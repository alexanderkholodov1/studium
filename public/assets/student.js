// «Guía del estudiante»: the tips, whole, grouped by what they help with. Each tip can be linked to directly
// (#/guia-estudiante/<id>), which is where the hints next to things lead.
import { TIPS, TOPICS, SOURCE } from './tips.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function renderStudentGuide(id) {
  const root = document.querySelector('#student-guide');
  root.innerHTML = Object.entries(TOPICS).map(([topic, name]) => `<section class="sg-topic"><h2>${esc(name)}</h2><div class="sg-tips">
    ${TIPS.filter((x) => x.topic === topic).map((x) => `<article class="sg-tip" id="tip-${x.id}"><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p>
      ${x.link ? `<a class="button ghost small" href="${esc(x.link)}" target="_blank" rel="noopener">Abrir la Oferta de cursos ↗</a>` : ''}
      ${x.source ? `<small class="sg-source">${esc(SOURCE)}, ${esc(x.source)}</small>` : ''}</article>`).join('')}
  </div></section>`).join('');
  const target = id && root.querySelector(`#tip-${CSS.escape(id)}`);
  if (target) { target.classList.add('focus'); requestAnimationFrame(() => target.scrollIntoView({ block: 'center' })); }
}
