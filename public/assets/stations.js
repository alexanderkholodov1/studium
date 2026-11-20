// The radio's stations. Some are original music generated live, as it plays (nothing is recorded or copied); others
// play an official upload through YouTube's own embedded player, from the channel of whoever owns it, with its credit
// (Studium hosts no one else's music). Each station opens with a secret (eggs.js).

// Where each station sits on the dial (88 to 108), what opens it, and what it plays.
export const STATIONS = [
  { id: 'bossa', freq: 88.5, name: 'Studium FM · bossa para estudiar', opens: 'radio' },
  { id: 'lofi', freq: 92.3, name: 'Lluvia y lo-fi', opens: 'cafe' },
  { id: 'chip', freq: 95.7, name: '8 bits', opens: 'crit' },
  { id: 'andina', freq: 98.9, name: 'Andina · quena y charango', opens: 'all' },
  { id: 'portal', freq: 101.3, name: 'Radio de Portal', opens: 'portal', video: 'SEJWpoiSzns',
    credit: '«Still Alive (Radio Mix)», del soundtrack de Portal (Aperture Science Psychoacoustic Laboratories; Valve). Se reproduce desde su canal oficial en YouTube.' },
  { id: 'tf2', freq: 104.1, name: 'Meet the Team', opens: 'medic', video: '36lSzUMBJnc',
    credit: '«Meet the Medic», de Team Fortress 2 (Valve). Se reproduce desde el canal oficial de Team Fortress en YouTube.' },
  { id: 'fono', freq: 107.5, name: 'El fonógrafo', opens: 'starve', video: 'aZD0PdUGP0A',
    credit: '«Ragtime», de Vince de Vera y Jason Garner, del soundtrack de Don’t Starve (Klei Entertainment). Se reproduce desde su canal oficial en YouTube.' },
];
export const stationOf = (id) => STATIONS.find((s) => s.id === id) ?? STATIONS[0];
export const embedURL = (s) => `https://www.youtube-nocookie.com/embed/${s.video}?autoplay=1&loop=1&playlist=${s.video}&enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}`;

/* ---------- the instruments ---------- */
const hz = (n) => 440 * 2 ** ((n - 69) / 12); // a MIDI note to its frequency

function voice(a, freq, t, { type = 'triangle', gain = 0.05, decay = 0.6, cutoff = 2400, dest, vibrato = 0, attack = 0.004 }) {
  const o = a.createOscillator(); const f = a.createBiquadFilter(); const g = a.createGain();
  o.type = type; o.frequency.value = freq;
  if (vibrato) { const l = a.createOscillator(); const lg = a.createGain(); l.frequency.value = 5.2; lg.gain.value = freq * vibrato; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + decay + 0.1); }
  f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff / 4), t + decay * 0.6);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + decay + 0.05);
}
function hit(a, t, { freq, q, gain, decay, dest, noise }) {
  const s = a.createBufferSource(); s.buffer = noise;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + decay + 0.02);
}
function kick(a, t, dest, gain = 0.22) {
  const o = a.createOscillator(); const g = a.createGain();
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(dest); o.start(t); o.stop(t + 0.32);
}
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

/* ---------- the generators: each plays one sixteenth (s, 0 to 15) of bar «bar» at time t ---------- */
// Bossa nova: plucked chords on a ii–V–I–VI, bass on the root and the fifth, a brushed shaker, a rim click on the
// clave and a vibraphone that improvises on the pentatonic.
const BOSSA = [
  { bass: [73.42, 110], notes: [174.61, 220, 261.63, 329.63] }, // Dm9
  { bass: [98, 146.83], notes: [174.61, 246.94, 329.63, 440] }, // G13
  { bass: [65.41, 98], notes: [164.81, 196, 246.94, 293.66] }, // Cmaj9
  { bass: [110, 164.81], notes: [196, 277.18, 349.23, 392] }, // A7(b13)
];
const VIBES = [293.66, 349.23, 392, 440, 523.25, 587.33, 698.46, 783.99];
// Lo-fi: warm electric piano on a slow i–iv–VII–III, a dusty kick and snare, lazy hats, rain and vinyl crackle.
const LOFI = [[57, 60, 64, 67, 71], [50, 57, 60, 65, 69], [55, 59, 62, 65, 69], [48, 55, 59, 64, 67]];
// 8 bits: square-wave arpeggios on I–V–vi–IV, a pulse bass, noise drums and a melody that answers itself.
const CHIP = [[60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]];
const CHIP_SCALE = [72, 74, 76, 79, 81, 84, 86, 88];
// Andina: charango strums in a huayno pattern on Am–C–G–Am, a bombo on the beat, and a quena on the minor pentatonic.
const ANDES = [[57, 64, 69, 72, 76], [60, 64, 67, 72, 76], [55, 62, 67, 71, 74], [57, 64, 69, 72, 76]];
const QUENA = [69, 72, 74, 76, 79, 81, 84];

