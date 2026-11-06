// The knowledge map. buildGraph() joins every guide, contribution and shared document the account can see into one
// graph of careers, courses, concepts, guides, materials and documents, read by the standard of standard.js: concepts
// by name, alias and regardless of plurals; courses by code and name; each item placed on its course's timeline (the
// evaluation it belongs to). GraphView draws it on a canvas, for thousands of nodes: Barnes-Hut forces, a layout that
// settles across frames, culling, level of detail and labels placed on a grid. What is shown, dimmed, tinted or laid
// out differently comes from the map's controls (mapui.js) through setState().
import { keyOf, themeOf, courseThemes, guessTheme } from './themes.js';
import { looseKey, conceptName, stageOf, termKey, codeKey, sameProfessor } from './standard.js';

/* ---------- union-find, to join names that mean the same ---------- */
class Sets {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) { this.parent.set(x, x); return x; }
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) { const next = this.parent.get(x); this.parent.set(x, root); x = next; }
    return root;
  }
  union(a, b) { const x = this.find(a); const y = this.find(b); if (x !== y) this.parent.set(y, x); }
}
const top = (counts) => [...counts].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]?.[0];
const add = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

const DAY = 86_400_000;
export const NODE_TYPES = ['career', 'course', 'concept', 'guide', 'material', 'document'];

