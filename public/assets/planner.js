// «Ármalo por mí»: proposed schedules for enrollment, from every section the person brought (lector.js or a paste),
// weighed as they say (his words, 2026-11-25: importance of the courses, how good the professor is). Pure local
// computing, no AI and nothing sent anywhere. Never decides: it proposes plans A, B and C as drafts, with their NRC
// lists in order and, for each course, the sections that still fit if that one fills up.
//
// What makes a plan valid (from his real registration): no clash between any two parts; theory, lab and exercises of
// one course share a group code; a course and its own prerequisite never in the same plan (Banner refuses the first);
// not over the person's credits; sections not closed to them; sections with seats (a full one is only a last resort).

// The days and hours of two sections overlap.
const clash = (a, b) => a.slots.some((x) => b.slots.some((y) => x.d === y.d && Math.max(x.s, y.s) < Math.min(x.e, y.e)));
const codesOf = (c) => String(c?.group ?? '').split(/[\s|]+/).filter(Boolean);
const linked = (a, b) => { const s = new Set(codesOf(a)); return codesOf(b).some((x) => s.has(x)); };
export const baseCode = (code) => String(code ?? '').toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^([A-Z]+ \d{3,4})E$/, '$1');
const isTheory = (s) => !s.kind || /^teor/i.test(s.kind);
export const seatsLeft = (s) => (s.seats && s.seats.max ? Math.max(0, s.seats.max - s.seats.taken) : null);
// A professor's name as a key: «Egas Proaño, David Alexis» → «egas proano david alexis».
export const profKey = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
// The community's name for a professor matches the catalog's when all its words are there («David Egas»).
export const sameProf = (catalogName, communityName) => { const a = new Set(profKey(catalogName).split(' ')); const b = profKey(communityName).split(' ').filter((w) => w.length > 2); return b.length >= 2 && b.every((w) => a.has(w)); };

// The ways to enroll in one course: a theory with one section of each other kind it needs, linked by group code; or a
// single section when the course has one kind.
export function bundles(sections) {
  const kinds = [...new Set(sections.map((s) => s.kind || 'Teoría'))];
  const theories = sections.filter(isTheory);
  const others = kinds.filter((k) => !/^teor/i.test(k));
  if (!others.length || !theories.length) return sections.map((s) => [s]);
  const out = [];
  for (const t of theories) {
    let partial = [[t]];
    for (const k of others) {
      const next = [];
      for (const p of partial) {
        for (const s of sections.filter((x) => (x.kind || '') === k)) {
          if (codesOf(t).length && !p.every((q) => linked(q, s))) continue;
          if (p.some((q) => clash(q, s))) continue;
          next.push([...p, s]);
        }
      }
      partial = next;
      if (!partial.length) break;
    }
    out.push(...partial);
    if (out.length > 200) break;
  }
  return out;
}

const DAY_MIN = 24 * 60;
// How a set of sections lives in the week: the days with class, the minutes of gaps, the earliest start.
function week(sections) {
  const byDay = new Map();
  for (const s of sections) for (const x of s.slots) { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x); }
  let gaps = 0; let early = DAY_MIN;
  for (const xs of byDay.values()) {
    xs.sort((a, b) => a.s - b.s);
    for (let i = 1; i < xs.length; i += 1) gaps += Math.max(0, xs[i].s - xs[i - 1].e - 10);
    early = Math.min(early, xs[0].s);
  }
  return { days: byDay.size, gaps, early };
}

