/* ads.ts — the interstitial, and the rule about when it is allowed to
 * appear. Served by Unity Ads. There is no banner and no rewarded ad: the
 * interstitial is the only format this game shows.
 *
 * Ported from the sort game's ads.js. The cap is the same one, deliberately
 * gentle for a puzzle game: ONE interstitial fires when BOTH of these have
 * happened since the last one shown —
 *
 *   - at least two minutes of wall-clock time, AND
 *   - at least three puzzles finished.
 *
 * Whichever comes last, not whichever comes first. Three levels inside ninety
 * seconds does not fire. Two minutes spent reading the level grid does not
 * fire. Only both together do, and only at a seam between puzzles — never
 * over a board being played.
 *
 * The clock starts at module load rather than at zero, so the first ad cannot
 * land inside the opening two minutes of a fresh install.
 *
 * Everything below the Gate is a no-op off a phone: the web build has no
 * window.Capacitor, so github.io runs the same file and never asks for an ad.
 * That is also what lets the gate itself be tested in Node. */
/* ─── the rule ───
   Kept apart from the plugin on purpose. This half is arithmetic over two
   numbers, it is what the ask was actually about, and it is the half worth
   having a test for — none of which is true of the plugin plumbing. */
export const MIN_MS = 2 * 60 * 1000;
export const MIN_LEVELS = 3;
export class Gate {
    since;
    levels = 0;
    constructor(now) { this.since = now; }
    /* One finished puzzle. Campaign, daily or random alike: the cadence counts
       boards actually solved, not win cards seen — a replay of a level already
       beaten still costs the player the same minute of their evening. */
    note() { this.levels += 1; }
    /* One short of the threshold is the moment to start loading an ad, so the
       win that fires it does not have to wait for the network to finish. */
    warming() { return this.levels >= MIN_LEVELS - 1; }
    due(now) {
        return now - this.since >= MIN_MS && this.levels >= MIN_LEVELS;
    }
    shown(now) { this.since = now; this.levels = 0; }
}
/* ─── the client ───
   Unity Ads through the studio's shared package,
   @politecarrot/capacitor-unity-ads — the same one color-sorting uses. SDK
   lifecycle, consent flags, ATT and playback live there; this file only owns
   the IDs and the cadence. The package is a plain script that defines
   window.PoliteCarrotAds; scripts/sync-www.js copies it to vendor/unity-ads.js
   and index.html loads it before js/app.js. */
/* The Game IDs from the Unity dashboard, one per store. Not secrets: every
   shipped build carries its own in the binary. */
export const GAME_ID = {
    ios: '800385205',
    android: '800386041',
};
/* The dashboard's "Network Placement ID" for the interstitial, copied
   exactly — Unity answers an unknown one with a load error and nothing else. */
export const PLACEMENT = {
    ios: 'BP_Interstitial_iOS',
    android: 'BP_Interstitial_Android',
};
/* Live ads. Never tap your own ads; use the Unity dashboard's per-device test mode instead. */
export const TEST_MODE = false;
/* The package deliberately never times out a visible ad. This is the game's
   own backstop: if the SDK loses its close callback, the player is let back
   to the next board after this long, and the package's own `showing` flag
   still stops a second ad stacking on the first. */
export const CLOSE_TIMEOUT_MS = 2 * 60 * 1000;
const host = () => (typeof window === 'undefined' ? null : window);
const platform = () => (host()?.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android');
const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
export const Ads = {
    gate: new Gate(Date.now()),
    client: null,
    /* Set by start() and nothing else, so the tracking prompt can never come up
       in front of the usage-data sheet that is meant to come first. */
    started: false,
    showing: false,
    preparing: null,
    /* The app's saved answer. Effective personalisation is this AND iOS
       tracking allowed — the package enforces the second half. */
    personalised: false,
    /* Called with the tracking prompt's answer so the app can save it and bring
       analytics' consent grants into line. Replaced in app.ts. */
    settle: ((_authorised) => { }),
    native() {
        return !!host()?.Capacitor?.isNativePlatform?.();
    },
    /* Native, configured for this platform, and the vendor script loaded. */
    on() {
        return this.native() && GAME_ID[platform()] !== '' && !!host()?.PoliteCarrotAds;
    },
    /* Created on first use rather than at import, so Capacitor's bridge is in
       place and the web build never constructs one. */
    get() {
        if (this.client)
            return this.client;
        if (!this.on())
            return null;
        this.client = host().PoliteCarrotAds.createUnityAds({
            ios: { gameId: GAME_ID.ios, interstitial: PLACEMENT.ios },
            android: { gameId: GAME_ID.android, interstitial: PLACEMENT.android },
            testMode: TEST_MODE,
        });
        return this.client;
    },
    warm() {
        const client = this.get();
        if (!client || !this.started || this.showing)
            return Promise.resolve(false);
        if (this.preparing)
            return this.preparing;
        this.preparing = client.prepareInterstitial()
            .then((r) => r.loaded === true, () => false)
            .finally(() => { this.preparing = null; });
        return this.preparing;
    },
    /* Called once per puzzle finished. */
    noteWin() {
        if (!this.on())
            return;
        this.gate.note();
        if (this.gate.warming() && !this.get().state().prepared.interstitial)
            void this.warm();
    },
    /* Called where the game is about to leave a finished board — the win card's
       three buttons. Never waits on the network: an ad that is not already
       loaded is skipped, and one is lined up for the next seam. */
    async maybeShow() {
        if (!this.on() || !this.started || this.showing)
            return false;
        if (!this.gate.due(Date.now()))
            return false;
        const client = this.get();
        if (!client.state().prepared.interstitial) {
            void this.warm();
            return false;
        }
        this.showing = true;
        try {
            const shown = client.showInterstitial().then((r) => r.shown === true, () => false);
            /* Seen, so it counts — even one that closes after the backstop let go. */
            void shown.then((yes) => { if (yes)
                this.gate.shown(Date.now()); });
            return await Promise.race([shown, after(CLOSE_TIMEOUT_MS, true)]);
        }
        finally {
            this.showing = false;
            void this.warm();
        }
    },
    /* A change goes to Unity at once; the package drops any ad loaded under the
       old answer, so a fresh one is warmed in its place. */
    setPersonalised(on) {
        this.personalised = on;
        const client = this.get();
        if (!client || client.state().personalized === on)
            return;
        void client.setPersonalized(on).then(() => { if (this.started)
            void this.warm(); }, () => { });
    },
    /* After the privacy sheet: the ATT prompt (iOS only; Android answers
       "notApplicable", which is a no), the consent flags that answer becomes,
       then the SDK and a first warm ad well before the third win. */
    start() {
        if (!this.on() || this.started)
            return;
        this.started = true;
        const client = this.get();
        void (async () => {
            try {
                this.settle((await client.requestTracking()) === 'authorized');
            }
            catch { /* keep the saved answer */ }
            await client.init();
            await this.warm();
        })();
    },
};
