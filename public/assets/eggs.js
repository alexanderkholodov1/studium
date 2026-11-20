// Easter eggs: small secrets that never get in the way. Everything here is original (the sounds, the drawings, the
// characters and the music); the winks are to games students love. Each secret does something on screen and leaves
// something on Inicio, in «Tus hallazgos» (space.js draws it with what this file exports). Found secrets are
// remembered in this browser.
//   · type «radio» (or the old cheat code ↑ ↑ ↓ ↓ ← → ← → B A): an old radio that plays bossa for studying; it can stay
//     on Inicio or go with you to every tab;
//   · press the red dot of «studium» three times: two portals, which then stay on Inicio;
//   · type «torta» or «cake»: a cake falls on the screen, and stays on Inicio with its candle;
//   · type «medico» or «medic»: someone jumps on screen and shouts, with the pulse; a heart monitor stays on Inicio;
//   · now and then, a goal checked off is a lucky hit; Inicio counts them with a trophy.
import { sfx } from './sfx.js';
import { t } from './i18n.js';
import { auth, countEgg } from './data.js';
import { flag } from './settings.js';

const FOUND = 'studium-eggs';
const RADIO = 'studium-radio';
const CRITS = 'studium-crits';
// Every easter egg, as the admin panel lists them. The ids are the ones the rules accept for the counters (eggs/{id}).
export const EGGS = [
  { id: 'radio', name: 'La radio', how: 'Escribir «radio» en cualquier página, fuera de un campo de texto, o el código ↑ ↑ ↓ ↓ ← → ← → B A.',
    what: 'Una radio antigua, en 3D, con bossa generada en vivo. Se puede dejar en Inicio o llevar a todas las pestañas.' },
  { id: 'portal', name: 'Portales', how: 'Pulsar tres veces seguidas el punto rojo de «studium» en la portada.',
    what: 'Un portal azul y uno rojo, y una canica de vidrio que entra por uno y sale por el otro. Los portales se quedan en Inicio.' },
  { id: 'cake', name: 'La torta', how: 'Escribir «torta» o «cake».', what: 'Cae una torta con su vela en la pantalla, y se queda en Inicio: se sopla y se vuelve a encender.' },
  { id: 'medic', name: '¡Médico!', how: 'Escribir «medico» o «medic».', what: 'Alguien salta en la pantalla y grita «¡Médico!», con el pulso. En Inicio queda un monitor de ritmo cardíaco.' },
  { id: 'crit', name: 'Golpe crítico', how: 'Marcar una meta como cumplida: una de cada diez veces.', what: '«¡CRÍTICO!» en verde y una celebración doble; en Inicio, un trofeo los cuenta.' },
];
const ALL = EGGS.map((e) => e.id);
let toast = () => {};
let onFound = () => {};
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.ambience === 'enfoque';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };
export const found = () => new Set(read(FOUND, []));
export const critCount = () => Number(read(CRITS, 0)) || 0;
export const eggCount = () => ALL.length;

function discover(id, message) {
  const s = found();
  const fresh = !s.has(id);
  if (fresh) {
    s.add(id); write(FOUND, [...s]); sfx.secret();
    // Counted once per browser, anonymously, for the admin panel.
    if (auth.currentUser) countEgg(id).catch(() => {});
  }
  toast(fresh ? `${t(message)} · ${t('Secreto')} ${s.size}/${ALL.length} · ${t('Ahora está en tu Inicio')}` : t(message));
  onFound(id, fresh);
}
const layer = (cls, html = '') => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; el.setAttribute('aria-hidden', 'true'); document.body.append(el); return el; };

