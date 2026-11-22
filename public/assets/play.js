// Things that float: glass tokens of every subject drifting in two depths behind the page, which the person can grab,
// throw and knock into each other; and, in the playful ambience, Specter (the mascot, a small 3D ghost that lives on the bottom edge,
// watches the pointer and hops) and bubbles to pop. Also the confetti of a met goal and the springy letters of the
// wordmark. Everything is DOM moved with transforms; nothing runs when the person prefers reduced motion or focus.
import { sfx } from './sfx.js';
import { props, actProp } from './props3d.js';
import { specterSkin, setSpecterSkin, skinOpen } from './specter.js';

const root = document.documentElement;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// The page's own things: on them the pointer selects text, follows a link or presses a button. Anywhere else is air,
// and a press there grabs whatever floats behind.
const SOLID = 'a, button, input, select, textarea, label, summary, details, iframe, canvas, p, h1, h2, h3, h4, li, dt, dd, pre, code, table, img, figure, dialog, svg, .glass, .solid, [data-tilt], .menu, .toast, .nodo, .bub';

const ICON = {
  atom: '<ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  dna: '<path d="M8 2c0 5 8 5 8 10s-8 5-8 10M16 2c0 5-8 5-8 10s8 5 8 10M9.2 5.5h5.6M9.2 18.5h5.6M10.6 12h2.8"/>',
  leaf: '<path d="M5 19C5 10 11 5 20 5c0 9-5 14-14 14"/><path d="M5 19 14 10"/>',
  bars: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="7" rx="1"/><rect x="11" y="6" width="3" height="12" rx="1"/><rect x="16" y="13" width="3" height="5" rx="1"/>',
  nodes: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="17" r="3"/><path d="M8 8.5l2.6 6M16.6 7.7l-3 6.6M8.4 6.8l7.6-.6"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  flask: '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z"/><path d="M14 6l3 3"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
};
// Blue and red lead; the highlighter colors follow.
const TOKENS = [
  { g: 'Σ', c: 'blue' }, { i: 'nodes', c: 'red' }, { g: 'π', c: 'red' }, { i: 'atom', c: 'blue' }, { i: 'dna', c: 'teal' },
  { g: '∫', c: 'blue' }, { i: 'bars', c: 'butter' }, { i: 'code', c: 'red' }, { g: 'λ', c: 'sky' }, { i: 'leaf', c: 'teal' },
  { i: 'note', c: 'peach' }, { i: 'bulb', c: 'butter' }, { g: 'Δ', c: 'red' }, { i: 'flask', c: 'blue' }, { i: 'pen', c: 'peach' },
  { i: 'globe', c: 'sky' }, { g: '√', c: 'blue' }, { g: 'Aa', c: 'red' },
];

// Specter, the mascot: a 3D ghost drawn by props3d.js (his look: canvas.dataset.skin, his face: canvas.dataset.mood).
const SPECTER = '<canvas class="prop specter" data-prop="specter" aria-hidden="true"></canvas>';

let back = null;
let front = null;
let W = innerWidth;
let H = innerHeight;
let bodies = [];
let bubbles = [];
let nodo = null;
let ambience = 'vivo';
// Bubbles to pop: only in the playful ambience, when the person turned them on in Settings and the admins allow them.
let bubblesOn = false;
let quiet = false;
let raf = 0;
let last = 0;
let drag = null;
let idleSince = performance.now();
let nextBubble = 0;
const pointer = { x: -999, y: -999, px: 0, py: 0, vx: 0, vy: 0, trail: [] };
const rand = (a, b) => a + Math.random() * (b - a);

const running = () => !!back && !quiet && !still() && ambience !== 'enfoque' && !document.hidden;
const wander = () => (ambience === 'sereno' ? 2.5 : ambience === 'jugueton' ? 6 : 4.5);

