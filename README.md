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

Two games. **Flood** starts in one corner. **Merge** starts in two opposite
corners and one color steers both at once — they become one blob the moment
they touch.

A hundred levels of each in order, a daily puzzle that is the same board for
everybody, and random ones at five sizes. Every level is generated in the
page: nothing is fetched, nothing is stored on a server, and the whole site is
a few files of plain ES modules.

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

### Merge: two fronts, one steering wheel

The sort game's merge mode mixes colors — red and yellow make orange. That
does not port: flooding never brings two colors together as materials, so
there is nothing to mix. What does port is the *shape* of a second mode.

Merge deals two origins, in opposite corners, and a move recolors **both**.
That single rule is the whole mode, and it is the interesting one because
every choice is a compromise: the color that opens up the bottom-left front is
often the wrong one top-right. It also means the fronts always wear the same
color as each other, so they merge on contact — there is no merging step in
the code, no merged flag, no moment to get wrong. They are one region when
they touch, by the same rule that made them two.

Almost everything generalised rather than forking. `origins` is a list, of one
or two; the layer growth takes several seeds; the blob is whatever is
connected to *an* origin; the heuristic became multi-source. There is no
second code path for the two-front case, which matters because the bugs that
survive are the ones in the rarely-taken branch.

Three things did have to change, and each was found by a board refusing to
generate rather than by thinking about it:

- **Layers stopped being one region.** A front's own ring already arrives in
  pieces — the two cells beside a corner origin touch it but not each other —
  which is why the joining step exists. Joining *across* fronts would thread a
  path the width of the board, so it is off for Merge and the invariant
  relaxes to "every piece hangs off the layer below it".
- **Patches had to be cut per piece**, not per layer. Growing patch seeds
  across a layer that arrives in pieces leaves whole pieces unreached, and
  those used to be swept into one patch. A patch in nineteen pieces is not a
  patch.
- **Pocket absorption had to keep one region per front.** It kept only the
  largest, which is right with one front and catastrophic with two: once the
  fronts meet, the remaining board is genuinely in two parts and the smaller
  one was being swallowed whole into a single layer. 170 boards in 200 died
  that way.

**Merge boards are smaller than Flood's at the same difficulty name**, and
that is a cost rather than a choice. par has to be searched for, and two
fronts make the search far more expensive — see below. Measured, a two-front
13×13 took ten seconds to deal and a 15×15 over a minute. Eleven across is
where it stays under a second, so eleven across is where it stops.

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

Two fronts broke that bound's usefulness without breaking its correctness. A
region counts as near if *either* front is close to it, so the
furthest-region number collapses towards half what one front would give —
while the real difficulty goes *up*, because one color has to serve both
fronts at once. A* had almost nothing to steer by. Dealing a two-front 11×11
took twenty seconds.

Two fixes, both cheap, together about twenty times faster:

- **A second bound, from the colors.** To swallow a region of color *c* the
  blob has to *be* color *c* at the time, so every color still outside has to
  be played at least once. That count is a floor too, and the larger of two
  floors is a floor, so taking the max keeps the answer exact.
- **Break ties towards depth.** These boards have great slabs of positions
  that all look equally promising, and a tie broken the other way spreads
  across the whole slab before going anywhere. The goal only ever sits at the
  deep end.

The second one sped up ordinary one-front boards too — the test suite went
from 24 seconds to 4.

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

## The campaigns

A hundred levels each, in order, unlocking one at a time. **The first five of
each are drawn by hand** and teach one rule apiece; everything after is a
seeded deal on a board that widens as you go.

The whole campaign is a *function*, not a file. Level 87 is worked out from
the number 87, so there is no megabyte of pre-generated boards to ship, and it
deals the same board on every device and will still deal it next year. All 200
levels generate in about six seconds, which is cheap enough that **a test
deals every one of them on every push** — a level that cannot be generated is
a wall a player hits with no way past and no message worth reading.

### The five that are drawn

| Flood | Teaches |
|---|---|
| 1. Your corner | The blob is your corner plus everything touching it that matches |
| 2. One band at a time | You can only take what you are touching |
| 3. Only what touches | A color that touches nothing wastes the move |
| 4. The big one is not always right | Greedy costs you a move here — par 3, greedy 4 |
| 5. Par exactly | From here on, no moves spare |

| Merge | Teaches |
|---|---|
| 1. Two corners | You hold two corners; one color moves both |
| 2. Both at once | Every move recolors both, helpful or not |
| 3. They join when they touch | They are always the same color, so nothing is needed to merge them |
| 4. Suits one, not the other | Every move is a compromise between the ends |
| 5. Par exactly | The real game, from both corners |

