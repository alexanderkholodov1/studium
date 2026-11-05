// The library: course documents that carry nothing personal (syllabi, lab guides, assignments, the professor's own
// material), shared as they come through a link to where they live (Drive, OneDrive, Dropbox). Studium stores only the
// link. A file dropped here is read in the browser to fill in what it is; with the person's AI connected, the AI reads
// its first pages too.
import { DOC_KINDS, publishDocument, remove } from './data.js';
import { keyOf, themeStyle } from './themes.js';
import { prefs } from './prefs.js';
import { sfx } from './sfx.js';
import { burst } from './play.js';
import { rise } from './fx.js';
import * as ai from './ai.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs';
export const LINK = /^https:\/\/(drive\.google\.com|docs\.google\.com|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+\.sharepoint\.com|(www\.)?dropbox\.com)\/[^ <>"]*$/;
let ctx = null;
let kindFilter = '';

const ICONS = {
  syllabus: '<path d="M7 3h7l4 4v14H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 11h5M10 15h5M10 7h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  reading: '<path d="M12 6c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5c-3-1-6-.5-8 1Zm0 0v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  lab: '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 15h9" stroke="currentColor" stroke-width="2"/>',
  assignment: '<path d="M5 20l4-1 11-11-3-3L6 16Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 6l3 3" stroke="currentColor" stroke-width="2"/>',
  slides: '<rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 17v4M8 21h8M7 13l3-3 3 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  other: '<path d="M7 3h7l4 4v14H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};
const KIND_COLOR = { syllabus: 'var(--blue)', reading: 'var(--teal)', lab: 'var(--sky)', assignment: 'var(--red)', slides: 'var(--peach)', other: 'var(--butter)' };

/* ---------- list ---------- */
function card(d) {
  const theme = ctx.state.themes.get(keyOf(d.course)) ?? 'estrellas';
  return `<article class="doc glass" style="${themeStyle(theme)};--k:${KIND_COLOR[d.kind] ?? 'var(--blue)'}" data-tilt="4">
    <span class="doc-ico d" style="--d:24"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[d.kind] ?? ICONS.other}</svg></span>
    <div class="d" style="--d:12">
      <p class="kicker" style="color:var(--k)">${esc(DOC_KINDS[d.kind] ?? 'Documento')}</p>
      <h3>${esc(d.title)}</h3>
      <p class="muted">${esc([d.code, d.course].filter(Boolean).join(' · '))}${d.professor || d.term ? `<br>${esc([d.professor, d.term].filter(Boolean).join(' · '))}` : ''}</p>
      ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
      ${d.by ? `<p class="fine">Lo compartió ${esc(d.by)}</p>` : ''}
    </div>
    <div class="actions"><a class="button primary small" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Abrir</a>${d.mine ? `<button class="button ghost small danger" data-doc-remove="${esc(d.id)}">Quitar</button>` : ''}</div>
  </article>`;
}
export function renderLibrary() {
  const docs = ctx.state.library ?? [];
  const q = keyOf($('#l-q').value);
  const counts = {};
  for (const d of docs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  $('#l-kinds').innerHTML = docs.length ? [`<button class="chip ${kindFilter ? '' : 'on'}" data-doc-kind="">Todo <small>${docs.length}</small></button>`,
    ...Object.entries(DOC_KINDS).filter(([k]) => counts[k]).map(([k, v]) => `<button class="chip ${kindFilter === k ? 'on' : ''}" data-doc-kind="${k}" style="--a:${KIND_COLOR[k]}"><i></i>${esc(v)} <small>${counts[k]}</small></button>`)].join('') : '';
  const list = docs.filter((d) => (!kindFilter || d.kind === kindFilter) && (!q || keyOf(`${d.title} ${d.course} ${d.code} ${d.professor} ${d.term}`).includes(q)))
    .sort((a, b) => a.course.localeCompare(b.course, 'es') || b.updated - a.updated);
  $('#docs').innerHTML = list.length ? list.map(card).join('')
    : `<div class="empty glass"><h2>${docs.length ? 'Nada coincide' : 'La biblioteca está vacía'}</h2><p>${docs.length ? 'Prueba con otra materia, profe o tipo.' : '¿Tienes el sílabo de alguna materia? Compártelo: es lo primero que alguien busca antes de inscribirse.'}</p></div>`;
  rise($('#docs'));
}

/* ---------- identify a file, in the browser ---------- */
async function pdfText(file, pages = 4) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, pages); i += 1) {
    const page = await doc.getPage(i);
    text += `${(await page.getTextContent()).items.map((x) => x.str).join(' ')}\n`;
  }
  return text;
}
const KIND_RULES = [
  ['syllabus', /s[ií]labo|syllabus|programa anal[ií]tico|plan de (la )?asignatura|programa del curso|course outline/i],
  ['lab', /laboratorio|\blab\b/i],
  ['assignment', /\bdeber\b|\btarea\b|proyecto final|enunciado|homework|assignment|problem set/i],
  ['slides', /diapositivas|slides|\.pptx?$/i],
  ['reading', /cap[ií]tulo|lectura|\breading\b|art[ií]culo|\bpaper\b/i],
];
function guess(text, filename) {
  const all = `${filename}\n${text}`;
  const line = (rx) => text.match(rx)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const code = all.match(/\b([A-Z]{2,4})[- ]?(\d{3,4})\b/);
  return {
    kind: KIND_RULES.find(([, rx]) => rx.test(all))?.[0] ?? 'other',
    code: code ? `${code[1]}-${code[2]}` : '',
    course: line(/(?:asignatura|materia|curso|course(?: title)?)\s*[:\-–]\s*([^\n|]{3,80})/i).replace(/\s*(c[oó]digo|code|cr[eé]ditos).*$/i, ''),
    professor: line(/(?:profesor(?:a)?|docente|instructor(?:a)?|professor|lecturer)\s*(?:[:\-–]|\s)\s*((?:dr\.?\s*|ing\.?\s*|mg\.?\s*|phd\.?\s*)?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü.' -]{2,60})/i),
    term: line(/\b(20\d{2}\s*[-–]\s*20\d{2}|20\d{4}|(?:primer|segundo)\s+semestre[^\n,.]{0,24}|(?:fall|spring|summer)\s+20\d{2})/i),
    title: filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140),
  };
}
async function identify(file) {
  const status = $('#doc-id-status');
  status.textContent = 'Leyendo el archivo en tu navegador…';
  let text = '';
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') text = await pdfText(file);
    else if (file.type.startsWith('text/') || /\.(txt|md|tex)$/i.test(file.name)) text = (await file.text()).slice(0, 20000);
  } catch { /* the name alone still says something */ }
  let found = guess(text, file.name);
  let how = text ? 'por su contenido' : 'por su nombre';
  if (ai.ready() && text) {
    status.textContent = 'Tu IA está identificando el documento…';
    try {
      const res = await ai.run({
        system: 'Identificas documentos de cursos universitarios. Respondes solo con un objeto JSON, sin texto alrededor.',
        text: `Nombre del archivo: «${file.name}». Primeras páginas:\n\n${text.slice(0, 12000)}\n\nDevuelve {"kind": uno de "syllabus", "reading", "lab", "assignment", "slides", "other"; "course": nombre de la materia; "code": código como MAT-1101; "professor": nombre del profesor; "term": semestre o periodo; "title": un título corto y claro del documento}. Usa "" en lo que no se sepa.`,
        maxTokens: 1200, use: ai.picked('identify', $('#doc-dialog')),
      });
      const json = JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1));
      for (const k of ['kind', 'course', 'code', 'professor', 'term', 'title']) if (typeof json[k] === 'string' && json[k].trim()) found[k] = json[k].trim();
      if (!(found.kind in DOC_KINDS)) found.kind = 'other';
      how = `con tu IA (${ai.PROVIDERS[res.provider].name})`;
    } catch (error) { status.textContent = `Tu IA no pudo: ${error.message} Uso lo que Studium encontró.`; }
  }
  const form = $('#doc-form');
  for (const k of ['course', 'code', 'professor', 'term', 'title']) if (found[k] && !form[k].value) form[k].value = found[k];
  form.kind.value = found.kind;
  if (!/Tu IA no pudo/.test(status.textContent)) status.textContent = `Identificado ${how}: revisa los datos, y pega el enlace donde lo compartiste.`;
  sfx.tick();
}

