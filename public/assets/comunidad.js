// «Comunidad», under construction: what is coming, each idea with «Yo quiero» («5 personas lo esperan»), and the same
// feedback button as the whole page, to propose what else. Studium's purpose is studying: one line says it on entering.
import { doc, getDoc, writeBatch, increment } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db, auth } from './data.js';
import { burst } from './play.js';
import { renderFriends, mountFriends } from './amigos.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s, r = document) => r.querySelector(s);

// The same ids as the rules (firestore.rules, ideas()).
export const IDEAS = [
  { id: 'amigos', icon: '🤝', title: 'Amigos y avatares', text: 'Agrega a tus compañeros, mira qué estudian y date una cara propia.' },
  { id: 'grupos', icon: '👥', title: 'Grupos de estudio', text: 'Un grupo por materia o por examen, con sus guías, su material y su chat.' },
  { id: 'horario', icon: '🗓️', title: 'Horario compartido', text: 'Compara tu horario con tus amigos y encuentren las horas libres en común.' },
  { id: 'musica', icon: '🎧', title: 'Música para estudiar juntos', text: 'Una sala con la misma música para todos, mientras cada uno estudia.' },
  { id: 'postits', icon: '📝', title: 'Post-its de los profes', text: 'Notas cortas sobre cada profe y cada materia, dejadas por quienes ya pasaron.' },
  { id: 'juego', icon: '🎮', title: 'Un juego para repasar', text: 'Repasa los conceptos de tu grafo jugando, solo o contra tus amigos.' },
  { id: 'logros', icon: '🏅', title: 'Logros y graduación', text: 'Cada materia aprobada se celebra, hasta el día de tu graduación.' },
  { id: 'campus', icon: '🏛️', title: 'Tu campus y la universidad', text: 'Aulas, el Learning Center, la biblioteca, los Leos: lo que nadie te explica el primer día.' },
];

let counts = {};
let mine = new Set();
async function load() {
  const uid = auth.currentUser?.uid;
  const rows = await Promise.all(IDEAS.map(async (i) => {
    const [w, m] = await Promise.all([getDoc(doc(db, 'wants', i.id)).catch(() => null), uid ? getDoc(doc(db, 'wanted', `${i.id}__${uid}`)).catch(() => null) : null]);
    return [i.id, w?.data()?.count ?? 0, !!m?.exists()];
  }));
  counts = Object.fromEntries(rows.map(([id, n]) => [id, n]));
  mine = new Set(rows.filter((r) => r[2]).map((r) => r[0]));
}
const waiting = (n) => (n === 0 ? 'Sé el primero en pedirlo' : n === 1 ? '1 persona lo espera' : `${n.toLocaleString('es')} personas lo esperan`);
const card = (i) => `<article class="cm-idea ${mine.has(i.id) ? 'wanted' : ''}" data-idea="${esc(i.id)}">
    <span class="cm-icon" aria-hidden="true">${i.icon}</span>
    <h3>${esc(i.title)}</h3><p>${esc(i.text)}</p>
    <div class="cm-foot"><button type="button" class="cm-want" aria-pressed="${mine.has(i.id)}">${mine.has(i.id) ? '✓ Lo quiero' : 'Yo quiero'}</button><span class="cm-count">${esc(waiting(counts[i.id] ?? 0))}</span></div>
  </article>`;

// Friends are real now (amigos.js): their panel goes on top, and their idea card leaves the list of what is coming.
export async function renderComunidad(arg = []) {
  const box = $('#cm-body');
  box.innerHTML = '<p class="status">Cargando…</p>';
  try { await load(); } catch { /* the counts stay empty */ }
  box.innerHTML = `<div id="am-panel"></div>
    <p class="cm-note" data-cm-note ${localStorage.getItem?.('studium-cm-note') === 'off' ? 'hidden' : ''}>Aquí vendrán los amigos, los grupos, la música y los juegos: cosas divertidas que también distraen. Studium es para estudiar; entra con eso en mente. <button type="button" class="link" data-cm-close>Entendido</button></p>
    <div class="cm-build"><span class="cm-tape" aria-hidden="true">En construcción</span><p>La Comunidad se está construyendo: <b>tus amigos ya funcionan, arriba</b>. Esto es lo que viene, <b>y mucho más</b>. Pulsa «Yo quiero» en lo que más esperas: así sé qué hacer primero.</p></div>
    <div class="cm-grid">${IDEAS.filter((i) => i.id !== 'amigos').map(card).join('')}</div>
    <div class="cm-more glass"><h3>¿Qué más te gustaría?</h3><p>Propón cualquier funcionalidad: la leo y te respondo.</p><button type="button" class="button primary" data-feedback="funcion">Proponer una idea</button></div>`;
  await renderFriends($('#am-panel'), arg[0] ?? '');
}

async function toggle(el) {
  const id = el.dataset.idea;
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const on = !mine.has(id);
  const btn = $('.cm-want', el);
  btn.disabled = true;
  const batch = writeBatch(db);
  // The counter by one, and the mark with it: the rules check that both change together.
  batch.set(doc(db, 'wants', id), { count: increment(on ? 1 : -1) }, { merge: true });
  if (on) batch.set(doc(db, 'wanted', `${id}__${uid}`), { idea: id }); else batch.delete(doc(db, 'wanted', `${id}__${uid}`));
  try {
    await batch.commit();
    counts[id] = Math.max(0, (counts[id] ?? 0) + (on ? 1 : -1));
    if (on) mine.add(id); else mine.delete(id);
    el.outerHTML = card(IDEAS.find((i) => i.id === id));
    if (on) { const r = $(`[data-idea="${id}"] .cm-want`)?.getBoundingClientRect(); if (r) burst(r.left + r.width / 2, r.top + r.height / 2, 14); }
  } catch (e) {
    btn.disabled = false;
    $('.cm-count', el).textContent = 'No se pudo guardar. Prueba otra vez.';
  }
}

export function mountComunidad(context = {}) {
  mountFriends((t) => context.toast?.(t));
  document.addEventListener('click', (e) => {
    const want = e.target.closest('#view-comunidad .cm-want');
    if (want) toggle(want.closest('[data-idea]'));
    if (e.target.closest('[data-cm-close]')) { $('[data-cm-note]').hidden = true; try { localStorage.setItem('studium-cm-note', 'off'); } catch { /* only this time */ } }
  });
}
