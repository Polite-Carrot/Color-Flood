/* app.ts — the browser build.
 *
 * The only file in src/ that knows a DOM exists. Everything it needs to decide
 * what a board is, what a move does, or which puzzle today's is comes from
 * the four modules above it, all of which are pure and none of which import
 * anything — so a React Native build can take the same four and write its own
 * version of this one file.
 *
 * No framework, no bundler, no build step beyond `tsc`. */
import { generate } from "./generator.js";
import { colour, ink, MAX_PALETTE } from "./palette.js";
import { blobOf, blobColour, canPlay, movesLeft, play, restart, start, undo, won } from "./play.js";
import { SETTINGS, dailySeed, dailySetting, dayKey, optionsFor, settingFor, } from "./levels.js";
/* ------------------------------------------------------------------ scaffolding */
const $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
        throw new Error('no element #' + id);
    return el;
};
function show(screen) {
    for (const s of document.querySelectorAll('.screen'))
        s.classList.remove('is-active');
    $(screen).classList.add('is-active');
}
function openOverlay(id) { $(id).hidden = false; }
function closeOverlay(id) { $(id).hidden = true; }
const DEFAULTS = {
    marks: true, streak: 0, best: 0, total: 0, lastDay: '', difficulty: 'easy',
};
const KEY = 'color-flood/v1';
function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return { ...DEFAULTS };
        const got = JSON.parse(raw);
        return {
            marks: typeof got.marks === 'boolean' ? got.marks : DEFAULTS.marks,
            streak: Number(got.streak) || 0,
            best: Number(got.best) || 0,
            total: Number(got.total) || 0,
            lastDay: typeof got.lastDay === 'string' ? got.lastDay : '',
            difficulty: typeof got.difficulty === 'string' ? got.difficulty : DEFAULTS.difficulty,
        };
    }
    catch {
        /* Private browsing, or storage switched off. The game is perfectly
           playable without a save — only the streak is lost — so it carries on
           rather than announcing a problem nobody can act on. */
        return { ...DEFAULTS };
    }
}
function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(saved));
    }
    catch { /* see above */ }
}
const saved = load();
let session = null;
let cells = [];
/* ------------------------------------------------------------------ the board */
/* Build the grid once per puzzle. Every move after that only repaints the
   cells, because rebuilding 225 elements a move throws away the animation and
   the browser's own layout work along with it. */
function buildBoard(level) {
    const board = $('board');
    board.replaceChildren();
    board.style.gridTemplateColumns = 'repeat(' + level.width + ', 1fr)';
    board.classList.toggle('no-marks', !saved.marks);
    cells = [];
    for (let r = 0; r < level.height; r++) {
        for (let c = 0; c < level.width; c++) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'cell';
            /* The board is one control, not w×h of them: a screen reader walking
               two hundred buttons individually would learn nothing, and every cell
               plays the same move as the swatch of its colour. */
            cell.tabIndex = -1;
            cell.setAttribute('aria-hidden', 'true');
            if (r === level.origin[0] && c === level.origin[1])
                cell.classList.add('origin');
            const mark = document.createElement('span');
            cell.append(mark);
            /* Tapping a cell plays its colour — the fastest way to play on a phone
               is to point at the band you want, not to hunt for it in the row. */
            cell.addEventListener('click', () => {
                if (session)
                    tryPlay(session.game.grid[r][c]);
            });
            board.append(cell);
            cells.push(cell);
        }
    }
    sizeBoard();
}
/* The largest square that fits the room left over, in whole pixels per cell.
   Whole pixels because a fractional cell size leaves hairline seams between
   cells at some zoom levels, and a flood board is nothing but seams. */
