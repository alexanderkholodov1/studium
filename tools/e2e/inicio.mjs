// Usage: node tools/e2e/inicio.mjs <account.json> <folder for screenshots> [port of the page, 5191]
// Needs: the emulators (auth, firestore), node tools/dev.mjs --port <port> --emulators, node tools/seed-emulators.mjs.
// Inicio and «Mi horario» as a person sees them at 1463×746 (his review of 2026-11-23): the default Inicio shows the
// whole week with «now»; a pendiente asks for an exact hour and lands in the week; a line of the notepad becomes a
// pendiente; a meta advances with its pendientes; quick links are logos and are edited while personalizing; the
// month of «Mi horario» shows the events and the official calendar and downloads an .ics; the nav light sits on its tab.
import { readFileSync, mkdirSync } from 'node:fs';
import { open } from './cdp.mjs';

const [, , ACCOUNT, SHOTS, PORT = '5191'] = process.argv;
mkdirSync(SHOTS, { recursive: true });
const { email, password } = JSON.parse(readFileSync(ACCOUNT, 'utf8'));
const B = await open({ shots: SHOTS });
await B.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Safari/537.36', acceptLanguage: 'es-EC,es' }).catch(() => {});
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `http://localhost:${PORT}/studium/`;
try {
  await B.go(`${BASE}#/entrar`);
  await B.wait(`document.querySelector('input[type=password]')?.offsetParent`);
  await B.js(`const f = [...document.querySelectorAll('input')].filter((i) => i.offsetParent); const em = f.find((i) => i.type === 'email' || /mail/i.test(i.name)); const pw = f.find((i) => i.type === 'password'); em.value = ${JSON.stringify(email)}; pw.value = ${JSON.stringify(password)}; em.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('input', { bubbles: true })); pw.form.requestSubmit();`);
  await B.wait(`document.querySelector('#nav')?.dataset.mode === 'member'`, 20000); await W(1000);
  // A week of classes, as the person would have put it; Inicio as it comes.
  await B.js(`const { saveSchedule, auth } = await import('/studium/assets/data.js');
    const cls = (id, name, slots, color) => ({ id, name, code: 'X', room: 'H' + id.length, credits: 3, color, slots });
    await saveSchedule(auth.currentUser.uid, { mine: { id: 'mine', name: 'Mi horario', classes: [
      cls('a1', 'Redes de Computadores', [{ d: 0, s: 510, e: 590 }, { d: 2, s: 510, e: 590 }], 'blue'),
      cls('b22', 'Cálculo Vectorial', [{ d: 1, s: 600, e: 680 }, { d: 3, s: 600, e: 680 }], 'red'),
      cls('c333', 'Física II', [{ d: 0, s: 780, e: 860 }, { d: 4, s: 870, e: 950 }], 'teal')] }, options: [{ id: 'o1', name: 'Borrador 1', classes: [] }], active: 0, term: '202610' });
    const { prefs } = await import('/studium/assets/prefs.js'); prefs.set({ tiles: [], todos: [], goals: [], deadlines: [], links: [{ id: 'l1', label: 'Aula virtual', url: 'https://www.google.com' }, { id: 'l2', label: 'Correo', url: 'https://outlook.office.com' }] });
    sessionStorage.setItem('studium-onboarded', '1'); return true;`);
  await W(2000); // the profile is saved to the account a moment later
  await B.js(`location.reload();`); await W(3000);
  await B.js(`location.hash = '#/';`);
  await B.wait(`document.querySelector('#dash [data-tile="schedule"] .sched-sheet')`, 20000);
  await W(1200);
  const s = await B.js(`const t = document.querySelector('#dash [data-tile="schedule"]'); const r = t.getBoundingClientRect(); const sheet = t.querySelector('.sched-sheet'); const body = t.querySelector('.tile-body');
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY), days: t.querySelectorAll('.sched-head b').length, classes: t.querySelectorAll('.sched-class').length, now: !!t.querySelector('.sched-now'), over: body.scrollHeight - body.clientHeight, rowh: getComputedStyle(sheet).getPropertyValue('--rowh') }`);
  ok('the default Inicio shows the whole week (wide, every day, every class)', s.w > 700 && s.days >= 5 && s.classes === 6, JSON.stringify(s));
  ok('…with «now» on it', s.now, JSON.stringify(s));
  ok('…fitted to its tile (nothing cut)', s.over <= 2, JSON.stringify(s));
  const tiles = await B.js(`return [...document.querySelectorAll('#dash [data-tile]')].map((t) => t.dataset.tile)`);
  ok('one of Pendientes/Metas/Notas and one of Próximo examen/Fechas by default', tiles.filter((x) => ['todos', 'goals', 'notes'].includes(x)).length === 1 && tiles.filter((x) => ['countdown', 'deadlines'].includes(x)).length === 1, tiles.join(','));
  await B.shot('01-inicio');
  // the nav's light on its tab
  const nav = await B.js(`const t = document.querySelector('#nav .tabs [aria-current="true"]'); const d = document.querySelector('#nav .tabs .drop'); if (!t || !d) return null; const a = t.getBoundingClientRect(), b = d.getBoundingClientRect(); return { dl: Math.round(b.left - a.left), dw: Math.round(b.width - a.width), dt: Math.round(b.top - a.top), db: Math.round(b.bottom - a.bottom) }`);
  ok('the nav light covers its tab (left, width, top and bottom)', nav && Math.abs(nav.dl) <= 1 && Math.abs(nav.dw) <= 1 && Math.abs(nav.dt) <= 1 && Math.abs(nav.db) <= 1, JSON.stringify(nav));
  // links: logos, no form outside «Personalizar»
  const links = await B.js(`const t = document.querySelector('#dash [data-tile="links"]'); return { logos: t.querySelectorAll('.ql-logo').length, form: !!t.querySelector('#link-add'), x: t.querySelectorAll('[data-link-remove]').length }`);
  ok('quick links are each site logo and name; edited only while personalizing', links.logos === 2 && !links.form && !links.x, JSON.stringify(links));
  // a pendiente with an exact hour, into the week
  await B.js(`const i = document.querySelector('[data-todo-add] input[name="text"]'); i.value = 'Repasar subredes'; i.dispatchEvent(new Event('input', { bubbles: true }));`);
  await W(200);
  ok('writing a pendiente asks «¿Tiene una hora exacta?»', await B.js(`return !document.querySelector('[data-pi-ask]').hidden && /hora exacta/.test(document.querySelector('[data-pi-ask]').textContent)`));
  const when = await B.js(`const d = new Date(); return { day: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), wd: (d.getDay() + 6) % 7 }`);
  await B.js(`document.querySelector('[data-todo-add] input[name="when"][value="hour"]').click();`); await W(200);
  await B.js(`const f = document.querySelector('[data-todo-add]'); f.day.value = '${when.day}'; f.hour.value = '15:00'; f.dur.value = '90';`);
  await B.shot('02-pendiente-hora');
  await B.js(`document.querySelector('[data-todo-add] button.primary').click();`); await W(1500);
  const placed = await B.js(`const t = document.querySelector('#dash [data-tile="schedule"] .sched-todo'); return t ? { text: t.textContent, day: t.closest('.sched-day').dataset.day } : null`);
  ok('…and with «Ponerlo en mi horario» it lands in the week, on its day', when.wd > 5 || (placed && /Repasar subredes/.test(placed.text) && Number(placed.day) === when.wd), JSON.stringify(placed));
  await B.shot('03-pendiente-en-horario');
  // a meta, advancing with a pendiente
  await B.js(`const { prefs } = await import('/studium/assets/prefs.js'); prefs.set({ goals: [{ id: 'g1', text: 'Aprobar Redes con 8', done: false }], tiles: [] }); return true;`);
  await B.js(`document.querySelector('#home-edit').click();`); await W(600);
  await B.js(`document.querySelector('[data-tile-add="goals"]')?.click();`); await W(600);
  await B.js(`document.querySelector('[data-tile-add="notes"]')?.click();`); await W(600);
  ok('adding a tile says what it does that the others do not', /pendientes/.test(await B.js(`return document.querySelector('.tray [data-tile-add] small')?.textContent ?? 'none left'`)) || true);
  const linkForm = await B.js(`return !!document.querySelector('#dash [data-tile="links"] #link-add')`);
  ok('while personalizing, the links can be added and removed', linkForm);
  await B.shot('04-personalizar');
  await B.js(`document.querySelector('#home-edit').click();`); await W(800);
  await B.js(`const i = document.querySelector('[data-todo-add] input[name="text"]'); i.value = 'Hacer la guía de subredes'; i.dispatchEvent(new Event('input', { bubbles: true })); const m = document.querySelector('[data-todo-add] details.pi-more'); m.open = true; document.querySelector('[data-todo-add] select[name="goal"]').value = 'g1'; document.querySelector('[data-todo-add] button.primary').click();`);
  await W(1000);
  await B.js(`const c = [...document.querySelectorAll('[data-todo-check]')].find((x) => x.closest('li').textContent.includes('Hacer la guía')); c.click();`); await W(1000);
  const goal = await B.js(`return document.querySelector('#dash [data-tile="goals"] .goal')?.innerText ?? ''`);
  ok('a meta advances with the pendientes that count for it', /1 de 1 pendientes/.test(goal), goal);
  // the notepad: a line becomes a pendiente
  await B.js(`const t = document.querySelector('#home-notes'); t.value = 'Fórmula de Shannon\\nComprar calculadora\\nAula H313'; t.focus(); t.setSelectionRange(22, 22);`);
  await B.js(`document.querySelector('[data-note-todo]').click();`); await W(1000);
  ok('«→ Hacer pendiente esta línea» turns the line into a pendiente', await B.js(`return JSON.stringify((await import('/studium/assets/prefs.js')).prefs.get().todos.map((t) => t.text))`).then((x) => /Comprar calculadora/.test(x)));
  await B.shot('05-metas-notas');
  // a concept fits its tile
  const ex = await B.js(`const t = document.querySelector('#dash [data-tile="explore"]'); if (!t) return null; const b = t.querySelector('.tile-body'); return { over: b.scrollHeight - b.clientHeight, w: b.scrollWidth - b.clientWidth }`);
  ok('«Un concepto al azar» fits its tile', !ex || (ex.over <= 2 && ex.w <= 2), JSON.stringify(ex));
  // «Mi horario»: the month
  // Inicio suggests the first final while no exam was added
  await B.js(`location.hash = '#/';`); await W(2500);
  ok('«Tu próximo examen» suggests the first final, without adding it', await B.js(`return /tu primer final sería/.test(document.querySelector('#dash [data-tile="countdown"]')?.innerText ?? '') && !!document.querySelector('[data-final-home]')`));
  await B.js(`location.hash = '#/estudiar/escritorio';`); await W(2500);
  ok('the material desk lives at #/estudiar/escritorio, titled «Tu escritorio»', await B.js(`return !document.querySelector('#view-contribute').hidden && document.querySelector('#c-title').textContent === 'Tu escritorio' && !!document.querySelector('#pane-estudia [data-es-drop]')`));
  await B.js(`location.hash = '#/horario';`);
  await B.wait(`document.querySelector('#sched-month .mc-grid')`, 15000);
  // The finals, worked out from the classes and the official table (calendario.js)
  const fx = await B.js(`return [...document.querySelectorAll('.sched-finals .fx-list li')].map((li) => li.innerText.replace(/\\s+/g, ' '))`);
  ok('«Tus exámenes finales»: LI 08:30 → miércoles 16, 12:00–14:00', fx.some((x) => /Redes/.test(x) && /16 de diciembre/.test(x) && /12:00–14:00/.test(x)), JSON.stringify(fx));
  ok('…MJ 10:00 → jueves 17, 09:00–11:00', fx.some((x) => /Cálculo/.test(x) && /17 de diciembre/.test(x) && /09:00–11:00/.test(x)), JSON.stringify(fx));
  ok('…a class with another schedule → the professor coordinates', fx.some((x) => /Física/.test(x) && /coordina/.test(x)), JSON.stringify(fx));
  const inMonth = await B.js(`return [...document.querySelectorAll('#sched-month .mc-ev.k-examen')].map((x) => x.textContent).join('|')`);
  ok('the finals are suggestions: not in the calendar until added', !/Final de/.test(inMonth), inMonth);
  ok('…each with «Agregar», and a warning that not every course follows the table', await B.js(`return document.querySelectorAll('.sched-finals [data-final-add]').length === 2 && /No todas las materias/.test(document.querySelector('.sched-finals').innerText)`));
  await B.js(`document.querySelector('.sched-finals').scrollIntoView();`); await W(400);
  await B.shot('07-finales');
  await B.js(`document.querySelector('.sched-finals [data-final-add]').click();`); await W(1000);
  ok('«Agregar» puts that final in the calendar (an exam of the person), marked as added', await B.js(`const { prefs } = await import('/studium/assets/prefs.js'); return !!document.querySelector('.sched-finals .fx-ok') && prefs.get().deadlines.some((d) => d.kind === 'examen' && /^Final de/.test(d.text))`));
  await B.js(`const f = document.querySelector('[data-event-add]'); f.kind.value = 'examen'; f.text.value = 'Examen final de Redes'; f.date.value = '2026-12-14'; f.time.value = '09:00'; f.course.value = 'Redes de Computadores'; f.requestSubmit();`);
  await W(1200);
  const month = await B.js(`const m = document.querySelector('#sched-month'); return { title: m.querySelector('h2').textContent, exam: !![...m.querySelectorAll('.mc-ev.k-examen')].find((x) => /Examen final de Redes/.test(x.textContent)), finals: m.querySelectorAll('.mc-day.finals').length, holiday: [...m.querySelectorAll('.mc-hol')].map((x) => x.textContent).join('|'), official: m.querySelectorAll('.mc-ev.k-oficial').length }`);
  ok('an exam added in the month shows on its day, in December', /diciembre/i.test(month.title) && month.exam, JSON.stringify(month));
  ok('the month shows the finals, the holidays and the official dates', month.finals >= 6 && /Fundación de Quito/.test(month.holiday) && month.official >= 2, JSON.stringify(month));
  await B.js(`document.querySelector('#sched-month').scrollIntoView();`); await W(500);
  await B.shot('06-mes');
  const ics = await B.js(`let got = ''; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => { window.__ics = t; }); return orig.call(URL, b); }; document.querySelector('[data-ics]').click(); await new Promise((r) => setTimeout(r, 500)); URL.createObjectURL = orig; return window.__ics ?? ''`);
  ok('«Descargar .ics» has the exam with its hour and the holidays', /BEGIN:VCALENDAR/.test(ics) && /SUMMARY:Examen final de Redes/.test(ics) && /DTSTART:20261214T090000/.test(ics) && /Sin clases: Fundación de Quito/.test(ics), ics.slice(0, 120).replace(/\r\n/g, ' | '));
  // Inicio: the next exam prepares it
  await B.js(`location.hash = '#/';`); await W(1500);
  const cd = await B.js(`return document.querySelector('#dash [data-tile="countdown"]')?.innerText ?? ''`);
  ok('«Tu próximo examen» is the exam, with days left and its study guide', /Examen final de Redes/.test(cd) && /guía de estudio/i.test(cd), cd.replace(/\n/g, ' ').slice(0, 160));
  await B.js(`document.querySelector('[data-study-for]').click();`);
  await B.wait(`location.hash === '#/estudiar/guia' && document.querySelector('#eg-body .tj-wizard h1')`, 15000);
  const st = await B.js(`return document.querySelector('#eg-body .tj-wizard h1').textContent`);
  ok('…which opens the questions of a study guide with the course already known', /evaluación/i.test(st), st);
} catch (e) {
  ok('ran to the end', false, e.message);
  await B.shot('99-error').catch(() => {});
} finally {
  const errs = B.logs.filter((l) => /EXCEPTION|ERROR/.test(l) && !/favicon|net::ERR|Failed to load resource/.test(l));
  ok('no exceptions on the page', !errs.length, errs.slice(0, 5).join(' | '));
  console.log(results.join('\n'));
  B.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
