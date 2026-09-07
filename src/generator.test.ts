/* generator.test.ts — the three things that would quietly ruin the game.
 *
 * A daily puzzle that deals differently on two phones, a board whose layers
 * do not hold together, and a move limit that is not the real par. None of
 * them show up as a crash: the game plays perfectly happily on a board whose
 * par is one more than it says, right up until somebody cannot finish it. */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  generate,
  generateDetailed,
  solve,
  assertLayerInvariants,
  bandRadius,
  rng,
  type GenOptions,
} from './generator.ts';

const base: GenOptions = {
  width: 9, height: 7, palette: 4, targetMoves: 3, seed: '2026-09-07',
};

describe('determinism', () => {
  it('deals the same board twice for one seed', () => {
    const a = generate(base);
    const b = generate(base);
    expect(b).toEqual(a);
  });

  it('deals the same board for a seed however many others came first', () => {
    const first = generate(base);
    generate({ ...base, seed: 'somebody-else' });
    generate({ ...base, seed: '2026-01-01' });
    expect(generate(base)).toEqual(first);
  });

  it('deals different boards for different seeds', () => {
    /* Two boards CAN coincide by luck, so this asks a hundred seeds for a
       hundred distinct boards rather than asking two seeds to differ. */
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(JSON.stringify(generate({ ...base, seed: 'seed-' + i }).grid));
    }
    expect(seen.size).toBe(100);
  });

  it('draws no randomness of its own', () => {
    /* Math.random anywhere in the chain would break the daily puzzle without
       breaking anything a test would otherwise notice. */
    const real = Math.random;
    Math.random = () => { throw new Error('generator reached for Math.random'); };
    try {
      expect(() => generate({ ...base, strandChance: 0.5 })).not.toThrow();
    } finally {
      Math.random = real;
    }
  });
});

describe('the module stays portable', () => {
  /* The web build and a phone build both take generator.ts as it is, so it
     must not acquire an import — of anything, including a type — or reach for
     a global that only one of them has. Both are the kind of change that is
     made in a moment, works perfectly in whichever build it was written in,
     and is only noticed in the other one much later. */
  const source = readFileSync(new URL('./generator.ts', import.meta.url), 'utf8');
  /* The comments in that file discuss Math.random and the DOM at some length,
     and a check that reads them finds exactly what it was written to forbid.
     So the prose comes out first. Stripping comments with a regex is wrong in
     general — a string holding "/*" defeats it — but there is no such string
     in the file, and the alternative is a parser. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('imports nothing', () => {
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it('never reaches for Math.random', () => {
    expect(code).not.toContain('Math.random');
  });

  it('touches no host globals', () => {
    for (const global of ['document', 'window', 'process', 'localStorage', 'fetch']) {
      expect(code, global).not.toMatch(new RegExp('\\b' + global + '\\b'));
    }
  });
});

describe('layer invariants', () => {
  it('holds over 500 boards', () => {
    /* The shapes are drawn from a seed too, so a failure here is a board
       somebody can deal again rather than one that has gone for good. */
    const rand = rng('invariant-sweep');
    for (let i = 0; i < 500; i++) {
      const width = 4 + Math.floor(rand() * 11);   /* 4..14 */
      const height = 4 + Math.floor(rand() * 9);   /* 4..12 */
      /* Every board is asked for a legal number of moves — up to the L-band
         ceiling, capped at 10 so the sweep stays quick. */
      const most = Math.min(bandRadius(width, height, [[height - 1, 0]]), 10);
      const targetMoves = 1 + Math.floor(rand() * most);
      const palette = 2 + Math.floor(rand() * 7);  /* 2..8 */
      const opts: GenOptions = { width, height, palette, targetMoves, seed: 'sweep-' + i };

      const { level, layers, layerCount } = generateDetailed(opts);
      const where = JSON.stringify(opts);

      expect(layerCount, where).toBe(targetMoves + 1);
      expect(() => assertLayerInvariants(width, height, layers, layerCount), where).not.toThrow();

      /* The origin is layer 1 and every layer is used. */
      expect(layers[level.origins[0][0]][level.origins[0][1]], where).toBe(1);
      const counts = new Array(layerCount + 1).fill(0);
      for (const row of layers) for (const n of row) counts[n]++;
      for (let n = 1; n <= layerCount; n++) expect(counts[n], where + ' layer ' + n).toBeGreaterThan(0);

      /* And the board is the shape that was asked for, in the colours that
         were asked for. */
      expect(level.grid.length, where).toBe(height);
      for (const row of level.grid) {
        expect(row.length, where).toBe(width);
        for (const c of row) {
          expect(c, where).toBeGreaterThanOrEqual(0);
          expect(c, where).toBeLessThan(palette);
        }
      }
    }
  });

  it('catches a layer that arrived in two pieces', () => {
    expect(() => assertLayerInvariants(3, 1, [[1, 2, 1]], 2)).toThrow(/pieces/);
  });

  it('catches a cell touching a layer two away', () => {
    /* Layer 1 sits under layer 3, so one move would take both. Every layer
       here is present and in one piece — it is only the adjacency that is
       wrong, which is the half that would otherwise go unnoticed. */
    expect(() => assertLayerInvariants(2, 2, [[3, 3], [1, 2]], 3)).toThrow(/jump a layer/);
  });

  it('catches a layer with no cells at all', () => {
    expect(() => assertLayerInvariants(2, 1, [[1, 2]], 3)).toThrow(/layer 3 is empty/);
  });
});

