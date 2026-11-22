// Decorations for Inicio: the 3D objects the Easter eggs unlock (the campfire, the phonograph, the cake…), placed by
// the person in the «Decoración» tile. Which ones are placed is kept in this browser, like the secrets themselves.
// When a secret unlocks one, a small card offers «Agregar al inicio».
import { t } from './i18n.js';
import { props } from './props3d.js';
import { sfx } from './sfx.js';

const KEY = 'studium-decor';
const FOUND = 'studium-eggs';
const found = () => { try { return new Set(JSON.parse(localStorage.getItem(FOUND) ?? '[]')); } catch { return new Set(); } };

// Each decoration: its 3D object (props3d.js), its name, and the secret that unlocks it.
export const DECOR = {
  fire: { name: 'La fogata', opens: 'starve' },
  gramophone: { name: 'El fonógrafo', opens: 'starve' },
  cake: { name: 'La torta', opens: 'cake' },
  monitor: { name: 'El monitor', opens: 'medic' },
  portals: { name: 'Los portales', opens: 'portal' },
  trophy: { name: 'El trofeo', opens: 'crit' },
  cup: { name: 'La taza de café', opens: 'cafe' },
  desk: { name: 'El escritorio', opens: 'cafe' },
};
export const unlocked = () => Object.keys(DECOR).filter((k) => found().has(DECOR[k].opens));
export function placed() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]').filter((k) => k in DECOR && found().has(DECOR[k].opens)).slice(0, 12); } catch { return []; }
}
const save = (list) => {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(list)])); } catch { /* not remembered */ }
  dispatchEvent(new CustomEvent('studium-decor'));
};
export function add(kind) { if (kind in DECOR && !placed().includes(kind)) save([...placed(), kind]); }
export function remove(kind) { save(placed().filter((k) => k !== kind)); }

// A secret just found: one card per decoration it unlocks, with its object turning, «Agregar al inicio» and «Ahora
// no». One card at a time; it leaves by itself after a while.
export function offerDecor(eggId) {
  const kinds = Object.keys(DECOR).filter((k) => DECOR[k].opens === eggId && !placed().includes(k));
  if (!kinds.length || document.querySelector('.decor-offer')) return;
  const card = document.createElement('div');
  card.className = 'decor-offer glass';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', t('Decoración nueva'));
  card.innerHTML = `<p class="kicker">${t('Decoración nueva')}</p>
    <div class="decor-offer-items">${kinds.map((k) => `<label class="decor-pick"><input type="checkbox" value="${k}" checked><canvas class="prop" data-prop="${k}" aria-hidden="true"></canvas><span>${t(DECOR[k].name)}</span></label>`).join('')}</div>
    <div class="actions"><button type="button" class="button primary small" data-decor-yes>${t('Agregar al inicio')}</button><button type="button" class="button ghost small" data-decor-no>${t('Ahora no')}</button></div>`;
  document.body.append(card);
  props(card);
  const go = () => { card.classList.add('out'); setTimeout(() => card.remove(), 420); };
  const timer = setTimeout(go, 20000);
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-decor-yes]')) {
      for (const box of card.querySelectorAll('input:checked')) add(box.value);
      sfx.tick(); clearTimeout(timer); go();
    } else if (e.target.closest('[data-decor-no]')) { clearTimeout(timer); go(); }
  });
}
