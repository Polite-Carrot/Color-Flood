/* generator.ts — builds flood-fill puzzles with a known solution length.
 *
 * The board is a grid of colour indices. A move recolours the blob — the
 * connected run of same-coloured cells containing the origin — and the puzzle
 * is won when the blob is the whole board. Par is the fewest moves that does
 * it, and it is printed on the level as `moveLimit`.
 *
 * Nothing here deals a random board and hopes. A random fill is a poor puzzle
 * twice over: its par is whatever it happens to be, so the move limit has to
 * be discovered by search, and the search is the expensive part — proving a
 * board CANNOT be done in n moves means exhausting the space. So the board is
 * built backwards instead, in layers, from an answer that is known before the
 * first cell is coloured. Layer 1 is the origin, layer 2 wraps it, layer 3
 * wraps that, and the solution is simply "recolour to layer 2's colour, then
 * layer 3's, and so on". targetMoves layers out, targetMoves moves in.
 *
 * That construction is exact, not approximate, and the argument is short:
 *
 *  - A move can only absorb cells adjacent to the blob, and the only layer
 *    adjacent to the blob is the next one out — that is the invariant the
 *    growth maintains and `assertLayerInvariants` checks.
 *  - Adjacent layers never share a colour, so one move can never take two
 *    layers at once.
 *
 * So every layer costs exactly one move: the intended solution is not just A
 * solution, it is THE shortest one, and `solve` is only needed to confirm it.
 * Colours are still reused across layers that do not touch, which is what lets
 * a nine-move puzzle run on four colours.
 *
 * Pure and dependency-free on purpose — the web build and the React Native
 * build both import this file, so it must not reach for a DOM, a filesystem,
 * or Math.random. Every random draw comes from the seed. */

/* ------------------------------------------------------------------ types */

export type Level = {
  width: number;
  height: number;
  /* [row, col] of the cell the blob grows from. Row 0 is the top, so the
     bottom-left corner is [height - 1, 0]. */
  origin: [number, number];
  /* grid[row][col] — a colour index in 0..palette-1, never a CSS colour.
     Which index looks like what is the renderer's business, not this file's. */
  grid: number[][];
  palette: number;
  /* The fewest moves that finish this board, from `solve`. */
  par: number;
  /* What the player is given, which is par plus whatever slack the setting
     allows. Once a board has real decisions in it, demanding the optimal line
     every time is a different and much less pleasant game. */
  moveLimit: number;
  seed: string;
};

export type GenOptions = {
  width: number;
  height: number;
  palette: number;
  targetMoves: number;
  seed: string;
  /* Chance per layer of stranding an island two layers out. Defaults to 0. */
  strandChance?: number;
  /* Roughly how many cells to a patch. 0 or absent leaves every layer whole
     and one colour, which is the original construction: exactly targetMoves
     moves, and — as it turned out — exactly one legal move per turn. Anything
     above 0 cuts the layers up, which is what puts a choice on the board and
     what makes `par` stop being knowable without searching for it. Smaller
     patches mean more colours on the blob's edge and a harder puzzle. */
  patchSize?: number;
  /* What `solve` is allowed to come back with. A board outside the band is
     thrown away and another dealt. Only consulted when the answer is not
     already known, which is to say whenever patches or islands are in play.
     Defaults to targetMoves..targetMoves*3. */
  parBand?: [number, number];
  /* moveLimit = par + slack. Defaults to 0, which is par exactly. */
  slack?: number;
  /* Where the blob starts. Defaults to the bottom-left corner. */
  origin?: [number, number];
};

/* What `generate` works with internally, and what the tests check. The layer
   map cannot be recovered from a finished grid — two touching layers that
   reuse a colour are indistinguishable once the board is coloured — so
   anything that wants to check the construction has to be handed it. */
export type Detailed = {
  level: Level;
  /* layers[row][col] — 1-based, so layer 1 is the origin's own cell. */
  layers: number[][];
  layerCount: number;
  /* patches[row][col] — which patch each cell belongs to, and the colour each
     patch was given. With patchSize 0 there is exactly one patch per layer. */
  patches: number[][];
  patchColours: number[];
  /* What the obvious one-move-deep strategy manages, against par. A board
     where these are equal has nothing to think about and is never returned;
     this is here so a caller can see by how much thinking wins. */
  greedyMoves: number | null;
  /* How many boards were built and thrown away before this one. */
  attempts: number;
};

/* ------------------------------------------------------------------- rng */

/* A seeded PRNG, because a daily puzzle has to deal the same board for
   everybody who plays it and the same board again if they come back to it a
   month later. Seeds are strings — dates, mostly — so they are hashed to a
   32-bit state first.
   
   xmur3 for the hash and mulberry32 for the stream: both are a handful of
   integer operations, both are well past good enough for dealing puzzles, and
   neither needs anything but Math.imul. */
export type Rng = () => number;

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function rng(seed: string): Rng {
  let a = xmur3(String(seed))();
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: Rng, n: number): number {
  return Math.floor(rand() * n);
}

/* ------------------------------------------------------------- grid basics */

/* Cells are flat indices, r * width + c, everywhere inside this file. Boards
   are small but they are walked a great many times during a search, and an
   Int32Array of indices costs nothing next to an array of [r, c] pairs. */

function neighbours(i: number, w: number, h: number, out: number[]): number[] {
  out.length = 0;
  const r = (i / w) | 0;
  const c = i % w;
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
}

/* Components of the cells `member` says yes to. Used three ways: to check a
   layer is one piece, to find the ring's separate arcs so they can be joined,
   and to spot a pocket of board that has been walled off. */
