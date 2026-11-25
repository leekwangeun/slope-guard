// ============================================================
// Slope Guard kickboard, built in code. It started as a port of slope_guard_model.py (Blender);
// since then the buzzer moved to the dashboard, the dashboard went to the top of the mast (no
// handle plate), the 470 uF capacitor moved to the foot of the mast and the weights became
// 4 M12 nuts and 6 thin discs. The Blender script does not have these changes yet.
// Shared by the blueprint viewer and the slope simulation.
//
// Coordinates: the Blender script uses X forward, Y left, Z up, in mm.
// three.js uses Y up, so a Blender point (x, y, z) becomes (x, z, -y).
// The model is built in mm; `model` is scaled to metres.
// ============================================================
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export const MM = 0.001;
export const P = (x, y, z) => new THREE.Vector3(x, z, -y);
export const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace); // Blender colours are linear
const rad = THREE.MathUtils.degToRad;

// ------------------------------------------------------------
// Textures made in code: height field -> roughness and normal maps
// ------------------------------------------------------------
const TEX = 256;
function rng(seed) { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function valueNoise(cx, cy, seed) {
  const r = rng(seed), g = Array.from({ length: cx * cy }, r), out = new Float32Array(TEX * TEX), sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const fx = (x / TEX) * cx, fy = (y / TEX) * cy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
    const x1 = (x0 + 1) % cx, y1 = (y0 + 1) % cy;
    const a = g[y0 * cx + x0], b = g[y0 * cx + x1], c = g[y1 * cx + x0], d = g[y1 * cx + x1];
    out[y * TEX + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}
function fbm(cx, cy, oct, seed) {
  const out = new Float32Array(TEX * TEX); let amp = 1, sum = 0;
  for (let o = 0; o < oct; o++) { const n = valueNoise(cx << o, cy << o, seed + o * 97); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; sum += amp; amp *= 0.5; }
  return out.map((v) => v / sum);
}
function makeTexture(pixel, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const ctx = c.getContext('2d'), img = ctx.createImageData(TEX, TEX);
  for (let i = 0; i < TEX * TEX; i++) img.data.set([...pixel(i), 255], i * 4);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace; // data maps, not colours
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}
const grayTex = (h, fn, rx, ry) => makeTexture((i) => { const g = Math.min(1, Math.max(0, fn(h[i]))) * 255; return [g, g, g]; }, rx, ry);
function normalTex(h, s, rx, ry) {
  return makeTexture((i) => {
    const x = i % TEX, y = (i / TEX) | 0;
    const nx = (h[y * TEX + ((x + TEX - 1) % TEX)] - h[y * TEX + ((x + 1) % TEX)]) * s;
    const ny = (h[((y + 1) % TEX) * TEX + x] - h[((y + TEX - 1) % TEX) * TEX + x]) * s;
    const k = 1 / Math.hypot(nx, ny, 1);
    return [(nx * k * 0.5 + 0.5) * 255, (ny * k * 0.5 + 0.5) * 255, (k * 0.5 + 0.5) * 255];
  }, rx, ry);
}
const foam = fbm(32, 32, 3, 5);       // PVC foam board: soft orange-peel
const rubber = fbm(48, 48, 2, 9);     // tyre rubber: fine grain
const brushed = fbm(2, 128, 3, 13);   // metal: streaks in one direction
const TX = {
  formex: { roughnessMap: grayTex(foam, (v) => 0.38 + 0.18 * v, 10, 2.7), normalMap: normalTex(foam, 1.2, 10, 2.7) },
  tire: { roughnessMap: grayTex(rubber, (v) => 0.72 + 0.2 * v, 8, 1), normalMap: normalTex(rubber, 2, 8, 1) },
  metal: { roughnessMap: grayTex(brushed, (v) => 0.2 + 0.25 * v) },
  brass: { roughnessMap: grayTex(brushed, (v) => 0.22 + 0.22 * v, 1, 3) },
};

// ------------------------------------------------------------
// Materials: same names and values as make_mat() in the Blender script
// ------------------------------------------------------------
function mat(name, rgb, { metal = 0, rough = 0.5, trans = 0, ior = 1.45 } = {}) {
  const o = { name, color: lin(...rgb), metalness: metal, roughness: rough };
  // clear acrylic: light passing through a long edge is tinted, so the edges read like real acrylic
  return trans
    ? new THREE.MeshPhysicalMaterial({ ...o, transmission: trans, ior, thickness: 3, attenuationColor: lin(0.55, 0.75, 0.8), attenuationDistance: 6, specularIntensity: 1 })
    : new THREE.MeshStandardMaterial(o);
}
export const M = {
  formex: mat('포맥스_노랑', [0.95, 0.72, 0.05], { rough: 0.45 }),
  acrylic: mat('아크릴_투명', [0.85, 0.95, 1.0], { rough: 0.03, trans: 1.0, ior: 1.49 }),
  tire: mat('타이어_고무', [0.02, 0.02, 0.02], { rough: 0.8 }),
  hub: mat('휠_노랑', [0.95, 0.75, 0.05], { rough: 0.4 }),
  gearbox: mat('TT기어박스', [0.95, 0.78, 0.10], { rough: 0.35 }),
  metal: mat('금속_은색', [0.55, 0.56, 0.6], { metal: 1.0, rough: 0.3 }),
  brass: mat('황동', [0.85, 0.62, 0.25], { metal: 1.0, rough: 0.3 }),
  black: mat('검정_플라스틱', [0.03, 0.03, 0.03], { rough: 0.5 }),
  pcb_blue: mat('PCB_파랑', [0.05, 0.18, 0.55], { rough: 0.45 }),
  pcb_red: mat('PCB_빨강', [0.6, 0.04, 0.03], { rough: 0.45 }),
  pcb_dark: mat('PCB_검정', [0.05, 0.06, 0.07], { rough: 0.45 }),
  pcb_purple: mat('PCB_보라', [0.25, 0.08, 0.45], { rough: 0.45 }),
  terminal_g: mat('단자대_초록', [0.05, 0.45, 0.15], { rough: 0.5 }),
  terminal_b: mat('단자대_파랑', [0.05, 0.25, 0.75], { rough: 0.5 }),
  bread: mat('브레드보드_초록', [0.20, 0.55, 0.25], { rough: 0.6 }),
  led_g: mat('LED_초록', [0.1, 0.9, 0.2], { rough: 0.2 }),
  led_r: mat('LED_빨강', [0.95, 0.08, 0.05], { rough: 0.2 }),
  cap: mat('커패시터', [0.08, 0.10, 0.35], { rough: 0.4 }),
  grey: mat('캐스터_회색', [0.35, 0.35, 0.37], { rough: 0.5 }),
  white: mat('캐스터_림_흰색', [0.9, 0.9, 0.9], { rough: 0.4 }),
  nylon: mat('나일론_인서트', [0.55, 0.65, 0.85], { rough: 0.5 }),
  tape: mat('절연테이프', [0.02, 0.02, 0.02], { rough: 0.35 }),
};
export function setTextures(on) {
  for (const [key, maps] of Object.entries(TX)) {
    const m = M[key];
    for (const [slot, tex] of Object.entries(maps)) m[slot] = on ? tex : null;
    if (on && maps.roughnessMap) m.roughness = 1; // the map carries the value
    else m.roughness = { formex: 0.45, tire: 0.8, metal: 0.3, brass: 0.3 }[key];
    m.needsUpdate = true;
  }
}
setTextures(true);

// ------------------------------------------------------------
// Part helpers (same signatures as box / cyl / hexpost / holed in Blender)
// ------------------------------------------------------------
export const model = new THREE.Group();
model.name = 'SlopeGuard_모형';
const groups = {};
const group = (name) => groups[name] ?? (groups[name] = model.add(Object.assign(new THREE.Group(), { name })).children.at(-1));
export const parts = [];   // { o: mesh, base: rest position (mm), ex: explode offset (mm), group, flat: non-indexed geometry }

function add(name, geo, m, loc, coll, ex) {
  const o = new THREE.Mesh(geo, m);
  o.name = name;
  o.castShadow = o.receiveShadow = true;
  o.position.copy(P(...loc));
  group(coll).add(o);
  parts.push({ o, base: o.position.clone(), ex: P(...ex), group: coll });
  return o;
}

// connection points for the wiring (Blender axes, mm): p = where the wire ends, d = the way it leaves
export const PINS = {};
const pin = (key, p, d) => { PINS[key] = { p, d }; };

function boxGeo([sx, sy, sz], bevel) {
  const r = Math.min(bevel, sx / 2, sy / 2, sz / 2) * 0.98;
  return r > 0.05 ? new RoundedBoxGeometry(sx, sz, sy, 2, r) : new THREE.BoxGeometry(sx, sz, sy);
}
const box = (name, size, loc, m, coll, ex, { bevel = 0.4 } = {}) => add(name, boxGeo(size, bevel), m, loc, coll, ex);

// cylinder with rounded edges, turned on a lathe (stands in for Blender's Bevel modifier)
function roundedCylinder(r, h, b, seg) {
  const pts = [new THREE.Vector2(0, -h / 2)];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 6; i++) { const a = a0 + ((a1 - a0) * i) / 6; pts.push(new THREE.Vector2(cx + b * Math.cos(a), cy + b * Math.sin(a))); } };
  arc(r - b, -h / 2 + b, -Math.PI / 2, 0);
  arc(r - b, h / 2 - b, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, seg);
}
// axis 'z' = upright (Blender default), 'y' = rot (90,0,0) sideways, 'x' = rot (0,90,0) lengthwise
function orient(geo, axis) {
  if (axis === 'y') geo.rotateX(Math.PI / 2);
  else if (axis === 'x') geo.rotateZ(Math.PI / 2);
  return geo;
}
function cylGeo(r, h, { axis = 'z', seg = 32, bevel = 0 } = {}) {
  let geo;
  if (seg <= 8) { geo = new THREE.CylinderGeometry(r, r, h, seg).toNonIndexed(); geo.computeVertexNormals(); } // flat hex faces
  else if (bevel > 0) geo = roundedCylinder(r, h, Math.min(bevel, r * 0.9, (h / 2) * 0.98), seg);
  else geo = new THREE.CylinderGeometry(r, r, h, seg);
  return orient(geo, axis);
}
const cyl = (name, r, h, loc, m, coll, ex, opt) => add(name, cylGeo(r, h, opt), m, loc, coll, ex);
const hexpost = (name, af, h, loc, m, coll, ex) => cyl(name, af / Math.sqrt(3), h, loc, m, coll, ex, { seg: 6 });

