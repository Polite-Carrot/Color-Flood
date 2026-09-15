/* track.test.ts — the one part of analytics with a right answer.
 *
 * The rest of track.ts is a bridge to somebody else's SDK and a consent flag;
 * there is nothing to assert there that would not just be the mock agreeing
 * with itself. Trimming is different: Firebase REJECTS a parameter name over
 * 40 characters or a value over 100, so getting this wrong loses events
 * silently, in production, on a platform where nobody is watching a console. */

import { describe, it, expect } from 'vitest';
import { Track, trim } from './track.ts';

describe('parameter trimming', () => {
  it('cuts names at 40 and string values at 100', () => {
    const out = trim({ ['n'.repeat(60)]: 'v'.repeat(160) });
    const [name, value] = Object.entries(out)[0]!;
    expect(name).toHaveLength(40);
    expect(value).toHaveLength(100);
  });

  it('leaves numbers and booleans alone', () => {
    expect(trim({ par: 13, over_par: 0, won: true })).toEqual({ par: 13, over_par: 0, won: true });
  });

  it('leaves anything already short exactly as it was', () => {
    const params = { game: 'merge', screen: 'campaign', level: '78', size: '11x11' };
    expect(trim(params)).toEqual(params);
  });
});

describe('consent', () => {
  it('sends nothing until it is switched on', () => {
    /* No window in Node, so the native branch is off and gtag is absent —
       which is the same position the web build is in before consent. The
       point of the assertion is that it does not THROW: every call site is
       one line with no guard around it, on the promise that this is safe at
       any time. */
    expect(Track.on).toBe(false);
    expect(() => Track.event('puzzle_start', { game: 'flood' })).not.toThrow();
  });

  it('is unconfigured with no measurement id, so the web build stays inert', () => {
    /* If this ever fails it means an id was committed. That is fine and
       intended — but it also means the live site starts setting cookies, so
       it should be a deliberate change rather than a surprise. */
    expect(Track.configured()).toBe(false);
  });
});