function components(w: number, h: number, member: (i: number) => boolean): number[][] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  const nb: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || !member(start)) continue;
    const group: number[] = [start];
    seen[start] = 1;
    for (let q = 0; q < group.length; q++) {
      for (const j of neighbours(group[q], w, h, nb)) {
        if (!seen[j] && member(j)) {
          seen[j] = 1;
          group.push(j);
        }
      }
    }
    out.push(group);
  }
  return out;
}

/* ------------------------------------------------------------ layer growth */

/* Thrown when a board runs out of room part way through — too many layers
   asked of too few cells, or a ragged layer that swallowed more than its
   share. Not a bug and not a broken invariant: the deal is thrown back and
   the next one drawn, exactly as the sort game throws back a deal whose par
   misses the band. Private, so it can never escape `generate` as an error a
   caller has to know about. */
class Regenerate extends Error {}

/* How far out a board reaches, measured in L-bands rather than in steps.
 *
 * The bands are nested squares around the origin, so the distance that
 * matters is the Chebyshev one — the greater of the row gap and the column
 * gap, not their sum. From a corner that makes the furthest cell max(w, h) - 1
 * bands away; from the middle of a board it is a good deal less, which is why
 * this is measured rather than assumed. */
function chebFrom(origin: number, i: number, w: number): number {
  return Math.max(
    Math.abs(((i / w) | 0) - ((origin / w) | 0)),
    Math.abs((i % w) - (origin % w)),
  );
}

export function bandRadius(width: number, height: number, origin: [number, number]): number {
  const [r, c] = origin;
  return Math.max(
    Math.max(r, height - 1 - r),
    Math.max(c, width - 1 - c),
  );
}

/* Grow layer 1..layerCount outwards from `origin`.
 *
 * Each layer must contain every unassigned cell touching the layers already
 * placed — the mandatory ring — and that single rule is what buys the
 * adjacency invariant for nothing. If a cell is unassigned when layer n is
 * being built, none of its neighbours can belong to layer n-2 or earlier: it
 * would have been dragged into layer n-1 by that same rule. So a layer-n cell
 * only ever touches n-1, n and n+1, however ragged the shape gets.
 *
 * Which is the point of the extras. Rings alone give bands stepping evenly
 * out from the corner, and a board that reads as a target rather than a
 * puzzle; they also leave the first layers tiny and the last one enormous. So
 * each layer takes its ring and then grows a randomised blob beyond it, which
 * both evens out the areas and gives the boundaries some tooth.
 *
 * The extras are the only free choice here, and on a board asked for as many
 * layers as it can hold there is no freedom to spend: every layer has to be
 * exactly one band wider than the last. So each layer's extras are taken, the
 * band radius is measured, and they are handed straight back if they cost
 * depth the layers still to come are going to need. Spreading sideways is
 * free; spreading outwards is not. */
function growLayers(
  w: number,
  h: number,
  origin: number,
  layerCount: number,
  rand: Rng,
): Int32Array {
  const n = w * h;
  const layerOf = new Int32Array(n); /* 0 means not yet assigned */
  layerOf[origin] = 1;
  let free = n - 1;

  const bands = bandRadius(w, h, [(origin / w) | 0, origin % w]);
  let rad = 0; /* how many bands out the claimed board already reaches */

  const marked = new Uint8Array(n);
  const nb: number[] = [];

  for (let layer = 2; layer <= layerCount; layer++) {
    marked.fill(0);
    let size = 0;

    if (layer === layerCount) {
      /* The outermost layer takes everything that is left. It is one piece
         because the unassigned region is kept one piece at every step below. */
      for (let i = 0; i < n; i++) if (!layerOf[i]) { marked[i] = 1; size++; }
    } else {
      const toCome = layerCount - layer; /* layers after this one */
      /* Every one of those still needs a band of its own, so this layer may
         not reach past here. */
      const limit = bands - toCome;

      /* 1. the mandatory ring */
      const ring: number[] = [];
      for (let i = 0; i < n; i++) {
        if (layerOf[i]) continue;
        for (const j of neighbours(i, w, h, nb)) {
          if (layerOf[j]) { ring.push(i); marked[i] = 1; size++; break; }
        }
      }
      if (!ring.length) throw new Regenerate('no room left for layer ' + layer);

      /* 2. join the ring's arcs. A ring wraps around whatever is behind it,
         so as soon as it turns a corner it arrives in separate pieces — the
         two arms of an L meet only diagonally, and diagonal cells do not
         touch. The layer has to be one region, so the pieces are joined
         through unassigned ground. A path always exists, because the
         unassigned region is connected and the whole ring sits inside it. */
      const joins = joinPieces(w, h, layerOf, marked);
      size += joins.length;
      rad = Math.max(rad, spread(ring, origin, w), spread(joins, origin, w));

      /* 3. the ragged extras. The layer aims for an even share of whatever
         board is still unclaimed — an even share of what is LEFT, not of the
         whole board, so a layer whose ring came out fat simply takes fewer
         extras instead of eating into the layers behind it. Get this wrong in
         the other direction and the early layers swallow the board, the last
         two come out one cell each, and the closing moves of the puzzle flip
         a single square. */
      /* An even share of what is left, then thrown about a good deal. The
         spread matters more than the average: bands of the same thickness
         read as stripes however ragged their edges are, and it is a fat layer
         next to a thin one that stops the board looking ruled. It is safe to
         be greedy here because the clamps below are the real limit — this
         only says what the layer would like. */
      const want = Math.round((free / (toCome + 1)) * (0.35 + 1.5 * rand()));
      const spare = countFree(layerOf, marked) - toCome;
      const budget = Math.max(0, Math.min(want - size, spare));

      let extras = growBlob(w, h, layerOf, marked, budget, rand);

      /* 4. absorb anything walled off. A tendril that reaches a wall can cut
         a pocket of board off from the rest; left alone that pocket becomes a
         second piece of some later layer. Taken into this layer it is
         harmless — its cells touch nothing but this layer — and the
         unassigned region is one piece again for the next pass. */
      let pockets = absorbPockets(w, h, layerOf, marked);
      let reached = Math.max(rad, spread(extras, origin, w), spread(pockets, origin, w));

      /* Too far out — so give the extras back, pocket and all. The pocket is
         worth undoing with them: a walled-off pocket is usually the extras'
         own doing, so it goes when they do. */
      if (reached > limit && extras.length) {
        for (const i of extras) marked[i] = 0;
        for (const i of pockets) marked[i] = 0;
        extras = [];
        pockets = absorbPockets(w, h, layerOf, marked);
        reached = Math.max(rad, spread(pockets, origin, w));
      }

      /* Ring, joins and pockets are all forced, so if the board is still
         pushed out too far there is nothing left to hand over. Deal again. */
      if (reached > limit) {
        throw new Regenerate('layer ' + layer + ' reached band ' + reached + ', past ' + limit);
      }

      size += extras.length + pockets.length;
      rad = reached;
    }

    for (let i = 0; i < n; i++) if (marked[i]) layerOf[i] = layer;
    free -= size;

    /* Every layer still to come needs at least one cell. */
    if (layer < layerCount && free < layerCount - layer) {
      throw new Regenerate('layer ' + layer + ' left no room for the rest');
    }
  }

  return layerOf;
}

