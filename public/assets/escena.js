// «Escena»: a picture of the thing itself, drawn by Studium from data the AI writes (his words, 2026-11-23: graphics
// must show what the thing looks like — the memory as cells with their addresses and values, a table with its rows,
// the blocks of a disk, a structure with its fields, pointers that point at real cells — and animations must happen on
// that picture, not dots running between boxes of text). It serves any subject: a cell, a circuit, a timeline, a
// molecule, a market. The AI never writes markup: an escena is shapes, texts and steps, checked here and drawn as SVG.
//
// Shapes: caja (a rectangle with text: a cell, a block, a field, a node), texto, circulo, linea, flecha (from one shape
// to another, or between points), celdas (a row or column of equal boxes: memory, an array, a register, a queue: its
// cells are «<id>.<n>»), tabla (columns and rows: a page table, an inode's fields, a truth table: its cells are
// «<id>.<row>.<col>», rows from 0, the header is row «h»). Each step changes the picture: shows, hides, highlights,
// changes a text or a color, moves a shape; the picture keeps what earlier steps did.

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : '');
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const ID = /^[A-Za-z][\w-]{0,39}$/;
const REF = /^[A-Za-z][\w-]{0,39}(\.(h|\d{1,3}))?(\.\d{1,3})?$/;
export const COLORS = ['azul', 'rojo', 'verde', 'naranja', 'violeta', 'amarillo', 'gris', 'rosa', 'cian'];
const color = (c) => (COLORS.includes(c) ? c : '');
const W = 1000; const H = 700;

// Only what Studium knows, with sizes capped; an escena with nothing to draw is dropped.
export function cleanEscena(e) {
  if (!e || typeof e !== 'object') return null;
  const ancho = num(e.ancho, 200, W, 800); const alto = num(e.alto, 120, H, 400);
  const els = [];
  for (const x of list(e.elementos, 220)) {
    const t = x?.tipo; const id = ID.test(x?.id ?? '') ? x.id : '';
    const base = { id, tipo: t, color: color(x?.color), texto: str(x?.texto, 140), sub: str(x?.sub, 80), oculto: !!x?.oculto };
    if (t === 'caja' || t === 'circulo') els.push({ ...base, x: num(x.x, 0, ancho, 0), y: num(x.y, 0, alto, 0), w: num(x.w ?? (x.r ?? 20) * 2, 4, ancho, 80), h: num(x.h ?? (x.r ?? 20) * 2, 4, alto, 40), estilo: ['contenedor', 'resaltado', 'tenue'].includes(x.estilo) ? x.estilo : '' });
    else if (t === 'texto') els.push({ ...base, x: num(x.x, 0, ancho, 0), y: num(x.y, 0, alto, 0), tam: num(x.tam, 9, 40, 15), alinear: ['inicio', 'medio', 'fin'].includes(x.alinear) ? x.alinear : 'inicio' });
    else if (t === 'linea') els.push({ ...base, x1: num(x.x1, 0, ancho, 0), y1: num(x.y1, 0, alto, 0), x2: num(x.x2, 0, ancho, 0), y2: num(x.y2, 0, alto, 0) });
    else if (t === 'flecha') els.push({ ...base, de: REF.test(x.de ?? '') ? x.de : '', a: REF.test(x.a ?? '') ? x.a : '', x1: num(x.x1, 0, ancho, NaN), y1: num(x.y1, 0, alto, NaN), x2: num(x.x2, 0, ancho, NaN), y2: num(x.y2, 0, alto, NaN) });
    else if (t === 'celdas') {
      const n = Math.round(num(x.n ?? x.textos?.length, 1, 64, 8));
      els.push({ ...base, x: num(x.x, 0, ancho, 0), y: num(x.y, 0, alto, 0), n, w: num(x.w, 8, 300, 56), h: num(x.h, 8, 200, 36), vertical: !!x.vertical,
        textos: Array.from({ length: n }, (_, i) => str(x.textos?.[i], 40)), etiquetas: Array.from({ length: n }, (_, i) => str(x.etiquetas?.[i], 30)) });
    } else if (t === 'tabla') {
      const columnas = list(x.columnas, 10).map((c) => str(c, 40));
      const filas = list(x.filas, 24).map((r) => columnas.map((_, j) => str(list(r, 10)[j], 40)));
      if (columnas.length) els.push({ ...base, x: num(x.x, 0, ancho, 0), y: num(x.y, 0, alto, 0), columnas, filas, anchoCol: num(x.anchoCol, 30, 400, 110), alto: num(x.altoFila, 16, 80, 30) });
    }
  }
  const pasos = list(e.pasos, 60).map((p) => ({
    texto: str(p?.texto, 400), comando: str(p?.comando, 300),
    mostrar: list(p?.mostrar, 60).filter((r) => REF.test(r)), ocultar: list(p?.ocultar, 60).filter((r) => REF.test(r)),
    resaltar: list(p?.resaltar, 60).filter((r) => REF.test(r)),
    cambiar: list(p?.cambiar, 60).filter((c) => REF.test(c?.id ?? '')).map((c) => ({ id: c.id, texto: c.texto === undefined ? undefined : str(c.texto, 140), color: c.color === undefined ? undefined : color(c.color) })),
    mover: list(p?.mover, 30).filter((m) => REF.test(m?.id ?? '')).map((m) => ({ id: m.id, x: num(m.x, 0, ancho, 0), y: num(m.y, 0, alto, 0) })),
  })).filter((p) => p.texto);
  if (!els.length) return null;
  return { titulo: str(e.titulo, 160), ancho, alto, elementos: els, pasos };
}

