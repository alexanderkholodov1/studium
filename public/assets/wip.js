// «En construcción» and «Beta» (his words, 2026-11-22): the sections he marks as not finished carry a black-and-yellow
// tape on top of the section and on the links that lead to it, saying they may fail or change; a beta build (its
// version says «beta», tools/beta.mjs) shows a «Beta» ribbon and its build name. To mark another section, add its view
// (the id after «view-» in index.html) and the links that open it.
import { VERSION } from './config.js';

// «Las guías de estudio» left the list on 2026-11-23: Estudiar was rebuilt as Trabajos (his words).
export const WIP = [];
export const BETA = /beta/i.test(VERSION);

const tapeHTML = (what) => `<div class="wip-tape" role="note"><span class="wip-stripes" aria-hidden="true"></span><p><b>En construcción.</b> ${what} todavía se están terminando: algo puede fallar o cambiar.</p></div>`;

// Called each time a view is shown.
export function markWip(view) {
  for (const w of WIP) {
    for (const sel of w.links) for (const a of document.querySelectorAll(sel)) a.classList.add('wip-link');
    if (w.view !== view) continue;
    const el = document.getElementById(`view-${view}`);
    if (el && !el.querySelector(':scope > .wip-tape')) el.insertAdjacentHTML('afterbegin', tapeHTML(w.what));
  }
}

export function markBeta() {
  if (!BETA) return;
  document.documentElement.classList.add('is-beta');
  if (!document.querySelector('.beta-ribbon')) document.body.insertAdjacentHTML('beforeend', `<a class="beta-ribbon" href="#/novedades" title="Studium beta · v${VERSION}">Beta</a>`);
}
