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
  moveLimit: number;
  seed: string;
};

export type GenOptions = {
  width: number;
  height: number;
  palette: number;
  targetMoves: number;
  seed: string;
  /* Chance per layer of stranding an island two layers out. Costs the player
     extra moves, so it is the one setting that makes moveLimit differ from
     targetMoves. Defaults to 0. */
  strandChance?: number;
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
  /* colours[n] is the colour index of layer n; colours[0] is unused. */
  colours: number[];
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
      const want = Math.round((free / (toCome + 1)) * (0.6 + 0.8 * rand()));
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

/* Randomised growth outwards from the marked cells: pick a cell off the
   frontier at random, take it, and push its own free neighbours on. Picking at
   random rather than in order is what makes the boundary ragged — a queue
   grows an even ring back again. Returns the cells taken, so a caller that
   decides they cost too much can give them back. */
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
  const frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!marked[i]) continue;
    for (const j of neighbours(i, w, h, nb)) {
      if (!layerOf[j] && !marked[j] && !queued[j]) { queued[j] = 1; frontier.push(j); }
    }
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

/* ----------------------------------------------------------------- colours */

/* One colour per layer. Touching layers must differ or a move would take two
   layers at once and par would be a lie; layers two apart are kept apart as
   well where the palette can afford it, because A-B-A-B-A reads as stripes
   rather than as a board. Unused colours are preferred while any remain, so a
   six-colour puzzle actually shows six colours. */
function assignColours(layerCount: number, palette: number, rand: Rng): number[] {
  if (palette < 2) throw new Error('palette must be at least 2 — touching layers have to differ');

  const colours = new Array<number>(layerCount + 1).fill(-1);
  const used = new Uint8Array(palette);

  for (let layer = 1; layer <= layerCount; layer++) {
    const banned = layer > 1 ? colours[layer - 1] : -1;
    const disliked = layer > 2 ? colours[layer - 2] : -1;

    let pool = allowed(palette, banned, disliked);
    if (!pool.length) pool = allowed(palette, banned, -1);

    const fresh = pool.filter((c) => !used[c]);
    const pick = fresh.length ? fresh : pool;
    colours[layer] = pick[randInt(rand, pick.length)];
    used[colours[layer]] = 1;
  }
  return colours;
}

function allowed(palette: number, banned: number, disliked: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < palette; c++) if (c !== banned && c !== disliked) out.push(c);
  return out;
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
  colours: number[],
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
    /* Two layers apart may share a colour on a small palette, and then the
       island is invisible and free. */
    if (colours[layer] === colours[host]) continue;

    const interior: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (layerOf[i] !== host || grid[i] !== colours[host]) continue;
      let inside = true;
      for (const j of neighbours(i, w, h, nb)) if (layerOf[j] !== host) { inside = false; break; }
      /* A cell on the board's own edge has fewer than four neighbours and is
         not interior however its neighbours are coloured. */
      const r = (i / w) | 0;
      const c = i % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) inside = false;
      if (inside) interior.push(i);
    }
    if (!interior.length) continue;

    /* One to three cells: enough to be worth a move, small enough that it
       cannot cut its host layer in half. */
    const want = 1 + randInt(rand, 3);
    const clump: number[] = [interior[randInt(rand, interior.length)]];
    const inClump = new Set(clump);
    for (let q = 0; q < clump.length && clump.length < want; q++) {
      for (const j of neighbours(clump[q], w, h, nb)) {
        if (clump.length >= want) break;
        if (!inClump.has(j) && interior.includes(j)) { inClump.add(j); clump.push(j); }
      }
    }
    for (const i of clump) grid[i] = colours[layer];
    islands++;
  }
  return islands;
}

/* ------------------------------------------------------------------- solve */

/* Fewest moves from where the board stands, by breadth-first search over
   positions, memoised on the grid itself so a position reached two ways is
   only expanded once.
   
   The one pruning rule: only colours already touching the blob are worth
   playing. Recolouring to anything else cannot grow the blob, so the move
   changes nothing but the blob's own colour — and whatever you were going to
   play next, you could have played instead. It can never come out ahead, and
   dropping it is what keeps the branching down to the handful of colours on
   the blob's edge rather than the whole palette.
   
   Returns null rather than a number if the cap is reached. Boards from
   `generate` are settled in a few hundred states; the cap is there for a
   board handed in from somewhere else. */