/* ---------- drawing ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Every shape, cell and table cell as a box with an id, for arrows to find and steps to change.
function boxes(e) {
  const out = new Map();
  for (const x of e.elementos) {
    if (x.tipo === 'caja' || x.tipo === 'circulo') out.set(x.id, { x: x.x, y: x.y, w: x.w, h: x.h });
    if (x.tipo === 'celdas') for (let i = 0; i < x.n; i += 1) out.set(`${x.id}.${i}`, { x: x.x + (x.vertical ? 0 : i * x.w), y: x.y + (x.vertical ? i * x.h : 0), w: x.w, h: x.h });
    if (x.tipo === 'tabla') {
      x.columnas.forEach((_, j) => out.set(`${x.id}.h.${j}`, { x: x.x + j * x.anchoCol, y: x.y, w: x.anchoCol, h: x.alto }));
      x.filas.forEach((r, i) => r.forEach((_, j) => out.set(`${x.id}.${i}.${j}`, { x: x.x + j * x.anchoCol, y: x.y + (i + 1) * x.alto, w: x.anchoCol, h: x.alto })));
      out.set(x.id, { x: x.x, y: x.y, w: x.columnas.length * x.anchoCol, h: (x.filas.length + 1) * x.alto });
    }
    if (x.tipo === 'celdas') out.set(x.id, { x: x.x, y: x.y, w: x.vertical ? x.w : x.w * x.n, h: x.vertical ? x.h * x.n : x.h });
  }
  return out;
}
// The point where a line from one box toward another leaves it.
function edge(b, toward) {
  const cx = b.x + b.w / 2; const cy = b.y + b.h / 2;
  const dx = toward.x - cx; const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs((b.w / 2) / (dx || 1e-9)), Math.abs((b.h / 2) / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
function rectHTML(id, b, text, sub, cls, col, round = 8, top = false) {
  const ty = top ? b.y + 20 : b.y + b.h / 2 + (sub ? -4 : 5);
  return `<g class="es-el ${cls}" data-es="${esc(id)}" data-col="${col}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${round}"/>
    <text class="es-t" x="${b.x + b.w / 2}" y="${ty}" text-anchor="middle">${esc(text)}</text>${sub ? `<text class="es-s" x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 13}" text-anchor="middle">${esc(sub)}</text>` : ''}</g>`;
}
export function escenaSVG(e) {
  const bx = boxes(e);
  const parts = [];
  for (const x of e.elementos) {
    const hid = x.oculto ? ' es-hidden' : '';
    if (x.tipo === 'caja') parts.push(rectHTML(x.id, bx.get(x.id), x.texto, x.sub, `es-caja ${x.estilo ? `es-${x.estilo}` : ''}${hid}`, x.color, x.estilo === 'contenedor' ? 14 : 8, x.estilo === 'contenedor'));
    if (x.tipo === 'circulo') { const b = bx.get(x.id); parts.push(`<g class="es-el es-circ${hid}" data-es="${esc(x.id)}" data-col="${x.color}"><ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}"/><text class="es-t" x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 5}" text-anchor="middle">${esc(x.texto)}</text></g>`); }
    if (x.tipo === 'texto') parts.push(`<g class="es-el es-label${hid}" data-es="${esc(x.id)}" data-col="${x.color}"><text x="${x.x}" y="${x.y}" font-size="${x.tam}" text-anchor="${{ inicio: 'start', medio: 'middle', fin: 'end' }[x.alinear]}">${esc(x.texto)}</text></g>`);
    if (x.tipo === 'linea') parts.push(`<g class="es-el es-line${hid}" data-es="${esc(x.id)}" data-col="${x.color}"><line x1="${x.x1}" y1="${x.y1}" x2="${x.x2}" y2="${x.y2}"/></g>`);
    if (x.tipo === 'celdas') {
      const g = [];
      for (let i = 0; i < x.n; i += 1) {
        const b = bx.get(`${x.id}.${i}`);
        g.push(rectHTML(`${x.id}.${i}`, b, x.textos[i], '', 'es-cell', x.color, 3));
        if (x.etiquetas[i]) g.push(`<text class="es-addr" x="${x.vertical ? b.x - 6 : b.x + b.w / 2}" y="${x.vertical ? b.y + b.h / 2 + 4 : b.y - 6}" text-anchor="${x.vertical ? 'end' : 'middle'}">${esc(x.etiquetas[i])}</text>`);
      }
      parts.push(`<g class="es-el es-cells${hid}" data-es="${esc(x.id)}">${x.texto ? `<text class="es-label" x="${x.x}" y="${x.y - (x.etiquetas.some(Boolean) && !x.vertical ? 22 : 8)}">${esc(x.texto)}</text>` : ''}${g.join('')}</g>`);
    }
    if (x.tipo === 'tabla') {
      const g = [];
      x.columnas.forEach((c, j) => g.push(rectHTML(`${x.id}.h.${j}`, bx.get(`${x.id}.h.${j}`), c, '', 'es-th', x.color, 0)));
      x.filas.forEach((r, i) => r.forEach((v, j) => g.push(rectHTML(`${x.id}.${i}.${j}`, bx.get(`${x.id}.${i}.${j}`), v, '', 'es-td', '', 0))));
      parts.push(`<g class="es-el es-table${hid}" data-es="${esc(x.id)}">${x.texto ? `<text class="es-label" x="${x.x}" y="${x.y - 8}">${esc(x.texto)}</text>` : ''}${g.join('')}</g>`);
    }
  }
  // Arrows last, over the shapes, from the edge of one box to the edge of the other.
  for (const x of e.elementos.filter((y) => y.tipo === 'flecha')) {
    const a = bx.get(x.de); const b = bx.get(x.a);
    let p1; let p2;
    if (a && b) { p1 = edge(a, center(b)); p2 = edge(b, center(a)); } else if (Number.isFinite(x.x1) && Number.isFinite(x.x2)) { p1 = { x: x.x1, y: x.y1 }; p2 = { x: x.x2, y: x.y2 }; } else continue;
    parts.push(`<g class="es-el es-arrow${x.oculto ? ' es-hidden' : ''}" data-es="${esc(x.id || `${x.de}-${x.a}`)}" data-col="${x.color}"><line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" marker-end="url(#es-head)"/>${x.texto ? `<text class="es-s" x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 6}" text-anchor="middle">${esc(x.texto)}</text>` : ''}</g>`);
  }
  return `<svg class="es-svg" viewBox="0 0 ${e.ancho} ${e.alto}" role="img" aria-label="${esc(e.titulo || 'Escena')}"><defs><marker id="es-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>${parts.join('')}</svg>`;
}
export function escenaHTML(key, e) {
  if (!e) return '';
  const steps = e.pasos.length;
  return `<figure class="escena" data-escena="${esc(key)}">${e.titulo ? `<figcaption>${esc(e.titulo)}</figcaption>` : ''}${escenaSVG(e)}
    ${steps ? `<div class="walk-bar"><button type="button" class="ask" data-tj="es-go" data-go="-1" aria-label="Anterior">◀</button><button type="button" class="act" data-tj="es-go" data-go="play">▶ Reproducir</button><button type="button" class="ask" data-tj="es-go" data-go="1" aria-label="Siguiente">▶</button><span class="walk-n mut small" data-es-n>0 de ${steps}</span></div>
    <ol class="walk-steps es-steps">${e.pasos.map((p, i) => `<li data-i="${i}"><span class="es-num">${i + 1}</span><span>${esc(p.texto)}</span>${p.comando ? `<code>${esc(p.comando)}</code>` : ''}</li>`).join('')}</ol>` : ''}</figure>`;
}
// The picture after steps 0…i (i = -1: as drawn): each step's changes are kept by the next ones.
export function escenaShow(fig, e, i) {
  const svg = fig.querySelector('svg');
  if (!svg) return;
  const at = (ref) => svg.querySelector(`[data-es="${CSS.escape(ref)}"]`);
  // Back to the picture as drawn.
  for (const g of svg.querySelectorAll('.es-el, .es-cell, .es-th, .es-td')) {
    g.classList.remove('es-lit', 'es-shown', 'es-gone');
    g.style.transform = '';
    if (g.dataset.t0 !== undefined) { const t = g.querySelector('.es-t'); if (t) t.textContent = g.dataset.t0; }
    if (g.dataset.c0 !== undefined) g.dataset.col = g.dataset.c0;
  }
  for (let k = 0; k <= i && k < e.pasos.length; k += 1) {
    const p = e.pasos[k];
    for (const r of p.mostrar) at(r)?.classList.add('es-shown');
    for (const r of p.ocultar) at(r)?.classList.add('es-gone');
    for (const c of p.cambiar) {
      const g = at(c.id);
      if (!g) continue;
      const t = g.querySelector('.es-t');
      if (c.texto !== undefined && t) { if (g.dataset.t0 === undefined) g.dataset.t0 = t.textContent; t.textContent = c.texto; }
      if (c.color !== undefined) { if (g.dataset.c0 === undefined) g.dataset.c0 = g.dataset.col ?? ''; g.dataset.col = c.color; }
    }
    for (const m of p.mover) {
      const g = at(m.id);
      const b = g?.querySelector('rect, ellipse');
      if (!b) continue;
      const x0 = Number(b.getAttribute('x') ?? Number(b.getAttribute('cx')) - Number(b.getAttribute('rx')));
      const y0 = Number(b.getAttribute('y') ?? Number(b.getAttribute('cy')) - Number(b.getAttribute('ry')));
      g.style.transform = `translate(${m.x - x0}px, ${m.y - y0}px)`;
    }
  }
  // What this step points at, lit.
  if (i >= 0 && e.pasos[i]) for (const r of [...e.pasos[i].resaltar, ...e.pasos[i].cambiar.map((c) => c.id), ...e.pasos[i].mostrar]) at(r)?.classList.add('es-lit');
  fig.querySelectorAll('.es-steps li').forEach((li, k) => li.classList.toggle('on', k === i));
  const n = fig.querySelector('[data-es-n]');
  if (n) n.textContent = `${Math.max(0, i + 1)} de ${e.pasos.length}`;
}
