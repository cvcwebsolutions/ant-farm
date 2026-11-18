// Ant colony: the page script of index.html.
//
// A cut-away of an ant nest seen face on: a soil face with tunnels and chambers dug into it, the meadow above, and a
// colony of cartoon ants (our own design: big heads, big eyes with lids and pupils, glossy caramel bodies, six legs
// on a tripod gait, elbowed antennae). Everything is drawn by code: no models, no images.
//
// The colony starts as a founding one (the queen and four workers) and grows as the brood hatches. Diggers extend the
// nest at its tunnel tips and carry the spoil up to a mound by the entrance; foragers fetch seeds, or cut pieces of
// clover and leaves and carry them home like sails, to the granary and the leaf garden; scraps go to the rubbish room;
// nurses carry the queen's eggs to the brood room and feed her; a soldier minds the door; the rest sleep in the rest
// rooms. Ants meet and touch antennae, clean their antennae, and now and then one sits down, turns to the camera and
// stretches. Above is a small meadow: clover, seedlings and daisies that grow back after harvesting, fallen and
// falling leaves, and the odd visitor (a ladybird, a beetle, a caterpillar). A slow camera moves between busy places.
//
// With server.py running it follows your computer's load (/load.json "heat" 0..1): the busier the machine, the more
// ants are awake and the faster they work; without it the colony keeps a slow rhythm of its own. The nest grows over
// about two days and is saved (server.py's /state?name=ant-colony, or the browser's localStorage), so a reload doesn't
// reset it; three days after it is full a new colony starts.
//
// Options: fps=N (default 30), heat=X (fixed load), demo=1 (load sweeping), fresh=1 (new colony, nothing loaded or
// saved), seed=N, grow=X (with fresh: start X of the way to a full nest), shot=<kind> (camera stays on one kind of
// shot: entrance queen granary brood rest dig follow wide), zoom=X (shot width factor, default 1.45), hour=H (clock hour for day/night), dpr=X, aa=0,
// capture=1 (no clock: window.__step(n) runs n frames of 1/30 s, for recording clips).
import * as THREE from './vendor/three.module.js';

const Q = new URLSearchParams(location.search);
const qn = (k, d) => { const v = parseFloat(Q.get(k)); return isFinite(v) ? v : d; };
const FPS = qn('fps', 30), CAPTURE = Q.get('capture') === '1', FRESH = Q.get('fresh') === '1';
const FORCE_SHOT = Q.get('shot') || '';
const ZOOM = qn('zoom', 1.45);   // every shot this much wider than the first build's: smaller ants, more of the nest in view
const R = Math.random, rr = (a, b) => a + (b - a) * R();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pick = a => a[Math.floor(R() * a.length)];
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177) | 0;
  h = Math.imul(h ^ h >>> 13, 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// ---------------------------------------------------------------- world (units: an ant is about 1 long)
const TR = 0.62;            // tunnel radius
const DEPTH = 1.25;         // how deep tunnels go into the face
const EOUT = 0.14, EW = 0.5; // carve edge: the opening reaches r+EOUT, the wall is EW wide
const STEP = 0.22;          // tunnel growth step
const NX0 = -7.6, NX1 = 7.6, NY0 = -24.5;  // nest bounds
const LANE = [-0.40, -0.86];
const GROW_S = 48 * 3600;   // seconds to a full nest at a normal pace
const vz = z => 1 - Math.sqrt(Math.max(0, 1 + z / DEPTH));      // carve value at depth z (inverse of the face shape)
const SP = [0, 0];
const surf = x => 0.10 * Math.sin(x * 0.55 + SP[0]) + 0.05 * Math.sin(x * 1.37 + SP[1]);
let EX = 0, SIDE = 1, HX = 0, HZ = -1.55, SEEDX = 4;
const heapH = () => Math.min(0.62, 0.08 + (F ? F.mound : 0) * 0.0016);
const heap = (x, z) => heapH() * Math.exp(-((x - HX) * (x - HX) * 0.8 + (z - HZ) * (z - HZ)) / 1.1);
const crater = (x, z) => 0;
const groundY = (x, z) => surf(x) + heap(x, z) - crater(x, z);

// ---------------------------------------------------------------- the colony (saved state)
let F = null;
function newFarm(seed) {
  return { v: 1, kind: 'ant-colony', seed, born: Date.now(), saved: Date.now(), prog: qn('grow', -1), full: 0,
    workers: qn('workers', 4), brood: 4, qeggs: 1, granary: 2, mound: 8, sseeds: null, leafstore: 0, midden: 0, pl: null, fleaves: null,
    trail: 0,
    lastLay: Date.now(), lastHatch: Date.now(), lastEat: Date.now() };
}

// ---------------------------------------------------------------- nest plan: every tunnel and chamber, in dig order
// A point is a disc of radius r on a tunnel or chamber centre line; rp is when it gets dug (0..TOTAL).
let P = [], CH = [], TOTAL = 1;
function makePlan(seed) {
  const rnd = mulberry(seed * 7 + 11);
  SP[0] = rnd() * 6; SP[1] = rnd() * 6;
  EX = Math.round((rnd() - 0.5) * 4.4 * 10) / 10;
  SIDE = EX > 0.3 ? -1 : EX < -0.3 ? 1 : (rnd() < 0.5 ? -1 : 1);   // the first shaft heads for the roomier side
  HX = EX - SIDE * 1.5; SEEDX = EX + SIDE * (4.6 + rnd() * 1.2);
  P = []; CH = [];
  let order = 0, tunId = 0;
  const GAP = 0.85;
  const addPt = (x, y, r, par, tun, k, ch, w = 1) => { P.push({ x, y, r, par, rp: order, tun, k, ch }); order += w; return P.length - 1; };
  const inB = (x, y, m, top) => x - m > NX0 && x + m < NX1 && y - m > NY0 && (top || y + m < -0.6);
  // ancestors of point i along the dig chain (i itself included), n of them
  const anc = (i, n) => { const out = new Set(); while (i >= 0 && n-- > 0) { out.add(i); i = P[i].par; } return out; };
  // is a disc of radius r at x,y too close to anything dug? t.skip: points to ignore (the run's own recent points
  // and where it leaves from); t.sx/sy with t.near: ignore everything round the junction it starts from
  function blocked(x, y, r, t, gap = GAP) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (t) {
        if (t.skip && t.skip.has(i)) continue;
        if (t.near && (p.ch < 0 || p.ent === t.from) && Math.hypot(p.x - t.sx, p.y - t.sy) < 2.5) continue;
      }
      const need = p.r + r + gap, dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < need * need) return true;
    }
    return false;
  }
  const lim = a => { let s = Math.sin(a); const c = Math.cos(a); s = clamp(s, -0.76, 0.24); return Math.atan2(s, (c >= 0 ? 1 : -1) * Math.sqrt(1 - s * s)); };
  function chamber(t, role) {
    const last = P[t.i];
    const dir = Math.cos(t.a) >= 0 ? 1 : -1;
    const big = role === 'queen';
    const L = big ? 4.2 : 2.6 + rnd() * 1.2, rm = big ? 1.08 : 0.88 + rnd() * 0.12;
    for (const sd of [dir, -dir]) {
      const n = Math.round(L / 0.2), pts = [], from = anc(t.i, 14);
      let ok = true;
      for (let j = 1; j <= n; j++) {
        const s = j / n;
        const r = lerp(TR, rm, sstep(0, 0.3, s)) * (1 - 0.2 * sstep(0.78, 1, s));
        const floorY = last.y - TR - 0.14 * Math.sin(Math.PI * s);
        const x = last.x + sd * j * 0.2, y = floorY + r;
        if (!inB(x, y, r + 0.3, false) || blocked(x, y, r, { skip: from, near: t.sx !== undefined, sx: t.sx, sy: t.sy }, 0.75)) { ok = false; break; }
        pts.push({ x, y, r });
      }
      if (!ok) continue;
      const ci = CH.length, i0 = P.length;
      let par = t.i;
      for (const p of pts) { t.k++; par = addPt(p.x, p.y, p.r, par, t.tun, t.k, ci, 3); P[par].ent = t.i; }
      CH.push({ role, i0, i1: P.length - 1, sd });
      t.i = P.length - 1;
      return true;
    }
    return false;
  }
  // dig a run of tunnel from point i, heading a, about len long; returns the last point, or -1 (and undoes it) if
  // it couldn't get at least `min` steps
  function run(i, a, len, tun, min, top) {
    const start = P.length, ord0 = order, p0 = P[i];
    let last = i, k = 0, bend = 0;
    const steps = Math.round(len / STEP), origin = anc(i, 13), recent = [];
    for (let st = 0; st < steps; st++) {
      bend = bend * 0.9 + (rnd() - 0.5) * 0.05;
      let ok = false;
      const skip = new Set(recent.slice(-13));
      if (k < 11) for (const j of origin) skip.add(j);
      for (const off of [0, 0.15, -0.15, 0.3, -0.3]) {
        const aa = lim(a + bend + off), p = P[last];
        const x = p.x + Math.cos(aa) * STEP, y = p.y + Math.sin(aa) * STEP;
        if (!inB(x, y, TR + 0.45, top && st < 16) || blocked(x, y, TR, { skip, near: k < 11, sx: p0.x, sy: p0.y, from: i })) continue;
        k++; last = addPt(x, y, TR, last, tun, (p0.tun === tun ? p0.k : 0) + k, -1); recent.push(last); a = aa; ok = true; break;
      }
      if (!ok) break;
    }
    if (k < min) { P.length = start; order = ord0; return -1; }
    return last;
  }
  const ROLES = ['queen', 'brood', 'granary', 'garden', 'rest', 'midden', 'rest', 'granary', 'garden', 'brood', 'rest', 'rest'];
  // a side gallery off the tunnel at point i, roughly level, ending in a room
  function gallery(i, dir, tun) {
    const L = 2.0 + rnd() * 1.6;
    const a = Math.atan2(-0.1 - rnd() * 0.25, dir);
    const g = run(i, a, L, tun, 4, false);
    if (g < 0) return false;
    const t = { i: g, a, tun, k: P[g].k, sx: P[i].x, sy: P[i].y };
    if (!chamber(t, ROLES[CH.length] || 'rest')) { // no room for a chamber: keep the gallery as a short dead end
      return true;
    }
    return true;
  }
  // the nest: a winding spine dug down from the entrance in switchbacks, side galleries with rooms at the bends,
  // and now and then a second spine from a gallery; dug in that order, so the nest grows downwards
  const r0 = addPt(EX, surf(EX) - 0.05, TR, -1, 0, 0, -1);
  const spines = [{ i: r0, dir: SIDE, tun: 0, top: true }];

  for (let si = 0; si < spines.length && si < 4; si++) {
    let { i: cur, dir, tun, top } = spines[si];
    let fails = 0;
    while (P[cur].y > NY0 + 2.5 && fails < 4) {
      const slope = 0.6 + rnd() * 0.15;
      const a = Math.atan2(-slope, dir * Math.sqrt(1 - slope * slope));
      const nx = run(cur, a, 3.4 + rnd() * 2.8, tun, 8, top || P[cur].y > -2.4);
      top = false;
      if (nx < 0) {
        dir = -dir; fails++;
        if (fails >= 3) { // stuck: carry on down from somewhere else already dug, deepest first
          const cand = P.map((p, j) => j).filter(j => P[j].ch < 0 && P[j].y < -1.5).sort((x, y) => P[x].y - P[y].y);
          for (let tr = 0; tr < 60 && cand.length; tr++) {
            const j = cand[Math.floor(Math.pow(rnd(), 2.5) * cand.length)], d = rnd() < 0.5 ? -1 : 1, sl = 0.6 + rnd() * 0.15;
            const r2 = run(j, Math.atan2(-sl, d * Math.sqrt(1 - sl * sl)), 3.4 + rnd() * 2.8, ++tunId, 8, false);
            if (r2 >= 0) { cur = r2; tun = tunId; dir = -d; fails = 0; break; }
          }
        }
        continue;
      }
      fails = 0;
      cur = nx;
      // a room right at this bend, opening outwards (the way the run was going), or else a gallery with a room
      const ct = { i: cur, a: Math.atan2(-0.15, dir), tun, k: P[cur].k, sx: P[cur].x, sy: P[cur].y };
      if (rnd() < 0.8 && chamber(ct, ROLES[CH.length] || 'rest')) { /* room at the bend */ }
      else gallery(cur, dir, ++tunId);
      if (rnd() < 0.3) gallery(cur, -dir, ++tunId);
      // a second spine now and then, from a little way back up this run
      if (spines.length < 3 && rnd() < 0.3 && P[cur].y < -5) {
        const back = P[cur].par >= 0 && P[P[cur].par].par >= 0 ? P[P[cur].par].par : cur;
        spines.push({ i: back, dir: -dir, tun: ++tunId, top: false, defer: true });
      }
      dir = -dir;
    }
  }
  TOTAL = order;
  if (!CH.length) throw new Error('nest plan without chambers (seed ' + seed + ')');
}
// a plan worth keeping: deep, several rooms, and no tunnel cutting through a room away from its door
function planOK() {
  if (CH.length < 5 || Math.min(...P.map(p => p.y)) > -17) return false;
  for (const c of P) {
    if (c.ch < 0) continue;
    const door = P[c.ent];
    for (const t of P) {
      if (t.ch === c.ch || (door && Math.hypot(t.x - door.x, t.y - door.y) < 1.6)) continue;
      if (Math.hypot(t.x - c.x, t.y - c.y) < c.r + t.r * 0.6) return false;
    }
  }
  // and no two tunnels running into each other away from where one leaves the other
  const junc = {};
  P.forEach(p => { if (p.ch < 0 && junc[p.tun] === undefined) junc[p.tun] = p.par >= 0 ? P[p.par] : p; });
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j];
    if (a.ch >= 0 || b.ch >= 0 || a.tun === b.tun) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) > TR * 1.5) continue;
    const ja = junc[a.tun], jb = junc[b.tun];
    if (Math.hypot(a.x - jb.x, a.y - jb.y) < 2.4 || Math.hypot(b.x - ja.x, b.y - ja.y) < 2.4) continue;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- walking graph
