// The home page's grid: each tile has a place (x, y) and a size (w, h) in a grid of 12 columns and rows of fixed
// height. While personalizing, a tile is moved by dragging it and resized from its corner; the others make room and
// rise to fill the gaps. With the keyboard: arrows move the focused tile, Shift + arrows resize it.
// A tile is stored as a string, "id@x.y.w.h" (the profile keeps a list of strings), and old lists ("id", "id:s")
// are laid out again from the defaults.

export const COLS = 12;

// The smallest size each tile can take, and its size when added.
export const SIZES = {
  countdown: { min: [3, 2], add: [4, 3] },
  todos: { min: [3, 3], add: [4, 5] },
  schedule: { min: [3, 3], add: [4, 4] },
  timer: { min: [3, 2], add: [4, 3] },
  goals: { min: [3, 3], add: [4, 3] },
  deadlines: { min: [3, 3], add: [4, 4] },
  week: { min: [6, 2], add: [8, 3] },
  notes: { min: [3, 2], add: [4, 3] },
  links: { min: [3, 2], add: [4, 3] },
  recent: { min: [3, 2], add: [4, 3] },
  news: { min: [4, 2], add: [8, 3] },
  explore: { min: [3, 2], add: [4, 3] },
  shelf: { min: [4, 2], add: [12, 3] },
};

// What a person sees first: on the first screen what matters today (the next exam, what to do, today's classes,
// focus and goals); below, everything else Studium can hold, so the home page shows what it can do from the start.
export const DEFAULT = [
  ['countdown', 0, 0, 4, 4], ['todos', 4, 0, 4, 7], ['schedule', 8, 0, 4, 4],
  ['timer', 0, 4, 4, 3], ['goals', 8, 4, 4, 3],
  ['week', 0, 7, 8, 3], ['deadlines', 8, 7, 4, 4],
  ['recent', 0, 10, 4, 3], ['news', 4, 10, 4, 3],
  ['notes', 0, 13, 4, 4], ['links', 4, 13, 4, 4], ['explore', 8, 11, 4, 4],
  ['shelf', 0, 17, 12, 3],
].map(([id, x, y, w, h]) => ({ id, x, y, w, h }));

const clampItem = (it) => {
  const [mw, mh] = SIZES[it.id]?.min ?? [3, 2];
  const w = Math.max(mw, Math.min(COLS, it.w | 0));
  const h = Math.max(mh, Math.min(12, it.h | 0));
  return { id: it.id, w, h, x: Math.max(0, Math.min(COLS - w, it.x | 0)), y: Math.max(0, Math.min(200, it.y | 0)) };
};