// ring with a round hole: outer is a radius or { hex: across-flats }
function holed(name, outer, rIn, h, loc, m, coll, ex, seg = 48) {
  const s = new THREE.Shape();
  if (outer.hex) {
    const R = outer.hex / Math.sqrt(3);
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; k ? s.lineTo(R * Math.cos(a), R * Math.sin(a)) : s.moveTo(R * Math.cos(a), R * Math.sin(a)); }
    s.closePath();
  } else s.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg / 4 }).translate(0, 0, -h / 2).rotateX(-Math.PI / 2);
  return add(name, geo, m, loc, coll, ex);
}

// boolean difference (Blender's Boolean modifier)
const evaluator = new Evaluator();
evaluator.useGroups = false;
function subtract(geo, cutters) {
  let result = new Brush(geo);
  for (const c of cutters) result = evaluator.evaluate(result, new Brush(c), SUBTRACTION);
  return result.geometry;
}
const cutBox = ([sx, sy, sz], rel) => new THREE.BoxGeometry(sx, sz, sy).translate(...P(...rel).toArray());

// ------------------------------------------------------------
// Dimensions (mm), from the frame drawing (프레임 설계도): deck 300 x 78, tab slots 4 mm in from
// the edges, 20 mm between the two motors (78 - (4 + 3 + 19 + 3) x 2), discs 16 mm apart
// ------------------------------------------------------------
const DECK_L = 300, DECK_W = 78, DECK_T = 5;
const WHEEL_R = 33, WHEEL_W = 26, REAR_AXLE_X = 30, TRACK = 110, WHEELBASE = 240;
const DECK_Z0 = 45, DECK_Z1 = DECK_Z0 + DECK_T, CASTER_H = 33, FRONT_X = REAR_AXLE_X + WHEELBASE, MAST_X = 288;
const CASTER_R = 12.7, CASTER_AXLE_X = FRONT_X - 6;
const TAB_OUT = [35, 32], TAB_IN = [13, 10], MOTOR_Y = 22.5, DISC_Y = 8, LIFT = 100;
const E = (dx = 0, dy = 0, dz = 0) => [dx, dy, dz + LIFT];

