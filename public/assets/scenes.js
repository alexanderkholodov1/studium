// The three scenes of the landing page that show what is inside, each with its own background and its own play:
// your AI (particles orbiting a core that only you can reach), the knowledge graph (a note is anonymized and becomes
// nodes you can drag), and your guides (one guide changing style, and one section rewritten by the AI as you watch).
// Each scene runs only while it is on screen, and stays still when the person prefers reduced motion or focus.
import { sfx } from './sfx.js';
import { t } from './i18n.js';

const root = document.documentElement;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || root.dataset.ambience === 'enfoque';
const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();
const rand = (a, b) => a + Math.random() * (b - a);

function visible(el, start, stop) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0.12 }).observe(el);
}
function fitCanvas(canvas) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

/* ---------- 1. your AI: a core, its particles, and a creator who cannot get in ---------- */
function aiScene(el) {
  const canvas = el.querySelector('canvas');
  const me = el.querySelector('.ak-chip');
  const note = el.querySelector('.ak-note');
  let size = fitCanvas(canvas);
  let palette = ['--blue', '--sky', '--teal'];
  let parts = [];
  let raf = 0; let t0 = 0;
  const pointer = { x: -1e4, y: -1e4 };
  const seed = () => {
    parts = Array.from({ length: Math.round(Math.min(260, size.w * size.h / 1800)) }, (_, i) => ({
      a: rand(0, Math.PI * 2), r: rand(46, Math.min(size.w, size.h) * 0.46), s: rand(0.15, 0.6) * (Math.random() < 0.5 ? -1 : 1),
      z: rand(0.3, 1), c: i % 3, x: 0, y: 0, vx: 0, vy: 0,
    }));
  };
  seed();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    const { ctx, w, h } = size;
    const cx = w / 2; const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    const colors = palette.map(css);
    // The core: a soft sphere that breathes.
    const R = 34 + Math.sin(t * 1.6) * 3;
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, 2, cx, cy, R * 2.6);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, colors[0]); g.addColorStop(0.55, `${colors[0]}33`); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.a += p.s * 0.01 * (1.4 - p.z);
      let tx = cx + Math.cos(p.a) * p.r; let ty = cy + Math.sin(p.a) * p.r * 0.62;
      // The pointer pulls the nearby particles into a swirl.
      const dx = pointer.x - tx; const dy = pointer.y - ty; const d = Math.hypot(dx, dy);
      if (d < 140) { tx += (dx / d) * (140 - d) * 0.35 - dy / d * 18; ty += (dy / d) * (140 - d) * 0.35 + dx / d * 18; }
      p.vx += (tx - p.x) * 0.08; p.vy += (ty - p.y) * 0.08; p.vx *= 0.78; p.vy *= 0.78;
      p.x += p.vx; p.y += p.vy;
      ctx.fillStyle = colors[p.c];
      ctx.globalAlpha = 0.35 + p.z * 0.55;
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.8 + p.z * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
  const start = () => { if (!raf && !calm()) { t0 = performance.now(); raf = requestAnimationFrame(frame); } else if (calm()) { frame(performance.now()); cancelAnimationFrame(raf); raf = 0; } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  visible(el, start, stop);
  // The page may be hidden when this runs: measure again whenever the canvas gets a size.
  new ResizeObserver(() => { const w = size.w; size = fitCanvas(canvas); if (Math.abs(size.w - w) > 40 || !parts.length) seed(); }).observe(canvas);
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; });
  canvas.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1e4; });
  el.querySelectorAll('[data-ai-pick]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-ai-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    palette = b.dataset.aiPick.split(',');
    for (const p of parts) p.r *= rand(0.7, 1.3);
    sfx.tick();
  }));
  // The creator's chip: drag it into the core and the shield throws it back.
  let hold = null; let pos = { x: 0, y: 0 }; let spring = 0;
  const place = () => { me.style.translate = `${pos.x}px ${pos.y}px`; };
  me.addEventListener('pointerdown', (e) => { me.setPointerCapture(e.pointerId); hold = { x: e.clientX - pos.x, y: e.clientY - pos.y }; sfx.pick(); });
  me.addEventListener('pointermove', (e) => {
    if (!hold) return;
    pos = { x: e.clientX - hold.x, y: e.clientY - hold.y }; place();
    const r = canvas.getBoundingClientRect(); const m = me.getBoundingClientRect();
    if (Math.hypot(m.left + m.width / 2 - (r.left + r.width / 2), m.top + m.height / 2 - (r.top + r.height / 2)) < 110) {
      hold = null;
      el.classList.remove('shield'); void el.offsetWidth; el.classList.add('shield');
      note.classList.remove('show'); void note.offsetWidth; note.classList.add('show');
      sfx.boing(0);
      cancelAnimationFrame(spring);
      const back = () => { pos.x *= 0.82; pos.y *= 0.82; place(); if (Math.abs(pos.x) + Math.abs(pos.y) > 0.5) spring = requestAnimationFrame(back); else { pos = { x: 0, y: 0 }; place(); } };
      back();
    }
  });
  const drop = () => { hold = null; };
  me.addEventListener('pointerup', drop); me.addEventListener('pointercancel', drop);
}

