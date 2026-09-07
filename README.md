# Color Flood

A puzzle about flooding a board with one color, in as few moves as you are
given.

The board is a grid, and the bottom-left corner is the **blob** — the run of
touching cells that share its color. Pick a color and the blob becomes it,
swallowing whatever it now matches along its edge. Win by turning the whole
board one color, inside the moves you are given.

Every level knows its own **par** — the fewest moves that will finish it,
found by search, not estimated. The easier settings give you par and a little
room; the hardest give you par exactly.

**Play it:** https://polite-carrot.github.io/Color-Flood/

A daily puzzle that is the same board for everybody, and a random one at five
sizes. Every level is generated in the page — nothing is fetched, nothing is
stored on a server, and the whole site is a few files of plain ES modules.

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

### Why one color per layer was not a game

The construction above is elegant and it produced, for a while, a game with no
decisions in it at all.

Look again at the invariant: layer *n* touches only layers *n−1*, *n* and
*n+1*. The blob is always exactly layers 1..*n*. So the only layer on the
blob's edge is *n+1* — and if a layer is one color, that is **one legal move,
every turn, on every board**. Measured across the five difficulties, the
number of colors touching the blob averaged 1.00, 1.00, 1.04, 1.08 and 1.11,
and a strategy that never looks past the current move finished 100% of boards
of every difficulty inside par.

The exactness and the emptiness were the same property. A layer that is one
color is a layer that costs exactly one move, and a layer that costs exactly
one move is a layer you cannot get wrong. No amount of tuning reaches that;
the layer had to stop being one color.

So each layer is now cut into a few connected **patches**, and the patches are
colored so no two that touch match. The blob's edge carries two, three, four
colors. Taking one patch does not take its neighbours. And the order matters,
because a patch of layer *n+1* becomes reachable the moment the layer-*n*
patch beside it is absorbed — so the layers interleave rather than falling
like dominoes.

| | Colors on the blob's edge | Turns with no choice | Greedy wins |
|---|---|---|---|
| One color per layer | 1.00 – 1.11 | 90 – 100% | 100% |
| Cut into patches | 1.83 – 2.79 | 16 – 40% | 3 – 99% |

What it costs is the exact par. A layer is no longer one move, so the answer
is whatever `solve` says — and `solve` had to be rewritten, because breadth-
first search was only ever adequate when there was nothing to search.

### The greedy gate

`greedy` plays the most obvious possible strategy: take whichever color on the
edge swallows the most board, never look further than one move. It exists to
be beaten. **Any board it finishes in par is discarded and another dealt**, so
"this puzzle has something to think about" is a generator invariant enforced
on every level, not a hope.

That check is the one that would have caught the original problem on day one.
Nothing else did — every board was solvable, every test was green, and the
game was still a matter of clicking the only lit-up button.

### The solver

`solve` is A*, over board positions, ordered by moves-so-far plus a lower
bound on moves-still-needed, memoised on the position itself.

The bound comes from seeing the board as **regions** rather than cells — a
16×16 board of 256 cells is usually forty or fifty blocks of one color, and a
move absorbs whole regions. Walk that graph out from the blob and take the
furthest region: each move pulls the blob one step along it at best, so a
region five steps out needs at least five more moves. Being a lower bound and
never an overestimate is what keeps the answer exactly optimal rather than
merely good, and it is what makes the search finish at all — plain breadth-
first went from settling a board in a few hundred states to not settling it.

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

### Why the outer bands look striped

Nested bands filling a fixed board get thinner the more of them there are —
a band's thickness is roughly its area divided by its length, and the bands
near the edge are long. At its ceiling a board has no freedom at all: every
layer has to be exactly one band wider than the last, the ragged growth is
suppressed, and what comes out is stripes.

So the settings all leave the board three bands of slack, and the growth
spends that slack in a few places rather than evenly — each layer bulges into
two to five lobes and stays thin between them, and the next layer has to wrap
those lobes, so the shape compounds outwards instead of being smoothed away.
The middle of a board comes out genuinely blobby; the last band or two,
against the far edge, is thin whatever anyone does. That one is geometry, not
a setting.

## The parts

The repository root **is** the website. Pages serves this branch's root
directly, so `index.html` and everything it loads sit where they are served
from, and `git push` is the deploy.

| Path | What it is |
|------|------------|
| `index.html`, `styles.css`, `fonts.css`, `assets/` | The page. Hand-written, and served as they are. |
| `js/` | **Generated** from `src/` by `npm run build`. Committed, and never edited by hand. |
| `src/generator.ts` | The generator and the solver. No imports, no DOM, no `Math.random`. |
| `src/play.ts` | The rules: what the blob is, what a move does, undo. |
| `src/levels.ts` | The five settings, and which puzzle today's is. |
| `src/palette.ts` | What a color index looks like. The generator never sees it. |
| `src/app.ts` | The browser build. The only file in `src/` that knows a DOM exists. |
| `src/cli.ts` | Deals a board and prints it to a terminal. |

`generator.ts`, `play.ts`, `levels.ts` and `palette.ts` are pure and none of
them import anything but a type, which is the point: a React Native build
takes those four as they are and writes its own version of `app.ts`. `generator.ts` in particular imports nothing at all,
and a test enforces it — the check strips the comments first, because the
comments discuss `Math.random` at some length and a check that reads them
finds exactly what it was written to forbid.