// 1. deck with the sensor-fork opening and four tab slots cut out
{
  const cutters = [cutBox([12, 32, 10], [REAR_AXLE_X - DECK_L / 2, 0, 0])];
  for (const yy of [TAB_OUT, TAB_IN]) for (const s of [1, -1]) cutters.push(cutBox([14, 3, 10], [43 - DECK_L / 2, (s * (yy[0] + yy[1])) / 2, 0]));
  add('데크_포맥스', subtract(boxGeo([DECK_L, DECK_W, DECK_T], 1.0), cutters), M.formex, [DECK_L / 2, 0, DECK_Z0 + DECK_T / 2], '01_데크_포맥스', E());
}

// encoder disc with 20 slots (built upright, then turned sideways)
function encoderDisc() {
  const cutters = [];
  for (let k = 0; k < 20; k++) {
    const t = (2 * Math.PI * k) / 20;
    cutters.push(new THREE.BoxGeometry(3.2, 6, 1.6).rotateY(t).translate(10 * Math.cos(t), 0, -10 * Math.sin(t)));
  }
  return orient(subtract(new THREE.CylinderGeometry(12.5, 12.5, 1.5, 48), cutters), 'y');
}

// 2. rear wheels, TT motors, tabs, encoder discs, FC-03 sensors
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const yw = (s * TRACK) / 2, axle = [REAR_AXLE_X, yw, WHEEL_R];
  let C = '02_뒷바퀴';
  const ex = E(0, s * 95, -10);
  cyl(`타이어_${side}`, WHEEL_R, WHEEL_W, axle, M.tire, C, ex, { axis: 'y', seg: 48, bevel: 4 });
  cyl(`휠허브_${side}`, 22, WHEEL_W + 1, axle, M.hub, C, ex, { axis: 'y', seg: 40, bevel: 0.8 });
  cyl(`휠캡_${side}`, 6, WHEEL_W + 3, axle, M.hub, C, ex, { axis: 'y', seg: 24, bevel: 0.5 });
  for (let k = 0; k < 6; k++) {
    const a = rad(k * 60 + 30);
    cyl(`휠구멍_${side}${k}`, 3.5, WHEEL_W + 1.6, [REAR_AXLE_X + 14 * Math.cos(a), yw, WHEEL_R + 14 * Math.sin(a)], M.black, C, ex, { axis: 'y', seg: 16 });
  }

  C = '03_TT모터_엔코더';
  const exm = E(0, s * 45, -60), ym = s * MOTOR_Y;
  box(`기어박스_${side}`, [37, 19, 22.5], [37.5, ym, WHEEL_R], M.gearbox, C, exm, { bevel: 1.0 });
  cyl(`모터캔_${side}`, 9.5, 29, [70.5, ym, WHEEL_R], M.metal, C, exm, { axis: 'x', seg: 32, bevel: 0.6 });
  cyl(`모터축_${side}`, 2.7, 50, [REAR_AXLE_X, s * 30, WHEEL_R], M.metal, C, exm, { axis: 'y', seg: 16 });
  for (const bz of [26, 40]) {
    cyl(`긴볼트_${side}${bz}`, 1.5, 26, [48, ym, bz], M.metal, C, exm, { axis: 'y', seg: 12 });
    cyl(`긴볼트머리_${side}${bz}`, 2.8, 2, [48, s * (TAB_OUT[0] + 1.5), bz], M.metal, C, exm, { axis: 'y', seg: 16 });
    hexpost(`긴볼트너트_${side}${bz}`, 5.5, 2.4, [48, s * (TAB_IN[1] - 1.2), bz], M.metal, C, exm);
  }
  const ext = E(0, s * 30, -35);
  for (const [tag, r] of [['밖', TAB_OUT], ['안', TAB_IN]]) {
    const ty = (s * (r[0] + r[1])) / 2;
    box(`고정탭_${tag}_${side}`, [14, 3, 33], [43, ty, 20 + 16.5], M.acrylic, C, ext, { bevel: 0.3 });
    box(`고정탭_머리_${tag}_${side}`, [18, 3, 2], [43, ty, DECK_Z1 + 1], M.acrylic, C, ext, { bevel: 0.3 });
  }
  const exd = E(0, s * 20, -60);
  add(`엔코더원판_${side}`, encoderDisc(), M.black, [REAR_AXLE_X, s * DISC_Y, WHEEL_R], C, exd);
  cyl(`엔코더허브_${side}`, 4, 4, [REAR_AXLE_X, s * DISC_Y, WHEEL_R], M.black, C, exd, { axis: 'y', seg: 20 });

  // the speed sensors sit the other way round: the fork stays over the disc, the board runs back
  // from it and its pin header ends up almost at the rear edge of the deck
  C = '04_속도센서_FC03';
  const exs = E(0, 0, 28);
  box(`FC03_보드_${side}`, [32, 14, 1.6], [20, s * DISC_Y, DECK_Z1 + 1.8], M.pcb_blue, C, exs, { bevel: 0.3 });
  for (const t of [1, -1]) box(`FC03_포크${t}_${side}`, [10, 3.5, 12], [30, s * DISC_Y + t * 4.25, DECK_Z1 + 1 - 6], M.black, C, exs, { bevel: 0.4 });
  box(`FC03_포크밑_${side}`, [10, 12, 2], [30, s * DISC_Y, DECK_Z1], M.black, C, exs, { bevel: 0.3 });
  box(`FC03_핀헤더_${side}`, [2.5, 8, 8], [6, s * DISC_Y, DECK_Z1 + 6.6], M.black, C, exs, { bevel: 0.2 });
  [['VCC', -2.54], ['GND', 0], ['DO', 2.54]].forEach(([n, o]) => pin(`FC_${side}_${n}`, [4.7, s * (DISC_Y + o), DECK_Z1 + 6.6], [-1, 0, 0]));
  for (const t of [1, -1]) pin(`MOT_${side}_${t > 0 ? 'A' : 'B'}`, [86, ym + t * 3, WHEEL_R], [1, 0, 0]);
}

