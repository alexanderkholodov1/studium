// Usage: node tools/e2e/amigos.mjs private/emulator-account.json private/emulator-account-2.json <folder for screenshots>
// Needs: firebase emulators:start --only auth,firestore; node tools/dev.mjs --port 5181 --emulators; two accounts from
// node tools/seed-emulators.mjs <file>.
// End to end, as two people (two headless Chromes):
// 1. Going back to the questions: A's writer is Claude through a FAKE bridge on its own port (never the person's real
//    one, 41730; it runs no AI and answers every request to write with an error). A lends a folder, the folder gets
//    disconnected, «Escribir mi guía» sends A back to «Tu IA» saying so, and no trabajo is created. Then the guide
//    fails (the fake bridge), and from the unwritten guide «Volver a las preguntas» brings every answer back; the
//    trabajo is changed, not duplicated. A folder gone while in the guide shows its own notice.
// 2. Friends: B opens A's friend link and accepts; both see each other; A invites B to the trabajo; B finds it in
//    Trabajos and enters; A ends the friendship.
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { open } from './cdp.mjs';

const [, , ACC_A, ACC_B, SHOTS] = process.argv;
mkdirSync(SHOTS, { recursive: true });
const A_ACC = JSON.parse(readFileSync(ACC_A, 'utf8'));
const B_ACC = JSON.parse(readFileSync(ACC_B, 'utf8'));
const APP = 'http://localhost:5181/studium/';
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const W = (ms) => new Promise((r) => setTimeout(r, ms));

// The fake bridge: Claude «ready», folders the test controls, every request to write refused.
const STUB_PORT = 41799;
let folders = [];
const runs = [];
const stub = http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const u = req.url.split('?')[0];
    if (u === '/v1/hello') return send(200, { app: 'studium-bridge', version: '1.7.0' });
    if (u === '/v1/status') return send(200, { version: '1.7.0', cwd: 'C:/tmp', engines: [{ id: 'claude', name: 'Claude Code', ready: true, models: [{ id: 'claude-haiku-5-5' }], accounts: [{ id: 'prueba', ready: true }], reads: { pdf: true, images: true } }] });
    if (u === '/v1/folders') return send(200, { folders, modes: {} });
    if (u === '/v1/folders/pick') { const f = { id: 'f1', name: 'Lab Redes', path: 'C:/tmp/Lab Redes', mode: 'read', label: 'Solo leer', exists: true, expires: '', expired: false }; folders = [f]; return send(200, { folder: f }); }
    if (u === '/v1/folders/change') { folders = []; return send(200, { ok: true }); }
    runs.push(u);
    return send(500, { error: 'fake-bridge', message: 'Puente de prueba: no ejecuta ninguna IA.' });
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

async function signIn(B, { email, password }) {
  await B.go(`${APP}#/entrar`);
  await B.wait(`document.querySelector('input[type=password]')?.offsetParent`);
  await B.js(`const f = [...document.querySelectorAll('input')].filter((i) => i.offsetParent); const em = f.find((i) => i.type === 'email' || /mail/i.test(i.name)); const pw = f.find((i) => i.type === 'password'); em.value = ${JSON.stringify(email)}; pw.value = ${JSON.stringify(password)}; em.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('input', { bubbles: true })); pw.form.requestSubmit();`);
  await W(2500);
}
const step = (B) => B.js(`return document.querySelector('.tj-wizard h1')?.textContent ?? ''`);
const next = async (B) => {
  const h = await step(B);
  if (/Cuántos son/.test(h)) await B.js(`document.querySelector('[data-tj="count"][data-n="3"]').click();`);
  else await B.js(`const b = [...document.querySelectorAll('.tj-wizard button')].find((x) => /^Siguiente|Saltar|Todavía no sabemos/.test(x.textContent.trim())); b?.click(); return !!b;`);
  await W(500);
};
const until = async (B, re, max = 14) => { for (let i = 0; i < max && !re.test(await step(B)); i += 1) await next(B); return re.test(await step(B)); };
const click = (B, sel, text) => B.js(`const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => ${text ? `/${text}/.test(x.textContent)` : 'true'} && x.offsetParent !== null); b?.click(); return !!b;`);
const trabajoIds = (B) => B.js(`const F = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js'); const { db, auth } = await import('/studium/assets/data.js'); const s = await F.getDoc(F.doc(db, 'misTrabajos', auth.currentUser.uid)); return s.exists() ? s.data().ids : [];`);