function token(spec, r, tier) {
  const el = document.createElement('div');
  el.className = `tok t${tier}`;
  el.style.setProperty('--c', `var(--${spec.c})`);
  el.style.width = el.style.height = `${Math.round(r * 2)}px`;
  el.innerHTML = spec.i
    ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[spec.i]}</svg>`
    : `<b style="font-size:${Math.round(r * (spec.g.length > 1 ? 0.62 : 0.92))}px">${spec.g}</b>`;
  return el;
}

function place(r, tier) {
  for (let tries = 0; tries < 40; tries += 1) {
    const x = rand(r + 8, W - r - 8);
    const y = rand(r + 70, H - r - 8);
    if (bodies.every((b) => b.tier !== tier || Math.hypot(b.x - x, b.y - y) > b.r + r + 24)) return { x, y };
  }
  return { x: rand(r, W - r), y: rand(r, H - r) };
}

function build() {
  back.replaceChildren();
  front.querySelectorAll('.nodo, .bub, .speech').forEach((el) => el.remove());
  bodies = []; bubbles = []; nodo = null;
  if (ambience === 'enfoque') return;
  const small = W < 720;
  const near = ambience === 'sereno' ? (small ? 3 : 5) : small ? 4 : W < 1200 ? 6 : 8;
  const mid = ambience === 'sereno' ? (small ? 2 : 4) : small ? 3 : 6;
  const pool = [...TOKENS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < near + mid; i += 1) {
    const tier = i < near ? 0 : 1;
    const r = tier ? rand(15, 24) : rand(small ? 26 : 32, small ? 36 : 50);
    const { x, y } = place(r, tier);
    const el = token(pool[i % pool.length], r, tier);
    back.append(el);
    bodies.push({ el, x, y, vx: rand(-6, 6), vy: rand(-6, 6), r, m: r * r, a: rand(-0.3, 0.3), va: rand(-0.05, 0.05), tier, phase: rand(0, 6.28), sq: 0, sqa: 0 });
  }
  if (ambience === 'jugueton') makeNodo();
  render();
}

/* ---------- Nodo ---------- */
function makeNodo() {
  const el = document.createElement('div');
  el.className = 'nodo';
  el.innerHTML = SPECTER;
  el.title = 'Specter';
  const face = el.querySelector('canvas');
  face.dataset.skin = specterSkin();
  front.append(el);
  const r = W < 720 ? 44 : 62;
  el.style.width = el.style.height = `${r * 2}px`;
  nodo = { el, x: Math.min(W - r - 20, Math.max(r + 20, W * 0.12)), y: H - r - 34, vx: 0, vy: 0, r, m: r * r * 1.4, a: 0, va: 0, tier: 0, phase: 0, sq: 0, sqa: 0, kind: 'nodo',
    hop: performance.now() + rand(9000, 15000), blink: performance.now() + rand(1500, 4000), mood: '', moodUntil: 0, face };
  bodies.push(nodo);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); grab(nodo, e); });
  props(el);
  try { if (!localStorage.getItem('studium-specter-hello')) { localStorage.setItem('studium-specter-hello', '1'); setTimeout(() => say('Hola, soy Specter. Puedes moverme.'), 1600); } } catch { /* not remembered */ }
}
// Poked, he answers with a face and a few words; poked many times in a row, he gets dizzy, then a bit annoyed.
const POKES = [['glad', '¡Hey!'], ['glad', 'Jaja, cosquillas.'], ['wink', '¿Estudiamos un rato?'], ['surprised', '¡Uy!'], ['love', 'Aww.'], ['glad', 'Tírame contra algo.'], ['wink', 'Boo.']];
let pokes = []; 
function poked(b) {
  const now = performance.now();
  pokes = [...pokes.filter((x) => now - x < 4000), now];
  b.vy -= 260; b.spin = now; stopRoutine();
  const [face, words] = pokes.length >= 7 ? ['angry', '¡Ya, ya! Basta.'] : pokes.length >= 4 ? ['dizzy', 'Todo da vueltas…'] : POKES[Math.floor(Math.random() * POKES.length)];
  mood(face, 1800);
  say(words, 1800);
  sfx.boing(Math.floor(rand(0, 5)));
  wake();
}
function mood(name, ms, quiet = false) {
  if (!nodo) return;
  if (name && name !== 'sleep' && name !== nodo.mood && !quiet) sfx.voice(name);
  nodo.mood = name; nodo.moodUntil = performance.now() + ms;
  nodo.el.dataset.mood = name;
  nodo.face.dataset.mood = name === 'sleep' ? 'shut' : FACES.includes(name) ? name : name ? 'glad' : '';
  // His hands say it too.
  nodo.face.dataset.hands = { surprised: 'cheeks', scared: 'up', yawn: 'mouth', dizzy: 'shrug', love: 'cheeks', angry: 'hips', sad: 'shrug', wink: 'wave' }[name] ?? (name === 'glad' && Math.random() < 0.5 ? 'wave' : 'rest');
}
// The faces his canvas knows (props3d.js).
const FACES = ['glad', 'shut', 'sad', 'surprised', 'angry', 'love', 'dizzy', 'wink', 'scared', 'yawn'];
// When nobody touches him, now and then he lives a little scene of his own, in his place: a stretch and a yawn, a
// doze that ends with a start, a song he sways to, a curious look around, a few hops, a game of disappearing.
// Each is a short timeline of steps; grabbing him, or a flight, cuts it.
function hopUp(b = nodo, power = 320) {
  if (!b) return;
  b.sq = 0.16; b.sqa = 0; // crouching first
  setTimeout(() => { if (nodo !== b) return; b.vy = -power; b.sq = -0.12; b.hopping = true; sfx.voice('hop'); wake(); }, 140);
  wake();
}
// His canvas, inside his body: swaying, nodding and fading are drawn on it, so they mix with the physics.
function pose({ rot = 0, y = 0, scale = 1, alpha = 1, ms = 400 } = {}) {
  if (!nodo) return;
  const c = nodo.face;
  c.style.transition = `transform ${ms}ms cubic-bezier(.4, 0, .3, 1), opacity ${ms}ms ease`;
  c.style.transform = rot || y || scale !== 1 ? `translateY(${y}px) rotate(${rot}deg) scale(${scale})` : '';
  c.style.opacity = alpha === 1 ? '' : String(alpha);
}
function notes(n = 3) {
  if (!nodo || !front) return;
  for (let i = 0; i < n; i += 1) {
    setTimeout(() => {
      if (!nodo) return;
      const el = document.createElement('span');
      el.className = 'specter-note';
      el.textContent = ['♪', '♫', '♩'][i % 3];
      el.style.left = `${nodo.x + rand(-10, 22)}px`; el.style.top = `${nodo.y - nodo.r * 0.9}px`;
      front.append(el);
      setTimeout(() => el.remove(), 1800);
    }, i * 420);
  }
}
const ROUTINES = {
  stretch: [[0, () => { nodo.sq = -0.2; nodo.sqa = 0; pose({ y: -4, ms: 700 }); wake(); }], [700, () => mood('yawn', 1600)], [2300, () => { pose({ ms: 300 }); nodo.sq = 0.14; wake(); }], [2700, () => mood('glad', 900, true)]],
  doze: [[0, () => mood('shut', 9000, true)], [400, () => pose({ y: 3, rot: -6, ms: 900 })], [1400, () => pose({ y: 0, rot: 0, ms: 300 })], [2000, () => pose({ y: 5, rot: 7, ms: 1100 })], [3300, () => { say('zz…', 1200); }],
    [4200, () => { pose({ ms: 120 }); mood('surprised', 900); hopUp(nodo, 260); }], [5200, () => { mood('glad', 1400); say('¡No estaba dormido!', 1600); }]],
  song: [[0, () => { mood('glad', 4200, true); nodo.face.dataset.talk = '1'; sfx.voice('hum'); notes(4); }], [0, () => pose({ rot: -8, ms: 500 })], [500, () => pose({ rot: 8, ms: 500 })], [1000, () => pose({ rot: -8, ms: 500 })],
    [1500, () => { pose({ rot: 8, ms: 500 }); sfx.voice('hum'); }], [2000, () => pose({ rot: -6, ms: 500 })], [2500, () => pose({ rot: 0, ms: 400 })], [2600, () => { nodo.face.dataset.talk = ''; mood('wink', 900); }]],
  curious: [[0, () => { nodo.lookAt = performance.now(); }], [700, () => mood('surprised', 700)], [1500, () => pose({ rot: -10, y: -2, ms: 400 })], [2300, () => { pose({ ms: 300 }); mood('glad', 1200, true); nodo.sq = 0.1; wake(); }]],
  bounce: [[0, () => hopUp(nodo, 240)], [650, () => hopUp(nodo, 280)], [1300, () => hopUp(nodo, 340)], [2200, () => mood('dizzy', 1500)], [3700, () => mood('glad', 900, true)]],
  boo: [[0, () => { mood('wink', 1200); pose({ alpha: 0.12, scale: 0.9, ms: 900 }); }], [2400, () => { pose({ alpha: 1, scale: 1.12, ms: 160 }); mood('surprised', 900); say('¡Boo!', 1200); nodo.sq = -0.14; wake(); }], [2700, () => pose({ ms: 300 })], [3400, () => mood('glad', 1000, true)]],
};
// The decoration of Inicio: very rarely Specter goes into it by himself (only when it is on screen, wherever it sits
// in the grid and whatever its size), and dropped on it he goes in too. He flies to the edge of its tile, vanishes in
// a spin, and his double, dressed for the place (an apron for the cake, a backpack for the campfire), lives a story
// inside the 3D scene itself (props3d.js); then he spins back out by the tile and flies home. A story he has done
// waits ten minutes; with none left he says he has had enough.
const DECOR_COOL = 10 * 60000;
const decorDone = {};
const STORY_IDS = { campfire: ['mallow', 'warm', 'story', 'song'], cake: ['cherry', 'wish', 'taste', 'dance'] };
const ENOUGH = { cake: ['Ya no quiero más torta…', 'Estoy lleno. Ni una cereza más.'], campfire: ['Ya me calenté bastante.', 'Ni un malvavisco más, por hoy.'] };
let lastVisit = performance.now();
let away = null; // { canvas, door: { x, y }, timer }
const placedDecor = () => {
  const c = document.querySelector('#dash [data-tile="decor"] .decor-obj canvas[data-prop]');
  return c && STORY_IDS[c.dataset.prop] && c._prop ? c : null;
};
// How much of it is on screen (0 to 1), below the navigation bar.
function onScreen(el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return 0;
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 64));
  return (w * h) / (r.width * r.height);
}
function decorCanvas() { const c = placedDecor(); return c && onScreen(c) >= 0.6 ? c : null; }
// His words and notes, where his double is in the scene.
function sceneSpeech(text, x, y, ms = 1600) {
  if (!front) return;
  const el = document.createElement('div');
  el.className = 'speech';
  el.textContent = text;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - 8).toFixed(1)}px, 0) translate(-50%, -100%)`;
  front.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}
