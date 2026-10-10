#!/usr/bin/env node
// Stub runner for wording-judge tests. Reads the prompt on stdin; STUB_MODE picks the behaviour; STUB_LOG gets one line per call.
import fs from 'fs';
const mode = process.env.STUB_MODE || 'ok';
let prompt = '';
process.stdin.setEncoding('utf-8');
for await (const c of process.stdin) prompt += c;
if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2), probe: prompt.startsWith('Reply with') }) + '\n');
const say = (result, is_error = false) => process.stdout.write(JSON.stringify({ type: 'result', is_error, result }));
if (prompt.startsWith('Reply with')) {
  if (mode === 'limit') { say('Claude usage limit reached. Your limit will reset at 5pm.', true); process.exit(1); }
  if (mode === 'login') { say('Please log in to continue'); process.exit(0); }
  if (mode === 'crash') process.exit(3);
  say('OK');
} else {
  const ids = [...prompt.trim().split("\n").pop().matchAll(/"id":"([^"]+)"/g)].map(m => m[1]);
  if (mode === 'garbage') say('I think these are fine!');
  else if (mode === 'extra') say(JSON.stringify({ verdicts: [...ids.map(id => ({ id, plain: 'yes', correct: false })), { id: 'ghost#1', plain: true, correct: true }] }));
  else say('```json\n' + JSON.stringify({ verdicts: ids.map(id => ({ id, plain: true, correct: true })) }) + '\n```');
}