Two things about these are worth knowing, because both are the kind of mistake
that would ship quietly.

**Par is not written next to the board.** It is searched for, from the board,
every time. A par typed by hand can be wrong, and it would be wrong *silently*
— the level would still play, it would just be impossible or a gift. The
boards are a few dozen cells and settle in well under a millisecond, so there
is nothing to save by trusting a number. A test then pins the expected par of
each, so an edit to a grid that changes its lesson fails rather than sliding
through.

**Flood 4 has to actually lose.** Its whole claim is that taking the biggest
patch costs a move, so a test asserts `greedy` needs 4 where par is 3. The
first version of that board did not: greedy matched par, and it was teaching
nothing while looking exactly as if it were.

The drawn boards also have to use a run of colors from the start of the
palette with no gaps — the picker shows one swatch per color in the palette,
so a hole means offering a color that appears nowhere on the board, on the
levels whose entire job is teaching what a move does. `campaign.ts` throws if
a board leaves one, and a test checks all ten.

### The ramp

Everything after level five interpolates: the board widens, the palette fills,
the construction deepens, and the moves you get over par run out — three
spare at the start, none by the end, sawing rather than sliding so the
campaign breathes. No table, because a hundred rows is a hundred chances to
fumble one and no way to see the shape.

Merge tops out at 11×11 where Flood reaches 16×16, for the same reason it does
on the Random screen: two fronts make par dear to find.

Progress is the fewest moves each level has been finished in, and the par it
was finished against, in `localStorage`. Both are stored because "done" and
"done at par" are worth telling apart — and par is stored rather than
recomputed, since working it out means *dealing* every level, which is several
seconds of work to color a grid of numbers.

## On a phone

The site is wrapped for iOS and Android with **Capacitor**, the same way the
sort game is. `android/` and `ios/` are checked in.

```
npm run sync          # rebuild js/, gather www/, and copy it into both projects
npx cap open android  # then Build > Generate Signed Bundle / APK
npx cap open ios      # then Product > Archive
```

`npm run sync` rebuilds before it copies, on purpose: running `cap sync`
against a stale `www/` ships whatever the last build left behind, silently,
and only on the phone.

**There is no IPA or APK in the repository, and there cannot be.** An `.ipa`
needs Xcode and a macOS machine plus an Apple Developer signing identity; an
`.apk` or `.aab` needs the Android SDK and a keystore. Both are signing steps
tied to accounts, which is exactly the sort of thing that should not live in a
git repository. The projects here are ready to open; the button is yours to
press.

`www/` is generated and gitignored. It exists because Capacitor copies its
`webDir` wholesale into the bundle, and this repository's web root is the
repository — pointing it there would ship the TypeScript, the tests and every
dependency inside the app.

## Fitting the screen

Nothing scrolls that should not, and nothing is ever cut off.

Those are different problems and the second is worse. A screen that scrolls at
least tells you there is more; a screen that clips just quietly has no Play
button on it. Measured across seven window sizes from a 320×568 phone to a
1280×800 desktop, the home screen was losing 216px, the calendar 46px and, in
landscape, three screens between them were hiding up to 272px of themselves.

So the lockup, the cards and the calendar are sized against the **shorter** of
the two axes — `min(9vw, 7.4vh)` rather than `9vw`, all the way down — which
is what stops a title that is fine on a tall phone from filling the screen on
the same phone turned sideways. Every screen now fits exactly at every size
tested, portrait and landscape, with one exception: a phone held sideways
(844×390) still runs about 20px over on the calendar. That one scrolls rather
than clips.

Text selection is off everywhere. None of it is text anybody wants to copy,
and a long-press selecting the word under a finger — or a drag across the
board painting half the cells — is only ever an accident.

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
| `src/levels.ts` | The five settings per game, and which puzzle today's is. |
| `src/campaign.ts` | The hand-drawn levels and the ramp behind them. |
| `android/`, `ios/` | Capacitor projects, ready to open in Android Studio and Xcode. |
| `src/palette.ts` | What a color index looks like. The generator never sees it. |
| `src/app.ts` | The browser build. |
| `src/sound.ts` | The blips. With `app.ts`, the only files in `src/` that know a DOM exists. |
| `src/cli.ts` | Deals a board and prints it to a terminal. |

`generator.ts`, `play.ts`, `levels.ts`, `campaign.ts` and `palette.ts` are all
pure — no DOM, no storage, no clock — which is the point: a React Native build
takes those five as they are and rewrites only `app.ts` and `sound.ts`. `generator.ts` in particular imports nothing at all,
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

