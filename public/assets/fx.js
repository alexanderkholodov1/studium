// Motion and depth: the scene behind every page (light, a graph-paper floor and notebook sheets at different depths),
// cards that lean toward the pointer, liquid glass on the floating panels, the light that follows the pointer on glass,
// and view transitions. Everything stays still when the person prefers reduced motion or the focus ambience.

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

/* ---------- the scene ---------- */
// Sheets of a notebook floating at different depths; the whole scene leans a little toward the pointer and the
// sheets drift with the scroll, each at its own speed.
const SHEETS = [
  { x: 9, y: 22, z: -300, rx: 12, ry: -26, rz: -8, w: 210, h: 280, kind: 'ruled', k: 0.12, text: '∫ f(x) dx\n= <em>F(b) − F(a)</em>' },
  { x: 88, y: 16, z: -520, rx: -8, ry: 30, rz: 7, w: 190, h: 250, kind: 'grid', k: 0.06, text: '192.168.1.0/24\n<em>/26</em> → 64' },
  { x: 84, y: 68, z: -260, rx: 16, ry: 32, rz: -9, w: 180, h: 230, kind: 'ruled', k: 0.16, text: 'mitosis\n→ <em>2n</em>' },
  { x: 16, y: 78, z: -640, rx: -14, ry: -18, rz: 12, w: 240, h: 300, kind: 'grid', k: 0.05, text: 'p < 0.05 ✓' },
  { x: 50, y: 104, z: -820, rx: 34, ry: 0, rz: 3, w: 280, h: 200, kind: 'dots', k: 0.03, text: '' },
  { x: 58, y: -4, z: -940, rx: -22, ry: 10, rz: -4, w: 250, h: 330, kind: 'ruled', k: 0.02, text: 'TCP ≠ UDP' },
];
export function startScene() {
  const rig = document.getElementById('rig');
  if (rig) {
    rig.insertAdjacentHTML('beforeend', SHEETS.map((s, i) => `<div class="sheet ${s.kind}" style="--i:${i};--x:${s.x};--y:${s.y};--z:${s.z};--rx:${s.rx};--ry:${s.ry};--rz:${s.rz};--w:${s.w};--h:${s.h};--k:${s.k}">${s.text ? `<span>${s.text}</span>` : ''}</div>`).join(''));
  }
  let sy = 0; let px = 0; let py = 0; let tx = 0; let ty = 0; let frame = 0;
  const paint = () => {
    frame = 0;
    px += (tx - px) * 0.045; py += (ty - py) * 0.045;
    root.style.setProperty('--sy', String(Math.round(sy)));
    root.style.setProperty('--px', px.toFixed(4));
    root.style.setProperty('--py', py.toFixed(4));
    if (Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001) frame = requestAnimationFrame(paint);
  };
  const calm = () => still() || root.dataset.ambience === 'enfoque';
  const ask = () => { if (!frame && !calm()) frame = requestAnimationFrame(paint); };
  addEventListener('scroll', () => { sy = scrollY; ask(); }, { passive: true });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; ask();
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

/* ---------- liquid glass ---------- */
// Chromium can refract the backdrop through an SVG filter: a displacement map that bends what is behind a panel
// near its edges, a little more for red than for blue. Other browsers keep the frosted glass of the stylesheet.
const liquidOK = !!navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)) && CSS.supports('backdrop-filter', 'blur(1px)');
let defs = null;
let serial = 0;

function edgeMap(w, h, radius, depth) {
  const s = 0.5;
  const W = Math.max(2, Math.ceil(w * s)); const H = Math.max(2, Math.ceil(h * s));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const r = Math.min(radius, w / 2, h / 2);
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const x = (i + 0.5) / s - w / 2; const y = (j + 0.5) / s - h / 2;
      const qx = Math.abs(x) - (w / 2 - r); const qy = Math.abs(y) - (h / 2 - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const dist = r - (outside + Math.min(Math.max(qx, qy), 0));
      const t = Math.max(0, 1 - dist / depth);
      let nx = 0; let ny = 0;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(x); ny = (qy / l) * Math.sign(y); }
      else if (qx > qy) nx = Math.sign(x); else ny = Math.sign(y);
      const k = t * t;
      const o = (j * W + i) * 4;
      img.data[o] = 128 - nx * k * 127; img.data[o + 1] = 128 - ny * k * 127; img.data[o + 2] = 128; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function liquid(el, { radius = 28, depth = 26, scale = 44, blur = 3 } = {}) {
  if (!liquidOK || !el) return;
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.prepend(defs);
  }
  const id = `liquid-${serial += 1}`;
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.id = id;
  defs.append(filter);
  let size = '';
  const build = () => {
    const w = Math.round(el.offsetWidth); const h = Math.round(el.offsetHeight);
    if (!w || !h || `${w}x${h}` === size) return;
    size = `${w}x${h}`;
    const map = edgeMap(w, h, radius, depth);
    const channel = (c, m) => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale * m}" xChannelSelector="R" yChannelSelector="G" result="d${c}"/>
      <feColorMatrix in="d${c}" type="matrix" values="${c === 'r' ? '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0' : c === 'g' ? '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0' : '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0'} 0 0 0 1 0" result="${c}"/>`;
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', String(w)); filter.setAttribute('height', String(h));
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.innerHTML = `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      ${channel('r', 1)}${channel('g', 0.94)}${channel('b', 0.88)}
      <feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`;
    el.style.backdropFilter = `url(#${id}) blur(${blur}px) saturate(1.7) brightness(1.05)`;
    el.classList.add('liquid');
  };
  new ResizeObserver(build).observe(el);
  build();
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
