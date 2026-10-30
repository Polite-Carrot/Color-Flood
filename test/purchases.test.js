/* purchases.test.js — Remove Ads, against a stand-in NativePurchases plugin.
 *
 * Ported from Color Match & Merge (the capacitor-game-services skill's
 * assets/test/purchases.test.js), with this game's cache key and storage. */
import { afterEach, describe, it, expect } from 'vitest';
import { OWNED_KEY, PRODUCT_ID, makePurchases } from '../js/purchases.js';
import { KEY } from '../js/store.js';

/* The native Preferences stand-in is cached by store.js for the whole run, so
   it is one object whose backing map each test replaces. */
let nativeMap = new Map();
const preferences = {
    get: async ({ key }) => ({ value: nativeMap.has(key) ? nativeMap.get(key) : null }),
    set: async ({ key, value }) => { nativeMap.set(key, value); },
};

function setup({ platform = 'ios', native = true, stored = null, fail = false } = {}) {
    const calls = [];
    const local = new Map(stored === null ? [] : [[OWNED_KEY, stored]]);
    nativeMap = new Map();
    const store = { owned: [], pending: false, fail };
    const plugin = {
        async getPurchases(opts) {
            calls.push(['getPurchases', opts]);
            if (store.fail) throw new Error('offline');
            const list = store.owned.map((id) => ({ productIdentifier: id, purchaseState: '1' }));
            if (store.pending) list.push({ productIdentifier: PRODUCT_ID, purchaseState: '2' });
            return { purchases: list };
        },
        async restorePurchases() { calls.push(['restorePurchases']); },
        async getProducts() { return { products: [{ identifier: PRODUCT_ID, priceString: '£1.99', title: 'Remove Ads' }] }; },
        async purchaseProduct(opts) {
            calls.push(['purchaseProduct', opts]);
            if (store.reject) { const e = new Error(store.reject.message); e.code = store.reject.code; throw e; }
            store.owned.push(PRODUCT_ID);
            return { productIdentifier: PRODUCT_ID, transactionId: '1' };
        },
        async addListener(name, fn) { calls.push(['addListener', name]); store.listener = fn; },
    };
    globalThis.localStorage = { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => { local.set(k, v); } };
    globalThis.document = { visibilityState: 'visible', addEventListener() {} };
    globalThis.window = {
        Capacitor: {
            isNativePlatform: () => native,
            getPlatform: () => platform,
            registerPlugin: (name) => (name === 'Preferences' ? preferences : plugin),
        },
    };
    const settle = () => new Promise((r) => setImmediate(r));
    return { P: makePurchases(), plugin, store, calls, local, settle };
}
afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.document;
    delete globalThis.window;
});