| Flood | Board | Colors | Given | Greedy wins |
|---|---|---|---|---|
| Easy | 7×7 | 4 | par + 2 | ~99% |
| Normal | 10×10 | 5 | par + 1 | ~79% |
| Hard | 12×12 | 6 | par + 1 | ~48% |
| Extra Hard | 14×14 | 6 | par exactly | ~4% |
| Expert | 16×16 | 6 | par exactly | ~3% |

| Merge | Board | Colors | Given |
|---|---|---|---|
| Easy | 7×7 | 4 | par + 2 |
| Normal | 9×9 | 5 | par + 1 |
| Hard | 10×10 | 6 | par + 1 |
| Extra Hard | 11×11 | 6 | par exactly |
| Expert | 11×11 | 6 | par exactly |

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

### The daily

A calendar, not a button. Every day since the first has its own puzzle, and
you can go back and play any of them — the board comes from the date, so a day
from last month deals exactly what it dealt then.

The week ramps: Monday is the gentlest, Sunday the hardest, and the two games
alternate the whole way down so no two days running are the same shape. All
but one, and it cannot be helped — seven is odd, so any two-game cycle over a
week has to repeat somewhere. The repeat sits at the Sunday-to-Monday seam,
between the hardest puzzle of one week and the gentlest of the next, where it
reads least like one.

**Streaks are worked out from the days actually solved, not counted up as they
happen.** A stored counter has to be nudged at exactly the right moments —
once a day, not twice, not on a replay, and not when the clock crosses
midnight mid-puzzle — and every one of those is a chance to be wrong in a way
nobody can check. Derived, it is simply what the record says. A run ending
*yesterday* still counts, because a streak is not broken until a day passes
unplayed, and telling somebody at breakfast that their streak is zero would be
both wrong and unkind.

The record lives in `localStorage` and nowhere else, so it is per-browser and
per-device, and clearing site data clears it.

Tapping a **cell** plays that cell's color, which on a phone is much the
fastest way in — you point at the region you want rather than hunting for it
in the row of swatches.

### Sound

Four blips, ported from the sort game with the frequencies and durations
unchanged, so the two sound like each other:

| | | |
|---|---|---|
| Any button | 540 Hz triangle, 60ms | a tap |
| A move | 320–580 Hz sine, 110ms | pitch rises with how much of the board you now hold |
| A wasted or impossible move | 150 Hz sawtooth, 130ms | |
| A win | 523 · 659 · 784 · 1047, 95ms apart | |

There is not an audio file in the repository. Every sound is an oscillator and
a gain envelope, which is also why the download does not grow.

Two things in there are less obvious than they look. **The audio context is
suspended when nothing has sounded for a second and a half**, and never opened
at all while sound is off — an open output device hums audibly on a lot of
hardware with nothing playing, so a switch that only stopped the blips would
not actually be silence. And **the board and the picker are left out of the
button sound**, because a move already has a voice; the tap would double up on
top of it.

The button sound is one delegated listener rather than thirty, and it
deliberately does *not* check whether the button is disabled. A disabled
button never dispatches a click, so the check would be dead code — and worse
than dead: it runs on the way back up, and Deal and Undo both disable
themselves in their own handlers, so they looked disabled by the time the
event arrived and went silent. That was a real bug, found by counting
oscillators in a browser rather than by listening.

### Color Blind Assist

Every cell and every swatch carries its color's initial. It is on by default,
and it is not decoration.

Simulating this palette against the three common color vision deficiencies
(Viénot–Brettel–Mollon, compared in CIE Lab) says why:

| | Closest pair | ΔE |
|---|---|---|
| Normal vision | blue / purple | 36.8 |
| Protanopia | **blue / purple** | **7.5** |
| Deuteranopia | **blue / purple** | **9.2** |
| Deuteranopia | yellow / orange | 14.4 |
| Tritanopia | blue / green | 18.4 |

Below about 20 a pair is hard to tell apart; below 10 it is the same color.
Blue and purple are in play from Normal upward and in every Merge setting past
Easy, so for a red–green color blind player — around one man in twelve — those
boards are unreadable without the letters. That is the whole argument for the
default, and for drawing them to be read rather than to be tasteful: they used
to sit at half opacity, which is legible only if you already know what it
says.

The palette itself is left alone, hex for hex, because it is the sort game's
and the two are meant to look like they came from the same place. A
color-blind-safe palette is possible — the best six-color set I could find
that keeps the cartoon look scores ΔE 23.5 at worst against 7.5 — but it would
break that tie, so it is an option rather than a change.

Settings is reachable from the board as well as from the home screen, because
the moment somebody wants this switch is the moment they are looking at a
board they cannot read.

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
