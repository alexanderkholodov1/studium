// The knowledge map. buildGraph() joins every guide and contribution the account can see into one graph of careers,
// courses, guides and concepts; GraphView draws it on a canvas with a force layout that the person can drag, pan and
// zoom, and lays a career's courses out by semester when one is chosen.
import { keyOf, themeOf, courseThemes, guessTheme } from './themes.js';

const ensure = (map, id, make) => {
  if (!map.has(id)) map.set(id, make());
  return map.get(id);
};

export function buildGraph({ catalog, contributions }) {
  const lessons = contributions.filter((c) => c.kind !== 'curriculum');
  const plans = contributions.filter((c) => c.kind === 'curriculum');
  const themes = courseThemes([...catalog, ...lessons]);
  const nodes = new Map();
  const links = new Map();
  const codes = new Map();
  const link = (a, b, kind, extra = {}) => {
    if (!a || !b || a === b) return null;
    const id = `${a.id}>${b.id}>${kind}`;
    return ensure(links, id, () => ({ id, source: a, target: b, kind, ...extra }));
  };
  const born = (n, t) => { if (t && t < n.born) n.born = t; };

  for (const item of [...lessons, ...catalog, ...plans.flatMap((p) => p.data.curriculum?.semesters.flatMap((s) => s.courses) ?? [])]) {
    if (item.code && keyOf(item.name ?? item.course)) codes.set(keyOf(item.code), keyOf(item.name ?? item.course));
  }
  const course = (name, code) => {
    const key = (code && codes.get(keyOf(code))) || codes.get(keyOf(name)) || keyOf(name);
    if (!key) return null;
    const n = ensure(nodes, `course:${key}`, () => ({
      id: `course:${key}`, type: 'course', key, name, names: new Map(), code: code || '', theme: themes.get(key) ?? guessTheme(name),
      guides: [], contributions: [], professors: new Map(), terms: new Set(), careers: [], born: Infinity,
    }));
    if (name && keyOf(name) === key) n.names.set(name, (n.names.get(name) ?? 0) + 1);
    if (code && !n.code) n.code = code;
    return n;
  };
  const concept = (name) => {
    const key = keyOf(name);
    if (!key) return null;
    const n = ensure(nodes, `concept:${key}`, () => ({
      id: `concept:${key}`, type: 'concept', key, name, names: new Map(), summaries: [], courses: new Set(), questions: [],
      examples: [], guides: [], relations: [], weight: 0, ghost: true, born: Infinity,
    }));
    n.names.set(name, (n.names.get(name) ?? 0) + 1);
    return n;
  };
  const inCourse = (c, n, when) => { n.courses.add(c.id); link(c, n, 'in'); born(n, when); };

  for (const item of lessons) {
    const c = course(item.course, item.code);
    if (!c) continue;
    c.contributions.push(item);
    born(c, item.updated);
    if (item.professor) c.professors.set(item.professor, new Set([...(c.professors.get(item.professor) ?? []), item.term].filter(Boolean)));
    if (item.term) c.terms.add(item.term);
    const where = { course: c.name, courseId: c.id, professor: item.professor ?? '', term: item.term ?? '', title: item.title, source: item.kind, item: item.id };
    for (const con of item.data.concepts ?? []) {
      const n = concept(con.name);
      if (!n) continue;
      n.ghost = false;
      n.weight += 1;
      inCourse(c, n, item.updated);
      if (con.summary && !n.summaries.some((s) => s.text === con.summary)) n.summaries.push({ text: con.summary, ...where });
      for (const r of con.related ?? []) {
        const m = concept(r.to);
        if (!m) continue;
        link(n, m, 'relation', { relation: r.kind });
        // Material that refers to a concept uses it: the concept joins the course, and bridges courses that share it.
        inCourse(c, m, item.updated);
        n.relations.push({ kind: r.kind, key: m.key, name: r.to, out: true });
        m.relations.push({ kind: r.kind, key: n.key, name: con.name, out: false });
      }
    }
    for (const q of item.data.questions ?? []) {
      for (const name of q.concepts) {
        const n = concept(name);
        if (!n) continue;
        n.questions.push({ ...q, ...where });
        n.weight += 1;
        if (!n.courses.has(c.id)) inCourse(c, n, item.updated);
      }
    }
    for (const e of item.data.examples ?? []) {
      for (const name of e.concepts) {
        const n = concept(name);
        if (n) { n.examples.push({ ...e, ...where }); if (!n.courses.has(c.id)) inCourse(c, n, item.updated); }
      }
    }
  }

  for (const entry of catalog) {
    const c = course(entry.course, entry.code);
    if (!c) continue;
    const when = entry.date ? Date.parse(`${entry.date}T12:00:00`) : entry.updated;
    c.guides.push(entry);
    if (entry.professor) c.professors.set(entry.professor, new Set([...(c.professors.get(entry.professor) ?? []), entry.term].filter(Boolean)));
    if (entry.term) c.terms.add(entry.term);
    born(c, when);
    const g = ensure(nodes, `guide:${entry.id}`, () => ({ id: `guide:${entry.id}`, type: 'guide', entry, name: entry.title, course: c, born: when || Infinity }));
    link(c, g, 'has');
    const named = entry.concepts?.length ? entry.concepts : entry.topics ?? [];
    named.forEach((name, i) => {
      const n = concept(name);
      if (!n) return;
      n.ghost = false;
      n.weight += 1;
      n.guides.push({ id: entry.id, anchor: entry.anchors?.[i] ?? '', title: entry.title, course: c.name });
      n.courses.add(c.id);
      link(g, n, 'covers');
      born(n, when);
    });
  }

  for (const plan of plans) {
    const key = keyOf(plan.course);
    if (!key) continue;
    const career = ensure(nodes, `career:${key}`, () => ({
      id: `career:${key}`, type: 'career', key, name: plan.course, university: plan.university ?? '', semesters: [], born: plan.updated || Infinity,
    }));
    for (const sem of plan.data.curriculum?.semesters ?? []) {
      for (const co of sem.courses) {
        const c = course(co.name, co.code);
        if (!c) continue;
        if (!c.careers.some((x) => x.career === career.id)) c.careers.push({ career: career.id, semester: sem.number, elective: !!co.elective });
        (career.semesters[sem.number] ??= []).push(c.id);
        link(career, c, 'plan', { semester: sem.number });
        born(c, plan.updated);
        for (const pre of co.prerequisites) link(course(pre, codes.has(keyOf(pre)) ? pre : ''), c, 'prerequisite');
      }
    }
  }

  const all = [...nodes.values()];
  for (const n of all) {
    if ((n.type === 'concept' || n.type === 'course') && n.names.size) n.name = [...n.names].sort((x, y) => y[1] - x[1])[0][0];
    n.degree = 0;
  }
  const list = [...links.values()];
  for (const l of list) { l.source.degree += 1; l.target.degree += 1; }
  for (const n of all) {
    const c = n.type === 'course' ? n : n.type === 'guide' ? n.course : nodes.get([...(n.courses ?? [])][0] ?? '');
    const theme = themeOf(c?.theme);
    n.color = n.type === 'guide' ? theme.b : n.type === 'career' ? '#f4f1ff' : theme.a;
    n.bridge = n.type === 'concept' && n.courses.size > 1;
    n.planned = n.type === 'course' && !n.contributions.length && !n.guides.length;
    n.r = n.type === 'career' ? 20 : n.type === 'course' ? 13 + Math.min(14, Math.sqrt(n.degree) * 1.6)
      : n.type === 'guide' ? 8 : 3.2 + Math.min(9, Math.sqrt(n.weight) * 1.5);
    if (n.born === Infinity) n.born = 0;
  }
  return { nodes: all, links: list, byId: nodes };
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

/* ---------- drawing ---------- */

const CHARGE = { concept: -70, guide: -160, course: -520, career: -900 };
const SPRING = {
  in: { distance: 64, strength: 0.45 }, covers: { distance: 54, strength: 0.25 }, relation: { distance: 44, strength: 0.6 },
  has: { distance: 52, strength: 0.6 }, plan: { distance: 180, strength: 0.03 }, prerequisite: { distance: 170, strength: 0.06 },
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

export class GraphView {
  constructor(canvas, { onSelect, onOpen } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect ?? (() => {});
    this.onOpen = onOpen ?? (() => {});
    this.view = { x: 0, y: 0, k: 0.8 };
    this.alpha = 1;
    this.alphaTarget = 0;
    this.hover = null;
    this.selected = null;
    this.focus = 0;
    this.grow = 1;
    this.filter = { courses: null, professor: '', career: '', semester: 0 };
    this.pointers = new Map();
    this.frame = 0;
    this.colors();
    this.listen();
    this.resize();
    // The canvas has no size while its view is hidden: the first fit waits for one.
    new ResizeObserver(() => {
      this.resize();
      if (this.pendingFit && this.w > 50) { this.pendingFit = false; this.fit(false); }
      this.wake();
    }).observe(canvas);
    new MutationObserver(() => { this.colors(); this.wake(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.colors(); this.wake(); });
  }

  colors() {
    const css = getComputedStyle(document.documentElement);
    this.ink = css.getPropertyValue('--ink').trim() || '#f3f0ff';
    this.muted = css.getPropertyValue('--muted').trim() || '#9a92c9';
    this.halo = css.getPropertyValue('--bg').trim() || '#120d31';
    this.dark = css.getPropertyValue('color-scheme').trim() !== 'light';
  }

  setGraph(graph, { animate = true } = {}) {
    const old = new Map((this.graph?.nodes ?? []).map((n) => [n.id, n]));
    this.graph = graph;
    const courses = graph.nodes.filter((n) => n.type === 'course');
    const ring = 140 + 70 * Math.sqrt(courses.length);
    courses.forEach((c, i) => {
      c.home = { x: Math.cos((i / courses.length) * Math.PI * 2) * ring, y: Math.sin((i / courses.length) * Math.PI * 2) * ring };
    });
    for (const n of graph.nodes) {
      const prior = old.get(n.id);
      const anchor = n.type === 'course' ? n.home : graph.byId.get([...(n.courses ?? [])][0] ?? '')?.home ?? n.course?.home ?? { x: 0, y: 0 };
      n.x = prior?.x ?? anchor.x + (Math.random() - 0.5) * 80;
      n.y = prior?.y ?? anchor.y + (Math.random() - 0.5) * 80;
      n.vx = 0; n.vy = 0;
    }
    const order = [...graph.nodes].sort((a, b) => a.born - b.born);
    order.forEach((n, i) => { n.order = order.length > 1 ? i / (order.length - 1) : 0; });
    this.adjacent = new Map(graph.nodes.map((n) => [n, new Set()]));
    for (const l of graph.links) { this.adjacent.get(l.source).add(l.target); this.adjacent.get(l.target).add(l.source); }
    if (this.selected) this.selected = graph.byId.get(this.selected.id) ?? null;
    this.hover = null;
    this.applyFilter();
    this.layout();
    this.alpha = 1;
    // Settle the layout before the first frame, so the map opens already shaped.
    for (let i = 0; i < 160; i += 1) this.step();
    this.resize();
    if (this.w > 50) this.fit(false); else this.pendingFit = true;
    if (animate && !reduced() && !old.size) this.playGrowth(1800);
    this.wake();
  }

  // Career mode pins the career's courses to columns by semester; otherwise courses drift toward their home ring.
  layout() {
    const career = this.filter.career && this.graph.byId.get(this.filter.career);
    this.columns = [];
    for (const n of this.graph.nodes) { n.target = null; }
    if (career) {
      const sems = career.semesters.map((ids, s) => [s, ids]).filter(([, ids]) => ids?.length);
      const count = sems.length;
      sems.forEach(([s, ids], i) => {
        const x = (i - (count - 1) / 2) * 280;
        this.columns.push({ x, label: `Semestre ${s}`, semester: s });
        ids.forEach((id, j) => { const c = this.graph.byId.get(id); if (c) c.target = { x, y: (j - (ids.length - 1) / 2) * 150, k: 0.5 }; });
        this.columns.at(-1).top = -((ids.length - 1) / 2) * 150 - 130;
      });
      career.target = { x: -((count + 1) / 2) * 280, y: 0, k: 0.5 };
    } else {
      for (const n of this.graph.nodes) if (n.type === 'course') n.target = { ...n.home, k: 0.004 };
    }
  }

  setFilter(next) {
    const careerChanged = next.career !== undefined && next.career !== this.filter.career;
    this.filter = { ...this.filter, ...next };
    if (!this.graph) return;
    this.applyFilter();
    if (careerChanged) { this.layout(); this.alpha = 0.9; }
    this.wake();
  }

  applyFilter() {
    const { courses, professor, career, semester } = this.filter;
    const plan = career && this.graph.byId.get(career);
    const inPlan = plan ? new Set(plan.semesters.flat()) : null;
    const soon = plan && semester ? new Set([semester + 1, semester + 2].flatMap((s) => plan.semesters[s] ?? [])) : null;
    for (const n of this.graph.nodes) {
      const own = n.type === 'course' ? [n.id] : n.type === 'guide' ? [n.course.id] : n.type === 'concept' ? [...n.courses] : [];
      let shown = !courses || own.some((id) => courses.has(id)) || n.type === 'career';
      if (inPlan && n.type !== 'career') shown &&= own.some((id) => inPlan.has(id));
      if (plan && n.type === 'career') shown = n === plan;
      if (professor && n.type === 'concept') shown &&= n.questions.some((q) => q.professor === professor) || n.summaries.some((s) => s.professor === professor);
      if (professor && n.type === 'course') shown &&= n.professors.has(professor);
      n.hidden = !shown;
      n.soon = !!soon && own.some((id) => soon.has(id));
    }
  }

  step() {
    const nodes = this.graph.nodes;
    const a = this.alpha;
    for (const l of this.graph.links) {
      const s = l.source; const t = l.target; const spring = SPRING[l.kind] ?? SPRING.in;
      let dx = t.x + t.vx - s.x - s.vx; let dy = t.y + t.vy - s.y - s.vy;
      const d = Math.hypot(dx, dy) || 1;
      const k = ((d - spring.distance - s.r - t.r) / d) * a * spring.strength;
      dx *= k; dy *= k;
      const b = s.degree / (s.degree + t.degree);
      t.vx -= dx * b; t.vy -= dy * b; s.vx += dx * (1 - b); s.vy += dy * (1 - b);
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const q = nodes[j];
        let dx = q.x - p.x; let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 360000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        p.vx += (dx * CHARGE[q.type] * a) / d2; p.vy += (dy * CHARGE[q.type] * a) / d2;
        q.vx -= (dx * CHARGE[p.type] * a) / d2; q.vy -= (dy * CHARGE[p.type] * a) / d2;
        const min = p.r + q.r + 4;
        if (d2 < min * min) {
          const d = Math.sqrt(d2); const push = ((min - d) / d) * 0.25;
          p.vx -= dx * push; p.vy -= dy * push; q.vx += dx * push; q.vy += dy * push;
        }
      }
    }
    for (const n of nodes) {
      if (n.target) { n.vx += (n.target.x - n.x) * n.target.k * a; n.vy += (n.target.y - n.y) * n.target.k * a; }
      n.vx -= n.x * 0.0025 * a; n.vy -= n.y * 0.0025 * a;
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.58; n.vy *= 0.58;
      n.x += n.vx; n.y += n.vy;
    }
    this.alpha += (this.alphaTarget - this.alpha) * 0.03;
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
  fit(animate = true) {
    const shown = this.graph.nodes.filter((n) => !n.hidden);
    if (!shown.length) return;
    const xs = shown.map((n) => n.x); const ys = shown.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.max(0.2, Math.min(1.5, Math.min(this.w / (x1 - x0 + 160), this.h / (y1 - y0 + 160))));
    const target = { x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k, k };
    if (animate) this.moveTo(target); else this.view = target;
  }
  zoomBy(f, sx = this.w / 2, sy = this.h / 2) {
    const k = Math.max(0.15, Math.min(5, this.view.k * f));
    const p = this.toWorld(sx, sy);
    this.view = { k, x: sx - this.w / 2 - p.x * k, y: sy - this.h / 2 - p.y * k };
    this.wake();
  }
  show(node) {
    if (!node) return;
    const k = Math.max(this.view.k, 1.3);
    this.moveTo({ x: -node.x * k, y: -node.y * k, k });
  }
  select(node, { fly = false } = {}) {
    this.selected = node;
    if (fly) this.show(node);
    this.onSelect(node);
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
    for (const n of this.graph?.nodes ?? []) {
      if (n.hidden || n.order > this.grow) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y) - n.r;
      if (d < 6 / this.view.k && d < bestD) { best = n; bestD = d; }
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
      if (this.pointers.size === 2) { this.pinch = { d: this.spread(), k: this.view.k }; this.drag = null; return; }
      const node = this.hit(p.x, p.y);
      this.drag = { node, start: p, last: p, moved: false };
      if (node) { node.fx = node.x; node.fy = node.y; this.alphaTarget = 0.25; this.alpha = Math.max(this.alpha, 0.3); }
      this.wake();
    });
    c.addEventListener('pointermove', (e) => {
      const p = at(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) { this.view.k = Math.max(0.15, Math.min(5, this.pinch.k * (this.spread() / this.pinch.d))); this.wake(); return; }
      if (this.drag) {
        if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 4) this.drag.moved = true;
        if (this.drag.node) { const w = this.toWorld(p.x, p.y); this.drag.node.fx = w.x; this.drag.node.fy = w.y; }
        else { this.view.x += p.x - this.drag.last.x; this.view.y += p.y - this.drag.last.y; }
        this.drag.last = p;
        this.wake();
        return;
      }
      const node = this.hit(p.x, p.y);
      if (node !== this.hover) { this.hover = node; c.style.cursor = node ? 'pointer' : 'grab'; this.wake(); }
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if (drag.node) { drag.node.fx = null; drag.node.fy = null; this.alphaTarget = 0; }
      if (!drag.moved && e.type === 'pointerup') this.select(drag.node);
      this.wake();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.hover = null; this.wake(); } });
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
    const simulating = this.alpha > 0.004 || this.alphaTarget > 0;
    if (simulating) this.step();
    this.camera?.(now);
    this.growth?.(now);
    const wanted = this.hover || this.selected ? 1 : 0;
    this.focus += (wanted - this.focus) * 0.18;
    const easing = Math.abs(wanted - this.focus) > 0.01;
    this.draw();
    if (simulating || this.camera || this.growth || easing || this.drag) this.wake();
  }
  draw() {
    const { ctx, view, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.w / 2 + view.x, this.h / 2 + view.y);
    ctx.scale(view.k, view.k);
    const center = this.hover ?? this.selected;
    const near = center ? this.adjacent.get(center) : null;
    const lit = (n) => !center || n === center || near.has(n);
    const appear = (n) => (this.grow >= 1 ? 1 : Math.max(0, Math.min(1, (this.grow - n.order) / 0.05)));
    const dim = (n) => (n.hidden ? 0.06 : lit(n) ? 1 : 1 - 0.82 * this.focus);

    for (const col of this.columns) {
      ctx.fillStyle = this.dark ? 'rgba(255,255,255,.035)' : 'rgba(40,20,120,.04)';
      ctx.beginPath(); ctx.roundRect(col.x - 120, -2000, 240, 4000, 40); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (const l of this.graph.links) {
      const s = l.source; const t = l.target;
      const show = Math.min(appear(s), appear(t));
      if (!show || s.hidden || t.hidden) continue;
      const hot = center && (s === center || t === center);
      const base = l.kind === 'prerequisite' ? 0.5 : l.kind === 'plan' ? 0.12 : l.kind === 'relation' ? 0.32 : 0.2;
      ctx.globalAlpha = show * (hot ? 0.95 : base * (center ? 1 - 0.85 * this.focus : 1));
      ctx.strokeStyle = hot ? (s === center ? t.color : s.color) : s.color;
      ctx.lineWidth = (hot ? 2 : l.kind === 'prerequisite' ? 1.6 : 1) / Math.max(0.6, view.k);
      if (l.kind === 'prerequisite') ctx.setLineDash([6 / view.k, 5 / view.k]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const n of this.graph.nodes) {
      const show = appear(n);
      if (!show) continue;
      const r = n.r * (this.grow >= 1 ? 1 : easeOutBack(show));
      ctx.globalAlpha = dim(n);
      if (n.type === 'course' || n.type === 'career' || n === center || n.soon) {
        const glow = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * (n.soon ? 3.4 : 2.6));
        glow.addColorStop(0, `${n.color}66`); glow.addColorStop(1, `${n.color}00`);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(n.x, n.y, r * (n.soon ? 3.4 : 2.6), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = n.color;
      ctx.strokeStyle = n.color;
      if (n.type === 'guide') {
        ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.PI / 4);
        ctx.beginPath(); ctx.roundRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6, r * 0.35); ctx.fill(); ctx.restore();
      } else if (n.type === 'career') {
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) { const t = (i / 6) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(n.x + Math.cos(t) * r, n.y + Math.sin(t) * r); }
        ctx.closePath(); ctx.fill();
      } else if (n.ghost || n.planned) {
        ctx.lineWidth = 1.6 / Math.max(0.6, view.k);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (n.bridge) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = this.ink; ctx.stroke(); }
      }
      if (n === this.selected) {
        ctx.globalAlpha = 1; ctx.lineWidth = 2.5 / view.k; ctx.strokeStyle = this.ink;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5 / view.k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    this.labels(center, near, appear);
  }
  labels(center, near, appear) {
    const { ctx, view } = this;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const col of this.columns) {
      const p = this.toScreen({ x: col.x, y: col.top ?? -200 });
      ctx.globalAlpha = 0.9; ctx.font = '750 14px "Bricolage Grotesque", system-ui, sans-serif';
      ctx.fillStyle = this.muted; ctx.fillText(col.label, p.x, p.y);
    }
    // Labels by priority; one that would cover a label already drawn is left out.
    const rank = (n) => (n === center ? 0 : near?.has(n) ? 1 : n.type === 'career' ? 2 : n.type === 'course' ? 3 : n.soon ? 4 : 5 + 1 / (1 + (n.weight ?? 1)));
    const placed = [];
    for (const n of [...this.graph.nodes].sort((x, y) => rank(x) - rank(y))) {
      if (n.hidden || !appear(n)) continue;
      const always = n.type === 'course' || n.type === 'career' || n === center || near?.has(n) || n.soon;
      const fade = n.type === 'guide' ? (view.k - 0.55) / 0.3 : (view.k - (n.weight > 3 ? 0.75 : 1.05)) / 0.35;
      const a = always ? 1 : Math.max(0, Math.min(1, fade));
      if (a <= 0.02) continue;
      const p = this.toScreen(n);
      if (p.x < -80 || p.y < -40 || p.x > this.w + 80 || p.y > this.h + 40) continue;
      const big = n.type === 'course' || n.type === 'career';
      ctx.font = big ? '750 14px "Bricolage Grotesque", system-ui, sans-serif' : '600 12px "Atkinson Hyperlegible Next", system-ui, sans-serif';
      const text = n.name.length > 34 ? `${n.name.slice(0, 32)}…` : n.name;
      const y = p.y + n.r * view.k + (big ? 18 : 14);
      const width = ctx.measureText(text).width;
      const box = [p.x - width / 2 - 3, y - 13, p.x + width / 2 + 3, y + 4];
      if (n !== center && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.globalAlpha = a * (center && !(n === center || near?.has(n)) ? 1 - 0.8 * this.focus : 1);
      ctx.lineWidth = 4; ctx.strokeStyle = this.halo; ctx.strokeText(text, p.x, y);
      ctx.fillStyle = big || n === center ? this.ink : this.muted; ctx.fillText(text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
}
