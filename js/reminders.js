/* reminders.js — the daily puzzle reminder, as a LOCAL notification.
 *
 * Ported from Color Match & Merge (color-sorting, js/reminders.js). The daily
 * puzzle is dealt on the phone from the date, so the phone can schedule its
 * own reminder too: no push server, no Firebase Cloud Messaging, no APNs keys,
 * no store setup, and nothing leaves the device.
 *
 * Not one repeating alarm, because a repeating alarm cannot skip a day.
 * Instead the next DAYS_AHEAD days are scheduled one by one, and every time
 * the game opens, comes back to the foreground or a daily is finished, all of
 * them are cancelled and scheduled again from scratch. So:
 *   - today's reminder goes as soon as today's daily is done;
 *   - the streak in the wording is true on the day it arrives;
 *   - somebody who stops playing hears from the game for a week, then never.
 *
 * Permission is asked only after the player taps "Remind me" — in the offer
 * or in Settings — never at launch. iOS shows that system prompt once per
 * install, and spending it before anybody cares about the daily wastes it.
 *
 * Where the choice is kept is the app's business: it lives in the save
 * beside everything else (saved.reminder), and Reset progress leaves it be.
 * This module is handed a way to read and write it rather than keeping its
 * own key.
 *
 * Reached through window.Capacitor rather than imported, like every other
 * plugin here: js/ is plain ES modules and a web view cannot resolve a bare
 * package name. Off a phone there is no plugin, and every call is a no-op. */
import { dayKey, streakOf } from "./levels.js";
export const DAYS_AHEAD = 7;
/* Ids FIRST_ID .. FIRST_ID + DAYS_AHEAD - 1 belong to this module, and only
   those are ever cancelled. */
export const FIRST_ID = 7100;
export const DEFAULT_HOUR = 18;
/* The hours the Settings picker offers: 7am to 10pm. */
export const HOURS = Array.from({ length: 16 }, (_, i) => 7 + i);
const CHANNEL = 'daily';
export const TITLE = 'Daily puzzle';
export function bodyFor(streak) {
    return streak >= 2
        ? 'Your daily puzzle is ready. Keep your ' + streak + '-day streak alive! \u{1F525}'
        : 'A new daily puzzle is ready.';
}
export function hourLabel(h) {
    return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
}
/* The saved choice, read back defensively like the rest of the save.
     on:    the player said yes and the system allowed it
     asked: the one-time offer has been shown (or answered in Settings)
     hour:  0-23, the phone's local time */
export function readReminder(got) {
    const from = (got && typeof got === 'object' ? got : {});
    const hour = Number(from.hour);
    return {
        on: from.on === true,
        asked: from.asked === true,
        hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR,
    };
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/* What to schedule, given the days solved. Pure, so it is tested without a
   phone.

   The streak is quoted only on the next reminder to fire — today's if today
   is not done, tomorrow's if it is. By the one after, the player may have
   missed a day in between, and a notification promising a streak that has
   already gone is worse than one that does not mention it. */
export function plan(solved, hour, now = new Date()) {
    const today = startOfDay(now);
    const todayDone = solved.has(dayKey(today));
    /* Alive at the moment the next reminder fires: counted from today if it is
       done, from yesterday if not — streakOf already reads it that way. */
    const streak = streakOf(solved, today);
    const out = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
        if (i === 0 && todayDone)
            continue;
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0);
        if (at <= now)
            continue;
        const next = todayDone ? i === 1 : i === 0;
        out.push({
            id: FIRST_ID + i,
            title: TITLE,
            body: bodyFor(next ? streak : 0),
            schedule: { at, allowWhileIdle: true },
            /* Inexact. A reminder a few minutes late is fine, and asking for exact
               alarms sends Android 12+ players to a system settings page — the
               manifest removes that permission for the same reason. */
            isExactNotification: false,
            channelId: CHANNEL,
            smallIcon: 'ic_stat_daily',
            iconColor: '#FF5D8F',
            extra: { kind: 'daily', day: dayKey(day) },
        });
    }
    return out;
}
/* A factory rather than one object, so a test can have a fresh one with its
   own stand-in plugin. The app uses the single instance exported below. */
