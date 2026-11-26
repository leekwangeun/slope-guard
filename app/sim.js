// ============================================================
// Slope driving simulation: port of slope_course_sim.py (Blender).
// Two kickboards, control OFF and ON, start together down an MDF ramp.
// Blender uses X forward, Y left, Z up in metres; a Blender point (x, y, z)
// becomes (x, z, -y) in three.js.
// ============================================================
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, lin, M, carGeometry } from './kickboard.js';
import { createView } from './post.js';
import { createCountdown } from './countdown.js';

const rad = THREE.MathUtils.degToRad;
const smooth = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
const $ = (id) => document.getElementById(id);

// course and model constants, the same numbers as the Blender script
const T = 0.006, W = 0.300, L_START = 0.600, L_SLOPE = 0.800;
const LANE_Y = { OFF: 0.21, ON: -0.21 };            // back lane = control OFF, front lane = control ON
const G = 9.81, FPS = 24, WB = 0.240, REAR_AXLE_X = 0.030;
// gearbox drag with the output off (1/s), short-circuit braking at PWM 255 (1/s), friction once stopped (m/s²),
// flat speed at throttle 190 (firmware comment) and how hard the driven motor holds it (1/s).
// K_SC and C_MOTOR follow the team's comparison video at 10° (start to the foot of the slope: OFF 2.07 s,
// ON 2.57 s): the real brake is weak and both cars come down fast. The gap is left a little wider than
// the video's 0.5 s so it can be seen on screen.
const D_COAST = 1.0, K_SC = 4.0, F_STOP = 0.6;
const V_MOTOR = 0.28, C_MOTOR = 5.0;
// firmware values (prj_test3.ino): target speed, its recovery, and the brake rule
const FW = { V_BASE: 0.32, K1: 0.006, V_MIN: 0.10, DEADBAND: 3, RECOVER: 0.30, MARGIN: 0.03, THROTTLE: 190, KP: 600, KI: 2000, STEP: 25, MAX: 255 };
const target = (deg) => Math.max(FW.V_BASE - FW.K1 * (deg > FW.DEADBAND ? deg : 0), FW.V_MIN);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const X_START = -0.52;
const INTRO = 84, PRE = 12, POST = 30, F_RUN = INTRO + 1;
const SIM_DT = 1 / (FPS * 10);
const EXPOSURE = 2 ** -0.25;                         // Blender exposure -0.25
const ANGLES = [10, 20, 30];                        // the ramp's 137 mm height blocks: 1, 2, 3 blocks

// ------------------------------------------------------------
// MDF texture made in code: fine fibres + broad blotches -> colour ramp, plus a normal map
// ------------------------------------------------------------
function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// value noise that tiles over `period` cells
function noise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (v) => ((v % period) + period) % period;
  const a = hash(w(x0), w(y0), seed), b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed), d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(size, period, octaves, seed) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, p = period;
      for (let o = 0; o < octaves; o++) {
        v += amp * noise((x / size) * p, (y / size) * p, p, seed + o);
        amp *= 0.5; p *= 2;
      }
      out[y * size + x] = v / (1 - 0.5 ** octaves);
    }
  }
  return out;
}
const toSRGB = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
function mdfMaps(dark, light, fibre, seed) {
  const S = 512, fine = fbm(S, fibre, 4, seed), blot = fbm(S, 2, 3, seed + 10), bump = fbm(S, fibre * 2, 3, seed + 20);
  const col = document.createElement('canvas'), nor = document.createElement('canvas');
  col.width = col.height = nor.width = nor.height = S;
  const ci = col.getContext('2d').createImageData(S, S), ni = nor.getContext('2d').createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // value noise spreads wider than Blender's noise, so pull it towards the middle before the ramp
    const v = (0.5 + (fine[i] - 0.5) * 0.45) * 0.7 + (0.5 + (blot[i] - 0.5) * 0.6) * 0.45;
    const k = Math.min(Math.max((v - 0.38) / 0.4, 0), 1);
    for (let c = 0; c < 3; c++) ci.data[i * 4 + c] = toSRGB(dark[c] + (light[c] - dark[c]) * k);
    ci.data[i * 4 + 3] = 255;
    const x = i % S, y = (i / S) | 0;
    const dx = bump[y * S + ((x + 1) % S)] - bump[y * S + ((x + S - 1) % S)];
    const dy = bump[((y + 1) % S) * S + x] - bump[((y + S - 1) % S) * S + x];
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    ni.data[i * 4] = (n.x * 0.5 + 0.5) * 255; ni.data[i * 4 + 1] = (n.y * 0.5 + 0.5) * 255;
    ni.data[i * 4 + 2] = (n.z * 0.5 + 0.5) * 255; ni.data[i * 4 + 3] = 255;
  }
  col.getContext('2d').putImageData(ci, 0, 0);
  nor.getContext('2d').putImageData(ni, 0, 0);
  const map = new THREE.CanvasTexture(col), normalMap = new THREE.CanvasTexture(nor);
  map.colorSpace = THREE.SRGBColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, normalMap };
}

// texture coordinates in metres (one texture tile = 25 cm), so long boards are not stretched
function worldUV(geo, offset) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
    uv.setXY(i, u / 0.25 + offset, v / 0.25 + offset * 0.7);
  }
}

// Blender rotation about +Y applied to a point in the XZ plane
const rotY = (th, x, z) => [x * Math.cos(th) + z * Math.sin(th), -x * Math.sin(th) + z * Math.cos(th)];

