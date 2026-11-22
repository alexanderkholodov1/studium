// Specter's looks: what he wears, and which looks the person has unlocked (a look opens with a secret, eggs.js).
// Kept in this browser. His body is drawn by props3d.js ('specter'); this file only says which look.
const KEY = 'studium-specter-skin';
const FOUND = 'studium-eggs';
const found = () => { try { return new Set(JSON.parse(localStorage.getItem(FOUND) ?? '[]')); } catch { return new Set(); } };

// Each look: its name, and the secret that opens it ('' is always open). The doctor's look is an original design.
export const SKINS = {
  '': { name: 'Como siempre', opens: '' },
  doctor: { name: 'De doctor', opens: 'medic' },
};
export const skinOpen = (id) => !SKINS[id]?.opens || found().has(SKINS[id].opens);
export function specterSkin() {
  let id = '';
  try { id = localStorage.getItem(KEY) ?? ''; } catch { /* not remembered */ }
  return SKINS[id] && skinOpen(id) ? id : '';
}
export function setSpecterSkin(id) {
  if (!SKINS[id] || !skinOpen(id)) return;
  try { localStorage.setItem(KEY, id); } catch { /* not remembered */ }
  dress(id);
}
const dress = (id) => { for (const c of document.querySelectorAll('canvas[data-prop="specter"]:not([data-fixed])')) c.dataset.skin = id; };
// Another tab of Studium changed his look: this one follows, so what he wears and what he does always agree.
addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== FOUND) return;
  dress(specterSkin());
  dispatchEvent(new CustomEvent('studium-skin', { detail: { skin: specterSkin() } }));
});
