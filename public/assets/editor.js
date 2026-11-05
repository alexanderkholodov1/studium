// Editing one's own guide with one's own AI, like a shared document: change one section, add a section, or redo the
// whole guide. For a section, the AI receives only that section, the request and the guide's styles, so it never has to
// read or rewrite the whole page. The result is previewed before it replaces the published guide.
import * as ai from './ai.js';
import { publishGuide } from './data.js';
import { prepareGuide, showAnchor } from './viewer.js';
import { parseGuide } from './prompts.js';
import { sfx } from './sfx.js';
import { celebrate } from './play.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let job = null; // { id, entry, html, uid, onSaved, toast, next, anchor }

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const serialize = (doc) => `<!doctype html>\n${doc.documentElement.outerHTML}`;
// The parts of a guide a student can ask about: its sections, or its headings when it has no sections.
function parts(doc) {
  const sections = [...doc.querySelectorAll('section[id]')].filter((s) => !s.parentElement.closest('section[id]'));
  const list = sections.length ? sections : [...doc.querySelectorAll('h2[id]')];
  // Words of a heading, with a space between its parts (a number badge and the title are separate elements).
  const words = (h) => (h ? [...h.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ') : '');
  return list.map((el) => ({ id: el.id, title: words(el.matches('h2') ? el : el.querySelector('h1, h2, h3')).slice(0, 90) || el.id }));
}
// A heading with an id stands for itself and what follows it, up to the next heading of its level.
function block(doc, id) {
  const el = doc.getElementById(id);
  if (!el) return null;
  if (!/^H[1-3]$/.test(el.tagName)) return { nodes: [el], html: el.outerHTML };
  const nodes = [el];
  for (let n = el.nextElementSibling; n && !(n.tagName === el.tagName || (/^H[1-3]$/.test(n.tagName) && n.tagName < el.tagName)); n = n.nextElementSibling) nodes.push(n);
  return { nodes, html: nodes.map((n) => n.outerHTML).join('\n') };
}
const styles = (doc) => [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n').slice(0, 7000);
function fragment(text) {
  const t = String(text).replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
  const doc = parse(`<!doctype html><body>${t}</body>`);
  return [...doc.body.children];
}

export function openEditor(options) {
  job = { ...options, next: null };
  const doc = parse(job.html);
  const list = parts(doc);
  $('#edit-who').innerHTML = ai.ready() ? `${ai.pickerHTML('edit')}<p class="fine">Solo tú puedes editar esta guía.</p>` : '';
  $('#edit-section').innerHTML = list.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  $('#edit-what').value = '';
  $('#edit-progress').hidden = true;
  $('#edit-preview').hidden = true;
  $('#edit-save').hidden = true;
  $('#edit-run').hidden = false;
  $('#edit-run').disabled = !ai.ready();
  $('#edit-noai').hidden = ai.ready();
  const mode = document.querySelector('#edit-form input[name="emode"]:checked');
  if (!list.length && mode?.value !== 'all') document.querySelector('#edit-form input[value="all"]').checked = true;
  syncMode();
  $('#edit-dialog').showModal();
}
function syncMode() {
  const mode = document.querySelector('#edit-form input[name="emode"]:checked')?.value ?? 'change';
  $('#edit-section-label').textContent = mode === 'add' ? 'Va después de' : 'Sección';
  $('#edit-section-wrap').hidden = mode === 'all';
  $('#edit-what').placeholder = {
    change: 'Ej.: explícalo con un ejemplo de la vida real; agrega un ejercicio; la fórmula de la máscara está mal.',
    add: 'Ej.: una sección de VLSM con dos ejercicios resueltos paso a paso.',
    all: 'Ej.: hazla más corta, para repasar en una hora; o cambia el estilo a nocturno.',
  }[mode];
}

async function run() {
  const mode = document.querySelector('#edit-form input[name="emode"]:checked')?.value ?? 'change';
  const what = $('#edit-what').value.trim();
  const out = $('#edit-progress');
  if (!what) { out.hidden = false; out.textContent = 'Escribe qué quieres que haga tu IA.'; return; }
  const doc = parse(job.html);
  const title = doc.title || job.entry?.title || 'Guía';
  const id = $('#edit-section').value;
  const button = $('#edit-run');
  button.disabled = true;
  out.hidden = false;
  out.textContent = 'Tu IA está trabajando…';
  const use = ai.picked('edit', $('#edit-dialog'));
  const onProgress = (n) => { out.textContent = n < 0 ? 'Tu IA está escribiendo…' : `Tu IA está escribiendo… ${n.toLocaleString('es')} caracteres`; };
  try {
    let next;
    if (mode === 'all') {
      const res = await ai.run({
        system: 'Editas guías de estudio de Studium: páginas HTML autocontenidas. Mantienes el bloque <script type="application/json" id="studium">, las secciones con id y todo lo que funciona; cambias solo lo que el estudiante pide. Respondes solo con el HTML completo, desde <!doctype html> hasta </html>.',
        text: `Pedido del estudiante: ${what}\n\nLa guía actual:\n\n${job.html}`,
        maxTokens: ai.longest(use), onProgress, use,
      });
      next = ai.htmlFrom(res.text);
      if (!next) throw new Error('Tu IA no devolvió una página completa. Vuelve a intentarlo.');
      job.anchor = '';
      job.made = res;
    } else {
      const target = block(doc, id);
      if (!target) throw new Error('No encontré esa sección en la guía.');
      const fresh = mode === 'add' ? `seccion-${Date.now().toString(36)}` : id;
      const res = await ai.run({
        system: 'Editas una guía de estudio HTML de Studium por partes. Respondes solo con el HTML de la sección pedida, sin texto antes ni después: los mismos tipos de elementos, clases y estilos que ya usa la guía, y el JavaScript que haga falta dentro de la sección.',
        text: mode === 'add'
          ? `Guía: «${title}». Escribe una sección nueva, como un único <section id="${fresh}"> con un solo <h2>, que va justo después de esta:\n\n${target.html}\n\nLo que debe tener: ${what}\n\nEstilos de la guía, para usar sus clases:\n${styles(doc)}`
          : `Guía: «${title}». Reescribe esta sección según el pedido. Conserva su id «${id}» en el primer elemento.\n\nPedido: ${what}\n\nSección actual:\n${target.html}\n\nEstilos de la guía, para usar sus clases:\n${styles(doc)}`,
        maxTokens: 16000, onProgress, use,
      });
      const nodes = fragment(res.text);
      if (!nodes.length) throw new Error('Tu IA no devolvió HTML. Vuelve a intentarlo.');
      if (mode === 'change' && !nodes.some((n) => n.id === id || n.querySelector?.(`#${CSS.escape(id)}`))) nodes[0].id = id;
      if (mode === 'add' && !nodes[0].id) nodes[0].id = fresh;
      const anchorAfter = target.nodes[target.nodes.length - 1];
      const imported = nodes.map((n) => doc.importNode(n, true));
      if (mode === 'change') { anchorAfter.after(...imported); target.nodes.forEach((n) => n.remove()); }
      else anchorAfter.after(...imported);
      next = serialize(doc);
      job.anchor = imported[0].id;
      job.made = res;
    }
    job.next = next;
    const frame = $('#edit-preview');
    frame.hidden = false;
    frame.addEventListener('load', () => showAnchor(frame, job.anchor), { once: true });
    frame.srcdoc = prepareGuide(next);
    out.textContent = 'Mira cómo quedó. Si te gusta, guárdalo en la guía.';
    $('#edit-save').hidden = false;
    sfx.tick();
  } catch (error) {
    out.textContent = error.message || 'Algo falló.';
  } finally { button.disabled = false; }
}

async function save() {
  if (!job?.next) return;
  const button = $('#edit-save');
  button.disabled = true;
  try {
    const e = job.entry;
    const parsed = parseGuide(job.next, e);
    const concepts = parsed.concepts?.length ? parsed.concepts : (e.concepts ?? []).map((name, i) => ({ name, anchor: e.anchors?.[i] ?? '' }));
    await publishGuide(job.uid, {
      course: e.course, code: e.code, university: e.university, professor: e.professor, term: e.term, title: e.title, theme: e.theme,
      date: e.date, level: e.level, topics: e.topics ?? [], concepts: concepts.map((c) => c.name), anchors: concepts.map((c) => c.anchor),
      visibility: e.visibility, by: e.by, ai: { provider: job.made.provider, model: job.made.model, effort: job.made.effort },
    }, job.next, job.id);
    const r = button.getBoundingClientRect();
    celebrate(r.left + r.width / 2, r.top);
    $('#edit-dialog').close();
    job.toast('Guardado en tu guía.');
    job.onSaved(job.next, job.anchor);
  } catch (error) { job.toast(error.message || 'No se pudo guardar.'); } finally { button.disabled = false; }
}

export function mountEditor() {
  $('#edit-run').addEventListener('click', run);
  $('#edit-save').addEventListener('click', save);
  $('#edit-form').addEventListener('change', (e) => { if (e.target.name === 'emode') syncMode(); });
}