export function buildGraph({ catalog = [], contributions = [], library = [], now = Date.now() }) {
  const lessons = contributions.filter((c) => c.kind !== 'curriculum').sort((a, b) => (a.updated || 0) - (b.updated || 0));
  const plans = contributions.filter((c) => c.kind === 'curriculum');
  const curriculumCourses = plans.flatMap((p) => p.data.curriculum?.semesters.flatMap((s) => s.courses) ?? []);
  const themes = courseThemes([...catalog, ...lessons]);

  // Courses: one per code, and one per name (regardless of accents and plurals) when there is no code.
  const courseSets = new Sets();
  const courseNames = new Map();
  const seeCourse = (name, code, weight = 1) => {
    const n = looseKey(name);
    if (!n) return;
    courseSets.find(`n:${n}`);
    if (codeKey(code)) courseSets.union(`n:${n}`, `c:${codeKey(code)}`);
    const set = courseNames.get(`n:${n}`) ?? new Map();
    add(set, String(name).trim(), weight);
    courseNames.set(`n:${n}`, set);
  };
  for (const x of [...lessons, ...catalog]) seeCourse(x.course, x.code, 3);
  for (const c of curriculumCourses) seeCourse(c.name, c.code, 1);
  for (const d of library) seeCourse(d.course, d.code, 1);
  const courseName = new Map(); // set root -> display name
  for (const [token, names] of courseNames) {
    const root = courseSets.find(token);
    const all = courseName.get(root) ?? new Map();
    for (const [name, count] of names) add(all, name, count);
    courseName.set(root, all);
  }
  const courseKeyOf = (name, code) => {
    const n = looseKey(name);
    if (!n && !codeKey(code)) return '';
    const root = courseSets.find(n ? `n:${n}` : `c:${codeKey(code)}`);
    return keyOf(top(courseName.get(root) ?? new Map([[name, 1]])) ?? name);
  };

  // Concepts: one per name, joined with their aliases. A short alias («IP», «AVL») joins only when a single concept
  // claims it, so two different things that share an abbreviation stay apart.
  const conceptSets = new Sets();
  const conceptNames = new Map(); // loose key -> Map(display name -> weight)
  const claims = new Map(); // alias key -> Set(name keys)
  const seeConcept = (raw, aka = [], weight = 1) => {
    const { name, aliases } = conceptName(raw, aka);
    const k = looseKey(name);
    if (!k) return;
    conceptSets.find(k);
    const names = conceptNames.get(k) ?? new Map();
    add(names, name, weight);
    conceptNames.set(k, names);
    for (const a of aliases) {
      const ak = looseKey(a);
      if (!ak || ak === k) continue;
      const set = claims.get(ak) ?? new Set();
      set.add(k);
      claims.set(ak, set);
    }
  };
  for (const item of lessons) {
    const d = item.data ?? {};
    for (const c of d.concepts ?? []) { seeConcept(c.name, c.aka, 3); for (const r of c.related ?? []) seeConcept(r.to); }
    for (const q of d.questions ?? []) for (const n of Array.isArray(q.concepts) ? q.concepts : []) seeConcept(n);
    for (const e of d.examples ?? []) for (const n of Array.isArray(e.concepts) ? e.concepts : []) seeConcept(n);
    for (const u of d.plan?.units ?? []) for (const n of u.concepts ?? []) seeConcept(n);
  }
  for (const g of catalog) for (const n of g.concepts?.length ? g.concepts : g.topics ?? []) seeConcept(n, [], 2);
  // An alias joins two concepts only when one concept claims it and some material uses it as a name («BFS» as a
  // concept, and «Búsqueda en anchura», also called «BFS»). An alias that two concepts claim is ambiguous («Gateway» is
  // the default gateway and also a protocol gateway) and joins nothing.
  for (const [ak, owners] of claims) {
    if (owners.size !== 1 || !conceptNames.has(ak)) continue;
    conceptSets.union([...owners][0], ak);
  }
  const conceptRootName = new Map();
  for (const [k, names] of conceptNames) {
    const root = conceptSets.find(k);
    const all = conceptRootName.get(root) ?? new Map();
    for (const [name, count] of names) add(all, name, count);
    conceptRootName.set(root, all);
  }
  const conceptKeyOf = (raw) => {
    const k = looseKey(conceptName(raw).name);
    if (!k) return '';
    const root = conceptSets.find(k);
    return looseKey(top(conceptRootName.get(root) ?? new Map()) ?? raw) || k;
  };

  // Professors, per course: the names that are one person («Ricardo Flores», «Flores Moyano», «Ricardo Flores Moyano»)
  // take the longest. Codes, per course: the most used spelling.
  const profSeen = new Map(); // course key -> Set(names)
  const codeSeen = new Map(); // course key -> Map(code -> count)
  for (const x of [...lessons, ...catalog, ...library]) {
    const key = courseKeyOf(x.course, x.code);
    if (!key) continue;
    const name = String(x.professor ?? '').replace(/\s+/g, ' ').trim();
    if (name) { if (!profSeen.has(key)) profSeen.set(key, new Set()); profSeen.get(key).add(name); }
    if (x.code) { if (!codeSeen.has(key)) codeSeen.set(key, new Map()); add(codeSeen.get(key), String(x.code).trim()); }
  }
  const profCanon = new Map(); // `${course key}|${name}` -> canonical name
  for (const [key, names] of profSeen) {
    const sets = new Sets();
    const list = [...names];
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) if (sameProfessor(list[i], list[j])) sets.union(list[i], list[j]);
    const groups = new Map();
    for (const n of list) { const r = sets.find(n); groups.set(r, [...(groups.get(r) ?? []), n]); }
    for (const group of groups.values()) {
      const canonical = [...group].sort((a, b) => b.length - a.length)[0];
      for (const n of group) profCanon.set(`${key}|${n}`, canonical);
    }
  }
  const bestCode = (key) => [...(codeSeen.get(key) ?? new Map())].sort((a, b) => b[1] - a[1] || (b[0].includes('-') ? 1 : 0) - (a[0].includes('-') ? 1 : 0))[0]?.[0] ?? '';

  const nodes = new Map();
  const links = new Map();
  const link = (a, b, kind, extra = {}) => {
    if (!a || !b || a === b) return null;
    const id = `${a.id}>${b.id}>${kind}`;
    if (!links.has(id)) links.set(id, { id, source: a, target: b, kind, ...extra });
    return links.get(id);
  };
  const born = (n, t) => { if (t && t < n.born) n.born = t; };

  const course = (name, code) => {
    const key = courseKeyOf(name, code);
    if (!key) return null;
    const id = `course:${key}`;
    if (!nodes.has(id)) {
      const root = courseSets.find(looseKey(name) ? `n:${looseKey(name)}` : `c:${codeKey(code)}`);
      const display = top(courseName.get(root) ?? new Map([[name, 1]])) ?? name;
      nodes.set(id, {
        id, type: 'course', key, name: display, code: bestCode(key) || code || '', theme: themes.get(keyOf(display)) ?? themes.get(keyOf(name)) ?? guessTheme(display),
        guides: [], contributions: [], documents: [], professors: new Map(), terms: new Set(), careers: [],
        stages: new Map(), sources: new Set(), mine: false, born: Infinity,
      });
    }
    const n = nodes.get(id);
    if (code && !n.code) n.code = code;
    return n;
  };
  // The professor as this course knows them: «Ricardo Flores» and «Ricardo Flores Moyano» are one person.
  const professorOf = (c, raw) => {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return '';
    const canonical = profCanon.get(`${c.key}|${name}`) ?? name;
    if (!c.professors.has(canonical)) c.professors.set(canonical, new Set());
    return canonical;
  };
  const concept = (raw) => {
    const key = conceptKeyOf(raw);
    if (!key) return null;
    const id = `concept:${key}`;
    if (!nodes.has(id)) {
      const names = conceptRootName.get(conceptSets.find(looseKey(conceptName(raw).name))) ?? new Map([[raw, 1]]);
      nodes.set(id, {
        id, type: 'concept', key, name: top(names) ?? raw, aliases: new Set(), summaries: [], courses: new Set(), questions: [],
        examples: [], guides: [], relations: [], units: new Set(), items: new Set(), sources: new Set(), professors: new Set(),
        terms: new Set(), stageBy: new Map(), weight: 0, ghost: true, mine: false, recent: false, born: Infinity,
      });
    }
    return nodes.get(id);
  };
  // A concept's place on a course's timeline: the earliest evaluation it appears in.
  const place = (n, c, stage) => {
    if (stage?.order == null) return;
    const prior = n.stageBy.get(c.id);
    if (prior == null || stage.order < prior) n.stageBy.set(c.id, stage.order);
  };
  const stageEntry = (c, stage) => {
    if (!stage) return null;
    const key = `${stage.kind}:${stage.n ?? ''}`;
    if (!c.stages.has(key)) c.stages.set(key, { key, ...stage, items: [], concepts: new Set() });
    return c.stages.get(key);
  };
  const inCourse = (c, n, when) => { n.courses.add(c.id); link(c, n, 'in'); born(n, when); };

  for (const item of lessons) {
    const c = course(item.course, item.code);
    if (!c) continue;
    const d = item.data ?? {};
    const professor = professorOf(c, item.professor);
    const term = item.term ? termKey(item.term) : '';
    const stage = item.kind === 'contest' ? null : stageOf(item.stage || item.title);
    const recent = item.updated && now - item.updated < 30 * DAY;
    c.contributions.push(item);
    born(c, item.updated);
    if (professor) { const terms = c.professors.get(professor); if (item.term) terms.add(item.term); }
    if (item.term) c.terms.add(item.term);
    if (item.source) c.sources.add(item.source);
    if (item.mine) c.mine = true;
    const entry = stageEntry(c, stage);
    entry?.items.push(item);
    const m = { id: `material:${item.id}`, type: 'material', item, name: item.title, course: c, stage, born: item.updated || Infinity, optional: true };
    nodes.set(m.id, m);
    link(c, m, 'has');
    const where = { course: c.name, courseId: c.id, professor, term: item.term ?? '', title: item.title, material: item.kind, source: item.source ?? '', item: item.id, stage: stage?.label ?? '' };
    const touch = (n) => {
      n.items.add(item.id);
      if (item.source) n.sources.add(item.source);
      if (professor) n.professors.add(professor);
      if (term) n.terms.add(term);
      if (item.mine) n.mine = true;
      if (recent) n.recent = true;
      if (!n.courses.has(c.id)) inCourse(c, n, item.updated);
      link(m, n, 'teaches');
    };
    for (const con of d.concepts ?? []) {
      const n = concept(con.name);
      if (!n) continue;
      n.ghost = false;
      n.weight += 1;
      touch(n);
      for (const a of con.aka ?? []) n.aliases.add(a);
      if (con.unit) n.units.add(con.unit);
      place(n, c, stage);
      entry?.concepts.add(n.id);
      if (con.summary && !n.summaries.some((s) => s.text === con.summary)) n.summaries.push({ text: con.summary, ...where });
      for (const r of con.related ?? []) {
        const other = concept(r.to);
        if (!other || other === n) continue;
        link(n, other, 'relation', { relation: r.kind });
        // Material that refers to a concept uses it: the concept joins the course, and bridges courses that share it.
        if (!other.courses.has(c.id)) inCourse(c, other, item.updated);
        n.relations.push({ kind: r.kind, key: other.key, name: r.to, out: true });
        other.relations.push({ kind: r.kind, key: n.key, name: con.name, out: false });
      }
    }
    for (const q of d.questions ?? []) {
      const qs = q.stage ? stageOf(q.stage) : stage;
      const qEntry = q.stage ? stageEntry(c, qs) : entry;
      for (const name of Array.isArray(q.concepts) ? q.concepts : []) {
        const n = concept(name);
        if (!n) continue;
        n.questions.push({ ...q, ...where, stage: qs?.label ?? where.stage });
        n.weight += 1;
        touch(n);
        place(n, c, qs);
        qEntry?.concepts.add(n.id);
      }
    }
    for (const e of d.examples ?? []) {
      for (const name of Array.isArray(e.concepts) ? e.concepts : []) {
        const n = concept(name);
        if (n) { n.examples.push({ ...e, ...where }); touch(n); }
      }
    }
    // A syllabus says which evaluation covers each unit: that places its concepts on the timeline.
    for (const u of d.plan?.units ?? []) {
      const us = stageOf(u.stage);
      const uEntry = stageEntry(c, us);
      for (const name of u.concepts ?? []) {
        const n = concept(name);
        if (!n) continue;
        n.ghost = false;
        touch(n);
        n.units.add(u.name);
        place(n, c, us);
        uEntry?.concepts.add(n.id);
      }
    }
    for (const a of d.plan?.assessments ?? []) {
      const e2 = stageEntry(c, stageOf(a.name));
      if (e2) { e2.week = a.week; e2.weight = a.weight; }
    }
  }

  for (const entry of catalog) {
    const c = course(entry.course, entry.code);
    if (!c) continue;
    const when = entry.date ? Date.parse(`${entry.date}T12:00:00`) : entry.updated;
    const stage = stageOf(entry.title);
    c.guides.push(entry);
    const professor = professorOf(c, entry.professor);
    if (professor && entry.term) c.professors.get(professor).add(entry.term);
    if (entry.term) c.terms.add(entry.term);
    if (entry.mine) c.mine = true;
    born(c, when);
    const sEntry = stageEntry(c, stage);
    sEntry?.items.push(entry);
    const g = { id: `guide:${entry.id}`, type: 'guide', entry, name: entry.title, course: c, stage, mine: !!entry.mine, born: when || Infinity };
    nodes.set(g.id, g);
    link(c, g, 'has');
    const named = entry.concepts?.length ? entry.concepts : entry.topics ?? [];
    named.forEach((name, i) => {
      const n = concept(name);
      if (!n) return;
      n.ghost = false;
      n.weight += 1;
      n.guides.push({ id: entry.id, anchor: entry.anchors?.[i] ?? '', title: entry.title, course: c.name });
      if (entry.mine) n.mine = true;
      if (professor) n.professors.add(professor);
      if (entry.term) n.terms.add(termKey(entry.term));
      n.courses.add(c.id);
      link(g, n, 'covers');
      place(n, c, stage);
      sEntry?.concepts.add(n.id);
      born(n, when);
    });
  }

  for (const d of library) {
    const c = course(d.course, d.code);
    if (!c) continue;
    c.documents.push(d);
    const n = { id: `document:${d.id}`, type: 'document', doc: d, name: d.title, course: c, born: d.updated || Infinity, optional: true };
    nodes.set(n.id, n);
    link(c, n, 'has');
  }

  for (const plan of plans) {
    const key = keyOf(plan.course);
    if (!key) continue;
    const id = `career:${key}`;
    if (!nodes.has(id)) nodes.set(id, { id, type: 'career', key, name: plan.course, university: plan.university ?? '', semesters: [], born: plan.updated || Infinity });
    const career = nodes.get(id);
    for (const sem of plan.data.curriculum?.semesters ?? []) {
      for (const co of sem.courses) {
        const c = course(co.name, co.code);
        if (!c) continue;
        if (!c.careers.some((x) => x.career === career.id)) c.careers.push({ career: career.id, semester: sem.number, elective: !!co.elective });
        (career.semesters[sem.number] ??= []).push(c.id);
        link(career, c, 'plan', { semester: sem.number });
        born(c, plan.updated);
        for (const pre of co.prerequisites) link(course(pre, ''), c, 'prerequisite');
      }
    }
  }

  const all = [...nodes.values()];
  const list = [...links.values()];
  for (const n of all) n.degree = 0;
  for (const l of list) { l.source.degree += 1; l.target.degree += 1; }
  for (const n of all) {
    const home = n.type === 'course' ? n : n.course ?? nodes.get([...(n.courses ?? [])][0] ?? '');
    const theme = themeOf(home?.theme);
    n.home = home?.id ?? '';
    n.color = n.type === 'guide' ? theme.b : n.type === 'career' ? '#f1f4fb' : n.type === 'material' || n.type === 'document' ? theme.b : theme.a;
    if (n.type === 'concept') {
      n.bridge = n.courses.size > 1;
      const ds = n.questions.map((q) => q.difficulty).filter(Boolean);
      n.difficulty = ds.length ? ds.reduce((s, x) => s + x, 0) / ds.length : 0;
    }
    if (n.type === 'course') n.planned = !n.contributions.length && !n.guides.length;
    n.r = n.type === 'career' ? 20 : n.type === 'course' ? 13 + Math.min(14, Math.sqrt(n.degree) * 1.6)
      : n.type === 'guide' ? 8 : n.type === 'material' || n.type === 'document' ? 6 : 3.2 + Math.min(9, Math.sqrt(n.weight) * 1.5);
    if (n.born === Infinity) n.born = 0;
  }
  const courses = all.filter((n) => n.type === 'course');
  for (const c of courses) c.stageList = [...c.stages.values()].sort((a, b) => (a.order ?? 1e6) - (b.order ?? 1e6) || (a.n ?? 0) - (b.n ?? 0) || a.label.localeCompare(b.label, 'es'));
  return { nodes: all, links: list, byId: nodes, courses };
}

