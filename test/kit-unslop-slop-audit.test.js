import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as sa from '../src/lib/kit/slop-audit.js';

const { run, scanText, listSigns, verb, parseColors } = sa;
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);
const signs = (text, format) => scanText(text, format).hits.map(h => h.sign);
const has = (text, sign, format) => assert.ok(signs(text, format).includes(sign), `${sign} expected in ${JSON.stringify(text)}; got ${signs(text, format)}`);
const hasNot = (text, sign, format) => assert.ok(!signs(text, format).includes(sign), `${sign} unexpected in ${JSON.stringify(text)}`);

describe('signs', () => {
  it('lists the required groups, each sign with id, label, fix and detect', () => {
    const { groups } = listSigns();
    const ids = groups.map(g => g.id);
    for (const g of ['surfaces', 'type', 'icons', 'spacing', 'copy', 'components', 'landing-hero', 'motion', 'template-look']) assert.ok(ids.includes(g), g);
    const all = groups.flatMap(g => g.signs);
    assert.equal(new Set(all.map(s => s.id)).size, all.length);
    for (const s of all) {
      assert.equal(typeof s.id, 'string');
      assert.ok(s.label.length > 3);
      assert.ok(s.fix.length > 3 && !s.fix.includes('\n'));
      assert.ok(s.detect === 'auto' || s.detect === 'manual');
    }
    assert.ok(groups.find(g => g.id === 'template-look').signs.every(s => s.detect === 'manual'));
    assert.deepEqual(groups.find(g => g.id === 'motion').signs.map(s => s.id), ['looping-pulse', 'transition-all', 'hover-scale', 'layout-animation']);
  });
  it('run signs matches listSigns and takes no arguments', async () => {
    assert.deepEqual(await run(['signs'], io('')), listSigns());
    await exit(() => run(['signs', '--file', 'x'], io('')));
  });
  it('exports the verb name', () => assert.equal(verb, 'slop-audit'));
});

describe('colors', () => {
  it('parses hex, rgb, hsl and names', () => {
    assert.equal(Math.round(parseColors('#ff0000')[0].h), 0);
    assert.equal(Math.round(parseColors('rgb(0, 0, 255)')[0].h), 240);
    assert.equal(Math.round(parseColors('hsl(270 80% 50%)')[0].h), 270);
    assert.equal(parseColors('rgba(0,0,0,.2)')[0].a, 0.2);
    assert.equal(parseColors('transparent').length, 0);
    assert.equal(parseColors('#abcd')[0].a > 0.8, true);
  });
});