// courses: [{ code, name, weight, sections, why: [] }] (weight 0 is left out); opts: { max, min, start, prefer,
// profScore(section) → number, together(codeA, codeB) → true when one is the other's prerequisite, closed(section) }.
// Returns up to three plans, the best first, each { picks: [{ course, bundle }], credits, score, reasons, fallback }.
export function generate(courses, opts) {
  const max = opts.max ?? 16;
  const list = courses.filter((c) => c.weight > 0 && c.sections.length).map((c) => {
    const options = bundles(c.sections.filter((s) => !opts.closed?.(s)))
      .map((b) => {
        const full = b.some((s) => seatsLeft(s) === 0);
        const early = b.some((s) => s.slots.some((x) => x.s < (opts.start ?? 0)));
        const prof = b.reduce((n, s) => n + (opts.profScore?.(s) ?? 0), 0);
        return { bundle: b, credits: b.reduce((n, s) => n + (s.credits || 0), 0), local: prof - (full ? 60 : 0) - (early ? 25 : 0), full };
      })
      .sort((a, b) => b.local - a.local).slice(0, 14);
    return { ...c, options };
  }).filter((c) => c.options.length).sort((a, b) => b.weight - a.weight);

  const best = [];
  const KEEP = 40;
  let nodes = 0;
  const comfort = (sections) => {
    const w = week(sections);
    return opts.prefer === 'dias' ? -6 * w.days - 0.01 * w.gaps : opts.prefer === 'huecos' ? -0.06 * w.gaps - 1 * w.days : -0.02 * w.gaps - 1 * w.days;
  };
  const remainingMax = list.map((_, i) => list.slice(i).reduce((n, c) => n + c.weight + Math.max(0, ...c.options.map((o) => o.local)), 0));
  const worst = () => (best.length < KEEP ? -Infinity : best[best.length - 1].score);
  function walk(i, picks, sections, credits, score) {
    nodes += 1;
    if (nodes > 120000) return;
    if (i === list.length) {
      if (!picks.length) return;
      const total = score + comfort(sections);
      const key = picks.map((p) => p.bundle.map((s) => s.nrc).join('+')).sort().join(',');
      if (best.some((b) => b.key === key)) return;
      best.push({ key, picks: [...picks], credits, score: total, sections: [...sections] });
      best.sort((a, b) => b.score - a.score);
      if (best.length > KEEP) best.pop();
      return;
    }
    if (score + remainingMax[i] < worst()) return;
    const c = list[i];
    const blocked = picks.some((p) => opts.together?.(p.course.code, c.code) || opts.together?.(c.code, p.course.code));
    if (!blocked) {
      for (const o of c.options) {
        if (credits + o.credits > max) continue;
        if (o.bundle.some((s) => sections.some((x) => clash(x, s)))) continue;
        picks.push({ course: c, bundle: o.bundle, full: o.full });
        walk(i + 1, picks, [...sections, ...o.bundle], credits + o.credits, score + c.weight + o.local);
        picks.pop();
      }
    }
    // Leaving a course out costs its weight: an «imprescindible» is left out only when it cannot fit.
    walk(i + 1, picks, sections, credits, score - (c.weight >= 100 ? 400 : 0));
  }
  walk(0, [], [], 0, 0);
  // A, then the best that differs from A in at least a course or a third of its sections, then from both.
  const nrcs = (p) => new Set(p.sections.map((s) => s.nrc));
  const far = (a, b) => { const x = nrcs(a); const y = nrcs(b); const shared = [...x].filter((n) => y.has(n)).length; return shared / Math.max(x.size, y.size) <= 0.67; };
  // A plan that is only a piece of another (A without one course) is no plan B: it is what A becomes if a course fails.
  const inside = (p, q) => [...nrcs(p)].every((n) => nrcs(q).has(n));
  // B and C keep about as many credits as A (a plan B is for when A does not work out, not a smaller A).
  const chosen = best.length ? [best[0]] : [];
  const near = (p) => p.credits >= (chosen[0]?.credits ?? 0) - 3;
  for (const test of [(p) => near(p) && chosen.every((q) => far(p, q)), (p) => near(p), () => true]) {
    for (const p of best) { if (chosen.length >= 3) break; if (!chosen.includes(p) && !chosen.some((q) => inside(p, q)) && test(p)) chosen.push(p); }
  }
  return chosen.map((p) => ({ ...p, order: order(p), fallback: fallback(p, list, max), left: list.filter((c) => !p.picks.some((x) => x.course === c)) }));
}

// The NRC list in the order to type them: what matters most and has the fewest seats first, each course's parts
// together (Banner takes them at once).
function order(plan) {
  return [...plan.picks].sort((a, b) => b.course.weight - a.course.weight || (minSeats(a) - minSeats(b))).map((p) => p);
}
const minSeats = (p) => Math.min(...p.bundle.map((s) => seatsLeft(s) ?? 99));
// For each course of a plan: the other ways to take it that still fit with the rest, for the moment one fills up.
function fallback(plan, list, max) {
  const out = new Map();
  for (const p of plan.picks) {
    const rest = plan.picks.filter((x) => x !== p).flatMap((x) => x.bundle);
    const credits = plan.credits - p.bundle.reduce((n, s) => n + (s.credits || 0), 0);
    const course = list.find((c) => c === p.course);
    const alts = (course?.options ?? []).filter((o) => o.bundle !== p.bundle && !o.full && credits + o.credits <= max
      && !o.bundle.some((s) => rest.some((x) => clash(x, s))) && o.bundle.map((s) => s.nrc).join() !== p.bundle.map((s) => s.nrc).join()).slice(0, 2);
    out.set(p.course.code, alts.map((o) => o.bundle));
  }
  return out;
}
