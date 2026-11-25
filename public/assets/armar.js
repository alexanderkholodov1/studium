// «Ármalo por mí», inside «Preparar mi inscripción»: bring every section of your courses at once (a bookmark in your
// own tab, or the bridge), say how much each course matters and which professors you prefer, and Studium proposes
// plans A, B and C as drafts with their NRC lists in order. His registration video (2026-11-25) is the reason: two
// courses refused for a prerequisite in the same plan, no plan B, 21 minutes searching the catalog page by page.
// The sections are kept on this device only (they are the catalog's, read again any time); the person's weights and
// choices live in their profile (prefs.planner).
import { prefs } from './prefs.js';
import { sfx } from './sfx.js';
import * as ai from './ai.js';
import { auth, loadTips } from './data.js';
import { bookmarklet, readPayload, CATALOG } from './lector.js';
import { generate, baseCode, seatsLeft, profKey, sameProf } from './planner.js';
import { courseFacts, plannedCodes, sameTermPrereqs } from './malla.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const isTheory = (s) => !s.kind || /^teor/i.test(s.kind);

/* ---------- the sections brought, on this device ---------- */
const key = () => `studium-oferta:${auth.currentUser?.uid ?? 'anon'}`;
let pool = null;
export function getPool() {
  if (!pool) { try { pool = JSON.parse(localStorage.getItem(key()) ?? 'null'); } catch { pool = null; } }
  pool ??= { term: '', read: '', sections: [] };
  return pool;
}
const keep = () => { try { localStorage.setItem(key(), JSON.stringify(pool)); } catch { /* this visit only */ } };
// Sections of a course replace the ones brought before for that course; a new term starts over.
export function addToPool(term, sections, read = new Date().toISOString()) {
  const p = getPool();
  if (term && p.term && term !== p.term) p.sections = [];
  const codes = new Set(sections.map((s) => baseCode(s.code)));
  p.sections = [...p.sections.filter((s) => !codes.has(baseCode(s.code))), ...sections.map(clean)].slice(0, 1500);
  p.term = term || p.term; p.read = read;
  keep(); facts = null;
  return codes.size;
}
const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const list = (v, n, m) => (Array.isArray(v) ? v : []).map((x) => str(x, m)).filter(Boolean).slice(0, n);
// What a paste or the bridge brings is checked to the page's own shape: it lands in the page.
function clean(s) {
  return {
    code: str(s.code, 20), nrc: str(s.nrc, 12), name: str(s.name, 80), kind: str(s.kind, 20), group: str(s.group, 30), section: str(s.section, 6),
    slots: (Array.isArray(s.slots) ? s.slots : []).filter((x) => Number.isInteger(x.d) && x.d >= 0 && x.d < 6 && Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s).slice(0, 12).map((x) => ({ d: x.d, s: x.s, e: x.e })),
    building: str(s.building, 40), room: str(s.room, 20), prof: str(s.prof, 80), profs: list(s.profs, 4, 80), credits: Math.max(0, Math.min(10, Number(s.credits) || 0)),
    excluded: list(s.excluded, 20, 80), careersOut: list(s.careersOut, 40, 120), careersOnly: list(s.careersOnly, 40, 120),
    seats: s.seats && Number.isFinite(s.seats.max) ? { max: Math.max(0, s.seats.max | 0), taken: Math.max(0, s.seats.taken | 0) } : null,
  };
}
export const fromPaste = (text) => readPayload(text);

/* ---------- what the page knows of each course ---------- */
let facts = null; // Map base code → facts from the malla
let tips = null; // the community's professor tags
let plans = null; // the last proposal
let busy = '';
let msg = '';
let open = ''; // the course whose professors are shown
let ctx = null;
// Open or closed as the person left it (a redraw keeps it); open by default once there is something to weigh.
let shut = null;
document.addEventListener('toggle', (e) => { if (e.target.matches?.('[data-armar]')) shut = !e.target.open; }, true);