// Courses that come after a course in a career, with the concepts they share with it.
export function upcoming(graph, courseNode) {
  const after = new Map();
  for (const l of graph.links) {
    if (l.kind === 'prerequisite' && l.source === courseNode) after.set(l.target.id, { course: l.target, why: 'prerequisite' });
  }
  for (const { career, semester } of courseNode.careers) {
    const plan = graph.byId.get(career);
    for (const id of plan?.semesters[semester + 1] ?? []) if (!after.has(id)) after.set(id, { course: graph.byId.get(id), why: 'next' });
  }
  const mine = new Set(graph.links.filter((l) => l.kind === 'in' && l.source === courseNode).map((l) => l.target));
  return [...after.values()].map((x) => ({
    ...x,
    shared: graph.links.filter((l) => l.kind === 'in' && l.source === x.course && mine.has(l.target)).map((l) => l.target),
  }));
}

/* ---------- forces ---------- */

const CHARGE = { concept: -40, guide: -140, material: -70, document: -70, course: -480, career: -900 };
const SPRING = {
  in: { distance: 60, strength: 0.4 }, covers: { distance: 50, strength: 0.22 }, relation: { distance: 42, strength: 0.5 },
  has: { distance: 52, strength: 0.5 }, teaches: { distance: 46, strength: 0.08 }, plan: { distance: 180, strength: 0.03 },
  prerequisite: { distance: 170, strength: 0.06 },
};
const THETA2 = 0.81; // Barnes-Hut's opening angle, squared

