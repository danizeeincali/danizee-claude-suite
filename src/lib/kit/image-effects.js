/**
 * image-effects — list and emit one-treatment image effects for the main visual of a page: glyph grid, halftone,
 * ordered dither or duotone, each as a self-contained snippet written for the product's own palette.
 *
 *   image-effects list                                                                         → { effects, rule }
 *   image-effects emit  --kind <glyph|halftone|dither|duotone> --palette <#hex,#hex[,#hex]>
 *                       [--selector <css selector>] [--chars <string>] [--cell <px>]           → { kind, html?, css, js?, notes }
 *   image-effects check --kind <glyph|halftone|dither|duotone> --palette <#hex,#hex[,#hex]>    → { kind, ok, palette, darkest, lightest, contrast, warnings, fix? }
 *
 * list prints the four treatments (id, label, when, cost, notes) and the rule: one treatment, on the main visual only.
 * emit prints a snippet to paste into the page. The palette is 2 or 3 hex colors (#rgb or #rrggbb). The selector (default
 * "img[data-image-effect]") names the image; only the first match is treated. Kinds:
 *   duotone  html: a hidden inline SVG <filter> (feColorMatrix to luminance, then feComponentTransfer tables mapping dark
 *            to the first color and light to the last, in the order given); css: `filter:url(#id)` on the selector. No js.
 *   halftone js: samples the image on a grid of --cell css px (default 8) and draws dots, bigger where the picture is darker,
 *            in palette[0] on palette[1].
 *   dither   js: ordered Bayer 4x4 dithering to the palette colors sorted dark to light; --cell is the pixel size in device
 *            pixels (default 3).
 *   glyph    js: maps brightness to characters from --chars (default " .:-=+*#%@", sparse to dense; 2 to 64 characters),
 *            from a prebuilt atlas; light ink on the darkest palette color. --cell default 8.
 * Every canvas script runs once when the image has loaded (no animation loop, no resize handler), keeps the original <img>
 * (visually hidden, its alt text intact) and marks the canvas aria-hidden, caps the grid at 40000 cells (the cell grows
 * until it fits), caps devicePixelRatio at 2, and falls back to the plain image when the canvas is tainted (cross-origin
 * SecurityError) or anything else throws. The only motion is a short fade-in, switched off under prefers-reduced-motion.
 * check validates the palette (2 or 3 valid hex colors), reports the darkest and lightest color and their WCAG contrast
 * ratio, and warns under 3 (exit 0; a warning is not an error).
 * Exit codes: 0 answer printed; 1 bad input (unknown kind, bad palette, unsafe selector, bad chars or cell, unknown or
 * duplicate flag). Input is only flags; nothing is read from files or stdin.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import { KitExit } from './kit-exit.js';

export const verb = 'image-effects';
export const usage = 'cli.js image-effects list | image-effects emit --kind <glyph|halftone|dither|duotone> --palette <#hex,#hex[,#hex]> [--selector <css>] [--chars <string>] [--cell <px>] | image-effects check --kind <kind> --palette <#hex,#hex[,#hex]>';

export const KINDS = ['glyph', 'halftone', 'dither', 'duotone'];
export const MAX_CELLS = 40000;
export const DEFAULT_SELECTOR = 'img[data-image-effect]';
export const DEFAULT_CHARS = ' .:-=+*#%@';
const DEFAULT_CELL = { glyph: 8, halftone: 8, dither: 3 };
const bad = m => new KitExit(m, 1);

const EFFECTS = [
  { id: 'glyph', label: 'Glyph grid', when: 'Developer, finance or technical products where the image can be built from the product\'s own characters (code symbols, money signs).', cost: 'Medium: one atlas and one pass over at most 40000 cells at load.', notes: 'Pass --chars with characters from the product\'s own material, sparse to dense. Light ink on the darkest palette color.' },
  { id: 'halftone', label: 'Halftone dots', when: 'Editorial, print or poster looks.', cost: 'Low: one pass over the grid at load.', notes: 'Dots in palette[0] on palette[1], bigger where the picture is darker.' },
  { id: 'dither', label: 'Ordered dither', when: 'Retro or technical looks with two or three flat colors.', cost: 'Low: one pass at load; the canvas is small and scaled up unsmoothed.', notes: 'Bayer 4x4 pattern to the palette sorted dark to light.' },
  { id: 'duotone', label: 'Duotone', when: 'Any generated or stock image that must match the palette; the simplest option.', cost: 'Lowest: a CSS filter, no JavaScript.', notes: 'Dark maps to the first color, light to the last. Works on any element, including cross-origin images.' }
];
const RULE = 'Use one treatment, on the main visual only; never as decoration elsewhere on the page.';

// ---- palette ----

/** Parse "#rgb" or "#rrggbb" into [r,g,b]; null when not a hex color. */
export function parseHex(s) {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(s).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

const toHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relLuminance([r, g, b]) {
  const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Validate the palette flag; returns the colors in the order given. */
export function parsePalette(str) {
  if (typeof str !== 'string' || !str.trim()) throw bad('--palette is required: 2 or 3 hex colors such as #0b1020,#f5c542');
  const parts = str.split(',').map(s => s.trim());
  if (parts.length < 2 || parts.length > 3) throw bad(`palette needs 2 or 3 colors, got ${parts.length}`);
  return parts.map(p => {
    const c = parseHex(p);
    if (!c) throw bad(`palette color "${p.slice(0, 40)}" is not a hex color (use #rgb or #rrggbb)`);
    return c;
  });
}

const byLuma = pal => [...pal].sort((a, b) => relLuminance(a) - relLuminance(b));

/** Contrast between the darkest and the lightest palette color. */
export function paletteReport(pal) {
  const s = byLuma(pal);
  const ratio = contrastRatio(s[0], s[s.length - 1]);
  const warnings = [];
  if (ratio < 3) warnings.push(`darkest and lightest colors have a contrast ratio of ${ratio.toFixed(2)}:1, under 3:1; the treated image will look flat`);
  return { darkest: toHex(s[0]), lightest: toHex(s[s.length - 1]), contrast: Math.round(ratio * 100) / 100, warnings };
}

/** Per-channel table values (0..1, in palette order) for the duotone feComponentTransfer. */
export function duotoneTables(pal) {
  const t = ch => pal.map(c => Math.round((c[ch] / 255) * 10000) / 10000);
  return { r: t(0), g: t(1), b: t(2) };
}

// ---- option validation ----

function checkSelector(sel) {
  if (typeof sel !== 'string' || !sel.trim()) throw bad('--selector must be a non-empty CSS selector');
  const s = sel.trim();
  if (s.length > 200) throw bad('--selector is longer than 200 characters');
  if (!/^[A-Za-z0-9_\-\s#.:>+~*,()\[\]="'^$|]+$/.test(s)) throw bad('--selector may use letters, digits, spaces and # . : > + ~ * , ( ) [ ] = " \' ^ $ | - _ only');
  return s;
}

function checkChars(str) {
  const chars = Array.from(str);
  if (chars.length < 2 || chars.length > 64) throw bad(`--chars needs 2 to 64 characters, got ${chars.length}`);
  if (chars.some(c => /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(c))) throw bad('--chars must not contain control characters');
  return chars;
}

function checkCell(v, kind) {
  if (v === undefined) return DEFAULT_CELL[kind];
  if (!/^\d+$/.test(v)) throw bad('--cell must be a whole number of pixels');
  const n = Number(v);
  if (n < 2 || n > 64) throw bad('--cell must be between 2 and 64');
  return n;
}

/** A JS string literal that is safe inside an inline <script>. */
const jsLit = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// ---- emit ----

const CANVAS_CSS = [
  '.ie-canvas{display:block;width:100%;height:auto}',
  '.ie-pixel{image-rendering:pixelated}',
  '.ie-done{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important}',
  '@media (prefers-reduced-motion:no-preference){.ie-canvas{animation:ie-in 400ms ease-out}@keyframes ie-in{from{opacity:0}to{opacity:1}}}'
];

function duotone(pal, selector) {
  const id = 'ie-duotone-' + pal.map(c => toHex(c).slice(1)).join('-');
  const t = duotoneTables(pal);
  const tv = a => a.join(' ');
  const html = [
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">',
    `  <filter id="${id}" color-interpolation-filters="sRGB">`,
    '    <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"/>',
    '    <feComponentTransfer>',
    `      <feFuncR type="table" tableValues="${tv(t.r)}"/>`,
    `      <feFuncG type="table" tableValues="${tv(t.g)}"/>`,
    `      <feFuncB type="table" tableValues="${tv(t.b)}"/>`,
    '    </feComponentTransfer>',
    '  </filter>',
    '</svg>'
  ].join('\n');
  return { html, css: `${selector}{filter:url(#${id})}`, id, tables: t };
}

function canvasScript(kind, pal, selector, cell, chars) {
  const sorted = byLuma(pal);
  const colors = kind === 'halftone' ? pal : sorted;
  const head = [
    '(function(){',
    `var SEL=${jsLit(selector)},P=${JSON.stringify(colors)},CELL=${cell},MAXC=${MAX_CELLS};`,
    kind === 'glyph' ? `var CH=Array.from(${jsLit(chars.join(''))});` : '',
    'var DPR=Math.min(window.devicePixelRatio||1,2);',
    'var img=null,list=document.querySelectorAll(SEL),cv=null,ran=false;',
    'for(var q=0;q<list.length;q++){if(list[q].tagName==="IMG"&&!list[q].__ie){img=list[q];break;}}',
    'if(!img)return;img.__ie=1;',
    'function rgb(c){return "rgb("+c[0]+","+c[1]+","+c[2]+")";}',
    'function fallback(){if(cv&&cv.parentNode)cv.parentNode.removeChild(cv);cv=null;img.classList.remove("ie-done");}',
    'function grid(w,h){var c=CELL,cols,rows;do{cols=Math.max(1,Math.round(w/c));rows=Math.max(1,Math.round(h/c));c+=1;}while(cols*rows>MAXC);return{cols:cols,rows:rows};}',
    'function sample(cols,rows){var s=document.createElement("canvas");s.width=cols;s.height=rows;var sc=s.getContext("2d");sc.drawImage(img,0,0,cols,rows);return sc.getImageData(0,0,cols,rows).data;}',
    'function lum(d,i){return (0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])/255*(d[i+3]/255);}',
    'function mount(){cv.className="ie-canvas"+('+ (kind === 'dither' ? '" ie-pixel"' : '""') + ');cv.setAttribute("aria-hidden","true");img.parentNode.insertBefore(cv,img.nextSibling);img.classList.add("ie-done");}',
    'function size(w,h){var d=Math.min(DPR,4096/Math.max(w,h));return d>0?d:1;}'
  ];
  const bodies = {
    halftone: [
      'function render(){',
      'var nw=img.naturalWidth,nh=img.naturalHeight;if(!nw||!nh)return;',
      'var w=Math.max(1,Math.round(img.clientWidth||nw)),h=Math.max(1,Math.round(w*nh/nw));',
      'var g=grid(w,h),d=sample(g.cols,g.rows),dp=size(w,h);',
      'cv=document.createElement("canvas");cv.width=Math.round(w*dp);cv.height=Math.round(h*dp);',
      'var x=cv.getContext("2d");x.scale(dp,dp);x.fillStyle=rgb(P[1]);x.fillRect(0,0,w,h);x.fillStyle=rgb(P[0]);',
      'var cw=w/g.cols,ch=h/g.rows,rmax=Math.max(cw,ch)*0.7;',
      'for(var j=0;j<g.rows;j++)for(var i=0;i<g.cols;i++){var r=Math.sqrt(1-lum(d,(j*g.cols+i)*4))*rmax;if(r<0.2)continue;x.beginPath();x.arc((i+0.5)*cw,(j+0.5)*ch,r,0,6.283185307);x.fill();}',
      'mount();}'
    ],
    dither: [
      'var B=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];',
      'function render(){',
      'var nw=img.naturalWidth,nh=img.naturalHeight;if(!nw||!nh)return;',
      'var w=Math.max(1,Math.round(img.clientWidth||nw)),h=Math.max(1,Math.round(w*nh/nw));',
      'var g=grid(w*DPR,h*DPR),d=sample(g.cols,g.rows),k=P.length;',
      'cv=document.createElement("canvas");cv.width=g.cols;cv.height=g.rows;',
      'var x=cv.getContext("2d"),o=x.createImageData(g.cols,g.rows),od=o.data;',
      'for(var j=0;j<g.rows;j++)for(var i=0;i<g.cols;i++){var p=(j*g.cols+i)*4,v=lum(d,p)*(k-1),a=Math.min(k-2,Math.floor(v)),t=(B[(j&3)*4+(i&3)]+0.5)/16,c=P[v-a>t?a+1:a];od[p]=c[0];od[p+1]=c[1];od[p+2]=c[2];od[p+3]=255;}',
      'x.putImageData(o,0,0);mount();}'
    ],
    glyph: [
      'function render(){',
      'var nw=img.naturalWidth,nh=img.naturalHeight;if(!nw||!nh)return;',
      'var w=Math.max(1,Math.round(img.clientWidth||nw)),h=Math.max(1,Math.round(w*nh/nw));',
      'var g=grid(w,h),d=sample(g.cols,g.rows),dp=size(w,h),n=CH.length,k=P.length-1;',
      'var pw=Math.max(1,Math.ceil(w/g.cols*dp)),ph=Math.max(1,Math.ceil(h/g.rows*dp));',
      'var at=document.createElement("canvas");at.width=pw*n;at.height=ph*k;var a=at.getContext("2d");',
      'a.font=Math.max(4,Math.floor(ph*0.9))+"px monospace";a.textAlign="center";a.textBaseline="middle";',
      'for(var r=0;r<k;r++){a.fillStyle=rgb(P[r+1]);for(var s=0;s<n;s++)a.fillText(CH[s],s*pw+pw/2,r*ph+ph/2);}',
      'cv=document.createElement("canvas");cv.width=g.cols*pw;cv.height=g.rows*ph;',
      'var x=cv.getContext("2d");x.fillStyle=rgb(P[0]);x.fillRect(0,0,cv.width,cv.height);',
      'for(var j=0;j<g.rows;j++)for(var i=0;i<g.cols;i++){var l=lum(d,(j*g.cols+i)*4),ix=Math.min(n-1,Math.floor(l*(n-1)+0.5)),row=k>1&&l>=0.5?1:0;x.drawImage(at,ix*pw,row*ph,pw,ph,i*pw,j*ph,pw,ph);}',
      'mount();}'
    ]
  };
  const tail = [
    'function go(){if(ran)return;ran=true;try{render();}catch(e){fallback();}}',
    'if(img.complete&&img.naturalWidth)go();else{img.addEventListener("load",go,{once:true});img.addEventListener("error",fallback,{once:true});}',
    '})();'
  ];
  return [...head.filter(Boolean), ...bodies[kind], ...tail].join('\n');
}

/** Build the snippet for one kind. */
export function emitEffect(kind, paletteStr, opts = {}) {
  if (!KINDS.includes(kind)) throw bad(`--kind must be one of ${KINDS.join(', ')}`);
  const pal = parsePalette(paletteStr);
  const selector = opts.selector === undefined ? DEFAULT_SELECTOR : checkSelector(opts.selector);
  if (opts.chars !== undefined && kind !== 'glyph') throw bad('--chars only applies to --kind glyph');
  if (opts.cell !== undefined && kind === 'duotone') throw bad('--cell does not apply to --kind duotone');
  const chars = kind === 'glyph' ? checkChars(opts.chars === undefined ? DEFAULT_CHARS : opts.chars) : null;
  const rep = paletteReport(pal);
  const notes = [RULE, ...rep.warnings];
  if (kind === 'duotone') {
    const d = duotone(pal, selector);
    notes.push('Dark maps to the first color and light to the last, in the order given. Put the SVG once in the body; the CSS goes in a stylesheet. No script is needed and the alt text is untouched.');
    return { kind, html: d.html, css: d.css, notes };
  }
  const cell = checkCell(opts.cell, kind);
  const ink = { halftone: 'Dots use the first color on the second.', dither: 'Colors are sorted dark to light.', glyph: 'The darkest color is the background; the others are the ink.' }[kind];
  notes.push(ink,
    'Place the <script> after the image. It runs once on load, treats the first matching <img> only, keeps that <img> (visually hidden, alt text intact) and marks the canvas aria-hidden.',
    `The grid is capped at ${MAX_CELLS} cells and devicePixelRatio at 2; a cross-origin image without CORS falls back to the plain image. The canvas is not redrawn on resize.`,
    'The fade-in is switched off under prefers-reduced-motion.');
  return { kind, css: [`${selector}{display:block}`, ...CANVAS_CSS].join('\n'), js: canvasScript(kind, pal, selector, cell, chars), notes };
}

export function checkPalette(kind, paletteStr) {
  if (!KINDS.includes(kind)) throw bad(`--kind must be one of ${KINDS.join(', ')}`);
  const pal = parsePalette(paletteStr);
  const rep = paletteReport(pal);
  const out = { kind, ok: rep.warnings.length === 0, palette: pal.map(toHex), ...rep };
  if (!out.ok) out.fix = 'Pick a darker darkest color or a lighter lightest color until the contrast ratio reaches 3:1.';
  return out;
}

// ---- CLI ----

const KNOWN = { list: [], emit: ['kind', 'palette', 'selector', 'chars', 'cell'], check: ['kind', 'palette'] };

function parse(args) {
  const [sub, ...rest] = args;
  if (!Object.prototype.hasOwnProperty.call(KNOWN, sub)) throw bad(`image-effects needs a subcommand: list, emit or check\n${usage}`);
  const known = KNOWN[sub];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"`);
    const k = a.slice(2);
    if (!known.includes(k)) throw bad(`unknown option "${a}" for ${sub}${known.length ? ` (allowed: ${known.map(x => '--' + x).join(', ')})` : ' (it takes no options)'}`);
    if (Object.prototype.hasOwnProperty.call(flags, k)) throw bad(`${a} given twice`);
    if (i + 1 >= rest.length) throw bad(`${a} needs a value`);
    const v = rest[++i];
    if (v === '') throw bad(`${a} has an empty value`);
    if (v.startsWith('--')) throw bad(`${a} needs a value, got "${v}"`);
    flags[k] = v;
  }
  return { sub, flags };
}

export async function run(args) {
  const { sub, flags } = parse(args);
  if (sub === 'list') return { effects: EFFECTS.map(e => ({ ...e })), rule: RULE };
  if (flags.kind === undefined) throw bad(`--kind is required (${KINDS.join(', ')})`);
  if (sub === 'check') return checkPalette(flags.kind, flags.palette);
  return emitEffect(flags.kind, flags.palette, { selector: flags.selector, chars: flags.chars, cell: flags.cell });
}
