/* purchases.js — "Remove Ads": one non-consumable in-app purchase, on iOS
 * (StoreKit 2) and Android (Google Play Billing), through
 * @capgo/native-purchases. No server and no account: each store keeps the
 * record of who owns what, and the phone asks it.
 *
 * Ported from Color Match & Merge (color-sorting
 * .github/skills/capacitor-game-services, assets/js/purchases.js), as an ES
 * module and with the cache kept the way this game keeps its save.
 *
 * PRODUCT_ID must match, character for character, the product ID created in
 * App Store Connect (In-App Purchases, type Non-Consumable) AND in Google Play
 * Console (Monetize > Products > In-app products). The price shown in the game
 * always comes from the store, in the player's own currency; there is no price
 * in this file.
 *
 * Where the answer lives:
 *   - The store is the truth. It is asked at launch and every time the app
 *     comes back to the foreground, so a refund turns ads back on and a
 *     purchase made on another device (or approved later by a parent) turns
 *     them off without anyone pressing Restore.
 *   - OWNED_KEY is only a cache, so an offline launch does not flash an ad at
 *     somebody who paid. A store query that FAILS leaves it alone; only a query
 *     that SUCCEEDS and does not list the product clears it.
 *   - It is a separate key from the save on purpose: Reset progress must
 *     never take away something the player paid for. Like the save, it is
 *     written to native storage as well as localStorage (store.js).
 *
 * The web build has no store: available() is false and the rows are hidden.
 * Reached through window.Capacitor rather than imported, like every plugin
 * here: js/ is plain ES modules and a web view cannot resolve a package name. */
import { nativePrefs, persist, readLocal, restore } from "./store.js";
export const PRODUCT_ID = 'remove_ads';
export const OWNED_KEY = 'color-flood/removeAds.v1';
/* A factory, so a test can have a fresh one with its own stand-in plugin. The
   game uses the single instance exported at the bottom. */
