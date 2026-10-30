/* reminders.test.js — the daily reminder, without a phone.
 *
 * Ported from Color Match & Merge's test/reminders.test.js, run against a
 * stand-in LocalNotifications plugin and this game's own save shape and
 * streak arithmetic. */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { DAYS_AHEAD, FIRST_ID, bodyFor, hourLabel, makeReminders, plan, readReminder } from '../js/reminders.js';
import { dayKey } from '../js/levels.js';

function setup({ permission = 'prompt', answer = 'granted', platform = 'ios', native = true, stored = null, days = [] } = {}) {
    const calls = [];
    let perm = permission;
    const plugin = {
        async checkPermissions() { return { display: perm }; },
        async requestPermissions() { calls.push(['requestPermissions']); perm = answer; return { display: perm }; },
        async cancel(o) { calls.push(['cancel', o.notifications.map((n) => n.id)]); },
        async schedule(o) { calls.push(['schedule', o.notifications]); return {}; },
        async createChannel(o) { calls.push(['createChannel', o.id]); },
        async addListener(name, fn) { calls.push(['addListener', name]); plugin.tap = fn; },
    };
    globalThis.window = {
        Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, registerPlugin: () => plugin },
    };
    /* The app's save, as far as the reminder sees it. */
    const saved = { reminder: readReminder(stored), days: [...days] };
    const writes = [];
    const R = makeReminders();
    R.use({
        read: () => saved.reminder,
        write: (r) => { saved.reminder = r; writes.push(r); },
        solved: () => new Set(saved.days),
    });
    return {
        R, saved, writes, calls, plugin,
        scheduled: () => { const s = calls.filter((c) => c[0] === 'schedule').pop(); return s ? s[1] : []; },
    };
}
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
afterEach(() => { delete globalThis.window; vi.useRealTimers(); });