/* The furthest band any of these cells sits in. */
function spread(cells: number[], origin: number, w: number): number {
  let far = 0;
  for (const i of cells) {
    const d = chebFrom(origin, i, w);
    if (d > far) far = d;
  }
  return far;
}

function countFree(layerOf: Int32Array, marked: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < layerOf.length; i++) if (!layerOf[i] && !marked[i]) c++;
  return c;
}

/* Join the marked cells into one region by threading paths through the
   unassigned ground between them. Returns the cells that cost.

   Joining two pieces routinely joins a third — the path runs past it, or the
   piece was touching one of the two all along — so what is outstanding is
   worked out afresh each time round rather than from a list drawn up at the
   start. Walking a stale list instead means eventually looking for a piece
   that is already part of the region, finding nothing, and concluding the
   board is impossible when it is nothing of the sort. */
function joinPieces(w: number, h: number, layerOf: Int32Array, marked: Uint8Array): number[] {
  const pieces = components(w, h, (i) => marked[i] === 1);
  if (pieces.length < 2) return [];

  const n = w * h;
  const joined = new Uint8Array(n);
  const added: number[] = [];
  const nb: number[] = [];

  /* Everything marked and reachable from here, without leaving the layer. */
  function absorb(seed: number): void {
    const queue = [seed];
    joined[seed] = 1;
    for (let q = 0; q < queue.length; q++) {
      for (const j of neighbours(queue[q], w, h, nb)) {
        if (!joined[j] && marked[j]) { joined[j] = 1; queue.push(j); }
      }
    }
  }
  absorb(pieces[0][0]);

  for (;;) {
    let outstanding = -1;
    for (let i = 0; i < n && outstanding < 0; i++) if (marked[i] && !joined[i]) outstanding = i;
    if (outstanding < 0) break;

    /* Breadth-first from everything joined so far, through unassigned cells,
       until another marked cell turns up. Whatever the shortest route was
       becomes part of this layer. */
    const from = new Int32Array(n).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) if (joined[i]) { queue.push(i); from[i] = i; }

    let reached = -1;
    for (let q = 0; q < queue.length && reached < 0; q++) {
      for (const j of neighbours(queue[q], w, h, nb)) {
        if (from[j] >= 0 || layerOf[j]) continue;
        from[j] = queue[q];
        if (marked[j]) { reached = j; break; }
        queue.push(j);
      }
    }
    /* Only reachable if the unassigned region has come apart, which the
       pocket sweep is there to prevent. */
    if (reached < 0) throw new Regenerate('layer arrived in pieces that cannot be joined');

    for (let step = reached; from[step] !== step; step = from[step]) {
      if (!marked[step]) { marked[step] = 1; added.push(step); }
    }
    absorb(reached);
  }
  return added;
}

/* Randomised growth outwards from the marked cells, and the two random
   choices in it are doing different jobs.
 *
 * Taking cells off the frontier at RANDOM rather than in order is what stops
 * the growth being a queue, which would lay down an even ring and put back
 * the concentric shape the extras exist to break up.
 *
 * Starting from a HANDFUL of points on the frontier rather than all of it is
 * the more important of the two, and it took a look at a finished board to
 * see why. Grow from the whole boundary at once and every part of it creeps
 * outwards at the same rate: the layer comes out an even thickness, which is
 * a ring again however randomly the individual cells were picked. Grow from
 * three places and the layer bulges into lobes there and stays thin between
 * them — and the next layer has to wrap those lobes, so the shape compounds
 * outwards instead of being smoothed away.
 *
 * Returns the cells taken, so a caller that decides they cost too much can
 * give them back. */
function growBlob(
  w: number,
  h: number,
  layerOf: Int32Array,
  marked: Uint8Array,
  budget: number,
  rand: Rng,
): number[] {
  if (budget <= 0) return [];
  const n = w * h;
  const nb: number[] = [];
  const queued = new Uint8Array(n);

  const edge: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!marked[i]) continue;
    for (const j of neighbours(i, w, h, nb)) {
      if (!layerOf[j] && !marked[j] && !queued[j]) { queued[j] = 1; edge.push(j); }
    }
  }

  /* One lobe per twenty cells of budget, between two and five of them. Fewer
     than two and a thin layer is a single blister on one side; more than five
     on a big board and they merge back into the even ring. */
  const lobes = Math.max(2, Math.min(5, Math.round(budget / 20) + 2));
  const frontier: number[] = [];
  queued.fill(0);
  for (let k = 0; k < lobes && edge.length; k++) {
    const pick = randInt(rand, edge.length);
    const cell = edge[pick];
    edge[pick] = edge[edge.length - 1];
    edge.pop();
    queued[cell] = 1;
    frontier.push(cell);
  }

  const taken: number[] = [];
  while (taken.length < budget && frontier.length) {
    const pick = randInt(rand, frontier.length);
    const cell = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    if (marked[cell] || layerOf[cell]) continue;
    marked[cell] = 1;
    taken.push(cell);
    for (const j of neighbours(cell, w, h, nb)) {
      if (!layerOf[j] && !marked[j] && !queued[j]) { queued[j] = 1; frontier.push(j); }
    }
  }
  return taken;
}