/* ---------- 2. the graph: a note goes in anonymous and comes out as concepts ---------- */
const NOTES = [
  { title: 'Apuntes · Redes de Computadores', lines: [['Nombre: Camila R.', true], ['Nota del parcial: 17/20', true], ['Una /26 deja 64 direcciones: 62 para hosts.', false], ['OSPF usa Dijkstra; RIP, vector de distancia.', false]],
    concepts: ['Subredes', 'Máscara /26', 'OSPF', 'Dijkstra', 'RIP'], links: [[0, 1], [2, 3], [2, 4], [0, 2]] },
  { title: 'Deber · Biología Celular', lines: [['Estudiante: J. Pérez · 00213', true], ['Comentario del profe: «revisa la fase 3»', true], ['Mitosis: profase, metafase, anafase, telofase.', false], ['La meiosis reduce a la mitad los cromosomas.', false]],
    concepts: ['Mitosis', 'Metafase', 'Meiosis', 'Cromosomas'], links: [[0, 1], [2, 3], [0, 3]] },
  { title: 'Examen · Estadística', lines: [['Correo: alumno@universidad.edu', true], ['Calificación: 8,5', true], ['IC 95 %: media ± 1,96·σ/√n.', false], ['p < 0,05 → se rechaza H0.', false]],
    concepts: ['Intervalo de confianza', 'Valor p', 'Hipótesis nula', 'Error estándar'], links: [[0, 3], [1, 2], [0, 1]] },
];
function graphScene(el) {
  const canvas = el.querySelector('canvas');
  const paper = el.querySelector('.note-card');
  const button = el.querySelector('[data-feed]');
  const counter = el.querySelector('[data-count]');
  let size = fitCanvas(canvas);
  const nodes = []; const edges = []; const flying = [];
  let raf = 0; let noteAt = 0; let dragging = null;
  const color = ['--blue', '--red', '--teal', '--butter', '--sky', '--peach'];
  const add = (name, near) => {
    const n = { name, x: near ? near.x + rand(-40, 40) : rand(size.w * 0.2, size.w * 0.8), y: near ? near.y + rand(-40, 40) : rand(size.h * 0.2, size.h * 0.8), vx: 0, vy: 0, r: 9 + Math.min(10, name.length * 0.3), c: color[nodes.length % color.length], born: performance.now() };
    nodes.push(n); return n;
  };
  ['Concepto', 'Ejemplo', 'Pregunta'].forEach((n) => add(n));
  edges.push([0, 1], [1, 2]);
  const step = () => {
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        const dx = a.x - b.x; const dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01;
        const f = 900 / d2; a.vx += dx * f * 0.02; a.vy += dy * f * 0.02;
      }
      // Pulled toward the right of the stage, clear of the note card.
      a.vx += (size.w * 0.64 - a.x) * 0.0022; a.vy += (size.h * 0.56 - a.y) * 0.0018;
    }
    for (const [i, j] of edges) {
      const a = nodes[i]; const b = nodes[j]; if (!a || !b) continue;
      const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; const k = (d - 90) * 0.012;
      a.vx += dx / d * k; a.vy += dy / d * k; b.vx -= dx / d * k; b.vy -= dy / d * k;
    }
    for (const n of nodes) {
      if (n === dragging) continue;
      n.vx *= 0.86; n.vy *= 0.86; n.x += n.vx; n.y += n.vy;
      n.x = Math.max(n.r + 4, Math.min(size.w - n.r - 4, n.x)); n.y = Math.max(n.r + 16, Math.min(size.h - n.r - 4, n.y));
    }
  };
  const draw = (now) => {
    const { ctx, w, h } = size;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    for (const [i, j] of edges) {
      const a = nodes[i]; const b = nodes[j]; if (!a || !b) continue;
      ctx.strokeStyle = `${css('--ink')}33`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of nodes) {
      const age = Math.min(1, (now - n.born) / 600);
      const r = n.r * (age < 1 ? 1 + Math.sin(age * Math.PI) * 0.6 : 1);
      ctx.fillStyle = css(n.c); ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(n.x, n.y, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css('--ink'); ctx.font = `700 13px ${css('--display') || 'sans-serif'}`; ctx.textAlign = 'center';
      ctx.fillText(t(n.name), n.x, n.y - r - 7);
    }
    for (const p of [...flying]) {
      p.t += 0.022;
      const e = 1 - (1 - Math.min(1, p.t)) ** 3;
      const x = p.x0 + (p.x1 - p.x0) * e; const y = p.y0 + (p.y1 - p.y0) * e - Math.sin(e * Math.PI) * 60;
      ctx.fillStyle = css(p.c); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      if (p.t >= 1) flying.splice(flying.indexOf(p), 1);
    }
  };
  const frame = (now) => { raf = requestAnimationFrame(frame); step(); draw(now); };
  const start = () => { if (calm()) { for (let i = 0; i < 200; i += 1) step(); draw(performance.now() + 1e4); return; } if (!raf) raf = requestAnimationFrame(frame); };
  visible(el, start, () => { cancelAnimationFrame(raf); raf = 0; });
  new ResizeObserver(() => {
    const before = size;
    size = fitCanvas(canvas);
    // Nodes placed while the canvas had no size move into it.
    if (before.w < 10) for (const n of nodes) { n.x = rand(size.w * 0.25, size.w * 0.85); n.y = rand(size.h * 0.35, size.h * 0.8); }
    if (calm()) draw(performance.now() + 1e4);
  }).observe(canvas);
  const showNote = () => {
    const n = NOTES[noteAt % NOTES.length];
    paper.innerHTML = `<p class="note-title">${n.title}</p>${n.lines.map(([t, personal]) => `<p class="${personal ? 'pii' : ''}"><span>${t}</span></p>`).join('')}`;
    paper.classList.remove('gone', 'redacted');
  };
  showNote();
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    const p = at(e); const n = nodes.find((m) => Math.hypot(m.x - p.x, m.y - p.y) < m.r + 8);
    if (n) { dragging = n; canvas.setPointerCapture(e.pointerId); sfx.pick(); }
  });
  canvas.addEventListener('pointermove', (e) => { if (!dragging) return; const p = at(e); dragging.x = p.x; dragging.y = p.y; dragging.vx = dragging.vy = 0; });
  const release = () => { if (dragging) sfx.drop(); dragging = null; };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  button.addEventListener('click', async () => {
    button.disabled = true;
    const n = NOTES[noteAt % NOTES.length];
    paper.classList.add('redacted');
    sfx.tick();
    await new Promise((r) => setTimeout(r, calm() ? 0 : 1100));
    paper.classList.add('gone');
    const pr = paper.getBoundingClientRect(); const cr = canvas.getBoundingClientRect();
    const base = nodes.length;
    const anchor = nodes[Math.floor(Math.random() * nodes.length)];
    n.concepts.forEach((name, i) => {
      setTimeout(() => {
        const node = add(name, anchor);
        for (let k = 0; k < 8; k += 1) flying.push({ x0: pr.left - cr.left + pr.width / 2, y0: pr.top - cr.top + pr.height / 2, x1: node.x, y1: node.y, t: -k * 0.04, c: node.c });
        if (i === 0) edges.push([base, nodes.indexOf(anchor)]);
        sfx.note(i);
      }, calm() ? 0 : 220 * i);
    });
    setTimeout(() => {
      for (const [a, b] of n.links) edges.push([base + a, base + b]);
      counter.textContent = String(nodes.length);
      noteAt += 1;
      showNote();
      button.disabled = false;
      if (calm()) draw(performance.now() + 1e4);
    }, calm() ? 0 : 220 * n.concepts.length + 500);
  });
}

