/**
 * page-snapshot — save a live page as ONE standalone static HTML copy plus a screenshot, so a redesign can start from a
 * link: work on the copy, compare against the screenshot. The page is loaded in headless Chromium at a set viewport, the
 * network is given time to settle and fonts to load, then the rendered document is copied: stylesheets are inlined into
 * <style>, images and CSS url() assets become data: URIs under a size cap, scripts, iframes, embedding elements (embed,
 * object, applet, portal, frame, frameset: each listed in skipped), srcset and <base> are dropped, and links are made absolute. Nothing runs when the copy is opened. Scripted or canvas-drawn animated backgrounds do
 * not survive the copy: describe them from the screenshot.
 * Shadow DOM: each open shadow root (web components) is copied as a declarative shadow root, <template shadowrootmode="open">
 * holding the root's children (its <style>, sheet links, constructed/adopted sheets and nested open roots included),
 * cleaned by the same DOM pass and text pass as the rest; the host's own children follow it. Adopted sheets are placed last
 * (the end of the root, the end of <body> for the document) so the cascade matches the live page; delegatesFocus and
 * clonable are carried as shadowrootdelegatesfocus and shadowrootclonable; a root with slotAssignment "manual" is copied
 * with named slotting (slot.assign() has no markup form) and listed in skipped as "manual slot assignment not reproduced; the copy uses named slotting". A closed shadow root (made by
 * attachShadow({mode:"closed"}); an init script records those hosts) cannot be read by script: it is not copied and is
 * listed in skipped as "closed shadow root not copied". A closed root the page declared in its own markup cannot be
 * detected and is a known gap. The fallback content of an <object> (an img with its alt, text) is kept, cleaned, in place of
 * the removed element, as the copy cannot load the object. A stylesheet the browser would not let script read (for example
 * a cross-origin one) is not in the copy: it stays a <link> the copy's CSP does not load, and skipped says so.
 * The copy is made safe in three layers. (1) In the page, before the DOM is serialized, the copy's clone is cleaned: every
 * comment node is removed, so is every script, noscript, noembed, noframes, iframe, embedding element, plaintext, base,
 * meta with http-equiv or charset, SVG animation that sets an href or a handler, and every on* attribute; javascript: and
 * vbscript: URLs are emptied, template contents are cleaned too, and <head> is made the first child of <html>. This runs in
 * the page's own script world, so a hostile page can tamper with it; the next two layers do not depend on it. (2) The
 * serialized text is cleaned again, failing closed: comments are removed, ended the way the HTML parser ends them (<!-->,
 * <!---> and --!> included); bogus comments are removed to their first >; noscript is raw text and removed with its
 * content like script; "<" in kept raw text is escaped (style text as \3c, title and textarea as &lt;), so it can never be
 * read as markup; an unterminated comment or tag drops the rest of the document. (3) page.html opens its <head> with the
 * charset, the snapshot-source meta and <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src
 * data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'">, before
 * anything from the page, so no script runs and nothing is fetched when it is opened even if a handler got through. An
 * asset left as an absolute URL (listed in skipped) is therefore not loaded when the copy is opened either.
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
 *       the reason. A stylesheet link that did not load (blocked or failed), or is disabled or alternate, is dropped from the
 *       copy and listed in skipped. --theme forces prefers-color-scheme to light or dark in the browser, in the copy's media
 *       queries and in the media= attributes of <style>, <link> and <source> (the other scheme becomes a query that never
 *       matches).
 *       --full-page screenshots the whole scrollable page. The page's rendered DOM may not exceed 8 MiB.
 *       In both modes WebRTC, WebTransport and workers are taken away from the page: an init script deletes
 *       RTCPeerConnection, webkitRTCPeerConnection, RTCDataChannel, WebTransport, Worker and SharedWorker in every frame
 *       (about:blank ones included) before any page script runs, and Chromium is launched with
 *       --force-webrtc-ip-handling-policy=disable_non_proxied_udp. Their STUN/TURN (UDP and TCP) and QUIC traffic never passes
 *       the request routes below, so without this a page could reach any address with them; a page that needs a worker to
 *       render is captured without it.
 *       --timeout-ms (default 30000, 1000 to 120000) is one deadline for the whole capture, counted from the start of the
 *       navigation: the document itself must arrive within it (else exit 1, could not load), and every later wait (the load
 *       event, the network settle, document.fonts.ready, the --full-page scroll, every asset body, the screenshot) gets at
 *       most what is left; so do the DOM copy that follows the screenshot (at least 1 s) and the address checks of pending
 *       stylesheets (at least 0.5 s; one still open then counts as private and the sheet is dropped). A page whose main thread
 *       does not answer the DOM copy in time (a busy loop, say) fails with exit 1 "the page did not answer in time" and nothing
 *       is written: a screenshot without the copy is not the snapshot asked for. The load event is not required: an image, stylesheet or font of the original markup, or one
 *       requested later, whose body is still unfinished when the budget is spent (at least 0.5 s after the settle; a
 *       streaming or stalled image or font, say) is dropped, keeps its absolute URL and is listed in skipped as "body did
 *       not finish in time"; network_idle is then false, the files are still written and the exit is 0. With a font still
 *       loading the screenshot is taken without waiting for it (the fallback face is drawn); the screenshot always gets at
 *       least 2 s. A capture ends within --timeout-ms plus 6 s (the fixed margin covers the browser start, the 0.5 s body
 *       grace, the 2 s screenshot floor, the DOM copy and address-check floors and writing the copy). An asset reached through redirects is stored under every URL of its redirect chain, so
 *       an element naming the first URL inlines it (each hop held to the address check below).
 *       Network policy: file:// and http(s)://localhost or 127.0.0.1 are allowed and everything else is blocked at the
 *       browser (no name but localhost resolves, no proxy, non-local requests and WebSockets aborted). Any other URL is
 *       refused with exit 2 and nothing is launched, unless --allow-remote is given; then only the given URL's own origin
 *       and the asset origins the page itself requests are reached: no links are followed after the load, no form or other
 *       non-GET request is sent, WebSockets, service workers, downloads, popups and iframes are blocked, and the context is
 *       fresh (no cookies, credentials or storage state). In remote mode no request other than to the page's own origin may
 *       reach a host that is loopback, private, link-local, CGNAT, unique-local, multicast, reserved or unspecified (IPv4 and
 *       IPv6, IPv4-mapped and numeric forms included), or a localhost name: Node resolves each other DNS name first (a
 *       failed lookup counts as private), redirects are held to the same check, and a response the browser got from such
 *       an address anyway is never copied; a page that ends up on one exits 2. Remote mode connects directly, without a
 *       proxy, even when HTTP_PROXY, HTTPS_PROXY or ALL_PROXY is set (through a proxy the address the browser reached would be
 *       the proxy's, and the check above would mean nothing); when such a variable is set and the remote page does not load,
 *       the exit-1 error says remote mode connects directly, without the configured proxy. Known limit: on a network that
 *       only allows egress through a proxy a remote capture cannot work, and there is no flag to use the proxy (it would
 *       weaken the address check; the owner decides).
 *       Each refused request's origin is in blocked_origins (file:// for file URLs). Known gap: a name whose answer changes
 *       between Node's lookup and the browser's (DNS rebinding) can reach such a host
 *       with that request; its body is dropped, and a stylesheet from it is dropped from the copy. Asset bytes are the ones the browser itself received, nothing
 *       is fetched by Node (DNS lookups only). Loads playwright only if the project can resolve it (it is not a dependency of this suite); if not,
 *       returns { captured:false, reason:"playwright not installed: page-snapshot capture needs it", exit:4 }.
 *
 * Exit codes: 0 answer printed · 1 bad input or broken state (bad flag, unparseable URL, HTTP error, DOM over 8 MiB, --out
 * a symlink or a file, page could not load, with a proxy hint in remote mode when a proxy variable is set, "the page did
 * not answer in time") · 2 URL refused
 * by the network policy (not local and no --allow-remote, an unsupported scheme, credentials in the URL, or a remote page
 * that led the browser to a private address) · 4 the browser cannot be used: playwright not installed, its browser could
 * not start, "playwright >= 1.48 required" (no WebSocket routing), or "the browser cannot apply the remote address guard"
 * (remote mode, no DevTools request interception). Exit 4 prints { captured:false, reason, exit:4 }.
 *
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KitExit } from './kit-exit.js';
import { resolvePlaywright, LAUNCH_ARGS } from './frame-capture.js';

export const verb = 'page-snapshot';
export const usage = 'cli.js page-snapshot plan --url <url> [--out <dir>] | capture --url <url> --out <dir> [--width 1440] [--height 900] [--full-page] [--allow-remote] [--theme light|dark] [--timeout-ms <ms>] [--max-asset-bytes <n>] [--max-total-bytes <n>]  (JSON out; exit 1 bad input, page could not load or the page did not answer in time (remote mode connects directly, without a configured HTTP(S)_PROXY, and says so); exit 2 URL refused, remote needs --allow-remote; exit 4 playwright not installed, browser could not start, playwright >= 1.48 required, or the browser cannot apply the remote address guard; --timeout-ms is one deadline for the whole capture (load, settle, fonts, asset bodies, screenshot; it ends within --timeout-ms plus 6 s): a late body, in the markup or later, is listed in skipped as "body did not finish in time" and the exit is 0)';

export const NOT_INSTALLED = 'playwright not installed: page-snapshot capture needs it';
export const MAX_ASSET_BYTES = 2 * 1048576;
export const MAX_TOTAL_BYTES = 20 * 1048576;
export const MAX_HTML_BYTES = 8 * 1048576;
export const BODY_LATE = 'body did not finish in time';
export const BODY_GRACE_MS = 500;
/** The least time the screenshot gets, even when --timeout-ms is spent. */
export const SCREENSHOT_FLOOR_MS = 2000;
/** How far past --timeout-ms a capture may run (browser start, the body grace, the screenshot floor, writing the copy). */
export const DEADLINE_MARGIN_MS = 6000;
/** The least time the in-page DOM copy gets, and the least the pending-stylesheet address checks get, once the deadline is spent. */
export const DOM_FLOOR_MS = 1000;
export const DNS_FLOOR_MS = 500;
/** The exit-1 message when the page's main thread does not answer the DOM copy in time (nothing is written then). */
export const NO_ANSWER = 'the page did not answer in time';
/** Chromium flag: WebRTC may not send UDP except through a proxy (none is configured), on top of the init script below. */
export const WEBRTC_FLAG = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';
/** The WeakSet key (on globalThis) under which the init script records the hosts of closed shadow roots. */
export const CLOSED_SHADOW_KEY = 'page-snapshot.closed-shadow-hosts';
/** The skipped reason for a closed shadow root. */
export const CLOSED_SHADOW = 'closed shadow root not copied';
/** The skipped reason for a shadow root with manual slot assignment: slot.assign() cannot be written as markup, so the copy uses named slotting. */
export const MANUAL_SLOTS = 'manual slot assignment not reproduced; the copy uses named slotting';
/** Page APIs that open connections no request route sees (WebRTC ICE over UDP and TCP, WebTransport over QUIC, and
 * workers, which can use WebTransport where the init script does not run): removed from every frame before any page script. */
