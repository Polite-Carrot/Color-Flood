/* levels.ts — what a puzzle is asked for, and which one today's is.
 *
 * Kept apart from both the generator and the page: the generator does not
 * care what "Hard" means, and a phone build will want exactly these settings
 * without wanting anything the browser knows about. Pure, seeded, no DOM. */

import type { GenOptions } from './generator.ts';

/* Player-facing text says "color", the way the sort game's does. The code
   around it says "colour" as often as not, and that is the same arrangement
   and the same rule: the boundary is what a player reads, not what file it
   lives in. */
export type Setting = {
  key: string;
  label: string;
  blurb: string;
  width: number;
  height: number;
  palette: number;
  /* How deep the layer construction goes. NOT the answer — with the layers
     cut into patches the answer is whatever the search finds, and it lands
     well above this. Depth 8 on a 12x12 board comes out around par 12. */
  depth: number;
  /* Roughly how many cells to a patch. Smaller patches put more colours on
     the blob's edge, which is the whole of the difficulty. */
  patchSize: number;
  /* What par is allowed to be. A board outside is thrown back. */
  parBand: [number, number];
  /* Moves above par the player is given. This is the difficulty dial that
     the player actually feels. Measured over hundreds of boards, playing
     greedily — always taking whichever colour swallows the most, never
     looking further — finishes one or two moves above par. So slack 2 is a
     board greedy will beat, slack 1 is a board where it is touch and go, and
     slack 0 cannot be beaten without finding a line better than the obvious
     one. That is the curve. */
  slack: number;
};

/* Five settings. What steps up between them is the board, the number of
   patches on it, and — mostly — how much room there is above par.
   
   More colours alone does not make a flood puzzle harder; if anything it
   makes the next region easier to pick out. What makes it hard is having
   several worthwhile moves at once and no way to tell which pays off four
   moves later, which is what cutting the layers into patches produces.
   
   Every board also leaves the layer construction three bands of slack below
   its ceiling, which is not about difficulty at all but about how the board
   LOOKS: at its ceiling every layer must be exactly one band wider than the
   last, the ragged growth is suppressed, and the board comes out ruled. */
export const SETTINGS: Setting[] = [
  {
    key: 'easy', label: 'Easy',
    blurb: 'A small board, and two moves in hand over the best line.',
    width: 7, height: 7, palette: 4, depth: 4, patchSize: 6,
    parBand: [5, 7], slack: 2,
  },
  {
    key: 'normal', label: 'Normal',
    blurb: 'Wider, with one move spare. Playing the biggest grab every time will just about do it.',
    width: 10, height: 10, palette: 5, depth: 6, patchSize: 8,
    parBand: [8, 11], slack: 1,
  },
  {
    key: 'hard', label: 'Hard',
    blurb: 'Twelve across and six colours, still with one move spare — but the greedy line is tighter than it looks.',
    width: 12, height: 12, palette: 6, depth: 8, patchSize: 8,
    parBand: [11, 14], slack: 1,
  },
  {
    key: 'extraHard', label: 'Extra Hard',
    blurb: 'Fourteen across, and no room over par. The obvious move is not always the one that pays.',
    width: 14, height: 14, palette: 6, depth: 9, patchSize: 10,
    parBand: [11, 15], slack: 0,
  },
  {
    key: 'expert', label: 'Expert',
    blurb: 'Sixteen across, at par exactly. Nothing but the best line will finish it.',
    width: 16, height: 16, palette: 6, depth: 10, patchSize: 12,
    parBand: [12, 16], slack: 0,
  },
];

export function settingFor(key: string): Setting {
  return SETTINGS.find((s) => s.key === key) ?? SETTINGS[0];
}

export function optionsFor(setting: Setting, seed: string): GenOptions {
  return {
    width: setting.width,
    height: setting.height,
    palette: setting.palette,
    targetMoves: setting.depth,
    patchSize: setting.patchSize,
    parBand: setting.parBand,
    slack: setting.slack,
    seed,
  };
}

/* ------------------------------------------------------------ the daily */

/* Nothing is stored for a daily beyond whether it was solved: the board is
   worked out from the date itself, so any two people on the same day get the
   same puzzle, and a day from months ago deals exactly what it dealt then. */

/* The first daily. Nothing before this is playable, so the calendar has a
   beginning rather than running back for ever. */
export const FIRST_DAILY = { year: 2026, month: 9, day: 1 };

/* Sunday first, to match Date#getDay. The week has a shape to it — a gentle
   start, the two hardest settings at the weekend. */
const WEEK = ['normal', 'easy', 'normal', 'hard', 'normal', 'extraHard', 'expert'];

/* Dates are handled as local calendar days, never as instants. A daily puzzle
   belongs to the date on the player's own wall, so the hour and the time zone
   must not come into it. */
export function dayKey(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function dailySetting(date: Date): Setting {
  return settingFor(WEEK[date.getDay()]);
}

/* The seed carries the setting as well as the date, so that a Wednesday and
   the Thursday after it cannot deal the same board simply because they happen
   to run the same width. */
export function dailySeed(date: Date): string {
  return dayKey(date) + '/' + dailySetting(date).key;
}

export function isBeforeFirstDaily(date: Date): boolean {
  const first = new Date(FIRST_DAILY.year, FIRST_DAILY.month - 1, FIRST_DAILY.day);
  return date < first;
}
