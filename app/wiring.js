// ============================================================
// Jumper wires between the pins listed in kickboard.js (PINS).
// Which pin goes to which follows the circuit diagram (전체 배선도.png) and the
// firmware pin map; the paths are drawn by hand around the parts and the
// edges of the deck and the dashboard (the real model has no wire holes).
// Colours follow the diagram legend. Wires are merged per colour, and
// pick() tells which wire a hit triangle belongs to.
// ============================================================
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, PINS, DASH } from './kickboard.js';

export const WIRE_KINDS = {
  bat: { name: '배터리 7.4V', color: '#d62828' },
  v5: { name: '5V', color: '#f08a00' },
  v33: { name: '3V3', color: '#c9a000' },
  gnd: { name: 'GND', color: '#26262a' },
  mot: { name: '모터 출력', color: '#8a5a44' },
  ctl: { name: '모터 제어', color: '#1f5fbf' },
  sen: { name: '속도센서', color: '#22a03c' },
  i2c: { name: 'I2C', color: '#0f9aa8' },
  io: { name: 'LED, 부저, 스위치', color: '#8e44c4' },
};
const R = 0.65;                                        // jumper wire radius (mm)

const at = (key) => {
  if (typeof key !== 'string') return key;
  if (!PINS[key]) throw new Error(`unknown pin ${key}`);
  return PINS[key];
};
const lead = (q, k) => q.p.map((c, i) => c + q.d[i] * k);
const x = (key) => at(key).p[0];

