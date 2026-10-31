/**
 * page-snapshot — save a live page as ONE standalone static HTML copy plus a screenshot, so a redesign can start from a
 * link: work on the copy, compare against the screenshot. The page is loaded in headless Chromium at a set viewport, the
 * network is given time to settle and fonts to load, then the rendered document is copied: stylesheets are inlined into
 * <style>, images and CSS url() assets become data: URIs under a size cap, scripts, iframes, srcset and <base> are dropped,
 * and links are made absolute. Nothing runs when the copy is opened. Scripted or canvas-drawn animated backgrounds do
 * not survive the copy: describe them from the screenshot.
 *
 *   page-snapshot plan --url <url> [--out <dir>]
 *       → { url, local, needs_consent, out_files:[...], viewport:{width,height}, next }. No browser and no network.
 *       local is true for file:// and http(s)://localhost or 127.0.0.1. needs_consent is true for every other http(s) URL:
 *       capturing it needs --allow-remote, which the workflow passes only after the user named the live URL and agreed.
 *       out_files is page.html, screenshot.png, manifest.json (joined to --out when given).
 *   page-snapshot capture --url <url> --out <dir> [--width 1440] [--height 900] [--full-page] [--allow-remote]
 *                         [--theme light|dark] [--timeout-ms <ms>] [--max-asset-bytes <n>] [--max-total-bytes <n>]
 *       → { captured, out, url, page, screenshot, manifest, inlined_count, inlined_bytes, skipped_count, blocked_origins,
 *       network_idle, next }. Writes <out>/page.html, <out>/screenshot.png and <out>/manifest.json
 *       { url, final_url, at, viewport:{width,height,full_page}, theme, remote, network_idle, files, inlined:[{url,mime,bytes}],
 *       skipped:[{url,reason}], blocked_origins }. Stale files of an earlier run are replaced; the manifest is written last.
 *       page.html carries <meta name="snapshot-source" content="<url>" data-at="<iso time>">. Each asset embeds at most
 *       2 MiB (--max-asset-bytes) and the copy embeds at most 20 MiB in all (--max-total-bytes); an asset over either cap,
 *       an asset the page never loaded, or one of an unsupported type keeps its absolute URL and is listed in skipped with
 *       the reason. --theme forces prefers-color-scheme to light or dark in the browser and in the copy's media queries.
 *       --full-page screenshots the whole scrollable page. The page's rendered DOM may not exceed 8 MiB.
 *       Network policy: file:// and http(s)://localhost or 127.0.0.1 are allowed and everything else is blocked at the
 *       browser (no name but localhost resolves, no proxy, non-local requests and WebSockets aborted). Any other URL is
 *       refused with exit 2 and nothing is launched, unless --allow-remote is given; then only the given URL's own origin
 *       and the asset origins the page itself requests are reached: no links are followed after the load, no form or other
 *       non-GET request is sent, WebSockets, service workers, downloads and iframes are blocked, and the context is fresh
 *       (no cookies, credentials or storage state). Asset bytes are the ones the browser itself received, nothing is fetched
 *       by Node. Loads playwright only if the project can resolve it (it is not a dependency of this suite); if not,
 *       returns { captured:false, reason:"playwright not installed: page-snapshot capture needs it", exit:4 }.
 *
 * Exit codes: 0 answer printed · 1 bad input or broken state (bad flag, unparseable URL, HTTP error, DOM over 8 MiB, --out
 * a symlink or a file, page could not load) · 2 URL refused by the network policy (not local and no --allow-remote, or an
 * unsupported scheme, credentials in the URL) · 4 playwright or its browser is missing.
 *
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KitExit } from './kit-exit.js';
import { resolvePlaywright, LAUNCH_ARGS } from './frame-capture.js';

export const verb = 'page-snapshot';
export const usage = 'cli.js page-snapshot plan --url <url> [--out <dir>] | capture --url <url> --out <dir> [--width 1440] [--height 900] [--full-page] [--allow-remote] [--theme light|dark] [--timeout-ms <ms>] [--max-asset-bytes <n>] [--max-total-bytes <n>]  (JSON out; exit 1 bad input; exit 2 URL refused, remote needs --allow-remote; exit 4 playwright missing)';

export const NOT_INSTALLED = 'playwright not installed: page-snapshot capture needs it';
export const MAX_ASSET_BYTES = 2 * 1048576;
export const MAX_TOTAL_BYTES = 20 * 1048576;
export const MAX_HTML_BYTES = 8 * 1048576;
export const OUT_FILES = Object.freeze(['page.html', 'screenshot.png', 'manifest.json']);
const MAX_STORED_BYTES = 64 * 1048576;
const MAX_LISTED = 1000;
const DEFAULT_TIMEOUT_MS = 30000;

const bad = (m, code = 1) => new KitExit(m, code);
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

// ---------------------------------------------------------------- URL policy

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const isLocalHttp = (u) => (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname) && !u.username && !u.password;

/** Classify a page URL: { href, local } or throw KitExit 1 (not a URL) / 2 (a scheme or form the policy never loads). */
export function classifyUrl(s) {
  let u;
  try { u = new URL(s); } catch { throw bad(`--url is not a valid URL: ${JSON.stringify(String(s).slice(0, 80))}`); }
  if (u.username || u.password) throw bad('url refused: credentials in the URL', 2);
  if (u.protocol === 'file:') {
    if (u.hostname !== '') throw bad('url refused: file:// URLs with a host are not loaded', 2);
    return { href: u.href, local: true, protocol: 'file:' };
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return { href: u.href, local: isLocalHttp(u), protocol: u.protocol };
  throw bad(`url refused: only file:// and http(s) pages are captured, got ${u.protocol}`, 2);
}

function checkConsent(target, allowRemote) {
  if (!target.local && !allowRemote) {
    throw bad(`url refused: ${new URL(target.href).origin} is not local. Capturing a live remote page is a network call: ask the user, then pass --allow-remote`, 2);
  }
}

/** Should a browser request be let through? mode is 'local' (file or localhost page) or 'remote'. */
export function allowRequest(rawUrl, mode, pageProtocol = 'file:') {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  if (mode === 'local') {
    if (u.protocol === 'file:') return pageProtocol === 'file:' && u.hostname === '';
    return isLocalHttp(u);
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
}

// ---------------------------------------------------------------- pure string work

export const asciiLower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const SKIP = Symbol('skip');
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes']);

export const decodeAttr = (v) => v.replace(/&(amp|quot|#39|#x27|lt|gt);/gi, (m, e) => ({ amp: '&', quot: '"', '#39': "'", '#x27': "'", lt: '<', gt: '>' })[e.toLowerCase()]);
export const encodeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Absolute form of a URL value against base; data:, blob:, about:, javascript:, mailto:, tel: and #fragments are returned unchanged. */
export function absolutizeUrl(value, base) {
  const v = String(value).trim();
  if (!v || v.startsWith('#') || /^(data|blob|about|javascript|mailto|tel):/i.test(v)) return v;
  try { return new URL(v, base).href; } catch { return v; }
}

/**
 * One linear walk over serialized HTML. tag(t) is called for each start tag with
 * t = { name, rawName, attrs:[{name, rawName, value|null}], self, changed } and may mutate t.attrs (set t.changed) or return a
 * replacement string for the whole tag, or SKIP to remove it (a raw-text element is removed with its content).
 * raw(t, content) may return replacement content for a raw-text element (style, textarea, ...). A tag that is never closed
 * ends the walk and the rest is kept verbatim, so every input costs one pass.
 */
export function scanHtml(html, { tag, raw }) {
  const lower = asciiLower(html);
  const n = html.length;
  const out = [];
  let copy = 0;
  let i = 0;
  const replace = (a, b, text) => { out.push(html.slice(copy, a), text); copy = b; };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); if (e < 0) break; i = e + 3; continue; }
    const isEnd = html.charCodeAt(lt + 1) === 47;
    const ns = lt + (isEnd ? 2 : 1);
    if (!isAlpha(html.charCodeAt(ns))) { i = lt + 1; continue; }
    let p = ns;
    for (let c; p < n && !isWs((c = html.charCodeAt(p))) && c !== 62 && c !== 47; p++);
    const rawName = html.slice(ns, p);
    const attrs = [];
    let self = false;
    let closed = false;
    while (p < n) {
      let c = html.charCodeAt(p);
      if (isWs(c)) { p++; continue; }
      if (c === 62) { closed = true; p++; break; }
      if (c === 47) { if (html.charCodeAt(p + 1) === 62) self = true; p++; continue; }
      const as = p;
      for (; p < n; p++) {
        c = html.charCodeAt(p);
        if (isWs(c) || c === 61 || c === 62 || (c === 47 && html.charCodeAt(p + 1) === 62)) break;
      }
      if (p === as) p++;
      const an = html.slice(as, p);
      let q = p;
      while (q < n && isWs(html.charCodeAt(q))) q++;
      let value = null;
      if (html.charCodeAt(q) === 61) {
        q++;
        while (q < n && isWs(html.charCodeAt(q))) q++;
        const qc = html[q];
        if (qc === '"' || qc === "'") {
          const e = html.indexOf(qc, q + 1);
          if (e < 0) { p = n; break; }
          value = html.slice(q + 1, e);
          p = e + 1;
        } else {
          const vs = q;
          for (let c2; q < n && !isWs((c2 = html.charCodeAt(q))) && c2 !== 62; q++);
          value = html.slice(vs, q);
          p = q;
        }
      }
      attrs.push({ name: an.toLowerCase(), rawName: an, value });
    }
    if (!closed) break;
    const name = asciiLower(rawName);
    const isRaw = !isEnd && !self && RAW_TEXT.has(name);
    let contentEnd = p;
    let closeEnd = p;
    if (isRaw) {
      const ci = lower.indexOf('</' + name, p);
      contentEnd = ci < 0 ? n : ci;
      const gt = ci < 0 ? -1 : html.indexOf('>', ci);
      closeEnd = ci < 0 || gt < 0 ? n : gt + 1;
    }
    let t = null;
    if (!isEnd) {
      t = { name, rawName, attrs, self, changed: false };
      const res = tag ? tag(t) : undefined;
      if (res === SKIP) { replace(lt, isRaw ? closeEnd : p, ''); i = isRaw ? closeEnd : p; continue; }
      if (typeof res === 'string') replace(lt, p, res);
      else if (t.changed) replace(lt, p, serializeTag(t));
    }
    if (isRaw) {
      if (raw) { const nc = raw(t, html.slice(p, contentEnd)); if (typeof nc === 'string') replace(p, contentEnd, nc); }
      i = contentEnd;
    } else i = p;
  }
  out.push(html.slice(copy));
  return out.join('');
}

function serializeTag(t) {
  let s = '<' + t.rawName;
  for (const a of t.attrs) s += ' ' + a.rawName + (a.value === null ? '' : '="' + a.value.replace(/"/g, '&quot;') + '"');
  return s + (t.self ? '/>' : '>');
}
const getAttr = (t, name) => { const a = t.attrs.find((x) => x.name === name); return a && a.value !== null ? decodeAttr(a.value) : null; };
const hasAttr = (t, name) => t.attrs.some((x) => x.name === name);
function setAttr(t, name, decoded) {
  const a = t.attrs.find((x) => x.name === name);
  if (a) a.value = encodeAttr(decoded); else t.attrs.push({ name, rawName: name, value: encodeAttr(decoded) });
  t.changed = true;
}
function dropAttrs(t, test) {
  const keep = t.attrs.filter((a) => !test(a));
  if (keep.length !== t.attrs.length) { t.attrs = keep; t.changed = true; }
}

/** Force prefers-color-scheme in media queries: the wanted scheme always matches, the other never does. */
export function forceScheme(css, scheme) {
  return css.replace(/\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi, (m, s) => (s.toLowerCase() === scheme ? '(min-width: 0px)' : '(max-width: -1px)'));
}

const CSS_URL = /url\(\s*(?:"([^"\\\n]*)"|'([^'\\\n]*)')\s*\)|url\(([^)"'(]*)\)/gi;
const CSS_IMPORT = /@import\s*(["'])([^"'\\\n]*)\1/gi;
const cssQuote = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ') + '"';

/**
 * A snapshot's byte budget and ledger. lookup(url) returns { mime, body:Buffer } | { tooBig:true, bytes } | null.
 */
export function makeBudget({ lookup = null, maxAsset = MAX_ASSET_BYTES, maxTotal = MAX_TOTAL_BYTES } = {}) {
  return { lookup, maxAsset, maxTotal, used: 0, inlined: new Map(), skipped: new Map(), removed: { scripts: 0, iframes: 0 } };
}

const SAFE_MIME = /^(image\/[\w.+-]+|font\/[\w.+-]+|application\/(x-)?font[\w.+-]*|application\/vnd\.ms-fontobject|application\/octet-stream|binary\/octet-stream)$/i;
const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css' };
export const mimeForPath = (p) => EXT_MIME[String(p).split(/[?#]/)[0].split('.').pop().toLowerCase()] || null;

function skip(b, url, reason) { if (!b.skipped.has(url)) b.skipped.set(url, reason); return null; }

/** Data URI for the absolute url, or null (and a ledger entry saying why). */
export function inlineAsset(abs, b) {
  if (!b.lookup || !/^(https?|file):/i.test(abs)) return null;
  const key = abs.split('#')[0];
  const hit = b.lookup(key);
  if (!hit) return skip(b, abs, 'the page never loaded it');
  const bytes = hit.tooBig ? hit.bytes : hit.body.length;
  if (hit.tooBig || bytes > b.maxAsset) return skip(b, abs, `over the per-asset cap (${b.maxAsset} bytes)`);
  let mime = String(hit.mime || '').split(';')[0].trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') mime = mimeForPath(key) || mime;
  if (!SAFE_MIME.test(mime)) return skip(b, abs, `unsupported type ${mime || 'unknown'}`);
  if (b.used + bytes > b.maxTotal) return skip(b, abs, `over the total cap (${b.maxTotal} bytes)`);
  b.used += bytes;
  if (!b.inlined.has(abs)) b.inlined.set(abs, { url: abs, mime, bytes });
  return `data:${mime};base64,${hit.body.toString('base64')}`;
}

/** CSS text: url() and @import strings made absolute against base, url() assets inlined when a budget with a lookup is given, scheme forced. */
export function transformCss(css, { base, budget = null, theme = null }) {
  let s = theme ? forceScheme(css, theme) : css;
  s = s.replace(CSS_IMPORT, (m, q, v) => `@import ${cssQuote(absolutizeUrl(v, base))}`);
  return s.replace(CSS_URL, (m, a, b2, c) => {
    const v = (a ?? b2 ?? c ?? '').trim();
    if (!v || v.startsWith('#') || /^data:/i.test(v)) return m;
    const abs = absolutizeUrl(v, base);
    const inl = budget ? inlineAsset(abs, budget) : null;
    return `url(${cssQuote(inl || abs)})`;
  });
}

const URL_ATTRS = new Set(['href', 'src', 'poster', 'action', 'formaction', 'background', 'xlink:href']);

/**
 * Rewrite a serialized DOM into the static copy: scripts, iframes, <base>, refresh and CSP metas, preloads, on* handlers,
 * srcset removed; URLs absolute against base; style text and style attributes transformed; img/icon/poster/svg image
 * sources inlined as data URIs when budget.lookup is set. headInsert is placed right after <head>.
 */
export function transformHtml(html, { base, budget = null, theme = null, headInsert = '' }) {
  let headDone = false;
  return scanHtml(html, {
    tag(t) {
      const nm = t.name;
      if (nm === 'script') { if (budget) budget.removed.scripts++; return SKIP; }
      if (nm === 'iframe') {
        if (budget) { budget.removed.iframes++; const s = getAttr(t, 'src'); if (s) skip(budget, absolutizeUrl(s, base), 'iframe removed from the static copy'); }
        return SKIP;
      }
      if (nm === 'base') return SKIP;
      if (nm === 'meta') {
        const he = (getAttr(t, 'http-equiv') || '').toLowerCase();
        if (he === 'refresh' || he === 'content-security-policy' || he === 'content-type' || hasAttr(t, 'charset')) return SKIP;
      }
      if (nm === 'link') {
        const rel = (getAttr(t, 'rel') || '').toLowerCase().split(/\s+/);
        if (rel.some((r) => ['modulepreload', 'preload', 'prefetch', 'prerender', 'dns-prefetch', 'preconnect'].includes(r))) return SKIP;
      }
      if (nm === 'source' && hasAttr(t, 'srcset') && !hasAttr(t, 'src')) return SKIP;
      dropAttrs(t, (a) => a.name.startsWith('on') || a.name === 'srcset' || a.name === 'sizes' || a.name === 'imagesrcset' || a.name === 'imagesizes' || a.name === 'integrity' || a.name === 'nonce');
      const imageish = nm === 'img' || nm === 'image' || (nm === 'input' && (getAttr(t, 'type') || '').toLowerCase() === 'image')
        || (nm === 'link' && /\bicon\b/i.test(getAttr(t, 'rel') || ''));
      for (const a of t.attrs) {
        if (a.value === null) continue;
        const wantsInline = (imageish && (a.name === 'src' || a.name === 'href' || a.name === 'xlink:href')) || (nm === 'video' && a.name === 'poster');
        if (a.name === 'style') {
          const next = transformCss(decodeAttr(a.value), { base, budget, theme });
          if (encodeAttr(next) !== a.value) { a.value = encodeAttr(next); t.changed = true; }
        } else if (URL_ATTRS.has(a.name)) {
          const v = decodeAttr(a.value);
          let next;
          if (/^\s*javascript:/i.test(v)) next = a.name === 'href' || a.name === 'action' || a.name === 'formaction' ? '#' : '';
          else {
            next = absolutizeUrl(v, base);
            if (wantsInline && budget) next = inlineAsset(next, budget) || next;
          }
          if (next !== v) { a.value = encodeAttr(next); t.changed = true; }
        }
      }
      if (nm === 'head' && !headDone && headInsert) { headDone = true; return serializeTag(t) + headInsert; }
      return undefined;
    },
    raw(t, content) {
      if (t.name !== 'style') return undefined;
      const sheetBase = getAttr(t, 'data-snapshot-href') || base;
      return transformCss(content, { base: sheetBase, budget, theme }).replace(/<\/style/gi, '<\\/style');
    },
  });
}

/** The head insert: utf-8 charset and the source meta. */
export function sourceMeta(url, at) {
  return `<meta charset="utf-8"><meta name="snapshot-source" content="${encodeAttr(url)}" data-at="${encodeAttr(at)}">`;
}

/** Assemble the standalone document from the browser's DOM report (see snapshotDom). pendingCss maps a placeholder number to css text or null. */
export function buildSnapshot(dom, { url, at, lookup = null, pendingCss = {}, theme = null, maxAsset, maxTotal }) {
  const budget = makeBudget({ lookup, maxAsset, maxTotal });
  let html = dom.html;
  for (const p of dom.pending || []) {
    const marker = `<style data-snapshot-pending="${p.n}"></style>`;
    const css = pendingCss[p.n];
    const media = p.media && p.media !== 'all' ? ` media="${encodeAttr(p.media)}"` : '';
    let rep;
    if (typeof css === 'string') rep = `<style${media} data-snapshot-href="${encodeAttr(p.href)}">${css.replace(/<\/style/gi, '<\\/style')}</style>`;
    else { skip(budget, p.href, 'stylesheet could not be read; linked instead'); rep = `<link rel="stylesheet"${media} href="${encodeAttr(p.href)}">`; }
    html = html.split(marker).join(rep);
  }
  const body = transformHtml(html, { base: dom.baseUri, budget, theme, headInsert: sourceMeta(url, at) });
  return { html: `${dom.doctype || '<!DOCTYPE html>'}\n${body}\n`, budget };
}

// ---------------------------------------------------------------- the in-browser pass

/**
 * Runs inside the page (no closures): clones the document, replaces each readable stylesheet link with a <style> holding its
 * CSSOM text (imports expanded, constructed sheets appended), marks sheets the browser will not let script read as
 * pending, resolves srcset images to the chosen source, and reports the document's base URL.
 */
export function snapshotDom() {
  const doc = document;
  const clone = doc.documentElement.cloneNode(true);
  const pending = [];
  const sheetText = (sheet, depth) => {
    let rules;
    try { rules = sheet.cssRules; } catch { return null; }
    let out = '';
    for (const r of rules) {
      if (r.type === 3 && r.styleSheet) {
        if (depth >= 6) continue;
        const inner = sheetText(r.styleSheet, depth + 1);
        const mq = r.media && r.media.mediaText;
        if (inner === null) out += `@import url("${r.styleSheet.href}")${mq && mq !== 'all' ? ' ' + mq : ''};\n`;
        else out += mq && mq !== 'all' ? `@media ${mq} {\n${inner}}\n` : inner;
      } else out += r.cssText + '\n';
    }
    return out;
  };
  const origStyles = doc.documentElement.querySelectorAll('style');
  const cloneStyles = clone.querySelectorAll('style');
  origStyles.forEach((s, i) => {
    if (!s.sheet) return;
    const text = sheetText(s.sheet, 0);
    if (text) cloneStyles[i].textContent = text;
  });
  const origLinks = doc.documentElement.querySelectorAll('link[rel~="stylesheet" i]');
  const cloneLinks = clone.querySelectorAll('link[rel~="stylesheet" i]');
  origLinks.forEach((l, i) => {
    const c = cloneLinks[i];
    if (!l.sheet || l.disabled) return;
    const text = sheetText(l.sheet, 0);
    const st = doc.createElement('style');
    const media = l.getAttribute('media');
    if (text === null) {
      st.setAttribute('data-snapshot-pending', String(pending.length));
      pending.push({ n: pending.length, href: l.href, media: media || 'all' });
    } else {
      if (media) st.setAttribute('media', media);
      st.setAttribute('data-snapshot-href', l.href);
      st.textContent = text;
    }
    c.replaceWith(st);
  });
  const adopted = (doc.adoptedStyleSheets || []).map((s) => sheetText(s, 0)).filter(Boolean);
  if (adopted.length) {
    const st = doc.createElement('style');
    st.textContent = adopted.join('\n');
    (clone.querySelector('head') || clone).appendChild(st);
  }
  const origImgs = doc.documentElement.querySelectorAll('img');
  const cloneImgs = clone.querySelectorAll('img');
  origImgs.forEach((im, i) => { if (im.currentSrc) cloneImgs[i].setAttribute('src', im.currentSrc); });
  const dt = doc.doctype;
  return {
    doctype: dt ? new XMLSerializer().serializeToString(dt) : '<!DOCTYPE html>',
    html: clone.outerHTML,
    baseUri: doc.baseURI,
    pending,
    title: doc.title,
  };
}

// ---------------------------------------------------------------- flags

function parseFlags(args, allowed, booleans = []) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"; ${usage}`);
    let val = null;
    const eq = a.indexOf('=');
    if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    const k = a.slice(2);
    if (!allowed.includes(k) && !booleans.includes(k)) throw bad(`unknown option ${a}; ${usage}`);
    if (Object.hasOwn(out, k)) throw bad(`--${k} given twice`);
    if (booleans.includes(k)) {
      if (val !== null) throw bad(`--${k} takes no value`);
      out[k] = true;
      continue;
    }
    if (val === null) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw bad(`--${k} needs a value`);
      val = args[++i];
    }
    if (val === '') throw bad(`--${k} needs a non-empty value`);
    out[k] = val;
  }
  return out;
}
function intFlag(f, k, min, max, dflt) {
  if (f[k] === undefined) return dflt;
  if (!/^\d{1,10}$/.test(f[k])) throw bad(`--${k} must be an integer, got ${JSON.stringify(f[k])}`);
  const n = Number(f[k]);
  if (n < min || n > max) throw bad(`--${k} must be between ${min} and ${max}, got ${n}`);
  return n;
}

// ---------------------------------------------------------------- plan and capture

export function plan({ url, out = null }) {
  const t = classifyUrl(url);
  const files = out ? OUT_FILES.map((f) => path.join(out, f)) : [...OUT_FILES];
  return {
    url: t.href,
    local: t.local,
    needs_consent: !t.local,
    out_files: files,
    viewport: { width: 1440, height: 900 },
    next: t.local
      ? 'capture needs no consent: run page-snapshot capture --url <url> --out <dir>'
      : 'this is a live remote page: a network call. Ask the user to confirm the URL, then run capture with --allow-remote',
  };
}

async function writeAtomic(dest, data) {
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw bad(`cannot write ${dest}: ${e.code || e.message}`);
  }
}

const origin = (u) => { try { return new URL(u).origin; } catch { return '(unparseable url)'; } };

async function readLocalAsset(url, maxAsset) {
  try {
    const p = fileURLToPath(url.split('#')[0].split('?')[0]);
    const mime = mimeForPath(p);
    if (!mime) return null;
    const st = await fs.stat(p);
    if (!st.isFile()) return null;
    if (st.size > maxAsset && mime !== 'text/css') return { tooBig: true, bytes: st.size };
    return { mime, body: await fs.readFile(p) };
  } catch { return null; }
}

export async function capture(o, io = {}) {
  const target = classifyUrl(o.url);
  checkConsent(target, o.allowRemote);
  const pw = await (io.resolvePlaywright ? io.resolvePlaywright(io.cwd) : resolvePlaywright(io.cwd));
  if (!pw || !pw.chromium) return { captured: false, reason: NOT_INSTALLED, exit: 4 };
  const out = path.resolve(io.cwd || process.cwd(), o.out);
  const lst = await fs.lstat(out).catch(() => null);
  if (lst && lst.isSymbolicLink()) throw bad(`--out ${o.out} is a symlink and is refused`);
  if (lst && !lst.isDirectory()) throw bad(`--out ${o.out} is not a directory`);
  const mode = target.local ? 'local' : 'remote';
  const maxAsset = o.maxAsset ?? MAX_ASSET_BYTES;
  const maxTotal = o.maxTotal ?? MAX_TOTAL_BYTES;
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let browser;
  try {
    try { browser = await pw.chromium.launch({ headless: true, args: mode === 'local' ? [...LAUNCH_ARGS] : [] }); } catch (e) {
      return { captured: false, reason: `playwright browser could not start: ${firstLine(e)}`, exit: 4 };
    }
    const ctxOpts = { viewport: { width: o.width, height: o.height }, serviceWorkers: 'block', acceptDownloads: false, permissions: [] };
    if (o.theme) ctxOpts.colorScheme = o.theme;
    const ctx = await browser.newContext(ctxOpts);
    if (typeof ctx.routeWebSocket !== 'function') return { captured: false, reason: 'playwright >= 1.48 required', exit: 4 };
    const blocked = new Set();
    const noteBlocked = (u) => { if (blocked.size < 50) blocked.add(origin(u)); };
    let loaded = false;
    await ctx.route('**/*', (route) => {
      const req = route.request();
      const u = req.url();
      const method = req.method();
      const sub = req.isNavigationRequest() && req.frame() && req.frame().parentFrame();
      const lateNav = req.isNavigationRequest() && loaded;
      if (!allowRequest(u, mode, target.protocol) || (method !== 'GET' && method !== 'HEAD') || sub || lateNav) { noteBlocked(u); return route.abort(); }
      return route.continue();
    });
    await ctx.routeWebSocket(/.*/, (ws) => { noteBlocked(ws.url()); return ws.close(); });
    const page = await ctx.newPage();

    // The bytes the browser itself received for images, fonts and stylesheets: nothing is fetched again.
    const captured = new Map();
    const bodies = [];
    let stored = 0;
    page.on('response', (r) => {
      bodies.push((async () => {
        try {
          const req = r.request();
          if (!['image', 'font', 'stylesheet'].includes(req.resourceType())) return;
          const st = r.status();
          if (st !== 0 && (st < 200 || st > 299)) return;
          const key = r.url().split('#')[0];
          const h = r.headers();
          const cl = Number(h['content-length']);
          if (Number.isFinite(cl) && cl > maxAsset && req.resourceType() !== 'stylesheet') { captured.set(key, { tooBig: true, bytes: cl }); return; }
          const body = await r.body();
          if (body.length > maxAsset && req.resourceType() !== 'stylesheet') { captured.set(key, { tooBig: true, bytes: body.length }); return; }
          if (stored + body.length > MAX_STORED_BYTES) { captured.set(key, { tooBig: true, bytes: body.length }); return; }
          stored += body.length;
          captured.set(key, { mime: h['content-type'] || mimeForPath(key) || '', body });
        } catch { /* a response without a body (redirect, aborted) is simply not stored */ }
      })());
    });

    let resp;
    try { resp = await page.goto(target.href, { waitUntil: 'load', timeout }); } catch (e) { throw bad(`could not load ${target.href}: ${firstLine(e)}`); }
    if (resp && typeof resp.ok === 'function' && !resp.ok() && resp.status() !== 0) throw bad(`page returned HTTP ${resp.status()}`);
    let networkIdle = true;
    const settle = async (ms) => { try { await page.waitForLoadState('networkidle', { timeout: ms }); } catch { networkIdle = false; } };
    await settle(Math.min(timeout, 10000));
    try { await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true)); } catch { /* fonts API missing */ }
    if (o.fullPage) {
      try {
        await page.evaluate(async () => {
          const h = Math.max(document.documentElement.scrollHeight, 0);
          for (let y = 0; y < h; y += Math.max(window.innerHeight, 200)) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
          window.scrollTo(0, 0);
        });
        await settle(Math.min(timeout, 5000));
      } catch { /* a page that cannot scroll is captured as it is */ }
    }
    loaded = true;
    await Promise.all(bodies);

    let png;
    try { png = await page.screenshot({ type: 'png', fullPage: !!o.fullPage, timeout: 15000 }); } catch (e) { throw bad(`the screenshot failed: ${firstLine(e)}`); }
    const dom = await page.evaluate(snapshotDom);
    if (Buffer.byteLength(dom.html) > MAX_HTML_BYTES) throw bad(`the rendered page is larger than ${MAX_HTML_BYTES} bytes`);
    const finalUrl = page.url();
    const at = (io.now ? io.now() : new Date()).toISOString();

    const fileMode = target.protocol === 'file:';
    const local = new Map();
    const lookup = (u) => captured.get(u) || local.get(u) || null;
    const pendingCss = {};
    for (const p of dom.pending) {
      const key = p.href.split('#')[0];
      let hit = captured.get(key);
      if (!hit && fileMode && /^file:/i.test(key)) hit = await readLocalAsset(key, maxAsset);
      pendingCss[p.n] = hit && hit.body && !hit.tooBig ? hit.body.toString('utf-8') : null;
    }
    const opts = { url: target.href, at, pendingCss, theme: o.theme || null, maxAsset, maxTotal };
    if (fileMode) {
      // a file:// page's assets are read from disk (images and fonts only); first pass learns which ones the copy asks for
      const need = new Set();
      buildSnapshot(dom, { ...opts, lookup: (u) => { need.add(u); return captured.get(u) || null; } });
      for (const u of need) if (/^file:/i.test(u) && !captured.has(u)) { const hit = await readLocalAsset(u, maxAsset); if (hit) local.set(u, hit); }
    }
    const built = buildSnapshot(dom, { ...opts, lookup });
    const b = built.budget;

    await fs.mkdir(out, { recursive: true });
    await fs.rm(path.join(out, 'manifest.json'), { force: true });
    await writeAtomic(path.join(out, 'page.html'), built.html);
    await writeAtomic(path.join(out, 'screenshot.png'), png);
    const inlined = [...b.inlined.values()];
    const skipped = [...b.skipped].map(([url, reason]) => ({ url, reason }));
    const manifest = {
      url: target.href, final_url: finalUrl, at,
      viewport: { width: o.width, height: o.height, full_page: !!o.fullPage },
      theme: o.theme || null, remote: !target.local, network_idle: networkIdle,
      files: [...OUT_FILES],
      inlined: inlined.slice(0, MAX_LISTED), skipped: skipped.slice(0, MAX_LISTED),
      blocked_origins: [...blocked].sort(),
    };
    await writeAtomic(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return {
      captured: true, out, url: target.href,
      page: path.join(out, 'page.html'), screenshot: path.join(out, 'screenshot.png'), manifest: path.join(out, 'manifest.json'),
      inlined_count: inlined.length, inlined_bytes: b.used, skipped_count: skipped.length,
      blocked_origins: manifest.blocked_origins, network_idle: networkIdle,
      next: 'Work on page.html as the baseline copy and compare against screenshot.png. Scripted or canvas-drawn animated backgrounds are not in the copy: describe them from the screenshot.',
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function run(args, io = {}) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') return { usage };
  if (rest.includes('--help') || rest.includes('-h')) return { usage };
  if (sub === 'plan') {
    const f = parseFlags(rest, ['url', 'out']);
    if (f.url === undefined) throw bad('--url is required');
    return plan({ url: f.url, out: f.out ?? null });
  }
  if (sub === 'capture') {
    const f = parseFlags(rest, ['url', 'out', 'width', 'height', 'theme', 'timeout-ms', 'max-asset-bytes', 'max-total-bytes'], ['full-page', 'allow-remote']);
    if (f.url === undefined) throw bad('--url is required');
    if (f.out === undefined) throw bad('--out is required');
    if (f.theme !== undefined && f.theme !== 'light' && f.theme !== 'dark') throw bad('--theme must be light or dark');
    return capture({
      url: f.url, out: f.out, theme: f.theme || null, fullPage: !!f['full-page'], allowRemote: !!f['allow-remote'],
      width: intFlag(f, 'width', 16, 8192, 1440), height: intFlag(f, 'height', 16, 8192, 900),
      timeoutMs: intFlag(f, 'timeout-ms', 1000, 120000, DEFAULT_TIMEOUT_MS),
      maxAsset: intFlag(f, 'max-asset-bytes', 1, 64 * 1048576, MAX_ASSET_BYTES),
      maxTotal: intFlag(f, 'max-total-bytes', 1, 256 * 1048576, MAX_TOTAL_BYTES),
    }, io);
  }
  throw bad(`unknown subcommand "${sub}"; ${usage}`);
}
