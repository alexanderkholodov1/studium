// Easter eggs: small secrets that never get in the way. Everything here is original (the sounds, the drawings, the
// characters and the music); the winks are to games students love. Each secret does something on screen and leaves
// something on Inicio, in «Tus hallazgos» (space.js draws it with what this file exports). Found secrets are
// remembered in this browser.
//   · type «radio» (or the old cheat code ↑ ↑ ↓ ↓ ← → ← → B A): an old 3D radio with stations (stations.js); it can
//     stay on Inicio or go with you to every tab;
//   · press the red dot of «studium» three times: two portals and a glass marble, which then stay on Inicio;
//   · type «torta» or «cake»: a cake falls on the screen, and stays on Inicio with its candle;
//   · type «medico» or «medic»: Specter jumps up in his doctor's look and shouts, with the pulse; a heart monitor stays
//     on Inicio, and the look opens for him;
//   · type «café» or «hambre»: a study desk behind the page, or night with a campfire, each with its station;
//   · now and then, a goal checked off is a lucky hit; Inicio counts them with a trophy.
import { sfx } from './sfx.js';
import { t } from './i18n.js';
import { auth, countEgg } from './data.js';
import { flag } from './settings.js';
import { STATIONS, GENERATORS, stationOf } from './stations.js';
import { props, pokeProp } from './props3d.js';

const FOUND = 'studium-eggs';
const RADIO = 'studium-radio';
const CRITS = 'studium-crits';
// Every easter egg, as the admin panel lists them. The ids are the ones the rules accept for the counters (eggs/{id}).
export const EGGS = [
  { id: 'radio', name: 'La radio', how: 'Escribir «radio» en cualquier página, fuera de un campo de texto, o el código ↑ ↑ ↓ ↓ ← → ← → B A.',
    what: 'Una radio antigua en 3D, con estaciones que abren otros secretos. Se puede dejar en Inicio o llevar a todas las pestañas.' },
  { id: 'portal', name: 'Portales', how: 'Pulsar tres veces seguidas el punto rojo de «studium» en la portada.',
    what: 'Un portal azul y uno naranja, y una canica de vidrio que entra por uno y sale por el otro. Los portales se quedan en Inicio.' },
  { id: 'cake', name: 'La torta', how: 'Escribir «torta» o «cake».', what: 'Cae una torta con su vela en la pantalla, y se queda en Inicio: se sopla y se vuelve a encender.' },
  { id: 'medic', name: '¡Médico!', how: 'Escribir «medico» o «medic».', what: 'Specter salta vestido de doctor y grita «¡Médico!», con el pulso. En Inicio queda un monitor de ritmo cardíaco, y Specter puede vestirse de doctor.' },
  { id: 'crit', name: 'Golpe crítico', how: 'Marcar una meta como cumplida: una de cada diez veces.', what: '«¡CRÍTICO!» en verde y una celebración doble; en Inicio, un trofeo los cuenta. Abre la estación «8 bits».' },
  { id: 'cafe', name: 'Noche de estudio', how: 'Escribir «café» o «cafe».', what: 'Un fondo de lámpara cálida con una taza humeante, que se enciende y se apaga desde Inicio. Abre la estación «Lluvia y lo-fi».' },
  { id: 'starve', name: 'No te mueras de hambre', how: 'Escribir «hambre» o «starve».', what: 'Cae la noche sobre la página y se enciende una fogata. Deja un fonógrafo en Inicio y abre la estación «El fonógrafo».' },
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
  toast(fresh ? `${t(message)} ${t('Secreto')} ${s.size} de ${ALL.length}, en tu Inicio.` : t(message));
  onFound(id, fresh);
}
const layer = (cls, html = '') => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; el.setAttribute('aria-hidden', 'true'); document.body.append(el); return el; };

