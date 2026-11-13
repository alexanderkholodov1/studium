// "Aportar": instructions for the person's own AI, the review of what it returns (contributions and guides), and the
// account's own items. Nothing of the original material reaches Studium: only what the AI extracted, after review.
import { THEMES, keyOf, themeStyle, guessTheme, validTheme } from './themes.js';
import {
  KINDS, KIND_HINTS, LEVELS, contributionInstructions, curriculumInstructions, guideInstructions, parseContribution, parseGuide,
  contextPack, findPersonal, redact,
} from './prompts.js';
import { publishContribution, publishGuide, setVisibility, remove, LIMIT } from './data.js';
import { prepareGroup, groupFiles, fingerprint, partsSize, partFiles, zipFiles } from './files.js';
import { createQueue, indexedStore, memoryStore } from './queue.js';
import { looseKey, stageOf, stageLabel } from './standard.js';
import { prepareGuide } from './viewer.js';
import { rise } from './fx.js';
import * as ai from './ai.js';
import { prefs } from './prefs.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* the draft is just not remembered */ } },
};
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
    <p><strong>Suelta aquí los archivos</strong> que te devolvió tu IA (.json o .html), o</p>
    <label class="button ghost">Elegir archivos<input type="file" accept=".json,.html,.htm,.txt,.md,application/json,text/html" multiple hidden data-files="${id}"></label>
  </div>
  <details class="paste"><summary>O pega aquí la respuesta de tu IA</summary>
    <textarea rows="7" data-paste="${id}" placeholder="Pega el bloque de código JSON, o la página HTML completa"></textarea>
    <button class="button ghost" data-review-paste="${id}">Revisar</button>
  </details>
  <div class="reviews" data-reviews="${id}"></div>`;

/* ---------- your AI, inside Studium ---------- */
const PROMPT_URL = 'https://github.com/alexanderkholodov1/studium/blob/main/public/assets/prompts.js';
const promise = () => `<aside class="anon glass">
    <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-shield"/></svg>
    <div><h2>Todo se anonimiza. Siempre.</h2>
      <p>Tus archivos van solo a tu IA. Ella saca las notas, nombres, códigos, correos y comentarios personales, y a
        Studium llega solo lo que se estudia: conceptos, preguntas y ejemplos. Antes de publicar, Studium vuelve a buscar
        datos personales y te muestra lo que encuentre.</p>
      <p class="fine">El único propósito es armar el conocimiento más amplio posible para otros estudiantes como tú.
        <a href="${PROMPT_URL}" target="_blank" rel="noopener noreferrer">Puedes leer las instrucciones exactas que recibe tu IA</a>.</p></div>
  </aside>`;
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
  if (!prepared.has(group.id)) remember(group.id, prepareGroup({ name: group.name, files: list, code: group.code }));
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
    system: instructionsOf(job, group), files, maxTokens: 32000, use: ai.choice('material'),
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
const lockQueue = (fn) => (navigator.locks?.request ? navigator.locks.request('studium-queue', { ifAvailable: true }, (held) => (held ? fn() : false)) : fn());
let lastCounts = null;
function onQueue(change) {
  if (change.progress) { const row = document.querySelector(`#q-${CSS.escape(change.progress)} > .state`); if (row) row.textContent = change.status.progress; return; }
  channel?.postMessage('changed');
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
  off: 'Sin elegir', manual: 'Para tu chat', missing: 'Suelta este archivo otra vez para seguir', done: 'Listo: revísalo abajo',
  published: 'Publicado', discarded: 'Quitado',
};
function jobState(job, st) {
  if (job.state === 'running') return st.progress || 'Leyendo…';
  if (job.state === 'waiting') return job.retryAt > Date.now() ? `Sigue a las ${clock(job.retryAt)}` : 'En espera';
  if (job.state === 'error') return job.error || 'Algo falló';
  if (job.state === 'done' && job.result?.truncated) return 'Listo, pero quedó cortado: revisa abajo';
  return STATES[job.state] ?? job.state;
}
function jobRow(job, many, st) {
  const cls = { running: 'busy', done: 'ok', published: 'ok', error: 'bad', off: 'skip', discarded: 'skip', missing: 'bad', manual: 'manual' }[job.state] ?? '';
  const name = many ? job.label.split(' · ').slice(1).join(' · ') || job.label : baseName(job.label);
  const choose = many && ['off', 'waiting', 'manual', 'error'].includes(job.state) ? `<label class="check"><input type="checkbox" data-unit="${esc(job.id)}" ${job.state === 'off' ? '' : 'checked'}></label>` : '';
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
      ${c.reviewed || c.off ? '<button type="button" class="link" data-q-clear>Quitar lo terminado</button>' : ''}</div>`;
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
async function enqueue(zone, files) {
  const q = await startQueue();
  const v = materialValues();
  const known = printed();
  const manual = !ai.ready();
  queueNotes.length = 0;
  let added = 0;
  for (const group of groupFiles(files)) {
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
    if (count && inMap.every(Boolean)) { queueNotes.push({ name: group.name, why: 'Ya está en el mapa: este mismo archivo ya se aportó' }); continue; }
    // The stage the file's name says («Examen parcial 1.pdf»), unless the form says it for the whole batch.
    const units = p.units.map((u, i) => ({ label: u.label, note: u.note, stage: v.stage || stageOf(u.label)?.label || '', print: prints[i], on: !!u.selected && !inMap[i] }));
    const { group: g } = await q.add({ zone, name: group.name, code: !!group.code, print, v: { ...v, known: (v.known ?? []).slice(0, 400) }, list: group.files, units, manual });
    remember(g.id, p);
    for (const n of p.notes ?? []) queueNotes.push({ name: group.name, why: n });
    added += 1;
  }
  if (added && manual) ctx.toast('Sin una IA conectada, cada parte queda lista para tu chat.');
  renderQueueSoon();
}
async function queueAction(t) {
  const q = await startQueue();
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

/* ---------- material ---------- */
function materialPane() {
  const d = store.get('studium-draft-material') ?? { kind: 'exam' };
  return `${datalists()}
  ${promise()}
  <ol class="flow">
    <li class="step glass">
      <h2>Cuéntale a tu IA qué es</h2>
      <p>Lo que completes va en las instrucciones; lo que dejes vacío, tu IA lo saca del material.</p>
      <form class="grid" id="m-form">
        ${segmented('kind', KINDS, d.kind, 'Qué material es')}
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
  const f = new FormData($('#m-form'));
  const v = Object.fromEntries(f.entries());
  store.set('studium-draft-material', v);
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
      <h2>¿Qué vas a estudiar?</h2>
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
      <h2>¿De dónde sale?</h2>
      <p>De tus apuntes: PDF, fotos del cuaderno, diapositivas o deberes. Van solo a tu IA; a Studium no llegan.</p>
      <div class="dropzone notes" data-notes-drop>
        <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h14l10 10v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M28 6v10h10M18 26h12M18 33h8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p><strong>Suelta aquí tus apuntes</strong>, o</p>
        <label class="button ghost">Elegir archivos<input type="file" multiple hidden data-notes accept="${NOTE_TYPES}"></label>
      </div>
      <ul class="notes-list" id="g-notes"></ul>
      <label class="toggle"><input type="checkbox" name="graph" ${d.graph ? 'checked' : ''}><span class="knob"></span>Sumar lo que la comunidad ya sabe de esta materia (el mapa de conocimiento)</label>
      <div class="from-map" id="g-from-map" hidden></div>
      <div class="scope" id="g-scope-wrap" hidden>
        <div class="scope-head"><h3>Conceptos del mapa que entran</h3><button type="button" class="link" data-scope="all">Todos</button><button type="button" class="link" data-scope="none">Ninguno</button></div>
        <div class="chips" id="g-scope"></div>
      </div>
      <p class="note" id="g-summary"></p>
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
function guideValues() {
  const form = $('#g-form');
  if (!form) return null;
  const f = new FormData(form);
  const v = Object.fromEntries(f.entries());
  v.sections = f.getAll('sections');
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
      banner.innerHTML = `<p><strong>Desde el mapa${fromMap.label ? `: la ruta ${esc(fromMap.label)}` : ''}</strong> · ${concepts.length} conceptos y ${qs} preguntas, con lo que necesitas antes. Puedes crear la guía solo con esto, o sumar tus apuntes.</p><button type="button" class="link" data-from-map-clear>Usar toda la materia</button>`;
    }
  }
  if (!v.graph || (!course && !fromMap)) {
    wrap.hidden = true;
    const known = course ? ` En el mapa hay ${course.contributions.length} ${course.contributions.length === 1 ? 'aporte' : 'aportes'} de ${course.name}: actívalo si quieres sumarlos.` : '';
    summary.textContent = v.graph && v.course && !course ? `${mine} Todavía no hay aportes de «${v.course}» en el mapa: la guía saldrá de tus apuntes.` : `${mine}${known}`;
  } else {
    const scopeKey = fromMap ? `map:${[...fromMap.keys].join(',')}` : course.id;
    if (!scope || scope.key !== scopeKey) scope = { key: scopeKey, off: new Set() };
    wrap.hidden = !concepts.length;
    const ranked = [...concepts].sort((a, b) => b.questions.length - a.questions.length || a.name.localeCompare(b.name, 'es'));
    $('#g-scope').innerHTML = ranked.map((n) => `<button type="button" class="chip ${scope.off.has(n.key) ? '' : 'on'}" data-concept="${esc(n.key)}">${esc(n.name)}${n.questions.length ? `<small>${n.questions.length}</small>` : ''}</button>`).join('');
    const lessons = fromMap ? sourcesOf(concepts) : course.contributions;
    const qs = fromMap ? concepts.reduce((s, n) => s + n.questions.length, 0) : lessons.reduce((s, c) => s + (c.data.questions?.length ?? 0), 0);
    const prof = v.professor ? lessons.filter((c) => keyOf(c.professor) === keyOf(v.professor)).length : 0;
    summary.textContent = `${mine} Del mapa suma ${concepts.length} conceptos y ${qs} preguntas${course && !fromMap ? ` de ${course.name}` : ''}${v.professor ? `; ${prof} de esos aportes son de ${v.professor}` : ''}.`;
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
  for (const file of files) {
    if (file.size > 8_000_000) { ctx.toast(`${file.name} pesa más de 8 MB: no es un archivo de Studium.`); continue; }
    addReview(zone, await file.text(), file.name);
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
    ? `Explica ${conceptNames.length} conceptos (${fresh} nuevos en el mapa). ${kb(new TextEncoder().encode(item.text).length)}.`
    : curriculum
      ? `${parsed.data.curriculum.semesters.length} semestres, ${parsed.data.curriculum.semesters.reduce((s, x) => s + x.courses.length, 0)} materias.`
      : `${conceptNames.length} conceptos (${fresh} nuevos en el mapa), ${parsed.data.questions.length} preguntas, ${parsed.data.examples.length} ejemplos.`;
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
      <button class="button primary" data-publish="${item.id}" ${ready ? '' : 'disabled'}>${item.replace ? 'Reemplazar' : 'Publicar'}</button>
      ${!ready && !blocking.length && isGuide && !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? '<span class="hint">Falta la fecha de la evaluación.</span>' : ''}
    </div>`}`;
  syncBulk(item.zone.startsWith('replace:') ? 'mine' : item.zone);
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
      item.done = `Publicada${item.visibility === 'private' ? ' solo para ti' : ''}. <a href="#/guia/${encodeURIComponent(id)}">Abrir la guía</a> · <a href="#/mapa/guide:${encodeURIComponent(id)}">Verla en el mapa</a>`;
    } else {
      id = await publishContribution(ctx.user.uid, { ...m, theme: m.kind === 'curriculum' ? 'estrellas' : m.theme, visibility: item.visibility, print: item.print }, item.parsed.data);
      item.done = `Publicado${item.visibility === 'private' ? ' solo para ti' : ''}. <a href="#/mapa">Verlo en el mapa</a>`;
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
  if (print && mine.some((c) => c.print === print)) return 'Este mismo archivo ya está en el mapa.';
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
  $('#preview-frame').srcdoc = prepareGuide(item.text);
  dialog.showModal();
}

/* ---------- mine ---------- */
function minePane() {
  const { catalog, contributions } = ctx.state;
  const items = [...catalog, ...contributions].filter((x) => x.mine).sort((a, b) => b.updated - a.updated);
  if (!items.length) {
    return `<div class="empty glass"><h2>Todavía no aportaste nada</h2><p>Tus aportes y guías aparecen aquí: puedes cambiar quién los ve, reemplazarlos o borrarlos.</p>
      <a class="button primary" href="#/aportar">Aportar material</a></div>`;
  }
  return `<ul class="mine">${items.map((x) => `<li class="glass" style="${themeStyle(x.theme)}" data-item="${esc(x.type)}:${esc(x.id)}">
      <div class="what"><span class="badge">${x.type === 'guide' ? 'Guía' : esc(KINDS[x.kind] ?? 'Aporte')}</span>
        <strong>${esc(x.title)}</strong><span class="muted">${esc([x.course, x.professor, x.term].filter(Boolean).join(', '))}</span></div>
      ${segmented(`mv-${x.id}`, { public: 'Para todos', private: 'Solo yo' }, x.visibility, 'Quién lo ve')}
      <div class="actions">
        ${x.type === 'guide' ? `<a class="button ghost" href="#/guia/${encodeURIComponent(x.id)}">Abrir</a><label class="button ghost">Reemplazar<input type="file" accept=".html,.htm,text/html" hidden data-replace="${esc(x.id)}"></label>` : ''}
        <button class="button ghost danger" data-remove="${esc(x.type)}:${esc(x.id)}">Borrar</button>
      </div>
    </li>`).join('')}</ul><div class="reviews" data-reviews="mine"></div>`;
}
const findItem = (ref) => {
  const [type, id] = ref.split(':');
  return (type === 'guide' ? ctx.state.catalog : ctx.state.contributions).find((x) => x.id === id);
};

/* ---------- mount ---------- */
export function mountContribute(context) {
  ctx = context;
  startQueue(context);
  const view = $('#view-contribute');
  if (view.dataset.ready) return;
  view.dataset.ready = '1';

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
    if (t.matches('[data-q-pause], [data-q-resume], [data-q-retry-all], [data-q-clear], [data-q-auto], [data-q-retry], [data-q-chat], [data-q-copy], [data-q-download], [data-q-answer]')) queueAction(t);
    if (t.dataset.discard) {
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
      try { await remove(findItem(t.dataset.remove)); ctx.toast('Borrado.'); await ctx.refresh(); renderPane('mine'); }
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

export function renderPane(pane, preset) {
  const panes = { material: materialPane, guide: () => guidePane(preset), mine: minePane };
  for (const name of Object.keys(panes)) {
    $(`#pane-${name}`).hidden = name !== pane;
    $(`[data-pane="${name}"]`).setAttribute('aria-selected', String(name === pane));
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
  rise(el, '.flow > li, .mine > li, .empty');
}
