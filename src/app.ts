/* app.ts — the browser build.
 *
 * The only file in src/ that knows a DOM exists. Everything it needs to decide
 * what a board is, what a move does, or which puzzle today's is comes from
 * the four modules above it, all of which are pure and none of which import
 * anything — so a React Native build can take the same four and write its own
 * version of this one file.
 *
 * No framework, no bundler, no build step beyond `tsc`. */

import { bestMove, generate, type Level } from './generator.ts';
import { colour, ink, MAX_PALETTE } from './palette.ts';
import { blobOf, blobColour, canPlay, movesLeft, play, restart, start, undo, won, type Game }
  from './play.ts';
import {
  MODES, bestStreakOf, dailySeed, dailySetting, dayKey, firstDailyDate, isPlayableDay,
  modeLabel, optionsFor, settingFor, settingsFor, streakOf,
  type Mode, type Setting,
} from './levels.ts';
import { CAMPAIGN_LENGTH, campaignLevel, campaignSetting } from './campaign.ts';
import { Sound } from './sound.ts';
import { Ads, startAdPreview } from './ads.ts';

/* ------------------------------------------------------------------ scaffolding */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('no element #' + id);
  return el as T;
};

function show(screen: string): void {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('is-active');
  $(screen).classList.add('is-active');
}

function openOverlay(id: string): void { $(id).hidden = false; }
function closeOverlay(id: string): void { $(id).hidden = true; }

/* ------------------------------------------------------------------ saved state */

/* Three numbers and two flags. Small enough that a schema would be more code
   than the thing it described, so it is read defensively instead: any field
   that is not the shape expected falls back to its default, and a save from a
   future version losing a field is a shrug rather than a crash. */
type Saved = {
  sound: boolean;
  /* Colour Blind Assist: the colour's initial on every cell and every swatch.
     
     Not a cosmetic toggle. Simulated against protanopia and deuteranopia, blue
     and purple in this palette come out about 8 apart in CIE Lab — the same
     colour, for practical purposes — and both are in play from Normal upward.
     Yellow and orange are 14 apart under deuteranopia, blue and green 18 under
     tritanopia. The letter is what carries those boards, which is why it is on
     by default and why it is drawn to be read rather than to be tasteful. */
  marks: boolean;
  /* Every daily ever finished, by its calendar day. The streak, the best
     streak and the total are all worked out from this rather than kept
     beside it — a counter has to be nudged at exactly the right moments and
     every one of those is a chance to be wrong in a way nobody can check. */
  days: string[];
  difficulty: string;
  mode: Mode;
  /* One entry per campaign level: the fewest moves it has been finished in
     and the par it was finished against, or 0 for not yet.
     
     Fewest rather than a flag, because "done" and "done at par" are worth
     telling apart and par is the thing worth going back for. And par stored
     rather than recomputed, because working it out means DEALING the level,
     and dealing a hundred of them to colour a hundred tiles would cost
     several seconds of a screen that is only a grid of numbers. */
  progress: Record<Mode, { best: number[]; par: number[] }>;
};

const blankRun = (): number[] => new Array<number>(CAMPAIGN_LENGTH).fill(0);
const blankProgress = () => ({ best: blankRun(), par: blankRun() });

const DEFAULTS: Saved = {
  sound: true, marks: true, days: [], difficulty: 'easy', mode: 'flood',
  progress: { flood: blankProgress(), merge: blankProgress() },
};

/* Read a saved campaign back defensively. A run that is the wrong length —
   an older save, or a newer one from a longer campaign — is padded or cut
   rather than thrown away, because losing somebody's progress is a worse
   outcome than carrying a stale entry. */
