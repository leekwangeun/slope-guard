// ============================================================
// Blueprint viewer: the assembled kickboard with camera stops, explode / flip
// animation, part cards (hover or tap), a parts list, dimension lines, wiring,
// an automatic tour and GLB, STL, PNG export.
// The same scene is the backdrop of the main menu, where it turns slowly.
// ============================================================
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MM, P, lin, model, parts, setTextures, COMPONENTS, DIMS } from './kickboard.js';
import { buildWires } from './wiring.js';
import { createView } from './post.js';

const rad = THREE.MathUtils.degToRad;
const $ = (id) => document.getElementById(id);

export function createBlueprint({ renderer, backend, restoreSize }) {
  const status = (t) => { $('model-status').textContent = t; };

  // ------------------------------------------------------------
  // World, lights, floor
  // ------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = lin(0.8, 0.8, 0.8);
  // the far floor fades into the background, so a tall phone screen shows no horizon line
  scene.fog = new THREE.Fog(scene.background, 2.5, 8);
  // a studio room for reflections on metal and acrylic, kept soft so the look stays close to the Blender scene
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  // sun: Blender rotation (35, 10, -30) deg, shining down its local -Z
  const sunDirBl = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(rad(35), rad(10), rad(-30), 'XYZ'));
  const sunDir = P(sunDirBl.x, sunDirBl.y, sunDirBl.z).normalize();
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.target.position.set(0.15, 0.1, 0);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.003;
  Object.assign(sun.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.5, far: 4 });
  scene.add(sun, sun.target);

  // the two Blender area lights, as soft fills without shadows
  for (const [pos, k] of [[[-0.6, 0.7, 0.7], 0.3], [[-0.5, -0.3, 1.0], 0.45]]) {
    const l = new THREE.DirectionalLight(0xffffff, k);
    l.position.copy(P(...pos));
    l.target.position.copy(P(0.15, 0, 0.15));
    scene.add(l, l.target);
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: lin(0.92, 0.92, 0.92), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.x = 0.15;
  floor.receiveShadow = true;
  scene.add(floor);

  // camera: 50 mm lens on a 36 mm sensor, as in Blender; a tall phone screen keeps most of the width
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const lensFov = () => THREE.MathUtils.radToDeg(2 * Math.atan(0.36 / Math.max(camera.aspect, 0.6)));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotateSpeed = 0.8;              // one turn in 75 s (update() gets the frame time)
  let size = { w: 1, h: 1 };
  function resize(w, h) {
    size = { w, h };
    camera.aspect = w / h;
    camera.fov = lensFov();
    camera.updateProjectionMatrix();
  }
  const view = createView(renderer, scene, camera, { radius: 0.012, strength: 0.75 });

  // ------------------------------------------------------------
  // Assembly root: flip pivot like the Blender empty '모형_전체'
  // ------------------------------------------------------------
  const PIVOT = P(0.15, 0, 0.12);
  const flip = new THREE.Group();
  flip.name = '뒤집기_기준점';
  flip.add(model);
  model.position.copy(PIVOT).negate();
  flip.position.copy(PIVOT);                           // the model's rest pose from the start, before the first applyState
  scene.add(flip);

  // wires live in the model (so they export with it) but only show while it is assembled
  const W = buildWires();
  model.add(W.group);
  let wiresOn = true;

  const state = { explode: 0, flip: 0 };
  const assembled = () => state.explode < 0.02 && state.flip < 0.02;
  // Most tour stops only move the camera (explode and flip stay the same). Then nothing is re-posed and the
  // merged meshes stay on screen, instead of drawing all 161 parts one by one for the whole move.
  let applied = { explode: NaN, flip: NaN };
  function applyState(force = false) {
    if (!force && state.explode === applied.explode && state.flip === applied.flip) return;
    applied = { explode: state.explode, flip: state.flip };
    for (const p of parts) p.o.position.copy(p.base).addScaledVector(p.ex, state.explode);
    flip.rotation.x = Math.PI * state.flip;
    flip.position.copy(PIVOT).add(new THREE.Vector3(0, 0.3 * state.flip, 0));
    W.group.visible = wiresOn && assembled();          // no wires while the model is taken apart
    flip.updateMatrixWorld(true);
    scheduleMerge();
    hiMoved = true;
    // the 조립 / 분해 switch shows which state the model is in, whichever button brought it there
    const apart = state.explode > 0.5;
    if (apart !== shownApart) {
      shownApart = apart;
      document.querySelectorAll('#assembly button').forEach((b) => b.classList.toggle('on', (b.dataset.asm === '1') === apart));
    }
  }
  let shownApart = null;

  // ------------------------------------------------------------
  // Performance: while nothing moves, every part of one material is merged
  // into a single mesh (one draw call per material). While the explode or
  // flip animation runs, the separate parts are drawn instead.
  // ------------------------------------------------------------
  // The merged meshes of each resting state (assembled, exploded, flipped) are kept, so a camera
  // stop that comes back (the automatic tour) shows them again without merging everything anew.
  const mergedByState = new Map();
  let mergeOn = false, mergeTimer = 0;
  function rebuildMerged() {
    // merge only a pose that has been applied; otherwise the parts would be baked where they are not drawn
    if (state.explode !== applied.explode || state.flip !== applied.flip) { applyState(); return; }
    const key = `${state.explode.toFixed(3)},${state.flip.toFixed(3)}`;
    let merged = mergedByState.get(key);
    if (!merged) {
      merged = new THREE.Group();
      merged.name = '합친_메시';
      flip.updateMatrixWorld(true);
      const byMat = new Map();
      for (const p of parts) {
        if (!byMat.has(p.o.material)) byMat.set(p.o.material, []);
        byMat.get(p.o.material).push(p.flat.clone().applyMatrix4(p.o.matrixWorld));
      }
      for (const [m, geos] of byMat) {
        const mesh = new THREE.Mesh(mergeGeometries(geos), m);
        geos.forEach((g) => g.dispose());
        mesh.name = m.name;
        mesh.castShadow = mesh.receiveShadow = true;
        merged.add(mesh);
      }
      scene.add(merged);
      mergedByState.set(key, merged);
      if (mergedByState.size > 6) {                    // only a handful of resting states exist; drop the oldest
        const [oldKey, old] = mergedByState.entries().next().value;
        old.children.forEach((m) => m.geometry.dispose());
        scene.remove(old);
        mergedByState.delete(oldKey);
      }
    }
    for (const g of mergedByState.values()) g.visible = g === merged;
    for (const p of parts) p.o.visible = false;        // the wires stay drawn from the model
  }
  function scheduleMerge() {
    for (const g of mergedByState.values()) g.visible = false;
    for (const p of parts) p.o.visible = true;
    clearTimeout(mergeTimer);
    if (mergeOn) mergeTimer = setTimeout(rebuildMerged, 150);
  }
  function setBatched(on) {
    mergeOn = on;
    scheduleMerge();
  }

  // ------------------------------------------------------------
  // Views: camera stops (metres, Blender axes); most of them show one part group
  // ------------------------------------------------------------
  const V = (label, c, t, explode, flipped, part) => ({ label, cam: P(...c), target: P(...t), explode, flip: flipped, part });
  const VIEWS = {
    home: V('처음', [0.58, -0.44, 0.34], [0.16, 0, 0.09], 0, 0),
    motor: V('뒷바퀴, 모터', [-0.30, -0.18, 0.85], [0.06, 0, 0.42], 1, 1, '03_TT모터_엔코더'),
    caster: V('앞 캐스터', [0.45, -0.22, 0.73], [0.27, 0, 0.51], 1, 1, '06_캐스터'),
    sensor: V('속도센서', [-0.13, -0.22, 0.35], [0.02, 0, 0.18], 1, 0, '04_속도센서_FC03'),
    batt: V('배터리', [0.20, 0.32, 0.42], [0.105, 0, 0.22], 1, 0, '05_배터리_18650x2'),
    l298n: V('L298N', [0.29, 0.30, 0.41], [0.173, 0.0165, 0.245], 1, 0, '08_L298N'),
    mpu: V('MPU6050', [0.25, -0.22, 0.36], [0.1675, -0.039, 0.21], 1, 0, '09_MPU6050'),
    esp: V('ESP32', [0.38, -0.25, 0.47], [0.235, 0, 0.27], 1, 0, '11_ESP32'),
    cap: V('커패시터', [0.39, -0.13, 0.28], [0.287, 0, 0.198], 1, 0, '12_커패시터'),
    weight: V('무게추', [0.64, -0.36, 0.50], [0.383, 0, 0.345], 1, 0, '14_무게추'),
    dash: V('계기판', [0.53, -0.32, 0.62], [0.305, 0, 0.415], 1, 0, '15_계기판_아크릴'),
  };
  // the exploded overview: not a camera stop of its own, but what the 조립 / 분해 switch shows
  const EXPLODED = V('분해', [0.95, -0.78, 0.74], [0.18, 0, 0.26], 1, 0);
  const viewOf = (key) => (key === 'explode' ? EXPLODED : VIEWS[key]);
  // the main menu: assembled, a little further back, turning slowly
  const SHOWCASE = V('메뉴', [0.90, -0.78, 0.51], [0.15, 0, 0.14], 0, 0);
  const SUMMARY = {
    home: { no: 'SG', title: 'Slope Guard 조립 모형', spec: `부품 ${parts.length}개, 데크 ${DIMS.DECK_L} × ${DIMS.DECK_W} mm, 높이 ${DIMS.TOP} mm`, role: '내리막을 느끼면 목표 속도를 낮추고, 그보다 빠르면 전자 제동을 거는 킥보드 모형' },
    explode: { no: '분해', title: '분해도', spec: `부품 묶음 ${Object.keys(COMPONENTS).length}개`, role: '조립 높이 순서대로 띄워 놓은 모습, 부품을 누르면 이름과 역할이 나와요' },
  };

  let tween = null, currentView = 'home';
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function tweenTo(v, instant) {
    tween = { from: { cam: camera.position.clone(), target: controls.target.clone(), explode: state.explode, flip: state.flip }, to: v, t0: performance.now(), dur: instant ? 0 : 1400 };
  }
  // card: show the view's part (or its summary) in the part card
  function goTo(key, instant = false, card = false) {
    currentView = key;
    document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === key));
    const v = viewOf(key);
    tweenTo(v, instant);
    if (card) select(v.part ? { type: 'part', group: v.part } : { type: 'summary', key });
  }
  function stepTween(now) {
    if (!tween) return;
    const k = tween.dur ? ease(Math.min(1, (now - tween.t0) / tween.dur)) : 1;
    const { from, to } = tween;
    camera.position.lerpVectors(from.cam, to.cam, k);
    controls.target.lerpVectors(from.target, to.target, k);
    state.explode = from.explode + (to.explode - from.explode) * k;
    state.flip = from.flip + (to.flip - from.flip) * k;
    applyState();
    if (k >= 1) tween = null;
  }

  // In the menu the picture is shifted right (or up on a narrow screen) so the menu does not cover the model
  let shift = 0, shiftTarget = 0;
  function applyShift() {
    const { w, h } = size;
    if (shift < 0.001) { if (camera.view?.enabled) camera.clearViewOffset(); return; }
    const narrow = w < 760;
    camera.setViewOffset(w, h, narrow ? 0 : -w * 0.19 * shift, narrow ? h * 0.2 * shift : 0, w, h);
  }

  // ------------------------------------------------------------
  // Dimension lines (mm, Blender axes), drawn on the floor and beside the mast.
  // They sit in a group with the model's transform but outside the model, so they are not exported.
  // ------------------------------------------------------------
  const dims = new THREE.Group();
  dims.name = '치수선';
  dims.position.copy(model.position);
  dims.scale.setScalar(MM);
  flip.add(dims);
  const INK = new THREE.MeshBasicMaterial({ color: lin(0.07, 0.07, 0.09) });
  const up = new THREE.Vector3(0, 1, 0);
  function rod(a, b, r = 0.35) {
    const A = P(...a), B = P(...b), d = B.clone().sub(A), len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, 6).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize())).translate(A.x, A.y, A.z);
    return g;
  }
  function tip(at, toward) {
    const A = P(...at), d = P(...toward).sub(A).normalize();
    const g = new THREE.ConeGeometry(1.4, 5, 10).translate(0, -2.5, 0);   // apex at the origin
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.negate())).translate(A.x, A.y, A.z);
    return g;
  }
  const { DECK_L, TRACK, REAR_AXLE_X, WHEELBASE, TOP } = DIMS;
  const z0 = 0.6, FRONT = REAR_AXLE_X + WHEELBASE;
  const DIM_LIST = [
    // `at`: where along the line the label sits, so the two long labels do not stack up
    { a: [0, -96, z0], b: [DECK_L, -96, z0], ext: [[[0, -44, z0], [0, -100, z0]], [[DECK_L, -44, z0], [DECK_L, -100, z0]]], label: `데크 길이 ${DECK_L}`, at: 0.28 },
    { a: [REAR_AXLE_X, -72, z0], b: [FRONT, -72, z0], ext: [[[REAR_AXLE_X, -60, z0], [REAR_AXLE_X, -76, z0]], [[FRONT, -10, z0], [FRONT, -76, z0]]], label: `휠베이스 ${WHEELBASE}`, at: 0.66 },
    { a: [-24, TRACK / 2, z0], b: [-24, -TRACK / 2, z0], ext: [[[-6, TRACK / 2, z0], [-28, TRACK / 2, z0]], [[-6, -TRACK / 2, z0], [-28, -TRACK / 2, z0]]], label: `바퀴 간격 ${TRACK}` },
    { a: [322, 0, 0], b: [322, 0, TOP], ext: [[[298, 0, TOP], [326, 0, TOP]], [[302, 0, z0], [326, 0, z0]]], label: `높이 ${TOP}` },
  ];
  {
    const geos = [];
    for (const d of DIM_LIST) {
      geos.push(rod(d.a, d.b), tip(d.a, d.b), tip(d.b, d.a));
      for (const [p, q] of d.ext) geos.push(rod(p, q, 0.25));
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), INK);
    mesh.name = '치수선';
    dims.add(mesh);
  }
  const dimLayer = $('dim-labels');
  const dimEls = DIM_LIST.map((d) => {
    const el = document.createElement('span');
    el.textContent = d.label;
    dimLayer.append(el);
    const k = d.at ?? 0.5, mid = d.a.map((c, i) => c + (d.b[i] - c) * k);
    return { el, at: P(...mid) };
  });
  let dimsOn = true;
  const tmp = new THREE.Vector3();
  function updateDims() {
    const show = active && dimsOn && assembled() && !tween;
    dims.visible = active && dimsOn && assembled();
    dimLayer.classList.toggle('on', show);
    if (!show) return;
    for (const { el, at } of dimEls) {
      tmp.copy(at).applyMatrix4(dims.matrixWorld).project(camera);
      const behind = tmp.z > 1;
      el.style.transform = `translate(${((tmp.x + 1) / 2) * size.w}px, ${((1 - tmp.y) / 2) * size.h}px) translate(-50%, -50%)`;
      el.style.visibility = behind ? 'hidden' : '';
    }
  }

  // ------------------------------------------------------------
  // Part card and highlight: hover with a mouse, tap on a touch screen.
  // A target is { type: 'part', group } | { type: 'wire', wire } | { type: 'summary', key }.
  // ------------------------------------------------------------
  const partOf = new Map(parts.map((p) => [p.o, p]));
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canvas = renderer.domElement;
  let active = false, hover = null, selected = null, highlightDirty = false;
  const same = (a, b) => a === b || (a && b && a.type === b.type && a.group === b.group && a.wire === b.wire && a.key === b.key);

  function pickAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = parts.map((p) => p.o);
    if (W.group.visible) targets.push(...W.group.children);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (partOf.has(hit.object)) return { type: 'part', group: partOf.get(hit.object).group };
    const wire = W.pick(hit);
    return wire ? { type: 'wire', wire } : null;
  }

  // the highlight is a yellow see-through copy of each highlighted part that shares its geometry and
  // follows its position, so the explode animation (and the tour) never rebuilds anything for it
  const HI = new THREE.MeshBasicMaterial({ color: 0xf2b605, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const hiGroup = new THREE.Group();
  hiGroup.name = '강조';
  scene.add(hiGroup);
  let hiPairs = [], hiMoved = false;
  function rebuildHighlight() {
    highlightDirty = false;
    hiGroup.clear();
    hiPairs = [];
    const t = active ? hover ?? selected : null;
    if (!t || t.type === 'summary') return;
    const src = t.type === 'part'
      ? parts.filter((p) => p.group === t.group).map((p) => [p.o.geometry, p.o])
      : W.group.visible ? [[t.wire.geometry, W.group]] : [];
    for (const [geometry, owner] of src) {
      const m = new THREE.Mesh(geometry, HI);
      m.matrixAutoUpdate = false;
      m.renderOrder = 2;
      hiGroup.add(m);
      hiPairs.push([m, owner]);
    }
    followHighlight();
  }
  function followHighlight() {
    hiMoved = false;
    for (const [m, owner] of hiPairs) { m.matrix.copy(owner.matrixWorld); m.matrixWorldNeedsUpdate = true; }
  }

  const card = $('part-card');
  function showCard() {
    const t = active ? hover ?? selected : null;
    card.hidden = !t;
    if (!t) return;
    let no, title, spec, role;
    if (t.type === 'part') ({ title, spec, role } = COMPONENTS[t.group]), (no = t.group.slice(0, 2));
    else if (t.type === 'wire') {
      no = '선'; title = t.wire.label; spec = `${t.wire.kindName} 배선`;
      role = '핀 연결은 회로 연결도와 같고, 전선이 지나가는 길은 보기 좋게 정리한 것';
    } else ({ no, title, spec, role } = SUMMARY[t.key]);
    card.querySelector('.no').textContent = no;
    card.querySelector('b').textContent = title;
    card.querySelector('.sub').textContent = spec;
    card.querySelector('.role').textContent = role;
    card.classList.toggle('pinned', !hover);
  }
  function setHover(t) {
    if (same(t, hover)) return;
    hover = t;
    canvas.style.cursor = t ? 'pointer' : '';
    highlightDirty = true;
    showCard();
  }
  function select(t) {
    selected = t;
    highlightDirty = true;
    showCard();
    document.querySelectorAll('#bom button').forEach((b) => b.classList.toggle('on', t?.type === 'part' && b.dataset.group === t.group));
  }
  card.querySelector('.x').onclick = () => select(null);

  let pending = null, down = null;
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerType !== 'mouse') return;
    if (e.buttons) { setHover(null); return; }
    pending = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerleave', () => { pending = null; setHover(null); });
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; stopTour(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!active || !down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved < 6) select(pickAt(e.clientX, e.clientY));    // a click or tap, not a drag
  });

  // ------------------------------------------------------------
  // Parts list
  // ------------------------------------------------------------
  const bom = $('bom');
  for (const [group, c] of Object.entries(COMPONENTS)) {
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    b.dataset.group = group;
    const no = Object.assign(document.createElement('span'), { className: 'no', textContent: group.slice(0, 2) });
    const text = document.createElement('span');
    text.append(Object.assign(document.createElement('b'), { textContent: c.title }), Object.assign(document.createElement('small'), { textContent: c.spec }));
    b.append(no, text);
    b.onclick = () => { stopTour(); goTo(c.view); select({ type: 'part', group }); };
    const li = document.createElement('li');
    li.append(b);
    bom.append(li);
  }
  $('bom-count').textContent = `${Object.keys(COMPONENTS).length}종`;

  // ------------------------------------------------------------
  // Automatic tour: every stop in turn with its part card, until the viewer touches anything
  // ------------------------------------------------------------
  const tourBtn = $('tour');
  let tour = null;
  function startTour() {
    tour = { i: 0, next: 0 };
    tourBtn.classList.add('on');
    tourBtn.textContent = '■ 둘러보기 멈춤';
  }
  function stopTour() {
    if (!tour) return;
    tour = null;
    tourBtn.classList.remove('on');
    tourBtn.textContent = '▶ 자동 둘러보기';
  }
  tourBtn.onclick = () => (tour ? stopTour() : startTour());
  controls.addEventListener('start', stopTour);
  // assembled first, then the exploded overview, then each part
  const ORDER = ['home', 'explode', ...Object.keys(VIEWS).filter((k) => k !== 'home')];
  function stepTour(now) {
    if (!tour || now < tour.next) return;
    goTo(ORDER[tour.i % ORDER.length], false, true);
    tour.i++;
    tour.next = now + 4600;
  }

  // ------------------------------------------------------------
  // Export: GLB (metres, materials, wires), STL (mm), PNG at 1920x1080
  // ------------------------------------------------------------
  // serve.py (on this computer) saves into out/; a static host such as GitHub Pages just downloads
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  async function save(blob, name) {
    if (local) {
      try {
        const res = await fetch(`save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
        if (res.ok) return `out/${name}에 저장했어요.`;
      } catch {}
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return `${name}을 내려받았어요.`;
  }
  // export the model assembled, upright and at the origin, whatever is on screen
  async function atRest(fn) {
    const keep = { ...state }, pos = model.position.clone();
    Object.assign(state, { explode: 0, flip: 0 });
    applyState();
    for (const p of parts) p.o.visible = true;
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    try { return await fn(); } finally { model.position.copy(pos); Object.assign(state, keep); applyState(true); }
  }
  async function exportModel(type) {
    let blob, name;
    if (type === 'glb') {
      blob = await atRest(async () => new Blob([await new GLTFExporter().parseAsync(model, { binary: true })], { type: 'model/gltf-binary' }));
      name = 'slope_guard_model.glb';
    } else if (type === 'stl') {
      blob = await atRest(() => {
        model.scale.setScalar(1); model.updateMatrixWorld(true);
        const data = new STLExporter().parse(model, { binary: true });
        model.scale.setScalar(MM); model.updateMatrixWorld(true);
        return new Blob([data], { type: 'model/stl' });
      });
      name = 'slope_guard_model.stl';
    } else {
      // WebGPU hands the canvas to the screen after each task, so draw and read it in the same task.
      // The window must be visible: a hidden page does not draw at all.
      hiGroup.visible = false;
      renderer.setPixelRatio(1);
      renderer.setSize(1920, 1080, false);
      resize(1920, 1080);
      await renderer.compileAsync(scene, camera);
      blob = await new Promise((r) => {
        view.render();
        renderer.domElement.toBlob(r, 'image/png');
      });
      hiGroup.visible = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      restoreSize();
      name = `slope_guard_${currentView}.png`;
    }
    const msg = await save(blob, name);
    status(msg);
    return msg;
  }

  // ------------------------------------------------------------
  // Panel
  // ------------------------------------------------------------
  for (const [key, v] of Object.entries(VIEWS)) {
    const b = Object.assign(document.createElement('button'), { textContent: v.label, className: 'btn', type: 'button' });
    b.dataset.view = key;
    b.onclick = () => { stopTour(); goTo(key, false, true); };
    $('views').append(b);
  }
  // 조립 / 분해: its own switch, apart from the camera stops
  document.querySelectorAll('#assembly button').forEach((b) => {
    b.onclick = () => {
      stopTour();
      const apart = b.dataset.asm === '1';
      if (apart !== state.explode > 0.5 || tween) goTo(apart ? 'explode' : 'home', false, true);
    };
  });
  $('dims').onchange = (e) => { dimsOn = e.target.checked; };
  $('wires').onchange = (e) => { wiresOn = e.target.checked; applyState(true); };
  document.querySelectorAll('[data-export]').forEach((b) => { b.onclick = () => exportModel(b.dataset.export); });

  let tris = 0;
  for (const p of parts) tris += (p.o.geometry.index ? p.o.geometry.index.count : p.o.geometry.attributes.position.count) / 3;
  for (const w of W.wires) tris += w.geometry.index.count / 3;
  const statsEl = $('model-stats');
  let frames = 0, last = performance.now();

  // ------------------------------------------------------------
  // Modes: 'menu' (turning backdrop) or 'model' (the viewer itself)
  // ------------------------------------------------------------
  function enter(kind, instant = false) {
    controls.enabled = true;
    active = kind === 'model';
    if (kind === 'menu') {
      document.querySelectorAll('#views button').forEach((b) => b.classList.remove('on'));
      stopTour();
      tweenTo(SHOWCASE, instant);
      controls.autoRotate = true;
      controls.enableZoom = controls.enablePan = false;
      shiftTarget = 1;
    } else {
      goTo('home', instant);
      controls.autoRotate = false;
      controls.enableZoom = controls.enablePan = true;
      shiftTarget = 0;
    }
    hover = selected = null;
    highlightDirty = true;
    showCard();
    if (instant) shift = shiftTarget;
  }
  function exit() {
    controls.enabled = false;
    active = false;
    stopTour();
    hover = selected = null;
    highlightDirty = true;
    showCard();
    dimLayer.classList.remove('on');
  }

  function frame(now, dt) {
    stepTour(now);
    stepTween(now);
    shift += (shiftTarget - shift) * Math.min(1, dt * 4);
    applyShift();
    controls.update(dt);
    if (pending && active) { setHover(pickAt(...pending)); pending = null; }
    if (highlightDirty) rebuildHighlight();
    else if (hiMoved) followHighlight();
    view.render();
    updateDims();
    frames++;
    if (now - last > 1000) {
      const fps = Math.round((frames * 1000) / (now - last)); frames = 0; last = now;
      statsEl.textContent = `부품 ${parts.length}개, 전선 ${W.wires.length}가닥, 삼각형 ${Math.round(tris).toLocaleString('ko-KR')}개\n그리기 호출 ${renderer.info.render.drawCalls}회, ${fps} fps, ${backend}${view.on ? ', 고품질' : ''}`;
    }
  }

  setBatched(true);
  return {
    scene, camera, controls, state, VIEWS, viewCount: Object.keys(VIEWS).length, partCount: parts.length,
    resize, enter, exit, frame, goTo, applyState, exportModel, setBatched, setTextures,
    setHQ: (on) => view.set(on), select, startTour, stopTour,
  };
}
