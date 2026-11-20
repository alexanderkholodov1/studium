// Feedback, one button for the whole page (his rule: accessible, never in the way). A member says what happened or
// what they want: an error, something wrong with the AI, an urgent alert, a suggestion, a feature, thanks, or anything.
// Optionally, and seeing exactly what goes: the AI's log, the page's recent errors, and a picture. Only the sender and
// the admins read it; the admins answer, and the answer shows here. «Algo salió mal» next to every use of an AI opens
// this same window with that request's log already chosen.
import { collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db, auth } from './data.js';
import { VERSION } from './config.js';
import { redact } from './secrets.js';
import * as ai from './ai.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s, r = document) => r.querySelector(s);

export const KINDS = {
  error: 'Algo no funciona',
  ia: 'Algo salió mal con la IA',
  urgente: '¡Alerta urgente!',
  sugerencia: 'Sugerencia',
  funcion: 'Quiero esta funcionalidad',
  gracias: 'Gracias',
  comentario: 'Comentario, o porque sí',
};
const HINT = {
  error: 'Qué hacías, qué esperabas y qué pasó.',
  ia: 'Qué le pediste a tu IA y qué salió mal. Adjunta su registro: ahí está lo que recibió y lo que respondió.',
  urgente: 'Algo grave: datos que no deberían verse, un cobro, algo que se rompió para todos. Lo leo primero.',
  sugerencia: 'Qué cambiarías y por qué.',
  funcion: 'Qué te gustaría poder hacer en Studium.',
  gracias: '¿Qué te sirvió?',
  comentario: 'Lo que quieras.',
};

/* ---------- what the page saw: its recent errors ---------- */
const errors = [];
const keep = (text) => { errors.unshift({ at: Date.now(), text: String(text).slice(0, 800) }); errors.length = Math.min(errors.length, 30); };
addEventListener('error', (e) => keep(`${e.message} (${(e.filename ?? '').split('/').pop()}:${e.lineno ?? ''})`));
addEventListener('unhandledrejection', (e) => keep(`Promesa sin atender: ${e.reason?.message ?? e.reason}`));

// The AI's log, as it goes: what each request sent (instructions cut to a few thousand characters), which AI and
// model, its lines, its answer cut, and its error. Keys and passwords are filtered again here.
function logOf(entryId) {
  const list = entryId ? ai.activity.filter((x) => x.id === entryId) : ai.activity.slice(0, 8);
  return redact(JSON.stringify(list.map((x) => ({
    label: x.label, task: x.task, way: x.way, model: x.model, effort: x.effort, phase: x.phase,
    started: new Date(x.started).toISOString(), ms: x.ms, files: x.files,
    lines: x.lines.map((l) => `${new Date(l.at).toISOString().slice(11, 19)} ${l.text}`),
    system: String(x.system ?? '').slice(0, 4000), text: String(x.text ?? '').slice(0, 4000),
    response: String(x.response ?? '').slice(0, 3000), error: x.error ?? '',
  })), null, 1)).text.slice(0, 140000);
}
const errorsOf = () => errors.map((e) => `${new Date(e.at).toISOString()} ${e.text}`).join('\n').slice(0, 29000);

/* ---------- a picture: chosen, pasted or captured, made small ---------- */
async function shrink(blob) {
  const img = await createImageBitmap(blob);
  for (const [side, q] of [[1400, 0.72], [1100, 0.6], [800, 0.5], [600, 0.45]]) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= 440000) return url;
  }
  throw new Error('La imagen es demasiado grande, incluso reducida.');
}
async function captureScreen() {
  // The browser asks which screen or tab; nothing is captured without that yes. One frame, then it stops.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
  try {
    const video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true });
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    const c = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight });
    c.getContext('2d').drawImage(video, 0, 0);
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  } finally { stream.getTracks().forEach((t) => t.stop()); }
}