/* Take every walled-off pocket of unassigned board into this layer, leaving
   the largest region — the one the next layer grows into — alone. */
function absorbPockets(w: number, h: number, layerOf: Int32Array, marked: Uint8Array): number[] {
  const left = components(w, h, (i) => !layerOf[i] && !marked[i]);
  if (left.length < 2) return [];

  let biggest = 0;
  for (let k = 1; k < left.length; k++) if (left[k].length > left[biggest].length) biggest = k;

  const added: number[] = [];
  for (let k = 0; k < left.length; k++) {
    if (k === biggest) continue;
    for (const i of left[k]) { marked[i] = 1; added.push(i); }
  }
  return added;
}

/* ----------------------------------------------------------------- patches */

/* Layers are the board's shape. Patches are what you actually play against.
 *
 * The first version of this game gave every layer one colour, and it was not
 * a game. The layer invariant says a layer only ever touches the layers
 * either side of it, so the blob — always exactly layers 1..n — had exactly
 * one layer on its edge, in exactly one colour. One legal move, every turn,
 * on every board. Measured across the five difficulties, the number of
 * colours touching the blob averaged 1.00, 1.00, 1.04, 1.08 and 1.11, and a
 * strategy that never looked further than one move ahead finished every board
 * of every difficulty in par. The exactness of par and the absence of any
 * decision were the same property, so no amount of tuning was going to fix
 * it — the layer had to stop being one colour.
 *
 * So each layer is cut into a few connected patches and the patches are
 * coloured so that no two touching ones match. Now the blob's edge carries
 * two, three, four colours, taking one patch does not take its neighbours,
 * and the order matters: a patch of layer n+1 becomes reachable the moment
 * the layer-n patch beside it is absorbed, so the layers interleave instead
 * of falling like dominoes.
 *
 * What it costs is the exact par. When a layer was one colour the answer was
 * the layer count and no search was needed; now the answer is whatever `solve`
 * says, and boards whose answer lands outside the band asked for are thrown
 * back — along with any board `greedy` can finish in par, which is the check
 * that the whole of this section exists to pass. */

type Patches = {
  /* patchAt[cell] — which patch each cell belongs to. */
  patchAt: Int32Array;
  /* Which layer each patch was cut from, and what colour it ended up. */
  layerOfPatch: number[];
  colours: number[];
  count: number;
};

/* Cut every layer into patches of roughly `patchSize` cells. A patchSize of 0
   leaves each layer whole, which is the original single-colour construction
   and still what the CLI deals by default. */
function splitIntoPatches(
  w: number,
  h: number,
  layerOf: Int32Array,
  layerCount: number,
  patchSize: number,
  rand: Rng,
): Patches {
  const n = w * h;
  const patchAt = new Int32Array(n).fill(-1);
  const layerOfPatch: number[] = [];
  let count = 0;
  const nb: number[] = [];

  for (let layer = 1; layer <= layerCount; layer++) {
    const cells: number[] = [];
    for (let i = 0; i < n; i++) if (layerOf[i] === layer) cells.push(i);
    if (!cells.length) throw new Error('layer ' + layer + ' is empty');

    const wanted = patchSize > 0
      ? Math.max(1, Math.min(cells.length, Math.round(cells.length / patchSize)))
      : 1;

    if (wanted === 1) {
      const id = count++;
      layerOfPatch.push(layer);
      for (const i of cells) patchAt[i] = id;
      continue;
    }

    /* Seeds spread as far apart as the layer allows: take one at random, then
       repeatedly take whichever cell is furthest from every seed so far,
       measuring distance THROUGH the layer rather than across the board. Seeds
       picked at random instead cluster, and a clustered seed produces a patch
       of two cells beside one of thirty. */
    const seeds: number[] = [cells[randInt(rand, cells.length)]];
    const far = new Int32Array(n).fill(-1);
    while (seeds.length < wanted) {
      far.fill(-1);
      const queue = seeds.slice();
      for (const sd of seeds) far[sd] = 0;
      for (let q = 0; q < queue.length; q++) {
        for (const j of neighbours(queue[q], w, h, nb)) {
          if (far[j] >= 0 || layerOf[j] !== layer) continue;
          far[j] = far[queue[q]] + 1;
          queue.push(j);
        }
      }
      let pick = -1;
      let best = 0;
      for (const i of cells) if (far[i] > best) { best = far[i]; pick = i; }
      if (pick < 0) break; /* every cell already a seed */
      seeds.push(pick);
    }

    /* Grow them together, a cell each in turn, so the patches come out
       comparable in size rather than the first one taking the layer. */
    const ids = seeds.map(() => { layerOfPatch.push(layer); return count++; });
    const fronts: number[][] = seeds.map((sd, k) => { patchAt[sd] = ids[k]; return [sd]; });
    let placed = seeds.length;
    while (placed < cells.length) {
      let moved = false;
      for (let k = 0; k < fronts.length; k++) {
        const front = fronts[k];
        while (front.length) {
          const cell = front[randInt(rand, front.length)];
          const at = front.indexOf(cell);
          front[at] = front[front.length - 1];
          front.pop();
          let took = false;
          for (const j of neighbours(cell, w, h, nb)) {
            if (patchAt[j] >= 0 || layerOf[j] !== layer) continue;
            patchAt[j] = ids[k];
            front.push(j);
            placed++;
            took = true;
            break;
          }
          if (took) { front.push(cell); moved = true; break; }
        }
      }
      /* Nothing grew: whatever is left cannot be reached from any seed, which
         cannot happen while layers are connected. Belt and braces. */
      if (!moved) break;
    }
    for (const i of cells) if (patchAt[i] < 0) patchAt[i] = ids[0];
  }

  return { patchAt, layerOfPatch, colours: [], count };
}

