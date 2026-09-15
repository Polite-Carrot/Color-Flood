/* campaign.test.ts — two hundred levels, and the five at the front of each.
 *
 * The taught levels are the ones a person meets first, so a broken one is the
 * worst broken thing in the game: impossible, or trivially given away, at the
 * exact moment somebody is deciding whether to keep playing. */

import { describe, it, expect } from 'vitest';
import { CAMPAIGN_LENGTH, RAMP_END, TAUGHT, campaignLevel, campaignSeed, campaignSetting } from './campaign.ts';
import { greedy, solve } from './generator.ts';
import { play, start, won } from './play.ts';
import { MODES } from './levels.ts';

describe('the taught levels', () => {
  /* What each drawn board is FOR. If an edit to a grid changes its par, this
     is what says so — the boards compute their own par rather than declaring
     one, so without this a slip would quietly reshape the lesson instead of
     failing. */
  const expected = {
    flood: [
      { name: 'Your corner', par: 1, limit: 3 },
      { name: 'One band at a time', par: 2, limit: 4 },
      { name: 'Only what touches', par: 3, limit: 5 },
      { name: 'The big one is not always right', par: 3, limit: 4 },
      { name: 'Par exactly', par: 4, limit: 4 },
    ],
    merge: [
      { name: 'Two corners', par: 1, limit: 3 },
      { name: 'Both at once', par: 2, limit: 4 },
      { name: 'They join when they touch', par: 2, limit: 4 },
      { name: 'Suits one, not the other', par: 3, limit: 4 },
      { name: 'Par exactly', par: 4, limit: 4 },
    ],
  };

  for (const mode of MODES) {
    it('are the boards ' + mode + ' means them to be', () => {
      for (let n = 1; n <= TAUGHT; n++) {
        const want = expected[mode][n - 1];
        const { level, name, brief } = campaignLevel(mode, n);
        const where = mode + ' level ' + n;

        expect(name, where).toBe(want.name);
        expect(level.par, where + ' par').toBe(want.par);
        expect(level.moveLimit, where + ' limit').toBe(want.limit);
        expect(solve(level), where + ' — the solver disagrees with the level').toBe(want.par);
        /* Every taught level says something. The seeded ones do not. */
        expect(brief.length, where + ' has no teaching line').toBeGreaterThan(20);
        expect(level.origins.length, where).toBe(mode === 'merge' ? 2 : 1);
      }
    });

    it('offer only colours that are on the board, in ' + mode, () => {
      /* The picker draws one swatch per colour in the palette, so a palette
         wider than the board means a swatch that does nothing — presented as
         a choice, on the levels whose job is teaching what a choice does. */
      for (let n = 1; n <= TAUGHT; n++) {
        const { level } = campaignLevel(mode, n);
        const used = new Set(level.grid.flat());
        for (let c = 0; c < level.palette; c++) {
          expect(used.has(c), mode + ' level ' + n + ' offers colour ' + c + ' but never shows it')
            .toBe(true);
        }
      }
    });
  }

  it('teaches that the biggest patch can be the wrong one', () => {
    /* Flood 4 claims taking the biggest patch costs a move. If greedy ever
       matches par here the board stops demonstrating its own lesson, and
       nothing else in the game would notice. */
    const { level } = campaignLevel('flood', 4);
    expect(level.par).toBe(3);
    expect(greedy(level), 'greedy no longer loses on this board').toBe(4);
  });

  it('can be finished by playing them', () => {
    /* Not just solvable in the abstract: winnable through the same code the
       buttons call, inside the limit the level gives. */
    for (const mode of MODES) {
      for (let n = 1; n <= TAUGHT; n++) {
        const { level } = campaignLevel(mode, n);
        const game = start(level);
        let guard = 0;
        while (!won(game) && guard++ < 20) {
          const from = { ...level, grid: game.grid.map((r) => r.slice()) };
          const before = solve(from);
          expect(before, mode + ' level ' + n).not.toBeNull();
          /* Walk an optimal line by trying colours and keeping the one that
             shortens it. */
          let played = false;
          for (let c = 0; c < level.palette && !played; c++) {
            const trial = start(level);
            trial.grid = game.grid.map((r) => r.slice());
            if (!play(trial, c).length && !won(trial)) continue;
            const after = solve({ ...level, grid: trial.grid.map((r) => r.slice()) });
            if (after === before! - 1) { play(game, c); played = true; }
          }
          expect(played, mode + ' level ' + n + ' — no move shortens the board').toBe(true);
        }
        expect(won(game), mode + ' level ' + n).toBe(true);
        expect(game.played.length, mode + ' level ' + n).toBeLessThanOrEqual(level.moveLimit);
      }
    }
  });
});

