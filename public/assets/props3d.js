// The objects the secrets leave (eggs.js, space.js), in real 3D: geometry, materials, light, reflections and shadows,
// never flat drawings (his rule: depth and volume). three.js comes from jsDelivr, a pinned version, and loads only when
// a secret has been found. One WebGL context draws every object: each canvas on the page gets a copy of its frame, so
// the browser keeps one context however many objects there are. Each object moves only while it is on screen, and
// stays still with reduced motion or the focus ambience.
import { sfx } from './sfx.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
const ROOM_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';

let T = null; // three.js
let gl = null; // { renderer, env, w, h }
let loading = null;
const live = new Set(); // { canvas, ctx, prop, on }
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.ambience === 'enfoque';
// Sharp enough on any screen, and not more: every pixel of every object is drawn about thirty times a second.
const DPR = () => Math.min(1.5, devicePixelRatio || 1);
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

// Specter's body and face, shared by his own canvas and by the scenes he walks into (as a billboard in 3D, lit by
// the scene and hidden by what stands in front of him). uOutfit: 0 none, 2 apron, 3 backpack.
const SPECTER_FRAG = (billboard) => `precision highp float;
uniform vec2 uRes; uniform float uT, uYaw, uPitch, uRoll, uBlinkL, uBlinkR, uHappy, uWide, uHeart, uDizzy, uBrow, uSmile, uMouth, uBlush, uTear, uDoctor, uRed, uCream, uOutfit, uAlpha;
uniform vec3 uTint, uHandL, uHandR;
${billboard ? 'varying vec2 vUv;' : ''}
mat3 rY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
mat3 rX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
mat3 rZ(float a){ float c=cos(a), s=sin(a); return mat3(c,-s,0., s,c,0., 0.,0.,1.); }
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
vec3 toObj(vec3 p){ p = rZ(uRoll) * rX(uPitch) * rY(uYaw) * p; return vec3(p.x, p.y, p.z*1.12); }
// id 0: his body; 1: the band of the head mirror; 2: the mirror
vec2 map(vec3 w){
  vec3 q = toObj(w);
  float head = length(q - vec3(0., .24, 0.)) - .6;
  float ang = atan(q.z, q.x);
  float r = .55 + .19*smoothstep(.15, -.62, q.y);
  float hem = -.62 + .085*sin(ang*5. + uT*2.4) + .03*sin(ang*9. - uT*1.6);
  float skirt = max(-smin(-(length(q.xz) - r), -(q.y - .05), .3), hem - q.y);
  vec2 res = vec2(smin(head, skirt, .28) * .8, 0.);
  // the medic's pack on his back: a metal case with a red cross
  if (uDoctor > .5){
    vec3 mq = q - vec3(0., .0, -.5);
    vec3 md = abs(mq) - vec3(.28, .32, .13);
    float pack = length(max(md, 0.)) + min(max(md.x, max(md.y, md.z)), 0.) - .07;
    if (pack < res.x) res = vec2(pack, 5.);
  }
  // the backpack (camping): a rounded bag on his back, with a rolled blanket on top
  if (uOutfit > 2.5 && uDoctor < .5){
    vec3 bq = q - vec3(0., .0, -.52);
    vec3 bd = abs(bq) - vec3(.34, .36, .17);
    float bag = length(max(bd, 0.)) + min(max(bd.x, max(bd.y, bd.z)), 0.) - .08;
    vec3 rq = q - vec3(0., .5, -.5);
    float roll = length(vec2(length(rq.yz) - .0, 0.)) - .11; roll = max(roll, abs(rq.x) - .36);
    bag = min(bag, roll);
    if (bag < res.x) res = vec2(bag, 3.);
  }
  // his hands: two small round mittens that float by his sides (no arms, like a cartoon)
  float hl = (length((q - uHandL) / vec3(.12, .11, .1)) - 1.) * .1;
  float hr = (length((q - uHandR) / vec3(.12, .11, .1)) - 1.) * .1;
  // a thumb on each mitten, toward the body and up
  float tl = length(q - uHandL - vec3(.07, .07, .04)) - .045;
  float tr = length(q - uHandR - vec3(-.07, .07, .04)) - .045;
  float hd = min(smin(hl, tl, .04), smin(hr, tr, .04));
  if (hd < res.x) res = vec2(hd, 4.);
  return res;
}
vec3 nrm(vec3 p){ vec2 e = vec2(.0015, -.0015);
  return normalize(e.xyy*map(p+e.xyy).x + e.yyx*map(p+e.yyx).x + e.yxy*map(p+e.yxy).x + e.xxx*map(p+e.xxx).x); }
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba), 0., 1.); return length(pa - ba*h); }
float heart(vec2 p){ p.x = abs(p.x); if (p.y + p.x > 1.) return sqrt(dot(p - vec2(.25,.75), p - vec2(.25,.75))) - sqrt(2.)/4.;
  return sqrt(min(dot(p - vec2(0.,1.), p - vec2(0.,1.)), dot(p - .5*max(p.x+p.y,0.), p - .5*max(p.x+p.y,0.)))) * sign(p.x - p.y); }
vec3 face(vec3 col, vec2 f, float dif){
  vec3 ink = vec3(.05,.06,.12);
  float side = f.x < 0. ? -1. : 1.;
  float open = side < 0. ? uBlinkL : uBlinkR;
  vec2 ec = vec2(abs(f.x), f.y) - vec2(.205, .3);
  // a worried or angry look tilts the eyes a little
  ec.y += ec.x * uBrow * .25;
  float shape = max(max(uHappy, uHeart), uDizzy);
  float o = open * clamp(1. - 2.*shape, 0., 1.);
  vec2 esz = vec2(.088, .118) * (1. + .32*uWide);
  vec2 e = ec / vec2(esz.x, max(.006, esz.y*o));
  if (o > .02 && length(e) < 1.){
    col = mix(ink, vec3(.16,.18,.36), smoothstep(.2, 1., -e.y)) * (.75 + .25*dif);
    float pr = 1. - .45*uWide;
    vec2 s1 = (vec2(abs(f.x), f.y) - vec2(.18, .34)) / (.032*pr);
    if (length(s1) < 1. && o > .5) col = vec3(1.);
    vec2 s2 = (vec2(abs(f.x), f.y) - vec2(.235, .265)) / (.016*pr);
    if (length(s2) < 1. && o > .5) col = mix(col, vec3(1.), .8);
  }
  // asleep or winking: a closed eye is a soft line
  if (o <= .02 && shape < .5 && abs(ec.y + .01 - ec.x*ec.x*2.2) < .016 && abs(ec.x) < .08) col = ink;
  float k = clamp(2.*shape - 1., 0., 1.);
  if (k > 0.){
    if (uHappy >= uHeart && uHappy >= uDizzy){
      // happy eyes: two arcs, ^ ^
      float arc = abs(length(ec - vec2(0., -.05)) - .085);
      if (arc < .022*k && ec.y > -.045) col = ink;
    } else if (uHeart >= uDizzy){
      vec2 hp = (ec + vec2(0., .1)) / (.2*k);
      if (heart(hp) < 0.) col = mix(vec3(.95,.2,.38), vec3(1.,.55,.7), smoothstep(.0, .8, hp.y)) * (.8 + .3*dif);
    } else {
      // dizzy: spirals
      float rr = length(ec); float a = atan(ec.y, ec.x*side);
      float sp = abs(fract(rr*28. - a/6.2832 - uT*.8) - .5);
      if (rr < .095*k && sp < .16) col = ink;
    }
  }
  // the medic's round glasses: thin dark rims over his eyes and a bridge, the lenses a touch lighter
  // the medic's small round glasses, low on the nose: he looks over them
  if (uDoctor > .5){
    vec2 gp = vec2(abs(f.x), f.y) - vec2(.16, .2);
    float rim = abs(length(gp) - .075);
    if (length(gp) < .07) col = mix(col, vec3(.85,.92,1.), .18);
    if (rim < .011) col = vec3(.1,.1,.12);
    if (abs(f.y - .205) < .008 && abs(f.x) < .088) col = vec3(.1,.1,.12);
    if (abs(f.y - .215) < .007 && abs(f.x) > .232 && abs(f.x) < .34) col = vec3(.1,.1,.12);
  }
  // brows, only when they say something: up in the middle when worried or sad, down when angry
  float bw = abs(uBrow);
  if (bw > .05){
    vec2 bp = vec2(abs(f.x), f.y);
    float tilt = uBrow * .09;
    float d = seg(bp, vec2(.12, .46 + tilt), vec2(.3, .46 - tilt*.4));
    if (d < .018) col = mix(col, ink, smoothstep(.05, .4, bw));
  }
  // the mouth: a curve that smiles or frowns, or open (talking, surprised)
  if (uMouth > .08){
    vec2 m = (f - vec2(0., .12 - .02*uSmile)) / vec2(.07 + .02*uSmile, .02 + .07*uMouth);
    if (length(m) < 1.) col = mix(vec3(.24,.12,.27), vec3(.95,.45,.6), smoothstep(.2, 1., -m.y)) * (.6 + .4*dif);
  } else {
    float x = f.x;
    if (abs(x) < .075 && abs(f.y - (.125 - .012*uSmile + uSmile*x*x*9.)) < .016) col = vec3(.24,.12,.27);
  }
  // cheeks: rosier when glad or in love, red when angry
  float bl = length((vec2(abs(f.x), f.y) - vec2(.37, .17)) / vec2(.1, .055));
  col = mix(col, mix(vec3(1.,.56,.72), vec3(1.,.3,.32), uRed), uBlush * (1. - smoothstep(.3, 1., bl)));
  // cream on his face after a bite of the cake: a dab by the mouth and one on the cheek
  if (uCream > .02){
    float c1 = length((f - vec2(.11, .1)) / vec2(.085, .055));
    float c2 = length((f - vec2(-.34, .25)) / vec2(.06, .045));
    float cd = min(c1, c2);
    // a soft rim of shade makes the white cream read on his white body
    col = mix(col, col * vec3(.78, .74, .82), (1. - smoothstep(.95, 1.25, cd)) * uCream);
    col = mix(col, vec3(1., .97, .9) * (.9 + .15*dif), (1. - smoothstep(.75, .95, cd)) * uCream);
    if (cd < .45) col = mix(col, vec3(1.), .5 * min(uCream, 1.));
    // all messy: more cream on his forehead and chin, and chocolate smudges
    float m2 = clamp(uCream - 1., 0., 1.);
    if (m2 > .02){
      float c3 = length((f - vec2(.24, .55)) / vec2(.1, .06));
      float c4 = length((f - vec2(-.05, -.02)) / vec2(.12, .06));
      float cc = min(c3, c4);
      col = mix(col, vec3(1., .97, .9) * (.9 + .15*dif), (1. - smoothstep(.75, .95, cc)) * m2);
      float ch = min(length((f - vec2(-.2, .05)) / vec2(.07, .04)), length((f - vec2(.36, .38)) / vec2(.05, .035)));
      col = mix(col, vec3(.3, .15, .08) * (.6 + .4*dif), (1. - smoothstep(.7, .95, ch)) * m2);
    }
  }
  // a tear, falling slowly
  if (uTear > .05){
    float fall = fract(uT*.35) * .18;
    vec2 tp = (f - vec2(-.25, .2 - fall)) / vec2(.03, .045);
    tp.y += .35*abs(tp.x);
    if (length(tp) < 1.) col = mix(col, vec3(.6,.82,1.), uTear * (1. - fall*3.));
  }
  return col;
}
void main(){
  vec2 uv = ${billboard ? 'vUv - .5' : '(gl_FragCoord.xy - .5*uRes) / uRes.y'};
  vec3 ro = vec3(0., .08, 3.55);
  vec3 rd = normalize(vec3(uv, -1.62));
  float t = 0.; vec2 h = vec2(1.); float dmin = 9.; bool hit = false;
  for (int i = 0; i < 80; i++){
    h = map(ro + rd*t);
    dmin = min(dmin, h.x);
    if (h.x < .0012){ hit = true; break; }
    t += h.x;
    if (t > 6.) break;
  }
  if (!hit){
    float px = 3.55 / (uRes.y * 1.62);
    float a = (1. - smoothstep(0., px*1.6, dmin)) * .9 * uAlpha;
    ${billboard ? 'if (a < .02) discard;' : ''}
    gl_FragColor = vec4(vec3(.48,.55,1.)*uTint*a, a);
    return;
  }
  vec3 p = ro + rd*t; vec3 n = nrm(p); vec3 q = toObj(p); vec3 v = -rd;
  vec3 L = normalize(vec3(-.55, .8, .7)); vec3 H = normalize(L + v);
  float dif = clamp(dot(n, L)*.5 + .5, 0., 1.); dif *= dif;
  float spec = pow(clamp(dot(n, H), 0., 1.), 42.);
  float fres = pow(1. - clamp(dot(n, v), 0., 1.), 2.6);
  float ao = clamp(map(p + n*.08).x / .08, .35, 1.);
  vec3 col;
  if (h.y > 4.5) {
    // the medic's pack: grey metal, a red cross on its back
    col = vec3(.55,.58,.62) * (.4 + .75*dif) + spec*.8;
    vec2 cq = vec2(q.x, q.y - .02);
    if (q.z < -.6 && ((abs(cq.x) < .045 && abs(cq.y) < .14) || (abs(cq.y) < .045 && abs(cq.x) < .14))) col = vec3(.78,.12,.12) * (.5 + .6*dif);
  } else if (h.y > 3.5) {
    // his hands: the same soft body; as a medic, dark rubber gloves
    vec3 base = uDoctor > .5 ? vec3(.72,.08,.1) : vec3(.86,.89,1.);
    col = base * (.4 + .7*dif) + (uDoctor > .5 ? vec3(.9) * spec * 1.2 + vec3(.3,.05,.05) * fres : vec3(.55,.5,1.)*fres*.7 + spec*.4);
  } else if (h.y > 2.5) {
    // the backpack: canvas green-brown, a lighter flap, a pocket, the blanket roll red
    col = mix(vec3(.36,.4,.26), vec3(.46,.5,.32), smoothstep(.12, .3, q.y)) * (.45 + .7*dif) + spec*.1;
    if (q.y > .38) col = vec3(.72,.2,.2) * (.45 + .7*dif);
    if (abs(q.x) < .2 && q.y < -.05 && q.y > -.3 && q.z < -.62) col *= .78;
  } else if (h.y > 1.5) {
    col = vec3(.78,.82,.88) * (.4 + .7*dif) + spec*1.4 + fres*.3;
  } else if (h.y > .5) {
    col = vec3(.16,.18,.24) * (.5 + .6*dif) + spec*.3;
  } else {
    vec3 base = mix(vec3(.72,.77,1.), vec3(1.,1.,1.), smoothstep(-.65, .8, q.y));
    col = base * (.36 + .72*dif) * mix(.72, 1., ao) + vec3(.55,.5,1.)*fres*.8 + spec*.4;
    col += vec3(.35,.4,1.) * .16 * smoothstep(-.2, -.6, q.y);
    // the medic: a white lab coat, closed, with buttons; a white shirt and a red tie show only in the V at the neck;
    // a high collar; a red cross on his chest
    if (uDoctor > .5){
      vec3 white = vec3(.97,.97,.95) * (.45 + .65*dif) * mix(.8, 1., ao) + spec*.2;
      float coat = smoothstep(.04, -.01, q.y);
      col = mix(col, white, coat);
      if (q.z > 0. && coat > .5){
        // the V at the neck: a white shirt, a red tie with its knot
        float vw = max(0., q.y + .14) * .55;
        if (q.y > -.14 && abs(q.x) < vw){
          col = vec3(.99,.99,1.) * (.6 + .5*dif);
          float tw = .022 + max(0., -.02 - q.y) * .06;
          if (abs(q.x) < tw && q.y < .02) col = vec3(.7,.08,.1) * (.5 + .6*dif) + spec*.3;
        }
        // the lapels' edges
        if (q.y > -.14 && abs(abs(q.x) - vw) < .014) col *= .8;
        // the buttons down the front
        for (int k = 0; k < 3; k++){ vec2 bp = vec2(q.x - .05, q.y + .24 + float(k) * .13); if (length(bp) < .022) col = vec3(.55,.57,.6) * (.5 + .6*dif) + spec*.6; }
        // the line where the coat closes
        if (abs(q.x - .025) < .006 && q.y < -.14) col *= .85;
      }
      // the high collar, up the sides of his neck
      if (q.y > -.02 && q.y < .1 && abs(q.x) > .34) col = white * .96;
      // a red cross on the left of his chest
      vec2 cr = vec2(q.x + .26, q.y + .2);
      if (q.z > .2 && ((abs(cr.x) < .02 && abs(cr.y) < .055) || (abs(cr.y) < .02 && abs(cr.x) < .055))) col = vec3(.8,.12,.12) * (.5 + .6*dif);
    }
    // the apron (the cake): pink with a white frill and a heart, over his lower body
    if (uOutfit > 1.5 && uOutfit < 2.5 && q.z > 0.){
      float ap = smoothstep(.02, -.03, q.y) * smoothstep(.44, .38, abs(q.x));
      float frill = ap * step(q.y, -.5 + .025*sin(q.x*60.));
      col = mix(col, vec3(1.,.78,.86) * (.5 + .6*dif) + spec*.15, ap * .95);
      col = mix(col, vec3(1.) * (.6 + .5*dif), frill);
      if (ap > .5 && length((q.xy - vec2(.0, -.22)) / vec2(.09, .07)) < 1.) col = vec3(.95,.45,.6) * (.6 + .4*dif);
    }
    // the backpack's straps over his shoulders
    if (uOutfit > 2.5 && uDoctor < .5 && q.z > 0. && abs(abs(q.x) - .4) < .045 && q.y < .42 && q.y > -.3) col = vec3(.4,.28,.18) * (.5 + .6*dif);
    if (q.z > .15) {
      if (uDoctor < .5){
        vec2 g = (q.xy - vec2(0., .64)) / vec2(.065, .08);
        if (abs(g.x) + abs(g.y) < 1.) col = mix(vec3(.3,.36,1.), vec3(.75,.8,1.), smoothstep(.2, -1., g.x + g.y)) * (.6 + .5*dif) + spec*.6;
      }
      col = face(col, q.xy, dif);
    }
  }
  gl_FragColor = vec4(col * uTint * uAlpha, uAlpha);
}`;
const specterUniforms = () => ({
  uHandL: { value: new T.Vector3(-0.66, -0.12, 0.12) }, uHandR: { value: new T.Vector3(0.66, -0.12, 0.12) },
  uRes: { value: new T.Vector2(1, 1) }, uT: { value: 0 }, uYaw: { value: 0 }, uPitch: { value: 0 }, uRoll: { value: 0 },
  uBlinkL: { value: 1 }, uBlinkR: { value: 1 }, uHappy: { value: 0 }, uWide: { value: 0 }, uHeart: { value: 0 }, uDizzy: { value: 0 },
  uBrow: { value: 0 }, uSmile: { value: 0.35 }, uMouth: { value: 0 }, uBlush: { value: 0.4 }, uTear: { value: 0 }, uDoctor: { value: 0 }, uRed: { value: 0 }, uCream: { value: 0 },
  uOutfit: { value: 0 }, uAlpha: { value: 1 }, uTint: { value: new T.Color(1, 1, 1) },
});
// What each emotion does to each feature; anything not named goes back to rest.
const REST = { happy: 0, wide: 0, heart: 0, dizzy: 0, brow: 0, smile: 0.35, mouth: 0, blush: 0.4, tear: 0, red: 0, shutL: 0, shutR: 0 };
const MOODS = {
  glad: { happy: 1, smile: 1, blush: 0.75 },
  shut: { shutL: 1, shutR: 1, smile: 0.15, blush: 0.3 },
  sad: { brow: 0.9, smile: -0.8, tear: 1, blush: 0.15, shutL: 0.35, shutR: 0.35 },
  surprised: { wide: 1, mouth: 0.9, brow: 0.55, smile: 0 },
  angry: { brow: -1, smile: -0.6, blush: 0.9, red: 1 },
  love: { heart: 1, smile: 1, blush: 1 },
  dizzy: { dizzy: 1, mouth: 0.35, smile: -0.2 },
  wink: { shutR: 1, smile: 1, blush: 0.6 },
  scared: { wide: 0.7, brow: 0.85, mouth: 0.45, smile: -0.5, blush: 0.1 },
  yawn: { shutL: 0.85, shutR: 0.85, mouth: 1, smile: 0, brow: 0.3 },
};
// His hands, in his own space (x to his left as you look at him, y up, z toward you), for each gesture.
const HANDS = {
  rest: [[-0.66, -0.14, 0.12], [0.66, -0.14, 0.12]],
  wave: [[-0.66, -0.14, 0.12], [0.6, 0.5, 0.25]],
  hold: [[-0.66, -0.14, 0.12], [0.46, 0.02, 0.5]],
  cheeks: [[-0.5, 0.18, 0.48], [0.5, 0.18, 0.48]],
  mouth: [[-0.66, -0.14, 0.12], [0.1, 0.1, 0.66]],
  up: [[-0.62, 0.66, 0.12], [0.62, 0.66, 0.12]],
  rub: [[-0.22, 0.3, 0.64], [0.66, -0.14, 0.12]],
  rummage: [[-0.3, 0.05, -0.78], [0.3, 0.1, -0.78]],
  shrug: [[-0.74, 0.26, 0.14], [0.74, 0.26, 0.14]],
  blow: [[-0.2, 0.08, 0.62], [0.2, 0.08, 0.62]],
  eat: [[-0.66, -0.14, 0.12], [0.08, 0.16, 0.66]],
  hips: [[-0.6, -0.02, 0.05], [0.6, -0.02, 0.05]],
  shake: [[-0.66, -0.14, 0.12], [0.5, 0.2, 0.45]],
};
// His face and hands from a state ({ mood, talk, look, yaw, cream, roll, hands }): each feature eases toward the
// emotion; he blinks now and then.
function specterFace(U) {
  const now = { ...REST };
  const hl = new T.Vector3(...HANDS.rest[0]); const hr = new T.Vector3(...HANDS.rest[1]);
  const tl = new T.Vector3(); const tr = new T.Vector3();
  let blinkAt = 2; let lastT = 0;
  return (t, d) => {
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    const target = { ...REST, ...(MOODS[d.mood] ?? {}) };
    const k = 1 - Math.exp(-dt * 9);
    for (const key of Object.keys(now)) now[key] += (target[key] - now[key]) * k;
    if (t > blinkAt) blinkAt = t + 2.5 + Math.random() * 3;
    const blink = blinkAt - t > 2.38 ? 0.08 : 1;
    U.uT.value = t;
    const look = Number(d.look) || 0;
    U.uYaw.value = d.yaw !== undefined && d.yaw !== '' ? Number(d.yaw) + Math.sin(t * 0.7) * 0.06 : Math.sin(t * 0.7) * 0.22 + look * 0.45;
    // The hands: toward the gesture, with a little life of their own; waving and shaking move them.
    const pose = HANDS[d.hands] ?? HANDS.rest;
    tl.set(...pose[0]); tr.set(...pose[1]);
    const bob = Math.sin(t * 2.4) * 0.03;
    tl.y += bob; tr.y += Math.sin(t * 2.4 + 1) * 0.03;
    if (d.hands === 'wave') { tr.x += Math.sin(t * 11) * 0.1; tr.y += Math.abs(Math.sin(t * 11)) * 0.04; }
    if (d.hands === 'shake') { tr.x += Math.sin(t * 22) * 0.16; tr.y += Math.cos(t * 22) * 0.06; }
    if (d.hands === 'rub') { tl.x += Math.sin(t * 9) * 0.05; tl.y += Math.cos(t * 9) * 0.04; }
    if (d.hands === 'rummage') { tl.y += Math.sin(t * 8) * 0.08; tr.y += Math.cos(t * 7) * 0.08; }
    const kh = 1 - Math.exp(-dt * 10);
    hl.lerp(tl, kh); hr.lerp(tr, kh);
    U.uHandL.value.copy(hl); U.uHandR.value.copy(hr);
    U.uPitch.value = Math.sin(t * 1.1) * 0.06 - (d.mood === 'sad' ? 0.05 : 0);
    U.uRoll.value = Math.sin(t * 0.9) * 0.05 + (d.mood === 'dizzy' ? Math.sin(t * 6) * 0.18 : 0) + (d.mood === 'scared' ? Math.sin(t * 40) * 0.03 : 0) + (Number(d.roll) || 0);
    U.uBlinkL.value = Math.min(blink, 1 - now.shutL);
    U.uBlinkR.value = Math.min(blink, 1 - now.shutR);
    U.uHappy.value = now.happy; U.uWide.value = now.wide; U.uHeart.value = now.heart; U.uDizzy.value = now.dizzy;
    U.uBrow.value = now.brow; U.uSmile.value = now.smile; U.uBlush.value = now.blush; U.uTear.value = now.tear; U.uRed.value = now.red;
    // Talking, the mouth opens and closes with the syllables.
    U.uMouth.value = Math.max(now.mouth, d.talk === '1' || d.talk === true ? 0.25 + 0.55 * Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3)) : 0);
    U.uDoctor.value = d.skin === 'doctor' ? 1 : 0;
    U.uCream.value += ((d.cream === 'messy' ? 2 : d.cream === '1' || d.cream === true ? 1 : 0) - U.uCream.value) * k;
  };
}
// Specter inside a scene: a billboard that always faces the camera, depth-tested against the scene.
function specterActor(parent) {
  const U = specterUniforms();
  const mat = new T.ShaderMaterial({ uniforms: U, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }', fragmentShader: SPECTER_FRAG(true), transparent: true, depthWrite: false });
  mat.premultipliedAlpha = true;
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
  mesh.visible = false; mesh.renderOrder = 5; parent.add(mesh);
  const face = specterFace(U);
  const state = { mood: '', talk: false, cream: false, roll: 0 };
  const pq = new T.Quaternion();
  return {
    mesh, U, state,
    update(t, cam, size) {
      if (!mesh.visible) return;
      mesh.parent.getWorldQuaternion(pq);
      mesh.quaternion.copy(pq.invert()).multiply(cam.quaternion);
      U.uRes.value.set(size, size);
      face(t, state);
    },
  };
}

// Specter's stories inside a scene. He comes in already dressed for it, flies in from outside along an arc, circles
// the scene once (what stands in front of him hides him, and he turns the way he flies, so you see his back and his
// side), and then lives the story: a list of steps, each one long enough to be read, with a place to go (hopping or
// flying), where to look, his hands, his face, a stretch or a squash, and what happens in the world. Then he flies
// away. `on(event)` tells the page: { say, x, y, ms }, { mark: '!' | '?' | 'z', x, y }, { notes, x, y }, { end }.
// A billboard's own space: one unit of his body is `size / 2.19` of the scene's.
const BODY = 1 / 2.19;
function storyStage({ actor, cam, look: { entry, exit, center, radius, height, size }, project, warm = () => 1 }) {
  const V = (a) => new T.Vector3(...a);
  const E = V(entry); const X = V(exit);
  const orbitAt = (a) => new T.Vector3(center[0] + Math.cos(a) * radius, height + Math.sin(a * 2) * 0.12, center[2] + Math.sin(a) * radius);
  const A0 = 0.45; const IN = 2.2; const AROUND = 3.6; const OUT = 2.0;
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
  const arc = (a, b, k, lift) => a.clone().lerp(b, ease(k)).add(new T.Vector3(0, Math.sin(k * Math.PI) * lift, 0));
  const right = new T.Vector3(); const up = new T.Vector3(); const back = new T.Vector3(); const tmp = new T.Vector3();
  const parent = actor.mesh.parent;
  let run = null;
  // The camera's axes, in the scene's own space.
  function axes() {
    cam.updateMatrixWorld(); parent.updateMatrixWorld();
    const inv = new T.Matrix3().setFromMatrix4(parent.matrixWorld).invert();
    right.setFromMatrixColumn(cam.matrixWorld, 0).applyMatrix3(inv).normalize();
    up.setFromMatrixColumn(cam.matrixWorld, 1).applyMatrix3(inv).normalize();
    back.setFromMatrixColumn(cam.matrixWorld, 2).applyMatrix3(inv).normalize();
  }
  // The yaw that makes him face a direction of the scene (0: toward you).
  const yawFor = (dir) => Math.atan2(dir.dot(right), dir.dot(back));
  // A point of his body (his own space, after his turn) in the scene: where his hand is, to hold things.
  function bodyPoint(q, yaw, pos) {
    const c = Math.cos(yaw); const sn = Math.sin(yaw);
    const px = c * q.x + sn * q.z; const pz = -sn * q.x + c * q.z;
    return pos.clone().addScaledVector(right, px * size * BODY).addScaledVector(up, (q.y - 0.08) * size * BODY).addScaledVector(back, pz * size * BODY);
  }
  const at = () => { const p = actor.mesh.position; return project(p.x, p.y + size * 0.42, p.z); };
  function emit(ev) { if (!run?.on) return; const p = at(); run.on({ ...ev, ...(p ? { x: p.x, y: p.y } : {}) }); }
  const ctx = {
    say: (text, ms = 2000) => emit({ say: text, ms }),
    mark: (m) => emit({ mark: m }),
    notes: (n = 3) => emit({ notes: n }),
  };
  return {
    busy: () => !!run,
    hand: () => (run ? bodyPoint(actor.U.uHandR.value, actor.U.uYaw.value, actor.mesh.position) : null),
    start(story, outfit, on, skin = '') {
      run = { story, on, t0: null, i: -1, stepT0: 0, from: null, pos: E.clone(), yaw: 0, stretch: 0 };
      actor.U.uOutfit.value = outfit;
      // His double wears what he wears (the medic's costume), with the scene's own things on top.
      Object.assign(actor.state, { mood: 'glad', talk: false, cream: false, roll: 0, hands: 'rest', yaw: 0, skin });
      return true;
    },
    // When he leaves, the scene is as it was (what he ate grows back, what he moved goes back).
    stop() { if (run) { actor.mesh.visible = false; const { on, story } = run; run = null; story.done?.(); actor.state.cream = false; on?.({ end: true }); } },
    update(t) {
      if (!run) return;
      axes();
      if (run.t0 === null) run.t0 = t;
      const e = t - run.t0;
      const steps = run.story.steps;
      let pos; let alpha = 1; let face = null; let heading = null; let grow = 1;
      const inEnd = IN + AROUND;
      if (e < IN) {
        const k = e / IN; pos = arc(E, orbitAt(A0), k, 0.5); heading = orbitAt(A0).sub(E);
        // He appears inside the frame, popping out of a little puff.
        grow = Math.min(1, 0.15 + e / 0.45); alpha = Math.min(1, e / 0.3);
        if (!run.poofed) { run.poofed = true; emit({ poof: true }); }
      }
      else if (e < inEnd) { const a = A0 - ((e - IN) / AROUND) * Math.PI * 2; pos = orbitAt(a); heading = orbitAt(a - 0.05).sub(pos); }
      else {
        // The steps of the story, one after another.
        if (run.i < 0 || (run.i < steps.length && e - run.stepT0 >= steps[run.i].ms / 1000)) {
          run.i += 1; run.stepT0 = e; run.from = run.pos.clone();
          const st = steps[run.i];
          if (st) {
            if (st.mood !== undefined) actor.state.mood = st.mood;
            if (st.hands) actor.state.hands = st.hands;
            if (st.talk !== undefined) actor.state.talk = st.talk;
            st.do?.(ctx);
          }
        }
        const st = steps[run.i];
        const k = st ? Math.min(1, (e - run.stepT0) / (st.ms / 1000)) : 1;
        if (st) {
          const to = st.to ? V(st.to) : null;
          pos = to ? arc(run.from, to, k, st.hop ?? (run.from.distanceTo(to) * 0.35)) : run.from.clone();
          if (to && run.from.distanceTo(to) > 0.05) heading = to.clone().sub(run.from);
          face = st.face;
          if (st.bounce) pos.y += Math.abs(Math.sin(k * Math.PI * st.bounce.n)) * st.bounce.h;
          if (st.jump) pos.y += Math.sin(Math.min(1, k * 1.6) * Math.PI) * st.jump;
          // Standing on something soft, he sinks into it a little.
          if (st.sink) pos.y -= st.sink * Math.min(1, k * 3);
          actor.state.roll = st.sway ? Math.sin(e * 3.4) * 0.2 : st.nod ? Math.max(0, Math.sin(e * 1.6)) * 0.28 : 0;
          run.stretch = st.stretch !== undefined ? st.stretch * Math.sin(Math.min(1, k * 2) * Math.PI) : run.stretch * 0.85;
          st.each?.(k, ctx);
        } else {
          // The end: away he flies.
          const ke = (e - run.stepT0) / OUT;
          if (ke >= 1) { emit({ poof: true }); this.stop(); return; }
          pos = arc(run.from, X, ke, 0.25); heading = X.clone().sub(run.from);
          // He vanishes inside the frame, in a little puff.
          grow = Math.min(1, (1 - ke) / 0.3); alpha = Math.min(1, (1 - ke) / 0.25);
          actor.state.hands = 'wave';
        }
      }
      run.pos.copy(pos);
      pos = pos.clone(); pos.y += Math.sin(t * 2.1) * 0.03;
      // Where he looks: the way he moves, a thing, or you.
      let yaw = run.yaw;
      if (face === 'you') yaw = 0;
      else if (Array.isArray(face)) { tmp.set(face[0] - pos.x, 0, face[2] - pos.z); yaw = yawFor(tmp); }
      else if (face === 'back') yaw = Math.PI;
      else if (heading && heading.lengthSq() > 1e-4) { heading.y = 0; yaw = yawFor(heading); }
      // The shortest way round.
      let dy = yaw - run.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      run.yaw += dy * 0.12;
      actor.state.yaw = run.yaw;
      actor.mesh.visible = true;
      actor.mesh.position.copy(pos);
      const sy = (1 + run.stretch) * grow; const sx = (1 - run.stretch * 0.5) * grow;
      actor.mesh.scale.set(size * sx, size * sy, size);
      actor.mesh.position.y += (sy - 1) * size * 0.4;
      actor.U.uAlpha.value = alpha;
      const w = warm(pos);
      actor.U.uTint.value.setRGB(0.78 + 0.27 * w, 0.82 + 0.1 * w, 0.95 - 0.12 * w);
      actor.update(t, cam, 160);
    },
  };
}

/* ---------- the props ---------- */
// Each returns { scene, camera, update(t, dt), poke() }.
const PROPS = {
  // A chocolate cake on a porcelain plate: glossy ganache, a ring of cream dollops with a cherry on each, shavings on
  // the side, and one striped candle with a living flame that lights the top.
  cake(canvas) {
    const scene = new T.Scene(); stage(scene, { key: [2.5, 5, 3.5], intensity: 2 });
    const g = new T.Group(); scene.add(g);
    // A porcelain plate, a chocolate sponge, a glossy ganache that drips over the edge, a ring of cream at the foot,
    // rosettes of cream on top and a few small cherries.
    g.add(mesh(new T.CylinderGeometry(1.45, 1.35, 0.06, 72), phys(0xf6f3ee, { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }), { y: 0.03 }));
    g.add(mesh(new T.CylinderGeometry(1, 1, 0.8, 72), std(0x5a2e1c, 0.8), { y: 0.46 }));
    const ganache = phys(0x3a1a0d, { roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.2, envMapIntensity: 0.45 });
    g.add(mesh(new T.CylinderGeometry(1.025, 1.025, 0.1, 72), ganache, { y: 0.88 }));
    g.add(mesh(new T.TorusGeometry(1.0, 0.05, 12, 72), ganache, { y: 0.88, rx: Math.PI / 2 }));
    for (let i = 0; i < 26; i += 1) {
      const a = (i / 26) * Math.PI * 2 + Math.sin(i * 7.1) * 0.05;
      const len = 0.12 + ((i * 37) % 11) / 11 * 0.26;
      g.add(mesh(new T.CapsuleGeometry(0.045, len, 6, 10), ganache, { x: Math.cos(a) * 1.02, y: 0.86 - len / 2, z: Math.sin(a) * 1.02, cast: false }));
    }
    const cream = phys(0xfbf7f0, { roughness: 0.45, sheen: 0.6, sheenColor: new T.Color(0xffffff) });
    g.add(mesh(new T.TorusGeometry(1.0, 0.075, 14, 90), cream, { y: 0.1, rx: Math.PI / 2 }));
    const cherry = phys(0xb3101f, { roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });
    const stem = std(0x4a6a2a, 0.6);
    const cherries = [];
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2; const x = Math.cos(a) * 0.76; const z = Math.sin(a) * 0.76;
      // A rosette: three rings of cream, each smaller, twisted, and a tip.
      for (let k = 0; k < 3; k += 1) g.add(mesh(new T.TorusGeometry(0.1 - k * 0.028, 0.045 - k * 0.008, 10, 24), cream, { x, y: 0.97 + k * 0.055, z, rx: Math.PI / 2, rz: k * 0.6 }));
      g.add(mesh(new T.ConeGeometry(0.035, 0.08, 12), cream, { x, y: 1.14, z }));
      if (i % 2 === 0) {
        const c = mesh(new T.SphereGeometry(0.06, 20, 14), cherry, { x, y: 1.21, z });
        const sm = mesh(new T.CylinderGeometry(0.006, 0.006, 0.12, 6), stem, { x: x + 0.02, y: 1.3, z, rz: -0.35, cast: false });
        g.add(c, sm); cherries.push([c, sm]);
      }
    }
    // The candle: a striped wax stick (a painted texture), a black wick, and the flame.
    const stripes = document.createElement('canvas'); stripes.width = 64; stripes.height = 256;
    const sx = stripes.getContext('2d'); sx.fillStyle = '#f6f1e8'; sx.fillRect(0, 0, 64, 256);
    sx.fillStyle = '#c8102e'; for (let k = -64; k < 256; k += 40) { sx.beginPath(); sx.moveTo(0, k); sx.lineTo(64, k + 30); sx.lineTo(64, k + 44); sx.lineTo(0, k + 14); sx.fill(); }
    const st = new T.CanvasTexture(stripes); st.colorSpace = T.SRGBColorSpace;
    g.add(mesh(new T.CylinderGeometry(0.04, 0.04, 0.5, 24), std(0xffffff, 0.5, 0, { map: st }), { y: 1.18 }));
    g.add(mesh(new T.CylinderGeometry(0.007, 0.007, 0.05, 6), std(0x111111), { y: 1.455, cast: false }));
    const flame = new T.Group(); flame.position.set(0, 1.53, 0); g.add(flame);
    const outer = mesh(new T.SphereGeometry(0.06, 20, 16), new T.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85 }), { s: [1, 2.1, 1], cast: false, receive: false });
    const inner = mesh(new T.SphereGeometry(0.035, 16, 12), new T.MeshBasicMaterial({ color: 0xfff3c0 }), { y: -0.02, s: [1, 1.8, 1], cast: false, receive: false });
    const glow = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0xffb04a, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.32);
    const light = new T.PointLight(0xffa040, 1.6, 3, 2); light.castShadow = false;
    flame.add(outer, inner, glow, light);
    let lit = true; let hold = false;
    const proj = new T.Vector3(); const projUp = new T.Vector3();
    const cam = camera(20, [0, 3.0, 7.4], [0, 0.6, 0]);
    // Specter, when he comes for cake: an apron on, sitting on the top of the cake.
    const actor = specterActor(g);
    const projectLocal = (x, y, z) => {
      const c = canvas?.getBoundingClientRect?.(); if (!c?.width) return null;
      g.updateMatrixWorld(); proj.set(x, y, z); g.localToWorld(proj); cam.updateMatrixWorld(); proj.project(cam);
      return { x: c.left + ((proj.x + 1) / 2) * c.width, y: c.top + ((1 - proj.y) / 2) * c.height };
    };
    const stage3 = storyStage({ actor, cam, project: projectLocal,
      look: { entry: [1.0, 1.7, 0.9], exit: [-0.95, 1.55, 0.7], center: [0, 0, 0], radius: 1.2, height: 1.45, size: 0.62 },
      warm: (p) => (lit ? Math.max(0, 1 - Math.hypot(p.x, p.y - 1.5, p.z) / 1.4) * 0.6 : 0) });
    const TOP = 1.2; // where he stands on the cake
    // The marks he leaves in the ganache where he lands (a soft dent), gone when he leaves.
    const dents = Array.from({ length: 6 }, () => { const d = mesh(new T.CircleGeometry(0.11, 18), phys(0x2a1208, { roughness: 0.5 }), { y: 0.932, rx: -Math.PI / 2, cast: false }); d.visible = false; g.add(d); return d; });
    let dentI = 0;
    const dent = (x, z) => { const d = dents[dentI++ % dents.length]; d.position.x = x; d.position.z = z; d.visible = true; d.scale.set(1.2, 1, 0.9); };
    const CANDLE = [0, 1.45, 0];
    const visibleCherries = () => cherries.filter(([c]) => c.visible);
    const STORIES = {
      // A cherry: he spots one, tiptoes to it, eats it, cream all over his face, and dances a little.
      cherry: () => {
        // The cherry nearest to you: he stands behind it, so reaching for it he faces you.
        const pair = visibleCherries().sort((p1, p2) => p2[0].position.z - p1[0].position.z)[0];
        const cp = pair ? pair[0].position : new T.Vector3(0.3, 1.2, 0.7);
        const by = [cp.x * 0.45, TOP, cp.z * 0.45 - 0.12];
        const C = [cp.x, 1.2, cp.z];
        let gone = false;
        return [
          { ms: 1500, to: [-0.2, TOP, -0.3], hop: 0.3, mood: 'glad' },
          { ms: 1600, face: C, hands: 'cheeks', mood: 'surprised', stretch: 0.22, sink: 0.08, do: (c) => { dent(-0.2, -0.3); c.mark('!'); sfx.voice('surprised'); c.say('¡Una cereza!', 1500); } },
          { ms: 1400, to: by, hop: 0.05, face: C, hands: 'hold', mood: 'wink', bounce: { n: 3, h: 0.03 } },
          { ms: 2000, face: C, hands: 'eat', mood: 'love', stretch: -0.15, sink: 0.1, do: () => dent(by[0], by[2]),
            each: (k) => { if (k > 0.35 && !gone) { gone = true; if (pair) for (const m of pair) m.visible = false; actor.state.cream = 'messy'; sfx.voice('glad'); sfx.crackle(); } } },
          { ms: 2200, face: 'you', hands: 'cheeks', mood: 'love', talk: true, sink: 0.1, do: (c) => c.say('Mmm… ¡qué rica!', 1900) },
          { ms: 2000, face: 'you', hands: 'up', mood: 'glad', talk: false, bounce: { n: 3, h: 0.1 }, do: (c) => c.say('¡Quedé todo manchado!', 1800) },
        ];
      },
      // A wish: eyes closed, hands together; a big breath; he blows the candle out.
      wish: () => [
        { ms: 1600, to: [0.12, TOP, -0.4], hop: 0.3, mood: 'glad', face: CANDLE },
        { ms: 2600, face: CANDLE, hands: 'blow', mood: 'shut', do: (c) => c.say('Pido un deseo…', 2300) },
        { ms: 1200, face: CANDLE, hands: 'up', mood: 'surprised', stretch: 0.25 },
        { ms: 1300, face: CANDLE, hands: 'blow', stretch: -0.22, do: (c) => { c.say('¡Fuuu!', 1000); if (lit) { lit = false; flame.visible = false; sfx.blow(); setTimeout(() => { lit = true; flame.visible = true; }, 30000); } } },
        { ms: 2200, face: 'you', hands: 'mouth', mood: 'wink', do: (c) => c.say('¡No te lo digo!', 1900) },
      ],
      // A taste: he looks both ways, swipes cream, and is caught with it on his face.
      taste: () => [
        { ms: 1500, to: [-0.3, TOP, -0.25], hop: 0.3, mood: 'wink' },
        { ms: 1300, face: [-1.5, 1.2, 0.4], hands: 'rest', mood: '' },
        { ms: 1300, face: [1.5, 1.2, 0.4], hands: 'rest', mood: '', do: (c) => c.say('Nadie está mirando…', 1700) },
        { ms: 1500, face: [-0.45, 1.0, 0.55], hands: 'hold', mood: 'wink', stretch: -0.1 },
        { ms: 1400, face: 'you', hands: 'eat', mood: 'love', sink: 0.08, do: () => { dent(-0.3, -0.25); actor.state.cream = true; sfx.voice('glad'); } },
        { ms: 1800, face: 'you', hands: 'cheeks', mood: 'surprised', stretch: 0.2, do: (c) => { c.mark('!'); c.say('¡Me viste!', 1600); } },
        { ms: 1600, face: 'you', hands: 'shrug', mood: 'wink', do: (c) => c.say('Solo una probadita.', 1500) },
      ],
      // A dance on the cake: hops in a little circle, hands up.
      dance: () => [
        { ms: 1400, to: [0.4, TOP, 0.4], hop: 0.3, mood: 'glad', do: (c) => c.say('¡Torta, torta!', 1700) },
        { ms: 900, to: [-0.4, TOP, 0.35], hop: 0.25, hands: 'up', mood: 'glad' },
        { ms: 900, to: [-0.35, TOP, -0.4], hop: 0.25, hands: 'up' },
        { ms: 900, to: [0.4, TOP, -0.35], hop: 0.25, hands: 'up' },
        { ms: 900, to: [0.42, TOP, 0.42], hop: 0.25, hands: 'up' },
        { ms: 1800, face: 'you', hands: 'hips', mood: 'love', stretch: 0.15, sink: 0.08, do: () => { dent(0.42, 0.42); dent(-0.4, 0.35); dent(-0.35, -0.4); sfx.voice('love'); } },
      ],
    };
    return {
      scene, camera: cam,
      project(x, y, z) {
        const c = canvas?.getBoundingClientRect?.();
        if (!c?.width) return null;
        g.updateMatrixWorld();
        proj.set(x, y, z); g.localToWorld(proj); projUp.set(x, y + 1, z); g.localToWorld(projUp);
        this.camera.updateMatrixWorld(); proj.project(this.camera); projUp.project(this.camera);
        return { x: c.left + ((proj.x + 1) / 2) * c.width, y: c.top + ((1 - proj.y) / 2) * c.height, unit: Math.abs(projUp.y - proj.y) / 2 * c.height };
      },
      update(t) {
        g.rotation.y += ((hold || stage3.busy() ? 0 : Math.sin(t * 0.25) * 0.5) - g.rotation.y) * 0.08;
        stage3.update(t);
        const f = 1 + Math.sin(t * 23) * 0.06 + Math.sin(t * 37) * 0.04;
        flame.scale.set(1, f, 1); light.intensity = lit ? 1.4 * f : 0;
      },
      poke() { lit = !lit; flame.visible = lit; return lit; },
      // Specter eats a cherry: it is gone from the top, and grows back a few minutes later.
      act(name, arg) {
        // Specter comes for cake: one of his stories (`arg`: { story, on }).
        if (name === 'story') { if (stage3.busy() || !STORIES[arg?.story]) return 0; return stage3.start({ steps: STORIES[arg.story](), done: () => {
          for (const pr of cherries) for (const m of pr) m.visible = true;
          for (const d of dents) d.visible = false;
          lit = true; flame.visible = true;
        } }, 2, arg.on, arg.skin); }
        if (name === 'stop') { stage3.stop(); return 1; }
        if (name === 'hold') { hold = true; return 1; }
        if (name === 'free') { hold = false; return 1; }
        // He blows the candle out (a wish); it lights again half a minute later.
        if (name === 'blow') { if (!lit) return false; lit = false; flame.visible = false; setTimeout(() => { lit = true; flame.visible = true; }, 30000); return true; }
        if (name !== 'eat') return false;
        const left = cherries.filter(([c]) => c.visible);
        if (!left.length) return false;
        const pair = left[Math.floor(Math.random() * left.length)];
        for (const m of pair) m.visible = false;
        setTimeout(() => { for (const m of pair) m.visible = true; }, 4 * 60000);
        return true;
      },
    };
  },

  // A ceramic mug of coffee on its saucer, with steam that rises and fades.
  cup(_canvas, opts = {}) {
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
    // Its light warms the logs and stones; it casts no shadow (a point light's shadow greys the whole floor square).
    const light = new T.PointLight(0xff8a2a, 6, 6, 1.6); light.position.y = 0.6; scene.add(light);
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

  // The campfire at night, a decoration for Inicio: a small floating island seen from a long lens (no fish-eye), in
  // low-poly with flat facets, under a blue moonlight. A forest of pines that keeps growing over the days surrounds a
  // clearing with the fire. Now and then (rarely) a pair of eyes opens between the trees at the back, or something
  // peeks out from behind a trunk. Poked, the fire flares up with a whoosh: the eyes squeeze shut and sink into the
  // dark, the thing ducks back behind its tree. Original shapes.
  campfire(canvas) {
    const scene = new T.Scene();
    const flat = (color, rough = 0.9) => std(color, rough, 0, { flatShading: true });
    // Night light: a dim blue sky, a cold moon from the side, and the warm fire (no daylight reflections).
    scene.add(new T.HemisphereLight(0x6a80d0, 0x3a3460, 1.2));
    const moon = new T.DirectionalLight(0xa8baff, 1.5); moon.position.set(-5, 6, 5); moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024); Object.assign(moon.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); scene.add(moon);
    // The fire's light casts no shadow: a point light's shadow draws the scene six more times every frame.
    const fireLight = new T.PointLight(0xff8a2a, 14, 7, 1.5); fireLight.position.set(0, 0.7, 0); scene.add(fireLight);
    const world = new T.Group(); scene.add(world);
    // The island: a grassy top and a rocky underside, faceted.
    const top = mesh(new T.CylinderGeometry(3.3, 3.1, 0.35, 14, 1), flat(0x2f5a3a), { y: -0.18 });
    world.add(top);
    const under = mesh(new T.ConeGeometry(3.1, 2.6, 14, 2), flat(0x6b5446), { y: -1.65, rx: Math.PI, cast: false });
    const pos = under.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) if (pos.getY(i) < 1.2 && pos.getY(i) > -1.2) { pos.setX(i, pos.getX(i) * (0.85 + Math.random() * 0.3)); pos.setZ(i, pos.getZ(i) * (0.85 + Math.random() * 0.3)); }
    under.geometry.computeVertexNormals(); world.add(under);
    const clearing = mesh(new T.CircleGeometry(1.25, 18), flat(0x4a3a2a, 1), { y: 0.002, rx: -Math.PI / 2, cast: false });
    world.add(clearing);
    // The fire: logs, a ring of stones, flames and sparks.
    const bark = flat(0x4a2f1e);
    for (let i = 0; i < 4; i += 1) world.add(mesh(new T.CylinderGeometry(0.07, 0.09, 1.0, 7), bark, { y: 0.1, rz: Math.PI / 2 - 0.25, ry: (i / 4) * Math.PI }));
    const stone = flat(0x8a8580);
    for (let i = 0; i < 10; i += 1) { const a = (i / 10) * Math.PI * 2; world.add(mesh(new T.DodecahedronGeometry(0.12 + Math.random() * 0.04), stone, { x: Math.cos(a) * 0.62, y: 0.07, z: Math.sin(a) * 0.62, rx: Math.random(), ry: Math.random() })); }
    const flames = Array.from({ length: 7 }, (_, i) => {
      const m = mesh(new T.ConeGeometry(0.13 - i * 0.008, 0.62 - i * 0.035, 7, 1, true), new T.MeshBasicMaterial({ color: i < 3 ? 0xff7a1a : 0xffc04a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }), { cast: false, receive: false });
      m.userData = { a: (i / 7) * Math.PI * 2, r: i ? 0.09 : 0, p: Math.random() * 10 }; world.add(m); return m;
    });
    const sparks = Array.from({ length: 18 }, () => { const s = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0xffa23a, transparent: true, blending: T.AdditiveBlending, depthWrite: false })); s.userData.p = Math.random(); world.add(s); return s; });
    const glow = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0xff8a2a, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(2.4); glow.position.y = 0.4; world.add(glow);
    // The forest: pines and a few round bushes; a dense ring is there from the start, and more grow over the days.
    let born = Date.now();
    try { born = Number(localStorage.getItem('studium-campfire')) || born; localStorage.setItem('studium-campfire', String(born)); } catch { /* grows from now */ }
    const greens = [flat(0x2a6a52), flat(0x2f7a5c), flat(0x235c47), flat(0x377f63)];
    const trunk = flat(0x3b271a);
    const trees = [];
    const plant = (x, z, h, kind, sprout) => {
      const tr = new T.Group(); tr.position.set(x, 0, z); tr.rotation.y = Math.random() * 6;
      const g = greens[trees.length % greens.length];
      if (kind === 'bush') tr.add(mesh(new T.IcosahedronGeometry(0.26, 0), g, { y: 0.18, s: [1.2, 0.8, 1.2] }));
      else {
        tr.add(mesh(new T.CylinderGeometry(0.05, 0.08, h * 0.3, 6), trunk, { y: h * 0.15 }));
        for (let k = 0; k < 3; k += 1) tr.add(mesh(new T.ConeGeometry((0.42 - k * 0.1) * (h / 1.6), h * 0.38, 7), g, { y: h * 0.3 + k * h * 0.2 }));
      }
      tr.userData = { sprout, grow: 120000, sway: Math.random() * 6, h };
      tr.scale.setScalar(0.001); world.add(tr); trees.push(tr);
      return tr;
    };
    // Rings: behind and on the sides (the front stays open, toward the person); random but always the same here.
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 34; i += 1) {
      const a = Math.PI * (1.05 + rnd() * 0.9) + (i % 2 ? 0 : (rnd() - 0.5) * 0.6) - Math.PI * 0.03;
      const ring = 1.6 + rnd() * 1.45;
      const x = Math.cos(a) * ring; const z = Math.sin(a) * ring * 0.95;
      if (Math.hypot(x, z) > 3.05) continue;
      const h = 1.1 + rnd() * 1.1;
      // Most are grown at once; the rest sprout over minutes, hours and days.
      const sprout = i < 22 ? 0 : [2, 10, 30, 90, 240, 600, 1440, 2880, 4320, 7200, 10080, 14400][i - 22] * 60000;
      plant(x, z, h, rnd() < 0.18 ? 'bush' : 'pine', sprout);
    }
    for (const [x, z] of [[2.4, 0.9], [-2.5, 0.8], [2.7, -0.2], [-2.8, -0.1]]) plant(x, z, 0.9, 'bush', 0);
    // Eyes between the trees at the back: they open, blink, and close; a flare makes them squeeze shut and sink.
    const eyeMat = () => new T.SpriteMaterial({ map: soft(), color: 0xfff2a8, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
    const eyes = new T.Group(); const el = new T.Sprite(eyeMat()); const er = new T.Sprite(eyeMat());
    el.position.x = -0.1; er.position.x = 0.1; eyes.add(el, er); world.add(eyes);
    const watch = { at: 25 + Math.random() * 25, start: null, life: 4, flee: null };
    // Something behind a tree: a shadow with two small lights.
    const peeker = new T.Group();
    peeker.add(mesh(new T.SphereGeometry(0.26, 14, 12), new T.MeshBasicMaterial({ color: 0x07080d }), { s: [1, 1.2, 0.8], cast: false }));
    const pe = [-0.08, 0.08].map((x) => { const sp = new T.Sprite(eyeMat()); sp.position.set(x, 0.08, 0.22); sp.scale.setScalar(0.13); sp.material.color.set(0xd6f3ff); peeker.add(sp); return sp; });
    peeker.visible = false; world.add(peeker);
    const peek = { next: 60 + Math.random() * 60, start: 0, tree: null, side: 1, out: 0, rustled: false };
    // Left alone, the fire slowly burns down to embers (over about twenty minutes, counted across visits); poked, it
    // flares up again.
    const POKED = 'studium-campfire-poked';
    let poked = Date.now();
    try { poked = Number(localStorage.getItem(POKED)) || poked; } catch { /* burns from now */ }
    const strength = () => Math.max(0.3, 1 - (Date.now() - poked) / (20 * 60000) * 0.7);
    // Specter's things in the scene: a twig he breaks off a pine, with a marshmallow on its tip, held in his right
    // hand. It toasts over the fire, catches fire when he dozes off, is blown out, charred, and eaten.
    const twig = new T.Group(); twig.visible = false; world.add(twig);
    const TW = 0.78;
    twig.add(mesh(new T.CylinderGeometry(0.011, 0.016, TW, 5), flat(0x7a5232), { x: TW / 2, rz: Math.PI / 2, cast: false }));
    twig.add(mesh(new T.ConeGeometry(0.035, 0.09, 5), greens[0], { x: TW * 0.55, y: 0.035, rz: -0.7, cast: false }));
    const mallowMat = phys(0xfffaf2, { roughness: 0.75, sheen: 0.5 });
    const mallow = mesh(new T.CapsuleGeometry(0.05, 0.06, 5, 10), mallowMat, { x: TW + 0.03, rz: Math.PI / 2, cast: false });
    mallow.visible = false; twig.add(mallow);
    const mFlame = new T.Group(); mFlame.visible = false; mFlame.position.x = TW + 0.03; twig.add(mFlame);
    for (let i = 0; i < 3; i += 1) mFlame.add(mesh(new T.ConeGeometry(0.035 - i * 0.008, 0.17 - i * 0.035, 7, 1, true), new T.MeshBasicMaterial({ color: i ? 0xffc04a : 0xff6a1a, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }), { y: 0.09, cast: false, receive: false }));
    const puffs = Array.from({ length: 6 }, () => { const sp = new T.Sprite(new T.SpriteMaterial({ map: soft(), color: 0x9a9aa6, transparent: true, opacity: 0, depthWrite: false })); world.add(sp); return sp; });
    let puffAt = -1; const puffFrom = new T.Vector3();
    const RAW = new T.Color(0xfffaf2); const GOLD = new T.Color(0xe7a64a); const BROWN = new T.Color(0x9a5a2a); const CHAR = new T.Color(0x1c1612);
    const roast = { toast: 0, burning: false, charred: false, aim: new T.Vector3(0, 1, 0), aimTo: new T.Vector3(0, 1, 0), shake: false };
    let hold = false;
    const proj = new T.Vector3(); const projUp = new T.Vector3();
    let flare = 0; let lastT = 0;
    // Specter, when he comes camping: a backpack on.
    const actor = specterActor(world);
    const cam = camera(21, [0, 5.4, 14.4], [0, -0.05, -0.3]);
    const projectLocal = (x, y, z) => {
      const c = canvas?.getBoundingClientRect?.(); if (!c?.width) return null;
      world.updateMatrixWorld(); proj.set(x, y, z); world.localToWorld(proj); cam.updateMatrixWorld(); proj.project(cam);
      return { x: c.left + ((proj.x + 1) / 2) * c.width, y: c.top + ((1 - proj.y) / 2) * c.height };
    };
    const stage3 = storyStage({ actor, cam, project: projectLocal,
      look: { entry: [2.2, 1.6, 1.4], exit: [-2.1, 1.6, 1.2], center: [0, 0, 0], radius: 2.4, height: 1.2, size: 1.0 },
      warm: (p) => Math.max(0, 1 - Math.hypot(p.x, p.z) / 3) * strength() });
    // Where things are: the fire, his seat at its right, the pine he takes a twig from.
    // He sits behind the fire, a little to its right: looking at the fire, he looks your way (a stage's rule).
    const FIRE = [0, 0.5, 0]; const SEAT = [0.95, 0.42, -0.6];
    const aim = (x, y, z) => { roast.aimTo.set(x, y, z); };
    const nearPine = () => {
      const want = new T.Vector3(2.1, 0, -0.7);
      return trees.filter((tr) => tr.scale.x > 0.8 && tr.userData.h > 1.2).sort((p1, p2) => p1.position.distanceTo(want) - p2.position.distanceTo(want))[0];
    };
    const smoke = () => { puffAt = lastT; puffFrom.copy(twig.position).addScaledVector(roast.aim.clone().sub(twig.position).normalize(), TW); };
    const STORIES = {
      // The marshmallow: a twig from a pine, the marshmallow from his backpack, toasting, a doze, a fire, a fright.
      mallow: () => {
        const pine = nearPine();
        const pp = pine ? pine.position : new T.Vector3(2.2, 0, -0.9);
        // Beside the pine, toward the front: you see him in profile as he reaches for it.
        const toFire = new T.Vector3(-pp.x, 0, -pp.z).normalize();
        const stand = [pp.x + toFire.x * 0.35 + 0.0, 0.42, pp.z + 0.62];
        const P = [pp.x, 0.6, pp.z];
        let z1 = false; let z2 = false; let ate = false;
        return [
          { ms: 1900, to: stand, mood: 'glad', do: (c) => c.say('Necesito una rama…', 1900) },
          { ms: 1500, face: P, hands: 'hold', mood: 'wink', stretch: 0.12 },
          { ms: 1100, face: P, hands: 'hold', stretch: -0.18, do: (c) => { if (pine) pine.userData.shake = lastT; sfx.crackle(); sfx.rustle(); c.mark('!'); twig.visible = true; mallow.visible = false; Object.assign(roast, { toast: 0, burning: false, charred: false }); aim(stand[0], 1.6, stand[2]); } },
          { ms: 1800, face: 'you', hands: 'hold', mood: 'glad', bounce: { n: 2, h: 0.1 }, do: (c) => c.say('¡Perfecta!', 1700) },
          { ms: 1900, to: SEAT, hop: 0.4, hands: 'hold', do: () => aim(SEAT[0] - 0.2, 1.4, SEAT[2]) },
          { ms: 2800, face: 'back', hands: 'rummage', mood: '', do: (c) => c.say('¿Dónde los guardé…?', 2600) },
          { ms: 1600, face: 'you', hands: 'hold', mood: 'surprised', stretch: 0.28, do: (c) => { mallow.visible = true; c.mark('!'); sfx.voice('surprised'); c.say('¡Aquí está!', 1500); } },
          { ms: 4600, face: FIRE, hands: 'hold', mood: 'glad', talk: true, sway: true, do: (c) => { aim(0.05, 0.62, 0.05); c.notes(4); sfx.voice('hum'); } },
          { ms: 2600, face: FIRE, hands: 'mouth', mood: 'yawn', talk: false, stretch: 0.16, do: (c) => { sfx.voice('yawn'); c.say('Qué sueño…', 2200); } },
          { ms: 4200, face: FIRE, hands: 'hold', mood: 'shut', nod: true, do: () => aim(0.02, 0.16, 0.02),
            each: (k, c) => { if (k > 0.2 && !z1) { z1 = true; c.mark('z'); } if (k > 0.65 && !z2) { z2 = true; c.mark('z'); } } },
          { ms: 3000, face: FIRE, hands: 'hold', mood: 'shut', nod: true, do: (c) => { roast.burning = true; sfx.whoosh(); c.mark('z'); } },
          { ms: 1500, face: FIRE, hands: 'rub', mood: 'wink', do: (c) => c.mark('?') },
          { ms: 1700, face: 'you', hands: 'up', mood: 'surprised', jump: 0.75, stretch: 0.5, do: (c) => { c.mark('!'); sfx.voice('scared'); c.say('¡¡AY!! ¡SE QUEMA!', 1700); aim(SEAT[0] + 0.3, 1.9, SEAT[2] + 0.3); } },
          { ms: 2000, face: 'you', hands: 'shake', mood: 'scared', do: (c) => { roast.shake = true; c.say('¡¡Fuego, fuego!!', 1700); } },
          { ms: 1300, face: 'you', hands: 'blow', mood: 'surprised', stretch: -0.14, do: (c) => { roast.shake = false; aim(SEAT[0] - 0.4, 1.0, SEAT[2] + 0.5); c.say('Fuuu…', 1100); sfx.blow(); } },
          { ms: 1400, face: 'you', hands: 'blow', stretch: -0.2, do: (c) => { c.say('¡FUUUU!', 1100); sfx.blow(); roast.burning = false; roast.charred = true; smoke(); } },
          { ms: 2800, face: 'you', hands: 'cheeks', mood: 'sad', do: (c) => { sfx.voice('sad'); c.say('…', 1500); } },
          { ms: 2200, face: 'you', hands: 'shrug', mood: 'sad', do: (c) => c.say('Quedó carbonizado.', 2000) },
          { ms: 2400, face: 'you', hands: 'eat', mood: 'wink', do: (c) => { aim(SEAT[0], 1.0, SEAT[2] + 0.9); c.say('Igual me lo como.', 1900); },
            each: (k) => { if (k > 0.65 && !ate) { ate = true; mallow.visible = false; sfx.crackle(); } } },
          { ms: 1800, face: 'you', hands: 'cheeks', mood: 'love', stretch: 0.1, do: (c) => { sfx.voice('love'); c.say('Crujiente.', 1500); twig.visible = false; } },
        ];
      },
      // Warming up: his hands to the fire, eyes closed, a sway; a yawn and a stretch.
      warm: () => [
        { ms: 2000, to: SEAT, hop: 0.35, mood: 'glad' },
        { ms: 4200, face: FIRE, hands: 'blow', mood: 'shut', sway: true, do: (c) => { flare = Math.max(flare, 0.45); c.say('Qué calentito…', 2200); } },
        { ms: 2400, face: FIRE, hands: 'up', mood: 'yawn', stretch: 0.3, do: () => sfx.voice('yawn') },
        { ms: 1800, face: 'you', hands: 'cheeks', mood: 'glad', do: (c) => { sfx.voice('glad'); c.say('Así da gusto.', 1600); } },
      ],
      // A scary story: told to you, hands up; the eyes open behind him; he notices last.
      story: () => [
        { ms: 2000, to: SEAT, hop: 0.35, mood: 'wink' },
        { ms: 2600, face: 'you', hands: 'shrug', mood: 'wink', do: (c) => c.say('Te cuento una historia de miedo…', 2400) },
        { ms: 3000, face: 'you', hands: 'up', mood: 'scared', talk: true, sway: true, do: (c) => { c.say('Había una vez… en este mismo bosque…', 2800); if (watch.start === null) watch.at = lastT + 0.6; } },
        { ms: 2200, face: 'you', hands: 'rest', mood: '', talk: false, do: (c) => c.mark('?') },
        { ms: 1600, face: 'back', hands: 'cheeks', mood: 'surprised', do: (c) => c.mark('!') },
        { ms: 1600, face: 'you', hands: 'up', mood: 'scared', jump: 0.6, stretch: 0.45, do: (c) => { sfx.voice('scared'); c.say('¡¿…Escuchaste eso?!', 1600); } },
        { ms: 2200, face: 'you', hands: 'hips', mood: 'glad', do: (c) => c.say('Jaja, era broma. Creo.', 2000) },
      ],
      // A song by the fire: he sways, waves, notes rise.
      song: () => [
        { ms: 2000, to: SEAT, hop: 0.35, mood: 'glad' },
        { ms: 2400, face: 'you', hands: 'wave', mood: 'glad', talk: true, sway: true, do: (c) => { c.notes(3); sfx.voice('hum'); } },
        { ms: 2400, face: FIRE, hands: 'cheeks', mood: 'love', talk: true, sway: true, do: (c) => { c.notes(3); sfx.voice('hum'); } },
        { ms: 2400, face: 'you', hands: 'up', mood: 'glad', talk: true, bounce: { n: 3, h: 0.08 }, do: (c) => { c.notes(3); sfx.voice('hum'); } },
        { ms: 1500, face: 'you', hands: 'hips', mood: 'wink', talk: false },
      ],
    };
    return {
      scene, camera: cam,
      update(t) {
        const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
        flare = Math.max(0, flare - dt * 0.5);
        // While Specter is in the scene, it holds still.
        world.rotation.y += ((hold || stage3.busy() ? 0 : Math.sin(t * 0.12) * 0.12) - world.rotation.y) * Math.min(1, dt * 3);
        stage3.update(t);
        // The twig in his hand, pointing where he aims it (shaken when it burns).
        const hand = stage3.hand();
        if (!stage3.busy()) twig.visible = false;
        if (twig.visible && hand) {
          roast.aim.lerp(roast.aimTo, Math.min(1, dt * 3));
          const dir = roast.aim.clone().sub(hand);
          if (roast.shake) dir.add(new T.Vector3(Math.sin(t * 22) * 0.6, Math.cos(t * 19) * 0.3, 0));
          twig.position.copy(hand);
          twig.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), dir.normalize());
          const tip = hand.clone().addScaledVector(dir, TW);
          if (mallow.visible && !roast.charred && !roast.burning && tip.distanceTo(new T.Vector3(0, 0.55, 0)) < 0.45) roast.toast = Math.min(1, roast.toast + dt / 5);
          mallowMat.color.copy(RAW).lerp(GOLD, Math.min(1, roast.toast * 1.6)).lerp(BROWN, Math.max(0, roast.toast * 1.6 - 1) * 0.8);
          if (roast.charred || roast.burning) mallowMat.color.copy(CHAR);
          mFlame.visible = roast.burning && mallow.visible;
          for (const [i, f] of mFlame.children.entries()) f.scale.set(1, 1 + Math.sin(t * 15 + i) * 0.25, 1);
          mFlame.quaternion.copy(twig.quaternion).invert(); // the little flame stays upright
        }
        // Smoke after he blows it out.
        for (const [i, sp] of puffs.entries()) {
          const k = puffAt < 0 ? 1 : (t - puffAt - i * 0.12) / 2;
          if (k < 0 || k >= 1) { sp.material.opacity = 0; continue; }
          sp.position.copy(puffFrom).add(new T.Vector3(Math.sin(i * 2.1 + k * 3) * 0.12, k * 0.9, 0));
          sp.scale.setScalar(0.12 + k * 0.35); sp.material.opacity = 0.6 * (1 - k);
        }
        world.position.y = Math.sin(t * 0.6) * 0.05;
        for (const f of flames) {
          const w = Math.sin(t * 9 + f.userData.p) * 0.05;
          f.position.set(Math.cos(f.userData.a) * f.userData.r, 0.38 + w + flare * 0.15, Math.sin(f.userData.a) * f.userData.r);
          const k = (0.35 + 0.65 * strength()) * (1 + flare * 1.2);
          f.scale.set(k * 0.9 + flare * 0.3, k * (1 + Math.sin(t * 13 + f.userData.p) * 0.18), k * 0.9 + flare * 0.3);
        }
        for (const s of sparks) {
          const k = (t * (0.5 + flare) + s.userData.p) % 1;
          s.position.set(Math.sin(k * 9 + s.userData.p * 20) * 0.22, 0.35 + k * (1.6 + flare * 1.5), Math.cos(k * 7 + s.userData.p * 20) * 0.15);
          s.scale.setScalar(0.05 * (1 - k)); s.material.opacity = 1 - k;
        }
        const st = strength();
        fireLight.intensity = (2.5 + 5.5 * st) + Math.sin(t * 17) * 1.2 * st + Math.sin(t * 29) * 0.8 * st + flare * 18;
        glow.material.opacity = 0.12 + 0.23 * st + flare * 0.5;
        glow.scale.setScalar(2.4 + flare * 1.6);
        const age = Date.now() - born;
        for (const tr of trees) {
          const g = Math.min(1, Math.max(0, (age - tr.userData.sprout) / tr.userData.grow));
          const s = g <= 0 ? 0.001 : 0.12 + 0.88 * (1 - (1 - g) ** 2);
          tr.scale.setScalar(s);
          const sh = tr.userData.shake ? Math.max(0, 1 - (t - tr.userData.shake) / 0.9) : 0;
          tr.rotation.z = Math.sin(t * 0.8 + tr.userData.sway) * 0.015 * s + Math.sin(t * 40) * 0.09 * sh;
        }
        // The eyes: rare; they open slowly, blink, close; fleeing, they squeeze shut and sink back into the dark.
        if (watch.start === null && t > watch.at && flare < 0.05) {
          const a = Math.PI * (1.25 + Math.random() * 0.5);
          eyes.position.set(Math.cos(a) * 2.5, 0.55 + Math.random() * 0.5, Math.sin(a) * 2.3);
          watch.start = t; watch.life = 3.5 + Math.random() * 2.5; watch.flee = null;
          sfx.eerie();
        }
        if (watch.start !== null) {
          const k = (t - watch.start) / watch.life;
          if (flare > 0.3 && watch.flee === null) watch.flee = t;
          let open = Math.min(1, k * 5, (1 - k) * 5);
          let sink = 0;
          if (watch.flee !== null) { const f = (t - watch.flee) / 0.6; open = Math.max(0, 1 - f * 1.6) * Math.min(1, open + 0.4); sink = f * 0.35; }
          const blink = Math.abs(Math.sin((t - watch.start) * 2.1)) > 0.97 ? 0.1 : 1;
          for (const e of [el, er]) { e.material.opacity = Math.max(0, open); e.scale.set(0.15, 0.1 * blink * Math.max(0.15, open) + 0.004, 1); }
          eyes.position.y -= sink * dt * 2;
          if (k >= 1 || (watch.flee !== null && t - watch.flee > 0.7)) { watch.start = null; watch.at = t + 45 + Math.random() * 60; for (const e of [el, er]) e.material.opacity = 0; }
        }
        // The peeker: rarer still; it leans out from a grown tree, looks, and goes back; a flare makes it duck fast.
        const grown = trees.filter((tr) => tr.scale.x > 0.8 && tr.userData.h > 1.3 && tr.position.z < -0.8);
        if (!peeker.visible && t > peek.next && grown.length && flare < 0.05) {
          Object.assign(peek, { start: t, tree: grown[Math.floor(Math.random() * grown.length)], side: Math.random() < 0.5 ? -1 : 1, out: 0, rustled: false, ducking: false });
          peeker.visible = true;
        }
        if (peeker.visible) {
          const k = (t - peek.start) / 5;
          if (flare > 0.3) peek.ducking = true;
          const want = peek.ducking || k > 0.8 ? 0 : k < 0.15 ? 0 : 1;
          peek.out += (want - peek.out) * Math.min(1, dt * (peek.ducking ? 14 : 3));
          if (peek.out > 0.3 && !peek.rustled) { peek.rustled = true; sfx.rustle(); }
          const tp = peek.tree.position;
          peeker.position.set(tp.x + peek.side * (0.02 + peek.out * 0.34), 0.5 + peek.out * 0.06, tp.z - 0.2);
          peeker.rotation.z = -peek.side * peek.out * 0.3;
          for (const e of pe) e.material.opacity = peek.out > 0.4 ? 1 : 0;
          if ((k > 1 || peek.ducking) && peek.out < 0.02) { peeker.visible = false; peek.next = t + 90 + Math.random() * 90; }
        }
      },
      act(name, arg) {
        // A scary story: the eyes open in the dark right away.
        if (name === 'eyes') { if (watch.start !== null) return 0; watch.at = lastT; return 4000; }
        // He warms up by it: the fire rises a little, quietly.
        if (name === 'warm') { flare = Math.max(flare, 0.45); return 3000; }
        // Specter comes camping: one of his stories (`arg`: { story, on }).
        if (name === 'story') { if (stage3.busy() || !STORIES[arg?.story]) return 0; return stage3.start({ steps: STORIES[arg.story](), done: () => { twig.visible = false; mallow.visible = false; Object.assign(roast, { toast: 0, burning: false, charred: false, shake: false }); } }, 3, arg.on, arg.skin); }
        if (name === 'stop') { stage3.stop(); return 1; }
        if (name === 'hold') { hold = true; return 1; }
        if (name === 'free') { hold = false; return 1; }
        return 0;
      },
      // Where a point of the scene falls on the screen, and how many pixels one unit measures there.
      project(x, y, z) {
        const c = canvas?.getBoundingClientRect?.();
        if (!c?.width) return null;
        world.updateMatrixWorld();
        proj.set(x, y, z); world.localToWorld(proj);
        projUp.set(x, y + 1, z); world.localToWorld(projUp);
        const cam = this.camera; cam.updateMatrixWorld();
        proj.project(cam); projUp.project(cam);
        return { x: c.left + ((proj.x + 1) / 2) * c.width, y: c.top + ((1 - proj.y) / 2) * c.height, unit: Math.abs(projUp.y - proj.y) / 2 * c.height };
      },
      poke() {
        // Brought back from the embers: the satisfying sound, once; while it burns, only a soft crackle now and then.
        if (strength() < 0.75) sfx.revive(); else sfx.crackle();
        poked = Date.now();
        try { localStorage.setItem(POKED, String(poked)); } catch { /* not remembered */ }
        flare = 1;
        return true;
      },
    };
  },

  // A dove, for the medic's routines: low-poly, pearl grey with an iridescent neck, a small beak, wings that flap
  // while it flies (canvas.dataset.flap = '1') and fold when it perches; its head pecks (canvas.dataset.peck = '1').
  dove(canvas) {
    const scene = new T.Scene(); stage(scene, { key: [2, 4, 4], ground: false, intensity: 1.8 });
    const flat = (c, r = 0.7) => std(c, r, 0, { flatShading: true });
    const g = new T.Group(); scene.add(g);
    g.add(mesh(new T.IcosahedronGeometry(0.5, 1), flat(0xc9ccd3), { s: [1.25, 0.8, 0.8] }));
    g.add(mesh(new T.ConeGeometry(0.22, 0.6, 6), flat(0x8e939c), { x: -0.75, y: 0.1, rz: Math.PI / 2 + 0.25, s: [1, 1, 0.5] }));
    const head = new T.Group(); head.position.set(0.55, 0.38, 0); g.add(head);
    head.add(mesh(new T.IcosahedronGeometry(0.24, 1), flat(0xb7bcc6)));
    head.add(mesh(new T.IcosahedronGeometry(0.2, 1), flat(0x5f8f7f, 0.3), { x: -0.08, y: -0.16, s: [1, 0.8, 1.1] }));
    head.add(mesh(new T.ConeGeometry(0.06, 0.18, 5), flat(0xd98c3a), { x: 0.27, y: -0.02, rz: -Math.PI / 2 }));
    for (const z of [-0.13, 0.13]) head.add(mesh(new T.SphereGeometry(0.035, 8, 6), std(0x111111, 0.2), { x: 0.13, y: 0.06, z }));
    const wings = [-1, 1].map((sz) => { const w = new T.Group(); w.position.set(0.05, 0.22, sz * 0.25); g.add(w); w.add(mesh(new T.IcosahedronGeometry(0.4, 0), flat(0xa9aeb8), { x: -0.15, z: sz * 0.25, s: [1.2, 0.18, 0.75] })); return w; });
    for (const z of [-0.1, 0.1]) g.add(mesh(new T.CylinderGeometry(0.02, 0.02, 0.22, 4), flat(0xd96a6a), { x: 0.1, y: -0.45, z }));
    return {
      scene, camera: camera(28, [0, 0.4, 4.2], [0, 0.05, 0]),
      update(t) {
        const d = canvas?.dataset ?? {};
        const flap = d.flap === '1';
        for (const [i, w] of wings.entries()) w.rotation.x = (i ? 1 : -1) * (flap ? 0.2 + Math.sin(t * 22) * 0.9 : 0.1);
        g.position.y = flap ? Math.sin(t * 22) * 0.04 : 0;
        head.rotation.z = d.peck === '1' ? -Math.max(0, Math.sin(t * 9)) * 0.7 : Math.sin(t * 2.5) * 0.08;
        head.position.x = 0.55 + (d.peck === '1' ? Math.max(0, Math.sin(t * 9)) * 0.08 : 0);
        g.rotation.y = -0.35 + Math.sin(t * 0.8) * 0.1;
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

  // Specter, Studium's mascot, the same ghost as Spectre's: one soft body (a round head that flows into a skirt with
  // a wavy hem), raymarched in the shader with light, a glowing rim and a soft outline, so he has real volume from
  // every angle. His face shows every emotion (canvas.dataset.mood): '' | 'glad' | 'shut' (asleep) | 'sad' |
  // 'surprised' | 'angry' | 'love' | 'dizzy' | 'wink' | 'scared'; canvas.dataset.talk = '1' moves his mouth;
  // canvas.dataset.look (-1 to 1) turns him toward the pointer. Each feature eases from one emotion to the next.
  // canvas.dataset.skin: '' | 'doctor' (an original doctor's look: a head mirror on a band and a white coat).
  specter(canvas) {
    const scene = new T.Scene();
    const U = specterUniforms();
    const frag = SPECTER_FRAG(false);
    const mat = new T.ShaderMaterial({ uniforms: U, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false });
    mat.premultipliedAlpha = true;
    const tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new T.Mesh(tri, mat); quad.frustumCulled = false; scene.add(quad);
    const face = specterFace(U);
    return {
      scene, camera: camera(30, [0, 0, 5], [0, 0, 0]),
      update(t) {
        U.uRes.value.set(Math.min(gl.w, canvas?.width || 160), Math.min(gl.h, canvas?.height || 160));
        face(t, canvas?.dataset ?? {});
      },
    };
  },

  // The study desk of «Noche de estudio»: a wooden desk, a desk lamp whose warm light falls in a cone with soft shadows,
  // and a mug of coffee steaming in its light.
  desk() {
    const cup = PROPS.cup(null, { desk: true, camera: camera(34, [-2.4, 3.2, 4.6], [-0.3, 0.8, 0]) });
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
const t0 = performance.now();
// What a removed object held (its geometries, materials and their own textures) is given back to the GPU.
const shared = new Set();
function dispose(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [o.material].flat().filter(Boolean)) {
      for (const k of ['map', 'emissiveMap']) if (m[k] && !shared.has(m[k])) m[k].dispose();
      m.dispose?.();
    }
  });
}
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) for (const p of live) if (p.canvas === e.target) p.on = e.isIntersecting;
  schedule();
});
function frame(now) {
  raf = 0;
  if (!gl || !live.size) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  const t = (now - t0) / 1000;
  const { renderer } = gl;
  let moving = false;
  for (const p of [...live]) {
    if (!p.canvas.isConnected) { live.delete(p); seen.unobserve(p.canvas); dispose(p.prop.scene); continue; }
    if (!p.on && p.drawn) continue;
    moving = moving || p.on;
    const w = Math.min(gl.w, p.canvas.width); const h = Math.min(gl.h, p.canvas.height);
    p.prop.update?.(still() ? 2 : t, still() ? 0 : dt);
    p.prop.camera.aspect = w / h; p.prop.camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(p.prop.scene, p.prop.camera);
    p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    p.ctx.drawImage(renderer.domElement, 0, gl.h - h, w, h, 0, 0, p.canvas.width, p.canvas.height);
    if (!p.drawn) { p.drawn = true; p.ready?.(); }
  }
  // Nothing on screen: the loop rests until something comes into view (the observer wakes it).
  if (moving && !still() && !document.hidden) schedule();
}
// About 30 frames a second is plenty for these objects.
function schedule() { if (!raf) raf = requestAnimationFrame((now) => { if (now - last < 30) { raf = 0; setTimeout(schedule, 30 - (now - last)); return; } frame(now); }); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

// Puts a 3D object in a canvas (its CSS size decides the resolution). Returns a handle with poke() and drawn (a
// promise kept when the object is first on the canvas); the object goes away with its canvas.
export async function prop(canvas, kind) {
  await boot();
  shared.add(woodTex); shared.add(softTex);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(Math.min(MAX_W, r.width || canvas.clientWidth || 160) * DPR());
  canvas.height = Math.round(Math.min(MAX_H, r.height || canvas.clientHeight || 160) * DPR());
  const p = { canvas, ctx: canvas.getContext('2d'), prop: PROPS[kind](canvas), on: true, drawn: false };
  const drawn = new Promise((resolve) => { p.ready = resolve; });
  live.add(p); seen.observe(canvas);
  last = 0; schedule();
  return { poke: () => { const out = p.prop.poke?.(); schedule(); return out; }, act: (name, arg) => { const out = p.prop.act?.(name, arg); schedule(); return out; }, project: (x, y, z) => p.prop.project?.(x, y, z), drawn };
}
// Every canvas with data-prop="kind" inside root gets its object (once). Returns a promise kept when all of them are
// drawn (or failed: the page never waits on a 3D object that cannot be drawn).
export function props(root = document) {
  const waits = [];
  for (const c of root.querySelectorAll('canvas[data-prop]:not([data-on])')) {
    c.dataset.on = '1';
    waits.push(prop(c, c.dataset.prop).then((h) => { c._prop = h; return h.drawn; }).catch(() => { c.replaceWith(Object.assign(document.createElement('span'), { className: 'prop-off', textContent: '' })); }));
  }
  return Promise.all(waits);
}
export const pokeProp = (canvas) => canvas?._prop?.poke();
// Something done to an object from outside (Specter eats a cherry of the cake, toasts a marshmallow at the fire).
export const actProp = (canvas, name, arg) => canvas?._prop?.act?.(name, arg);
// Where a point of an object's scene falls on the screen (for Specter to walk into it).
export const projectProp = (canvas, x, y, z) => canvas?._prop?.project?.(x, y, z);
