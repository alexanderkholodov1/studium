// Before the page paints: the theme and ambience this person chose, so it never flashes the other one.
try { const r = document.documentElement; const p = JSON.parse(localStorage.getItem('studium-prefs') || '{}');
  if (p.theme === 'light' || p.theme === 'dark') r.dataset.theme = p.theme;
  if (['jugueton', 'vivo', 'sereno', 'enfoque'].includes(p.ambience)) r.dataset.ambience = p.ambience; } catch (e) {}
