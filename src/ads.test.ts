/* ads.test.ts — when the interstitial is allowed to appear.
 *
 * Mostly the gate. The Unity plumbing around it is a no-op off a phone and
 * there is little in it to assert that would not just be restating the
 * plugin's own API back at it; the cadence is the part that was actually
 * specified, and the part a change could quietly get wrong. The rest checks
 * that the module stays inert where it should, that the interstitial is the
 * only format, and that AdMob is gone. */

import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Ads, CLOSE_TIMEOUT_MS, Gate, GAME_ID, MIN_LEVELS, MIN_MS, PLACEMENT, SHOW_TIMEOUT_MS } from './ads.ts';

const T0 = 1_700_000_000_000; /* any fixed instant; nothing here reads a clock */
const wins = (gate: Gate, n: number) => { for (let i = 0; i < n; i++) gate.note(); };

describe('the ad gate', () => {
  it('is both conditions, not either', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS);
    /* Enough levels, but inside ninety seconds. */
    expect(gate.due(T0 + 90_000)).toBe(false);

    const idle = new Gate(T0);
    /* Ten minutes on the level grid, no puzzle finished. */
    expect(idle.due(T0 + 10 * 60_000)).toBe(false);
  });

  it('fires once both have been met', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS);
    expect(gate.due(T0 + MIN_MS)).toBe(true);
  });

  it('needs the last win, not the one before it', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS - 1);
    expect(gate.due(T0 + MIN_MS)).toBe(false);
    gate.note();
    expect(gate.due(T0 + MIN_MS)).toBe(true);
  });

  it('starts warming an ad one win before it can be shown', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS - 2);
    expect(gate.warming()).toBe(false);
    gate.note();
    expect(gate.warming()).toBe(true);
  });

  it('resets both counters when one is shown, so two never run together', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS);
    const at = T0 + MIN_MS;
    expect(gate.due(at)).toBe(true);
    gate.shown(at);

    /* The next wins land immediately after. The clock has restarted, so they
       do not fire a second ad on top of the first. */
    wins(gate, MIN_LEVELS);
    expect(gate.due(at + 1000)).toBe(false);
    expect(gate.due(at + MIN_MS)).toBe(true);
  });

  it('counts time from when it was made, so a fresh install gets two minutes', () => {
    const gate = new Gate(T0);
    /* A fast player: the threshold cleared inside the first minute. */
    wins(gate, MIN_LEVELS + 2);
    expect(gate.due(T0 + 60_000)).toBe(false);
    expect(gate.due(T0 + MIN_MS)).toBe(true);
  });

  it('is the cap that was asked for', () => {
    expect(MIN_LEVELS).toBe(3);
    expect(MIN_MS).toBe(2 * 60 * 1000);
  });
});

describe('the Unity module', () => {
  it('does nothing off a phone, so the web build never asks for an ad', async () => {
    expect(Ads.native()).toBe(false);
    expect(Ads.on()).toBe(false);
    Ads.noteWin();
    expect(Ads.gate.levels).toBe(0);
    await expect(Ads.maybeShow()).resolves.toBe(false);
    Ads.start();
    expect(Ads.started).toBe(false);
  });

  it('has an interstitial placement on both stores', () => {
    expect(PLACEMENT.ios).toMatch(/Interstitial_iOS$/);
    expect(PLACEMENT.android).toMatch(/Interstitial_Android$/);
    /* Filled in from the dashboard; a string either way, never undefined. */
    expect(typeof GAME_ID.ios).toBe('string');
    expect(typeof GAME_ID.android).toBe('string');
  });
});

describe('AdMob', () => {
  /* It was asked to be removed, all of it, and a leftover app ID in a
     manifest is exactly the kind of thing nobody notices until the Play
     Console flags an SDK the app no longer ships. */
  it('is gone from the source and the native configuration', () => {
    const root = new URL('../', import.meta.url);
    const files = [
      ...readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.ts') && f !== 'ads.test.ts').map((f) => 'src/' + f),
      'package.json',
      'android/app/src/main/AndroidManifest.xml',
      'android/app/capacitor.build.gradle',
      'android/capacitor.settings.gradle',
      'ios/App/App/Info.plist',
      'ios/App/Podfile',
    ];
    for (const f of files) {
      expect(readFileSync(new URL(f, root), 'utf8'), f).not.toMatch(/admob|ca-app-pub|GADApplicationIdentifier|gms\.ads\.APPLICATION_ID/i);
    }
  });
});

describe('ad formats', () => {
  /* Interstitial only. No banner and no rewarded ad — asked for explicitly,
     so a test holds it. */
  it('is the interstitial and nothing else', () => {
    const root = new URL('../', import.meta.url);
    const files = [
      'src/ads.ts',
      'src/app.ts',
      'styles.css',
      'plugins/unity-ads/ios/Sources/UnityAdsPlugin/UnityAdsPlugin.swift',
    ];
    for (const f of files) {
      const code = readFileSync(new URL(f, root), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/banner|rewarded|--ad-h/i);
    }
  });
});