describe('daily reminders', () => {
    it('asks and schedules nothing until the player says yes', async () => {
        const f = setup();
        await f.R.sync();
        expect(f.calls.some((c) => c[0] === 'requestPermissions')).toBe(false);
        expect(f.calls.some((c) => c[0] === 'schedule')).toBe(false);
    });

    it('yes asks the system once and schedules the next week at 6pm', async () => {
        const f = setup();
        expect(await f.R.enable()).toBe('on');
        expect(f.calls.filter((c) => c[0] === 'requestPermissions')).toHaveLength(1);
        const list = f.scheduled();
        expect(list.length).toBeGreaterThanOrEqual(DAYS_AHEAD - 1);
        expect(list.length).toBeLessThanOrEqual(DAYS_AHEAD);
        for (const n of list) {
            expect(new Date(n.schedule.at).getHours()).toBe(18);
            expect(new Date(n.schedule.at) > new Date()).toBe(true);
            expect(n.isExactNotification, 'never sends Android players to the exact-alarm page').toBe(false);
            expect(n.extra.kind).toBe('daily');
            expect(n.smallIcon).toBe('ic_stat_daily');
        }
        expect(new Set(list.map((n) => n.id)).size).toBe(list.length);
        expect(f.saved.reminder).toEqual({ on: true, asked: true, hour: 18 });
    });

    it('skips today once today is done', () => {
        const today = daysAgo(0);
        const morning = new Date(today); morning.setHours(9);
        const unsolved = plan(new Set(), 23, morning);
        const solved = plan(new Set([dayKey(today)]), 23, morning);
        expect(new Date(unsolved[0].schedule.at).getDate()).toBe(today.getDate());
        expect(new Date(solved[0].schedule.at).getDate()).not.toBe(today.getDate());
        expect(solved).toHaveLength(unsolved.length - 1);
    });

    it('skips a time that has already passed today', () => {
        const evening = daysAgo(0); evening.setHours(20);
        const list = plan(new Set(), 18, evening);
        expect(new Date(list[0].schedule.at).getDate()).not.toBe(evening.getDate());
        expect(list).toHaveLength(DAYS_AHEAD - 1);
    });

    it('quotes the streak only on the next reminder, where it is still true', () => {
        /* Today and the four days before it. */
        const done = new Set([0, 1, 2, 3, 4].map((n) => dayKey(daysAgo(n))));
        const morning = daysAgo(0); morning.setHours(9);
        const list = plan(done, 23, morning);
        /* Today is done, so the first reminder is tomorrow's, and it quotes 5. */
        expect(list[0].body).toBe('Your daily puzzle is ready. Keep your 5-day streak alive! \u{1F525}');
        expect(list.slice(1).every((n) => n.body === 'A new daily puzzle is ready.')).toBe(true);
    });

    it("quotes yesterday's streak on today's reminder when today is not done yet", () => {
        const done = new Set([1, 2, 3].map((n) => dayKey(daysAgo(n))));
        const morning = daysAgo(0); morning.setHours(9);
        expect(plan(done, 23, morning)[0].body).toMatch(/Keep your 3-day streak alive/);
    });

    it('says nothing about a streak of one or none', () => {
        expect(bodyFor(0)).toBe('A new daily puzzle is ready.');
        expect(bodyFor(1)).toBe('A new daily puzzle is ready.');
        expect(bodyFor(2)).toBe('Your daily puzzle is ready. Keep your 2-day streak alive! \u{1F525}');
    });

    it('declining at the system prompt leaves reminders off', async () => {
        const f = setup({ answer: 'denied' });
        expect(await f.R.enable()).toBe('denied');
        expect(f.saved.reminder.on).toBe(false);
        expect(f.calls.some((c) => c[0] === 'schedule')).toBe(false);
    });

    it('refused before: no prompt can appear, so it says blocked', async () => {
        const f = setup({ permission: 'denied' });
        expect(await f.R.enable()).toBe('blocked');
        expect(f.calls.some((c) => c[0] === 'requestPermissions'), 'nothing to show').toBe(false);
        expect(f.saved.reminder).toEqual({ on: false, asked: true, hour: 18 });
    });

    it('refusing the prompt just shown is denied, not blocked', async () => {
        const f = setup({ answer: 'denied' });
        expect(await f.R.enable()).toBe('denied');
    });

    it('opens the phone settings: app-settings: on iOS', () => {
        const f = setup({ platform: 'ios' });
        globalThis.window.location = { href: '' };
        f.R.openSettings();
        expect(globalThis.window.location.href).toBe('app-settings:');
    });

    it("opens the phone settings: the app's notification page on Android", async () => {
        const opened = [];
        const f = setup({ platform: 'android' });
        globalThis.window.Capacitor.registerPlugin = (name) => (name === 'NotificationSettings'
            ? { open: async () => { opened.push(name); } } : f.plugin);
        f.R.openSettings();
        await Promise.resolve();
        expect(opened).toEqual(['NotificationSettings']);
    });

    it('offers once, and never where the system already said no', async () => {
        const f = setup();
        expect(await f.R.shouldOffer()).toBe(true);
        f.R.markOffered();
        expect(await f.R.shouldOffer()).toBe(false);
        expect(await setup({ permission: 'denied' }).R.shouldOffer()).toBe(false);
        expect(await setup({ permission: 'granted', platform: 'android' }).R.shouldOffer(),
            'Android 12 and older report granted with no prompt').toBe(true);
    });

    it('turning it off cancels everything', async () => {
        const f = setup();
        await f.R.enable();
        await f.R.disable();
        expect(f.calls.at(-1)[0]).toBe('cancel');
        expect(f.calls.at(-1)[1]).toEqual(Array.from({ length: DAYS_AHEAD }, (_, i) => FIRST_ID + i));
        expect(f.saved.reminder.on).toBe(false);
    });

    it('changing the hour reschedules at the new time and saves it', async () => {
        const f = setup();
        await f.R.enable();
        await f.R.setHour('8');
        expect(f.scheduled().every((n) => new Date(n.schedule.at).getHours() === 8)).toBe(true);
        expect(f.saved.reminder.hour).toBe(8);
    });

    it('a solved daily drops today and moves the streak on, on the next sync', async () => {
        /* Morning, so today's 11pm slot is still ahead whenever this runs. */
        const morning = daysAgo(0); morning.setHours(9);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(morning);
        const f = setup({ stored: { on: true, asked: true, hour: 23 }, days: [dayKey(daysAgo(1))], permission: 'granted' });
        await f.R.sync();
        const before = f.scheduled();
        f.saved.days.push(dayKey(daysAgo(0)));
        await f.R.sync();
        const after = f.scheduled();
        expect(after).toHaveLength(before.length - 1);
        expect(after[0].body).toMatch(/2-day streak/);
    });

    it('Android gets its channel before the first schedule', async () => {
        const f = setup({ platform: 'android' });
        await f.R.enable();
        const names = f.calls.map((c) => c[0]);
        expect(names.indexOf('createChannel')).toBeGreaterThanOrEqual(0);
        expect(names.indexOf('createChannel')).toBeLessThan(names.indexOf('schedule'));
    });

    it('iOS has no channel to make', async () => {
        const f = setup({ platform: 'ios' });
        await f.R.enable();
        expect(f.calls.some((c) => c[0] === 'createChannel')).toBe(false);
    });

    it('tapping a reminder reaches the game; other notifications do not', async () => {
        const f = setup();
        const opened = [];
        f.R.onOpen((day) => opened.push(day));
        await f.R.enable();
        const n = f.scheduled()[0];
        f.plugin.tap({ actionId: 'tap', notification: n });
        f.plugin.tap({ actionId: 'tap', notification: { extra: { kind: 'something-else' } } });
        expect(opened).toEqual([n.extra.day]);
    });

    it('the web has nothing to schedule and asks for nothing', async () => {
        const f = setup({ native: false, platform: 'web' });
        expect(f.R.available()).toBe(false);
        expect(await f.R.enable()).toBe('unavailable');
        expect(await f.R.shouldOffer()).toBe(false);
        await f.R.sync();
        expect(f.calls).toHaveLength(0);
    });
});

describe('the saved choice', () => {
    it('defaults to off, not asked, 6pm', () => {
        expect(readReminder(undefined)).toEqual({ on: false, asked: false, hour: 18 });
    });

    it('reads a save back defensively', () => {
        expect(readReminder({ on: true, asked: true, hour: 8 })).toEqual({ on: true, asked: true, hour: 8 });
        expect(readReminder({ on: 'yes', hour: 31 })).toEqual({ on: false, asked: false, hour: 18 });
        expect(readReminder('nonsense')).toEqual({ on: false, asked: false, hour: 18 });
    });

    it('labels the hour the way the offer says it', () => {
        expect(hourLabel(18)).toBe('6pm');
        expect(hourLabel(12)).toBe('12pm');
        expect(hourLabel(7)).toBe('7am');
    });
});
