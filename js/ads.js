/* ads.ts — the interstitial, and the rule about when it is allowed to appear.
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
       third win does not have to wait for the network to finish. */
    warming() { return this.levels >= MIN_LEVELS - 1; }
    due(now) {
        return now - this.since >= MIN_MS && this.levels >= MIN_LEVELS;
    }
    shown(now) { this.since = now; this.levels = 0; }
}
/* ─── the plugin ─── */
/* Google's official test units. These are what is committed, on purpose: a
   real ad unit ID in a public repository is an invitation to have somebody
   else's traffic charged against the account, and a build that accidentally
   ships with test IDs shows test creatives, while a build that accidentally
   ships with real ones during development racks up invalid clicks.
   
   To ship for real, put the Color Flood units from the AdMob console here —
   and the matching app IDs in android/app/src/main/AndroidManifest.xml and
   ios/App/App/Info.plist, which carry test values for the same reason. */
const INTERSTITIAL = {
    android: 'ca-app-pub-3940256099942544/1033173712',
    ios: 'ca-app-pub-3940256099942544/4411468910',
};
const BANNER = {
    android: 'ca-app-pub-3940256099942544/6300978111',
    ios: 'ca-app-pub-3940256099942544/2934735716',
};
/* BANNER is the 320x50 one — the small strip, and the size asked for.
   ADAPTIVE_BANNER is the other sensible choice: it fills the width of the
   phone rather than sitting in a 320px box with a gap either side on anything
   wider, and is a little taller for it. Swapping this one word is the whole
   difference. */
const BANNER_SIZE = 'BANNER';
/* The banner is drawn NATIVELY, as a subview over the web view — on both
   platforms, checked in the plugin's own source. It does not resize the page
   underneath it, so nothing reserves that strip unless we do: the height the
   plugin reports goes into --ad-h, the app's bottom padding is written in
   terms of it, and the board re-measures. Without that the banner sits on top
   of the color swatches. */
const AD_HEIGHT = '--ad-h';
/* The one screen the banner is allowed on. A board is a thing somebody is
   thinking about, and the puzzle screen is also the one screen where the
   strip costs something real — measured, it took an Extra Hard board on a
   375px phone from 23.6px a cell down to 19.6px. The menu has height going
   spare and nothing to concentrate on. */
const BANNER_ON = 'screen-home';
function reserve(px) {
    if (typeof document === 'undefined')
        return;
    document.documentElement.style.setProperty(AD_HEIGHT, px + 'px');
    /* app.ts already re-measures on resize, and the board's size depends on the
       height this just took away. */
    window.dispatchEvent(new Event('resize'));
}
/* Anything under Google's test publisher gets isTesting on every request.
   The flag is not decoration: the plugin swaps in its own test unit when it
   is set and the device is not a registered test device, so a build cannot
   count a developer's own taps against a real account. Real units skip the
   flag and get real fills. Derived rather than configured, so the ID and the
   flag can never disagree with each other. */
const TEST_PUBLISHER = 'ca-app-pub-3940256099942544';
const isTestUnit = (id) => id.startsWith(TEST_PUBLISHER);
/* UMP decides whether the GDPR form is needed from the device's real
   location. To see the form somewhere it is not required, this overrides the
   lookup: 1 makes the device look like it is in the EEA, 3 like a regulated
   US state, 0 turns the override off. A NUMBER, not a name — the plugin took
   strings at v8, which is what the sort game is on, and this is v7. Null in
   anything shipped. */