const courses = () => {
  const by = new Map();
  for (const s of getPool().sections) { const k = baseCode(s.code); if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  return [...by].map(([code, sections]) => ({ code, sections, name: (sections.find(isTheory) ?? sections[0]).name.replace(/\s*\+\s*(Lab|Ej)[^]*$/i, '').trim() || code }));
};
async function learn() {
  const cs = courses();
  facts = await courseFacts(cs.map((c) => c.code)).catch(() => new Map());
  if (!tips) tips = await loadTips().catch(() => []);
  // A course and its own prerequisite cannot go together: computed once for the pairs brought.
  pairs = new Set();
  for (const a of cs) {
    const need = await sameTermPrereqs(a.code, cs.filter((b) => b !== a).map((b) => b.code)).catch(() => []);
    for (const b of cs) if (b !== a && need.some((n) => n.includes(b.code) || n.includes(b.sections[0].code.replace('-', ' ')))) pairs.add(`${a.code}>${b.code}`);
  }
  ctx?.paint();
}
let pairs = new Set();

// How much a course matters: the person's say first; otherwise from the malla.
const WEIGHT = { 3: 100, 2: 40, 1: 12, 0: 0 };
const PRIO = [[3, 'Imprescindible'], [2, 'Me gustaría'], [1, 'Si cabe'], [0, 'No']];
function prioOf(c) {
  const own = prefs.get().planner?.prio?.[c.code];
  if (own !== undefined) return own;
  const f = facts?.get(c.code);
  if (!f) return 1;
  if (f.inMalla && !f.met && !f.doing) return 0;
  if (f.passed) return 1;
  if (f.planned) return 3;
  if (f.inMalla || f.minor) return 2;
  return 1;
}
function weightOf(c) {
  const f = facts?.get(c.code) ?? {};
  return WEIGHT[prioOf(c)] + Math.min(5, f.opens ?? 0) * 3 + (f.minor ? 8 : 0);
}
// The community's tags for a professor (constructive only, counted, never signed: community.js).
function tagsOf(name) {
  if (!name || !tips?.length) return { people: 0, top: [] };
  const mine = tips.filter((t) => sameProf(name, t.professor));
  const count = new Map();
  for (const t of mine) for (const g of t.tags ?? []) count.set(g, (count.get(g) ?? 0) + 1);
  return { people: mine.length, top: [...count].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g) };
}
const own = (name) => prefs.get().planner?.profs?.[profKey(name).slice(0, 80)] ?? 0;
function profScore(s) {
  const o = own(s.prof);
  return (o === 1 ? 20 : o === -1 ? -35 : 0) + Math.min(5, tagsOf(s.prof).people);
}
const setPlanner = (patch) => prefs.set({ planner: { ...(prefs.get().planner ?? {}), ...patch } });

