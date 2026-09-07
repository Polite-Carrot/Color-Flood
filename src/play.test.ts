/* play.test.ts — the rules, and the seam between them and the generator.
 *
 * The generator proves a board can be finished in n moves. These check that
 * the thing the player actually operates agrees — that the line the
 * construction laid down really does win when it is played out one move at a
 * time through the same code the buttons call. */

import { describe, it, expect } from 'vitest';
import { generate, generateDetailed, solve } from './generator.ts';
import { blobColour, blobOf, canPlay, movesLeft, play, restart, start, undo, won } from './play.ts';
import { SETTINGS, dailySeed, dailySetting, dayKey, optionsFor } from './levels.ts';

describe('the blob', () => {
  it('starts as the run of cells touching the origin', () => {
    const game = start(generate({ width: 6, height: 6, palette: 3, targetMoves: 3, seed: 'blob' }));
    const blob = blobOf(game);
    const colour = blobColour(game);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) if (blob[r][c]) expect(game.grid[r][c]).toBe(colour);
    }
    expect(blob[game.level.origin[0]][game.level.origin[1]]).toBe(true);
  });

  it('will not replay the colour it already is', () => {
    const game = start(generate({ width: 6, height: 6, palette: 3, targetMoves: 3, seed: 'blob' }));
    expect(canPlay(game, blobColour(game))).toBe(false);
    expect(play(game, blobColour(game))).toEqual([]);
    expect(game.played).toHaveLength(0);
  });
});

describe('playing the line the board was built from', () => {
  it('wins in exactly the move limit, on every setting', () => {
    for (const setting of SETTINGS) {
      /* Islands break the one-band-per-move line, so this walks the layers
         only on the settings that have none — the stranded ones are covered
         by the solver test below. */
      if (setting.strandChance > 0) continue;
      for (let i = 0; i < 12; i++) {
        const opts = optionsFor(setting, 'line-' + i);
        const { level, colours, layerCount } = generateDetailed(opts);
        const game = start(level);
        const where = setting.key + ' seed line-' + i;

        for (let layer = 2; layer <= layerCount; layer++) {
          expect(won(game), where + ' won early at layer ' + layer).toBe(false);
          play(game, colours[layer]);
        }
        expect(won(game), where).toBe(true);
        expect(game.played.length, where).toBe(level.moveLimit);
        expect(movesLeft(game), where).toBe(0);
      }
    }
  });

  it('agrees with the solver on stranded boards too', () => {
    for (const setting of SETTINGS) {
      if (setting.strandChance === 0) continue;
      for (let i = 0; i < 4; i++) {
        const level = generate(optionsFor(setting, 'strand-line-' + i));
        expect(solve(level), setting.key + ' seed ' + i).toBe(level.moveLimit);
      }
    }
  });
});

describe('undo and restart', () => {
  it('puts the board back exactly', () => {
    const level = generate({ width: 8, height: 8, palette: 4, targetMoves: 5, seed: 'undo' });
    const game = start(level);
    const before = JSON.stringify(game.grid);

    play(game, (blobColour(game) + 1) % level.palette);
    play(game, (blobColour(game) + 2) % level.palette);
    expect(game.played).toHaveLength(2);

    undo(game);
    expect(game.played).toHaveLength(1);
    undo(game);
    expect(game.played).toHaveLength(0);
    expect(JSON.stringify(game.grid)).toBe(before);

    /* Undo on an untouched board is a no-op rather than an error. */
    expect(undo(game)).toBe(false);
  });

  it('never writes back into the level it was dealt', () => {
    /* The level is what restart goes back to, so a move that reached into it
       would make the board unrecoverable — and the bug would only show on the
       second attempt at a puzzle. */
    const level = generate({ width: 7, height: 7, palette: 4, targetMoves: 4, seed: 'sacred' });
    const pristine = JSON.stringify(level.grid);
    const game = start(level);
    for (let i = 0; i < 4; i++) play(game, (blobColour(game) + 1) % level.palette);
    expect(JSON.stringify(level.grid)).toBe(pristine);
    restart(game);
    expect(JSON.stringify(game.grid)).toBe(pristine);
  });
});

describe('settings and dailies', () => {
  it('every setting deals a board', () => {
    /* A setting asking for more moves than its board can hold throws, and it
       would throw in the player's face rather than here. */
    for (const setting of SETTINGS) {
      const level = generate(optionsFor(setting, 'settings-check'));
      expect(level.width, setting.key).toBe(setting.width);
      expect(level.moveLimit, setting.key).toBeGreaterThanOrEqual(setting.moves);
    }
  });

  it('deals the same daily to everyone, and a different one each day', () => {
    const seeds = new Set<string>();
    const day = new Date(2026, 8, 7);
    for (let i = 0; i < 28; i++) {
      const date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i);
      seeds.add(dailySeed(date));
      const a = generate(optionsFor(dailySetting(date), dailySeed(date)));
      const b = generate(optionsFor(dailySetting(date), dailySeed(date)));
      expect(b, dayKey(date)).toEqual(a);
    }
    expect(seeds.size).toBe(28);
  });

  it('reads the day off the wall clock, not off an instant', () => {
    /* Late on the 7th and early on the 8th are different puzzles even though
       they are hours apart; the same wall date in two zones is one puzzle. */
    expect(dayKey(new Date(2026, 8, 7, 23, 59))).toBe('2026-09-07');
    expect(dayKey(new Date(2026, 8, 8, 0, 1))).toBe('2026-09-08');
  });
});
