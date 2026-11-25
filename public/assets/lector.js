// Reading every section of a course at once from USFQ's «Oferta de cursos» (catalogodecursos.usfq.edu.ec), instead of
// copying it page by page (his registration, 2026-11-25: 32 sections of Química, 10 per page, Ctrl+F only on the page
// shown). Two ways, the same reader:
// - in the person's own tab, signed in: a bookmark («marcador») they save once and press there; nothing installed;
// - through the bridge, which opens a Chrome window of its own where they sign in once (bridge.mjs keeps a copy of
//   this same reader, so the page never sends the bridge code to run).
// The catalog asks its own server with the person's session (the same request its «Actualizar Cursos» makes, one per
// course, with a pause); the reader only reads, never enrolls or changes anything, and gives the sections to Studium
// as text the person copies, so they see what goes where.
export const CATALOG = 'https://catalogodecursos.usfq.edu.ec/';

// Runs inside the catalog's page. `codes`: codes or names to search («QUI-1003», «Química»); `term`: «202620», or empty
// for the one chosen on the page. Returns { term, sections, missing } in Studium's shape.
export function catalogReader(codes, term) {
  const store = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$store;
  if (!store || !/catalogodecursos\.usfq\.edu\.ec$/.test(location.hostname)) throw new Error('not-catalog');
  if (!store.state?.user?.token) throw new Error('not-signed-in');
  const pageTerm = [...document.querySelectorAll('select')].map((s) => s.options[s.selectedIndex]?.text?.match(/\((\d{6})\)/)?.[1]).find(Boolean);
  const periodo = /^\d{6}$/.test(term ?? '') ? term : pageTerm || store.state.periodo_actual?.periodo_id;
  const body = { search: '', colegio: '', area: '', campus: '', sesion: '', mallas: '', cursos_ingles: false, cursos_wi: false, cursos_con_cupo: false, filtro_lunes: false, filtro_martes: false, filtro_miercoles: false, filtro_jueves: false, filtro_viernes: false, filtro_sabado: false, filtro_domingo: false, semana: [] };
  const norm = (s) => String(s ?? '').toUpperCase().replace(/[\s_-]+/g, '');
  const base = (s) => norm(s).replace(/^([A-Z]+\d{3,4})E$/, '$1');
  const isCode = (s) => /^[A-Z]{3,4}[\s-]?\d{4}[A-Z]?$/i.test(String(s).trim());
  const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const min = (h) => Number(String(h).slice(0, -2)) * 60 + Number(String(h).slice(-2));
  const lines = (html) => String(html ?? '').split(/<br\s*\/?>/i).map((x) => x.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const block = (html, label) => { const parts = String(html ?? '').split(/<strong>/i); const p = parts.find((x) => new RegExp(`^\\s*${label}`, 'i').test(x)); return p ? lines(p.replace(/^[^<]*<\/strong>/i, '')) : []; };
  const shape = (x) => {
    const slots = [];
    for (const r of x.info_reuniones?.length ? x.info_reuniones : [x.info_reunion].filter(Boolean)) {
      if (!/^\d{4}$/.test(r.hora_inicio ?? '') || !/^\d{4}$/.test(r.hora_fin ?? '')) continue;
      DAYS.forEach((d, i) => { if (r[d] && !slots.some((s) => s.d === i && s.s === min(r.hora_inicio))) slots.push({ d: i, s: min(r.hora_inicio), e: min(r.hora_fin) }); });
    }
    const r0 = x.info_reuniones?.[0] ?? x.info_reunion ?? {};
    const letter = String(r0.edificio ?? '').match(/\(([A-Z]{1,4})\)/)?.[1] ?? '';
    const aula = String(r0.aula ?? '').trim();
    const p = x.profesor ?? {};
    const one = [p.apellidos, [p.primer_nombre, p.segundo_nombre].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const profs = lines(x.string_profesores).length ? lines(x.string_profesores) : one ? [one] : [];
    return {
      code: x.code_numb, nrc: String(x.nrc), name: x.nombre_curso, kind: x.tipo_curso?.tipocurso_desc ?? '',
      group: String(x.liga ?? '').split('|').map((s) => s.trim()).filter(Boolean).sort().join(' '), section: String(x.seq_num ?? ''),
      slots, building: String(r0.edificio ?? '').replace(/\s*\([A-Z]{1,4}\)\s*/, '').trim(), room: aula ? (/^[A-Z]/.test(aula) || !letter ? aula : `${letter}${aula}`) : '',
      prof: profs[0] ?? '', profs, credits: Number(x.creditos) || 0,
      excluded: block(x.restricciones, 'CLASES EXCLUIDOS'), careersOut: block(x.restricciones, 'CARRERAS EXCLUIDOS'), careersOnly: block(x.restricciones, 'CARRERAS INCLUIDOS'),
      seats: { max: Number(x.maximo_registrados) || 0, taken: Number(x.numero_registrados) || 0 },
      english: /E$/.test(String(x.code_numb ?? '')), campus: x.campus?.campus_desc ?? '',
    };
  };
  return (async () => {
    const sections = []; const missing = [];
    const wanted = [...new Set((codes ?? []).map((c) => String(c).trim()).filter(Boolean))].slice(0, 40);
    for (const q of wanted) {
      const found = await store.dispatch('getCursos', { aulas: '', horas: '', dias: '', periodo, semana: [], body: { ...body, search: q } });
      const mine = (Array.isArray(found) ? found : []).filter((x) => !isCode(q) || base(x.code_numb) === base(q));
      if (!mine.length) missing.push(q);
      for (const x of mine) if (!sections.some((s) => s.nrc === String(x.nrc))) sections.push(shape(x));
      await new Promise((r) => setTimeout(r, 700));
    }
    // Nothing asked: what the page is showing now, the person's own search.
    if (!wanted.length) for (const x of store.state.cursos ?? []) sections.push(shape(x));
    return { term: periodo, sections, missing };
  })();
}

// The text the person copies to Studium: marked, so the paste box knows it at once.
export const MARK = 'studium-oferta';
export function readPayload(text) {
  const m = String(text ?? '').match(/\{[\s\S]*"studium"\s*:\s*"studium-oferta"[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (o.studium !== MARK || !Array.isArray(o.sections)) return null;
    return { term: /^\d{6}$/.test(o.term ?? '') ? o.term : '', sections: o.sections.slice(0, 1500), read: String(o.read ?? '').slice(0, 25), missing: Array.isArray(o.missing) ? o.missing.slice(0, 40).map(String) : [] };
  } catch { return null; }
}

// The bookmark: a small panel in the catalog's corner, with the courses to read (the person's own, already written)
// and one button; then «Copiar para Studium». Nothing leaves the catalog's tab but what the person copies.
export function bookmarklet(codes = [], term = '') {
  const run = `(${catalogReader.toString()})`;
  const ui = `(function(){var R=${run};var old=document.getElementById('studium-lector');if(old)old.remove();
var d=document.createElement('div');d.id='studium-lector';d.style.cssText='position:fixed;z-index:99999;right:16px;bottom:16px;width:340px;max-width:calc(100vw - 32px);background:#fff;color:#1b1b1f;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:16px;font:14px/1.4 system-ui,sans-serif';
d.innerHTML='<b style=\\'font-size:15px\\'>Studium: leer la oferta</b><p style=\\'margin:6px 0\\'>Materias (códigos o nombres, separados por coma):</p><textarea rows=3 style=\\'width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:8px;padding:6px;font:inherit\\'></textarea><p style=\\'margin:6px 0\\'>Periodo: <input size=7 style=\\'border:1px solid #ccc;border-radius:6px;padding:3px\\'> <small>(vacío: el de la página)</small></p><button style=\\'background:#c8102e;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer\\'>Leer</button> <button style=\\'background:none;border:0;color:#555;cursor:pointer;font:inherit\\'>Cerrar</button><p class=m style=\\'margin:8px 0 0\\'></p>';
document.body.appendChild(d);var t=d.querySelector('textarea'),p=d.querySelector('input'),b=d.querySelectorAll('button'),m=d.querySelector('.m');t.value=${JSON.stringify(codes.join(', '))};p.value=${JSON.stringify(term)};
b[1].onclick=function(){d.remove()};
b[0].onclick=async function(){b[0].disabled=true;m.textContent='Leyendo… (una materia a la vez)';try{var r=await R(t.value.split(/[,;\\n]+/),p.value.trim());var out=JSON.stringify({studium:'studium-oferta',v:1,term:r.term,read:new Date().toISOString(),missing:r.missing,sections:r.sections});
m.innerHTML='Listo: '+r.sections.length+' secciones'+(r.missing.length?'. Sin resultados: '+r.missing.join(', '):'')+'.<br>';var c=document.createElement('button');c.textContent='Copiar para Studium';c.style.cssText=b[0].style.cssText+';margin-top:8px';m.appendChild(c);
c.onclick=function(){navigator.clipboard.writeText(out).then(function(){c.textContent='Copiado: pégalo en Studium'},function(){var a=document.createElement('textarea');a.value=out;d.appendChild(a);a.select();document.execCommand('copy');c.textContent='Copiado: pégalo en Studium'})}}
catch(e){m.textContent=e.message==='not-catalog'?'Esto funciona en la Oferta de cursos (catalogodecursos.usfq.edu.ec), con tu sesión iniciada.':e.message==='not-signed-in'?'Inicia sesión en la Oferta de cursos y vuelve a pulsar el marcador.':'No se pudo leer: '+e.message}b[0].disabled=false}})()`;
  return `javascript:${encodeURIComponent(ui)}`;
}
