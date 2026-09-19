/* haptics.test.ts — the one decision in there worth holding still.
 *
 * Everything else is a bridge call that does nothing off a phone; asserting
 * it would be the mock agreeing with itself. How hard a move feels is a real
 * choice, and a wrong threshold would make every move feel the same. */

import { describe, it, expect } from 'vitest';
import { Haptics, SOLID, styleFor } from './haptics.ts';

describe('how hard a move feels', () => {
  it('is heavier for a move that takes real ground', () => {
    expect(styleFor(0)).toBe('LIGHT');
    expect(styleFor(SOLID - 0.001)).toBe('LIGHT');
    expect(styleFor(SOLID)).toBe('MEDIUM');
    expect(styleFor(1)).toBe('MEDIUM');
  });

  it('treats a single cell of a big board as light', () => {
    /* One cell of a 14x14 is 0.005 of it. A move that takes one cell should
       not feel like a move that takes a third of the board. */
    expect(styleFor(1 / (14 * 14))).toBe('LIGHT');
  });
});

describe('off a phone', () => {
  it('does nothing and throws nothing', () => {
    /* No window in Node, which is the same position the web build is in.
       Every call site is one line with no guard around it. */
    expect(() => { Haptics.flood(0.5); Haptics.nope(); Haptics.win(); }).not.toThrow();
  });
});
