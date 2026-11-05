// Sounds, synthesized on the spot with the Web Audio API (no audio files): soft knocks when objects collide, a pop
// for bubbles, a chime when a goal is met. Silent until the person turns sounds on; the audio context starts on the
// first gesture after that, as browsers require.

let ctx = null;
let master = null;
let noise = null;
let enabled = false;
let volume = 0.7;
let lastKnock = 0;

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.32 * volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// One voice: an oscillator with a quick attack and an exponential decay, optionally gliding in pitch.
function tone(freq, { type = 'sine', at = 0, attack = 0.004, decay = 0.25, gain = 0.5, glide = 0, detune = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + decay);
  osc.detune.value = detune;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}
function hiss({ at = 0, decay = 0.06, gain = 0.25, freq = 2400, q = 1.2 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const src = a.createBufferSource();
  src.buffer = noise;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  const env = a.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(band).connect(env).connect(master);
  src.start(t);
  src.stop(t + decay + 0.02);
}

// A pentatonic scale, so that any sequence of notes sounds pleasant.
const PENTA = [0, 2, 4, 7, 9];
const note = (step, base = 523.25) => base * 2 ** ((PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);

export const sfx = {
  get on() { return enabled; },
  enable(on) { enabled = !!on; if (enabled) audio(); },
  setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = 0.32 * volume; },
  // Two objects meeting: bigger objects sound lower, harder hits sound louder.
  knock(radius = 30, speed = 300) {
    const now = performance.now();
    if (now - lastKnock < 45) return;
    lastKnock = now;
    const g = Math.min(0.5, 0.05 + speed / 3200);
    const f = 900 - Math.min(60, radius) * 9;
    tone(f, { type: 'triangle', decay: 0.09, gain: g, glide: 0.6 });
    hiss({ decay: 0.03, gain: g * 0.5, freq: f * 3 });
  },
  pick() { tone(660, { type: 'sine', decay: 0.07, gain: 0.18, glide: 1.4 }); },
  drop() { tone(520, { type: 'sine', decay: 0.1, gain: 0.16, glide: 0.7 }); },
  pop() {
    tone(380 + Math.random() * 160, { type: 'sine', decay: 0.07, gain: 0.35, glide: 3.2 });
    hiss({ decay: 0.04, gain: 0.3, freq: 3600, q: 0.8 });
  },
  tick() { tone(1400, { type: 'square', decay: 0.025, gain: 0.05 }); },
  boing(step = 0) { tone(note(step, 196), { type: 'sine', decay: 0.28, gain: 0.3, glide: 1.9, attack: 0.008 }); },
  note(step = 0) { tone(note(step), { type: 'triangle', decay: 0.4, gain: 0.26 }); tone(note(step) * 2, { type: 'sine', decay: 0.25, gain: 0.08 }); },
  // A goal met: a rising arpeggio with a soft bell on top.
  chime() {
    [0, 2, 4].forEach((s, i) => { tone(note(s + 5), { type: 'triangle', at: i * 0.07, decay: 0.5, gain: 0.22 }); tone(note(s + 10), { type: 'sine', at: i * 0.07, decay: 0.35, gain: 0.07 }); });
  },
  // Every goal met.
  fanfare() {
    [0, 2, 4, 5, 7].forEach((s, i) => tone(note(s + 5), { type: 'triangle', at: i * 0.09, decay: i === 4 ? 0.9 : 0.3, gain: 0.24 }));
    hiss({ at: 0.36, decay: 0.5, gain: 0.08, freq: 6000, q: 0.5 });
  },
  // The focus timer reached zero.
  bell() { [0, 0.18].forEach((at) => { tone(880, { type: 'sine', at, decay: 1.2, gain: 0.3 }); tone(1320, { type: 'sine', at, decay: 0.8, gain: 0.1 }); }); },
};
