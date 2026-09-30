/* store.ts — where the save lives.
 *
 * On a phone the save is kept in native storage, through @capacitor/preferences
 * (UserDefaults on iOS, SharedPreferences on Android). The web view's
 * localStorage is not a safe home for it: iOS treats web view storage as
 * something it may clear when the device is short of space, and a player a
 * few hundred levels into a thousand-level campaign should never open the
 * game to find it empty.
 *
 * localStorage is still written, every time, as a second copy. It is what the
 * web build uses, it is what lets the game read its settings synchronously
 * while the native copy is on its way, and it is where a save made before
 * this change is found and carried across.
 *
 * Reached through window.Capacitor rather than imported, for the same reason
 * as every other plugin here: js/ is plain ES modules and a web view cannot
 * resolve a bare package name. */

export const KEY = 'color-flood/v1';

/* The native read is waited for at boot, but not for ever. Past this the game
   starts from the local copy rather than sit on a blank home screen. */
export const RESTORE_TIMEOUT_MS = 3000;

export type Prefs = {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<unknown>;
};

type Cap = { isNativePlatform?: () => boolean; registerPlugin?: (name: string) => Prefs };

let plugin: Prefs | null | undefined;

/* The native store, or null off a phone. */
export function nativePrefs(): Prefs | null {
  if (plugin !== undefined) return plugin;
  const c = typeof window === 'undefined' ? null : (window as unknown as { Capacitor?: Cap }).Capacitor;
  plugin = c && c.isNativePlatform && c.isNativePlatform() && c.registerPlugin ? c.registerPlugin('Preferences') : null;
  return plugin;
}

export function readLocal(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function writeLocal(raw: string): void {
  try { localStorage.setItem(KEY, raw); } catch { /* private browsing, or storage off */ }
}

/* The save to start from. The native copy wins whenever there is one, since
   it is the one iOS will not clear. With none — a first launch, or the first
   launch since this change — the local copy is used and, if there is one,
   carried into native storage so it is safe from then on. Anything going
   wrong on the native side falls back to the local copy: a save that cannot
   be read is never a reason the game cannot open. */
export async function restore(
  prefs: Prefs | null = nativePrefs(),
  local: string | null = readLocal(),
  timeoutMs = RESTORE_TIMEOUT_MS,
): Promise<string | null> {
  if (!prefs) return local;
  try {
    const got = await Promise.race([
      prefs.get({ key: KEY }),
      new Promise<'slow'>((resolve) => setTimeout(() => resolve('slow'), timeoutMs)),
    ]);
    if (got === 'slow') return local;
    if (typeof got?.value === 'string') {
      /* Keep the second copy in step, so the synchronous read at the next
         launch starts from the same place. */
      if (got.value !== local) writeLocal(got.value);
      return got.value;
    }
    if (local !== null) void prefs.set({ key: KEY, value: local }).catch(() => {});
    return local;
  } catch {
    return local;
  }
}

/* Both copies, every time. The native write is not awaited: nothing the
   player is doing should wait on a save, and the bridge keeps the writes in
   the order they were made. */
export function persist(raw: string, prefs: Prefs | null = nativePrefs()): void {
  writeLocal(raw);
  if (prefs) void prefs.set({ key: KEY, value: raw }).catch(() => {});
}
