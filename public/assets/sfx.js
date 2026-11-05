// Sounds, synthesized on the spot with the Web Audio API (no audio files), quiet and alive:
// - every gesture has its own sound and follows what the hand does: grabbing, dragging (a continuous rub that grows
//   with the speed), throwing (air that grows with the release speed), impacts (by size and speed), shaking,
//   setting down, pressing;
// - nothing is ever the same sound twice: partials, filters, envelopes and stereo position vary on every hit, not
//   only the pitch;
// - the pointer passing over a panel is a deep, almost imperceptible breath, once per panel; buttons are silent until
//   pressed;
// - music (goals, the timer, secrets) uses soft voices on a pentatonic scale, in one shared room.
// Silent until the person turns sounds on; the audio context starts on the first gesture after that, as browsers
// require.

let ctx = null;
let master = null;
let verb = null;
let noise = null;
let enabled = false;
let volume = 0.7;
const GAIN = 0.6;
const last = {};

function build() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = GAIN * volume;
  // Nothing sharp: a gentle top, and a soft limiter so that stacked sounds never clip.
  const top = ctx.createBiquadFilter();
  top.type = 'lowpass'; top.frequency.value = 7000; top.Q.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.3;
  master.connect(top).connect(comp).connect(ctx.destination);
  // The room: a stereo impulse of decaying, slightly darkened noise.
  verb = ctx.createConvolver();
  const len = Math.round(ctx.sampleRate * 2.6);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i += 1) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * (1 - i / len) ** 3; }
  }
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  verb.connect(wet).connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const n = noise.getChannelData(0);
  for (let i = 0; i < n.length; i += 1) n[i] = Math.random() * 2 - 1;
  return ctx;
}
function audio(force = false) {
  if (!enabled && !force) return null;
  if (!ctx && !build()) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
const now = () => ctx.currentTime;
const vary = (x, amount) => x * (1 + (Math.random() * 2 - 1) * amount);
const limit = (name, ms) => { const t = performance.now(); if (t - (last[name] ?? 0) < ms) return false; last[name] = t; return true; };
// A voice goes to the dry mix and, by `room`, to the reverb, from a place in the stereo field.
function out(node, room = 0.4, pan = 0) {
  let n = node;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); n = n.connect(p); }
  n.connect(master);
  if (room > 0) { const g = ctx.createGain(); g.gain.value = room; n.connect(g).connect(verb); }
  return n;
}
function env(gain, t, attack, decay, curve = 'exp') {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  else g.gain.setTargetAtTime(0.0001, t + attack, decay / 4);
  return g;
}
function sine(freq, t, { gain, attack = 0.004, decay = 0.3, glide = 0, type = 'sine', room = 0.4, pan = 0 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + attack + decay * 0.8);
  const g = env(gain, t, attack, decay);
  out(o.connect(g), room, pan);
  o.start(t); o.stop(t + attack + decay + 0.05);
}
function hiss(t, { gain, attack = 0.002, decay = 0.05, freq = 1200, q = 0.8, sweep = 0, type = 'bandpass', room = 0.3, pan = 0 }) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + attack + decay);
  const g = env(gain, t, attack, decay);
  out(s.connect(f).connect(g), room, pan);
  s.start(t, Math.random() * 1.5); s.stop(t + attack + decay + 0.05);
}
// A struck body: a few inharmonic partials, different on every hit, high ones fading first, and a tiny transient.
function body(freq, t, { gain, decay = 0.4, bright = 1, room = 0.35, pan = (Math.random() - 0.5) * 0.6, partials = [1, 2.41, 3.93, 5.6] }) {
  partials.forEach((ratio, i) => {
    const r = i ? vary(ratio, 0.03) : 1;
    const f = freq * r;
    if (f > 9000) return;
    sine(f, t, { gain: gain * (i ? (0.5 * bright) / (i * 1.3) : 1), attack: 0.002 + Math.random() * 0.002, decay: vary(decay / (1 + i * 0.7), 0.2), room, pan });
  });
  hiss(t, { gain: gain * 0.35 * bright, decay: 0.012, freq: Math.min(7000, freq * vary(4, 0.2)), q: 1.5, room: 0.1, pan });
}

