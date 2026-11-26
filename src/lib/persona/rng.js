/** A small seeded random source: the same seed always draws the same numbers (so a round can be made again). */
import { createHash } from "node:crypto";

export function seedFrom(text) {
  return createHash("sha256").update(String(text)).digest().readUInt32LE(0);
}

/** `next()` in [0,1) (mulberry32). */
export function rngFor(seed) {
  let a = seedFrom(seed) >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng.next() * list.length)];
}

/** A shuffled copy (Fisher-Yates). */
export function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
