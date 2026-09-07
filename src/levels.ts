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

/* Two games on one board. Flood starts in one corner; Merge starts in two
   opposite corners and a move recolours BOTH at once. */
export type Mode = 'flood' | 'merge';

export type Setting = {
  mode: Mode;
  key: string;
  label: string;
  blurb: string;
  width: number;
  height: number;
  palette: number;
  /* How deep the layer construction goes. NOT the answer — with the layers
     cut into patches the answer is whatever the search finds, and it lands
     well above this. */
  depth: number;
  /* Roughly how many cells to a patch. Smaller patches put more colours on
     the blob's edge, which is the whole of the difficulty. */
  patchSize: number;
  /* What par is allowed to be. A board outside is thrown back. */
  parBand: [number, number];
  /* Moves above par the player is given. This is the difficulty dial that
     the player actually feels. Measured over hundreds of boards, playing
     greedily — always taking whichever colour swallows the most, never
     looking further — finishes one to three moves above par. So slack 2 is a
     board greedy will beat, slack 1 is touch and go, and slack 0 cannot be
     beaten without finding a line better than the obvious one. */
  slack: number;
};

/* Flood: one corner, and what steps up between the settings is the board, the
   number of patches on it, and — mostly — how much room there is over par.
   
   Every board also leaves the layer construction three bands of slack below
   its ceiling, which is not about difficulty at all but about how the board
   LOOKS: at its ceiling every layer must be exactly one band wider than the
   last, the ragged growth is suppressed, and the board comes out ruled. */
export const FLOOD: Setting[] = [
  {
    mode: 'flood', key: 'easy', label: 'Easy',
    blurb: 'A small board, and two moves in hand over the best line.',
    width: 7, height: 7, palette: 4, depth: 4, patchSize: 6,
    parBand: [5, 7], slack: 2,
  },
  {
    mode: 'flood', key: 'normal', label: 'Normal',
    blurb: 'Wider, with one move spare. Playing the biggest grab every time will just about do it.',
    width: 10, height: 10, palette: 5, depth: 6, patchSize: 8,
    parBand: [8, 11], slack: 1,
  },
  {
    mode: 'flood', key: 'hard', label: 'Hard',
    blurb: 'Twelve across and six colors, still with one move spare — but the greedy line is tighter than it looks.',
    width: 12, height: 12, palette: 6, depth: 8, patchSize: 8,
    parBand: [11, 14], slack: 1,
  },
  {
    mode: 'flood', key: 'extraHard', label: 'Extra Hard',
    blurb: 'Fourteen across, and no room over par. The obvious move is not always the one that pays.',
    width: 14, height: 14, palette: 6, depth: 9, patchSize: 10,
    parBand: [11, 15], slack: 0,
  },
  {
    mode: 'flood', key: 'expert', label: 'Expert',
    blurb: 'Sixteen across, at par exactly. Nothing but the best line will finish it.',
    width: 16, height: 16, palette: 6, depth: 10, patchSize: 12,
    parBand: [12, 16], slack: 0,
  },
];

/* Merge: two corners, one steering wheel. Every move recolours both fronts,
   so a colour that opens up the bottom-left is often the wrong one top-right,
   and the whole game is in that compromise. The fronts merge on contact,
   because they are always the same colour as each other.
   
   The boards are SMALLER than Flood's at the same difficulty name, and that
   is a cost rather than a choice. par has to be searched for, and two fronts
   make the search enormously more expensive: a region counts as near if
   either front is close to it, so the distance bound that steers A* collapses
   towards half of what one front would give, while the real difficulty goes
   up. Measured, a 13x13 two-front board took ten seconds to deal and a 15x15
   over a minute. Eleven across is where it stays under a second, so eleven
   across is where it stops. */
export const MERGE: Setting[] = [
  {
    mode: 'merge', key: 'easy', label: 'Easy',
    blurb: 'Two corners on a small board, and two moves in hand.',
    width: 7, height: 7, palette: 4, depth: 4, patchSize: 6,
    parBand: [5, 7], slack: 2,
  },
  {
    mode: 'merge', key: 'normal', label: 'Normal',
    blurb: 'Nine across. One colour has to suit both corners at once.',
    width: 9, height: 9, palette: 5, depth: 5, patchSize: 8,
    parBand: [8, 10], slack: 1,
  },
  {
    mode: 'merge', key: 'hard', label: 'Hard',
    blurb: 'Ten across and six colors, with the two fronts meeting in the middle.',
    width: 10, height: 10, palette: 6, depth: 6, patchSize: 9,
    parBand: [10, 12], slack: 1,
  },
  {
    mode: 'merge', key: 'extraHard', label: 'Extra Hard',
    blurb: 'Eleven across, at par exactly. Every move has to earn its keep at both ends.',
    width: 11, height: 11, palette: 6, depth: 6, patchSize: 10,
    parBand: [10, 12], slack: 0,
  },
  {
    mode: 'merge', key: 'expert', label: 'Expert',
    blurb: 'The longest line in the game, steered from both corners at once.',
    width: 11, height: 11, palette: 6, depth: 7, patchSize: 10,
    parBand: [11, 14], slack: 0,
  },
];

export const MODES: Mode[] = ['flood', 'merge'];

export function modeLabel(mode: Mode): string {
  return mode === 'merge' ? 'Merge' : 'Flood';
}

export function settingsFor(mode: Mode): Setting[] {
  return mode === 'merge' ? MERGE : FLOOD;
}

/* Where the blob or blobs start. Flood takes the bottom-left corner; Merge
   takes that and the one diagonally opposite, which is as far apart as a
   rectangle allows. */
export function originsFor(setting: Setting): Array<[number, number]> {
  return setting.mode === 'merge'
    ? [[setting.height - 1, 0], [0, setting.width - 1]]
    : [[setting.height - 1, 0]];
}

export function settingFor(mode: Mode, key: string): Setting {
  const list = settingsFor(mode);
  return list.find((s) => s.key === key) ?? list[0];
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
    origins: originsFor(setting),
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
   start, both games in it, and the two hardest settings at the weekend. */
const WEEK: Array<{ mode: Mode; key: string }> = [
  { mode: 'merge', key: 'hard' },       /* Sun */
  { mode: 'flood', key: 'easy' },       /* Mon */
  { mode: 'merge', key: 'normal' },     /* Tue */
  { mode: 'flood', key: 'hard' },       /* Wed */
  { mode: 'merge', key: 'normal' },     /* Thu */
  { mode: 'flood', key: 'extraHard' },  /* Fri */
  { mode: 'merge', key: 'expert' },     /* Sat */
];

export function dayKey(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function dailySetting(date: Date): Setting {
  const { mode, key } = WEEK[date.getDay()];
  return settingFor(mode, key);
}

/* The seed carries the setting as well as the date, so that a Wednesday and
   the Thursday after it cannot deal the same board simply because they happen
   to run the same width. */
export function dailySeed(date: Date): string {
  const setting = dailySetting(date);
  return dayKey(date) + '/' + setting.mode + '/' + setting.key;
}

export function isBeforeFirstDaily(date: Date): boolean {
  const first = new Date(FIRST_DAILY.year, FIRST_DAILY.month - 1, FIRST_DAILY.day);
  return date < first;
}
