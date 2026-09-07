/* levels.ts — what a puzzle is asked for, and which one today's is.
 *
 * Kept apart from both the generator and the page: the generator does not
 * care what "Hard" means, and a phone build will want exactly these settings
 * without wanting anything the browser knows about. Pure, seeded, no DOM. */
/* Five settings, and the thing that steps up between them is the board. More
   colours alone does not make a flood puzzle harder — it makes the next band
   easier to pick out, if anything. What makes it harder is a longer chain to
   read ahead through, so the board grows and the move count grows with it.
   
   Every one of these leaves the board three bands of slack — a 12×12 board
   holds twelve L-bands and is asked for eight. That is the single most
   important number here and it is not about difficulty at all, it is about
   how the boards LOOK. At its ceiling a board has no freedom: every layer has
   to be exactly one band wider than the last, so the ragged growth is
   suppressed and what comes out is stripes. Give it slack and the layers can
   spread sideways, which is where all the shape comes from. Nine moves on a
   twelve-wide board would be a fine puzzle and a dull picture.
   
   Islands arrive at Hard and get likelier from there. They are the one thing
   that breaks the tidy "one band per move" reading, so they are what the top
   two settings are actually about. */
export const SETTINGS = [
    {
        key: 'easy', label: 'Easy',
        blurb: 'A small board and four colors. Read the bands and walk out.',
        width: 7, height: 7, palette: 4, moves: 4, strandChance: 0,
    },
    {
        key: 'normal', label: 'Normal',
        blurb: 'Wider, with a longer chain to see all the way through.',
        width: 10, height: 10, palette: 5, moves: 6, strandChance: 0,
    },
    {
        key: 'hard', label: 'Hard',
        blurb: 'Twelve across, and the first islands to double back for.',
        width: 12, height: 12, palette: 5, moves: 8, strandChance: 0.35,
    },
    {
        key: 'extraHard', label: 'Extra Hard',
        blurb: 'Fourteen across, six colors, and islands most of the way down.',
        width: 14, height: 14, palette: 6, moves: 10, strandChance: 0.55,
    },
    {
        key: 'expert', label: 'Expert',
        blurb: 'Sixteen across and twelve moves. Every one of them has to be right.',
        width: 16, height: 16, palette: 6, moves: 12, strandChance: 0.65,
    },
];
export function settingFor(key) {
    return SETTINGS.find((s) => s.key === key) ?? SETTINGS[0];
}
export function optionsFor(setting, seed) {
    return {
        width: setting.width,
        height: setting.height,
        palette: setting.palette,
        targetMoves: setting.moves,
        strandChance: setting.strandChance,
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
export function dayKey(date) {
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}
export function dailySetting(date) {
    return settingFor(WEEK[date.getDay()]);
}
/* The seed carries the setting as well as the date, so that a Wednesday and
   the Thursday after it cannot deal the same board simply because they happen
   to run the same width. */
export function dailySeed(date) {
    return dayKey(date) + '/' + dailySetting(date).key;
}
export function isBeforeFirstDaily(date) {
    const first = new Date(FIRST_DAILY.year, FIRST_DAILY.month - 1, FIRST_DAILY.day);
    return date < first;
}
