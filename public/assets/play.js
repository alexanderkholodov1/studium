// Things that float: glass tokens of every subject drifting in two depths behind the page, which the person can grab,
// throw and knock into each other; and, in the playful ambience, Nodo (a small companion that lives on the bottom edge,
// watches the pointer and hops) and bubbles to pop. Also the confetti of a met goal and the springy letters of the
// wordmark. Everything is DOM moved with transforms; nothing runs when the person prefers reduced motion or focus.
import { sfx } from './sfx.js';

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

const NODO = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <radialGradient id="nodo-glass" cx="36%" cy="28%" r="78%"><stop offset="0" stop-color="#f4f7ff" stop-opacity=".95"/><stop offset=".32" stop-color="#a9c0ff" stop-opacity=".62"/><stop offset=".78" stop-color="#4f7dff" stop-opacity=".72"/><stop offset="1" stop-color="#1b3aa6" stop-opacity=".95"/></radialGradient>
    <radialGradient id="nodo-core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff8a6b" stop-opacity=".7"/><stop offset=".6" stop-color="#ff5241" stop-opacity=".16"/><stop offset="1" stop-color="#ff5241" stop-opacity="0"/></radialGradient>
    <linearGradient id="nodo-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>
  </defs>
  <circle cx="50" cy="50" r="45" fill="url(#nodo-glass)"/>
  <circle class="ball" cx="50" cy="64" r="24" fill="url(#nodo-core)"/>
  <ellipse cx="50" cy="87" rx="25" ry="5" fill="#fff" opacity=".22"/>
  <circle cx="50" cy="50" r="44.3" fill="none" stroke="url(#nodo-rim)" stroke-width="1.5"/>
  <ellipse cx="33" cy="25" rx="14" ry="6.5" fill="#fff" opacity=".6" transform="rotate(-30 33 25)"/>
  <circle cx="63" cy="17" r="2.6" fill="#fff" opacity=".8"/>
  <g class="open"><g class="eye"><g class="pupil"><rect x="34.5" y="42" width="9" height="15" rx="4.5" fill="#0b1020" opacity=".86"/><circle class="glint" cx="40.6" cy="46" r="1.7" fill="#fff"/></g></g>
    <g class="eye"><g class="pupil"><rect x="56.5" y="42" width="9" height="15" rx="4.5" fill="#0b1020" opacity=".86"/><circle class="glint" cx="62.6" cy="46" r="1.7" fill="#fff"/></g></g></g>
  <path class="glad" d="M34 51q5-6 10 0M56 51q5-6 10 0" fill="none" stroke="#0b1020" stroke-opacity=".86" stroke-width="3.2" stroke-linecap="round"/>
  <path class="shut" d="M34 51h10M56 51h10" stroke="#0b1020" stroke-opacity=".86" stroke-width="3.2" stroke-linecap="round"/>
  <ellipse cx="29" cy="61" rx="5" ry="2.8" fill="#ff5241" opacity=".35"/><ellipse cx="71" cy="61" rx="5" ry="2.8" fill="#ff5241" opacity=".35"/>
  <path class="mouth" d="M46 63q4 3.5 8 0" fill="none" stroke="#0b1020" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

let back = null;
let front = null;
let W = innerWidth;
let H = innerHeight;
let bodies = [];
let bubbles = [];
let nodo = null;
let ambience = 'vivo';
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
  el.innerHTML = NODO;
  el.title = 'Nodo';
  front.append(el);
  const r = W < 720 ? 30 : 38;
  el.style.width = el.style.height = `${r * 2}px`;
  nodo = { el, x: Math.min(W - r - 20, Math.max(r + 20, W * 0.12)), y: H - r - 34, vx: 0, vy: 0, r, m: r * r * 1.4, a: 0, va: 0, tier: 0, phase: 0, sq: 0, sqa: 0, kind: 'nodo',
    hop: performance.now() + rand(3000, 6000), blink: performance.now() + rand(1500, 4000), mood: '', moodUntil: 0, pupils: [...el.querySelectorAll('.pupil')] };
  bodies.push(nodo);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); grab(nodo, e); });
  setTimeout(() => say('Hola. Puedes moverme.'), 1600);
}
function mood(name, ms) {
  if (!nodo) return;
  nodo.mood = name; nodo.moodUntil = performance.now() + ms;
  nodo.el.dataset.mood = name;
}
export function say(text, ms = 2600) {
  if (!nodo) return;
  front.querySelector('.speech')?.remove();
  const el = document.createElement('div');
  el.className = 'speech';
  el.textContent = text;
  front.append(el);
  nodo.speech = el;
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); if (nodo?.speech === el) nodo.speech = null; }, ms);
  render();
}

