// What the map can work out from the graph: routes (everything needed for an evaluation, up to it and no further),
// the path between two concepts, a node's neighbourhood, and the reading of a question asked in words, either by a
// simple reader of common phrasings or by the person's AI with a compact index of the map.
import { keyOf } from './themes.js';
import { looseKey, stageOf, termOf, termKey, sameProfessor } from './standard.js';

// Relations that make one concept come before another: A prerequisite of B, and A used in B. «A is part of B» does not:
// the parts of TCP (its congestion control, its timers) are not needed for an exam that only asks for TCP's ports.
const BEFORE = new Set(['prerequisite', 'uses']);
const concepts = (graph) => graph.nodes.filter((n) => n.type === 'concept');

// The concepts a concept needs before it (one step), from the relations in the graph.
function needs(graph) {
  if (graph.needs) return graph.needs;
  const before = new Map(); // node -> Map(node that comes before it -> its relation)
  for (const l of graph.links) {
    if (l.kind !== 'relation' || !BEFORE.has(l.relation)) continue;
    if (!before.has(l.target)) before.set(l.target, new Map());
    if (before.get(l.target).get(l.source) !== 'prerequisite') before.get(l.target).set(l.source, l.relation);
  }
  graph.needs = before;
  return before;
}

/* ---------- routes ---------- */

// A route to an evaluation of a course: the concepts placed up to that evaluation on the course's timeline (cumulative:
// Examen 2 stands on Examen 1), plus everything they need before them, from any course, and nothing that belongs to a
// later evaluation. Without a timeline (no material says which evaluation it is), the whole course. A route can also
// lead to a few concepts (to), with what they need. professor and term narrow the course's concepts to what that
// professor or term covered, when there is enough of it.
export function routeTo(graph, { course = null, stage = null, professor = '', term = '', to = null } = {}) {
  const notes = [];
  const before = needs(graph);
  let target = [];
  let limit = null;
  const bands = [];
  if (to?.length) {
    target = to.filter((n) => n?.type === 'concept');
  } else if (course) {
    let own = concepts(graph).filter((n) => n.courses.has(course.id));
    if (professor) {
      const mine = own.filter((n) => [...n.professors].some((p) => sameProfessor(p, professor)));
      if (mine.length >= 3) own = mine; else notes.push(`Hay poco material de ${professor}: la ruta usa el de todos los profesores.`);
    }
    if (term) {
      const t = termKey(term);
      const inTerm = own.filter((n) => n.terms.has(t));
      if (inTerm.length >= 3) own = inTerm; else notes.push('Hay poco material de ese semestre: la ruta usa el de todos.');
    }
    const placed = (course.stageList ?? []).filter((s) => s.order != null);
    const wanted = stage ? (typeof stage === 'string' ? stageOf(stage) : stage) : null;
    if (wanted?.order != null && placed.length) {
      limit = wanted.order;
      for (const s of placed) if (s.order <= limit) bands.push(s);
      target = own.filter((n) => (n.stageBy.get(course.id) ?? Infinity) <= limit);
      const later = own.filter((n) => (n.stageBy.get(course.id) ?? -1) > limit).length;
      const loose = own.filter((n) => !n.stageBy.has(course.id)).length;
      if (later) notes.push(`${later} ${later === 1 ? 'concepto queda fuera: es' : 'conceptos quedan fuera: son'} de evaluaciones posteriores.`);
      if (loose) notes.push(`${loose} ${loose === 1 ? 'concepto de la materia no tiene' : 'conceptos de la materia no tienen'} evaluación asignada: ${loose === 1 ? 'entra' : 'entran'} solo si otro ${loose === 1 ? 'lo necesita' : 'los necesita'}.`);
      if (!target.length) { notes.push(`Todavía no hay material ubicado en ${wanted.label} o antes: la ruta incluye toda la materia.`); target = own; limit = null; bands.length = 0; }
    } else {
      if (wanted) notes.push(`Ningún material de ${course.name} dice todavía a qué evaluación pertenece: la ruta incluye toda la materia.`);
      target = own;
    }
  }
  const inRoute = new Set(target);
  const late = (n) => course && limit != null && (n.stageBy.get(course.id) ?? -Infinity) > limit;
  // What the target needs before it, across courses: prerequisites up to three steps back, and what is used in it one
  // step back.
  let frontier = [...target];
  for (let depth = 0; depth < 3 && frontier.length; depth += 1) {
    const next = [];
    for (const n of frontier) {
      for (const [m, kind] of before.get(n) ?? []) {
        if (inRoute.has(m) || late(m) || (kind === 'uses' && depth > 0)) continue;
        inRoute.add(m); next.push(m);
      }
    }
    frontier = next;
  }
  // Rows: a band per evaluation (the foundations first), and inside a band, by what comes before what.
  const bandOf = (n) => {
    if (!course || limit == null) return 0;
    const order = n.stageBy.get(course.id);
    const i = order == null ? -1 : bands.findIndex((s) => s.order >= order);
    return i < 0 ? 0 : i + 1;
  };
  const depth = new Map();
  const visit = (n, seen) => {
    if (depth.has(n)) return depth.get(n);
    if (seen.has(n)) return 0;
    seen.add(n);
    let d = 0;
    for (const m of (before.get(n) ?? new Map()).keys()) if (inRoute.has(m) && bandOf(m) === bandOf(n)) d = Math.max(d, visit(m, seen) + 1);
    depth.set(n, Math.min(d, 6));
    return depth.get(n);
  };
  for (const n of inRoute) visit(n, new Set());
  const steps = [...inRoute].map((n) => ({ node: n, band: bandOf(n), depth: depth.get(n) ?? 0, target: target.includes(n) }))
    .sort((a, b) => a.band - b.band || a.depth - b.depth || b.node.questions.length - a.node.questions.length || a.node.name.localeCompare(b.node.name, 'es'));
  const bandLabels = ['Lo que necesitas antes', ...bands.map((s) => s.label)];
  return { course, stage: limit != null ? bands.at(-1) : null, professor, term, steps, notes, bandLabels, nodes: inRoute };
}

