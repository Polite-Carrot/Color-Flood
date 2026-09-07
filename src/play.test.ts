/* play.test.ts — the rules, and the seam between them and the generator.
 *
 * The generator proves a board can be finished in n moves. These check that
 * the thing the player actually operates agrees — that the line the
 * construction laid down really does win when it is played out one move at a
 * time through the same code the buttons call. */

import { describe, it, expect } from 'vitest';
import { bestMove, generate, generateDetailed, solve } from './generator.ts';
import { blobColour, blobOf, canPlay, play, restart, start, undo, won } from './play.ts';
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

describe('the construction still holds where it is meant to', () => {
  it('wins in exactly targetMoves when a layer is one colour', () => {
    /* patchSize 0 is the original construction, and its whole claim is that
       the layer count IS the answer. A layer being one colour is what makes
       the line readable off the board: take the colour of any cell in layer
       2, then layer 3, and so on. */
    for (let i = 0; i < 20; i++) {
      const opts = { width: 9, height: 8, palette: 4, targetMoves: 5, seed: 'line-' + i };
      const { level, layers, layerCount } = generateDetailed(opts);
      const game = start(level);
      const where = JSON.stringify(opts);

      const colourOfLayer = (layer: number): number => {
        for (let r = 0; r < level.height; r++) {
          for (let c = 0; c < level.width; c++) if (layers[r][c] === layer) return level.grid[r][c];
        }
        throw new Error('layer ' + layer + ' is empty');
      };

      for (let layer = 2; layer <= layerCount; layer++) {
        expect(won(game), where + ' won early at layer ' + layer).toBe(false);
        play(game, colourOfLayer(layer));
      }
      expect(won(game), where).toBe(true);
      expect(game.played.length, where).toBe(opts.targetMoves);
      expect(level.par, where).toBe(opts.targetMoves);
    }
  });
});

describe('the puzzles are worth playing', () => {
  /* The failure this catches is the one that got all the way to a deployed
     site: every board solvable, every test green, and not one of them a
     puzzle. One legal move per turn is not a difficulty setting, it is an
     absence of a game, and nothing else here would have said so. */
  it('never ships a board that greedy solves in par', () => {
    for (const setting of SETTINGS) {
      for (let i = 0; i < 8; i++) {
        const { level, greedyMoves } = generateDetailed(optionsFor(setting, 'worth-' + i));
        const where = setting.key + ' seed worth-' + i;
        expect(greedyMoves, where + ' — greedy could not finish at all').not.toBeNull();
        expect(greedyMoves, where + ' — greedy matches par, so there is nothing to think about')
          .toBeGreaterThan(level.par);
      }
    }
  });

  it('puts more than one colour on the blob\'s edge', () => {
    /* The direct measurement of the same thing: how many moves actually do
       anything when it is your turn. One is the broken case. */
    let turns = 0;
    let choices = 0;
    for (const setting of SETTINGS) {
      for (let i = 0; i < 6; i++) {
        const level = generate(optionsFor(setting, 'edge-' + i));
        const game = start(level);
        while (!won(game) && game.played.length < level.moveLimit) {
          const blob = blobOf(game);
          const mine = blobColour(game);
          const touching = new Set<number>();
          for (let r = 0; r < level.height; r++) {
            for (let c = 0; c < level.width; c++) {
              if (!blob[r][c]) continue;
              for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as const) {
                if (nr < 0 || nc < 0 || nr >= level.height || nc >= level.width) continue;
                if (!blob[nr][nc] && game.grid[nr][nc] !== mine) touching.add(game.grid[nr][nc]);
              }
            }
          }
          turns++;
          choices += touching.size;
          /* Play something, anything, to move the board on. */
          const next = [...touching][0];
          if (next === undefined) break;
          play(game, next);
        }
      }
    }
    expect(choices / turns).toBeGreaterThan(2);
  });

  it('agrees with the solver about par', () => {
    for (const setting of SETTINGS) {
      for (let i = 0; i < 4; i++) {
        const level = generate(optionsFor(setting, 'par-' + i));
        expect(solve(level), setting.key + ' seed ' + i).toBe(level.par);
        expect(level.moveLimit, setting.key).toBeGreaterThanOrEqual(level.par);
      }
    }
  });
});

describe('hints', () => {
  /* A hint that is merely plausible is worse than none: it spends one of the
     two the player gets and can talk them off the best line. So the check is
     not "it names a colour that grows the blob" but the real thing — playing
     it must leave a board that needs exactly one move fewer. */
  it('names a move that is genuinely on a best line', () => {
    for (const setting of SETTINGS) {
      for (let i = 0; i < 3; i++) {
        const level = generate(optionsFor(setting, 'hint-' + i));
        const game = start(level);
        const where = setting.key + ' seed hint-' + i;

        /* Ask at the start, and again a few moves in on a line the generator
           never had in mind — which is when a hint is actually wanted. */
        for (let step = 0; step < 3 && !won(game); step++) {
          const before = solve({ ...level, grid: game.grid.map((r) => r.slice()) });
          expect(before, where + ' step ' + step).not.toBeNull();

          const hint = bestMove({ ...level, grid: game.grid.map((r) => r.slice()) });
          expect(hint, where + ' step ' + step).not.toBeNull();
          expect(hint!.moves, where + ' step ' + step).toBe(before);

          play(game, hint!.colour);
          const after = solve({ ...level, grid: game.grid.map((r) => r.slice()) });
          expect(after, where + ' step ' + step + ' — the hint did not advance the board')
            .toBe(before! - 1);
        }
      }
    }
  });

  it('following hints all the way finishes in par', () => {
    const level = generate(optionsFor(SETTINGS[2], 'hint-run'));
    const game = start(level);
    let guard = 0;
    while (!won(game) && guard++ < 40) {
      const hint = bestMove({ ...level, grid: game.grid.map((r) => r.slice()) });
      expect(hint).not.toBeNull();
      play(game, hint!.colour);
    }
    expect(won(game)).toBe(true);
    expect(game.played.length).toBe(level.par);
  });

  it('has nothing to say about a board that is already finished', () => {
    const level = generate(optionsFor(SETTINGS[0], 'hint-done'));
    const flat = { ...level, grid: level.grid.map((row) => row.map(() => 0)) };
    expect(bestMove(flat)).toBeNull();
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
      expect(level.moveLimit, setting.key).toBeGreaterThanOrEqual(level.par);
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