// 3. battery case (the buzzer that sat beside it is now on the dashboard)
{
  const C = '05_배터리_18650x2', bx = 104, exb = E(0, 0, 70);
  box('배터리케이스', [88, 41, 22], [bx, 0, DECK_Z1 + 11], M.black, C, exb, { bevel: 1.5 });
  box('배터리_뚜껑선', [86, 39, 0.6], [bx, 0, DECK_Z1 + 22.2], M.pcb_dark, C, exb, { bevel: 0.2 });
  box('배터리_스위치', [8, 4, 5], [bx + 28, 0, DECK_Z1 + 24], M.metal, C, exb, { bevel: 0.5 });
  pin('BAT_P', [bx + 44.5, 5, DECK_Z1 + 10], [1, 0, 0]);
  pin('BAT_N', [bx + 44.5, 12, DECK_Z1 + 10], [1, 0, 0]);
}

// 4. front caster and its 6 mm brass spacers
{
  const C = '06_캐스터', exc = E(0, 0, -75);
  box('캐스터판', [30, 39, 1.5], [FRONT_X, 0, CASTER_H - 0.75], M.metal, C, exc, { bevel: 0.3 });
  cyl('캐스터_베어링상', 9, 2, [FRONT_X, 0, CASTER_H - 2.5], M.metal, C, exc, { bevel: 0.4 });
  cyl('캐스터_베어링하', 7.5, 2, [FRONT_X, 0, CASTER_H - 4.5], M.metal, C, exc, { bevel: 0.4 });
  box('캐스터_포크상판', [16, 17, 1.2], [FRONT_X - 2, 0, CASTER_H - 6], M.metal, C, exc, { bevel: 0.3 });
  for (const t of [1, -1]) box(`캐스터_포크${t}`, [15, 1.2, 15], [FRONT_X - 4, t * 8, 19.5], M.metal, C, exc, { bevel: 0.3 });
  const w = [CASTER_AXLE_X, 0, CASTER_R];
  cyl('캐스터_바퀴', CASTER_R, 13, w, M.tire, C, exc, { axis: 'y', seg: 40, bevel: 2 });
  cyl('캐스터_림', 9.5, 13.4, w, M.white, C, exc, { axis: 'y', seg: 40, bevel: 0.5 });
  cyl('캐스터_허브', 7.5, 13.8, w, M.black, C, exc, { axis: 'y', seg: 32, bevel: 0.5 });
  cyl('캐스터_축캡', 3.5, 18.5, w, M.metal, C, exc, { axis: 'y', seg: 24, bevel: 1.2 });
  [[11, 15.5], [11, -15.5], [-11, 15.5], [-11, -15.5]].forEach(([dx, dy], i) => {
    hexpost(`캐스터서포트_${i}`, 5, 6, [FRONT_X + dx, dy, CASTER_H + 3], M.brass, '07_황동서포트_6mm', E(0, 0, -38));
    hexpost(`캐스터서포트_${i}b`, 5, 6, [FRONT_X + dx, dy, CASTER_H + 9], M.brass, '07_황동서포트_6mm', E(0, 0, -30));
  });
}

