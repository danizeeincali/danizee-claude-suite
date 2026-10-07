/**
 * Tests for src/lib/marathon/context.js
 * AC 20–21. Fixture mirrors a real Claude Code transcript record shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureTranscript, contextPct, decide } from '../src/lib/marathon/context.js';
import { DEFAULT_CONFIG } from '../src/lib/marathon/config.js';

const rec = (type, usage) => JSON.stringify(
  usage ? { type, message: { role: 'assistant', usage } } : { type, message: { role: 'user', content: 'hi' } }
);

describe('context — measureTranscript', () => {
  it('AC20: sums input + cache_creation + cache_read of the LAST assistant usage', () => {
    const text = [
      rec('user'),
      rec('assistant', { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 7 }),
      '{"type":"attachment"}',
      'this line is not json',
      rec('assistant', { input_tokens: 5, cache_creation_input_tokens: 15, cache_read_input_tokens: 25, output_tokens: 9 })
    ].join('\n');
    const m = measureTranscript(text);
    assert.equal(m.tokens, 45);
    assert.equal(m.input, 5);
    assert.equal(m.cache_creation, 15);
    assert.equal(m.cache_read, 25);
    assert.equal(m.output, 9);
  });

  it('returns null when no assistant usage exists', () => {
    assert.equal(measureTranscript([rec('user'), '{}', ''].join('\n')), null);
    assert.equal(measureTranscript(''), null);
  });

  it('tolerates missing cache fields', () => {
    const m = measureTranscript(rec('assistant', { input_tokens: 100 }));
    assert.equal(m.tokens, 100);
  });
});

describe('context — pct and decision', () => {
  it('contextPct', () => {
    assert.equal(contextPct(500_000, 1_000_000), 50);
    assert.equal(contextPct(0, 1_000_000), 0);
  });

  it('AC21: decide by thresholds and stream finish', () => {
    const bc = DEFAULT_CONFIG.bc;
    assert.equal(decide(40, bc), 'none');
    assert.equal(decide(49.9, bc), 'none');
    assert.equal(decide(50, bc), 'compact');
    assert.equal(decide(79.9, bc), 'compact');
    assert.equal(decide(80, bc), 'clear');
    assert.equal(decide(95, bc), 'clear');
    assert.equal(decide(30, bc, { streamFinished: true }), 'clear');
  });
});