/* ---------- the window ---------- */
let shot = '';
let entry = '';
function dialog() {
  let d = $('#fb');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'fb'; d.className = 'sheet-dialog fb';
  d.innerHTML = `<form method="dialog" class="fb-form">
    <div class="fb-head"><h2>Cuéntame</h2><button class="button ghost small" value="close" formnovalidate>Cerrar</button></div>
    <div class="fb-tabs" role="tablist"><button type="button" role="tab" data-fb-tab="write" aria-selected="true">Escribir</button><button type="button" role="tab" data-fb-tab="mine" aria-selected="false">Lo que enviaste</button></div>
    <div data-fb-pane="write">
      <fieldset class="fb-kinds"><legend>¿Qué es?</legend>${Object.entries(KINDS).map(([k, v]) => `<label class="fb-kind ${k}"><input type="radio" name="kind" value="${k}" ${k === 'error' ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}</fieldset>
      <label class="field"><span data-fb-hint>${esc(HINT.error)}</span><textarea name="text" rows="5" maxlength="5000" required></textarea></label>
      <fieldset class="fb-attach"><legend>Adjuntar (si quieres)</legend>
        <label class="check"><input type="checkbox" name="log"> El registro de tu IA <small data-fb-logsize></small></label>
        <label class="check"><input type="checkbox" name="errors"> Los errores recientes de la página <small data-fb-errsize></small></label>
        <div class="fb-shot"><button type="button" class="button ghost small" data-fb-capture>Capturar la pantalla</button><label class="button ghost small">Elegir una imagen<input type="file" accept="image/*" hidden data-fb-file></label><small>o pégala aquí (Ctrl+V)</small><span data-fb-thumb></span></div>
        <details class="prompt"><summary>Ver exactamente lo que se envía</summary><pre data-fb-preview></pre></details>
      </fieldset>
      <p class="fine">Lo leen solo los admins de Studium, y tú. Se envía también la página donde estás, la versión y tu navegador. Las claves y contraseñas se tapan antes de enviar.</p>
      <p class="msg" data-fb-msg hidden></p>
      <div class="actions"><button type="submit" class="button" value="send" data-fb-send>Enviar</button></div>
    </div>
    <div data-fb-pane="mine" hidden><div data-fb-mine><p class="muted">Cargando…</p></div></div>
  </form>`;
  document.body.append(d);
  const form = $('form', d);
  const kind = () => form.kind.value;
  const preview = () => {
    $('[data-fb-hint]', d).textContent = HINT[kind()];
    const log = form.log.checked ? logOf(entry) : '';
    const errs = form.errors.checked ? errorsOf() : '';
    $('[data-fb-logsize]', d).textContent = ai.activity.length ? `(${entry ? 'el pedido de donde viniste' : `los últimos ${Math.min(8, ai.activity.length)} pedidos`})` : '(no hay pedidos todavía)';
    $('[data-fb-errsize]', d).textContent = `(${errors.length})`;
    $('[data-fb-preview]', d).textContent = [`Tipo: ${KINDS[kind()]}`, `Página: ${location.hash || '#/'}`, `Versión: ${VERSION}`, `Navegador: ${navigator.userAgent}`,
      shot ? 'Imagen: sí (abajo)' : '', errs ? `\nErrores:\n${errs}` : '', log ? `\nRegistro de la IA:\n${log}` : ''].filter(Boolean).join('\n');
  };
  form.addEventListener('change', preview);
  const setShot = async (blob) => {
    try { shot = await shrink(blob); $('[data-fb-thumb]', d).innerHTML = `<img src="${shot}" alt="La imagen que se adjunta"><button type="button" class="link" data-fb-unshot>Quitar</button>`; preview(); }
    catch (e) { say(e.message); }
  };
  const say = (t) => { const m = $('[data-fb-msg]', d); m.hidden = !t; m.textContent = t ?? ''; };
  d.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); setShot(f); } });
  $('[data-fb-file]', d).addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) setShot(f); e.target.value = ''; });
  d.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.fbUnshot !== undefined) { shot = ''; $('[data-fb-thumb]', d).innerHTML = ''; preview(); }
    if (t.dataset.fbCapture !== undefined) { try { const b = await captureScreen(); if (b) setShot(b); } catch { say('No se capturó la pantalla (el navegador no lo permitió). Puedes pegar o elegir una imagen.'); } }
    if (t.dataset.fbTab) {
      for (const b of d.querySelectorAll('[data-fb-tab]')) b.setAttribute('aria-selected', String(b === t));
      for (const p of d.querySelectorAll('[data-fb-pane]')) p.hidden = p.dataset.fbPane !== t.dataset.fbTab;
      if (t.dataset.fbTab === 'mine') drawMine(d);
    }
  });
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'send') return;
    e.preventDefault();
    const btn = $('[data-fb-send]', d);
    btn.disabled = true; say('');
    try {
      await send({ kind: kind(), text: form.text.value.trim(), log: form.log.checked ? logOf(entry) : '', errors: form.errors.checked ? errorsOf() : '', shot });
      form.text.value = ''; shot = ''; $('[data-fb-thumb]', d).innerHTML = '';
      say('¡Enviado, gracias! Verás la respuesta en «Lo que enviaste».');
    } catch (err) { say(/permission|insufficient/i.test(err.message) ? 'No se pudo enviar: Studium no aceptó el mensaje. Si ya enviaste 10 hoy, mañana puedes enviar más; si no, avísame por otro medio.' : err.message); }
    finally { btn.disabled = false; }
  });
  d._preview = preview;
  return d;
}

async function send({ kind, text, log, errors: errs, shot: pic }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sesión para escribir.');
  if (!text) throw new Error('Escribe algo antes de enviar.');
  const day = Math.floor(Date.now() / 86400000);
  const countRef = doc(db, 'feedbackDay', user.uid);
  const was = (await getDoc(countRef)).data();
  const n = was?.day === day ? was.n + 1 : 1;
  if (n > 10) throw new Error('Ya enviaste 10 mensajes hoy. Mañana puedes enviar más.');
  const data = { uid: user.uid, from: (user.email ?? '').slice(0, 120), kind, text: redact(text).text.slice(0, 5000), page: (location.hash || '#/').slice(0, 300), version: VERSION, agent: navigator.userAgent.slice(0, 300), created: serverTimestamp(), status: 'nuevo' };
  if (log) data.log = log;
  if (errs) data.errors = errs;
  if (pic) data.shot = pic;
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'feedback')), data);
  batch.set(countRef, { day, n });
  await batch.commit();
}

const STATUS = { nuevo: 'Enviado', visto: 'Leído', resuelto: 'Resuelto', descartado: 'Cerrado' };
async function drawMine(d) {
  const box = $('[data-fb-mine]', d);
  try {
    const snap = await getDocs(query(collection(db, 'feedback'), where('uid', '==', auth.currentUser?.uid ?? '')));
    const list = snap.docs.map((x) => ({ id: x.id, ...x.data() })).sort((a, b) => (b.created?.toMillis?.() ?? 0) - (a.created?.toMillis?.() ?? 0));
    box.innerHTML = list.length ? list.map((x) => `<article class="fb-item ${esc(x.kind)}"><p class="fine"><b>${esc(KINDS[x.kind] ?? x.kind)}</b> · ${esc(x.created?.toDate?.().toLocaleString('es') ?? '')} · <span class="tag">${esc(STATUS[x.status] ?? x.status)}</span></p>
      <p>${esc(x.text)}</p>${x.answer ? `<blockquote class="fb-answer"><b>Respuesta:</b> ${esc(x.answer)}</blockquote>` : ''}</article>`).join('') : '<p class="muted">Todavía no enviaste nada.</p>';
  } catch (e) { box.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}

// Open the window; kind and an AI request's id preselect what it is about.
export function openFeedback({ kind = 'error', entryId = '', text = '' } = {}) {
  if (!auth.currentUser) return;
  const d = dialog();
  const form = $('form', d);
  entry = entryId;
  form.kind.value = KINDS[kind] ? kind : 'error';
  form.log.checked = kind === 'ia' && ai.activity.length > 0;
  form.errors.checked = kind === 'error' || kind === 'ia' || kind === 'urgente';
  $('[data-fb-msg]', d).hidden = true;
  // Opened from a place (a section of the guide): its name starts the text, for the person to go on.
  if (text && !form.text.value.trim()) form.text.value = text.slice(0, 300);
  d._preview();
  if (!d.open) d.showModal();
  form.text.focus();
}

// The line next to every use of an AI.
export const wrongHTML = (entryId = '') => `<button type="button" class="link fb-wrong" data-feedback="ia"${entryId ? ` data-entry="${esc(entryId)}"` : ''}>¿Algo salió mal? Cuéntamelo</button>`;

export function mountFeedback() {
  // Any element with data-feedback opens the window, from anywhere on the page.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-feedback]');
    if (!t) return;
    e.preventDefault();
    openFeedback({ kind: t.dataset.feedback || 'error', entryId: t.dataset.entry ?? '', text: t.dataset.feedbackText ?? '' });
  });
}