/* ---------- the drawings (original) ---------- */
// A two-tier cake with one candle; lit or not.
export const cakeSVG = (lit = true) => `<svg class="cake-svg" viewBox="0 0 120 120" aria-hidden="true">
  <ellipse cx="60" cy="108" rx="50" ry="7" fill="rgba(0,0,0,.18)"/>
  <rect x="14" y="66" width="92" height="38" rx="9" fill="#7a4a2b"/><rect x="14" y="66" width="92" height="12" rx="6" fill="#f6efe6"/>
  <path d="M14 76c8 8 14-2 22 4s14-4 22 2 14-4 22 2 14-4 26 0v-8H14Z" fill="#f6efe6"/>
  <rect x="28" y="40" width="64" height="30" rx="8" fill="#8c5634"/><rect x="28" y="40" width="64" height="10" rx="5" fill="#ffd6e2"/>
  <path d="M28 48c6 6 11-2 16 3s11-3 16 1 11-3 16 1 10-3 16-1v-6H28Z" fill="#ffd6e2"/>
  ${[22, 40, 58, 76, 94].map((x) => `<circle cx="${x + 2}" cy="${x % 2 ? 90 : 94}" r="2.4" fill="#ff4f6d"/>`).join('')}
  <circle cx="60" cy="40" r="5" fill="#d7263d"/><path d="M60 35c2-6 6-8 9-8" stroke="#3a7d44" stroke-width="2" fill="none"/>
  <rect x="57" y="16" width="6" height="20" rx="2" fill="#7cc4ff"/><path d="M57 21l6-3M57 27l6-3M57 33l6-3" stroke="#fff" stroke-width="1.6"/>
  <g class="flame" ${lit ? '' : 'opacity="0"'}><ellipse cx="60" cy="10" rx="4.5" ry="7.5" fill="#ffb627"/><ellipse cx="60" cy="11.5" rx="2.2" ry="4" fill="#fff4c2"/></g>
</svg>`;
// Someone in a white coat with a stethoscope and a green heart, arms up. Original, not any game's character.
const medicSVG = `<svg viewBox="0 0 120 160" aria-hidden="true">
  <path d="M36 66 14 22M84 66l22-44" stroke="#f3d2b5" stroke-width="12" stroke-linecap="round"/><path d="M36 66 26 46M84 66l10-20" stroke="#fbfbfb" stroke-width="16" stroke-linecap="round"/>
  <path d="M30 60c0-14 13-22 30-22s30 8 30 22v62H30Z" fill="#fbfbfb" stroke="#d8dde6" stroke-width="2"/>
  <path d="M52 40l8 18 8-18" fill="#5aa9ff"/><path d="M42 64c0 18 10 26 18 26s18-8 18-26" stroke="#3b4251" stroke-width="3" fill="none"/>
  <circle cx="60" cy="92" r="5" fill="#3b4251"/>
  <path d="M74 74c4-5 11-2 9 4-1 4-9 9-9 9s-8-5-9-9c-2-6 5-9 9-4Z" fill="#2ecc71"/>
  <rect x="36" y="118" width="18" height="34" rx="6" fill="#3b4251"/><rect x="66" y="118" width="18" height="34" rx="6" fill="#3b4251"/>
  <circle cx="60" cy="26" r="20" fill="#f3d2b5"/><path d="M40 24c2-14 12-20 20-20s18 6 20 20c-6-6-14-8-20-8s-14 2-20 8Z" fill="#5b3b28"/>
  <circle cx="52" cy="27" r="2.6" fill="#222"/><circle cx="68" cy="27" r="2.6" fill="#222"/>
  <ellipse cx="60" cy="37" rx="7" ry="5.5" fill="#7a2230"/>
</svg>`;

/* ---------- words and codes ---------- */
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let typed = '';
let keys = [];
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || !flag('eggs')) return;
  const el = e.target;
  if (el instanceof Element && el.closest('input, textarea, select, [contenteditable="true"]')) return;
  keys = [...keys, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-KONAMI.length);
  if (keys.join() === KONAMI.join()) { keys = []; openRadio(true); return; }
  if (e.key.length !== 1) return;
  typed = (typed + e.key.toLowerCase()).slice(-12);
  if (typed.endsWith('radio')) { typed = ''; openRadio(true); }
  else if (typed.endsWith('torta') || typed.endsWith('cake')) { typed = ''; cakeFalls(); discover('cake', 'La torta es una mentira. Esta no: es tuya.'); }
  else if (typed.endsWith('medico') || typed.endsWith('medic')) { typed = ''; medic(); discover('medic', '¡Médico! +25 de ánimo para seguir estudiando.'); }
}

