/* ads.ts — the interstitial, and the rule about when it is allowed to
 * appear. Served by Unity Ads. There is no banner and no rewarded ad: the
 * interstitial is the only format this game shows.
 *
 * Ported from the sort game's ads.js. The cap is the same one, deliberately
 * gentle for a puzzle game: ONE interstitial fires when BOTH of these have
 * happened since the last one shown —
 *
 *   - at least two minutes of wall-clock time, AND
 *   - at least two puzzles finished.
 *
 * Whichever comes last, not whichever comes first. Two levels inside ninety
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
export const MIN_LEVELS = 2;

export class Gate {
  since: number;
  levels = 0;

  constructor(now: number) { this.since = now; }

  /* One finished puzzle. Campaign, daily or random alike: the cadence counts
     boards actually solved, not win cards seen — a replay of a level already
     beaten still costs the player the same minute of their evening. */
  note(): void { this.levels += 1; }

  /* One short of the threshold is the moment to start loading an ad, so the
     win that fires it does not have to wait for the network to finish. */
  warming(): boolean { return this.levels >= MIN_LEVELS - 1; }

  due(now: number): boolean {
    return now - this.since >= MIN_MS && this.levels >= MIN_LEVELS;
  }

  shown(now: number): void { this.since = now; this.levels = 0; }
}

/* ─── the plugin ───
   Unity Ads, through the small plugin that lives in this repository at
   plugins/unity-ads (installed as a file: dependency, so `cap sync` wires it
   into both native projects like any other). The published ones were stuck
   on old SDKs without the privacy flags, which is why it is ours. */

/* The Game IDs from the Unity dashboard, one per store — Monetization, the
   project's settings. Empty means that platform never asks for an ad: the
   module stays exactly as inert as it is on the web. They are not secrets;
   every shipped build carries its own in the binary. */
export const GAME_ID: Record<Platform, string> = {
  ios: '800385205',
  android: '',
};

/* The dashboard's "Network Placement ID" for the interstitial, copied
   exactly — Unity answers an unknown one with a load error and nothing else.
   Android's is Unity's usual default until the Android app is set up. */
export const PLACEMENT: Record<Platform, string> = {
  ios: 'BP_Interstitial_iOS',
  android: 'Interstitial_Android',
};

/* Unity has no test IDs the way Google does: test mode is a flag sent with
   the real Game ID, and Unity serves its own test creatives while it is on —
   nothing is earned and nothing a developer taps counts against the account.
   It stays true in every commit until the one that makes the store build,
   and goes back straight after. The dashboard can also force it per
   platform, which is the safer switch if it is ever in doubt. */
export const TEST_MODE = true;

type Platform = 'ios' | 'android';

type Plugin = {
  initialize(o: { gameId: string; testMode: boolean }): Promise<unknown>;
  setConsent(o: { consent?: boolean; optOut?: boolean }): Promise<unknown>;
  loadInterstitial(o: { placementId: string }): Promise<unknown>;
  showInterstitial(): Promise<unknown>;
  trackingStatus(): Promise<{ status?: string }>;
  requestTracking(): Promise<{ status?: string }>;
  addListener(event: string, fn: () => void): Promise<unknown>;
};

type Cap = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  registerPlugin?: (name: string) => Plugin;
  Plugins?: { UnityAds?: Plugin };
};

const cap = (): Cap | null =>
  (typeof window === 'undefined' ? null : ((window as unknown as { Capacitor?: Cap }).Capacitor ?? null));

const platform = (): Platform => {
  const c = cap();
  return (c && c.getPlatform && c.getPlatform()) === 'ios' ? 'ios' : 'android';
};

