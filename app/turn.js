// ============================================================
// Turn course (prj_test3.ino, command t): each car spins on the spot to the right, the outer (left)
// wheel forward and the inner (right) wheel backward at PWM 255, and once it has turned 90° it stops
// with a reverse pulse of up to 0.15 s, then brakes.
// Control OFF keeps full output: it spins fast, and the sudden stop throws the top-heavy car onto its right side.
// Control ON lowers the target speed by K2 for every deg/s of yaw, so it spins slowly and stays on its wheels.
// The wheel model follows the other simulations; the roll after the stop is a simple model
// (the car as an inverted pendulum about its right wheels), not measured.
// ============================================================
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { P, lin, carGeometry } from './kickboard.js';
import { createView } from './post.js';
import { createCountdown } from './countdown.js';

const $ = (id) => document.getElementById(id);
const deg = THREE.MathUtils.radToDeg;
const LANES = { OFF: 0.42, ON: -0.42 };                // board centres (m, Blender y)
const BOARD = { L: 0.9, W: 0.6, T: 0.006 };            // the plywood board under each car
const AXLE_X = 0.03, TRACK = 0.11, WHEEL_R = 0.033, CASTER_ARM = 0.235;   // the car spins about the middle of its rear axle
const PIVOT_Y = 0.068;                                 // right wheel's outer face: the car tips about this line
// pivot-turn wheel model: free speed at 255 with the tyres scrubbing, motor pull, coasting drag, short-circuit braking,
// and the reverse pulse (1/s); the same kind of model as the slope and tip-over simulations
const V_SPIN = 0.30, C_MOTOR = 5.0, D_TURN = 3.0, K_SC = 4.0, K_REV = 30;
// prj_test3.ino: target speed and its recovery, the brake rule, and the turn course settings
const FW = { V_BASE: 0.32, K2: 0.0015, V_MIN: 0.10, YAW_DEADBAND: 10, RECOVER: 0.30, MARGIN: 0.03, KP: 600, KI: 2000, STEP: 25, MAX: 255,
  THROTTLE: 255, TURN_DEG: 90, REVERSE: 0.15 };
// roll after the stop: centre of mass height, so the angle at which the car goes over and gravity over the arm (1/s²)
const H_CG = 0.14, TH_TIP = Math.atan2(PIVOT_Y, H_CG), G_L = 9.81 / Math.hypot(PIVOT_Y, H_CG);
const DT = 0.005, T_END = 7;

