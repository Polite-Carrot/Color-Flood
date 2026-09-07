#!/usr/bin/env node
/* cli.ts — deal a board and print it, so a change to the generator can be
 * looked at rather than only tested.
 *
 *   npm run gen -- --w 9 --h 7 --moves 3 --seed 2026-09-07
 *   npm run gen -- --w 12 --h 12 --moves 8 --palette 5 --strand 0.4 --solve
 *
 * Cells print two characters wide, because a terminal cell is about half as
 * wide as it is tall and a one-character board comes out squashed. Each one
 * carries its colour's letter as well as its colour: set NO_COLOR and the
 * board still reads, which is also what happens wherever the output is piped
 * into a file. */

import { generateDetailed, solve, type GenOptions } from './generator.ts';
import { colour, ink, rgb, MAX_PALETTE } from './palette.ts';

type Args = Record<string, string | boolean>;

function parse(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    /* A flag is a flag if nothing follows it or the next thing is another
       flag — so --solve needs no value but --moves 3 still reads as a pair. */
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function num(args: Args, key: string, fallback: number): number {
  const v = args[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('--' + key + ' wants a number, got "' + String(v) + '"');
  return n;
}

const USAGE = `deal a flood-fill board and print it

  --w <n>        board width           (default 9)
  --h <n>        board height          (default 7)
  --moves <n>    intended par          (default 3)
  --palette <n>  colours in play       (default 4, at most ${MAX_PALETTE})
  --seed <s>     any string            (default today's date)
  --strand <p>   0..1, island chance   (default 0)
  --solve        search for par and check it against the move limit
  --plain        letters only, no colour
  --help`;

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const colourless = () =>
  Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;

function cell(index: number, plain: boolean): string {
  const mark = colour(index).mark;
  if (plain) return mark + ' ';
  const c = rgb(index);
  const fg = ink(index) === 'dark' ? '30' : '97';
  return '\x1b[48;2;' + c.r + ';' + c.g + ';' + c.b + 'm\x1b[' + fg + 'm ' + mark + '\x1b[0m';
}

function main(): void {
  const args = parse(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }

  const opts: GenOptions = {
    width: num(args, 'w', 9),
    height: num(args, 'h', 7),
    palette: num(args, 'palette', 4),
    targetMoves: num(args, 'moves', 3),
    seed: typeof args.seed === 'string' ? args.seed : today(),
    strandChance: num(args, 'strand', 0),
  };

  /* The generator is happy with any number of colours — it only ever deals
     indices — but this has to draw them, so here is where the palette runs
     out. */
  if (opts.palette > MAX_PALETTE) {
    throw new Error('--palette ' + opts.palette + ' is more colours than there are: ' + MAX_PALETTE);
  }

  const started = Date.now();
  const { level, layerCount, colours, attempts } = generateDetailed(opts);
  const dealt = Date.now() - started;

  const plain = Boolean(args.plain) || colourless();

  console.log('');
  console.log(
    '  ' + level.width + '×' + level.height +
    '   par ' + level.moveLimit +
    '   ' + level.palette + ' colours' +
    '   seed ' + level.seed,
  );
  console.log('');
  for (let r = 0; r < level.height; r++) {
    console.log('  ' + level.grid[r].map((c) => cell(c, plain)).join(''));
  }
  console.log('');

  /* The blob starts at the origin, so it is worth pointing at — on a printed
     board it is just another cell. */
  const [or, oc] = level.origin;
  console.log('  blob starts at row ' + or + ', column ' + oc +
    ' (' + colour(level.grid[or][oc]).name + ')');
  console.log('  intended line: ' +
    colours.slice(2, layerCount + 1).map((c) => colour(c).name).join(' → '));
  console.log('  dealt in ' + dealt + 'ms' + (attempts ? ', after ' + attempts + ' thrown back' : ''));

  if (args.solve) {
    const t = Date.now();
    const par = solve(level);
    console.log('  searched: par ' + (par === null ? 'not found inside the cap' : par) +
      ' in ' + (Date.now() - t) + 'ms' +
      (par === level.moveLimit ? ' — matches the move limit' : '  ** DISAGREES with the move limit'));
    if (par !== level.moveLimit) process.exitCode = 1;
  }
  console.log('');
}

main();