export function parse(list) {
  const out = [];
  for (const s of list) {
    const m = String(s).match(/^([a-z]+)@(\d{1,3})\.(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/);
    if (!m) return null; // an old list: laid out again
    out.push(clampItem({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));
  }
  return out;
}
export const serialize = (items) => items.map((it) => `${it.id}@${it.x}.${it.y}.${it.w}.${it.h}`);

const hits = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Every tile rises as far as it can, in reading order; `fixed` stays where it was dropped.
export function compact(items, fixed = null) {
  const done = fixed ? [fixed] : [];
  const rest = items.filter((it) => it !== fixed).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of rest) {
    it.y = 0;
    for (;;) {
      const hit = done.find((o) => hits(it, o));
      if (!hit) break;
      it.y = hit.y + hit.h;
    }
    done.push(it);
  }
  return items;
}

// Where a new tile goes: the first place it fits, from the top.
export function place(items, id) {
  const [w, h] = SIZES[id]?.add ?? [4, 3];
  for (let y = 0; y < 400; y += 1) {
    for (let x = 0; x + w <= COLS; x += 1) {
      const it = { id, x, y, w, h };
      if (!items.some((o) => hits(it, o))) return it;
    }
  }
  return { id, x: 0, y: 400, w, h };
}

export const rows = (items) => Math.max(0, ...items.map((it) => it.y + it.h));

/* ---------- moving and resizing with the pointer ---------- */
// `host` holds the grid of tiles (.dash-grid, drawn again on each change); `get` returns the current items, `save` keeps
// a new layout.
export function bindGrid(host, { get, save, editing }) {
  let drag = null;
  let grid = null;
  const metrics = () => {
    const r = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap) || 16;
    const row = parseFloat(cs.getPropertyValue('--row')) || 64;
    return { r, gap, col: (r.width - gap * (COLS - 1)) / COLS, row };
  };
  const apply = (items, moving) => {
    for (const it of items) {
      const el = grid.querySelector(`[data-tile="${it.id}"]`);
      if (!el || el === moving) continue;
      el.style.gridArea = `${it.y + 1} / ${it.x + 1} / span ${it.h} / span ${it.w}`;
    }
  };
  host.addEventListener('pointerdown', (e) => {
    if (!editing() || e.button !== 0) return;
    grid = host.querySelector('.dash-grid');
    if (!grid) return;
    const el = e.target.closest('[data-tile]');
    if (!el || e.target.closest('.tile-tools button, input, textarea, select, a, button, label, summary, [contenteditable]')) return;
    const resize = !!e.target.closest('[data-resize]');
    const items = get().map((it) => ({ ...it }));
    const it = items.find((x) => x.id === el.dataset.tile);
    if (!it) return;
    e.preventDefault();
    const m = metrics();
    const box = el.getBoundingClientRect();
    drag = { el, it, items, resize, m, start: { x: e.clientX, y: e.clientY }, box, from: { ...it }, moved: false };
    el.setPointerCapture(e.pointerId);
    el.classList.add(resize ? 'resizing' : 'dragging');
    grid.classList.add('arranging');
    // The place the tile will take, drawn under it.
    const ghost = document.createElement('div');
    ghost.className = 'tile-ghost';
    ghost.style.gridArea = `${it.y + 1} / ${it.x + 1} / span ${it.h} / span ${it.w}`;
    grid.append(ghost);
    drag.ghost = ghost;
  });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { el, it, m, start, box, from } = drag;
    const dx = e.clientX - start.x; const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    const stepX = m.col + m.gap; const stepY = m.row + m.gap;
    if (drag.resize) {
      el.style.width = `${Math.max(80, box.width + dx)}px`; el.style.height = `${Math.max(80, box.height + dy)}px`;
      it.w = from.w + Math.round(dx / stepX); it.h = from.h + Math.round(dy / stepY);
    } else {
      el.style.translate = `${dx}px ${dy}px`;
      it.x = from.x + Math.round(dx / stepX); it.y = from.y + Math.round(dy / stepY);
    }
    Object.assign(it, clampItem(it));
    // The others make room: whatever the tile now covers goes below it, then everything rises.
    const others = drag.items.filter((o) => o !== it);
    for (const o of others) { const f = get().find((x) => x.id === o.id); if (f) Object.assign(o, { x: f.x, y: f.y }); }
    for (const o of others.sort((a, b) => a.y - b.y)) if (hits(o, it)) o.y = it.y + it.h;
    compact(drag.items, it);
    drag.ghost.style.gridArea = `${it.y + 1} / ${it.x + 1} / span ${it.h} / span ${it.w}`;
    apply(drag.items, el);
    grid.style.setProperty('--rows', rows(drag.items));
  });
  const end = () => {
    if (!drag) return;
    const { el, items, ghost, moved } = drag;
    drag = null;
    ghost.remove();
    el.classList.remove('dragging', 'resizing');
    grid.classList.remove('arranging');
    el.style.translate = ''; el.style.width = ''; el.style.height = '';
    if (moved) save(compact(items)); else apply(get());
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  // The keyboard: the focused tile moves with the arrows and grows or shrinks with Shift.
  host.addEventListener('keydown', (e) => {
    if (!editing() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const el = e.target.closest('[data-tile]');
    if (!el || e.target !== el) return;
    e.preventDefault();
    const items = get().map((it) => ({ ...it }));
    const it = items.find((x) => x.id === el.dataset.tile);
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.shiftKey) { it.w += d[0]; it.h += d[1]; } else { it.x += d[0]; it.y += d[1]; }
    Object.assign(it, clampItem(it));
    for (const o of items) if (hits(o, it)) o.y = it.y + it.h;
    save(compact(items, it), it.id);
  });
}