/* Colour the patches so no two that touch match.
 *
 * Touching patches have to differ or they are not two patches — they would
 * merge into one region and one move would take both, which is the thing this
 * is here to prevent. Patches that do NOT touch are free to share, which is
 * what lets a board of forty patches run on five colours.
 *
 * Ordinary greedy graph colouring, in a random order, choosing at random from
 * whatever is still allowed. The board's patch graph is planar, so five
 * colours always suffice and four nearly always do; below that it can genuinely
 * get stuck, and a stuck board is dealt again rather than fudged. */
function colourPatches(
  w: number,
  h: number,
  patches: Patches,
  palette: number,
  rand: Rng,
): number[] {
  if (palette < 2) throw new Error('palette must be at least 2 — touching patches have to differ');

  const n = w * h;
  const nb: number[] = [];
  const touching: Set<number>[] = [];
  for (let p = 0; p < patches.count; p++) touching.push(new Set<number>());
  for (let i = 0; i < n; i++) {
    for (const j of neighbours(i, w, h, nb)) {
      const a = patches.patchAt[i];
      const b = patches.patchAt[j];
      if (a !== b) { touching[a].add(b); touching[b].add(a); }
    }
  }

  const order: number[] = [];
  for (let p = 0; p < patches.count; p++) order.push(p);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  const colours = new Array<number>(patches.count).fill(-1);
  const used = new Uint8Array(palette);
  for (const p of order) {
    const taken = new Set<number>();
    for (const q of touching[p]) if (colours[q] >= 0) taken.add(colours[q]);

    const free: number[] = [];
    for (let c = 0; c < palette; c++) if (!taken.has(c)) free.push(c);
    if (!free.length) throw new Regenerate('patch ' + p + ' has no colour left');

    /* Prefer a colour nothing has used yet, so a six-colour board shows six
       colours rather than settling on the first three. */
    const fresh = free.filter((c) => !used[c]);
    const pool = fresh.length ? fresh : free;
    colours[p] = pool[randInt(rand, pool.length)];
    used[colours[p]] = 1;
  }
  return colours;
}

/* --------------------------------------------------------------- invariant */

/* The construction is only worth anything if it actually held, so it is
   checked rather than trusted. Both halves matter: a layer that arrived in
   two pieces means the growth's bookkeeping is wrong, and a cell touching a
   layer two away means a move could jump a layer and par is not par. Either
   is a bug in this file, so it throws rather than dealing again. */
export function assertLayerInvariants(
  width: number,
  height: number,
  layers: number[][],
  layerCount: number,
): void {
  const w = width;
  const h = height;
  const flat = new Int32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) flat[r * w + c] = layers[r][c];

  for (let layer = 1; layer <= layerCount; layer++) {
    const pieces = components(w, h, (i) => flat[i] === layer);
    if (pieces.length === 0) throw new Error('layer ' + layer + ' is empty');
    if (pieces.length > 1) {
      throw new Error('layer ' + layer + ' is in ' + pieces.length + ' pieces, not one region');
    }
  }

  const nb: number[] = [];
  for (let i = 0; i < w * h; i++) {
    for (const j of neighbours(i, w, h, nb)) {
      const gap = Math.abs(flat[i] - flat[j]);
      if (gap > 1) {
        const r = (i / w) | 0;
        throw new Error(
          'layer ' + flat[i] + ' at [' + r + ',' + (i % w) + '] touches layer ' + flat[j] +
          ' — a move could jump a layer',
        );
      }
    }
  }
}

/* Patches have their own two things to be true, and both would show up as a
   puzzle that is wrong rather than as a crash. A patch in two pieces is two
   patches wearing one name, and the second piece is unreachable board. Two
   touching patches sharing a colour are one region, so a move takes both and
   par is lower than the search was told. */
export function assertPatchInvariants(
  width: number,
  height: number,
  patchAt: number[][],
  colours: number[],
): void {
  const w = width;
  const h = height;
  const flat = new Int32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) flat[r * w + c] = patchAt[r][c];

  const counted = new Set<number>(Array.from(flat));
  for (const p of counted) {
    const pieces = components(w, h, (i) => flat[i] === p);
    if (pieces.length > 1) {
      throw new Error('patch ' + p + ' is in ' + pieces.length + ' pieces, not one region');
    }
  }

  const nb: number[] = [];
  for (let i = 0; i < w * h; i++) {
    for (const j of neighbours(i, w, h, nb)) {
      if (flat[i] === flat[j]) continue;
      if (colours[flat[i]] === colours[flat[j]]) {
        const r = (i / w) | 0;
        throw new Error(
          'patches ' + flat[i] + ' and ' + flat[j] + ' touch at [' + r + ',' + (i % w) +
          '] and share colour ' + colours[flat[i]] + ' — they are one region, not two',
        );
      }
    }
  }
}

/* --------------------------------------------------------------- stranding */

/* An island of an earlier layer's colour, dropped inside the interior of a
   later one. The player reaches it with the board already conquered around
   it and has to spend a move going back for it, so it is the one thing here
   that lengthens the solution beyond the layer count.
   
   The colour is copied out of layer n rather than cut out of it: taking cells
   away from a layer can break it into two pieces or strand its own
   neighbours, and the repair is worth more than the difficulty is. Copying
   leaves the layer structure exactly as it was built and asserted — the
   island is a lie told to the grid, not to the layers, which is why `solve`
   has the last word on par whenever any of this runs.
   
   Only interior cells are repainted: a cell whose four neighbours are all the
   same layer. An island touching the edge of its layer would be picked up by
   the ordinary sweep and cost nothing. */