// Where each step of a route goes on the screen: the foundations at the bottom, the evaluation at the top, at most
// nine concepts per row, each row ordered by where the concepts it needs are.
export function routeLayout(route) {
  const pins = new Map();
  const rows = [];
  const W = 172; const H = 96; const PER = 9;
  const groups = new Map();
  for (const s of route.steps) {
    const key = `${s.band}:${s.depth}`;
    if (!groups.has(key)) groups.set(key, { band: s.band, depth: s.depth, steps: [] });
    groups.get(key).steps.push(s);
  }
  const ordered = [...groups.values()].sort((a, b) => a.band - b.band || a.depth - b.depth);
  let y = 0;
  let lastBand = null;
  const xOf = new Map();
  const before = (n) => [...(n.relations ?? [])].filter((r) => !r.out && BEFORE.has(r.kind));
  // Each band is a soft stripe behind its rows, with its name at the left.
  const close = (yTop) => { const band = rows.at(-1); if (band) { band.y = (band.from + yTop + H) / 2; band.height = band.from - yTop - H + H * 0.86; } };
  for (const g of ordered) {
    if (g.band !== lastBand) {
      if (lastBand !== null) { close(y); y -= H * 0.5; }
      rows.push({ from: y, y, label: route.bandLabels[g.band] ?? '', height: H });
      lastBand = g.band;
    }
    // Barycentre of what each concept needs, so lines cross less.
    const bary = (s) => {
      const xs = before(s.node).map((r) => xOf.get(`concept:${r.key}`)).filter((x) => x != null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    const sorted = [...g.steps].sort((a, b) => bary(a) - bary(b));
    for (let i = 0; i < sorted.length; i += PER) {
      const row = sorted.slice(i, i + PER);
      row.forEach((s, j) => {
        const x = (j - (row.length - 1) / 2) * W;
        pins.set(s.node.id, { x, y });
        xOf.set(s.node.id, x);
      });
      y -= H;
    }
  }
  close(y);
  return { pins, rows };
}

/* ---------- paths and neighbourhoods ---------- */

// The shortest path between two nodes. A relation between two concepts is the shortest step; going through a
// course or a guide costs more, so the path follows what the concepts say about each other when it can.
const COST = { relation: 1, in: 3, covers: 4, has: 5, prerequisite: 3, plan: 6 };
export function pathBetween(graph, a, b) {
  if (!a || !b) return [];
  const next = new Map(graph.nodes.map((n) => [n, []]));
  for (const l of graph.links) {
    const cost = COST[l.kind];
    if (!cost) continue;
    next.get(l.source).push([l.target, cost]); next.get(l.target).push([l.source, cost]);
  }
  const dist = new Map([[a, 0]]);
  const prev = new Map([[a, null]]);
  const open = [[0, a]];
  while (open.length) {
    open.sort((x, y) => x[0] - y[0]);
    const [d, n] = open.shift();
    if (n === b) break;
    if (d > (dist.get(n) ?? Infinity)) continue;
    for (const [m, c] of next.get(n) ?? []) {
      if (d + c < (dist.get(m) ?? Infinity)) { dist.set(m, d + c); prev.set(m, n); open.push([d + c, m]); }
    }
  }
  if (!prev.has(b)) return [];
  const path = [];
  for (let n = b; n; n = prev.get(n)) path.unshift(n);
  return path;
}
// A node and everything within depth steps of it.
export function neighbourhood(graph, node, depth = 1, adjacent = null) {
  const near = adjacent ?? new Map(graph.nodes.map((n) => [n, new Set()]));
  if (!adjacent) for (const l of graph.links) { near.get(l.source).add(l.target); near.get(l.target).add(l.source); }
  const out = new Set([node]);
  let frontier = [node];
  for (let d = 0; d < depth; d += 1) {
    const next = [];
    for (const n of frontier) for (const m of near.get(n) ?? []) if (!out.has(m)) { out.add(m); next.push(m); }
    frontier = next;
  }
  return out;
}

/* ---------- questions in words ---------- */

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'a', 'en', 'para', 'por', 'con', 'que', 'me', 'mi', 'mis', 'un', 'una',
  'lo', 'al', 'se', 'su', 'sus', 'es', 'como', 'the', 'of', 'and', 'to', 'for', 'in', 'introduccion', 'fundamentos', 'i', 'ii', 'iii']);
