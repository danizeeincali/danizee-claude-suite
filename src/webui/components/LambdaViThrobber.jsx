import React, { useState, useEffect, useCallback } from 'react';
import './LambdaViThrobber.css';

/**
 * Character pairs for each position in the λVI throbber.
 * Each position alternates between two characters in a wave pattern.
 *   Position 0: λ ↔ A
 *   Position 1: V ↔ v
 *   Position 2: I ↔ !
 */
const CHAR_PAIRS = [
  ['λ', 'A'],
  ['V', 'v'],
  ['I', '!'],
];

// Total frames in one full cycle: flip each char forward (3), then back (3)
const TOTAL_FRAMES = CHAR_PAIRS.length * 2;

/**
 * Given a frame index (0..5), return the three characters to display.
 *
 * Frames 0-2 flip each position from primary → alternate (left to right).
 * Frames 3-5 flip each position from alternate → primary (left to right).
 *
 *   Frame 0: λ V I  (start)
 *   Frame 1: A V I  (pos 0 flips)
 *   Frame 2: A v I  (pos 1 flips)
 *   Frame 3: A v !  (pos 2 flips)
 *   Frame 4: λ v !  (pos 0 flips back)
 *   Frame 5: λ V !  (pos 1 flips back)
 *   → next cycle starts at frame 0 again (λ V I)
 */
function getCharsForFrame(frame) {
  return CHAR_PAIRS.map(([primary, alternate], idx) => {
    // During the forward sweep (frames 0-2), position idx flips at frame idx+1
    // During the backward sweep (frames 3-5), position idx flips back at frame idx+1+3
    const flipForward = frame >= idx + 1;
    const flipBack = frame >= idx + 1 + CHAR_PAIRS.length;
    const isAlternate = flipForward && !flipBack;
    return {
      char: isAlternate ? alternate : primary,
      flipping: frame === idx + 1 || frame === idx + 1 + CHAR_PAIRS.length,
    };
  });
}

export default function LambdaViThrobber({
  size = 'medium',
  speed = 180,
  className = '',
  label,
  inline = false,
}) {
  const [frame, setFrame] = useState(0);

  const advance = useCallback(() => {
    setFrame((prev) => (prev + 1) % TOTAL_FRAMES);
  }, []);

  useEffect(() => {
    const id = setInterval(advance, speed);
    return () => clearInterval(id);
  }, [advance, speed]);

  const chars = getCharsForFrame(frame);
  const Tag = inline ? 'span' : 'div';

  return (
    <Tag
      className={`lvi-throbber lvi-throbber--${size} ${className}`}
      role="status"
      aria-label={label || 'Avi is working'}
    >
      <span className="lvi-throbber__chars" aria-hidden="true">
        {chars.map(({ char, flipping }, i) => (
          <span
            key={i}
            className={`lvi-throbber__char${flipping ? ' lvi-throbber__char--flip' : ''}`}
          >
            {char}
          </span>
        ))}
      </span>
      {label && <span className="lvi-throbber__label">{label}</span>}
      <span className="lvi-throbber__sr-only">{label || 'Avi is working'}</span>
    </Tag>
  );
}

// Re-export helpers for testing
LambdaViThrobber.CHAR_PAIRS = CHAR_PAIRS;
LambdaViThrobber.TOTAL_FRAMES = TOTAL_FRAMES;
LambdaViThrobber.getCharsForFrame = getCharsForFrame;
