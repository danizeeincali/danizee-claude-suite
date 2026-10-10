/**
 * Preload (`node --import <this>`) for the packaged checks: any network attempt or any child process
 * other than node, a local git subcommand, or an executable inside $KIT_EGRESS_ALLOW_DIR is logged
 * to $KIT_EGRESS_LOG (one JSON line) and refused with an error. Child node processes inherit this
 * preload through NODE_OPTIONS, which the harness sets.
 */
import { createRequire, syncBuiltinESMExports } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const LOG = process.env.KIT_EGRESS_LOG;
const ALLOW_DIR = process.env.KIT_EGRESS_ALLOW_DIR ? path.resolve(process.env.KIT_EGRESS_ALLOW_DIR) : null;
const GIT_NETWORK = new Set(['fetch', 'clone', 'pull', 'push', 'ls-remote', 'remote', 'submodule', 'archive']);

function block(kind, detail) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify({ kind, detail: String(detail).slice(0, 300), pid: process.pid }) + '\n');
  const e = new Error(`egress blocked: ${kind} ${detail}`);
  e.code = 'EGRESS_BLOCKED';
  throw e;
}

for (const [modName, fns] of [
  ['net', ['connect', 'createConnection']],
  ['tls', ['connect']],
  ['http', ['request', 'get']],
  ['https', ['request', 'get']],
  ['dns', ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveTxt', 'resolveSrv']]
]) {
  const m = require(modName);
  for (const fn of fns) m[fn] = (...a) => block(`${modName}.${fn}`, typeof a[0] === 'object' ? JSON.stringify(a[0]) : a[0]);
}
require('net').Socket.prototype.connect = function (...a) { return block('net.Socket.connect', JSON.stringify(a[0])); };
const dnsp = require('dns').promises;
for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) dnsp[fn] = async (h) => block(`dns.promises.${fn}`, h);
globalThis.fetch = async (u) => block('fetch', u);
if (globalThis.WebSocket) globalThis.WebSocket = function (u) { block('WebSocket', u); };

function allowedCommand(file, args) {
  const cmd = String(file);
  const base = path.basename(cmd);
  if (cmd === process.execPath || base === 'node') return true;
  if (base === 'git') {
    const sub = (args || []).find(a => !String(a).startsWith('-') && !/^[\w.]+=/.test(String(a)));
    return !GIT_NETWORK.has(String(sub));
  }
  if (ALLOW_DIR && path.isAbsolute(cmd) && path.resolve(cmd).startsWith(ALLOW_DIR + path.sep)) return true;
  return false;
}
const cp = require('child_process');
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const orig = cp[fn];
  cp[fn] = function (file, args, ...rest) {
    const list = Array.isArray(args) ? args : [];
    if (!allowedCommand(file, list)) block(`child_process.${fn}`, [file, ...list].join(' '));
    return orig.call(this, file, args, ...rest);
  };
}
for (const fn of ['exec', 'execSync', 'fork']) {
  const orig = cp[fn];
  cp[fn] = function (command, ...rest) {
    if (fn === 'fork') return orig.call(this, command, ...rest); // a node child: inherits this preload
    const first = String(command).trim().split(/\s+/);
    if (!allowedCommand(first[0], first.slice(1))) block(`child_process.${fn}`, command);
    return orig.call(this, command, ...rest);
  };
}
syncBuiltinESMExports();
