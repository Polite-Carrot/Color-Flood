/* ads.test.ts — when the interstitial is allowed to appear.
 *
 * Mostly the gate. The Unity plumbing around it is a no-op off a phone and
 * there is little in it to assert that would not just be restating the
 * plugin's own API back at it; the cadence is the part that was actually
 * specified, and the part a change could quietly get wrong. The rest checks
 * that the module stays inert where it should, and that AdMob is gone. */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Ads, Gate, GAME_ID, MIN_LEVELS, MIN_MS, PLACEMENT } from './ads.ts';

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
    expect(MIN_LEVELS).toBe(2);
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

  it('has an ad unit for both formats on both stores', () => {
    for (const format of [PLACEMENT.interstitial, PLACEMENT.banner]) {
      expect(format.ios).toMatch(/_iOS$/);
      expect(format.android).toMatch(/_Android$/);
    }
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
