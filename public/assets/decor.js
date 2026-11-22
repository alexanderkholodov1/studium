// Decorations for Inicio: the 3D scenes and objects the Easter eggs unlock (the campfire at night, the phonograph, the
// cake…). One at a time lives in the «Decoración» tile, with no card behind it: purely decorative room. Which one is
// kept in this browser, like the secrets themselves. When a secret unlocks one, a small card offers «Agregar al inicio».
import { t } from './i18n.js';
import { props } from './props3d.js';
import { sfx } from './sfx.js';

const KEY = 'studium-decor';
const FOUND = 'studium-eggs';
const found = () => { try { return new Set(JSON.parse(localStorage.getItem(FOUND) ?? '[]')); } catch { return new Set(); } };

// Each decoration: its name, the secret that unlocks it, and its 3D scene (props3d.js; its own id when not given).
export const DECOR = {
  fire: { name: 'La fogata', opens: 'starve', scene: 'campfire' },
  cake: { name: 'La torta', opens: 'cake' },
  monitor: { name: 'El monitor', opens: 'medic' },
  portals: { name: 'Los portales', opens: 'portal' },
  trophy: { name: 'El trofeo', opens: 'crit' },
  cup: { name: 'La taza de café', opens: 'cafe' },
  desk: { name: 'El escritorio', opens: 'cafe' },
};
export const unlocked = () => Object.keys(DECOR).filter((k) => found().has(DECOR[k].opens));
export const sceneOf = (kind) => DECOR[kind]?.scene ?? kind;
// The one on Inicio ('' when none). (An older list of several keeps its first.)
export function current() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '""');
    const k = Array.isArray(v) ? v[0] : v;
    return k in DECOR && found().has(DECOR[k].opens) ? k : '';
  } catch { return ''; }
}
export const placed = () => (current() ? [current()] : []);
function save(kind) {
  try { localStorage.setItem(KEY, JSON.stringify(kind)); } catch { /* not remembered */ }
  dispatchEvent(new CustomEvent('studium-decor'));
}
export function choose(kind) { if (kind in DECOR) save(kind); }
export function clear() { save(''); }

// A secret just found: one card per decoration it unlocks, with its object turning, «Agregar al inicio» and «Ahora
// no». One card at a time; it leaves by itself after a while.
export function offerDecor(eggId) {
  const kinds = Object.keys(DECOR).filter((k) => DECOR[k].opens === eggId && current() !== k);
  if (!kinds.length || document.querySelector('.decor-offer')) return;
  const card = document.createElement('div');
  card.className = 'decor-offer glass';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', t('Decoración nueva'));
  card.innerHTML = `<p class="kicker">${t('Decoración nueva')}</p>
    <div class="decor-offer-items">${kinds.map((k) => `<label class="decor-pick"><input type="radio" name="decor-new" value="${k}" ${k === kinds[0] ? 'checked' : ''}><canvas class="prop" data-prop="${sceneOf(k)}" aria-hidden="true"></canvas><span>${t(DECOR[k].name)}</span></label>`).join('')}</div>
    <div class="actions"><button type="button" class="button primary small" data-decor-yes>${t('Agregar al inicio')}</button><button type="button" class="button ghost small" data-decor-no>${t('Ahora no')}</button></div>`;
  document.body.append(card);
  props(card);
  const go = () => { card.classList.add('out'); setTimeout(() => card.remove(), 420); };
  const timer = setTimeout(go, 20000);
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-decor-yes]')) {
      const pick = card.querySelector('input:checked')?.value;
      if (pick) choose(pick);
      sfx.tick(); clearTimeout(timer); go();
    } else if (e.target.closest('[data-decor-no]')) { clearTimeout(timer); go(); }
  });
}