export const NEUTERED_APIS = Object.freeze(['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport', 'Worker', 'SharedWorker']);
const NEUTER_SCRIPT = `(() => { for (const k of ${JSON.stringify(NEUTERED_APIS)}) { try { delete globalThis[k]; } catch {} `
  + `try { if (k in globalThis) Object.defineProperty(globalThis, k, { value: undefined, configurable: false, writable: false }); } catch {} } })();`
  // remember the hosts of closed shadow roots (script cannot reach their content, so the copy lists them as not copied)
  + `(() => { try { const set = new WeakSet(); Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(CLOSED_SHADOW_KEY)}), { value: set }); `
  + `const orig = Element.prototype.attachShadow; Element.prototype.attachShadow = function attachShadow(init) { const r = orig.call(this, init); `
  + `try { if (init && init.mode === 'closed') set.add(this); } catch {} return r; }; } catch {} })();`;
export const PROXY_HINT = 'remote mode connects directly, without the configured proxy';
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
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

/** Should a browser request be let through? mode is 'local' (file or localhost page) or 'remote'. In remote mode a host that
 * is loopback, private, link-local, CGNAT, unique-local, multicast, reserved or unspecified (or a localhost name) is refused
 * unless it is the page's own origin (pageOrigin), which the user agreed to. DNS names are checked separately (hostVerdict). */
export function allowRequest(rawUrl, mode, pageProtocol = 'file:', pageOrigin = null) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  if (mode === 'local') {
    if (u.protocol === 'file:') return pageProtocol === 'file:' && u.hostname === '';
    return isLocalHttp(u);
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return false;
  return u.origin === pageOrigin || !isPrivateHost(u.hostname);
}

// ---------------------------------------------------------------- private address ranges