/* ---------- 3. your guides: one guide, four styles, one section rewritten ---------- */
const BEFORE = 'Una subred divide una red en partes más pequeñas. Se indica con la máscara: /26 quiere decir 26 bits para la red.';
const AFTER = 'Piensa en un edificio (la red) con pisos (las subredes): cada piso tiene sus propias oficinas. Con /26, los primeros 26 bits dicen el piso, y quedan 6 bits para 64 oficinas, 62 utilizables.';
const ASK = 'Explícalo con un ejemplo de la vida real';
function guideScene(el) {
  const mock = el.querySelector('.mock');
  const para = el.querySelector('[data-rewrite]');
  const bubble = el.querySelector('.ask-bubble');
  let busy = false;
  el.querySelectorAll('[data-skin]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-skin]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    mock.dataset.skin = b.dataset.skin;
    mock.classList.remove('flash'); void mock.offsetWidth; mock.classList.add('flash');
    sfx.tick();
  }));
  const type = (node, text, ms) => new Promise((done) => {
    if (calm()) { node.textContent = text; done(); return; }
    let i = 0; node.textContent = '';
    const id = setInterval(() => { node.textContent = text.slice(0, i += 1); if (i >= text.length) { clearInterval(id); done(); } }, ms);
  });
  const play = async () => {
    if (busy) return;
    busy = true;
    para.textContent = t(BEFORE); para.classList.remove('shimmer', 'fresh');
    bubble.classList.add('show');
    await type(bubble.querySelector('span'), t(ASK), 38);
    await new Promise((r) => setTimeout(r, calm() ? 0 : 450));
    para.classList.add('shimmer');
    await new Promise((r) => setTimeout(r, calm() ? 0 : 1300));
    para.classList.remove('shimmer'); para.classList.add('fresh');
    await type(para, t(AFTER), 16);
    sfx.chime();
    setTimeout(() => { bubble.classList.remove('show'); busy = false; }, 1200);
  };
  el.querySelector('[data-replay]').addEventListener('click', play);
  let played = false;
  visible(el, () => { if (!played) { played = true; setTimeout(play, 600); } }, () => {});
}

export function mountScenes() {
  const a = document.querySelector('.fb-ai'); if (a) aiScene(a);
  const g = document.querySelector('.fb-graph'); if (g) graphScene(g);
  const s = document.querySelector('.fb-guides'); if (s) guideScene(s);
}