describe('surfaces', () => {
  it('flags purple-to-blue and purple-to-pink gradients in css, rgb and hsl', () => {
    has('.a{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}', 'purple-blue-gradient', 'css');
    has('.a{background:linear-gradient(to right, rgb(139,92,246), rgb(236,72,153))}', 'purple-blue-gradient', 'css');
    has('.a{background:radial-gradient(circle, hsl(270 80% 60%), hsl(210 90% 55%))}', 'purple-blue-gradient', 'css');
    has('.a{background:linear-gradient(90deg, indigo, pink)}', 'purple-blue-gradient', 'css');
  });
  it('flags tailwind from/to purple-blue classes', () => {
    has('<div class="bg-gradient-to-r from-purple-500 to-blue-500">x</div>', 'purple-blue-gradient');
    has('<div className="bg-gradient-to-br from-violet-600 via-indigo-500 to-pink-500" />', 'purple-blue-gradient', 'jsx');
    has('<div class="bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">x</div>', 'purple-blue-gradient');
  });
  it('ignores neutral, same-hue-ish and fade gradients', () => {
    hasNot('.a{background:linear-gradient(#fff,#eee)}', 'purple-blue-gradient', 'css');
    hasNot('.a{background:linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,.6))}', 'purple-blue-gradient', 'css');
    hasNot('.a{background:linear-gradient(#22c55e,#16a34a)}', 'purple-blue-gradient', 'css');
    hasNot('<div class="bg-gradient-to-r from-gray-100 to-gray-200">x</div>', 'purple-blue-gradient');
    hasNot('<div class="bg-purple-500">x</div>', 'purple-blue-gradient');
  });
  it('flags colored glows but not grey shadows or small colored ones', () => {
    has('.a{box-shadow:0 0 40px rgba(139,92,246,.5)}', 'colored-glow', 'css');
    has('.a{box-shadow:0 8px 32px #00d4ff}', 'colored-glow', 'css');
    has('.a{filter:drop-shadow(0 0 12px hotpink)}', 'colored-glow', 'css');
    has('.a{text-shadow:0 0 20px #0ff}', 'colored-glow', 'css');
    has('<div className="shadow-lg shadow-indigo-500/50" />', 'colored-glow', 'jsx');
    has('<div class="shadow-[0_0_30px_rgba(168,85,247,0.6)]">x</div>', 'colored-glow');
    hasNot('.a{box-shadow:0 4px 24px rgba(0,0,0,.25)}', 'colored-glow', 'css');
    hasNot('.a{box-shadow:0 1px 2px rgba(99,102,241,.4)}', 'colored-glow', 'css');
    hasNot('.a{box-shadow:0 10px 30px #ccc}', 'colored-glow', 'css');
    hasNot('<div class="shadow-lg shadow-slate-900/10">x</div>', 'colored-glow');
    hasNot('<div class="shadow-md">x</div>', 'colored-glow');
  });
  it('flags a neon border only together with a glow', () => {
    has('.a{border:1px solid #0ff;box-shadow:0 0 20px #0ff}', 'neon-border', 'css');
    hasNot('.a{border:1px solid #0ff}', 'neon-border', 'css');
    hasNot('.a{border:1px solid #ddd;box-shadow:0 0 20px #0ff}', 'neon-border', 'css');
    has('<div class="border border-cyan-400 shadow-cyan-500/50 shadow-lg">x</div>', 'neon-border');
  });
  it('flags glass', () => {
    has('.a{backdrop-filter:blur(12px);background:rgba(255,255,255,.1)}', 'glass', 'css');
    has('<div class="backdrop-blur-md bg-white/10">x</div>', 'glass');
    hasNot('.a{filter:blur(2px)}', 'glass', 'css');
  });
});

describe('type', () => {
  it('flags weight 800/900 in css, jsx style and tailwind but not 700', () => {
    has('h1{font-weight:800}', 'heavy-weight', 'css');
    has('h1{font-weight: 900 !important}', 'heavy-weight', 'css');
    has('<h1 class="font-extrabold">x</h1>', 'heavy-weight');
    has('<h1 class="text-3xl font-black">x</h1>', 'heavy-weight');
    has("<h1 style={{ fontWeight: 800 }}>x</h1>", 'heavy-weight', 'jsx');
    hasNot('h1{font-weight:700}', 'heavy-weight', 'css');
    hasNot('<h1 class="font-bold">x</h1>', 'heavy-weight');
  });
  it('flags gradient text', () => {
    has('h1{-webkit-background-clip:text;color:transparent}', 'gradient-text', 'css');
    has('h1{background-clip: text}', 'gradient-text', 'css');
    has('<h1 class="bg-clip-text text-transparent">x</h1>', 'gradient-text');
  });
  it('flags tracked uppercase labels only when both are present', () => {
    has('.l{text-transform:uppercase;letter-spacing:.1em}', 'tracked-uppercase', 'css');
    has('.l{text-transform:uppercase;letter-spacing:2px}', 'tracked-uppercase', 'css');
    has('<span class="text-xs uppercase tracking-wider">x</span>', 'tracked-uppercase');
    has("<span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>x</span>", 'tracked-uppercase', 'jsx');
    hasNot('.l{text-transform:uppercase}', 'tracked-uppercase', 'css');
    hasNot('.l{letter-spacing:.1em}', 'tracked-uppercase', 'css');
    hasNot('<span class="uppercase">x</span>', 'tracked-uppercase');
    hasNot('<span class="uppercase tracking-tight">x</span>', 'tracked-uppercase');
  });
});