function strand(
  w: number,
  h: number,
  layerOf: Int32Array,
  grid: Int32Array,
  layerCount: number,
  chance: number,
  rand: Rng,
): number {
  if (chance <= 0) return 0;
  const nb: number[] = [];
  let islands = 0;

  for (let layer = 2; layer + 2 <= layerCount; layer++) {
    if (rand() >= chance) continue;
    const host = layer + 2;

    /* Interior cells of the host layer: every neighbour in the same layer,
       and not against the board's edge, which has fewer than four neighbours
       and so is never interior however its neighbours are coloured. */
    const interior: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (layerOf[i] !== host) continue;
      const r = (i / w) | 0;
      const c = i % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) continue;
      let inside = true;
      for (const j of neighbours(i, w, h, nb)) if (layerOf[j] !== host) { inside = false; break; }
      if (inside) interior.push(i);
    }
    if (!interior.length) continue;

    const seed = interior[randInt(rand, interior.length)];
    /* The island wears a colour from two layers back. Taken off the grid
       rather than off a per-layer list, because a layer is not one colour any
       more — it is however many patches were cut from it. */
    const wearing: number[] = [];
    for (let i = 0; i < w * h; i++) if (layerOf[i] === layer) wearing.push(grid[i]);
    const colour = wearing[randInt(rand, wearing.length)];
    /* Same colour as its host is no island at all — it is invisible and free. */
    if (colour === grid[seed]) continue;

    /* One to three cells: enough to be worth a move, small enough that it
       cannot cut its host in half. */
    const want = 1 + randInt(rand, 3);
    const clump: number[] = [seed];
    const inClump = new Set(clump);
    for (let q = 0; q < clump.length && clump.length < want; q++) {
      for (const j of neighbours(clump[q], w, h, nb)) {
        if (clump.length >= want) break;
        if (!inClump.has(j) && interior.includes(j) && grid[j] !== colour) {
          inClump.add(j);
          clump.push(j);
        }
      }
    }
    for (const i of clump) grid[i] = colour;
    islands++;
  }
  return islands;
}

/* ------------------------------------------------------------------- solve */

/* Regions: the board seen as blocks of one colour rather than as cells.
 *
 * Everything the search needs is here. A move absorbs whole regions, never
 * parts of them, so the region graph is the board at the resolution the game
 * is actually played at — a 16×16 board of 256 cells is usually forty or
 * fifty regions. And the distance through that graph is what makes the search
 * finish: a region three colour-changes away from the blob cannot be reached
 * in fewer than three moves, whatever else happens. */
type Regions = {
  /* regionAt[cell] — which region each cell belongs to. */
  regionAt: Int32Array;
  colours: number[];
  sizes: number[];
  /* neighbours[r] — the regions touching region r. */
  neighbours: number[][];
  count: number;
};

function regionsOf(g: Uint8Array, w: number, h: number): Regions {
  const n = w * h;
  const regionAt = new Int32Array(n).fill(-1);
  const colours: number[] = [];
  const sizes: number[] = [];
  const neighbours: number[][] = [];
  const nb: number[] = [];
  const queue = new Int32Array(n);

  let count = 0;
  for (let seed = 0; seed < n; seed++) {
    if (regionAt[seed] >= 0) continue;
    const colour = g[seed];
    const id = count++;
    regionAt[seed] = id;
    let size = 1;
    queue[0] = seed;
    for (let q = 0; q < size; q++) {
      for (const j of neighbours2(queue[q], w, h, nb)) {
        if (regionAt[j] < 0 && g[j] === colour) { regionAt[j] = id; queue[size++] = j; }
      }
    }
    colours.push(colour);
    sizes.push(size);
    neighbours.push([]);
  }

  /* Edges, once each. */
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const a = regionAt[i];
    for (const j of neighbours2(i, w, h, nb)) {
      const b = regionAt[j];
      if (a === b) continue;
      const key = a < b ? a * count + b : b * count + a;
      if (seen.has(key)) continue;
      seen.add(key);
      neighbours[a].push(b);
      neighbours[b].push(a);
    }
  }

  return { regionAt, colours, sizes, neighbours, count };
}

/* A copy of `neighbours` under another name, because `neighbours` is already
   taken by the region field above and shadowing it inside these functions was
   a bug waiting to be written. */
function neighbours2(i: number, w: number, h: number, out: number[]): number[] {
  return neighbours(i, w, h, out);
}

/* The fewest moves that could possibly still be needed, never more.
 *
 * Walk the region graph out from the blob and take the furthest region: each
 * move pulls the blob one step along that graph at best, so a region five
 * steps out needs at least five more moves. Being a lower bound and never an
 * overestimate is what keeps A*'s answer exactly optimal rather than merely
 * good. */
function stillToGo(regions: Regions, blobRegion: number): number {
  const dist = new Int32Array(regions.count).fill(-1);
  dist[blobRegion] = 0;
  const queue = [blobRegion];
  let far = 0;
  for (let q = 0; q < queue.length; q++) {
    const d = dist[queue[q]] + 1;
    for (const j of regions.neighbours[queue[q]]) {
      if (dist[j] >= 0) continue;
      dist[j] = d;
      if (d > far) far = d;
      queue.push(j);
    }
  }
  return far;
}

/* A binary heap, because A* wants the cheapest node next and a sorted array
   costs more than the search saves. */
class Heap {
  private f: number[] = [];
  private items: Array<{ g: number; grid: Uint8Array; first: number }> = [];

  get size(): number { return this.f.length; }

