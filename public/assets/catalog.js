const GUIDES = [
  { course: 'Redes de Computadores', code: 'CMP-4005', university: 'USFQ', term: '202610 · 1.er semestre 2026-2027', professor: 'Ricardo Flores Moyano',
    title: 'Examen 2', date: '2026-11-05', path: 'usfq/cmp-4005/202610/exam-2/',
    topics: ['Switches y VLANs', 'Packet Tracer y ARP', 'Router-on-a-stick', 'Capa de red', 'Datagrama IPv4', 'Subredes a mano', 'VLSM y agregación', 'Vector de distancia y RIP', 'Dijkstra y OSPF', 'RIPv2 en Cisco', 'ICMP, BGP, SDN'] },
];
const $ = (s) => document.querySelector(s);
const uniq = (k) => [...new Set(GUIDES.map((g) => g[k]))].sort();
const fill = (sel, k, label) => { sel.innerHTML = `<option value="">${label}</option>` + uniq(k).map((v) => `<option>${v}</option>`).join(''); };
fill($('#f-course'), 'course', 'Todas'); fill($('#f-term'), 'term', 'Todos'); fill($('#f-prof'), 'professor', 'Todos');
// Links resolve against the catalog's own folder, whether it is opened as /studium or /studium/
const link = (rel) => new URL(rel, location.origin + location.pathname.replace(/\/?(index\.html)?$/, '/')).href;
const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
function render() {
  const q = $('#q').value.trim().toLowerCase(), c = $('#f-course').value, t = $('#f-term').value, p = $('#f-prof').value;
  const rows = GUIDES.filter((g) => (!c || g.course === c) && (!t || g.term === t) && (!p || g.professor === p) && (!q || JSON.stringify(g).toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  $('#count').textContent = rows.length === 1 ? '1 guía' : `${rows.length} guías`;
  $('#list').innerHTML = rows.length ? rows.map((g) => `<article class="guide">
      <div><div class="code">${g.university} · ${g.code}</div><div class="when">${fmt(g.date)}</div></div>
      <div><h2>${g.course} · ${g.title}</h2><div class="meta">${g.professor} · ${g.term}</div><div class="tags">${g.topics.map((x) => `<span>${x}</span>`).join('')}</div></div>
      <a class="open" href="${link(g.path)}">Abrir guía →</a></article>`).join('') : '<div class="empty">Ninguna guía coincide con esos filtros.</div>';
}
['#q', '#f-course', '#f-term', '#f-prof'].forEach((s) => $(s).addEventListener('input', render));
render();
(() => { const r = document.documentElement; try { const t = localStorage.getItem('studium-theme'); if (t) r.dataset.theme = t; } catch (e) {}
  $('#theme').onclick = () => { const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('studium-theme', r.dataset.theme); } catch (e) {} }; })();