function readRun(got: unknown): number[] {
  const out = blankRun();
  if (!Array.isArray(got)) return out;
  for (let i = 0; i < out.length && i < got.length; i++) {
    const n = Number(got[i]);
    out[i] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

function readProgress(got: unknown): { best: number[]; par: number[] } {
  const from = (got ?? {}) as Record<string, unknown>;
  return { best: readRun(from.best), par: readRun(from.par) };
}
const KEY = 'color-flood/v1';

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const got = JSON.parse(raw) as Partial<Saved>;
    return {
      sound: typeof got.sound === 'boolean' ? got.sound : DEFAULTS.sound,
      marks: typeof got.marks === 'boolean' ? got.marks : DEFAULTS.marks,
      /* A save from before the calendar kept only the last day played. It is
         one day rather than none, so it is carried over rather than dropped —
         somebody's streak of one is still their streak. */
      days: Array.isArray(got.days)
        ? got.days.filter((d): d is string => typeof d === 'string')
        : (typeof (got as { lastDay?: unknown }).lastDay === 'string' && (got as { lastDay: string }).lastDay
          ? [(got as { lastDay: string }).lastDay]
          : []),
      difficulty: typeof got.difficulty === 'string' ? got.difficulty : DEFAULTS.difficulty,
      mode: got.mode === 'merge' ? 'merge' : DEFAULTS.mode,
      progress: {
        flood: readProgress((got.progress as Record<string, unknown> | undefined)?.flood),
        merge: readProgress((got.progress as Record<string, unknown> | undefined)?.merge),
      },
    };
  } catch {
    /* Private browsing, or storage switched off. The game is perfectly
       playable without a save — only the streak is lost — so it carries on
       rather than announcing a problem nobody can act on. */
    return { ...DEFAULTS };
  }
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* see above */ }
}

const saved = load();

/* ------------------------------------------------------------------ the session */

/* Two hints a puzzle, on every difficulty.
 *
 * Per PUZZLE and not per attempt, which is the only reading of a cap that
 * means anything — hints that came back on restart would be unlimited hints
 * with an extra click in front of them. So undo and restart stay free and do
 * not touch this; only dealing a new board does. */
const HINTS = 2;

type Session = {
  game: Game;
  kind: 'daily' | 'random' | 'campaign';
  setting: Setting;
  /* The day a daily belongs to, so a win can be recorded against the right
     one even if midnight passes mid-puzzle. */
  day: string;
  /* Which campaign level this is, if it is one. */
  campaign: { mode: Mode; n: number } | null;
  hintsLeft: number;
  /* The colour the last hint named, so the swatch can show it until a move is
     played. -1 for none. */
  hinted: number;
};

let session: Session | null = null;
let cells: HTMLButtonElement[] = [];

/* ------------------------------------------------------------------ the board */

/* Build the grid once per puzzle. Every move after that only repaints the
   cells, because rebuilding 225 elements a move throws away the animation and
   the browser's own layout work along with it. */