describe('icons', () => {
  it('flags emoji in visible text, not in attributes, scripts or plain symbols', () => {
    has('<button>🚀 Launch</button>', 'emoji-icons');
    has('# Title ✨\n', 'emoji-icons', 'md');
    hasNot('<div data-x="🚀">Launch</div>', 'emoji-icons');
    hasNot('<script>const a = "🚀";</script><p>ok</p>', 'emoji-icons');
    hasNot('<p>Copyright © 2026 — v1 → v2 ✓</p>', 'emoji-icons');
  });
  it('flags a second icon set', () => {
    has("import { Home } from 'lucide-react';\nimport { FaBell } from 'react-icons/fa';\n", 'mixed-icon-sets', 'jsx');
    has("import { Home } from '@heroicons/react/24/outline';\nimport { Bell } from 'lucide-react';\n", 'mixed-icon-sets', 'jsx');
    hasNot("import { Home } from 'lucide-react';\nimport { Bell } from 'lucide-react';\n", 'mixed-icon-sets', 'jsx');
    hasNot("import { FaBell } from 'react-icons/fa';\nimport { FaHome } from 'react-icons/fa';\n", 'mixed-icon-sets', 'jsx');
  });
});

describe('spacing', () => {
  it('flags px off the 4px grid in css, jsx and tailwind arbitrary values', () => {
    has('.a{margin:13px}', 'off-grid-spacing', 'css');
    has('.a{padding:8px 15px}', 'off-grid-spacing', 'css');
    has('.a{gap:18px}', 'off-grid-spacing', 'css');
    has('.a{margin-top:-7px}', 'off-grid-spacing', 'css');
    has("<div style={{ marginTop: 13 }} />", 'off-grid-spacing', 'jsx');
    has('<div class="mt-[13px]">x</div>', 'off-grid-spacing');
  });
  it('ignores on-grid values, 1px, calc, em, borders and 0', () => {
    hasNot('.a{margin:16px 0 8px;padding:4px;gap:24px}', 'off-grid-spacing', 'css');
    hasNot('.a{border:1px solid red;outline:3px solid blue}', 'off-grid-spacing', 'css');
    hasNot('.a{margin:1px;padding:0}', 'off-grid-spacing', 'css');
    hasNot('.a{margin:calc(100% - 13px)}', 'off-grid-spacing', 'css');
    hasNot('.a{margin:1.5em}', 'off-grid-spacing', 'css');
    hasNot('<div class="mt-[16px] p-4">x</div>', 'off-grid-spacing');
  });
});