/** Dotted-quad IPv4 (the canonical form URL gives every numeric, decimal, octal or hex host) to 4 numbers, or null. */
export function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const a = m.slice(1).map(Number);
  return a.every((x) => x <= 255) ? a : null;
}
/** IPv6 text (no brackets, no zone) to 8 numbers, or null. Accepts :: and a trailing dotted IPv4. */
export function parseIPv6(s) {
  let t = String(s).toLowerCase().replace(/%.*$/, '');
  if (!/^[0-9a-f:.]+$/.test(t) || !t.includes(':')) return null;
  let tail = [];
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (v4) {
    const a = parseIPv4(v4[1]);
    if (!a) return null;
    tail = [(a[0] << 8) | a[1], (a[2] << 8) | a[3]];
    t = t.slice(0, -v4[1].length);
    if (t.endsWith(':') && !t.endsWith('::')) t = t.slice(0, -1);
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const part = (x) => (x === '' ? [] : x.split(':'));
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const fill = new Array(8 - known).fill(0);
  return [...head, ...(halves.length === 2 ? fill : []), ...rest].map((g) => parseInt(g, 16)).concat(tail);
}
function privateV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224 // unspecified, private, loopback, multicast and reserved
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local and cloud metadata
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) // private
    || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)); // IETF and benchmarking
}
/** Is an IP address (v4 or v6 text) one a remote capture must never reach? Text that is not an address is not private. */
export function isPrivateAddress(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(s);
  if (v4) return privateV4(v4);
  const g = parseIPv6(s);
  if (!g) return false;
  const embedded = (hi, lo) => privateV4([g[hi] >> 8, g[hi] & 255, g[lo] >> 8, g[lo] & 255]);
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return true; // IPv4-mapped: a page has no reason to use it
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(6, 7); // NAT64
  if (g[0] === 0x2002) return privateV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]); // 6to4
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}
/** Is a URL host (as URL.hostname gives it, or raw text: numeric forms are normalized here) private or a localhost name? */
export function isPrivateHost(host) {
  let h = String(host).toLowerCase();
  if (!h.startsWith('[')) { try { h = new URL(`http://${h}/`).hostname; } catch { return true; } }
  if (h.startsWith('[')) return isPrivateAddress(h.slice(1, -1));
  const name = h.replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name === '') return true;
  return isPrivateAddress(name);
}
const isIpLiteral = (h) => h.startsWith('[') || parseIPv4(h) !== null;

/** Resolve a DNS name (not an IP literal) and say whether any address it answers is private. A failed lookup counts as
 * private, so a name Node cannot vet is not loaded. cache maps host to a promise of the verdict. */
export function hostVerdict(host, lookup, cache) {
  const h = String(host).toLowerCase();
  if (isPrivateHost(h)) return Promise.resolve(true);
  if (isIpLiteral(h)) return Promise.resolve(false);
  if (!cache.has(h)) {
    cache.set(h, Promise.resolve().then(() => lookup(h.replace(/\.$/, ''), { all: true, verbatim: true }))
      .then((list) => !Array.isArray(list) || list.length === 0 || list.some((r) => isPrivateAddress(r && r.address)), () => true));
  }
  return cache.get(h);
}

// ---------------------------------------------------------------- pure string work

export const asciiLower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const SKIP = Symbol('skip');
/** Elements whose content the scanner does not parse as markup. Their content is never kept unexamined: script, iframe,
 * noscript, noembed, noframes, xmp and plaintext are removed with their content, style keeps its CSS with every "<"
 * escaped (\3c), and title and textarea keep their text with every "<" escaped (&lt;). */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes', 'noscript', 'plaintext']);
/** Removed with their content in both passes (the in-page DOM pass and the text pass). */
export const DROPPED_RAW = Object.freeze(['script', 'iframe', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext']);
const ANIMATION = new Set(['animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor', 'discard']);
/** Attributes whose value is a URL (javascript: there is neutralized) and SVG animation values that can set one. */
const JS_URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'codebase', 'cite', 'ping', 'srcdoc', 'lowsrc', 'dynsrc', 'archive', 'classid', 'to', 'from', 'values', 'by']);

/** Is a (decoded) attribute value a javascript: or vbscript: URL, the way a browser's URL parser reads it (tabs and newlines
 * removed anywhere, leading controls and spaces trimmed, numeric and common named character references decoded)? */
