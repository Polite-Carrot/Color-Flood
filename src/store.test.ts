/* store.test.ts — the save survives, whichever copy it is found in.
 *
 * Run against a stand-in for the native store and an in-memory localStorage,
 * so every way the two copies can disagree is covered without a phone. */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { KEY, RESTORE_TIMEOUT_MS, persist, restore, type Prefs } from './store.ts';

let native: Map<string, string>;
let local: Map<string, string>;

const prefs = (): Prefs => ({
  get: async ({ key }) => ({ value: native.get(key) ?? null }),
  set: async ({ key, value }) => { native.set(key, value); },
});

beforeEach(() => {
  native = new Map();
  local = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => local.get(k) ?? null,
      setItem: (k: string, v: string) => { local.set(k, v); },
    },
  });
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)['localStorage'];
  vi.useRealTimers();
});

describe('the save', () => {
  it('comes from native storage when iOS has cleared the web view', async () => {
    native.set(KEY, '{"progress":"kept"}');
    /* localStorage empty: exactly what a cleared web view looks like. */
    await expect(restore(prefs(), null)).resolves.toBe('{"progress":"kept"}');
    /* And the local copy is put back, so the two agree again. */
    expect(local.get(KEY)).toBe('{"progress":"kept"}');
  });

  it('prefers the native copy when the two disagree', async () => {
    native.set(KEY, 'native');
    await expect(restore(prefs(), 'local')).resolves.toBe('native');
  });

  it('carries a save from before this change into native storage', async () => {
    /* An existing player: everything so far is in localStorage only. */
    await expect(restore(prefs(), 'older save')).resolves.toBe('older save');
    await Promise.resolve();
    expect(native.get(KEY)).toBe('older save');
  });

  it('starts fresh on a first launch', async () => {
    await expect(restore(prefs(), null)).resolves.toBeNull();
    expect(native.size).toBe(0);
  });

  it('falls back to the local copy if the native read fails', async () => {
    const broken: Prefs = { get: async () => { throw new Error('bridge'); }, set: async () => {} };
    await expect(restore(broken, 'local')).resolves.toBe('local');
  });

  it('does not keep the game waiting on a native read that never answers', async () => {
    vi.useFakeTimers();
    const stuck: Prefs = { get: () => new Promise(() => {}), set: async () => {} };
    const p = restore(stuck, 'local');
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS);
    await expect(p).resolves.toBe('local');
  });

  it('uses the local copy on the web', async () => {
    await expect(restore(null, 'web')).resolves.toBe('web');
  });

  it('is written to both copies', async () => {
    persist('saved', prefs());
    await Promise.resolve();
    expect(local.get(KEY)).toBe('saved');
    expect(native.get(KEY)).toBe('saved');
  });
});