export function buildWires() {
  const list = [];
  const wire = (kind, label, from, to, via = []) => list.push({ kind, label, from: at(from), to: at(to), via });
  const BB = (bx, by) => ({ p: [bx, by, DASH.bbTop], d: [0, 0, 1] });     // a breadboard hole, wire plugged from above
  const shift = (key, dz) => ({ p: [...at(key).p.slice(0, 2), at(key).p[2] + dz], d: at(key).d });

  // ---------------- power: battery to the L298N, L298N 5V and the capacitor to the ESP32 ----------------
  wire('bat', '배터리 + → L298N 12V', 'BAT_P', 'L298_12V', [[153, 3, 66], [165, -9, 70]]);
  wire('gnd', '배터리 − → L298N GND', 'BAT_N', 'L298_GND', [[154, 9, 68], [171, -10, 71]]);
  wire('v5', 'L298N 5V → ESP32 VIN', 'L298_5V', 'ESP_VIN', [[182, -10, 74], [196, 8, 82], [200, 36, 74]]);
  wire('gnd', 'L298N GND → ESP32 GND', shift('L298_GND', 1), 'ESP_GND_L', [[176, -11, 76], [198, 10, 84], [203, 37, 75]]);
  wire('v5', '커패시터 + → ESP32 VIN', 'CAP_P', shift('ESP_VIN', 1.2), [[276, 20, 66], [240, 38, 76], [214, 37, 70]]);
  wire('gnd', '커패시터 − → ESP32 GND', 'CAP_N', shift('ESP_GND_L', 1.2), [[275, 22, 64], [242, 40, 74], [218, 38, 69]]);

  // ---------------- motors: under the deck, out past its left edge, up into the L298N outputs ----------------
  wire('mot', '왼쪽 모터 → L298N OUT1', 'MOT_L_A', 'L298_OUT1', [[100, 30, 38], [138, 46, 42], [150, 47, 58]]);
  wire('mot', '왼쪽 모터 → L298N OUT2', 'MOT_L_B', 'L298_OUT2', [[102, 26, 37], [142, 47, 43], [156, 48, 59]]);
  wire('mot', '오른쪽 모터 → L298N OUT3', 'MOT_R_A', 'L298_OUT3', [[106, -8, 37], [134, 24, 38], [170, 47, 43], [182, 47, 58]]);
  wire('mot', '오른쪽 모터 → L298N OUT4', 'MOT_R_B', 'L298_OUT4', [[108, -12, 37], [138, 22, 39], [174, 48, 44], [188, 48, 59]]);

  // ---------------- motor control: expansion board terminals over to the L298N signal pins ----------------
  for (const [esp, l298] of [['D25', 'ENA'], ['D26', 'IN1'], ['D27', 'IN2'], ['D33', 'ENB']]) {
    wire('ctl', `${esp} → L298N ${l298}`, `ESP_${esp}`, `L298_${l298}`, [[x(`ESP_${esp}`) - 5, 34, 74], [206, 18, 88], [x(`L298_${l298}`) + 3, 6, 82]]);
  }
  for (const [esp, l298, alias] of [['D16', 'IN3', 'RX2'], ['D17', 'IN4', 'TX2']]) {
    wire('ctl', `${esp} (${alias}) → L298N ${l298}`, `ESP_${esp}`, `L298_${l298}`, [[x(`ESP_${esp}`) - 5, -34, 74], [206, -16, 88], [x(`L298_${l298}`) + 3, -7, 82]]);
  }

  // ---------------- speed sensors and the tilt sensor ----------------
  // the sensor headers face the rear edge: the wires leave backwards, climb and turn forward over the boards;
  // along the left edge they keep clear of the L298N heat sink
  const fcUp = (y) => [[0, y, 64], [24, y * 1.1, 72]];
  wire('sen', 'FC-03 왼쪽 DO → D34', 'FC_L_DO', 'ESP_D34', [...fcUp(10.5), [66, 12, 77], [104, 18, 82], [146, 36, 80], [196, 38, 78], [x('ESP_D34') - 6, 37, 72]]);
  wire('sen', 'FC-03 오른쪽 DO → D35', 'FC_R_DO', 'ESP_D35', [...fcUp(-10.5), [66, -12, 77], [104, 2, 84], [146, 35, 82], [196, 39, 78], [x('ESP_D35') - 6, 38, 72]]);
  wire('i2c', 'D21 → MPU6050 SDA', 'ESP_D21', 'MPU_SDA', [[x('ESP_D21') - 4, -34, 74], [226, -26, 86], [186, -20, 84], [170, -18, 74]]);
  wire('i2c', 'D22 → MPU6050 SCL', 'ESP_D22', 'MPU_SCL', [[x('ESP_D22') - 4, -34, 75], [228, -25, 87], [184, -19, 85], [167, -18, 75]]);

  // ---------------- the harness up to the dashboard breadboard ----------------
  // it climbs just outside the plate's right edge (clear of the weights on the mast) and comes over that
  // edge onto the breadboard; 3V3 and GND share two breadboard columns, as the diagram notes
  const [hx, hy] = DASH.riser, top = DASH.plateTop, over = DASH.bbTop + 7;
  const harness = (k, kind, label, from, to, pre) => {
    const ox = ((k % 3) - 1) * 1.5, oy = (Math.floor(k / 3) - 1.5) * 1.5;
    const end = at(to).p;
    const up = [
      [hx + ox, hy + oy, 90], [hx + ox, hy + oy, top - 4], [hx + ox * 0.6, hy + 6 + oy * 0.4, over],
      [(end[0] + hx) / 2, (end[1] + hy + 6) / 2, over + 2],
    ];
    wire(kind, label, from, to, [...pre, ...up]);
  };
  const c33 = 270, cGnd = 273, bb = DASH.bbX0;        // the 3V3 and GND columns at the front right of the breadboard
  const fcRun = (y, z) => [...fcUp(y), [66, y, z], [110, y * 0.6, z + 10], [140, 0, z + 18], [200, -8, z + 22], [258, -20, z + 10]];
  harness(0, 'v33', 'ESP32 3V3 → 계기판 3V3 열', 'ESP_3V3', BB(c33, -15), [[214, -35, 70], [252, -34, 70]]);
  harness(1, 'gnd', 'ESP32 GND → 계기판 GND 열', 'ESP_GND_R', BB(cGnd, -15), [[218, -36, 70], [254, -35, 70]]);
  harness(2, 'io', 'D23 → 초록 LED', 'ESP_D23', BB(bb + 20, DASH.bbY - 3), [[264, -34, 70]]);
  harness(3, 'io', 'D19 → 빨간 LED', 'ESP_D19', BB(bb + 10, DASH.bbY - 3), [[244, -34, 70], [258, -32, 70]]);
  harness(4, 'io', 'D18 → 부저 I/O', 'ESP_D18', 'BZ_IO', [[238, -35, 70], [256, -33, 70]]);
  harness(5, 'io', 'D13 → 스위치', 'ESP_D13', BB(bb + 32, DASH.bbY - 3), [[210, 36, 74], [236, 10, 90], [258, -16, 84]]);
  harness(6, 'v33', 'MPU6050 VCC → 3V3 열', 'MPU_VCC', BB(c33, -12.5), [[158, -16, 78], [200, -24, 90], [256, -28, 84]]);
  harness(7, 'gnd', 'MPU6050 GND → GND 열', 'MPU_GND', BB(cGnd, -12.5), [[161, -16, 79], [202, -23, 91], [257, -27, 85]]);
  harness(8, 'v33', 'FC-03 왼쪽 VCC → 3V3 열', 'FC_L_VCC', BB(c33, -10), fcRun(5.5, 76));
  harness(9, 'gnd', 'FC-03 왼쪽 GND → GND 열', 'FC_L_GND', BB(cGnd, -10), fcRun(8, 77));
  harness(10, 'v33', 'FC-03 오른쪽 VCC → 3V3 열', 'FC_R_VCC', BB(c33, -7.5), fcRun(-5.5, 78));
  harness(11, 'gnd', 'FC-03 오른쪽 GND → GND 열', 'FC_R_GND', BB(cGnd, -7.5), fcRun(-8, 79));
  // the buzzer module sits behind the breadboard; its header points to the right edge of the plate
  wire('v33', '부저 VCC → 3V3 열', 'BZ_VCC', BB(c33, -5), [[224, -21, 224], [250, -16, over + 2], [266, -8, over]]);
  wire('gnd', '부저 GND → GND 열', 'BZ_GND', BB(cGnd, -5), [[226, -21, 225], [252, -15, over + 3], [269, -7, over]]);

  // ---------------- tubes, merged per colour ----------------
  const group = new THREE.Group();
  group.name = '18_배선';
  const byKind = new Map();
  for (const w of list) {
    const pts = [w.from.p, lead(w.from, 4), ...w.via, lead(w.to, 4), w.to.p].map((q) => P(...q));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const seg = Math.min(160, Math.max(16, Math.round(curve.getLength() / 2.5)));
    w.geometry = new THREE.TubeGeometry(curve, seg, R, 6, false);
    w.kindName = WIRE_KINDS[w.kind].name;
    if (!byKind.has(w.kind)) byKind.set(w.kind, []);
    byKind.get(w.kind).push(w);
  }
  for (const [kind, ws] of byKind) {
    const material = new THREE.MeshStandardMaterial({ name: `배선_${WIRE_KINDS[kind].name}`, color: WIRE_KINDS[kind].color, roughness: 0.5 });
    const mesh = new THREE.Mesh(mergeGeometries(ws.map((w) => w.geometry)), material);
    mesh.name = `배선_${WIRE_KINDS[kind].name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    // triangle ranges, in merge order, so a hit can be traced back to its wire
    let t = 0;
    mesh.userData.ranges = ws.map((w) => { const n = w.geometry.index.count / 3, r = { from: t, to: t + n, wire: w }; t += n; return r; });
    group.add(mesh);
  }
  const pick = (hit) => hit.object.userData.ranges?.find((r) => hit.faceIndex >= r.from && hit.faceIndex < r.to)?.wire ?? null;
  return { group, wires: list, pick };
}