describe('copy', () => {
  it('flags greeting headlines', () => {
    has('<h1>Welcome back, Sam</h1>', 'greeting-headline');
    has('<h1>Hey there</h1>', 'greeting-headline');
    has('<h1>Good morning</h1>', 'greeting-headline');
    has('## Hi Alex\n', 'greeting-headline', 'md');
    hasNot('<h1>Your projects</h1>', 'greeting-headline');
  });
  it('flags exclamation marks in visible text only', () => {
    has('<h1>Get started now!</h1>', 'exclamation-marks');
    has('Done!\n', 'exclamation-marks', 'md');
    hasNot('.a{color:red !important}', 'exclamation-marks', 'css');
    hasNot('<div style="color:red !important">x</div>', 'exclamation-marks');
    hasNot('<!doctype html><p>x</p>', 'exclamation-marks');
    hasNot('<!-- Wow! --><p>x</p>', 'exclamation-marks');
    hasNot('<script>if (a !== b) alert("no!")</script><p>x</p>', 'exclamation-marks');
    hasNot("export const A = () => <div>{!ok && <b>x</b>}</div>;", 'exclamation-marks', 'jsx');
    hasNot('![alt](a.png)\n', 'exclamation-marks', 'md');
    hasNot('Use `a!` here\n', 'exclamation-marks', 'md');
  });
  it('flags hype words', () => {
    for (const w of ['revolutionary', 'Supercharge your team', 'unleash the power', 'seamless integration', 'cutting-edge', 'a game-changer', 'next-level', 'blazing fast', '10x faster', 'seamlessly'])
      has(`<p>${w}</p>`, 'hype-words');
    hasNot('<p>Plain, honest words about invoices.</p>', 'hype-words');
    hasNot('<p>The 10 xylophones</p>', 'hype-words');
  });
  it('flags fake data and placeholder numbers', () => {
    has('<p>Lorem ipsum dolor sit amet</p>', 'fake-data');
    has('<td>John Doe</td>', 'fake-data');
    has('<span>$1,234</span>', 'fake-data');
    has('<span>12,345 users</span>', 'fake-data');
    hasNot('<span>$1,834.20</span>', 'fake-data');
    hasNot('<p>Room 12345B</p>x', 'fake-data');
  });
  it('flags unverified social proof (landing hero group)', () => {
    has('<p>Trusted by 10,000+ teams</p>', 'unverified-social-proof');
    has('<p>Join 5,000 developers</p>', 'unverified-social-proof');
    has('<p>Loved by thousands of founders</p>', 'unverified-social-proof');
    hasNot('<p>Trusted by Stripe and Linear</p>', 'unverified-social-proof');
  });
});

describe('components', () => {
  it('flags a glowing badge or pill, not a flat one', () => {
    has('.badge{background:#eee;box-shadow:0 0 20px rgba(99,102,241,.6)}', 'glow-badge', 'css');
    has('<span class="badge rounded-full shadow-lg shadow-purple-500/50">x</span>', 'glow-badge');
    hasNot('.badge{background:#eee;border-radius:4px}', 'glow-badge', 'css');
    hasNot('.card{box-shadow:0 0 20px rgba(99,102,241,.6)}', 'glow-badge', 'css');
  });
  it('flags sparklines', () => {
    has('<StatCard value="12"><Sparkline data={d} /></StatCard>', 'sparkline-stat-card', 'jsx');
    has('<div class="stat-card"><svg class="sparkline"></svg></div>', 'sparkline-stat-card');
    hasNot('<div class="stat-card">12</div>', 'sparkline-stat-card');
  });
});

describe('motion', () => {
  it('flags looping pulses', () => {
    has('.p{animation:pulse 2s ease-in-out infinite}', 'looping-pulse', 'css');
    has('.p{animation:glow 3s infinite}', 'looping-pulse', 'css');
    has('<span class="animate-pulse">x</span>', 'looping-pulse');
    hasNot('.p{animation:spin 1s linear infinite}', 'looping-pulse', 'css');
    hasNot('.p{animation:pulse 1s 2}', 'looping-pulse', 'css');
    hasNot('<svg class="animate-spin"></svg>', 'looping-pulse');
  });
  it('flags transition: all and transition-all', () => {
    has('.b{transition:all .3s ease}', 'transition-all', 'css');
    has('.b{transition-property:all}', 'transition-all', 'css');
    has('<button class="transition-all duration-300">x</button>', 'transition-all');
    has("<div style={{ transition: 'all 0.3s' }} />", 'transition-all', 'jsx');
    hasNot('.b{transition:opacity .2s, transform .2s}', 'transition-all', 'css');
    hasNot('<button class="transition-colors">x</button>', 'transition-all');
  });
  it('flags hover scale', () => {
    has('.b:hover{transform:scale(1.05)}', 'hover-scale', 'css');
    has('<div class="hover:scale-105">x</div>', 'hover-scale');
    has('<motion.div whileHover={{ scale: 1.1 }} />', 'hover-scale', 'jsx');
    hasNot('.b{transform:scale(1.05)}', 'hover-scale', 'css');
    hasNot('.b:hover{background:#eee}', 'hover-scale', 'css');
  });
  it('flags animating layout properties', () => {
    has('.b{transition:width .3s}', 'layout-animation', 'css');
    has('.b{transition:opacity .2s, margin-left .2s}', 'layout-animation', 'css');
    has('@keyframes grow{from{height:0}to{height:100%}}', 'layout-animation', 'css');
    has('<div class="transition-[width] duration-200">x</div>', 'layout-animation');
    hasNot('.b{transition:transform .2s, opacity .2s}', 'layout-animation', 'css');
    hasNot('@keyframes fade{from{opacity:0}to{opacity:1}}', 'layout-animation', 'css');
    hasNot('.b{width:100%;transition:color .2s}', 'layout-animation', 'css');
  });
});