// The pentatonic scale, from A: any sequence of these notes sounds pleasant.
const PENTA = [0, 3, 5, 7, 10];
const note = (step, base = 220) => base * 2 ** ((PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
// Bigger things sound lower.
const sizeToFreq = (size) => Math.max(140, Math.min(900, 1400 / Math.sqrt(Math.max(8, size))));

/* ---------- the continuous voice of a drag ---------- */
let rub = null; // { src, filter, gain }
function rubStart() {
  if (rub) return;
  const s = ctx.createBufferSource();
  s.buffer = noise; s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.value = 400;
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  out(s.connect(f).connect(g), 0.15, 0);
  s.start(now(), Math.random() * 1.5);
  rub = { src: s, filter: f, gain: g };
}
function rubStop() {
  if (!rub) return;
  const r = rub; rub = null;
  r.gain.gain.cancelScheduledValues(now());
  r.gain.gain.setTargetAtTime(0.0001, now(), 0.06);
  r.src.stop(now() + 0.4);
}
let shakeDir = 0;

export const sfx = {
  get on() { return enabled; },
  enable(on) { enabled = !!on; if (enabled) audio(); else rubStop(); },
  setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = GAIN * volume; },
  // The context for music the person starts on purpose (the radio), whether or not interface sounds are on.
  raw() { const a = audio(true); return a ? { ctx: a, out: master, verb } : null; },

  /* ---------- the interface ---------- */
  // The pointer arriving on a panel: a deep breath, barely there. Bigger panels breathe lower.
  hover(size = 300) {
    if (!audio() || !limit('hover', 320)) return;
    const t = now();
    const f = vary(Math.max(70, Math.min(140, 26000 / Math.max(120, size))), 0.06);
    sine(f, t, { gain: 0.016, attack: 0.09, decay: 0.7, glide: 0.94, room: 0.25 });
    hiss(t, { gain: 0.006, attack: 0.12, decay: 0.5, freq: vary(260, 0.2), q: 0.6, type: 'lowpass', room: 0.2 });
  },
  // A press: a soft, felt tap with a little depth.
  press() {
    if (!audio() || !limit('press', 70)) return;
    const t = now();
    sine(vary(150, 0.06), t, { gain: 0.036, attack: 0.002, decay: 0.08, glide: 0.65, room: 0.1 });
    hiss(t, { gain: 0.012, decay: 0.012, freq: vary(1600, 0.25), q: 1.2, room: 0.05 });
  },
  tick() {
    if (!audio() || !limit('tick', 60)) return;
    hiss(now(), { gain: 0.016, decay: 0.01, freq: vary(2600, 0.2), q: 2, room: 0.05 });
  },
  toggle(on) {
    if (!audio()) return;
    const t = now(); const [a, b] = on ? [5, 7] : [7, 5];
    body(note(a + 5), t, { gain: 0.03, decay: 0.5, bright: 0.4, room: 0.3 });
    body(note(b + 5), t + 0.07, { gain: 0.028, decay: 0.7, bright: 0.4, room: 0.3 });
  },
  // Changing pages: a distant swell, at most every second and a half.
  open() {
    if (!audio() || !limit('open', 1500)) return;
    const t = now();
    hiss(t, { gain: 0.012, attack: 0.25, decay: 0.9, freq: 300, q: 0.7, sweep: 2.2, room: 0.6 });
    sine(vary(note(-5, 220), 0.01), t, { gain: 0.012, attack: 0.3, decay: 1.2, room: 0.7 });
  },

  /* ---------- objects in the hand ---------- */
  grab(size = 40) {
    if (!audio()) return;
    const t = now();
    body(sizeToFreq(size) * 1.5, t, { gain: 0.03, decay: 0.18, bright: 0.5, room: 0.15 });
    rubStart();
    shakeDir = 0;
  },
  // While dragging: a rub that grows with the speed; quick reversals are a shake.
  drag(speed = 0, vx = 0) {
    if (!audio() || !rub) return;
    const s = Math.min(1, speed / 1800);
    const t = now();
    rub.gain.gain.setTargetAtTime(0.0001 + s * 0.035, t, 0.05);
    rub.filter.frequency.setTargetAtTime(250 + s * 1800, t, 0.05);
    const dir = Math.sign(vx);
    if (dir && shakeDir && dir !== shakeDir && Math.abs(vx) > 500 && limit('shake', 70)) this.shake(Math.min(1, Math.abs(vx) / 2500));
    if (dir) shakeDir = dir;
  },
  // Letting go: a soft set-down when slow, air that grows with the speed when thrown.
  release(speed = 0, size = 40) {
    if (!audio()) return;
    rubStop();
    const t = now();
    if (speed > 500) {
      const s = Math.min(1, speed / 2200);
      hiss(t, { gain: 0.02 + s * 0.05, attack: 0.02, decay: 0.18 + s * 0.35, freq: 900 + s * 1400, q: 0.6, sweep: 0.35, room: 0.25, pan: (Math.random() - 0.5) * 0.4 });
    } else body(sizeToFreq(size), t, { gain: 0.03, decay: 0.25, bright: 0.3, room: 0.2 });
  },
  // Two things meeting: by size and speed, a different body every time; gentle and never too often.
  impact(size = 40, speed = 300) {
    if (!audio() || speed < 260 || !limit('impact', 90)) return;
    const s = Math.min(1, (speed - 260) / 1600);
    body(vary(sizeToFreq(size), 0.08), now(), { gain: 0.012 + s * 0.05, decay: 0.12 + s * 0.25, bright: 0.3 + s * 0.6 });
  },
  shake(intensity = 0.5) {
    if (!audio()) return;
    const t = now();
    for (let i = 0; i < 3; i += 1) hiss(t + i * vary(0.022, 0.4), { gain: 0.01 + intensity * 0.025, decay: 0.015, freq: vary(2200, 0.4), q: 3, room: 0.1, pan: (Math.random() - 0.5) * 0.8 });
  },
  // A bubble: a drop of water, different every time.
  pop() {
    if (!audio() || !limit('pop', 40)) return;
    const t = now(); const f = vary(520, 0.25);
    sine(f, t, { gain: 0.05, attack: 0.002, decay: 0.09, glide: vary(2.3, 0.15), room: 0.45 });
  },
  // Letters of the wordmark: soft wooden notes.
  note(step = 0) { if (!audio()) return; body(note(step + 7), now(), { gain: 0.035, decay: 0.6, bright: 0.35, room: 0.4 }); },
  boing(step = 0) { this.note(step); },

  /* ---------- moments ---------- */
  // A goal met: a soft rising figure, voiced differently each time, over a low note.
  chime() {
    if (!audio()) return;
    const t = now(); const steps = pick([[5, 7, 10], [5, 9, 12], [3, 7, 10], [7, 10, 12]]);
    steps.forEach((s, i) => body(note(s + 5), t + i * vary(0.08, 0.15), { gain: 0.03, decay: 1.0, bright: 0.35, room: 0.55 }));
    sine(note(0, 110), t, { gain: 0.03, attack: 0.05, decay: 1.4, room: 0.5 });
  },
  // Every goal met: the figure climbs further and a deep chord opens under it.
  fanfare() {
    if (!audio()) return;
    const t = now();
    [5, 7, 10, 12, 14].forEach((s, i) => body(note(s + 5), t + i * vary(0.09, 0.1), { gain: 0.03, decay: i === 4 ? 2 : 1, bright: 0.4, room: 0.6 }));
    for (const s of [0, 7, 12]) sine(note(s, 110), t + 0.05, { gain: 0.022, attack: 0.4, decay: 2.4, room: 0.7 });
  },
  // The focus timer reached zero: a singing bowl, struck twice, with slow beating.
  bell() {
    if (!audio()) return;
    for (const at of [0, 1.6]) {
      const t = now() + at;
      for (const [r, g, d] of [[1, 0.06, 5], [2.71, 0.025, 3.2], [5.15, 0.01, 1.8]]) {
        sine(196 * r, t, { gain: g, attack: 0.008, decay: d, room: 0.6 });
        sine(196 * r * 1.0035, t, { gain: g * 0.7, attack: 0.008, decay: d, room: 0.6 });
      }
    }
  },

  /* ---------- for the easter eggs: originals, in the spirit of the games they wink at ---------- */
  portal() {
    if (!audio()) return;
    const t = now();
    hiss(t, { gain: 0.06, attack: 0.08, decay: 0.8, freq: 220, q: 5, sweep: 8, room: 0.7 });
    sine(180, t + 0.05, { gain: 0.03, attack: 0.06, decay: 0.9, glide: 3.5, type: 'triangle', room: 0.7 });
  },
  crit() {
    if (!audio()) return;
    const t = now();
    body(note(12, 440), t, { gain: 0.05, decay: 0.7, bright: 0.8 });
    body(note(15, 440), t + 0.06, { gain: 0.05, decay: 1.1, bright: 0.8 });
  },
  secret() {
    if (!audio()) return;
    const t = now();
    for (const s of [-5, 0, 3]) sine(note(s, 220), t, { gain: 0.016, attack: 0.6, decay: 2.2, room: 0.8 });
    [12, 14, 17].forEach((s, i) => body(note(s, 220), t + 0.7 + i * 0.13, { gain: 0.025, decay: 1.2, bright: 0.4, room: 0.6 }));
  },

  /* ---------- the names older code uses ---------- */
  pick() { this.grab(40); },
  drop() { this.release(0, 40); },
  knock(radius = 30, speed = 300) { this.impact(radius * 2, speed); },
};