export const Ads = {
  gate: new Gate(Date.now()),
  plugin: null as Plugin | null,
  ready: false,
  starting: null as Promise<boolean> | null,
  /* What the tracking prompt said. Personalised until told otherwise; when
     told otherwise the player is opted out of Unity's data sharing. */
  personalised: true,
  /* Called with the prompt's answer, so the rest of the app can record it and
     bring its own consent grants into line. Replaced in app.ts; a no-op here
     so ads.ts stays something that can be dropped into anything. */
  settle: ((_authorised: boolean): void => {}) as (authorised: boolean) => void,
  /* An interstitial is loaded and waiting. Cleared by every show — each one
     has to be loaded again — and by Unity saying a waiting one went stale. */
  loaded: false,
  loading: null as Promise<boolean> | null,
  /* Set by start() and nothing else. Nothing else may start the SDK, or the
     tracking prompt could come up in front of the usage-data sheet that is
     meant to come first. */
  started: false,

  native(): boolean {
    const c = cap();
    return !!(c && c.isNativePlatform && c.isNativePlatform());
  },

  /* Native AND configured for this platform. Before the Game IDs are filled
     in, a phone build behaves like the web one: no prompt, no requests. */
  on(): boolean {
    return this.native() && GAME_ID[platform()] !== '';
  },

  get(): Plugin | null {
    if (this.plugin) return this.plugin;
    const c = cap();
    if (!c) return null;
    if (c.registerPlugin) this.plugin = c.registerPlugin('UnityAds');
    else if (c.Plugins && c.Plugins.UnityAds) this.plugin = c.Plugins.UnityAds;
    return this.plugin;
  },

  async init(): Promise<boolean> {
    if (!this.on()) return false;
    if (this.ready) return true;
    if (this.starting) return this.starting;

    const unity = this.get();
    if (!unity) return false;

    /* Order matters. The tracking prompt first, since its answer decides
       whether ads are personalised; then the privacy flags that answer turns
       into; then the SDK, so the very first request already carries them. */
    this.starting = (async () => {
      await this.tracking(unity);
      await this.sendConsent();
      await unity.initialize({ gameId: GAME_ID[platform()], testMode: TEST_MODE });
      await this.listen(unity);
      this.ready = true;
      return true;
    })().catch(() => {
      /* Offline at launch, most likely. Let the next call try again rather
         than leaving the whole session without ads. */
      this.starting = null;
      return false;
    });
    return this.starting;
  },

  /* iOS 14.5+ wants an explicit prompt before the IDFA is readable, and that
     prompt IS the personalised-ads question — which is why the answer is read
     back rather than thrown away. Android has no ATT and its half of the
     plugin answers `authorized` unconditionally, which is the right answer
     there. Swallowed: a prompt that fails is not a reason a puzzle game
     cannot open. */
  async tracking(unity: Plugin): Promise<void> {
    try {
      let t = await unity.trackingStatus();
      if (t && t.status === 'notDetermined') t = await unity.requestTracking();
      /* `authorized` is the only yes. Denied, restricted, and a prompt that
         somehow came back still undetermined are all no. */
      const yes = t?.status === 'authorized';
      this.personalised = yes;
      this.settle(yes);
    } catch { /* leave it as it was */ }
  },

  /* Unity ships no consent form, so what the game knows goes over as flags.
       consent — the GDPR one, applied where GDPR is. Always false: nothing in
         this app asks a GDPR-grade question, and the tracking prompt is not
         one. Players in the EEA and the UK get non-personalised ads.
       optOut — the US state-law one. On when the tracking prompt said no. */
  async sendConsent(): Promise<void> {
    try {
      await this.get()!.setConsent({ consent: false, optOut: !this.personalised });
    } catch { /* keep going; Unity falls back to its own defaults */ }
  },

  /* Hung once, after initialize. */
  async listen(unity: Plugin): Promise<void> {
    await unity.addListener('interstitialExpired', () => {
      this.loaded = false;
      if (this.gate.warming()) void this.load();
    });
  },

  async load(): Promise<boolean> {
    if (!this.started) return false;
    if (!(await this.init())) return false;
    if (this.loaded) return true;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        await this.plugin!.loadInterstitial({ placementId: PLACEMENT[platform()] });
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
    if (!this.on()) return;
    this.gate.note();
    if (this.gate.warming() && !this.loaded && !this.loading) void this.load();
  },

  /* Called where the game is about to leave a finished board — the win card's
     buttons, all three of them. Returns whether an ad was shown, and always
     returns a promise so the caller can await it the same way either way.
     The plugin resolves only once the ad has been dismissed. */
  async maybeShow(): Promise<boolean> {
    if (!this.on()) return false;
    if (!this.gate.due(Date.now())) return false;
    if (!this.loaded && !(await this.load())) return false;

    try {
      this.loaded = false;
      await this.plugin!.showInterstitial();
      this.gate.shown(Date.now());
      /* Line the next one up now, so the next threshold is not spent waiting
         on a network call. */
      void this.load();
      return true;
    } catch {
      return false;
    }
  },

  /* The flags go again, and any ad already warmed was requested under the old
     setting, so a fresh one is loaded in its place. */
  setPersonalised(on: boolean): void {
    if (this.personalised === on) return;
    this.personalised = on;
    if (!this.ready) return;
    void this.sendConsent().then(() => {
      this.loaded = false;
      void this.load();
    });
  },

  /* Initialise at boot rather than mid-play, so the iOS tracking prompt
     happens while the player is still on the home screen, and the first
     interstitial is warm long before the second win. */
  start(): void {
    if (!this.on() || this.started) return;
    this.started = true;
    void this.load();
  },
};