/* ---------- the panel ---------- */
const TAG_NAMES = { 'explica-claro': 'explica claro', ejemplos: 'muchos ejemplos', practico: 'práctico', responde: 'responde dudas', tutorias: 'tutorías', 'examen-clase': 'examen de lo visto', recuperar: 'deja recuperar', material: 'comparte material', 'puntos-extra': 'puntos extra', procedimiento: 'valora el procedimiento' };
function wantedCodes() {
  const fromPool = courses().map((c) => c.sections[0].code);
  const planned = plannedCodes().map((c) => c.replace(' ', '-'));
  return [...new Set([...planned, ...fromPool])];
}
function bringStep() {
  const codes = wantedCodes();
  const b = ai.bridgeOf();
  return `<section class="ar-step"><h4><span>1</span> Trae todos los paralelos</h4>
    <label class="field"><span>Tus materias <small>códigos o nombres, separados por coma</small></span><input data-ar-codes value="${esc(codes.join(', '))}" placeholder="CMP-5006, QUI-1003, Física para Ing. 1"></label>
    <div class="ar-ways">
      <div class="ar-way"><b>En tu navegador</b>
        <p class="fine">Arrastra este botón a tu barra de marcadores (una vez): <a class="ar-bookmark" href="${esc(bookmarklet(codes, getPool().term))}" data-ar-bookmark title="Arrástralo a tu barra de marcadores">Studium: leer la oferta</a></p>
        <p class="fine">Abre la <a href="${CATALOG}" target="_blank" rel="noopener">Oferta de cursos ↗</a> con tu cuenta, pulsa el marcador, «Leer» y «Copiar para Studium», y pégalo abajo en «Agregar clases».</p></div>
      <div class="ar-way"><b>Con el puente</b>
        <p class="fine">El puente abre una ventana de Chrome propia; la primera vez inicias sesión ahí con tu cuenta de la U.</p>
        ${b?.token ? `<button class="button ghost small" data-ar-bridge ${busy ? 'disabled' : ''}>${busy === 'bridge' ? 'Leyendo…' : 'Leer con el puente'}</button>` : '<p class="fine"><a href="#/ajustes">Enlaza el puente en Ajustes</a> para usar esta forma.</p>'}</div>
    </div>
    <details class="ar-info"><summary>Qué hacen exactamente</summary>
      <p class="fine">Los dos usan el mismo lector: pide a la Oferta de cursos, con tu sesión, lo mismo que pide su botón «Actualizar Cursos», una materia a la vez y con una pausa. Solo lee: no inscribe ni cambia nada. Lo leído llega a Studium cuando tú lo pegas (marcador) o cuando el puente termina, y queda solo en este dispositivo. Tu contraseña nunca pasa por Studium: inicias sesión en la página de la U.</p></details>
    ${getPool().sections.length ? `<p class="fine">Tienes ${getPool().sections.length} secciones de ${courses().length} materias${getPool().term ? ` del periodo ${esc(getPool().term)}` : ''}, leídas ${esc(new Date(getPool().read).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }))}. <button class="link" data-ar-clear>Borrarlas</button></p>` : ''}
  </section>`;
}
function courseRow(c) {
  const f = facts?.get(c.code) ?? {};
  const p = prioOf(c);
  const seats = c.sections.map(seatsLeft).filter((x) => x !== null);
  const free = seats.reduce((a, b) => a + b, 0);
  const why = [
    f.planned && 'para tu próximo semestre', f.opens && `abre ${f.opens}`, f.minor && `cuenta para tu minor`, f.passed && 'ya la aprobaste: sería repetir',
    f.doing && 'la estás cursando', f.inMalla && !f.met && !f.doing && `te falta ${f.needs}`, !f.inMalla && facts && 'fuera de tu malla: electiva u optativa',
  ].filter(Boolean);
  const profs = [...new Set(c.sections.map((s) => s.prof).filter(Boolean))];
  return `<li class="ar-course${p === 0 ? ' off' : ''}">
    <div class="ar-course-head"><b>${esc(c.name)}</b> <small>${esc(c.sections[0].code)} · ${c.sections.length} secciones${seats.length ? ` · ${free} cupos` : ''}</small></div>
    ${why.length ? `<p class="fine">${why.map(esc).join(' · ')}</p>` : ''}
    <div class="ar-prio" role="radiogroup" aria-label="Qué tanto te importa ${esc(c.name)}">${PRIO.map(([v, n]) => `<button role="radio" aria-checked="${p === v}" data-ar-prio="${esc(c.code)}" data-v="${v}">${n}</button>`).join('')}</div>
    ${profs.length ? `<button class="link small" data-ar-profs="${esc(c.code)}" aria-expanded="${open === c.code}">Profesores (${profs.length})</button>` : ''}
    ${open === c.code ? `<ul class="ar-profs">${profs.map((n) => { const t = tagsOf(n); const o = own(n); return `<li><span>${esc(n)}${t.people ? ` <small>${t.people} ${t.people === 1 ? 'persona' : 'personas'} en Comunidad: ${t.top.map((g) => esc(TAG_NAMES[g] ?? g)).join(', ')}</small>` : ''}</span>
      <span class="ar-own"><button data-ar-prof="${esc(n)}" data-v="1" aria-pressed="${o === 1}">Lo prefiero</button><button data-ar-prof="${esc(n)}" data-v="-1" aria-pressed="${o === -1}">Mejor no</button></span></li>`; }).join('')}</ul>
      <p class="fine">Lo que eliges aquí es solo tuyo: nadie más lo ve. Lo que cuenta la comunidad está en <a href="#/profes">Profes</a>.</p>` : ''}
  </li>`;
}
function comfortStep() {
  const c = prefs.get().planner?.comfort ?? {};
  return `<section class="ar-step"><h4><span>3</span> Tu comodidad</h4><div class="ar-comfort">
    <label class="field"><span>Máximo de créditos</span><input type="number" min="6" max="22" value="${c.max ?? 16}" data-ar-comfort="max"></label>
    <label class="field"><span>No antes de</span><select data-ar-comfort="start">${[420, 510, 600, 690].map((m) => `<option value="${m}" ${Number(c.start ?? 420) === m ? 'selected' : ''}>${hhmm(m)}</option>`).join('')}</select></label>
    <label class="field"><span>Prefiero</span><select data-ar-comfort="prefer"><option value="">Equilibrado</option><option value="dias" ${c.prefer === 'dias' ? 'selected' : ''}>Menos días de clase</option><option value="huecos" ${c.prefer === 'huecos' ? 'selected' : ''}>Menos huecos entre clases</option></select></label>
  </div></section>`;
}
function planCard(p, i) {
  const letter = 'ABC'[i];
  const nrcs = p.order.flatMap((x) => x.bundle.map((s) => s.nrc));
  return `<article class="ar-plan"><header><b>Plan ${letter}</b><small>${p.credits} créditos</small></header>
    <ol>${p.order.map((x) => { const alts = p.fallback.get(x.course.code) ?? []; return `<li><b>${esc(x.course.name)}</b>
      <small>${x.bundle.map((s) => `${esc(s.kind || 'Clase')} ${esc(s.nrc)}: ${s.slots.map((t) => `${SHORT[t.d]} ${hhmm(t.s)}`).join(', ')}${s.prof ? ` · ${esc(s.prof.split(',')[0])}` : ''}${seatsLeft(s) !== null ? ` · ${seatsLeft(s)} cupos` : ''}`).join('<br>')}</small>
      ${x.full ? '<em class="tag amber">sin cupo: pide cupo o usa otra</em>' : ''}
      ${alts.length ? `<small class="ar-alt">Si se llena: ${alts.map((b) => b.map((s) => s.nrc).join(' + ')).join(' o ')}</small>` : ''}</li>`; }).join('')}</ol>
    ${p.left.length ? `<p class="fine">No entra: ${p.left.map((c) => esc(c.name)).join(', ')}.</p>` : ''}
    <div class="actions"><button class="button ghost small" data-ar-copy="${i}" data-nrcs="${esc(nrcs.join('\n'))}">Copiar NRC (${nrcs.length})</button><button class="button primary small" data-ar-draft="${i}">Crear como borrador</button></div>
  </article>`;
}
export function armarPanel(context) {
  ctx = context;
  if (getPool().sections.length && !facts) learn();
  const cs = courses().sort((a, b) => weightOf(b) - weightOf(a));
  const isOpen = shut === null ? true : !shut;
  return `<details class="armar glass" ${isOpen ? 'open' : ''} data-armar>
    <summary><h3>Ármalo por mí</h3><span class="muted small">Trae todos los paralelos y Studium te propone horarios A, B y C.</span></summary>
    ${bringStep()}
    ${cs.length ? `<section class="ar-step"><h4><span>2</span> Qué tanto te importa cada una</h4><ul class="ar-courses">${cs.map(courseRow).join('')}</ul>
      ${[...pairs].length ? `<p class="fine ar-warn">${[...pairs].map((x) => { const [a, b] = x.split('>'); return `${esc(cs.find((c) => c.code === a)?.name ?? a)} pide ${esc(cs.find((c) => c.code === b)?.name ?? b)}`; }).join('; ')}: nunca van en el mismo plan.</p>` : ''}</section>
      ${comfortStep()}
      <div class="actions"><button class="button primary" data-ar-run>Armar horarios</button></div>` : ''}
    ${msg ? `<p class="msg" role="status">${msg}</p>` : ''}
    ${plans?.length ? `<div class="ar-plans">${plans.map(planCard).join('')}</div>
      <p class="fine">El orden de cada plan es el orden para escribirlos en Banner: lo imprescindible y con menos cupos primero. Las partes de una materia (teoría, laboratorio, ejercicios) van juntas. Studium propone; tú decides.</p>` : ''}
  </details>`;
}