// Nodes: the meadow surface (kind S, always open), and one per plan point (T tunnel, C chamber), open once dug.
// Each tunnel node keeps the offset from its centre line to its floor (o, length m <= 1, smoothed along the tunnel):
// where a tunnel turns through steep, the floor swaps sides and m dips, so the ant crosses on the back wall.
let N = [], S0 = 0;
function buildGraph() {
  N = [];
  for (let x = -22; x <= 22.0001; x += 0.3) N.push({ kind: 'S', cx: x, cy: 0, r: 0, ox: 0, oy: 0, m: 1, ux: 0, uy: 1, thr: -1, adj: [], ch: -1 });
  S0 = N.length;
  const link = (a, b) => { N[a].adj.push(b); N[b].adj.push(a); };
  for (let i = 1; i < S0; i++) link(i - 1, i);
  P.forEach((p, i) => N.push({ kind: p.ch >= 0 ? 'C' : 'T', cx: p.x, cy: p.y, r: p.r, thr: p.rp / TOTAL, adj: [], ch: p.ch, ox: 0, oy: -1, m: 1, ux: 0, uy: 1 }));
  P.forEach((p, i) => { if (p.par >= 0) link(S0 + i, S0 + p.par); });
  let best = 0; for (let i = 0; i < S0; i++) if (Math.abs(N[i].cx - EX) < Math.abs(N[best].cx - EX)) best = i;
  link(best, S0);
  // floor side: the perpendicular of the tunnel direction that points down
  const o = P.map((p, i) => {
    let tx, ty;
    if (p.par >= 0) { tx = p.x - P[p.par].x; ty = p.y - P[p.par].y; }
    else { const c = P.findIndex(q => q.par === i); tx = c >= 0 ? P[c].x - p.x : 0; ty = c >= 0 ? P[c].y - p.y : -1; }
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    if (p.ch >= 0) return [0, -1];
    const a = [ty, -tx], b = [-ty, tx];
    return a[1] < b[1] ? a : b;
  });
  let cur = o;
  for (let it = 0; it < 4; it++) {
    cur = cur.map((v, i) => {
      if (P[i].ch >= 0) return v;
      let sx = v[0] * 2, sy = v[1] * 2, n = 2;
      for (const j of N[S0 + i].adj) if (j >= S0) { sx += cur[j - S0][0]; sy += cur[j - S0][1]; n++; }
      return [sx / n, sy / n];
    });
  }
  cur.forEach((v, i) => {
    const n = N[S0 + i], m = Math.min(1, Math.hypot(v[0], v[1]));
    n.ox = v[0]; n.oy = v[1]; n.m = m;
    const l = Math.hypot(v[0], v[1]) || 1; n.ux = -v[0] / l; n.uy = -v[1] / l;
  });
  // the shaft's first node sits in the entrance crater
  N[S0].m = 1; N[S0].ox = 0; N[S0].oy = -0.3; N[S0].ux = 0; N[S0].uy = 1;
}
const open = j => N[j].thr <= F.prog;
// contact point of an ant on node n at depth z, with the surface normal (o.ux, o.uy, o.uz)
function contact(n, z, o) {
  if (n.kind === 'S') {
    const x = n.cx, e = 0.06, y = groundY(x, z);
    const dx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e), dz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    o.x = x; o.y = y; o.z = z; o.ux = -dx / l; o.uy = 1 / l; o.uz = -dz / l; return o;
  }
  const d = n.r + EOUT - EW * vz(z);
  const w = sstep(0.35, 0.85, n.m);
  // on the back wall of a steep stretch the two lanes become two sides of the shaft
  const side = clamp((z - (LANE[0] + LANE[1]) / 2) / ((LANE[0] - LANE[1]) / 2), -1.2, 1.2) * 0.3 * (1 - w);
  o.x = n.cx + n.ox * d + n.ux * side; o.y = n.cy + n.oy * d + n.uy * side;
  o.z = lerp(-DEPTH + 0.04, z, w);
  const ux = n.ux * w, uy = n.uy * w, uz = 1 - w, l = Math.hypot(ux, uy, uz) || 1;
  o.ux = ux / l; o.uy = uy / l; o.uz = uz / l;
  return o;
}
function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Int32Array(N.length).fill(-1);
  prev[from] = from;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of N[i].adj) {
      if (prev[j] >= 0 || !open(j)) continue;
      prev[j] = i;
      if (j === to) { const path = [to]; let k = to; while (k !== from) { k = prev[k]; path.push(k); } return path.reverse(); }
      q.push(j);
    }
  }
  return null;
}
const chNodes = role => {
  const out = [];
  CH.forEach((c, ci) => {
    if (c.role !== role) return;
    let n = 0; for (let i = c.i0; i <= c.i1; i++) if (open(S0 + i)) n++;
    if (n < (c.i1 - c.i0 + 1) * 0.75) return;
    out.push(ci);
  });
  return out;
};
// node at fraction s along chamber ci
const chAt = (ci, s) => S0 + CH[ci].i0 + Math.round(clamp(s, 0, 1) * (CH[ci].i1 - CH[ci].i0));
const surfNode = x => clamp(Math.round((x + 22) / 0.3), 0, S0 - 1);
let FRONT = [];
function frontier() {
  FRONT = [];
  if (F.prog >= 1) return;
  for (let i = S0; i < N.length; i++) {
    if (!open(i)) continue;
    for (const j of N[i].adj) if (!open(j) && N[j].thr <= F.prog + 0.02) { FRONT.push({ node: i, next: j }); break; }
  }
}

// ---------------------------------------------------------------- renderer, scene, light
const renderer = new THREE.WebGLRenderer({ antialias: Q.get('aa') !== '0', powerPreference: 'low-power', preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(qn('dpr', 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 200);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const key = new THREE.DirectionalLight(0xffe0b0, 2.6); key.position.set(-4, 7, 6);
const rim = new THREE.DirectionalLight(0xa8c8ff, 1.1); rim.position.set(4, 5, -6);
const hemi = new THREE.HemisphereLight(0xc4d6ff, 0x6a4026, 0.85);
scene.add(key, rim, hemi);
{ // a warm studio sky for the glossy bodies and the eyes' catchlights
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP);
      vec3 c = mix(vec3(0.22,0.12,0.06), vec3(0.95,0.78,0.55), smoothstep(-0.3, 0.8, d.y));
      c += vec3(4.0,3.5,2.8) * smoothstep(0.93, 0.985, dot(d, normalize(vec3(-0.45, 0.65, 0.62))));
      c += vec3(0.6,0.8,1.2) * smoothstep(0.9, 0.99, dot(d, normalize(vec3(0.5, 0.5, -0.7))));
      gl_FragColor = vec4(c, 1.); }` })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0.03).texture;
}

const GLSL_NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= .5; } return s; }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
`;
const GLSL_GROUND = `
uniform vec2 uSP; uniform vec4 uHeap; uniform vec2 uEx;
float surfY(float x){ return 0.10*sin(x*0.55 + uSP.x) + 0.05*sin(x*1.37 + uSP.y); }
float heapAt(float x, float z){ float dx = x - uHeap.x, dz = z - uHeap.y; return uHeap.w * exp(-(dx*dx*0.8 + dz*dz)/1.1); }
float craterAt(float x, float z){ return 0.; }
float groundY(float x, float z){ return surfY(x) + heapAt(x, z) - craterAt(x, z); }
`;
const U = { // uniforms shared by the hand-written materials
  uSP: { value: new THREE.Vector2() }, uHeap: { value: new THREE.Vector4() }, uEx: { value: new THREE.Vector2() },
  uKeyDir: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color() }, uSkyAmb: { value: new THREE.Color() },
  uGndAmb: { value: new THREE.Color() }, uLamp: { value: new THREE.Vector3(0, -3, 6) }, uTime: { value: 0 },
  uNight: { value: 0 }, uHorizon: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uTrail: { value: 0 },
};

// ---------------------------------------------------------------- the soil face, carved by a texture
const CB = { x0: NX0 - 1.2, y0: NY0 - 1.5, w: (NX1 - NX0) + 2.4, h: -(NY0 - 1.5) + 1.2 }, TEX = 0.05;
const CW = Math.round(CB.w / TEX), CHH = Math.round(CB.h / TEX);
const carve = new Uint8Array(CW * CHH);
const carveTex = new THREE.DataTexture(carve, CW, CHH, THREE.RedFormat, THREE.UnsignedByteType);
carveTex.magFilter = carveTex.minFilter = THREE.LinearFilter;
carveTex.needsUpdate = true;
let carveDirty = false;
function stamp(x, y, r) {
  const ro = r + EOUT;
  const i0 = Math.max(0, Math.floor((x - ro - CB.x0) / TEX)), i1 = Math.min(CW - 1, Math.ceil((x + ro - CB.x0) / TEX));
  const j0 = Math.max(0, Math.floor((y - ro - CB.y0) / TEX)), j1 = Math.min(CHH - 1, Math.ceil((y + ro - CB.y0) / TEX));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(CB.x0 + (i + 0.5) * TEX - x, CB.y0 + (j + 0.5) * TEX - y);
    const v = Math.round(clamp((ro - d) / EW, 0, 1) * 255), k = j * CW + i;
    if (v > carve[k]) carve[k] = v;
  }
  carveDirty = true;
}
let stamped = 0; // plan points are dug in rp order: P sorted copy
let DIG_ORDER = [];
function digUpTo(prog) {
  const lim = prog * TOTAL;
  while (stamped < DIG_ORDER.length && P[DIG_ORDER[stamped]].rp <= lim) { const p = P[DIG_ORDER[stamped]]; stamp(p.x, p.y, p.r); stamped++; }
}
const faceMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uCarve: { value: carveTex }, uBox: { value: new THREE.Vector4(CB.x0, CB.y0, CB.w, CB.h) },
    uDepth: { value: DEPTH }, uTexel: { value: TEX } }, U),
  vertexShader: GLSL_GROUND + `
uniform sampler2D uCarve; uniform vec4 uBox; uniform float uDepth;
varying vec3 vW;
float carveAt(vec2 p){ vec2 uv = (p - uBox.xy)/uBox.zw; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.; return texture2D(uCarve, uv).r; }
void main(){
  vec3 p = position;
  p.y = min(p.y, groundY(p.x, 0.));
  float v = carveAt(p.xy), h = 1. - (1. - v)*(1. - v);
  p.z = -uDepth*h;
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`,
  fragmentShader: GLSL_NOISE + `
uniform sampler2D uCarve; uniform vec4 uBox; uniform float uDepth, uTexel, uNight;
uniform vec3 uKeyDir, uKeyCol, uSkyAmb, uGndAmb, uLamp;
varying vec3 vW;
float H(vec2 p){ vec2 uv = (p - uBox.xy)/uBox.zw; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
  float v = texture2D(uCarve, uv).r; return 1. - (1. - v)*(1. - v); }
void main(){
  vec2 p = vW.xy; float e = uTexel;
  float h = H(p);
  float hx = H(p + vec2(e, 0.)) - H(p - vec2(e, 0.)), hy = H(p + vec2(0., e)) - H(p - vec2(0., e));
  float dep = -p.y;
  float wob = fbm(p*0.33)*1.8;
  float yy = p.y + wob;
  // fine bumps on the face so it reads as earth, not plaster
  float bx = fbm(p*6. + 3.) - fbm(p*6. - vec2(0.15, 0.) + 3.), by = fbm(p*6. + 3.) - fbm(p*6. - vec2(0., 0.15) + 3.);
  vec3 n = normalize(vec3(uDepth*hx/(2.*e) + bx*1.6, uDepth*hy/(2.*e) + by*1.6, 1.));
  vec3 humus = lin(vec3(0.22,0.15,0.10)), loam = lin(vec3(0.46,0.33,0.23)), ochre = lin(vec3(0.58,0.44,0.29));
  vec3 clay = lin(vec3(0.50,0.31,0.21)), sand = lin(vec3(0.66,0.56,0.42));
  float b1 = 0.5 + 0.5*sin(yy*0.85 + 1.3), b2 = 0.5 + 0.5*sin(yy*2.2 + wob*2.);
  vec3 alb = mix(loam, ochre, smoothstep(0.35, 0.95, b1));
  alb = mix(alb, clay, smoothstep(0.62, 1.0, b2)*0.5);
  alb = mix(alb, sand, smoothstep(0.62, 0.9, fbm(p*0.5 + 5.))*0.45);
  alb = mix(humus, alb, smoothstep(0.5, 1.9, dep + (fbm(p*1.6) - 0.5)*0.9));
  float g = fbm(p*11.)*0.6 + hash12(floor(p*80.))*0.4;
  alb *= 0.8 + 0.34*g;
  // a few small stones, irregular, sitting in the earth (a little shading of their own)
  vec2 pq = p*1.7 + (vec2(fbm(p*3.1), fbm(p*3.1 + 4.)) - 0.5)*0.5;
  vec2 c3 = floor(pq); vec2 f3 = fract(pq) - 0.5; vec2 off = vec2(hash12(c3 + 3.1), hash12(c3 + 7.7)) - 0.5;
  float pr = 0.06 + 0.1*hash12(c3 + 9.)*hash12(c3 + 2.);
  vec2 pd = (f3 - off*0.6)*vec2(1., 1.3);
  float peb = smoothstep(pr, pr - 0.03, length(pd))*step(0.82, hash12(c3));
  vec3 stone = mix(lin(vec3(0.40,0.36,0.31)), lin(vec3(0.58,0.50,0.40)), hash12(c3 + 1.));
  stone *= 0.8 + 0.5*clamp(dot(normalize(vec3(-pd, 0.5)), normalize(vec3(-0.5, 0.7, 0.5))), 0., 1.);
  alb = mix(alb, stone, peb*(1. - h));
  // tunnel walls: packed earth, a little darker and redder
  alb = mix(alb, alb*vec3(0.74, 0.66, 0.6), smoothstep(0.05, 0.9, h));
  // light, with the soil's own shadow (march towards the key light through the height field)
  float lz = uKeyDir.z; vec2 lxy = uKeyDir.xy;
  float sh = 1.;
  float jit = hash12(gl_FragCoord.xy);   // jittered steps: fine grain instead of streaks
  for (int i = 0; i < 5; i++) {
    float s = (float(i) + 0.4 + jit)*0.15;
    float hq = H(p + lxy*s);
    sh -= 0.21*smoothstep(0., 0.16, (h - lz*s/uDepth) - hq);
  }
  sh = clamp(sh, 0., 1.);
  float ndl = max(dot(n, uKeyDir), 0.);
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y*0.5 + 0.5);
  float ao = 1. - 0.42*h*h - 0.18*min(1., length(vec2(hx, hy))*2.5);
  vec2 dl = p - uLamp.xy;
  float lamp = 0.62 + 0.55*exp(-dot(dl, dl)/(uLamp.z*uLamp.z));
  vec3 col = alb*(uKeyCol*ndl*sh + amb*ao)*lamp;
  col += alb*lin(vec3(1.0, 0.70, 0.45))*h*0.12*(1. + uNight);   // a little warm bounce deep in the tunnels
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
});
{
  // fine grid over the nest, coarse grid around it
  const fine = new THREE.PlaneGeometry(CB.w, CB.h + 0.4, Math.round(CB.w / 0.035), Math.round((CB.h + 0.4) / 0.035));
  fine.translate(CB.x0 + CB.w / 2, CB.y0 + (CB.h + 0.4) / 2, 0);
  scene.add(new THREE.Mesh(fine, faceMat));
  const part = (x0, x1, y0, y1, sx, sy) => { const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, sx, sy); g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    const m = new THREE.Mesh(g, faceMat); m.frustumCulled = false; scene.add(m); };
  const top = CB.y0 + CB.h + 0.4;
  part(-60, CB.x0, -80, top, 140, 12);
  part(CB.x0 + CB.w, 60, -80, top, 140, 12);
  part(CB.x0, CB.x0 + CB.w, -80, CB.y0, 8, 12);
  scene.children.forEach(m => { if (m.isMesh) m.frustumCulled = false; });
}

// ---------------------------------------------------------------- the meadow above: ground, grass, sky
const groundMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: GLSL_GROUND + `
varying vec3 vW; varying vec3 vN;
void main(){
  vec3 p = position; p.y = groundY(p.x, p.z);
  float e = 0.05;
  float dx = groundY(p.x + e, p.z) - groundY(p.x - e, p.z), dz = groundY(p.x, p.z + e) - groundY(p.x, p.z - e);
  vN = normalize(vec3(-dx/(2.*e), 1., -dz/(2.*e)));
  vW = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`,
  fragmentShader: GLSL_NOISE + `
uniform vec3 uKeyDir, uKeyCol, uSkyAmb, uGndAmb, uHorizon; uniform vec4 uHeap; uniform vec2 uEx; uniform float uTrail, uNight;
varying vec3 vW; varying vec3 vN;
void main(){
  vec2 p = vW.xz;
  // the nest's opening: the ground is open over the top of the shaft
  vec2 ho = vec2((vW.x - uEx.x)/0.62, (vW.z + 0.62)/0.78);
  if (dot(ho, ho) < 1.) discard;
  float rimd = length(ho);
  vec3 alb = mix(lin(vec3(0.30,0.20,0.12)), lin(vec3(0.42,0.30,0.18)), fbm(p*1.3));
  float leaf = smoothstep(0.66, 0.72, fbm(p*2.2 + 9.));
  alb = mix(alb, mix(lin(vec3(0.42,0.27,0.13)), lin(vec3(0.34,0.36,0.15)), fbm(p*4.)), leaf*0.45);
  float hp = uHeap.w*exp(-((vW.x-uHeap.x)*(vW.x-uHeap.x)*0.8 + (vW.z-uHeap.y)*(vW.z-uHeap.y))/1.1);
  alb = mix(alb, lin(vec3(0.62,0.44,0.28))*(0.8 + 0.4*hash12(floor(p*40.))), smoothstep(0.03, 0.12, hp));
  alb *= 0.85 + 0.3*hash12(floor(p*60.));
  alb *= mix(0.45, 1., smoothstep(1., 1.5, rimd));   // a darker, trodden rim round the opening
  // the ants' trail: bare, packed earth along the front, worn in over the days
  float lane = smoothstep(-1.35, -1.0, vW.z)*(1. - smoothstep(-0.1, 0., vW.z));
  alb = mix(alb, lin(vec3(0.40,0.29,0.19))*(0.9 + 0.2*hash12(floor(p*50.))), lane*(0.25 + 0.6*uTrail));
  float ndl = max(dot(vN, uKeyDir), 0.);
  vec3 col = alb*(uKeyCol*ndl + mix(uGndAmb, uSkyAmb, 0.7));
  float fog = smoothstep(4., 30., -vW.z);
  vec3 far = mix(lin(vec3(0.30,0.40,0.16)), uHorizon, 0.25)*mix(1., 0.15, uNight);
  col = mix(col, far, fog*0.9);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
});
function buildGround() {
  const xs = [], zs = [];
  for (let i = -70; i <= 70; i++) { const u = i / 70; xs.push(EX + Math.sign(u) * 50 * Math.pow(Math.abs(u), 1.9)); }
  for (let j = 0; j <= 60; j++) zs.push(-38 * Math.pow(j / 60, 1.8));
  const pos = [], idx = [];
  for (const z of zs) for (const x of xs) pos.push(x, 0, z);
  const nx = xs.length;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, groundMat); m.frustumCulled = false; scene.add(m);
}
const skyMat = new THREE.ShaderMaterial({
  uniforms: U, depthWrite: false,
  vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }',
  fragmentShader: GLSL_NOISE + `
uniform vec3 uHorizon, uZenith; uniform float uNight, uTime;
varying vec3 vW;
void main(){
  float t = clamp((vW.y + 1.)/40., 0., 1.);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.15, 1., t));
  // the sun low behind the meadow
  vec2 sp = vW.xy - vec2(-14., 9.);
  col += uHorizon*0.9*exp(-dot(sp, sp)/120.)*(1. - uNight);
  // far foliage, far out of focus: big soft dark-green masses along the horizon
  float fol = fbm(vec2(vW.x*0.035, vW.y*0.05) + 2.);
  float band = smoothstep(18. + 10.*fol, 4. + 6.*fol, vW.y);
  vec3 green = mix(lin(vec3(0.20,0.32,0.12)), lin(vec3(0.42,0.52,0.20)), fbm(vW.xy*0.03 + 7.));
  green = mix(green, lin(vec3(0.03,0.05,0.07)), uNight);
  col = mix(col, green, band*0.85);
  // the garden behind, far out of focus: soft discs of leaves and light
  vec2 q = vW.xy/4.2;
  for (int k = 0; k < 2; k++){
    vec2 c = floor(q), f = fract(q) - 0.5;
    float r = hash12(c + float(k)*13.);
    vec2 o = vec2(hash12(c + 1.7), hash12(c + 4.3)) - 0.5;
    float rad = 0.18 + 0.22*hash12(c + 8.1);
    float disc = smoothstep(rad, rad - 0.05, length(f - o*0.5));
    vec3 dc = mix(lin(vec3(0.70, 0.88, 0.42)), lin(vec3(1.0, 0.93, 0.70)), hash12(c + 2.2))*1.3;
    dc = mix(dc, lin(vec3(1.0, 0.75, 0.35)), uNight);
    float a = step(0.5, r)*(0.42 - 0.2*uNight)*smoothstep(0., 0.3, t + 0.1);
    a *= 1. - uNight*step(r, 0.9);   // at night only a few warm ones (fireflies)
    col = mix(col, dc, disc*a);
    q = q*1.7 + 3.3;
  }
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
});
{
  const g = new THREE.PlaneGeometry(260, 110); g.translate(0, 50, -38);
  const m = new THREE.Mesh(g, skyMat); m.frustumCulled = false; m.renderOrder = -1; scene.add(m);
}
const grassMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide,
  vertexShader: GLSL_GROUND + `
attribute vec4 aB; attribute vec2 aC;
uniform float uTime;
varying float vV; varying float vHue; varying float vFog; varying float vLit;
void main(){
  float v = position.y;
  float w = 0.075*(1. - 0.92*v);
  float ang = aB.w;
  vec2 dir = vec2(cos(ang), sin(ang));
  float sway = aC.x + 0.10*sin(uTime*1.1 + aB.w*3. + aB.x*0.3) + 0.04*sin(uTime*2.3 + aB.z);
  float b = sway*v*v;
  vec3 p = vec3(aB.x, groundY(aB.x, aB.y), aB.y);
  vec2 side = vec2(-dir.y, dir.x);
  p.xz += side*position.x*w + dir*b*aB.z;
  p.y += v*aB.z*(1. - 0.3*b*b);
  vV = v; vHue = aC.y; vFog = smoothstep(4., 30., -p.z);
  vLit = 0.7 + 0.3*v;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`,
  fragmentShader: GLSL_NOISE + `
uniform vec3 uKeyCol, uSkyAmb, uGndAmb, uHorizon; uniform float uNight;
varying float vV; varying float vHue; varying float vFog; varying float vLit;
void main(){
  vec3 base = mix(lin(vec3(0.10,0.22,0.06)), lin(vec3(0.16,0.30,0.08)), vHue);
  vec3 tip = mix(lin(vec3(0.46,0.66,0.20)), lin(vec3(0.72,0.72,0.30)), vHue*vHue);
  vec3 alb = mix(base, tip, smoothstep(0., 1., vV));
  vec3 col = alb*(uKeyCol*0.55*vLit + mix(uGndAmb, uSkyAmb, vV)*0.9);
  col += alb*uKeyCol*0.25*smoothstep(0.5, 1., vV);   // light through the blade
  col = mix(col, mix(lin(vec3(0.30,0.40,0.16)), uHorizon, 0.25)*mix(1., 0.15, uNight), vFog*0.8);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
});
function buildGrass(seed) {
  const rnd = mulberry(seed ^ 0x6a55);
  const n = 6500, aB = new Float32Array(n * 4), aC = new Float32Array(n * 2);
  let k = 0;
  for (let t = 0; t < n * 3 && k < n; t++) {
    const z = -1.5 - 26 * Math.pow(rnd(), 1.7), x = EX + (rnd() - 0.5) * (30 + (-z) * 2.2);
    if (Math.hypot(x - HX, z - HZ) < 1.9) continue;
    if (Math.hypot(x - EX, z + 0.6) < 1.6) continue;
    const near = z > -4;
    if (near && rnd() < 0.35) continue;
    if (PLANTS.some(q => Math.hypot(q.x - x, q.z - z) < (q.kind === 'daisy' ? 0.35 : 0.6))) continue;
    const far = sstep(-2.5, -9, z);
    aB[k * 4] = x; aB[k * 4 + 1] = z; aB[k * 4 + 2] = (0.25 + rnd() * 0.5) * (1 - far) + far * (0.8 + rnd() * 1.6 + (rnd() < 0.08 ? 1.2 : 0)); aB[k * 4 + 3] = rnd() * 6.283;
    aC[k * 2] = (rnd() - 0.5) * 0.9; aC[k * 2 + 1] = rnd();
    k++;
  }
  const g = new THREE.InstancedBufferGeometry();
  const blade = new THREE.PlaneGeometry(1, 1, 1, 5); blade.translate(0, 0.5, 0);
  g.index = blade.index; g.attributes.position = blade.attributes.position;
  g.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 2));
  g.instanceCount = k;
  const m = new THREE.Mesh(g, grassMat); m.frustumCulled = false; scene.add(m);
}

