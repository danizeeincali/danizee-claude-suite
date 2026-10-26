/**
 * layer-place — placement math for exported design layers. Each moving element is exported as its own image; this
 * verb says where that image goes on the page: which rule applies, and the left/top/width/height relative to the
 * frame, so the layer lines up with the source design. Pure: it reads JSON and prints the plan.
 *
 *   layer-place [--file <f>]   (layers JSON on stdin or --file, at most 8 MiB)
 *
 * Input: { frame:{x,y}, layers:[{ id, z, bounds:{x,y,w,h}, render_bounds?:{x,y,w,h}, image?:{w,h,scale},
 *          clipped_by_parent?, effects_even?, stroke_geometry?:{x,y,w,h}, shape?:"arc"|"rotated"|"mask"|"plain",
 *          children_move? }] }
 * Decision table, first match wins:
 *   1 absolute-bounds   shape arc / rotated / mask: export with absolute bounds, place at bounds.
 *   2 render-bounds     the image size equals render_bounds size x scale (each side within 1 px): place at render_bounds.
 *   3 overhang-offset   clipped_by_parent, or effects_even with an even overhang: place at bounds pushed out by the
 *                       overhang (render_bounds minus bounds on each side). Needs render_bounds.
 *   4 stroke-geometry   the overhang is uneven and stroke_geometry is given: place at stroke_geometry.
 *   5 bounds            nothing else fits: place at bounds and warn.
 * Positions are relative to the frame origin. children_move marks the layer's container to be rebuilt in CSS, with
 * each child exported on its own. Output is sorted by the original z, ties keeping input order.
 * Unknown keys, wrong types, non-finite numbers, negative sizes and duplicate ids are refused (exit 1).
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'layer-place';
export const usage = 'cli.js layer-place [--file <f>]  (layers JSON on stdin or --file; prints the placement of each exported layer)';

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const IMAGE_TOLERANCE_PX = 1;
const EPS = 1e-9;
const TOP_KEYS = ['frame', 'layers'];
const LAYER_KEYS = ['id', 'z', 'bounds', 'render_bounds', 'image', 'clipped_by_parent', 'effects_even', 'stroke_geometry', 'shape', 'children_move'];
const SHAPES = ['arc', 'rotated', 'mask', 'plain'];

const bad = m => new KitExit(m, 1);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, where) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${where} must be a finite number`);
  return v;
};
const size = (v, where) => {
  num(v, where);
  if (v < 0) throw bad(`${where} must not be negative`);
  return v;
};
const clean = n => (n === 0 ? 0 : n); // no -0 in the output
function noUnknown(o, allowed, where) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
}
function box(v, where) {
  if (!isObj(v)) throw bad(`${where} must be an object {x,y,w,h}`);
  noUnknown(v, ['x', 'y', 'w', 'h'], where);
  return { x: num(v.x, `${where}.x`), y: num(v.y, `${where}.y`), w: size(v.w, `${where}.w`), h: size(v.h, `${where}.h`) };
}
function bool(o, k, where) {
  if (o[k] !== undefined && typeof o[k] !== 'boolean') throw bad(`${where}.${k} must be a boolean`);
  return o[k] === true;
}

/** Validate the input; returns a fresh normalised { frame, layers }. */
export function normalize(input) {
  if (!isObj(input)) throw bad('input must be a JSON object with frame and layers');
  noUnknown(input, TOP_KEYS, 'input');
  if (!isObj(input.frame)) throw bad('input.frame must be an object {x,y}');
  noUnknown(input.frame, ['x', 'y'], 'input.frame');
  const frame = { x: num(input.frame.x, 'input.frame.x'), y: num(input.frame.y, 'input.frame.y') };
  if (!Array.isArray(input.layers)) throw bad('input.layers must be an array');
  const seen = new Set();
  const layers = input.layers.map((l, i) => {
    const where = `layers[${i}]`;
    if (!isObj(l)) throw bad(`${where} must be an object`);
    noUnknown(l, LAYER_KEYS, where);
    if (typeof l.id !== 'string' || !l.id) throw bad(`${where}.id must be a non-empty string`);
    if (seen.has(l.id)) throw bad(`${where}.id "${l.id}" is a duplicate`);
    seen.add(l.id);
    const out = { id: l.id, z: num(l.z, `${where}.z`), bounds: box(l.bounds, `${where}.bounds`) };
    if (l.render_bounds !== undefined) out.render_bounds = box(l.render_bounds, `${where}.render_bounds`);
    if (l.stroke_geometry !== undefined) out.stroke_geometry = box(l.stroke_geometry, `${where}.stroke_geometry`);
    if (l.image !== undefined) {
      if (!isObj(l.image)) throw bad(`${where}.image must be an object {w,h,scale}`);
      noUnknown(l.image, ['w', 'h', 'scale'], `${where}.image`);
      const scale = num(l.image.scale, `${where}.image.scale`);
      if (scale <= 0) throw bad(`${where}.image.scale must be greater than 0`);
      out.image = { w: size(l.image.w, `${where}.image.w`), h: size(l.image.h, `${where}.image.h`), scale };
    }
    if (l.shape !== undefined && !SHAPES.includes(l.shape)) throw bad(`${where}.shape must be one of ${SHAPES.join(', ')}`);
    out.shape = l.shape || 'plain';
    out.clipped_by_parent = bool(l, 'clipped_by_parent', where);
    out.effects_even = bool(l, 'effects_even', where);
    out.children_move = bool(l, 'children_move', where);
    return out;
  });
  return { frame, layers };
}