describe('the fail-safes', () => {
  /* A stand-in for the native plugin on an iPhone, so the ad path can be run
     here with a fake clock: every way an ad can go wrong, and the game must
     come out the other side of all of them. */
  type Listener = () => void;
  let listeners: Record<string, Listener>;
  let loadAd: () => Promise<unknown>;
  let showAd: () => Promise<unknown>;
  const shows = vi.fn();
  /* What the tracking prompt answers, which phone this is, and everything the
     plugin was told, in order. */
  let att: string;
  let os: string;
  let calls: string[];

  const plugin = {
    initialize: async () => { calls.push('initialize'); },
    setConsent: async (o: { consent?: boolean; optOut?: boolean }) => {
      calls.push(`consent=${o.consent} optOut=${o.optOut}`);
    },
    trackingStatus: async () => ({ status: att }),
    requestTracking: async () => { if (att === 'notDetermined') att = 'authorized'; return { status: att }; },
    loadInterstitial: () => { calls.push('load'); return loadAd(); },
    showInterstitial: () => { shows(); return showAd(); },
    addListener: async (event: string, fn: Listener) => { listeners[event] = fn; },
  };

  const never = () => new Promise<unknown>(() => {});

  /* Game running, three puzzles done and two minutes gone: an ad is due. */
  async function due(): Promise<void> {
    Ads.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MIN_LEVELS; i++) Ads.gate.note();
    vi.setSystemTime(T0 + MIN_MS);
  }

  /* Whether a promise has settled yet, without waiting on it. */
  const settled = (p: Promise<unknown>) => {
    const state = { done: false };
    void p.then(() => { state.done = true; });
    return state;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    listeners = {};
    loadAd = async () => {};
    showAd = async () => {};
    shows.mockClear();
    att = 'authorized';
    os = 'ios';
    calls = [];
    Object.assign(Ads, {
      gate: new Gate(T0), plugin: null, ready: false, starting: null, loaded: false,
      loading: null, started: false, appeared: null, personalised: false,
      settle: () => {},
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { Capacitor: { isNativePlatform: () => true, getPlatform: () => os, registerPlugin: () => plugin } },
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)['window'];
    vi.useRealTimers();
  });

  it('shows an ad that is loaded, and waits for it to be closed', async () => {
    let close!: () => void;
    showAd = () => new Promise<void>((resolve) => { close = resolve; });
    await due();
    expect(Ads.loaded).toBe(true);

    const p = Ads.maybeShow();
    const state = settled(p);
    await vi.advanceTimersByTimeAsync(0);
    listeners['interstitialStarted']!();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.done).toBe(false);          /* the ad is still up */
    close();
    await expect(p).resolves.toBe(true);
    expect(Ads.gate.levels).toBe(0);         /* the count starts again */
  });

  it('skips the ad, without waiting, when it is still loading', async () => {
    loadAd = never;                          /* a network that never answers */
    await due();
    expect(Ads.loaded).toBe(false);
    /* Settles with no time passing at all: the player is not kept waiting. */
    await expect(Ads.maybeShow()).resolves.toBe(false);
    expect(shows).not.toHaveBeenCalled();
  });

  it('gives up on an ad that has not appeared within the time limit', async () => {
    showAd = never;
    await due();
    const p = Ads.maybeShow();
    const state = settled(p);
    await vi.advanceTimersByTimeAsync(SHOW_TIMEOUT_MS - 1);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(false);
    /* Not counted as seen, so the next seam tries again. */
    expect(Ads.gate.levels).toBe(MIN_LEVELS);
  });

  it('carries on when the ad fails to show', async () => {
    showAd = async () => { throw new Error('show failed'); };
    await due();
    await expect(Ads.maybeShow()).resolves.toBe(false);
  });

  it('lets go of an ad that appeared but never says it closed', async () => {
    showAd = never;
    await due();
    const p = Ads.maybeShow();
    const state = settled(p);
    await vi.advanceTimersByTimeAsync(0);
    listeners['interstitialStarted']!();
    await vi.advanceTimersByTimeAsync(CLOSE_TIMEOUT_MS - 1);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(true);
    /* It was seen, so it counts, and a second one cannot follow straight on. */
    expect(Ads.gate.levels).toBe(0);
  });

  it('turns personalised ads on when tracking is allowed, before Unity starts', async () => {
    att = 'notDetermined';                   /* first launch: the prompt shows, player taps Allow */
    const answers: boolean[] = [];
    Ads.settle = (yes) => { answers.push(yes); };
    await due();
    expect(Ads.personalised).toBe(true);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((yes) => yes)).toBe(true);   /* recorded as a yes, never a no */
    expect(calls.slice(0, 2)).toEqual(['consent=true optOut=false', 'initialize']);
  });

  it('keeps them off when tracking is refused', async () => {
    att = 'denied';
    await due();
    expect(Ads.personalised).toBe(false);
    expect(calls.slice(0, 2)).toEqual(['consent=false optOut=true', 'initialize']);
  });

  it('keeps them off on Android, where nothing was asked', async () => {
    os = 'android';
    GAME_ID.android = 'test';                /* Android is not configured yet; pretend for this */
    try {
      await due();
      expect(Ads.personalised).toBe(false);
      expect(calls[0]).toBe('consent=false optOut=true');
    } finally {
      GAME_ID.android = '';
    }
  });

  it('notices tracking switched off in iOS Settings before the next ad loads', async () => {
    await due();
    expect(calls).toContain('consent=true optOut=false');
    calls = [];
    att = 'denied';                          /* changed in Settings while the game ran */
    Ads.loaded = false;
    await Ads.load();
    expect(Ads.personalised).toBe(false);
    expect(calls).toEqual(['consent=false optOut=true', 'load']);
  });

  it('shows nothing before the cadence is met', async () => {
    await due();
    vi.setSystemTime(T0 + MIN_MS - 1);
    await expect(Ads.maybeShow()).resolves.toBe(false);
    expect(shows).not.toHaveBeenCalled();
  });
});