export function isScriptUrl(v) {
  const d = String(v).replace(/&(#x[0-9a-f]+|#\d+|tab|newline|colon);?/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'tab') return '\t';
    if (k === 'newline') return '\n';
    if (k === 'colon') return ':';
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
  return /^(javascript|vbscript):/i.test(d.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, ''));
}
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
 * t = { name, rawName, attrs:[{name, rawName, value|null}], self, changed, start, end } and may mutate t.attrs (set t.changed) or return a
 * replacement string for the whole tag, or SKIP to remove it (a raw-text element is removed with its content).
 * raw(t, content) may return replacement content for a raw-text element (style, textarea, ...).
 * It fails closed: whatever a browser would not read as markup the walk does not keep unexamined. Comments are removed,
 * ended the way the HTML parser ends them ("<!-->" and "<!--->" at once, otherwise at the first "-->" or "--!>"); a bogus
 * comment ("<!x", "<?x", "</ x") is removed up to its first ">"; an unterminated comment or tag removes the rest of the
 * document (the parser drops it too). Every input costs one pass.
 */
export function scanHtml(html, { tag, raw }) {
  const lower = asciiLower(html);
  const n = html.length;
  const out = [];
  let copy = 0;
  let i = 0;
  const replace = (a, b, text) => { out.push(html.slice(copy, a), text); copy = b; };
  // indexOf with a memo per needle, so that many comments cost one pass even when one of the two end markers never occurs
  const memo = new Map();
  const find = (needle, from) => {
    const m = memo.get(needle);
    if (m !== undefined && (m < 0 || m >= from)) return m;
    const r = html.indexOf(needle, from);
    memo.set(needle, r);
    return r;
  };
  let cut = false; // the rest of the document is dropped
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      let end;
      if (html.startsWith('>', lt + 4)) end = lt + 5;
      else if (html.startsWith('->', lt + 4)) end = lt + 6;
      else {
        const a = find('-->', lt + 4);
        const b = find('--!>', lt + 4);
        end = a < 0 && b < 0 ? -1 : (b < 0 || (a >= 0 && a < b)) ? a + 3 : b + 4;
      }
      if (end < 0) { replace(lt, n, ''); cut = true; break; }
      replace(lt, end, '');
      i = end;
      continue;
    }
    const c1 = html.charCodeAt(lt + 1);
    const isEnd = c1 === 47;
    const ns = lt + (isEnd ? 2 : 1);
    if (!isAlpha(html.charCodeAt(ns))) {
      if (c1 === 33 || c1 === 63 || (isEnd && ns < n)) {
        // a bogus comment: the parser ends it at the first ">" ("</>" is dropped the same way)
        const e = find('>', ns);
        if (e < 0) { replace(lt, n, ''); cut = true; break; }
        replace(lt, e + 1, '');
        i = e + 1;
        continue;
      }
      i = lt + 1;
      continue;
    }
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
        if (isWs(c) || c === 61 || c === 62 || c === 47) break;
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
    if (!closed) { replace(lt, n, ''); cut = true; break; }
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
      t = { name, rawName, attrs, self, changed: false, start: lt, end: p };
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
  if (!cut) out.push(html.slice(copy));
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
 * A snapshot's byte budget and ledger. lookup(url) returns { mime, body:Buffer } | { tooBig:true, bytes } | { late:true } | null.
 */
export function makeBudget({ lookup = null, maxAsset = MAX_ASSET_BYTES, maxTotal = MAX_TOTAL_BYTES } = {}) {
  return { lookup, maxAsset, maxTotal, used: 0, inlined: new Map(), skipped: new Map(), removed: { scripts: 0, iframes: 0, embedded: 0 } };
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
  if (hit.late) return skip(b, abs, BODY_LATE);
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
/** Elements that load and run another document (or a plugin): removed from the copy like iframe, each listed in skipped. */
export const EMBEDDING = Object.freeze(['embed', 'object', 'applet', 'portal', 'frame', 'frameset']);
const MEDIA_TAGS = new Set(['style', 'link', 'source']);

/**
 * Rewrite a serialized DOM into the static copy: scripts, iframes, <base>, refresh and CSP metas, preloads, on* handlers,
 * srcset removed; URLs absolute against base; style text and style attributes transformed; img/icon/poster/svg image
 * sources inlined as data URIs when budget.lookup is set. headInsert is placed right after <head>.
 */
export function transformHtml(html, { base, budget = null, theme = null, headInsert = '' }) {
  // headInsert goes right after <head> only when that <head> is where the parser opens the head (the first tag, or the
  // second after <html>, with only whitespace before it); otherwise it opens the document, which the parser also puts in
  // the head. So the copy's CSP always applies, whatever the page's markup looked like.
  let headDone = false;
  let decided = false;
  let seen = 0;
  let htmlEnd = -1;
  const blank = (a, b) => /^[ \t\n\r\f]*$/.test(html.slice(a, b));
  const html2 = scanHtml(html, {
    tag(t) {
      const nm = t.name;
      let here = false;
      if (!decided) {
        if (seen === 0 && nm === 'html' && blank(0, t.start)) htmlEnd = t.end;
        else {
          here = nm === 'head' && ((seen === 0 && blank(0, t.start)) || (seen === 1 && htmlEnd >= 0 && blank(htmlEnd, t.start)));
          decided = true;
        }
        seen++;
      }
      if (nm === 'script') { if (budget) budget.removed.scripts++; return SKIP; }
      if (nm === 'iframe') {
        if (budget) { budget.removed.iframes++; const s = getAttr(t, 'src'); if (s) skip(budget, absolutizeUrl(s, base), 'iframe removed from the static copy'); }
        return SKIP;
      }
      if (EMBEDDING.includes(nm)) {
        if (budget) {
          budget.removed.embedded++;
          const s = getAttr(t, 'src') || getAttr(t, 'data') || getAttr(t, 'code');
          skip(budget, s ? absolutizeUrl(s, base) : `(<${nm}> without a source)`, `<${nm}> removed from the static copy`);
        }
        return SKIP;
      }
      if (DROPPED_RAW.includes(nm)) return SKIP;
      if (nm === 'base') return SKIP;
      if (nm === 'meta' && (hasAttr(t, 'http-equiv') || hasAttr(t, 'charset'))) return SKIP;
      if (ANIMATION.has(nm) && /^((xlink:)?href|on)/i.test(getAttr(t, 'attributename') || '')) return SKIP;
      if (nm === 'link') {
        const rel = (getAttr(t, 'rel') || '').toLowerCase().split(/\s+/);
        if (rel.some((r) => ['modulepreload', 'preload', 'prefetch', 'prerender', 'dns-prefetch', 'preconnect'].includes(r))) return SKIP;
      }
      if (nm === 'source' && hasAttr(t, 'srcset') && !hasAttr(t, 'src')) return SKIP;
      if (theme && MEDIA_TAGS.has(nm)) {
        const m = getAttr(t, 'media');
        if (m !== null) { const fm = forceScheme(m, theme); if (fm !== m) setAttr(t, 'media', fm); }
      }
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
          if (isScriptUrl(v)) next = a.name === 'href' || a.name === 'action' || a.name === 'formaction' ? '#' : '';
          else {
            next = absolutizeUrl(v, base);
            if (wantsInline && budget) next = inlineAsset(next, budget) || next;
          }
          if (next !== v) { a.value = encodeAttr(next); t.changed = true; }
        } else if (JS_URL_ATTRS.has(a.name) && isScriptUrl(decodeAttr(a.value))) { a.value = ''; t.changed = true; }
      }
      if (here && headInsert) { headDone = true; return serializeTag(t) + headInsert; }
      return undefined;
    },
    raw(t, content) {
      // nothing in raw text may read as markup if a browser parses it differently (an SVG <style> or <title> is markup)
      if (t.name === 'title' || t.name === 'textarea') return content.replace(/</g, '&lt;');
      if (t.name !== 'style') return '';
      const sheetBase = getAttr(t, 'data-snapshot-href') || base;
      return transformCss(content, { base: sheetBase, budget, theme }).replace(/</g, '\\3c ');
    },
  });
  // no <head> start tag (a page script removed it): the head insert opens the document, where the parser puts it in <head>
  return headDone || !headInsert ? html2 : headInsert + html2;
}

/** The copy's own Content-Security-Policy: no script of any kind, and nothing but data: and inline styles is loaded. */
export const SNAPSHOT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'";
/** The head insert: utf-8 charset, the source meta and the copy's CSP, before anything from the page. */
export function sourceMeta(url, at) {
  return `<meta charset="utf-8"><meta name="snapshot-source" content="${encodeAttr(url)}" data-at="${encodeAttr(at)}">`
    + `<meta http-equiv="Content-Security-Policy" content="${encodeAttr(SNAPSHOT_CSP)}">`;
}

export const PENDING_UNREAD = 'stylesheet could not be read and is not in the copy (left as a link the copy\'s CSP does not load)';
export const PENDING_BLOCKED = 'stylesheet from a blocked private or loopback address; dropped from the copy';
const PRIVATE_SHEET = PENDING_BLOCKED.split(';')[0];

