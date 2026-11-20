// «Crea tu guía» (0.5's «Aportar»): instructions for the person's own AI, the review of what it returns (contributions and guides), and the
// account's own items. Nothing of the original material reaches Studium: only what the AI extracted, after review.
import { THEMES, keyOf, themeStyle, guessTheme, validTheme } from './themes.js';
import {
  KINDS, KIND_HINTS, LEVELS, contributionInstructions, curriculumInstructions, guideInstructions, parseContribution, parseGuide,
  contextPack, findPersonal, redact,
} from './prompts.js';
import { publishContribution, publishGuide, setVisibility, remove, LIMIT, loadDrafts, saveDrafts, myVersions, restoreVersion, deleteVersion } from './data.js';
import { prepareGroup, groupFiles, fingerprint, partsSize, partFiles, zipFiles } from './files.js';
import { createQueue, indexedStore, memoryStore } from './queue.js';
import { looseKey, stageOf, stageLabel } from './standard.js';
import { showGuide } from './viewer.js';
import { rise } from './fx.js';
import * as ai from './ai.js';
import * as convert from './convert.js';
import { prefs } from './prefs.js';
import { renderEstudia, renderDesk } from './estudia.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* the draft is just not remembered */ } if (DRAFTS[k]) keepDraft(); },
};
// What is filled in is a draft: on the device at once, and in the account a moment later (drafts/{uid}), so it is
// there on another device too. Only the form's fields travel, never the notes or the material.
const DRAFTS = { 'studium-draft-material': 'material', 'studium-draft-guide': 'guide' };
let draftTimer = 0;
function keepDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!ctx?.user) return;
    const out = {};
    for (const [k, name] of Object.entries(DRAFTS)) { const v = store.get(k); if (v) out[name] = v; }
    saveDrafts(ctx.user.uid, out).catch(() => { /* it stays on this device */ });
  }, 1500);
}
async function restoreDrafts() {
  if (!ctx?.user || Object.keys(DRAFTS).some((k) => store.get(k))) return false;
  const saved = await loadDrafts(ctx.user.uid).catch(() => null);
  if (!saved) return false;
  for (const [k, name] of Object.entries(DRAFTS)) if (saved[name]) try { localStorage.setItem(k, JSON.stringify(saved[name])); } catch { /* not remembered */ }
  return true;
}
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

let ctx = null; // { state, user, refresh, toast, go }

export function download(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); ctx.toast(`${what} copiadas. Pégalas en tu IA.`); }
  catch { ctx.toast('No se pudo copiar: descarga el archivo y adjúntalo en tu IA.'); }
}

function known() {
  const { catalog, contributions } = ctx.state;
  const lessons = contributions.filter((c) => c.kind !== 'curriculum');
  return {
    courses: uniq([...catalog, ...lessons].map((x) => x.course)),
    professors: uniq([...catalog, ...lessons].map((x) => x.professor)),
    terms: uniq([...catalog, ...lessons].map((x) => x.term)),
    universities: uniq(contributions.concat(catalog).map((x) => x.university)),
  };
}
// The display name already used for the same course or person, so that variants join the same node.
function canonical(value, options) {
  const key = keyOf(value);
  return options.find((o) => keyOf(o) === key) ?? value;
}
const canonicalCourse = (value) => ctx.state.graph.byId.get(`course:${keyOf(value)}`)?.name ?? value;

