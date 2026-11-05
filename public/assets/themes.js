// Visual themes for courses: two colors and a background motif drawn from what the course studies. A guide or a
// contribution names its theme; a course takes the theme most of its guides and contributions use.

export const THEMES = {
  vectores: { name: 'Vectores', hint: 'Álgebra, cálculo, matemáticas', a: '#3d7bff', b: '#2dd4bf' },
  redes: { name: 'Redes', hint: 'Redes, sistemas, telecomunicaciones', a: '#ff6a3d', b: '#3d6bff' },
  codigo: { name: 'Código', hint: 'Programación, software, datos', a: '#2ee59d', b: '#16b5d0' },
  algoritmos: { name: 'Algoritmos', hint: 'Programación competitiva: IEEEXtreme, ICPC', a: '#ffd23f', b: '#ff4f6d' },
  neuronas: { name: 'Neuronas', hint: 'Inteligencia artificial, estadística', a: '#ff5a4f', b: '#ffb547' },
  ondas: { name: 'Ondas', hint: 'Física, electrónica, señales', a: '#3fa7ff', b: '#7cf2ff' },
  moleculas: { name: 'Moléculas', hint: 'Química, materiales', a: '#b8f34a', b: '#2ed3a0' },
  celulas: { name: 'Células', hint: 'Biología, medicina, salud', a: '#ff6b7a', b: '#7be495' },
  mercados: { name: 'Mercados', hint: 'Economía, finanzas, administración', a: '#ffc93c', b: '#19c2a0' },
  palabras: { name: 'Palabras', hint: 'Humanidades, idiomas, derecho', a: '#f0a35e', b: '#ff5a5f' },
  trazos: { name: 'Trazos', hint: 'Arte, diseño, arquitectura', a: '#ff7a59', b: '#5ac8fa' },
  estrellas: { name: 'Estrellas', hint: 'Cualquier otra materia', a: '#4f7dff', b: '#2dd4bf' },
};
export const DEFAULT_THEME = 'estrellas';

const GUESSES = [
  [/ieee|xtreme|icpc|competitiv|olimpiad|codeforces|hackathon|maraton de programacion/, 'algoritmos'],
  [/algebra|calculo|matemat|ecuacion|geometr|analisis real|discreta|numeric/, 'vectores'],
  [/redes|network|telecom|sistemas operativos|distribuid|ciberseg/, 'redes'],
  [/program|software|web|base(s)? de datos|algoritm|compilador|estructuras de datos|desarrollo/, 'codigo'],
  [/inteligencia|machine|aprendizaje|estadistic|probabilid|datos masivos|mineria/, 'neuronas'],
  [/fisica|electronic|senal|circuito|mecanica|termodin|electromag/, 'ondas'],
  [/quimic|material/, 'moleculas'],
  [/biolog|medicin|anatom|salud|genetic|fisiolog|nutric/, 'celulas'],
  [/econom|finanz|contab|administr|marketing|negocio|empresa/, 'mercados'],
  [/historia|filosof|literat|idioma|ingles|frances|derecho|comunicacion|etica|escritura/, 'palabras'],
  [/arte|diseno|arquitect|musica|cine|fotograf|animacion/, 'trazos'],
];

// One key per name: case, accents, punctuation and spacing do not matter.
export const keyOf = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const themeOf = (id) => THEMES[id] ?? THEMES[DEFAULT_THEME];
export const validTheme = (id) => (id in THEMES ? id : null);
export function guessTheme(course) {
  const key = keyOf(course).replaceAll('-', ' ');
  return GUESSES.find(([pattern]) => pattern.test(key))?.[1] ?? DEFAULT_THEME;
}

// The theme of each course, by course key: the one its guides and contributions use most.
export function courseThemes(items) {
  const votes = new Map();
  for (const item of items) {
    const key = keyOf(item.course);
    if (!key) continue;
    const tally = votes.get(key) ?? new Map();
    const theme = validTheme(item.theme) ?? guessTheme(item.course);
    tally.set(theme, (tally.get(theme) ?? 0) + 1);
    votes.set(key, tally);
  }
  return new Map([...votes].map(([key, tally]) => [key, [...tally].sort((x, y) => y[1] - x[1])[0][0]]));
}