export function createTurn({ renderer, term, onStart = () => {} }) {
  const scene = new THREE.Scene();
  scene.background = lin(0.8, 0.8, 0.8);
  scene.fog = new THREE.Fog(scene.background, 2.5, 8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.copy(P(-0.8, -0.9, 1.6));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, near: 0.3, far: 5 });
  scene.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: lin(0.86, 0.86, 0.87), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const plywood = new THREE.MeshStandardMaterial({ color: lin(0.78, 0.7, 0.42), roughness: 0.75 });
  for (const y of Object.values(LANES)) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD.L, BOARD.T, BOARD.W), plywood);
    board.position.copy(P(0.12, y, BOARD.T / 2));
    board.receiveShadow = true;
    scene.add(board);
  }

  // cars: own copies of the materials; a yaw pivot at the rear axle, inside it a roll pivot at the right wheel line
  const CAR = carGeometry();
  const own = new Map();
  const mine = (m) => { if (!own.has(m)) own.set(m, m.clone()); return own.get(m); };
  function makeCar(run) {
    const yaw = new THREE.Group(), roll = new THREE.Group(), body = new THREE.Group();
    yaw.add(roll);
    roll.add(body);
    roll.position.copy(P(0, -PIVOT_Y, 0));
    body.position.copy(P(-AXLE_X, PIVOT_Y, 0));
    const mesh = (g) => {
      const m = new THREE.Mesh(g.geometry, mine(g.material));
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    for (const b of CAR.body) body.add(mesh(b));
    const wheels = CAR.wheels.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.copy(w.at);
      pivot.rotation.order = 'YZX';                      // the caster swivels about the vertical, then rolls
      for (const g of w.parts) pivot.add(mesh(g));
      body.add(pivot);
      return pivot;
    });
    scene.add(yaw);
    return { yaw, roll, body, wheels, casterR: CAR.wheels[2].r };
  }
  const CARS = { OFF: makeCar('OFF'), ON: makeCar('ON') };

  // ------------------------------------------------------------
  // One run per car, every 5 ms, with the firmware loop every 20 ms
  // ------------------------------------------------------------
  function spin(ctl) {
    const R = { v: [], head: [], roll: [], rows: [], vMax: 0, dist: 0 };
    let v = 0, head = 0, state = 'D', pwm = FW.THROTTLE, brakeI = 0, brakePwm = 0, target = FW.V_BASE;
    let th = 0, w = 0;
    for (let k = 0; k * DT < T_END; k++) {
      const t = k * DT, yawRate = deg((2 * v) / TRACK);  // deg/s, to the right
      if (R.T_STOP === undefined && k % 4 === 0) {
        if (head >= FW.TURN_DEG) {
          // turned 90°: reverse pulse, then the stop; the yaw it had sets how hard the car is thrown sideways
          R.T_STOP = t;
          R.yawStop = yawRate;
          w = THREE.MathUtils.degToRad(yawRate);
        } else {
          if (ctl) {
            const turn = yawRate < FW.YAW_DEADBAND ? 0 : yawRate;
            const want = Math.max(FW.V_BASE - FW.K2 * turn, FW.V_MIN);
            target = want < target ? want : Math.min(want, target + FW.RECOVER * 0.02);
            const over = v - target;
            if (over > -FW.MARGIN) brakeI = Math.min(Math.max(brakeI + FW.KI * over * 0.02, 0), FW.MAX);
            if (over > FW.MARGIN) {
              const need = Math.min(Math.max(Math.trunc(FW.KP * over + brakeI), 0), FW.MAX);
              brakePwm = need > brakePwm + FW.STEP ? brakePwm + FW.STEP : need;
              state = 'B'; pwm = brakePwm;
            } else if (over > -FW.MARGIN) {
              if (brakeI >= 1) { brakePwm = Math.trunc(brakeI); state = 'B'; pwm = brakePwm; }
              else { brakePwm = 0; state = 'C'; pwm = 0; }
            } else { brakePwm = 0; brakeI = 0; state = 'D'; pwm = FW.THROTTLE; }
          }
          R.rows.push({ ms: k * 5, v, target, pwm, state, yaw: yawRate, head });
        }
      }
      // the wheels: driven, coasting or braked while turning; reversed for up to 0.15 s, then braked, after the stop
      let acc;
      if (R.T_STOP === undefined) acc = state === 'D' ? C_MOTOR * (V_SPIN - v) : state === 'C' ? -D_TURN * v : -(D_TURN + (K_SC * pwm) / FW.MAX) * v;
      else if (t < R.T_STOP + FW.REVERSE && v > 0.02) acc = -K_REV * v - 2;
      else acc = -(D_TURN + K_SC) * v;
      v = Math.max(0, v + acc * DT);
      head += deg((2 * v) / TRACK) * DT;
      R.dist += v * DT;
      if (R.T_STOP === undefined) R.vMax = Math.max(R.vMax, v);
      // the roll: the car leans out about its right wheels; past TH_TIP gravity takes it over
      if (R.T_STOP !== undefined) {
        w += G_L * Math.sin(th - TH_TIP) * DT;
        th += w * DT;
        if (th >= Math.PI / 2) { th = Math.PI / 2; w = w > 1 ? -0.25 * w : 0; R.T_FALLEN ??= t; }   // on its side
        if (th <= 0 && w < 0) { th = 0; w = w < -0.6 ? -0.3 * w : 0; }                            // back on its wheels
        R.rollMax = Math.max(R.rollMax ?? 0, th);
      }
      R.v.push(v); R.head.push(head); R.roll.push(th);
    }
    R.headEnd = head;
    return R;
  }
  const RUN = { OFF: spin(false), ON: spin(true) };
  const T_ON_STOP = RUN.ON.T_STOP, T_DONE = Math.max(RUN.ON.T_STOP, RUN.OFF.T_FALLEN ?? RUN.OFF.T_STOP) + 1.2;
  const at = (arr, t) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(t / DT)))];
  // a car on its side slides a little towards its right, the way it was thrown
  const slideAt = (run, t) => { const f = RUN[run].T_FALLEN; return f === undefined || t < f - 0.15 ? 0 : 0.07 * (1 - Math.exp(-(t - f + 0.15) / 0.15)); };

  // ------------------------------------------------------------
  // Camera: from behind the start, a little high, both boards side by side (OFF left, ON right)
  // ------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.enabled = false;
  const view = createView(renderer, scene, camera, { radius: 0.02, strength: 0.7 });
  let size = { w: 1, h: 1 };
  const tallView = () => camera.aspect < 0.8;
  function homeCamera() {
    const back = tallView() ? 1.3 * Math.sqrt(0.75 / camera.aspect) : 1.45;
    controls.target.copy(P(0.1, -0.1, 0.04));
    camera.position.copy(P(-1.2, -0.3, 1.05)).multiplyScalar(back).add(controls.target);
    camera.lookAt(controls.target);
  }
  function resize(w, h) {
    size = { w, h };
    camera.aspect = w / h;
    camera.fov = deg(2 * Math.atan(0.42 / Math.max(camera.aspect, 0.75)));
    if (camera.aspect < 0.8) camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    else camera.setViewOffset(w, h, w * 0.12, 0, w, h);
    camera.updateProjectionMatrix();
    homeCamera();
  }

  // ------------------------------------------------------------
  // phases: ready (waiting for t) -> count (3 beeps) -> run -> done
  // ------------------------------------------------------------
  let phase = 'ready', t = -1, countT = 0, beeps = 0, nextRow = 0, stopPrinted = false, audio = null;
  const spinAngle = { OFF: [0, 0, 0], ON: [0, 0, 0] };  // left, right and caster wheel
  const beep = (ms) => {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'square'; o.frequency.value = 2400; g.gain.value = 0.04;
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  };
  // the first macro button sends t (turn run) on this screen
  const cue = document.querySelector('#term [data-cmd="s"]'), cueLabel = cue?.querySelector('small');
  const count = createCountdown($('turn-count'));
  function reset() {
    phase = 'ready'; t = -1; countT = 0; beeps = 0; nextRow = 0; stopPrinted = false;
    for (const a of Object.values(spinAngle)) a.fill(0);
    cue?.classList.add('cue');
    count.hide();
    lower.style.opacity = 0;
    controls.enabled = true;
    homeCamera();
  }
  function start() {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
    reset();
    term.print('회전 주행, 제어 ON');
    phase = 'count';
    cue?.classList.remove('cue');
    controls.enabled = false;
    onStart();
  }
  function command(c) {
    const busy = phase === 'count' || phase === 'run';
    if (c === 't' && !busy) start();
    else if (c === '?') term.print('[상태] 스위치 제어 ON, 경사각 0.0도, 좌우각 0.0도, 방향 0.0도, IMU 버린 샘플 0개, 블루투스 연결됨');
    else if (c === 'c' && !busy) setTimeout(() => term.print('보정 완료 (정상 샘플 200/200)'), 2050);
    else if (!busy) term.print('이 화면에서는 t 출발, c 영점, ? 상태만 쓸 수 있어요', 'sys');
  }

  // the ON car's 20 ms log lines while it turns, then (after 1 s of braking) why it stopped and the summary
  function emit() {
    const ms = Math.floor(t * 1000), rows = RUN.ON.rows;
    while (nextRow < rows.length && rows[nextRow].ms <= ms) {
      const r = rows[nextRow++];
      term.print([r.ms, 'ON', '0.0', '0.0', r.v.toFixed(3), r.target.toFixed(3), r.pwm, r.state, r.yaw.toFixed(1), r.head.toFixed(1)].join(','));
    }
    if (!stopPrinted && t > T_ON_STOP + FW.REVERSE + 1) {
      stopPrinted = true;
      term.print('회전 완료');
      term.print(`요약: 회전, 모드 ON, 최고 속도 ${RUN.ON.vMax.toFixed(3)} m/s, 주행 거리 ${RUN.ON.dist.toFixed(2)} m, 회전각 ${RUN.ON.headEnd.toFixed(1)}도, IMU 버린 샘플 0개`);
    }
  }

  // ------------------------------------------------------------
  // HUD: a readout over each car (yaw rate, how far it has turned, what happens)
  // ------------------------------------------------------------
  const tags = { OFF: $('turn-OFF'), ON: $('turn-ON') }, tmp = new THREE.Vector3();
  const parts = Object.fromEntries(Object.entries(tags).map(([run, el]) => [run, {
    box: el.querySelector('.box'), deg: el.querySelector('.deg'), fill: el.querySelector('.fill'), state: el.querySelector('.state'),
  }]));
  const linkSvg = $('turn-link'), linkPath = linkSvg.querySelector('path'), termEl = $('term'), lower = $('turn-lower');
  function hud(tt) {
    const { w, h } = size;
    const tr = termEl.getBoundingClientRect();
    const right = tr.width > 0 && tr.left > w * 0.5 ? tr.left - 12 : w - 12;
    for (const [run, el] of Object.entries(tags)) {
      const q = parts[run], R = RUN[run], car = CARS[run];
      tmp.set(0, 0, 0).applyMatrix4(car.yaw.matrixWorld);
      tmp.y += 0.36;
      tmp.project(camera);
      const half = q.box.offsetWidth / 2;
      const sx = Math.min(Math.max(((tmp.x + 1) / 2) * w, half + 12), right - half), sy = ((1 - tmp.y) / 2) * h;
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
      const yawNow = tt < 0 ? 0 : deg((2 * at(R.v, tt)) / TRACK), head = tt < 0 ? 0 : at(R.head, tt);
      q.deg.textContent = `${Math.round(yawNow)}°/s`;
      q.fill.style.width = `${Math.min(100, (head / FW.TURN_DEG) * 100)}%`;
      const stopped = tt >= R.T_STOP, fallen = R.T_FALLEN !== undefined && tt >= R.T_FALLEN;
      if (run === 'ON') {
        q.state.textContent = tt < 0 ? '출발 대기' : stopped ? '90° 회전 완료, 서 있음' : '회전이 빠를수록 감속';
        q.state.dataset.tone = stopped ? 'ok' : '';
      } else {
        q.state.textContent = tt < 0 ? '출발 대기' : fallen ? '멈추는 순간 넘어짐' : stopped ? '급정지' : '최대 출력으로 급회전';
        q.state.dataset.tone = fallen ? 'bad' : '';
      }
    }
    // the dotted line from the ON car's readout (the car the terminal is connected to) to the terminal
    const br = parts.ON.box.getBoundingClientRect();
    if (tr.width > 0 && br.width > 0) {
      const ax = br.right, ay = br.top;
      const tall = tr.top > ay + 40 && tr.left < ax;
      const bx = tall ? tr.right - 28 : tr.left, by = tall ? tr.top : tr.top + 20;
      linkPath.setAttribute('d', tall
        ? `M${ax - 4} ${ay + 8} C${ax + 8} ${ay + 90} ${bx + 14} ${by - 90} ${bx} ${by}`
        : `M${ax} ${ay} C${(ax + bx) / 2} ${ay} ${(ax + bx) / 2} ${by} ${bx} ${by}`);
      linkSvg.style.opacity = 1;
      linkSvg.classList.toggle('live', phase === 'run' && tt <= T_ON_STOP);
    } else linkSvg.style.opacity = 0;
    lower.style.opacity = tt > T_DONE ? 1 : 0;
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
      t += dt;
      emit();
      if (phase === 'run' && t > T_DONE + 1.5) {
        phase = 'done';
        controls.enabled = true;
        cue?.classList.add('cue');
      }
    }
    const tt = phase === 'ready' || phase === 'count' ? -1 : t;
    for (const [run, car] of Object.entries(CARS)) {
      const R = RUN[run], head = tt < 0 ? 0 : at(R.head, tt), v = tt < 0 ? 0 : at(R.v, tt);
      const yawRad = THREE.MathUtils.degToRad(head);
      // the axle stays on the board centre; a car thrown on its side slides a little towards its right
      const s = slideAt(run, tt);
      car.yaw.position.copy(P(-Math.sin(yawRad) * s, LANES[run] - Math.cos(yawRad) * s, BOARD.T));
      car.yaw.rotation.y = -yawRad;                       // clockwise seen from above: a right turn
      car.roll.rotation.x = tt < 0 ? 0 : at(R.roll, tt);  // over onto its right side
      // left wheel forward, right wheel backward; the caster turns sideways and rolls round the circle
      const a = spinAngle[run];
      a[0] += (v / WHEEL_R) * dt;
      a[1] -= (v / WHEEL_R) * dt;
      a[2] += (((2 * v) / TRACK) * CASTER_ARM / car.casterR) * dt;
      car.wheels[0].rotation.z = -a[0];
      car.wheels[1].rotation.z = -a[1];
      car.wheels[2].rotation.set(0, tt < 0 ? 0 : -Math.PI / 2 * Math.min(1, head / 15), -a[2]);
    }
    if (controls.enabled) controls.update();
    view.render();
    hud(tt);
    term.flush();
  }

  function enter() {
    if (cue) { cue.dataset.cmd = 't'; cueLabel.textContent = 't 회전'; }
    reset();
    term.print('회전 시험: 터미널은 제어 ON 차에 연결됨. t를 보내면 두 차가 같이 출발', 'sys');
  }
  function exit() {
    controls.enabled = false;
    count.hide();
    if (cue) { cue.classList.remove('cue'); cue.dataset.cmd = 's'; cueLabel.textContent = 's 경사로'; }
  }
  return { scene, camera, resize, enter, exit, frame, command, setHQ: (on) => view.set(on) };
}