function buildBoard(level: Level): void {
  /* Only the keys that do something. On a two-colour teaching board, telling
     somebody about keys 1 to 6 is telling them about four keys that do
     nothing. */
  $('keys-colors').textContent = level.palette > 1 ? '1–' + level.palette : '1';

  const board = $('board');
  board.replaceChildren();
  board.style.gridTemplateColumns = 'repeat(' + level.width + ', 1fr)';
  board.classList.toggle('no-marks', !saved.marks);
  $('picker').classList.toggle('no-marks', !saved.marks);
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
      if (level.origins.some(([orr, orc]) => orr === r && orc === c)) cell.classList.add('origin');
      const mark = document.createElement('span');
      cell.append(mark);
      /* Tapping a cell plays its colour — the fastest way to play on a phone
         is to point at the band you want, not to hunt for it in the row. */
      cell.addEventListener('click', () => {
        if (session) tryPlay(session.game.grid[r][c]);
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
function sizeBoard(): void {
  if (!session) return;
  const level = session.game.level;
  const wrap = $('board').parentElement as HTMLElement;
  const room = Math.min(wrap.clientWidth, wrap.clientHeight);
  if (room <= 0) return;

  /* Two pixels of slack, not eight. The board is quantised — a whole pixel
     per cell means it grows in steps of one cell-count, 14px at a time on a
     14-wide board — so anything held back here is likely to cost a whole step
     rather than the pixels themselves. */
  const per = Math.max(12, Math.floor((room - 2) / Math.max(level.width, level.height)));
  const board = $('board');
  board.style.width = per * level.width + 'px';
  board.style.height = per * level.height + 'px';
  board.style.fontSize = Math.max(9, Math.round(per * 0.44)) + 'px';
}

function paint(gained: Array<[number, number]> = []): void {
  if (!session) return;
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
      (cell.firstElementChild as HTMLElement).textContent = paintWith.mark;

      /* The blob's outline, drawn as inset shadows on its edge cells rather
         than as borders — a border changes the cell's size and would shuffle
         the whole grid every move. */
      if (blob[r][c]) {
        const lines: string[] = [];
        if (r === 0 || !blob[r - 1][c]) lines.push('inset 0 3px 0 #2b2142');
        if (r === h - 1 || !blob[r + 1][c]) lines.push('inset 0 -3px 0 #2b2142');
        if (c === 0 || !blob[r][c - 1]) lines.push('inset 3px 0 0 #2b2142');
        if (c === w - 1 || !blob[r][c + 1]) lines.push('inset -3px 0 0 #2b2142');
        cell.style.boxShadow = lines.join(', ');
      } else {
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

function paintPicker(): void {
  if (!session) return;
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
    const swatch = picker.children[i] as HTMLButtonElement;
    const c = colour(i);
    swatch.style.background = c.hex;
    swatch.style.color = ink(i) === 'dark' ? '#2b2142' : '#ffffff';
    (swatch.firstElementChild as HTMLElement).textContent = c.mark;
    swatch.disabled = over || i === current;
    swatch.classList.toggle('is-hinted', i === session.hinted && !swatch.disabled);
    swatch.setAttribute('aria-label', c.name +
      (i === current ? ', the color you are now' : '') +
      (i === session.hinted ? ', hinted' : ''));
  }
}

function paintStats(): void {
  if (!session) return;
  const { game } = session;
  /* A campaign level has a next level, not a next deal. Offering "New puzzle"
     there is offering to leave the campaign, which is not what the button
     beside Undo and Restart looks like it does. */
  ($('again') as HTMLButtonElement).hidden = session.campaign !== null;
  const used = game.played.length;
  const left = game.level.moveLimit - used;
  $('stat-moves').textContent = String(used);
  $('stat-left').textContent = String(left);
  $('stat-left').parentElement!.classList.toggle('is-out', left <= 0);
  ($('undo') as HTMLButtonElement).disabled = used === 0;
  ($('restart') as HTMLButtonElement).disabled = used === 0;

  const hint = $('hint') as HTMLButtonElement;
  hint.textContent = session.hintsLeft > 0 ? 'Hint (' + session.hintsLeft + ')' : 'Hint';
  hint.disabled = session.hintsLeft === 0 || won(game) || left <= 0;
}

function say(text: string, tone: '' | 'is-good' | 'is-warn' = ''): void {
  const status = $('status');
  status.textContent = text || ' ';
  status.className = 'status' + (tone ? ' ' + tone : '');
}

/* ------------------------------------------------------------------ playing */

function tryPlay(index: number): void {
  if (!session) return;
  const { game } = session;
  if (won(game)) return;
  if (movesLeft(game) <= 0) {
    Sound.nope();
    say('Out of moves — undo a move, or restart and try a different line.', 'is-warn');
    return;
  }
  if (!canPlay(game, index)) return;

  const gained = play(game, index);
  session.hinted = -1;
  paint(gained);

  if (won(game)) return finish();

  /* Pitch rises with how much of the board you hold, so a game climbs as it
     goes. Counted off the blob rather than the moves used, because a move
     that takes forty cells should not sound like one that takes two. */
  const held = blobOf(game).reduce((n, row) => n + row.filter(Boolean).length, 0);
  if (gained.length) Sound.flood(held / (game.level.width * game.level.height));

  if (!gained.length) {
    Sound.nope();
    say('That color was not touching the blob, so nothing moved — but the move is spent.', 'is-warn');
  } else if (movesLeft(game) === 0) {
    say('Out of moves, and the board is not one color yet. Undo, or restart.', 'is-warn');
  } else if (movesLeft(game) === 1) {
    say('One move left.', 'is-warn');
  } else {
    say('');
  }
}

function askHint(): void {
  if (!session) return;
  const { game } = session;
  if (session.hintsLeft <= 0 || won(game) || movesLeft(game) <= 0) return;

  /* The search blocks the thread. On the small boards it is a millisecond and
     nobody sees this; on a 16×16 it is a tenth of a second warm and closer to
     half a second on the very first call, before anything is compiled — long
     enough that a button which simply does not respond reads as broken. So
     say what is happening first.
     
     rAF alone is not enough: it runs BEFORE the paint, so the search would
     still start on the same frame as the label change and the label would
     never be seen. rAF then a timeout puts the work after the paint. */
  const button = $('hint') as HTMLButtonElement;
  button.disabled = true;
  button.textContent = 'Thinking…';
  requestAnimationFrame(() => window.setTimeout(runHint, 0));
}

function runHint(): void {
  if (!session) return;
  const { game } = session;
  if (session.hintsLeft <= 0 || won(game) || movesLeft(game) <= 0) return paintStats();

  /* Solve from where the player actually is, not from the board as dealt —
     three moves in, on a line the generator never considered, is exactly when
     a hint is worth asking for. */
  const from: Level = { ...game.level, grid: game.grid.map((row) => row.slice()) };
  const best = bestMove(from);

  if (!best) {
    /* Only reachable if the search hit its cap, which boards from this
       generator do not. Say so, put the button back, and do not charge for
       the hint that was not given. */
    say('Could not work this one out. Hint not used.', 'is-warn');
    paintStats();
    return;
  }

  session.hintsLeft -= 1;
  session.hinted = best.colour;
  paint();

  const name = colour(best.colour).name;
  const left = movesLeft(game);
  /* "a best line", not "the best line": there is usually more than one
     optimal move and this names one of them. A hint that contradicted a line
     the player had already found would be worse than no hint. */
  /* Careful with the word "left" here: the stat beside the board already
     uses it for moves remaining in the limit, and a hint that also said
     "left" for the length of the best line would put two different meanings
     of it on screen at once. */
  if (best.moves > left) {
    say('Play ' + name + ' — but the best line from here still needs ' + best.moves +
        ' and you have ' + left + '. Undo, or restart.', 'is-warn');
  } else {
    say('Play ' + name + '. A best line from here finishes in ' + best.moves + '.' +
        (session.hintsLeft ? '' : ' No hints left.'));
  }
}

function finish(): void {
  if (!session) return;
  const { game, kind, setting, day, campaign } = session;
  const used = game.played.length;

  if (kind === 'daily') recordDaily(day);
  if (campaign) {
    const run = saved.progress[campaign.mode];
    /* Keep the best, so replaying a level worse than before does not undo the
       gold tile. */
    if (run.best[campaign.n - 1] === 0 || used < run.best[campaign.n - 1]) {
      run.best[campaign.n - 1] = used;
    }
    run.par[campaign.n - 1] = game.level.par;
    save();
  }

  const par = game.level.par;
  $('win-swatch').style.background = colour(blobColour(game)).hex;
  $('win-title').textContent = used === par ? 'Par!' : 'Flooded!';
  $('win-line').textContent = used === par
    ? used + (used === 1 ? ' move' : ' moves') + ' — nothing finishes this board faster.'
    : used + ' moves, against a par of ' + par + '. ' +
      (used - par === 1 ? 'One move off the best line.' : (used - par) + ' moves off the best line.');
  const solved = new Set(saved.days);
  const streak = streakOf(solved, new Date());
  $('win-note').textContent = kind === 'daily'
    ? 'Daily streak: ' + streak +
      (streak > 1 && streak === bestStreakOf(solved) ? ' — your best yet.' : '')
    : campaign ? modeLabel(campaign.mode) + ' level ' + campaign.n
    : setting.label + ' · seed ' + game.level.seed;
  /* Three kinds of puzzle, three different things to do next — and the way
     back is named for where it actually goes, since "Home" on a daily meant
     the home screen when what anybody wants is the calendar they came from. */
  const next = $('win-next') as HTMLButtonElement;
  const again = $('win-again') as HTMLButtonElement;
  const home = $('win-home') as HTMLButtonElement;
  if (campaign) {
    next.hidden = campaign.n >= CAMPAIGN_LENGTH;
    again.hidden = true;
    home.textContent = 'Levels';
    if (campaign.n >= CAMPAIGN_LENGTH) {
      $('win-note').textContent =
        'That is the last of them. ' + modeLabel(campaign.mode) + ' finished.';
    }
  } else if (kind === 'daily') {
    next.hidden = true;
    again.hidden = true;
    home.textContent = 'Calendar';
  } else {
    next.hidden = true;
    again.hidden = false;
    again.textContent = 'New puzzle';
    home.textContent = 'Home';
  }
  Sound.win();
  /* One finished board towards the ad cadence. Counted here, at the win
     itself, rather than at the button that leaves it: a player who closes the
     card with Escape has still finished the puzzle. */
  Ads.noteWin();
  openOverlay('overlay-win');
  say('Flooded in ' + used + '.', 'is-good');
}

/* A daily counts once. Playing it again — later the same day, or a month
   later off the calendar — is welcome and changes nothing, because the record
   is a set of days and the day is already in it. */
function recordDaily(day: string): void {
  if (saved.days.includes(day)) return;
  saved.days.push(day);
  save();
}

/* ------------------------------------------------------------------ dealing */

function begin(kind: 'daily' | 'random', setting: Setting, seed: string, day: string): void {
  let level: Level;
  try {
    level = generate(optionsFor(setting, seed));
  } catch (err) {
    /* Only reachable if a setting is asking for something the board cannot
       hold, which is a mistake in levels.ts rather than anything the player
       did — so it says so plainly instead of showing an empty board. */
    say('Could not deal that puzzle: ' + (err as Error).message, 'is-warn');
    show('screen-home');
    return;
  }

  session = {
    game: start(level), kind, setting, day, campaign: null, hintsLeft: HINTS, hinted: -1,
  };
  $('level-name').textContent = kind === 'daily' ? 'Daily Puzzle' : modeLabel(setting.mode);
  /* Par belongs here rather than in the stats row: it does not change while
     you play, and the row beside it is for the two numbers that do. */
  $('level-sub').textContent =
    (kind === 'daily' ? day + ' · ' + modeLabel(setting.mode) + ' · ' + setting.label : setting.label) +
    ' · ' + level.width + '×' + level.height + ' · par ' + level.par;

  /* Show the screen BEFORE building the board. A hidden screen has no
     layout, so the board would measure the room available as zero and fall
     back to sizing itself to its own letters — a 7×7 board about a fifth of
     the width it should be. */
  show('screen-game');
  $('brief').textContent = '';
  buildBoard(level);
  paint();
  /* Size it once more now the picker exists. buildBoard measures the room
     left over, and until paint() has put the colour swatches in there is more
     of it than there will be — so a first measurement on its own comes out
     one row of swatches too tall and the board runs over them. */
  sizeBoard();
  say('');
}

/* Dealing runs the solver, and on the biggest boards that is a few hundred
   milliseconds — a Merge Expert board can touch a second, because two fronts
   make par much dearer to find. Long enough that a button which just sits
   there reads as broken, so it says so and yields until after a paint, the
   same way the hint does. */
function dealing(button: HTMLButtonElement, work: () => void): void {
  const was = button.textContent;
  button.disabled = true;
  button.textContent = 'Dealing…';
  requestAnimationFrame(() => window.setTimeout(() => {
    try { work(); } finally {
      button.disabled = false;
      button.textContent = was;
    }
  }, 0));
}

/* A campaign level is unlocked once the one before it has been finished.
   Level 1 always is. */
function unlocked(mode: Mode, n: number): boolean {
  return n === 1 || saved.progress[mode].best[n - 2] > 0;
}

function playCampaign(mode: Mode, n: number, button: HTMLButtonElement): void {
  dealing(button, () => {
    let entry;
    try {
      entry = campaignLevel(mode, n);
    } catch (err) {
      say('Could not deal level ' + n + ': ' + (err as Error).message, 'is-warn');
      return;
    }
    const setting = campaignSetting(mode, n);

    show('screen-game');
    session = {
      game: start(entry.level),
      kind: 'campaign',
      setting,
      day: '',
      campaign: { mode, n },
      hintsLeft: HINTS,
      hinted: -1,
    };
    $('level-name').textContent = modeLabel(mode) + ' ' + n;
    $('level-sub').textContent = entry.name + ' · ' + entry.level.width + '×' +
      entry.level.height + ' · par ' + entry.level.par;
    $('brief').textContent = entry.brief;
    buildBoard(entry.level);
    paint();
    sizeBoard();
    say('');
  });
}

function dealRandom(button: HTMLButtonElement): void {
  const setting = settingFor(saved.mode, saved.difficulty);
  /* A seed nobody has to type: the clock, in base 36. It goes on the win
     screen so a board worth sharing can be dealt again. */
  dealing(button, () => begin('random', setting, Date.now().toString(36), ''));
}

function playDaily(date: Date, button: HTMLButtonElement): void {
  dealing(button, () => begin('daily', dailySetting(date), dailySeed(date), dayKey(date)));
}

/* ------------------------------------------------------------------ screens */

function paintRandomScreen(): void {
  const list = settingsFor(saved.mode);
  /* A difficulty key that exists in one mode exists in the other, but read it
     back through settingFor rather than assuming — a mode that dropped a
     setting would otherwise deal whatever happened to be at that index. */
  const index = Math.max(0, list.findIndex((s) => s.key === saved.difficulty));
  const setting = list[index];
  saved.difficulty = setting.key;

  const modes = $('mode-pick');
  if (modes.childElementCount !== MODES.length) {
    modes.replaceChildren();
    for (const mode of MODES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'diff';
      button.setAttribute('role', 'radio');
      button.textContent = modeLabel(mode);
      button.addEventListener('click', () => {
        saved.mode = mode;
        save();
        paintRandomScreen();
      });
      modes.append(button);
    }
  }
  for (let i = 0; i < MODES.length; i++) {
    const button = modes.children[i] as HTMLElement;
    button.classList.toggle('is-on', MODES[i] === saved.mode);
    button.setAttribute('aria-checked', String(MODES[i] === saved.mode));
  }

  ($('difficulty') as HTMLInputElement).max = String(list.length - 1);
  ($('difficulty') as HTMLInputElement).value = String(index);
  $('difficulty').setAttribute('aria-valuetext', setting.label);
  $('difficulty-name').textContent = setting.label;
  $('difficulty-blurb').textContent = setting.blurb;
  $('difficulty-shape').textContent =
    setting.width + '×' + setting.height + ' · ' + setting.palette + ' colors · ' +
    (setting.mode === 'merge' ? 'two corners · ' : '') +
    (setting.slack === 0
      ? 'par exactly'
      : setting.slack + (setting.slack === 1 ? ' move' : ' moves') + ' over par');

  const ticks = $('difficulty-ticks');
  ticks.replaceChildren();
  for (const s of list) {
    const span = document.createElement('span');
    span.textContent = s.label;
    ticks.append(span);
  }
  for (let i = 0; i < list.length; i++) {
    (ticks.children[i] as HTMLElement).classList.toggle('is-on', i === index);
  }
}

function showLevels(mode: Mode): void {
  const run = saved.progress[mode];
  const done = run.best.filter((m) => m > 0).length;
  const atPar = run.best.filter((m, i) => m > 0 && m === run.par[i]).length;

  $('levels-heading').textContent = modeLabel(mode);
  $('levels-note').textContent =
    done + ' of ' + CAMPAIGN_LENGTH + ' done' + (atPar ? ' · ' + atPar + ' at par' : '');

  const grid = $('level-grid');
  grid.replaceChildren();
  for (let n = 1; n <= CAMPAIGN_LENGTH; n++) {
    const item = document.createElement('li');
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.disabled = !unlocked(mode, n);

    const number = document.createElement('span');
    number.textContent = String(n);
    const mark = document.createElement('span');
    mark.className = 'tile__mark';
    tile.append(number, mark);

    const best = run.best[n - 1];
    if (best > 0) {
      const par = run.par[n - 1];
      tile.classList.add(par > 0 && best <= par ? 'is-par' : 'is-done');
      mark.textContent = String(best);
      tile.setAttribute('aria-label',
        'Level ' + n + ', done in ' + best + ' moves' + (par > 0 ? ', par ' + par : ''));
    } else if (tile.disabled) {
      tile.setAttribute('aria-label', 'Level ' + n + ', locked');
    } else {
      tile.setAttribute('aria-label', 'Level ' + n);
    }

    tile.addEventListener('click', () => playCampaign(mode, n, tile));
    item.append(tile);
    grid.append(item);
  }
  show('screen-levels');
}

/* Which month the calendar is showing. Today's, until somebody pages back. */
let shownMonth = new Date();

function paintDailyScreen(): void {
  const today = new Date();
  const solved = new Set(saved.days);
  const first = firstDailyDate();

  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();
  $('cal-month').textContent =
    shownMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  /* Paging stops where the puzzles do, in both directions. */
  ($('cal-prev') as HTMLButtonElement).disabled =
    year === first.getFullYear() && month === first.getMonth();
  ($('cal-next') as HTMLButtonElement).disabled =
    year === today.getFullYear() && month === today.getMonth();

  const grid = $('cal-grid');
  grid.replaceChildren();

  /* Monday-first, to match the column headings. getDay is Sunday-first, so
     Sunday's 0 becomes 6 and everything else shifts down one. */
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) {
    const blank = document.createElement('li');
    blank.className = 'cal--blank';
    blank.setAttribute('aria-hidden', 'true');
    grid.append(blank);
  }

  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month, d);
    const key = dayKey(date);
    const setting = dailySetting(date);
    const playable = isPlayableDay(date, today);

    const item = document.createElement('li');
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal__day';
    cell.disabled = !playable;
    if (key === dayKey(today)) cell.classList.add('is-today');
    if (solved.has(key)) cell.classList.add('is-done');

    const number = document.createElement('span');
    number.textContent = String(d);
    const dot = document.createElement('i');
    dot.className = 'cal__dot cal__dot--' + setting.mode;
    cell.append(number, dot);

    cell.setAttribute('aria-label',
      date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) +
      ' · ' + modeLabel(setting.mode) + ' · ' + setting.label +
      (solved.has(key) ? ' · done' : playable ? '' : ' · not playable'));

    if (playable) cell.addEventListener('click', () => playDaily(date, cell));
    item.append(cell);
    grid.append(item);
  }

  const streak = streakOf(solved, today);
  $('streak-now').textContent = String(streak);
  $('streak-best').textContent = String(bestStreakOf(solved));
  $('streak-total').textContent = String(solved.size);

  const todaySetting = dailySetting(today);
  $('daily-note').textContent = solved.has(dayKey(today))
    ? "Today's is done — " + modeLabel(todaySetting.mode) + ' · ' + todaySetting.label
    : "Today: " + modeLabel(todaySetting.mode) + ' · ' + todaySetting.label;
}