describe('the campaigns', () => {
  it('deal every level of the first two hundred, and a stride through the rest', () => {
    /* A level that cannot be generated is a wall a player hits with no way
       past and no message worth reading, so this is the check that matters
       for the seeded half.
       
       It used to deal all of both campaigns. At a hundred levels each that
       was six seconds, worth paying on every push; at a thousand it is the
       better part of a minute, most of it Merge, whose par search carries two
       fronts. So: every level up to where the ramp tops out — that is where
       the settings are all different from each other and where a mistake in
       the ramp would show — and then a stride of 7 through the rest.
       
       7 because the shapes above RAMP_END repeat on 60 and the slack on 10,
       and 7 is coprime with both: the stride walks every phase of both cycles
       rather than sampling the same corner of them a hundred times. */
    for (const mode of MODES) {
      for (let n = 1; n <= CAMPAIGN_LENGTH; n++) {
        if (n > RAMP_END && n % 7 !== 0) continue;
        const where = mode + ' level ' + n;
        let entry;
        expect(() => { entry = campaignLevel(mode, n); }, where).not.toThrow();
        expect(entry!.level.par, where).toBeGreaterThan(0);
        expect(entry!.level.moveLimit, where).toBeGreaterThanOrEqual(entry!.level.par);
        expect(entry!.level.origins.length, where).toBe(mode === 'merge' ? 2 : 1);
      }
    }
  }, 120_000);

  it('deal the same board for a level every time', () => {
    for (const mode of MODES) {
      for (const n of [7, 23, 61, 100, 419, 640, CAMPAIGN_LENGTH]) {
        expect(campaignLevel(mode, n).level, mode + ' level ' + n)
          .toEqual(campaignLevel(mode, n).level);
      }
    }
  });

  it('give a different board to every level', () => {
    const seen = new Set<string>();
    for (const mode of MODES) {
      for (let n = TAUGHT + 1; n <= CAMPAIGN_LENGTH; n++) seen.add(campaignSeed(mode, n));
    }
    expect(seen.size).toBe(2 * (CAMPAIGN_LENGTH - TAUGHT));
  });

  it('ramps upwards and runs out of slack', () => {
    for (const mode of MODES) {
      const first = campaignSetting(mode, TAUGHT + 1);
      /* The top of the ramp, not the end of the campaign: past RAMP_END the
         settings cycle, so the last level is wherever the wave happens to
         have got to rather than the hardest board in the game. */
      const last = campaignSetting(mode, RAMP_END - 1);
      expect(last.width, mode).toBeGreaterThan(first.width);
      expect(last.palette, mode).toBeGreaterThanOrEqual(first.palette);
      expect(last.depth, mode).toBeGreaterThan(first.depth);
      expect(first.slack, mode).toBeGreaterThan(0);
      expect(last.slack, mode).toBe(0);
      /* Never wider than the mode can deal in reasonable time. */
      expect(last.width, mode).toBeLessThanOrEqual(mode === 'merge' ? 11 : 16);
    }
  });

  it('refuses a level that is not in the campaign', () => {
    expect(() => campaignLevel('flood', 0)).toThrow(/no level/);
    expect(() => campaignLevel('flood', CAMPAIGN_LENGTH + 1)).toThrow(/no level/);
  });
});
