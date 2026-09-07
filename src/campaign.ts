/* campaign.ts — two hundred levels in order, and what each of them is.
 *
 * Two campaigns, one per game. The first five of each are drawn by hand and
 * teach one rule apiece; everything after is a seeded deal from the same
 * generator the Random screen uses, on a board that widens as you go.
 *
 * Nothing is stored. A level is worked out from its number, so the whole
 * campaign is a function rather than a file — no megabyte of pre-generated
 * boards to ship, and level 87 deals the same board on every device and will
 * still deal it next year.
 *
 * Pure: no DOM, no storage, no clock. */

import { generate, solve, type Level } from './generator.ts';
import { PALETTE } from './palette.ts';
import { optionsFor, type Mode, type Setting } from './levels.ts';

export const CAMPAIGN_LENGTH = 100;
/* How many of those are drawn by hand. */
export const TAUGHT = 5;

export type CampaignLevel = {
  n: number;
  mode: Mode;
  level: Level;
  name: string;
  /* One line of teaching, shown above the board. The hand-drawn levels have
     one; the seeded ones do not, because there is nothing left to say. */
  brief: string;
};

/* ------------------------------------------------------- the drawn levels */

/* Boards are written as letters, because a grid of colour indices is
   unreadable and an unreadable board is one nobody will check. The letters
   are the palette's own marks — R B Y G P O — so what is written here is what
   appears on the cell. */
const MARKS = PALETTE.map((c) => c.mark);

function parse(rows: string[]): number[][] {
  const grid = rows.map((row) => Array.from(row.replace(/\s/g, '')).map((ch) => {
    const index = MARKS.indexOf(ch);
    if (index < 0) throw new Error('no colour has the mark "' + ch + '"');
    return index;
  }));
  const width = grid[0].length;
  for (const row of grid) {
    if (row.length !== width) throw new Error('the rows of a drawn board must be the same length');
  }
  return grid;
}

type Drawn = {
  name: string;
  brief: string;
  rows: string[];
  /* Moves given ON TOP of par. The first levels are generous; by the fifth
     there is nothing spare, which is the last thing each campaign teaches. */
  slack: number;
};

/* The five Flood lessons, in the order a person meets the rules.
 *
 * Every one is small enough to read at a glance and to solve without trying,
 * which is the point: a tutorial level that can be failed teaches the wrong
 * thing. The difficulty starts at level six. */
const FLOOD_DRAWN: Drawn[] = [
  {
    name: 'Your corner',
    brief: 'The bottom-left cell is yours. Pick a color and it becomes that color — ' +
           'and everything touching it that already matches joins in. Turn the whole board blue.',
    rows: [
      'BBBB',
      'BBBB',
      'BBBB',
      'RBBB',
    ],
    slack: 2,
  },
  {
    name: 'One band at a time',
    brief: 'You can only take what your blob is touching. Blue first — then, with blue in hand, ' +
           'you are touching the yellow.',
    rows: [
      'YYYY',
      'YYYY',
      'BBBY',
      'RBBY',
    ],
    slack: 2,
  },
  {
    name: 'Only what touches',
    brief: 'Green is on the board but nowhere near you, and playing it now would waste a move ' +
           'without moving anything. Work outwards.',
    rows: [
      'GGGGG',
      'GGGGG',
      'YYYGG',
      'BBYGG',
      'RBYGG',
    ],
    slack: 2,
  },
  {
    name: 'The big one is not always right',
    brief: 'Yellow is the biggest thing you can take, and taking it first costs you a move. ' +
           'Blue then green puts you next to BOTH yellow patches at once, and one move takes them together.',
    /* The board has two yellow patches, and the only cheap line reaches both
       before spending yellow on either. Grab the near one first — which is
       what taking the biggest patch does — and yellow has to be played twice.
       Verified rather than asserted: par 3, greedy 4, and a test holds both. */
    rows: [
      'YYYGY',
      'YYYGY',
      'YYGGY',
      'YBGGY',
      'RBGYY',
    ],
    slack: 1,
  },
  {
    name: 'Par exactly',
    brief: 'From here on you get exactly the number of moves the best line needs. ' +
           'Undo and restart are free — use them.',
    rows: [
      'PPPGGG',
      'PPPGGG',
      'YYYGGG',
      'YYYBBB',
      'RYYBBB',
      'RRYBBB',
    ],
    slack: 0,
  },
];

/* The five Merge lessons. The first teaches the whole rule in one move: two
   corners, one colour, both of them. */
const MERGE_DRAWN: Drawn[] = [
  {
    name: 'Two corners',
    brief: 'This time you hold two corners, top-right as well as bottom-left. ' +
           'One color moves both of them at once. Play blue.',
    rows: [
      'BBBR',
      'BBBB',
      'BBBB',
      'RBBB',
    ],
    slack: 2,
  },
  {
    name: 'Both at once',
    brief: 'Every move recolors both blobs, whether it helps them both or not. ' +
           'Yellow first, and watch the top-right end move too.',
    rows: [
      'BBYR',
      'BBYY',
      'YYBB',
      'RYBB',
    ],
    slack: 2,
  },
  {
    name: 'They join when they touch',
    brief: 'Your two blobs are always the same color as each other, so the moment they touch ' +
           'they are one blob. Nothing else is needed to merge them.',
    rows: [
      'YYBBR',
      'YYBBB',
      'BBBBB',
      'BBBYY',
      'RBBYY',
    ],
    slack: 2,
  },
  {
    name: 'Suits one, not the other',
    brief: 'A color that opens up one corner is often the wrong one at the other. ' +
           'Every move here is a compromise between the two ends.',
    rows: [
      'GGYYR',
      'GGYYY',
      'BBGGY',
      'BBBGG',
      'RBBGG',
    ],
    slack: 1,
  },
  {
    name: 'Par exactly',
    brief: 'Exactly the moves the best line needs, from both corners at once. ' +
           'This is the game from here on.',
    rows: [
      'YYGGPR',
      'YYGGPP',
      'BBYYGG',
      'GGBBYY',
      'RGGBBY',
      'RRGGBB',
    ],
    slack: 0,
  },
];