  push(f: number, g: number, grid: Uint8Array, first: number): void {
    this.f.push(f);
    this.items.push({ g, grid, first });
    let i = this.f.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.f[parent] <= this.f[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { g: number; grid: Uint8Array; first: number } {
    const top = this.items[0];
    const lastF = this.f.pop() as number;
    const lastItem = this.items.pop() as { g: number; grid: Uint8Array; first: number };
    if (this.f.length) {
      this.f[0] = lastF;
      this.items[0] = lastItem;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let small = i;
        if (l < this.f.length && this.f[l] < this.f[small]) small = l;
        if (r < this.f.length && this.f[r] < this.f[small]) small = r;
        if (small === i) break;
        this.swap(i, small);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const f = this.f[a]; this.f[a] = this.f[b]; this.f[b] = f;
    const it = this.items[a]; this.items[a] = this.items[b]; this.items[b] = it;
  }
}

/* Fewest moves from where the board stands. Exactly fewest, not nearly.
 *
 * A* over positions, ordered by moves-so-far plus the lower bound above, and
 * memoised on the board itself so a position reached two ways is expanded
 * once. It was a plain breadth-first search when every layer was a single
 * colour, because then only one move ever did anything and there was nothing
 * to search. Splitting the layers put two to four colours on the blob's edge
 * at a time, and breadth-first went from settling a board in a few hundred
 * states to not settling it at all.
 *
 * The one pruning rule: only colours already touching the blob are worth
 * playing. Recolouring to anything else cannot grow the blob, so the move
 * changes nothing but the blob's own colour — and whatever you meant to play
 * next, you could have played instead.
 *
 * Returns null rather than a number if the cap is reached. */
function search(level: Level, cap: number): { moves: number; first: number } | null {
  const w = level.width;
  const h = level.height;
  const n = w * h;
  const origin = level.origin[0] * w + level.origin[1];

  const start = new Uint8Array(n);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) start[r * w + c] = level.grid[r][c];

  const key = (g: Uint8Array) => String.fromCharCode.apply(null, Array.from(g));

  const first = regionsOf(start, w, h);
  /* Already one colour: no moves needed and so no move to name. */
  if (first.count === 1) return { moves: 0, first: -1 };

  const heap = new Heap();
  const best = new Map<string, number>();
  heap.push(stillToGo(first, first.regionAt[origin]), 0, start, -1);
  best.set(key(start), 0);

  let states = 1;
  while (heap.size) {
    const { g, grid, first: opener } = heap.pop();
    const regions = regionsOf(grid, w, h);
    const blob = regions.regionAt[origin];

    if (regions.count === 1) return { moves: g, first: opener };
    /* A stale heap entry: this board was reached more cheaply after it was
       queued. */
    const seen = best.get(key(grid));
    if (seen !== undefined && seen < g) continue;

    const playable = new Set<number>();
    for (const j of regions.neighbours[blob]) playable.add(regions.colours[j]);

    for (const colour of playable) {
      const next = grid.slice();
      for (let i = 0; i < n; i++) if (regions.regionAt[i] === blob) next[i] = colour;

      const k = key(next);
      const had = best.get(k);
      if (had !== undefined && had <= g + 1) continue;
      if (++states > cap) return null;
      best.set(k, g + 1);

      const after = regionsOf(next, w, h);
      /* Every node remembers which move opened its line, so reaching the goal
         answers "what should I play now" as well as "how many". Carrying one
         number is cheaper than keeping every parent and walking back. */
      heap.push(g + 1 + stillToGo(after, after.regionAt[origin]), g + 1, next,
                g === 0 ? colour : opener);
    }
  }
  return null;
}

export function solve(level: Level, cap: number = 200000): number | null {
  const found = search(level, cap);
  return found ? found.moves : null;
}

/* What to play from here, and how many moves are left after it.
 *
 * The same search, asked for the move rather than the count. There is usually
 * more than one optimal move and this names one of them, not "the" one — a
 * hint that disagreed with a line the player had already found would be worse
 * than no hint at all, so the wording it feeds says a move rather than the
 * move.
 *
 * Null if the board is already finished, or if the search hit its cap. */
export function bestMove(
  level: Level,
  cap: number = 200000,
): { colour: number; moves: number } | null {
  const found = search(level, cap);
  if (!found || found.first < 0) return null;
  return { colour: found.first, moves: found.moves };
}

/* How many moves the most obvious possible strategy takes: at every turn play
 * whichever colour on the blob's edge swallows the most board, and never look
 * further ahead than that.
 *
 * This exists to be BEATEN. A puzzle that greedy finishes in par is a puzzle
 * with nothing to think about — you can play it without ever looking past the
 * cells you are touching — and the generator throws those away rather than
 * shipping them. It was worth writing precisely because the first version of
 * this game failed that test on every board of every difficulty, and nothing
 * else in the codebase noticed. */
export function greedy(level: Level, limit: number = 200): number | null {
  const w = level.width;
  const h = level.height;
  const n = w * h;
  const origin = level.origin[0] * w + level.origin[1];

  const grid = new Uint8Array(n);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) grid[r * w + c] = level.grid[r][c];

  for (let moves = 0; moves < limit; moves++) {
    const regions = regionsOf(grid, w, h);
    if (regions.count === 1) return moves;
    const blob = regions.regionAt[origin];

    /* How much each playable colour would take, counted over whole regions. */
    const gain = new Map<number, number>();
    for (const j of regions.neighbours[blob]) {
      const c = regions.colours[j];
      gain.set(c, (gain.get(c) ?? 0) + regions.sizes[j]);
    }

    let pick = -1;
    let most = -1;
    /* Ties go to the lower colour index, so this is one strategy and not a
       family of them — a tie broken at random would make the gate it feeds
       non-deterministic. */
    for (const [colour, size] of [...gain.entries()].sort((a, b) => a[0] - b[0])) {
      if (size > most) { most = size; pick = colour; }
    }
    if (pick < 0) return null;

    for (let i = 0; i < n; i++) if (regions.regionAt[i] === blob) grid[i] = pick;
  }
  return null;
}

/* ---------------------------------------------------------------- generate */

/* How many boards may be built and thrown away before giving up. Only two
   things throw one back — a layer that ran the board out of room, and, when
   stranding is on, a par that landed outside the band asked for — and neither
   is common, so the ceiling is only there so a bad set of options fails
   loudly instead of hanging. */
const MAX_ATTEMPTS = 200;

export function generateDetailed(opts: GenOptions): Detailed {
  const { width, height, palette, targetMoves, seed } = opts;
  const strandChance = opts.strandChance ?? 0;
  const patchSize = opts.patchSize ?? 0;
  const slack = opts.slack ?? 0;
  const parBand = opts.parBand ?? [targetMoves, targetMoves * 3];

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('width and height must be whole numbers of at least 2');
  }
  if (!Number.isInteger(targetMoves) || targetMoves < 1) {
    throw new Error('targetMoves must be a whole number of at least 1');
  }
  if (!Number.isInteger(palette) || palette < 2) {
    throw new Error('palette must be a whole number of at least 2');
  }
  if (typeof seed !== 'string' || !seed.length) throw new Error('seed must be a non-empty string');
  if (strandChance < 0 || strandChance > 1) throw new Error('strandChance must be between 0 and 1');
  if (patchSize < 0) throw new Error('patchSize must not be negative');
  if (slack < 0) throw new Error('slack must not be negative');

