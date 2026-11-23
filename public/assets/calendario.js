// The official academic calendar: when there are classes, when not, and when the final exams are. Classes are shown
// only while they happen (his words, 2026-11-23: classes end on 9 December; after that day Studium stops showing them).
// Source: USFQ, «Calendario académico, Primer Semestre 2026-2027 (202610)», version of August 2026:
// https://www.usfq.edu.ec/sites/default/files/2026-08/calendario_academico_usfq_primer_semestre_2026-2027_202610.pdf
// A new term is one more entry here, from its official calendar.

export const TERMS = [
  {
    code: '202610', name: 'Primer semestre 2026-2027', source: 'https://www.usfq.edu.ec/sites/default/files/2026-08/calendario_academico_usfq_primer_semestre_2026-2027_202610.pdf',
    classes: ['2026-08-17', '2026-12-09'], finals: ['2026-12-11', '2026-12-18'], end: '2026-12-18',
    // Days without classes (they do not apply to online courses or to Medicine's rotating internship).
    off: [
      ['2026-08-08', '2026-08-10', 'Primer Grito de Independencia'],
      ['2026-10-09', '2026-10-18', 'Receso de medio semestre e Independencia de Guayaquil'],
      ['2026-10-31', '2026-11-03', 'Difuntos e Independencia de Cuenca'],
      ['2026-12-05', '2026-12-07', 'Fundación de Quito'],
      ['2026-12-19', '2027-01-11', 'Vacaciones de Navidad'],
    ],
    // Dates worth knowing, shown in the month of «Mi horario».
    dates: [
      ['2026-08-25', 'Último día para agregar o cambiar materias'],
      ['2026-10-23', 'Notas de medio semestre'],
      ['2026-11-15', 'Último día para retirarse con W'],
      ['2026-11-30', 'Contacto Empresarial'],
      ['2026-12-09', 'Último día de clases'],
      ['2026-12-11', 'Empiezan los exámenes finales'],
      ['2026-12-18', 'Terminan los exámenes finales'],
      ['2026-12-22', 'Notas finales en Banner'],
    ],
    // «Calendario de Exámenes Finales», USFQ Registro, Primer Semestre 2026/2027 (a picture in the students' SharePoint,
    // behind the university login; transcribed from his screenshot of 2026-11-23). Days: 0 Monday … 5 Saturday.
    exams: {
      source: 'USFQ Registro, «Calendario de Exámenes Finales, Primer Semestre 2026/2027» (SharePoint de estudiantes)',
      byClass: [
        [[0, 2], '11:30', '2026-12-14', '09:00', '11:00'], [[0, 2], '14:30', '2026-12-14', '12:00', '14:00'], [[0, 2], '16:00', '2026-12-14', '15:00', '17:00'],
        [[1, 3], '11:30', '2026-12-15', '09:00', '11:00'], [[1, 3], '14:30', '2026-12-15', '12:00', '14:00'], [[1, 3], '16:00', '2026-12-15', '15:00', '17:00'],
        [[0, 2], '08:30', '2026-12-16', '12:00', '14:00'], [[0, 2], '10:00', '2026-12-16', '09:00', '11:00'], [[0, 2], '13:00', '2026-12-16', '15:00', '17:00'],
        [[1, 3], '08:30', '2026-12-17', '12:00', '14:00'], [[1, 3], '10:00', '2026-12-17', '09:00', '11:00'], [[1, 3], '13:00', '2026-12-17', '15:00', '17:00'],
        [[0, 2], '07:00', '2026-12-18', '09:00', '11:00'], [[0, 2], '17:30', '2026-12-18', '15:00', '17:00'], [[1, 3], '07:00', '2026-12-18', '12:00', '14:00'], [[1, 3], '17:30', '2026-12-18', '18:00', '20:00'],
      ].map(([days, start, date, from, to]) => ({ days, start, date, from, to })),
      // Departmental exams: one exam for every section of a course area. Matched by the course's code or name.
      departmental: [
        { name: 'Química', code: /^QUI/i, words: /qu[ií]mica/i, date: '2026-12-11', from: '09:00', to: '12:00' },
        { name: 'Arquitectura', code: /^ARQ/i, words: /^$/, date: '2026-12-11', from: '09:00', to: '14:00' },
        { name: 'Biología General', code: /^$/, words: /biolog[ií]a general/i, date: '2026-12-11', from: '15:00', to: '18:00' },
        { name: 'Matemáticas', code: /^MAT/i, words: /^$/, date: '2026-12-12', from: '09:00', to: '14:00' },
        { name: 'Inglés (niveles ESL 1 a 6)', code: /^ESL/i, words: /\bESL\b|ingl[eé]s/i, date: '2026-12-11', from: '08:00', to: '18:00', choose: 'Eliges una hora el viernes 11 o el sábado 12, entre 08:00 y 18:00; dura 1 h 15.' },
      ],
      notes: ['Puedes tener hasta 3 exámenes en un día; si te tocan más, habla con tus profesores para buscar alternativas.', 'Si tu clase tiene otro horario que los de la tabla, tu profesor coordina contigo la hora del final.'],
    },
  },
];

