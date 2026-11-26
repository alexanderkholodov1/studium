// Usage: node tools/e2e/armar.mjs <account.json> <folder for screenshots> [port of the page, 5191]
// Needs: the emulators (auth, firestore), node tools/dev.mjs --port <port> --emulators, node tools/seed-emulators.mjs.
// The registration planner, from his registration video (2026-11-25), with made-up sections (no real professor):
// - «Mi malla» reads a CAPP pasted as text: passed and «cursando» (which counts as a prerequisite next semester);
//   a minor is chosen from the published list;
// - «Preparar mi inscripción» takes what the bookmark copies (every section of several courses), says which pairs can
//   never go together (a course and its own prerequisite), and «Armar horarios» gives plans A, B and C: no clash,
//   theory + lab + exercises of one group, never a course with its prerequisite, within the credits;
// - a plan becomes a draft, with its NRCs to copy.
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

const S = (code, nrc, name, kind, group, slots, prof, seats = [30, 5], credits = kind === 'Teoría' ? 3 : 0) => ({ code, nrc, name, kind, group, section: nrc.slice(-1), slots: slots.map(([d, s]) => ({ d, s, e: s + 80 })), building: 'Newton', room: 'N10' + nrc.slice(-1), prof, profs: [prof], credits, excluded: [], careersOut: [], careersOnly: [], seats: { max: seats[0], taken: seats[1] } });
const sections = [
  S('CMP-5006E', '9122', 'Computer Security', 'Teoría', '', [[1, 780], [3, 780]], 'Prueba Uno, Ana'),
  S('CMP-5007', '9143', 'Hacking Ético', 'Teoría', '', [[0, 870], [2, 870]], 'Prueba Dos, Beto'),
  S('CMP-4002', '9114', 'Base de Datos', 'Teoría', '', [[1, 510], [3, 510]], 'Prueba Tres, Caro', [20, 20]),
  S('CMP-4002', '9115', 'Base de Datos', 'Teoría', '', [[0, 1050], [2, 1050]], 'Prueba Cuatro, Dani'),
  S('CMP-5001', '9121', 'Aplicaciones Distribuidas', 'Teoría', '', [[4, 420], [4, 510]], 'Prueba Cinco, Eva'),
  S('QUI-1003', '9017', 'Química General 1 +Lab/Ej', 'Teoría', 'Z3 Z4', [[0, 420], [2, 420]], 'Prueba Seis, Fer'),
  S('QUI-1003', '9069', 'Química General 1 +Lab/Ej', 'Laboratorio', 'Z3 Z5', [[4, 600]], 'Prueba Seis, Fer'),
  S('QUI-1003', '9033', 'Química General 1 +Lab/Ej', 'Ejercicios', 'Z4 Z5', [[1, 780]], 'Prueba Seis, Fer'),
  S('QUI-1003', '9019', 'Química General 1 +Lab/Ej', 'Teoría', '0A Z9', [[0, 600], [2, 600]], 'Prueba Siete, Gabi'),
  S('QUI-1003', '9070', 'Química General 1 +Lab/Ej', 'Laboratorio', '0B Z9', [[3, 600]], 'Prueba Siete, Gabi'),
  S('QUI-1003', '9035', 'Química General 1 +Lab/Ej', 'Ejercicios', '0A 0B', [[1, 870]], 'Prueba Siete, Gabi'),
];
const payload = JSON.stringify({ studium: 'studium-oferta', v: 1, term: '202620', read: new Date().toISOString(), missing: [], sections });
// A CAPP as a copy of the page gives it: tab-separated rows; «-» where nothing fills the requirement yet.
const capp = [
  'Resultados de Evaluación CAPP', '1CMP-4-10 Año 4 Semestre 1',
  'CMP 4005\tRedes +Lab\tCMP - 4005\tRedes +Lab\t3.00\t\t202610\t1652\tC',
  'CMP-4003\tSistemas Operativos\tCMP - 4003\tSistemas Operativos\t3.00\t\t202610\t1649\tC',
  'CMP-4002\tBase de Datos\t-\t\t0.00\t\t\t\tC',
  'CMP 5006\tSeguridad Informática\t-\t\t0.00\t\t\t\tC',
  'MAT-1201\tCálculo 1\tMAT - 1201\tCálculo 1\t3.00\t\t202410\t1201\tC',
  'ELECTIVA 2\tElectiva Libre 2/2\tDIM - 3203\tDesarrollo Web 3\t3.00\t\t202610\t1421',
].join('\n');