function sizeBoard() {
    if (!session)
        return;
    const level = session.game.level;
    const wrap = $('board').parentElement;
    const room = Math.min(wrap.clientWidth, wrap.clientHeight);
    if (room <= 0)
        return;
    const per = Math.max(12, Math.floor((room - 8) / Math.max(level.width, level.height)));
    const board = $('board');
    board.style.width = per * level.width + 'px';
    board.style.height = per * level.height + 'px';
    board.style.fontSize = Math.max(9, Math.round(per * 0.44)) + 'px';
}
function paint(gained = []) {
    if (!session)
        return;
    const { game } = session;
    const { width: w, height: h } = game.level;
    const blob = blobOf(game);
    const isNew = new Set(gained.map(([r, c]) => r * w + c));
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            const cell = cells[r * w + c];
            const index = game.grid[r][c];
            const paintWith = colour(index);
            cell.style.background = paintWith.hex;
            cell.style.color = ink(index) === 'dark' ? '#2b2142' : '#ffffff';
            cell.firstElementChild.textContent = paintWith.mark;
            /* The blob's outline, drawn as inset shadows on its edge cells rather
               than as borders — a border changes the cell's size and would shuffle
               the whole grid every move. */
            if (blob[r][c]) {
                const lines = [];
                if (r === 0 || !blob[r - 1][c])
                    lines.push('inset 0 3px 0 #2b2142');
                if (r === h - 1 || !blob[r + 1][c])
                    lines.push('inset 0 -3px 0 #2b2142');
                if (c === 0 || !blob[r][c - 1])
                    lines.push('inset 3px 0 0 #2b2142');
                if (c === w - 1 || !blob[r][c + 1])
                    lines.push('inset -3px 0 0 #2b2142');
                cell.style.boxShadow = lines.join(', ');
            }
            else {
                cell.style.boxShadow = '';
            }
            /* Restart the animation by taking the class off and putting it back —
               a class that is already there does not replay. */
            cell.classList.remove('is-new');
            if (isNew.has(r * w + c)) {
                void cell.offsetWidth;
                cell.classList.add('is-new');
            }
        }
    }
    paintPicker();
    paintStats();
}
function paintPicker() {
    if (!session)
        return;
    const { game } = session;
    const picker = $('picker');
    const current = blobColour(game);
    const over = movesLeft(game) <= 0 || won(game);
    if (picker.childElementCount !== game.level.palette) {
        picker.replaceChildren();
        for (let i = 0; i < game.level.palette; i++) {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'swatch';
            swatch.dataset.colour = String(i);
            const mark = document.createElement('span');
            swatch.append(mark);
            swatch.addEventListener('click', () => tryPlay(i));
            picker.append(swatch);
        }
    }
    for (let i = 0; i < game.level.palette; i++) {
        const swatch = picker.children[i];
        const c = colour(i);
        swatch.style.background = c.hex;
        swatch.style.color = ink(i) === 'dark' ? '#2b2142' : '#ffffff';
        swatch.firstElementChild.textContent = c.mark;
        swatch.disabled = over || i === current;
        swatch.setAttribute('aria-label', c.name + (i === current ? ', the color you are now' : ''));
    }
}
function paintStats() {
    if (!session)
        return;
    const { game } = session;
    const used = game.played.length;
    $('stat-moves').textContent = String(used);
    $('stat-par').textContent = String(game.level.moveLimit);
    $('stat-moves').parentElement.classList.toggle('is-out', used >= game.level.moveLimit);
    $('undo').disabled = used === 0;
    $('restart').disabled = used === 0;
}
function say(text, tone = '') {
    const status = $('status');
    status.textContent = text || ' ';
    status.className = 'status' + (tone ? ' ' + tone : '');
}
/* ------------------------------------------------------------------ playing */
function tryPlay(index) {
    if (!session)
        return;
    const { game } = session;
    if (won(game))
        return;
    if (movesLeft(game) <= 0) {
        say('Out of moves — undo a move, or restart and try a different line.', 'is-warn');
        return;
    }
    if (!canPlay(game, index))
        return;
    const gained = play(game, index);
    paint(gained);
    if (won(game))
        return finish();
    if (!gained.length) {
        say('That color was not touching the blob, so nothing moved — but the move is spent.', 'is-warn');
    }
    else if (movesLeft(game) === 0) {
        say('Last move gone, and the board is not one color yet. Undo, or restart.', 'is-warn');
    }
    else if (movesLeft(game) === 1) {
        say('One move left.', 'is-warn');
    }
    else {
        say('');
    }
}
function finish() {
    if (!session)
        return;
    const { game, kind, setting, day } = session;
    const used = game.played.length;
    if (kind === 'daily')
        recordDaily(day);
    $('win-swatch').style.background = colour(blobColour(game)).hex;
    $('win-line').textContent =
        used + (used === 1 ? ' move' : ' moves') + ', against a limit of ' + game.level.moveLimit + '.';
    $('win-note').textContent = kind === 'daily'
        ? 'Daily streak: ' + saved.streak + (saved.streak === saved.best && saved.best > 1 ? ' — your best yet.' : '')
        : setting.label + ' · seed ' + game.level.seed;
    $('win-again').textContent = kind === 'daily' ? 'Random puzzle' : 'New puzzle';
    openOverlay('overlay-win');
    say('Flooded in ' + used + '.', 'is-good');
}
/* A daily counts once. Playing it again on the same day is welcome but does
   not move the streak, and neither does replaying it after midnight — the day
   the puzzle belongs to is fixed when it is dealt. */
