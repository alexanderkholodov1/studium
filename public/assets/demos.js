// The small live pieces of the landing page: what a Studium guide can hold, for four different subjects.
import { sfx } from './sfx.js';

const SUBJECTS = [
  ['Computación', 'blue'], ['Estadística', 'butter'], ['Biología', 'teal'], ['Diseño', 'red'], ['Desarrollo web', 'sky'], ['Física', 'blue'],
  ['Economía', 'teal'], ['Idiomas', 'peach'], ['Medicina', 'red'], ['Derecho', 'butter'], ['Música', 'peach'], ['Arquitectura', 'sky'],
  ['Química', 'teal'], ['Programación competitiva', 'red'], ['Lo que estudies por gusto', 'blue'],
];

function bars(el) {
  el.innerHTML = '<div class="bars" role="button" tabindex="0" aria-label="Sacar otra muestra"><span class="mean"></span></div>';
  const box = el.firstElementChild;
  box.insertAdjacentHTML('afterbegin', Array.from({ length: 9 }, () => '<i></i>').join(''));
  const sample = () => {
    // A normal-looking sample: the sum of three uniforms per bar.
    const hs = [...box.querySelectorAll('i')].map((b, i) => {
      const center = 1 - Math.abs(i - 4) / 5;
      const h = Math.max(8, Math.min(96, center * 70 + (Math.random() + Math.random() + Math.random() - 1.5) * 26 + 14));
      b.style.setProperty('--h', h.toFixed(0));
      return h;
    });
    box.querySelector('.mean').style.setProperty('--m', (hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(0));
  };
  sample();
  const go = () => { sample(); sfx.tick(); };
  box.addEventListener('click', go);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}

function net(el) {
  el.innerHTML = `<svg class="full net" viewBox="0 0 260 170" aria-hidden="true">
    <path class="edge" d="M30 120 90 50 160 90 230 40M30 120 110 150 160 90M90 50 150 20 230 40M110 150 220 135 230 40"/>
    <path class="path" d="M30 120 90 50 160 90 230 40"/>
    <g>${[[30, 120], [90, 50], [160, 90], [230, 40], [110, 150], [150, 20], [220, 135]].map(([x, y], i) => `<circle class="n" cx="${x}" cy="${y}" r="${i < 4 ? 10 : 7}"/>`).join('')}</g>
    <circle class="pk" r="5.5" style="offset-path: path('M30 120 90 50 160 90 230 40')"/>
    <circle class="pk" r="5.5" style="offset-path: path('M30 120 90 50 160 90 230 40'); animation-delay: -1.4s"/>
  </svg>`;
}

function helix(el) {
  el.innerHTML = `<div class="helix"><div class="helix-rig">${Array.from({ length: 14 }, (_, k) => `<i class="bp" style="--k:${k}"></i>`).join('')}</div></div>`;
}

function bezier(el) {
  el.innerHTML = `<svg class="bez" viewBox="0 0 260 170" aria-label="Curva de Bézier: arrastra los puntos rojos">
    <path class="arm" d=""/><path class="curve" d=""/>
    <circle class="end" cx="30" cy="140" r="7"/><circle class="end" cx="230" cy="140" r="7"/>
    <circle class="h" data-i="0" cx="70" cy="30" r="10"/><circle class="h" data-i="1" cx="200" cy="40" r="10"/></svg>`;
  const svg = el.firstElementChild;
  const pts = [[70, 30], [200, 40]];
  const draw = () => {
    svg.querySelector('.curve').setAttribute('d', `M30 140 C${pts[0][0]} ${pts[0][1]} ${pts[1][0]} ${pts[1][1]} 230 140`);
    svg.querySelector('.arm').setAttribute('d', `M30 140 L${pts[0][0]} ${pts[0][1]} M230 140 L${pts[1][0]} ${pts[1][1]}`);
    svg.querySelectorAll('.h').forEach((h, i) => { h.setAttribute('cx', pts[i][0]); h.setAttribute('cy', pts[i][1]); });
  };
  draw();
  let held = -1;
  const at = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.h');
    if (!h) return;
    held = Number(h.dataset.i);
    svg.setPointerCapture(e.pointerId);
    sfx.pick();
  });
  svg.addEventListener('pointermove', (e) => {
    if (held < 0) return;
    const p = at(e);
    pts[held] = [Math.max(8, Math.min(252, p.x)), Math.max(8, Math.min(162, p.y))];
    draw();
  });
  const drop = () => { if (held >= 0) sfx.drop(); held = -1; };
  svg.addEventListener('pointerup', drop);
  svg.addEventListener('pointercancel', drop);
}

const DEMOS = { bars, net, helix, bezier };
export function mountDemos(root = document) {
  for (const el of root.querySelectorAll('[data-demo]')) if (!el.dataset.ready) { el.dataset.ready = '1'; DEMOS[el.dataset.demo]?.(el); }
  const subjects = root.querySelector('#subjects');
  if (subjects && !subjects.childElementCount) subjects.innerHTML = SUBJECTS.map(([name, c], i) => `<span style="--c:var(--${c});--i:${i}">${name}</span>`).join('');
}