try {
  await B.go(`${BASE}#/entrar`);
  await B.wait(`document.querySelector('input[type=password]')?.offsetParent`);
  await B.js(`const f = [...document.querySelectorAll('input')].filter((i) => i.offsetParent); const em = f.find((i) => i.type === 'email' || /mail/i.test(i.name)); const pw = f.find((i) => i.type === 'password'); em.value = ${JSON.stringify(email)}; pw.value = ${JSON.stringify(password)}; em.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('input', { bubbles: true })); pw.form.requestSubmit();`);
  await B.wait(`document.querySelector('#nav')?.dataset.mode === 'member'`, 20000); await W(800);
  // A Computación student in the middle of the career: everything before the 4th year passed.
  await B.js(`const { prefs } = await import('/studium/assets/prefs.js'); const { mallaOf } = await import('/studium/assets/malla.js');
    const m = await mallaOf('1CMP'); const keep = new Set(['CMP 4002', 'CMP 5006', 'CMP 5007', 'CMP 5001', 'CMP 4005', 'CMP 4003', 'CMP 5002']);
    const passed = m.semesters.slice(0, 7).flatMap((s) => s.classes.map((c) => c.code)).filter((c) => !keep.has(c));
    prefs.set({ malla: '1CMP', passed, plan: [], planner: {}, lang: 'es' }); const { saveSchedule, auth } = await import('/studium/assets/data.js'); await saveSchedule(auth.currentUser.uid, { mine: { id: 'mine', name: 'Mi horario', classes: [] }, options: [{ id: 'o1', name: 'Borrador 1', classes: [] }], active: 0, term: '' }); sessionStorage.setItem('studium-onboarded', '1'); localStorage.setItem('studium-news-seen', (await import('/studium/assets/config.js')).VERSION); document.querySelector('dialog[open]')?.close(); try { localStorage.removeItem('studium-oferta:' + (await import('/studium/assets/data.js')).auth.currentUser.uid); } catch {} return true;`);
  await W(2000);
  await B.js(`location.reload();`); await W(2500);
  await B.wait(`document.querySelector('#nav')?.dataset.mode === 'member'`, 20000); await W(800);

  // 1. Mi malla: the CAPP, then a minor.
  await B.js(`location.hash = '#/malla';`);
  await B.wait(`document.querySelector('#malla .mm-capp')`, 15000);
  await B.js(`const d = document.querySelector('#malla .mm-capp'); d.open = true; d.querySelector('[data-capp]').value = ${JSON.stringify(capp)}; d.querySelector('[data-capp-read]').click();`);
  await W(1200);
  const c = await B.js(`const { prefs } = await import('/studium/assets/prefs.js'); const p = prefs.get(); return { doing: p.planner.cursando, passedMat: p.passed.includes('MAT 1201'), msg: document.querySelector('#malla [data-capp-msg]')?.textContent, legend: document.querySelector('#malla .mm-legend').textContent }`);
  ok('the CAPP marks what is in progress (this term) and what was passed (an earlier one)', c.doing.includes('CMP 4005') && c.doing.includes('CMP 4003') && c.doing.includes('DIM 3203') && c.passedMat, JSON.stringify(c));
  ok('…the malla says «Cursando» for its own classes (3: DIM 3203 is not in it)', /Cursando 3/.test(c.legend) && /Listo: 1 aprobadas y 4 cursando/.test(c.msg), JSON.stringify(c));
  await B.js(`document.querySelector('#malla .mm-card[data-mm="CMP 5001"]')?.click();`); await W(500);
  const ad = await B.js(`return document.querySelector('#malla .mm-detail')?.textContent ?? ''`);
  ok('a course whose prerequisite is in progress no longer says Redes is missing (only Base de Datos)', /Base de Datos/.test(ad) && !/te falta:[^.]*Redes/i.test(ad), ad.slice(0, 300));
  const minors = await B.js(`const d = document.querySelector('#malla .mm-minors'); d.open = true; const s = d.querySelector('[data-minor-add]'); const opts = s ? s.options.length : 0; const o = s && [...s.options].find((x) => /Análisis de Datos/.test(x.text)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } return { opts, found: !!o }`);
  await W(800);
  const mm = await B.js(`return document.querySelector('#malla .mm-minors')?.textContent ?? ''`);
  ok('a minor is chosen from the published list, with its classes and PDF', minors.opts > 50 && /ADM 3080/.test(mm) && /PDF/.test(mm), `${minors.opts} options; ${mm.slice(0, 200)}`);
  await B.shot('01-malla-capp-minor');

  // 2. Preparar mi inscripción: paste what the bookmark copied.
  await B.js(`const { prefs } = await import('/studium/assets/prefs.js'); prefs.set({ plan: ['CMP 4002', 'CMP 5006'] }); location.hash = '#/horario';`);
  await B.wait(`document.querySelector('#horario [data-mode="prep"]')`, 15000);
  await B.js(`document.querySelector('#horario [data-mode="prep"]').click();`);
  await B.wait(`document.querySelector('#horario [data-armar]')`, 8000);
  const before = await B.js(`const a = document.querySelector('#horario [data-armar]'); return { open: a.open, codes: a.querySelector('[data-ar-codes]')?.value, bm: (a.querySelector('[data-ar-bookmark]')?.getAttribute('href') ?? '').slice(0, 11), bridge: /Enlaza el puente|Leer con el puente/.test(a.textContent) }`);
  ok('«Ármalo por mí» offers both ways: the bookmark (with the planned courses) and the bridge', before.open && before.bm === 'javascript:' && /CMP-4002/.test(before.codes) && before.bridge, JSON.stringify(before));
  await B.shot('02-armar-vacio');
  await B.js(`const t = document.querySelector('#horario [data-paste]'); t.value = ${JSON.stringify(payload)}; document.querySelector('#horario [data-paste-add]').click();`);
  await B.wait(`document.querySelectorAll('#horario .ar-course').length >= 5`, 10000); await W(1500);
  const rows = await B.js(`return { n: document.querySelectorAll('#horario .ar-course').length, note: document.querySelector('#horario .sched-note')?.textContent ?? '', warn: document.querySelector('#horario .ar-warn')?.textContent ?? '', text: document.querySelector('#horario [data-armar]').textContent }`);
  ok('the pasted reading is taken whole: 11 sections of 5 courses', /11 secciones de 5 materias/.test(rows.note) && rows.n === 5, rows.note);
  ok('it says which pairs never go together (a course and its own prerequisite)', /Hacking Ético pide Computer Security|Hacking Ético pide Seguridad/.test(rows.warn) && /Aplicaciones Distribuidas pide Base de Datos/.test(rows.warn), rows.warn);
  ok('each course says why it matters (planned, opens, repeat or what is missing)', /para tu próximo semestre/.test(rows.text) && /abre \d/.test(rows.text), rows.text.slice(0, 400));
  // His say on a professor and on Química (a repeat would be «Si cabe»).
  await B.js(`document.querySelector('#horario [data-ar-profs="QUI 1003"]').click();`); await W(300);
  await B.js(`[...document.querySelectorAll('#horario [data-ar-prof]')].find((b) => /Siete/.test(b.dataset.arProf) && b.dataset.v === '1').click();`); await W(300);
  await B.js(`document.querySelector('#horario [data-ar-run]').click();`); await W(1200);
  const plans = await B.js(`return [...document.querySelectorAll('#horario .ar-plan')].map((p) => ({ cr: p.querySelector('header small').textContent, nrcs: p.querySelector('[data-ar-copy]').dataset.nrcs.split('\\n'), text: p.textContent }))`);
  ok('plans A and B at least, none a piece of another', plans.length >= 2 && plans.every((p, i) => plans.every((q, j) => i === j || !p.nrcs.every((n) => q.nrcs.includes(n)))), plans.map((p) => p.nrcs.join('+')).join(' | '));
  ok('…B and C keep about as many credits as A', plans.every((p) => parseInt(p.cr) >= parseInt(plans[0].cr) - 3), plans.map((p) => p.cr + ' ' + p.nrcs.join('+')).join(' | '));
  const A = plans[0] ?? { nrcs: [], text: '' };
  const has = (n) => A.nrcs.includes(n);
  ok('plan A: Seguridad and Base de Datos (imprescindibles) with no clash, the full section left out', has('9122') && has('9115') && !has('9114'), A.nrcs.join(','));
  ok('…never a course with its own prerequisite (no Hacking Ético, no Aplicaciones Distribuidas)', plans.every((p) => !(p.nrcs.includes('9143') && p.nrcs.includes('9122')) && !(p.nrcs.includes('9121') && (p.nrcs.includes('9114') || p.nrcs.includes('9115')))), plans.map((p) => p.nrcs.join('+')).join(' | '));
  ok('…Química with its three parts of one group, the professor preferred', has('9019') && has('9070') && has('9035') && !has('9017'), A.nrcs.join(','));
  ok('…the imprescindibles first in the NRC order', A.nrcs[0] !== '9019', A.nrcs.join(','));
  await B.js(`document.querySelector('#horario .ar-plans').scrollIntoView({ block: 'center' });`); await W(400);
  await B.shot('03-armar-planes');
  await B.js(`document.querySelector('#horario [data-ar-draft="0"]').click();`); await W(1200);
  const draft = await B.js(`const t = document.querySelector('#horario .sched-opt[aria-selected="true"]'); return { name: t?.textContent ?? '', classes: document.querySelectorAll('#horario .sched-list li').length, clash: !!document.querySelector('#horario .sched-clash-chip') }`);
  await B.js(`document.querySelector('#horario [data-ar-draft="0"]').click();`); await W(800);
  const tabs = await B.js(`return [...document.querySelectorAll('#horario .sched-opt:not(.add)')].map((t) => t.textContent.trim())`);
  ok('creating Plan A again replaces it, never a second «Plan A»', tabs.filter((t) => /^Plan A/.test(t)).length === 1, tabs.join(' | '));
  ok('a plan becomes a draft with all its parts and no clash', /Plan A/.test(draft.name) && draft.classes === A.nrcs.length && !draft.clash, JSON.stringify(draft));
  await B.shot('04-plan-a-borrador');
  // Phone width: nothing wider than the screen.
  await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await W(800);
  const over = await B.js(`return document.documentElement.scrollWidth - innerWidth`);
  ok('at phone width nothing overflows sideways', over <= 1, String(over));
  await B.js(`document.querySelector('#horario [data-armar]').scrollIntoView();`); await W(400);
  await B.shot('05-telefono');
  // In English, the panel has no Spanish left but the catalog's own words (course names, professors, its buttons).
  await B.send('Emulation.clearDeviceMetricsOverride', {});
  await B.js(`(await import('/studium/assets/i18n.js')).setLang('en'); document.querySelector('#horario [data-ar-profs]')?.click();`); await W(1200);
  const left = await B.js(`const a = document.querySelector('#horario [data-armar]'); const out = []; const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    const data = new Set([...document.querySelectorAll('#horario .ar-course-head b, #horario .ar-plan ol li > b, #horario .ar-profs li > span')].map((e) => e));
    for (let n = w.nextNode(); n; n = w.nextNode()) { const t = ${JSON.stringify([...new Set(sections.map((s) => s.name.replace(/\s*\+.*$/, '')))].concat(['Seguridad Informática', 'Base de Datos']))}.reduce((x, name) => x.split(name).join(''), n.nodeValue.trim()); if (!t || n.parentElement.closest('textarea, input') || [...data].some((e) => e.contains(n) && e.firstChild === n)) continue;
      if (/[áéíóúñ¿]|\\b(de|tu|tus|las|los|para|que|con|por|del|una|sin|cupos|secciones|materias)\\b/i.test(t.replace(/«[^»]*»|Leer|Copiar para Studium|Agregar clases|Actualizar Cursos/g, '')) && !/^[A-Z]{3,4}[- ]\\d{4}/.test(t)) out.push(t.slice(0, 90)); }
    (await import('/studium/assets/i18n.js')).setLang('es'); return out;`);
  ok('in English, nothing of the panel is left in Spanish (but the catalog’s names)', left.length === 0, left.join(' | '));
} catch (e) { results.push(`FAIL ${e.message}`); }
console.log(results.join('\n'));
console.log(B.logs.filter((l) => !/favicon|ERR_CONNECTION_REFUSED|41730/.test(l)).slice(0, 10).join('\n'));
B.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