// 5. L298N on the left half (heat sink to the outer edge) and MPU6050 beside it on the right,
//    as in the frame drawing
{
  const lx = 173.5, ly = 16.5, pcbZ = DECK_Z1 + 6;
  [[18.5, 18.5], [18.5, -18.5], [-18.5, 18.5], [-18.5, -18.5]].forEach(([dx, dy], i) =>
    hexpost(`L298N서포트_${i}`, 5, 6, [lx + dx, ly + dy, DECK_Z1 + 3], M.brass, '07_황동서포트_6mm', E(0, 0, 35)));
  const C = '08_L298N', exl = E(0, 0, 75);
  box('L298N_PCB', [43, 43, 1.6], [lx, ly, pcbZ + 0.8], M.pcb_red, C, exl, { bevel: 0.3 });
  box('L298N_방열판', [23, 8, 25], [lx, ly + 13, pcbZ + 1.6 + 12.5], M.black, C, exl, { bevel: 0.5 });
  for (let k = 0; k < 5; k++) box(`L298N_방열핀${k}`, [23, 1.2, 6], [lx, ly + 16 - k * 2, pcbZ + 1.6 + 28], M.black, C, exl, { bevel: 0.2 });
  for (const t of [1, -1]) box(`L298N_모터단자${t}`, [10, 8, 10], [lx + t * 15, ly + 3, pcbZ + 6.6], M.terminal_b, C, exl, { bevel: 0.4 });
  box('L298N_전원단자', [15, 8, 10], [lx, ly - 15, pcbZ + 6.6], M.terminal_b, C, exl, { bevel: 0.4 });
  box('L298N_IC', [15, 2, 12], [lx, ly + 8, pcbZ + 7.6], M.black, C, exl, { bevel: 0.3 });
  box('L298N_신호핀', [13.8, 2.5, 8.5], [188.25, ly - 17, pcbZ + 1.6 + 4.25], M.black, C, exl, { bevel: 0.2 });
  ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'].forEach((n, i) => pin(`L298_${n}`, [182.5 + 2.3 * i, ly - 17, pcbZ + 10.5], [0, 0, 1]));
  ['12V', 'GND', '5V'].forEach((n, i) => pin(`L298_${n}`, [lx - 5 + 5 * i, ly - 19.5, pcbZ + 6.6], [0, -1, 0]));
  ['OUT1', 'OUT2'].forEach((n, i) => pin(`L298_${n}`, [lx - 17.5 + 5 * i, ly + 7.5, pcbZ + 6.6], [0, 1, 0]));
  ['OUT3', 'OUT4'].forEach((n, i) => pin(`L298_${n}`, [lx + 12.5 + 5 * i, ly + 7.5, pcbZ + 6.6], [0, 1, 0]));

  const U = '09_MPU6050', mx = 167.5, my = -24, exu = E(0, -15, 55);
  cyl('MPU_나일론와셔1', 3, 1.5, [mx - 7, my - 5.5, DECK_Z1 + 0.75], M.white, U, exu, { seg: 20 });
  cyl('MPU_나일론와셔2', 3, 1.5, [mx + 7, my - 5.5, DECK_Z1 + 0.75], M.white, U, exu, { seg: 20 });
  box('MPU6050_PCB', [21, 16, 1.6], [mx, my, DECK_Z1 + 2.3], M.pcb_purple, U, exu, { bevel: 0.3 });
  box('MPU6050_칩', [4, 4, 1], [mx, my + 1, DECK_Z1 + 3.6], M.black, U, exu, { bevel: 0.1 });
  box('MPU6050_핀헤더', [20, 2.5, 8], [mx, my + 6.5, DECK_Z1 + 7.1], M.black, U, exu, { bevel: 0.2 });
  for (const t of [1, -1]) cyl(`MPU_볼트머리${t}`, 2.7, 2, [mx + t * 7, my - 5.5, DECK_Z1 + 4.1], M.metal, U, exu, { seg: 20, bevel: 0.4 });
  ['VCC', 'GND', 'SCL', 'SDA'].forEach((n, i) => pin(`MPU_${n}`, [mx - 8.89 + 2.54 * i, my + 6.5, DECK_Z1 + 11.5], [0, 0, 1]));
}

