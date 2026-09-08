/* sound.ts — the blips.
 *
 * Ported from the sort game's ui.js, frequencies and durations unchanged, so
 * the two games sound like each other. Nothing is fetched: every sound is an
 * oscillator and a gain envelope, which is why there is not an audio file in
 * the repository.
 *
 * This and app.ts are the two files in src/ that know they are in a browser.
 * The rest — the generator, the rules, the settings, the campaign — stay pure
 * so a phone build can take them as they are. */

/* A running AudioContext holds the output device open, and an open device
   hums audibly on a lot of hardware with nothing playing at all. The graph
   itself is silent between sounds, so the hum is the open stream, and the
   only way to stop it is to hand the device back. So the context is suspended
   once nothing has sounded for a moment and resumed by the next sound — and
   it is never opened at all while sound is switched off, which is what makes
   the switch actually silence the hardware rather than just the game. */
const IDLE_MS = 1500; /* comfortably longer than the longest sound (~0.5s) */

type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export const Sound = {
  on: true,
  ctx: null as AudioContext | null,
  /* Set once anything throws. Audio is the last thing that should take a game
     down with it, so after one failure it goes quiet and stays quiet. */
  broken: false,
  idle: 0,

  /* Browsers refuse to start an AudioContext outside a user gesture, so this
     is called from the click handler rather than at load. */
  ensure(): AudioContext | null {
    if (!this.on || this.broken) return null;
    try {
      if (!this.ctx && typeof AudioContext !== 'undefined') this.ctx = new AudioContext();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.broken = true;
      this.ctx = null;
    }
    return this.ctx;
  },

  /* Give the device back shortly after the last sound. Every blip pushes this
     out, so a run of taps never suspends between them. */
  rest(): void {
    if (this.idle) window.clearTimeout(this.idle);
    this.idle = window.setTimeout(() => {
      this.idle = 0;
      this.hush();
    }, IDLE_MS);
  },

  hush(): void {
    if (this.idle) { window.clearTimeout(this.idle); this.idle = 0; }
    try {
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    } catch { /* nothing to give back */ }
  },

  blip(freq: number, dur: number, type: Wave = 'sine', gain = 0.09): void {
    if (!this.on) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      /* Ramped from and to a whisker above zero rather than from zero:
         exponential ramps cannot touch it. */
      amp.gain.setValueAtTime(0.0001, ctx.currentTime);
      amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(amp).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    } catch {
      this.broken = true;
    }
    this.rest();
  },

  /* A move. Pitch rises with how much of the board you now hold, so a game
     climbs as it goes — the sort game's pour, reading fullness off the board
     instead of off a jar. */
  flood(fullness: number): void { this.blip(320 + fullness * 260, 0.11, 'sine'); },

  /* Any button. */
  tap(): void { this.blip(540, 0.06, 'triangle', 0.05); },

  /* A move that could not be played, or one that was wasted. */
  nope(): void { this.blip(150, 0.13, 'sawtooth', 0.05); },

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => {
      window.setTimeout(() => this.blip(f, 0.22, 'triangle', 0.08), i * 95);
    });
  },
};