const words = (text) => keyOf(text).split('-').filter(Boolean);
// The course a phrase names: by its code, or by the words of its name.
export function findCourse(graph, text) {
  const ws = new Set(words(text).map((w) => looseKey(w)));
  const flat = keyOf(text).replace(/-/g, '');
  let best = null; let score = 0;
  for (const c of graph.courses ?? graph.nodes.filter((n) => n.type === 'course')) {
    if (c.code && flat.includes(keyOf(c.code).replace(/-/g, ''))) return c;
    const own = words(c.name).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => looseKey(w));
    if (!own.length) continue;
    const hit = own.filter((w) => ws.has(w)).length;
    const s = hit / own.length + hit * 0.25 + (c.planned ? 0 : 0.05);
    if (hit && s > score) { best = c; score = s; }
  }
  return best;
}
// Concepts named in a phrase: by a whole name or alias (the longest first), then by a word that only one or two
// concepts carry («Dijkstra» is «Algoritmo de Dijkstra»).
export function findConcepts(graph, text, max = 6) {
  const phrase = ` ${words(text).map((w) => looseKey(w)).join(' ')} `;
  const found = [];
  const names = [];
  const byWord = new Map();
  for (const n of concepts(graph)) {
    for (const name of [n.name, ...(n.aliases ?? [])]) {
      const k = looseKey(name).replace(/-/g, ' ');
      if (k.length >= 3) names.push([k, n]);
      for (const w of k.split(' ')) if (w.length >= 5 && !STOP.has(w)) { if (!byWord.has(w)) byWord.set(w, new Set()); byWord.get(w).add(n); }
    }
  }
  names.sort((a, b) => b[0].length - a[0].length);
  let rest = phrase;
  for (const [k, n] of names) {
    if (found.length >= max) break;
    if (rest.includes(` ${k} `) && !found.includes(n)) { found.push(n); rest = rest.replace(` ${k} `, ' '); }
  }
  for (const w of rest.trim().split(' ')) {
    if (found.length >= max) break;
    const owners = byWord.get(w);
    if (owners && owners.size <= 2) {
      const best = [...owners].sort((x, y) => y.weight - x.weight)[0];
      if (!found.includes(best)) found.push(best);
    }
  }
  return found;
}
export function findProfessor(graph, text) {
  const ws = new Set(words(text));
  const all = new Set((graph.courses ?? []).flatMap((c) => [...c.professors.keys()]));
  for (const p of all) {
    const own = words(p).filter((w) => w.length > 3);
    if (own.some((w) => ws.has(w))) return p;
  }
  return '';
}

// A simple reader of what a person asks, for when no AI is connected: routes («la ruta para rendir el Examen 2 de
// redes», «qué necesito para entender OSPF»), paths («de subredes a Dijkstra»), a course or concepts.
export function readAsk(graph, text) {
  const t = keyOf(text).replace(/-/g, ' ');
  const course = findCourse(graph, text);
  const stage = stageOf(text);
  const professor = findProfessor(graph, text);
  const term = termOf(text)?.code ?? '';
  // A concept whose whole name is inside the course's name («Base» in «Bases de Datos») is the course, not the concept.
  const courseWords = new Set(course ? words(course.name).map((w) => looseKey(w)) : []);
  const named = findConcepts(graph, text).filter((n) => !course || !words(n.name).every((w) => courseWords.has(looseKey(w)) || STOP.has(w)));
  const wantsRoute = /\b(ruta|camino|necesito|necesita|rendir|estudiar|preparar|prepararme|repasar|entra|entran|aprender|entender|saber|route|study|need)\b/.test(t);
  const between = /\b(entre|desde|from|de)\b.*\b(y|hasta|hacia|a|to|and)\b/.test(t);
  if (named.length >= 2 && between && !stage) return { action: 'path', from: named[0], to: named[1], say: `El camino de ${named[0].name} a ${named[1].name}.` };
  if (course && (stage || wantsRoute) && !(named.length && !stage && !/\b(materia|curso|todo)\b/.test(t))) {
    return { action: 'route', course, stage: stage && stage.kind !== 'chapter' && stage.kind !== 'class' ? stage : null, professor, term,
      say: `La ruta ${stage ? `hasta ${stage.label}` : 'completa'} de ${course.name}${professor ? `, con ${professor}` : ''}.` };
  }
  if (named.length && wantsRoute) return { action: 'route', to: named, say: `Todo lo que necesitas para ${named.map((n) => n.name).join(', ')}.` };
  if (named.length) return { action: 'concepts', concepts: named, say: named.length === 1 ? named[0].name : `${named.length} conceptos.` };
  if (course) return { action: 'course', course, say: course.name };
  return { action: 'none', say: 'No encontré eso en el mapa. Prueba con el nombre de una materia, un concepto o «la ruta para el Examen 2 de…».' };
}