// ---------------------------------------------------------------- instanced parts
class Batch {
  constructor(geo, mat, max) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.max = max; this.n = 0;
    scene.add(this.mesh);
  }
  push(m, c) { if (this.n >= this.max) return; this.mesh.setMatrixAt(this.n, m); this.mesh.setColorAt(this.n, c); this.n++; }
  begin() { this.n = 0; }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
}
const sphereG = new THREE.SphereGeometry(1, 18, 12);
const lidG = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const cylG = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t; })();
const MAX_ANTS = 64;
const BODY = new Batch(sphereG, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0, envMapIntensity: 0.9 }), MAX_ANTS * 18);
const LEG = new Batch(cylG, new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, envMapIntensity: 0.6 }), MAX_ANTS * 20);
const EYE = new Batch(sphereG, new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0, emissive: 0x2a2620, envMapIntensity: 1.2 }), MAX_ANTS * 2);
const PUPIL = new Batch(sphereG, new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0, envMapIntensity: 1.4 }), MAX_ANTS * 2);
const LID = new Batch(lidG, new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0, side: THREE.DoubleSide }), MAX_ANTS * 2);
const PROP = new Batch(sphereG, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, envMapIntensity: 0.5 }), 1400);
const SHADOW = new Batch(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false,
  color: 0x000000, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }), MAX_ANTS + 4);
SHADOW.mesh.renderOrder = 2;

const M4 = new THREE.Matrix4(), M3 = new THREE.Matrix4(), QT = new THREE.Quaternion(), QL = new THREE.Quaternion(), SC = new THREE.Vector3();
const VA = new THREE.Vector3(), VB = new THREE.Vector3(), VC = new THREE.Vector3(), VD = new THREE.Vector3(), MID = new THREE.Vector3();
const AXY = new THREE.Vector3(0, 1, 0), AXX = new THREE.Vector3(1, 0, 0), AXZ = new THREE.Vector3(0, 0, 1);
function ell(b, pos, q, sx, sy, sz, c) { SC.set(sx, sy, sz); M4.compose(pos, q, SC); b.push(M4, c); }
function cyl(b, a, e, r, c) {
  VD.subVectors(e, a); const L = VD.length(); if (L < 1e-5) return;
  VD.divideScalar(L); QT.setFromUnitVectors(AXY, VD); MID.addVectors(a, e).multiplyScalar(0.5);
  SC.set(r, L, r); M4.compose(MID, QT, SC); b.push(M4, c);
}
const COL = { seed: new THREE.Color().setRGB(0.80, 0.56, 0.24, THREE.SRGBColorSpace), seed2: new THREE.Color().setRGB(0.66, 0.44, 0.18, THREE.SRGBColorSpace),
  egg: new THREE.Color().setRGB(0.97, 0.94, 0.86, THREE.SRGBColorSpace), larva: new THREE.Color().setRGB(0.96, 0.92, 0.80, THREE.SRGBColorSpace),
  crumb: new THREE.Color().setRGB(0.55, 0.38, 0.24, THREE.SRGBColorSpace), crumb2: new THREE.Color().setRGB(0.66, 0.48, 0.30, THREE.SRGBColorSpace),
  eye: new THREE.Color().setRGB(0.98, 0.96, 0.92, THREE.SRGBColorSpace), pupil: new THREE.Color().setRGB(0.05, 0.04, 0.06, THREE.SRGBColorSpace),
  black: new THREE.Color(0, 0, 0), stem: new THREE.Color().setRGB(0.35, 0.45, 0.16, THREE.SRGBColorSpace),
  leaf: new THREE.Color().setRGB(0.36, 0.62, 0.18, THREE.SRGBColorSpace), leafD: new THREE.Color().setRGB(0.22, 0.45, 0.12, THREE.SRGBColorSpace),
  husk: new THREE.Color().setRGB(0.55, 0.42, 0.26, THREE.SRGBColorSpace), rubbish: new THREE.Color().setRGB(0.32, 0.24, 0.17, THREE.SRGBColorSpace),
  fungus: new THREE.Color().setRGB(0.96, 0.93, 0.84, THREE.SRGBColorSpace), petal: new THREE.Color().setRGB(0.98, 0.97, 0.94, THREE.SRGBColorSpace),
  yolk: new THREE.Color().setRGB(1.0, 0.78, 0.15, THREE.SRGBColorSpace), pebble: new THREE.Color().setRGB(0.55, 0.52, 0.48, THREE.SRGBColorSpace),
  pebble2: new THREE.Color().setRGB(0.42, 0.40, 0.37, THREE.SRGBColorSpace), twig: new THREE.Color().setRGB(0.36, 0.25, 0.15, THREE.SRGBColorSpace),
  lady: new THREE.Color().setRGB(0.86, 0.10, 0.06, THREE.SRGBColorSpace), beetle: new THREE.Color().setRGB(0.10, 0.32, 0.30, THREE.SRGBColorSpace),
  cater: new THREE.Color().setRGB(0.48, 0.74, 0.22, THREE.SRGBColorSpace), cater2: new THREE.Color().setRGB(0.95, 0.85, 0.30, THREE.SRGBColorSpace),
  white: new THREE.Color(1, 1, 1) };
// autumn colours of fallen leaves
const LEAFC = [COL.leaf, new THREE.Color().setRGB(0.85, 0.52, 0.12, THREE.SRGBColorSpace), new THREE.Color().setRGB(0.80, 0.68, 0.16, THREE.SRGBColorSpace),
  new THREE.Color().setRGB(0.62, 0.40, 0.12, THREE.SRGBColorSpace), new THREE.Color().setRGB(0.55, 0.60, 0.16, THREE.SRGBColorSpace)];
const leafG = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-1, 0); sh.quadraticCurveTo(-0.2, 1.25, 1, 0); sh.quadraticCurveTo(-0.2, -1.25, -1, 0);
  const g = new THREE.ShapeGeometry(sh, 8);
  g.rotateX(-Math.PI / 2);               // lie in x-z, facing up
  const pos = g.attributes.position;     // a slight cup across the leaf
  for (let i = 0; i < pos.count; i++) pos.setY(i, 0.5 * pos.getZ(i) * pos.getZ(i));
  g.computeVertexNormals();
  return g;
})();
const LEAFB = new Batch(leafG, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 }), 900);
const EU = new THREE.Euler();

