// ============================================================
// Tip-over test: two kickboards (control OFF and ON) drive straight on the floor at full throttle (PWM 255),
// the right rear wheel of each runs up a wedge and the car rolls onto its left side.
// The ON car's firmware speed control brakes it towards 0.32 m/s on the way, so it arrives a little later.
// The ON car runs the firmware's tip check (prj_test3.ino): accelerometer roll over 50°
// for 5 samples (0.1 s) -> brake at 255, buzzer 0.5 s, red LED blinking, output cut.
// The OFF car does not stop: lying on its side, its wheels keep turning and push it slowly forward.
// The fall itself is scripted (simple pendulum about the left wheel line), not measured.
// ============================================================
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, lin, M, carGeometry } from './kickboard.js';
import { createView } from './post.js';
import { createCountdown } from './countdown.js';

const $ = (id) => document.getElementById(id);
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const LANES = { OFF: 0.21, ON: -0.21 };             // Blender y (back lane OFF, front lane ON)
const X0 = -0.9, X_WEDGE = 0.05;                      // start, car position when the wheel meets the wedge (m)
// full throttle (PWM 255) on the flat, scaled from the firmware comment "스로틀 190 예상 속도 0.28 m/s"
const V_FULL = 0.28 * 255 / 190, WHEEL_R = 0.033;
// motor and brake model of the slope simulation (sim.js): driven, coasting and short-circuit braking (1/s)
const C_MOTOR = 5.0, D_COAST = 1.0, K_SC = 4.0;
// prj_test3.ino speed control on the flat (target 0.32 m/s), with the throttle at 255
const FW = { V_BASE: 0.32, MARGIN: 0.03, KP: 600, KI: 2000, STEP: 25, MAX: 255, THROTTLE: 255 };
const SAFE_ROLL = 50, HOLD = 0.1;                     // firmware SAFE_ROLL_DEG and 5 samples of 20 ms
const PIVOT_Y = 0.068;                                // left wheel's outer face (m): the car rolls about this line
const AXLE_X = 0.03, WHEEL_Y = 0.055;                 // rear axle from the deck's rear end, rear wheel from the centre line
const L_W = 0.08, H_W = 0.055, D_W = 0.05;            // wedge length, height and width
const TH_CLIMB = Math.asin(H_W / (PIVOT_Y + WHEEL_Y));  // roll at the top of the wedge (about 27°)