/* ---------- the objects: real 3D (props3d.js), never flat drawings ---------- */
// A canvas that props3d.js fills with a lit, shaded object; the object comes with the canvas.
export const prop3d = (kind, cls = '', attrs = '') => `<canvas class="prop ${cls}" data-prop="${kind}" ${attrs} aria-hidden="true"></canvas>`;
const show3d = (el) => { props(el); return el; };
// A moment on screen: hidden until its 3D object is drawn, then shown for «ms» and gone. Returns when it shows.
function moment(cls, html, ms) {
  const el = layer(`${cls} wait`, html);
  const shown = props(el).then(() => { el.classList.remove('wait'); setTimeout(() => el.classList.add('away'), ms); setTimeout(() => el.remove(), ms + 900); });
  setTimeout(() => el.remove(), 15000); // never stuck if it cannot be drawn
  return shown;
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
  else if (typed.endsWith('torta') || typed.endsWith('cake')) { typed = ''; cakeFalls(); discover('cake', 'La torta es una mentira. Esta no: es tuya.'); }
  else if (typed.endsWith('medico') || typed.endsWith('medic')) { typed = ''; medic(); discover('medic', '¡Médico! +25 de ánimo para seguir estudiando.'); }
  else if (typed.endsWith('café') || typed.endsWith('cafe')) { typed = ''; setBackdrop('cafe'); discover('cafe', 'Noche de estudio: lámpara, café y la estación «Lluvia y lo-fi».'); }
  else if (typed.endsWith('hambre') || typed.endsWith('starve')) { typed = ''; nightfall(); discover('starve', 'Se hizo de noche. Come algo, y sigue: hay un fonógrafo en tu Inicio.'); }
}

/* ---------- «Noche de estudio»: a background with a warm lamp and a cup of coffee ---------- */
const BACKDROP = 'studium-backdrop';
export const backdrop = () => String(read(BACKDROP, ''));
export function setBackdrop(id) {
  write(BACKDROP, id);
  document.getElementById('egg-backdrop')?.remove();
  if (id !== 'cafe') return;
  // The warm light of the lamp over the page, and the desk itself in a corner, in 3D.
  const el = layer('egg-backdrop cafe', prop3d('desk', 'desk'));
  el.id = 'egg-backdrop';
  // Behind the page, with the page's own background: under the floating decorations and every tile.
  document.querySelector('body > .play')?.before(el);
  show3d(el);
}

/* ---------- «No te mueras de hambre»: night falls, and a campfire is lit ---------- */
function nightfall() {
  if (still()) return;
  sfx.portal();
  moment('egg-fire', prop3d('fire'), 4600).then(() => {
    const night = layer('egg-night');
    setTimeout(() => sfx.blow(), 600);
    setTimeout(() => night.classList.add('away'), 4600);
    setTimeout(() => night.remove(), 5600);
  });
}