The generator deals in color *indices*; what index 2 looks like is
`palette.ts`'s business, and the palette is the sort game's, hex for hex.

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
npm run gen -- --w 9 --h 7 --moves 3 --seed 2026-09-07   # a board in the terminal
npm run build && npm run serve                            # the game, on :8080
```

There is no bundler and no framework. `npm run build` runs `tsc` over `src/`
into `js/` as plain ES modules; `index.html` loads `js/app.js` as a module and
the browser follows the imports from there. The whole site is about 390 KB,
and 244 KB of that is the two fonts, inlined as data URIs so the page fetches
nothing at all.

The source imports say `./generator.ts`, which is what lets Node run the CLI
and the tests straight from source with no build. `rewriteRelativeImportExtensions`
turns them into `./generator.js` on the way out, which is what the browser
needs. Both are true at once, and neither is a copy of the other.

## Deploying

`git push` to `main`. That is the whole of it — Pages serves this branch's
root, so pushing the root publishes it.

Which is why **`js/` is committed**, and that is worth being upfront about
because generated files in git are normally a mistake. Publishing straight
from a branch means there is no build step between the branch and the URL, so
whatever the browser needs has to be *in* the branch. The alternative is
setting the Pages source to GitHub Actions and letting a workflow build and
upload — cleaner in git, one setting to get right, and that setting is admin
only.

The cost of this way is drift: `js/` can fall behind `src/`, and a drifted
`js/` is a stale game at the URL with a perfectly green repository behind it.
So `.github/workflows/pages.yml` rebuilds on every push and fails if what is
committed differs from what `src/` compiles to. **Run `npm run build` and
commit `js/` whenever you change `src/`** — or CI will tell you that you
forgot.

`.nojekyll` at the root turns off Jekyll. Without it Pages runs the tree
through Jekyll on its way out, which among other things drops anything whose
name begins with an underscore — a silent 404 rather than an error.

## The game

The corner cell is yours, along with every cell touching it that shares its
color — the blob, drawn with a heavy outline so there is never a question
about what you hold. Pick a color and the whole blob becomes it. Win by
turning the board one color before the moves run out.

The difficulty is not really the board size. It is how much room you are given
over par, and the numbers behind that are measured rather than guessed:

| | Board | Colors | Given | Greedy wins |
|---|---|---|---|---|
| Easy | 7×7 | 4 | par + 2 | ~99% |
| Normal | 10×10 | 5 | par + 1 | ~79% |
| Hard | 12×12 | 6 | par + 1 | ~48% |
| Extra Hard | 14×14 | 6 | par exactly | ~4% |
| Expert | 16×16 | 6 | par exactly | ~3% |

"Greedy wins" is the share of boards you can finish by always taking whichever
color swallows the most, never thinking further ahead. Easy is meant to be
won that way — it teaches the mechanic. By Extra Hard the obvious move is
usually the wrong one, and the puzzle is finding the move that opens two
regions at once instead of the one that eats the most now.

Undo and restart are free and unlimited, which is what makes par-exact fair
rather than cruel.

**Two hints a puzzle**, on every setting. A hint names a color that is on a
best line *from wherever you have got to* — not from the board as dealt, which
is the only version worth having: three moves in, on a line the generator
never had in mind, is exactly when you want one. It costs no move, and it says
how long the best line still is, so it doubles as a way of finding out how
badly the last few moves went.

Hints are counted per puzzle, not per attempt. Undo and restart do not give
them back — hints that came back on restart would be unlimited hints with an
extra click in front of them. Dealing a new board is what resets them.

The search runs on the page, and on a 16×16 board it takes about a tenth of a
second warm and closer to half on the very first call, before anything is
compiled. Long enough that a button which simply did not respond would read as
broken, so it says *Thinking…* first — after a paint, not merely after a
`requestAnimationFrame`, which runs before one.

The daily's setting depends on the day of the week, so the week has a shape to
it: a gentle start and the two hardest settings at the weekend. A streak is
kept in `localStorage` and nowhere else, so it is per-browser and per-device,
and clearing site data clears it.

Tapping a **cell** plays that cell's color, which on a phone is much the
fastest way in — you point at the region you want rather than hunting for it
in the row of swatches. Every cell also carries its color's initial, faintly,
so the board can be read without relying on color alone; that can be turned
off in Settings.

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
- **Every board is worth playing.** No level is ever returned that `greedy`
  finishes in par. This is the test that matters most, because its absence is
  what let a game with exactly one legal move per turn get all the way to a
  deployed site with everything green behind it.
- **More than one color on the blob's edge**, averaged over real play. The
  direct measurement of the same thing, and the one that would have shown 1.00
  in the old build.
- **Agreement between `solve` and the level's own par.** A level advertising a
  par its own solver disagrees with is either promising more difficulty than
  it has or asking for something impossible.
- **Hints are real.** Not "it names a color that grows the blob" but the
  actual property: playing what the hint says must leave a board that needs
  exactly one move fewer than before. A merely plausible hint is worse than
  none, because it spends one of the two you get and can talk you off the best
  line. Following hints from the first move to the last also has to finish in
  par exactly.
- **The construction still holds where it is claimed.** With patches switched
  off a layer is one color again and the layer count *is* the answer, so the
  test walks that line one move at a time through the same code the buttons
  call and checks it wins on the last one.
- **Nothing writes back into the level it was dealt.** Restart goes back to
  the level's own grid, so a move that reached into it would leave a board
  that could not be restarted — and the bug would only show on somebody's
  second attempt at a puzzle.

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
