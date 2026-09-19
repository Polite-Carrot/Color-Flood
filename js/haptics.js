/* haptics.ts — the taps you feel.
 *
 * The same three moments the sound marks, in the other sense: a move that
 * takes ground, a move that takes none, and the win. Deliberately not the
 * buttons — a phone that buzzes on every tap is a phone somebody turns the
 * feature off on, and then it is not there for the moments that matter.
 *
 * Native only. There is a vibration API on the web, but it is unsupported on
 * iOS Safari, ignored by most desktop browsers, and on Android it is a blunt
 * buzz rather than the tuned click the native engine gives — so this asks the
 * plugin or does nothing at all.
 *
 * Reached through the bridge rather than by importing @capacitor/haptics, for
 * the same reason ads.ts, track.ts and the back button do it: nothing here is
 * bundled, js/ is plain ES modules served off disk, and a bare specifier is
 * not something a web view can resolve. */
/* How much of the board a move has to take to feel like it took something.
   Below this it is a LIGHT tap, above it a MEDIUM one — so a move that turns
   forty cells over lands differently from one that turns two, which is the
   same thing the sound does with its pitch. */
export const SOLID = 0.12;
export function styleFor(fullness) {
    return fullness >= SOLID ? 'MEDIUM' : 'LIGHT';
}
export const Haptics = {
    on: true,
    plugin: null,
    /* Set once anything throws. A phone with no haptic engine, or one that has
       them switched off system-wide, will reject these — and after one refusal
       there is no point asking again for the rest of the session. */
    broken: false,
    get() {
        if (this.broken || !this.on)
            return null;
        if (this.plugin)
            return this.plugin;
        /* No window at all in Node, which is where the tests run and where a
           React Native build would import this from. */
        if (typeof window === 'undefined')
            return null;
        const cap = window.Capacitor;
        if (!cap?.isNativePlatform?.() || !cap.registerPlugin)
            return null;
        this.plugin = cap.registerPlugin('Haptics');
        return this.plugin;
    },
    /* Never awaited by anything the player is waiting on: a slow bridge call
       must not sit between a tap and the board redrawing. */
    fire(run) {
        const p = this.get();
        if (!p)
            return;
        try {
            void run(p).catch(() => { this.broken = true; });
        }
        catch {
            this.broken = true;
        }
    },
    /* A move that took ground. `fullness` is the share of the board now held,
       the same number the sound uses to pick its pitch. */
    flood(fullness) {
        this.fire((p) => p.impact({ style: styleFor(fullness) }));
    },
    /* A move that took nothing, or one there was no room left for. */
    nope() {
        this.fire((p) => p.notification({ type: 'WARNING' }));
    },
    win() {
        this.fire((p) => p.notification({ type: 'SUCCESS' }));
    },
};