// 6. ESP32 expansion board and ESP32
{
  const exX = 235, pcbZ = DECK_Z1 + 6;
  [[30, 25], [30, -25], [-30, 25], [-30, -25]].forEach(([dx, dy], i) =>
    hexpost(`확장보드서포트_${i}`, 5, 6, [exX + dx, dy, DECK_Z1 + 3], M.brass, '07_황동서포트_6mm', E(0, 0, 35)));
  // screw terminals, front (antenna end) to back, as printed on the expansion board
  const ROW_L = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND_L', 'VIN'];
  const ROW_R = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'D17', 'D16', 'D4', 'D2', 'D15', 'GND_R', '3V3'];
  ROW_L.forEach((n, i) => pin(`ESP_${n}`, [exX + 28 - 4 * i, 28.5, pcbZ + 6], [0, 1, 0]));
  ROW_R.forEach((n, i) => pin(`ESP_${n}`, [exX + 28 - 4 * i, -28.5, pcbZ + 6], [0, -1, 0]));
  const C = '10_ESP32_확장보드', exe = E(0, 0, 75);
  box('확장보드_PCB', [68, 58, 1.6], [exX, 0, pcbZ + 0.8], M.pcb_dark, C, exe, { bevel: 0.3 });
  for (const t of [1, -1]) {
    box(`확장보드_단자대${t}`, [60, 7, 9], [exX, t * 24.5, pcbZ + 6.1], M.terminal_g, C, exe, { bevel: 0.4 });
    box(`확장보드_헤더${t}`, [40, 3, 8], [exX, t * 12, pcbZ + 5.6], M.black, C, exe, { bevel: 0.2 });
  }
  const S = '11_ESP32', exp = E(0, 0, 120), espZ = pcbZ + 9.6;
  box('ESP32_PCB', [51, 28, 1.6], [exX, 0, espZ + 0.8], M.pcb_dark, S, exp, { bevel: 0.3 });
  box('ESP32_모듈쉴드', [18, 16, 3], [exX + 12, 0, espZ + 3.1], M.metal, S, exp, { bevel: 0.3 });
  box('ESP32_안테나', [6, 18, 0.8], [exX + 23.5, 0, espZ + 2], M.pcb_dark, S, exp, { bevel: 0.1 });
  box('ESP32_USBC', [7, 9, 3.2], [exX - 23, 0, espZ + 3.2], M.metal, S, exp, { bevel: 0.5 });
}

// 7. mast (eight 20 mm spacers) with the dashboard on top, the capacitor at its foot,
//    and the weights (4 M12 nuts, 6 thin discs) on the mast under the dashboard
const TOP_Z = DECK_Z1 + 20 * 8;                         // top of the mast
// the 4WD kit's 3 mm acrylic cut to 40 x 85; from the back: buzzer module, breadboard, the mast
// 8 mm from the front edge (frame drawing ④)
const DASH_L = 85, DASH_W = 40, DASH_FRONT = MAST_X + 8;
export const DASH = {
  rear: DASH_FRONT - DASH_L, plateTop: TOP_Z + 3, bbTop: TOP_Z + 3 + 8.5,
  bbX0: DASH_FRONT - DASH_L + 18, bbY: 0,                // breadboard (47 x 35) across the plate
  bzX: DASH_FRONT - DASH_L + 10.5,                       // buzzer module (13 x 33) in the rear margin
  riser: [266, -25],                                     // the harness climbs outside the plate's right edge here
};
{
  const mastZ = (k) => DECK_Z1 + 20 * k;
  const mastOff = (k) => 30 + k * 6;
  for (let k = 0; k < 8; k++) hexpost(`핸들서포트_${k}`, 5, 20, [MAST_X, 0, mastZ(k) + 10], M.brass, '13_핸들기둥_20mm서포트', E(45, 0, mastOff(k)));

  // 470 uF capacitor, moved here from beside the ESP32: lying across the deck, legs to the left
  const cx = MAST_X - 10, cz = DECK_Z1 + 5, K = '12_커패시터', exk = E(10, 0, 40);
  cyl('커패시터_470uF', 5, 13, [cx, 0, cz], M.cap, K, exk, { axis: 'y', seg: 24, bevel: 0.6 });
  cyl('커패시터_윗면', 4.2, 0.4, [cx, -6.6, cz], M.metal, K, exk, { axis: 'y', seg: 24 });
  for (const t of [1, -1]) cyl(`커패시터_다리${t}`, 0.3, 3, [cx, 8, cz + t * 2.2], M.metal, K, exk, { axis: 'y', seg: 8 });
  pin('CAP_P', [cx, 9.5, cz + 2.2], [0, 1, 0]);
  pin('CAP_N', [cx, 9.5, cz - 2.2], [0, 1, 0]);

  // dashboard: acrylic plate on the top spacer, held by a nut
  const { plateTop, bbTop, bbX0, bbY, bzX } = DASH, offDash = mastOff(7) + 24;
  box('계기판_아크릴', [DASH_L, DASH_W, 3], [DASH_FRONT - DASH_L / 2, 0, TOP_Z + 1.5], M.acrylic, '15_계기판_아크릴', E(45, 0, offDash), { bevel: 0.6 });
  hexpost('계기판_고정너트', 5.5, 2.4, [MAST_X, 0, plateTop + 1.2], M.metal, '15_계기판_아크릴', E(45, 0, offDash + 8));

  const C = '16_계기판_LED_스위치', exd = E(45, 0, offDash + 26);
  box('미니브레드보드', [47, 35, 8.5], [bbX0 + 23.5, bbY, plateTop + 4.25], M.bread, C, exd, { bevel: 0.6 });
  [[10, M.led_r], [20, M.led_g]].forEach(([xx, m], k) => {
    cyl(`LED_${k}`, 2.5, 6, [bbX0 + xx, bbY + 7, bbTop + 3], m, C, exd, { seg: 20 });
    cyl(`LED_돔_${k}`, 2.5, 1, [bbX0 + xx, bbY + 7, bbTop + 6.5], m, C, exd, { seg: 20, bevel: 1.2 });
  });
  box('슬라이드스위치', [4, 9, 4], [bbX0 + 32, bbY + 6.5, bbTop + 2], M.metal, C, exd, { bevel: 0.3 });
  box('슬라이드스위치_노브', [2, 2, 3], [bbX0 + 32, bbY + 7.5, bbTop + 5.5], M.black, C, exd, { bevel: 0.2 });

  // buzzer module, moved from beside the battery to the rear margin of the dashboard, lying across it
  const Z = '17_부저', exz = E(45, 0, offDash + 26);
  box('부저모듈_PCB', [13, 33, 1.6], [bzX, 0, plateTop + 0.8], M.pcb_blue, Z, exz, { bevel: 0.3 });
  cyl('부저', 6, 8, [bzX, 7, plateTop + 5.6], M.black, Z, exz, { seg: 28, bevel: 0.5 });
  box('부저_핀헤더', [8, 2.5, 8], [bzX, -15, plateTop + 5.6], M.black, Z, exz, { bevel: 0.2 });
  [['IO', -2.54], ['VCC', 0], ['GND', 2.54]].forEach(([n, o]) => pin(`BZ_${n}`, [bzX + o, -16.3, plateTop + 5.6], [0, -1, 0]));

  // weights, top down from the plate: 6 discs, then 4 nuts wrapped in tape, a cable tie under them
  const W = '14_무게추', NUT_S = 18, NUT_BODY = 9, NUT_TOP = 3, NUT_H = NUT_BODY + NUT_TOP, DISC_R = 12, DISC_T = 3;
  const discZ0 = TOP_Z - 6 * DISC_T, nutZ0 = discZ0 - 4 * NUT_H;
  for (let k = 0; k < 6; k++) holed(`원판무게추_${k}`, DISC_R, 6.2, DISC_T - 0.25, [MAST_X, 0, discZ0 + k * DISC_T + DISC_T / 2], M.metal, W, E(95, 0, 72), 64);
  const nut = (name, z0, ex) => {
    holed(name, { hex: NUT_S }, 6.2, NUT_BODY, [MAST_X, 0, z0 + NUT_BODY / 2], M.metal, W, ex);
    holed(`${name}_칼라`, 8.3, 6.2, NUT_TOP, [MAST_X, 0, z0 + NUT_BODY + NUT_TOP / 2], M.metal, W, ex);
    holed(`${name}_나일론`, 6.2, 5.4, NUT_TOP - 0.3, [MAST_X, 0, z0 + NUT_BODY + NUT_TOP / 2], M.nylon, W, ex);
  };
  const exNut = E(95, 0, 40);
  for (let k = 0; k < 4; k++) nut(`M12너트_${k}`, nutZ0 + k * NUT_H, exNut);
  holed('절연테이프', { hex: NUT_S + 1.2 }, 9.5, 19, [MAST_X, 0, nutZ0 + 2 * NUT_H], M.tape, W, exNut);
  holed('케이블타이_받침', 3.7, 2.6, 3.5, [MAST_X, 0, nutZ0 - 1.75], M.black, W, E(70, 0, 32), 24);
  box('케이블타이_받침_머리', [5, 6, 4.5], [MAST_X - 5.5, 0, nutZ0 - 1.75], M.black, W, E(70, 0, 32), { bevel: 0.5 });
}