/* ---------- the cake ---------- */
function cakeFalls() {
  if (still()) return;
  const el = layer('egg-cake-drop', cakeSVG(true));
  sfx.pop();
  setTimeout(() => { sfx.impact(80, 500); confetti(innerWidth / 2, innerHeight * 0.55); }, 820);
  setTimeout(() => el.classList.add('away'), 2600);
  setTimeout(() => el.remove(), 3300);
}
function confetti(x, y, n = 40) {
  const colors = ['#ff4f6d', '#ffd23f', '#2ee59d', '#3d7bff', '#ff8a3d', '#c77dff'];
  for (let i = 0; i < n; i += 1) {
    const p = layer('egg-confetti');
    p.style.left = `${x}px`; p.style.top = `${y}px`; p.style.background = colors[i % colors.length];
    const a = Math.random() * Math.PI * 2; const v = 120 + Math.random() * 260;
    p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px, ${Math.sin(a) * v - 140 + 380}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
      { duration: 1400 + Math.random() * 700, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' }).onfinish = () => p.remove();
  }
}

/* ---------- ¡Médico! ---------- */
// Someone jumps up from the bottom of the screen and shouts, a pulse line crosses the screen with its beeps, and +25.
function shout(text) {
  // The browser's own voice, on this device: nothing is sent anywhere. Only with the page's sound on.
  try {
    if (!sfx.on || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES'; u.rate = 1.15; u.pitch = 1.35; u.volume = 0.9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* no voice here */ }
}
function medic() {
  if (still()) { heal(); return; }
  const who = layer('egg-medic', `${medicSVG}<b class="bubble">${t('¡MÉDICO!')}</b>`);
  setTimeout(() => shout(t('¡Médico!')), 380);
  const line = layer('egg-pulse', '<svg viewBox="0 0 1200 160" preserveAspectRatio="none"><path d="M0 80H380l30-10 20 10h40l18-66 26 132 22-90 14 24h50l26-14 24 14H1200"/></svg>');
  [520, 1240, 1960].forEach((ms) => setTimeout(() => sfx.beep(), ms));
  setTimeout(() => { sfx.heartbeat(); heal(); }, 900);
  setTimeout(() => { who.classList.add('away'); line.classList.add('away'); }, 2600);
  setTimeout(() => { who.remove(); line.remove(); }, 3200);
}
function heal() {
  if (still()) return;
  sfx.chime();
  const el = layer('egg-heal', '<span>+25</span>');
  setTimeout(() => el.remove(), 1800);
}

/* ---------- a lucky hit ---------- */
// Called when a goal is checked off. About one in ten is a lucky hit.
export function luckyHit(x, y) {
  if (Math.random() > 0.1 || still() || !flag('eggs')) return false;
  sfx.crit();
  write(CRITS, critCount() + 1);
  const el = layer('egg-crit');
  el.textContent = t('¡CRÍTICO!');
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  setTimeout(() => el.remove(), 1500);
  discover('crit', 'Golpe crítico: esa meta valió doble.');
  return true;
}

/* ---------- portals ---------- */
let dotClicks = [];
function onDot(e) {
  if (!flag('eggs')) return;
  const now = performance.now();
  dotClicks = [...dotClicks.filter((t0) => now - t0 < 1600), now];
  if (dotClicks.length < 3) return;
  dotClicks = [];
  const r = e.target.getBoundingClientRect();
  portals(r.left + r.width / 2, r.top + r.height / 2);
}
function ring(x, y, kind) {
  const el = layer(`egg-portal ${kind}`);
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  return el;
}
function portals(x, y) {
  discover('portal', 'Ahora piensas con portales.');
  if (still()) return;
  sfx.portal();
  const ox = innerWidth - Math.max(120, Math.min(innerWidth - 120, x)); const oy = Math.min(innerHeight - 140, y + 220);
  const a = ring(x, y + 60, 'blue');
  const b = ring(ox, oy, 'red');
  // A glass marble falls into the blue one and comes out of the red one.
  const ball = layer('egg-ball');
  const fall = ball.animate([{ transform: `translate(${x}px, ${y - 40}px) scale(1)` }, { transform: `translate(${x}px, ${y + 60}px) scale(.3)`, opacity: 0.2 }], { duration: 700, delay: 500, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' });
  fall.onfinish = () => {
    const out = ball.animate([
      { transform: `translate(${ox}px, ${oy}px) scale(.3)`, opacity: 0.2 },
      { transform: `translate(${ox + (ox > innerWidth / 2 ? -140 : 140)}px, ${oy - 120}px) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${ox + (ox > innerWidth / 2 ? -260 : 260)}px, ${innerHeight + 60}px) scale(1)`, opacity: 1 },
    ], { duration: 1500, easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'both' });
    out.onfinish = () => ball.remove();
  };
  setTimeout(() => { a.classList.add('closing'); b.classList.add('closing'); }, 2400);
  setTimeout(() => { a.remove(); b.remove(); }, 3100);
}

/* ---------- what each find does on Inicio («Tus hallazgos», drawn by space.js) ---------- */
// el: the trinket pressed. The cake's candle is blown out and lit again; the monitor beats; a marble crosses the
// portals; the trophy shines.
export function poke(id, el) {
  if (!el) return;
  if (id === 'cake') {
    const flame = el.querySelector('.flame');
    const lit = flame && flame.getAttribute('opacity') !== '0';
    if (lit) { sfx.blow(); flame.setAttribute('opacity', '0'); } else { sfx.tick(); flame?.setAttribute('opacity', '1'); const r = el.getBoundingClientRect(); if (!still()) confetti(r.left + r.width / 2, r.top + 10, 18); }
    el.setAttribute('aria-pressed', String(lit));
  } else if (id === 'medic') {
    sfx.heartbeat(); setTimeout(() => sfx.beep(), 260);
    el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat');
  } else if (id === 'portal') {
    sfx.portal();
    el.classList.remove('through'); void el.offsetWidth; el.classList.add('through');
  } else if (id === 'crit') {
    sfx.crit();
    el.classList.remove('shine'); void el.offsetWidth; el.classList.add('shine');
  }
}

/* ---------- the radio ---------- */
// Original bossa nova, generated as it plays: nylon-like plucked chords on a ii–V–I–VI, a soft bass on the root and
// the fifth, a brushed shaker and a rim click, a vibraphone that improvises on the pentatonic, all through a small
// radio speaker. Nothing is recorded or copied.
const BAR = 16;
const CHORDS = [
  { bass: [73.42, 110], notes: [174.61, 220, 261.63, 329.63] }, // Dm9
  { bass: [98, 146.83], notes: [174.61, 246.94, 329.63, 440] }, // G13
  { bass: [65.41, 98], notes: [164.81, 196, 246.94, 293.66] }, // Cmaj9
  { bass: [110, 164.81], notes: [196, 277.18, 349.23, 392] }, // A7(b13)
];
const COMP = [0, 3, 6, 10, 12];
const CLAVE = [0, 6, 12, 20, 26]; // a bossa clave over two bars of sixteenths
const SCALE = [293.66, 349.23, 392, 440, 523.25, 587.33, 698.46, 783.99];
const radio = { audio: null, out: null, playing: false, step: 0, next: 0, timer: 0, gain: 0.6 };

function voice(a, freq, t, { type = 'triangle', gain = 0.05, decay = 0.6, cutoff = 2400, dest }) {
  const o = a.createOscillator(); const f = a.createBiquadFilter(); const g = a.createGain();
  o.type = type; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff / 4), t + decay * 0.6);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + decay + 0.05);
}
function hit(a, t, { freq, q, gain, decay, dest, noise }) {
  const s = a.createBufferSource(); s.buffer = noise;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + decay + 0.02);
}
function schedule() {
  const { ctx: a } = radio.audio;
  const dur = 60 / 124 / 4;
  while (radio.next < a.currentTime + 0.15) {
    const t0 = radio.next; const s = radio.step % BAR; const bar = Math.floor(radio.step / BAR) % CHORDS.length;
    const chord = CHORDS[bar]; const dest = radio.out; const noise = radio.noise;
    const swing = s % 2 ? dur * 0.12 : 0;
    const t = t0 + swing;
    if (s === 0 || s === 8) voice(a, chord.bass[s === 0 ? 0 : 1], t, { type: 'sine', gain: 0.16, decay: 0.7, cutoff: 600, dest });
    if (s === 7 && Math.random() < 0.5) voice(a, chord.bass[1], t, { type: 'sine', gain: 0.1, decay: 0.3, cutoff: 600, dest });
    if (COMP.includes(s)) chord.notes.forEach((f, i) => voice(a, f, t + i * 0.012, { gain: 0.032, decay: 0.55, cutoff: 2600, dest }));
    hit(a, t, { freq: 7000, q: 0.8, gain: s % 4 === 2 ? 0.02 : 0.009, decay: 0.05, dest, noise });
    if (CLAVE.includes(radio.step % (BAR * 2))) hit(a, t, { freq: 1900, q: 6, gain: 0.05, decay: 0.03, dest, noise });
    if (s % 2 === 0 && Math.random() < 0.22) {
      const f = SCALE[Math.floor(Math.random() * SCALE.length)];
      for (const [r, g, d] of [[1, 0.03, 1.1], [3.98, 0.008, 0.4]]) voice(a, f * r, t, { type: 'sine', gain: g, decay: d, cutoff: 6000, dest });
    }
    if (Math.random() < 0.03) hit(a, t, { freq: 3000, q: 0.5, gain: 0.006, decay: 0.01, dest, noise });
    radio.next += dur; radio.step += 1;
  }
}
function startMusic() {
  const raw = sfx.raw();
  if (!raw) return false;
  const a = raw.ctx;
  if (!radio.out) {
    radio.audio = raw;
    // The speaker of a small radio: no deep bass, no shine, a little room.
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const g = a.createGain(); g.gain.value = radio.gain;
    const room = a.createGain(); room.gain.value = 0.18;
    hp.connect(lp).connect(g).connect(raw.out);
    lp.connect(room).connect(raw.verb);
    radio.out = hp; radio.level = g;
    radio.noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = radio.noise.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  radio.playing = true;
  radio.next = a.currentTime + 0.08;
  radio.timer = setInterval(schedule, 30);
  return true;
}
function stopMusic() { radio.playing = false; clearInterval(radio.timer); }


/* ---------- the radio, on screen: an old radio that is a box in 3D ---------- */
// It goes with you to every tab (floating, wherever you drop it), or it stays on Inicio, in «Tus hallazgos». Either
// way the music goes on while you move around the page.
function radioEl() { return document.getElementById('egg-radio'); }
function place(el, pos) {
  const w = el.offsetWidth || 300; const h = el.offsetHeight || 210;
  const x = Math.max(8, Math.min(innerWidth - w - 8, pos.x)); const y = Math.max(8, Math.min(innerHeight - h - 8, pos.y));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  return { x, y };
}
export function radioOn() { return !!read(RADIO, {}).on; }
export const radioDocked = () => radioOn() && !!read(RADIO, {}).dock;
const knob = (v) => `rotate(${Math.round(v * 270 - 135)}deg)`;

function radioHTML() {
  return `<div class="rstage"><div class="box">
      <div class="face front">
        <span class="cloth" aria-hidden="true"></span>
        <div class="panel">
          <div class="dial" aria-hidden="true"><span class="scale"><i>88</i><i>98</i><i>108</i></span><i class="needle"></i><i class="lamp"></i></div>
          <span class="name">${t('Studium FM · bossa para estudiar')}</span>
          <div class="knobs">
            <button class="knob rplay" type="button" data-radio-play aria-label="${t('Reproducir')}"><svg viewBox="0 0 24 24"><path class="p" d="M9 6v12l9-6Z" fill="currentColor"/><path class="s" d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor"/></svg></button>
            <span class="knob vol" title="${t('Volumen')}"><i style="transform:${knob(radio.gain)}"></i><input type="range" min="0" max="1" step="0.05" value="${radio.gain}" data-radio-vol aria-label="${t('Volumen')}"></span>
          </div>
        </div>
      </div>
      <span class="face back"></span><span class="face right"></span><span class="face left"></span><span class="face top"><i class="handle"></i></span><span class="face bottom"></span>
    </div></div>
    <div class="radio-bar"><button class="link" type="button" data-radio-dock></button><button class="link" type="button" data-radio-close>${t('Apagar')}</button></div>`;
}
function syncDock(el) {
  const docked = !!read(RADIO, {}).dock;
  el.querySelector('[data-radio-dock]').textContent = t(docked ? 'Llevarla conmigo' : 'Dejarla en Inicio');
}
// Where the radio is now: inside its stand on Inicio when it is left there and the stand is drawn; floating otherwise.
// space.js calls it after drawing Inicio, and before, to take it out of what is about to be redrawn.
export function placeRadio(stand = document.querySelector('[data-radio-stand]')) {
  const el = radioEl();
  if (!el) return;
  const state = read(RADIO, {});
  if (state.dock && stand) {
    if (el.parentElement !== stand) stand.append(el);
    el.classList.add('docked'); el.classList.remove('waiting');
    el.style.left = ''; el.style.top = '';
  } else {
    if (el.parentElement !== document.body) document.body.append(el);
    el.classList.remove('docked');
    // Left on Inicio, but Inicio is not on screen: it waits, hidden, still playing.
    el.classList.toggle('waiting', !!state.dock);
    if (!state.dock) place(el, state.x != null ? state : { x: innerWidth - 400, y: innerHeight - 300 });
  }
  syncDock(el);
}
export function rescueRadio() { const el = radioEl(); if (el && el.parentElement !== document.body) document.body.append(el); }

export function openRadio(discovered = false) {
  if (!flag('radio')) return;
  if (discovered) discover('radio', 'Encontraste la radio. Llévala contigo o déjala en tu Inicio.');
  write(RADIO, { ...read(RADIO, {}), on: true });
  if (radioEl()) { placeRadio(); return; }
  const el = document.createElement('section');
  el.id = 'egg-radio';
  el.className = 'egg-radio';
  el.setAttribute('aria-label', t('Radio'));
  el.innerHTML = radioHTML();
  document.body.append(el);
  placeRadio();
  const play = el.querySelector('[data-radio-play]');
  play.addEventListener('click', () => {
    if (radio.playing) stopMusic(); else startMusic();
    el.classList.toggle('playing', radio.playing);
    play.setAttribute('aria-label', t(radio.playing ? 'Pausar' : 'Reproducir'));
    sfx.tick();
  });
  const vol = el.querySelector('[data-radio-vol]');
  const setVol = (v) => { radio.gain = Math.max(0, Math.min(1, v)); vol.value = radio.gain; if (radio.level) radio.level.gain.value = radio.gain; el.querySelector('.vol i').style.transform = knob(radio.gain); };
  vol.addEventListener('input', () => setVol(Number(vol.value)));
  el.querySelector('.vol').addEventListener('wheel', (e) => { e.preventDefault(); setVol(radio.gain + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
  el.querySelector('[data-radio-close]').addEventListener('click', () => closeRadio());
  el.querySelector('[data-radio-dock]').addEventListener('click', () => {
    const dock = !read(RADIO, {}).dock;
    write(RADIO, { ...read(RADIO, {}), dock });
    sfx.tick();
    placeRadio();
    toast(t(dock ? 'La radio se queda en tu Inicio, en «Tus hallazgos». Sigue sonando aunque cambies de pestaña.' : 'La radio va contigo a todas las pestañas.'));
    onFound('radio-dock', false);
  });
  // It turns a little toward the pointer, like a box on the table.
  const box = el.querySelector('.box');
  el.addEventListener('pointermove', (e) => {
    if (drag || still()) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5; const dy = (e.clientY - r.top) / r.height - 0.5;
    box.style.setProperty('--ry', `${-16 + dx * 22}deg`); box.style.setProperty('--rx', `${8 - dy * 12}deg`);
  });
  el.addEventListener('pointerleave', () => { box.style.removeProperty('--ry'); box.style.removeProperty('--rx'); });
  // Floating, it is dragged by its body and left wherever it is dropped; it swings with the speed.
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (el.classList.contains('docked') || e.target.closest('button, input, .radio-bar')) return;
    drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, x: e.clientX, t: performance.now() };
    el.setPointerCapture(e.pointerId); el.classList.add('held'); sfx.grab(160);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now(); const vx = ((e.clientX - drag.x) / Math.max(1, now - drag.t)) * 1000;
    sfx.drag(Math.abs(vx), vx); drag.x = e.clientX; drag.t = now;
    if (!still()) box.style.setProperty('--ry', `${-16 + Math.max(-30, Math.min(30, vx / 40))}deg`);
    place(el, { x: e.clientX - drag.dx, y: e.clientY - drag.dy });
  });
  const drop = () => { if (!drag) return; drag = null; el.classList.remove('held'); box.style.removeProperty('--ry'); write(RADIO, { ...read(RADIO, {}), x: el.offsetLeft, y: el.offsetTop }); sfx.release(0, 160); };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
}
export function closeRadio() {
  stopMusic();
  radioEl()?.remove();
  write(RADIO, { ...read(RADIO, {}), on: false });
  onFound('radio-off', false);
}

// options.toast: how to say things; options.onFound(id, fresh): a secret was found (or the radio moved), so Inicio
// can draw what it unlocked.
export function mountEggs(options) {
  toast = options.toast;
  onFound = options.onFound ?? onFound;
  addEventListener('keydown', onKey);
  // The dot answers on its own: pressing it does not throw its letter, so it can be pressed again.
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element && e.target.matches('.wordmark .i b'))) return;
    e.stopPropagation();
    e.target.animate([{ scale: 1 }, { scale: 1.35 }, { scale: 1 }], { duration: 260, easing: 'ease-out' });
    sfx.tick();
    onDot(e);
  }, true);
  addEventListener('resize', () => { const el = radioEl(); if (el && !el.classList.contains('docked')) place(el, { x: el.offsetLeft, y: el.offsetTop }); });
  if (radioOn()) openRadio();
}