const datalists = () => {
  const k = known();
  const opts = (xs) => xs.map((x) => `<option value="${esc(x)}">`).join('');
  return `<datalist id="dl-courses">${opts(k.courses)}</datalist><datalist id="dl-profs">${opts(k.professors)}</datalist>
    <datalist id="dl-terms">${opts(k.terms)}</datalist><datalist id="dl-unis">${opts(k.universities)}</datalist>`;
};
const input = (name, label, value, attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const segmented = (name, options, value, label) => `<fieldset class="seg" aria-label="${esc(label)}"><legend>${esc(label)}</legend>${
  Object.entries(options).map(([k, v]) => `<label><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}</fieldset>`;
const themePicker = (name, value) => `<fieldset class="themes" aria-label="Estilo visual"><legend>Estilo visual de la materia</legend>${
  Object.entries(THEMES).map(([k, t]) => `<label class="swatch" style="${themeStyle(k)}" title="${esc(t.hint)}"><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</fieldset>`;
const dropzone = (id) => `<div class="dropzone" data-drop="${id}">
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 31V11m0 0-8 8m8-8 8 8M10 30v5a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4v-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <p><strong>Suelta aquí los archivos</strong> que te devolvió tu IA (.json o .html)${id === 'guide' ? '; o una guía que ya tenías (otra página HTML, un PDF, Markdown), para pasarla al formato actual con tu IA' : ''}, o</p>
    <label class="button ghost">Elegir archivos<input type="file" accept=".json,.html,.htm,.txt,.md,application/json,text/html${id === 'guide' ? ',.pdf,application/pdf' : ''}" multiple hidden data-files="${id}"></label>
  </div>
  <details class="paste"><summary>O pega aquí la respuesta de tu IA</summary>
    <textarea rows="7" data-paste="${id}" placeholder="Pega el bloque de código JSON, o la página HTML completa"></textarea>
    <button class="button ghost" data-review-paste="${id}">Revisar</button>
  </details>
  <div class="reviews" data-reviews="${id}"></div>`;

/* ---------- your AI, inside Studium ---------- */
function aiStep(zone) {
  const ready = ai.ready();
  return `<li class="step glass ai-step ${ready ? '' : 'off'}"><h2>${ready ? 'Con tu IA, sin copiar ni pegar' : 'Suelta todo tu material'}</h2>
    <p>${ready
      ? 'Suelta los archivos que quieras, o carpetas enteras: cada parte espera su turno en la cola, va a tu IA con las instrucciones de Studium y vuelve aquí para que la revises. La cola sigue aunque recargues la página.'
      : `Suelta los archivos que quieras, o carpetas enteras: Studium los divide en partes y cada una queda lista para tu chat, con sus instrucciones. Si <a href="#/ajustes">conectas tu IA</a> (también gratis o con tu suscripción), Studium lo hace solo.`}</p>
    ${ai.pickerHTML('material')}
    <div class="dropzone" data-ai-drop="${zone}">
      <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14a4 4 0 0 1 4-4h8l4 4h12a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M24 30V20m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p><strong>Suelta aquí tus archivos o una carpeta</strong>: PDF (también libros enteros y escaneos), fotos de exámenes o apuntes a mano, Word, PowerPoint, Excel, EPUB, notebooks, código, texto o un ZIP.</p>
      <div class="actions"><label class="button primary">Elegir archivos<input type="file" multiple hidden data-ai-files="${zone}"></label>
        <label class="button ghost">Elegir una carpeta<input type="file" multiple hidden webkitdirectory data-ai-files="${zone}"></label></div>
    </div>
    <p class="fine">Los libros largos se dividen por capítulos: primero va su índice, y tú eliges qué capítulos procesar. Las fotos de un mismo examen se unen solas.</p>
    <div class="queue-head" id="q-head"></div>
    <ul class="ai-queue" data-ai-queue="${zone}"></ul>
  </li>`;
}
// The queue (queue.js): each dropped file (or each group of photos of the same exam, or the code of one folder) is read
// in this browser and split into parts; each part is one request to the person's AI, or one trip to their chat, and
// becomes one contribution to review. Any amount of material can wait here: the queue lives in this browser, survives
// a reload, waits out the limits of each AI and runs one part after another, in one tab only. A file already in the
// map (by its fingerprint) is not queued again.
let queue = null;
let queueReady = null;
const prepared = new Map(); // group id -> its parts, read again from its files when a part of it runs (a few at a time)
const reviewOf = new Map(); // job id -> review id
const queueNotes = []; // files skipped in this visit, and why
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('studium-queue') : null;
const printed = () => new Set(ctx.state.contributions.map((c) => c.print).filter(Boolean));
// Each part of a long file has its own fingerprint, derived from the file's: a book's chapters are added one by one.
const unitPrint = (print, i, count) => (!print ? '' : count === 1 ? print : `${print.slice(0, 20)}${i.toString(16).padStart(4, '0')}`);
async function printOf(group) {
  const prints = await Promise.all(group.files.map((f) => fingerprint(f)));
  if (prints.length === 1) return prints[0];
  const joined = new TextEncoder().encode(prints.join(''));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', joined))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
const baseName = (name) => String(name).split('/').pop();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clock = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
function remember(gid, parts) {
  prepared.set(gid, parts);
  while (prepared.size > 4) prepared.delete(prepared.keys().next().value);
}
async function unitOf(job, group, list) {
  if (!prepared.has(group.id)) remember(group.id, prepareGroup({ name: group.name, files: list, code: group.code, folder: !!group.v?.oneFolder }));
  const parts = await prepared.get(group.id);
  const unit = parts?.units?.[job.index];
  if (!unit) throw new ai.AIError('No se pudo volver a leer este archivo.', { kind: 'job' });
  return unit;
}
const instructionsOf = (job, group) => {
  const v = { ...group.v, stage: job.stage };
  return v.kind === 'curriculum' ? curriculumInstructions(v) : contributionInstructions({ ...v, part: job.note });
};
// One part, to the person's AI: the way, model and effort chosen for «Procesar material».
async function processJob(job, group, list) {
  const unit = await unitOf(job, group, list);
  const files = await unit.make();
  queue.setProgress(job.id, `Tu IA lo está leyendo… (${kb(partsSize(files))})`);
  const res = await ai.run({
    system: instructionsOf(job, group), files, maxTokens: 32000, task: 'material', use: ai.choice('material'), label: group.v?.oneFolder || job.label,
    text: 'Procesa el material adjunto siguiendo las instrucciones de Studium. Responde solo con el JSON, en un bloque de código.',
    onProgress: (n) => queue.setProgress(job.id, n < 0 ? 'Tu IA está escribiendo…' : `Tu IA está escribiendo… ${n.toLocaleString('es')} caracteres`),
  });
  return { text: res.text, provider: res.provider, model: res.model, effort: res.effort, way: res.way, truncated: !!res.truncated };
}
function storeFor() {
  try { if (typeof indexedDB === 'object' && indexedDB) return indexedStore(); } catch { /* a private window */ }
  return memoryStore();
}
// One tab runs the queue; the others show it.
// The other tabs wait for their turn: when the tab that runs the queue closes, the next one takes it over.
const lockQueue = (fn) => (navigator.locks?.request ? navigator.locks.request('studium-queue', () => fn()) : fn());
let lastCounts = null;
const watchers = new Set();
// «Estudia» draws the processing as it happens: it hears every change of the queue.
export function watchQueue(fn) { watchers.add(fn); return () => watchers.delete(fn); }
export async function queueControl(action) {
  const q = await startQueue();
  if (action === 'pause') q.pause();
  if (action === 'resume') q.resume();
  if (action === 'discard') {
    await q.discardAll();
    for (const [id, item] of reviews) if (item.jobId && !item.done) { reviews.delete(id); document.getElementById(id)?.remove(); }
  }
  return q;
}
export const reviewOfJob = (jobId) => reviews.get(reviewOf.get(jobId));
function onQueue(change) {
  for (const fn of watchers) { try { fn(change, queue); } catch (e) { console.warn('[estudia]', e); } }
  if (change.progress) { const row = document.querySelector(`#q-${CSS.escape(change.progress)} > .state`); if (row) row.textContent = change.status.progress; return; }
  // Only this tab's own changes are announced: reading what another tab announced must not answer it back.
  if (!change.loaded) channel?.postMessage('changed');
  if (change.done) syncReviews();
  if (change.kind === 'account') ctx?.toast(change.status.stopped);
  const c = queue.counts();
  if (lastCounts && (lastCounts.waiting || lastCounts.running) && !c.waiting && !c.running && c.done > lastCounts.done) ctx?.toast('Tu IA terminó la cola: revisa y publica abajo.');
  lastCounts = c;
  for (const gid of [...prepared.keys()]) if (!queue.jobs().some((j) => j.gid === gid && (j.state === 'waiting' || j.state === 'running'))) prepared.delete(gid);
  renderQueueSoon();
}
export function startQueue(context) {
  if (context) ctx = context;
  queueReady ??= (async () => {
    queue = createQueue({ store: storeFor(), process: processJob, onChange: onQueue });
    queue.lock = lockQueue;
    await queue.load();
    channel?.addEventListener('message', async () => { await queue.load(); syncReviews(); renderQueueSoon(); queue.start(); });
    queue.start();
    return queue;
  })();
  return queueReady;
}
let renderPending = false;
function renderQueueSoon() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderQueue(); });
}
const STATES = {
  manual: 'Para tu chat', missing: 'Suelta este archivo otra vez para seguir', done: 'Listo: revísalo abajo',
  published: 'Publicado', discarded: 'Quitado',
};
function jobState(job, st) {
  if (job.state === 'running') return st.progress || 'Leyendo…';
  if (job.state === 'waiting') return job.retryAt > Date.now() ? `Sigue a las ${clock(job.retryAt)}` : 'En espera';
  if (job.state === 'error') return job.error || 'Algo falló';
  if (job.state === 'off') return job.inMap ? 'Ya está en el grafo: márcalo para procesarlo otra vez' : 'Sin elegir';
  if (job.state === 'done' && job.result?.truncated) return 'Listo, pero quedó cortado: revisa abajo';
  return STATES[job.state] ?? job.state;
}
function jobRow(job, many, st) {
  const cls = { running: 'busy', done: 'ok', published: 'ok', error: 'bad', off: 'skip', discarded: 'skip', missing: 'bad', manual: 'manual' }[job.state] ?? '';
  const name = many ? job.label.split(' · ').slice(1).join(' · ') || job.label : baseName(job.label);
  // A part of a book, or a file already in the map, can be chosen.
  const choose = (many || job.state === 'off') && ['off', 'waiting', 'manual', 'error'].includes(job.state) ? `<label class="check"><input type="checkbox" data-unit="${esc(job.id)}" ${job.state === 'off' ? '' : 'checked'}></label>` : '';
  const actions = job.state === 'manual'
    ? `<div class="chat-part"><div class="actions"><button type="button" class="button ghost small" data-q-copy="${esc(job.id)}">Copiar instrucciones</button><button type="button" class="button ghost small" data-q-download="${esc(job.id)}">Descargar la parte</button></div>
        <textarea class="plain" rows="2" data-q-paste="${esc(job.id)}" placeholder="Pega aquí lo que te devolvió tu IA"></textarea>
        <div class="actions"><button type="button" class="button primary small" data-q-answer="${esc(job.id)}">Listo</button>${ai.ready() ? `<button type="button" class="link" data-q-retry="${esc(job.id)}">Que lo haga mi IA</button>` : ''}</div></div>`
    : job.state === 'error'
      ? `<div class="actions"><button type="button" class="link" data-q-retry="${esc(job.id)}">Reintentar</button><button type="button" class="link" data-q-chat="${esc(job.id)}">Hacerlo por chat</button></div>`
      : '';
  return `<li id="q-${esc(job.id)}" class="${cls}">${choose}<span class="name">${esc(name)}</span><span class="state">${esc(jobState(job, st))}</span>${actions}</li>`;
}
function renderQueue() {
  const list = $('[data-ai-queue="material"]');
  const head = $('#q-head');
  if (!list || !queue) return;
  const st = queue.status();
  const c = queue.counts();
  const jobs = queue.jobs();
  const byGroup = new Map();
  for (const j of jobs) { if (!byGroup.has(j.gid)) byGroup.set(j.gid, []); byGroup.get(j.gid).push(j); }
  list.innerHTML = [...byGroup.entries()].map(([gid, js]) => {
    const g = queue.group(gid);
    const live = js.filter((j) => j.state !== 'off');
    const ready = live.filter((j) => ['done', 'published', 'discarded'].includes(j.state)).length;
    const summary = js.length > 1 ? `${ready} de ${plural(live.length, 'parte', 'partes')}${js.some((j) => j.state === 'off') ? ` · ${plural(js.filter((j) => j.state === 'off').length, 'sin elegir', 'sin elegir')}` : ''}` : '';
    return `<li class="file ${js.every((j) => ['done', 'published'].includes(j.state)) ? 'ok' : ''}"><span class="name">${esc(g?.name ?? '')}</span><span class="state">${esc(summary)}</span><ul class="units">${js.map((j) => jobRow(j, js.length > 1, st)).join('')}</ul></li>`;
  }).join('') + queueNotes.map((n) => `<li class="skip"><span class="name">${esc(n.name)}</span><span class="state">${esc(n.why)}</span></li>`).join('');
  if (!head) return;
  if (!c.total && !c.off) { head.innerHTML = ''; return; }
  const parts = [`${c.done} de ${c.total} listas`];
  if (c.running) parts.push('1 leyendo');
  if (c.waiting) parts.push(`${c.waiting} en espera`);
  if (c.manual) parts.push(`${c.manual} para tu chat`);
  if (c.error) parts.push(plural(c.error, 'con error', 'con error'));
  if (c.missing) parts.push(`${c.missing} sin su archivo`);
  const waitingLimit = st.waitUntil > Date.now();
  const line = st.stopped ? `<p class="msg bad">${esc(st.stopped)}</p>`
    : st.paused ? '<p class="msg">En pausa.</p>'
      : waitingLimit ? `<p class="msg">${esc(st.note || 'Tu IA pidió una pausa.')} Sigue sola a las ${esc(clock(st.waitUntil))}.</p>` : '';
  const busy = c.running || (c.waiting && !st.stopped && !st.paused);
  head.innerHTML = `<div class="queue-bar"><progress max="${Math.max(1, c.total)}" value="${c.done}"></progress><p><strong>${esc(parts.join(' · '))}</strong></p></div>${line}
    <div class="actions">${busy && !waitingLimit ? '<button type="button" class="button ghost small" data-q-pause>Pausar</button>' : ''}
      ${st.paused || st.stopped || waitingLimit ? '<button type="button" class="button primary small" data-q-resume>Seguir ahora</button>' : ''}
      ${c.error ? '<button type="button" class="button ghost small" data-q-retry-all>Reintentar las fallidas</button>' : ''}
      ${c.manual && ai.ready() ? '<button type="button" class="button ghost small" data-q-auto>Que mi IA haga las del chat</button>' : ''}
      ${c.reviewed || c.off ? '<button type="button" class="link" data-q-clear>Quitar lo terminado</button>' : ''}
      ${c.total > c.reviewed ? `<button type="button" class="button ghost small danger" data-q-discard-all>${discardAsked > Date.now() ? '¿Descartar todo lo que no publicaste? Toca otra vez' : 'Descartar todo'}</button>` : ''}</div>`;
}
// Every answer waits for review, also after a reload.
function syncReviews() {
  if (!queue || !$('[data-reviews="material"]')) return;
  for (const job of queue.jobs()) {
    if (job.state !== 'done' || reviewOf.has(job.id) || !job.result) continue;
    const g = queue.group(job.gid);
    const made = job.result.way === 'chat' ? null : { provider: job.result.provider, model: job.result.model, effort: job.result.effort };
    const item = addReview(g?.zone ?? 'material', job.result.text, job.label, made, { print: job.print, stage: job.stage, source: g?.v?.source, fallback: g?.v });
    item.jobId = job.id;
    reviewOf.set(job.id, item.id);
  }
}
async function enqueue(zone, files, given) {
  const q = await startQueue();
  const v = given ? valuesFor(given) : materialValues();
  const known = printed();
  const manual = !ai.ready();
  // What the picker shows now, a model just typed included, is what the queue uses.
  if (!given && $('[data-ai-pick="material"]')) ai.picked('material');
  queueNotes.length = 0;
  let added = 0;
  // From «Estudia», a folder is one group (one material, packed into as few requests as fit).
  for (const group of given?.oneFolder ? [{ name: given.oneFolder, files, folder: true }] : groupFiles(files)) {
    const print = await printOf(group).catch(() => '');
    const queued = print ? q.groups().find((g) => g.print === print) : null;
    if (queued) {
      const missing = q.jobs().some((j) => j.gid === queued.id && j.state === 'missing');
      if (missing) await q.attach(print, group.files); else queueNotes.push({ name: group.name, why: 'Ya está en la cola' });
      continue;
    }
    let p;
    try { p = await prepareGroup(group); } catch (error) { queueNotes.push({ name: group.name, why: `No se pudo leer: ${error.message || 'formato desconocido'}` }); continue; }
    if (p.skipped) { queueNotes.push({ name: group.name, why: `Saltado: ${p.skipped}` }); continue; }
    const count = p.units.length;
    const prints = p.units.map((_, i) => unitPrint(print, i, count));
    const inMap = prints.map((x) => !!x && known.has(x));
    // The stage the file's name says («Examen parcial 1.pdf»), unless the form says it for the whole batch.
    const units = p.units.map((u, i) => ({ label: u.label, note: u.note, stage: v.stage || stageOf(u.label)?.label || '', print: prints[i], on: !!u.selected && !inMap[i], inMap: inMap[i] }));
    const { group: g } = await q.add({ zone, name: group.name, code: !!group.code, print, v: { ...v, known: (v.known ?? []).slice(0, 400) }, list: group.files, units, manual });
    remember(g.id, p);
    for (const n of p.notes ?? []) queueNotes.push({ name: group.name, why: n });
    added += 1;
  }
  if (added && manual) ctx.toast('Sin una IA conectada, cada parte queda lista para tu chat.');
  renderQueueSoon();
}
let discardAsked = 0; // «Descartar todo» asks once more before it empties the queue
async function queueAction(t) {
  const q = await startQueue();
  if (t.dataset.qDiscardAll !== undefined) {
    if (discardAsked < Date.now()) { discardAsked = Date.now() + 5000; renderQueue(); setTimeout(renderQueueSoon, 5100); return; }
    discardAsked = 0;
    await q.discardAll();
    for (const [id, item] of reviews) if (item.jobId && !item.done) { reviews.delete(id); document.getElementById(id)?.remove(); }
    ctx.toast('Descartado. No se publicó nada de eso.');
    return;
  }
  if (t.dataset.qPause !== undefined) q.pause();
  if (t.dataset.qResume !== undefined) q.resume();
  if (t.dataset.qRetryAll !== undefined) q.retryFailed();
  if (t.dataset.qClear !== undefined) q.clearFinished();
  if (t.dataset.qAuto !== undefined) for (const j of q.jobs()) if (j.state === 'manual') await q.retry(j.id);
  if (t.dataset.qRetry) q.retry(t.dataset.qRetry);
  if (t.dataset.qChat) q.toChat(t.dataset.qChat);
  const id = t.dataset.qCopy || t.dataset.qDownload || t.dataset.qAnswer;
  if (!id) return;
  const job = q.job(id);
  const group = job && q.group(job.gid);
  if (!job || !group) return;
  if (t.dataset.qCopy) copy(instructionsOf(job, group), 'Instrucciones');
  if (t.dataset.qDownload) {
    const list = await q.filesOf(group.id);
    if (!list) { ctx.toast('Suelta este archivo otra vez: el navegador no lo guardó.'); return; }
    const unit = await unitOf(job, group, list);
    const zip = partFiles(await unit.make()).map((f) => ({ name: f.name, bytes: f.bytes }));
    zip.push({ name: 'instrucciones.md', bytes: new TextEncoder().encode(instructionsOf(job, group)) });
    download(`${baseName(job.label).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.zip`, zipFiles(zip), 'application/zip');
  }
  if (t.dataset.qAnswer) {
    const area = $(`[data-q-paste="${CSS.escape(id)}"]`);
    if (!area?.value.trim()) { ctx.toast('Pega primero lo que te devolvió tu IA.'); return; }
    await q.answer(id, area.value);
  }
}
// Without an API key: the same preparation, as files to download and take to a chat with the instructions.
async function prepareForChat(files) {
  const out = $('#m-prepared');
  out.hidden = false;
  out.innerHTML = '<p class="status">Preparando…</p>';
  const v = materialValues();
  const zip = [];
  const notes = [];
  for (const group of groupFiles(files)) {
    const prepared = await prepareGroup(group).catch((e) => ({ skipped: e.message }));
    if (prepared.skipped) { notes.push(`${group.name}: ${prepared.skipped}`); continue; }
    for (const [i, unit] of prepared.units.entries()) {
      if (!unit.selected) continue;
      const folder = `${String(i + 1).padStart(2, '0')} ${baseName(unit.label).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}`;
      for (const f of partFiles(await unit.make())) zip.push({ name: `${folder}/${f.name}`, bytes: f.bytes });
      zip.push({ name: `${folder}/instrucciones.md`, bytes: new TextEncoder().encode(contributionInstructions({ ...v, stage: v.stage || stageOf(unit.label)?.label || '', part: unit.note })) });
    }
  }
  if (zip.length) download('studium-material-preparado.zip', zipFiles(zip), 'application/zip');
  out.innerHTML = `<p>${zip.length ? 'Se descargó <strong>studium-material-preparado.zip</strong>: una carpeta por parte, con sus archivos y sus instrucciones. Abre un chat nuevo por carpeta, adjunta lo que trae y pega sus instrucciones.' : 'No quedó nada que preparar.'}</p>${notes.length ? `<ul class="warnings">${notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}
// A dropped folder arrives as entries: walk it.
async function droppedFiles(dataTransfer) {
  const out = [];
  const walk = (entry) => new Promise((resolve) => {
    if (entry.isFile) entry.file((f) => { out.push(f); resolve(); }, () => resolve());
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const more = () => reader.readEntries(async (batch) => { if (!batch.length) { for (const e of all) await walk(e); resolve(); } else { all.push(...batch); more(); } }, () => resolve());
      more();
    } else resolve();
  });
  const entries = [...(dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  for (const e of entries) await walk(e);
  return out;
}

/* ---------- what «Estudia» calls ---------- */
// To the knowledge graph: the queue of the person's AI, with the kind and course «Estudia» found.
export const shareToGraph = (files, values) => enqueue('material', files, values);
// A guide from what was dropped: the files become its notes, and what «Estudia» saw prefills its exact questions.
let found = null; // { piles, exams, links }
export function startGuide(files, preset) {
  if (files.length) { notes = files.slice(0, 20); }
  found = { piles: preset.piles ?? [], exams: preset.exams ?? [], links: preset.links ?? [] };
  pending = { course: preset.course, graph: true };
  location.hash = '#/estudiar/guia';
}
export { droppedFiles };
// The exact instructions «Procesar material» sends, for the person to read before anything runs.
export const materialInstructions = (values) => contributionInstructions(valuesFor(values));

/* ---------- material ---------- */
function materialPane() {
  const d = { kind: '', ...(store.get('studium-draft-material') ?? {}) };
  const told = Object.entries(d).some(([k, v]) => k !== 'kind' && v) || d.kind;
  return `${datalists()}
  <ol class="flow">
    <li class="step glass">
      <h2>Tu IA reconoce el material sola</h2>
      <p>Qué es, de qué materia, de qué profe y de qué evaluación: lo saca del material. No tienes que llenar nada.</p>
      <details class="more" ${told ? 'open' : ''}><summary>Si quieres, dile tú algún dato</summary>
      <form class="grid" id="m-form">
        ${segmented('kind', { '': 'Que lo reconozca', ...KINDS }, d.kind, 'Qué material es')}
        <p class="hint wide kind-hint" id="m-kind-hint">${esc(KIND_HINTS[d.kind] ?? '')}</p>
        ${input('course', 'Materia, competencia o carrera', d.course, 'list="dl-courses" autocomplete="off"')}
        ${input('code', 'Código', d.code, 'autocomplete="off"')}
        ${input('university', 'Universidad u organizador', d.university, 'list="dl-unis" autocomplete="off"')}
        ${input('professor', 'Profesor', d.professor, 'list="dl-profs" autocomplete="off"')}
        ${input('term', 'Semestre o edición', d.term, 'list="dl-terms" autocomplete="off" placeholder="202610, IEEEXtreme 19.0…"')}
        ${input('stage', 'Evaluación', d.stage, 'list="dl-stages" autocomplete="off" placeholder="Examen 1, Examen 2, Final… (si es de una sola)"')}
        ${ctx.state.sources.length ? `<label class="field"><span>De dónde viene</span><select name="source"><option value="">De mí o de mis compañeros</option>${ctx.state.sources.map((x) => `<option value="${esc(x.id)}" ${d.source === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      </form>
      <datalist id="dl-stages">${['Examen 1', 'Examen 2', 'Examen 3', 'Examen 4', 'Final', 'Quiz 1', 'Quiz 2', 'Deber 1', 'Proyecto'].map((x) => `<option value="${x}">`).join('')}</datalist>
      <p class="fine">Si subes varios archivos de evaluaciones distintas, deja «Evaluación» vacío: Studium la lee del nombre de cada archivo (por ejemplo, «Parcial 2.pdf»), y tu IA del material.</p>
      </details>
      <details class="prompt"><summary>Ver las instrucciones que recibe tu IA</summary><pre id="m-prompt"></pre></details>
    </li>
    ${aiStep('material')}
    <li class="step glass">
      <h2>${ai.ready() ? 'O hazlo a mano, con cualquier IA' : 'Pásale tu material a tu IA'}</h2>
      <p>Sirve con cualquier IA que lea archivos: ChatGPT, Gemini, Claude, Copilot o NotebookLM.</p>
      <div class="actions">
        <button class="button ${ai.ready() ? 'ghost' : 'primary'}" id="m-copy">Copiar instrucciones</button>
        <button class="button ghost" id="m-download">Descargar instrucciones</button>
      </div>
      <ol class="howto">
        <li>Abre un chat nuevo en tu IA.</li>
        <li>Adjunta tu material: PDF, fotos, diapositivas, enunciados o la malla. Varios archivos a la vez está bien.</li>
        <li>Pega las instrucciones y envía.</li>
        <li>Descarga el archivo <code>.json</code> que te devuelve. Si tu IA no crea archivos, copia su bloque de código.</li>
      </ol>
      <details class="prepare"><summary>¿Un libro entero, un Word, un PowerPoint o un ZIP? Studium te lo prepara</summary>
        <p>Suéltalo aquí: Studium lo lee en tu navegador, lo divide en partes que cualquier chat acepta (los libros, por capítulos) y te descarga una carpeta por parte con sus instrucciones.</p>
        <label class="button ghost">Elegir archivos<input type="file" multiple hidden data-prepare></label>
        <div id="m-prepared" hidden></div>
      </details>
      <p class="note">Tu material no se sube a Studium: solo el resumen anónimo que hace tu IA, después de que lo revises.</p>
    </li>
    <li class="step glass">
      <h2>Sube lo que te devolvió</h2>
      ${dropzone('material')}
    </li>
  </ol>`;
}
function materialValues() {
  const form = $('#m-form');
  const v = form ? Object.fromEntries(new FormData(form).entries()) : {};
  if (form) store.set('studium-draft-material', v);
  return valuesFor(v);
}
function valuesFor(v) {
  const k = known();
  const course = v.course?.trim();
  // The concepts the map already has for this course, by the names the map shows (the course's node, so its guides
  // and every spelling of the course count), so the AI reuses them and the map joins them.
  const node = ctx.state.graph?.byId.get(`course:${keyOf(canonicalCourse(course))}`);
  const knownConcepts = node
    ? uniq(ctx.state.graph.nodes.filter((n) => n.type === 'concept' && n.courses.has(node.id)).sort((a, b) => b.weight - a.weight).map((n) => n.name))
    : uniq(ctx.state.contributions.filter((c) => keyOf(c.course) === keyOf(course)).flatMap((c) => (c.data.concepts ?? []).map((x) => x.name)));
  return { ...v, course: canonicalCourse(course), professor: canonical(v.professor?.trim(), k.professors), stage: stageLabel(v.stage ?? ''), source: v.source ?? '', known: knownConcepts };
}
const materialPrompt = () => { const v = materialValues(); return v.kind === 'curriculum' ? curriculumInstructions(v) : contributionInstructions(v); };

/* ---------- guide ---------- */
// A guide starts from what the person is studying (any subject, known to Studium or not) and from their own notes,
// which go only to their AI. What the community already knows of that subject (the map) is an extra they can add. The
// details are optional and folded away. Three ways to make it: the AI connected with a key, the person's own
// subscription in the provider's page, or by hand with any AI.
const SECTIONS = {
  flashcards: 'Tarjetas de términos para repasar',
  mock: 'Simulacro de la prueba, con tiempo',
  cheatsheet: 'Resumen de una página para el último repaso',
  mistakes: 'Errores comunes y trampas',
  solved: 'Ejercicios resueltos paso a paso',
  conceptmap: 'Mapa de conceptos interactivo',
  selfcheck: 'Autoevaluación con puntaje al final de cada tema',
};
// What fits each way of studying (the person's setting), checked by default.
const RECOMMENDED = { examenes: ['mock', 'cheatsheet', 'mistakes'], gusto: ['conceptmap', 'solved'], intensivo: ['flashcards', 'mock'], metas: ['selfcheck', 'flashcards'] };
const DECOR = { notebook: 'Cuaderno', minimal: 'Minimal', playful: 'Tierna', night: 'Nocturna' };
// The chat pages where a subscription works. Studium copies the instructions and opens a new chat there.
const CHATS = {
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
};
const NOTE_TYPES = '.pdf,image/*,.txt,.md,.tex,.csv,.docx,.pptx,.xlsx,.odt,.odp,.epub,.ipynb,.zip,.py,.c,.cpp,.java,.js,.html';
let notes = []; // the person's own files for this guide: read in this browser, sent only to their AI
let scope = null;
// A guide made from the map (a route, or a selection): its fields, and exactly those concepts as the map's part.
let pending = null;
let fromMap = null; // { keys: Set, label, bands }
export function presetGuide(preset) {
  pending = preset;
  fromMap = preset.route ? { keys: new Set(preset.route.keys), label: preset.route.label, bands: preset.route.bands } : null;
  store.set('studium-draft-guide', { ...(store.get('studium-draft-guide') ?? {}), course: preset.course, code: preset.code, title: preset.title, professor: preset.professor, term: preset.term, graph: true });
}

function courseNode(name) {
  return name ? ctx.state.graph?.byId.get(`course:${keyOf(name)}`) ?? null : null;
}
function guidePane(preset = {}) {
  const d = { level: 'standard', length: 'medium', practice: 'normal', challenge: 'same', examples: 'normal', language: 'C++', ...(store.get('studium-draft-guide') ?? {}), ...preset, ...(pending ?? {}) };
  pending = null;
  // Links from the map and the home page name the course by its node.
  if (String(d.course ?? '').startsWith('course:')) d.course = ctx.state.graph?.byId.get(d.course)?.name ?? '';
  const node = courseNode(d.course);
  const contest = node?.theme === 'algoritmos' || node?.contributions.some((c) => c.kind === 'contest');
  const mode = prefs.get().mode;
  const custom = store.get('studium-guide-custom');
  return `${datalists()}
  <form id="g-form" autocomplete="off" novalidate><ol class="flow">
    <li class="step glass">
      <h2>${d.course ? esc(d.course) : 'La materia'}</h2>
      <div class="grid">
        <label class="field wide"><span>Materia o tema</span><input name="course" value="${esc(d.course ?? '')}" list="dl-courses" maxlength="80" placeholder="Redes de Computadores, Cálculo II, la Revolución francesa…"></label>
        ${input('title', 'Para qué (opcional)', d.title ?? '', 'maxlength="80" placeholder="Examen 2, el final, entenderlo de una vez…"')}
        ${input('date', 'Fecha (opcional)', d.date ?? '', 'type="date"')}
        <details class="more wide" ${d.professor || d.term || d.code ? 'open' : ''}><summary>Más datos, si los tienes: profesor, semestre, código</summary>
          <div class="grid">${input('professor', 'Profesor', d.professor ?? '', 'list="dl-profs" maxlength="80"')}${input('term', 'Semestre o edición', d.term ?? '', 'list="dl-terms" maxlength="40" placeholder="202610"')}${input('code', 'Código', d.code ?? '', 'maxlength="20" placeholder="CMP-4005"')}</div>
        </details>
      </div>
    </li>
    <li class="step glass">
      <h2>${notes.length ? 'Tus archivos' : '¿De dónde sale?'}</h2>
      <p>${notes.length ? 'Van solo a tu IA; a Studium no llegan. Puedes sumar o quitar.' : 'De tus apuntes: PDF, fotos del cuaderno, diapositivas o deberes. Van solo a tu IA; a Studium no llegan.'}</p>
      <div class="dropzone notes" data-notes-drop>
        <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h14l10 10v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M28 6v10h10M18 26h12M18 33h8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p><strong>Suelta aquí tus apuntes</strong>, o</p>
        <label class="button ghost">Elegir archivos<input type="file" multiple hidden data-notes accept="${NOTE_TYPES}"></label>
      </div>
      <ul class="notes-list" id="g-notes"></ul>
      <label class="toggle"><input type="checkbox" name="graph" ${d.graph !== false ? 'checked' : ''}><span class="knob"></span>Sumar el grafo de conocimiento</label>
      <div class="from-map" id="g-from-map" hidden></div>
      <div class="scope" id="g-scope-wrap" hidden>
        <div class="scope-head"><h3>Conceptos del grafo que entran</h3><button type="button" class="link" data-scope="all">Todos</button><button type="button" class="link" data-scope="none">Ninguno</button></div>
        <div class="chips" id="g-scope"></div>
      </div>
      <p class="note" id="g-summary"></p>
    </li>
    <li class="step glass">
      <h2>Este examen</h2>
      <div class="grid">
        ${segmented('scope', { all: 'Todo', range: 'Una parte' }, d.scope ?? 'all', '¿Qué temas entran?')}
        <div class="wide g-range" ${d.scope === 'range' ? '' : 'hidden'}><div class="grid">${input('from', 'Desde', d.from ?? '', 'list="dl-stages-g" placeholder="Examen 2, capítulo 4…"')}${input('until', 'Hasta', d.until ?? '', 'list="dl-stages-g" placeholder="lo de la semana 10…"')}</div></div>
        <datalist id="dl-stages-g">${['Examen 1', 'Examen 2', 'Examen 3', 'el inicio', 'lo último que vimos'].map((x) => `<option value="${x}">`).join('')}</datalist>
        <fieldset class="tagpick wide"><legend>¿De dónde salen los temas?</legend><div>${Object.entries(SOURCES_OF).map(([k, label]) => `<label><input type="checkbox" name="sources" value="${k}" ${(d.sources ?? defaultSources()).includes(k) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div></fieldset>
        <label class="toggle wide"><input type="checkbox" name="likeExams" ${(d.likeExams ?? !!(found?.exams ?? []).length) ? 'checked' : ''}><span class="knob"></span>Preguntas como las de mis exámenes anteriores</label>
        ${(found?.exams ?? []).length ? `<p class="fine">Tomará como referencia: ${esc(found.exams.slice(0, 4).join(', '))}${found.exams.length > 4 ? '…' : ''}</p>` : ''}
        ${input('style', 'Cómo serán las preguntas (opcional)', d.style ?? '', 'maxlength="160" placeholder="Opción múltiple, desarrollo, problemas largos…"')}
      </div>
    </li>
    <li class="step glass">
      <details class="custom" id="g-custom" ${custom ? 'open' : ''}>
        <summary><span class="custom-title">Hazla a tu medida</span><span class="muted">Opcional: nivel, extensión, práctica, idioma, estilo y secciones extra.</span></summary>
        <div class="grid">
          ${segmented('level', LEVELS, d.level, 'Nivel de explicación')}
          ${segmented('length', { short: 'Repaso corto', medium: 'Media', complete: 'Completa' }, d.length, 'Extensión')}
          ${segmented('practice', { few: 'Poca', normal: 'Normal', lots: 'Mucha' }, d.practice, 'Práctica')}
          ${segmented('challenge', { easier: 'Más fácil', same: 'Como la evaluación', harder: 'Más difícil' }, d.challenge, 'Dificultad de la práctica')}
          ${segmented('examples', { few: 'Pocos', normal: 'Normal', lots: 'Muchos' }, d.examples, 'Ejemplos resueltos')}
          ${contest ? segmented('language', { 'C++': 'C++', Python: 'Python', Java: 'Java' }, d.language, 'Lenguaje del código') : ''}
          ${segmented('lang', { es: 'Español', en: 'English' }, d.lang ?? (prefs.get().lang || 'es'), 'Idioma de la guía')}
          ${segmented('decor', DECOR, d.decor ?? 'notebook', 'Estilo y decoración')}
          ${input('focus', 'Quiero reforzar', d.focus ?? '', 'maxlength="160" placeholder="Ej.: demostraciones, subredes, programación dinámica…"')}
          ${input('goal', 'Mi objetivo con esta guía', d.goal ?? '', 'maxlength="160" placeholder="Sacar más de 18, entender desde cero, repasar en una noche…"')}
          <fieldset class="tagpick wide"><legend>Secciones extra</legend><div>${Object.entries(SECTIONS).map(([k, label]) => {
            const rec = (RECOMMENDED[mode] ?? []).includes(k);
            const on = d.sections ? d.sections.includes(k) : rec;
            return `<label><input type="checkbox" name="sections" value="${k}" ${on ? 'checked' : ''}><span>${esc(label)}${rec ? ' <small>· recomendada para ti</small>' : ''}</span></label>`;
          }).join('')}</div></fieldset>
        </div>
      </details>
    </li>
    <li class="step glass">
      <h2>Créala</h2>
      <p>Elige una de las tres: las tres dan la misma guía. Van de la más cómoda, donde Studium hace todo, a la más a mano.</p>
      <div class="ways">
        <section class="way ${ai.ready() ? 'ready' : ''}">
          <h3>Con tu IA conectada</h3>
          <p>${ai.ready() ? 'Studium le pasa tus apuntes y las instrucciones; tú solo revisas el resultado.' : 'Conecta Claude, ChatGPT o Gemini con tu clave y Studium hace todo el camino, sin copiar ni pegar.'}</p>
          ${ai.pickerHTML('guide')}
          ${ai.ready() ? '<button type="button" class="button primary" id="g-ai">Crear con mi IA</button>' : '<a class="button ghost" href="#/ajustes">Conectar mi IA</a>'}
        </section>
        <section class="way">
          <h3>Con tu suscripción</h3>
          <p>En la página de Claude, ChatGPT o Gemini, con tu cuenta de siempre. Studium copia las instrucciones y abre un chat nuevo.</p>
          <div class="actions">${Object.entries(CHATS).map(([k, c]) => `<button type="button" class="button ${ai.ready() ? 'ghost' : k === 'claude' ? 'primary' : 'ghost'}" data-chat="${k}">Abrir ${c.name}</button>`).join('')}</div>
        </section>
        <section class="way">
          <h3>A mano</h3>
          <p>Con cualquier otra IA: copia o descarga las instrucciones y pégalas junto con tus apuntes.</p>
          <div class="actions"><button type="button" class="button ghost" id="g-copy">Copiar</button><button type="button" class="button ghost" id="g-download">Descargar</button></div>
        </section>
      </div>
      <p class="ai-progress" id="g-ai-progress" role="status" hidden></p>
      <ol class="howto" id="g-howto" hidden></ol>
      <details class="prompt"><summary>Ver las instrucciones que recibe tu IA</summary><pre id="g-prompt"></pre></details>
    </li>
  </ol></form>
  <ol class="flow after">
    <li class="step glass">
      <h2>Sube la guía que te devolvió</h2>
      ${dropzone('guide')}
    </li>
  </ol>`;
}
const SOURCES_OF = { notes: 'Fotos y apuntes', prof: 'Diapositivas y material del profe', book: 'Capítulos del libro', homework: 'Deberes', exam: 'Exámenes anteriores', video: 'Videos', web: 'Páginas web' };
const defaultSources = () => { const p = found?.piles ?? []; const out = Object.keys(SOURCES_OF).filter((k) => p.includes(k) || (k === 'web' && p.includes('code'))); return out.length ? out : ['notes']; };
function guideValues() {
  const form = $('#g-form');
  if (!form) return null;
  const f = new FormData(form);
  const v = Object.fromEntries(f.entries());
  v.sections = f.getAll('sections');
  v.sources = f.getAll('sources');
  v.likeExams = f.has('likeExams');
  v.graph = f.has('graph');
  v.course = String(v.course ?? '').trim();
  store.set('studium-draft-guide', v);
  const course = courseNode(v.course);
  const g = ctx.state.graph;
  // From the map: the route's or the selection's concepts, from any course. Otherwise, the course's.
  const concepts = fromMap ? [...fromMap.keys].map((k) => g.byId.get(`concept:${k}`)).filter(Boolean)
    : !course ? [] : g.links.filter((l) => l.kind === 'in' && l.source === course).map((l) => l.target)
      .concat(g.links.filter((l) => l.kind === 'has' && l.source === course).flatMap((l) => g.links.filter((m) => m.source === l.target).map((m) => m.target)))
      .filter((n, i, all) => n.type === 'concept' && all.indexOf(n) === i);
  return { v, course, concepts };
}
function renderNotes() {
  const list = $('#g-notes');
  if (!list) return;
  list.innerHTML = notes.map((f, i) => `<li><span>${esc(f.name)}</span><small>${kb(f.size)}</small><button type="button" class="icon x" data-note-remove="${i}" aria-label="Quitar ${esc(f.name)}"><svg><use href="#i-x"/></svg></button></li>`).join('');
}
function addNotes(files) {
  for (const file of files) {
    if (file.size > 400_000_000) { ctx.toast(`${file.name} pesa demasiado para leerlo aquí.`); continue; }
    if (!notes.some((n) => n.name === file.name && n.size === file.size)) notes.push(file);
  }
  notes = notes.slice(0, 20);
  renderNotes();
  renderScope();
}
function renderScope() {
  const values = guideValues();
  if (!values) return;
  const { v, course, concepts } = values;
  const wrap = $('#g-scope-wrap');
  const summary = $('#g-summary');
  const mine = notes.length ? `Tu IA leerá ${notes.length === 1 ? 'tu archivo' : `tus ${notes.length} archivos`}.` : 'Sin apuntes, tu IA usará lo que sabe del tema.';
  const banner = $('#g-from-map');
  if (banner) {
    banner.hidden = !fromMap || !v.graph;
    if (fromMap) {
      const qs = concepts.reduce((s, n) => s + n.questions.length, 0);
      banner.innerHTML = `<p><strong>Desde el grafo${fromMap.label ? `: la ruta ${esc(fromMap.label)}` : ''}</strong> · ${concepts.length} conceptos y ${qs} preguntas, con lo que necesitas antes. Puedes crear la guía solo con esto, o sumar tus apuntes.</p><button type="button" class="link" data-from-map-clear>Usar toda la materia</button>`;
    }
  }
  if (!v.graph || (!course && !fromMap)) {
    wrap.hidden = true;
    const known = course ? ` En el grafo hay ${course.contributions.length} ${course.contributions.length === 1 ? 'aporte' : 'aportes'} de ${course.name}: actívalo si quieres sumarlos.` : '';
    summary.textContent = v.graph && v.course && !course ? `${mine} Todavía no hay aportes de «${v.course}» en el grafo: la guía saldrá de tus apuntes.` : `${mine}${known}`;
  } else {
    const scopeKey = fromMap ? `map:${[...fromMap.keys].join(',')}` : course.id;
    if (!scope || scope.key !== scopeKey) scope = { key: scopeKey, off: new Set() };
    wrap.hidden = !concepts.length;
    const ranked = [...concepts].sort((a, b) => b.questions.length - a.questions.length || a.name.localeCompare(b.name, 'es'));
    $('#g-scope').innerHTML = ranked.map((n) => `<button type="button" class="chip ${scope.off.has(n.key) ? '' : 'on'}" data-concept="${esc(n.key)}">${esc(n.name)}${n.questions.length ? `<small>${n.questions.length}</small>` : ''}</button>`).join('');
    const lessons = fromMap ? sourcesOf(concepts) : course.contributions;
    const qs = fromMap ? concepts.reduce((s, n) => s + n.questions.length, 0) : lessons.reduce((s, c) => s + (c.data.questions?.length ?? 0), 0);
    const prof = v.professor ? lessons.filter((c) => keyOf(c.professor) === keyOf(v.professor)).length : 0;
    summary.textContent = `${mine} Del grafo suma ${concepts.length} conceptos y ${qs} preguntas${course && !fromMap ? ` de ${course.name}` : ''}${v.professor ? `; ${prof} de esos aportes son de ${v.professor}` : ''}.`;
  }
  $('#g-prompt').textContent = guidePrompt({ inline: true });
}
// The contributions behind some concepts, from any course.
function sourcesOf(concepts) {
  const ids = new Set(concepts.flatMap((n) => [...n.items]));
  return ctx.state.contributions.filter((c) => ids.has(c.id));
}
function guideRequest() {
  const { v, course, concepts } = guideValues();
  const picked = concepts.filter((n) => !scope?.off.has(n.key));
  const theme = course?.theme ?? guessTheme(v.course);
  const contest = theme === 'algoritmos' || !!course?.contributions.some((c) => c.kind === 'contest');
  const file = `studium-contexto-${keyOf(v.course || 'guia').slice(0, 40)}.md`;
  return { v, course, picked, contest, theme, file, graph: v.graph && (!!course || (!!fromMap && picked.length > 0)) };
}
function guidePrompt({ api = false, inline = false } = {}) {
  const r = guideRequest();
  return guideInstructions({
    ...r.v, course: r.v.course || 'el tema que te indico', code: r.v.code || r.course?.code || '',
    university: r.course?.contributions.find((c) => c.university)?.university ?? '', theme: r.theme, contest: r.contest,
    graph: r.graph, contextFile: inline ? '' : r.file, api, notes: notes.length, mode: prefs.get().mode,
    until: fromMap && r.graph ? fromMap.label : '',
    scope: r.v.scope === 'range' ? { from: r.v.from, until: r.v.until } : null,
    sources: (r.v.sources ?? []).map((k) => SOURCES_OF[k]).filter(Boolean),
    likeExams: r.v.likeExams ? (found?.exams ?? []) : null, style: r.v.style, links: found?.links ?? [],
  });
}
function guideContext() {
  const { v, course, picked, contest } = guideRequest();
  if (!course && !fromMap) return '';
  return contextPack({
    course: { name: course?.name ?? v.course, code: course?.code ?? v.code ?? '', university: course?.contributions.find((c) => c.university)?.university ?? '' },
    professor: v.professor, term: v.term, contest,
    concepts: picked.map((n) => ({ key: n.key, name: n.name, summaries: n.summaries.map((s) => s.text), relations: n.relations, band: fromMap?.bands?.[n.key] ?? '' })),
    contributions: fromMap ? sourcesOf(picked) : course.contributions, guides: course?.guides ?? [],
    ordered: !!fromMap,
  });
}
// The course is the one thing a guide needs.
function guideReady() {
  const field = $('#g-form [name="course"]');
  if (field?.value.trim()) return true;
  ctx.toast('Escribe primero qué vas a estudiar.');
  field?.focus();
  return false;
}
// The instructions with the map's context inline, for a chat or for any AI.
function fullPrompt() {
  const r = guideRequest();
  const context = r.graph ? guideContext() : '';
  return guidePrompt({ inline: true }) + (context ? `\n\n---\n\n# Contexto de Studium: ${r.course?.name ?? r.v.course}\n\n${context}` : '');
}
// With a subscription: the instructions go to the clipboard, a new chat opens in the provider's page, and the steps
// stay here.
async function openChat(key) {
  if (!guideReady()) return;
  const chat = CHATS[key];
  const text = fullPrompt();
  let copied = true;
  try { await navigator.clipboard.writeText(text); } catch { copied = false; download('studium-instrucciones-guia.md', text); }
  window.open(chat.url, '_blank', 'noopener');
  const howto = $('#g-howto');
  howto.hidden = false;
  howto.innerHTML = [
    copied ? `En ${chat.name}, pega las instrucciones: <kbd>Ctrl</kbd> + <kbd>V</kbd> (en Mac, <kbd>⌘</kbd> + <kbd>V</kbd>).` : `Se descargó el archivo de instrucciones: adjúntalo en ${chat.name}.`,
    notes.length ? `Adjunta tus apuntes: ${notes.map((n) => `<strong>${esc(n.name)}</strong>`).join(', ')}.` : 'Adjunta tus apuntes, si tienes.',
    'Envía. Cuando termine, descarga el archivo <code>.html</code> o copia todo su código.',
    'Vuelve aquí y súbelo en el paso de abajo.',
  ].map((x) => `<li>${x}</li>`).join('');
  ctx.toast(copied ? `Instrucciones copiadas. Pégalas en ${chat.name}.` : 'Instrucciones descargadas.');
}
let making = null;
async function generateGuide() {
  const button = $('#g-ai');
  const out = $('#g-ai-progress');
  if (making) { making.abort(); return; }
  if (!guideReady()) return;
  making = new AbortController();
  button.textContent = 'Cancelar';
  out.hidden = false;
  try {
    // The notes, read like any material (files.js): Word, PowerPoint and long PDFs included. A long PDF sends its
    // first part (a book, its index); everything together stays within what a provider accepts in one request.
    const files = [];
    let size = 0;
    for (const file of notes) {
      out.textContent = `Leyendo ${file.name}…`;
      const prepared = await prepareGroup({ name: file.name, files: [file] }).catch((e) => ({ skipped: e.message }));
      if (prepared.skipped) { ctx.toast(`${file.name}: ${prepared.skipped}.`); continue; }
      for (const unit of prepared.units.filter((u) => u.selected).slice(0, 3)) {
        const parts = await unit.make();
        if (size + partsSize(parts) > 24_000_000) { ctx.toast(`${file.name}: no cabe entero junto con lo demás; va lo primero.`); break; }
        size += partsSize(parts);
        files.push(...parts);
      }
    }
    out.textContent = 'Tu IA está leyendo…';
    const use = ai.picked('guide');
    const r = guideRequest();
    const context = r.graph ? guideContext() : '';
    const res = await ai.run({
      system: guidePrompt({ api: true, inline: true }),
      files,
      text: [files.length ? 'Te adjunto mis apuntes.' : '', context ? `El contexto de Studium:\n\n${context}` : '',
        'Escribe la guía completa. Responde solo con el HTML completo, desde <!doctype html> hasta </html>.'].filter(Boolean).join('\n\n'),
      maxTokens: ai.longest(use), use,
      signal: making.signal,
      onProgress: (n) => { out.textContent = n < 0 ? 'Tu IA está escribiendo la guía…' : `Tu IA está escribiendo la guía… ${n.toLocaleString('es')} caracteres`; },
    });
    const html = ai.htmlFrom(res.text);
    if (!html) throw new Error('Tu IA no devolvió una página HTML completa. Vuelve a intentarlo.');
    const item = addReview('guide', html, `Guía creada con ${ai.WAYS[res.way]?.name ?? 'tu IA'}`, { provider: res.provider, model: res.model, effort: res.effort });
    out.textContent = res.truncated ? 'Lista, pero quedó cortada: elige una extensión más corta y vuelve a crearla.' : 'Lista: revísala abajo y publícala.';
    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    out.textContent = error.message || 'Algo falló.';
  } finally {
    making = null;
    button.textContent = 'Crear con mi IA';
  }
}

/* ---------- review ---------- */
const reviews = new Map(); // review id -> item
let serial = 0;

async function readFiles(zone, files) {
  const guides = zone === 'guide' || zone.startsWith('replace:');
  for (const file of files) {
    // A guide someone already had, in another format: a PDF or Markdown goes to be converted by their AI.
    if (guides && (/\.pdf$/i.test(file.name) || file.type === 'application/pdf')) { addConvert(zone, { file: await ai.readFile(file) }, file.name); continue; }
    if (file.size > 8_000_000) { ctx.toast(`${file.name} pesa más de 8 MB: no es un archivo de Studium.`); continue; }
    const text = await file.text();
    if (guides && /\.(md|markdown|txt)$/i.test(file.name) && !/^\s*[{[]/.test(text)) { addConvert(zone, { text }, file.name); continue; }
    addReview(zone, text, file.name);
  }
}

/* ---------- a guide someone already had, to the current format with their own AI (convert.js) ---------- */
const converting = new Map(); // card id -> { id, zone, source, name, meta, plan, state, running, done }
const legacy = (text) => !/<script[^>]*\bid=["']?studium\b/i.test(text);
function guideFallback() {
  const p = guideValues();
  return p ? { course: p.course?.name ?? p.v.course, code: p.v.code || p.course?.code || '', professor: p.v.professor ?? '', term: p.v.term ?? '', title: p.v.title, date: p.v.date, theme: p.course?.theme ?? guessTheme(p.v.course) } : {};
}
async function addConvert(zone, source, name, meta = null) {
  const id = `c${serial += 1}`;
  const job = { id, zone, source, name, meta: meta ?? (zone === 'guide' ? guideFallback() : {}), plan: null, state: {} };
  converting.set(id, job);
  const list = $(`[data-reviews="${zone.startsWith('replace:') ? 'mine' : zone}"]`);
  list.insertAdjacentHTML('afterbegin', `<article class="review glass" id="${id}"></article>`);
  renderConvert(job, 'Leyendo la guía tal como se ve…');
  rise(list, ':scope > :first-child');
  try { job.plan = await convert.plan(source); renderConvert(job); } catch (error) { renderConvert(job, error.message || 'No se pudo leer la guía.'); }
}
function renderConvert(job, status = '') {
  const el = document.getElementById(job.id);
  if (!el) return;
  const p = job.plan;
  el.innerHTML = `<header><span class="badge">Para convertir</span><strong>${esc(job.name)}</strong><button class="link" data-discard="${job.id}">Quitar</button></header>
    ${job.done ? `<p class="done">${job.done}</p>` : `
    <p>Tu IA la rehace con el diseño actual de Studium, sin dejar nada fuera: cada explicación, pregunta, figura y animación.${p ? (p.mode === 'one' ? ' Va en un solo pedido.' : ` Es larga: va en ${p.parts.length + 1} pedidos, primero la página y después cada parte; si uno falla, se reintenta sin repetir los demás.`) : ''}${p?.extraParts ? ' También van los textos que la guía guardaba en su código (tarjetas, glosario, preguntas).' : ''} Tu archivo original no cambia.</p>
    ${ai.ready() ? ai.pickerHTML('edit') : '<p class="note">Conecta tu IA en <a href="#/ajustes">Ajustes</a> para convertirla.</p>'}
    ${p ? convert.promptsHTML(p, job.meta) : ''}
    <p class="ai-progress" role="status" ${status ? '' : 'hidden'}>${esc(status)}</p>
    ${job.coverage !== undefined ? convert.coverageHTML(job.coverage) : ''}
    <div class="actions"><button class="button primary" data-convert-run="${job.id}" ${p && ai.ready() && !job.running ? '' : 'disabled'}>${Object.keys(job.state.done ?? {}).length || job.state.shell ? 'Seguir donde quedó' : 'Convertir con mi IA'}</button></div>`}`;
}
async function runConvertCard(job) {
  if (!job?.plan || job.running) return;
  job.running = true;
  const card = document.getElementById(job.id);
  const use = ai.picked('edit', card ?? document);
  renderConvert(job, 'Tu IA está trabajando…');
  try {
    const done = await convert.run(job.plan, { meta: job.meta, use, state: job.state, onProgress: (text) => { const out = document.querySelector(`#${job.id} .ai-progress`); if (out) { out.hidden = false; out.textContent = text; } } });
    job.coverage = done.coverage;
    job.running = false;
    job.done = `Lista. Revísala en la tarjeta nueva antes de publicarla.${done.coverage ? ` ${convert.coverageHTML(done.coverage)}` : ''}`;
    renderConvert(job);
    addReview(job.zone, done.html, `${job.name} · en el formato actual`, { provider: done.made?.provider, model: done.made?.model, effort: done.made?.effort }, { fallback: job.meta });
  } catch (error) {
    job.running = false;
    renderConvert(job, error.message || 'Algo falló. Vuelve a intentarlo: lo hecho se conserva.');
  }
}
// extra: what Studium knows of the original file (its fingerprint, its stage, its source).
function addReview(zone, text, name, made = null, extra = {}) {
  const html = /^\s*<!doctype html/i.test(text.replace(/^﻿/, ''));
  const preset = zone === 'guide' ? guideValues() : null;
  const fallback = zone === 'guide' && preset
    ? { course: preset.course?.name ?? preset.v.course, code: preset.v.code || preset.course?.code || '', professor: preset.v.professor ?? '', term: preset.v.term ?? '', title: preset.v.title, date: preset.v.date, level: preset.v.level, theme: preset.course?.theme ?? guessTheme(preset.v.course) }
    : extra.fallback ? { ...extra.fallback, ...(extra.stage ? { stage: extra.stage } : {}) }
      : $('#m-form') ? { ...materialValues(), ...(extra.stage ? { stage: extra.stage } : {}) } : {};
  const parsed = html ? parseGuide(text, fallback) : parseContribution(text, fallback);
  if (!html && !parsed.error) parsed.meta.source = extra.source ?? fallback.source ?? '';
  // Where it came from (the folders, the week, the tool): kept in the contribution's body, so the graph can order and
  // relate nodes by it. The files of a lab say whether the professor gave them or they are a student's answer.
  if (!html && !parsed.error) {
    const tool = fallback.tool || parsed.data.activity?.tool || '';
    const files = (parsed.data.activity?.files ?? []).map((f) => ({ ...f, url: '' }));
    const context = { ...(fallback.folder ? { folder: String(fallback.folder).slice(0, 200) } : {}), ...(fallback.place ? { place: String(fallback.place).slice(0, 40) } : {}), ...(tool ? { tool: String(tool).slice(0, 60) } : {}), ...(files.length ? { files } : {}) };
    if (Object.keys(context).length) parsed.data.context = context;
  }
  const id = `r${serial += 1}`;
  const item = { id, zone, name, html, text, parsed, visibility: 'public', confirmed: false, replace: zone.startsWith('replace:') ? zone.slice(8) : '', ai: made, sign: false, print: extra.print ?? '' };
  reviews.set(id, item);
  const list = $(`[data-reviews="${zone.startsWith('replace:') ? 'mine' : zone}"]`);
  list.insertAdjacentHTML('afterbegin', `<article class="review glass" id="${id}"></article>`);
  renderReview(item);
  rise(list, ':scope > :first-child');
  return item;
}
function renderReview(item) {
  const el = document.getElementById(item.id);
  const { parsed } = item;
  if (parsed.error) {
    el.innerHTML = `<header><span class="badge bad">No se pudo leer</span><strong>${esc(item.name)}</strong><button class="link" data-discard="${item.id}">Quitar</button></header><p class="msg">${esc(parsed.error)}</p>`;
    return;
  }
  const k = known();
  const m = parsed.meta;
  m.course = canonicalCourse(m.course);
  m.professor = canonical(m.professor, k.professors);
  m.theme = validTheme(m.theme) ?? ctx.state.themes.get(keyOf(m.course)) ?? guessTheme(m.course);
  const findings = findPersonal(item.html ? parsed.text : item.text, ctx.user.email);
  const blocking = findings.filter((f) => f.block);
  const needsLook = findings.filter((f) => !f.block);
  const isGuide = item.html;
  const curriculum = !isGuide && m.kind === 'curriculum';
  const conceptNames = isGuide ? parsed.concepts.map((c) => c.name) : (parsed.data.concepts ?? []).map((c) => c.name);
  const inMap = new Set(ctx.state.graph.nodes.filter((n) => n.type === 'concept' && !n.ghost).map((n) => n.key));
  const fresh = conceptNames.filter((n) => !inMap.has(keyOf(n))).length;
  const summary = isGuide
    ? `Explica ${conceptNames.length} conceptos (${fresh} nuevos en el grafo). ${kb(new TextEncoder().encode(item.text).length)}.`
    : curriculum
      ? `${parsed.data.curriculum.semesters.length} semestres, ${parsed.data.curriculum.semesters.reduce((s, x) => s + x.courses.length, 0)} materias.`
      : `${conceptNames.length} conceptos (${fresh} nuevos en el grafo), ${parsed.data.questions.length} preguntas, ${parsed.data.examples.length} ejemplos.`;
  const ready = m.course && m.title && !blocking.length && (!needsLook.length || item.confirmed) && (!isGuide || /^\d{4}-\d{2}-\d{2}$/.test(m.date || ''));
  item.ready = !!ready && !item.done;
  const twin = !isGuide && !curriculum ? lookalike(m, parsed.data, item.print) : null;
  el.setAttribute('style', themeStyle(m.theme));
  el.innerHTML = `<header>
      <span class="badge">${isGuide ? 'Guía' : curriculum ? 'Malla' : `Aporte: ${esc(KINDS[m.kind] ?? 'Otro')}`}</span>
      <strong>${esc(item.name)}</strong>
      <button class="link" data-discard="${item.id}">Quitar</button>
    </header>
    ${item.done ? `<p class="done">${item.done}</p>` : `
    <form class="grid" data-meta="${item.id}">
      ${isGuide ? '' : `<label class="field"><span>Tipo</span><select name="kind">${Object.entries(KINDS).map(([key, v]) => `<option value="${key}" ${key === m.kind ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`}
      ${input('course', curriculum ? 'Carrera' : 'Materia o competencia', m.course, 'list="dl-courses" required')}
      ${curriculum ? '' : input('code', 'Código', m.code)}
      ${input('university', 'Universidad u organizador', m.university, 'list="dl-unis"')}
      ${curriculum ? '' : input('professor', 'Profesor', m.professor, 'list="dl-profs"')}
      ${curriculum ? '' : input('term', 'Semestre o edición', m.term, 'list="dl-terms"')}
      ${input('title', isGuide ? 'Evaluación' : 'Título', m.title, 'required')}
      ${isGuide || curriculum || m.kind === 'contest' ? '' : input('stage', 'Evaluación', m.stage, 'list="dl-stages" placeholder="Examen 1, Final…"')}
      ${isGuide || curriculum || !ctx.state.sources.length ? '' : `<label class="field"><span>De dónde viene</span><select name="source"><option value="">De mí o de mis compañeros</option>${ctx.state.sources.map((x) => `<option value="${esc(x.id)}" ${m.source === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`}
      ${isGuide ? input('date', 'Fecha de la evaluación', m.date, 'type="date" required') : ''}
      ${isGuide ? `<label class="field"><span>Nivel</span><select name="level"><option value="">Sin indicar</option>${Object.entries(LEVELS).map(([key, v]) => `<option value="${key}" ${key === m.level ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>` : ''}
      ${curriculum ? '' : themePicker(`theme-${item.id}`, m.theme)}
      ${isGuide ? `<label class="field"><span>Hecha con</span><select name="aiprov"><option value="">No lo digo</option>${Object.entries(ai.PROVIDERS).map(([k, pr]) => `<option value="${k}" ${item.ai?.provider === k ? 'selected' : ''}>${esc(pr.name)}</option>`).join('')}<option value="other" ${item.ai?.provider === 'other' ? 'selected' : ''}>Otra IA</option></select></label>
        ${input('aimodel', 'Modelo', item.ai?.model ?? '', 'maxlength="80" placeholder="Ej.: claude-opus-5-5"')}
        <label class="field"><span>Esfuerzo</span><select name="aieffort"><option value="">Sin indicar</option>${Object.entries(ai.EFFORTS).map(([k, label]) => `<option value="${k}" ${item.ai?.effort === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>` : ''}
      ${isGuide
        ? segmented(`vis-${item.id}`, { public: 'Para todos los estudiantes', private: 'Solo para mí' }, item.visibility, 'Quién la ve')
        : segmented(`vis-${item.id}`, { public: 'Sí, aportar al grafo', private: 'No, solo para mí' }, item.visibility, '¿Aportar al grafo de conocimiento?')}
      ${isGuide ? (prefs.get().name
        ? `<label class="check wide"><input type="checkbox" data-sign="${item.id}" ${item.sign ? 'checked' : ''}> Firmar con mi nombre: <strong>${esc(prefs.get().name)}</strong></label>`
        : '<p class="hint wide">Para firmar tus guías con tu nombre, escríbelo en <a href="#/ajustes">Ajustes</a>.</p>') : ''}
    </form>
    <p class="summary">${summary}</p>
    ${isGuide || curriculum ? '' : coherenceHTML(item)}
    ${isGuide || curriculum ? '' : labFilesHTML(item)}
    ${twin ? `<p class="twin">${esc(twin)}</p>` : ''}
    ${parsed.warnings.length ? `<ul class="warnings">${parsed.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${findings.length ? `<div class="personal">
      <p><strong>${blocking.length ? 'Hay datos personales: quítalos antes de publicar.' : 'Revisa estos datos antes de publicar.'}</strong></p>
      <ul>${findings.map((f) => `<li><span>${esc(f.label)}</span> <mark>${esc(f.match)}</mark></li>`).join('')}</ul>
      <div class="actions"><button class="button ghost" data-redact="${item.id}">Quitar estos datos</button>
      ${!blocking.length ? `<label class="check"><input type="checkbox" data-confirm="${item.id}" ${item.confirmed ? 'checked' : ''}> Lo revisé: no son datos personales</label>` : ''}</div>
    </div>` : '<p class="clean">Sin datos personales a la vista.</p>'}
    ${conceptNames.length ? `<div class="chips small">${conceptNames.slice(0, 40).map((n) => `<span class="chip ${inMap.has(keyOf(n)) ? '' : 'new'}">${esc(n)}</span>`).join('')}${conceptNames.length > 40 ? `<span class="chip">y ${conceptNames.length - 40} más</span>` : ''}</div>` : ''}
    <div class="actions">
      ${isGuide ? `<button class="button ghost" data-preview="${item.id}">Vista previa</button>` : ''}
      ${isGuide && legacy(item.text) ? `<button class="button ghost" data-convert-from="${item.id}" title="Tu IA la rehace con el diseño actual, sin dejar nada fuera; esta queda como está">Pasarla al formato actual</button>` : ''}
      <button class="button primary" data-publish="${item.id}" ${ready ? '' : 'disabled'}>${item.replace ? 'Reemplazar' : 'Publicar'}</button>
      ${!ready && !blocking.length && isGuide && !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? '<span class="hint">Falta la fecha de la evaluación.</span>' : ''}
    </div>`}`;
  syncBulk(item.zone.startsWith('replace:') ? 'mine' : item.zone);
}

/* ---------- before it is public: does it belong together? The person's AI says, and the person decides ---------- */
function coherenceRequest(item) {
  const m = item.parsed.meta;
  const names = (item.parsed.data.concepts ?? []).map((c) => c.name).slice(0, 80);
  const course = courseNode(m.course);
  const g = ctx.state.graph;
  const known = course ? g.links.filter((l) => l.kind === 'in' && l.source === course).map((l) => l.target.name).slice(0, 150) : [];
  return {
    names,
    system: COHERENCE,
    text: `Materia: ${m.course}\nTítulo: ${m.title}\nTipo: ${KINDS[m.kind] ?? m.kind}\nConceptos del aporte: ${names.join('; ')}\nConceptos que la materia ya tiene en el grafo: ${known.join('; ') || '(ninguno todavía)'}`,
  };
}
const COHERENCE = 'Revisas, antes de que se publique, un aporte anónimo al grafo de conocimiento de una materia universitaria. Di si su contenido es de esa materia y si sus conceptos tienen que ver entre ellos. Responde solo JSON: {"fits": true o false, "why": "una frase", "outliers": ["conceptos de la lista que no son de esta materia o no tienen que ver con el resto"]}.';
async function checkCoherence(item) {
  const card = document.getElementById(item.id);
  const use = ai.picked('ask', card ?? document);
  item.coherence = { state: 'running' };
  renderReview(item);
  const { names, system, text } = coherenceRequest(item);
  try {
    const res = await ai.run({ system, text, maxTokens: 800, task: 'ask', use });
    const a = JSON.parse(String(res.text ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    const set = new Set(names.map((n) => keyOf(n)));
    item.coherence = { state: 'done', fits: a.fits !== false, why: String(a.why ?? '').slice(0, 300), outliers: (Array.isArray(a.outliers) ? a.outliers : []).map(String).filter((n) => set.has(keyOf(n))).slice(0, 20) };
  } catch { item.coherence = { state: 'error' }; }
  if (document.getElementById(item.id)) renderReview(item);
}
function coherenceHTML(item) {
  const c = item.coherence;
  if (!c) {
    if (!ai.ready()) return '<p class="fine">Con tu IA conectada, puedes revisar también que todo tenga que ver con la materia antes de publicar.</p>';
    const r = coherenceRequest(item);
    return `<div class="coherence"><p>¿Quieres que tu IA revise que todo tenga que ver con ${esc(item.parsed.meta.course || 'la materia')}? Es opcional.</p>
      ${ai.pickerHTML('ask')}${ai.promptHTML(r.system, r.text)}
      <div class="actions"><button type="button" class="button ghost small" data-coherence="${item.id}">Revisar con mi IA</button></div></div>`;
  }
  if (c.state === 'running') return `<p class="coherence">Tu IA está revisando que todo tenga que ver con ${esc(item.parsed.meta.course || 'la materia')}…</p>`;
  if (c.state === 'error') return '<p class="coherence">Tu IA no pudo revisarlo ahora; revísalo tú.</p>';
  if (c.fits && !c.outliers.length) return `<p class="coherence ok">${c.why === 'Quitaste lo que no era de aquí.' ? esc(c.why) : `Tu IA lo revisó: todo tiene que ver con ${esc(item.parsed.meta.course)}.`}</p>`;
  return `<div class="coherence warn"><p>${c.fits ? '' : '<strong>¿Seguro que es de esta materia?</strong> '}${esc(c.why)}</p>${c.outliers.length ? `<p class="fine">No parecen de aquí; tócalos para quitarlos:</p><div class="chips small">${c.outliers.map((n) => `<button class="chip" data-drop-concept="${item.id}" data-name="${esc(n)}">${esc(n)} ✕</button>`).join('')}</div>` : ''}</div>`;
}
// A lab's files: each one says whether the professor gave it or it is a student's answer, with a link where it lives.
function labFilesHTML(item) {
  const files = item.parsed.data.context?.files ?? [];
  if (item.parsed.meta.kind !== 'lab' && !files.length) return '';
  const row = (f, i) => `<div class="labfile"><input data-labfile="${item.id}" data-i="${i}" data-f="name" value="${esc(f.name)}" maxlength="160" placeholder="Nombre del archivo (red-inicial.pkt)" aria-label="Nombre del archivo">
      <select data-labfile="${item.id}" data-i="${i}" data-f="from"><option value="profesor" ${f.from === 'profesor' ? 'selected' : ''}>Lo dio el profe</option><option value="alumno" ${f.from === 'alumno' ? 'selected' : ''}>Respuesta de un alumno</option></select>
      <input type="url" data-labfile="${item.id}" data-i="${i}" data-f="url" value="${esc(f.url ?? '')}" placeholder="Enlace donde está (Drive, OneDrive, la página del profe)"></div>`;
  return `<div class="labfiles"><p><strong>Archivos del laboratorio</strong> <small class="muted">Studium guarda solo el enlace; tu respuesta no se publica si no lo eliges.</small></p>${files.map(row).join('')}
    <button type="button" class="link" data-labfile-add="${item.id}">Agregar un archivo</button></div>`;
}
function readMeta(item) {
  const form = $(`[data-meta="${item.id}"]`);
  if (!form) return;
  const v = Object.fromEntries(new FormData(form).entries());
  const m = item.parsed.meta;
  for (const k of ['kind', 'course', 'code', 'university', 'professor', 'term', 'title', 'stage', 'source', 'date', 'level']) if (k in v) m[k] = v[k].trim();
  if ('stage' in v) m.stage = stageLabel(m.stage);
  if (v[`theme-${item.id}`]) m.theme = v[`theme-${item.id}`];
  if (v[`vis-${item.id}`]) item.visibility = v[`vis-${item.id}`];
  if ('aiprov' in v) item.ai = v.aiprov ? { provider: v.aiprov, model: String(v.aimodel ?? '').trim().slice(0, 80), effort: v.aieffort ?? '' } : null;
}
async function publish(item) {
  if (item.done) return true;
  readMeta(item);
  const m = item.parsed.meta;
  const button = $(`[data-publish="${item.id}"]`);
  button.disabled = true;
  button.textContent = 'Publicando…';
  try {
    let id;
    if (item.html) {
      const concepts = item.parsed.concepts;
      id = await publishGuide(ctx.user.uid, {
        ...m, theme: m.theme, topics: m.topics?.length ? m.topics : concepts.slice(0, 12).map((c) => c.name),
        concepts: concepts.map((c) => c.name), anchors: concepts.map((c) => c.anchor), visibility: item.visibility,
        by: item.sign ? prefs.get().name : '', ai: item.ai?.provider ? item.ai : null,
      }, item.text, item.replace || undefined);
      item.done = `Publicada${item.visibility === 'private' ? ' solo para ti' : ''}. <a href="#/guia/${encodeURIComponent(id)}">Abrir la guía</a> · <a href="#/grafo/guide:${encodeURIComponent(id)}">Verla en el grafo</a>`;
    } else {
      id = await publishContribution(ctx.user.uid, { ...m, theme: m.kind === 'curriculum' ? 'estrellas' : m.theme, visibility: item.visibility, print: item.print }, item.parsed.data);
      grown.add(id);
      item.done = `Publicado${item.visibility === 'private' ? ' solo para ti' : ''}. <a href="#/grafo/nuevo:${[...grown].join(',')}">Ver cómo creció el grafo</a>`;
    }
    item.ready = false;
    if (item.jobId) queue?.reviewed(item.jobId, 'published');
    renderReview(item);
    if (!bulk) { await ctx.refresh(); ctx.toast(item.html ? 'Guía publicada.' : 'Aporte publicado.'); }
    return true;
  } catch (error) {
    button.disabled = false;
    button.textContent = item.replace ? 'Reemplazar' : 'Publicar';
    ctx.toast(error.code === 'too-large' ? `Pesa ${kb(error.size)} comprimido; el límite es ${kb(LIMIT)}. Pide a tu IA una versión más corta.` : ctx.explain(error));
    return false;
  }
}
// Every review that is ready (nothing personal left to check), one after the other, then the map once.
let bulk = false;
async function publishAll(zone) {
  const ready = [...reviews.values()].filter((x) => x.zone === zone && x.ready && !x.done);
  if (!ready.length) return;
  const button = $(`[data-publish-all="${zone}"]`);
  bulk = true;
  let done = 0;
  try {
    for (const item of ready) {
      if (button) button.textContent = `Publicando ${done + 1} de ${ready.length}…`;
      if (await publish(item)) done += 1;
    }
  } finally { bulk = false; }
  await ctx.refresh();
  ctx.toast(`${plural(done, 'aporte publicado', 'aportes publicados')}.`);
  syncBulk(zone);
}
function syncBulk(zone) {
  const list = $(`[data-reviews="${zone}"]`);
  if (!list) return;
  const ready = [...reviews.values()].filter((x) => x.zone === zone && x.ready && !x.done).length;
  let bar = list.previousElementSibling?.classList.contains('bulk') ? list.previousElementSibling : null;
  if (ready < 2) { bar?.remove(); return; }
  if (!bar) { list.insertAdjacentHTML('beforebegin', '<div class="bulk"></div>'); bar = list.previousElementSibling; }
  bar.innerHTML = `<p>${plural(ready, 'aporte listo', 'aportes listos')}: revisados, sin datos personales a la vista.</p><button class="button primary" data-publish-all="${zone}">Publicar los ${ready}</button>`;
}
// The same file, or what looks like the same exam: most of its questions are already in another contribution of the
// course.
function lookalike(m, data, print) {
  const mine = ctx.state.contributions;
  if (print && mine.some((c) => c.print === print)) return 'Este mismo archivo ya está en el grafo.';
  const qkey = (q) => keyOf(q.text).slice(0, 70);
  const ours = new Set((data.questions ?? []).map(qkey).filter((k) => k.length > 20));
  if (ours.size < 3) return null;
  for (const c of mine.filter((x) => keyOf(x.course) === keyOf(m.course))) {
    const theirs = new Set((c.data?.questions ?? []).map(qkey));
    const same = [...ours].filter((k) => theirs.has(k)).length;
    if (same / ours.size >= 0.5) return `Se parece mucho a «${c.title}» (${same} de ${ours.size} preguntas iguales): revisa que no esté repetido.`;
  }
  return null;
}
function preview(item) {
  const dialog = $('#preview');
  showGuide($('#preview-frame'), item.text);
  dialog.showModal();
}

/* ---------- mine ---------- */
function minePane() {
  const { catalog, contributions } = ctx.state;
  const items = [...catalog, ...contributions].filter((x) => x.mine).sort((a, b) => b.updated - a.updated);
  if (!items.length) {
    return `<div class="empty glass"><h2>Todavía no aportaste nada</h2><p>Tus aportes y guías aparecen aquí: puedes cambiar quién los ve, reemplazarlos o borrarlos.</p>
      <a class="button primary" href="#/estudiar">Soltar material en Estudiar</a></div>${HISTORY}`;
  }
  return `<ul class="mine">${items.map((x) => `<li class="glass" style="${themeStyle(x.theme)}" data-item="${esc(x.type)}:${esc(x.id)}">
      <div class="what"><span class="badge">${x.type === 'guide' ? 'Guía' : esc(KINDS[x.kind] ?? 'Aporte')}</span>
        <strong>${esc(x.title)}</strong><span class="muted">${esc([x.course, x.professor, x.term].filter(Boolean).join(', '))}</span></div>
      ${segmented(`mv-${x.id}`, { public: 'Para todos', private: 'Solo yo' }, x.visibility, 'Quién lo ve')}
      <div class="actions">
        ${x.type === 'guide' ? `<a class="button ghost" href="#/guia/${encodeURIComponent(x.id)}">Abrir</a><label class="button ghost">Reemplazar<input type="file" accept=".html,.htm,text/html" hidden data-replace="${esc(x.id)}"></label>` : ''}
        <button class="button ghost danger" data-remove="${esc(x.type)}:${esc(x.id)}">Borrar</button>
      </div>
    </li>`).join('')}</ul><div class="reviews" data-reviews="mine"></div>${HISTORY}`;
}
// Your history: how each guide or contribution was before you changed or deleted it. Restore any of it, or delete it
// for good. Kept by the database itself (data.js keepVersion; the rules demand it), the last 10 of each.
const HISTORY = '<section class="history glass" data-history><h2>Tu historial</h2><p class="muted">Cargando…</p></section>';
const ACTION = { replaced: 'Antes de reemplazarlo', deleted: 'Antes de borrarlo', restored: 'Antes de restaurar otra versión' };
let kept = new Map();
async function drawHistory() {
  const box = $('[data-history]');
  if (!box) return;
  try {
    const list = await myVersions(ctx.user.uid);
    // A guide keeps its page and its entry in one write: one event, shown once.
    const events = new Map();
    for (const v of list) {
      const key = `${v.of}@${v.at?.toMillis?.() ?? 0}`;
      const e = events.get(key) ?? { parts: [] };
      e.parts.push(v);
      if (v.col !== 'guides') e.main = v;
      events.set(key, e);
    }
    kept = new Map(list.map((v) => [v.vid, v]));
    const exists = new Set([...ctx.state.catalog, ...ctx.state.contributions].filter((x) => x.mine).map((x) => x.id));
    const rows = [...events.values()].map((e) => {
      const v = e.main ?? e.parts[0];
      const d = v.data ?? {};
      const when = v.at?.toDate?.().toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? '';
      return `<li><div class="what"><span class="badge">${v.col === 'contributions' ? esc(KINDS[d.kind] ?? 'Aporte') : 'Guía'}</span>
          <strong>${esc(d.title ?? '')}</strong><span class="muted">${esc(ACTION[v.action] ?? '')} · ${esc(when)}${exists.has(v.of) ? '' : ' · ya no existe'}</span></div>
        <div class="actions"><button type="button" class="button ghost small" data-restore="${esc(v.vid)}">${exists.has(v.of) ? 'Volver a esta versión' : 'Recuperarlo'}</button>
          <button type="button" class="button ghost small danger" data-forget="${esc(e.parts.map((p) => p.vid).join(' '))}">Borrar para siempre</button></div></li>`;
    });
    box.innerHTML = `<h2>Tu historial</h2><p class="muted">Cómo estaba cada guía o aporte tuyo antes de cambiarlo o borrarlo (los últimos 10 de cada uno). Solo lo ves tú, y quien administra Studium para poder ayudarte a recuperarlo.</p>
      ${rows.length ? `<ul class="mine">${rows.join('')}</ul>` : '<p class="muted">Todavía no cambiaste ni borraste nada.</p>'}`;
  } catch (e) { box.innerHTML = `<h2>Tu historial</h2><p class="msg">${esc(ctx.explain(e))}</p>`; }
}
const findItem = (ref) => {
  const [type, id] = ref.split(':');
  return (type === 'guide' ? ctx.state.catalog : ctx.state.contributions).find((x) => x.id === id);
};

/* ---------- mount ---------- */
export function mountContribute(context) {
  ctx = context;
  startQueue(context);
  if (!drafted) { drafted = true; restoreDrafts().then((r) => { if (r && shown && shown !== 'mine') renderPane(shown); }); }
  const view = $('#view-contribute');
  if (view.dataset.ready) return;
  view.dataset.ready = '1';
  // The queue's controls act on press, not on release: the list is drawn again as parts finish, and a click that
  // waited for the release could land on a button that was already replaced.
  view.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('[data-q-pause], [data-q-resume], [data-q-discard-all]');
    if (!t || e.button > 0) return;
    e.preventDefault(); queueAction(t);
  });
  view.addEventListener('keydown', (e) => {
    const t = (e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-q-pause], [data-q-resume], [data-q-discard-all]');
    if (t) { e.preventDefault(); queueAction(t); }
  });
  view.addEventListener('click', (e) => {
    const check = e.target.closest('[data-coherence]');
    if (check) { const item = reviews.get(check.dataset.coherence); if (item) checkCoherence(item); }
    const drop = e.target.closest('[data-drop-concept]');
    if (drop) {
      const item = reviews.get(drop.dataset.dropConcept); const k = keyOf(drop.dataset.name);
      const d = item.parsed.data;
      d.concepts = d.concepts.filter((c) => keyOf(c.name) !== k);
      for (const x of [...d.questions, ...d.examples]) x.concepts = (x.concepts ?? []).filter((n) => keyOf(n) !== k);
      item.coherence.outliers = item.coherence.outliers.filter((n) => keyOf(n) !== k);
      if (!item.coherence.outliers.length) Object.assign(item.coherence, { fits: true, why: 'Quitaste lo que no era de aquí.' });
      renderReview(item);
    }
    const add = e.target.closest('[data-labfile-add]');
    if (add) {
      const item = reviews.get(add.dataset.labfileAdd);
      const ctxt = item.parsed.data.context ??= {}; (ctxt.files ??= []).push({ name: '', from: 'profesor', url: '' }); renderReview(item);
      document.querySelector(`#${item.id} .labfile:last-of-type input`)?.focus();
    }
  });
  view.addEventListener('change', (e) => {
    const f = e.target.closest('[data-labfile]');
    if (!f) return;
    const item = reviews.get(f.dataset.labfile); const file = item.parsed.data.context?.files?.[Number(f.dataset.i)];
    if (!file) return;
    if (f.dataset.f === 'url') { const v = f.value.trim(); file.url = /^https:\/\/\S+$/.test(v) ? v.slice(0, 500) : ''; if (v && !file.url) ctx.toast('Ese enlace no empieza con https://'); }
    else if (f.dataset.f === 'name') file.name = f.value.trim().slice(0, 160);
    else file.from = f.value === 'alumno' ? 'alumno' : 'profesor';
  });

  view.addEventListener('input', (e) => {
    if (e.target.closest('#m-form')) $('#m-prompt').textContent = materialPrompt();
    if (e.target.closest('#g-form')) renderScope();
    const meta = e.target.closest('[data-meta]');
    if (meta) {
      const item = reviews.get(meta.dataset.meta);
      readMeta(item);
      if (e.target.type === 'radio' || e.target.tagName === 'SELECT') renderReview(item);
      else $(`[data-publish="${item.id}"]`).disabled = !(item.parsed.meta.course && item.parsed.meta.title) || $(`[data-publish="${item.id}"]`).disabled;
    }
  });
  view.addEventListener('change', async (e) => {
    const files = e.target.dataset.files;
    if (files) { await readFiles(files, e.target.files); e.target.value = ''; }
    if (e.target.dataset.notes !== undefined) { addNotes([...e.target.files]); e.target.value = ''; }
    const aiFiles = e.target.dataset.aiFiles;
    if (aiFiles) { enqueue(aiFiles, [...e.target.files]); e.target.value = ''; }
    if (e.target.dataset.prepare !== undefined) { prepareForChat([...e.target.files]); e.target.value = ''; }
    // A part of a book (or a file already in the map) joins the queue when the person ticks it.
    if (e.target.dataset.unit) { const id = e.target.dataset.unit; const on = e.target.checked; startQueue().then((q) => q.choose(id, on, !ai.ready())); }
    if (e.target.name === 'scope' && e.target.closest('#g-form')) { const r = $('.g-range'); if (r) r.hidden = e.target.value !== 'range'; }
    if (e.target.name === 'kind' && e.target.closest('#m-form')) { const hint = $('#m-kind-hint'); if (hint) hint.textContent = KIND_HINTS[e.target.value] ?? ''; }
    const sign = e.target.dataset.sign;
    if (sign) { const item = reviews.get(sign); item.sign = e.target.checked; }
    const replaceId = e.target.dataset.replace;
    if (replaceId) { const [file] = e.target.files; if (file) addReview(`replace:${replaceId}`, await file.text(), file.name); e.target.value = ''; }
    const confirm = e.target.dataset.confirm;
    if (confirm) { const item = reviews.get(confirm); item.confirmed = e.target.checked; renderReview(item); }
    const meta = e.target.closest('[data-meta]');
    if (meta && e.target.tagName === 'INPUT' && e.target.type !== 'radio') renderReview(reviews.get(meta.dataset.meta));
    const vis = e.target.name?.startsWith('mv-') && e.target.closest('[data-item]');
    if (vis) {
      const item = findItem(vis.dataset.item);
      try { await setVisibility(item, e.target.value); item.visibility = e.target.value; ctx.toast(e.target.value === 'private' ? 'Ahora solo tú lo ves.' : 'Ahora lo ven todos los estudiantes.'); await ctx.refresh(); }
      catch (error) { ctx.toast(ctx.explain(error)); renderPane('mine'); }
    }
  });
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-concept]');
    if (!t) return;
    if (t.id === 'm-copy') copy(materialPrompt(), 'Instrucciones');
    if (t.id === 'm-download') download(materialValues().kind === 'curriculum' ? 'studium-instrucciones-malla.md' : 'studium-instrucciones-aporte.md', materialPrompt());
    if (t.id === 'g-copy' && guideReady()) copy(fullPrompt(), 'Instrucciones');
    if (t.id === 'g-ai') generateGuide();
    if (t.id === 'g-download' && guideReady()) download('studium-instrucciones-guia.md', fullPrompt());
    if (t.dataset.chat) openChat(t.dataset.chat);
    if (t.dataset.noteRemove) { notes.splice(Number(t.dataset.noteRemove), 1); renderNotes(); renderScope(); }
    if (t.dataset.concept) { scope.off.has(t.dataset.concept) ? scope.off.delete(t.dataset.concept) : scope.off.add(t.dataset.concept); renderScope(); }
    if (t.dataset.scope) {
      const { concepts } = guideValues();
      scope.off = t.dataset.scope === 'none' ? new Set(concepts.map((n) => n.key)) : new Set();
      renderScope();
    }
    if (t.dataset.reviewPaste) {
      const area = $(`[data-paste="${t.dataset.reviewPaste}"]`);
      if (area.value.trim()) { addReview(t.dataset.reviewPaste, area.value, 'Respuesta pegada'); area.value = ''; }
    }
    if (t.matches('[data-q-retry-all], [data-q-clear], [data-q-auto], [data-q-retry], [data-q-chat], [data-q-copy], [data-q-download], [data-q-answer]')) queueAction(t);
    if (t.dataset.convertRun) runConvertCard(converting.get(t.dataset.convertRun));
    if (t.dataset.convertFrom) { const item = reviews.get(t.dataset.convertFrom); readMeta(item); addConvert(item.zone, { html: item.text }, item.name, { ...item.parsed.meta }); }
    if (t.dataset.discard) {
      converting.delete(t.dataset.discard);
      const gone = reviews.get(t.dataset.discard);
      if (gone?.jobId) queue?.reviewed(gone.jobId, 'discarded');
      reviews.delete(t.dataset.discard); document.getElementById(t.dataset.discard)?.remove();
    }
    if (t.dataset.redact) {
      const item = reviews.get(t.dataset.redact);
      readMeta(item);
      const findings = findPersonal(item.html ? item.parsed.text : item.text, ctx.user.email);
      item.text = redact(item.text, findings);
      const meta = item.parsed.meta;
      item.parsed = item.html ? parseGuide(item.text, meta) : parseContribution(item.text, meta);
      if (!item.parsed.error) Object.assign(item.parsed.meta, meta);
      renderReview(item);
    }
    if (t.dataset.publish) publish(reviews.get(t.dataset.publish));
    if (t.dataset.publishAll) publishAll(t.dataset.publishAll);
    if (t.dataset.fromMapClear !== undefined) { fromMap = null; scope = null; renderScope(); }
    if (t.dataset.preview) preview(reviews.get(t.dataset.preview));
    if (t.dataset.remove) {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = '¿Borrar? Pulsa otra vez'; setTimeout(() => { if (t.isConnected) { t.dataset.armed = ''; t.textContent = 'Borrar'; } }, 4000); return; }
      t.disabled = true;
      try { await remove(findItem(t.dataset.remove)); ctx.toast('Borrado. Puedes recuperarlo desde «Tu historial».'); await ctx.refresh(); renderPane('mine'); }
      catch (error) { t.disabled = false; ctx.toast(ctx.explain(error)); }
    }
    // Your history: back to a kept version (the current one is kept first), or a kept version deleted for good.
    if (t.dataset.restore && kept.has(t.dataset.restore)) {
      t.disabled = true;
      try { await restoreVersion(kept.get(t.dataset.restore)); ctx.toast('Listo: volvió esa versión. La que había quedó en tu historial.'); await ctx.refresh(); renderPane('mine'); }
      catch (error) { t.disabled = false; ctx.toast(ctx.explain(error)); }
    }
    if (t.dataset.forget) {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = '¿Seguro? No se puede deshacer'; setTimeout(() => { if (t.isConnected) { t.dataset.armed = ''; t.textContent = 'Borrar para siempre'; } }, 4000); return; }
      t.disabled = true;
      try { for (const vid of t.dataset.forget.split(' ')) await deleteVersion(vid); ctx.toast('Borrado para siempre.'); drawHistory(); }
      catch (error) { t.disabled = false; ctx.toast(ctx.explain(error)); }
    }
  });
  view.addEventListener('submit', (e) => { if (e.target.id === 'g-form') e.preventDefault(); });
  // Whether «Hazla a tu medida» is open is remembered.
  view.addEventListener('toggle', (e) => { if (e.target.id === 'g-custom') store.set('studium-guide-custom', e.target.open); }, true);
  for (const type of ['dragenter', 'dragover']) view.addEventListener(type, (e) => { const z = e.target.closest('[data-drop], [data-ai-drop], [data-notes-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  view.addEventListener('dragleave', (e) => e.target.closest('[data-drop], [data-ai-drop], [data-notes-drop]')?.classList.remove('over'));
  view.addEventListener('drop', async (e) => {
    const notesZone = e.target.closest('[data-notes-drop]');
    if (notesZone) { e.preventDefault(); notesZone.classList.remove('over'); addNotes(await droppedFiles(e.dataTransfer)); return; }
    const zone = e.target.closest('[data-ai-drop]');
    if (zone) { e.preventDefault(); zone.classList.remove('over'); enqueue(zone.dataset.aiDrop, await droppedFiles(e.dataTransfer)); return; }
    const z = e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    readFiles(z.dataset.drop, e.dataTransfer.files);
  });
  $('#preview-close').addEventListener('click', () => $('#preview').close());
}

let drafted = false;
const grown = new Set(); // what this person published in this visit: the graph shows it growing
let shown = '';
export function renderPane(pane, preset) {
  shown = pane;
  const deps = { ctx, shareToGraph, startGuide, droppedFiles, materialInstructions, watchQueue, queueControl, reviewOfJob, syncReviews: () => syncReviews(), startQueue };
  // Only one place shows the reviews at a time: the old page's list must not catch «Estudia»'s cards.
  if (pane === 'estudia' || pane === 'desk') $('#pane-material').innerHTML = '';
  if (pane === 'estudia' || pane === 'desk') {
    for (const name of ['material', 'guide', 'mine']) $(`#pane-${name}`).hidden = true;
    const el = $('#pane-estudia'); el.hidden = false;
    if (pane === 'desk') renderDesk(el, preset.course, deps); else renderEstudia(el, deps);
    return;
  }
  $('#pane-estudia').hidden = true;
  const panes = { material: materialPane, guide: () => guidePane(preset), mine: minePane };
  for (const name of Object.keys(panes)) {
    $(`#pane-${name}`).hidden = name !== pane;
    $(`[data-pane="${name}"]`)?.setAttribute('aria-selected', String(name === pane));
  }
  const el = $(`#pane-${pane}`);
  el.innerHTML = panes[pane]();
  for (const item of reviews.values()) {
    const zone = item.zone.startsWith('replace:') ? 'mine' : item.zone;
    const list = $(`[data-reviews="${zone}"]`, el);
    if (list) { list.insertAdjacentHTML('beforeend', `<article class="review glass" id="${item.id}"></article>`); renderReview(item); }
  }
  if (pane === 'material') { $('#m-prompt').textContent = materialPrompt(); renderQueue(); syncReviews(); }
  if (pane === 'guide' && $('#g-form')) { renderNotes(); renderScope(); }
  if (pane === 'mine') drawHistory();
  rise(el, '.flow > li, .mine > li, .empty');
}