// ---------------------------------------------------------------- the ants
const ants = [];
const CA = { x: 0, y: 0, z: 0, ux: 0, uy: 1, uz: 0 }, CBn = { x: 0, y: 0, z: 0, ux: 0, uy: 1, uz: 0 };
let clockS = 0, heat = qn('heat', 0.3), heatT = heat;
const T_START = Date.now();
const simNow = () => CAPTURE ? T_START + clockS * 1000 * qn('speed', 1) : Date.now();
const camPos = new THREE.Vector3();
class Ant {
  constructor(id, queen) {
    this.id = id; this.queen = !!queen;
    const rnd = mulberry(F.seed * 131 + id * 7919 + 3);
    const soldier = !queen && (id === 2 || rnd() < 0.12);
    this.soldier = soldier;
    this.sc = queen ? 1.62 : (soldier ? 1.12 : 0.9 + rnd() * 0.16);
    const h = queen ? 0.012 : (soldier ? 0.005 : 0.03 + (rnd() - 0.5) * 0.03);
    const s = queen ? 0.72 : 0.72 + rnd() * 0.12, l = queen ? 0.33 : (soldier ? 0.30 : 0.40 + (rnd() - 0.5) * 0.08);
    this.col = new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);
    this.lid = new THREE.Color().setHSL(h + 0.012, s, Math.min(0.6, l * 1.0), THREE.SRGBColorSpace);
    this.gcol = new THREE.Color().setHSL(h - 0.008, s, l * 0.78, THREE.SRGBColorSpace);
    this.hcol = new THREE.Color().setHSL(h + 0.012, s, Math.min(0.6, l * 1.08), THREE.SRGBColorSpace);
    this.lcol = new THREE.Color().setHSL(h - 0.01, s * 0.7, l * 0.42, THREE.SRGBColorSpace);
    this.eyeS = queen ? 1.0 : 0.92 + rnd() * 0.22; this.pupS = 0.88 + rnd() * 0.22;
    this.headS = queen ? 1.0 : 0.95 + rnd() * 0.12;
    this.spd = 0.85 + rnd() * 0.3;
    this.zPers = -0.3 - rnd() * 0.7;
    this.path = null; this.t = 0; this.n = S0; this.z = LANE[0]; this.zt = LANE[0];
    this.steps = []; this.cur = null; this.timer = 0;
    this.carry = null; this.awake = true; this.tired = false;
    this.phi = 0.12; this.phiT = 0.12; this.T0x = 1; this.T0y = 0;
    this.gait = rnd(); this.sit = 0; this.crouch = 0; this.arms = 0; this.stretch = 0; this.dig = 0;
    this.blinkT = 1 + rnd() * 4; this.blink = 0; this.lidC = 0;
    this.look = new THREE.Vector3(); this.lookT = 0; this.sacc = new THREE.Vector3();
    this.antT = null; this.greet = null; this.greetCd = 10 + rnd() * 20; this.wait = 0; this.pass = 0;
    this.P = new THREE.Vector3(); this.Uv = new THREE.Vector3(0, 1, 0); this.Fv = new THREE.Vector3(1, 0, 0); this.Sv = new THREE.Vector3(0, 0, 1);
    this.Q = new THREE.Quaternion(); this.moving = false; this.dir2 = [1, 0]; this.nod = 0; this.mand = 0;
  }
  at() { return this.path && this.path.length > 1 ? (this.t < 0.5 ? this.path[0] : this.path[1]) : this.n; }
  place(node) { this.n = node; this.path = null; this.t = 0; }
  go(to) { this.steps.push({ k: 'go', to }); }
  act(a, d, extra) { this.steps.push(Object.assign({ k: 'act', a, d }, extra || {})); }
  fn(f) { this.steps.push({ k: 'fn', f }); }
  plan() {
    if (this.queen) return;
    if (this.tired || !this.awake) { this.awake = false; this.tired = false; this.goSleep(); return; }
    const gran = chNodes('granary'), brood = chNodes('brood'), qch = chNodes('queen');
    const diggers = ants.filter(a => a.task === 'dig').length;
    const night = U.uNight.value, guards = ants.filter(a => a.task === 'guard').length;
    const w = { dig: FRONT.length && diggers < 2 + FRONT.length ? 0.32 : 0, forage: (0.22 + 0.2 * heat) * (1 - 0.6 * night),
      leaf: (0.18 + 0.12 * heat) * (1 - 0.6 * night), nurse: qch.length ? 0.2 : 0, patrol: 0.1, brk: 0.07,
      waste: (F.husks || 0) > 0 && chNodes('midden').length ? 0.08 : 0, guard: this.soldier && guards < 2 ? 0.5 : 0 };
    let tot = 0; for (const k in w) tot += w[k];
    let r = R() * tot, task = 'patrol';
    for (const k in w) { r -= w[k]; if (r <= 0) { task = k; break; } }
    this.task = task;
    if (task === 'dig') {
      const f = pick(FRONT);
      this.go(f.node);
      this.act('dig', rr(7, 12), { faceNode: f.next });
      this.fn(a => { a.carry = 'crumb'; });
      this.go(surfNode(HX + rr(-0.7, 0.7)));
      this.act('drop', 1.2, { faceX: HX });
      this.fn(a => { a.carry = null; F.mound++; });
    } else if (task === 'forage') {
      const s = F.sseeds.filter(q => !q.res);
      if (!s.length) { this.go(surfNode(EX + rr(-9, 9))); this.act('look', rr(2, 4)); return; }
      const sd = pick(s); sd.res = true;
      this.go(surfNode(sd.x));
      this.act('pick', 1.3, { faceX: sd.x });
      this.fn(a => { const i = F.sseeds.indexOf(sd); if (i >= 0) F.sseeds.splice(i, 1); a.carry = 'seed'; });
      const g = gran.length ? chAt(pick(gran), rr(0.35, 0.6)) : (qch.length ? chAt(qch[0], 0.2) : S0);
      this.go(g);
      this.act('drop', 1.2);
      this.fn(a => { a.carry = null; F.granary = Math.min(F.granary + 1, 240); });
    } else if (task === 'leaf') { // cut a piece off a plant or a fallen leaf and carry it home like a sail
      const plants = PLANTS.filter(q => q.n > 0 && !q.res), fl = F.fleaves.filter(q => !q.res);
      const src = plants.length && (R() < 0.6 || !fl.length) ? pick(plants) : (fl.length ? pick(fl) : null);
      if (!src) { this.go(surfNode(EX + rr(-8, 8))); this.act('look', rr(2, 4)); return; }
      src.res = true;
      this.go(surfNode(src.x + rr(-0.2, 0.2)));
      this.act('cut', rr(2.5, 4), { faceX: src.x, z: -1.0 });
      this.fn(a => { src.res = false; if (src.max !== undefined) { if (src.n > 0) src.n--; } else { src.bites = (src.bites || 0) + 1; if (src.bites >= 4) F.fleaves.splice(F.fleaves.indexOf(src), 1); } a.carry = 'leaf'; a.leafHue = src.max !== undefined ? 0 : src.c; });
      const gd = chNodes('garden'), gr = chNodes('granary');
      this.go(gd.length ? chAt(pick(gd), rr(0.35, 0.6)) : gr.length ? chAt(pick(gr), rr(0.35, 0.6)) : chAt(0, 0.2));
      this.act('drop', 1.2);
      this.fn(a => { a.carry = null; F.leafstore = Math.min(F.leafstore + 1, 200); });
    } else if (task === 'waste') { // husks and scraps out to the rubbish room
      const from = gran.length ? chAt(pick(gran), rr(0.6, 0.9)) : chAt(0, 0.1), mid = chNodes('midden');
      this.go(from); this.act('pick', 1.2);
      this.fn(a => { if ((F.husks || 0) > 0) { F.husks--; a.carry = 'husk'; } });
      this.go(chAt(pick(mid), rr(0.4, 0.6))); this.act('drop', 1.2);
      this.fn(a => { if (a.carry === 'husk') F.midden = Math.min(F.midden + 1, 200); a.carry = null; });
    } else if (task === 'guard') { // a soldier minds the door, looking out
      this.go(surfNode(EX + rr(-0.9, 0.9)));
      this.act('guard', rr(20, 40), { faceX: this.P.x > EX ? EX + 9 : EX - 9 });
    } else if (task === 'nurse') {
      const q = qch[0];
      if (F.qeggs > 0 && brood.length && R() < 0.6) {
        this.go(chAt(q, 0.93)); this.act('pick', 1.3, { z: rr(-0.3, -0.45) });
        this.fn(a => { if (F.qeggs > 0) { F.qeggs--; a.carry = 'egg'; } });
        this.go(chAt(pick(brood), rr(0.3, 0.55))); this.act('drop', 1.2);
        this.fn(a => { if (a.carry === 'egg') F.brood = Math.min(F.brood + 1, 40); a.carry = null; });
      } else if (R() < 0.5 || !brood.length) {
        this.go(chAt(q, 0.3)); this.act('feed', rr(5, 8), { faceQueen: true, z: rr(-0.5, -0.95) });
      } else {
        this.go(chAt(pick(brood), rr(0.4, 0.62))); this.act('tend', rr(6, 10), { faceNode: chAt(brood[0], 0.95), z: rr(-0.3, -0.95) });
      }
    } else if (task === 'brk') { // a break somewhere quiet: a room other than the queen's
      const rooms = CH.map((c, i) => i).filter(i => i > 0 && CH[i].role !== 'queen' && chNodes(CH[i].role).includes(i));
      if (rooms.length) { this.go(chAt(pick(rooms), rr(0.55, 0.85))); this.act('break', rr(8, 13)); }
    } else {
      const open_ = []; for (let i = S0; i < N.length; i++) if (open(i)) open_.push(i);
      this.go(R() < 0.25 ? surfNode(EX + rr(-6, 6)) : pick(open_));
      this.act('look', rr(1.5, 3.5));
      if (R() < 0.35) this.act('groom', rr(3, 5));   // clean an antenna with a front leg
    }
  }
  goSleep() {
    this.task = 'sleep';
    let rest = chNodes('rest'), qOnly = false;
    if (!rest.length) { rest = chNodes('queen'); qOnly = true; }
    if (!rest.length) { this.act('sleep', 1e9); return; }
    // a free spot: chamber, position along, depth
    for (let k = 0; k < 30; k++) {
      const ci = pick(rest), s = qOnly ? rr(0.0, 0.12) : rr(0.12, 0.9), zi = Math.floor(R() * 3);
      const node = chAt(ci, s), z = [-0.32, -0.62, -0.92][zi];
      contact(N[node], z, CA);
      if (ants.some(a => a !== this && ((a.sleepAt && Math.hypot(N[a.sleepAt.node].cx - N[node].cx, a.sleepAt.z - z) < 0.75) ||
        (a.queen && Math.abs(a.P.x - CA.x) < 1.9)))) continue;
      this.sleepAt = { node, z };
      break;
    }
    if (!this.sleepAt) this.sleepAt = { node: chAt(pick(rest), rr(0.2, 0.8)), z: -0.62 };
    this.go(this.sleepAt.node);
    this.act('sleep', 1e9, { z: this.sleepAt.z });
  }
  wake() { this.awake = true; this.tired = false; if (this.cur && this.cur.a === 'sleep') { this.cur = null; this.sleepAt = null; } this.steps = []; }
  update(dt) {
    this.clock = (this.clock || 0) + dt; this.dtl = dt;
    if (this.queen) { this.updateQueen(dt); return; }
    if (!this.cur) { this.cur = this.steps.shift() || null; if (!this.cur) { this.plan(); this.cur = this.steps.shift() || null; } if (this.cur) this.cur.t0 = clockS; }
    const c = this.cur;
    let wantSit = 0, wantCrouch = 0, wantArms = this.carry ? 1 : 0, wantStretch = 0;
    this.moving = false; this.antT = null; this.dig = 0; this.lookMode = 'fwd'; this.cutting = 0; this.guarding = 0; this.grooming = 0;
    if (this.greet) {
      const g = this.greet;
      if (clockS > g.until || !g.other) this.greet = null;
      else { this.faceTo(g.other.P.x - this.P.x, g.other.P.y - this.P.y, 0.5); this.antT = g.other.headW; this.lookMode = 'other'; this.lookObj = g.other; }
    }
    if (c && !this.greet) {
      if (c.k === 'fn') { c.f(this); this.cur = null; }
      else if (c.k === 'go') {
        if (!c.path) {
          c.path = findPath(this.at(), c.to);
          if (!c.path) { this.steps = []; this.cur = null; this.task = null; }
          else { this.path = c.path; this.n = this.path[0]; this.t = 0; }
        }
        if (this.cur) this.walk(dt);
      } else if (c.k === 'act') {
        const el = clockS - c.t0;
        if (c.zFree === undefined) c.zFree = c.z !== undefined ? this.freeDepth(c.z) : this.freeDepth(this.z);
        this.zt = c.zFree;
        if (c.faceNode !== undefined) { const nn = N[c.faceNode], me = N[this.n]; this.faceTo(nn.cx - me.cx, nn.cy - me.cy, 0.42); }
        else if (c.faceX !== undefined) this.faceTo(c.faceX - this.P.x, 0, 0.42);
        else if (c.faceQueen && QUEEN) { this.faceTo(QUEEN.P.x - this.P.x, 0, 0.45); this.antT = QUEEN.headW; this.lookMode = 'queen'; }
        switch (c.a) {
          case 'dig': wantCrouch = 1; this.dig = 1; break;
          case 'pick': case 'drop': wantCrouch = sstep(0, 0.4, el) * (1 - sstep(c.d - 0.4, c.d, el)) * 0.8; break;
          case 'tend': wantCrouch = 0.55; this.antT = null; break;
          case 'feed': wantCrouch = 0.1; break;
          case 'look': this.lookMode = 'around'; break;
          case 'cut': wantCrouch = 0.55; this.dig = 0; this.cutting = 1; this.lookMode = 'fwd'; break;
          case 'guard': this.lookMode = 'around'; this.guarding = 1; break;
          case 'groom': this.grooming = 1; this.lookMode = 'around'; break;
          case 'break': {
            wantSit = 1; this.phiT = Math.PI / 2; this.lookMode = 'camera';
            const ph = el / c.d;
            wantStretch = sstep(0.35, 0.45, ph) * (1 - sstep(0.6, 0.7, ph));
            break;
          }
          case 'sleep': wantSit = 1; wantCrouch = 0.45; this.lookMode = 'sleep'; break;
        }
        if (el >= c.d) this.cur = null;
      }
    }
    // smooth posture
    const k = 1 - Math.exp(-dt * 4);
    this.sit += (wantSit - this.sit) * (1 - Math.exp(-dt * 2.2));
    this.crouch += (wantCrouch - this.crouch) * k;
    this.arms += (wantArms - this.arms) * k;
    this.stretch += (wantStretch - this.stretch) * (1 - Math.exp(-dt * 3));
    this.z += (this.zt - this.z) * (1 - Math.exp(-dt * 1.6));
    const dp = wrapA(this.phiT - this.phi), mx = 3.4 * dt;
    const turn = clamp(dp, -mx, mx); this.phi += turn;
    if (!this.moving) this.gait += Math.abs(turn) * 0.35;
    this.place3D();
    this.updateFace(dt);
    if (this.dig && R() < dt * 9) spawnCrumb(this);
    if (this.cutting && R() < dt * 6) spawnCrumb(this, true);
  }
  // the depth (towards or away from the glass) where this ant, standing still here, overlaps nobody; near `pref`
  freeDepth(pref) {
    const lo = N[this.n].kind === 'S' ? -1.35 : -1.0, hi = -0.28;
    let best = pref, bs = -1e9;
    for (let k = 0; k <= 12; k++) {
      const z = lo + (hi - lo) * k / 12;
      let sc = -Math.abs(z - pref) * 0.6;
      for (const o of ants) {
        if (o === this) continue;
        const d = Math.hypot(o.P.x - this.P.x, o.P.y - this.P.y), dz = Math.abs(o.P.z - z);
        if (d < 1.1 * Math.max(this.sc, o.sc)) sc -= Math.max(0, 0.6 - dz) * (1.2 - d) * 10;
      }
      if (sc > bs) { bs = sc; best = z; }
    }
    return best;
  }
  faceTo(dx, dy, cheat) { const s = dx * this.T0x + dy * this.T0y; this.phiT = s >= 0 ? cheat : Math.PI - cheat; }
  walk(dt) {
    const p = this.path;
    if (!p || p.length < 2) { this.n = p ? p[0] : this.n; this.path = null; this.cur = null; return; }
    contact(N[p[0]], this.z, CA); contact(N[p[1]], this.z, CBn);
    let dx = CBn.x - CA.x, dy = CBn.y - CA.y;
    const len = Math.hypot(dx, dy, CBn.z - CA.z) || 0.01, l2 = Math.hypot(dx, dy) || 1;
    dx /= l2; dy /= l2;
    // keep T0 along the path, with continuous sign
    const sgn = dx * this.T0x + dy * this.T0y >= 0 ? 1 : -1;
    this.T0x = dx * sgn; this.T0y = dy * sgn;
    this.phiT = sgn > 0 ? 0.12 : Math.PI - 0.12;
    this.dir2 = [dx, dy];
    this.zt = N[p[0]].kind === 'S' || Math.abs(dx) > 0.25 ? (dx >= 0 ? LANE[0] : LANE[1]) : this.zt;
    const face = Math.cos(this.phi) * sgn;
    let v = 0.62 * this.spd * (0.85 + 0.45 * heat) * (this.carry ? 0.85 : 1) * clamp((face - 0.55) / 0.35, 0, 1);
    // queue behind an ant in the same lane
    let blk = null;
    if (v > 0 && this.pass <= 0) {
      for (const o of ants) {
        if (o === this) continue;
        const ox = o.P.x - this.P.x, oy = o.P.y - this.P.y, oz = o.z - this.zt;
        if (Math.abs(oz) > 0.3 * Math.max(this.sc, o.sc)) continue;
        const ahead = ox * dx + oy * dy, side = Math.abs(-ox * dy + oy * dx);
        if (ahead > 0.05 && ahead < 1.02 * Math.max(this.sc, o.sc) && side < 0.5) { v = 0; blk = o; break; }
      }
    }
    if (v === 0 && face > 0.9) {
      this.wait += dt;
      // step aside into the other lane: always round someone standing still; of two walkers, the higher id gives way
      if (blk && !this.flipped && this.wait > 0.8 && (!blk.path || blk.id < this.id)) {
        this.zt = Math.abs(this.zt - LANE[0]) < Math.abs(this.zt - LANE[1]) ? LANE[1] : LANE[0];
        this.flipped = true;
      }
      if (this.wait > 7) { this.pass = 2.5; this.wait = 0; }
    } else if (v > 0) { this.wait = 0; this.flipped = false; }
    this.pass -= dt;
    if (v > 0) {
      this.moving = true;
      const d = v * dt;
      this.gait += d / (0.25 * this.sc);
      this.t += d / len;
      while (this.t >= 1) { p.shift(); this.t -= 1; this.n = p[0]; if (p.length < 2) { this.t = 0; this.path = null; this.cur = null; break; } }
      // greet someone coming the other way
      this.greetCd -= dt;
      if (this.greetCd <= 0 && !this.carry) {
        for (const o of ants) {
          if (o === this || o.queen || !o.moving || o.greet || o.carry) continue;
          const ox = o.P.x - this.P.x, oy = o.P.y - this.P.y;
          if (Math.hypot(ox, oy) < 0.95 && o.dir2[0] * dx + o.dir2[1] * dy < -0.5 && ox * dx + oy * dy > 0.2) {
            const until = clockS + rr(1.6, 2.6);
            this.greet = { other: o, until }; o.greet = { other: this, until };
            this.greetCd = o.greetCd = rr(20, 45);
            break;
          }
        }
        if (!this.greet) this.greetCd = 2;
      }
    }
  }
  place3D() {
    if (this.path && this.path.length > 1) {
      contact(N[this.path[0]], this.z, CA); contact(N[this.path[1]], this.z, CBn);
      const t = this.t;
      this.P.set(lerp(CA.x, CBn.x, t), lerp(CA.y, CBn.y, t), lerp(CA.z, CBn.z, t));
      this.Uv.set(lerp(CA.ux, CBn.ux, t), lerp(CA.uy, CBn.uy, t), lerp(CA.uz, CBn.uz, t)).normalize();
      // in a jam ants climb over each other rather than through: lift onto the other's back
      let lift = 0;
      for (const o of ants) {
        if (o === this || (o.climb || 0) > 0.05) continue;
        const d = Math.hypot(o.P.x - this.P.x, o.P.y - this.P.y, o.P.z - this.P.z), r = 0.62 * Math.max(this.sc, o.sc);
        if (d < r) lift = Math.max(lift, 0.42 * o.sc * sstep(r, r * 0.45, d));
      }
      this.climb = (this.climb || 0) + (lift - (this.climb || 0)) * (1 - Math.exp(-this.dtl * 10));
      this.P.addScaledVector(this.Uv, this.climb);
    } else {
      contact(N[this.n], this.z, CA);
      this.P.set(CA.x, CA.y, CA.z); this.Uv.set(CA.ux, CA.uy, CA.uz);
      this.climb = 0;
    }
    this.frame();
  }
  frame() {
    const Uv = this.Uv;
    VA.set(this.T0x, this.T0y, 0).addScaledVector(Uv, -(this.T0x * Uv.x + this.T0y * Uv.y)).normalize();
    VB.set(0, 0, 1).addScaledVector(Uv, -Uv.z);
    if (VB.lengthSq() < 0.05) VB.crossVectors(Uv, VA);
    VB.addScaledVector(VA, -VB.dot(VA)).normalize();
    this.Fv.copy(VA).multiplyScalar(Math.cos(this.phi)).addScaledVector(VB, Math.sin(this.phi));
    this.Fv.addScaledVector(Uv, -this.Fv.dot(Uv)).normalize();
    this.Sv.crossVectors(this.Fv, Uv);
    M3.makeBasis(this.Fv, Uv, this.Sv); this.Q.setFromRotationMatrix(M3);
  }
  updateFace(dt) {
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.18; this.blinkT = R() < 0.2 ? 0.35 : rr(2, 6.5); }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin(Math.PI * this.blink / 0.18) : 0;
    const want = this.lookMode === 'sleep' ? 1 : Math.max(bl, this.dig ? 0.35 : 0, this.stretch * 0.5);
    this.lidC += (want - this.lidC) * (this.lookMode === 'sleep' ? 1 - Math.exp(-dt * 2) : 1 - Math.exp(-dt * 30));
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = rr(0.8, 3.2);
      this.sacc.set(rr(-0.25, 0.25), rr(-0.15, 0.3), rr(-0.25, 0.35));
      if (R() < 0.12) this.sacc.set(9, 9, 9); // a glance at the camera
    }
    this.mand = this.dig || this.cutting ? 0.5 + 0.5 * Math.sin(this.clock * 13) : (this.cur && this.cur.a === 'feed' ? 0.5 + 0.5 * Math.sin(this.clock * 6) : 0.15 + this.stretch);
    this.nod = this.dig ? 0.12 * Math.sin(this.clock * 6.5) : 0;
  }
  updateQueen(dt) {
    const qch = chNodes('queen');
    if (qch.length) { const nd = chAt(qch[0], 0.6); if (this.n !== nd) this.place(nd); }
    this.z = this.zt = -0.8;
    this.T0x = CH[0] ? CH[0].sd : 1; this.T0y = 0;
    this.phiT = 0.75 + 0.25 * Math.sin(this.clock * 0.07);
    const dp = wrapA(this.phiT - this.phi); this.phi += clamp(dp, -dt, dt);
    this.sit = 0.85; this.crouch = 0; this.arms = 0; this.stretch = 0; this.moving = false; this.dig = 0;
    this.lookMode = Math.sin(this.clock * 0.11) > 0.4 ? 'camera' : 'around';
    this.antT = null;
    this.place3D(); this.updateFace(dt);
  }
}
let QUEEN = null;