export function makePurchases() {
    const state = {
        plugin: undefined,
        owned: readLocal(OWNED_KEY) === '1',
        pending: false, /* paid with a slow method, or waiting on Ask to Buy */
        product: null, /* { priceString, title } once the store answers */
        busy: false, /* a purchase or restore sheet is up */
        refreshing: null,
        queued: null,
        boughtAt: 0, /* when buy() last succeeded */
        started: false,
    };
    const listeners = [];
    const platform = () => {
        try {
            const c = typeof window === 'undefined' ? null : window.Capacitor;
            return c && c.isNativePlatform && c.isNativePlatform() ? c.getPlatform() : 'web';
        }
        catch {
            return 'web';
        }
    };
    const available = () => platform() === 'ios' || platform() === 'android';
    const plugin = () => {
        if (state.plugin !== undefined)
            return state.plugin;
        if (!available())
            return null;
        const c = window.Capacitor;
        state.plugin = c.registerPlugin ? c.registerPlugin('NativePurchases') : (c.Plugins?.NativePurchases ?? null);
        return state.plugin;
    };
    function status() {
        return {
            available: available(),
            owned: state.owned,
            pending: state.pending,
            busy: state.busy,
            price: state.product ? state.product.priceString : null,
        };
    }
    function emit() {
        const snap = status();
        for (const fn of listeners) {
            try {
                fn(snap);
            }
            catch { /* one listener cannot stop the others */ }
        }
    }
    function setOwned(on) {
        on = !!on;
        if (on)
            state.pending = false;
        const changed = on !== state.owned;
        state.owned = on;
        persist(on ? '1' : '0', nativePrefs(), OWNED_KEY);
        if (changed)
            emit();
    }
    /* Google Play reports purchaseState as a string: "1" purchased, "2"
       pending. StoreKit's current entitlements leave out refunded and revoked
       purchases, so on iOS being listed is enough. */
    function findOwned(purchases) {
        let owned = false;
        let pending = false;
        for (const p of purchases || []) {
            if (!p || p.productIdentifier !== PRODUCT_ID || p.revocationDate)
                continue;
            if (platform() === 'android') {
                if (p.purchaseState === '1')
                    owned = true;
                else if (p.purchaseState === '2')
                    pending = true;
            }
            else {
                owned = true;
            }
        }
        return { owned, pending };
    }
    /* Ask the store what this player owns. Silent: never shows a sign-in sheet
       (restore(), below, is the one that may). One query at a time; a call that
       arrives during one runs again after it, so a caller never gets an answer
       to a question asked before whatever it is reacting to. */
    function refresh() {
        const NP = plugin();
        if (!NP)
            return Promise.resolve(status());
        if (state.refreshing) {
            if (!state.queued) {
                state.queued = state.refreshing.then(() => {
                    state.queued = null;
                    return refresh();
                });
            }
            return state.queued;
        }
        const askedAt = Date.now();
        state.refreshing = (async () => {
            try {
                if (platform() === 'android') {
                    /* Picks up purchases that finished while the app was closed (a
                       pending payment that cleared) and acknowledges them: Google
                       refunds any purchase left unacknowledged for three days. Shows
                       nothing to the player on Android. */
                    try {
                        await NP.restorePurchases();
                    }
                    catch { /* carry on to the query */ }
                }
                const res = await NP.getPurchases(platform() === 'ios' ? { onlyCurrentEntitlements: true } : { productType: 'inapp' });
                const found = findOwned(res && res.purchases);
                /* A query sent before a purchase finished can come back after it,
                   without the purchase in it. That answer is stale; ignore it. */
                if (!found.owned && state.boughtAt >= askedAt)
                    return status();
                state.pending = !found.owned && found.pending;
                setOwned(found.owned);
                emit();
            }
            catch { /* offline, or the store is having a moment: keep what we had */ }
            finally {
                state.refreshing = null;
            }
            return status();
        })();
        return state.refreshing;
    }
    async function loadProduct() {
        const NP = plugin();
        if (!NP || state.product)
            return state.product;
        try {
            const res = await NP.getProducts({ productIdentifiers: [PRODUCT_ID], productType: 'inapp' });
            const p = res && res.products && res.products[0];
            if (p) {
                state.product = { priceString: p.priceString, title: p.title };
                emit();
            }
        }
        catch { /* tried again at the next launch */ }
        return state.product;
    }
    /* 'owned'     bought now, or already owned (ads are off)
       'pending'   waiting on payment or a parent's approval; ads switch off by
                   themselves once it completes
       'cancelled' the player closed the sheet; say nothing
       'failed'    anything else */
    async function buy() {
        const NP = plugin();
        if (!NP)
            return 'failed';
        if (state.owned)
            return 'owned';
        if (state.busy)
            return 'failed';
        state.busy = true;
        emit();
        try {
            const tx = await NP.purchaseProduct({ productIdentifier: PRODUCT_ID, productType: 'inapp', isConsumable: false });
            if (tx && tx.productIdentifier === PRODUCT_ID) {
                state.boughtAt = Date.now();
                setOwned(true);
            }
            else
                await refresh();
            return state.owned ? 'owned' : 'failed';
        }
        catch (e) {
            const text = ((e && e.code) || '') + ' ' + ((e && e.message) || '');
            if (/USER_CANCEL|cancel/i.test(text))
                return 'cancelled';
            if (/pending/i.test(text)) {
                state.pending = true;
                emit();
                return 'pending';
            }
            if (/ITEM_ALREADY_OWNED/i.test(text)) {
                await refresh();
                return state.owned ? 'owned' : 'failed';
            }
            return 'failed';
        }
        finally {
            state.busy = false;
            emit();
        }
    }
    /* The Restore button, which Apple requires for anything bought once. On iOS
       this syncs with the App Store and may ask for the Apple ID password, which
       is why it is only ever called from a tap. True if the player owns Remove
       Ads afterwards. */
    async function restorePurchases() {
        const NP = plugin();
        if (!NP)
            return false;
        if (state.busy)
            return state.owned;
        state.busy = true;
        emit();
        try {
            try {
                await NP.restorePurchases();
            }
            catch { /* the query below still runs */ }
            await refresh();
            return state.owned;
        }
        finally {
            state.busy = false;
            emit();
        }
    }
    /* At boot, before the ad SDK can start. The native copy of the cache is
       read first, so a phone whose web view storage was cleared still knows it
       paid while offline. */
    async function start() {
        const NP = plugin();
        if (!NP || state.started)
            return;
        state.started = true;
        const cached = await restore(nativePrefs(), readLocal(OWNED_KEY), undefined, OWNED_KEY);
        if (cached === '1' && !state.owned) {
            state.owned = true;
            emit();
        }
        /* iOS reports purchases that complete outside buy(): Ask to Buy
           approvals, purchases on another device, refunds. Asking the store
           again is simpler and safer than interpreting each event. */
        if (platform() === 'ios' && NP.addListener) {
            try {
                void NP.addListener('transactionUpdated', () => { void refresh(); });
            }
            catch { /* the visibility refresh still catches it */ }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && !state.busy)
                    void refresh();
            });
        }
        void refresh();
        void loadProduct();
    }
    return {
        PRODUCT_ID,
        available,
        adsRemoved: () => state.owned,
        status,
        buy,
        restore: restorePurchases,
        refresh,
        loadProduct,
        start,
        onChange(fn) { listeners.push(fn); },
    };
}
export const Purchases = makePurchases();