/**
 * Put each pending stylesheet in its placeholder, in ONE pass over the document. pendingCss maps a placeholder number to
 * css text, null (unread: kept as a link) or false (blocked: dropped). Returns { html, skipped:[[url, reason]] }; the result
 * can be passed to buildSnapshot as resolved so a two-pass build substitutes once.
 */
export function resolvePending(dom, pendingCss = {}) {
  const byN = new Map((dom.pending || []).map((p) => [String(p.n), p]));
  const skipped = [];
  for (const d of dom.dropped || []) skipped.push([d.href, d.reason]);
  const html = byN.size === 0 ? dom.html : dom.html.replace(/<style data-snapshot-pending="(\d+)"><\/style>/g, (m, n) => {
    const p = byN.get(n);
    if (!p) return m;
    const css = pendingCss[p.n];
    const media = p.media && p.media !== 'all' ? ` media="${encodeAttr(p.media)}"` : '';
    if (typeof css === 'string') return `<style${media} data-snapshot-href="${encodeAttr(p.href)}">${css.replace(/<\/style/gi, '<\\/style')}</style>`;
    if (css === false) { skipped.push([p.href, PENDING_BLOCKED]); return ''; }
    skipped.push([p.href, PENDING_UNREAD]);
    return `<link rel="stylesheet"${media} href="${encodeAttr(p.href)}">`;
  });
  return { html, skipped };
}

/** Assemble the standalone document from the browser's DOM report (see snapshotDom and resolvePending). */
export function buildSnapshot(dom, { url, at, lookup = null, pendingCss = {}, resolved = null, theme = null, maxAsset, maxTotal }) {
  const budget = makeBudget({ lookup, maxAsset, maxTotal });
  // what the in-page pass already removed is counted and listed the same way the text pass would have
  for (const x of dom.removed || []) {
    if (x.tag === 'script') budget.removed.scripts++;
    else if (x.tag === 'iframe') { budget.removed.iframes++; if (x.src) skip(budget, x.src, 'iframe removed from the static copy'); }
    else if (EMBEDDING.includes(x.tag)) { budget.removed.embedded++; skip(budget, x.src || `(<${x.tag}> without a source)`, `<${x.tag}> removed from the static copy`); }
  }
  const r = resolved || resolvePending(dom, pendingCss);
  for (const [u, reason] of r.skipped) skip(budget, u, reason);
  const body = transformHtml(r.html, { base: dom.baseUri, budget, theme, headInsert: sourceMeta(url, at) });
  return { html: `${dom.doctype || '<!DOCTYPE html>'}\n${body}\n`, budget };
}

// ---------------------------------------------------------------- the in-browser pass

/**
 * Runs inside the page (no closures): clones the document, replaces each readable stylesheet link with a <style> holding its
 * CSSOM text (imports expanded, constructed sheets appended), marks sheets the browser will not let script read as
 * pending, resolves srcset images to the chosen source, and reports the document's base URL. A stylesheet link that is
 * disabled or alternate, has no sheet, or whose URL is in failedUrls (urls or [url, reason] pairs: requests that were
 * blocked, failed, got an HTTP error or came from a private address) is removed and reported in dropped.
 * Then the clone is cleaned in the DOM, before it is serialized (the main guard; the text pass is defence in depth): every
 * comment, processing instruction and CDATA node is removed; script, noscript, noembed, noframes, iframe, embed, object
 * (its fallback content kept),
 * applet, portal, frame, frameset, plaintext and base elements are removed (reported in removed); xmp becomes pre; every
 * meta with http-equiv or charset, every SVG animation that sets an href or a handler, every on* attribute is removed;
 * javascript: and vbscript: URLs are emptied ("#" for links); template contents are cleaned the same way; <head> is made
 * the first child of <html>, so the copy's own head insert (charset, source, CSP) comes before anything from the page.
 */
