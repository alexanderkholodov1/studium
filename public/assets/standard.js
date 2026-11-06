// The standard every contribution, guide and document is read by, so the map joins what belongs together: the stage
// of a course an item belongs to (Parcial 1, Examen 2, the final…), academic terms, concept names with their aliases,
// course codes and professors. Pure functions: the browser, the tools and the tests use the same ones.
import { keyOf } from './themes.js';

/* ---------- concept names ---------- */

// The key that joins concepts: accents, case, punctuation, a leading article and plurals do not matter.
// «Subredes», «la subred» and «Subred» share one key; «Índices» and «índice» too.
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'the', 'a', 'an']);
function singular(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ces')) return `${w.slice(0, -3)}z`;
  if (w.endsWith('ce')) return `${w.slice(0, -2)}z`;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ie')) return `${w.slice(0, -2)}y`;
  if (w.endsWith('es') && /[rlndzyj]$/.test(w.slice(0, -2))) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|is|us)$/.test(w)) return w.slice(0, -1);
  return w;
}
export function looseKey(name) {
  const words = keyOf(name).split('-').filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.map(singular).join('-');
}

// A concept's standard name and its other names. A name in parentheses after a space is an alias:
// «Búsqueda en anchura (BFS)» is «Búsqueda en anchura», also called «BFS». Math such as «O(n log n)» stays as it is.
export function conceptName(raw, more = []) {
  let name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const aliases = [];
  name = name.replace(/\s\(([^()]{2,60})\)/g, (whole, inner) => {
    if (!/^[\p{L}][\p{L}\p{N} .,'/&+-]*$/u.test(inner.trim())) return whole;
    for (const a of inner.split(/\s*[,;/]\s*|\s+(?:o|or)\s+/)) if (a.trim()) aliases.push(a.trim());
    return '';
  }).trim();
  if (!keyOf(name) && aliases.length) name = aliases.shift();
  const seen = new Set([looseKey(name)]);
  const out = [];
  for (const a of [...aliases, ...(Array.isArray(more) ? more : [])]) {
    const clean = String(a ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const k = looseKey(clean);
    if (k && !seen.has(k)) { seen.add(k); out.push(clean); }
  }
  return { name: name.slice(0, 80), aliases: out.slice(0, 8) };
}

/* ---------- stages: where in a course an item belongs ---------- */

// kind: partial (a numbered exam or partial), midterm, final, quiz, homework, lab, project, class (a class or week),
// chapter, unit, other. order places it on the course's timeline: partials by number, the final last. Quizzes,
// homework, classes and chapters have no place of their own on the timeline until a syllabus or the material says
// which evaluation they belong to.
const ORDINALS = {
  primer: 1, primero: 1, primera: 1, '1er': 1, '1ro': 1, '1ra': 1, first: 1,
  segundo: 2, segunda: 2, '2do': 2, '2da': 2, second: 2,
  tercer: 3, tercero: 3, tercera: 3, '3er': 3, '3ro': 3, '3ra': 3, third: 3,
  cuarto: 4, cuarta: 4, '4to': 4, '4ta': 4, fourth: 4,
  quinto: 5, quinta: 5, '5to': 5, '5ta': 5, fifth: 5,
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
const LABELS = {
  partial: (n) => (n ? `Examen ${n}` : 'Examen'), midterm: () => 'Medio semestre', final: () => 'Final',
  quiz: (n) => (n ? `Quiz ${n}` : 'Quiz'), homework: (n) => (n ? `Deber ${n}` : 'Deber'), lab: (n) => (n ? `Práctica ${n}` : 'Práctica'),
  project: (n) => (n ? `Proyecto ${n}` : 'Proyecto'), class: (n) => (n ? `Clase ${n}` : 'Clase'),
  chapter: (n) => (n ? `Capítulo ${n}` : 'Capítulo'), unit: (n) => (n ? `Unidad ${n}` : 'Unidad'), other: () => '',
};
const ORDER = { partial: (n) => (n ? n * 10 : null), midterm: () => 15, final: () => 1000 };

// A number as a word: «2», «02», «12d3» (12.3, see stageOf). Numbers past 99 are years or codes, not stages.
const asNumber = (w) => {
  const m = String(w ?? '').replace(/^#/, '').match(/^(\d+)(?:d(\d+))?$/);
  if (!m) return null;
  const n = Number(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  return n > 0 && n < 100 ? n : null;
};
const FILLER = new Set(['de', 'del', 'la', 'el', 'no', 'n', 'num', 'numero', 'practica', 'practice', 'parcial', 'partial']);
// The number near a word: «Parcial 2», «Parcial II», «Segundo parcial», «Exam1», «EP1», «Deber 12.3», «Examen Práctica 1».
function numberNear(words, i) {
  const glued = asNumber(words[i].match(/(\d+(?:d\d+)?)$/)?.[1]);
  if (glued) return glued;
  for (let j = i + 1; j <= i + 3 && j < words.length; j += 1) {
    const w = words[j];
    const n = asNumber(w) ?? ROMAN[w] ?? ORDINALS[w] ?? asNumber(w.match(/(\d+(?:d\d+)?)$/)?.[1]);
    if (n) return n;
    // Fillers and short tags in between are skipped: «Examen de práctica 1», «ClaseMD 8.1».
    if (!FILLER.has(w) && w.length > 2) break;
  }
  return ORDINALS[words[i - 1]] ?? null;
}
const RULES = [
  [/^(final|finales)$/, 'final'],
  [/^(midterm|mid)$/, 'midterm'],
  [/^(parcial\d*|parcila\d*|parciales|partial\d*|partials|ep\d*|examen\d*|examenes|exam\d*|exams|test\d*|evaluacion\d*|prueba\d*|pruebas)$/, 'partial'],
  [/^(quiz\d*|quices|quizzes|corta|cortas|lecciones|leccion\d*)$/, 'quiz'],
  [/^(deber\d*|deberes|tarea\d*|tareas|homework\d*|hw\d*|assignment\d*|ejercicios|taller\d*|talleres)$/, 'homework'],
  [/^(practica\d*|practicas|laboratorio\d*|laboratorios|lab\d*|labs|informe\d*|informes)$/, 'lab'],
  [/^(proyecto\d*|proyectos|project\d*)$/, 'project'],
  [/^(semana\d*|semanas|clase\d*|clases|clasemd|sesion\d*|lecture\d*|week\d*|class)$/, 'class'],
  [/^(capitulo\d*|capitulos|cap\d*|chapter\d*|chap\d*|ch\d*)$/, 'chapter'],
  [/^(unidad\d*|unidades|unit\d*|modulo\d*|tema\d*)$/, 'unit'],
];
// Preparation for an evaluation belongs to that evaluation: «Repaso Examen 2», «Hoja de preparación 1», «Guía Examen 1».
const PREP = /^(repaso|repasos|review|preparacion|guia|simulacro|practice)(\d*)$/;

export function stageOf(text) {
  // «PrimerParcial1» is «Primer Parcial1»; «Semana_2a» is «Semana 2 a»; «Deber 12.3» keeps its decimal as «12d3».
  const raw = String(text ?? '').replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/(\d+)\.(\d+)/g, '$1d$2');
  const words = keyOf(raw).split('-').filter(Boolean);
  let found = null;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === 'prueba' && words[i + 1] === 'corta') { found = { kind: 'quiz', n: numberNear(words, i + 1) }; break; }
    if (w === 'final' && /^(exam|examen|review)$/.test(words[i + 1] ?? '')) { found = { kind: 'final', n: null }; break; }
    const rule = RULES.find(([rx]) => rx.test(w));
    if (!rule) continue;
    let kind = rule[1];
    // «Examen final», «Final Exam»: the final. «Examen parcial 1»: a partial. «Prueba 1» at USFQ is an exam.
    if (kind === 'partial' && words[i + 1] === 'final') kind = 'final';
    if (kind === 'partial' && words[i + 1] === 'midterm') kind = 'midterm';
    found = { kind, n: kind === 'final' || kind === 'midterm' ? null : numberNear(words, i) };
    break;
  }
  if (!found) {
    const at = words.findIndex((w) => PREP.test(w));
    const n = at >= 0 ? numberNear(words, at) : null;
    if (n && n < 20) found = { kind: 'partial', n };
  }
  if (!found) return null;
  const order = ORDER[found.kind]?.(found.n) ?? null;
  return { kind: found.kind, n: found.n, order, label: LABELS[found.kind](found.n) };
}
// A stage as written by a person or an AI, kept readable: «Examen 2» stays «Examen 2», «EP1» becomes «Examen 1».
export function stageLabel(text) {
  const s = stageOf(text);
  if (!s) return String(text ?? '').trim().slice(0, 40);
  return s.label;
}
// Two stages are the same evaluation.
export const sameStage = (a, b) => {
  const x = stageOf(a); const y = stageOf(b);
  return !!x && !!y && x.kind === y.kind && x.n === y.n;
};

/* ---------- academic terms ---------- */

// USFQ's term codes: YYYY10 is the first semester of YYYY-(YYYY+1), YYYY20 the second, YYYY30 the summer after it.
export function termOf(text) {
  const raw = String(text ?? '');
  const code = raw.match(/\b(20\d{2})(10|20|30)\b/)?.slice(1) ?? raw.match(/\b(20\d{2})\s*[-–]\s*(10|20|30)\b/)?.slice(1);
  if (!code) return null;
  return { code: `${code[0]}${code[1]}`, year: Number(code[0]), part: Number(code[1]) / 10 };
}
export function termLabel(text) {
  const t = termOf(text);
  if (!t) return String(text ?? '').trim();
  if (t.part === 1) return `1.er semestre ${t.year}-${t.year + 1}`;
  if (t.part === 2) return `2.º semestre ${t.year}-${t.year + 1}`;
  return `Verano ${t.year + 1}`;
}
// One key per term: its code when it has one, so «202610» and «202610 · 1.er semestre 2026-2027» are the same term.
export const termKey = (text) => termOf(text)?.code ?? keyOf(text);

/* ---------- courses and professors ---------- */

// «CMP-4005», «CMP 4005» and «cmp4005» are one code.
export const codeKey = (code) => keyOf(code).replace(/-/g, '');

// Two names of the same professor in the same course: one is contained in the other («Ricardo Flores» and «Ricardo
// Flores Moyano»), or a lone surname matches.
export function sameProfessor(a, b) {
  const x = keyOf(a).split('-').filter((w) => w.length > 1);
  const y = keyOf(b).split('-').filter((w) => w.length > 1);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w)) && (short.length >= 2 || long.length <= 3);
}