export function createTip({ renderer, term, onStart = () => {} }) {
  const scene = new THREE.Scene();
  scene.background = lin(0.8, 0.8, 0.8);
  scene.fog = new THREE.Fog(scene.background, 2.5, 8);  // as on the blueprint: no hard horizon line on a tall screen
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.copy(P(-0.6, -1.0, 1.6));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.3, far: 5 });
  scene.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: lin(0.86, 0.86, 0.87), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // the bump in front of each car's right rear wheel: a small rubber curb ramp, highest at its far end,
  // with rounded edges, ribs across the slope and yellow and black bands on its sides
  const wedgeShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L_W, 0), new THREE.Vector2(L_W, H_W)]);
  const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
    depth: D_W - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelOffset: -0.002, bevelSegments: 3,
  }).translate(-L_W, 0, -(D_W - 0.004) / 2);
  const slope = Math.atan2(H_W, L_W), nx = -Math.sin(slope), ny = Math.cos(slope);
  const ribGeo = mergeGeometries([0.2, 0.36, 0.52, 0.68, 0.84].map((f) => new THREE.BoxGeometry(0.005, 0.0026, D_W - 0.012)
    .rotateZ(slope).translate(-L_W + f * L_W + nx * 0.0008, f * H_W + ny * 0.0008, 0)));
  const hazard = (() => {                              // 45° bands, one yellow and one black every 25 mm
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#f2b605';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1d1e22';
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(k * 64, 64); g.lineTo(k * 64 + 32, 64); g.lineTo(k * 64 + 96, 0); g.lineTo(k * 64 + 64, 0);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);                            // the side faces are laid out in metres
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  })();
  const sideMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#2c2e33', roughness: 0.85 });
  const ribMat = new THREE.MeshStandardMaterial({ color: '#474a52', roughness: 0.7 });

  // cars: own copies of the materials, wheels on pivots, the whole car on a roll pivot at the left wheel line
  const CAR = carGeometry();
  const own = new Map();
  const mine = (m) => { if (!own.has(m)) own.set(m, m.clone()); return own.get(m); };
  function makeCar(run) {
    const roll = new THREE.Group(), body = new THREE.Group(), red = M.led_r.clone();
    roll.add(body);
    body.position.copy(P(0, -PIVOT_Y, 0));             // the pivot line sits on the car's left side
    const mesh = (g) => {
      const m = new THREE.Mesh(g.geometry, g.material === M.led_r ? red : mine(g.material));
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    for (const b of CAR.body) body.add(mesh(b));
    const wheels = CAR.wheels.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.copy(w.at);
      for (const g of w.parts) pivot.add(mesh(g));
      body.add(pivot);
      return pivot;
    });
    const wedge = new THREE.Group();
    for (const m of [new THREE.Mesh(wedgeGeo, [sideMat, rubber]), new THREE.Mesh(ribGeo, ribMat)]) {
      m.castShadow = m.receiveShadow = true;
      wedge.add(m);
    }
    wedge.position.copy(P(X_WEDGE + AXLE_X + L_W, LANES[run] - WHEEL_Y, 0));
    scene.add(roll, wedge);
    return { roll, body, wheels, red, run, casterR: CAR.wheels[2].r };
  }
  const CARS = { OFF: makeCar('OFF'), ON: makeCar('ON') };

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.enabled = false;
  const view = createView(renderer, scene, camera, { radius: 0.02, strength: 0.7 });
  let size = { w: 1, h: 1 };
  function resize(w, h) {
    size = { w, h };
    camera.aspect = w / h;
    camera.fov = deg(2 * Math.atan(0.42 / Math.max(camera.aspect, 0.75)));
    if (camera.aspect < 0.8) camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    else camera.setViewOffset(w, h, w * 0.12, 0, w, h);
    camera.updateProjectionMatrix();
    homeCamera();
  }
  // The camera first shows the whole run-up, start line to wedges, then closes in on the wedges as the
  // cars get there (camX: where it looks, camB: how far back, 1 = close); on a tall screen it steps back.
  let camX = 0, camB = 1;
  const tallView = () => camera.aspect < 0.8;
  function camGoal(tt) {
    const mean = (xAt(tt, 'OFF') + xAt(tt, 'ON')) / 2;
    const k = Math.min(Math.max((mean - X0) / (X_WEDGE - 0.1 - X0), 0), 1);   // 0 on the start line, 1 near the wedges
    const wide = (X0 + X_WEDGE + 0.16) / 2 + 0.06, close = tallView() ? 0.22 : 0.18;
    return { x: wide + (close - wide) * k, b: 1.45 - 0.45 * k };
  }
  function homeCamera() {
    const back = (tallView() ? 1.1 * Math.sqrt(0.75 / camera.aspect) : 1.25) * camB;
    controls.target.copy(P(camX, 0, 0.06));
    camera.position.copy(P(0.03, -1.25, 0.49)).multiplyScalar(back).add(controls.target);
    camera.lookAt(controls.target);
  }

  // ------------------------------------------------------------
  // One run per car: drive at full throttle, climb the wedge, fall, lie on the side.
  // The OFF car keeps the throttle; the ON car runs the firmware's speed control (it brakes
  // once it is more than 0.03 m/s over 0.32 m/s), so it comes in a little slower and later.
  // ------------------------------------------------------------
  const DT = 0.005, T_END = 14;
  // roll after the hit, every 5 ms: the right wheel runs up the wedge, then a pendulum about the left wheel line
  function fallTable(tClimb) {
    const out = [];
    let th = 0, w = 0;
    for (let k = 0; k < 600; k++) {
      const tt = k * DT;
      if (tt < tClimb) { th = TH_CLIMB * (tt / tClimb); w = TH_CLIMB / tClimb; }
      else {
        w += 55 * Math.sin(th) * DT;
        th += w * DT;
        if (th >= Math.PI / 2) { th = Math.PI / 2; w = w > 1 ? -0.22 * w : 0; }   // lands on its side, a small bounce
      }
      out.push(th);
    }
    return out;
  }
  function drive(ctl) {
    const R = { x: [], vw: [], rows: [], vMax: 0 };
    let x = X0, vw = 0, state = 'D', pwm = FW.THROTTLE, brakeI = 0, brakePwm = 0;
    for (let k = 0; k * DT < T_END; k++) {
      const t = k * DT;
      if (R.T_HIT === undefined && x >= X_WEDGE) {
        // the rear wheel meets the wedge: from here the fall is scripted at the speed it came in with
        R.T_HIT = t;
        R.T_CLIMB = L_W / Math.max(vw, 0.05);
        R.fall = fallTable(R.T_CLIMB);
        R.T_TOP = t + R.T_CLIMB;
        R.T_FALLEN = t + R.fall.findIndex((th) => th > rad(60)) * DT;
        R.T_DETECT = t + R.fall.findIndex((th) => th > rad(SAFE_ROLL)) * DT + HOLD;   // roll over 50° for 5 samples
      }
      if (k % 4 === 0) {                               // the firmware loop, every 20 ms
        if (ctl && R.T_DETECT !== undefined && t >= R.T_DETECT) { state = 'B'; pwm = FW.MAX; }   // stopped for the fall: full brake
        else if (ctl) {
          const over = vw - FW.V_BASE;
          if (over > -FW.MARGIN) brakeI = Math.min(Math.max(brakeI + FW.KI * over * 0.02, 0), FW.MAX);
          if (over > FW.MARGIN) {
            const want = Math.min(Math.max(Math.trunc(FW.KP * over + brakeI), 0), FW.MAX);
            brakePwm = want > brakePwm + FW.STEP ? brakePwm + FW.STEP : want;
            state = 'B'; pwm = brakePwm;
          } else if (over > -FW.MARGIN) {
            if (brakeI >= 1) { brakePwm = Math.trunc(brakeI); state = 'B'; pwm = brakePwm; }
            else { brakePwm = 0; state = 'C'; pwm = 0; }
          } else { brakePwm = 0; brakeI = 0; state = 'D'; pwm = FW.THROTTLE; }
        }
        R.rows.push({ ms: k * 5, v: vw, pwm, state });
      }
      // the wheels: driven towards full-throttle speed, coasting, or short-circuit braked
      const acc = state === 'D' ? C_MOTOR * (V_FULL - vw) : state === 'C' ? -D_COAST * vw : -(D_COAST + (K_SC * pwm) / FW.MAX) * vw;
      vw = Math.max(0, vw + acc * DT);
      if (R.T_DETECT === undefined || t < R.T_DETECT) R.vMax = Math.max(R.vMax, vw);
      // the car rolls with its wheels until the right wheel is at the top of the wedge
      if (R.T_TOP === undefined || t < R.T_TOP) { x += vw * DT; R.vTop = vw; R.xTop = x; }
      R.x.push(x); R.vw.push(vw);
    }
    // the OFF car, on its side with its wheels still turning, scrubs along the floor afterwards
    R.T_CREEP = Math.max(R.T_TOP + 0.25, R.T_FALLEN + 0.15);
    return R;
  }
  const RUN = { OFF: drive(false), ON: drive(true) };
  const T_DETECT = RUN.ON.T_DETECT;                    // the ON car's stop: log, beep, caption
  const at = (arr, t) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(t / DT)))];
  const rollAt = (t, run) => { const R = RUN[run]; return t < R.T_HIT ? 0 : at(R.fall, t - R.T_HIT); };
  // the OFF car creeps forward and turns a little, slower and slower (0 to 1 of the way, CREEP metres and CREEP_YAW in all)
  const CREEP = 0.15, CREEP_TAU = 2.5, CREEP_YAW = rad(12);
  const creepAt = (run, t) => (run === 'OFF' && t > RUN.OFF.T_CREEP ? 1 - Math.exp(-(t - RUN.OFF.T_CREEP) / CREEP_TAU) : 0);
  // after the top of the wedge the tipping car slides to a stop in 0.25 s
  function xAt(t, run) {
    const R = RUN[run];
    if (t < R.T_TOP) return t < 0 ? X0 : at(R.x, t);
    const slide = Math.min(t - R.T_TOP, 0.25);
    return R.xTop + R.vTop * (slide - (slide * slide) / 0.5) + CREEP * creepAt(run, t);
  }
  // rear wheel turn rate (rad/s), on the floor and in the air
  const spinAt = (run, t) => (t < 0 ? 0 : at(RUN[run].vw, t) / WHEEL_R);

  // ------------------------------------------------------------
  // phases: ready (waiting for s or f) -> count (3 beeps) -> run -> done
  // ------------------------------------------------------------
  let phase = 'ready', t = -1, countT = 0, beeps = 0, nextRow = 0, stopPrinted = false, audio = null, course = '직진';
  const wheelAngle = { OFF: 0, ON: 0 };
  const beep = (ms) => {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'square'; o.frequency.value = 2400; g.gain.value = 0.04;
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  };
  // the first macro button sends f (straight run) on this screen instead of s (slope run)
  const cue = document.querySelector('#term [data-cmd="s"]'), cueLabel = cue?.querySelector('small');
  const count = createCountdown($('tip-count'));
  function reset() {
    phase = 'ready'; t = -1; countT = 0; beeps = 0; nextRow = 0; stopPrinted = false;
    wheelAngle.OFF = wheelAngle.ON = 0;
    cue?.classList.add('cue');
    count.hide();
    burst.hidden = true;
    $('tip-lower').style.opacity = 0;
    controls.enabled = true;
    ({ x: camX, b: camB } = camGoal(-1));
    homeCamera();
  }
  function start(cmd) {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
    reset();
    course = cmd === 's' ? '경사로' : '직진';
    term.print(`${course} 주행, 제어 ON`);
    phase = 'count';
    cue?.classList.remove('cue');
    controls.enabled = false;
    onStart();
  }
  function command(c) {
    const busy = phase === 'count' || phase === 'run';
    if ((c === 's' || c === 'f') && !busy) start(c);
    else if (c === '?') term.print('[상태] 스위치 제어 ON, 경사각 0.0도, 좌우각 0.0도, 방향 0.0도, IMU 버린 샘플 0개, 블루투스 연결됨');
    else if (c === 'c' && !busy) setTimeout(() => term.print('보정 완료 (정상 샘플 200/200)'), 2050);
    else if (!busy) term.print('이 화면에서는 f 출발, c 영점, ? 상태만 쓸 수 있어요', 'sys');
  }

  // the ON car's 20 ms log lines up to the fall, then (after the 0.5 s beep and 1 s of braking) the stop line and summary;
  // the speed is what the encoders count, on the floor or with the wheels in the air
  function emit() {
    const ms = Math.floor(t * 1000), rows = RUN.ON.rows;
    while (nextRow < rows.length && rows[nextRow].ms <= ms && rows[nextRow].ms <= T_DETECT * 1000) {
      const r = rows[nextRow++], th = deg(rollAt(r.ms / 1000, 'ON'));
      term.print([r.ms, 'ON', '0.0', th.toFixed(1), r.v.toFixed(3), FW.V_BASE.toFixed(3), r.pwm, r.state, '0.0', '0.0'].join(','));
    }
    if (!stopPrinted && t > T_DETECT + 1.5) {
      stopPrinted = true;
      term.print('기울기 초과로 정지');
      term.print(`요약: ${course}, 모드 ON, 최고 속도 ${RUN.ON.vMax.toFixed(3)} m/s, 주행 거리 ${(xAt(T_DETECT, 'ON') - X0).toFixed(2)} m, 회전각 0.0도, IMU 버린 샘플 0개`);
    }
  }

  // ------------------------------------------------------------
  // HUD: a tag over each car with its roll, the 50° mark and what the motors do
  // ------------------------------------------------------------
  // the OFF tag sits above its car (the back lane), the ON tag below its car (the front lane), so neither covers the other car
  const tags = { OFF: $('tip-OFF'), ON: $('tip-ON') }, tmp = new THREE.Vector3();
  const parts = Object.fromEntries(Object.entries(tags).map(([run, el]) => [run, {
    box: el.querySelector('.box'), deg: el.querySelector('.deg'), fill: el.querySelector('.fill'), state: el.querySelector('.state'),
  }]));
  const linkSvg = $('tip-link'), linkPath = linkSvg.querySelector('path'), termEl = $('term'), lower = $('tip-lower');
  // "2차 사고 위험" in a starburst, up and to the left of the OFF car while it is being pushed along on its side
  const burst = $('tip-burst'), gaugesEl = $('tip-gauges'), backEl = $('back'), BURST_AT = P(0, 0, 0.12);   // the car's rear end, 12 cm up (before it fell)
  burst.querySelector('polygon').setAttribute('points', Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 0.74 : i % 4 ? 1 : 0.9;
    return `${(120 + 114 * r * Math.cos(a)).toFixed(1)},${(75 + 70 * r * Math.sin(a)).toFixed(1)}`;
  }).join(' '));
  function hud(tt) {
    const { w, h } = size;
    const tr = termEl.getBoundingClientRect();
    const right = tr.width > 0 && tr.left > w * 0.5 ? tr.left - 12 : w - 12;   // keep the tags clear of a terminal on the right
    for (const [run, el] of Object.entries(tags)) {
      const q = parts[run], th = deg(rollAt(tt, run)), above = run === 'OFF';
      tmp.copy(P(xAt(tt, run) + 0.15, LANES[run] + (above ? 0 : -0.09), above ? 0.3 : 0)).project(camera);
      const half = q.box.offsetWidth / 2;
      const sx = Math.min(Math.max(((tmp.x + 1) / 2) * w, half + 12), right - half), sy = ((1 - tmp.y) / 2) * h;
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, ${above ? '-100%' : '0'})`;
      q.deg.textContent = `${Math.round(th)}°`;
      q.fill.style.width = `${Math.min(100, (th / 90) * 100)}%`;
      q.fill.classList.toggle('over', th > SAFE_ROLL);
      const early = tt < 0 ? '출발 대기' : th < 3 ? '주행' : null;
      if (run === 'ON') {
        q.state.textContent = early ?? (th <= SAFE_ROLL ? '기울어지는 중' : tt <= T_DETECT ? '50° 넘음, 0.1초 확인 중' : '출력 차단, 바퀴 멈춤');
        q.state.dataset.tone = tt > T_DETECT ? 'ok' : '';
      } else {
        q.state.textContent = early ?? (tt <= RUN.OFF.T_FALLEN ? '기울어지는 중, 제어 없음' : tt <= RUN.OFF.T_CREEP ? '넘어진 채 바퀴 계속 회전' : '바퀴가 돌며 앞으로 밀려감');
        q.state.dataset.tone = tt > RUN.OFF.T_FALLEN ? 'bad' : '';
      }
    }
    const showBurst = tt > RUN.OFF.T_CREEP + 0.4;
    if (burst.hidden === showBurst) burst.hidden = !showBurst;
    if (showBurst) {
      tmp.copy(BURST_AT).applyMatrix4(CARS.OFF.body.matrixWorld).project(camera);
      const px = ((tmp.x + 1) / 2) * w, py = ((1 - tmp.y) / 2) * h, bw = burst.offsetWidth, bh = burst.offsetHeight;
      // below the back button, and on a phone below the panel of the two readouts
      const minTop = Math.max(backEl.getBoundingClientRect().bottom, gaugesEl.getBoundingClientRect().bottom) + 6;
      const bx = Math.min(Math.max(px - bw * 0.92, 8), right - bw), by = Math.min(Math.max(py - bh * 0.9, minTop), h - bh - 8);
      burst.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
    }
    // the dotted line from the ON car's tag (the car the terminal is connected to) to the terminal
    const br = parts.ON.box.getBoundingClientRect();
    if (tr.width > 0 && br.width > 0) {
      const ax = br.right, ay = br.top;
      const tall = tr.top > ay + 40 && tr.left < ax;     // terminal below the cars (a tall phone): down the right edge
      const bx = tall ? tr.right - 28 : tr.left, by = tall ? tr.top : tr.top + 20;
      linkPath.setAttribute('d', tall
        ? `M${ax - 4} ${ay + 8} C${ax + 8} ${ay + 90} ${bx + 14} ${by - 90} ${bx} ${by}`
        : `M${ax} ${ay} C${(ax + bx) / 2} ${ay} ${(ax + bx) / 2} ${by} ${bx} ${by}`);
      linkSvg.style.opacity = 1;
      linkSvg.classList.toggle('live', phase === 'run' && tt <= T_DETECT);
    } else linkSvg.style.opacity = 0;
    lower.style.opacity = tt > T_DETECT + 1.5 ? 1 : 0;
  }

  function frame(now, dt) {
    if (phase === 'count') {
      countT += dt;
      while (beeps < 3 && countT >= beeps) { beep(150); beeps++; }
      if (countT < 3) count.show(3 - Math.min(2, Math.floor(countT)));
      else {
        phase = 'run'; t = 0;
        count.go();
        term.print('t_ms,mode,slope,roll,speed,target,pwm,state,yaw,heading');
      }
    } else if (phase === 'run' || phase === 'done') {
      const before = t;
      t += dt;
      if (before <= T_DETECT && t > T_DETECT) beep(500);
      emit();
      if (phase === 'run' && t > T_DETECT + 2.5) {
        phase = 'done';
        controls.enabled = true;
        cue?.classList.add('cue');
      }
    }
    const tt = phase === 'ready' || phase === 'count' ? -1 : t;
    for (const [run, car] of Object.entries(CARS)) {
      car.roll.position.copy(P(xAt(tt, run), LANES[run] + PIVOT_Y, 0));
      // tips over to its left, away from the camera; the OFF car then shakes a little on its turning wheels
      // and swings round as it creeps (yaw first, about the floor's up, then the roll)
      const shake = run === 'OFF' && tt > RUN.OFF.T_FALLEN + 0.2 ? 0.012 * Math.abs(Math.sin(tt * V_FULL / WHEEL_R)) : 0;
      car.roll.rotation.set(-(rollAt(tt, run) - shake), CREEP_YAW * creepAt(run, tt), 0, 'YXZ');
      wheelAngle[run] += spinAt(run, tt) * dt;
      // the rear wheels follow the motors; the caster only rolls while it is on the floor
      car.wheels.forEach((w, i) => { w.rotation.z = i < 2 ? -wheelAngle[run] : -(xAt(Math.min(tt, RUN[run].T_HIT), run) - X0) / car.casterR; });
      // the ON car's red LED blinks slowly once it has stopped for a fall
      const blink = run === 'ON' && tt > T_DETECT && Math.floor((tt - T_DETECT) / 0.5) % 2 === 0;
      car.red.emissive.setHex(blink ? 0xff2010 : 0x000000);
      car.red.emissiveIntensity = blink ? 3 : 0;
    }
    if (controls.enabled) controls.update();
    else {                                             // follows the cars while they drive
      const g = camGoal(tt), s = 1 - Math.exp(-dt * 3);
      camX += (g.x - camX) * s;
      camB += (g.b - camB) * s;
      homeCamera();
    }
    view.render();
    hud(tt);
    term.flush();
  }

  function enter() {
    if (cue) { cue.dataset.cmd = 'f'; cueLabel.textContent = 'f 직진'; }
    reset();
    term.print('전도 시험: 터미널은 제어 ON 차에 연결됨. f를 보내면 두 차가 같이 출발', 'sys');
  }
  function exit() {
    controls.enabled = false;
    count.hide();
    if (cue) { cue.classList.remove('cue'); cue.dataset.cmd = 's'; cueLabel.textContent = 's 경사로'; }
  }
  return { scene, camera, resize, enter, exit, frame, command, setHQ: (on) => view.set(on) };
}