// term: the Bluetooth terminal (terminal.js); onReady / onStop: the cars wait on the start line / a run has ended
export function createSim({ renderer, backend, term, onReady = () => {}, onStop = () => {} }) {
  // ------------------------------------------------------------
  // World, lights
  // ------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = lin(0.8 * EXPOSURE, 0.8 * EXPOSURE, 0.8 * EXPOSURE);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: lin(0.8, 0.8, 0.8), side: THREE.BackSide })));
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene).texture;
  scene.environmentIntensity = EXPOSURE;

  // sun from the model scene, Blender rotation (35, 10, -30) deg; it follows the camera so the shadow box stays small
  const sunDirBl = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(rad(35), rad(10), rad(-30), 'XYZ'));
  const sunDir = P(sunDirBl.x, sunDirBl.y, sunDirBl.z).normalize();
  const sun = new THREE.DirectionalLight(0xffffff, 2.2 * EXPOSURE);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.003;
  Object.assign(sun.shadow.camera, { left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, near: 0.5, far: 5 });
  scene.add(sun, sun.target);
  function aimSun(x) {
    sun.target.position.set(x, 0.05, 0);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, -2.5);
  }
  // the course fill and rim area lights, as soft lights without shadows
  for (const [pos, k] of [[[-0.4, -1.6, 1.3], 0.9], [[1.3, 1.2, 1.1], 0.4]]) {
    const l = new THREE.DirectionalLight(0xffffff, k * EXPOSURE);
    l.position.copy(P(...pos));
    l.target.position.copy(P(0.3, 0, 0.1));
    scene.add(l, l.target);
  }
  // shadow catcher floor, like Blender's is_shadow_catcher
  const ShadowMat = THREE.ShadowNodeMaterial || THREE.ShadowMaterial;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new ShadowMat({ opacity: 0.22 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // camera: 40 mm lens on a 36 mm sensor; on a tall phone screen the view keeps about 60 % of
  // the width (the cars stay big enough to see) and the extra height goes to the HUD
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const tanV = () => 0.45 / Math.max(camera.aspect, 0.75);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.enabled = false;
  const view = createView(renderer, scene, camera, { radius: 0.025, strength: 0.7 });

  let unit = 0.5, size = { w: 1, h: 1 };
  // u: HUD scale, 1 = sizes of a 1920 x 1080 frame
  function resize(w, h, u) {
    size = { w, h };
    unit = u;
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV()));
    // a tall screen: lift the picture so the cars sit between the title and the graph or terminal;
    // a wide one: move it left, out from under the terminal in the right column
    if (camera.aspect < 0.8) camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    else camera.setViewOffset(w, h, w * 0.12, 0, w, h);
    camera.updateProjectionMatrix();
    sizeGraph();
  }

  // ------------------------------------------------------------
  // Course: start board 300x600 + slope board 300x800 on two hinges, height blocks, stoppers, tape
  // Built for any slope angle; every material ends up as one merged mesh.
  // ------------------------------------------------------------
  const MDF_TOP = new THREE.MeshStandardMaterial({ ...mdfMaps([0.30, 0.19, 0.10], [0.47, 0.32, 0.18], 160, 1), roughness: 0.78, normalScale: new THREE.Vector2(0.15, 0.15) });
  const MDF_EDGE = new THREE.MeshStandardMaterial({ ...mdfMaps([0.20, 0.12, 0.06], [0.34, 0.22, 0.12], 96, 7), roughness: 0.9, normalScale: new THREE.Vector2(0.3, 0.3) });
  const STEEL = new THREE.MeshStandardMaterial({ color: lin(0.78, 0.79, 0.8), metalness: 1, roughness: 0.22 });
  const GLUE = new THREE.MeshPhysicalMaterial({ color: lin(0.95, 0.95, 0.92), roughness: 0.15, transparent: true, opacity: 0.8 });
  const FOAM = new THREE.MeshStandardMaterial({ color: lin(0.94, 0.94, 0.95), roughness: 0.85 });
  const TAPE = new THREE.MeshStandardMaterial({ color: lin(0.86, 0.80, 0.62), roughness: 0.7 });

  let C = null;                      // course numbers for the current angle
  const courseGroup = new THREE.Group();
  scene.add(courseGroup);

  function courseNumbers(deg) {
    const TH = rad(deg);
    const Z_TOP = L_SLOPE * Math.sin(TH) + T / Math.cos(TH);
    return { deg, TH, Z_TOP, BLOCK_H: Z_TOP - T, X_END: L_SLOPE * Math.cos(TH) };
  }

  function buildCourse() {
    for (const m of courseGroup.children) m.geometry.dispose();
    courseGroup.clear();
    const { TH, Z_TOP, BLOCK_H, X_END } = C;
    const parts = { top: [], edge: [], steel: [], glue: [], foam: [], tape: [] };
    let seed = 0;
    // place a geometry (built in three.js axes) at a Blender location, tilted about Blender Y
    const put = (geo, loc, tilt = 0) => geo.applyMatrix4(new THREE.Matrix4().compose(P(...loc), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tilt), new THREE.Vector3(1, 1, 1)));
    const board = (size, loc, tilt = 0) => {
      const g = new THREE.BoxGeometry(size[0], size[2], size[1]);
      worldUV(g, (seed++ * 0.37) % 1);
      // box faces 2 and 3 (+Y, -Y) are the top and bottom: MDF surface; the rest are cut edges
      for (const grp of g.groups) {
        const sub = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) sub.setAttribute(k, g.attributes[k]);
        sub.setIndex(Array.from(g.index.array.slice(grp.start, grp.start + grp.count)));
        parts[grp.materialIndex === 2 || grp.materialIndex === 3 ? 'top' : 'edge'].push(put(sub.toNonIndexed(), loc, tilt));
      }
    };
    const box = (list, size, loc, tilt = 0) => list.push(put(new THREE.BoxGeometry(size[0], size[2], size[1]), loc, tilt));
    const cylY = (list, r, h, loc, tilt = 0, seg = 24) => list.push(put(new THREE.CylinderGeometry(r, r, h, seg), loc, tilt));
    for (const y0 of Object.values(LANE_Y)) {
      board([L_START, W, T], [-L_START / 2, y0, Z_TOP - T / 2]);
      const [cx, cz] = rotY(TH, L_SLOPE / 2, -T / 2);
      board([L_SLOPE, W, T], [cx, y0, Z_TOP + cz], TH);
      for (const bx of [-0.50, -0.12]) board([0.10, W - 0.02, BLOCK_H], [bx, y0, BLOCK_H / 2]);
      for (const dy0 of [0.105, -0.105]) {
        const hy = y0 + dy0;
        parts.steel.push(put(new THREE.CylinderGeometry(0.0024, 0.0024, 0.039, 24).rotateX(Math.PI / 2), [0, hy, Z_TOP + 0.0022]));
        box(parts.steel, [0.0150, 0.039, 0.0008], [-0.0080, hy, Z_TOP + 0.0004]);
        const [wx, wz] = rotY(TH, 0.0080, 0.0004);
        box(parts.steel, [0.0150, 0.039, 0.0008], [wx, hy, Z_TOP + wz], TH);
        for (const dy of [-0.012, 0.012]) {
          cylY(parts.steel, 0.0019, 0.0012, [-0.0095, hy + dy, Z_TOP + 0.0012], 0, 16);
          const [sx, sz] = rotY(TH, 0.0095, 0.0012);
          cylY(parts.steel, 0.0019, 0.0012, [sx, hy + dy, Z_TOP + sz], TH, 16);
        }
        for (const [gx, gy] of [[-0.020, 0.024], [-0.018, -0.022], [0.021, 0.02]]) {
          const gz = Z_TOP + 0.0008 - Math.max(gx, 0) * Math.tan(TH);
          parts.glue.push(put(new THREE.SphereGeometry(0.0035, 16, 10).scale(1.3, 0.45, 1.0), [gx, hy + gy, gz]));
        }
      }
      for (const sy of [0.125, -0.125]) box(parts.foam, [0.04, 0.04, 0.010], [X_END + 0.024, y0 + sy, 0.005]);
      box(parts.tape, [0.05, 0.21, 0.0003], [X_END + 0.02, y0, 0.00015]);
    }
    const mats = { top: MDF_TOP, edge: MDF_EDGE, steel: STEEL, glue: GLUE, foam: FOAM, tape: TAPE };
    for (const [k, geos] of Object.entries(parts)) {
      const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      const mesh = new THREE.Mesh(mergeGeometries(flat), mats[k]);
      mesh.castShadow = mesh.receiveShadow = true;
      courseGroup.add(mesh);
    }
  }

  // ------------------------------------------------------------
  // Driving simulation (same equations as simulate() in the Blender script)
  // target speed = 0.32 - 0.006 x slope angle (flat below 3 deg, lower limit 0.10), as in prj_test3;
  // over target + 0.03 -> short-circuit brake with the firmware's PWM rule (P + I), see simulate().
  // ------------------------------------------------------------
  function surfaceZ(x) {
    const { TH, Z_TOP, X_END } = C;
    if (x <= 0) return Z_TOP;
    if (x <= X_END) return Z_TOP - x * Math.tan(TH);
    if (x <= X_END + 0.04) return T * (1 - (x - X_END) / 0.04);   // 6 mm step covered by masking tape
    return 0;
  }
  let XS, S_TAB;
  function buildArcTable() {
    const n = Math.floor((C.X_END + 1.6) / 0.0005);
    XS = new Float64Array(n); S_TAB = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      XS[i] = -0.62 + i * 0.0005;
      if (i) S_TAB[i] = S_TAB[i - 1] + Math.hypot(XS[i] - XS[i - 1], surfaceZ(XS[i]) - surfaceZ(XS[i - 1]));
    }
  }
  function xAt(s) {
    let lo = 0, hi = S_TAB.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S_TAB[mid] < s) lo = mid; else hi = mid; }
    const f = (s - S_TAB[lo]) / Math.max(S_TAB[hi] - S_TAB[lo], 1e-9);
    return XS[lo] + f * (XS[hi] - XS[lo]);
  }
  // rear wheel contact at s, caster contact one wheelbase ahead -> body position and pitch (nose down = +)
  function pose(s) {
    const xr = xAt(s), zr = surfaceZ(xr);
    let xf = xr + WB;
    for (let i = 0; i < 30; i++) xf += (WB - Math.hypot(xf - xr, surfaceZ(xf) - zr)) * 0.9;
    return { xr, zr, pitch: Math.atan2(zr - surfaceZ(xf), xf - xr) };
  }
  // One run. Every 20 ms the firmware's control step runs as in prj_test3.ino: target speed (dropping
  // at once, recovering at 0.3 m/s per s), then D / C / B and the brake PWM (P + I, raised at most
  // 25 per step). In between, the car moves under gravity and the chosen output:
  //   D: the motor pulls the speed towards 0.28 m/s (throttle 190 on the flat)
  //   C: output off, only the gearbox drag
  //   B: drag plus short-circuit braking, which grows with the PWM and with the wheel speed
  // stopRun() brakes at 255 for 1 s, then cuts the output. out.ctl keeps every control step for the log.
  // stopAt: run time (s) of a manual stop ('x' from the terminal); out.stop = step where stopping began
  function simulate(control, S0, stopAt = Infinity) {
    const RUN_DIST = 1.6, CTRL_DT = 0.02;              // RUN_DIST_M: start board + slope board
    let t = 0, s = S0, v = 0, stopping = false, tStop = 0, nextCtl = 0, k = 0;
    let state = 'D', pwm = FW.THROTTLE, brakePwm = 0, brakeI = 0, vt = FW.V_BASE;
    const out = { s: [], v: [], deg: [], brake: [], ctl: [], stop: -1, reason: '' };
    for (;;) {
      const { pitch } = pose(s);
      const deg = THREE.MathUtils.radToDeg(pitch);
      if (!stopping && t >= nextCtl - 1e-9) {
        nextCtl += CTRL_DT;
        if (s - S0 >= RUN_DIST || t >= stopAt) {
          stopping = true;
          tStop = t;
          out.stop = out.s.length;
          out.reason = t >= stopAt ? '수동 정지' : '주행 거리 도달';   // the firmware's own stop messages
        } else {
          const want = target(deg);
          vt = want < vt ? want : Math.min(want, vt + FW.RECOVER * CTRL_DT);
          if (!control) { state = 'D'; pwm = FW.THROTTLE; }
          else {
            const over = v - vt;
            if (over > -FW.MARGIN) brakeI = clamp(brakeI + FW.KI * over * CTRL_DT, 0, FW.MAX);
            if (over > FW.MARGIN) {
              const w = clamp(Math.trunc(FW.KP * over + brakeI), 0, FW.MAX);
              brakePwm = w > brakePwm + FW.STEP ? brakePwm + FW.STEP : w;
              state = 'B'; pwm = brakePwm;
            } else if (over > -FW.MARGIN) {
              if (brakeI >= 1) { brakePwm = Math.trunc(brakeI); state = 'B'; pwm = brakePwm; }
              else { brakePwm = 0; state = 'C'; pwm = 0; }
            } else { brakePwm = 0; brakeI = 0; state = 'D'; pwm = FW.THROTTLE; }
          }
          out.ctl.push({ ms: 20 * k++, deg, v, vt, pwm, state });
        }
      }
      out.s.push(s); out.v.push(v); out.deg.push(deg); out.brake.push(!stopping && state === 'B');
      const aG = G * Math.sin(pitch) * 0.55;            // share of gravity left after wheel and gear inertia
      let acc;
      if (stopping) acc = aG - (t - tStop < 1 ? D_COAST + K_SC : D_COAST) * v - F_STOP;
      else if (state === 'D') acc = aG + C_MOTOR * (V_MOTOR * Math.min(1, t / 0.4) - v);
      else if (state === 'C') acc = aG - D_COAST * v;
      else acc = aG - (D_COAST + (K_SC * pwm) / FW.MAX) * v;
      v = Math.max(0, v + acc * SIM_DT);
      s += v * SIM_DT;
      t += SIM_DT;
      if ((stopping && v <= 0) || t > 20) break;
    }
    return out;
  }

  // ------------------------------------------------------------
  // Kickboards: the same model as the blueprint, merged per material
  // (wheels stay separate so they can turn), used for both cars
  // ------------------------------------------------------------
  const CAR = carGeometry();
  const ledLit = M.led_g.clone();                    // the ON car has its green status LED lit
  ledLit.emissive = new THREE.Color(0x1aff40);
  ledLit.emissiveIntensity = 2.5;

  // the cars get their own copies of the materials: sharing one material between the blueprint
  // scene and this scene (different lights, different render targets) left some pipelines invalid
  const own = new Map();
  const mine = (m) => { if (!own.has(m)) own.set(m, m.clone()); return own.get(m); };
  function makeCar(lit) {
    const car = new THREE.Group();
    const mesh = ({ geometry, material }) => {
      const m = new THREE.Mesh(geometry, lit && material === M.led_g ? ledLit : mine(material));
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    for (const b of CAR.body) car.add(mesh(b));
    const pivots = CAR.wheels.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.copy(w.at);
      for (const g of w.parts) pivot.add(mesh(g));
      car.add(pivot);
      return { pivot, r: w.r };
    });
    scene.add(car);
    return { car, pivots };
  }
  const CARS = { OFF: makeCar(false), ON: makeCar(true) };
  const TAG_LOCAL = P(0.288, 0, 0.26);                 // just above the dashboard

  // ------------------------------------------------------------
  // Timeline: 1-84 course intro, then both cars start together (frames at 24 fps, as in Blender)
  // ------------------------------------------------------------
  let RUNS, LOGS, S0, N_RUN, F_END, camTrack, slopeT, vMax, tMax;
  const frameOf = (t) => 1 + t * FPS;
  const runIndex = (f) => Math.min(Math.max(f - F_RUN - PRE, 0), N_RUN - 1);   // in 24 fps steps, may be fractional
  const sample = (arr, i) => { const k = Math.min(Math.max(i, 0), arr.length - 1), a = Math.floor(k), b = Math.min(a + 1, arr.length - 1); return arr[a] + (arr[b] - arr[a]) * (k - a); };
  const stepsPerFrame = 1 / (SIM_DT * FPS);            // 10 simulation steps per video frame

  // both runs from the start line; a manual stop re-plans them (the part already driven stays the same)
  function plan(stopAt = Infinity) {
    RUNS = { OFF: simulate(false, S0, stopAt), ON: simulate(true, S0, stopAt) };
    LOGS = { OFF: logTrack(RUNS.OFF, 'OFF'), ON: logTrack(RUNS.ON, 'ON') };
    const frames = (r) => Math.ceil(r.s.length / stepsPerFrame);
    N_RUN = Math.max(frames(RUNS.OFF), frames(RUNS.ON));
    F_END = F_RUN + PRE + N_RUN + POST - 1;
    // camera follows the middle of the two cars, smoothed per frame like the Blender keyframes
    // (and rises and falls with them, so a 30° start board does not push them out of the top)
    camTrack = [];
    let sm = null, sz = null;
    for (let f = F_RUN; f <= F_END; f++) {
      const k = runIndex(f);
      const a = pose(sample(RUNS.OFF.s, k * stepsPerFrame)), b = pose(sample(RUNS.ON.s, k * stepsPerFrame));
      const mid = (a.xr + b.xr) / 2 + 0.15, midZ = (a.zr + b.zr) / 2;
      sm = sm === null ? mid : sm + (mid - sm) * 0.12;
      sz = sz === null ? midZ : sz + (midZ - sz) * 0.12;
      camTrack.push({ x: sm, z: sz });
    }
  }

  function rebuild(deg) {
    C = courseNumbers(deg);
    buildCourse();
    buildArcTable();
    let best = 0;
    for (let i = 0; i < XS.length; i++) if (Math.abs(XS[i] - X_START) < Math.abs(XS[best] - X_START)) best = i;
    S0 = S_TAB[best];
    plan();
    // graph scale and the slope band (both cars on the slope until ON leaves it)
    const onSlope = (r) => r.deg.map((g, i) => (g > 3 ? i : -1)).filter((i) => i >= 0);
    const both = [...onSlope(RUNS.OFF), ...onSlope(RUNS.ON)];
    slopeT = [Math.min(...both) * SIM_DT, Math.max(...onSlope(RUNS.ON)) * SIM_DT];
    vMax = Math.max(0.8, Math.ceil(Math.max(...RUNS.OFF.v) * 5 + 0.5) / 5);
    tMax = Math.max(5.5, Math.ceil(N_RUN / FPS * 2) / 2);
    document.querySelectorAll('#angles button').forEach((b) => b.classList.toggle('on', Number(b.dataset.deg) === deg));
    graphBase = null;
  }

  // intro camera keys (Blender frames, location, target), auto-clamped Bezier between them
  const yn = LANE_Y.ON;
  const introKeys = () => [
    [1, [1.45, -1.55, 0.95], [0.10, 0, 0.06]],
    [40, [1.00, -1.20, 0.62], [0.05, 0, 0.08]],
    // the close-up of the hinge keeps its height above the start board, whatever the slope
    [70, [0.20, yn - 0.30, C.Z_TOP + 0.155], [0.0, yn + 0.07, C.Z_TOP]],
    [84, [0.17, yn - 0.27, C.Z_TOP + 0.135], [0.0, yn + 0.08, C.Z_TOP]],
  ];
  function hermite(keys, f, comp) {
    const n = keys.length;
    if (f <= keys[0][0]) return keys[0][comp];
    if (f >= keys[n - 1][0]) return keys[n - 1][comp];
    let i = 0;
    while (keys[i + 1][0] < f) i++;
    const slope = (j) => {
      if (j === 0 || j === n - 1) return keys[j][comp].map(() => 0);
      return keys[j][comp].map((v, c) => {
        const a = keys[j - 1][comp][c], b = keys[j + 1][comp][c];
        return (v - a) * (b - v) <= 0 ? 0 : (b - a) / (keys[j + 1][0] - keys[j - 1][0]);
      });
    };
    const [f0, f1] = [keys[i][0], keys[i + 1][0]], d = f1 - f0, u = (f - f0) / d;
    const m0 = slope(i), m1 = slope(i + 1);
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return keys[i][comp].map((p0, c) => h00 * p0 + h10 * d * m0[c] + h01 * keys[i + 1][comp][c] + h11 * d * m1[c]);
  }

  const lookTarget = new THREE.Vector3();
  function placeCars(f) {
    for (const [run, { car, pivots }] of Object.entries(CARS)) {
      const s = f >= F_RUN ? sample(RUNS[run].s, runIndex(f) * stepsPerFrame) : S0;
      const { xr, zr, pitch } = pose(s);
      car.position.copy(P(xr - REAR_AXLE_X * Math.cos(pitch), LANE_Y[run], zr + REAR_AXLE_X * Math.sin(pitch)));
      car.rotation.z = -pitch;
      for (const { pivot, r } of pivots) pivot.rotation.z = -(s - S0) / r;
    }
  }
  function placeCamera(f) {
    if (f < F_RUN) {
      const keys = introKeys();
      camera.position.copy(P(...hermite(keys, f, 1)));
      lookTarget.copy(P(...hermite(keys, f, 2)));
    } else {
      const k = Math.min(f - F_RUN, camTrack.length - 1), a = Math.floor(k), b = Math.min(a + 1, camTrack.length - 1);
      const sm = camTrack[a].x + (camTrack[b].x - camTrack[a].x) * (k - a);
      const zc = camTrack[a].z + (camTrack[b].z - camTrack[a].z) * (k - a);
      camera.position.copy(P(sm - 0.12, -1.50, 0.56 + 0.8 * zc));
      lookTarget.copy(P(sm, 0, 0.08 + 0.8 * zc));
    }
    camera.lookAt(lookTarget);
  }

  // ------------------------------------------------------------
  // HUD: intro captions, speed tags that follow each car, speed graph
  // ------------------------------------------------------------
  const tags = { OFF: $('tag-OFF'), ON: $('tag-ON') };
  const linkSvg = $('link'), linkPath = linkSvg.querySelector('path'), termEl = $('term');
  const lower = $('lower');
  const graphCanvas = $('graph').querySelector('canvas');
  const gctx = graphCanvas.getContext('2d');
  let graphBase = null;
  // the canvas follows the box the page gives the graph (it is full width on a phone)
  function sizeGraph() {
    const r = window.devicePixelRatio || 1, box = $('graph').getBoundingClientRect();
    graphCanvas.width = Math.max(1, Math.round((box.width || 572 * unit) * r));
    graphCanvas.height = Math.max(1, Math.round((box.width || 572 * unit) * (330 / 572) * r));
    graphBase = null;
  }
  const GP = { x0: 64, y0: 58, x1: 572 - 24, y1: 330 - 50 };
  const gx = (t) => GP.x0 + (GP.x1 - GP.x0) * t / tMax;
  const gy = (v) => GP.y1 - (GP.y1 - GP.y0) * v / vMax;
  function drawGraphBase() {
    const c = document.createElement('canvas');
    c.width = graphCanvas.width; c.height = graphCanvas.height;
    const g = c.getContext('2d'), k = c.width / 572;
    g.scale(k, k);
    const font = (w, px) => `${w} ${px}px 'Malgun Gothic', system-ui, sans-serif`;
    g.fillStyle = '#121216'; g.font = font(700, 22); g.textBaseline = 'top';
    g.fillText('속도 (m/s)', 22, 18);
    // slope band
    g.fillStyle = 'rgba(253, 243, 212, 0.92)';
    g.fillRect(gx(slopeT[0]), GP.y0, gx(slopeT[1]) - gx(slopeT[0]), GP.y1 - GP.y0);
    g.fillStyle = '#966e00'; g.font = font(400, 16); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`경사 ${C.deg}° 구간`, (gx(slopeT[0]) + gx(slopeT[1])) / 2, GP.y0 + 13);
    // grid and axes
    g.font = font(400, 15); g.fillStyle = '#787c84'; g.textAlign = 'right';
    for (let v = 0.2; v <= vMax + 1e-6; v += 0.2) {
      g.strokeStyle = '#e8eaee'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(GP.x0, gy(v)); g.lineTo(GP.x1, gy(v)); g.stroke();
      g.fillText(v.toFixed(1), GP.x0 - 10, gy(v));
    }
    g.strokeStyle = '#c8cbd0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(GP.x0, GP.y1); g.lineTo(GP.x1, GP.y1); g.stroke();
    g.textAlign = 'center';
    for (let t = 0; t <= tMax; t++) g.fillText(String(t), gx(t), GP.y1 + 15);
    g.textAlign = 'right';
    g.fillText('시간 (s)', GP.x1, GP.y1 + 34);
    // target speed (dashed)
    const vt = target(C.deg);
    g.strokeStyle = '#8a8e96'; g.lineWidth = 2; g.setLineDash([10, 8]);
    g.beginPath(); g.moveTo(GP.x0, gy(vt)); g.lineTo(GP.x1, gy(vt)); g.stroke();
    g.setLineDash([]);
    // legend, in the colours of the speed tags: OFF dark grey, ON green, the target a neutral dashed line
    const legend = [['OFF', '#464a52', 4], ['ON', '#22a050', 5], [`목표 ${vt.toFixed(2)}`, '#8a8e96', 2]];
    g.textAlign = 'left'; g.font = font(400, 16); g.fillStyle = '#787c84';
    legend.forEach(([lab, col, w], i) => {
      const x = 230 + i * 92;
      g.strokeStyle = col; g.lineWidth = w;
      g.setLineDash(i === 2 ? [6, 5] : []);
      g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 24, 30); g.stroke();
      g.fillText(lab, x + 30, 30);
    });
    g.setLineDash([]);
    graphBase = c;
  }
  function drawGraph(tRun) {
    if (!graphBase) drawGraphBase();
    const g = gctx, k = graphCanvas.width / 572;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    g.drawImage(graphBase, 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineJoin = g.lineCap = 'round';
    for (const [run, col, w] of [['OFF', '#464a52', 4], ['ON', '#22a050', 5]]) {
      const v = RUNS[run].v, n = Math.min(v.length, Math.floor(tRun / SIM_DT) + 1);
      if (n < 2) continue;
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath();
      for (let i = 0; i < n; i += 4) (i ? g.lineTo : g.moveTo).call(g, gx(i * SIM_DT), gy(v[i]));
      g.lineTo(gx((n - 1) * SIM_DT), gy(v[n - 1]));
      g.stroke();
    }
  }

  const tmp = new THREE.Vector3();
  function updateHud(f) {
    const hudAlpha = smooth((f - F_RUN) / 8);
    for (const id of ['graph', 'foot']) $(id).style.opacity = hudAlpha;
    // intro captions
    let cap = null, a = 0;
    if (f < 54) { cap = ['경사로 코스', 'MDF 출발대 300×600 + 경사판 300×800']; a = smooth((f - 6) / 10) * (1 - smooth((f - 44) / 8)); }
    else if (f < F_RUN + 4) {
      cap = ['스텐 미니 경첩 2개', C.deg === 10 ? '높이 블록으로 각도 조절 (블록 1개 = 10°)' : `높이 블록으로 각도 조절 (지금 ${C.deg}°)`];
      a = smooth((f - 54) / 10) * (1 - smooth((f - F_RUN + 2) / 4));
    }
    if (cap) { lower.children[0].textContent = cap[0]; lower.children[1].textContent = cap[1]; }
    lower.style.opacity = a;
    if (hudAlpha <= 0) { for (const t of Object.values(tags)) t.style.opacity = 0; linkSvg.style.opacity = 0; return; }
    // speed tags above the dashboards
    const { w, h } = size;
    const k = runIndex(f), i = k * stepsPerFrame, raw = (f - F_RUN - PRE) * stepsPerFrame;
    const tw = 232 * unit, th = 50 * unit, full = tw + 76 * unit;   // tag width with the brake chip
    const pos = {};
    for (const run of ['ON', 'OFF']) {
      tmp.copy(TAG_LOCAL).applyMatrix4(CARS[run].car.matrixWorld).project(camera);
      const sx = (tmp.x + 1) / 2 * w, sy = (1 - tmp.y) / 2 * h;
      pos[run] = { sx, x0: Math.min(Math.max(sx - tw / 2, 12 * unit), w - tw - 90 * unit), y0: Math.max(sy - 14 * unit - th, 12 * unit) };
    }
    // the back car's tag moves up when it would sit on top of the front car's tag
    const on = pos.ON, off = pos.OFF;
    if (Math.abs(on.x0 - off.x0) < full && off.y0 > on.y0 - th - 8 * unit) off.y0 = Math.max(on.y0 - th - 8 * unit, 12 * unit);
    for (const [run, el] of Object.entries(tags)) {
      const r = RUNS[run], { sx, x0, y0 } = pos[run];
      const live = raw >= 0 && raw < r.v.length;      // a car that has stopped shows 0.00, as in the video
      el.style.transform = `translate(${x0}px, ${y0}px)`;
      el.style.setProperty('--px', `${sx - x0}px`);
      el.style.opacity = hudAlpha;
      el.querySelector('.v').textContent = (live ? sample(r.v, i) : 0).toFixed(2);
      // the brake chip follows the same state the terminal prints (B = braking)
      el.classList.toggle('braking', live && LOGS[run].rows[Math.floor((i * SIM_DT * 1000) / 20)]?.state === 'B');
    }
    // the car the terminal listens to (the switch read at the start of a run, else the switch now):
    // a Bluetooth badge on its tag, and a dotted line from that badge to the terminal
    const linked = phase === 'run' || phase === 'count' ? runMode : sw;
    for (const [run, el] of Object.entries(tags)) el.classList.toggle('linked', run === linked);
    const tr = termEl.getBoundingClientRect();
    if (tr.width > 0) {
      const ax = pos[linked].x0 + tw, ay = pos[linked].y0;          // the badge, top right of the tag
      const tall = tr.top > ay + 40 && tr.left < ax;               // terminal below the cars (a tall phone)
      const bx = tall ? tr.left + tr.width * 0.5 : tr.left, by = tall ? tr.top : tr.top + 20;
      linkPath.setAttribute('d', tall
        ? `M${ax} ${ay} C${ax + 60} ${ay} ${bx} ${by - 80} ${bx} ${by}`
        : `M${ax} ${ay} C${(ax + bx) / 2} ${ay} ${(ax + bx) / 2} ${by} ${bx} ${by}`);
      linkSvg.style.opacity = hudAlpha;
      linkSvg.classList.toggle('live', phase === 'run');
    } else linkSvg.style.opacity = 0;
    drawGraph(Math.max(0, (f - F_RUN - PRE) / FPS));
  }

  // ------------------------------------------------------------
  // What the firmware prints every 20 ms during a run (prj_test3 log format), from the control steps
  // simulate() kept. roll and yaw are a small made-up sensor wobble: simulated, not measured.
  // ------------------------------------------------------------
  const LOG_HEAD = 't_ms,mode,slope,roll,speed,target,pwm,state,yaw,heading';
  function logTrack(r, mode) {
    const rows = [], seed = mode === 'ON' ? 0 : 2.1;
    let heading = 0, vmax = 0;
    for (const { ms, deg, v, vt, pwm, state } of r.ctl) {
      const roll = 0.3 * Math.sin(ms * 0.013 + seed) + 0.2 * Math.sin(ms * 0.051 + 1.3);
      const yaw = 0.4 * Math.sin(ms * 0.021 + 0.7 + seed) + 0.2 * Math.sin(ms * 0.067);
      heading += yaw * 0.02;
      vmax = Math.max(vmax, v);
      rows.push({ ms, state, text: [ms, mode, deg.toFixed(1), roll.toFixed(1), v.toFixed(3), vt.toFixed(3), pwm, state, yaw.toFixed(1), heading.toFixed(1)].join(',') });
    }
    const endMs = rows.length ? rows[rows.length - 1].ms : 0;
    const dist = r.s[r.s.length - 1] - S0;
    return {
      rows, endMs, reason: r.reason || '주행 거리 도달',
      summary: `요약: 경사로, 모드 ${mode}, 최고 속도 ${vmax.toFixed(3)} m/s, 주행 거리 ${dist.toFixed(2)} m, 회전각 ${heading.toFixed(1)}도, IMU 버린 샘플 0개`,
    };
  }

  // ------------------------------------------------------------
  // Run phases, like the real car: the course intro plays, the cars wait on the start line,
  // 's' from the terminal gives the 3 s countdown with beeps, then both cars run.
  // Pausing freezes time; while nothing moves the camera can be dragged.
  // ------------------------------------------------------------
  const READY_F = F_RUN + PRE;
  let t = 0, playing = false, active = false, phase = 'intro', countT = 0, beeps = 0;
  let sw = 'ON', runMode = 'ON', nextRow = 0, endPrinted = true, busy = null, stopQueued = false, connected = false;
  const moving = () => phase === 'intro' || phase === 'count' || phase === 'run';
  const playBtn = $('play'), skipBtn = $('skip'), count = createCountdown($('count')), swBtn = $('term-sw');
  const cueBtn = document.querySelector('#term [data-cmd="s"]');
  // the buttons fade out while something moves and the mouse rests, so they stay off the slide
  const bar = $('bar');
  let idleTimer = 0;
  function wake() {
    if (!active) return;
    bar.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (playing && moving()) bar.classList.add('idle'); }, 2500);
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(ev, wake);
  function refreshUI() {
    playBtn.hidden = !moving();
    playBtn.textContent = playing ? '일시정지' : '재생';
    skipBtn.hidden = phase !== 'intro';
    playBtn.parentElement.hidden = playBtn.hidden && skipBtn.hidden;   // no empty pill in the bar
    cueBtn?.classList.toggle('cue', active && (phase === 'ready' || phase === 'done'));
    const free = active && (!playing || !moving());
    if (free && !controls.enabled) controls.target.copy(lookTarget);
    controls.enabled = free;
    wake();
  }
  function setPlaying(on) { playing = on; refreshUI(); }
  playBtn.onclick = () => setPlaying(!playing);
  skipBtn.onclick = () => toReady();
  for (const deg of ANGLES) {
    const b = Object.assign(document.createElement('button'), { textContent: `${deg}°` });
    b.dataset.deg = deg;
    b.onclick = () => { rebuild(deg); toReady(); };   // another ramp angle: back to the start line
    $('angles').append(b);
  }
  window.addEventListener('keydown', (e) => {
    if (!active || e.target.closest?.('input')) return;
    if (e.code === 'Space' && moving()) { e.preventDefault(); setPlaying(!playing); }
  });
  // the slide switch on the dashboard: read when a run starts, like the firmware does
  swBtn.onclick = () => { sw = sw === 'ON' ? 'OFF' : 'ON'; swBtn.textContent = `스위치 ${sw}`; };

  // the cars on the start line, waiting for 's' (quiet: no "ready" call, used when a run starts)
  function toReady(quiet = false) {
    phase = 'ready';
    playing = true;
    count.hide();
    plan();                                            // a fresh run (undoes a manual stop)
    t = (READY_F - 1) / FPS;
    placeCars(READY_F);
    placeCamera(READY_F);
    controls.enabled = false;
    refreshUI();
    if (!quiet) onReady();
  }

  // ------------------------------------------------------------
  // The car's side of the Bluetooth terminal: the commands and messages of prj_test3.ino
  // ------------------------------------------------------------
  let audio = null;
  function unlockAudio() {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  }
  function beep(ms) {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'square';
    o.frequency.value = 2400;                          // an active buzzer sounds around 2 to 3 kHz
    g.gain.value = 0.04;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  }
  const say = (text) => term.print(text);
  function printStatus() {
    const f = frameOf(t), s = f >= F_RUN ? sample(RUNS[sw].s, runIndex(f) * stepsPerFrame) : S0;
    const deg = THREE.MathUtils.radToDeg(pose(s).pitch);
    say(`[상태] 스위치 제어 ${sw}, 경사각 ${deg.toFixed(1)}도, 좌우각 0.0도, 방향 0.0도, IMU 버린 샘플 0개, 블루투스 연결됨`);
    say('[명령] s 경사로, f 직진, t 회전, x 정지, c 영점, i IMU 점검, l 왼쪽 바퀴, r 오른쪽 바퀴, ? 상태');
  }
  function connect() {
    if (connected) return;
    connected = true;
    term.print('SlopeGuard_5에 연결하는 중...', 'sys');
    setTimeout(() => { term.print('연결됨', 'sys'); say('블루투스 연결됨'); printStatus(); }, 700);
  }
  // a blocking step of the firmware (calibration, IMU check, wheel test): other commands wait
  function block(ms, done, kind = '') {
    const t0 = performance.now();
    busy = { kind, t0, done, timer: setTimeout(() => { busy = null; done(ms); }, ms) };
  }
  function imuCheck() {
    say('I2C 장치: 0x68 (MPU6050은 0x68, 0x69만 나오면 AD0 핀이 VCC에 닿은 것)');
    say('WHO_AM_I 0x68 (MPU6050이면 0x68)');
    say('설정 쓰기 성공');
    for (let k = 0; k < 5; k++) {
      setTimeout(() => {
        const w = (a, p) => a * Math.sin(k * 1.7 + p);
        const ax = w(0.01, 0), ay = w(0.01, 1), az = 1 + w(0.004, 2), mag = Math.hypot(ax, ay, az);
        say(`ax ${ax.toFixed(2)}, ay ${ay.toFixed(2)}, az ${az.toFixed(2)} g (크기 ${mag.toFixed(2)}), gx ${w(0.3, 3).toFixed(1)}, gy ${w(0.3, 4).toFixed(1)}, gz ${w(0.2, 5).toFixed(1)} deg/s, 판정 정상`);
      }, 50 + k * 100);
    }
    block(560, () => {});
  }
  function wheelTest(left) {
    say(`${left ? '왼쪽' : '오른쪽'} 바퀴 테스트 (2.0초)`);
    // lifted wheel at throttle 190, 20 slots per turn of a 65 mm wheel
    const done = (ms) => {
      const n = Math.round((Math.min(ms, 2000) / 1000) * V_MOTOR / (Math.PI * 0.065 / 20));
      say(`펄스 수: 왼쪽 ${left ? n : 0}개, 오른쪽 ${left ? 0 : n}개`);
    };
    block(2300, done, 'wheel');
  }
  function startRun() {
    unlockAudio();
    if (phase !== 'ready') toReady(true);
    runMode = sw;
    say(`경사로 주행, 제어 ${runMode}`);
    phase = 'count';
    countT = 0; beeps = 0; stopQueued = false;
    refreshUI();
  }
  function stepCount(dt) {
    countT += dt;
    while (beeps < 3 && countT >= beeps) { beep(150); beeps++; }
    if (countT < 3) { count.show(3 - Math.min(2, Math.floor(countT))); return; }
    count.go();
    phase = 'run';
    nextRow = 0; endPrinted = false;
    say(LOG_HEAD);
    refreshUI();
    if (stopQueued) manualStop();
  }
  // 'x': both cars brake from this moment; the run is planned again from here
  function manualStop() {
    const tr = Math.max(0, runIndex(frameOf(t)) / FPS);
    if (tr * 1000 < LOGS[runMode].endMs) plan(tr);
  }
  function emitLog(nowMs) {
    const L = LOGS[runMode];
    while (nextRow < L.rows.length && L.rows[nextRow].ms <= nowMs) say(L.rows[nextRow++].text);
    // the firmware brakes for 1 s before it prints why it stopped and the summary
    if (!endPrinted && nowMs >= L.endMs + 1000) { endPrinted = true; say(L.reason); say(L.summary); }
  }
  function command(c) {
    const running = phase === 'run' || phase === 'count';
    if (busy) {
      if (c === 'x' && busy.kind === 'wheel') {
        clearTimeout(busy.timer);
        const { done, t0 } = busy;
        busy = null;
        done(performance.now() - t0);
      }
      return;
    }
    if (phase === 'count') { if (c === 'x') stopQueued = true; return; }   // the countdown blocks; 'x' waits
    if (c === 's' && !running) startRun();
    else if (c === 'x' && phase === 'run') manualStop();
    else if (c === 'c' && !running) block(2050, () => say('보정 완료 (정상 샘플 200/200)'));
    else if (c === 'i' && !running) imuCheck();
    else if ((c === 'l' || c === 'r') && !running) wheelTest(c === 'l');
    else if (c === '?') printStatus();
    else if ((c === 'f' || c === 't') && !running) term.print('t는 03 회전 코스, f는 04 전도 상황 화면에서 해 볼 수 있어요', 'sys');
  }

  rebuild(10);
  placeCars(1);
  placeCamera(1);

  // ------------------------------------------------------------
  // Mode hooks and the frame step
  // ------------------------------------------------------------
  function enter() {
    active = true;
    t = 0;
    phase = 'intro';
    playing = true;
    count.hide();
    plan();
    placeCars(1);
    placeCamera(1);
    controls.enabled = false;
    refreshUI();
    connect();
  }
  function exit() {
    active = false;
    playing = false;
    controls.enabled = false;
    clearTimeout(idleTimer);
    count.hide();
    cueBtn?.classList.remove('cue');
  }

  const statsEl = $('sim-stats');
  let frames = 0, fpsT = performance.now();
  function frame(now, dt) {
    if (playing) {
      if (phase === 'intro') { t += dt; if (frameOf(t) >= READY_F) toReady(); }
      else if (phase === 'count') stepCount(dt);
      else if (phase === 'run') {
        t += dt;
        if (frameOf(t) >= F_END) { t = (F_END - 1) / FPS; phase = 'done'; emitLog(Infinity); refreshUI(); onStop(); }
      }
    }
    const f = frameOf(t);
    if (phase === 'run') emitLog((runIndex(f) / FPS) * 1000);
    term.flush();
    placeCars(f);
    if (controls.enabled) controls.update(); else placeCamera(f);
    aimSun(lookTarget.x);
    view.render();
    updateHud(f);
    frames++;
    if (now - fpsT > 500) {
      const fps = Math.round(frames * 1000 / (now - fpsT));
      frames = 0; fpsT = now;
      const info = renderer.info.render;
      statsEl.textContent = `그리기 호출 ${info.drawCalls ?? info.calls}회, ${fps} fps, ${backend}`;
    }
  }

  return { scene, camera, resize, enter, exit, frame, setPlaying, rebuild, command, runs: () => RUNS, setHQ: (on) => view.set(on) };
}
