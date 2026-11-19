// Reads the text a student copies from USFQ's course offering (catalogodecursos.usfq.edu.ec), as it comes: one section
// or a whole page of results. No AI and no request anywhere: the page's own words are enough. Each section gives its
// code, NRC, name, parallel, kind (theory, exercises, lab…), the group that ties a theory to its exercises or lab
// («Agrupado con | VZ | | V0 |»), its days and hours, building and room, professor and credits.
const DAY = { lunes: 0, martes: 1, 'miércoles': 2, miercoles: 2, jueves: 3, viernes: 4, 'sábado': 5, sabado: 5 };
const clock = (s) => Number(s.slice(0, -2)) * 60 + Number(s.slice(-2));
const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export function parseOffer(text) {
  const src = String(text ?? '').replace(/\r/g, '');
  const term = src.match(/\((\d{6})\)/)?.[1] ?? '';
  const lines = src.split('\n');
  // A section starts where a course code is followed, on the next non-empty line, by its NRC.
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i].trim().match(/^([A-Z]{3,4}-\d{3,4}[A-Z]?)$/);
    if (!code) continue;
    let j = i + 1; while (j < lines.length && !lines[j].trim()) j += 1;
    if (/^\d{3,6}$/.test(lines[j]?.trim() ?? '')) starts.push({ i, code: code[1], nrc: lines[j].trim(), nameAt: j + 1 });
  }
  const sections = starts.map((st, k) => {
    const block = lines.slice(st.i, starts[k + 1]?.i ?? lines.length);
    const body = block.join('\n');
    let n = st.nameAt - st.i; while (n < block.length && !block[n].trim()) n += 1;
    const name = (block[n] ?? '').trim();
    const kind = body.match(/Curso de:\s*([^\n]+)/)?.[1].trim() ?? '';
    const group = (body.match(/Agrupado con([^)\n]*)\)?/)?.[1] ?? '').split('|').map((x) => x.trim()).filter(Boolean).sort().join(' ');
    // Every «Horario:» line with the hours on the line after it.
    const slots = [];
    for (let i = 0; i < block.length; i += 1) {
      const h = block[i].match(/Horario:\s*(.+)/);
      if (!h) continue;
      const hours = (block[i + 1] ?? '').match(/(\d{4})\s*-\s*(\d{4})/);
      if (!hours) continue;
      const days = h[1].toLowerCase().split(/\s+/).map((d) => DAY[d]).filter((d) => d !== undefined);
      for (const d of days) slots.push({ d, s: clock(hours[1]), e: clock(hours[2]) });
    }
    const place = body.match(/Edificio:[ \t]*([^\n]*?)[ \t]*Aula:[ \t]*([^\s]*)/);
    const building = place?.[1].trim() ?? '';
    const letter = building.match(/\(([A-Z]{1,3})\)/)?.[1] ?? '';
    const aula = place?.[2].trim() ?? '';
    const room = aula ? (/^[A-Z]/.test(aula) || !letter ? aula : `${letter}${aula}`) : '';
    const prof = block.map((l) => l.match(/^\d{2}\/\d{2}\/\d{4}[\t ]{1,}(\S.*)$/)).find((m) => m && !m[1].includes('|'))?.[1].trim() ?? '';
    const credits = Number(block.map((l) => l.match(/^(\d{1,2})[\t ]+\S/)).find(Boolean)?.[1] ?? 0);
    const section = body.match(/Paralelo:\s*(\d+)/)?.[1] ?? '';
    return { code: st.code, nrc: st.nrc, name, kind: kind ? titleCase(kind) : '', group, section, slots, building: building.replace(/\s*\([A-Z]{1,3}\)\s*/, '').trim(), room, prof, credits };
  });
  // The same NRC copied twice (a page and the next one overlap) counts once.
  const seen = new Set();
  return { term, sections: sections.filter((s) => s.slots.length && !seen.has(s.nrc) && seen.add(s.nrc)) };
}

// The term's code, said in words: 202610 is the first semester of 2026–2027.
export function termName(code) {
  const m = String(code).match(/^(\d{4})(\d)0$/);
  if (!m) return '';
  const y = Number(m[1]);
  return `${{ 1: 'Primer Semestre', 2: 'Segundo Semestre', 3: 'Verano' }[m[2]] ?? 'Periodo'} ${y}–${y + 1}`;
}
// The sections that go with this one: the same course and the same group, of another kind (its exercises, its lab).
export const partners = (sec, all) => (sec.group ? all.filter((x) => x !== sec && x.code === sec.code && x.group === sec.group && x.kind !== sec.kind) : []);