// a crumb flicked back by a digger
const CRUMBS = [];
function spawnCrumb(a, green) {
  if (CRUMBS.length > 60) return;
  const p = a.headW || a.P;
  CRUMBS.push({ x: p.x, y: p.y - 0.15 * a.sc, z: p.z, vx: -a.Fv.x * rr(0.4, 1.0) + rr(-0.2, 0.2), vy: rr(0.5, 1.3), vz: rr(-0.2, 0.2), life: rr(0.5, 0.9), r: rr(0.025, 0.045), green });
}

// ---------------------------------------------------------------- posing: one ant into the batches
const BX = new THREE.Vector3();
function bw(a, x, y, z, out) { // body space to world
  return out.copy(a.P).addScaledVector(a.Fv, x * a.sc).addScaledVector(a.Uv, y * a.sc).addScaledVector(a.Sv, z * a.sc);
}
function wb(a, w, out) { // world to body space
  VC.subVectors(w, a.P).divideScalar(a.sc);
  return out.set(VC.dot(a.Fv), VC.dot(a.Uv), VC.dot(a.Sv));
}
const WP = Array.from({ length: 8 }, () => new THREE.Vector3());
const HIP = new THREE.Vector3(), FOOT = new THREE.Vector3(), KNEE = new THREE.Vector3(), POLE = new THREE.Vector3();
const QB = new THREE.Quaternion(), QH = new THREE.Quaternion();
function ik(h, f, l1, l2, pole, out) {
  VC.subVectors(f, h); let d = VC.length();
  d = clamp(d, 0.01, (l1 + l2) * 0.999); VC.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  VD.copy(pole).addScaledVector(VC, -pole.dot(VC)).normalize();
  return out.copy(h).addScaledVector(VC, a).addScaledVector(VD, hh);
}
function poseAnt(a) {
  const sc = a.sc, sit = a.sit, cr = a.crouch, Q = a.Q, t = a.clock || 0;
  const bob = a.moving ? Math.abs(Math.sin(a.gait * Math.PI * 2)) * 0.016 : 0;
  const breath = Math.sin(t * (a.lookMode === 'sleep' ? 1.3 : 2.2) + a.id) * (a.lookMode === 'sleep' ? 0.025 : 0.01);
  const pet = [-0.06 + 0.02 * sit, 0.27 - 0.06 * sit - 0.05 * cr + bob];
  const aT = 0.72 + 0.32 * sit - 0.5 * cr + 0.15 * a.stretch + 0.18 * (a.guarding || 0);
  const dT = [Math.cos(aT), Math.sin(aT)];
  const tor = [pet[0] + dT[0] * 0.15, pet[1] + dT[1] * 0.15];
  const neck = [pet[0] + dT[0] * 0.30, pet[1] + dT[1] * 0.30];
  const aN = 0.55 - 0.85 * cr + a.nod * 0.5;
  const hs = a.headS;
  const head = [neck[0] + Math.cos(aN) * 0.12 * hs, neck[1] + Math.sin(aN) * 0.12 * hs];
  let aHd = -0.15 - 0.55 * cr + a.nod + (a.lookMode === 'sleep' ? -0.25 : 0);
  const aG = 0.3 - 0.12 * sit;
  const qs = a.queen ? 1.85 : 1;
  const gas = [pet[0] - Math.cos(aG) * 0.24 * qs, pet[1] - Math.sin(aG) * 0.24 * qs + (a.queen ? -0.04 : 0)];
  const col = a.col;
  // body
  QL.setFromAxisAngle(AXZ, aG); QB.multiplyQuaternions(Q, QL);
  ell(BODY, bw(a, gas[0], gas[1], 0, WP[0]), QB, 0.235 * qs * sc * (1 + breath), 0.175 * (a.queen ? 1.5 : 1) * sc * (1 + breath), 0.175 * (a.queen ? 1.5 : 1) * sc * (1 + breath), a.gcol);
  if (a.queen) { // the queen's banded gaster
    for (let k = 0; k < 2; k++) {
      QL.setFromAxisAngle(AXZ, aG); QB.multiplyQuaternions(Q, QL);
      const f = -0.12 - k * 0.14;
      ell(BODY, bw(a, gas[0] + Math.cos(aG) * f * qs * 0.6, gas[1] + Math.sin(aG) * f * qs * 0.6, 0, WP[1]), QB, 0.035 * sc, 0.272 * sc * (1 + breath), 0.272 * sc * (1 + breath), a.lid);
    }
  }
  ell(BODY, bw(a, pet[0], pet[1], 0, WP[1]), Q, 0.058 * sc, 0.058 * sc, 0.058 * sc, col);
  QL.setFromAxisAngle(AXZ, aT); QB.multiplyQuaternions(Q, QL);
  ell(BODY, bw(a, tor[0], tor[1], 0, WP[2]), QB, 0.155 * sc, 0.095 * sc, 0.1 * sc, col);
  ell(BODY, bw(a, neck[0], neck[1], 0, WP[3]), Q, 0.048 * sc, 0.048 * sc, 0.048 * sc, col);
  QL.setFromAxisAngle(AXZ, aHd); QH.multiplyQuaternions(Q, QL);
  const headW = bw(a, head[0], head[1], 0, WP[4]);
  ell(BODY, headW, QH, 0.155 * sc * hs, 0.148 * sc * hs, 0.14 * sc * hs, a.hcol);
  a.headW = a.headW || new THREE.Vector3(); a.headW.copy(headW);
  const ch = Math.cos(aHd), sh = Math.sin(aHd);
  const hl = (x, y, z, out) => bw(a, head[0] + (x * ch - y * sh) * hs, head[1] + (x * sh + y * ch) * hs, z * hs, out);
  // look direction (world)
  const look = a.look;
  if (a.lookMode === 'camera' || (a.sacc.x === 9 && a.lookMode !== 'sleep' && !a.dig)) look.subVectors(camPos, headW).normalize();
  else if ((a.lookMode === 'other' && a.lookObj && a.lookObj.headW)) look.subVectors(a.lookObj.headW, headW).normalize();
  else if (a.lookMode === 'queen' && QUEEN && QUEEN.headW) look.subVectors(QUEEN.headW, headW).normalize();
  else {
    look.copy(a.Fv);
    if (a.sacc.x !== 9) look.addScaledVector(a.Uv, a.sacc.y + (a.dig ? -0.5 : 0) + (a.lookMode === 'around' ? 0.2 * Math.sin(t * 0.9 + a.id) : 0)).addScaledVector(a.Sv, a.sacc.z + (a.lookMode === 'around' ? 0.5 * Math.sin(t * 0.6 + a.id * 2) : 0));
    look.normalize();
  }
  wb(a, VA.copy(headW).add(look), BX); BX.sub(wb(a, headW, VB));
  // into head-local space
  let lx = BX.x * ch + BX.y * sh, ly = -BX.x * sh + BX.y * ch, lz = BX.z;
  lx = Math.max(lx, 0.35); const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  // eyes, pupils, lids
  const er = 0.066 * a.eyeS;
  for (const sd of [-1, 1]) {
    const eye = hl(0.095, 0.05, sd * 0.074, WP[5]);
    ell(EYE, eye, QH, er * sc * hs, er * sc * hs, er * sc * hs, COL.eye);
    // pupil: a flat disc on the eyeball, along the look direction (a touch towards the nose for the near target)
    const px = lx, py = ly, pz = lz - sd * 0.06;
    const pl = Math.hypot(px, py, pz);
    VA.set((px * ch - py * sh) / pl, (px * sh + py * ch) / pl, pz / pl); // body space dir
    VB.copy(a.Fv).multiplyScalar(VA.x).addScaledVector(a.Uv, VA.y).addScaledVector(a.Sv, VA.z).normalize();
    WP[6].copy(eye).addScaledVector(VB, er * 0.93 * sc * hs);
    QT.setFromUnitVectors(AXX, VB);
    ell(PUPIL, WP[6], QT, 0.013 * sc * hs, 0.036 * a.pupS * sc * hs * a.eyeS, 0.036 * a.pupS * sc * hs * a.eyeS, COL.pupil);
    const th = lerp(-1.5, 1.62, a.lidC);
    QL.setFromAxisAngle(AXZ, -th + aHd); QB.multiplyQuaternions(Q, QL);
    ell(LID, eye, QB, er * 1.14 * sc * hs, er * 1.14 * sc * hs, er * 1.14 * sc * hs, a.lid);
  }
  // mandibles
  for (const sd of [-1, 1]) {
    hl(0.115, -0.075, sd * 0.045, WP[0]);
    hl(0.2, -0.105, sd * (0.02 + 0.035 * a.mand), WP[1]);
    cyl(LEG, WP[0], WP[1], 0.019 * sc, a.lcol);
    ell(BODY, WP[1], Q, 0.017 * sc, 0.017 * sc, 0.017 * sc, a.lcol);
  }
  // antennae: elbowed, sway with the walk, reach for a target when meeting someone
  for (const sd of [-1, 1]) {
    const base = hl(0.05, 0.125, sd * 0.05, WP[0]);
    const sw = 0.05 * Math.sin(t * 2.1 + a.id + sd) + (a.moving ? 0.04 * Math.sin(a.gait * 6.28 + sd) : 0) + (a.guarding ? 0.08 * Math.sin(t * 4.5 + sd * 2) : 0);
    const droop = a.lookMode === 'sleep' ? 0.12 : 0;
    const elbow = bw(a, head[0] + 0.05 * hs + 0.03 + sw, head[1] + 0.29 - droop, sd * 0.12, WP[1]);
    let tip;
    if (a.antT) {
      wb(a, a.antT, BX);
      const tap = 0.03 * Math.sin(t * 14 + sd * 1.7);
      VA.set(BX.x - (head[0] + 0.05), BX.y - (head[1] + 0.29), 0); const l = VA.length() || 1;
      tip = bw(a, head[0] + 0.08 + sw + VA.x / l * 0.22, head[1] + 0.29 + VA.y / l * 0.22 + tap, sd * 0.1, WP[2]);
    } else {
      const da = -0.15 - droop * 3 + (a.dig ? -0.5 : 0) + 0.12 * Math.sin(t * 1.7 + a.id * 1.3 + sd);
      tip = bw(a, head[0] + 0.08 + sw + Math.cos(da) * 0.22, head[1] + 0.29 - droop + Math.sin(da) * 0.22, sd * 0.16, WP[2]);
    }
    cyl(LEG, base, elbow, 0.015 * sc, a.lcol);
    cyl(LEG, elbow, tip, 0.012 * sc, a.lcol);
    ell(BODY, tip, Q, 0.027 * sc, 0.027 * sc, 0.027 * sc, col);
  }
  // legs: tripod gait (front-left, middle-right, hind-left together), feet planted by distance walked
  const L = [[0.21, 0.30, 0.14, 0.22, 0.26], [0.14, 0.05, 0.2, 0.20, 0.23], [0.06, -0.22, 0.19, 0.22, 0.26]];   // feet tucked in: wider read as spidery
  for (let li = 0; li < 3; li++) for (const sd of [-1, 1]) {
    const [hp, fx, fz, l1, l2] = L[li];
    bw(a, pet[0] + dT[0] * hp, pet[1] + dT[1] * hp - 0.035, sd * 0.062, HIP);
    const grp = (li + (sd > 0 ? 1 : 0)) % 2;
    const q = ((a.gait + grp * 0.5) % 1 + 1) % 1;
    let x = fx, y = 0, z = sd * fz;
    if (a.moving || (a.gait % 1) !== 0) {
      if (q < 0.5) x = fx + 0.065 - 0.13 * (q / 0.5);
      else { const s = (q - 0.5) / 0.5; x = fx - 0.065 + 0.13 * (s * s * (3 - 2 * s)); y = 0.07 * Math.sin(Math.PI * s); }
    }
    if (sit > 0.01) { x = lerp(x, li === 2 ? -0.1 : (li === 1 ? 0.1 : x), sit); z = lerp(z, sd * (fz + 0.03), sit); }
    POLE.set(0, 0.6, sd);
    let lift = 0;
    if (li === 0) { // front legs double as arms
      const arms = Math.max(a.arms, a.stretch);
      if (a.dig > 0) {
        const s = Math.sin(t * 11 + (sd > 0 ? Math.PI : 0));
        x = 0.42 + 0.06 * s; y = 0.05 + 0.06 * Math.max(0, s); z = sd * 0.1;
      } else if (arms > 0.01) {
        const st = a.stretch > a.arms, wig = st ? 0.04 * Math.sin(t * 5 + sd) : 0;
        const hx = st ? 0.1 : 0.34, hy = st ? 0.86 + wig : 0.72 + bob, hz = st ? 0.34 : 0.085;
        x = lerp(x, hx, arms); y = lerp(y, hy, arms); z = lerp(z, sd * hz, arms);
        POLE.set(-0.5 * arms, 0.6 * (1 - arms), sd);
      } else if (a.grooming) { // one front leg up to the antenna on that side, wiping
        if (sd > 0) { const w = Math.sin(t * 7); x = 0.3 + 0.03 * w; y = 0.58 + 0.06 * w; z = 0.1; POLE.set(-0.3, -0.4, 1); }
      } else if (a.cutting) {
        x = 0.4 + 0.04 * Math.sin(t * 9 + sd); y = 0.12; z = sd * 0.09;
      } else if (a.cur && a.cur.a === 'tend') {
        x = 0.36 + 0.03 * Math.sin(t * 3 + sd); y = 0.03; z = sd * 0.08;
      }
      lift = y;
    }
    bw(a, x, y, z, FOOT);
    VA.copy(POLE); POLE.set(0, 0, 0).addScaledVector(a.Fv, VA.x).addScaledVector(a.Uv, VA.y).addScaledVector(a.Sv, VA.z);
    ik(HIP, FOOT, l1 * sc, l2 * sc, POLE, KNEE);
    cyl(LEG, HIP, KNEE, 0.024 * sc, a.lcol);
    cyl(LEG, KNEE, FOOT, 0.018 * sc, a.lcol);
    ell(BODY, KNEE, Q, 0.026 * sc, 0.026 * sc, 0.026 * sc, a.lcol);
    ell(BODY, FOOT, Q, 0.024 * sc, 0.02 * sc, 0.024 * sc, a.lcol);
  }
  // what it carries, held above its head
  if (a.carry && a.arms > 0.3) {
    bw(a, 0.34, 0.8 + bob, 0, WP[7]);
    if (a.carry === 'seed') { QL.setFromAxisAngle(AXY, 0.4); QB.multiplyQuaternions(Q, QL); ell(PROP, WP[7], QB, 0.15 * sc, 0.085 * sc, 0.085 * sc, COL.seed); }
    else if (a.carry === 'egg') ell(PROP, WP[7], Q, 0.08 * sc, 0.06 * sc, 0.06 * sc, COL.egg);
    else if (a.carry === 'leaf') { // held up like a sail, swaying with the walk
      bw(a, 0.22, 0.98 + bob, 0, WP[7]);
      QL.setFromEuler(EU.set(Math.PI / 2 + 0.25 * Math.sin(t * 3 + a.id), 0, 1.0 + 0.08 * Math.sin(a.gait * 6.28))); QB.multiplyQuaternions(Q, QL);
      ell(LEAFB, WP[7], QB, 0.36 * sc, 0.02 * sc, 0.26 * sc, a.leafHue ? LEAFC[a.leafHue % LEAFC.length] : COL.leaf);
    }
    else if (a.carry === 'husk') ell(PROP, WP[7], Q, 0.1 * sc, 0.05 * sc, 0.07 * sc, COL.husk);
    else ell(PROP, WP[7], Q, 0.11 * sc, 0.1 * sc, 0.1 * sc, COL.crumb);
  }
  // soft shadow on the floor
  VA.crossVectors(a.Uv, a.Fv);
  M3.makeBasis(a.Fv, VA, a.Uv); QT.setFromRotationMatrix(M3);
  VB.copy(a.P).addScaledVector(a.Uv, 0.012);
  ell(SHADOW, VB, QT, 0.95 * sc * (a.queen ? 1.6 : 1), 0.55 * sc, 1, COL.black);
}

