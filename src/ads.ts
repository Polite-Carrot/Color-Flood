/* ads.ts — the interstitial and the home-screen banner, and the rule about
 * when the interstitial is allowed to appear. Served by Unity Ads.
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
   into both native projects like any other). Nothing off the shelf did both a
   banner and the privacy flags, which is why it is ours. */

/* The Game IDs from the Unity dashboard, one per store — Monetization, the
   project's settings. Empty means that platform never asks for an ad: the
   module stays exactly as inert as it is on the web. They are not secrets;
   every shipped build carries its own in the binary. */
export const GAME_ID: Record<Platform, string> = {
  ios: '800385205',
  android: '',
};

/* The dashboard's "Network Placement ID" for each ad unit, copied exactly —
   Unity answers an unknown one with a load error and nothing else. The ones
   not yet taken from the dashboard are Unity's usual defaults; a banner
   that does not exist simply never fills, and leaves no gap behind. */
export const PLACEMENT: Record<'interstitial' | 'banner', Record<Platform, string>> = {
  interstitial: { ios: 'BP_Interstitial_iOS', android: 'Interstitial_Android' },
  banner: { ios: 'Banner_iOS', android: 'Banner_Android' },
};

/* Unity has no test IDs the way Google does: test mode is a flag sent with
   the real Game ID, and Unity serves its own test creatives while it is on —
   nothing is earned and nothing a developer taps counts against the account.
   It stays true in every commit until the one that makes the store build,
   and goes back straight after. The dashboard can also force it per
   platform, which is the safer switch if it is ever in doubt. */
export const TEST_MODE = true;

/* The banner is drawn NATIVELY, as a view over the web view, on both
   platforms. It does not resize the page underneath it, so nothing reserves
   that strip unless we do: the height the plugin reports goes into --ad-h,
   the app's bottom padding is written in terms of it, and the board
   re-measures. Without that the banner sits on top of the color swatches. */
const AD_HEIGHT = '--ad-h';

/* The one screen the banner is allowed on. A board is a thing somebody is
   thinking about, and the puzzle screen is also the one screen where the
   strip costs something real — measured, it took an Extra Hard board on a
   375px phone from 23.6px a cell down to 19.6px. The menu has height going
   spare and nothing to concentrate on. */
const BANNER_ON = 'screen-home';

function reserve(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(AD_HEIGHT, px + 'px');
  /* app.ts already re-measures on resize, and the board's size depends on the
     height this just took away. */
  window.dispatchEvent(new Event('resize'));
}

type Platform = 'ios' | 'android';

type Plugin = {
  initialize(o: { gameId: string; testMode: boolean }): Promise<unknown>;
  setConsent(o: { consent?: boolean; optOut?: boolean }): Promise<unknown>;
  loadInterstitial(o: { placementId: string }): Promise<unknown>;
  showInterstitial(): Promise<unknown>;
  showBanner(o: { placementId: string }): Promise<unknown>;
  hideBanner(): Promise<unknown>;
  trackingStatus(): Promise<{ status?: string }>;
  requestTracking(): Promise<{ status?: string }>;
  addListener(event: string, fn: (info: { height?: number }) => void): Promise<unknown>;
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
  /* Whether the screen showing is the banner's screen. The banner loads
     asynchronously, and one that arrives after the player has already left
     the home screen must not take the strip from the board. */
  wantBanner: false,
  /* Set by start() and nothing else. Until then a screen change only records
     where the player is: it must never be the thing that starts the SDK, or
     the tracking prompt could come up in front of the usage-data sheet that
     is meant to come first. */
  started: false,
  bannerHeight: 0,
  reserved: 0,

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
    await unity.addListener('bannerLoaded', (info) => {
      this.bannerHeight = typeof info?.height === 'number' ? info.height : 0;
      if (this.wantBanner) this.hold(this.bannerHeight);
    });
    await unity.addListener('bannerFailed', () => {
      this.bannerHeight = 0;
      this.hold(0);
    });
    await unity.addListener('interstitialExpired', () => {
      this.loaded = false;
      if (this.gate.warming()) void this.load();
    });
  },

  /* reserve(), but only when the number changes — hiding a banner that was
     never there should not make the board re-measure on every screen change. */
  hold(px: number): void {
    if (px === this.reserved) return;
    this.reserved = px;
    reserve(px);
  },

  async load(): Promise<boolean> {
    if (!this.started) return false;
    if (!(await this.init())) return false;
    if (this.loaded) return true;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        await this.plugin!.loadInterstitial({ placementId: PLACEMENT.interstitial[platform()] });
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

  /* Show or hide the strip for the screen being opened. Called from the one
     place the game changes screens, so there is no screen this can be out of
     step with. */
  onScreen(screen: string): void {
    if (!this.on()) return;
    void this.banner(screen === BANNER_ON);
  },

  /* The plugin makes the banner once and then hides and shows it, loading a
     new one only when there is none — a request per screen change would be
     both slower to appear and a good way to have the traffic noticed. */
  async banner(on: boolean): Promise<void> {
    this.wantBanner = on;
    if (!on) {
      this.hold(0);
      if (this.ready) {
        try { await this.plugin!.hideBanner(); } catch { /* nothing to hide */ }
      }
      return;
    }
    if (!this.started) return;
    if (!(await this.init())) return;
    /* The screen may have changed while the SDK was starting. */
    if (!this.wantBanner) return;
    try {
      /* The space is reserved when the plugin says an ad is actually there —
         the bannerLoaded listener — not here, so no fill means no gap. */
      await this.plugin!.showBanner({ placementId: PLACEMENT.banner[platform()] });
    } catch {
      this.hold(0);
    }
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
    if (preview()) return;
    if (!this.on() || this.started) return;
    this.started = true;
    void this.init().then((ok) => {
      if (!ok) return;
      /* Asked of the page rather than remembered: at boot the home screen is
         shown without going through onScreen at all. */
      const active = document.querySelector('.screen.is-active');
      void this.banner(!!active && active.id === BANNER_ON);
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
   and it never asks Unity for anything. */
function preview(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('ads') === 'preview';
}

export function startAdPreview(): void {
  if (!preview() || typeof document === 'undefined') return;
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
export function adPreviewOnScreen(screen: string): void {
  if (!preview() || typeof document === 'undefined') return;
  const box = document.querySelector('.ad-preview');
  if (!(box instanceof HTMLElement)) return;
  const on = screen === BANNER_ON;
  box.hidden = !on;
  reserve(on ? 50 : 0);
}
