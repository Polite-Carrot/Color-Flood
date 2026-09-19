/* share.ts — the daily, as something you can paste.
 *
 * Four lines, in the shape everybody already knows from Wordle: what it was,
 * how it went, the run of moves as coloured squares, and where to play it.
 * The squares are the point — they say how the board fell without giving away
 * a single thing about the board, so the person reading it has the same
 * puzzle ahead of them that you had.
 *
 * Pure, and separated from the button for that reason: the text is the part
 * with a right answer, and the clipboard is the part that behaves differently
 * on every platform. */

import { PALETTE } from './palette.ts';

export const SITE = 'polite-carrot.github.io/Color-Flood';

export type Result = {
  day: string;        /* 2026-09-19 */
  game: string;       /* Flood, Merge */
  setting: string;    /* Easy, Expert */
  par: number;
  moves: number[];    /* the colours played, in order */
  hints: number;
};

export function shareText(r: Result): string {
  const used = r.moves.length;
  /* "7 of 6" reads as a fraction of the par rather than a score out of it,
     which is what it is: par is the best possible, not the target. At par it
     says so instead, because that is the thing worth bragging about. */
  const score = used === r.par ? used + ' moves · par!' : used + ' moves · par ' + r.par;
  const hints = r.hints ? ' · ' + r.hints + (r.hints === 1 ? ' hint' : ' hints') : '';
  return [
    'Color Flood · ' + r.day,
    r.game + ' · ' + r.setting + ' · ' + score + hints,
    r.moves.map((c) => PALETTE[c]?.square ?? '⬜').join(''),
    SITE,
  ].join('\n');
}