describe('skipping', () => {
  it('skips html comments, script bodies, css comments and fenced markdown', () => {
    assert.equal(scanText('<!-- <h1>Revolutionary!</h1> font-weight:900 --><p>ok</p>', 'html').total, 0);
    assert.equal(scanText('<script>var s = "font-weight:900; Welcome back!"</script><p>ok</p>', 'html').total, 0);
    assert.equal(scanText('/* font-weight:900; transition: all 1s */ .a{color:red}', 'css').total, 0);
    assert.equal(scanText('# Doc\n\n```css\nh1{font-weight:900}\n```\n\nPlain text.\n', 'md').total, 0);
    assert.equal(scanText('~~~\nSupercharge!\n~~~\n', 'md').total, 0);
    assert.equal(scanText('// font-weight: 900\nexport const a = 1;\n', 'jsx').total, 0);
  });
  it('still scans style blocks in html', () => {
    has('<style>h1{font-weight:900}</style>', 'heavy-weight', 'html');
  });
});

describe('scan output shape', () => {
  const SAMPLE = '<h1 class="font-black">Welcome back!</h1>\n<p>Fine.</p>\n<div style="margin:13px">x</div>\n';
  it('has format, hits, counts, total, manual with the documented fields', () => {
    const r = scanText(SAMPLE);
    assert.equal(r.format, 'html');
    assert.equal(r.total, r.hits.length);
    assert.deepEqual(Object.keys(r.counts), listSigns().groups.map(g => g.id));
    assert.equal(r.counts.type, 1);
    assert.equal(r.counts.copy, 2);
    assert.equal(r.counts.spacing, 1);
    assert.equal(r.counts.motion, 0);
    for (const h of r.hits) {
      assert.deepEqual(Object.keys(h).sort(), ['excerpt', 'fix', 'group', 'line', 'sign']);
      assert.ok(h.excerpt.length <= 120);
      assert.ok(h.fix.length > 0);
    }
    const lines = r.hits.map(h => h.line);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
    assert.equal(r.hits.at(-1).line, 3);
    assert.ok(r.manual.includes('grey-neutrals'));
    assert.ok(r.manual.includes('pill-badge-hero'));
    assert.ok(!r.manual.includes('heavy-weight'));
  });
  it('reports one hit per sign per line and trims long lines to 120 chars', () => {
    const long = '<div class="' + 'x '.repeat(200) + 'font-black font-extrabold">Hi!</div>';
    const r = scanText(long, 'html');
    assert.equal(r.hits.filter(h => h.sign === 'heavy-weight').length, 1);
    for (const h of r.hits) assert.ok(h.excerpt.length <= 120);
    assert.ok(r.hits.find(h => h.sign === 'heavy-weight').excerpt.includes('font-'));
  });
  it('is clean on a calm page', () => {
    const r = scanText('<main><h1>Invoices</h1><p>Three are overdue.</p></main>\n<style>main{margin:16px;font-weight:600}</style>');
    assert.equal(r.total, 0);
    assert.deepEqual(r.hits, []);
  });
});

