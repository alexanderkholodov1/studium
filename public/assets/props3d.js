// The objects the secrets leave (eggs.js, space.js), in real 3D: geometry, materials, light, reflections and shadows,
// never flat drawings (his rule: depth and volume). three.js comes from jsDelivr, a pinned version, and loads only when
// a secret has been found. One WebGL context draws every object: each canvas on the page gets a copy of its frame, so
// the browser keeps one context however many objects there are. Each object moves only while it is on screen, and
// stays still with reduced motion or the focus ambience.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
const ROOM_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';

let T = null; // three.js
let gl = null; // { renderer, env, w, h }
let loading = null;
const live = new Set(); // { canvas, ctx, prop, on }
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.ambience === 'enfoque';
const DPR = () => Math.min(2, devicePixelRatio || 1);
const MAX_W = 560;
const MAX_H = 460;

async function boot() {
  if (gl) return gl;
  loading ??= (async () => {
    T = await import(THREE_URL);
    const { RoomEnvironment } = await import(ROOM_URL);
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(MAX_W * DPR(), MAX_H * DPR(), false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setScissorTest(true);
    const pmrem = new T.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    gl = { renderer, env, w: MAX_W * DPR(), h: MAX_H * DPR() };
    return gl;
  })();
  return loading;
}

/* ---------- materials and pieces ---------- */
const std = (color, roughness = 0.6, metalness = 0, more = {}) => new T.MeshStandardMaterial({ color, roughness, metalness, ...more });
const phys = (color, more = {}) => new T.MeshPhysicalMaterial({ color, ...more });
function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, cast = true, receive = true } = {}) {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(...s);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}
// A wood grain, painted once on a small canvas.
let woodTex = null;
function wood() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#7a4523'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i += 1) {
    x.strokeStyle = `rgba(${40 + Math.random() * 30},${18 + Math.random() * 12},6,${0.15 + Math.random() * 0.25})`;
    x.lineWidth = 1 + Math.random() * 2.5;
    x.beginPath(); const y0 = Math.random() * 256; x.moveTo(0, y0);
    for (let k = 0; k <= 256; k += 32) x.lineTo(k, y0 + Math.sin(k / 40 + i) * 4);
    x.stroke();
  }
  woodTex = new T.CanvasTexture(c); woodTex.colorSpace = T.SRGBColorSpace; woodTex.wrapS = woodTex.wrapT = T.RepeatWrapping;
  return woodTex;
}
// A soft round spot, for steam, sparks and glows.
let softTex = null;
function soft() {
  if (softTex) return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  softTex = new T.CanvasTexture(c);
  return softTex;
}
function stage(scene, { ground = true, key = [3, 5, 4], intensity = 2.2, warm = false } = {}) {
  scene.environment = gl.env;
  const hemi = new T.HemisphereLight(warm ? 0xffe2c0 : 0xdfe8ff, 0x3a2a20, 0.5);
  const sun = new T.DirectionalLight(warm ? 0xffd2a0 : 0xffffff, intensity);
  sun.position.set(...key); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 6; sun.shadow.bias = -0.0005;
  const sc = sun.shadow.camera; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 20;
  scene.add(hemi, sun);
  if (ground) {
    const floor = new T.Mesh(new T.PlaneGeometry(12, 12), new T.ShadowMaterial({ opacity: 0.28 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
  }
  return sun;
}
const camera = (fov, pos, look, aspect = 1) => { const c = new T.PerspectiveCamera(fov, aspect, 0.1, 50); c.position.set(...pos); c.lookAt(...look); return c; };

/* ---------- the props ---------- */
// Each returns { scene, camera, update(t, dt), poke() }.
const PROPS = {
  // A chocolate cake on a porcelain plate: glossy ganache, a ring of cream dollops with a cherry on each, shavings on
  // the side, and one striped candle with a living flame that lights the top.
  cake() {
    const scene = new T.Scene(); stage(scene, { key: [2.5, 5, 3] });
    const g = new T.Group(); scene.add(g);
    g.add(mesh(new T.CylinderGeometry(1.42, 1.32, 0.07, 72), phys(0xf4f1ec, { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }), { y: 0.035 }));
    g.add(mesh(new T.CylinderGeometry(1, 1, 0.82, 72), std(0x3b1d12, 0.85), { y: 0.48 }));
    g.add(mesh(new T.CylinderGeometry(1.02, 1.02, 0.08, 72), phys(0x24100a, { roughness: 0.28, clearcoat: 0.8 }), { y: 0.92 }));
    const shav = std(0x2a140b, 0.7);
    for (let i = 0; i < 90; i += 1) {
      const a = Math.random() * Math.PI * 2; const y = 0.15 + Math.random() * 0.68;
      g.add(mesh(new T.BoxGeometry(0.07, 0.025, 0.02), shav, { x: Math.cos(a) * 1.01, y, z: Math.sin(a) * 1.01, ry: -a, rz: Math.random() * 3, receive: false }));
    }
    const cream = phys(0xfbf7f0, { roughness: 0.42, sheen: 0.6, sheenColor: new T.Color(0xffffff) });
    const cherry = phys(0xa80d1a, { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
    const stem = std(0x4a6a2a, 0.6);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2; const x = Math.cos(a) * 0.78; const z = Math.sin(a) * 0.78;
      g.add(mesh(new T.SphereGeometry(0.16, 24, 16), cream, { x, y: 1.0, z, s: [1, 0.75, 1] }));
      g.add(mesh(new T.ConeGeometry(0.12, 0.2, 18), cream, { x, y: 1.16, z, ry: a }));
      g.add(mesh(new T.SphereGeometry(0.085, 24, 16), cherry, { x, y: 1.3, z }));
      g.add(mesh(new T.CylinderGeometry(0.008, 0.008, 0.16, 6), stem, { x: x + 0.03, y: 1.42, z, rz: -0.4, cast: false }));
    }
    // The candle: a striped wax stick (a painted texture), a black wick, and the flame.
    const stripes = document.createElement('canvas'); stripes.width = 64; stripes.height = 256;
    const sx = stripes.getContext('2d'); sx.fillStyle = '#f6f1e8'; sx.fillRect(0, 0, 64, 256);
    sx.fillStyle = '#c8102e'; for (let k = -64; k < 256; k += 40) { sx.beginPath(); sx.moveTo(0, k); sx.lineTo(64, k + 30); sx.lineTo(64, k + 44); sx.lineTo(0, k + 14); sx.fill(); }
    const st = new T.CanvasTexture(stripes); st.colorSpace = T.SRGBColorSpace;
    g.add(mesh(new T.CylinderGeometry(0.05, 0.05, 0.62, 24), std(0xffffff, 0.5, 0, { map: st }), { y: 1.27 }));
    g.add(mesh(new T.CylinderGeometry(0.008, 0.008, 0.06, 6), std(0x111111), { y: 1.61, cast: false }));
    const flame = new T.Group(); flame.position.set(0, 1.7, 0); g.add(flame);
    const outer = mesh(new T.SphereGeometry(0.06, 20, 16), new T.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85 }), { s: [1, 2.1, 1], cast: false, receive: false });
    const inner = mesh(new T.SphereGeometry(0.035, 16, 12), new T.MeshBasicMaterial({ color: 0xfff3c0 }), { y: -0.02, s: [1, 1.8, 1], cast: false, receive: false });
    const glow = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0xffb04a, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.6);
    const light = new T.PointLight(0xffa040, 1.6, 3, 2); light.castShadow = false;
    flame.add(outer, inner, glow, light);
    let lit = true;
    return {
      scene, camera: camera(32, [0, 2.4, 4.2], [0, 0.75, 0]),
      update(t) {
        g.rotation.y = Math.sin(t * 0.25) * 0.5;
        const f = 1 + Math.sin(t * 23) * 0.06 + Math.sin(t * 37) * 0.04;
        flame.scale.set(1, f, 1); light.intensity = lit ? 1.4 * f : 0;
      },
      poke() { lit = !lit; flame.visible = lit; return lit; },
    };
  },

  // A ceramic mug of coffee on its saucer, with steam that rises and fades.
  cup(opts = {}) {
    const scene = new T.Scene(); stage(scene, { key: [-2, 4, 3], warm: true, ground: !opts.desk });
    const g = new T.Group(); scene.add(g);
    const ceramic = phys(opts.color ?? 0xefe4d2, { roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.08 });
    const P = (x, y) => new T.Vector2(x, y);
    // One closed profile, turned: the outside, the rim and the inside of the mug.
    const mug = new T.LatheGeometry([P(0, 0.02), P(0.5, 0.02), P(0.56, 0.08), P(0.6, 0.95), P(0.58, 1.0), P(0.54, 0.98), P(0.52, 0.12), P(0, 0.12)], 64);
    g.add(mesh(mug, ceramic, { y: 0.06 }));
    g.add(mesh(new T.CircleGeometry(0.52, 48), phys(0x2b160a, { roughness: 0.1, clearcoat: 1 }), { y: 0.92, rx: -Math.PI / 2, cast: false }));
    g.add(mesh(new T.TorusGeometry(0.24, 0.055, 18, 40, Math.PI * 1.15), ceramic, { x: 0.6, y: 0.56, rz: -Math.PI * 0.57 }));
    const saucer = new T.LatheGeometry([P(0, 0), P(0.95, 0.02), P(1.02, 0.08), P(0.98, 0.09), P(0.62, 0.04), P(0, 0.04)], 64);
    g.add(mesh(saucer, ceramic));
    // The steam: soft puffs, each rising, swaying and fading, then starting again.
    const puffs = Array.from({ length: 14 }, (_, i) => {
      const s = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      s.userData.phase = i / 14; g.add(s); return s;
    });
    return {
      scene, camera: opts.camera ?? camera(30, [0, 2.2, 4.4], [0.1, 0.6, 0]), group: g,
      update(t) {
        g.rotation.y = opts.desk ? -0.5 : Math.sin(t * 0.3) * 0.4 - 0.4;
        for (const s of puffs) {
          const k = (t * 0.22 + s.userData.phase) % 1;
          s.position.set(Math.sin(k * 6 + s.userData.phase * 10) * 0.12, 1.05 + k * 1.3, Math.cos(k * 5) * 0.08);
          s.scale.setScalar(0.25 + k * 0.6);
          s.material.opacity = Math.sin(k * Math.PI) * 0.22;
        }
      },
    };
  },

  // A gramophone: a wooden box with brass corners, a turning black record, a tonearm and a big brass horn.
  gramophone() {
    const scene = new T.Scene(); stage(scene, { key: [3, 5, 2], warm: true });
    const g = new T.Group(); scene.add(g);
    g.add(mesh(new T.BoxGeometry(1.5, 0.55, 1.5), std(0xffffff, 0.55, 0, { map: wood() }), { y: 0.3 }));
    const brass = std(0xd4a63c, 0.28, 1);
    for (const [x, z] of [[-0.74, -0.74], [0.74, -0.74], [-0.74, 0.74], [0.74, 0.74]]) g.add(mesh(new T.BoxGeometry(0.06, 0.57, 0.06), brass, { x, y: 0.3, z }));
    const record = new T.Group(); record.position.y = 0.6; g.add(record);
    record.add(mesh(new T.CylinderGeometry(0.62, 0.62, 0.025, 64), phys(0x0c0c0c, { roughness: 0.25, clearcoat: 0.6 })));
    record.add(mesh(new T.CylinderGeometry(0.2, 0.2, 0.03, 48), std(0xb2202e, 0.5), { y: 0.002 }));
    g.add(mesh(new T.CylinderGeometry(0.05, 0.06, 0.35, 16), brass, { x: 0.55, y: 0.75, z: 0.5 }));
    g.add(mesh(new T.CylinderGeometry(0.02, 0.02, 0.6, 12), brass, { x: 0.32, y: 0.9, z: 0.3, rz: 0.9, ry: -0.8 }));
    // The horn: a curve turned around itself, flaring at the mouth.
    const pts = []; for (let i = 0; i <= 24; i += 1) { const k = i / 24; pts.push(new T.Vector2(0.04 + k ** 3 * 0.75, k * 1.3)); }
    const horn = mesh(new T.LatheGeometry(pts, 64), std(0xd9ab45, 0.25, 1, { side: T.DoubleSide }), { x: 0.2, y: 1.0, z: -0.15, rx: -0.95, rz: 0.35 });
    g.add(horn);
    return {
      scene, camera: camera(32, [2.6, 2.6, 3.6], [0, 0.9, 0]),
      update(t) { record.rotation.y = -t * 2.4; g.rotation.y = Math.sin(t * 0.2) * 0.3 - 0.2; },
    };
  },

  // A small heart monitor: a plastic case, a glass screen that glows with the beating trace, and two knobs.
  monitor() {
    const scene = new T.Scene(); stage(scene, { key: [2, 4, 4] });
    const g = new T.Group(); scene.add(g);
    g.add(mesh(new T.BoxGeometry(2.2, 1.35, 0.6), phys(0xd9dde3, { roughness: 0.45, clearcoat: 0.3 }), { y: 0.72 }));
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    g.add(mesh(new T.PlaneGeometry(1.6, 0.85), new T.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, roughness: 0.1 }), { x: -0.18, y: 0.78, z: 0.301, cast: false }));
    g.add(mesh(new T.PlaneGeometry(1.7, 0.95), phys(0xffffff, { transmission: 1, roughness: 0.05, thickness: 0.05, transparent: true, opacity: 0.25 }), { x: -0.18, y: 0.78, z: 0.31, cast: false }));
    for (const y of [1.0, 0.55]) g.add(mesh(new T.CylinderGeometry(0.1, 0.1, 0.1, 24), std(0x2a2e36, 0.4), { x: 0.86, y, z: 0.33, rx: Math.PI / 2 }));
    const led = mesh(new T.SphereGeometry(0.04, 16, 12), new T.MeshBasicMaterial({ color: 0x3ddc97 }), { x: 0.86, y: 0.28, z: 0.31, cast: false });
    g.add(led);
    let fast = 0;
    const beat = (k) => { const p = k % 1; if (p < 0.08) return Math.sin(p / 0.08 * Math.PI) * 0.15; if (p > 0.3 && p < 0.34) return -0.2; if (p > 0.34 && p < 0.4) return 1; if (p > 0.4 && p < 0.46) return -0.45; if (p > 0.6 && p < 0.75) return Math.sin((p - 0.6) / 0.15 * Math.PI) * 0.25; return 0; };
    return {
      scene, camera: camera(30, [0.8, 1.6, 4.4], [0, 0.7, 0]),
      update(t, dt) {
        fast = Math.max(0, fast - dt);
        const speed = fast > 0 ? 2.6 : 1.1;
        x.fillStyle = '#04110b'; x.fillRect(0, 0, 256, 128);
        x.strokeStyle = 'rgba(61,220,151,.12)'; x.lineWidth = 1;
        for (let k = 0; k < 256; k += 16) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, 128); x.stroke(); }
        x.strokeStyle = '#3ddc97'; x.lineWidth = 3; x.shadowColor = '#3ddc97'; x.shadowBlur = 8; x.beginPath();
        for (let px = 0; px < 256; px += 2) { const y = 70 - beat(t * speed - (256 - px) / 160) * 50; if (px) x.lineTo(px, y); else x.moveTo(px, y); }
        x.stroke(); x.shadowBlur = 0;
        x.fillStyle = '#3ddc97'; x.font = 'bold 22px monospace'; x.fillText(`♥ ${fast > 0 ? 140 : 72}`, 168, 28);
        tex.needsUpdate = true;
        led.visible = beat(t * speed) > 0.5;
        g.rotation.y = Math.sin(t * 0.3) * 0.25 - 0.2;
      },
      poke() { fast = 3; },
    };
  },

  // Two portals on the floor, blue and orange-red, glowing and lighting the floor around them; a glass marble falls
  // into one and comes out of the other.
  portals() {
    const scene = new T.Scene(); stage(scene, { key: [1, 6, 3], intensity: 1.2 });
    const ring = (color, x) => {
      const r = new T.Group(); r.position.set(x, 0.01, 0);
      r.add(mesh(new T.TorusGeometry(0.62, 0.08, 24, 64), new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3 }), { rx: -Math.PI / 2, s: [1, 0.62, 1], cast: false }));
      r.add(mesh(new T.CircleGeometry(0.6, 48), new T.MeshBasicMaterial({ color: 0x05070d }), { rx: -Math.PI / 2, y: 0.005, s: [1, 0.62, 1], cast: false }));
      r.add(mesh(new T.TorusGeometry(0.72, 0.03, 12, 64), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }), { rx: -Math.PI / 2, s: [1, 0.62, 1], cast: false }));
      const l = new T.PointLight(color, 8, 3, 2); l.position.y = 0.35; r.add(l);
      scene.add(r); return r;
    };
    ring(0x3d7bff, -1.15); ring(0xff6a2a, 1.15);
    const marble = mesh(new T.SphereGeometry(0.18, 32, 24), phys(0xcfe2ff, { roughness: 0, transmission: 1, thickness: 0.4, ior: 1.5, clearcoat: 1 }), { y: -1 });
    scene.add(marble);
    let since = -1;
    return {
      scene, camera: camera(34, [0, 3.1, 4.3], [0, 0.05, 0]),
      update(t, dt) {
        if (since < 0) { marble.visible = false; return; }
        since += dt; marble.visible = true;
        const k = since / 1.8;
        if (k < 0.4) marble.position.set(-1.15, 1.6 - (k / 0.4) ** 2 * 1.7, 0);
        else if (k < 1) { const q = (k - 0.4) / 0.6; marble.position.set(1.15 + q * 1.2, -0.1 + Math.sin(q * Math.PI) * 1.4, 0); }
        else since = -1;
      },
      poke() { since = 0; },
    };
  },

  // A gold trophy cup on a dark wooden base, polished metal reflecting the room.
  trophy() {
    const scene = new T.Scene(); stage(scene, { key: [2, 5, 3] });
    const g = new T.Group(); scene.add(g);
    const gold = std(0xe6b422, 0.22, 1);
    g.add(mesh(new T.BoxGeometry(0.9, 0.3, 0.9), std(0x3a2114, 0.45, 0, { map: wood() }), { y: 0.15 }));
    const P = (x, y) => new T.Vector2(x, y);
    g.add(mesh(new T.LatheGeometry([P(0.25, 0.3), P(0.3, 0.34), P(0.08, 0.45), P(0.07, 0.75), P(0.12, 0.8), P(0.42, 0.95), P(0.5, 1.45), P(0.47, 1.47), P(0.38, 1.0), P(0, 0.98)], 64), gold));
    for (const s of [1, -1]) g.add(mesh(new T.TorusGeometry(0.2, 0.035, 14, 32, Math.PI), gold, { x: s * 0.5, y: 1.2, rz: s * -Math.PI / 2 }));
    let spin = 0;
    return {
      scene, camera: camera(30, [0, 1.8, 3.6], [0, 0.75, 0]),
      update(t, dt) { spin = Math.max(0, spin - dt); g.rotation.y = t * 0.4 + spin * 6; },
      poke() { spin = 1.2; },
    };
  },

  // A campfire: crossed logs with bark, a ring of stones, flames that flicker and lift sparks, lighting everything.
  fire() {
    const scene = new T.Scene(); stage(scene, { key: [2, 5, 2], intensity: 0.25 });
    const bark = std(0x4a2f1e, 0.95);
    for (let i = 0; i < 4; i += 1) scene.add(mesh(new T.CylinderGeometry(0.11, 0.13, 1.5, 12), bark, { y: 0.16, rz: Math.PI / 2 - 0.25, ry: (i / 4) * Math.PI }));
    const stone = std(0x77736d, 0.9);
    for (let i = 0; i < 11; i += 1) { const a = (i / 11) * Math.PI * 2; scene.add(mesh(new T.DodecahedronGeometry(0.17 + Math.random() * 0.06), stone, { x: Math.cos(a) * 0.95, y: 0.1, z: Math.sin(a) * 0.95, rx: Math.random(), ry: Math.random() })); }
    const flames = Array.from({ length: 7 }, (_, i) => {
      const m = mesh(new T.ConeGeometry(0.18 - i * 0.012, 0.9 - i * 0.05, 18, 1, true), new T.MeshBasicMaterial({ color: i < 3 ? 0xff7a1a : 0xffc04a, transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }), { cast: false, receive: false });
      m.userData = { a: (i / 7) * Math.PI * 2, r: i ? 0.14 : 0, p: Math.random() * 10 }; scene.add(m); return m;
    });
    const sparks = Array.from({ length: 24 }, () => { const s = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0xffa23a, transparent: true, blending: T.AdditiveBlending, depthWrite: false })); s.userData.p = Math.random(); scene.add(s); return s; });
    const light = new T.PointLight(0xff8a2a, 6, 6, 1.6); light.position.y = 0.6; light.castShadow = true; scene.add(light);
    return {
      scene, camera: camera(36, [0, 1.9, 3.4], [0, 0.4, 0]),
      update(t) {
        for (const f of flames) {
          const w = Math.sin(t * 9 + f.userData.p) * 0.08;
          f.position.set(Math.cos(f.userData.a) * f.userData.r, 0.6 + w, Math.sin(f.userData.a) * f.userData.r);
          f.scale.set(1, 1 + Math.sin(t * 13 + f.userData.p) * 0.18, 1);
        }
        for (const s of sparks) {
          const k = (t * 0.5 + s.userData.p) % 1;
          s.position.set(Math.sin(k * 9 + s.userData.p * 20) * 0.3, 0.5 + k * 2, Math.cos(k * 7 + s.userData.p * 20) * 0.2);
          s.scale.setScalar(0.06 * (1 - k)); s.material.opacity = 1 - k;
        }
        light.intensity = 5 + Math.sin(t * 17) * 0.8 + Math.sin(t * 29) * 0.6;
      },
    };
  },

  // A glossy red heart that beats.
  heart() {
    const scene = new T.Scene(); stage(scene, { key: [2, 4, 4], ground: false });
    const s = new T.Shape();
    s.moveTo(0, -0.9); s.bezierCurveTo(-0.2, -0.6, -1, -0.2, -1, 0.3); s.bezierCurveTo(-1, 0.8, -0.4, 1.05, 0, 0.6);
    s.bezierCurveTo(0.4, 1.05, 1, 0.8, 1, 0.3); s.bezierCurveTo(1, -0.2, 0.2, -0.6, 0, -0.9);
    const geo = new T.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.28, bevelSize: 0.22, bevelSegments: 10, curveSegments: 32 });
    geo.center();
    const heart = mesh(geo, phys(0xd61f3c, { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4 }));
    scene.add(heart);
    return {
      scene, camera: camera(30, [0, 0, 5], [0, 0, 0]),
      update(t) { const b = 1 + Math.max(0, Math.sin(t * 7)) ** 8 * 0.18; heart.scale.setScalar(b); heart.rotation.y = Math.sin(t * 1.2) * 0.5; },
    };
  },

  // The study desk of «Noche de estudio»: a wooden desk, a desk lamp whose warm light falls in a cone with soft shadows,
  // and a mug of coffee steaming in its light.
  desk() {
    const cup = PROPS.cup({ desk: true, camera: camera(34, [2.4, 3.2, 4.6], [0.3, 0.8, 0]) });
    const { scene } = cup;
    scene.add(mesh(new T.BoxGeometry(6, 0.2, 3.4), std(0xffffff, 0.5, 0, { map: wood() }), { y: -0.1 }));
    cup.group.position.set(0.6, 0, 0.6);
    const metal = std(0x2c2f36, 0.35, 0.8);
    scene.add(mesh(new T.CylinderGeometry(0.45, 0.5, 0.1, 40), metal, { x: -1.2, y: 0.05, z: -0.6 }));
    scene.add(mesh(new T.CylinderGeometry(0.04, 0.04, 1.8, 12), metal, { x: -1.2, y: 0.95, z: -0.6, rz: 0.3 }));
    scene.add(mesh(new T.CylinderGeometry(0.04, 0.04, 1.2, 12), metal, { x: -0.75, y: 1.95, z: -0.6, rz: -1.1 }));
    const shade = mesh(new T.ConeGeometry(0.42, 0.6, 40, 1, true), std(0x1d4d3a, 0.4, 0.3, { side: T.DoubleSide }), { x: -0.15, y: 1.95, z: -0.6, rz: -0.6 });
    scene.add(shade);
    const bulb = mesh(new T.SphereGeometry(0.11, 20, 16), new T.MeshBasicMaterial({ color: 0xfff1c8 }), { x: -0.05, y: 1.82, z: -0.6, cast: false });
    scene.add(bulb);
    const spot = new T.SpotLight(0xffc98a, 40, 8, 0.75, 0.6, 1.6);
    spot.position.set(-0.05, 1.8, -0.6); spot.target.position.set(0.7, 0, 0.5); spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024);
    scene.add(spot, spot.target);
    return { scene, camera: cup.camera, update: cup.update };
  },
};