function notesAt(x, y, n = 3) {
  if (!front) return;
  for (let i = 0; i < n; i += 1) {
    setTimeout(() => {
      const el = document.createElement('span');
      el.className = 'specter-note';
      el.textContent = ['♪', '♫', '♩'][i % 3];
      el.style.left = `${x + rand(-10, 18)}px`; el.style.top = `${y}px`;
      front.append(el);
      setTimeout(() => el.remove(), 1800);
    }, i * 420);
  }
}
// A mark over his head in the scene: «!» when he realizes, «?» when he wonders, «z» when he dozes.
function markAt(x, y, m) {
  if (!front) return;
  const el = document.createElement('span');
  el.className = `specter-mark m-${m === '!' ? 'bang' : m === '?' ? 'ask' : 'zz'}`;
  el.textContent = m === 'z' ? 'z' : m;
  el.style.left = `${x}px`; el.style.top = `${y - 26}px`;
  front.append(el);
  setTimeout(() => el.remove(), m === 'z' ? 2200 : 1300);
}
// The spin that hides him (out) or brings him back (in), with a puff of sparkles.
function spin(dir) {
  if (!nodo) return;
  nodo.el.classList.remove('spin-in', 'spin-out');
  void nodo.el.offsetWidth;
  nodo.el.classList.add(`spin-${dir}`);
  burst(nodo.x, nodo.y, 14);
  sfx.voice(dir === 'out' ? 'wink' : 'glad');
}
function comeBack() {
  if (!away || !nodo) return;
  const { door, timer } = away;
  clearTimeout(timer);
  away = null;
  nodo.x = door.x; nodo.y = door.y; nodo.vx = 0; nodo.vy = 0;
  nodo.gone = false; nodo.el.style.visibility = '';
  spin('in');
  render();
  setTimeout(() => { if (!nodo) return; nodo.el.classList.remove('spin-in'); mood('glad', 1200, true); specter.home(); }, 600);
  wake();
}
function playAt(c, asked = false) {
  if (!nodo || !c || away || nodo.gone) return false;
  const kind = c.dataset.prop;
  const now = performance.now();
  const free = STORY_IDS[kind].filter((id) => now - (decorDone[`${kind}:${id}`] ?? -Infinity) > DECOR_COOL);
  if (!free.length) {
    if (asked) { mood(kind === 'cake' ? 'dizzy' : 'shut', 1600); say(ENOUGH[kind][Math.floor(Math.random() * ENOUGH[kind].length)], 2000); }
    return false;
  }
  const story = free[Math.floor(Math.random() * free.length)];
  stopRoutine();
  if (nodo.place == null) nodo.place = asked ? nodo.grabbedFrom ?? nodo.x : nodo.home ?? nodo.x;
  // The door: the edge of the tile nearest to him.
  const r = c.getBoundingClientRect();
  const door = nodo.x < r.left ? { x: r.left - nodo.r * 0.4, y: r.top + r.height * 0.45 }
    : nodo.x > r.right ? { x: r.right + nodo.r * 0.4, y: r.top + r.height * 0.45 }
      : { x: Math.max(r.left + 30, Math.min(r.right - 30, nodo.x)), y: Math.max(90, r.top - nodo.r * 0.4) };
  away = { canvas: c, door, timer: 0 };
  specter.visit(door.x, door.y);
  mood('glad', 1200, true);
  setTimeout(() => {
    if (!away || drag || !nodo) return;
    spin('out');
    setTimeout(() => {
      if (!away || !nodo) return;
      nodo.el.classList.remove('spin-out');
      nodo.fly = null; nodo.gone = true; nodo.el.style.visibility = 'hidden';
      front.querySelector('.speech')?.remove();
      const started = actProp(c, 'story', { story, skin: specterSkin(), on: (ev) => {
        if (ev.say && ev.x !== undefined) { sceneSpeech(ev.say, ev.x, ev.y, ev.ms); sfx.babble(ev.say); }
        if (ev.notes && ev.x !== undefined) notesAt(ev.x, ev.y, ev.notes);
        if (ev.mark && ev.x !== undefined) markAt(ev.x, ev.y, ev.mark);
        if (ev.poof && ev.x !== undefined) burst(ev.x, ev.y, 10);
        if (ev.end) comeBack();
      } });
      if (!started) { comeBack(); return; }
      decorDone[`${kind}:${story}`] = performance.now();
      // Never lost in there: if the scene goes away (another page, the tile removed), he comes back anyway.
      away.timer = setTimeout(() => { actProp(c, 'stop'); comeBack(); }, 45000);
      const watchIt = setInterval(() => { if (!away) { clearInterval(watchIt); return; } if (!c.isConnected) { clearInterval(watchIt); comeBack(); } }, 1000);
    }, 550);
  }, 1100);
  return true;
}
function decorVisit() { return playAt(decorCanvas()); }
// Dropped on the decoration: he goes in.
function droppedOnDecor(x, y) {
  const c = placedDecor();
  if (!c) return false;
  const r = c.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  nodo.place = nodo.grabbedFrom ?? nodo.place;
  return playAt(c, true) || true;
}
// Where he dances: beside the radio (right of it if there is room, else left).
function danceSpot(el) {
  const r = el.getBoundingClientRect();
  const right = r.right + nodo.r * 1.2 < innerWidth;
  return { x: right ? r.right + nodo.r * 0.8 : r.left - nodo.r * 0.8, y: Math.min(innerHeight - nodo.r - 20, Math.max(90, r.top + r.height * 0.55)), r };
}
// When the radio plays, he comes to dance by it for a while: bouncing on the beat, swaying, hands up, notes; then back
// to his place. While the music goes on, he comes back now and then.
let music = { on: false, el: null, next: 0 };
let dancing = 0;
function danceBy() {
  const el = music.el;
  if (!music.on || !nodo || nodo.gone || away || drag || dancing || !el?.isConnected || !running()) return false;
  const { x, y, r } = danceSpot(el);
  if (!r.width || r.bottom < 80 || r.top > innerHeight - 40) return false;
  stopRoutine();
  if (nodo.place == null) nodo.place = nodo.home ?? nodo.x;
  specter.visit(x, y);
  const run = ++dancing;
  const beats = 22; const beat = 380;
  setTimeout(() => {
    if (run !== dancing || !nodo?.fly) { dancing = 0; return; }
    mood('glad', beats * beat, true); say(['¡A bailar!', '¡Esta me gusta!', '♪ ♫'][Math.floor(Math.random() * 3)], 1500);
    for (let i = 0; i < beats; i += 1) {
      setTimeout(() => {
        if (run !== dancing || !nodo?.fly) return;
        // The radio moved (dragged somewhere else): he goes with it, dancing.
        const to = danceSpot(el);
        if (Math.hypot(to.x - nodo.fly.x, to.y - nodo.fly.y) > 24) flyTo(to.x, to.y, { ms: 420, arc: 10 });
        const up = i % 2 === 0;
        pose({ y: up ? -14 : 0, rot: (i % 4 < 2 ? -1 : 1) * 10, scale: up ? 1.04 : 0.97, ms: beat * 0.9 });
        nodo.face.dataset.hands = i % 8 < 4 ? 'up' : 'wave';
        if (i % 6 === 0) notes(2);
        if (i === Math.floor(beats / 2)) mood('love', beat * 4, true);
      }, i * beat);
    }
    setTimeout(() => {
      if (run !== dancing) return;
      dancing = 0; pose({ ms: 300 }); nodo.face.dataset.hands = 'rest'; mood('wink', 900);
      if (nodo?.fly) specter.home();
      music.next = performance.now() + rand(60000, 120000);
    }, beats * beat + 200);
  }, 1100);
  return true;
}
let offTimer = 0;
addEventListener('studium-radio', (e) => {
  const was = music.on;
  music.on = !!e.detail?.on; music.el = e.detail?.el ?? music.el;
  clearTimeout(offTimer);
  if (music.on) { if (!dancing) setTimeout(danceBy, 1400); return; }
  if (!was) return;
  // Turned off (and still off a moment later: not just a change of station): he reacts.
  offTimer = setTimeout(() => {
    if (music.on || !nodo || nodo.gone || away) return;
    if (dancing) {
      dancing = 0; pose({ ms: 200 }); nodo.face.dataset.hands = 'cheeks';
      mood('sad', 2200); say(['¡Oye! Estaba bailando…', '¿Por qué la apagaste?', 'Ay, justo en la mejor parte.'][Math.floor(Math.random() * 3)], 2200);
      setTimeout(() => { if (nodo?.fly) specter.home(); }, 1600);
    } else if (running()) {
      mood('surprised', 1200); say(['¿Se acabó la música?', 'Mmm, silencio.', '¿Ya no hay radio?'][Math.floor(Math.random() * 3)], 1800);
    }
  }, 700);
});
// Dropped on the radio: he dances by it, and turns it on first if it was off.
function droppedOnRadio(x, y) {
  const el = document.getElementById('egg-radio');
  if (!el || el.classList.contains('waiting')) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || x < r.left - 10 || x > r.right + 10 || y < r.top - 10 || y > r.bottom + 10) return false;
  music.el = el;
  if (el.classList.contains('playing')) { music.on = true; danceBy(); }
  else { mood('glad', 1200, true); say('¡Pongamos música!', 1400); el.querySelector('[data-radio-play]')?.click(); }
  return true;
}
/* ---------- the medic's routines (when he wears that costume): doves, Archimedes, a checkup ---------- */
// A dove on the screen: a small 3D bird (props3d.js 'dove') that flies along an arc, perches, pecks, flies away.
function dove(x, y) {
  const el = document.createElement('div');
  el.className = 'dove';
  el.innerHTML = '<canvas class="prop" data-prop="dove" data-fixed data-flap="1" aria-hidden="true"></canvas>';
  front.append(el);
  props(el);
  const c = el.querySelector('canvas');
  const d = { el, x, y, set(px, py, face) { this.x = px; this.y = py; el.style.transform = `translate3d(${(px - 36).toFixed(1)}px, ${(py - 36).toFixed(1)}px, 0) scaleX(${face < 0 ? -1 : 1})`; } };
  d.set(x, y, 1);
  d.fly = (tx, ty, ms = 1400, lift = 70) => new Promise((res) => {
    const fx = d.x; const fy = d.y; const t0 = performance.now(); const face = tx < fx ? -1 : 1;
    c.dataset.flap = '1'; c.dataset.peck = ''; sfx.wings();
    const step = (now) => {
      if (!el.isConnected) { res(); return; }
      const k = Math.min(1, (now - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      d.set(fx + (tx - fx) * e, fy + (ty - fy) * e - Math.sin(k * Math.PI) * lift, face);
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  d.perch = () => { c.dataset.flap = ''; };
  d.peck = (on) => { c.dataset.peck = on ? '1' : ''; if (on) sfx.coo(); };
  d.gone = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
  return d;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MEDIC = {
  async archimedes() {
    const head = () => ({ x: nodo.x + 6, y: nodo.y - nodo.r * 0.95 });
    const b = dove(innerWidth + 60, Math.max(80, nodo.y - 260));
    await b.fly(head().x, head().y, 1700, 60);
    b.perch(); sfx.coo();
    mood('love', 1800, true); nodo.face.dataset.hands = 'cheeks'; say('¡Archimedes!', 1600);
    await wait(1800);
    b.peck(true); mood('surprised', 1200); nodo.face.dataset.hands = 'up'; say('¡Ay!', 900); nodo.sq = -0.12; wake();
    await wait(1300);
    b.peck(false); mood('angry', 2000); nodo.face.dataset.hands = 'hips'; say('¡Archimedes! ¡No!', 1700);
    await wait(900);
    b.fly(-80, Math.max(60, nodo.y - 300), 1600, 40).then(() => b.gone());
    await wait(1000);
    nodo.face.dataset.hands = 'shake'; say('Pájaro travieso…', 1500);
    await wait(1600);
    nodo.face.dataset.hands = 'rest'; mood('wink', 900);
  },
  async flock() {
    nodo.face.dataset.hands = 'up'; mood('glad', 2400, true); nodo.face.dataset.talk = '1'; sfx.voice('hum'); say('♪ Fiu, fiu…', 1500);
    await wait(900);
    nodo.face.dataset.talk = '';
    const birds = [[-60, 120], [innerWidth + 60, 160], [innerWidth / 2, -60]].map(([x, y]) => dove(x, y));
    const cx = nodo.x; const cy = nodo.y - nodo.r * 1.6;
    await Promise.all(birds.map((b, i) => b.fly(cx + Math.cos(i * 2.1) * 110, cy + Math.sin(i * 2.1) * 50, 1500 + i * 200, 50)));
    mood('love', 2000, true); nodo.face.dataset.hands = 'cheeks';
    for (let r = 0; r < 2; r += 1) await Promise.all(birds.map((b, i) => b.fly(cx + Math.cos(i * 2.1 + (r + 1) * 1.4) * 110, cy + Math.sin(i * 2.1 + (r + 1) * 1.4) * 50, 700, 15)));
    await Promise.all(birds.map((b, i) => b.fly(nodo.x + (i - 1) * 70 + (i === 1 ? 0 : 0), innerHeight - 30, 900, 10)));
    for (const b of birds) { b.perch(); b.peck(true); }
    say('Coman, coman.', 1500); nodo.face.dataset.hands = 'rest';
    await wait(2000);
    for (const [i, b] of birds.entries()) { b.peck(false); b.fly(i % 2 ? innerWidth + 80 : -80, 60 + i * 40, 1400, 60).then(() => b.gone()); }
    nodo.face.dataset.hands = 'wave'; say('¡Adiós!', 1200);
    await wait(1400);
    nodo.face.dataset.hands = 'rest';
  },
  async checkup() {
    nodo.face.dataset.hands = 'hold'; mood('', 3000, true); say('A ver ese pulso…', 1600);
    await wait(1200); sfx.heartbeat(); await wait(700); sfx.heartbeat(); await wait(900);
    mood('wink', 1400); nodo.face.dataset.hands = 'hips'; say('Mmm… todo en orden.', 1600);
    await wait(1500); nodo.face.dataset.hands = 'rest';
  },
};
let medicBusy = false;
function medicRoutine() {
  if (medicBusy || !nodo || nodo.gone || specterSkin() !== 'doctor') return false;
  const names = Object.keys(MEDIC);
  const pick = names[Math.floor(Math.random() * names.length)];
  medicBusy = true;
  MEDIC[pick]().catch(() => {}).finally(() => { medicBusy = false; if (nodo) nodo.face.dataset.hands = 'rest'; });
  return true;
}
let routineRun = 0;
function stopRoutine() {
  routineRun += 1;
  if (nodo) { pose({ ms: 200 }); nodo.face.dataset.talk = ''; }
}
function routine() {
  const now = performance.now();
  if (now - lastVisit > rand(6, 12) * 60000 && decorVisit()) { lastVisit = now; return; }
  if (music.on && now > music.next && danceBy()) return;
  // In his medic's costume, most of his little scenes are a medic's.
  if (specterSkin() === 'doctor' && Math.random() < 0.65 && medicRoutine()) return;
  const names = Object.keys(ROUTINES);
  const steps = ROUTINES[names[Math.floor(Math.random() * names.length)]];
  const run = ++routineRun;
  for (const [ms, fn] of steps) setTimeout(() => { if (run === routineRun && nodo && !drag && !nodo.fly && !nodo.gone) fn(); }, ms);
}
export function say(text, ms = 2600) {
  if (!nodo) return;
  front.querySelector('.speech')?.remove();
  const el = document.createElement('div');
  el.className = 'speech';
  el.textContent = text;
  front.append(el);
  nodo.speech = el;
  // He says it out loud, in his voice with no words.
  sfx.babble(text);
  // He moves his mouth while the words are on screen (about the time it takes to say them).
  nodo.face.dataset.talk = '1';
  clearTimeout(nodo.talking);
  nodo.talking = setTimeout(() => { if (nodo) nodo.face.dataset.talk = ''; }, Math.min(ms, 500 + text.length * 55));
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); if (nodo?.speech === el) nodo.speech = null; }, ms);
  render();
}

/* ---------- bubbles ---------- */
function bubble(x, y) {
  const el = document.createElement('div');
  el.className = 'bub';
  const r = rand(14, 30);
  el.style.width = el.style.height = `${Math.round(r * 2)}px`;
  el.innerHTML = '<i></i>';
  front.append(el);
  const b = { el, x, y, r, vx: rand(-10, 10), vy: rand(-60, -35), born: performance.now(), life: rand(12000, 18000), phase: rand(0, 6.28) };
  const burst = (e) => { e?.preventDefault?.(); pop(b); };
  el.addEventListener('pointerenter', burst);
  el.addEventListener('pointerdown', burst);
  bubbles.push(b);
}
function pop(b, silent = false) {
  if (b.gone) return;
  b.gone = true;
  bubbles = bubbles.filter((x) => x !== b);
  if (!silent) {
    sfx.pop();
    for (let i = 0; i < 7; i += 1) {
      const d = document.createElement('i');
      d.className = 'drop';
      d.style.left = `${b.x}px`; d.style.top = `${b.y}px`;
      front.append(d);
      const a = (i / 7) * Math.PI * 2;
      d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 0.9 }, { transform: `translate(calc(-50% + ${Math.cos(a) * b.r * 1.6}px), calc(-50% + ${Math.sin(a) * b.r * 1.6}px)) scale(.3)`, opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => d.remove();
    }
  }
  b.el.classList.add('popped');
  setTimeout(() => b.el.remove(), 220);
}

/* ---------- confetti ---------- */
const CONFETTI = ['var(--blue)', 'var(--red)', 'var(--butter)', 'var(--teal)', 'var(--sky)', 'var(--peach)'];
export function burst(x, y, n = 30) {
  if (still() || ambience === 'enfoque' || !front) return;
  for (let i = 0; i < n; i += 1) {
    const el = document.createElement('i');
    el.className = `confetti${i % 3 ? '' : ' round'}`;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.background = CONFETTI[i % CONFETTI.length];
    front.append(el);
    const a = -Math.PI / 2 + rand(-1.2, 1.2);
    const v = rand(180, 480);
    const dx = Math.cos(a) * v; const dy = Math.sin(a) * v;
    el.animate([
      { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7}px)) rotate(${rand(-200, 200)}deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 300}px)) rotate(${rand(-540, 540)}deg)`, opacity: 0 },
    ], { duration: rand(1000, 1500), easing: 'cubic-bezier(.15,.75,.35,1)' }).onfinish = () => el.remove();
  }
}
// A goal met: confetti where it happened, a chime, and Nodo cheers.
export function celebrate(x, y, all = false) {
  burst(x, y, all ? 60 : 30);
  if (all) sfx.fanfare(); else sfx.chime();
  if (nodo) {
    nodo.vy = -rand(160, 220);
    mood('glad', 1800);
    say(all ? '¡Todas tus metas! 🎉' : ['¡Bien!', '¡Una menos!', '¡Eso!', '¡Sigue así!'][Math.floor(Math.random() * 4)]);
    wake();
  }
}

/* ---------- grabbing ---------- */
// Phones and tablets: the layer is part of the page (see play.start), so a touch is measured from the page's top.
const inPage = () => matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const pageY = (y) => y + (back?.classList.contains('in-page') ? scrollY : 0);
function hit(x, y) {
  let best = null; let dist = Infinity;
  for (const b of bodies) {
    if (b.tier !== 0 || b.kind === 'nodo') continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < b.r * 1.08 && d < dist) { best = b; dist = d; }
  }
  return best;
}
function grab(b, e) {
  drag = { body: b, id: e.pointerId, ox: e.clientX - b.x, oy: e.clientY - b.y, moved: 0 };
  root.classList.add('grabbing');
  if (b.kind === 'nodo') { b.grabbedFrom = b.home ?? b.x; if (away && !b.gone) away = null; if (dancing) { dancing = 0; pose({ ms: 150 }); } stopRoutine(); mood('surprised', 99999); b.fly = null; }
  sfx.grab(b.r * 2);
  idleSince = performance.now();
  wake();
}
function release() {
  if (!drag) return;
  const b = drag.body;
  const speed = Math.hypot(pointer.vx, pointer.vy);
  const k = speed > 1100 ? 1100 / speed : 1;
  b.vx = pointer.vx * k * 0.8; b.vy = pointer.vy * k * 0.8;
  b.va += (pointer.vx / b.r) * 0.004;
  // Thrown hard he gets dizzy; let go gently, glad.
  if (b.kind === 'nodo') b.home = null;
  // Dropped on the decoration: he goes in (the grab's rubbing sound ends here too, or it would go on).
  if (b.kind === 'nodo' && drag.moved >= 4 && speed < 900 && (droppedOnCostume(b.x, b.y) || droppedOnRadio(b.x, b.y) || droppedOnDecor(b.x, b.y))) { sfx.release(0, b.r * 2); drag = null; root.classList.remove('grabbing'); return; }
  if (b.kind === 'nodo') { if (drag.moved < 4) poked(b); else if (speed > 900) { mood('dizzy', 2200); say(['¡Wiii!', 'Mareado…', '¡Otra vez!'][Math.floor(Math.random() * 3)], 1500); } else mood('glad', 900); }
  else if (drag.moved < 4) { b.vy -= 160; b.va += rand(-1, 1); }
  sfx.release(drag.moved < 4 ? 600 : speed, b.r * 2);
  drag = null;
  root.classList.remove('grabbing');
}
// Touch screens scroll with the same gesture, so there a tap flicks a token instead of dragging it.
function flick(b) { b.vy -= rand(180, 280); b.vx += rand(-90, 90); b.va += rand(-1.5, 1.5); b.sq = 0.08; sfx.release(600, b.r * 2); wake(); }

function onDown(e) {
  if (!running() || e.button > 0) return;
  if (e.target instanceof Element && e.target.closest(SOLID)) return;
  const b = hit(e.clientX, pageY(e.clientY));
  if (b) {
    if (e.pointerType === 'touch') { flick(b); return; }
    e.preventDefault();
    grab(b, e);
  } else if (ambience === 'jugueton' && e.pointerType !== 'touch') {
    if (bubblesOn && bubbles.length < 6) for (let i = 0; i < 2; i += 1) bubble(e.clientX + rand(-14, 14), e.clientY + rand(-8, 8));
    wake();
  }
}
function onMove(e) {
  const now = performance.now();
  pointer.trail.push({ t: now, x: e.clientX, y: e.clientY });
  while (pointer.trail.length > 2 && now - pointer.trail[0].t > 90) pointer.trail.shift();
  const first = pointer.trail[0];
  const dt = (now - first.t) / 1000;
  if (dt > 0.008) { pointer.vx = (e.clientX - first.x) / dt; pointer.vy = (e.clientY - first.y) / dt; }
  if (drag) { drag.moved += Math.abs(e.clientX - pointer.x) + Math.abs(e.clientY - pointer.y); sfx.drag(Math.hypot(pointer.vx, pointer.vy), pointer.vx); }
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.px = e.clientX / W - 0.5; pointer.py = e.clientY / H - 0.5;
  idleSince = now;
  if (nodo?.mood === 'sleep') { mood('', 0); nodo.el.dataset.mood = ''; nodo.face.dataset.mood = ''; }
  if (!running() || e.pointerType !== 'mouse') return;
  if (!drag) {
    const air = !(e.target instanceof Element && e.target.closest(SOLID));
    root.classList.toggle('can-grab', air && !!hit(e.clientX, e.clientY));
  }
  wake();
}

/* ---------- the simulation ---------- */
// A collision squashes a little and sounds by size and speed. What is held makes no sound when it pushes: dragging
// something through the others is silent, and only throws and falls ring.
function impact(b, speed, angle, other = null) {
  if (speed < 160) return;
  b.sq = Math.min(0.1, Math.max(b.sq, speed / 6000));
  b.sqa = angle;
  if (ambience === 'sereno' || drag?.body === b || (other && drag?.body === other)) return;
  const now = performance.now();
  if (now - (b.rang ?? 0) < 250) return;
  b.rang = now;
  sfx.impact(b.r * 2, speed);
}

function step(h, now) {
  const t = now / 1000;
  const wv = wander();
  for (const b of bodies) {
    if (drag?.body === b) {
      b.vx = (pointer.x - drag.ox - b.x) * 22;
      b.vy = (pointer.y - drag.oy - b.y) * 22;
    } else if (b.kind === 'nodo' && b.fly) {
      // Specter flies: toward where he was called (a hint, the tour's offer, out of the screen), along a playful arc,
      // bobbing once there.
      const f = b.fly;
      const p = Math.min(1, (now - f.t0) / f.ms);
      const ease = p < 1 ? 1 - (1 - p) ** 3 : 1;
      const arc = Math.sin(p * Math.PI) * f.arc;
      const tx = f.x0 + (f.x - f.x0) * ease + Math.cos(p * Math.PI * 2 * f.loops) * arc * 0.35 - (f.loops ? arc * 0.35 : 0);
      const ty = f.y0 + (f.y - f.y0) * ease - arc + Math.sin(p * Math.PI * 2 * f.loops) * arc * 0.35 + (p >= 1 ? Math.sin(t * 2.2) * 6 : 0);
      b.vx = (tx - b.x) / Math.max(h, 0.001) * 0.5; b.vy = (ty - b.y) / Math.max(h, 0.001) * 0.5;
      b.a = 0; b.va = 0;
      if (p >= 1 && f.then) { const then = f.then; f.then = null; then(); }
      if (f.until && now > f.until) { b.fly = null; b.home = b.place ?? Math.max(b.r + 20, Math.min(W - b.r - 20, b.x)); }
    } else if (b.kind === 'nodo') {
      // Nodo floats: it rests a little above the bottom edge, bobbing, and glides back there as if under water.
      const rest = H - b.r - 34 + Math.sin(t * 0.9) * 5;
      b.vy += (rest - b.y) * 5 * h;
      if (b.home != null) b.vx += (b.home - b.x) * 0.6 * h;
      const k = Math.exp(-2.4 * h); b.vx *= k; b.vy *= k;
      b.a = 0; b.va = 0;
    } else {
      const wx = Math.sin(t * 0.21 + b.phase) * wv; const wy = Math.cos(t * 0.17 + b.phase * 1.3) * wv;
      const ease = Math.min(1, 0.55 * h * (b.tier ? 1.6 : 1));
      b.vx += (wx - b.vx) * ease; b.vy += (wy - b.vy) * ease;
      b.va *= Math.exp(-1.6 * h);
    }
    b.x += b.vx * h; b.y += b.vy * h; b.a += b.va * h;
    b.sq *= Math.exp(-11 * h);
    if (b.fly?.out) continue; // flying out of the screen, the edges do not hold him
    const e = b.kind === 'nodo' ? 0.2 : 0.5;
    if (b.x < b.r) { b.x = b.r; if (b.vx < 0) { impact(b, -b.vx, 0); b.vx = -b.vx * e; } }
    if (b.x > W - b.r) { b.x = W - b.r; if (b.vx > 0) { impact(b, b.vx, 0); b.vx = -b.vx * e; } }
    if (b.y < b.r) { b.y = b.r; if (b.vy < 0) { impact(b, -b.vy, Math.PI / 2); b.vy = -b.vy * e; } }
    if (b.y > H - b.r) {
      b.y = H - b.r;
      if (b.vy > 0) { impact(b, b.vy, Math.PI / 2); b.vy = -b.vy * e; }
    }
  }
  // Collisions inside each depth; what is held pushes without being pushed.
  for (let i = 0; i < bodies.length; i += 1) {
    const p = bodies[i];
    for (let j = i + 1; j < bodies.length; j += 1) {
      const q = bodies[j];
      // Specter is a ghost: he goes through the floating things (only the bubbles burst on him).
      if (p.tier !== q.tier || p.kind === 'nodo' || q.kind === 'nodo') continue;
      const dx = q.x - p.x; const dy = q.y - p.y;
      const min = p.r + q.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2); const nx = dx / d; const ny = dy / d;
      const ip = drag?.body === p ? 0 : 1 / p.m; const iq = drag?.body === q ? 0 : 1 / q.m;
      if (!ip && !iq) continue;
      const overlap = min - d;
      p.x -= nx * overlap * (ip / (ip + iq)); p.y -= ny * overlap * (ip / (ip + iq));
      q.x += nx * overlap * (iq / (ip + iq)); q.y += ny * overlap * (iq / (ip + iq));
      const rvx = q.vx - p.vx; const rvy = q.vy - p.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn >= 0) continue;
      const jn = (-(1 + 0.55) * vn) / (ip + iq);
      p.vx -= jn * nx * ip; p.vy -= jn * ny * ip;
      q.vx += jn * nx * iq; q.vy += jn * ny * iq;
      const vt = rvx * -ny + rvy * nx;
      p.va -= (vt / p.r) * 0.08; q.va += (vt / q.r) * 0.08;
      const angle = Math.atan2(ny, nx);
      impact(p, -vn, angle, q); impact(q, -vn, angle, p);
    }
  }
  // Bubbles rise and sway, slowly; one Specter touches bursts.
  for (const b of [...bubbles]) {
    if (nodo && Math.hypot(b.x - nodo.x, b.y - nodo.y) < b.r + nodo.r * 0.9) { pop(b); continue; }
    b.vy = Math.max(b.vy - 4 * h, -70);
    b.x += (b.vx + Math.sin(t * 1.3 + b.phase) * 12) * h;
    b.y += b.vy * h;
    if (b.y < -b.r * 2 || now - b.born > b.life) pop(b, b.y < 0);
  }
  if (nodo) {
    // He stays where he is; where he was dropped becomes his place once he stops.
    if (nodo.home == null && Math.abs(nodo.vx) < 20 && !drag && !nodo.gone) nodo.home = nodo.x;
    if (!drag && !nodo.fly && !away && now > nodo.hop && nodo.mood !== 'sleep' && !nodo.gone) {
      routine();
      nodo.hop = now + rand(14000, 28000);
    }
    // A hop ends with a squash where he lands.
    if (nodo.hopping && nodo.vy > 0 && nodo.y >= H - nodo.r - 40) { nodo.hopping = false; nodo.sq = 0.14; nodo.sqa = 0; }
    if (nodo.mood && nodo.mood !== 'sleep' && now > nodo.moodUntil) { nodo.mood = ''; nodo.el.dataset.mood = ''; nodo.face.dataset.mood = ''; }
    if (!drag && !nodo.mood && !nodo.gone && !away && now - idleSince > 45000) { mood('sleep', 0); say('zzz…', 3000); }
  }
}

function render() {
  for (const b of bodies) {
    let x = b.x - b.r; let y = b.y - b.r;
    // A very slight parallax with the pointer: the far ones move a bit more.
    if (b.kind !== 'nodo') { const k = b.tier ? 14 : 6; x -= pointer.px * k; y -= pointer.py * k * 0.7; }
    const sq = b.sq; const sqa = b.sqa;
    const squash = Math.abs(sq) > 0.003 ? ` rotate(${sqa.toFixed(3)}rad) scale(${(1 + sq).toFixed(3)}, ${(1 - sq).toFixed(3)}) rotate(${(-sqa).toFixed(3)}rad)` : '';
    const spin = b.spin ? Math.max(0, 1 - (performance.now() - b.spin) / 600) : 0;
    if (b.spin && !spin) b.spin = 0;
    b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${squash}${spin ? ` rotate(${((1 - spin) * 360).toFixed(1)}deg)` : ''}`;
    // Only the glyph turns; the light and the shadow of the glass stay where the light is.
    if (Math.abs((b.shownA ?? 0) - b.a) > 0.01) { b.shownA = b.a; b.el.style.setProperty('--a', `${b.a.toFixed(3)}rad`); }
  }
  for (const b of bubbles) b.el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, 0)`;
  if (nodo) {
    const dx = pointer.x - nodo.x; const dy = pointer.y - nodo.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / 160) * 2.6;
    // Looking around (a routine): left, right, and back to the pointer.
    const la = nodo.lookAt ? (performance.now() - nodo.lookAt) / 2600 : 1;
    nodo.face.dataset.look = la < 1 ? (Math.sin(la * Math.PI * 2) * 0.9).toFixed(2) : ((dx / len) * (k / 2.6)).toFixed(2);
    if (nodo.speech) nodo.speech.style.transform = `translate3d(${(nodo.x).toFixed(1)}px, ${(nodo.y - nodo.r - 14).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}

// While the page scrolls, nothing here moves: the browser only has to scroll. At rest, when nothing is held, thrown
// or popping, the slow drift is drawn at half the frame rate, and at a quarter once the pointer has been still for a
// few seconds: each drawn frame makes the browser restyle and recompose the floating things.
let scrollingUntil = 0;
let skip = 0;
const busy = () => !!nodo?.fly || !!drag || bubbles.length > 0 || bodies.some((b) => Math.abs(b.vx) + Math.abs(b.vy) > 40 || Math.abs(b.sq) > 0.01 || b.spin);
function frame(now) {
  raf = 0;
  if (!running()) return;
  if ((now < scrollingUntil && !drag) || (!busy() && (++skip % (now - idleSince > 5000 ? 4 : 2)))) { last = now; raf = requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const n = 2;
  for (let i = 0; i < n; i += 1) step(dt / n, now);
  if (ambience === 'jugueton' && bubblesOn && now > nextBubble && bubbles.length < 3) {
    bubble(rand(40, W - 40), H + 30);
    nextBubble = now + rand(20000, 35000);
  }
  render();
  raf = requestAnimationFrame(frame);
}
function wake() { if (!raf && running()) { last = performance.now(); raf = requestAnimationFrame(frame); } }

/* ---------- Specter flies: to a hint, out of the screen and back ---------- */
// Where he is called: (x, y) on the screen, in `ms`; he stays there `stay` ms (0: until he is sent home) and then goes
// home. `loops` makes the way playful (a loop in the air).
function flyTo(x, y, { ms = 900, stay = 0, loops = 0, arc = 60, out = false, then = null } = {}) {
  if (!nodo) return false;
  stopRoutine();
  const now = performance.now();
  nodo.fly = { x0: nodo.x, y0: nodo.y, x, y, t0: now, ms, until: stay ? now + ms + stay : 0, loops, arc, out, then };
  idleSince = now;
  if (nodo.mood === 'sleep') { nodo.mood = ''; nodo.el.dataset.mood = ''; nodo.face.dataset.mood = ''; }
  wake();
  return true;
}
/* ---------- his costumes: dragged onto him (or he onto them), he puts one on; again, he takes it off ---------- */
export function wearCostume(id) {
  if (!skinOpen(id)) return;
  const off = specterSkin() === id;
  setSpecterSkin(off ? '' : id);
  if (!nodo || nodo.gone) return;
  stopRoutine();
  spin('in');
  setTimeout(() => nodo?.el.classList.remove('spin-in'), 600);
  sfx.voice(off ? 'wink' : 'glad');
  mood(off ? 'wink' : 'love', 1600, true);
  say(off ? 'Mejor así.' : id === 'doctor' ? '¡Listo para curar!' : '¡Me queda bien!', 1700);
  wake();
}
// Specter dropped on a costume of the Easter eggs.
function droppedOnCostume(x, y) {
  for (const el of document.querySelectorAll('[data-costume]')) {
    const r = el.getBoundingClientRect();
    if (r.width && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) { wearCostume(el.dataset.costume); return true; }
  }
  return false;
}
// A costume dragged onto him: it follows the hand; let go over him, he wears it; elsewhere, it goes back.
function costumeDrag(e) {
  const item = e.target.closest?.('[data-costume]');
  if (!item || e.button !== 0) return;
  const start = { x: e.clientX, y: e.clientY };
  let moved = false;
  const move = (ev) => {
    const dx = ev.clientX - start.x; const dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    if (!moved) { moved = true; item.classList.add('dragging-costume'); }
    item.style.translate = `${dx}px ${dy}px`;
    const r = nodo?.el.getBoundingClientRect();
    item.classList.toggle('over-specter', !!r && !nodo.gone && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom);
  };
  const up = (ev) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (!moved) return;
    const r = nodo?.el.getBoundingClientRect();
    const onHim = !!r && !nodo.gone && ev.clientX > r.left - 10 && ev.clientX < r.right + 10 && ev.clientY > r.top - 10 && ev.clientY < r.bottom + 10;
    item.classList.remove('dragging-costume', 'over-specter');
    item.style.translate = '';
    if (onHim) wearCostume(item.dataset.costume);
    // A drag is not a press: the click that follows does nothing.
    item.addEventListener('click', (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
document.addEventListener('pointerdown', costumeDrag);

// Only one Specter on screen: when something else shows him (the tour), the one of the page spins away, and comes
// back to his place when it ends. Nested callers are counted.
let held = 0;
function leavePage() {
  held += 1;
  if (!nodo || nodo.gone) return;
  stopRoutine();
  if (dancing) { dancing = 0; pose({ ms: 150 }); }
  nodo.fly = null;
  spin('out');
  setTimeout(() => { if (!nodo || held === 0) return; nodo.el.classList.remove('spin-out'); nodo.gone = true; nodo.el.style.visibility = 'hidden'; front?.querySelector('.speech')?.remove(); }, 550);
}
function returnToPage() {
  held = Math.max(0, held - 1);
  if (held || !nodo || away) return;
  if (!nodo.gone) { nodo.el.classList.remove('spin-out'); return; }
  nodo.x = Math.max(nodo.r + 20, Math.min(W - nodo.r - 20, nodo.place ?? nodo.home ?? nodo.x)); nodo.y = H - nodo.r - 34; nodo.vx = 0; nodo.vy = 0;
  nodo.home = nodo.x;
  nodo.gone = false; nodo.el.style.visibility = '';
  spin('in'); render();
  setTimeout(() => { nodo?.el.classList.remove('spin-in'); mood('glad', 1000, true); }, 600);
  wake();
}

export const specter = {
  // Away from the page while something else shows him (the tour), and back.
  leave: () => leavePage(),
  comeBack: () => returnToPage(),
  // Is he on screen (the playful ambience, moving)?
  here: () => !!nodo && running() && !nodo.gone && !away,
  // Where he is, on the screen.
  at: () => (nodo ? { x: nodo.x, y: nodo.y, r: nodo.r } : null),
  visit(x, y, stay = 0) { if (nodo && !nodo.fly) nodo.place = nodo.home ?? nodo.x; return flyTo(Math.max(nodo?.r ?? 40, Math.min(W - (nodo?.r ?? 40), x)), Math.max(70, Math.min(H - (nodo?.r ?? 40), y)), { ms: 900, stay, arc: 40 }); },
  home() { if (!nodo) return; if (nodo.gone) { this.back(); return; } nodo.fly = null; if (nodo.place != null) nodo.home = nodo.place; wake(); },
  // Out of the screen, waving, with a loop; `back` in a while, flying in from the other side.
  away(backIn = 0) {
    if (!nodo) return;
    mood('wink', 1400);
    nodo.place = nodo.home ?? nodo.x; // he comes back to his own place
    const right = nodo.x > W / 2;
    flyTo(right ? W + 120 : -120, -100, { ms: 1300, loops: 1, arc: 90, out: true, then: () => { nodo.gone = true; nodo.el.style.visibility = 'hidden'; } });
    if (backIn) setTimeout(() => specter.back(), backIn);
  },
  back() {
    if (!nodo) return;
    const fromLeft = Math.random() < 0.5;
    nodo.gone = false; nodo.el.style.visibility = '';
    nodo.x = fromLeft ? -80 : W + 80; nodo.y = H * 0.35;
    const home = Math.max(nodo.r + 20, Math.min(W - nodo.r - 20, nodo.place ?? W * 0.14));
    nodo.home = home;
    flyTo(home, H - nodo.r - 34, { ms: 1600, loops: 1, arc: 110, stay: 1, then: () => { mood('glad', 1600); say(['¡Volví!', '¡Aquí estoy!', 'Boo. ¿Me extrañaste?'][Math.floor(Math.random() * 3)], 1800); sfx.boing(2); } });
  },
  // One of the medic's scenes now (in that costume).
  medic: (name) => { if (name && MEDIC[name] && !medicBusy && nodo && !nodo.gone) { medicBusy = true; MEDIC[name]().catch(() => {}).finally(() => { medicBusy = false; }); return true; } return medicRoutine(); },
  // Into the decoration of Inicio now (its stories still wait their turn).
  decor: () => playAt(placedDecor(), true),
  say: (text, ms) => say(text, ms),
  mood: (name, ms) => mood(name, ms),
};

export const play = {
  start(backLayer, frontLayer) {
    back = backLayer; front = frontLayer;
    ambience = root.dataset.ambience || 'vivo';
    back.classList.toggle('in-page', inPage());
    build();
    addEventListener('scroll', () => { scrollingUntil = performance.now() + 180; }, { passive: true });
    addEventListener('pointerdown', onDown, { passive: false });
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) release(); });
    addEventListener('pointercancel', () => release());
    addEventListener('resize', () => {
      const grew = Math.abs(innerWidth - W) > 160;
      W = innerWidth; H = innerHeight;
      if (grew) build(); else wake();
    });
    document.addEventListener('visibilitychange', wake);
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { build(); wake(); });
    wake();
  },
  setBubbles(on) { bubblesOn = !!on; if (!on) for (const b of [...bubbles]) pop(b, true); },
  setAmbience(name) {
    if (name === ambience) return;
    ambience = name;
    if (back) { build(); wake(); }
  },
  // The map and the guide reader need the whole screen still.
  setQuiet(on) { quiet = on; if (!on) wake(); },
};

/* ---------- the wordmark: letters on springs ---------- */
export function springLetters(el) {
  if (!el) return;
  const letters = [...el.querySelectorAll('.g')].map((g, i) => ({ g, i, x: 0, y: 0, vx: 0, vy: 0, hold: null }));
  let frameId = 0;
  const tick = () => {
    frameId = 0;
    const h = 1 / 60;
    let moving = false;
    for (const L of letters) {
      if (L.hold) { L.vx = (L.hold.x - L.x) * 18; L.vy = (L.hold.y - L.y) * 18; }
      else { L.vx += (-L.x * 230 - L.vx * 8.5) * h; L.vy += (-L.y * 230 - L.vy * 8.5) * h; }
      L.x += L.vx * h; L.y += L.vy * h;
      if (L.hold || Math.abs(L.x) + Math.abs(L.y) + Math.abs(L.vx) * 0.02 + Math.abs(L.vy) * 0.02 > 0.2) moving = true;
      else { L.x = 0; L.y = 0; L.vx = 0; L.vy = 0; }
      L.g.style.translate = `${L.x.toFixed(1)}px ${L.y.toFixed(1)}px`;
      L.g.style.rotate = `${Math.max(-35, Math.min(35, L.vx * 0.02 + L.x * 0.06)).toFixed(1)}deg`;
    }
    if (moving) frameId = requestAnimationFrame(tick);
  };
  const go = () => { if (!frameId) frameId = requestAnimationFrame(tick); };
  for (const L of letters) {
    let start = null;
    L.g.addEventListener('pointerdown', (e) => {
      if (still()) return;
      e.preventDefault();
      L.g.setPointerCapture(e.pointerId);
      start = { x: e.clientX - L.x, y: e.clientY - L.y, moved: 0 };
      L.hold = { x: L.x, y: L.y };
      sfx.grab(30); go();
    });
    L.g.addEventListener('pointermove', (e) => {
      if (!L.hold) return;
      let x = e.clientX - start.x; let y = e.clientY - start.y;
      const d = Math.hypot(x, y); const max = 240;
      if (d > max) { x = (x / d) * (max + (d - max) * 0.2); y = (y / d) * (max + (d - max) * 0.2); }
      start.moved += Math.abs(x - L.hold.x) + Math.abs(y - L.hold.y);
      sfx.drag(Math.hypot(x - L.hold.x, y - L.hold.y) * 60, (x - L.hold.x) * 60);
      L.hold = { x, y };
    });
    const let_go = () => {
      if (!L.hold) return;
      if (start.moved < 4) L.vy = -520;
      L.hold = null;
      sfx.release(0, 30);
      sfx.note(L.i);
      go();
    };
    L.g.addEventListener('pointerup', let_go);
    L.g.addEventListener('pointercancel', let_go);
  }
  // A first nudge, so that it is clear the letters can move.
  setTimeout(() => { if (still()) return; const L = letters[3]; if (L && !L.hold) { L.vy = -360; go(); } }, 2400);
}