// ---------------------------------------------------------------- the meadow: plants, leaves, stones, visitors
let PLANTS = [], ROCKS = [], FALLING = [], VISIT = null, nextVisit = 0;
function buildMeadow() {
  const rnd = mulberry(F.seed ^ 0x9e37);
  PLANTS = []; ROCKS = [];
  const kinds = [...Array(9).fill('clover'), ...Array(5).fill('sprout'), ...Array(3).fill('daisy')];
  for (const kind of kinds) {
    for (let t = 0; t < 60; t++) {
      const x = EX + (rnd() - 0.5) * 22, z = kind === 'daisy' ? -2.6 - rnd() * 1.4 : -1.2 - rnd() * 0.4;
      if (Math.abs(x - EX) < 1.7 || Math.hypot(x - HX, z - HZ) < 1.8 || Math.abs(x - SEEDX) < 1.0) continue;
      if (PLANTS.some(q => Math.abs(q.x - x) < (q.kind === 'daisy' || kind === 'daisy' ? 0.5 : 0.95))) continue;
      const stems = kind === 'clover' ? 1 + Math.floor(rnd() * 2) : 1;
      const max = kind === 'clover' ? 3 * stems : kind === 'sprout' ? 2 : 3;
      PLANTS.push({ x, z, kind, stems, max, n: max, h: kind === 'daisy' ? 1.8 + rnd() * 0.8 : kind === 'clover' ? 0.8 + rnd() * 0.45 : 0.6 + rnd() * 0.25,
        a: rnd() * 6.28, ph: rnd() * 6 });
      break;
    }
  }
  if (F.pl && F.pl.length === PLANTS.length) PLANTS.forEach((q, i) => { q.n = clamp(F.pl[i] | 0, 0, q.max); });
  for (let i = 0; i < 9; i++) {
    const x = EX + (rnd() - 0.5) * 24, z = -1.3 - rnd() * 2.5;
    if (Math.abs(x - EX) < 1.5 || Math.hypot(x - HX, z - HZ) < 1.8) continue;
    ROCKS.push({ kind: i < 7 ? 'pebble' : 'twig', x, z, r: 0.12 + rnd() * 0.16, a: rnd() * 6.28, c: rnd() < 0.5 });
  }
  if (!F.fleaves) { F.fleaves = []; for (let i = 0; i < 3; i++) { const f = newFalling(); F.fleaves.push({ x: f.x, z: f.z, a: f.a, c: f.c, bites: 0 }); } }
  F.fleaves.forEach(f => { f.res = false; });
}
function newFalling() { return { x: EX + rr(-9, 9), y: 9 + rr(0, 3), z: rr(-1.15, -2.2), ph: R() * 6, c: 1 + Math.floor(R() * 4), a: R() * 6.28, spin: rr(0.6, 1.4) }; }
// a visitor wanders across the meadow now and then: a ladybird, a beetle or a caterpillar
function updateVisitor(dt) {
  const now = simNow();
  if (!VISIT) {
    if (!nextVisit) nextVisit = now + rr(1, 3) * 60e3;
    if (now < nextVisit && !Q.get('visitor')) return;
    const kind = Q.get('visitor') || pick(['ladybird', 'ladybird', 'beetle', 'caterpillar']);
    const dir = R() < 0.5 ? 1 : -1;
    VISIT = { kind, dir, x: EX - dir * 14, z: -1.95, spd: kind === 'caterpillar' ? 0.16 : kind === 'beetle' ? 0.42 : 0.32, gait: 0, awake: true,
      P: new THREE.Vector3(), t: 0 };
  }
  const v = VISIT;
  v.t += dt;
  const pause = v.kind === 'ladybird' && Math.sin(v.t * 0.21) > 0.85;   // a ladybird stops now and then
  if (!pause) { v.x += v.dir * v.spd * dt; v.gait += v.spd * dt / 0.12; }
  v.P.set(v.x, groundY(v.x, v.z), v.z);
  if (Math.abs(v.x - EX) > 15) { v.awake = false; VISIT = null; nextVisit = now + rr(4, 9) * 60e3 * (U.uNight.value > 0.5 ? 2 : 1); }
}
function drawMeadow(dt) {
  const t = clockS;
  for (const q of PLANTS) {
    const g = groundY(q.x, q.z), sway = 0.06 * Math.sin(t * 0.9 + q.ph), sway2 = 0.04 * Math.sin(t * 1.7 + q.ph * 2);
    if (q.kind === 'clover') {
      let left = q.n;
      for (let st = 0; st < q.stems; st++) {
        const ox = (st - (q.stems - 1) / 2) * 0.32, h = q.h * (1 - 0.18 * st);
        VA.set(q.x + ox, g, q.z); VB.set(q.x + ox + sway, g + h, q.z + sway2);
        cyl(LEG, VA, VB, 0.025, COL.stem);
        for (let k = 0; k < 3; k++) {
          if (left <= 0) break; left--;
          const ang = q.a + st + k * 2.094;
          WP[0].set(VB.x + Math.cos(ang) * 0.21, VB.y + 0.03, VB.z + Math.sin(ang) * 0.21);
          QL.setFromEuler(EU.set(0.25 * Math.sin(ang), -ang, 0.25 * Math.cos(ang)));
          ell(LEAFB, WP[0], QL, 0.24, 0.02, 0.2, k === 1 ? COL.leafD : COL.leaf);
        }
      }
    } else if (q.kind === 'sprout') {
      VA.set(q.x, g, q.z); VB.set(q.x + sway, g + q.h, q.z);
      cyl(LEG, VA, VB, 0.022, COL.stem);
      for (let k = 0; k < q.n; k++) {
        const sd = k ? 1 : -1;
        WP[0].set(VB.x + sd * 0.2, VB.y + 0.06, VB.z);
        QL.setFromEuler(EU.set(0, q.a, sd * 0.45)); ell(LEAFB, WP[0], QL, 0.24, 0.02, 0.13, COL.leaf);
      }
    } else { // a daisy: a white flower nodding on its stem, its leaves at the foot
      VA.set(q.x, g, q.z); VB.set(q.x + sway * 2.2, g + q.h, q.z + sway2);
      cyl(LEG, VA, VB, 0.03, COL.stem);
      for (let k = 0; k < q.n; k++) {
        const ang = q.a + k * 2.1;
        WP[0].set(q.x + Math.cos(ang) * 0.22, g + 0.05, q.z + Math.sin(ang) * 0.22);
        QL.setFromEuler(EU.set(0, -ang, 0.2)); ell(LEAFB, WP[0], QL, 0.26, 0.02, 0.09, COL.leafD);
      }
      QT.setFromEuler(EU.set(1.1 + sway2, 0, sway));  // the flower faces up and out
      for (let k = 0; k < 13; k++) {
        const ang = k * 0.4833;
        VC.set(Math.cos(ang) * 0.19, 0, Math.sin(ang) * 0.19).applyQuaternion(QT).add(VB);
        QL.setFromEuler(EU.set(0, -ang, 0)); QB.multiplyQuaternions(QT, QL);
        ell(LEAFB, VC, QB, 0.16, 0.015, 0.05, COL.petal);
      }
      ell(BODY, VB, QT, 0.085, 0.04, 0.085, COL.yolk);
    }
  }
  for (const r of ROCKS) {
    const g = groundY(r.x, r.z);
    if (r.kind === 'pebble') { WP[0].set(r.x, g + r.r * 0.35, r.z); QL.setFromEuler(EU.set(0, r.a, 0.2)); ell(PROP, WP[0], QL, r.r * 1.3, r.r * 0.75, r.r, r.c ? COL.pebble : COL.pebble2); }
    else { VA.set(r.x - Math.cos(r.a) * 0.9, g + 0.04, r.z - Math.sin(r.a) * 0.3); VB.set(r.x + Math.cos(r.a) * 0.9, g + 0.05, r.z + Math.sin(r.a) * 0.3); cyl(LEG, VA, VB, 0.045, COL.twig); }
  }
  // fallen leaves, nibbled smaller by the ants
  for (const f of F.fleaves) {
    const k = 1 - 0.18 * (f.bites || 0);
    WP[0].set(f.x, groundY(f.x, f.z) + 0.03, f.z); QL.setFromEuler(EU.set(0.08, f.a, 0.06));
    ell(LEAFB, WP[0], QL, 0.7 * k, 0.02, 0.36 * k, LEAFC[f.c % LEAFC.length]);
  }
  // a leaf coming down, rocking from side to side
  for (let i = FALLING.length - 1; i >= 0; i--) {
    const f = FALLING[i];
    f.y -= 0.55 * dt; f.x += Math.sin(t * 1.3 + f.ph) * 0.5 * dt;
    const gy = groundY(f.x, f.z) + 0.03;
    if (f.y <= gy) { F.fleaves.push({ x: f.x, z: f.z, a: f.a, c: f.c, bites: 0 }); FALLING.splice(i, 1); continue; }
    WP[0].set(f.x, f.y, f.z); QL.setFromEuler(EU.set(0.6 * Math.sin(t * 1.3 * f.spin + f.ph), f.a + t * 0.3, 0.4 * Math.cos(t * f.spin + f.ph)));
    ell(LEAFB, WP[0], QL, 0.6, 0.02, 0.3, LEAFC[f.c % LEAFC.length]);
  }
  if (VISIT) drawVisitor(VISIT);
}
const VQ = new THREE.Quaternion();
function drawVisitor(v) {
  const t = clockS, d = v.dir, P = v.P;
  VQ.setFromAxisAngle(AXY, d > 0 ? 0 : Math.PI);   // facing its way along x
  const W = (x, y, z, out) => out.set(x * d, y, z * d).add(P);
  if (v.kind === 'caterpillar') { // a chain of plump segments with a hump travelling along it (W already scales nothing: sizes as drawn)
    for (let k = 8; k >= 0; k--) {
      const hump = Math.max(0, Math.sin(v.gait * 0.5 - k * 0.8)) * 0.1;
      W(-k * 0.17, 0.13 + hump, 0, WP[0]);
      ell(BODY, WP[0], VQ, 0.13, 0.13 - (k === 8 ? 0.03 : 0), 0.13, k % 2 ? COL.cater : COL.cater2);
    }
    W(0.12, 0.2, 0, WP[1]); ell(BODY, WP[1], VQ, 0.15, 0.15, 0.15, COL.cater);
    for (const sd of [-1, 1]) {
      W(0.22, 0.26, sd * 0.07, WP[2]); ell(EYE, WP[2], VQ, 0.05, 0.05, 0.05, COL.eye);
      W(0.265, 0.265, sd * 0.07, WP[3]); ell(PUPIL, WP[3], VQ, 0.02, 0.028, 0.028, COL.pupil);
      W(0.12, 0.33, sd * 0.05, WP[4]); W(0.15, 0.45, sd * 0.09, WP[5]); cyl(LEG, WP[4], WP[5], 0.012, COL.black); ell(BODY, WP[5], VQ, 0.025, 0.025, 0.025, COL.cater2);
    }
    return;
  }
  const lady = v.kind === 'ladybird', L = lady ? 1 : 1.25, K = 1.45;   // visitors drawn a size up from the ants' scale
  const W0 = W; const W2 = (x, y, z, out) => W0(x * K, y * K, z * K, out);
  // shell, head, eyes
  W2(0, 0.17, 0, WP[0]); ell(BODY, WP[0], VQ, (0.26 * L) * K, (0.17) * K, (0.21) * K, lady ? COL.lady : COL.beetle);
  W2(0.27 * L, 0.12, 0, WP[1]); ell(BODY, WP[1], VQ, (0.1) * K, (0.09) * K, (0.11) * K, COL.black);
  for (const sd of [-1, 1]) {
    W2(0.33 * L, 0.15, sd * 0.05, WP[2]); ell(EYE, WP[2], VQ, (0.035) * K, (0.035) * K, (0.035) * K, COL.eye);
    W2(0.36 * L, 0.152, sd * 0.05, WP[3]); ell(PUPIL, WP[3], VQ, (0.012) * K, (0.018) * K, (0.018) * K, COL.pupil);
    W2(0.34 * L, 0.17, sd * 0.04, WP[4]); W2(0.44 * L, 0.27, sd * 0.09, WP[5]); cyl(LEG, WP[4], WP[5], 0.01 * K, COL.black);
  }
  if (lady) { // spots, and the line down the middle of the wing cases
    const SP7 = [[0.35, 0.55, 0.45], [0.35, -0.55, 0.45], [-0.15, 0.7, 0.4], [-0.15, -0.7, 0.4], [-0.55, 0.35, 0.5], [-0.55, -0.35, 0.5], [0.1, 0.25, 0.85], [0.1, -0.25, 0.85]];
    for (const [sx, sz, sy] of SP7) { // on the shell's surface, flattened against it
      const l = Math.hypot(sx, sy, sz) / 1.03;
      W2(sx / l * 0.26, 0.17 + sy / l * 0.17, sz / l * 0.21, WP[2]);
      VC.set(sx / l / 0.26, sy / l / 0.17, sz / l / 0.21 * d).normalize(); VC.x *= d; QT.setFromUnitVectors(AXY, VC);
      ell(PROP, WP[2], QT, 0.055 * K, 0.018 * K, 0.055 * K, COL.black);
    }
  } else { W2(0, 0.33, 0, WP[2]); ell(BODY, WP[2], VQ, (0.2 * L) * K, (0.012) * K, (0.012) * K, COL.black); }
  // six little legs on a tripod gait
  for (let li = 0; li < 3; li++) for (const sd of [-1, 1]) {
    const ph = v.gait + ((li + (sd > 0 ? 1 : 0)) % 2) * Math.PI, lx = (0.14 - li * 0.14) * L;
    W2(lx, 0.08, sd * 0.12, WP[3]);
    W2(lx + 0.05 * Math.cos(ph), 0.0 + 0.03 * Math.max(0, Math.sin(ph)), sd * 0.24, WP[4]);
    cyl(LEG, WP[3], WP[4], 0.014 * K, COL.black);
  }
}