export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const within = (day, [a, b]) => day >= a && day <= b;
export const termOf = (day) => TERMS.find((t) => day >= t.classes[0] && day <= t.end) ?? null;
// What a day is, for classes: 'classes', 'off' (a holiday, with its name), 'finals', 'after' (classes ended), 'none'.
export function dayStatus(date = new Date()) {
  const day = typeof date === 'string' ? date : iso(date);
  const off = TERMS.flatMap((t) => t.off).find((o) => within(day, o));
  if (off) return { kind: 'off', name: off[2], until: off[1] };
  const t = termOf(day);
  if (!t) {
    const next = TERMS.find((x) => x.classes[0] > day);
    return { kind: 'none', next };
  }
  if (within(day, t.classes)) return { kind: 'classes', term: t };
  if (within(day, t.finals)) return { kind: 'finals', term: t };
  return { kind: 'after', term: t };
}
// Whether the classes of the week are still on: a week entirely after the last day of classes has none.
export function classesThisWeek(date = new Date()) {
  const monday = new Date(date); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days = Array.from({ length: 6 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return iso(d); });
  return days.some((d) => dayStatus(d).kind === 'classes');
}
// For each day of a week (Monday first), the holiday that falls on it, if any.
export function weekOff(date = new Date()) {
  const monday = new Date(date); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); const s = dayStatus(d); return s.kind === 'off' ? s.name : s.kind === 'classes' ? '' : s.kind; });
}
export const longDay = (day) => new Date(`${day}T12:00`).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });

/* ---------- final exams: when each class has its final ---------- */
// The term's table, or one the person transcribed with their AI when Studium does not have it yet (kept on this device).
const OWN = (code) => `studium-finales-${code}`;
export function examTable(term) {
  if (term?.exams) return term.exams;
  try {
    const t = JSON.parse(localStorage.getItem(OWN(term?.code)) ?? 'null');
    return t?.byClass?.length ? { ...t, own: true, departmental: (t.departmental ?? []).map((d) => ({ ...d, code: /^$/, words: new RegExp(String(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })) } : null;
  } catch { return null; }
}
export function keepOwnTable(term, table) { try { localStorage.setItem(OWN(term.code), JSON.stringify(table)); } catch { /* this time only */ } }
const minOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
// One class of «Mi horario» (its slots: d = day, s = start in minutes): a departmental exam, its slot in the table, or
// «coordinate with the professor» (another schedule). Exercises and labs have no final of their own.
export function finalFor(c, term = TERMS[0]) {
  const table = examTable(term);
  if (!table || !c?.slots?.length) return null;
  const theory = !c.kind || /^teor/i.test(c.kind);
  if (!theory) return null;
  const dep = table.departmental.find((d) => d.code.test(c.code ?? '') || d.words.test(c.name ?? ''));
  if (dep) return { kind: 'departamental', name: dep.name, date: dep.date, from: dep.from, to: dep.to, choose: dep.choose ?? '' };
  const days = [...new Set(c.slots.map((x) => x.d))].sort();
  const starts = [...new Set(c.slots.map((x) => x.s))];
  const hit = starts.length === 1 && table.byClass.find((r) => r.days.length === days.length && r.days.every((d, i) => d === days[i]) && Math.abs(minOf(r.start) - starts[0]) <= 10);
  if (hit) return { kind: 'materia', date: hit.date, from: hit.from, to: hit.to };
  return { kind: 'coordinar' };
}