describe('run scan', () => {
  it('reads stdin, sniffs the format and exits 0 without --strict', async () => {
    const r = await run(['scan'], io('<h1 class="font-black">x</h1>'));
    assert.equal(r.format, 'html');
    assert.equal(r.total, 1);
    assert.equal('exit' in r, false);
    assert.equal((await run(['scan'], io('h1{font-weight:900}'))).format, 'css');
    assert.equal((await run(['scan'], io("import x from 'y';\nexport default () => <div className=\"font-black\">x</div>;"))).format, 'jsx');
    assert.equal((await run(['scan'], io('# Title\n\ntext'))).format, 'md');
  });
  it('honors --format over the sniff', async () => {
    const r = await run(['scan', '--format', 'css'], io('h1{font-weight:900}'));
    assert.equal(r.format, 'css');
    assert.equal((await run(['scan', '--format', 'md'], io('<h1 class="font-black">x</h1>'))).format, 'md');
  });
  it('--strict exits 2 with the JSON when there are hits and 0 when clean', async () => {
    const dirty = await run(['scan', '--strict'], io('h1{font-weight:900}'));
    assert.equal(dirty.exit, 2);
    assert.equal(dirty.total, 1);
    assert.equal(dirty.hits[0].sign, 'heavy-weight');
    const clean = await run(['scan', '--strict'], io('h1{font-weight:600}'));
    assert.equal(clean.exit, 0);
    assert.equal(clean.total, 0);
  });
  it('reads --file relative to cwd and agrees with stdin', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slop-'));
    try {
      const text = '<h1 class="font-black">Hi!</h1>\n';
      await fs.writeFile(path.join(dir, 'a.html'), text);
      const f = await run(['scan', '--file', 'a.html'], io('', dir));
      assert.deepEqual(f, await run(['scan'], io(text, dir)));
      await exit(() => run(['scan', '--file', 'nope.html'], io('', dir)));
      await exit(() => run(['scan', '--file', '.'], io('', dir)));
      await exit(() => run(['scan', '--file', '/dev/null'], io('', dir)));
      await fs.writeFile(path.join(dir, 'bin.html'), Buffer.from([0x3c, 0, 0x3e]));
      await exit(() => run(['scan', '--file', 'bin.html'], io('', dir)));
      await fs.writeFile(path.join(dir, 'big.html'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
      await exit(() => run(['scan', '--file', 'big.html'], io('', dir)));
      await fs.writeFile(path.join(dir, 'empty.css'), '  \n');
      await exit(() => run(['scan', '--file', 'empty.css'], io('', dir)));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('rejects empty, binary, oversize input and bad arguments with exit 1', async () => {
    await exit(() => run(['scan'], io('')));
    await exit(() => run(['scan'], io(' \n ')));
    await exit(() => run(['scan'], io('a\0b')));
    await exit(() => run(['scan'], io('x'.repeat(8 * 1024 * 1024 + 1))));
    await exit(() => run(['scan', '--bogus'], io('x')));
    await exit(() => run(['scan', 'extra'], io('x')));
    await exit(() => run(['scan', '--format', 'pdf'], io('x')));
    await exit(() => run(['scan', '--format'], io('x')));
    await exit(() => run(['scan', '--format', 'css', '--format', 'css'], io('x')));
    await exit(() => run(['scan', '--file', 'a', '--file', 'b'], io('x')));
    await exit(() => run(['scan', '--file', ''], io('x')));
    await exit(() => run(['scan', '--strict', '--strict'], io('x')));
    await exit(() => run([], io('')));
    await exit(() => run(['bogus'], io('')));
  });
  it('handles BOM and CRLF input', async () => {
    const r = await run(['scan'], io('﻿h1{\r\n font-weight: 900;\r\n}\r\n'));
    assert.equal(r.format, 'css');
    assert.equal(r.hits[0].line, 2);
  });
});

describe('review r1 regressions', () => {
  const COPY_SIGNS = ['fake-data', 'exclamation-marks', 'hype-words', 'greeting-headline', 'emoji-icons', 'unverified-social-proof'];
  const copyHits = (t, f) => scanText(t, f).hits.filter(h => COPY_SIGNS.includes(h.sign));

  it('jsx: code between and around tags is never read as copy (multi-component .jsx)', () => {
    const src = `import React from 'react';

export function Header() {
  return <h1>Projects</h1>;
}

export function Footer({ year }) {
  const port = 1234;
  if (!year) throw new Error('year is required!');
  const label = "Welcome back!";
  return (
    <footer className="p-4">
      <p>Built in {year}</p>
      {year > 2000 && <small>since 2000</small>}
    </footer>
  );
}
`;
    assert.deepEqual(copyHits(src, 'jsx'), []);
    assert.equal(scanText(src).format, 'jsx');
    assert.equal(scanText(src).total, 0);
  });
  it('jsx: TS generics and forwardRef are not tags (shadcn-style tsx)', () => {
    const src = `import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Array<string>;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => {
    const [n, setN] = React.useState<number>(1234);
    const [msg, setMsg] = React.useState<string>('saved!');
    if (n < 5 && msg !== 'x') console.log("never!");
    return <button ref={ref} className={cn('px-4', className)} {...props}>Save</button>;
  }
);
Button.displayName = 'Button';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div ref={ref} {...props}>Total 1834</div>
);
`;
    assert.deepEqual(copyHits(src, 'jsx'), []);
    assert.equal(scanText(src).total, 0);
  });
  it('jsx: text children and lone string literal children are still read', () => {
    const src = `export const A = () => (
  <main>
    <h1>Welcome back, Sam</h1>
    <p>Get started now!</p>
    <p>{"Revolutionary stuff"}</p>
    <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
    <b>John Doe</b>
  </main>
);
const note = 'Lorem ipsum!';
`;
    const hits = scanText(src, 'jsx').hits.map(h => h.sign + ':' + h.line);
    for (const x of ['greeting-headline:3', 'exclamation-marks:4', 'hype-words:5', 'fake-data:7']) assert.ok(hits.includes(x), x + ' in ' + hits);
    assert.ok(!hits.some(h => h.endsWith(':9') || h.endsWith(':8')), String(hits));
  });
  it('jsx: --strict exits 0 on a clean multi-component file', async () => {
    const src = "export function Footer() {\n  const port = 1234;\n  throw new Error('year is required!');\n}\nexport const H = () => <h1>Projects</h1>;\n";
    const r = await run(['scan', '--strict', '--format', 'jsx'], io(src));
    assert.equal(r.exit, 0);
    assert.equal(r.total, 0);
  });

  it('md: a fence closes only on a fence at least as long, with no info string', () => {
    const nested = '# T\n\n````md\n```js\nconst a = "x!";\n```\nWelcome back!\n````\n\nDone.\n';
    assert.equal(scanText(nested, 'md').total, 0);
    const info = '# T\n\n```js\nconst a = "x!";\n```js\nWelcome back!\n```\n';
    assert.equal(scanText(info, 'md').total, 0);
    const tilde = '# T\n\n~~~\nWow!\n```\nWow!\n~~~\n\nok\n';
    assert.equal(scanText(tilde, 'md').total, 0);
    const after = '# T\n\n```\ncode!\n```\nAfter the fence!\n';
    assert.deepEqual(scanText(after, 'md').hits.map(h => h.line), [6]);
    const longer = '# T\n\n```\ncode!\n`````\nAfter!\n';
    assert.deepEqual(scanText(longer, 'md').hits.map(h => h.line), [6]);
  });
  it('md: a README that opens with an HTML block is still markdown', async () => {
    const readme = '<p align="center">\n  <img src="logo.png" alt="Logo">\n</p>\n\n# Project\n\nInstall:\n\n```sh\necho "done!"\n```\n\nUse `x!` inline.\n';
    assert.equal(sa.sniff(readme), 'md');
    const r = scanText(readme);
    assert.equal(r.format, 'md');
    assert.equal(r.total, 0);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-'));
    try {
      await fs.writeFile(path.join(dir, 'README.md'), readme);
      const f = await run(['scan', '--file', 'README.md', '--strict'], io('', dir));
      assert.equal(f.format, 'md');
      assert.equal(f.exit, 0);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
    assert.equal(sa.sniff('<div>\n<style>\n.a { color: red; }\n</style>\n</div>'), 'html');
    assert.equal(sa.sniff('<ul>\n- not a list\n</ul>'), 'html');
  });

  it('header contract: every documented exit code and output field is asserted', async () => {
    const header = (await fs.readFile(new URL('../src/lib/kit/slop-audit.js', import.meta.url), 'utf8')).split('*/')[0];
    for (const f of ['format', 'hits', 'counts', 'total', 'manual', 'exit', 'sign, group, line, excerpt, fix']) assert.ok(header.includes(f), f);
    const dirty = '<h1>Get started now!</h1>';
    const r = await run(['scan', '--strict'], io(dirty));
    assert.deepEqual(Object.keys(r).sort(), ['counts', 'exit', 'format', 'hits', 'manual', 'total']);
    assert.deepEqual(Object.keys(r.hits[0]).sort(), ['excerpt', 'fix', 'group', 'line', 'sign']);
    assert.equal(r.exit, 2);
    assert.equal((await run(['scan'], io(dirty))).exit, undefined);
    assert.equal((await run(['scan', '--strict'], io('<p>Plain.</p>'))).exit, 0);
    assert.equal(Object.keys(r.counts).length, sa.GROUPS.length);
    await exit(() => run(['scan'], io('')), 1);
    await exit(() => run(['nope'], io('')), 1);
    for (const fmt of ['html', 'css', 'jsx', 'md']) assert.equal((await run(['scan', '--format', fmt], io('x'))).format, fmt);
  });
});

describe('review r2 regressions', () => {
  it('a README with a jsx fence containing className= is markdown and its prose is scanned', () => {
    const md = '# My Button\n\nWelcome back! This is a revolutionary button.\n\n```jsx\n<Button className="px-4">Click me!</Button>\n```\n';
    assert.equal(sa.sniff(md), 'md');
    const r = scanText(md);
    assert.equal(r.format, 'md');
    const s = r.hits.map(h => h.sign + ':' + h.line);
    for (const x of ['greeting-headline:3', 'exclamation-marks:3', 'hype-words:3']) assert.ok(s.includes(x), x + ' in ' + s);
    assert.equal(sa.sniff('Use `className=` here\n\n# T\n'), 'md');
    assert.equal(sa.sniff('export const A = () => <b>x</b>;\n'), 'jsx');
    assert.equal(sa.sniff('const A = () => <div className="x">hi</div>;\n'), 'jsx');
  });
  it('a TSX generic arrow <T extends X>(...) is not a JSX element', () => {
    const src = `const identity = <T extends unknown>(x: T): T => x;
const pick = <K extends keyof Array<string>, V>(k: K) => k;
const port = 1234;
throw new Error('year is required!');
export const H = () => <h1>Projects</h1>;
`;
    const r = scanText(src, 'jsx');
    assert.deepEqual(r.hits, []);
  });
  it('a regex literal holding a backtick or brace does not hide later markup', () => {
    const src = 'const re = /`/;\nexport const A = () => <h1>Welcome back!</h1>;\n';
    assert.ok(scanText(src, 'jsx').hits.some(h => h.sign === 'greeting-headline' && h.line === 2));
    const br = 'export const A = () => <p>{x.replace(/\\{/g, "")}<b>Welcome back!</b></p>;\nconst q = a / b;\n';
    assert.ok(scanText(br, 'jsx').hits.some(h => h.sign === 'greeting-headline'));
  });
  it('the jsx and markdown fence sniffing stay linear on a large input', () => {
    const big = ('```\n' + 'a'.repeat(60) + '\n').repeat(100000);
    const t0 = Date.now();
    scanText(big.slice(0, 8 * 1024 * 1024), undefined);
    assert.ok(Date.now() - t0 < 5000);
  });
});
