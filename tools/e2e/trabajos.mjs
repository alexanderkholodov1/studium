// Usage: node tools/e2e/trabajos.mjs private/emulator-account.json <folder for screenshots>
// Needs: firebase emulators:start --only auth,firestore; node tools/dev.mjs --port 5181 --emulators; node tools/seed-emulators.mjs.
// End to end, as a person: sign in, create a trabajo from a file on disk that changes after being chosen (the
// «could not be read» case), without GitHub and without an AI; then the GitHub path that must fail plainly, with
// «Pedir a tu IA que lo explique» and «Enviar reporte a Studium». Screenshots in the shots folder.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { open } from './cdp.mjs';

const [, , ACCOUNT, SHOTS] = process.argv;
mkdirSync(SHOTS, { recursive: true });
const { email, password } = JSON.parse(readFileSync(ACCOUNT, 'utf8'));
const B = await open({ shots: SHOTS });
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const step = () => B.js(`return document.querySelector('.tj-wizard h1')?.textContent ?? ''`);
const next = async () => {
  const h = await step();
  if (/Cuántos son/.test(h)) await B.js(`document.querySelector('[data-tj="count"][data-n="3"]').click();`);
  else await B.js(`const b = [...document.querySelectorAll('.tj-wizard button')].find((x) => /^Siguiente|Saltar|Todavía no sabemos/.test(x.textContent.trim())); b?.click(); return !!b;`);
  await W(500);
};
try {
  await B.go('http://localhost:5181/studium/#/entrar');
  await B.wait(`document.querySelector('input[type=password]')?.offsetParent`);
  await B.js(`const f = [...document.querySelectorAll('input')].filter((i) => i.offsetParent); const em = f.find((i) => i.type === 'email' || /mail/i.test(i.name)); const pw = f.find((i) => i.type === 'password'); em.value = ${JSON.stringify(email)}; pw.value = ${JSON.stringify(password)}; em.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('input', { bubbles: true })); pw.form.requestSubmit();`);
  await W(2500);
  await B.js(`location.hash = '#/trabajos';`);
  await B.wait(`document.querySelector('[data-tj="new"]')`);
  ok('signed in and on Trabajos', true);

  // --- A: a file that changes on disk after being chosen
  const file = path.join(SHOTS, 'enunciado-laboratorio.txt');
  writeFileSync(file, 'Laboratorio 3 de Redes. Configurar una VPN con WireGuard sobre una topología OSPF. Entregar Grupo_5.zip.\n');
  await B.js(`document.querySelector('[data-tj="new"]').click();`);
  await B.wait(`document.querySelector('.tj-wizard input[name="v"]')`);
  await B.js(`const v = document.querySelector('.tj-wizard input[name="v"]'); v.value = 'Laboratorio 3 (prueba automática)'; v.dispatchEvent(new Event('input', { bubbles: true }));`);
  await next(); await next();
  ok('reached «Trae el enunciado»', /Trae el enunciado/.test(await step()), await step());
  await B.setFiles('input[name="files"]', [file]);
  await B.wait(`document.querySelector('.tj-files li')`);
  appendFileSync(file, 'Cambio hecho en el disco después de elegir el archivo.\n');
  ok('the file shows in the list', true);
  await B.shot('01-archivo');
  for (let i = 0; i < 12 && !/Todo listo/.test(await step()); i += 1) {
    const h = await step();
    if (/Cómo van a trabajar/.test(h)) await B.shot('02-como-trabajan');
    if (/Tu IA/.test(h)) await B.shot('03-tu-ia');
    await next();
  }
  ok('reached «Todo listo»', /Todo listo/.test(await step()), await step());
  await B.shot('04-todo-listo');
  const label = await B.js(`return document.querySelector('.tj-wizard [type=submit]')?.textContent.trim();`);
  await B.js(`document.querySelector('.tj-wizard [type=submit]').click();`);
  await B.wait(`/^#\\/trabajos\\/[\\w-]{10,}/.test(location.hash) || document.querySelector('.tj-error, .tj-warn')`, 20000);
  const err = await B.js(`return document.querySelector('.tj-error, .tj-warn')?.innerText ?? ''`);
  ok(`«${label}» creates the trabajo although the file changed on disk`, !err, err.slice(0, 300));
  const stored = await B.js(`const F = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js'); const { db, gunzip } = await import('/studium/assets/data.js'); const id = location.hash.split('/')[2]; const d = (await F.getDoc(F.doc(db, 'trabajos', id))).data(); return { statement: await gunzip(d.statement.toUint8Array()), share: d.prefs.share };`);
  ok('the statement keeps the file as it was chosen', /Configurar una VPN/.test(stored.statement) && !/Cambio hecho/.test(stored.statement), stored.statement.slice(0, 160));
  ok('«No, sin GitHub» is kept as the group\'s choice', stored.share === 'each', stored.share);
  await W(1500);
  await B.shot('05-guia-creada');

  // --- B: a new repo with a key that is not there: a plain error with its two buttons
  await B.js(`location.hash = '#/trabajos';`);
  await B.wait(`document.querySelector('[data-tj="new"]')`);
  await B.js(`document.querySelector('[data-tj="new"]').click();`);
  await B.wait(`document.querySelector('.tj-wizard input[name="v"]')`);
  await B.js(`const v = document.querySelector('.tj-wizard input[name="v"]'); v.value = 'Repo nuevo (prueba automática)';`);
  await next(); await next();
  await B.js(`[...document.querySelectorAll('.tj-wizard button')].find((b) => /pegar el texto/.test(b.textContent)).click();`);
  await W(300);
  await B.js(`document.querySelector('.tj-wizard textarea').value = 'Enunciado corto de prueba.';`);
  for (let i = 0; i < 12 && !/Cómo van a trabajar/.test(await step()); i += 1) await next();
  await B.js(`document.querySelector('input[data-tj="share-git"][value="github"]').click();`); await W(400);
  await B.js(`document.querySelector('input[data-tj="share-repo"][value="newrepo"]').click();`); await W(400);
  await B.js(`document.querySelector('input[name="repoBy"][value="token"]').click();`); await W(400);
  await B.shot('06-repo-nuevo');
  ok('the GitHub questions show one after another', await B.js(`return !!document.querySelector('input[name="repoName"]') && !document.body.innerText.includes('Drive')`));
  await next();
  ok('a missing key is said at that question, not at the end', /Pega la clave de GitHub/.test(await B.js(`return document.querySelector('.tj-warn')?.innerText ?? ''`)) && /Cómo van a trabajar/.test(await step()));
  await B.js(`document.querySelector('input[name="repoBy"][value="bridge"]').click();`); await W(400);
  for (let i = 0; i < 12 && !/Todo listo/.test(await step()); i += 1) await next();
  await B.js(`document.querySelector('.tj-wizard [type=submit]').click();`);
  await B.wait(`document.querySelector('.tj-error, .tj-warn')`, 15000);
  const box = await B.js(`const e = document.querySelector('.tj-error'); return e ? { text: e.innerText, buttons: [...e.querySelectorAll('button')].map((b) => b.textContent.trim()) } : { text: document.querySelector('.tj-warn')?.innerText };`);
  ok('a failure is a box that explains it', !!box.buttons, (box.text ?? '').slice(0, 200));
  ok('…with «Pedir a tu IA que lo explique» and «Enviar reporte a Studium»', box.buttons?.includes('Pedir a tu IA que lo explique') && box.buttons?.includes('Enviar reporte a Studium'), JSON.stringify(box.buttons));
  await B.js(`[...document.querySelectorAll('.tj-error button')].find((b) => /explique/.test(b.textContent)).click();`);
  await W(800);
  ok('«Pedir a tu IA…» answers even with no AI connected', /conecta una/i.test(await B.js(`return document.querySelector('[data-err-ai]')?.innerText ?? ''`)));
  await B.shot('07-error');
  await B.js(`[...document.querySelectorAll('.tj-error button')].find((b) => /reporte/.test(b.textContent)).click();`);
  await W(800);
  ok('«Enviar reporte» opens Studium\'s report window', await B.js(`return !!document.querySelector('dialog[open]')`));
  await B.shot('08-reporte');
} catch (e) {
  ok('the run', false, e.message);
  await B.shot('99-donde-fallo').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log('--- page errors ---\n' + (B.logs.filter((l) => !/favicon|DevTools/.test(l)).join('\n') || 'none'));
  B.close();
}
