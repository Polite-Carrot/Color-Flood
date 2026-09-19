/* share.test.ts — the text, which is the half with a right answer. */

import { describe, it, expect } from 'vitest';
import { shareText } from './share.ts';

const base = { day: '2026-09-19', game: 'Merge', setting: 'Easy', par: 6, moves: [1, 0, 2, 3, 4, 5], hints: 0 };

describe('the shared daily', () => {
  it('is three lines: what, how, and the moves', () => {
    const lines = shareText(base).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Color Flood · 2026-09-19');
    expect(lines[1]).toBe('Merge · Easy · 6 moves · par!');
    expect(lines[2]).toBe('🟦🟥🟨🟩🟪🟧');
  });

  it('points nowhere', () => {
    /* No URL, no host, nothing that looks like one. The GitHub Pages build is
       where the game is developed, not where anybody should be sent. */
    expect(shareText(base)).not.toMatch(/https?:|github|\.io|\.com/i);
  });

  it('says par only when it was par', () => {
    expect(shareText({ ...base, moves: [1, 0, 2, 3, 4, 5, 1] })).toContain('7 moves · par 6');
    expect(shareText({ ...base, moves: [1, 0, 2, 3, 4, 5, 1] })).not.toContain('par!');
  });

  it('owns up to hints, and counts them properly', () => {
    expect(shareText({ ...base, hints: 1 })).toContain('· 1 hint');
    expect(shareText({ ...base, hints: 2 })).toContain('· 2 hints');
    expect(shareText(base)).not.toContain('hint');
  });

  it('gives away nothing about the board', () => {
    /* One square per move and nothing else. A row, a size, a cell — anything
       that would let somebody reconstruct the puzzle — must not be in here,
       because the whole point is that the person reading it plays it fresh. */
    const text = shareText({ ...base, moves: [0, 0, 1] });
    expect(text.split('\n')[2]).toBe('🟥🟥🟦');
    expect(text).not.toMatch(/\d+x\d+/);
  });

  it('has a square for every colour a daily can deal', () => {
    /* A daily never reaches past the sixth colour, so these six are the ones
       that have to be distinct — and they are the six Unicode gives us. */
    const six = shareText({ ...base, moves: [0, 1, 2, 3, 4, 5] }).split('\n')[2];
    expect(new Set([...six]).size).toBe(6);
  });
});