// sizes for the dimension lines (mm)
export const DIMS = { DECK_L, DECK_W, WHEEL_R, WHEEL_W, REAR_AXLE_X, TRACK, WHEELBASE, FRONT_X, MAST_X, TOP: TOP_Z + 3, DECK_Z1 };

// what each part group is, for the part card and the parts list
export const COMPONENTS = {
  '01_데크_포맥스': { title: '데크', spec: `포맥스 5T, ${DECK_L} × ${DECK_W} mm`, role: '모든 부품을 올리는 바닥판, 앞쪽에 기둥이 서고 뒤쪽 아래에 모터가 달림', view: 'home' },
  '02_뒷바퀴': { title: '뒷바퀴 2개', spec: `Ø${WHEEL_R * 2} × ${WHEEL_W} mm, 고무 타이어`, role: 'TT모터 축에 바로 끼운 구동 바퀴', view: 'motor' },
  '03_TT모터_엔코더': { title: 'TT모터와 엔코더 원판', spec: '모터 2개, 원판 구멍 20개', role: '바퀴를 돌리고, 원판 구멍 수로 회전을 셈 (구멍 1개 = 약 10.2 mm 이동)', view: 'motor' },
  '04_속도센서_FC03': { title: '속도센서 FC-03 2개', spec: '포토 인터럽터, D34와 D35', role: '원판 구멍이 지날 때마다 펄스를 보내 실제 속도를 잼, 기판은 뒤쪽을 향하게 달아 데크 끝에 거의 닿음', view: 'sensor' },
  '05_배터리_18650x2': { title: '18650 배터리 박스', spec: '88 × 41 mm, 2개 직렬 7.4V (만충 8.4V), 스위치 내장', role: 'L298N 12V 단자로 모터 전원, L298N 5V를 거쳐 ESP32 전원', view: 'batt' },
  '06_캐스터': { title: '앞 캐스터', spec: `바퀴 Ø${CASTER_R * 2} mm, 황동 서포트 2단`, role: '앞을 받치고 방향을 자유롭게 바꿈', view: 'caster' },
  '07_황동서포트_6mm': { title: '황동 서포트', spec: '육각 6 mm, 16개', role: '보드를 데크에서 띄우고 캐스터 높이를 맞춤', view: 'caster' },
  '08_L298N': { title: 'L298N 모터 드라이버', spec: '43 × 43 mm, 6 mm 받침, ENA와 ENB 점퍼 제거', role: 'ESP32 신호로 두 모터를 전진시키거나 단락 제동', view: 'l298n' },
  '09_MPU6050': { title: 'MPU6050 기울기 센서', spec: 'I2C (D21, D22), L298N 옆, X 화살표가 앞', role: '0.02초마다 경사각을 잼, 자이로와 가속도를 상보필터로 섞음', view: 'mpu' },
  '10_ESP32_확장보드': { title: 'ESP32 확장보드', spec: '68 × 58 mm, 나사 단자 30개', role: '전선을 나사 단자로 물려 주행 중에 빠지지 않게 함', view: 'esp' },
  '11_ESP32': { title: 'ESP32 DevKit V1', spec: '30핀, USB-C', role: '경사각과 속도로 목표 속도를 정하고, 빠르면 제동하는 제어 보드', view: 'esp' },
  '12_커패시터': { title: '커패시터 470µF', spec: '전해 커패시터, VIN과 GND 사이', role: '모터가 켜지고 꺼질 때 생기는 전압 흔들림을 줄임, 기둥 밑동 옆에 눕혀 둠', view: 'cap' },
  '13_핸들기둥_20mm서포트': { title: '핸들 기둥', spec: '20 mm 육각 서포트 8개, 높이 160 mm', role: '맨 위에 계기판을 얹고 그 아래에 무게추를 끼우는 기둥', view: 'weight' },
  '14_무게추': { title: '무게추', spec: 'M12 나일론 너트 4개, 얇은 원판 6개', role: '계기판 바로 아래 기둥에 끼움, 너트는 절연테이프로 감고 케이블타이로 받침', view: 'weight' },
  '15_계기판_아크릴': { title: '계기판', spec: `아크릴 3T, ${DASH_L} × ${DASH_W} mm, 기둥 맨 위`, role: '뒤에서부터 부저 모듈, 미니 브레드보드, 앞 끝에 기둥', view: 'dash' },
  '16_계기판_LED_스위치': { title: 'LED와 스위치', spec: '미니 브레드보드 170홀, LED 2개, 220Ω', role: '초록 LED는 정상 주행 (D23), 빨간 LED는 제동 (D19), 스위치로 제어 ON/OFF (D13)', view: 'dash' },
  '17_부저': { title: '액티브 부저 모듈', spec: 'I/O는 D18, 전원 3V3, 계기판 뒤쪽', role: '주행 시작 전 카운트다운 3번, 넘어질 만큼 기울면 경고음', view: 'dash' },
};

