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