export function makeReminders() {
    let plugin;
    let channelMade = false;
    let syncing = Promise.resolve();
    let opened = null;
    let listening = false;
    /* Wired by the app at boot. Until then nothing is on and nothing is saved. */
    let read = () => readReminder(null);
    let write = (_r) => { };
    let solved = () => new Set();
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
    const get = () => {
        if (plugin !== undefined)
            return plugin;
        if (!available())
            return null;
        const c = window.Capacitor;
        plugin = c.registerPlugin ? c.registerPlugin('LocalNotifications') : (c.Plugins?.LocalNotifications ?? null);
        return plugin;
    };
    /* 'granted' | 'denied' | 'prompt' | 'unavailable' */
    async function permission() {
        const LN = get();
        if (!LN)
            return 'unavailable';
        try {
            const r = await LN.checkPermissions();
            if (r.display === 'granted')
                return 'granted';
            if (r.display === 'denied')
                return 'denied';
            return 'prompt';
        }
        catch {
            return 'unavailable';
        }
    }
    async function ensureChannel() {
        if (channelMade || platform() !== 'android')
            return;
        try {
            await get().createChannel({
                id: CHANNEL,
                name: 'Daily puzzle',
                description: 'A reminder when the daily puzzle is ready',
                importance: 3,
            });
            channelMade = true;
        }
        catch { /* the default channel still delivers */ }
    }
    async function cancelAll() {
        const ids = [];
        for (let i = 0; i < DAYS_AHEAD; i++)
            ids.push({ id: FIRST_ID + i });
        try {
            await get().cancel({ notifications: ids });
        }
        catch { /* nothing was pending */ }
    }
    /* Cancel and schedule again from the current record. Safe to call as often
       as anything likes: calls queue rather than overlap, so two in quick
       succession cannot interleave a cancel with the other's schedule. */
    function sync() {
        syncing = syncing.then(async () => {
            const LN = get();
            if (!LN)
                return;
            await cancelAll();
            const r = read();
            if (!r.on || (await permission()) !== 'granted')
                return;
            await ensureChannel();
            const list = plan(solved(), r.hour);
            if (!list.length)
                return;
            try {
                await LN.schedule({ notifications: list });
            }
            catch { /* tried again at the next launch or resume */ }
        }).catch(() => { });
        return syncing;
    }
    return {
        available,
        permission,
        sync,
        state: () => read(),
        /* How the app hands over its save. */
        use(o) {
            read = o.read;
            write = o.write;
            solved = o.solved;
        },
        /* Turn reminders on, asking the system first if it has not been asked.
           'on', 'denied' (blocked in the phone's settings — say where to change
           it) or 'unavailable' (the web). */
        async enable() {
            const LN = get();
            if (!LN)
                return 'unavailable';
            let p = await permission();
            if (p === 'prompt') {
                try {
                    const r = await LN.requestPermissions();
                    p = r.display === 'granted' ? 'granted' : 'denied';
                }
                catch {
                    p = 'denied';
                }
            }
            const on = p === 'granted';
            write({ ...read(), on, asked: true });
            await sync();
            return on ? 'on' : 'denied';
        },
        async disable() {
            write({ ...read(), on: false, asked: true });
            await sync();
        },
        setHour(h) {
            const hour = Number(h);
            if (!(Number.isInteger(hour) && hour >= 0 && hour <= 23))
                return Promise.resolve();
            write({ ...read(), hour });
            return sync();
        },
        /* The one-time offer: once per install, only where notifications exist,
           and only if the system has not already said no — a prompt that cannot
           appear is a broken button. 'granted' counts too: Android 12 and older
           have no runtime prompt and report granted from the start, so the offer
           is the only question there is. */
        async shouldOffer() {
            const r = read();
            if (!available() || r.asked || r.on)
                return false;
            const p = await permission();
            return p === 'prompt' || p === 'granted';
        },
        markOffered() { write({ ...read(), asked: true }); },
        /* fn(day) runs when a reminder is tapped. A tap that cold-starts the app
           is held by the plugin until this listener is attached. */
        onOpen(fn) {
            opened = fn;
            const LN = get();
            if (!LN || !LN.addListener || listening)
                return;
            listening = true;
            try {
                void LN.addListener('localNotificationActionPerformed', (e) => {
                    const extra = e?.notification?.extra;
                    if (extra && extra.kind === 'daily' && opened)
                        opened(extra.day);
                });
            }
            catch { /* no listener, no deep link — the app still opens */ }
        },
    };
}
export const Reminders = makeReminders();
