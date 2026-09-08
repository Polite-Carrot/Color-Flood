/* ads.test.ts — when the interstitial is allowed to appear.
 *
 * Only the gate. The AdMob plumbing around it is a no-op off a phone and
 * there is nothing in it to assert that would not just be restating the
 * plugin's own API back at it; the cadence is the part that was actually
 * specified, and the part a change could quietly get wrong. */

import { describe, it, expect } from 'vitest';
import { Gate, MIN_LEVELS, MIN_MS } from './ads.ts';

const T0 = 1_700_000_000_000; /* any fixed instant; nothing here reads a clock */
const wins = (gate: Gate, n: number) => { for (let i = 0; i < n; i++) gate.note(); };

describe('the ad gate', () => {
  it('is both conditions, not either', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS);
    /* Three levels, but inside ninety seconds. */
    expect(gate.due(T0 + 90_000)).toBe(false);

    const idle = new Gate(T0);
    /* Ten minutes on the level grid, no puzzle finished. */
    expect(idle.due(T0 + 10 * 60_000)).toBe(false);
  });

  it('fires once both have been met', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS);
    expect(gate.due(T0 + MIN_MS)).toBe(true);
  });

  it('needs the third win, not the second', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS - 1);
    expect(gate.due(T0 + MIN_MS)).toBe(false);
    gate.note();
    expect(gate.due(T0 + MIN_MS)).toBe(true);
  });

  it('starts warming an ad one win before it can be shown', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS - 2);
    expect(gate.warming()).toBe(false);
    gate.note();
    expect(gate.warming()).toBe(true);
  });

  it('resets both counters when one is shown, so two never run together', () => {
    const gate = new Gate(T0);
    wins(gate, MIN_LEVELS);
    const at = T0 + MIN_MS;
    expect(gate.due(at)).toBe(true);
    gate.shown(at);

    /* The next three wins land immediately after. The clock has restarted, so
       they do not fire a second ad on top of the first. */
    wins(gate, MIN_LEVELS);
    expect(gate.due(at + 1000)).toBe(false);
    expect(gate.due(at + MIN_MS)).toBe(true);
  });

  it('counts time from when it was made, so a fresh install gets two minutes', () => {
    const gate = new Gate(T0);
    /* A fast player: three levels done in the first minute. */
    wins(gate, MIN_LEVELS + 2);
    expect(gate.due(T0 + 60_000)).toBe(false);
    expect(gate.due(T0 + MIN_MS)).toBe(true);
  });

  it('is the cap the sort game uses', () => {
    expect(MIN_LEVELS).toBe(3);
    expect(MIN_MS).toBe(2 * 60 * 1000);
  });
});