// A quadtree over the active nodes, with each cell's charge and centre of charge.
function buildTree(nodes) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const n of nodes) { if (n.x < x0) x0 = n.x; if (n.y < y0) y0 = n.y; if (n.x > x1) x1 = n.x; if (n.y > y1) y1 = n.y; }
  const size = Math.max(x1 - x0, y1 - y0, 1) + 1;
  const root = { x: x0, y: y0, s: size, q: 0, cx: 0, cy: 0, kids: null, node: null };
  const insert = (cell, n, depth) => {
    for (;;) {
      if (!cell.kids && !cell.node) { cell.node = n; return; }
      if (!cell.kids) {
        if (depth > 40) { (cell.extra ??= []).push(n); return; }
        const old = cell.node; cell.node = null; cell.kids = [null, null, null, null];
        insert(cell, old, depth);
      }
      const h = cell.s / 2;
      const i = (n.x >= cell.x + h ? 1 : 0) + (n.y >= cell.y + h ? 2 : 0);
      cell.kids[i] ??= { x: cell.x + (i & 1 ? h : 0), y: cell.y + (i & 2 ? h : 0), s: h, q: 0, cx: 0, cy: 0, kids: null, node: null };
      cell = cell.kids[i]; depth += 1;
    }
  };
  for (const n of nodes) insert(root, n, 0);
  const sum = (cell) => {
    let q = 0; let cx = 0; let cy = 0;
    if (cell.node) { const c = CHARGE[cell.node.type] ?? -60; q += c; cx += cell.node.x * c; cy += cell.node.y * c; }
    for (const e of cell.extra ?? []) { const c = CHARGE[e.type] ?? -60; q += c; cx += e.x * c; cy += e.y * c; }
    if (cell.kids) for (const k of cell.kids) if (k) { sum(k); q += k.q; cx += k.cx * k.q; cy += k.cy * k.q; }
    cell.q = q; cell.cx = q ? cx / q : cell.x + cell.s / 2; cell.cy = q ? cy / q : cell.y + cell.s / 2;
  };
  sum(root);
  return root;
}
// Concepts only push what is near them (their island and its neighbours); courses and careers push farther, which
// keeps the islands apart without flinging every concept outward as the map grows.
const REACH = { concept: 90000, guide: 160000, material: 90000, document: 90000, course: 640000, career: 640000 };
function repel(cell, n, a) {
  const dx = cell.cx - n.x; const dy = cell.cy - n.y;
  let d2 = dx * dx + dy * dy;
  if (cell.kids && (cell.s * cell.s) / Math.max(d2, 1) > THETA2) { for (const k of cell.kids) if (k) repel(k, n, a); return; }
  if (cell.node === n && !cell.extra) return;
  if (d2 > (REACH[n.type] ?? 640000)) return;
  if (d2 < 1) d2 = 1;
  let q = cell.q;
  if (cell.node === n) q -= CHARGE[n.type] ?? -60;
  n.vx += (dx * q * a) / d2;
  n.vy += (dy * q * a) / d2;
}

/* ---------- drawing ---------- */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const FONT_BIG = '750 14px "Bricolage Grotesque", system-ui, sans-serif';
const FONT = '600 12px "Atkinson Hyperlegible Next", system-ui, sans-serif';

