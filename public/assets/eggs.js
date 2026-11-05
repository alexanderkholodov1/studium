// Easter eggs: small secrets that never get in the way. Everything here is original (the sounds, the drawings and the
// music); the winks are to games students love. Found secrets are remembered in this browser.
//   · type «radio» (or the old cheat code ↑ ↑ ↓ ↓ ← → ← → B A): a radio that plays bossa for studying, which stays on
//     screen wherever you drop it, and can also be added from «Personalizar» once found;
//   · press the red dot of «studium» three times: two portals;
//   · type «torta» or «cake»; type «medico» or «medic»;
//   · now and then, a goal checked off is a lucky hit.
import { sfx } from './sfx.js';
import { t } from './i18n.js';
import { auth, countEgg } from './data.js';
import { flag } from './settings.js';

const FOUND = 'studium-eggs';
const RADIO = 'studium-radio';
// Every easter egg, as the admin panel lists them. The ids are the ones the rules accept for the counters (eggs/{id}).
export const EGGS = [
  { id: 'radio', name: 'La radio', how: 'Escribir «radio» en cualquier página, fuera de un campo de texto, o el código ↑ ↑ ↓ ↓ ← → ← → B A.',
    what: 'Una radio de bossa generada en vivo, que se queda donde la sueltes. Una vez encontrada, también se agrega desde «Personalizar».' },
  { id: 'portal', name: 'Portales', how: 'Pulsar tres veces seguidas el punto rojo de «studium» en la portada.',
    what: 'Un portal azul y uno rojo, y una canica de vidrio que entra por uno y sale por el otro.' },
  { id: 'cake', name: 'La torta', how: 'Escribir «torta» o «cake».', what: 'Un aviso: «La torta es una mentira. Las guías, no».' },
  { id: 'medic', name: '¡Médico!', how: 'Escribir «medico» o «medic».', what: 'Un pulso verde de +25 de ánimo.' },
  { id: 'crit', name: 'Golpe crítico', how: 'Marcar una meta como cumplida: una de cada diez veces.', what: '«¡CRÍTICO!» en verde y una celebración doble.' },
];
const ALL = EGGS.map((e) => e.id);
let toast = () => {};
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.ambience === 'enfoque';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };
export const found = () => new Set(read(FOUND, []));

function discover(id, message) {
  const s = found();
  const fresh = !s.has(id);
  if (fresh) {
    s.add(id); write(FOUND, [...s]); sfx.secret();
    // Counted once per browser, anonymously, for the admin panel.
    if (auth.currentUser) countEgg(id).catch(() => {});
  }
  toast(fresh ? `${t(message)} · ${t('Secreto')} ${s.size}/${ALL.length}` : t(message));
}

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
  else if (typed.endsWith('torta') || typed.endsWith('cake')) { typed = ''; discover('cake', 'La torta es una mentira. Las guías, no.'); }
  else if (typed.endsWith('medico') || typed.endsWith('medic')) { typed = ''; heal(); discover('medic', '¡Médico! +25 de ánimo para seguir estudiando.'); }
}
function heal() {
  if (still()) return;
  sfx.chime();
  const el = document.createElement('div');
  el.className = 'egg-heal';
  el.innerHTML = '<span>+25</span>';
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
}

/* ---------- a lucky hit ---------- */
// Called when a goal is checked off. About one in ten is a lucky hit.
export function luckyHit(x, y) {
  if (Math.random() > 0.1 || still() || !flag('eggs')) return false;
  sfx.crit();
  const el = document.createElement('div');
  el.className = 'egg-crit';
  el.textContent = t('¡CRÍTICO!');
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  document.body.append(el);
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
  const el = document.createElement('div');
  el.className = `egg-portal ${kind}`;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  document.body.append(el);
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
  const ball = document.createElement('div');
  ball.className = 'egg-ball';
  document.body.append(ball);
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

function radioEl() { return document.getElementById('egg-radio'); }
function place(el, pos) {
  const w = el.offsetWidth || 260; const h = el.offsetHeight || 150;
  const x = Math.max(8, Math.min(innerWidth - w - 8, pos.x)); const y = Math.max(8, Math.min(innerHeight - h - 8, pos.y));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  return { x, y };
}
export function radioOn() { return !!read(RADIO, {}).on; }
export function openRadio(discovered = false) {
  if (!flag('radio')) return;
  if (discovered) discover('radio', 'Encontraste la radio. Ponla donde quieras.');
  const state = read(RADIO, {});
  write(RADIO, { ...state, on: true });
  if (radioEl()) return;
  const el = document.createElement('section');
  el.id = 'egg-radio';
  el.className = 'egg-radio glass';
  el.setAttribute('aria-label', t('Radio'));
  el.innerHTML = `<div class="grill" aria-hidden="true"></div>
    <div class="face"><span class="freq">88.5<small>FM</small></span><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="name">${t('Studium FM · bossa para estudiar')}</span></div>
    <div class="ctl"><button class="icon rplay" data-radio-play aria-label="${t('Reproducir')}"><svg viewBox="0 0 24 24"><path class="p" d="M8 5v14l11-7Z" fill="currentColor"/><path class="s" d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg></button>
      <input type="range" min="0" max="1" step="0.05" value="${radio.gain}" data-radio-vol aria-label="${t('Volumen')}">
      <button class="icon" data-radio-close aria-label="${t('Apagar la radio')}"><svg><use href="#i-x"/></svg></button></div>`;
  document.body.append(el);
  const pos = place(el, state.x != null ? state : { x: innerWidth - 300, y: innerHeight - 240 });
  write(RADIO, { ...read(RADIO, {}), on: true, ...pos });
  el.querySelector('[data-radio-play]').addEventListener('click', () => {
    if (radio.playing) stopMusic(); else startMusic();
    el.classList.toggle('playing', radio.playing);
    el.querySelector('[data-radio-play]').setAttribute('aria-label', t(radio.playing ? 'Pausar' : 'Reproducir'));
  });
  el.querySelector('[data-radio-vol]').addEventListener('input', (e) => { radio.gain = Number(e.target.value); if (radio.level) radio.level.gain.value = radio.gain; });
  el.querySelector('[data-radio-close]').addEventListener('click', () => closeRadio());
  // Dragged by its body, and left wherever it is dropped.
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input')) return;
    drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
    el.setPointerCapture(e.pointerId); el.classList.add('held');
  });
  el.addEventListener('pointermove', (e) => { if (drag) place(el, { x: e.clientX - drag.dx, y: e.clientY - drag.dy }); });
  const drop = () => { if (!drag) return; drag = null; el.classList.remove('held'); write(RADIO, { ...read(RADIO, {}), x: el.offsetLeft, y: el.offsetTop }); sfx.drop(); };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
}
export function closeRadio() {
  stopMusic();
  radioEl()?.remove();
  write(RADIO, { ...read(RADIO, {}), on: false });
}

export function mountEggs(options) {
  toast = options.toast;
  addEventListener('keydown', onKey);
  // The dot answers on its own: pressing it does not throw its letter, so it can be pressed again.
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element && e.target.matches('.wordmark .i b'))) return;
    e.stopPropagation();
    e.target.animate([{ scale: 1 }, { scale: 1.35 }, { scale: 1 }], { duration: 260, easing: 'ease-out' });
    sfx.tick();
    onDot(e);
  }, true);
  addEventListener('resize', () => { const el = radioEl(); if (el) place(el, { x: el.offsetLeft, y: el.offsetTop }); });
  if (radioOn()) openRadio();
}