describe('solve agrees with the construction', () => {
  it('finds exactly targetMoves with no stranding', () => {
    const rand = rng('par-sweep');
    for (let i = 0; i < 40; i++) {
      const width = 4 + Math.floor(rand() * 6);   /* 4..9 */
      const height = 4 + Math.floor(rand() * 5);  /* 4..8 */
      const targetMoves = 1 + Math.floor(rand() * Math.min(bandRadius(width, height, [[height - 1, 0]]), 5));
      const palette = 3 + Math.floor(rand() * 4);
      const opts: GenOptions = { width, height, palette, targetMoves, seed: 'par-' + i };
      const level = generate(opts);
      const where = JSON.stringify(opts);

      expect(level.moveLimit, where).toBe(targetMoves);
      expect(solve(level), where).toBe(targetMoves);
    }
  });

  it('reports 0 for a board that is already one colour', () => {
    const level = generate({ ...base, targetMoves: 1 });
    const flat = { ...level, grid: level.grid.map((row) => row.map(() => 0)) };
    expect(solve(flat)).toBe(0);
  });

  it('gives up rather than running for ever', () => {
    expect(solve(generate({ ...base, targetMoves: 5 }), 1)).toBeNull();
  });
});

describe('stranding', () => {
  it('sets the move limit from the search, inside the band', () => {
    for (let i = 0; i < 25; i++) {
      const opts: GenOptions = {
        width: 10, height: 8, palette: 5, targetMoves: 5,
        seed: 'strand-' + i, strandChance: 0.8,
      };
      const level = generate(opts);
      const where = JSON.stringify(opts);
      expect(level.moveLimit, where).toBe(solve(level));
      expect(level.moveLimit, where).toBeGreaterThanOrEqual(opts.targetMoves);
      expect(level.moveLimit, where).toBeLessThanOrEqual(opts.targetMoves + 2);
    }
  });

  it('actually lengthens some boards', () => {
    /* If stranding never bit, the test above would pass on boards that are
       simply the unstranded ones — so at least some of them must cost more
       than the layer count. */
    let longer = 0;
    for (let i = 0; i < 25; i++) {
      const level = generate({
        width: 10, height: 8, palette: 5, targetMoves: 5,
        seed: 'strand-' + i, strandChance: 0.8,
      });
      if (level.moveLimit > 5) longer++;
    }
    expect(longer).toBeGreaterThan(0);
  });
});

describe('bad options', () => {
  it('refuses more layers than the board can hold', () => {
    /* 4×4 holds four L-bands, so three moves is the most it can be asked for
       however many cells it has. */
    expect(() => generate({ ...base, width: 4, height: 4, targetMoves: 4 }))
      .toThrow(/holds at most 4/);
    expect(() => generate({ ...base, width: 4, height: 4, targetMoves: 3 })).not.toThrow();
  });

  it('counts the ceiling from where the blob starts', () => {
    /* From a corner a 9×9 board is eight bands deep; from the middle it is
       only four, and asking for eight is a different mistake with the same
       cause. */
    expect(bandRadius(9, 9, [[8, 0]])).toBe(8);
    expect(bandRadius(9, 9, [[4, 4]])).toBe(4);
    expect(() => generate({ ...base, width: 9, height: 9, targetMoves: 8, origins: [[4, 4]] }))
      .toThrow(/holds at most 5/);
  });

  it('refuses a palette too small for touching layers to differ', () => {
    expect(() => generate({ ...base, palette: 1 })).toThrow(/palette/);
  });

  it('refuses a board with no seed', () => {
    expect(() => generate({ ...base, seed: '' })).toThrow(/seed/);
  });
});