const DEBUG_GEOGRAPHY = null;
const cap = () => (typeof window === 'undefined' ? null : (window.Capacitor ?? null));
export const Ads = {
    gate: new Gate(Date.now()),
    plugin: null,
    ready: false,
    starting: null,
    unit: '',
    bannerUnit: '',
    /* Personalised by default; a privacy switch would flip this. When off, npa
       goes on every request so Google serves non-personalised ads even where
       UMP recorded a consent. */
    personalised: true,
    /* An interstitial is loaded and waiting. Cleared by every show — each one
       has to be prepared again. */
    loaded: false,
    loading: null,
    /* The banner is created once and then hidden and resumed, rather than being
       made and destroyed per screen: every showBanner is a fresh ad request,
       and a request per screen change is both slower to appear and a good way
       to have Google notice the traffic. */
    bannerMade: false,
    bannerHeight: 0,
    native() {
        const c = cap();
        return !!(c && c.isNativePlatform && c.isNativePlatform());
    },
    get() {
        if (this.plugin)
            return this.plugin;
        const c = cap();
        if (!c)
            return null;
        if (c.registerPlugin)
            this.plugin = c.registerPlugin('AdMob');
        else if (c.Plugins && c.Plugins.AdMob)
            this.plugin = c.Plugins.AdMob;
        return this.plugin;
    },
    async init() {
        if (!this.native())
            return false;
        if (this.ready)
            return true;
        if (this.starting)
            return this.starting;
        const admob = this.get();
        if (!admob)
            return false;
        const c = cap();
        const platform = (c.getPlatform && c.getPlatform()) === 'ios' ? 'ios' : 'android';
        this.unit = INTERSTITIAL[platform];
        this.bannerUnit = BANNER[platform];
        /* Order matters. UMP first, since it works out whether this is a consent
           jurisdiction and takes the answer; then iOS's tracking prompt; then the
           SDK, which loads with whatever those two settled and serves
           personalised or not from that alone. */
        this.starting = (async () => {
            await this.consent(admob);
            await this.tracking(admob);
            await admob.initialize({ initializeForTesting: isTestUnit(this.unit) });
            this.ready = true;
            return true;
        })().catch(() => false);
        return this.starting;
    },
    /* Swallowed on purpose, all of it: a consent form that fails is not a
       reason a puzzle game cannot open. */
    async consent(admob) {
        try {
            const info = await admob.requestConsentInfo(DEBUG_GEOGRAPHY ? { debugGeography: DEBUG_GEOGRAPHY } : {});
            if (info && info.status === 'REQUIRED' && info.isConsentFormAvailable)
                await admob.showConsentForm();
        }
        catch { /* no form published, or the lookup failed — carry on */ }
    },
    /* iOS 14.5+ wants an explicit prompt before the IDFA is readable. Android
       no-ops both calls. */
    async tracking(admob) {
        try {
            const t = await admob.trackingAuthorizationStatus();
            if (t && t.status === 'notDetermined')
                await admob.requestTrackingAuthorization();
        }
        catch { /* not iOS, or an older SDK */ }
    },
    async load() {
        if (!(await this.init()))
            return false;
        if (this.loaded)
            return true;
        if (this.loading)
            return this.loading;
        this.loading = (async () => {
            try {
                const opts = { adId: this.unit, isTesting: isTestUnit(this.unit) };
                if (!this.personalised)
                    opts['npa'] = true;
                await this.plugin.prepareInterstitial(opts);
                this.loaded = true;
                return true;
            }
            catch {
                this.loaded = false;
                return false;
            }
            finally {
                this.loading = null;
            }
        })();
        return this.loading;
    },
    /* Show or hide the strip for the screen being opened. Called from the one
       place the game changes screens, so there is no screen this can be out of
       step with. */
    onScreen(screen) {
        if (!this.native())
            return;
        void this.banner(screen === BANNER_ON);
    },
    async banner(on) {
        if (!on) {
            if (!this.bannerMade)
                return;
            reserve(0);
            try {
                await this.plugin.hideBanner();
            }
            catch { /* nothing to hide */ }
            return;
        }
        if (this.bannerMade) {
            try {
                await this.plugin.resumeBanner();
            }
            catch {
                return;
            }
            reserve(this.bannerHeight);
            return;
        }
        await this.makeBanner();
    },
    /* The first show: creates the view, hangs the listeners, and asks for the
       first ad. Everything after it is hide and resume. */
    async makeBanner() {
        if (!(await this.init()))
            return false;
        try {
            /* The plugin reports the real height once the ad is measured — 50 for
               a 320x50, more for an adaptive one, and 0 if it never fills. Taking
               it from the event rather than assuming 50 is what keeps the layout
               right for either size, and what puts the space back when there is no
               ad to show. */
            await this.plugin.addListener('bannerAdSizeChanged', (info) => {
                this.bannerHeight = typeof info?.height === 'number' ? info.height : 0;
                reserve(this.bannerHeight);
            });
            await this.plugin.addListener('bannerAdFailedToLoad', () => {
                this.bannerHeight = 0;
                reserve(0);
            });
            const opts = {
                adId: this.bannerUnit,
                adSize: BANNER_SIZE,
                position: 'BOTTOM_CENTER',
                margin: 0,
                isTesting: isTestUnit(this.bannerUnit),
            };
            if (!this.personalised)
                opts['npa'] = true;
            await this.plugin.showBanner(opts);
            this.bannerMade = true;
            return true;
        }
        catch {
            reserve(0);
            return false;
        }
    },
    /* Called once per puzzle finished. */
    noteWin() {
        if (!this.native())
            return;
        this.gate.note();
        if (this.gate.warming() && !this.loaded && !this.loading)
            void this.load();
    },
    /* Called where the game is about to leave a finished board — the win card's
       buttons, all three of them. Returns whether an ad was shown, and always
       returns a promise so the caller can await it the same way either way. */
    async maybeShow() {
        if (!this.native())
            return false;
        if (!this.gate.due(Date.now()))
            return false;
        if (!this.loaded && !(await this.load()))
            return false;
        try {
            await this.plugin.showInterstitial();
            this.gate.shown(Date.now());
            this.loaded = false;
            /* Line the next one up now, so the next threshold is not spent waiting
               on a network call. */
            void this.load();
            return true;
        }
        catch {
            this.loaded = false;
            return false;
        }
    },
    /* Any ad already warmed was requested under the old setting, so it goes and
       a fresh one is warmed under the new one. */
    setPersonalised(on) {
        if (this.personalised === on)
            return;
        this.personalised = on;
        if (!this.native())
            return;
        this.loaded = false;
        void this.load();
    },
    /* Initialise at boot rather than mid-play, so the consent form and the iOS
       tracking prompt happen while the player is still on the home screen, and
       the first interstitial is warm long before the third win. */
    start() {
        if (preview())
            return;
        if (!this.native())
            return;
        void this.init().then((ok) => {
            if (!ok)
                return;
            /* The home screen is the one showing at boot. */
            void this.banner(true);
            void this.load();
        });
    },
};
/* ─── seeing it without a phone ───
   The banner is native, so the web build cannot show one: on github.io the
   plugin is not there and nothing appears. That makes "how does the layout
   look with a banner in it" a question you would otherwise need a TestFlight
   build to answer, which is a slow way to check that the swatches still fit.
   
   So: ?ads=preview draws an EMPTY BOX of exactly the size the real banner
   would take, reserves the same space, and says on its face that it is a
   placeholder. It is off unless the flag is in the URL, it is never an ad,
   and it never asks Google for anything. */
function preview() {
    if (typeof window === 'undefined')
        return false;
    return new URLSearchParams(window.location.search).get('ads') === 'preview';
}
export function startAdPreview() {
    if (!preview() || typeof document === 'undefined')
        return;
    const box = document.createElement('div');
    box.className = 'ad-preview';
    box.hidden = true;
    /* 320x50 is the MMA banner. The strip is the width of the screen because
       that is what the space costs; the box inside it is the ad. */
    box.innerHTML = '<span>Ad preview &middot; 320&times;50</span>';
    document.body.append(box);
}
/* Comes and goes with the same screen the real one does, or the preview would
   be answering a different question from the one being asked. */
export function adPreviewOnScreen(screen) {
    if (!preview() || typeof document === 'undefined')
        return;
    const box = document.querySelector('.ad-preview');
    if (!(box instanceof HTMLElement))
        return;
    const on = screen === BANNER_ON;
    box.hidden = !on;
    reserve(on ? 50 : 0);
}