function drawn(mode: Mode): Drawn[] {
  return mode === 'merge' ? MERGE_DRAWN : FLOOD_DRAWN;
}

/* Build a Level out of a drawn board.
 *
 * par is NOT written down beside the board. It is searched for, every time,
 * from the board itself — because a par typed in by hand is a par that can be
 * wrong, and it would be wrong silently: the level would still play, it would
 * just be impossible or a gift. The boards are a few dozen cells and the
 * search settles them in well under a millisecond, so there is nothing to
 * save by trusting a number instead. */
function fromDrawn(mode: Mode, n: number, spec: Drawn): CampaignLevel {
  const grid = parse(spec.rows);
  const height = grid.length;
  const width = grid[0].length;
  const origins: Array<[number, number]> = mode === 'merge'
    ? [[height - 1, 0], [0, width - 1]]
    : [[height - 1, 0]];

  /* The picker shows one swatch per colour in the palette, and the palette is
     however many colours the board reaches into. So a board using red, blue
     and purple but no yellow would offer a yellow swatch that appears nowhere
     on it — a move that does nothing, presented as an option, on the levels
     whose whole job is to teach what a move does. Drawn boards therefore have
     to use a run of colours from the start of the palette with no gaps, and
     saying so here is cheaper than noticing it in a screenshot. */
  const used = new Set<number>();
  for (const row of grid) for (const c of row) used.add(c);
  const most = Math.max(...used);
  for (let c = 0; c <= most; c++) {
    if (!used.has(c)) {
      throw new Error(
        'the drawn board for ' + mode + ' level ' + n + ' uses colour ' + most +
        ' but not colour ' + c + ', so the picker would offer a colour that is not on the board',
      );
    }
  }

  const level: Level = {
    width, height, origins, grid,
    palette: most + 1,
    par: 0,
    moveLimit: 0,
    seed: mode + '/taught/' + n,
  };
  const par = solve(level);
  if (par === null || par === 0) {
    throw new Error('the drawn board for ' + mode + ' level ' + n + ' cannot be solved');
  }
  level.par = par;
  level.moveLimit = par + spec.slack;

  return { n, mode, level, name: spec.name, brief: spec.brief };
}

/* ------------------------------------------------------------- the ramp */

/* Everything after the taught levels, worked out from the level number.
 *
 * The board widens, the palette fills out, the construction goes deeper and
 * the moves you are given over par run out. All four move together and all
 * four are a straight interpolation over the length of the campaign — no
 * table, because a table of a hundred rows is a hundred chances to fumble one
 * and no way to see the shape.
 *
 * Merge tops out smaller than Flood, and for the same reason it does on the
 * Random screen: par has to be searched for and two fronts make that dear.
 * Eleven across is where a board still deals in under a second. */
export function campaignSetting(mode: Mode, n: number): Setting {
  const merge = mode === 'merge';
  /* 0 at the first seeded level, 1 at the last. */
  const t = Math.min(1, Math.max(0, (n - TAUGHT - 1) / (CAMPAIGN_LENGTH - TAUGHT - 1)));
  const ease = (from: number, to: number) => Math.round(from + (to - from) * t);

  const width = merge ? ease(7, 11) : ease(6, 16);
  const height = width;
  const palette = merge ? ease(4, 6) : ease(4, 6);
  const depth = merge ? ease(3, 7) : ease(3, 10);
  const patchSize = merge ? ease(6, 10) : ease(6, 12);

  /* Three spare moves at the start, none by the end. It saws rather than
     sliding: within each stretch of ten the slack drops, then comes back a
     little as the board steps up, so the campaign breathes instead of getting
     relentlessly harder for a hundred levels. */
  const base = t < 0.2 ? 3 : t < 0.45 ? 2 : t < 0.75 ? 1 : 0;
  const slack = Math.max(0, base - (n % 10 >= 7 ? 1 : 0));

  return {
    mode,
    key: 'campaign-' + n,
    label: 'Level ' + n,
    blurb: '',
    width, height, palette, depth, patchSize,
    /* Wide on purpose. The Random screen's bands are there to keep a setting
       feeling like itself; here the level number already says where you are,
       and a band tight enough to reject boards would only slow the deal. */
    parBand: [1, 60],
    slack,
  };
}

export function campaignSeed(mode: Mode, n: number): string {
  return mode + '/campaign/' + n;
}

/* The level, whichever kind it is. */
export function campaignLevel(mode: Mode, n: number): CampaignLevel {
  if (!Number.isInteger(n) || n < 1 || n > CAMPAIGN_LENGTH) {
    throw new Error('there is no level ' + n + ' — the campaign runs 1 to ' + CAMPAIGN_LENGTH);
  }
  if (n <= TAUGHT) return fromDrawn(mode, n, drawn(mode)[n - 1]);

  const setting = campaignSetting(mode, n);
  return {
    n, mode,
    level: generate(optionsFor(setting, campaignSeed(mode, n))),
    name: 'Level ' + n,
    brief: '',
  };
}
