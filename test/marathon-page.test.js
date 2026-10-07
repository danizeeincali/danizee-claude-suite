/**
 * Tests for src/lib/marathon/page.js — AC 27.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/lib/marathon/page.js';

describe('page — renderPage', () => {
  const html = renderPage({
    runId: '2026-10-07-bbs',
    gate: {
      buildGateMet: false, gateMet: false, failing: ['e2e'], waitingOnHuman: ['deployed'],
      lines: [
        { id: 'e2e', label: 'Green e2e runs in a row', status: 'failing', actual: 3, value: 6, op: 'at_least', owner: 'build' },
        { id: 'deployed', label: 'Deployed to hosting', status: 'waiting_on_human', actual: false, value: true, op: 'is', owner: 'human' },
        { id: 'lh', label: 'Lighthouse mobile', status: 'not_counted', actual: null, value: null, op: 'at_least', owner: 'build' }
      ]
    },
    streams: [{ name: 'intake', state: 'active', next: 'make tests pass' }, { name: 'fetch', state: 'queued', next: 'start' }],
    reviews: [{ id: 'r1', stream: 'intake', round: 1, pass: false, counts: { high: 1, medium: 0, low: 2 }, ts: '2026-10-07T09:00:00Z' }],
    helpers: [{ event: 'spawn', id: 'h1', model: 'sonnet', budget: 100 }, { event: 'done', helper_id: 'h1', tokens: 90 }]
  });

  it('is a full HTML document with a title', () => {
    assert.match(html.slice(0, 40).toLowerCase(), /^<!doctype html>/);
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /2026-10-07-bbs/);
  });

  it('lists every gate line with its status and every stream', () => {
    assert.match(html, /Green e2e runs in a row/);
    assert.match(html, /Deployed to hosting/);
    assert.match(html, /Lighthouse mobile/);
    assert.match(html, /failing/i);
    assert.match(html, /waiting/i);
    assert.match(html, /not counted|not_counted/i);
    assert.match(html, /intake/);
    assert.match(html, /fetch/);
    assert.match(html, /r1/);
    assert.match(html, /sonnet/);
  });

  it('has light and dark theming', () => {
    assert.match(html, /prefers-color-scheme:\s*dark/);
    assert.match(html, /--bg/);
  });

  it('escapes HTML in user-supplied text', () => {
    const h = renderPage({ runId: 'x', gate: { lines: [{ id: 'a', label: '<script>alert(1)</script>', status: 'failing', owner: 'build' }], failing: ['a'], waitingOnHuman: [], buildGateMet: false, gateMet: false }, streams: [], reviews: [], helpers: [] });
    assert.ok(!h.includes('<script>alert(1)</script>'));
    assert.match(h, /&lt;script&gt;/);
  });
});