// ---------------------------------------------------------------- still things: stores, brood, mound, meadow seeds
function drawProps(dt) {
  drawMeadow(dt);
  // the seed heads above the meadow seed patch
  const stemBase = VA.set(SEEDX, groundY(SEEDX, -2.3), -2.3), top = VB.set(SEEDX - SIDE * 0.6, stemBase.y + 4.2, -2.3);
  cyl(LEG, stemBase, top, 0.05, COL.stem);
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4, r = 0.18 + 0.02 * (i % 3);
    WP[0].set(top.x + Math.cos(a) * r - SIDE * 0.15, top.y - 0.15 - i * 0.06 + 0.03 * Math.sin(clockS * 1.1 + i), top.z + Math.sin(a) * r);
    QL.setFromAxisAngle(AXZ, 1.2 + 0.2 * Math.cos(a)); ell(PROP, WP[0], QL, 0.17, 0.08, 0.08, i % 2 ? COL.seed : COL.seed2);
  }
  for (const s of F.sseeds) {
    WP[0].set(s.x, groundY(s.x, s.z) + 0.05, s.z); QL.setFromAxisAngle(AXY, s.a);
    ell(PROP, WP[0], QL, 0.15, 0.075, 0.08, s.c ? COL.seed : COL.seed2);
  }
  // the spoil mound by the entrance
  const nm = Math.min(F.mound, 260);
  for (let i = 0; i < nm; i++) {
    const u = hash(i, 1, F.seed), v = hash(i, 2, F.seed), ang = u * 6.283, rad = Math.sqrt(v) * 1.15;
    const x = HX + Math.cos(ang) * rad * 1.05, z = HZ + Math.sin(ang) * rad * 0.9;
    if (z > -0.15) continue;
    WP[0].set(x, groundY(x, z) + 0.02, z); const r = 0.05 + 0.04 * hash(i, 3, F.seed);
    ell(PROP, WP[0], QL.identity(), r, r * 0.85, r, i % 3 ? COL.crumb : COL.crumb2);
  }
  // granary seed piles, brood, the queen's fresh eggs
  const store = (role, count, fill) => {
    const cs = chNodes(role); if (!cs.length) return;
    for (let i = 0; i < count; i++) {
      const ci = cs[i % cs.length], s = 0.62 + 0.33 * hash(i, 5, F.seed);
      const z = -0.22 - 0.85 * hash(i, 6, F.seed);
      contact(N[chAt(ci, s)], z, CA);
      const layer = Math.floor(i / (cs.length * 14));
      fill(i, CA.x + (hash(i, 7, F.seed) - 0.5) * 0.12, CA.y + 0.045 + layer * 0.07, CA.z);
    }
  };
  store('granary', Math.min(F.granary, 90), (i, x, y, z) => { WP[0].set(x, y, z); QL.setFromAxisAngle(AXY, hash(i, 8, 1) * 6.28); ell(PROP, WP[0], QL, 0.14, 0.075, 0.075, i % 3 ? COL.seed : COL.seed2); });
  store('brood', Math.min(F.brood, 34), (i, x, y, z) => {
    WP[0].set(x, y, z);
    if (i % 3 === 0) { // a larva: a curled grub of three beads, wriggling slowly
      for (let k = 0; k < 3; k++) { const a = k * 0.9 + 0.15 * Math.sin(clockS * 1.5 + i); WP[1].set(x + Math.cos(a) * 0.07, y + 0.02 + Math.sin(a) * 0.05, z); ell(PROP, WP[1], QL.identity(), 0.06 - k * 0.01, 0.055 - k * 0.01, 0.055, COL.larva); }
    } else { QL.setFromAxisAngle(AXY, i); ell(PROP, WP[0], QL, 0.075, 0.055, 0.055, COL.egg); }
  });
  store('garden', Math.min(F.leafstore, 90), (i, x, y, z) => {
    WP[0].set(x, y - 0.02, z);
    if (i % 4 === 3) ell(PROP, WP[0], QL.identity(), 0.07, 0.06, 0.07, COL.fungus);   // the white fungus they farm on the leaves
    else { QL.setFromEuler(EU.set(0.3 * hash(i, 9, 2), hash(i, 8, 3) * 6.28, 0.2)); ell(LEAFB, WP[0], QL, 0.16, 0.02, 0.12, i % 3 ? COL.leaf : COL.leafD); }
  });
  store('midden', Math.min(F.midden, 90), (i, x, y, z) => { WP[0].set(x, y - 0.02, z); QL.setFromAxisAngle(AXY, i); ell(PROP, WP[0], QL, 0.08, 0.04, 0.06, i % 2 ? COL.rubbish : COL.husk); });
  const qch = chNodes('queen');
  if (qch.length) for (let i = 0; i < Math.min(F.qeggs, 5); i++) {
    contact(N[chAt(qch[0], 0.88 + i * 0.025)], -0.3 - (i % 2) * 0.12, CA);
    WP[0].set(CA.x, CA.y + 0.05, CA.z); ell(PROP, WP[0], QL.identity(), 0.075, 0.055, 0.055, COL.egg);
  }
  // crumbs in the air
  for (let i = CRUMBS.length - 1; i >= 0; i--) {
    const c = CRUMBS[i]; c.life -= dt; if (c.life <= 0) { CRUMBS.splice(i, 1); continue; }
    c.vy -= 4 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
    WP[0].set(c.x, c.y, c.z); ell(PROP, WP[0], QL.identity(), c.r, c.r * (c.green ? 0.4 : 1), c.r, c.green ? COL.leaf : COL.crumb2);
  }
}

// ---------------------------------------------------------------- camera: a slow documentary between busy places
const cam = { x: 0, y: -2, w: 7 * ZOOM, from: null, shot: null, t: 0, hold: 0, trans: 0, last: '' };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function chamberShot(role, w) { const c = chNodes(role); if (!c.length) return null; const n = N[chAt(c[0], 0.5)]; return { x: n.cx, y: n.cy + 0.25, w }; }
function newShot() {
  const order = ['entrance', 'meadow', 'follow', 'queen', 'close', 'dig', 'meadow', 'follow', 'granary', 'brood', 'wide', 'rest', 'close', 'follow', 'dig', 'queen', 'entrance', 'meadow'];
  for (let k = 0; k < 20; k++) {
    const kind = FORCE_SHOT || (k < 3 ? order[(cam.idx = ((cam.idx || 0) + 1) % order.length)] : pick(order));
    if (kind === cam.last && !FORCE_SHOT && k < 19) continue;
    let s = null;
    if (kind === 'entrance') s = { x: EX + SIDE * 0.9, y: -2.6, w: 6.8 };
    else if (kind === 'meadow') {
      if (VISIT && Math.abs(VISIT.x - EX) < 9) s = { follow: VISIT, x: VISIT.x, y: 0.6, w: 5.2, meadow: true, tilt: 3.2 };
      else { const q = pick(PLANTS.length ? PLANTS : [{ x: EX }]); s = { x: q.x, y: 0.9, w: 6.0, tilt: 3.2 }; }
    }
    else if (kind === 'queen' || kind === 'granary' || kind === 'brood') s = chamberShot(kind, 5.6);
    else if (kind === 'rest') s = chamberShot('rest', 6.2);
    else if (kind === 'dig') { if (FRONT.length) { const f = N[FRONT[FRONT.length - 1].node]; s = { x: f.cx, y: f.cy + 0.3, w: 5.4 }; } }
    else if (kind === 'close') { // someone up close: an ant taking a break, digging or feeding the queen
      const c = ants.filter(a => !a.queen && a.cur && (a.cur.a === 'break' || a.cur.a === 'dig' || a.cur.a === 'feed') && clockS - a.cur.t0 < 3);
      if (c.length) { const a = pick(c); s = { follow: a, x: a.P.x, y: a.P.y, w: 3.0, close: true }; }
    }
    else if (kind === 'follow') {
      const c = ants.filter(a => !a.queen && a.awake && (a.carry || a.task === 'dig' || a.task === 'forage'));
      if (c.length) { const a = pick(c); s = { follow: a, x: a.P.x, y: a.P.y, w: 4.9 }; }
    } else if (kind === 'wide') {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9;
      for (let i = S0; i < N.length; i++) if (open(i)) { x0 = Math.min(x0, N[i].cx); x1 = Math.max(x1, N[i].cx); y0 = Math.min(y0, N[i].cy); }
      const w = clamp(Math.max(x1 - x0 + 4, (0.4 - y0 + 3) * camera.aspect), 6.5 * ZOOM, 16.5); // already at screen width
      s = { x: (x0 + x1) / 2, y: 1.6 - w / camera.aspect / 2, w: w / ZOOM };
    }
    if (!s) continue;
    s.kind = kind;
    s.hold = kind === 'wide' ? 15 : kind === 'follow' ? 26 : kind === 'close' ? 12 : rr(22, 32);
    return s;
  }
  return { kind: 'entrance', x: EX, y: -2.6, w: 6.8, hold: 20 };
}
function shotTarget(s, out) {
  if (s.follow) { const a = s.follow; s.fx = lerp(s.fx === undefined ? a.P.x : s.fx, a.P.x, 0.03); s.fy = lerp(s.fy === undefined ? a.P.y : s.fy, a.P.y, 0.03); out.x = s.fx; out.y = s.fy + (s.meadow ? 0.9 : s.close ? 0.35 : 0.4); }
  else { out.x = s.x; out.y = s.y; }
  out.w = s.w * ZOOM;
  return out;
}
const TG = { x: 0, y: 0, w: 0 };
function updateCamera(dt) {
  if (!cam.shot) { cam.shot = newShot(); const t = shotTarget(cam.shot, TG); cam.x = t.x; cam.y = t.y; cam.w = t.w; cam.from = { x: t.x, y: t.y, w: t.w }; cam.t = 99; }
  cam.t += dt;
  const s = cam.shot, T = shotTarget(s, TG);
  const tt = clamp(cam.t / 7, 0, 1), e = ease(tt);
  const hf = clamp((cam.t - 7) / s.hold, 0, 1);
  const w = lerp(cam.from.w, T.w, e) * (1 - 0.06 * hf) * (1 + 0.12 * Math.sin(Math.PI * tt) * (Math.abs(cam.from.x - T.x) + Math.abs(cam.from.y - T.y) > 6 ? 1 : 0));
  cam.x = lerp(cam.from.x, T.x, e); cam.y = lerp(cam.from.y, T.y, e); cam.w = w;
  cam.tilt = lerp(cam.from.tilt || 0, s.tilt || 0, e);
  if (cam.t > 7 + s.hold || (s.follow && !s.follow.awake)) { cam.last = s.kind; cam.from = { x: cam.x, y: cam.y, w: cam.w, tilt: cam.tilt }; cam.shot = newShot(); cam.t = 0; }
  const h = cam.w / camera.aspect;
  let y = Math.min(cam.y, 7.5 - h / 2);
  y = Math.max(y, NY0 - 2 + h / 2);
  const dist = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tz = clockS;
  camPos.set(cam.x + 0.35 * Math.sin(tz * 0.05), y + 1.1 + (cam.tilt || 0) + 0.25 * Math.sin(tz * 0.037), dist - 0.6);
  camera.position.copy(camPos);
  camera.lookAt(cam.x + 0.1 * Math.sin(tz * 0.031), y, -0.6);
  U.uLamp.value.set(cam.x - 0.6, y + 0.8, Math.max(3.2, cam.w * 0.75));
}