/* ---------- share ---------- */
function openShare() {
  const form = $('#doc-form');
  form.reset();
  $('#doc-id-status').textContent = ai.ready() ? 'Lo leen tu navegador y tu IA; el archivo no se sube a Studium.' : 'Lo lee tu navegador; el archivo no se sube a Studium.';
  $('#doc-ai').innerHTML = ai.pickerHTML('identify');
  $('#doc-msg').textContent = '';
  $('#doc-sign-wrap').innerHTML = prefs.get().name
    ? `<label class="check"><input type="checkbox" name="sign"> Firmar con mi nombre: <strong>${esc(prefs.get().name)}</strong></label>`
    : '<p class="hint">Para firmar con tu nombre, escríbelo en <a href="#/ajustes">Ajustes</a>.</p>';
  const known = [...new Set([...ctx.state.catalog, ...ctx.state.contributions, ...(ctx.state.library ?? [])].map((x) => x.course).filter(Boolean))];
  $('#doc-courses').innerHTML = known.map((c) => `<option value="${esc(c)}">`).join('');
  $('#doc-dialog').showModal();
}
const NAME_OK = (s) => !s || (s.length >= 3 && s.length <= 80 && !/[0-9@/<>{}]/.test(s));
async function save() {
  const form = $('#doc-form');
  const v = Object.fromEntries(new FormData(form).entries());
  const msg = (t) => { $('#doc-msg').textContent = t; };
  v.url = String(v.url ?? '').trim();
  if (!v.title?.trim()) return msg('Ponle un título.');
  if (!NAME_OK(v.course?.trim()) || !v.course?.trim()) return msg('Escribe la materia, sin números ni enlaces (el código va aparte).');
  if (!NAME_OK(v.professor?.trim())) return msg('Escribe el nombre del profe sin números ni enlaces.');
  if (!LINK.test(v.url)) return msg('Pega un enlace de Google Drive, OneDrive o Dropbox que empiece con https://.');
  const button = $('#doc-save');
  button.disabled = true;
  try {
    const id = await publishDocument(ctx.user.uid, { ...v, by: v.sign ? prefs.get().name : '' });
    ctx.state.library = [...(ctx.state.library ?? []), { id, type: 'document', ...v, by: v.sign ? prefs.get().name : '', updated: Date.now(), mine: true }];
    $('#doc-dialog').close();
    const r = $('#doc-new').getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 24); sfx.chime();
    ctx.toast('¡Compartido! Gracias por dejarlo para los que vienen.');
    renderLibrary();
  } catch (error) { msg(ctx.explain(error)); } finally { button.disabled = false; }
}

export function mountLibrary(context) {
  ctx = context;
  $('#doc-new').addEventListener('click', openShare);
  $('#l-q').addEventListener('input', renderLibrary);
  $('#l-kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-doc-kind]'); if (b) { kindFilter = b.dataset.docKind; sfx.tick(); renderLibrary(); } });
  $('#doc-file').addEventListener('change', (e) => { const [f] = e.target.files; if (f) identify(f); e.target.value = ''; });
  const drop = $('#doc-drop');
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const [f] = e.dataTransfer.files; if (f) identify(f); });
  $('#doc-save').addEventListener('click', save);
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-doc-remove]');
    if (!b) return;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '¿Seguro?'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Quitar'; } }, 4000); return; }
    try {
      await remove({ type: 'document', id: b.dataset.docRemove });
      ctx.state.library = ctx.state.library.filter((d) => d.id !== b.dataset.docRemove);
      renderLibrary();
      ctx.toast('Quitado de la biblioteca.');
    } catch (error) { ctx.toast(ctx.explain(error)); }
  });
}