export class GraphView {
  constructor(canvas, { onSelect, onOpen, onHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect ?? (() => {});
    this.onOpen = onOpen ?? (() => {});
    this.onHover = onHover ?? (() => {});
    this.view = { x: 0, y: 0, k: 0.8 };
    this.alpha = 0;
    this.hover = null;
    this.primary = null;
    this.selection = new Set();
    this.focus = 0;
    this.grow = 1;
    this.state = {};
    this.pins = null;
    this.guides = [];
    this.pointers = new Map();
    this.frame = 0;
    this.colors();
    this.listen();
    this.resize();
    // The canvas has no size while its view is hidden: the first fit waits for one.
    new ResizeObserver(() => {
      this.resize();
      if (this.pendingFit && this.w > 50) { this.pendingFit = false; this.fit(null, false); }
      this.wake();
    }).observe(canvas);
    new MutationObserver(() => { this.colors(); this.wake(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.colors(); this.wake(); });
  }

  colors() {
    const css = getComputedStyle(document.documentElement);
    this.ink = css.getPropertyValue('--ink').trim() || '#f1f4fb';
    this.muted = css.getPropertyValue('--muted').trim() || '#8b95ad';
    this.halo = css.getPropertyValue('--bg').trim() || '#0a0e1a';
    this.dark = css.getPropertyValue('color-scheme').trim() !== 'light';
  }

  /* ----- the graph and what the controls say about it ----- */
  setGraph(graph, { animate = true } = {}) {
    const old = new Map((this.graph?.nodes ?? []).map((n) => [n.id, n]));
    this.graph = graph;
    this.homes();
    for (const n of graph.nodes) {
      const prior = old.get(n.id);
      if (prior) { n.x = prior.x; n.y = prior.y; } else this.seed(n);
      n.vx = 0; n.vy = 0;
    }
    const order = [...graph.nodes].sort((a, b) => a.born - b.born);
    order.forEach((n, i) => { n.order = order.length > 1 ? i / (order.length - 1) : 0; });
    this.adjacent = new Map(graph.nodes.map((n) => [n, new Set()]));
    for (const l of graph.links) { this.adjacent.get(l.source).add(l.target); this.adjacent.get(l.target).add(l.source); }
    this.selection = new Set([...this.selection].map((n) => graph.byId.get(n.id)).filter(Boolean));
    this.primary = this.primary ? graph.byId.get(this.primary.id) ?? null : null;
    this.hover = null;
    this.apply();
    this.alpha = old.size ? 0.5 : 1;
    // A first stretch of settling before the first frame, so the map opens already shaped; the rest settles live.
    const t0 = performance.now();
    while (this.alpha > 0.02 && performance.now() - t0 < 120) this.step();
    this.resize();
    if (this.w > 50) this.fit(null, false); else this.pendingFit = true;
    if (animate && !reduced() && !old.size) this.playGrowth(1800);
    this.wake();
  }
  // Each course's home: the courses of a subject area side by side, the areas around a circle.
  // Each subject area is a sector of a circle; inside it, each course is an island on a sunflower spiral, as large as
  // its concepts need, so islands neither overlap nor drift into the middle as the map grows.
  homes() {
    const courses = this.graph.nodes.filter((n) => n.type === 'course');
    const count = new Map();
    for (const n of this.graph.nodes) if (n.type === 'concept' && n.home) count.set(n.home, (count.get(n.home) ?? 0) + 1);
    const size = (c) => 34 + 12 * Math.sqrt(count.get(c.id) ?? 0);
    const spacing = 2 * (courses.reduce((t, c) => t + size(c), 0) / Math.max(1, courses.length)) + 60;
    const byTheme = new Map();
    for (const c of courses) byTheme.set(c.theme, [...(byTheme.get(c.theme) ?? []), c]);
    const groups = [...byTheme.values()].sort((a, b) => b.length - a.length).map((list) => {
      list.sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'es'));
      return { list, radius: list.length === 1 ? size(list[0]) : spacing * 0.62 * Math.sqrt(list.length) + spacing * 0.4 };
    });
    const total = groups.reduce((t, g) => t + 2.3 * g.radius, 0);
    const R = groups.length === 1 ? 0 : Math.max(groups[0].radius * 1.3, total / (2 * Math.PI));
    let cursor = 0;
    for (const g of groups) {
      const angle = groups.length === 1 ? 0 : ((cursor + 1.15 * g.radius) / total) * Math.PI * 2;
      cursor += 2.3 * g.radius;
      const cx = Math.cos(angle) * R; const cy = Math.sin(angle) * R;
      g.list.forEach((c, i) => {
        const r = g.list.length === 1 ? 0 : spacing * 0.62 * Math.sqrt(i + 0.5);
        const t = i * 2.39996 + angle;
        c.anchor = { x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r };
      });
    }
  }
  // A new node starts near its course, on a sunflower spiral, so the map is already readable before it settles.
  seed(n) {
    const home = n.type === 'course' ? n : this.graph.byId.get(n.home);
    const base = n.type === 'course' ? n.anchor : home?.anchor ?? { x: 0, y: 0 };
    if (n.type === 'course' || n.type === 'career' || !home) { n.x = base.x + (Math.random() - 0.5) * 40; n.y = base.y + (Math.random() - 0.5) * 40; return; }
    home.seeded = (home.seeded ?? 0) + 1;
    const i = home.seeded;
    const r = 22 + 11 * Math.sqrt(i);
    const t = i * 2.39996;
    n.x = base.x + Math.cos(t) * r; n.y = base.y + Math.sin(t) * r;
  }

  // state, from the map's controls (every key optional):
  //   hide(n) -> true when the node is out; dim(n) -> 0..1, how far it fades; tint(n) -> a colour, or null;
  //   size(n) -> a factor on its radius; mark(n) -> true for a ring of emphasis; showTypes: the optional types shown
  //   (material, document); labels: 'auto' or 'more'.
  setState(state) {
    this.state = { ...this.state, ...state };
    if (!this.graph) return;
    this.apply();
    this.alpha = Math.max(this.alpha, 0.25);
    this.wake();
  }
  apply() {
    const s = this.state;
    const types = s.showTypes ?? new Set();
    for (const n of this.graph.nodes) {
      n.hidden = (n.optional && !types.has(n.type)) || !!s.hide?.(n);
      n.dim = n.hidden ? 1 : s.dim?.(n) ?? 0;
      n.tint = s.tint?.(n) ?? null;
      n.scale = s.size?.(n) ?? 1;
      n.mark = !!s.mark?.(n);
    }
    this.active = this.graph.nodes.filter((n) => !n.hidden);
    this.activeLinks = this.graph.links.filter((l) => !l.source.hidden && !l.target.hidden);
    for (const n of this.selection) if (n.hidden) this.selection.delete(n);
    if (this.primary?.hidden) this.primary = null;
  }
  // Fixed places for some nodes (a route, a timeline): id -> { x, y }. columns: labelled bands, rows: labelled lines.
  setPins(pins, { columns = [], rows = [] } = {}) {
    const next = pins && pins.size ? pins : null;
    const changed = next !== this.pins && (next || this.pins);
    this.pins = next;
    this.guides = [...columns.map((c) => ({ ...c, axis: 'x' })), ...rows.map((r) => ({ ...r, axis: 'y' }))];
    if (changed) this.alpha = 1;
    this.wake();
  }

  step() {
    const nodes = this.active;
    const a = this.alpha;
    if (!nodes?.length) { this.alpha = 0; return; }
    const pins = this.pins;
    for (const l of this.activeLinks) {
      if (pins && (pins.has(l.source.id) || pins.has(l.target.id))) continue;
      const s = l.source; const t = l.target; const spring = SPRING[l.kind] ?? SPRING.in;
      let dx = t.x + t.vx - s.x - s.vx; let dy = t.y + t.vy - s.y - s.vy;
      const d = Math.hypot(dx, dy) || 1;
      const k = ((d - spring.distance - s.r - t.r) / d) * a * spring.strength;
      dx *= k; dy *= k;
      const b = s.degree / (s.degree + t.degree);
      t.vx -= dx * b; t.vy -= dy * b; s.vx += dx * (1 - b); s.vy += dy * (1 - b);
    }
    const tree = buildTree(nodes);
    for (const n of nodes) if (!pins?.has(n.id)) repel(tree, n, a);
    for (const n of nodes) {
      // A node with a fixed place (a route, a timeline) glides to it and stays.
      const pin = pins?.get(n.id);
      if (pin && n.fx == null) { n.x += (pin.x - n.x) * 0.22; n.y += (pin.y - n.y) * 0.22; n.vx = 0; n.vy = 0; continue; }
      // Courses hold their place; concepts stay near their course, so the map reads as islands.
      if (n.type === 'course' && n.anchor && !pins) { n.vx += (n.anchor.x - n.x) * 0.06 * a; n.vy += (n.anchor.y - n.y) * 0.06 * a; }
      else if (n.home && !pins) {
        const home = this.graph.byId.get(n.home);
        if (home && !home.hidden) { n.vx += (home.x - n.x) * 0.03 * a; n.vy += (home.y - n.y) * 0.03 * a; }
      } else { n.vx -= n.x * 0.0015 * a; n.vy -= n.y * 0.0015 * a; }
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.55; n.vy *= 0.55;
      n.x += n.vx; n.y += n.vy;
    }
    this.alpha *= 0.985;
    if (this.alpha < 0.004) this.alpha = 0;
  }