/** Overhang of render_bounds beyond bounds on each side (negative when render_bounds sits inside). */
export function overhang(bounds, rb) {
  return {
    left: clean(bounds.x - rb.x),
    top: clean(bounds.y - rb.y),
    right: clean(rb.x + rb.w - (bounds.x + bounds.w)),
    bottom: clean(rb.y + rb.h - (bounds.y + bounds.h)),
  };
}
const isEven = o => Math.abs(o.left - o.right) <= EPS && Math.abs(o.top - o.bottom) <= EPS;

/** True when the image size equals render_bounds size x scale, each side within 1 px. */
export function imageMatches(image, rb) {
  if (!image || !rb) return false;
  return Math.abs(image.w - rb.w * image.scale) <= IMAGE_TOLERANCE_PX + EPS
    && Math.abs(image.h - rb.h * image.scale) <= IMAGE_TOLERANCE_PX + EPS;
}

/** Place one normalised layer. Returns { placement, warning? }. */
export function placeLayer(layer, frame) {
  const at = (b, rule, why, extra = {}) => ({
    id: layer.id, rule, left: clean(b.x - frame.x), top: clean(b.y - frame.y), width: clean(b.w), height: clean(b.h), z: layer.z, ...extra, why,
  });
  const { bounds, render_bounds: rb } = layer;
  if (layer.shape === 'arc' || layer.shape === 'rotated' || layer.shape === 'mask') {
    return { placement: at(bounds, 'absolute-bounds', `${layer.shape} shape: export with absolute bounds and place at bounds`) };
  }
  if (rb && imageMatches(layer.image, rb)) {
    return { placement: at(rb, 'render-bounds', `image ${layer.image.w}x${layer.image.h} matches render bounds ${rb.w}x${rb.h} at scale ${layer.image.scale} (within ${IMAGE_TOLERANCE_PX}px)`) };
  }
  const ov = rb ? overhang(bounds, rb) : null;
  if (rb && (layer.clipped_by_parent || (layer.effects_even && isEven(ov)))) {
    const b = { x: bounds.x - ov.left, y: bounds.y - ov.top, w: bounds.w + ov.left + ov.right, h: bounds.h + ov.top + ov.bottom };
    return { placement: at(b, 'overhang-offset', `${layer.clipped_by_parent ? 'clipped by its parent' : 'even effects'}: bounds offset by the overhang (left ${ov.left}, top ${ov.top}, right ${ov.right}, bottom ${ov.bottom})`, { overhang: ov }) };
  }
  if (rb && !isEven(ov) && layer.stroke_geometry) {
    return { placement: at(layer.stroke_geometry, 'stroke-geometry', 'uneven overhang: placed at the stroke geometry', { overhang: ov }) };
  }
  return {
    placement: at(bounds, 'bounds', 'no rule matched: placed at bounds'),
    warning: `layer "${layer.id}": no placement rule matched (image does not match render bounds, no clipping or even effects, no stroke geometry for an uneven overhang); placed at bounds, check it against the source`,
  };
}

/** The whole plan: placements sorted by original z (ties keep input order), warnings, rebuild flag. */
export function plan(input) {
  const { frame, layers } = normalize(input);
  const warnings = [];
  const rebuild = [];
  const placements = layers.map((layer, index) => {
    const r = placeLayer(layer, frame);
    if (r.warning) warnings.push(r.warning);
    if (layer.children_move) { r.placement.rebuild_container_in_css = true; rebuild.push(layer.id); }
    return { index, p: r.placement };
  });
  placements.sort((a, b) => (a.p.z - b.p.z) || (a.index - b.index));
  const out = { placements: placements.map(x => x.p), warnings };
  if (rebuild.length) { out.rebuild_container_in_css = true; out.rebuild_container_ids = rebuild; }
  return out;
}

// ---- CLI ----

function parse(args) {
  const flags = {};
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (k !== 'file') throw bad(`unknown flag --${k} (allowed: --file)`);
    if (k in flags) throw bad('--file given more than once');
    if (!rest.length || rest[0].startsWith('--')) throw bad('--file needs a value');
    const v = rest.shift();
    if (!v) throw bad('--file must not be empty');
    flags[k] = v;
  }
  return flags;
}

async function readFileBounded(file) {
  let st;
  try { st = await fs.stat(file); } catch (e) { throw bad(`cannot read ${file}: ${e.code || e.message}`); }
  if (!st.isFile()) throw bad(`${file} is not a regular file`);
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    return buf.subarray(0, n);
  } catch (e) {
    throw bad(`cannot read ${file}: ${e.code || e.message}`);
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

export async function run(args, io) {
  const flags = parse(args);
  const cwd = io.cwd || process.cwd();
  const bytes = flags.file
    ? await readFileBounded(path.resolve(cwd, flags.file))
    : Buffer.from(await io.stdinBytes({ maxBytes: MAX_INPUT_BYTES + 1 }));
  if (bytes.length > MAX_INPUT_BYTES) throw bad(`input is larger than ${MAX_INPUT_BYTES} bytes`);
  const raw = bytes.toString('utf-8').replace(/^﻿/, '');
  if (!raw.trim()) throw bad('no input: pass layers JSON on stdin or --file');
  let data;
  try { data = JSON.parse(raw); } catch { throw bad('input is not valid JSON'); }
  return plan(data);
}
