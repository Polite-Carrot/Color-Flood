/* share.ts — the daily, as something you can paste.
 *
 * Three lines, in the shape everybody already knows from Wordle: what it was,
 * how it went, and the run of moves as coloured squares. The squares are the
 * point — they say how the board fell without giving away a single thing
 * about the board, so the person reading it has the same puzzle ahead of them
 * that you had.
 *
 * There is no fourth line pointing anywhere. There was, and it pointed at the
 * GitHub Pages build, which is where the game is developed rather than where
 * anybody should be sent. When there is a store listing to name, it goes back
 * as one more entry in the array below.
 *
 * Pure, and separated from the button for that reason: the text is the part
 * with a right answer, and the clipboard is the part that behaves differently
 * on every platform. */
import { PALETTE } from "./palette.js";
export function shareText(r) {
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
    ].join('\n');
}
