/* daily.test.ts — the calendar, and the streak worked out from it.
 *
 * Streaks are the kind of thing that looks right in every screenshot and is
 * wrong at a boundary nobody thought to try: the day before the first daily,
 * the day the clock crosses midnight, the gap of exactly one day. */

import { describe, it, expect } from 'vitest';
import {
  FIRST_DAILY, MODES, bestStreakOf, dailySeed, dailySetting, dayKey, firstDailyDate,
  isPlayableDay, streakOf,
} from './levels.ts';

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const keys = (...dates: Date[]) => new Set(dates.map(dayKey));

describe('which puzzle a day is', () => {
  it('alternates the two games and gets harder through the week', () => {
    /* A week from a Monday. */
    const week: Array<{ mode: string; label: string }> = [];
    for (let i = 0; i < 7; i++) week.push(dailySetting(on(2026, 9, 7 + i)));

    expect(week.map((s) => s.mode)).toEqual([
      'flood', 'merge', 'flood', 'merge', 'flood', 'merge', 'flood',
    ]);
    /* Monday easiest, Sunday hardest, and no two days running the same. */
    expect(week[0].label).toBe('Easy');
    expect(week[6].label).toBe('Expert');
    for (let i = 1; i < 7; i++) {
      expect(week[i].mode + '/' + week[i].label, 'day ' + i + ' repeats day ' + (i - 1))
        .not.toBe(week[i - 1].mode + '/' + week[i - 1].label);
    }
  });

  it('gives every day its own seed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(dailySeed(on(2026, 9, 7 + i)));
    expect(seen.size).toBe(400);
  });

  it('knows which days can be played', () => {
    const today = on(2026, 9, 7);
    expect(isPlayableDay(today, today), 'today').toBe(true);
    expect(isPlayableDay(on(2026, 9, 6), today), 'yesterday').toBe(true);
    expect(isPlayableDay(on(2026, 9, 8), today), 'tomorrow').toBe(false);
    /* Before the first daily is not a puzzle that was missed — it is a day
       the game did not exist. */
    const first = firstDailyDate();
    expect(isPlayableDay(first, today), 'the first daily').toBe(true);
    expect(isPlayableDay(on(first.getFullYear(), first.getMonth() + 1, first.getDate() - 1), today))
      .toBe(false);
    expect(FIRST_DAILY.year).toBeGreaterThan(2000);
  });

  it('reads the day off the wall clock, not off an instant', () => {
    expect(dayKey(new Date(2026, 8, 7, 23, 59))).toBe('2026-09-07');
    expect(dayKey(new Date(2026, 8, 8, 0, 1))).toBe('2026-09-08');
  });
});

describe('streaks', () => {
  const today = on(2026, 9, 7);

  it('counts a run ending today', () => {
    expect(streakOf(keys(on(2026, 9, 5), on(2026, 9, 6), today), today)).toBe(3);
  });

  it('still counts a run ending yesterday', () => {
    /* Not broken until a day passes unplayed. Telling somebody at breakfast
       that their streak is zero because they have not played yet would be
       both wrong and unkind. */
    expect(streakOf(keys(on(2026, 9, 5), on(2026, 9, 6)), today)).toBe(2);
  });

  it('is broken by a missed day', () => {
    expect(streakOf(keys(on(2026, 9, 3), on(2026, 9, 4)), today)).toBe(0);
    expect(streakOf(keys(on(2026, 9, 4), on(2026, 9, 6), today), today)).toBe(2);
  });

  it('is nothing when nothing has been played', () => {
    expect(streakOf(new Set(), today)).toBe(0);
  });

  it('remembers the longest run there has ever been', () => {
    const days = keys(
      on(2026, 7, 1), on(2026, 7, 2), on(2026, 7, 3), on(2026, 7, 4),
      on(2026, 8, 10),
      on(2026, 9, 6), today,
    );
    expect(bestStreakOf(days)).toBe(4);
    expect(streakOf(days, today)).toBe(2);
  });

  it('counts a run that crosses a month end', () => {
    const days = keys(on(2026, 8, 30), on(2026, 8, 31), on(2026, 9, 1));
    expect(bestStreakOf(days)).toBe(3);
  });

  it('is not confused by the days arriving out of order', () => {
    const forwards = keys(on(2026, 9, 1), on(2026, 9, 2), on(2026, 9, 3));
    const backwards = new Set([...forwards].reverse());
    expect(bestStreakOf(backwards)).toBe(bestStreakOf(forwards));
  });

  it('covers both games across a week of dailies', () => {
    const modes = new Set(MODES.map(() => ''));
    modes.clear();
    for (let i = 0; i < 7; i++) modes.add(dailySetting(on(2026, 9, 7 + i)).mode);
    expect(modes.size).toBe(2);
  });
});