export const GENERATORS = {
  bossa: {
    bpm: 124,
    play(k, t, s, bar) {
      const { a, dest, noise } = k; const chord = BOSSA[bar % 4];
      if (s === 0 || s === 8) voice(a, chord.bass[s === 0 ? 0 : 1], t, { type: 'sine', gain: 0.16, decay: 0.7, cutoff: 600, dest });
      if (s === 7 && Math.random() < 0.5) voice(a, chord.bass[1], t, { type: 'sine', gain: 0.1, decay: 0.3, cutoff: 600, dest });
      if ([0, 3, 6, 10, 12].includes(s)) chord.notes.forEach((f, i) => voice(a, f, t + i * 0.012, { gain: 0.032, decay: 0.55, cutoff: 2600, dest }));
      hit(a, t, { freq: 7000, q: 0.8, gain: s % 4 === 2 ? 0.02 : 0.009, decay: 0.05, dest, noise });
      if ([0, 6, 12].includes(s) || (bar % 2 && [4, 10].includes(s))) hit(a, t, { freq: 1900, q: 6, gain: 0.05, decay: 0.03, dest, noise });
      if (s % 2 === 0 && Math.random() < 0.22) {
        const f = pick(VIBES);
        for (const [r, g, d] of [[1, 0.03, 1.1], [3.98, 0.008, 0.4]]) voice(a, f * r, t, { type: 'sine', gain: g, decay: d, cutoff: 6000, dest });
      }
    },
  },
  lofi: {
    bpm: 74,
    start(k) {
      // Rain: filtered noise, always on, and a drop now and then; vinyl crackle on top.
      const { a, dest, noise } = k;
      const s = a.createBufferSource(); s.buffer = noise; s.loop = true;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      const g = a.createGain(); g.gain.value = 0.05;
      s.connect(f).connect(g).connect(dest); s.start();
      return () => { try { s.stop(); } catch { /* already stopped */ } };
    },
    play(k, t, s, bar) {
      const { a, dest, noise } = k; const chord = LOFI[bar % 4];
      const swing = s % 2 ? 0.045 : 0;
      if (s === 0) chord.forEach((n, i) => voice(a, hz(n), t + i * 0.02, { type: 'sine', gain: 0.03, decay: 2.4, cutoff: 1400, dest, vibrato: 0.003, attack: 0.02 }));
      if (s === 10 && Math.random() < 0.6) chord.slice(1, 4).forEach((n, i) => voice(a, hz(n), t + swing + i * 0.03, { type: 'sine', gain: 0.022, decay: 1.2, cutoff: 1200, dest }));
      if (s === 0 || s === 7 || (s === 10 && bar % 2)) kick(a, t + swing, dest, 0.16);
      if (s === 4 || s === 12) hit(a, t, { freq: 1800, q: 0.7, gain: 0.05, decay: 0.16, dest, noise });
      if (s % 2 === 0) hit(a, t + swing, { freq: 8000, q: 1, gain: 0.008, decay: 0.04, dest, noise });
      if (s === 0 || s === 8) voice(a, hz(chord[0] - 12), t, { type: 'sine', gain: 0.12, decay: 0.9, cutoff: 400, dest });
      if (Math.random() < 0.15) hit(a, t + Math.random() * 0.1, { freq: 3000 + Math.random() * 2000, q: 8, gain: 0.012, decay: 0.02, dest, noise }); // a drop
      if (Math.random() < 0.3) hit(a, t + Math.random() * 0.1, { freq: 5000, q: 0.4, gain: 0.004, decay: 0.008, dest, noise }); // crackle
    },
  },
  chip: {
    bpm: 140,
    play(k, t, s, bar) {
      const { a, dest, noise } = k; const chord = CHIP[bar % 4];
      voice(a, hz(chord[s % 4] + 12), t, { type: 'square', gain: 0.016, decay: 0.09, cutoff: 5000, dest });
      if (s % 4 === 0) voice(a, hz(chord[0] - 24), t, { type: 'square', gain: 0.04, decay: 0.2, cutoff: 900, dest });
      if (s % 4 === 2) voice(a, hz(chord[0] - 12), t, { type: 'square', gain: 0.03, decay: 0.12, cutoff: 900, dest });
      if (s === 0 || s === 8) hit(a, t, { freq: 200, q: 0.5, gain: 0.08, decay: 0.08, dest, noise });
      if (s === 4 || s === 12) hit(a, t, { freq: 2500, q: 0.5, gain: 0.05, decay: 0.07, dest, noise });
      if (s % 2 === 1) hit(a, t, { freq: 9000, q: 1, gain: 0.01, decay: 0.02, dest, noise });
      // The melody: a phrase of two bars, played again a little changed.
      const phrase = k.phrase ??= Array.from({ length: 32 }, (_, i) => (i % 2 === 0 && Math.random() < 0.55 ? pick(CHIP_SCALE) : 0));
      const n = phrase[(bar % 2) * 16 + s];
      if (n) voice(a, hz(n), t, { type: 'square', gain: 0.022, decay: 0.16, cutoff: 6000, dest, vibrato: 0.004 });
      if (s === 15 && bar % 4 === 3) { const i = Math.floor(Math.random() * 32); phrase[i] = i % 2 === 0 ? pick(CHIP_SCALE) : 0; }
    },
  },
  andina: {
    bpm: 100,
    play(k, t, s, bar) {
      const { a, dest, noise } = k; const chord = ANDES[bar % 4];
      // Huayno: a long strum, two short ones.
      if ([0, 3, 4, 8, 11, 12].includes(s)) {
        const up = s % 4 !== 0;
        (up ? [...chord].reverse() : chord).forEach((n, i) => voice(a, hz(n + 12), t + i * 0.009, { type: 'triangle', gain: up ? 0.014 : 0.022, decay: up ? 0.18 : 0.35, cutoff: 4200, dest }));
      }
      if (s === 0 || s === 8) kick(a, t, dest, 0.2);
      if (s === 6 || s === 14) hit(a, t, { freq: 900, q: 1.2, gain: 0.04, decay: 0.08, dest, noise });
      // The quena: long breathy notes, with vibrato, now and then.
      if (s % 4 === 0 && Math.random() < 0.45) {
        const n = pick(QUENA);
        voice(a, hz(n), t, { type: 'sine', gain: 0.045, decay: s % 8 === 0 ? 1.1 : 0.55, cutoff: 3000, dest, vibrato: 0.006, attack: 0.06 });
        hit(a, t, { freq: hz(n) * 2, q: 2, gain: 0.006, decay: 0.12, dest, noise });
      }
    },
  },
};
