// Sounds, synthesized on the spot with the Web Audio API (no audio files). Everything is glass, water and deep air:
// struck glass has inharmonic partials that ring and fade; a drop of water glides up in pitch; a swell is a soft chord
// that opens slowly. All of it sits in one shared space (a generated reverb), quietly, on a pentatonic scale so that
// any sequence of notes sounds pleasant. Silent until the person turns sounds on; the audio context starts on the first
// gesture after that, as browsers require.

let ctx = null;
let master = null;
let verb = null;
let noise = null;
let enabled = false;
let volume = 0.7;
const last = {};
const GAIN = 0.55;

function build() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = GAIN * volume;
  // A gentle top so nothing is sharp, and a limiter so stacked notes never clip.
  const soft = ctx.createBiquadFilter();
  soft.type = 'highshelf'; soft.frequency.value = 5200; soft.gain.value = -7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  master.connect(soft).connect(comp).connect(ctx.destination);
  // The room: a stereo impulse of decaying noise, about three seconds long.
  verb = ctx.createConvolver();
  const len = Math.round(ctx.sampleRate * 3.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
  }
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  verb.connect(wet).connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
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
// Send a voice to the dry mix and, by `room`, to the reverb.
function out(node, room = 0.5) {
  node.connect(master);
  if (room > 0) { const g = ctx.createGain(); g.gain.value = room; node.connect(g).connect(verb); }
}
const limit = (name, ms) => { const now = performance.now(); if (now - (last[name] ?? 0) < ms) return false; last[name] = now; return true; };

