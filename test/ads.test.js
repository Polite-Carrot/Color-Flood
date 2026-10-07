/* ads.test.js — when the interstitial is allowed to appear.
 *
 * Mostly the gate. The Unity plumbing around it is a no-op off a phone and
 * there is little in it to assert that would not just be restating the
 * plugin's own API back at it; the cadence is the part that was actually
 * specified, and the part a change could quietly get wrong. The rest checks
 * that the module stays inert where it should, that the interstitial is the
 * only format, and that AdMob is gone. */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Ads, CLOSE_TIMEOUT_MS, Gate, GAME_ID, MIN_LEVELS, MIN_MS, PLACEMENT } from "../js/ads.js";
const PoliteCarrotAds = createRequire(import.meta.url)('@politecarrot/capacitor-unity-ads');
const T0 = 1_700_000_000_000; /* any fixed instant; nothing here reads a clock */
const wins = (gate, n) => { for (let i = 0; i < n; i++)
    gate.note(); };
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
        /* Filled in from the Unity dashboard. */
        expect(GAME_ID.ios).toBe('800385205');
        expect(GAME_ID.android).toBe('800386041');
    });
});
describe('AdMob', () => {
    /* It was asked to be removed, all of it, and a leftover app ID in a
       manifest is exactly the kind of thing nobody notices until the Play
       Console flags an SDK the app no longer ships. */
    it('is gone from the source and the native configuration', () => {
        const root = new URL('../', import.meta.url);
        const files = [
            ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f),
            'package.json',
            'android/app/src/main/AndroidManifest.xml',
            'android/app/capacitor.build.gradle',
            'android/capacitor.settings.gradle',
            'ios/App/App/Info.plist',
            'ios/App/CapApp-SPM/Package.swift',
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
            'js/ads.js',
            'js/app.js',
            'styles.css',
        ];
        for (const f of files) {
            const code = readFileSync(new URL(f, root), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '');
            expect(code, f).not.toMatch(/banner|rewarded|--ad-h/i);
        }
    });
});
describe('through the shared package', () => {
    /* The real @politecarrot/capacitor-unity-ads client over a stand-in native
       bridge, so the whole path — ATT, consent, init, load, show — runs here
       with a fake clock. */
    let att;
    let os;
    let calls;
    let showAd;
    const native = {
        trackingAuthorizationStatus: async () => ({ status: att }),
        requestTrackingAuthorization: async () => {
            if (att === 'notDetermined')
                att = 'authorized';
            return { status: att };
        },
        setConsent: async (o) => { calls.push(`consent=${o.granted}`); },
        initialize: async () => { calls.push('initialize'); },
        prepareInterstitial: async (o) => { calls.push('load ' + o.placementId); return { loaded: true }; },
        showInterstitial: () => { calls.push('show'); return showAd(); },
    };
    const never = () => new Promise(() => { });
    /* After the privacy sheet: Ads.start() and everything it kicks off. */
    async function started() {
        Ads.start();
        await vi.advanceTimersByTimeAsync(0);
    }
    async function due() {
        await started();
        for (let i = 0; i < MIN_LEVELS; i++)
            Ads.noteWin();
        await vi.advanceTimersByTimeAsync(0);
        vi.setSystemTime(T0 + MIN_MS);
    }
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        att = 'authorized';
        os = 'ios';
        calls = [];
        showAd = async () => ({ shown: true });
        const Capacitor = { isNativePlatform: () => true, getPlatform: () => os, registerPlugin: () => native };
        Object.assign(globalThis, { Capacitor });
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            writable: true,
            value: { Capacitor, PoliteCarrotAds },
        });
        Object.assign(Ads, {
            gate: new Gate(T0), client: null, started: false, showing: false, preparing: null,
            personalised: false, settle: (yes) => Ads.setPersonalised(yes),
        });
    });
    afterEach(() => {
        delete globalThis['window'];
        delete globalThis['Capacitor'];
        vi.useRealTimers();
    });
    it('asks for tracking, sends consent, then starts Unity and warms an ad', async () => {
        att = 'notDetermined';
        await started();
        expect(Ads.personalised).toBe(true);
        /* The ATT call syncs the not-yet-answered state first; the Allow lands
           before Unity initialises, which is what matters. */
        expect(calls.slice(-3)).toEqual(['consent=true', 'initialize', 'load ' + PLACEMENT.ios]);
    });
    it('keeps ads non-personalised when tracking is refused', async () => {
        att = 'denied';
        await started();
        expect(Ads.personalised).toBe(false);
        expect(calls[0]).toBe('consent=false');
    });
    it('keeps them off on Android, where nothing was asked', async () => {
        os = 'android';
        await started();
        expect(Ads.personalised).toBe(false);
        expect(calls).toEqual(['consent=false', 'initialize', 'load ' + PLACEMENT.android]);
    });
    it('shows a loaded ad once the cadence is met, and starts the count again', async () => {
        await due();
        await expect(Ads.maybeShow()).resolves.toBe(true);
        expect(calls).toContain('show');
        expect(Ads.gate.levels).toBe(0);
    });
    it('shows nothing before the cadence is met', async () => {
        await started();
        for (let i = 0; i < MIN_LEVELS; i++)
            Ads.noteWin();
        vi.setSystemTime(T0 + MIN_MS - 1);
        await expect(Ads.maybeShow()).resolves.toBe(false);
        expect(calls).not.toContain('show');
    });
    it('carries on when the ad fails to show, and does not count it', async () => {
        showAd = async () => { throw new Error('show failed'); };
        await due();
        await expect(Ads.maybeShow()).resolves.toBe(false);
        expect(Ads.gate.levels).toBe(MIN_LEVELS);
    });
    it('lets the game go on if the SDK never says the ad closed', async () => {
        showAd = never;
        await due();
        const p = Ads.maybeShow();
        let done = false;
        void p.then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(CLOSE_TIMEOUT_MS - 1);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(p).resolves.toBe(true);
    });
    it('never asks for an ad before the privacy sheet has been answered', async () => {
        Ads.noteWin();
        Ads.noteWin();
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toEqual([]);
    });
});
