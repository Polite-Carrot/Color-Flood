/* track.ts — optional, consented analytics.
 *
 * Two backends, one call surface. On the web build events go to a GA4 web
 * stream through gtag.js; on iOS and Android they go through the Capacitor
 * Firebase Analytics plugin to the same property's app streams, which is what
 * GoogleService-Info.plist and google-services.json configure. `configured()`
 * hides that split from every caller.
 *
 * Nothing runs until somebody has said yes. GA4 sets cookies and Firebase
 * writes an install id, and both need consent BEFORE they are written — which
 * is why the native SDKs ship deactivated in the manifest and the plist, and
 * why gtag.js is injected on acceptance rather than at load.
 *
 * Every call is safe at any time. Before consent, with no measurement id, with
 * no plugin registered, or with the script blocked, `event()` does nothing and
 * throws nothing. Analytics failing must never cost somebody their game —
 * which is why every call here is wrapped and none of them is awaited by
 * anything the player is waiting on.
 *
 * Ported from the sort game's track.js, event names and all, so the two games
 * report into one property and a funnel can be read across both. */
/* The GA4 measurement id: the "G-" one from Admin → Data Streams, and the WEB
   stream's, since gtag.js cannot talk to an app stream.
   
   EMPTY ON PURPOSE. Until the Color Flood web stream exists and its id is
   pasted here, the web branch is inert: no script is fetched and every web
   event is a no-op. Native events do not go through here at all, so a phone
   build reports with this still blank.
   
   Not a secret when it is set. A measurement id is readable in the source of
   every page that uses it; what protects a property is the domain filter in
   GA4, not the id being hard to find. */
const MEASUREMENT_ID = '';
/* Firebase Analytics' own limits. Names over 40 characters and values over
   100 are rejected by the SDK, so they are trimmed here instead — a dropped
   event is worse than a shortened label. */
const MAX_KEY = 40;
const MAX_VALUE = 100;
/* Exported for the test: the same trimming the native branch applies. */
export function trim(params) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        out[k.slice(0, MAX_KEY)] = typeof v === 'string' ? v.slice(0, MAX_VALUE) : v;
    }
    return out;
}
const win = () => (typeof window === 'undefined' ? null : window);
export const Track = {
    /* Two flags, not one, and the difference is why turning the setting off and
       on again works. `injected` says the script tag exists, which can only
       happen once per page; `on` says events should be sent, which flips as
       often as somebody likes. One flag meant a re-enable injected gtag.js a
       second time. */
    injected: false,
    on: false,
    plugin: null,
    native() { return !!win()?.Capacitor; },
    /* "There is a route for analytics on this platform." The web needs an id;
       a phone needs the plugin to be registered. */
    configured() {
        return this.native() ? !!this.firebase() : !!MEASUREMENT_ID;
    },
    firebase() {
        if (this.plugin)
            return this.plugin;
        const c = win()?.Capacitor;
        if (!c)
            return null;
        if (c.registerPlugin)
            this.plugin = c.registerPlugin('FirebaseAnalytics');
        else if (c.Plugins?.FirebaseAnalytics)
            this.plugin = c.Plugins.FirebaseAnalytics;
        return this.plugin;
    },
    /* Consent given, or the setting switched back on. Safe to call repeatedly.
       `ads` is the personalised-ads answer: when it is false the ad-related
       Consent Mode v2 grants are DENIED while analytics stays GRANTED, so one
       "no" does not have to mean two. */
    async start(ads) {
        if (!this.configured())
            return;
        this.on = true;
        if (this.native()) {
            /* Two flips. The SDK-wide switch stops the process starting at boot;
               the Consent Mode grants are what Analytics reads on every event once
               it has. Setting one without the other looks like it worked and sends
               nothing. */
            const fb = this.firebase();
            if (!fb)
                return;
            const forAds = ads ? 'GRANTED' : 'DENIED';
            try {
                await fb.setEnabled({ enabled: true });
                await fb.setConsent?.({ consents: [
                        { type: 'ANALYTICS_STORAGE', status: 'GRANTED' },
                        { type: 'AD_STORAGE', status: forAds },
                        { type: 'AD_USER_DATA', status: forAds },
                        { type: 'AD_PERSONALIZATION', status: forAds },
                    ] });
            }
            catch { /* an SDK that will not start is not a reason to stop playing */ }
            return;
        }
        const w = win();
        if (!w)
            return;
        /* GA reads this on every hit, so an opt-out has to be lifted explicitly.
           Leaving it set was why re-enabling used to look like it had worked. */
        w['ga-disable-' + MEASUREMENT_ID] = false;
        if (this.injected)
            return;
        this.injected = true;
        w.dataLayer = w.dataLayer || [];
        const gtag = (...a) => { w.dataLayer.push(a); };
        w.gtag = gtag;
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
        /* Offline, or blocked — which an ad blocker does as a matter of course.
           Stop queueing into an array that will never drain, and put `injected`
           back so a later toggle may try again. */
        s.onerror = () => { this.on = false; this.injected = false; };
        document.head.appendChild(s);
        gtag('js', new Date());
        /* The game is one page and its screens are not URLs, so the events say
           where somebody is rather than inventing paths for them. */
        gtag('config', MEASUREMENT_ID, { send_page_view: true });
    },
    /* Switched off after having been on: stop sending, and ask for what is held
       to be dropped. The script cannot be un-injected without a reload, so the
       flag is what actually stops the events. */
    async stop() {
        this.on = false;
        if (this.native()) {
            const fb = this.firebase();
            if (!fb)
                return;
            try {
                await fb.setEnabled({ enabled: false });
                await fb.setConsent?.({ consents: [
                        { type: 'ANALYTICS_STORAGE', status: 'DENIED' },
                        { type: 'AD_STORAGE', status: 'DENIED' },
                        { type: 'AD_USER_DATA', status: 'DENIED' },
                        { type: 'AD_PERSONALIZATION', status: 'DENIED' },
                    ] });
            }
            catch { /* nothing to do about it */ }
            return;
        }
        const w = win();
        if (w && MEASUREMENT_ID)
            w['ga-disable-' + MEASUREMENT_ID] = true;
    },
    event(name, params = {}) {
        if (!this.on)
            return;
        if (this.native()) {
            const fb = this.firebase();
            /* Not awaited anywhere: a slow bridge call must not sit between a tap
               and the board redrawing. */
            void fb?.logEvent({ name, params: trim(params) }).catch(() => { });
            return;
        }
        const w = win();
        if (!w?.gtag)
            return;
        try {
            w.gtag('event', name, params);
        }
        catch { /* never break play */ }
    },
};