// One sine partial with a quick attack and an exponential fade.
function partial(freq, t, { gain, decay, attack = 0.003, glide = 0, room, type = 'sine', pan = 0 }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + Math.min(decay, 0.3));
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  let node = osc.connect(env);
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  out(node, room);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}
// Filtered noise: the strike of a glass, a breath of air.
function air(t, { gain, decay, freq, q = 1, sweep = 0, attack = 0.002, room = 0.4 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass'; band.Q.value = q;
  band.frequency.setValueAtTime(freq, t);
  if (sweep) band.frequency.exponentialRampToValueAtTime(freq * sweep, t + attack + decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  out(src.connect(band).connect(env), room);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + decay + 0.05);
}

// Struck glass: inharmonic partials, the high ones fading first, and a tiny strike of noise.
const GLASS = [[1, 1, 1], [2.32, 0.42, 0.62], [4.25, 0.2, 0.36], [6.63, 0.09, 0.2]];
function glass(freq, { at = 0, gain = 0.08, decay = 1.1, room = 0.55, strike = 0.3, pan = (Math.random() - 0.5) * 0.5 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  for (const [ratio, g, d] of GLASS) if (freq * ratio < 16000) partial(freq * ratio, t, { gain: gain * g, decay: decay * d, room, pan });
  if (strike) air(t, { gain: gain * strike, decay: 0.018, freq: Math.min(9000, freq * 3), q: 2, room: 0.1 });
}
// A drop of water: a short sine that glides up.
function droplet(freq, { at = 0, gain = 0.09, room = 0.5 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  partial(freq, t, { gain, decay: 0.12, attack: 0.002, glide: 2.4, room });
  partial(freq * 2.01, t + 0.01, { gain: gain * 0.25, decay: 0.07, glide: 2.2, room });
}
// Deep air: a low sine that settles, felt more than heard.
function deep(freq, { at = 0, gain = 0.1, decay = 0.6, room = 0.3 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  partial(freq, t, { gain, decay, attack: 0.01, glide: 0.82, room });
}
// A swell: a soft chord that opens through a filter and fades, like a distant star brightening.
function swell(freqs, { at = 0, gain = 0.035, rise = 0.5, fade = 2.2, room = 0.8 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(300, t);
  filter.frequency.exponentialRampToValueAtTime(2600, t + rise);
  filter.frequency.exponentialRampToValueAtTime(600, t + rise + fade);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + rise);
  env.gain.exponentialRampToValueAtTime(0.0001, t + rise + fade);
  filter.connect(env);
  out(env, room);
  for (const f of freqs) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
      o.connect(filter); o.start(t); o.stop(t + rise + fade + 0.1);
    }
  }
}

// The pentatonic scale, from A: any sequence of these sounds pleasant.
const PENTA = [0, 3, 5, 7, 10];
const note = (step, base = 440) => base * 2 ** ((PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

export const sfx = {
  get on() { return enabled; },
  enable(on) { enabled = !!on; if (enabled) audio(); },
  setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = GAIN * volume; },
  // The context for music the person starts on purpose (the radio), whether or not interface sounds are on.
  raw() { const a = audio(true); return a ? { ctx: a, out: master, verb } : null; },

  // The pointer arriving on a card, a window or a table: a faint glass note, never twice in a row too fast.
  hover(kind = 'card') {
    if (!enabled || !limit('hover', 110)) return;
    if (kind === 'button') glass(note(pick([7, 8, 9, 10])), { gain: 0.022, decay: 0.5, strike: 0.15 });
    else glass(note(pick([3, 4, 5, 6, 7])), { gain: 0.026, decay: 0.9, strike: 0.1 });
  },
  // Pressing something: a tap on glass with a little depth under it.
  press() { if (!limit('press', 60)) return; glass(note(pick([5, 6, 7])), { gain: 0.05, decay: 0.45 }); deep(150, { gain: 0.05, decay: 0.25 }); },
  tick() { if (!limit('tick', 50)) return; glass(2637, { gain: 0.03, decay: 0.12, strike: 0.2, room: 0.3 }); },
  // Changing pages or opening a window: a soft swell, at most every second and a half.
  open() { if (!enabled || !limit('open', 1500)) return; swell([note(-5, 440), note(-3, 440), note(0, 440)], { gain: 0.022, rise: 0.35, fade: 1.6 }); },
  toggle(on) { const a = on ? [5, 7] : [7, 5]; glass(note(a[0]), { gain: 0.05, decay: 0.6 }); glass(note(a[1]), { at: 0.07, gain: 0.05, decay: 0.8 }); },

  // Two glass marbles meeting: bigger ones sound lower, harder hits a little louder.
  knock(radius = 30, speed = 300) {
    if (!limit('knock', 70)) return;
    const f = 1900 - Math.min(60, radius) * 16;
    glass(f, { gain: Math.min(0.06, 0.012 + speed / 26000), decay: 0.35, strike: 0.5, room: 0.35 });
  },
  pick() { glass(note(7), { gain: 0.045, decay: 0.5 }); glass(note(9), { at: 0.045, gain: 0.03, decay: 0.6 }); },
  drop() { glass(note(5), { gain: 0.04, decay: 0.7 }); deep(110, { gain: 0.05, decay: 0.4 }); },
  pop() { if (!limit('pop', 40)) return; droplet(420 + Math.random() * 260, { gain: 0.08 }); },
  boing(step = 0) { glass(note(step + 3), { gain: 0.05, decay: 0.9 }); },
  note(step = 0) { glass(note(step + 2), { gain: 0.06, decay: 1.3 }); },
  // A goal met: a rising glass arpeggio over a faint swell.
  chime() {
    [5, 7, 9, 12].forEach((s, i) => glass(note(s), { at: i * 0.075, gain: 0.05, decay: 1.4 }));
    swell([note(0, 220), note(2, 220)], { gain: 0.02, rise: 0.25, fade: 1.8 });
  },
  // Every goal met: the arpeggio climbs further and a deeper chord opens under it.
  fanfare() {
    [5, 7, 9, 10, 12, 14].forEach((s, i) => glass(note(s), { at: i * 0.085, gain: 0.05, decay: i === 5 ? 2.4 : 1.2 }));
    swell([note(-5, 440), note(-3, 440), note(0, 440), note(2, 440)], { gain: 0.03, rise: 0.5, fade: 2.6 });
    deep(98, { at: 0.05, gain: 0.08, decay: 1.2 });
  },
  // The focus timer reached zero: a singing bowl, two strikes.
  bell() {
    const a = audio();
    if (!a) return;
    for (const at of [0, 1.4]) {
      const t = a.currentTime + at;
      for (const [r, g, d] of [[1, 0.09, 5], [2.71, 0.04, 3.2], [5.15, 0.018, 1.8]]) {
        partial(196 * r, t, { gain: g, decay: d, attack: 0.006, room: 0.6 });
        partial(196 * r * 1.004, t, { gain: g * 0.7, decay: d, attack: 0.006, room: 0.6 });
      }
    }
  },

  /* ---------- for the easter eggs: originals, in the spirit of the games they wink at ---------- */
  // A portal opening: air pulled through a resonant sweep, with a ring that rises.
  portal() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    air(t, { gain: 0.09, decay: 0.7, freq: 260, q: 6, sweep: 9, attack: 0.05, room: 0.7 });
    partial(220, t + 0.04, { gain: 0.05, decay: 0.75, attack: 0.04, glide: 3.8, room: 0.7, type: 'triangle' });
    glass(note(9), { at: 0.55, gain: 0.04, decay: 1.4 });
  },
  // A lucky hit: a bright two-note ding and a shimmer.
  crit() {
    glass(note(12), { gain: 0.07, decay: 0.9, strike: 0.6 });
    glass(note(15), { at: 0.06, gain: 0.07, decay: 1.3, strike: 0.6 });
    const a = audio();
    if (a) air(a.currentTime + 0.05, { gain: 0.03, decay: 0.5, freq: 7000, q: 0.8, room: 0.6 });
  },
  // A secret found: a slow, low swell with a high glass answer.
  secret() {
    swell([note(-10, 440), note(-7, 440), note(-5, 440)], { gain: 0.04, rise: 0.8, fade: 2.8 });
    [12, 14, 17].forEach((s, i) => glass(note(s), { at: 0.6 + i * 0.12, gain: 0.035, decay: 1.6 }));
  },
};