/* ---------- the cake ---------- */
function cakeFalls() {
  if (still()) return;
  moment('egg-cake-drop', prop3d('cake'), 2600).then(() => {
    sfx.pop();
    setTimeout(() => { sfx.impact(80, 500); confetti(innerWidth / 2, innerHeight * 0.55); }, 820);
  });
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
// Specter jumps up from the bottom of the screen in his doctor's look and shouts; a pulse line crosses the screen
// with its beeps, and +25. Finding it also opens that look for him (specter.js).
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
  moment('egg-medic', `${prop3d('specter', 'specter', 'data-skin="doctor" data-mood="glad" data-fixed')}<b class="bubble">${t('¡MÉDICO!')}</b>`, 2600).then(() => {
    setTimeout(() => shout(t('¡Médico!')), 380);
    const line = layer('egg-pulse', '<svg viewBox="0 0 1200 160" preserveAspectRatio="none"><path d="M0 80H380l30-10 20 10h40l18-66 26 132 22-90 14 24h50l26-14 24 14H1200"/></svg>');
    [520, 1240, 1960].forEach((ms) => setTimeout(() => sfx.beep(), ms));
    setTimeout(() => { sfx.heartbeat(); heal(); }, 900);
    setTimeout(() => line.classList.add('away'), 2600);
    setTimeout(() => line.remove(), 3200);
  });
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
function portals(x, y) {
  discover('portal', 'Ahora piensas con portales.');
  if (still()) return;
  const left = Math.max(12, Math.min(innerWidth - 432, x - 210)); const top = Math.max(84, Math.min(innerHeight - 312, y + 30));
  const el = layer('egg-portals wait', prop3d('portals'));
  el.style.left = `${left}px`; el.style.top = `${top}px`;
  props(el).then(() => {
    el.classList.remove('wait');
    sfx.portal();
    setTimeout(() => pokeProp(el.querySelector('canvas')), 400);
    setTimeout(() => el.classList.add('away'), 2800);
    setTimeout(() => el.remove(), 3600);
  });
  setTimeout(() => el.remove(), 15000);
}

/* ---------- what each find does on Inicio («Tus hallazgos», drawn by space.js) ---------- */
// el: the trinket pressed. The cake's candle is blown out and lit again; the monitor beats; a marble crosses the
// portals; the trophy shines.
export function poke(id, el) {
  if (!el) return;
  const canvas = el.querySelector('canvas[data-prop]');
  if (id === 'cake') {
    const lit = pokeProp(canvas);
    if (lit === false) sfx.blow(); else { sfx.tick(); const r = el.getBoundingClientRect(); if (!still()) confetti(r.left + r.width / 2, r.top + 10, 18); }
    el.setAttribute('aria-pressed', String(lit === false));
  } else if (id === 'medic') {
    sfx.heartbeat(); setTimeout(() => sfx.beep(), 260); pokeProp(canvas);
  } else if (id === 'portal') {
    sfx.portal(); pokeProp(canvas);
  } else if (id === 'cafe') {
    setBackdrop(backdrop() === 'cafe' ? '' : 'cafe'); sfx.tick();
    el.setAttribute('aria-pressed', String(backdrop() === 'cafe'));
  } else if (id === 'starve') {
    // The gramophone: the radio turns on and tunes to the phonograph.
    openRadio(); tune(0, 'fono'); sfx.tick();
  } else if (id === 'crit') {
    sfx.crit(); pokeProp(canvas);
  }
}

/* ---------- the radio's sound ---------- */
// A station of original music is generated as it plays (stations.js), through a small radio speaker; a station of an
// official upload plays in YouTube's own player, shown on the radio (never hidden), with its credit.
const BAR = 16;
const radio = { audio: null, out: null, playing: false, step: 0, next: 0, timer: 0, gain: 0.6, stop: null, kit: null };
function schedule() {
  const { ctx: a } = radio.audio;
  const gen = GENERATORS[radio.station] ?? GENERATORS.bossa;
  const dur = 60 / gen.bpm / 4;
  if (radio.next < a.currentTime - 0.05) radio.next = a.currentTime + 0.02;
  while (radio.next < a.currentTime + 0.15) {
    const s = radio.step % BAR; const bar = Math.floor(radio.step / BAR);
    const swing = radio.station === 'bossa' && s % 2 ? dur * 0.12 : 0;
    gen.play(radio.kit, radio.next + swing, s, bar);
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
  radio.kit = { a, dest: radio.out, noise: radio.noise };
  radio.playing = true;
  radio.step = 0;
  radio.next = a.currentTime + 0.08;
  radio.stop = GENERATORS[radio.station]?.start?.(radio.kit) ?? null;
  radio.timer = setInterval(schedule, 30);
  return true;
}
function stopMusic() { radio.playing = false; clearInterval(radio.timer); radio.stop?.(); radio.stop = null; }

/* ---------- the radio, on screen: an old radio that is a box in 3D ---------- */
// It goes with you to every tab (floating, wherever you drop it), or it stays on Inicio, in «Tus hallazgos». Either
// way the music goes on while you move around the page.
function radioEl() { return document.getElementById('egg-radio'); }
function place(el, pos) {
  const w = el.offsetWidth || 300; const h = el.offsetHeight || 210;
  // Never over the navigation bar at the top.
  const top = Math.max(84, (document.getElementById('nav')?.getBoundingClientRect().bottom ?? 0) + 8);
  const x = Math.max(8, Math.min(innerWidth - w - 8, pos.x)); const y = Math.max(top, Math.min(innerHeight - h - 8, pos.y));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  return { x, y };
}
export function radioOn() { return !!read(RADIO, {}).on; }
export const radioDocked = () => radioOn() && !!read(RADIO, {}).dock;
const knob = (v) => `rotate(${Math.round(v * 270 - 135)}deg)`;

/* ---------- the stations: each opens with a secret ---------- */
const BASE = ['radio', 'portal', 'cake', 'medic', 'crit'];
export function stationOpen(s) { const f = found(); return s.opens === 'radio' || (s.opens === 'all' ? BASE.every((x) => f.has(x)) : f.has(s.opens)); }
export const openStations = () => STATIONS.filter(stationOpen);
const current = () => { const s = stationOf(read(RADIO, {}).station); return stationOpen(s) ? s : STATIONS[0]; };
const needle = (s) => `${((s.freq - 88) / 20) * 100}%`;
// An official upload plays in YouTube's own player (its official IFrame API), visible on the radio, with its credit
// and a link to the original. The radio's own knobs play, pause and set its volume; what the player says (playing,
// paused, an error, a click the browser asks for) is shown on the radio in words.
let ytLoad = null;
function youtube() {
  ytLoad ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { before?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytLoad = null; reject(new Error('no-api')); };
    document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) { ytLoad = null; reject(new Error('slow')); } }, 15000);
  });
  return ytLoad;
}
const YT_ERRORS = {
  2: 'YouTube no reconoce este video.',
  5: 'Este navegador no puede reproducir este video.',
  100: 'El video ya no está en YouTube.',
  101: 'Su dueño no deja reproducirlo fuera de YouTube. Ábrelo en YouTube con el enlace.',
  150: 'Su dueño no deja reproducirlo fuera de YouTube. Ábrelo en YouTube con el enlace.',
};
function status(el, text) { const p = el.querySelector('.yt-status'); if (p) { p.textContent = t(text); p.hidden = !text; } }
function playingNow(el, on) {
  radio.playing = on;
  el.classList.toggle('playing', on);
  el.querySelector('[data-radio-play]').setAttribute('aria-label', t(on ? 'Pausar' : 'Reproducir'));
}
function tv(el, s) {
  const box = el.querySelector('.radio-tv');
  try { radio.yt?.destroy(); } catch { /* already gone */ }
  radio.yt = null;
  if (!s?.video) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<div class="yt"></div><p class="yt-status" role="status">${t('Abriendo el reproductor de YouTube…')}</p>
    <p class="credit">${t(s.credit)} <a href="https://www.youtube.com/watch?v=${s.video}" target="_blank" rel="noopener">${t('Ver en YouTube')}</a></p>`;
  // Floating, the radio grows upward with its player and stays on screen.
  if (!el.classList.contains('docked')) setTimeout(() => place(el, { x: el.offsetLeft, y: el.offsetTop - box.offsetHeight }), 0);
  youtube().then((YT) => {
    if (current().id !== s.id || !el.isConnected) return;
    radio.yt = new YT.Player(box.querySelector('.yt'), {
      host: 'https://www.youtube.com', videoId: s.video, width: '100%', height: '200',
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, loop: 1, playlist: s.video, origin: location.origin },
      events: {
        onReady: (e) => {
          e.target.setVolume(Math.round(radio.gain * 100));
          e.target.playVideo();
          status(el, '');
          // A browser that blocks sound until a click inside the player: say so, instead of looking broken.
          setTimeout(() => { if (radio.yt === e.target && e.target.getPlayerState?.() !== 1) status(el, 'Tu navegador pide un clic: pulsa ▶ en el video.'); }, 2500);
        },
        onStateChange: (e) => {
          if (e.data === 1) { status(el, ''); playingNow(el, true); }
          else if (e.data === 2) playingNow(el, false);
          else if (e.data === 0) e.target.playVideo(); // the loop
        },
        onError: (e) => { status(el, YT_ERRORS[e.data] ?? 'YouTube no pudo reproducir este video.'); playingNow(el, false); },
      },
    });
  }).catch(() => status(el, 'No se pudo cargar el reproductor de YouTube. Revisa tu internet y vuelve a sintonizar.'));
}
function play(el, on) {
  const s = current();
  radio.station = s.id;
  stopMusic();
  if (s.video) {
    if (!radio.yt && on) { tv(el, s); return; }
    try { if (on) radio.yt?.playVideo(); else radio.yt?.pauseVideo(); } catch { /* not ready yet */ }
    playingNow(el, on);
  } else {
    tv(el, null);
    if (on) startMusic();
    playingNow(el, radio.playing);
  }
}
function tell(_el, func, args = []) { try { radio.yt?.[func]?.(...args); } catch { /* not ready yet */ } }
function syncStation(el) {
  const s = current();
  const open = openStations();
  el.querySelector('.needle').style.left = needle(s);
  el.querySelector('.name').textContent = `${s.freq.toFixed(1)} · ${t(s.name)}`;
  el.querySelector('[data-radio-tune]').title = open.length > 1 ? `${t('Cambiar de estación')} (${open.length})` : t('Por ahora hay una estación: cada secreto abre otra');
  el.querySelector('.marks').innerHTML = open.map((x) => `<i style="left:${needle(x)}"></i>`).join('');
}
// Turning the tuning knob: the next open station (or the one before, or one by its id); it plays if the radio played.
export function tune(dir = 1, id = '') {
  const list = openStations();
  const at = Math.max(0, list.findIndex((x) => x.id === current().id));
  const next = (id && list.find((x) => x.id === id)) || list[(at + dir + list.length) % list.length];
  write(RADIO, { ...read(RADIO, {}), station: next.id });
  const el = radioEl();
  if (!el) return;
  const was = radio.playing;
  tv(el, null);
  play(el, was);
  syncStation(el);
  sfx.tick();
}

function radioHTML() {
  return `<div class="rstage"><div class="box">
      <div class="face front">
        <span class="cloth" aria-hidden="true"></span>
        <div class="panel">
          <div class="dial" aria-hidden="true"><span class="scale"><i>88</i><i>98</i><i>108</i></span><span class="marks"></span><i class="needle"></i><i class="lamp"></i></div>
          <span class="name"></span>
          <div class="knobs">
            <button class="knob rplay" type="button" data-radio-play aria-label="${t('Reproducir')}"><svg viewBox="0 0 24 24"><path class="p" d="M9 6v12l9-6Z" fill="currentColor"/><path class="s" d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor"/></svg></button>
            <button class="knob tune" type="button" data-radio-tune aria-label="${t('Cambiar de estación')}"><i></i></button>
            <span class="knob vol" title="${t('Volumen')}"><i style="transform:${knob(radio.gain)}"></i><input type="range" min="0" max="1" step="0.05" value="${radio.gain}" data-radio-vol aria-label="${t('Volumen')}"></span>
          </div>
        </div>
      </div>
      <span class="face back"></span><span class="face right"></span><span class="face left"></span><span class="face top"><i class="handle"></i></span><span class="face bottom"></span>
    </div></div>
    <div class="radio-tv" hidden></div>
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
  syncStation(el);
  placeRadio();
  el.querySelector('[data-radio-play]').addEventListener('click', () => { play(el, !radio.playing); sfx.tick(); });
  const tuner = el.querySelector('[data-radio-tune]');
  let turns = 0;
  tuner.addEventListener('click', () => { turns += 1; tuner.querySelector('i').style.transform = `rotate(${turns * 51}deg)`; tune(1); });
  tuner.addEventListener('wheel', (e) => { e.preventDefault(); tune(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  const vol = el.querySelector('[data-radio-vol]');
  const setVol = (v) => { radio.gain = Math.max(0, Math.min(1, v)); vol.value = radio.gain; if (radio.level) radio.level.gain.value = radio.gain; el.querySelector('.vol i').style.transform = knob(radio.gain); tell(el, 'setVolume', [Math.round(radio.gain * 100)]); };
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
  try { radio.yt?.destroy(); } catch { /* already gone */ }
  radio.yt = null;
  radio.playing = false;
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
  const keep = () => { const el = radioEl(); if (el && !el.classList.contains('docked')) place(el, { x: el.offsetLeft, y: el.offsetTop }); };
  addEventListener('resize', keep);
  addEventListener('hashchange', () => setTimeout(keep, 50));
  if (radioOn()) openRadio();
  if (found().has('cafe') && backdrop() === 'cafe') setBackdrop('cafe');
}