model.scale.setScalar(MM);
for (const p of parts) p.flat = p.o.geometry.index ? p.o.geometry.toNonIndexed() : p.o.geometry;

// ------------------------------------------------------------
// For the driving simulation: the assembled model in metres, merged per material.
// The rear wheels (with their encoder discs) and the caster wheel stay apart,
// each set around its own axle, so they can turn.
// ------------------------------------------------------------
const rearWheel = (side) => [`타이어_${side}`, `휠허브_${side}`, `휠캡_${side}`, `엔코더원판_${side}`, `엔코더허브_${side}`, ...[0, 1, 2, 3, 4, 5].map((k) => `휠구멍_${side}${k}`)];
const WHEEL_SETS = [
  { at: P(REAR_AXLE_X, TRACK / 2, WHEEL_R), r: WHEEL_R, names: rearWheel('L') },
  { at: P(REAR_AXLE_X, -TRACK / 2, WHEEL_R), r: WHEEL_R, names: rearWheel('R') },
  { at: P(CASTER_AXLE_X, 0, CASTER_R), r: CASTER_R, names: ['캐스터_바퀴', '캐스터_림', '캐스터_허브', '캐스터_축캡'] },
];
export function carGeometry() {
  const setOf = new Map();
  WHEEL_SETS.forEach((w, i) => w.names.forEach((n) => setOf.set(n, i + 1)));
  const buckets = [new Map(), ...WHEEL_SETS.map(() => new Map())];   // [0] body, then one per wheel set
  for (const p of parts) {
    const k = setOf.get(p.o.name) ?? 0;
    const g = p.flat.clone().translate(p.base.x, p.base.y, p.base.z);
    if (k) g.translate(-WHEEL_SETS[k - 1].at.x, -WHEEL_SETS[k - 1].at.y, -WHEEL_SETS[k - 1].at.z);
    g.scale(MM, MM, MM);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!buckets[k].has(p.o.material)) buckets[k].set(p.o.material, []);
    buckets[k].get(p.o.material).push(g);
  }
  const merge = (m) => [...m].map(([material, geos]) => ({ material, geometry: mergeGeometries(geos) }));
  return {
    body: merge(buckets[0]),
    wheels: WHEEL_SETS.map((w, i) => ({ at: w.at.clone().multiplyScalar(MM), r: w.r * MM, parts: merge(buckets[i + 1]) })),
  };
}
