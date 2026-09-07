/* play.ts — the rules, with no opinion about how a board is drawn.
 *
 * Small enough to read in one go, which is the point: the web build and a
 * phone build have to agree exactly on what a move does, and the cheapest way
 * to guarantee that is for there to be only one copy of it. */
export function start(level) {
    return { level, grid: level.grid.map((row) => row.slice()), played: [] };
}
/* Which cells the player currently controls: the run of touching cells of one
   colour around each origin.

   On an ordinary board that is one region. On a Merge board it is two, one in
   each corner, and they stay two until they grow into each other — at which
   point they are one region and nothing here needs to notice, because this
   only ever asks "what is connected to an origin". There is no merging step,
   no merged flag, no moment to get wrong: the blobs are one when they touch,
   by the same rule that made them two. */
export function blobOf(game) {
    const { width: w, height: h, origins } = game.level;
    const grid = game.grid;
    const inBlob = [];
    for (let r = 0; r < h; r++)
        inBlob.push(new Array(w).fill(false));
    const queue = [];
    for (const [orr, orc] of origins) {
        if (inBlob[orr][orc])
            continue;
        inBlob[orr][orc] = true;
        queue.push([orr, orc]);
    }
    for (let q = 0; q < queue.length; q++) {
        const [r, c] = queue[q];
        const colour = grid[r][c];
        const around = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of around) {
            if (nr < 0 || nc < 0 || nr >= h || nc >= w)
                continue;
            if (inBlob[nr][nc] || grid[nr][nc] !== colour)
                continue;
            inBlob[nr][nc] = true;
            queue.push([nr, nc]);
        }
    }
    return inBlob;
}
/* The colour under each origin. One entry on an ordinary board.

   On a Merge board these can differ, but only before the first move: a move
   recolours every blob to the same colour, so from move one onwards the two
   fronts always match. That is the whole of the Merge rule — one colour, two
   fronts — and it is why they merge on contact rather than needing to be
   brought to the same colour first. */
export function blobColours(game) {
    return game.level.origins.map(([r, c]) => game.grid[r][c]);
}
/* The one colour the blob is, for the ordinary single-front case. On a Merge
   board before the first move the two fronts may differ; this reports the
   first, and callers that care use blobColours instead. */
export function blobColour(game) {
    return blobColours(game)[0];
}
export function won(game) {
    const first = game.grid[0][0];
    for (const row of game.grid)
        for (const c of row)
            if (c !== first)
                return false;
    return true;
}
export function movesLeft(game) {
    return game.level.moveLimit - game.played.length;
}
/* Playing a colour every front already is would change nothing, so it is not
   a move. Everything else is legal, including a colour that touches nothing —
   the player is allowed to waste a move, they are just unlikely to want to.

   The "every" matters on a Merge board before the first move: if one front is
   red and the other blue, playing red is a real move, because it takes the
   blue one with it. */
export function canPlay(game, colour) {
    return !won(game) && blobColours(game).some((c) => c !== colour);
}
/* Recolour the blob, and return the cells that joined it — the caller wants
   them to animate the ones that just changed hands rather than the whole
   board. */
export function play(game, colour) {
    if (!canPlay(game, colour))
        return [];
    const before = blobOf(game);
    for (let r = 0; r < game.level.height; r++) {
        for (let c = 0; c < game.level.width; c++)
            if (before[r][c])
                game.grid[r][c] = colour;
    }
    game.played.push(colour);
    const after = blobOf(game);
    const gained = [];
    for (let r = 0; r < game.level.height; r++) {
        for (let c = 0; c < game.level.width; c++)
            if (after[r][c] && !before[r][c])
                gained.push([r, c]);
    }
    return gained;
}
export function restart(game) {
    game.grid = game.level.grid.map((row) => row.slice());
    game.played = [];
}
export function undo(game) {
    if (!game.played.length)
        return false;
    const again = game.played.slice(0, -1);
    restart(game);
    for (const colour of again)
        play(game, colour);
    return true;
}
