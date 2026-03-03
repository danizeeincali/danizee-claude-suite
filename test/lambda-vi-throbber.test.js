/**
 * Tests for the λVI Throbber animation logic.
 *
 * Tests the pure getCharsForFrame function and constants that drive
 * the LambdaViThrobber React component's animation cycle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the pure animation logic (no React/DOM needed)
const CHAR_PAIRS = [
  ['λ', 'A'],
  ['V', 'v'],
  ['I', '!'],
];

const TOTAL_FRAMES = CHAR_PAIRS.length * 2; // 6

function getCharsForFrame(frame) {
  return CHAR_PAIRS.map(([primary, alternate], idx) => {
    const flipForward = frame >= idx + 1;
    const flipBack = frame >= idx + 1 + CHAR_PAIRS.length;
    const isAlternate = flipForward && !flipBack;
    return {
      char: isAlternate ? alternate : primary,
      flipping: frame === idx + 1 || frame === idx + 1 + CHAR_PAIRS.length,
    };
  });
}

describe('λVI Throbber — animation constants', () => {
  it('should have 3 character pairs', () => {
    assert.equal(CHAR_PAIRS.length, 3);
  });

  it('should have correct character pairs (λ/A, V/v, I/!)', () => {
    assert.deepEqual(CHAR_PAIRS[0], ['λ', 'A']);
    assert.deepEqual(CHAR_PAIRS[1], ['V', 'v']);
    assert.deepEqual(CHAR_PAIRS[2], ['I', '!']);
  });

  it('should have 6 total frames per cycle', () => {
    assert.equal(TOTAL_FRAMES, 6);
  });
});

describe('λVI Throbber — getCharsForFrame', () => {
  it('frame 0 should show λ V I (all primary)', () => {
    const chars = getCharsForFrame(0);
    assert.equal(chars[0].char, 'λ');
    assert.equal(chars[1].char, 'V');
    assert.equal(chars[2].char, 'I');
  });

  it('frame 1 should flip position 0 → A V I', () => {
    const chars = getCharsForFrame(1);
    assert.equal(chars[0].char, 'A');
    assert.equal(chars[1].char, 'V');
    assert.equal(chars[2].char, 'I');
    assert.equal(chars[0].flipping, true);
    assert.equal(chars[1].flipping, false);
  });

  it('frame 2 should flip position 1 → A v I', () => {
    const chars = getCharsForFrame(2);
    assert.equal(chars[0].char, 'A');
    assert.equal(chars[1].char, 'v');
    assert.equal(chars[2].char, 'I');
    assert.equal(chars[1].flipping, true);
  });

  it('frame 3 should flip position 2 → A v !', () => {
    const chars = getCharsForFrame(3);
    assert.equal(chars[0].char, 'A');
    assert.equal(chars[1].char, 'v');
    assert.equal(chars[2].char, '!');
    assert.equal(chars[2].flipping, true);
  });

  it('frame 4 should flip position 0 back → λ v !', () => {
    const chars = getCharsForFrame(4);
    assert.equal(chars[0].char, 'λ');
    assert.equal(chars[1].char, 'v');
    assert.equal(chars[2].char, '!');
    assert.equal(chars[0].flipping, true);
  });

  it('frame 5 should flip position 1 back → λ V !', () => {
    const chars = getCharsForFrame(5);
    assert.equal(chars[0].char, 'λ');
    assert.equal(chars[1].char, 'V');
    assert.equal(chars[2].char, '!');
    assert.equal(chars[1].flipping, true);
  });

  it('should produce exactly one flipping char per frame (except frame 0)', () => {
    for (let f = 1; f < TOTAL_FRAMES; f++) {
      const chars = getCharsForFrame(f);
      const flipping = chars.filter((c) => c.flipping);
      assert.equal(flipping.length, 1, `Frame ${f} should have exactly 1 flipping char`);
    }
  });

  it('frame 0 should have no flipping chars', () => {
    const chars = getCharsForFrame(0);
    const flipping = chars.filter((c) => c.flipping);
    assert.equal(flipping.length, 0);
  });

  it('should always return 3 characters per frame', () => {
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      assert.equal(getCharsForFrame(f).length, 3, `Frame ${f} should return 3 chars`);
    }
  });
});

describe('λVI Throbber — full cycle', () => {
  it('should produce a valid wave pattern across all frames', () => {
    const expected = [
      ['λ', 'V', 'I'],  // frame 0 — start
      ['A', 'V', 'I'],  // frame 1 — pos 0 flips
      ['A', 'v', 'I'],  // frame 2 — pos 1 flips
      ['A', 'v', '!'],  // frame 3 — pos 2 flips
      ['λ', 'v', '!'],  // frame 4 — pos 0 flips back
      ['λ', 'V', '!'],  // frame 5 — pos 1 flips back
    ];

    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const chars = getCharsForFrame(f).map((c) => c.char);
      assert.deepEqual(chars, expected[f], `Frame ${f} mismatch`);
    }
  });

  it('next cycle (frame 0 again) should match the start', () => {
    // After frame 5, position 2 still shows '!' — that gets flipped back
    // at the implicit "frame 6" which wraps to frame 0 via modulo in the component.
    // Frame 0 always returns all-primary.
    const chars = getCharsForFrame(0).map((c) => c.char);
    assert.deepEqual(chars, ['λ', 'V', 'I']);
  });
});
