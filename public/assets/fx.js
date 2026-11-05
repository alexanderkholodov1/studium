// Motion and depth: the scene behind every page (light, a graph-paper floor and notebook sheets at different depths),
// cards that lean toward the pointer, the light that follows the pointer on glass, and view transitions. Everything stays still when the person prefers reduced motion or the focus ambience.

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

/* ---------- the scene ---------- */
// Sheets of a notebook floating at different depths, still. The whole scene, the stars and the landing's stack lean a
// very little toward the pointer: their transforms are set one by one, never through a variable on the root (that
// made the browser recompute the style of the whole page on every frame), and nothing follows the scroll.
const SHEETS = [
  { x: 9, y: 22, z: -300, rx: 12, ry: -26, rz: -8, w: 210, h: 280, kind: 'ruled', text: '∫ f(x) dx\n= <em>F(b) − F(a)</em>' },
  { x: 88, y: 16, z: -520, rx: -8, ry: 30, rz: 7, w: 190, h: 250, kind: 'grid', text: '192.168.1.0/24\n<em>/26</em> → 64' },
  { x: 84, y: 68, z: -260, rx: 16, ry: 32, rz: -9, w: 180, h: 230, kind: 'ruled', text: 'mitosis\n→ <em>2n</em>' },
  { x: 16, y: 78, z: -640, rx: -14, ry: -18, rz: 12, w: 240, h: 300, kind: 'grid', text: 'p < 0.05 ✓' },
  { x: 50, y: 104, z: -820, rx: 34, ry: 0, rz: 3, w: 280, h: 200, kind: 'dots', text: '' },
  { x: 58, y: -4, z: -940, rx: -22, ry: 10, rz: -4, w: 250, h: 330, kind: 'ruled', text: 'TCP ≠ UDP' },
];
export function startScene() {
  const rig = document.getElementById('rig');
  const stars = document.querySelector('.scene .stars');
  if (rig) {
    rig.insertAdjacentHTML('beforeend', SHEETS.map((s, i) => `<div class="sheet ${s.kind}" style="--i:${i};--x:${s.x};--y:${s.y};--z:${s.z};--rx:${s.rx};--ry:${s.ry};--rz:${s.rz};--w:${s.w};--h:${s.h}">${s.text ? `<span>${s.text}</span>` : ''}</div>`).join(''));
  }
  const stacks = [...document.querySelectorAll('.stack-rig')];
  let px = 0; let py = 0; let tx = 0; let ty = 0; let frame = 0;
  const paint = () => {
    frame = 0;
    px += (tx - px) * 0.06; py += (ty - py) * 0.06;
    if (rig) rig.style.transform = `rotateX(${(py * 1.6).toFixed(3)}deg) rotateY(${(px * -2.4).toFixed(3)}deg)`;
    if (stars) stars.style.transform = `translate3d(${(px * -6).toFixed(2)}px, ${(py * -6).toFixed(2)}px, 0)`;
    for (const el of stacks) if (el.isConnected && el.offsetParent) el.style.transform = `rotateY(${(-16 + px * 16).toFixed(2)}deg) rotateX(${(8 - py * 10).toFixed(2)}deg)`;
    if (Math.abs(tx - px) > 0.002 || Math.abs(ty - py) > 0.002) frame = requestAnimationFrame(paint);
  };
  const calm = () => still() || root.dataset.ambience === 'enfoque';
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || calm()) return;
    tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5;
    if (!frame) frame = requestAnimationFrame(paint);
  }, { passive: true });
}

/* ---------- cards that lean toward the pointer ---------- */
export function tilt() {
  let current = null;
  const reset = (el) => { el.classList.remove('tilting'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || still() || root.dataset.ambience === 'enfoque') return;
    const el = e.target instanceof Element ? e.target.closest('[data-tilt]') : null;
    if (current && current !== el) { reset(current); current = null; }
    if (!el) return;
    current = el;
    el.classList.add('tilting');
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
    const max = (Number(el.dataset.tilt) || 4) * 0.5;
    el.style.setProperty('--rx', `${(-y * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(x * max).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { if (current) reset(current); current = null; });
}

/* ---------- light on glass ---------- */
export function glassLight() {
  let frame = 0; let event = null;
  addEventListener('pointermove', (e) => {
    event = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const el = event.target instanceof Element && event.target.closest('.glass, .lit');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${event.clientX - r.left}px`);
      el.style.setProperty('--my', `${event.clientY - r.top}px`);
    });
  }, { passive: true });
}

/* ---------- transitions ---------- */
export function transition(update) {
  if (still() || !document.startViewTransition) { update(); return; }
  // A transition interrupted by the next one is not an error.
  const vt = document.startViewTransition(update);
  for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch(() => {});
}

// One orchestrated entrance per render: the children rise in sequence.
export function rise(container, selector = ':scope > *') {
  if (still() || root.dataset.ambience === 'enfoque') return;
  container.querySelectorAll(selector).forEach((el, i) => {
    el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
      duration: 560, delay: Math.min(i, 12) * 45, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards',
    });
  });
}