/* ------------------------------------------------------------------ wiring */

function wire(): void {
  $('go-flood').addEventListener('click', () => showLevels('flood'));
  $('go-merge').addEventListener('click', () => showLevels('merge'));
  $('go-random').addEventListener('click', () => { paintRandomScreen(); show('screen-random'); });
  $('go-daily').addEventListener('click', () => {
    shownMonth = new Date();
    paintDailyScreen();
    show('screen-daily');
  });
  $('cal-prev').addEventListener('click', () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
    paintDailyScreen();
  });
  $('cal-next').addEventListener('click', () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
    paintDailyScreen();
  });
  for (const btn of document.querySelectorAll('[data-home]')) {
    btn.addEventListener('click', () => show('screen-home'));
  }
  /* Back out of a campaign level to its grid rather than to the home screen —
     the next thing wanted after level 12 is almost always level 13. */
  $('back').addEventListener('click', () => {
    if (session?.campaign) showLevels(session.campaign.mode);
    else if (session?.kind === 'daily') { paintDailyScreen(); show('screen-daily'); }
    else show('screen-home');
  });

  $('difficulty').addEventListener('input', (e) => {
    const list = settingsFor(saved.mode);
    saved.difficulty = list[Number((e.target as HTMLInputElement).value)].key;
    save();
    paintRandomScreen();
  });
  $('deal').addEventListener('click', () => dealRandom($('deal') as HTMLButtonElement));

  $('undo').addEventListener('click', () => {
    if (session && undo(session.game)) { session.hinted = -1; paint(); say(''); }
  });
  $('hint').addEventListener('click', askHint);
  $('restart').addEventListener('click', () => {
    if (session) { restart(session.game); session.hinted = -1; paint(); say(''); }
  });
  $('again').addEventListener('click', () => dealRandom($('again') as HTMLButtonElement));

  /* The three ways off a finished board, and the only three places an ad is
     allowed to appear: the card is closed, the ad is offered the seam, and
     whatever comes next happens after it. Nothing here interrupts a board
     being played, and the awaits are no-ops on the web build. */
  $('win-again').addEventListener('click', async () => {
    closeOverlay('overlay-win');
    await Ads.maybeShow();
    dealRandom($('again') as HTMLButtonElement);
  });
  $('win-next').addEventListener('click', async () => {
    closeOverlay('overlay-win');
    const at = session?.campaign;
    await Ads.maybeShow();
    if (at) playCampaign(at.mode, at.n + 1, $('win-next') as HTMLButtonElement);
  });
  $('win-home').addEventListener('click', async () => {
    closeOverlay('overlay-win');
    const was = session;
    await Ads.maybeShow();
    if (was?.campaign) showLevels(was.campaign.mode);
    else if (was?.kind === 'daily') { paintDailyScreen(); show('screen-daily'); }
    else show('screen-home');
  });

  $('how-to').addEventListener('click', () => openOverlay('overlay-howto'));
  /* Settings is reachable from the board as well as from home. Colour Blind
     Assist is the reason: the moment somebody wants it is the moment they are
     looking at a board they cannot read, and making them back out to the home
     screen to find it is making them do it blind. */
  for (const id of ['settings', 'game-settings']) {
    $(id).addEventListener('click', () => { paintSettings(); openOverlay('overlay-settings'); });
  }
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => closeOverlay((btn as HTMLElement).dataset.close!));
  }

  $('set-sound').addEventListener('click', () => {
    saved.sound = !saved.sound;
    Sound.on = saved.sound;
    save();
    paintSettings();
    /* Turning it on says so — the switch is the one control whose effect is
       otherwise not there to hear. Turning it off hands the device back at
       once rather than after the idle timeout. */
    if (saved.sound) Sound.tap();
    else Sound.hush();
  });

  $('set-marks').addEventListener('click', () => {
    saved.marks = !saved.marks;
    save();
    paintSettings();
    $('board').classList.toggle('no-marks', !saved.marks);
    $('picker').classList.toggle('no-marks', !saved.marks);
  });
  /* Erasing takes two presses. Two hundred levels of progress is a real thing
     to lose to a mis-tap, and the ellipsis on the button is a promise that
     something comes next — so something does. Any other press, or closing the
     panel, forgets that it was ever asked. */
  let armed = false;
  const disarm = () => {
    armed = false;
    $('set-wipe').textContent = 'Erase…';
    $('set-wipe').classList.remove('btn--primary');
  };
  $('set-wipe').addEventListener('click', () => {
    if (!armed) {
      armed = true;
      $('set-wipe').textContent = 'Sure?';
      $('set-wipe').classList.add('btn--primary');
      $('settings-note').textContent =
        'This erases both campaigns and every daily. It cannot be undone.';
      return;
    }
    saved.progress = { flood: blankProgress(), merge: blankProgress() };
    saved.days = [];
    save();
    disarm();
    $('settings-note').textContent = 'Progress erased.';
  });
  $('set-marks').addEventListener('click', disarm);
  for (const id of ['settings', 'game-settings']) {
    $(id).addEventListener('click', () => {
      disarm();
      $('settings-note').textContent = '';
    });
  }

  /* Every button clicks, in one place rather than thirty. The board and the
     picker are left out because they have their own voices — a move already
     sounds, and a tap on top of it would double up. */
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest('button');
    if (!el) return;
    if (el.closest('#board') || el.closest('#picker')) return;
    /* No `disabled` check here, and that is deliberate twice over. A disabled
       button never dispatches a click in the first place, so it would be dead
       code — and worse than dead, because this runs on the way back up: Deal
       and Undo both disable themselves in their own handlers, so by the time
       the event arrived here they looked disabled and went silent. */
    Sound.tap();
  });

  window.addEventListener('keydown', (e) => {
    if (!$('overlay-win').hidden || !$('overlay-howto').hidden || !$('overlay-settings').hidden) {
      if (e.key === 'Escape') {
        for (const id of ['overlay-win', 'overlay-howto', 'overlay-settings']) closeOverlay(id);
      }
      return;
    }
    if (!$('screen-game').classList.contains('is-active')) return;
    if (e.key === 'Escape') return void $('back').click();
    if (e.key === 'u' || e.key === 'U') return void $('undo').click();
    if (e.key === 'h' || e.key === 'H') return void $('hint').click();
    if (e.key === 'r' || e.key === 'R') return void $('restart').click();
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_PALETTE) tryPlay(n - 1);
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

function paintSettings(): void {
  for (const [id, on] of [['set-sound', saved.sound], ['set-marks', saved.marks]] as const) {
    $(id).textContent = on ? 'On' : 'Off';
    $(id).setAttribute('aria-pressed', String(on));
  }
}

Sound.on = saved.sound;
wire();
paintRandomScreen();
/* Native only, and deliberately at boot: the GDPR form and iOS's tracking
   prompt land while the player is still looking at the home screen, and the
   first interstitial is warm long before anything is allowed to show it. */
Ads.start();
/* Only ever with ?ads=preview in the URL. Draws an empty box the size of the
   banner so the layout can be looked at without a phone build. */
startAdPreview();
