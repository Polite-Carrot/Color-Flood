# Color Flood

A puzzle about flooding a board with one color, in as few moves as you are
given.

The board is a grid, and the bottom-left corner is the **blob** — the run of
touching cells that share its color. Pick a color and the blob becomes it,
swallowing whatever it now matches along its edge. Win by turning the whole
board one color; the level tells you how many moves you get, and that number
is the fewest that will do it, not a guess.

**What is here so far:** the generator, and nothing else. There is no game to
play yet — no board to tap, no screen, no app. What there is deals levels,
proves they can be finished, and prints one to a terminal so you can look at
it. Everything a player will eventually touch is still to come.

## Where the levels come from

The obvious way to make one of these is to fill a grid with random colors and
then work out how long it takes to solve. That is a bad idea twice over. Par
comes out wherever it lands, so you cannot ask for a three-move puzzle; and
finding par means a search, which is fine when a board can be solved and
expensive when it cannot — proving no five-move solution exists means
exhausting every five-move line there is.

So the board is built **backwards**, from an answer known before a single cell
is colored.

1. Layer 1 is one cell: the corner the blob starts in.
2. Layer 2 is a band around it. Layer 3 is a band around those two. And so on.
3. Adjacent layers never share a color, so the solution is simply: recolor to
   layer 2's color, then layer 3's, then layer 4's.

`targetMoves` layers out is `targetMoves` moves in, and it is exactly that
rather than at most that:

- A move only takes cells touching the blob, and the only layer touching the
  blob is the next one out — so no move can skip a layer.
- Touching layers differ in color — so no move can take two layers at once.

Every layer therefore costs exactly one move. The intended line is not merely
*a* solution, it is *the* shortest one, and the search only ever confirms what
the construction already settled. Colors are still reused between layers that
do not touch, which is what lets a nine-move board run on four colors.

### Why the layers are ragged

Bands alone give a board that steps evenly out from the corner and reads as a
target rather than a puzzle. They also come out lopsided: the first layers are
a few cells and the last one is most of the board.

So each layer takes the band it must have and then grows a random blob past
it, sized so the layers still to come get a fair share of what is left. That
is the whole difference between a board you look at and a board you look into.

### Why nine moves does not fit on a 9×9 board

The natural guess for how many layers a board holds is one per diagonal, or
`w + h - 1`. It is wrong, and the reason is worth knowing before anyone tries
to raise the limit.

Cells the same distance from the corner form an anti-diagonal, and cells on an
anti-diagonal touch only at their corners — which is not touching. So a band
at a fixed distance is not one region, and a layer has to be thicker than one
to be one region. What *is* connected is the **L-shaped band**: one arm across
and one arm up, meeting at the corner. Nested L-bands fill a board in
`max(w, h)` of them.

So the ceiling is `max(w, h) - 1` moves — fourteen on a 15×9 board, not
twenty-two. Asking for more throws, with the number it will accept in the
message. A lucky board occasionally squeezes out one extra layer; it is not
offered, because a generator dealing a campaign has to be predictable about
what it takes, and "sometimes" is worse than one fewer.

Start the blob somewhere other than a corner and the ceiling drops, because
the furthest cell is nearer. `bandRadius(width, height, origin)` is the number.

### Stranded islands

`strandChance` drops a small island of an earlier layer's color into the
middle of a later one. The player floods past it, finishes the board around
it, and has to spend a move going back. It is the one setting that makes the
real par differ from the layer count.

The color is copied out of the earlier layer rather than cut out of it.
Removing cells from a layer can break it in two, or strand its neighbours, and
repairing that is worth more than the difficulty is — so the island is a lie
told to the grid, not to the layers, which stay exactly as they were built.

Because it breaks the exactness, any board with an island has its move limit
set by the search rather than by the construction, and a board whose real par
wandered outside `targetMoves..targetMoves+2` is thrown back and another
dealt.

## The parts

| File | What it is |
|------|------------|
| `src/generator.ts` | The generator and the solver. No imports, no DOM, no `Math.random`. |
| `src/palette.ts` | What a color index looks like. The generator never sees it. |
| `src/cli.ts` | Deals a board and prints it. |
| `src/generator.test.ts` | The three things that would quietly ruin the game. |

`generator.ts` imports nothing at all, on purpose: the web build and the React
Native build both take this same file, so it must not reach for a document, a
filesystem, or a global random number generator. It deals in color *indices*;
what index 2 looks like is `palette.ts`'s business and, later, the renderer's.

```ts
generate(opts: GenOptions): Level
solve(level: Level, cap?: number): number | null
bandRadius(width, height, origin): number
```

`solve` returns `null` rather than a number if it hits its state cap, which
defaults to 200,000. Boards out of `generate` settle in a few hundred states;
the cap is there for a board handed in from somewhere else.

## Seeds

Every random draw comes from the seed, which is a string. The same seed deals
the same board on every machine, this year and next — which is the whole
requirement for a daily puzzle, where the seed is the date and two people on
opposite sides of the world have to be playing the same thing.

There is no `Math.random` anywhere in `generator.ts`, and a test enforces it by
breaking `Math.random` and dealing a board anyway.

## Running it

```
npm install
npm test
npm run gen -- --w 9 --h 7 --moves 3 --seed 2026-09-07
```

`gen` prints the board in color, each cell carrying its color's letter as well
— set `NO_COLOR`, pass `--plain`, or pipe the output anywhere and it still
reads.

```
  --w <n>        board width           (default 9)
  --h <n>        board height          (default 7)
  --moves <n>    intended par          (default 3)
  --palette <n>  colors in play        (default 4, at most 10)
  --seed <s>     any string            (default today's date)
  --strand <p>   0..1, island chance   (default 0)
  --solve        search for par and check it against the move limit
  --plain        letters only, no color
```

`--solve` is the one worth knowing about: it runs the search and exits non-zero
if the answer disagrees with the move limit on the level. That is the check
that catches a change to the growth quietly breaking the construction, and it
costs a millisecond.

## What the tests are actually for

None of the three failures they catch look like failures. The game plays
perfectly happily on a broken board, right up until somebody cannot finish it.

- **Determinism.** A daily puzzle that deals differently on two phones. A
  hundred seeds must give a hundred distinct boards, a seed must give the same
  board however many others were dealt in between, and `Math.random` must never
  be reached for.
- **The layer invariants**, over 500 boards of assorted sizes: every layer one
  connected region, and no cell touching a layer two away. A cell touching a
  layer two away means a move could jump a layer, and par is not par.
- **Agreement between `solve` and `targetMoves`.** The construction says three
  moves; the search has to find three. Not two, which would mean a level
  advertising more difficulty than it has, and not four, which would mean a
  level nobody can beat.

## Spelling

Anything a player reads says **color**. Anything only a developer reads may say
either, and a fair amount of it says *colour*, which is the same arrangement
the sort game settled on and for the same reason: the rule is the boundary, not
the file.

## Where the colors come from

The palette is the sort game's, hex for hex. The two are meant to look like
they came from the same place, and somebody who has played one should recognise
the colors in the other. Each carries a unique initial as well as a hex, so a
board stays readable printed in a terminal that cannot do color, or read by
somebody who cannot easily tell two of them apart.
