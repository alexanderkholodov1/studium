// «Guía del estudiante»: what helps to enroll, build a schedule and make the most of a career. It is read at a glance:
// the essentials first, big; then each tip as a card with its idea in a few words, and the detail one tap away. A tip
// can be linked to directly (#/guia-estudiante/<id>): it opens and is marked, which is where the hints lead.
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
const ESSENTIAL = ['como', 'grupo', 'creditos', 'minor'];

function card(x, open) {
  const color = TOPICS[x.topic].color;
  return `<article class="sg-card c-${color}" id="tip-${x.id}">
    <div class="sg-icon">${icon(x.icon)}</div>
    <p class="sg-kicker">${esc(x.title)}</p>
    <h3>${esc(x.key)}</h3>
    <details ${open ? 'open' : ''}><summary>Cómo funciona</summary>
      <p>${esc(x.body)}</p>
      ${x.link ? `<a class="button ghost small" href="${esc(x.link)}" target="_blank" rel="noopener">Abrir la Oferta de cursos ↗</a>` : ''}
      ${x.source ? `<small class="sg-source">${esc(SOURCE)}, ${esc(x.source)}</small>` : ''}
    </details>
  </article>`;
}
export function renderStudentGuide(id) {
  const root = document.querySelector('#student-guide');
  const essential = ESSENTIAL.map((k) => TIPS.find((x) => x.id === k));
  root.innerHTML = `
    <section class="sg-essential" aria-label="Lo esencial">
      ${essential.map((x) => `<a class="sg-big c-${TOPICS[x.topic].color}" href="#/guia-estudiante/${x.id}"><span class="sg-icon">${icon(x.icon)}</span><b>${esc(x.key)}</b><small>${esc(x.title)}</small></a>`).join('')}
    </section>
    ${Object.entries(TOPICS).map(([topic, t]) => `<section class="sg-topic"><h2><i class="c-${t.color}"></i>${esc(t.name)}</h2>
      <div class="sg-grid">${TIPS.filter((x) => x.topic === topic).map((x) => card(x, x.id === id)).join('')}</div></section>`).join('')}`;
  const target = id && root.querySelector(`#tip-${CSS.escape(id)}`);
  if (target) { target.classList.add('focus'); requestAnimationFrame(() => target.scrollIntoView({ block: 'center' })); }
}
