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
  since: number;
  levels = 0;

  constructor(now: number) { this.since = now; }

  /* One finished puzzle. Campaign, daily or random alike: the cadence counts
     boards actually solved, not win cards seen — a replay of a level already
     beaten still costs the player the same minute of their evening. */
  note(): void { this.levels += 1; }

  /* One short of the threshold is the moment to start loading an ad, so the
     third win does not have to wait for the network to finish. */
  warming(): boolean { return this.levels >= MIN_LEVELS - 1; }

  due(now: number): boolean {
    return now - this.since >= MIN_MS && this.levels >= MIN_LEVELS;
  }

  shown(now: number): void { this.since = now; this.levels = 0; }
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

/* Anything under Google's test publisher gets isTesting on every request.
   The flag is not decoration: the plugin swaps in its own test unit when it
   is set and the device is not a registered test device, so a build cannot
   count a developer's own taps against a real account. Real units skip the
   flag and get real fills. Derived rather than configured, so the ID and the
   flag can never disagree with each other. */
const TEST_PUBLISHER = 'ca-app-pub-3940256099942544';
const isTestUnit = (id: string): boolean => id.startsWith(TEST_PUBLISHER);

/* UMP decides whether the GDPR form is needed from the device's real
   location. To see the form somewhere it is not required, this overrides the
   lookup: 1 makes the device look like it is in the EEA, 3 like a regulated
   US state, 0 turns the override off. A NUMBER, not a name — the plugin took
   strings at v8, which is what the sort game is on, and this is v7. Null in
   anything shipped. */
const DEBUG_GEOGRAPHY: number | null = null;

type Plugin = {
  initialize(o: unknown): Promise<unknown>;
  requestConsentInfo(o: unknown): Promise<{ status?: string; isConsentFormAvailable?: boolean }>;
  showConsentForm(): Promise<unknown>;
  trackingAuthorizationStatus(): Promise<{ status?: string }>;
  requestTrackingAuthorization(): Promise<unknown>;
  prepareInterstitial(o: unknown): Promise<unknown>;
  showInterstitial(): Promise<unknown>;
};

type Cap = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  registerPlugin?: (name: string) => Plugin;
  Plugins?: { AdMob?: Plugin };
};

const cap = (): Cap | null =>
  (typeof window === 'undefined' ? null : ((window as unknown as { Capacitor?: Cap }).Capacitor ?? null));

export const Ads = {
  gate: new Gate(Date.now()),
  plugin: null as Plugin | null,
  ready: false,
  starting: null as Promise<boolean> | null,
  unit: '',
  /* Personalised by default; a privacy switch would flip this. When off, npa
     goes on every request so Google serves non-personalised ads even where
     UMP recorded a consent. */
  personalised: true,
  /* An interstitial is loaded and waiting. Cleared by every show — each one
     has to be prepared again. */
  loaded: false,
  loading: null as Promise<boolean> | null,

  native(): boolean {
    const c = cap();
    return !!(c && c.isNativePlatform && c.isNativePlatform());
  },

  get(): Plugin | null {
    if (this.plugin) return this.plugin;
    const c = cap();
    if (!c) return null;
    if (c.registerPlugin) this.plugin = c.registerPlugin('AdMob');
    else if (c.Plugins && c.Plugins.AdMob) this.plugin = c.Plugins.AdMob;
    return this.plugin;
  },

  async init(): Promise<boolean> {
    if (!this.native()) return false;
    if (this.ready) return true;
    if (this.starting) return this.starting;

    const admob = this.get();
    if (!admob) return false;
    const c = cap()!;
    const platform = (c.getPlatform && c.getPlatform()) === 'ios' ? 'ios' : 'android';
    this.unit = INTERSTITIAL[platform];

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
  async consent(admob: Plugin): Promise<void> {
    try {
      const info = await admob.requestConsentInfo(DEBUG_GEOGRAPHY ? { debugGeography: DEBUG_GEOGRAPHY } : {});
      if (info && info.status === 'REQUIRED' && info.isConsentFormAvailable) await admob.showConsentForm();
    } catch { /* no form published, or the lookup failed — carry on */ }
  },

  /* iOS 14.5+ wants an explicit prompt before the IDFA is readable. Android
     no-ops both calls. */
  async tracking(admob: Plugin): Promise<void> {
    try {
      const t = await admob.trackingAuthorizationStatus();
      if (t && t.status === 'notDetermined') await admob.requestTrackingAuthorization();
    } catch { /* not iOS, or an older SDK */ }
  },

  async load(): Promise<boolean> {
    if (!(await this.init())) return false;
    if (this.loaded) return true;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const opts: Record<string, unknown> = { adId: this.unit, isTesting: isTestUnit(this.unit) };
        if (!this.personalised) opts['npa'] = true;
        await this.plugin!.prepareInterstitial(opts);
        this.loaded = true;
        return true;
      } catch {
        this.loaded = false;
        return false;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  },

  /* Called once per puzzle finished. */
  noteWin(): void {
    if (!this.native()) return;
    this.gate.note();
    if (this.gate.warming() && !this.loaded && !this.loading) void this.load();
  },

  /* Called where the game is about to leave a finished board — the win card's
     buttons, all three of them. Returns whether an ad was shown, and always
     returns a promise so the caller can await it the same way either way. */
  async maybeShow(): Promise<boolean> {
    if (!this.native()) return false;
    if (!this.gate.due(Date.now())) return false;
    if (!this.loaded && !(await this.load())) return false;

    try {
      await this.plugin!.showInterstitial();
      this.gate.shown(Date.now());
      this.loaded = false;
      /* Line the next one up now, so the next threshold is not spent waiting
         on a network call. */
      void this.load();
      return true;
    } catch {
      this.loaded = false;
      return false;
    }
  },

  /* Any ad already warmed was requested under the old setting, so it goes and
     a fresh one is warmed under the new one. */
  setPersonalised(on: boolean): void {
    if (this.personalised === on) return;
    this.personalised = on;
    if (!this.native()) return;
    this.loaded = false;
    void this.load();
  },

  /* Initialise at boot rather than mid-play, so the consent form and the iOS
     tracking prompt happen while the player is still on the home screen, and
     the first interstitial is warm long before the third win. */
  start(): void {
    if (!this.native()) return;
    void this.init().then((ok) => { if (ok) void this.load(); });
  },
};
