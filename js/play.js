/* play.ts — the rules, with no opinion about how a board is drawn.
 *
 * Small enough to read in one go, which is the point: the web build and a
 * phone build have to agree exactly on what a move does, and the cheapest way
 * to guarantee that is for there to be only one copy of it. */
export function start(level) {
    return { level, grid: level.grid.map((row) => row.slice()), played: [] };
}
/* Which cells the player currently controls: the run of touching cells of one
   colour that includes the origin. */
export function blobOf(game) {
    const { width: w, height: h, origin } = game.level;
    const grid = game.grid;
    const colour = grid[origin[0]][origin[1]];
    const inBlob = [];
    for (let r = 0; r < h; r++)
        inBlob.push(new Array(w).fill(false));
    const queue = [[origin[0], origin[1]]];
    inBlob[origin[0]][origin[1]] = true;
    for (let q = 0; q < queue.length; q++) {
        const [r, c] = queue[q];
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
export function blobColour(game) {
    return game.grid[game.level.origin[0]][game.level.origin[1]];
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
/* Playing the colour the blob already is would change nothing, so it is not a
   move. Everything else is legal, including a colour that touches nothing —
   the player is allowed to waste a move, they are just unlikely to want to. */
export function canPlay(game, colour) {
    return colour !== blobColour(game) && !won(game);
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