// Background motifs: one 160 px tile each, drawn in the given color.
const MOTIFS = {
  vectores: `<path d="M0 40H160M0 80H160M0 120H160M40 0V160M80 0V160M120 0V160" opacity=".35"/>
    <path d="M40 120 100 60m0 0-15 3m15-3-3 15M40 120l88-12m0 0-11-8m11 8-10 9" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  redes: `<path d="M20 30 80 52l60-28M80 52 60 112l60 20M60 112 14 142m106-10 32-42-72-38" stroke-width="1.6"/>
    <g fill="C" stroke="none"><circle cx="20" cy="30" r="4"/><circle cx="80" cy="52" r="6.5"/><circle cx="140" cy="24" r="4"/><circle cx="60" cy="112" r="5"/><circle cx="120" cy="132" r="4"/><circle cx="14" cy="142" r="3"/><circle cx="152" cy="90" r="4"/></g>`,
  algoritmos: `<path d="M80 22 44 62m36-40 36 40M44 62 26 104m18-42 22 42m50-42-6 42m6-42 24 42" stroke-width="1.8"/>
    <g fill="C" stroke="none"><circle cx="80" cy="22" r="7"/><circle cx="44" cy="62" r="5.5"/><circle cx="116" cy="62" r="5.5"/><circle cx="26" cy="104" r="4"/><circle cx="66" cy="104" r="4"/><circle cx="110" cy="104" r="4"/><circle cx="140" cy="104" r="4"/></g>
    <path d="M20 140h28l8-10 8 20 8-10h28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>`,
  codigo: `<path d="m42 48-20 20 20 20m30-44-12 48m30-44 20 20-20 20" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M124 104c-9 0-9 7-9 13s0 10-7 10c7 0 7 4 7 10s0 13 9 13M18 128h44M18 142h26" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>`,
  neuronas: `<path d="M24 40 80 24M24 40l56 40M24 40l56 56M24 120 80 24m-56 96 56-40m-56 40 56-24M80 24l56 56M80 80h56m-56 16 56-16" stroke-width="1.2" opacity=".6"/>
    <g fill="C" stroke="none"><circle cx="24" cy="40" r="6"/><circle cx="24" cy="120" r="6"/><circle cx="80" cy="24" r="5"/><circle cx="80" cy="80" r="5"/><circle cx="80" cy="96" r="5"/><circle cx="136" cy="80" r="7"/></g>`,
  ondas: `<path d="M0 50c20-30 40-30 60 0s40 30 60 0 30-30 40-14M0 110c20-30 40-30 60 0s40 30 60 0 30-30 40-14" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M0 80h160" stroke-width="1" stroke-dasharray="4 6" opacity=".5"/>`,
  moleculas: `<path d="M50 30 76 45v30L50 90 24 75V45ZM76 45l26-15 26 15v30l-26 15-26-15M102 90v28l-24 14M50 90v26" stroke-width="2" stroke-linejoin="round"/>
    <g fill="C" stroke="none"><circle cx="78" cy="132" r="5"/><circle cx="50" cy="118" r="4"/></g>`,
  celulas: `<circle cx="48" cy="52" r="30" stroke-width="2"/><circle cx="54" cy="46" r="10" fill="C" fill-opacity=".35"/>
    <circle cx="118" cy="114" r="24" stroke-width="2"/><circle cx="112" cy="118" r="8" fill="C" fill-opacity=".35"/>
    <circle cx="130" cy="34" r="8" stroke-width="1.6" opacity=".7"/><circle cx="30" cy="132" r="6" stroke-width="1.6" opacity=".7"/>`,
  mercados: `<path d="M30 40v80M70 30v70M110 60v80M150 20v60" stroke-width="1.4"/>
    <g fill="C" fill-opacity=".45"><rect x="22" y="58" width="16" height="40" rx="3"/><rect x="62" y="44" width="16" height="34" rx="3"/><rect x="102" y="80" width="16" height="44" rx="3"/><rect x="142" y="34" width="16" height="30" rx="3"/></g>
    <path d="M0 140 40 120l40 10 40-36 40-20" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  palabras: `<path d="M28 40c-8 4-12 10-12 18h10v12H14V58c0-12 6-20 14-24M52 40c-8 4-12 10-12 18h10v12H38V58c0-12 6-20 14-24" stroke-width="2"/>
    <path d="M70 52h70M70 66h56M16 100h124M16 114h96M16 128h112" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>`,
  trazos: `<path d="M10 120c30-60 60-80 90-50s40 10 50-30" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    <circle cx="44" cy="44" r="16" stroke-width="2"/><path d="m110 130 30-30" stroke-width="2.4" stroke-linecap="round"/>`,
  estrellas: `<g fill="C" stroke="none"><circle cx="20" cy="24" r="1.6"/><circle cx="96" cy="16" r="1.2"/><circle cx="140" cy="60" r="1.8"/><circle cx="60" cy="90" r="1.2"/><circle cx="24" cy="140" r="1.6"/><circle cx="120" cy="136" r="1.3"/></g>
    <path d="M80 50v20M70 60h20M130 104v12m-6-6h12" stroke-width="1.8" stroke-linecap="round"/>`,
};

export function motif(id, color) {
  const body = (MOTIFS[id] ?? MOTIFS[DEFAULT_THEME]).replaceAll('"C"', `"${color}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" fill="none" stroke="${color}">${body}</svg>`;
  // Single quotes: the value also goes inside style="…" attributes.
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

// CSS custom properties for an element that wears a theme.
// Text on a theme color: dark on bright colors, white on deep ones.
function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.2 ? '#0a0f2a' : '#ffffff';
}
export function themeStyle(id) {
  const t = themeOf(id);
  return `--a:${t.a};--b:${t.b};--on-a:${readableOn(t.a)};--motif:${motif(validTheme(id) ?? DEFAULT_THEME, t.a)}`;
}