// What the person's AI reads to answer a question about the map: every course with its code, professors, terms and
// evaluations, and its concepts (the most asked first), within a size that a light model reads quickly.
export function mapIndex(graph, max = 24_000) {
  const lines = [];
  for (const c of [...(graph.courses ?? [])].sort((a, b) => b.degree - a.degree)) {
    const own = concepts(graph).filter((n) => n.courses.has(c.id)).sort((a, b) => b.weight - a.weight);
    lines.push(`## ${c.name}${c.code ? ` (${c.code})` : ''}`);
    if (c.professors.size) lines.push(`Profesores: ${[...c.professors].map(([p, t]) => `${p}${t.size ? ` (${[...t].join(', ')})` : ''}`).join('; ')}`);
    const placed = (c.stageList ?? []).filter((s) => s.order != null);
    if (placed.length) lines.push(`Evaluaciones: ${placed.map((s) => s.label).join(', ')}`);
    lines.push(`Conceptos: ${own.slice(0, 160).map((n) => n.name).join('; ')}`, '');
  }
  return lines.join('\n').slice(0, max);
}
export function askInstructions() {
  return `Eres el buscador del mapa de conocimiento de Studium. Te doy el índice del mapa (materias, profesores, evaluaciones y conceptos) y una pregunta de un estudiante. Responde solo con un objeto JSON, sin texto antes ni después:

{"action": "route" | "concepts" | "path" | "course" | "none", "course": "", "stage": "", "professor": "", "term": "", "concepts": [], "from": "", "to": "", "say": ""}

- "route": la ruta para rendir una evaluación de una materia (course y stage, como "Examen 2"; professor y term si los dice), o para entender unos conceptos (concepts).
- "concepts": mostrar unos conceptos.
- "path": el camino entre dos conceptos (from y to).
- "course": mostrar una materia.
- "none": si el mapa no tiene lo que pide; en "say" explica en una frase qué sí hay.
- Escribe los nombres de materias y conceptos exactamente como aparecen en el índice. Si pide algo que el índice no nombra así, elige los conceptos del índice que lo cubren (hasta 20).
- "say": una frase corta, en el idioma de la pregunta, que diga qué le muestras.`;
}
// The AI's answer, made into the same shape readAsk() returns. Names that are not in the map are dropped.
export function readAskAnswer(graph, text) {
  const raw = String(text ?? '');
  let obj;
  try { obj = JSON.parse(raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  const byKey = new Map();
  for (const n of concepts(graph)) { byKey.set(looseKey(n.name), n); for (const a of n.aliases ?? []) if (!byKey.has(looseKey(a))) byKey.set(looseKey(a), n); }
  const concept = (name) => byKey.get(looseKey(name)) ?? findConcepts(graph, name, 1)[0] ?? null;
  const course = obj.course ? findCourse(graph, obj.course) : null;
  const named = (Array.isArray(obj.concepts) ? obj.concepts : []).map(concept).filter(Boolean);
  const say = String(obj.say ?? '').slice(0, 240);
  if (obj.action === 'route' && course) return { action: 'route', course, stage: obj.stage ? stageOf(obj.stage) : null, professor: String(obj.professor ?? ''), term: String(obj.term ?? ''), say };
  if (obj.action === 'route' && named.length) return { action: 'route', to: named, say };
  if (obj.action === 'path' && concept(obj.from) && concept(obj.to)) return { action: 'path', from: concept(obj.from), to: concept(obj.to), say };
  if (obj.action === 'concepts' && named.length) return { action: 'concepts', concepts: named, say };
  if (obj.action === 'course' && course) return { action: 'course', course, say };
  return { action: 'none', say: say || 'Tu IA no encontró eso en el mapa.' };
}
