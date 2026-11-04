// Motion and depth: the sky behind every page (layers that move at different speeds with scroll and pointer),
// liquid glass on the floating panels, the light that follows the pointer on glass, and view transitions.
// Everything stays still when the person prefers reduced motion.

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

/* ---------- parallax sky ---------- */
export function startSky() {
  let sy = 0; let px = 0; let py = 0; let tx = 0; let ty = 0; let frame = 0;
  const paint = () => {
    frame = 0;
    px += (tx - px) * 0.08; py += (ty - py) * 0.08;
    root.style.setProperty('--sy', String(sy));
    root.style.setProperty('--px', px.toFixed(4));
    root.style.setProperty('--py', py.toFixed(4));
    if (Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001) frame = requestAnimationFrame(paint);
  };
  const ask = () => { if (!frame && !still()) frame = requestAnimationFrame(paint); };
  addEventListener('scroll', () => { sy = scrollY; ask(); }, { passive: true });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; ask();
  }, { passive: true });
  constellation(document.getElementById('sky-graph'));
}

// The nearest sky layer: a slow constellation of points that link when they come close.
function constellation(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0; let h = 0; let dots = []; let frame = 0; let last = 0;
  const size = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth; h = innerHeight * 1.4;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(70, (w * h) / 26000));
    dots = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12, r: 0.8 + Math.random() * 1.8 }));
  };
  const draw = (now) => {
    frame = 0;
    if (document.hidden || canvas.closest('[hidden]') || root.classList.contains('quiet')) return;
    if (now - last < 33) { frame = requestAnimationFrame(draw); return; }
    last = now;
    const css = getComputedStyle(root);
    const a = css.getPropertyValue('--sky-a').trim() || '#8d63ff';
    const b = css.getPropertyValue('--sky-b').trim() || '#22e5c9';
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      if (!still()) { d.x = (d.x + d.vx + w) % w; d.y = (d.y + d.vy + h) % h; }
    }
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const p = dots[i]; const q = dots[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > 150) continue;
        ctx.globalAlpha = (1 - d / 150) * 0.35;
        ctx.strokeStyle = i % 3 ? a : b;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    dots.forEach((d, i) => {
      ctx.globalAlpha = 0.85; ctx.fillStyle = i % 3 ? a : b;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    });
    if (!still()) frame = requestAnimationFrame(draw);
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(draw); };
  size();
  addEventListener('resize', () => { size(); wake(); });
  document.addEventListener('visibilitychange', wake);
  new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  wake();
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
  document.startViewTransition(update);
}

// One orchestrated entrance per render: the children rise in sequence.
export function rise(container, selector = ':scope > *') {
  if (still()) return;
  container.querySelectorAll(selector).forEach((el, i) => {
    el.animate([{ opacity: 0, transform: 'translateY(18px) scale(.98)' }, { opacity: 1, transform: 'none' }], {
      duration: 620, delay: Math.min(i, 12) * 55, easing: 'cubic-bezier(.2,.9,.25,1.15)', fill: 'backwards',
    });
  });
}