// ---------------------------------------------------------------- day and night (the real clock)
function lightFor(hour) {
  const day = sstep(5.5, 8.5, hour) * (1 - sstep(17.5, 20.5, hour));
  const gold = Math.max(0, 1 - Math.abs(hour - 17.5) / 2.2) * day + Math.max(0, 1 - Math.abs(hour - 7.8) / 1.6) * day * 0.6;
  const night = 1 - day;
  U.uNight.value = night;
  const keyCol = new THREE.Color().setRGB(1.0, 0.88 - 0.12 * gold, 0.70 - 0.2 * gold, THREE.SRGBColorSpace).lerp(new THREE.Color().setRGB(1.0, 0.72, 0.45, THREE.SRGBColorSpace), night * 0.7);
  key.color.copy(keyCol); key.intensity = lerp(2.7, 1.9, night);
  rim.intensity = lerp(1.1, 0.7, night); rim.color.setRGB(0.62, 0.74, 1.0, THREE.SRGBColorSpace);
  hemi.intensity = lerp(0.85, 0.55, night);
  hemi.color.setRGB(0.76, 0.84, 1.0, THREE.SRGBColorSpace).lerp(new THREE.Color().setRGB(0.35, 0.42, 0.7, THREE.SRGBColorSpace), night);
  U.uKeyDir.value.copy(key.position).normalize();
  U.uKeyCol.value.copy(key.color).multiplyScalar(key.intensity * 0.55);
  U.uSkyAmb.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.42);
  U.uGndAmb.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity * 0.42);
  const hz = new THREE.Color().setRGB(1.0, 0.86 - 0.1 * gold, 0.62 - 0.15 * gold, THREE.SRGBColorSpace), ze = new THREE.Color().setRGB(0.44, 0.64, 0.92, THREE.SRGBColorSpace);
  U.uHorizon.value.copy(hz).lerp(new THREE.Color().setRGB(0.10, 0.10, 0.20, THREE.SRGBColorSpace), night);
  U.uZenith.value.copy(ze).lerp(new THREE.Color().setRGB(0.02, 0.03, 0.09, THREE.SRGBColorSpace), night);
}
const HOUR = Q.has('hour') ? qn('hour', 15) : null;
function hourNow() { if (HOUR !== null) return HOUR; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

// ---------------------------------------------------------------- vignette (a soft lens falloff)
const post = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: 'varying vec2 vU; void main(){ vec2 d = (vU - 0.5)*vec2(1.0, 1.25); float a = smoothstep(0.32, 0.82, length(d)); gl_FragColor = vec4(0.03, 0.015, 0.0, a*0.62); }' })));

// ---------------------------------------------------------------- colony life over time
function lifeTick(dt) {
  const now = simNow();
  // digging moves the nest on; a slow floor keeps it growing when few dig
  const nDig = ants.filter(a => a.dig).length;
  if (F.prog < 1) {
    const before = F.prog;
    F.prog = Math.min(1, F.prog + dt * (0.35 + 0.65 * Math.min(1, nDig / 3)) / GROW_S * qn('speed', 1));
    if (F.prog >= 1 && before < 1) F.full = now;
  }
  if (F.qeggs < 4 && now - F.lastLay > (F.workers < 14 ? 3 : 6) * 60e3) { F.qeggs++; F.lastLay = now; }
  // a young colony hatches a new worker every 12 minutes, an established one every 35
  if (F.brood > 0 && now - F.lastHatch > (F.workers < 14 ? 12 : 35) * 60e3) {
    F.lastHatch = now; F.brood--;
    if (F.workers < 48) {
      F.workers++;
      const b = chNodes('brood'), a = new Ant(ants.length, false);
      a.place(b.length ? chAt(b[0], 0.5) : chAt(0, 0.2)); a.place3D(); ants.push(a);
    }
  }
  if (now - F.lastEat > 12 * 60e3) { F.lastEat = now; F.granary = Math.max(0, F.granary - 2); F.leafstore = Math.max(0, F.leafstore - 1); F.husks = (F.husks || 0) + 2; }
  if (F.sseeds.length < 12 && R() < dt / 25) F.sseeds.push(newSeed());
  // plants grow their leaves back; now and then a leaf falls from above
  if (R() < dt / 40) { const pl = PLANTS.filter(q => q.n < q.max); if (pl.length) pick(pl).n++; }
  if (F.fleaves.length < 6 && R() < dt / 200 && !FALLING.length) FALLING.push(newFalling());
  F.trail = Math.min(1, F.trail + dt * 0.00002 * ants.filter(a => a.moving && N[a.at()].kind === 'S').length);
  updateVisitor(dt);
}
function newSeed() { const z = R() < 0.5 ? LANE[0] - 0.05 : LANE[1] + 0.05; return { x: SEEDX + rr(-1.3, 1.3), z, a: R() * 6.28, c: R() < 0.5 }; }
let wakeT = 0;
function manageSleep(dt) {
  wakeT -= dt; if (wakeT > 0) return; wakeT = 2;
  const work = ants.filter(a => !a.queen);
  const want = Math.round(work.length * (0.3 + 0.65 * heat));
  const awake = work.filter(a => a.awake && !a.tired);
  if (awake.length < want) { const s = work.filter(a => !a.awake); if (s.length) pick(s).wake(); }
  else if (awake.length > want + 1) { const c = awake.filter(a => !a.carry); if (c.length) pick(c).tired = true; }
}

// ---------------------------------------------------------------- persistence and load
const STATE_URL = '/state?name=ant-colony';
function save() {
  if (FRESH || CAPTURE) return;
  F.saved = Date.now();
  const body = JSON.stringify(Object.assign({}, F, { sseeds: F.sseeds.map(s => ({ x: s.x, z: s.z, a: s.a, c: s.c })),
    fleaves: F.fleaves.map(f => ({ x: f.x, z: f.z, a: f.a, c: f.c, bites: f.bites || 0 })), pl: PLANTS.map(q => q.n) }));
  try { localStorage.setItem('antcolony', body); } catch (e) { /* full or blocked */ }
  fetch(STATE_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
}
async function load() {
  const ok = f => f && f.v === 1 && f.kind === 'ant-colony' && typeof f.prog === 'number' ? f : null;
  try { const r = await fetch(STATE_URL, { cache: 'no-store' }); if (r.ok) { const f = ok(await r.json()); if (f) return f; } } catch (e) { /* no server state */ }
  try { return ok(JSON.parse(localStorage.getItem('antcolony'))); } catch (e) { return null; }
}
async function poll() {
  if (Q.has('heat')) return;
  if (Q.get('demo') === '1') { heatT = 0.5 + 0.5 * Math.sin(clockS / 20); return; }
  try { const j = await (await fetch('/load.json', { cache: 'no-store' })).json(); if (typeof j.heat === 'number') { heatT = clamp(j.heat, 0, 1); poll.ok = performance.now(); } }
  catch (e) { if (!poll.ok) heatT = 0.45 + 0.25 * Math.sin(performance.now() / 95000); }   // no server: a rhythm of its own
}

// ---------------------------------------------------------------- frame
function step(dt) {
  clockS += dt;
  U.uTime.value = clockS;
  if (Q.get('demo') === '1') heatT = 0.5 + 0.5 * Math.sin(clockS / 20);
  heat += (heatT - heat) * (1 - Math.exp(-dt / 8));
  lifeTick(dt);
  digUpTo(F.prog);
  if (carveDirty && (CAPTURE || (clockS - (step.lastUp || 0)) > 0.5)) { carveTex.needsUpdate = true; carveDirty = false; step.lastUp = clockS; frontier(); }
  manageSleep(dt);
  U.uHeap.value.set(HX, HZ, 0, heapH()); U.uTrail.value = F.trail;
  for (const a of ants) a.update(dt);
  updateCamera(dt);
}
function draw(dt) {
  for (const b of [BODY, LEG, EYE, PUPIL, LID, PROP, SHADOW, LEAFB]) b.begin();
  for (const a of ants) poseAnt(a);
  drawProps(dt);
  for (const b of [BODY, LEG, EYE, PUPIL, LID, PROP, SHADOW, LEAFB]) b.end();
  renderer.clear();
  renderer.render(scene, camera);
  renderer.render(post, postCam);
}

async function main() {
  F = FRESH ? null : await load();
  if (!F || (F.full && Date.now() - F.full > 3 * 864e5)) F = newFarm(FRESH && Q.has('seed') ? qn('seed', 1) | 0 : (Math.random() * 1e9) | 0);
  for (let k = 0; ; k++) {
    try { makePlan(F.seed); if (CH[0].role === 'queen' && (planOK() || (k > 60 && CH.length >= 3))) break; } catch (e) { if (k > 80) throw e; }
    F.seed = (F.seed + 7919) | 0;
  }
  if (F.prog < 0) F.prog = Math.min(0.6, (P[CH[0].i1].rp + 1) / TOTAL);   // a founding colony: just the queen's room
  for (const [k, v] of Object.entries({ leafstore: 0, midden: 0, trail: 0, husks: 0 })) if (typeof F[k] !== 'number') F[k] = v;
  // catch up the time the screen was off (at the slow pace)
  if (!FRESH && F.saved) F.prog = Math.min(1, F.prog + Math.max(0, Date.now() - F.saved) / 1000 * 0.35 / GROW_S);
  buildGraph();
  DIG_ORDER = P.map((p, i) => i).sort((a, b) => P[a].rp - P[b].rp);
  digUpTo(F.prog); carveTex.needsUpdate = true; frontier();
  U.uSP.value.set(SP[0], SP[1]); U.uEx.value.set(EX, 0);
  if (!F.sseeds) { F.sseeds = []; for (let i = 0; i < 10; i++) F.sseeds.push(newSeed()); }
  buildGround(); buildMeadow(); buildGrass(F.seed);
  lightFor(hourNow());
  QUEEN = new Ant(999, true); QUEEN.place(chAt(0, 0.6)); QUEEN.z = -0.8; ants.push(QUEEN);
  const openNodes = []; for (let i = S0; i < N.length; i++) if (open(i)) openNodes.push(i);
  for (let i = 0; i < F.workers; i++) {
    const a = new Ant(i, false);
    a.awake = R() < 0.3 + 0.65 * heat;
    a.place(a.awake ? (R() < 0.3 ? surfNode(EX + rr(-5, 5)) : pick(openNodes)) : pick(openNodes));
    ants.push(a);
  }
  for (const a of ants) a.place3D();
  poll(); if (!CAPTURE) setInterval(poll, 2000);
  if (!CAPTURE) { setInterval(save, 120e3); setInterval(() => lightFor(hourNow()), 60e3); }
  // a few seconds of life before the first frame, so nobody starts mid-air
  for (let i = 0; i < 90; i++) step(1 / 30);
  draw(0);
  renderer.domElement.classList.add('on');
  window.__colony = {
    F, ants, N, P, CH, cam, FRONT: () => FRONT,
    stats: () => ({ prog: +F.prog.toFixed(3), workers: F.workers, awake: ants.filter(a => a.awake && !a.queen).length, heat: +heat.toFixed(2),
      tasks: ants.reduce((m, a) => { m[a.task || '-'] = (m[a.task || '-'] || 0) + 1; return m; }, {}), shot: cam.shot && cam.shot.kind,
      chambers: CH.map(c => c.role), points: P.length, frontier: FRONT.length, gl: BODY.n + LEG.n + EYE.n + PUPIL.n + LID.n + PROP.n }),
    shot: k => { const s = newShotOf(k); if (s) { cam.from = { x: cam.x, y: cam.y, w: cam.w }; cam.shot = s; cam.t = 7; } return !!s; },
    // test hook: the awake ant nearest the middle of the frame stops for a break
    brk: () => {
      const c = ants.filter(a => !a.queen && a.awake && !a.carry && !a.greet && N[a.at()].kind === 'C' && N[a.at()].ch > 0)
        .sort((a, b) => Math.hypot(a.P.x - cam.x, a.P.y - cam.y) - Math.hypot(b.P.x - cam.x, b.P.y - cam.y));
      if (!c.length) return null;
      const a = c[0]; a.n = a.at(); a.path = null; a.t = 0; a.steps = []; a.cur = null; a.act('break', 9); a.task = 'brk';
      return [a.id, +a.P.x.toFixed(2), +a.P.y.toFixed(2)];
    },
    focus: (id, w) => { const a = ants.find(q => q.id === id); if (!a) return false; cam.from = { x: cam.x, y: cam.y, w: cam.w }; cam.shot = { kind: 'close', follow: a, x: a.P.x, y: a.P.y, w: w || 3.6, close: true, hold: 600 }; cam.t = 7; return true; },
    census: () => {
      let overlap = 0, nan = 0;
      for (const a of ants) { if (!isFinite(a.P.x + a.P.y + a.P.z)) nan++; for (const b of ants) if (a.id < b.id && a.P.distanceTo(b.P) < 0.35 * Math.min(a.sc, b.sc) && (a.climb || 0) < 0.1 && (b.climb || 0) < 0.1) overlap++; }
      const stuck = ants.filter(a => a.wait > 5).length;
      return { overlap, nan, stuck };
    },
  };
  if (CAPTURE) { window.__step = n => { for (let i = 0; i < n; i++) step(1 / 30); draw(1 / 30); return true; }; window.__ready = true; return; }
  let last = performance.now();
  // bench=S: after S seconds put frames drawn, frame gaps and the script's own time per frame in window.__bench
  const BENCH = qn('bench', 0), bench = { n: 0, work: 0, gaps: [], t0: performance.now() + 5000, sent: false };
  const loop = now => {
    requestAnimationFrame(loop);
    const dt = (now - last) / 1000;
    if (dt < 1 / FPS - 0.004) return;
    last = now;
    const d = Math.min(dt, 0.1);
    const w0 = performance.now();
    step(d); draw(d);
    if (BENCH && now > bench.t0 && !bench.sent) {
      bench.n++; bench.work += performance.now() - w0; bench.gaps.push(dt * 1000);
      if (now - bench.t0 > BENCH * 1000) {
        bench.sent = true;
        const g = bench.gaps.sort((x, y) => x - y), pct = q => g[Math.min(g.length - 1, Math.floor(q * g.length))].toFixed(1);
        const msg = 'fps=' + (bench.n / ((now - bench.t0) / 1000)).toFixed(1) + '&work_ms=' + (bench.work / bench.n).toFixed(2) + '&gap_p50=' + pct(0.5) + '&gap_p95=' + pct(0.95) + '&gap_max=' + g[g.length - 1].toFixed(0);
        window.__bench = msg;
      }
    }
  };
  requestAnimationFrame(loop);
  window.__ready = true;
}
function newShotOf(k) {
  // same as newShot, for one kind
  let s = null;
  if (k === 'entrance') s = { x: EX + SIDE * 0.9, y: -2.6, w: 6.8 };
  else if (k === 'queen' || k === 'granary' || k === 'brood') s = chamberShot(k, 5.6);
  else if (k === 'rest') s = chamberShot('rest', 6.2);
  else if (k === 'dig' && FRONT.length) { const f = N[FRONT[FRONT.length - 1].node]; s = { x: f.cx, y: f.cy + 0.3, w: 5.4 }; }
  else if (k === 'follow') { const c = ants.filter(a => !a.queen && a.awake && a.carry); if (c.length) { const a = pick(c); s = { follow: a, x: a.P.x, y: a.P.y, w: 4.9 }; } }
  else if (k === 'meadow') { if (VISIT) s = { follow: VISIT, x: VISIT.x, y: 0.6, w: 5.2, meadow: true, tilt: 3.2 }; else s = { x: EX + SIDE * 4, y: 0.9, w: 6.0, tilt: 3.2 }; }
  if (s) { s.kind = k; s.hold = 30; }
  return s;
}
main().catch(e => {
  console.error(e);
});