  const layerCount = targetMoves + 1;

  const origin: [number, number] = opts.origin ?? [height - 1, 0];
  if (origin[0] < 0 || origin[0] >= height || origin[1] < 0 || origin[1] >= width) {
    throw new Error('origin is off the board');
  }

  /* The most layers a board can hold, and it is not the diagonal count you
     would expect. A ring at a fixed distance from the origin is an
     anti-diagonal, and cells on an anti-diagonal touch each other only at
     their corners — so a ring is not a connected region, and a layer has to
     be thicker than one to be one. What IS connected is the L-shaped band:
     the cells a fixed Chebyshev distance out, an arm across and an arm up,
     meeting at the corner. Nested bands fill a board from a corner in
     max(w, h) of them, and from the middle in rather fewer, which is why the
     count is taken from where the blob actually starts.

     A lucky board sometimes squeezes out one more. It is not offered: a
     generator dealing a campaign has to be predictable about what it accepts,
     and "sometimes" is worse than one fewer. */
  const ceiling = bandRadius(width, height, origin);
  if (targetMoves > ceiling) {
    throw new Error(
      targetMoves + ' moves needs ' + layerCount + ' layers, and a ' + width + '×' + height +
      ' board from [' + origin[0] + ',' + origin[1] + '] holds at most ' + (ceiling + 1) +
      ' — try ' + ceiling + ' moves or a bigger board',
    );
  }

  const rand = rng(seed);
  const w = width;
  const h = height;
  const originIdx = origin[0] * w + origin[1];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let layerOf: Int32Array;
    let patches: Patches;
    let patchColours: number[];
    try {
      layerOf = growLayers(w, h, originIdx, layerCount, rand);
      patches = splitIntoPatches(w, h, layerOf, layerCount, patchSize, rand);
      patchColours = colourPatches(w, h, patches, palette, rand);
    } catch (err) {
      if (err instanceof Regenerate) continue;
      throw err;
    }

    const layers: number[][] = [];
    const patchGrid: number[][] = [];
    for (let r = 0; r < h; r++) {
      const layerRow: number[] = [];
      const patchRow: number[] = [];
      for (let c = 0; c < w; c++) {
        layerRow.push(layerOf[r * w + c]);
        patchRow.push(patches.patchAt[r * w + c]);
      }
      layers.push(layerRow);
      patchGrid.push(patchRow);
    }
    assertLayerInvariants(w, h, layers, layerCount);
    assertPatchInvariants(w, h, patchGrid, patchColours);

    const flat = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) flat[i] = patchColours[patches.patchAt[i]];

    const islands = strand(w, h, layerOf, flat, layerCount, strandChance, rand);

    const grid: number[][] = [];
    for (let r = 0; r < h; r++) {
      const row: number[] = [];
      for (let c = 0; c < w; c++) row.push(flat[r * w + c]);
      grid.push(row);
    }

    const level: Level = {
      width, height, origin, grid, palette,
      par: targetMoves, moveLimit: targetMoves, seed,
    };

    /* One layer per move only holds while a layer is one colour and nothing
       has been hidden inside a later one. Either of those and the
       construction has stopped being the answer, so the search becomes it. */
    if (patchSize > 0 || islands) {
      const par = solve(level);
      if (par === null || par < parBand[0] || par > parBand[1]) continue;
      level.par = par;
    }
    level.moveLimit = level.par + slack;

    /* And the gate the whole patch business exists to pass. A board the
       one-move-deep strategy finishes in par is a board you can play without
       ever looking past the cells you are touching — which is not a puzzle,
       however good it looks. Thinking has to be worth something. */
    const greedyMoves = greedy(level);
    if (patchSize > 0 && (greedyMoves === null || greedyMoves <= level.par)) continue;

    return {
      level, layers, layerCount,
      patches: patchGrid, patchColours,
      greedyMoves, attempts: attempt,
    };
  }

  throw new Error(
    'gave up after ' + MAX_ATTEMPTS + ' boards for seed "' + seed + '" — ' +
    targetMoves + ' moves on ' + width + '×' + height + ' with ' + palette + ' colours',
  );
}

export function generate(opts: GenOptions): Level {
  return generateDetailed(opts).level;
}