  /* ----- camera ----- */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }
  toWorld(sx, sy) { return { x: (sx - this.w / 2 - this.view.x) / this.view.k, y: (sy - this.h / 2 - this.view.y) / this.view.k }; }
  toScreen(n) { return { x: n.x * this.view.k + this.w / 2 + this.view.x, y: n.y * this.view.k + this.h / 2 + this.view.y }; }
  moveTo(target, ms = 650) {
    if (reduced() || !ms) { this.view = target; this.wake(); return; }
    const from = { ...this.view }; const start = performance.now();
    this.camera = (now) => {
      const t = Math.min(1, (now - start) / ms); const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      this.view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
      if (t === 1) this.camera = null;
    };
    this.wake();
  }
  // Fits the given nodes (or every shown node) in the free part of the screen (insets: the panels over the canvas).
  fit(nodes = null, animate = true) {
    const shown = (nodes ?? this.active ?? []).filter((n) => !n.hidden);
    if (!shown.length) return;
    const pins = this.pins;
    const pos = (n) => pins?.get(n.id) ?? n;
    const xs = shown.map((n) => pos(n).x); const ys = shown.map((n) => pos(n).y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const inset = this.insets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const w = Math.max(120, this.w - inset.left - inset.right); const h = Math.max(120, this.h - inset.top - inset.bottom);
    // Room for the labels at the edges: in screen pixels, so it holds at any zoom.
    const k = Math.max(0.08, Math.min(1.6, Math.min((w - 220) / Math.max(1, x1 - x0), (h - 120) / Math.max(1, y1 - y0))));
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const target = { x: -cx * k + (inset.left - inset.right) / 2, y: -cy * k + (inset.top - inset.bottom) / 2, k };
    if (animate) this.moveTo(target); else this.view = target;
  }
  zoomBy(f, sx = this.w / 2, sy = this.h / 2) {
    const k = Math.max(0.06, Math.min(5, this.view.k * f));
    const p = this.toWorld(sx, sy);
    this.view = { k, x: sx - this.w / 2 - p.x * k, y: sy - this.h / 2 - p.y * k };
    this.wake();
  }
  show(node) {
    if (!node) return;
    const k = Math.max(this.view.k, 1.3);
    this.moveTo({ x: -node.x * k, y: -node.y * k, k });
  }
  // Selecting: one node (the panel shows it), or several (add: toggles one into the selection).
  select(node, { fly = false, add = false } = {}) {
    if (add && node) {
      if (this.selection.has(node)) { this.selection.delete(node); if (this.primary === node) this.primary = [...this.selection].at(-1) ?? null; }
      else { this.selection.add(node); this.primary = node; }
    } else {
      this.selection = node ? new Set([node]) : new Set();
      this.primary = node;
    }
    if (fly && node) this.show(node);
    this.onSelect(this.primary, this.selection);
    this.wake();
  }
  selectMany(nodes, { add = false } = {}) {
    if (!add) this.selection = new Set();
    for (const n of nodes) if (!n.hidden) this.selection.add(n);
    this.primary = this.selection.size === 1 ? [...this.selection][0] : null;
    this.onSelect(this.primary, this.selection);
    this.wake();
  }
  playGrowth(ms = 4200) {
    if (reduced()) return;
    const start = performance.now();
    this.grow = 0;
    this.growth = (now) => { this.grow = Math.min(1, (now - start) / ms); if (this.grow === 1) this.growth = null; };
    this.wake();
  }

  /* ----- input ----- */
  hit(sx, sy) {
    const p = this.toWorld(sx, sy);
    let best = null; let bestD = Infinity;
    for (const n of this.active ?? []) {
      if (n.order > this.grow) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y) - n.r * (n.scale ?? 1);
      if (d < 7 / this.view.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }
  listen() {
    const c = this.canvas;
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = at(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) { this.pinch = { d: this.spread(), k: this.view.k }; this.drag = null; this.box = null; return; }
      const node = this.hit(p.x, p.y);
      // Shift and drag on the empty map: a box that selects what it covers.
      if (!node && e.shiftKey) { this.box = { from: p, to: p, add: e.ctrlKey || e.metaKey || true }; this.wake(); return; }
      this.drag = { node, start: p, last: p, moved: false, add: e.shiftKey || e.ctrlKey || e.metaKey };
      if (node) { node.fx = node.x; node.fy = node.y; this.alpha = Math.max(this.alpha, 0.2); }
      this.wake();
    });
    c.addEventListener('pointermove', (e) => {
      const p = at(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) { this.view.k = Math.max(0.06, Math.min(5, this.pinch.k * (this.spread() / this.pinch.d))); this.wake(); return; }
      if (this.box) { this.box.to = p; this.wake(); return; }
      if (this.drag) {
        if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 4) this.drag.moved = true;
        if (this.drag.node) { const w = this.toWorld(p.x, p.y); this.drag.node.fx = w.x; this.drag.node.fy = w.y; this.alpha = Math.max(this.alpha, 0.12); }
        else { this.view.x += p.x - this.drag.last.x; this.view.y += p.y - this.drag.last.y; }
        this.drag.last = p;
        this.wake();
        return;
      }
      const node = this.hit(p.x, p.y);
      if (node !== this.hover) { this.hover = node; c.style.cursor = node ? 'pointer' : 'grab'; this.onHover(node); this.wake(); }
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.box) {
        const { from, to } = this.box;
        this.box = null;
        const a = this.toWorld(Math.min(from.x, to.x), Math.min(from.y, to.y));
        const b = this.toWorld(Math.max(from.x, to.x), Math.max(from.y, to.y));
        if (Math.abs(to.x - from.x) > 6 || Math.abs(to.y - from.y) > 6) {
          this.selectMany(this.active.filter((n) => n.x >= a.x && n.x <= b.x && n.y >= a.y && n.y <= b.y && n.order <= this.grow), { add: true });
        }
        this.wake();
        return;
      }
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if (drag.node) { drag.node.fx = null; drag.node.fy = null; }
      if (!drag.moved && e.type === 'pointerup') this.select(drag.node, { add: drag.add && !!drag.node });
      this.wake();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.hover = null; this.onHover(null); this.wake(); } });
    c.addEventListener('dblclick', (e) => { const p = at(e); const n = this.hit(p.x, p.y); if (n) this.onOpen(n); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); const p = at(e); this.zoomBy(Math.exp(-e.deltaY * 0.0016), p.x, p.y); }, { passive: false });
    c.addEventListener('keydown', (e) => {
      const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
      if (moves[e.key]) { this.view.x += moves[e.key][0]; this.view.y += moves[e.key][1]; this.wake(); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      if (e.key === '-') this.zoomBy(0.8);
    });
  }
  spread() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }

  /* ----- frames ----- */
  wake() {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }
  tick(now) {
    this.frame = 0;
    if (!this.graph || !this.canvas.isConnected) return;
    // The layout settles in slices of the frame, so a large map never blocks the page.
    if (this.alpha > 0) {
      const t0 = performance.now();
      do this.step(); while (this.alpha > 0 && performance.now() - t0 < 7 && (this.active?.length ?? 0) < 600);
    }
    this.camera?.(now);
    this.growth?.(now);
    const wanted = this.hover || this.primary || this.selection.size ? 1 : 0;
    this.focus += (wanted - this.focus) * 0.18;
    const easing = Math.abs(wanted - this.focus) > 0.01;
    this.draw();
    if (this.alpha > 0 || this.camera || this.growth || easing || this.drag || this.box) this.wake();
  }
  draw() {
    const { ctx, view, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.active) return;
    ctx.save();
    ctx.translate(this.w / 2 + view.x, this.h / 2 + view.y);
    ctx.scale(view.k, view.k);
    const k = view.k;
    const center = this.hover ?? this.primary;
    const near = center ? this.adjacent.get(center) : null;
    const chosen = this.selection;
    const lit = (n) => (!center && !chosen.size) || n === center || near?.has(n) || chosen.has(n);
    const appear = (n) => (this.grow >= 1 ? 1 : Math.max(0, Math.min(1, (this.grow - n.order) / 0.05)));
    const alphaOf = (n) => (1 - 0.88 * n.dim) * (lit(n) ? 1 : 1 - 0.8 * this.focus);
    // What the screen shows, in world coordinates, with a margin: nothing outside is drawn.
    const m = 60 / k;
    const vx0 = (-this.w / 2 - view.x) / k - m; const vx1 = (this.w / 2 - view.x) / k + m;
    const vy0 = (-this.h / 2 - view.y) / k - m; const vy1 = (this.h / 2 - view.y) / k + m;
    const inView = (n) => n.x >= vx0 && n.x <= vx1 && n.y >= vy0 && n.y <= vy1;
    const far = k < 0.42;

    for (const g of this.guides) {
      ctx.fillStyle = this.dark ? 'rgba(255,255,255,.035)' : 'rgba(30,40,90,.045)';
      ctx.beginPath();
      if (g.axis === 'x') ctx.roundRect(g.x - (g.width ?? 240) / 2, vy0, g.width ?? 240, vy1 - vy0, 40);
      else ctx.roundRect(vx0, g.y - (g.height ?? 90) / 2, vx1 - vx0, g.height ?? 90, 30);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    // Links, batched by colour; the ones around the focus on top.
    const batches = new Map();
    const hot = [];
    for (const l of this.activeLinks) {
      const s = l.source; const t = l.target;
      if (!inView(s) && !inView(t)) continue;
      const show = Math.min(appear(s), appear(t));
      if (!show) continue;
      if (center && (s === center || t === center)) { hot.push(l); continue; }
      if (far && l.kind !== 'in' && l.kind !== 'prerequisite' && l.kind !== 'plan' && !(chosen.has(s) && chosen.has(t))) continue;
      const base = l.kind === 'prerequisite' ? 0.5 : l.kind === 'plan' ? 0.12 : l.kind === 'relation' ? 0.32 : l.kind === 'teaches' ? 0.1 : 0.2;
      const alpha = show * base * Math.min(alphaOf(s), alphaOf(t)) * (far ? 0.6 : 1);
      if (alpha < 0.015) continue;
      const color = s.tint ?? s.color;
      const key = `${color}|${Math.round(alpha * 20)}|${l.kind === 'prerequisite' ? 1 : 0}`;
      let b = batches.get(key);
      if (!b) { b = { color, alpha: Math.round(alpha * 20) / 20, dash: l.kind === 'prerequisite', path: new Path2D() }; batches.set(key, b); }
      b.path.moveTo(s.x, s.y); b.path.lineTo(t.x, t.y);
    }
    ctx.lineWidth = 1 / Math.max(0.6, k);
    for (const b of batches.values()) {
      ctx.globalAlpha = b.alpha; ctx.strokeStyle = b.color;
      if (b.dash) ctx.setLineDash([6 / k, 5 / k]);
      ctx.stroke(b.path);
      if (b.dash) ctx.setLineDash([]);
    }
    for (const l of hot) {
      const s = l.source; const t = l.target;
      ctx.globalAlpha = 0.95 * Math.min(appear(s), appear(t));
      ctx.strokeStyle = s === center ? t.tint ?? t.color : s.tint ?? s.color;
      ctx.lineWidth = 2 / Math.max(0.6, k);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    for (const n of this.active) {
      if (!inView(n)) continue;
      const show = appear(n);
      if (!show) continue;
      const r = n.r * (n.scale ?? 1) * (this.grow >= 1 ? 1 : easeOutBack(show));
      const color = n.tint ?? n.color;
      ctx.globalAlpha = alphaOf(n);
      if (far && n.type === 'concept' && !chosen.has(n) && n !== center && !n.mark) {
        // Far away, a concept is a dot.
        ctx.fillStyle = color;
        ctx.fillRect(n.x - Math.max(r, 1.6 / k) / 2, n.y - Math.max(r, 1.6 / k) / 2, Math.max(r, 1.6 / k), Math.max(r, 1.6 / k));
        continue;
      }
      if (n.type === 'course' || n.type === 'career' || n === center || n.mark) {
        const glow = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * (n.mark ? 3.4 : 2.6));
        glow.addColorStop(0, `${color}66`); glow.addColorStop(1, `${color}00`);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(n.x, n.y, r * (n.mark ? 3.4 : 2.6), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (n.type === 'guide') {
        ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.PI / 4);
        ctx.beginPath(); ctx.roundRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6, r * 0.35); ctx.fill(); ctx.restore();
      } else if (n.type === 'material' || n.type === 'document') {
        ctx.beginPath(); ctx.roundRect(n.x - r * 0.75, n.y - r, r * 1.5, r * 2, r * 0.3); ctx.fill();
        ctx.globalAlpha *= 0.7; ctx.strokeStyle = this.halo; ctx.lineWidth = 1.2 / k;
        ctx.beginPath(); ctx.moveTo(n.x - r * 0.4, n.y - r * 0.3); ctx.lineTo(n.x + r * 0.4, n.y - r * 0.3); ctx.moveTo(n.x - r * 0.4, n.y + r * 0.2); ctx.lineTo(n.x + r * 0.3, n.y + r * 0.2); ctx.stroke();
      } else if (n.type === 'career') {
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) { const t = (i / 6) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(n.x + Math.cos(t) * r, n.y + Math.sin(t) * r); }
        ctx.closePath(); ctx.fill();
      } else if (n.ghost || n.planned) {
        ctx.lineWidth = 1.6 / Math.max(0.6, k);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (n.bridge && !far) { ctx.lineWidth = 2 / k; ctx.strokeStyle = this.ink; ctx.stroke(); }
      }
      if (chosen.has(n) || n.mark) {
        ctx.globalAlpha = 1; ctx.lineWidth = (chosen.has(n) ? 2.5 : 1.6) / k; ctx.strokeStyle = chosen.has(n) ? this.ink : color;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5 / k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    this.labels(center, near, appear, inView, far);
    if (this.box) {
      const { from, to } = this.box;
      ctx.globalAlpha = 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = this.dark ? 'rgba(120,160,255,.12)' : 'rgba(61,123,255,.1)';
      ctx.strokeStyle = '#3d7bff'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.fillRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      ctx.strokeRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      ctx.setLineDash([]);
    }
  }
  // Labels by priority on a grid of cells: one that would cover a label already drawn is left out.
  labels(center, near, appear, inView, far) {
    const { ctx, view } = this;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const g of this.guides) {
      if (!g.label) continue;
      const p = this.toScreen(g.axis === 'x' ? { x: g.x, y: g.top ?? 0 } : { x: g.left ?? 0, y: g.y });
      ctx.globalAlpha = 0.95; ctx.font = FONT_BIG; ctx.fillStyle = this.muted;
      ctx.textAlign = g.axis === 'x' ? 'center' : 'left';
      const top = (this.insets?.().top ?? 0) + 18;
      ctx.fillText(g.label, g.axis === 'x' ? p.x : Math.max(12, p.x), g.axis === 'x' ? Math.max(top, p.y) : p.y - 8);
      ctx.textAlign = 'center';
    }
    const chosen = this.selection;
    const more = this.state.labels === 'more';
    const rank = (n) => (n === center ? 0 : chosen.has(n) ? 0.5 : near?.has(n) ? 1 : n.type === 'career' ? 2 : n.type === 'course' ? 3 : n.mark ? 4 : 5 + 1 / (1 + (n.weight ?? 1)));
    const cell = 40;
    const grid = new Map();
    const free = (b) => {
      for (let gx = Math.floor(b[0] / cell); gx <= Math.floor(b[2] / cell); gx += 1) {
        for (let gy = Math.floor(b[1] / cell); gy <= Math.floor(b[3] / cell); gy += 1) {
          for (const o of grid.get(`${gx},${gy}`) ?? []) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
        }
      }
      return true;
    };
    const take = (b) => {
      for (let gx = Math.floor(b[0] / cell); gx <= Math.floor(b[2] / cell); gx += 1) {
        for (let gy = Math.floor(b[1] / cell); gy <= Math.floor(b[3] / cell); gy += 1) {
          const key = `${gx},${gy}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(b);
        }
      }
    };
    const candidates = this.active.filter((n) => inView(n) && appear(n) && (n.type !== 'concept' || !far || n === center || chosen.has(n) || near?.has(n) || n.mark));
    let drawn = 0;
    for (const n of candidates.sort((x, y) => rank(x) - rank(y))) {
      if (drawn > 500) break;
      const pinned = !!this.pins?.has(n.id);
      const always = n.type === 'course' || n.type === 'career' || n === center || chosen.has(n) || near?.has(n) || n.mark || (pinned && view.k > 0.3);
      const fade = n.type === 'guide' || n.type === 'material' || n.type === 'document' ? (view.k - 0.55) / 0.3 : (view.k - (n.weight > 3 || more ? 0.62 : 0.95)) / 0.35;
      const a = always ? 1 : Math.max(0, Math.min(1, fade));
      if (a <= 0.02) continue;
      const p = this.toScreen(n);
      if (p.x < -80 || p.y < -40 || p.x > this.w + 80 || p.y > this.h + 40) continue;
      const big = n.type === 'course' || n.type === 'career';
      ctx.font = big ? FONT_BIG : FONT;
      const max = pinned ? 24 : 34;
      const text = n.name.length > max ? `${n.name.slice(0, max - 2)}…` : n.name;
      const y = p.y + n.r * (n.scale ?? 1) * view.k + (big ? 18 : 14);
      const width = ctx.measureText(text).width;
      const box = [p.x - width / 2 - 3, y - 13, p.x + width / 2 + 3, y + 4];
      if (n !== center && !free(box)) continue;
      take(box);
      drawn += 1;
      const focusFade = (this.hover || this.primary) && !(n === center || near?.has(n) || chosen.has(n)) ? 1 - 0.8 * this.focus : 1;
      ctx.globalAlpha = a * focusFade * (1 - 0.85 * (n.dim ?? 0));
      ctx.lineWidth = 4; ctx.strokeStyle = this.halo; ctx.strokeText(text, p.x, y);
      ctx.fillStyle = big || n === center || chosen.has(n) ? this.ink : this.muted; ctx.fillText(text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
}