const A = await open({ port: 9333, shots: SHOTS });
const B = await open({ port: 9334, shots: SHOTS });
try {
  await signIn(A, A_ACC);
  await signIn(B, B_ACC);
  ok('both signed in', await A.js(`return !!document.querySelector('#initial')?.textContent`) && await B.js(`return !!document.querySelector('#initial')?.textContent`));

  // --- 1. Going back to the questions
  await A.js(`const ai = await import('/studium/assets/ai.js'); await ai.pairBridge(${STUB_PORT}, 'puente-de-prueba'); ai.setDefault('bridge:claude');`);
  ok('A uses Claude through the fake bridge', await A.js(`const ai = await import('/studium/assets/ai.js'); return ai.choice('solution').provider === 'bridge:claude' && ai.bridgeOf().port === ${STUB_PORT};`));
  const before = (await trabajoIds(A)).length;
  await A.js(`location.hash = '#/trabajos';`);
  await A.wait(`document.querySelector('[data-tj="new"]')`);
  await A.js(`document.querySelector('[data-tj="new"]').click();`);
  await A.wait(`document.querySelector('.tj-wizard input[name="v"]')`);
  await A.js(`const v = document.querySelector('.tj-wizard input[name="v"]'); v.value = 'Lab de Redes (prueba automática)'; v.dispatchEvent(new Event('input', { bubbles: true }));`);
  await next(A); await next(A);
  await click(A, '.tj-wizard button', 'pegar el texto'); await W(300);
  await A.js(`const t = document.querySelector('.tj-wizard textarea'); t.value = 'Laboratorio 4: OSPF multiárea y una VPN. Entregar el .pkt y un informe.'; t.dispatchEvent(new Event('input', { bubbles: true }));`);
  ok('reached «Tu IA»', await until(A, /Tu IA/), await step(A));
  await W(800);
  await click(A, '[data-tj="folder-pick"]'); await W(1200);
  ok('A lends the folder «Lab Redes»', await A.js(`return /Lab Redes/.test(document.querySelector('.tj-where')?.innerText ?? '')`));
  await A.shot('a1-carpeta-prestada');
  folders = []; // the bridge was restarted: the folder is no longer lent
  ok('reached «Todo listo»', await until(A, /Todo listo/), await step(A));
  await A.js(`document.querySelector('.tj-wizard [type=submit]').click();`);
  await A.wait(`/Tu IA/.test(document.querySelector('.tj-wizard h1')?.textContent ?? '')`, 10000);
  const warn = await A.js(`return document.querySelector('.tj-wizard .tj-warn')?.innerText ?? ''`);
  ok('a disconnected folder sends A back to «Tu IA», saying so', /se desconectó/.test(warn), warn.slice(0, 120));
  ok('…and no trabajo was created, nothing was sent to the AI', (await trabajoIds(A)).length === before && runs.length === 0, `${runs.length} requests`);
  await A.shot('a2-carpeta-desconectada');
  await until(A, /Todo listo/);
  await A.js(`document.querySelector('.tj-wizard [type=submit]').click();`);
  await A.wait(`/^#\\/trabajos\\/[\\w-]{10,}/.test(location.hash) && document.querySelector('#tjg-body .tj-error, #tjg-body [data-tj="edit-questions"]')`, 20000);
  const tid = await A.js(`return location.hash.split('/')[2]`);
  ok('without the folder, the trabajo is created and the fake AI fails', runs.length > 0 && !!(await A.js(`return document.querySelector('#tjg-body .tj-error')`)), runs.join(','));
  await A.shot('a3-guia-fallo');
  // A folder gone while in the guide: its own notice.
  await A.js(`const m = JSON.parse(localStorage.getItem('studium-tj-folders') ?? '{}'); m[${JSON.stringify(tid)}] = 'f1'; localStorage.setItem('studium-tj-folders', JSON.stringify(m)); location.reload();`);
  await W(2500);
  await A.wait(`document.querySelector('#tjg-body .tj-gone')`, 15000);
  ok('in the unwritten guide, a gone folder has its own notice with three ways out', await A.js(`return ['folder-pick', 'folder-forget', 'edit-questions'].every((k) => document.querySelector('.tj-gone [data-tj="' + k + '"]'))`));
  await A.shot('a4-guia-carpeta-desconectada');
  await A.js(`document.querySelector('.tj-gone [data-tj="edit-questions"]').click();`);
  await A.wait(`document.querySelector('.tj-wizard .tj-editing')`, 10000);
  ok('«Volver a las preguntas» opens the wizard on «Tu IA», marked as changing the trabajo', /Tu IA/.test(await step(A)));
  await A.shot('a5-de-vuelta-tu-ia');
  for (let i = 0; i < 8 && !/Trae el enunciado/.test(await step(A)); i += 1) { await click(A, '[data-tj="back"]'); await W(400); }
  ok('«Atrás» reaches «Trae el enunciado», which keeps what was brought', /Ya está guardado el enunciado/.test(await A.js(`return document.querySelector('.tj-kept')?.innerText ?? ''`)));
  await click(A, '[data-tj="back"]'); await W(400); await click(A, '[data-tj="back"]'); await W(400);
  ok('…and the title is still there', (await A.js(`return document.querySelector('.tj-wizard input[name="v"]')?.value`)) === 'Lab de Redes (prueba automática)');
  await A.shot('a6-atras-titulo');
  for (let i = 0; i < 14 && !/Cómo se llama el grupo/.test(await step(A)); i += 1) await next(A);
  await A.js(`const v = document.querySelector('.tj-wizard input[name="v"]'); v.value = 'Grupo 7'; v.dispatchEvent(new Event('input', { bubbles: true }));`);
  await A.js(`document.querySelector('.tj-wizard [type=submit]').click();`); await W(500);
  await until(A, /Todo listo/);
  const runsBefore = runs.length;
  await A.js(`document.querySelector('.tj-wizard [type=submit]').click();`);
  await A.wait(`location.hash === '#/trabajos/${tid}' && document.querySelector('#tjg-body .tj-error, #tjg-body .tjg-app')`, 20000);
  await W(1500);
  const after = await A.js(`const F = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js'); const { db } = await import('/studium/assets/data.js'); const d = (await F.getDoc(F.doc(db, 'trabajos', ${JSON.stringify(tid)}))).data(); return { group: d.group, title: d.title };`);
  ok('the same trabajo is changed (group «Grupo 7»), not a new one', after.group === 'Grupo 7' && (await trabajoIds(A)).length === before + 1, JSON.stringify(after));
  ok('…and the guide is asked again', runs.length > runsBefore);

  // --- 2. Friends
  await A.js(`location.hash = '#/comunidad';`);
  await A.wait(`document.querySelector('.am-link code')`, 15000);
  const link = await A.js(`return document.querySelector('.am-link code').textContent`);
  ok('A has a friend link', /#\/amigos\/[\w-]{24,}/.test(link), link);
  await A.shot('b1-a-comunidad');
  await B.js(`location.hash = ${JSON.stringify(`#/amigos/${link.split('#/amigos/')[1]}`)};`);
  await B.wait(`document.querySelector('.am-offer [data-am="accept"]')`, 15000);
  ok('B sees A\'s proposal', /te propone ser amigos/.test(await B.js(`return document.querySelector('.am-offer').innerText`)));
  await B.shot('b2-b-propuesta');
  await B.js(`document.querySelector('[data-am="accept"]').click();`);
  await B.wait(`document.querySelector('.am-list li')`, 10000);
  ok('B accepts: A is in B\'s friends', true);
  await B.shot('b3-b-amigos');
  await A.js(`location.reload();`); await W(2500);
  await A.wait(`document.querySelector('.am-list li')`, 15000);
  ok('A sees B in their friends', true);
  // A invites B to the trabajo, from the list's ⋯ menu.
  await A.js(`location.hash = '#/trabajos';`);
  await A.wait(`document.querySelector('.tj-card[data-id="${tid}"]')`, 15000);
  await A.js(`const c = document.querySelector('.tj-card[data-id="${tid}"]'); c.querySelector('.tj-menu').open = true; c.querySelector('[data-tj="share"]').click();`);
  await A.wait(`document.querySelector('.tj-invite [data-tj-friend]')`, 10000);
  await A.js(`document.querySelector('.tj-invite [data-tj-friend]').click(); document.querySelector('[data-tj="invite-send"]').click();`);
  await A.wait(`/Invitaste a/.test(document.querySelector('[data-invite-status]')?.textContent ?? '')`, 10000);
  ok('A invites B with one tap', true, await A.js(`return document.querySelector('[data-invite-status]').textContent`));
  await A.shot('b4-a-invita');
  await B.js(`location.hash = '#/trabajos';`);
  await B.wait(`document.querySelector('[data-tj="inv-join"]')`, 15000);
  ok('B finds the invitation in Trabajos', /te invitó a/.test(await B.js(`return document.querySelector('.tj-invited').innerText`)));
  await B.shot('b5-b-invitacion');
  await B.js(`document.querySelector('[data-tj="inv-join"]').click();`);
  await B.wait(`location.hash === '#/trabajos/${tid}' && document.querySelector('#tjg-body .tjg-app')`, 15000);
  await W(1000);
  ok('B enters the trabajo', /Lab de Redes/.test(await B.js(`return document.querySelector('#tjg-body').innerText`)));
  await B.shot('b6-b-en-el-trabajo');
  // A ends the friendship.
  await A.js(`location.hash = '#/comunidad';`);
  await A.wait(`document.querySelector('[data-am="end-ask"]')`, 15000);
  await A.js(`document.querySelector('[data-am="end-ask"]').click();`); await W(200);
  await A.js(`document.querySelector('[data-am="end"]').click();`);
  await A.wait(`document.querySelector('.am-empty')`, 10000);
  await B.js(`location.hash = '#/comunidad'; location.reload();`); await W(2500);
  await B.wait(`document.querySelector('.am-empty, .am-list li')`, 15000);
  ok('A ends the friendship: gone on both sides', !!(await B.js(`return document.querySelector('.am-empty')`)));
} catch (e) {
  ok('the run', false, e.message);
  await A.shot('99-a-donde-fallo').catch(() => {});
  await B.shot('99-b-donde-fallo').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log('--- page errors (A) ---\n' + (A.logs.filter((l) => !/favicon|DevTools/.test(l)).join('\n') || 'none'));
  console.log('--- page errors (B) ---\n' + (B.logs.filter((l) => !/favicon|DevTools/.test(l)).join('\n') || 'none'));
  A.close(); B.close(); stub.close();
}