function recordDaily(day) {
    if (saved.lastDay === day)
        return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    saved.streak = saved.lastDay === dayKey(yesterday) ? saved.streak + 1 : 1;
    saved.best = Math.max(saved.best, saved.streak);
    saved.total += 1;
    saved.lastDay = day;
    save();
}
/* ------------------------------------------------------------------ dealing */
function begin(kind, setting, seed, day) {
    let level;
    try {
        level = generate(optionsFor(setting, seed));
    }
    catch (err) {
        /* Only reachable if a setting is asking for something the board cannot
           hold, which is a mistake in levels.ts rather than anything the player
           did — so it says so plainly instead of showing an empty board. */
        say('Could not deal that puzzle: ' + err.message, 'is-warn');
        show('screen-home');
        return;
    }
    session = { game: start(level), kind, setting, day };
    $('level-name').textContent = kind === 'daily' ? 'Daily Puzzle' : setting.label;
    $('level-sub').textContent = kind === 'daily'
        ? day + ' · ' + setting.label
        : level.width + '×' + level.height + ' · ' + level.palette + ' colors';
    /* Show the screen BEFORE building the board. A hidden screen has no
       layout, so the board would measure the room available as zero and fall
       back to sizing itself to its own letters — a 7×7 board about a fifth of
       the width it should be. */
    show('screen-game');
    buildBoard(level);
    paint();
    /* Size it once more now the picker exists. buildBoard measures the room
       left over, and until paint() has put the colour swatches in there is more
       of it than there will be — so a first measurement on its own comes out
       one row of swatches too tall and the board runs over them. */
    sizeBoard();
    say('');
}
function dealRandom() {
    const setting = settingFor(saved.difficulty);
    /* A seed nobody has to type: the clock, in base 36. It goes on the win
       screen so a board worth sharing can be dealt again. */
    begin('random', setting, Date.now().toString(36), '');
}
function playDaily() {
    const now = new Date();
    begin('daily', dailySetting(now), dailySeed(now), dayKey(now));
}
/* ------------------------------------------------------------------ screens */
function paintRandomScreen() {
    const index = Math.max(0, SETTINGS.findIndex((s) => s.key === saved.difficulty));
    const setting = SETTINGS[index];
    $('difficulty').value = String(index);
    $('difficulty').setAttribute('aria-valuetext', setting.label);
    $('difficulty-name').textContent = setting.label;
    $('difficulty-blurb').textContent = setting.blurb;
    $('difficulty-shape').textContent =
        setting.width + '×' + setting.height + ' · ' + setting.palette + ' colors · ' +
            setting.moves + ' moves' + (setting.strandChance > 0 ? ' · islands' : '');
    const ticks = $('difficulty-ticks');
    if (ticks.childElementCount !== SETTINGS.length) {
        ticks.replaceChildren();
        for (const s of SETTINGS) {
            const span = document.createElement('span');
            span.textContent = s.label;
            ticks.append(span);
        }
    }
    for (let i = 0; i < SETTINGS.length; i++) {
        ticks.children[i].classList.toggle('is-on', i === index);
    }
}
function paintDailyScreen() {
    const now = new Date();
    const setting = dailySetting(now);
    const day = dayKey(now);
    $('daily-date').textContent = now.toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
    });
    $('daily-setting').textContent = setting.label;
    $('daily-blurb').textContent = setting.blurb;
    $('streak-now').textContent = String(saved.streak);
    $('streak-best').textContent = String(saved.best);
    $('streak-total').textContent = String(saved.total);
    $('daily-note').textContent = saved.lastDay === day
        ? "Today's is done. Play it again if you like — the streak is already counted."
        : 'Everybody gets the same board today.';
    $('play-daily').textContent =
        saved.lastDay === day ? "Play today's again" : "Play today's puzzle";
}
/* ------------------------------------------------------------------ wiring */
function wire() {
    $('go-random').addEventListener('click', () => { paintRandomScreen(); show('screen-random'); });
    $('go-daily').addEventListener('click', () => { paintDailyScreen(); show('screen-daily'); });
    for (const btn of document.querySelectorAll('[data-home]')) {
        btn.addEventListener('click', () => show('screen-home'));
    }
    $('back').addEventListener('click', () => show('screen-home'));
    $('difficulty').addEventListener('input', (e) => {
        saved.difficulty = SETTINGS[Number(e.target.value)].key;
        save();
        paintRandomScreen();
    });
    $('deal').addEventListener('click', dealRandom);
    $('play-daily').addEventListener('click', playDaily);
    $('undo').addEventListener('click', () => {
        if (session && undo(session.game)) {
            paint();
            say('');
        }
    });
    $('restart').addEventListener('click', () => {
        if (session) {
            restart(session.game);
            paint();
            say('');
        }
    });
    $('again').addEventListener('click', dealRandom);
    $('win-again').addEventListener('click', () => { closeOverlay('overlay-win'); dealRandom(); });
    $('win-home').addEventListener('click', () => { closeOverlay('overlay-win'); show('screen-home'); });
    $('how-to').addEventListener('click', () => openOverlay('overlay-howto'));
    $('settings').addEventListener('click', () => { paintSettings(); openOverlay('overlay-settings'); });
    for (const btn of document.querySelectorAll('[data-close]')) {
        btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
    }
    $('set-marks').addEventListener('click', () => {
        saved.marks = !saved.marks;
        save();
        paintSettings();
        $('board').classList.toggle('no-marks', !saved.marks);
    });
    $('set-reset').addEventListener('click', () => {
        saved.streak = 0;
        saved.best = 0;
        saved.total = 0;
        saved.lastDay = '';
        save();
        paintSettings();
        $('settings-note').textContent = 'Streak reset.';
    });
    window.addEventListener('keydown', (e) => {
        if (!$('overlay-win').hidden || !$('overlay-howto').hidden || !$('overlay-settings').hidden) {
            if (e.key === 'Escape') {
                for (const id of ['overlay-win', 'overlay-howto', 'overlay-settings'])
                    closeOverlay(id);
            }
            return;
        }
        if (!$('screen-game').classList.contains('is-active'))
            return;
        if (e.key === 'Escape')
            return show('screen-home');
        if (e.key === 'u' || e.key === 'U')
            return void $('undo').click();
        if (e.key === 'r' || e.key === 'R')
            return void $('restart').click();
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= MAX_PALETTE)
            tryPlay(n - 1);
    });
    /* Publish the visual viewport height, and resize the board with it. The
       visual viewport is the one the browser's toolbars actually leave behind,
       which on iOS is not what 100dvh resolves to. */
    const measure = () => {
        const vv = window.visualViewport;
        document.documentElement.style.setProperty('--vvh', (vv ? vv.height : window.innerHeight) + 'px');
        sizeBoard();
    };
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
}
function paintSettings() {
    const marks = $('set-marks');
    marks.textContent = saved.marks ? 'On' : 'Off';
    marks.setAttribute('aria-pressed', String(saved.marks));
}
wire();
paintRandomScreen();