export function solve(level: Level, cap: number = 200000): number | null {
  const w = level.width;
  const h = level.height;
  const n = w * h;
  const origin = level.origin[0] * w + level.origin[1];

  const start = new Uint8Array(n);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) start[r * w + c] = level.grid[r][c];

  const nb: number[] = [];
  const blobCells = new Int32Array(n);
  const inBlob = new Uint8Array(n);

  /* Fills blobCells with the blob and returns its size, leaving inBlob set
     for the caller to read and then clear. */
  function flood(g: Uint8Array): number {
    inBlob.fill(0);
    const colour = g[origin];
    blobCells[0] = origin;
    inBlob[origin] = 1;
    let size = 1;
    for (let q = 0; q < size; q++) {
      for (const j of neighbours(blobCells[q], w, h, nb)) {
        if (!inBlob[j] && g[j] === colour) { inBlob[j] = 1; blobCells[size++] = j; }
      }
    }
    return size;
  }

  if (flood(start) === n) return 0;

  let states = 1;
  const seen = new Set<string>([String.fromCharCode.apply(null, Array.from(start))]);
  let frontier: Uint8Array[] = [start];

  for (let depth = 1; frontier.length; depth++) {
    const next: Uint8Array[] = [];
    for (const g of frontier) {
      const size = flood(g);
      const colour = g[origin];

      const edge: number[] = [];
      for (let q = 0; q < size; q++) {
        for (const j of neighbours(blobCells[q], w, h, nb)) {
          if (!inBlob[j] && g[j] !== colour && edge.indexOf(g[j]) < 0) edge.push(g[j]);
        }
      }
      /* Read the blob out before the next flood overwrites it. */
      const cells = blobCells.slice(0, size);

      for (const c of edge) {
        const g2 = g.slice();
        for (let q = 0; q < size; q++) g2[cells[q]] = c;

        let uniform = true;
        for (let i = 0; i < n; i++) if (g2[i] !== c) { uniform = false; break; }
        if (uniform) return depth;

        const key = String.fromCharCode.apply(null, Array.from(g2));
        if (seen.has(key)) continue;
        if (++states > cap) return null;
        seen.add(key);
        next.push(g2);
      }
    }
    frontier = next;
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
    try {
      layerOf = growLayers(w, h, originIdx, layerCount, rand);
    } catch (err) {
      if (err instanceof Regenerate) continue;
      throw err;
    }

    const layers: number[][] = [];
    for (let r = 0; r < h; r++) {
      const row: number[] = [];
      for (let c = 0; c < w; c++) row.push(layerOf[r * w + c]);
      layers.push(row);
    }
    assertLayerInvariants(w, h, layers, layerCount);

    const colours = assignColours(layerCount, palette, rand);
    const flat = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) flat[i] = colours[layerOf[i]];

    const islands = strand(w, h, layerOf, flat, colours, layerCount, strandChance, rand);

    const grid: number[][] = [];
    for (let r = 0; r < h; r++) {
      const row: number[] = [];
      for (let c = 0; c < w; c++) row.push(flat[r * w + c]);
      grid.push(row);
    }

    const level: Level = {
      width, height, origin, grid, palette, moveLimit: targetMoves, seed,
    };

    /* Without islands the construction settles par on its own and the search
       would only be confirming what is already proved. With them, the board
       no longer matches the layers it was built from, so the search has the
       last word — and a board whose true par wandered outside the band asked
       for is thrown back rather than shipped with a move limit nobody can
       meet or one nobody can feel. */
    if (islands) {
      const par = solve(level);
      if (par === null || par < targetMoves || par > targetMoves + 2) continue;
      level.moveLimit = par;
    }

    return { level, layers, layerCount, colours, attempts: attempt };
  }

  throw new Error(
    'gave up after ' + MAX_ATTEMPTS + ' boards for seed "' + seed + '" — ' +
    targetMoves + ' moves on ' + width + '×' + height + ' with ' + palette + ' colours',
  );
}

export function generate(opts: GenOptions): Level {
  return generateDetailed(opts).level;
}
