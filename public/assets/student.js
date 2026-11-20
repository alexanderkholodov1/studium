// «Guía del estudiante»: what helps to enroll, build a schedule, understand your grades and make the most of a career.
// Read at a glance: the essentials first, big; then each tip as a card with its idea in a few words, and the detail one
// tap away, animated, its key words in bold. Some tips carry a picture or a tool (the grade scale, the GPA calculator,
// how «+ Ej» pairs go together). «¿Falta algo? ¿Tienes una duda?» opens the page's feedback with the section named.
// A tip can be linked to directly (#/guia-estudiante/<id>): it opens and is marked, which is where the hints lead.
import { TIPS, TOPICS, SOURCE } from './tips.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const P = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  layers: '<path d="M12 4 3.5 8.5 12 13l8.5-4.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  credit: '<circle cx="12" cy="12" r="8.5"/><path d="M9 12h6M12 9v6"/>',
  map: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7Z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.4M12 17h.01"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? P.star}</svg>`;
const ESSENTIAL = ['como', 'grupo', 'gpa', 'ingles'];
// **words** in bold, after escaping.
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
// A tip's text: sentences as paragraphs, and lines that start with «• » as a list.
function prose(body) {
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = []; } };
  for (const line of String(body).split(/\n/)) {
    if (line.startsWith('• ')) list.push(line.slice(2)); else { flush(); if (line.trim()) out.push(`<p>${inline(line)}</p>`); }
  }
  flush();
  return out.join('');
}

/* ---------- pictures and tools inside some tips ---------- */
const GRADES = [['A', 4, '91–100 %'], ['B', 3, '81–90,99 %'], ['C', 2, '71–80,99 %'], ['D', 1, '61–70,99 %'], ['F', 0, '≤ 60,99 %']];
const VISUAL = {
  escala: () => `<div class="sg-scale" aria-hidden="true">${GRADES.map(([g, v, r], i) => `<span class="g-${g}" style="--i:${i}"><b>${g}</b><i>${v}</i><small>${r}</small></span>`).join('')}</div>`,
  grupo: () => `<div class="sg-pair" aria-hidden="true">
      <div class="sg-sec t"><small>Teoría · NRC 3730</small><b>Paralelo 1</b><em>| XC | | XD |</em></div>
      <span class="sg-match">=</span>
      <div class="sg-sec e"><small>Ejercicios · NRC 3735</small><b>Paralelo 8</b><em>| XC | | XD |</em></div>
      <div class="sg-sec no"><small>Ejercicios · otro grupo</small><b>Paralelo 9</b><em>| XE | | XF |</em></div>
    </div>`,
  calc: () => `<div class="sg-calc" data-gpa>
      <div class="sg-calc-rows">${[3, 3, 3].map(() => calcRow()).join('')}</div>
      <div class="actions"><button type="button" class="button ghost small" data-gpa-add>+ Otra materia</button></div>
      <p class="sg-calc-out" data-gpa-out>Elige la nota y los créditos de cada materia.</p>
      <p class="fine">Se calcula aquí, en tu navegador: no se guarda ni se envía.</p>
    </div>`,
};
const calcRow = () => `<div class="sg-calc-row"><label>Nota <select data-gpa-grade><option value="">—</option>${GRADES.map(([g, v]) => `<option value="${v}">${g}</option>`).join('')}<option value="0">N</option></select></label>
  <label>Créditos <input type="number" min="0" max="10" value="3" data-gpa-cr></label></div>`;
function gpa(box) {
  let pts = 0; let cr = 0;
  for (const row of box.querySelectorAll('.sg-calc-row')) {
    const g = row.querySelector('[data-gpa-grade]').value; const c = Number(row.querySelector('[data-gpa-cr]').value) || 0;
    if (g === '' || c <= 0) continue;
    pts += Number(g) * c; cr += c;
  }
  const out = box.querySelector('[data-gpa-out]');
  out.innerHTML = cr ? `<b>${(pts / cr).toFixed(2)}</b> · ${pts} puntos ÷ ${cr} créditos` : 'Elige la nota y los créditos de cada materia.';
}

function card(x, open) {
  const color = TOPICS[x.topic].color;
  const from = x.source ? `${SOURCE}, ${x.source}` : x.cite ?? '';
  return `<article class="sg-card c-${color}" id="tip-${x.id}">
    <div class="sg-icon">${icon(x.icon)}</div>
    <h3>${esc(x.key)}</h3>
    <details ${open ? 'open' : ''}><summary>${esc(x.title)}</summary>
      <div class="sg-body">
        ${x.visual ? VISUAL[x.visual]() : ''}
        ${prose(x.body)}
        ${x.url ? `<a class="button ghost small" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir la página ↗</a>` : ''}
        <div class="sg-foot">${from ? `<small class="sg-source">Fuente: ${esc(from)}</small>` : ''}
          <button type="button" class="link sg-ask" data-feedback="sugerencia" data-feedback-text="Guía del estudiante, «${esc(x.key)}»: ">¿Falta algo? ¿Tienes una duda?</button></div>
      </div>
    </details>
  </article>`;
}
export function renderStudentGuide(id) {
  const root = document.querySelector('#student-guide');
  const essential = ESSENTIAL.map((k) => TIPS.find((x) => x.id === k)).filter(Boolean);
  root.innerHTML = `
    <section class="sg-essential" aria-label="Lo esencial">
      ${essential.map((x) => `<a class="sg-big c-${TOPICS[x.topic].color}" href="#/guia-estudiante/${x.id}"><span class="sg-icon">${icon(x.icon)}</span><b>${esc(x.key)}</b><small>${esc(x.title)}</small></a>`).join('')}
    </section>
    <nav class="sg-jump" aria-label="Temas">${Object.entries(TOPICS).map(([k, t]) => `<a class="c-${t.color}" href="#/guia-estudiante/${TIPS.find((x) => x.topic === k)?.id ?? ''}">${esc(t.name)}</a>`).join('')}</nav>
    ${Object.entries(TOPICS).map(([topic, t]) => `<section class="sg-topic"><h2><i class="c-${t.color}"></i>${esc(t.name)}</h2>
      <div class="sg-grid">${TIPS.filter((x) => x.topic === topic).map((x) => card(x, x.id === id)).join('')}</div></section>`).join('')}
    <section class="sg-missing glass"><h2>¿Falta algo?</h2><p>Si algo no está, no se entiende o cambió, cuéntame: la guía se completa con lo que preguntan.</p>
      <button type="button" class="button primary" data-feedback="sugerencia" data-feedback-text="Guía del estudiante: ">Escribir una duda o una sugerencia</button></section>`;
  const target = id && root.querySelector(`#tip-${CSS.escape(id)}`);
  // After the route's own scroll to the top, which happens with the page's transition.
  if (target) { target.classList.add('focus'); setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 450); }
}

// The calculator and the «+ Otra materia» row.
document.addEventListener('input', (e) => { const box = e.target.closest?.('[data-gpa]'); if (box) gpa(box); });
document.addEventListener('change', (e) => { const box = e.target.closest?.('[data-gpa]'); if (box) gpa(box); });
document.addEventListener('click', (e) => {
  const add = e.target.closest?.('[data-gpa-add]');
  if (!add) return;
  const rows = add.closest('[data-gpa]').querySelector('.sg-calc-rows');
  if (rows.children.length < 12) rows.insertAdjacentHTML('beforeend', calcRow());
});