export function snapshotDom(failedUrls) {
  const doc = document;
  const failed = new Map((failedUrls || []).map((x) => (Array.isArray(x) ? x : [x, ''])));
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
  const dropped = [];
  const closedHosts = (() => { try { return globalThis[Symbol.for('page-snapshot.closed-shadow-hosts')] || null; } catch { return null; } })();
  // one scope is the document or one open shadow root: its styles and sheet links are inlined, its images resolved, and
  // each open shadow root below it is copied as a declarative shadow root (<template shadowrootmode="open">)
  const scope = (orig, cl, depth) => {
    const oEls = Array.from(orig.querySelectorAll('*'));
    const cEls = Array.from(cl.querySelectorAll('*'));
    const origStyles = orig.querySelectorAll('style');
    const cloneStyles = cl.querySelectorAll('style');
    origStyles.forEach((s, i) => {
      if (!s.sheet) return;
      const text = sheetText(s.sheet, 0);
      if (text) cloneStyles[i].textContent = text;
    });
    const origLinks = orig.querySelectorAll('link[rel~="stylesheet" i]');
    const cloneLinks = cl.querySelectorAll('link[rel~="stylesheet" i]');
    origLinks.forEach((l, i) => {
      const c = cloneLinks[i];
      const alternate = /(^|\s)alternate(\s|$)/i.test(l.getAttribute('rel') || '');
      const failure = failed.get(l.href) ?? failed.get(l.href.split('#')[0]);
      if (l.disabled || alternate || !l.sheet || failure !== undefined) {
        const why = l.disabled || alternate ? 'stylesheet is disabled or alternate' : failure || 'stylesheet did not load (blocked or failed)';
        dropped.push({ href: l.href || '(link without href)', reason: `${why}; dropped from the copy` });
        c.remove();
        return;
      }
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
    const origImgs = orig.querySelectorAll('img');
    const cloneImgs = cl.querySelectorAll('img');
    origImgs.forEach((im, i) => { if (im.currentSrc) cloneImgs[i].setAttribute('src', im.currentSrc); });
    oEls.forEach((o, i) => {
      const c = cEls[i];
      const sr = o.shadowRoot;
      if (!sr) {
        if (closedHosts && closedHosts.has && closedHosts.has(o)) dropped.push({ href: `(<${String(o.localName)}> shadow root)`, reason: 'closed shadow root not copied' });
        return;
      }
      if (depth >= 8) { dropped.push({ href: `(<${String(o.localName)}> shadow root)`, reason: 'shadow root nested too deep; not copied' }); return; }
      const tpl = doc.createElement('template');
      tpl.setAttribute('shadowrootmode', 'open');
      if (sr.delegatesFocus) tpl.setAttribute('shadowrootdelegatesfocus', '');
      if (sr.clonable) tpl.setAttribute('shadowrootclonable', '');
      if (sr.slotAssignment === 'manual') dropped.push({ href: `(<${String(o.localName)}> shadow root)`, reason: 'manual slot assignment not reproduced; the copy uses named slotting' });
      for (const ch of Array.from(sr.childNodes)) tpl.content.appendChild(ch.cloneNode(true));
      scope(sr, tpl.content, depth + 1);
      const sheets = Array.from(sr.adoptedStyleSheets || []).map((x) => sheetText(x, 0)).filter(Boolean);
      if (sheets.length) {
        const st = doc.createElement('style');
        st.textContent = sheets.join('\n');
        tpl.content.appendChild(st);
      }
      c.insertBefore(tpl, c.firstChild);
    });
  };
  scope(doc.documentElement, clone, 0);
  const adopted = (doc.adoptedStyleSheets || []).map((s) => sheetText(s, 0)).filter(Boolean);
  if (adopted.length) {
    const st = doc.createElement('style');
    st.textContent = adopted.join('\n');
    (clone.querySelector('body') || clone).appendChild(st);
  }
  const removed = [];
  const DROP = new Set(['script', 'noscript', 'noembed', 'noframes', 'iframe', 'embed', 'object', 'applet', 'portal', 'frame', 'frameset', 'plaintext', 'base']);
  const ANIM = new Set(['animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor', 'discard']);
  const URLISH = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'codebase', 'cite', 'ping', 'srcdoc', 'lowsrc', 'dynsrc', 'archive', 'classid', 'to', 'from', 'values', 'by']);
  const LINKISH = new Set(['href', 'xlink:href', 'action', 'formaction']);
  const scriptUrl = (v) => /^(javascript|vbscript):/i.test(String(v).replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, ''));
  const absUrl = (v) => { try { return new URL(v, doc.baseURI).href; } catch { return v; } };
  const stack = [clone];
  while (stack.length) {
    const node = stack.pop();
    for (const ch of Array.from(node.childNodes)) {
      if (ch.nodeType !== 1) { if (ch.nodeType !== 3) ch.remove(); continue; }
      const nm = String(ch.localName).toLowerCase();
      if (DROP.has(nm)) {
        const s = ch.getAttribute('src') || ch.getAttribute('data') || ch.getAttribute('code');
        if (removed.length < 5000) removed.push({ tag: nm, src: s ? absUrl(s) : null });
        if (nm === 'object') {
          // the fallback content of an object is what the page draws when the object does not load: keep it, cleaned
          const kids = Array.from(ch.childNodes);
          ch.replaceWith(...kids);
          for (const k of kids) { if (k.nodeType !== 1 && k.nodeType !== 3) k.remove(); }
          stack.push(node);
          continue;
        }
        ch.remove();
        continue;
      }
      if (nm === 'meta' && (ch.hasAttribute('http-equiv') || ch.hasAttribute('charset'))) { ch.remove(); continue; }
      if (ANIM.has(nm) && /^((xlink:)?href|on)/i.test(ch.getAttribute('attributeName') || '')) { ch.remove(); continue; }
      if (nm === 'xmp') { const pre = doc.createElement('pre'); pre.textContent = ch.textContent; ch.replaceWith(pre); continue; }
      for (const a of Array.from(ch.attributes)) {
        const an = a.name.toLowerCase();
        if (an.startsWith('on')) ch.removeAttributeNode(a);
        else if (URLISH.has(an) && scriptUrl(a.value)) a.value = LINKISH.has(an) ? '#' : '';
      }
      if (nm === 'template' && ch.content) stack.push(ch.content);
      stack.push(ch);
    }
  }
  if (String(clone.localName).toLowerCase() === 'html') {
    let head = Array.from(clone.children).find((c) => String(c.localName).toLowerCase() === 'head');
    if (!head) head = doc.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }
  const dt = doc.doctype;
  return {
    doctype: dt ? new XMLSerializer().serializeToString(dt) : '<!DOCTYPE html>',
    html: clone.outerHTML,
    baseUri: doc.baseURI,
    pending,
    dropped,
    removed,
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

/** The origin a blocked request is listed under: file: URLs (whose URL.origin is the string "null") are listed as file://. */
export const blockedOrigin = (u) => {
  try { const x = new URL(u); return x.protocol === 'file:' ? 'file://' : x.origin === 'null' ? `${x.protocol}//${x.host}` : x.origin; } catch { return '(unparseable url)'; }
};

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

/** Resolve to the promise's value, or to `fallback` once `ms` have passed (the promise is left to settle on its own). */
async function bounded(p, ms, fallback) {
  let timer;
  try { return await Promise.race([p, new Promise((r) => { timer = setTimeout(() => r(fallback), Math.max(0, ms)); })]); } finally { clearTimeout(timer); }
}

/** A PNG of the viewport (or the whole page) through the page's DevTools session, without waiting for web fonts. */
async function devtoolsScreenshot(ctx, page, fullPage) {
  const cdp = await ctx.newCDPSession(page);
  try {
    const params = { format: 'png' };
    if (fullPage) {
      const m = await cdp.send('Page.getLayoutMetrics');
      const c = m.cssContentSize || m.contentSize;
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: Math.max(1, Math.ceil(c.width)), height: Math.max(1, Math.min(Math.ceil(c.height), 32767)), scale: 1 };
    }
    const r = await cdp.send('Page.captureScreenshot', params);
    return Buffer.from(r.data, 'base64');
  } finally { await cdp.detach().catch(() => {}); }
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
  const env = io.env || process.env;
  let browser;
  try {
    // remote mode connects directly (no proxy) so the address the browser reached is the server's own and can be checked
    try { browser = await pw.chromium.launch({ headless: true, args: mode === 'local' ? [...LAUNCH_ARGS, WEBRTC_FLAG] : ['--no-proxy-server', WEBRTC_FLAG] }); } catch (e) {
      return { captured: false, reason: `playwright browser could not start: ${firstLine(e)}`, exit: 4 };
    }
    const ctxOpts = { viewport: { width: o.width, height: o.height }, serviceWorkers: 'block', acceptDownloads: false, permissions: [] };
    if (o.theme) ctxOpts.colorScheme = o.theme;
    const ctx = await browser.newContext(ctxOpts);
    if (typeof ctx.routeWebSocket !== 'function') return { captured: false, reason: 'playwright >= 1.48 required', exit: 4 };
    // WebRTC, WebTransport and workers are taken away in every frame (about:blank ones too) before any page script runs
    await ctx.addInitScript(NEUTER_SCRIPT);
    const blocked = new Set();
    const noteBlocked = (u) => { if (blocked.size < 50) blocked.add(blockedOrigin(u)); };
    const remote = mode === 'remote';
    const pageOrigin = new URL(target.href).origin;
    const lookup = io.lookup || dns.promises.lookup;
    const verdicts = new Map();
    // remote: is this URL's host private (loopback, private, link-local, ... or a DNS name answering such an address)?
    const privateUrl = async (u) => {
      let x;
      try { x = new URL(u); } catch { return true; }
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return false;
      if (x.origin === pageOrigin) return false;
      return hostVerdict(x.hostname, lookup, verdicts);
    };
    const tainted = new Set(); // URLs the browser reached on a private address although Node could not stop the request
    // Requests that were blocked, failed, got an HTTP error or came from a private address: a stylesheet link to one is
    // dropped from the copy (even one whose CORS headers let the page read it).
    const failedUrls = new Map();
    let loaded = false;
    let page = null;
    let navRefused = null; // remote: the origin of a page navigation (a redirect) the address policy refused
    const frameOf = (req) => { try { return req.frame(); } catch { return null; } }; // a worker request has no frame
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      const u = req.url();
      const method = req.method();
      const fr = req.isNavigationRequest() ? frameOf(req) : null;
      const sub = fr && fr.parentFrame();
      const popup = fr && page && fr.page() !== page;
      const lateNav = req.isNavigationRequest() && loaded;
      if (!allowRequest(u, mode, target.protocol, remote ? pageOrigin : null) || (method !== 'GET' && method !== 'HEAD') || sub || popup || lateNav
        || (remote && await privateUrl(u))) { noteBlocked(u); return route.abort().catch(() => {}); }
      return route.continue().catch(() => {});
    });
    await ctx.routeWebSocket(/.*/, (ws) => { noteBlocked(ws.url()); return ws.close(); });
    page = await ctx.newPage();
    // Request routing never sees redirect targets, so in remote mode the page's own DevTools session also pauses every
    // request, redirects included, and fails any that the address policy (literal or DNS answer) refuses.
    if (remote) {
      try {
        const cdp = await ctx.newCDPSession(page);
        cdp.on('Fetch.requestPaused', (e) => {
          const u = e.request.url;
          (async () => {
            const ok = allowRequest(u, mode, target.protocol, pageOrigin) && !(await privateUrl(u));
            if (!ok) { noteBlocked(u); if (e.resourceType === 'Document' && !loaded) navRefused = blockedOrigin(u); }
            await cdp.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: e.requestId } : { requestId: e.requestId, errorReason: 'BlockedByClient' });
          })().catch(() => { /* the request or the page is gone */ });
        });
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      } catch (e) {
        return { captured: false, reason: `the browser cannot apply the remote address guard: ${firstLine(e)}`, exit: 4 };
      }
    }
    // remote: did the browser actually connect to a private address for this response (DNS rebinding, redirect to a name)?
    const reachedPrivate = async (r) => {
      if (!remote) return false;
      const key = r.url().split('#')[0];
      if (tainted.has(key)) return true;
      if (blockedOrigin(key) === pageOrigin) return false;
      let sa = null;
      try { sa = await r.serverAddr(); } catch { /* no address known */ }
      if ((sa && isPrivateAddress(sa.ipAddress)) || await privateUrl(key)) { tainted.add(key); failedUrls.set(key, PRIVATE_SHEET); return true; }
      return false;
    };

    page.on('requestfailed', (rq) => { if (!failedUrls.has(rq.url())) failedUrls.set(rq.url(), ''); });
    // The bytes the browser itself received for images, fonts and stylesheets: nothing is fetched again.
    // Each body is stored under every URL of its request's redirect chain, so an element that names the first URL (an
    // image behind a 302) finds it; every hop is held to the same private-address check.
    const captured = new Map();
    const bodies = [];
    const waiting = new Map(); // body jobs still reading: job id -> the keys it would store
    let bodiesClosed = false; // set when the body wait ran out: a late job stores nothing
    let stored = 0;
    let jobs = 0;
    // Image, font and stylesheet requests still in flight: Chromium may hold a response back (MIME sniffing a stalled body,
    // say) so no response event comes; the body wait also waits for these, and one still open at the deadline is late.
    const inflight = new Map(); // request -> { key, done }
    const settleReq = (rq) => { const f = inflight.get(rq); if (f) { inflight.delete(rq); f.done(); } };
    page.on('request', (rq) => {
      try {
        for (let q = rq.redirectedFrom(); q; q = q.redirectedFrom()) settleReq(q);
        if (bodiesClosed || inflight.size >= 5000 || !['image', 'font', 'stylesheet'].includes(rq.resourceType())) return;
        let done;
        const p = new Promise((r) => { done = r; });
        inflight.set(rq, { key: rq.url().split('#')[0], done, p });
      } catch { /* a request without a frame or type */ }
    });
    page.on('requestfinished', settleReq);
    page.on('requestfailed', settleReq);
    page.on('response', (r) => {
      const id = jobs++;
      bodies.push((async () => {
        try {
          const req = r.request();
          if (!['image', 'font', 'stylesheet'].includes(req.resourceType())) return;
          const st = r.status();
          if (st >= 400 && !failedUrls.has(r.url())) failedUrls.set(r.url(), '');
          if (st !== 0 && (st < 200 || st > 299)) return;
          const key = r.url().split('#')[0];
          if (await reachedPrivate(r)) { noteBlocked(key); return; }
          const keys = [key];
          for (let q = req.redirectedFrom(); q && keys.length < 21; q = q.redirectedFrom()) {
            const k = q.url().split('#')[0];
            if (remote && (tainted.has(k) || await privateUrl(k))) { noteBlocked(k); return; }
            if (!keys.includes(k)) keys.push(k);
          }
          const put = (v) => { if (!bodiesClosed) for (const k of keys) captured.set(k, v); };
          const h = r.headers();
          const cl = Number(h['content-length']);
          if (Number.isFinite(cl) && cl > maxAsset && req.resourceType() !== 'stylesheet') return put({ tooBig: true, bytes: cl });
          if (bodiesClosed) return;
          waiting.set(id, keys);
          const body = await r.body();
          waiting.delete(id);
          if (body.length > maxAsset && req.resourceType() !== 'stylesheet') return put({ tooBig: true, bytes: body.length });
          if (bodiesClosed) return;
          if (stored + body.length > MAX_STORED_BYTES) return put({ tooBig: true, bytes: body.length });
          stored += body.length;
          put({ mime: h['content-type'] || mimeForPath(key) || '', body });
        } catch { waiting.delete(id); /* a response without a body (redirect, aborted) is simply not stored */ }
      })());
    });

    // ONE deadline for the whole capture: every wait after the start (load, settle, fonts, full-page scroll, asset bodies,
    // screenshot) gets at most what is left of --timeout-ms, so a stalled font or image cannot stretch the run
    const deadline = Date.now() + timeout;
    const left = () => Math.max(0, deadline - Date.now());
    let resp;
    const ledToPrivate = (o2) => bad(`url refused: ${target.href} led the browser to a private or loopback address (${o2})`, 2);
    // the document itself must arrive in time; the load event (every image, stylesheet and font of the markup) is then
    // only waited for until the deadline, so one stalled asset in the original HTML does not fail the capture
    try { resp = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout }); } catch (e) {
      if (navRefused) throw ledToPrivate(navRefused);
      const proxyVar = remote ? PROXY_VARS.find((v) => env[v]) : null;
      const hint = proxyVar ? ` (${PROXY_HINT}: ${proxyVar} is set but not used, so a network that only allows egress through a proxy cannot reach the page)` : '';
      throw bad(`could not load ${target.href}: ${firstLine(e)}${hint}`);
    }
    if (resp && typeof resp.ok === 'function' && !resp.ok() && resp.status() !== 0) throw bad(`page returned HTTP ${resp.status()}`);
    if (resp && await reachedPrivate(resp)) throw ledToPrivate(blockedOrigin(resp.url()));
    let networkIdle = true;
    const waitState = async (state, cap) => {
      const ms = Math.min(cap, left());
      if (ms <= 0) { networkIdle = false; return; }
      try { await page.waitForLoadState(state, { timeout: ms }); } catch { networkIdle = false; }
    };
    await waitState('load', Infinity);
    await waitState('networkidle', 10000);
    // document.fonts.ready never resolves while a font body stalls: race it against the time left (in the page and here)
    const fontsMs = left();
    const fontsReady = fontsMs > 0 && await bounded(page.evaluate((ms) => (document.fonts && document.fonts.ready
      ? Promise.race([document.fonts.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))])
      : true), fontsMs).catch(() => true), fontsMs + 250, false) === true;
    if (!fontsReady) networkIdle = false;
    if (o.fullPage) {
      const ms = left();
      const scrolled = ms > 0 && await bounded(page.evaluate(async (until) => {
        const h = Math.max(document.documentElement.scrollHeight, 0);
        for (let y = 0; y < h && Date.now() < until; y += Math.max(window.innerHeight, 200)) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
        return true;
      }, Date.now() + ms).catch(() => false), ms + 250, false);
      if (scrolled) await waitState('networkidle', 5000);
      else networkIdle = false;
    }
    loaded = true;
    // every body wait is bounded by what is left of --timeout-ms (at least BODY_GRACE_MS): a body still streaming then is
    // dropped and listed in skipped, and the capture goes on
    const allIn = await bounded(Promise.all([...bodies, ...[...inflight.values()].map((f) => f.p)]).then(() => Promise.all(bodies)).then(() => true),
      Math.max(BODY_GRACE_MS, left()), false);
    if (!allIn) {
      bodiesClosed = true;
      for (const keys of waiting.values()) for (const k of keys) if (!captured.has(k)) captured.set(k, { late: true });
      for (const f of inflight.values()) if (!captured.has(f.key)) captured.set(f.key, { late: true });
    }

    // Playwright's screenshot waits for document.fonts.ready itself: with a font still stalled it would only time out,
    // so then the picture is taken through DevTools, which does not wait for fonts (the fallback face is drawn)
    let png;
    const shotMs = Math.max(SCREENSHOT_FLOOR_MS, left());
    try {
      png = fontsReady
        ? await page.screenshot({ type: 'png', fullPage: !!o.fullPage, timeout: shotMs })
        : await bounded(devtoolsScreenshot(ctx, page, !!o.fullPage), shotMs, null).then((b) => { if (!b) throw new Error(`timed out after ${shotMs} ms`); return b; });
    } catch (e) { throw bad(`the screenshot failed: ${firstLine(e)}`); }
    // the DOM copy runs on the page's main thread: a page that keeps it busy (a loop after the screenshot) never answers,
    // so it gets what is left of the deadline (at least DOM_FLOOR_MS); then the capture fails with exit 1 and writes nothing
    const domMs = Math.max(DOM_FLOOR_MS, left());
    const dom = await bounded(page.evaluate(snapshotDom, [...failedUrls].slice(0, 5000)), domMs, null);
    if (!dom || typeof dom.html !== 'string') throw bad(`${NO_ANSWER}: the DOM copy did not finish within ${domMs} ms; nothing was written`);
    if (Buffer.byteLength(dom.html) > MAX_HTML_BYTES) throw bad(`the rendered page is larger than ${MAX_HTML_BYTES} bytes`);
    const finalUrl = page.url();
    const at = (io.now ? io.now() : new Date()).toISOString();

    const fileMode = target.protocol === 'file:';
    const local = new Map();
    const assetLookup = (u) => captured.get(u) || local.get(u) || null;
    const pendingCss = {};
    // the address checks of pending sheets share one bound: a lookup still open then counts as private (the sheet is dropped)
    const dnsUntil = Date.now() + Math.max(DNS_FLOOR_MS, left());
    for (const p of Array.isArray(dom.pending) ? dom.pending : []) {
      const key = String(p.href).split('#')[0];
      if (remote && (tainted.has(key) || await bounded(privateUrl(key), dnsUntil - Date.now(), true))) { pendingCss[p.n] = false; continue; }
      let hit = captured.get(key);
      if (!hit && fileMode && /^file:/i.test(key)) hit = await readLocalAsset(key, maxAsset);
      pendingCss[p.n] = hit && hit.body && !hit.tooBig ? hit.body.toString('utf-8') : null;
    }
    const opts = { url: target.href, at, resolved: resolvePending(dom, pendingCss), theme: o.theme || null, maxAsset, maxTotal };
    if (fileMode) {
      // a file:// page's assets are read from disk (images and fonts only); first pass learns which ones the copy asks for
      const need = new Set();
      buildSnapshot(dom, { ...opts, lookup: (u) => { need.add(u); return captured.get(u) || null; } });
      for (const u of need) if (/^file:/i.test(u) && !captured.has(u)) { const hit = await readLocalAsset(u, maxAsset); if (hit) local.set(u, hit); }
    }
    const built = buildSnapshot(dom, { ...opts, lookup: assetLookup });
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