/* ---------- drawing ---------- */
let raf = 0;
let last = 0;
let t0 = performance.now();
const seen = new IntersectionObserver((entries) => { for (const e of entries) for (const p of live) if (p.canvas === e.target) p.on = e.isIntersecting; });
function frame(now) {
  raf = 0;
  if (!gl || !live.size) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  const t = (now - t0) / 1000;
  const { renderer } = gl;
  for (const p of [...live]) {
    if (!p.canvas.isConnected) { live.delete(p); seen.unobserve(p.canvas); continue; }
    if (!p.on && p.drawn) continue;
    const w = Math.min(gl.w, p.canvas.width); const h = Math.min(gl.h, p.canvas.height);
    p.prop.update?.(still() ? 2 : t, still() ? 0 : dt);
    p.prop.camera.aspect = w / h; p.prop.camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(p.prop.scene, p.prop.camera);
    p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    p.ctx.drawImage(renderer.domElement, 0, gl.h - h, w, h, 0, 0, p.canvas.width, p.canvas.height);
    p.drawn = true;
  }
  if (!still() && !document.hidden) schedule();
}
// About 30 frames a second is plenty for these objects.
function schedule() { if (!raf) raf = requestAnimationFrame((now) => { if (now - last < 30) { raf = 0; setTimeout(schedule, 30 - (now - last)); return; } frame(now); }); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

// Puts a 3D object in a canvas (its CSS size decides the resolution). Returns a handle with poke(); the object goes
// away with its canvas.
export async function prop(canvas, kind) {
  await boot();
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(Math.min(MAX_W, r.width || canvas.clientWidth || 160) * DPR());
  canvas.height = Math.round(Math.min(MAX_H, r.height || canvas.clientHeight || 160) * DPR());
  const p = { canvas, ctx: canvas.getContext('2d'), prop: PROPS[kind](), on: true, drawn: false };
  live.add(p); seen.observe(canvas);
  last = 0; schedule();
  return { poke: () => { const out = p.prop.poke?.(); schedule(); return out; } };
}
// Every canvas with data-prop="kind" inside root gets its object (once).
export function props(root = document) {
  for (const c of root.querySelectorAll('canvas[data-prop]:not([data-on])')) {
    c.dataset.on = '1';
    prop(c, c.dataset.prop).then((h) => { c._prop = h; }).catch(() => { c.replaceWith(Object.assign(document.createElement('span'), { className: 'prop-off', textContent: '' })); });
  }
}
export const pokeProp = (canvas) => canvas?._prop?.poke();