/* ---------- actions ---------- */
function run() {
  const cf = prefs.get().planner?.comfort ?? {};
  const list = courses().map((c) => ({ ...c, weight: weightOf(c) * (prioOf(c) === 0 ? 0 : 1) }));
  const closed = (s) => ctx.closedToMe?.(s) ?? false;
  plans = generate(list, { max: cf.max ?? 16, start: cf.start ?? 420, prefer: cf.prefer ?? '', profScore, closed, together: (a, b) => pairs.has(`${a}>${b}`) });
  msg = plans.length ? '' : 'No encontré una combinación sin choques con esas materias. Prueba marcar alguna como «Si cabe» o subir el máximo de créditos.';
  ctx.paint();
  if (plans.length) sfx.chime?.();
}
export async function armarClick(t) {
  const d = t.dataset;
  if (d.arPrio !== undefined) { setPlanner({ prio: { ...(prefs.get().planner?.prio ?? {}), [d.arPrio]: Number(d.v) } }); plans = null; ctx.paint(); return true; }
  if (d.arProfs !== undefined) { open = open === d.arProfs ? '' : d.arProfs; ctx.paint(); return true; }
  if (d.arProf !== undefined) {
    const k = profKey(d.arProf); const cur = { ...(prefs.get().planner?.profs ?? {}) };
    if (cur[k] === Number(d.v)) delete cur[k]; else cur[k] = Number(d.v);
    setPlanner({ profs: cur }); plans = null; ctx.paint(); return true;
  }
  if ('arRun' in d) { run(); return true; }
  if ('arClear' in d) { pool = { term: '', read: '', sections: [] }; keep(); plans = null; facts = null; ctx.paint(); return true; }
  if (d.arCopy !== undefined) {
    try { await navigator.clipboard.writeText(d.nrcs); t.textContent = 'Copiados'; sfx.tick?.(); } catch { t.textContent = 'No se pudo copiar'; }
    return true;
  }
  if (d.arDraft !== undefined) {
    const p = plans?.[Number(d.arDraft)];
    if (!p) return true;
    const name = `Plan ${'ABC'[Number(d.arDraft)]}`;
    ctx.addDraft(name, p.order.flatMap((x) => x.bundle), getPool().term);
    msg = `${name} quedó como borrador: revísalo arriba.`; sfx.chime?.(); ctx.paint(); scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }
  if ('arBridge' in d) {
    const codes = (ctx.root().querySelector('[data-ar-codes]')?.value ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (!codes.length) { msg = 'Escribe primero tus materias.'; ctx.paint(); return true; }
    busy = 'bridge'; msg = 'El puente abrió una ventana de Chrome: si te pide tu cuenta de la U, inicia sesión ahí. Lee una materia a la vez.'; ctx.paint();
    try {
      const r = await ai.bridgeCatalog(codes, getPool().term);
      const n = addToPool(r.term, r.sections, r.read);
      msg = `Listo: ${r.sections.length} secciones de ${n} materias.${r.missing?.length ? ` Sin resultados: ${r.missing.map(esc).join(', ')}.` : ''}`;
      sfx.chime?.();
    } catch (e) { msg = esc(e?.message ?? 'El puente no pudo leer la oferta.'); }
    busy = ''; ctx.paint();
    return true;
  }
  if ('arBookmark' in d) { msg = 'Arrastra el botón a tu barra de marcadores; púlsalo en la Oferta de cursos, no aquí.'; ctx.paint(); return true; }
  return false;
}
export function armarChange(t) {
  if (t.matches('[data-ar-comfort]')) {
    const c = { ...(prefs.get().planner?.comfort ?? {}) };
    c[t.dataset.arComfort] = t.dataset.arComfort === 'prefer' ? t.value : Number(t.value);
    setPlanner({ comfort: c }); plans = null; return true;
  }
  if (t.matches('[data-ar-codes]')) { const a = ctx.root().querySelector('[data-ar-bookmark]'); if (a) a.href = bookmarklet(t.value.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean), getPool().term); return true; }
  return false;
}