/* ---------- bubbles ---------- */
function bubble(x, y) {
  const el = document.createElement('div');
  el.className = 'bub';
  const r = rand(11, 27);
  el.style.width = el.style.height = `${Math.round(r * 2)}px`;
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
  if (b.kind === 'nodo') { mood('glad', 99999); sfx.pick(); } else sfx.pick();
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
  if (b.kind === 'nodo') { mood('glad', 900); sfx.drop(); }
  else if (drag.moved < 4) { b.vy -= 160; b.va += rand(-1, 1); sfx.boing(Math.floor(rand(0, 5))); }
  else sfx.drop();
  drag = null;
  root.classList.remove('grabbing');
}
// Touch screens scroll with the same gesture, so there a tap flicks a token instead of dragging it.
function flick(b) { b.vy -= rand(180, 280); b.vx += rand(-90, 90); b.va += rand(-1.5, 1.5); b.sq = 0.08; sfx.boing(Math.floor(rand(0, 5))); wake(); }

function onDown(e) {
  if (!running() || e.button > 0) return;
  if (e.target instanceof Element && e.target.closest(SOLID)) return;
  const b = hit(e.clientX, pageY(e.clientY));
  if (b) {
    if (e.pointerType === 'touch') { flick(b); return; }
    e.preventDefault();
    grab(b, e);
  } else if (ambience === 'jugueton' && e.pointerType !== 'touch') {
    for (let i = 0; i < 3; i += 1) bubble(e.clientX + rand(-14, 14), e.clientY + rand(-8, 8));
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
  if (drag) drag.moved += Math.abs(e.clientX - pointer.x) + Math.abs(e.clientY - pointer.y);
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.px = e.clientX / W - 0.5; pointer.py = e.clientY / H - 0.5;
  idleSince = now;
  if (nodo?.mood === 'sleep') { mood('', 0); nodo.el.dataset.mood = ''; }
  if (!running() || e.pointerType !== 'mouse') return;
  if (!drag) {
    const air = !(e.target instanceof Element && e.target.closest(SOLID));
    root.classList.toggle('can-grab', air && !!hit(e.clientX, e.clientY));
  }
  wake();
}

/* ---------- the simulation ---------- */
function impact(b, speed, angle) {
  if (speed < 160) return;
  b.sq = Math.min(0.1, Math.max(b.sq, speed / 6000));
  b.sqa = angle;
  if (speed > 380 && ambience !== 'sereno') sfx.knock(b.r, speed);
}

function step(h, now) {
  const t = now / 1000;
  const wv = wander();
  for (const b of bodies) {
    if (drag?.body === b) {
      b.vx = (pointer.x - drag.ox - b.x) * 22;
      b.vy = (pointer.y - drag.oy - b.y) * 22;
    } else if (b.kind === 'nodo') {
      // Nodo floats: it rests a little above the bottom edge, bobbing, and glides back there as if under water.
      const rest = H - b.r - 34 + Math.sin(t * 0.9) * 5;
      b.vy += (rest - b.y) * 5 * h;
      b.vx += ((b.home ?? b.x) - b.x) * 0.6 * h;
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
      if (p.tier !== q.tier) continue;
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
      impact(p, -vn, angle); impact(q, -vn, angle);
    }
  }
  // Bubbles rise and sway, slowly.
  for (const b of [...bubbles]) {
    b.vy = Math.max(b.vy - 4 * h, -70);
    b.x += (b.vx + Math.sin(t * 1.3 + b.phase) * 12) * h;
    b.y += b.vy * h;
    if (b.y < -b.r * 2 || now - b.born > b.life) pop(b, b.y < 0);
  }
  if (nodo) {
    // Now and then it drifts to another spot along the bottom, slowly.
    if (!drag && now > nodo.hop && nodo.mood !== 'sleep') {
      nodo.home = Math.max(nodo.r + 20, Math.min(W - nodo.r - 20, (nodo.home ?? nodo.x) + rand(-160, 160)));
      nodo.hop = now + rand(9000, 18000);
    }
    if (now > nodo.blink) { nodo.el.classList.add('blink'); setTimeout(() => nodo?.el.classList.remove('blink'), 140); nodo.blink = now + rand(2200, 6000); }
    if (nodo.mood && nodo.mood !== 'sleep' && now > nodo.moodUntil) { nodo.mood = ''; nodo.el.dataset.mood = ''; }
    if (!drag && !nodo.mood && now - idleSince > 45000) { nodo.mood = 'sleep'; nodo.el.dataset.mood = 'sleep'; say('zzz…', 3000); }
  }
}

function render() {
  for (const b of bodies) {
    let x = b.x - b.r; let y = b.y - b.r;
    // A very slight parallax with the pointer: the far ones move a bit more.
    if (b.kind !== 'nodo') { const k = b.tier ? 14 : 6; x -= pointer.px * k; y -= pointer.py * k * 0.7; }
    const squash = b.sq > 0.003 ? ` rotate(${b.sqa.toFixed(3)}rad) scale(${(1 + b.sq).toFixed(3)}, ${(1 - b.sq).toFixed(3)}) rotate(${(-b.sqa).toFixed(3)}rad)` : '';
    b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${squash}`;
    // Only the glyph turns; the light and the shadow of the glass stay where the light is.
    if (Math.abs((b.shownA ?? 0) - b.a) > 0.01) { b.shownA = b.a; b.el.style.setProperty('--a', `${b.a.toFixed(3)}rad`); }
  }
  for (const b of bubbles) b.el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, 0)`;
  if (nodo) {
    const dx = pointer.x - nodo.x; const dy = pointer.y - nodo.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / 160) * 2.6;
    for (const p of nodo.pupils) p.style.transform = `translate(${((dx / len) * k).toFixed(2)}px, ${((dy / len) * k).toFixed(2)}px)`;
    if (nodo.speech) nodo.speech.style.transform = `translate3d(${(nodo.x).toFixed(1)}px, ${(nodo.y - nodo.r - 14).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}

// While the page scrolls, nothing here moves: the browser only has to scroll. At rest, when nothing is held, thrown
// or popping, the slow drift is drawn at half the frame rate.
let scrollingUntil = 0;
let parity = 0;
const busy = () => !!drag || bubbles.length > 0 || bodies.some((b) => Math.abs(b.vx) + Math.abs(b.vy) > 40 || b.sq > 0.01);
function frame(now) {
  raf = 0;
  if (!running()) return;
  if ((now < scrollingUntil && !drag) || (!busy() && (parity ^= 1))) { last = now; raf = requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const n = 2;
  for (let i = 0; i < n; i += 1) step(dt / n, now);
  if (ambience === 'jugueton' && now > nextBubble) {
    bubble(rand(40, W - 40), H + 30);
    nextBubble = now + rand(9000, 16000);
  }
  render();
  raf = requestAnimationFrame(frame);
}
function wake() { if (!raf && running()) { last = performance.now(); raf = requestAnimationFrame(frame); } }

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
      sfx.pick(); go();
    });
    L.g.addEventListener('pointermove', (e) => {
      if (!L.hold) return;
      let x = e.clientX - start.x; let y = e.clientY - start.y;
      const d = Math.hypot(x, y); const max = 240;
      if (d > max) { x = (x / d) * (max + (d - max) * 0.2); y = (y / d) * (max + (d - max) * 0.2); }
      start.moved += Math.abs(x - L.hold.x) + Math.abs(y - L.hold.y);
      L.hold = { x, y };
    });
    const let_go = () => {
      if (!L.hold) return;
      if (start.moved < 4) L.vy = -520;
      L.hold = null;
      sfx.note(L.i);
      go();
    };
    L.g.addEventListener('pointerup', let_go);
    L.g.addEventListener('pointercancel', let_go);
  }
  // A first nudge, so that it is clear the letters can move.
  setTimeout(() => { if (still()) return; const L = letters[3]; if (L && !L.hold) { L.vy = -360; go(); } }, 2400);
}