describe('Remove Ads', () => {
    it('a fresh install that owns nothing shows ads and the store price', async () => {
        const f = setup();
        await f.P.start();
        await f.settle();
        await f.P.refresh();
        expect(f.P.adsRemoved()).toBe(false);
        expect(f.P.status().price).toBe('£1.99');
    });

    it('buying removes ads and is remembered in both copies', async () => {
        const f = setup();
        await f.P.refresh();
        expect(await f.P.buy()).toBe('owned');
        expect(f.P.adsRemoved()).toBe(true);
        expect(f.local.get(OWNED_KEY)).toBe('1');
        await f.settle();
        expect(nativeMap.get(OWNED_KEY)).toBe('1');
        const buy = f.calls.find((c) => c[0] === 'purchaseProduct')[1];
        expect(buy.productIdentifier).toBe('remove_ads');
        expect(buy.isConsumable).toBe(false);
    });

    it('is kept under its own key, so Reset progress cannot take it away', () => {
        expect(OWNED_KEY).not.toBe(KEY);
    });

    it('trusts the native copy when the web view storage was cleared', async () => {
        const f = setup();
        nativeMap.set(OWNED_KEY, '1');
        f.store.fail = true;                       /* offline, too */
        await f.P.start();
        expect(f.P.adsRemoved()).toBe(true);
    });

    it('iOS asks only for current entitlements, so refunds drop out', async () => {
        const f = setup({ stored: '1' });
        expect(f.P.adsRemoved(), 'cache trusted at launch').toBe(true);
        await f.settle();
        await f.P.refresh();
        expect(JSON.stringify(f.calls.find((c) => c[0] === 'getPurchases')[1])).toBe('{"onlyCurrentEntitlements":true}');
        expect(f.P.adsRemoved(), 'store says not owned (refunded): ads back').toBe(false);
        expect(f.calls.some((c) => c[0] === 'restorePurchases'), 'launch never triggers the Apple ID sheet').toBe(false);
    });

    it('a failed store query keeps the cached purchase', async () => {
        const f = setup({ stored: '1', fail: true });
        await f.settle();
        await f.P.refresh();
        expect(f.P.adsRemoved()).toBe(true);
    });

    it('cancelling says cancelled and changes nothing', async () => {
        const f = setup({ platform: 'android' });
        f.store.reject = { code: 'USER_CANCELED', message: 'Purchase is not purchased' };
        expect(await f.P.buy()).toBe('cancelled');
        expect(f.P.adsRemoved()).toBe(false);
        const g = setup();
        g.store.reject = { message: 'User cancelled' };
        expect(await g.P.buy()).toBe('cancelled');
    });

    it('pending payments wait, then unlock on the next check', async () => {
        const f = setup({ platform: 'android' });
        f.store.reject = { message: 'Purchase is pending' };
        expect(await f.P.buy()).toBe('pending');
        expect(f.P.status().pending).toBe(true);
        expect(f.P.adsRemoved()).toBe(false);
        f.store.owned.push(PRODUCT_ID);
        await f.P.refresh();
        expect(f.P.adsRemoved()).toBe(true);
        expect(f.P.status().pending).toBe(false);
    });

    it('an Android pending purchase found at launch shows as pending, not owned', async () => {
        const f = setup({ platform: 'android' });
        f.store.pending = true;
        await f.P.refresh();
        expect(f.P.adsRemoved()).toBe(false);
        expect(f.P.status().pending).toBe(true);
    });

    it('Android acknowledges outstanding purchases before reading them', async () => {
        const f = setup({ platform: 'android' });
        await f.P.refresh();
        const names = f.calls.map((c) => c[0]);
        expect(names.indexOf('restorePurchases')).toBeGreaterThan(-1);
        expect(names.indexOf('restorePurchases')).toBeLessThan(names.indexOf('getPurchases'));
    });

    it('"already owned" on Android turns into a restore', async () => {
        const f = setup({ platform: 'android' });
        f.store.owned.push(PRODUCT_ID);
        f.store.reject = { code: 'ITEM_ALREADY_OWNED', message: 'Purchase is not purchased' };
        expect(await f.P.buy()).toBe('owned');
        expect(f.P.adsRemoved()).toBe(true);
    });

    it('Restore finds a purchase made on another device', async () => {
        const f = setup();
        await f.P.refresh();
        f.store.owned.push(PRODUCT_ID);
        expect(await f.P.restore()).toBe(true);
        expect(f.P.adsRemoved()).toBe(true);
    });

    it('a stale query that started before the purchase cannot undo it', async () => {
        const f = setup();
        await f.P.refresh();
        let release;
        const real = f.plugin.getPurchases;
        f.plugin.getPurchases = () => new Promise((r) => { release = () => r({ purchases: [] }); });
        const slow = f.P.refresh();
        f.plugin.getPurchases = real;
        expect(await f.P.buy()).toBe('owned');
        release();
        await slow;
        expect(f.P.adsRemoved()).toBe(true);
    });

    it('iOS listens for Ask to Buy approvals and refunds', async () => {
        const f = setup();
        await f.P.start();
        await f.settle();
        expect(f.calls.some((c) => c[0] === 'addListener' && c[1] === 'transactionUpdated')).toBe(true);
        f.store.owned.push(PRODUCT_ID);
        f.store.listener({});
        await f.settle();
        await f.settle();
        expect(f.P.adsRemoved()).toBe(true);
    });

    it('the web build has no store', async () => {
        const f = setup({ native: false, platform: 'web' });
        expect(f.P.available()).toBe(false);
        expect(await f.P.buy()).toBe('failed');
        await f.P.start();
        expect(f.calls).toHaveLength(0);
    });
});
