// Source code screen: the firmware prj_test3.ino, cut into parts by line number,
// each part with a short note beside it. The file is fetched the first time the screen opens.

const FILE = 'firmware/prj_test3.ino';

// [[n]] in a note becomes a button that scrolls to line n and flashes it.
// mark: the lines a note talks about ('48-56,61').
const PARTS = [
  {
    from: 1, to: 39, title: '머리말 주석', mark: '7-9',
    note: `
      <p>20 ms마다 속도와 자세를 재고, 목표 속도와 비교해서 스로틀, 출력 끊음, 제동 중 하나를 고른다.</p>
      <p class="eq">목표 = V_BASE − K1 × 경사각 − K2 × |회전 각속도|</p>
      <p>내리막이 가파를수록, 빨리 돌수록 목표가 낮아진다.</p>`,
  },
  {
    from: 40, to: 62, title: '핀, 블루투스', mark: '43-45,48-49',
    note: `
      <p>보드를 ESP32 Dev Module로 안 고르면 블루투스 설정이 빠져서 [[43]]~45행에서 컴파일이 멈춘다.</p>
      <p>속도센서를 34, 35번에 꽂은 건 입력 전용 핀이라서다. 대신 내부 풀업이 없어서 센서 모듈에 달린 풀업을 쓴다.</p>
      <p>휴대폰의 Serial Bluetooth Terminal 앱에서 SlopeGuard_5로 연결한다. 시뮬레이션 화면의 터미널이 이 앱을 따라 만든 것.</p>`,
  },
  {
    from: 63, to: 94, title: '제어 상수', mark: '66,71,75,77,89',
    note: `
      <p>펄스 하나는 π × 0.065 / 20 ≈ 1.02 cm.</p>
      <p>스로틀을 일부러 190에 뒀다. 끝까지 안 당겨도 내리막에서는 빨라지는 상황을 만들려고. V_BASE 0.32는 스로틀 190의 평지 예상 속도(0.28)보다 조금 높아서
      평지에서는 제어가 안 걸린다.</p>
      <table>
        <tr><th>내리막</th><td>3° 이하</td><td>10°</td><td>20°</td><td>30°</td></tr>
        <tr><th>목표 (m/s)</th><td>0.32</td><td>0.26</td><td>0.20</td><td>0.14</td></tr>
      </table>
      <p>처음엔 비례 제동만 넣었는데, PC 시뮬레이션 20° 경사에서 목표 0.20이 아니라 0.38 m/s에서 더 안 내려갔다. 그래서 KI_BRAKE를 추가했다.</p>`,
  },
  {
    from: 95, to: 115, title: '직진, 회전 상수', mark: '104-107,110-113',
    note: `
      <p>회전 코스는 급회전 상황이라 스로틀 255. TURN_PIVOT이 true면 바깥 바퀴는 앞으로, 안쪽 바퀴는 뒤로 같은 세기로 돌려서 거의 제자리에서 돈다.</p>
      <p>1.6 m, 0.7 m, 3초, 8초 같은 종료 조건은 차가 경사로 밖으로 달려 나가지 않게 넣은 값.</p>`,
  },
  {
    from: 116, to: 147, title: '넘어짐, IMU 상수', mark: '118-120,131,134',
    note: `
      <p>넘어짐은 가속도계 각도로만 판정한다. 자이로 적분값은 튄 값이 한 번 들어가면 계속 남는다.</p>
      <p>앞뒤 기준(65°)이 좌우(50°)보다 큰 건, 30° 경사에서 제동까지 걸리면 앞뒤 각도가 크게 나와서.</p>
      <p>자이로 범위를 ±1000 deg/s로 넓혀서 1 deg/s가 32.8 (32768 / 1000). 제자리 회전에서도 값이 끝까지 차지 않는다.</p>`,
  },
  {
    from: 148, to: 193, title: '전역 변수', mark: '156,161',
    note: `
      <p>엔코더 변수는 인터럽트 안에서 바뀌어서 volatile을 붙였고 읽을 때는 encMux로 잠근다.</p>
      <p>FC-03은 바퀴가 어느 쪽으로 도는지 모른다. 그래서 모터에 준 방향(dirL, dirR)을 펄스에 곱해서 거꾸로 도는 바퀴는 거리에서 빠지게 했다.</p>`,
  },
  {
    from: 194, to: 238, title: '엔코더', mark: '199,204,221',
    note: `
      <p>2 ms보다 짧은 펄스는 버린다. 속도로 치면 5 m/s가 넘어서 떨림일 수밖에 없다.</p>
      <p>주기는 (이전 × 3 + 새 값) / 4로 평균.</p>
      <p>[[221]]: 다음 펄스가 늦어지고 있으면 기다린 시간을 주기로 써서 속도를 바로 낮춘다. 이게 없으면 감속이 펄스 하나만큼 늦게 잡힌다.</p>`,
  },
  {
    from: 239, to: 264, title: 'MPU6050 설정', mark: '247-248,260',
    note: `
      <p>전원이 흔들려 센서가 리셋되면 다시 잠든 상태(값이 전부 0)가 된다. 그래서 켤 때만이 아니라 c, i 때도 설정을 다시 쓴다.</p>
      <p>I2C는 모터 노이즈 때문에 100 kHz로 낮췄다.</p>`,
  },
  {
    from: 265, to: 324, title: 'MPU6050 읽기', mark: '286-291,300-303',
    note: `
      <p>핀이 위로 오게 뒤집어 붙여서 y, z축 부호를 바꿔 읽는다.</p>
      <p>[[300]]~303행은 두 번째 시안 때문에 넣었다. 평지에 가만히 서 있는데 값이 튀어서 "기울기 초과로 정지"가 떴다.
      지금은 가속도 크기가 1 g에서 많이 벗어나거나, z축이 음수거나, 자이로가 꽉 찬 샘플을 버린다.</p>`,
  },
  {
    from: 325, to: 423, title: '보정과 점검', mark: '377-381,385',
    note: `
      <p>c는 2초 동안 200번 읽은 평균으로 영점을 잡는다. 자이로 평균은 바이어스라서 이후 매번 빼고 가속도로 본 각도는 0°로 삼는다.
      그래서 평평한 바닥에서 해야 한다.</p>
      <p>정상 샘플이 하나도 없으면 imuReady가 false로 남아서 주행이 시작되지 않는다. 버린 이유별 개수를 보고 배선, 장착 방향, 센서 잠듦 중 원인을 짐작해 출력한다.</p>
      <p>i는 I2C 주소를 훑고 WHO_AM_I가 0x68인지 본다.</p>`,
  },
  {
    from: 424, to: 457, title: '상보필터', mark: '442,448-449',
    note: `
      <p class="eq">각도 = 0.98 × (이전 각도 + 각속도 × dt) + 0.02 × 가속도계 각도</p>
      <p>자이로는 짧게 보면 정확하지만 오차가 쌓인다. 가속도계는 진동에 흔들리지만 길게 보면 맞다. 0.98이면 가속도계 쪽이 1초쯤 걸려 따라온다.</p>
      <p>[[442]]: 가속하거나 제동하면 가속도계가 그걸 기울기로 읽어서 엔코더로 잰 가감속만큼 빼 준다.</p>
      <p>깨진 샘플은 건너뛰고 다음 샘플에서 빠진 시간까지 한 번에 적분한다(최대 0.1초).</p>`,
  },
  {
    from: 458, to: 512, title: '모터', mark: '466-469,496',
    note: `
      <p>B(단락 제동)는 IN 두 개를 다 LOW로 둔다. 모터 단자가 이어지면 돌던 모터가 발전기처럼 전류를 흘리고 그게 제동력이 된다. 세기는 EN 듀티.</p>
      <p>C는 출력만 끊는다. 바퀴는 그냥 굴러간다.</p>
      <p>steer가 1을 넘으면 안쪽 바퀴 값이 음수가 돼서 거꾸로 돈다.</p>`,
  },
  {
    from: 513, to: 531, title: '조향', mark: '521,525-528',
    note: `
      <p>직진은 heading을 0으로 돌려놓는 비례 제어. 10° 틀어지면 steer가 −0.2.</p>
      <p>호를 따라 돌 때는 지나온 거리 / 반경으로 지금 돌아 있어야 할 각도를 구하고 기본값 0.22 (0.055 / 0.25)에 그 차이만큼 더한다. 속도가 바뀌어도 반경이 유지된다.</p>
      <p>지금 설정(TURN_PIVOT = true)에서는 회전 쪽 계산이 쓰이지 않는다.</p>`,
  },
  {
    from: 532, to: 543, title: '목표 속도', mark: '538,540-541',
    note: `
      <p>오르막, 3° 이하 경사, 10 deg/s 이하 회전은 0으로 친다.</p>
      <p>목표가 내려갈 땐 바로, 올라갈 땐 초당 0.3 m/s씩. 내리막이 끝나자마자 스로틀이 확 붙지 않게.</p>
      <p>20° 내리막에서 100 deg/s로 돌면 0.32 − 0.12 − 0.15 = 0.05인데, 하한 0.10에서 잘린다.</p>`,
  },
  {
    from: 544, to: 593, title: '제동', mark: '563,566-568,574-578',
    note: `
      <p>over는 실제 속도 − 목표. 로그의 state 칸이 아래 결과다.</p>
      <table>
        <tr><th>over &gt; 0.03</th><td>B 제동</td></tr>
        <tr><th>±0.03 안</th><td>C 출력 끊음 (쌓인 제동이 있으면 B)</td></tr>
        <tr><th>over ≤ −0.03</th><td>D 스로틀</td></tr>
      </table>
      <p class="eq">제동 PWM = 600 × over + 쌓인 값<br>쌓인 값 += 2000 × over × dt</p>
      <p>비례만 쓰면 내리막에서 중력을 버틸 만큼 속도가 목표를 넘은 채로 멈춘다(앞의 0.38 m/s). 쌓인 값이 그만큼을 메워서 목표까지 내려간다.
      ±0.03 안에서도 쌓인 값을 계속 거는 건, 거기서 끊으면 다시 빨라지기 때문.</p>
      <p>[[567]]: 20 ms에 25씩만 올려서 0에서 255까지 0.2초쯤 걸린다.</p>
      <p><a href="#sim">02 경사 주행</a> 그래프가 이 식으로 계산한 값이다.</p>`,
  },
  {
    from: 594, to: 610, title: 'LED', mark: '604',
    note: `
      <p>스위치는 풀업 입력이라 GND 쪽(LOW)이 제어 ON. 나머지는 주석 그대로.</p>`,
  },
  {
    from: 611, to: 655, title: '주행 시작', mark: '626,649-651',
    note: `
      <p>제어 ON/OFF는 출발할 때 한 번 읽는다. 달리는 중에 스위치를 바꿔도 소용없다.</p>
      <p>[[649]]~651행: 기준 시각을 카운트다운이 끝난 뒤로 맞춘다. 안 하면 카운트다운 3초가 첫 dt로 들어가서 적분이 튄다.</p>`,
  },
  {
    from: 656, to: 695, title: '주행 끝', mark: '662-667,685-687',
    note: `
      <p>회전을 다 돌면 반대 방향 최대 출력을 0.15초까지 줘서 급정지한다. 바퀴가 0.12 m/s 아래로 느려지면 그 바퀴만 단락 제동으로 바꿔서 거꾸로 돌지 않게 했다.</p>
      <p>멈추는 이유가 뭐든 1초 단락 제동 후 출력을 끊고 요약 한 줄을 남긴다.</p>`,
  },
  {
    from: 696, to: 772, title: '명령', mark: '744-747',
    note: `
      <p>명령은 글자 하나. USB를 먼저 보고 없으면 블루투스를 본다.</p>
      <p>[[744]]~747행: 보정이 안 됐으면 출발하지 않는다. IMU가 죽은 채로 달리면 넘어져도 못 멈춘다.</p>
      <p>l, r은 바퀴를 띄워 놓고 한쪽만 돌려서 펄스가 그쪽에서만 올라가는지 보는 배선 확인용.</p>`,
  },
  {
    from: 773, to: 797, title: 'setup', mark: '791-793',
    note: `
      <p>켜자마자 영점 보정까지 한다. 전원을 켤 때 평평한 곳에 가만히 둬야 하는 이유(초록 LED가 깜빡이는 2초).</p>`,
  },
  {
    from: 798, to: 877, title: 'loop', mark: '803,810,835-838',
    note: `
      <p>delay 없이 시각만 비교해서 20 ms마다 돈다. 그 사이에도 명령은 계속 받는다.</p>
      <p>[[810]]: 제자리 회전에서는 안쪽 바퀴가 거꾸로 돌아 평균이 0 근처라, 바깥 바퀴 속도만 쓴다.</p>
      <p>[[835]]: 넘어지면 모터부터 세우고 부저를 울린다. beep() 안에 0.5초 delay가 있어서 순서가 바뀌면 그동안 바퀴가 계속 돈다.</p>
      <p>제어 OFF는 넘어져도 로그만 남기고 계속 달린다. <a href="#tip">04 전도 상황</a>이 이 차이를 보여 준다.</p>`,
  },
];

// ---------------- C++ colouring, one line at a time (the file has no block comments) ----------------
// three colours only: comments, strings, numbers and constants; keywords and types are just bold
const KW = new Set(('if else for while do return const volatile static void break continue switch case default true false sizeof unsigned signed ' +
  'int float double bool char long short byte String int16_t uint8_t portMUX_TYPE BluetoothSerial').split(' '));
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b0x[0-9a-fA-F]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b)|([A-Za-z_]\w*)/g;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paint(line) {
  if (/^\s*#/.test(line)) return `<span class="t-kw">${esc(line)}</span>`;
  let out = '', at = 0;
  for (const m of line.matchAll(TOKEN)) {
    const [t, com, str, chr, num, id] = m;
    out += esc(line.slice(at, m.index));
    at = m.index + t.length;
    let cls = '';
    if (com) cls = 'com';
    else if (str || chr) cls = 'str';
    else if (num) cls = 'num';
    else if (KW.has(id)) cls = 'kw';
    else if (id.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(id)) cls = 'num';    // constants read like numbers: pins, gains, limits
    out += cls ? `<span class="t-${cls}">${esc(t)}</span>` : esc(t);
  }
  return out + esc(line.slice(at));
}

function markSet(spec) {
  const s = new Set();
  for (const r of spec.split(',')) {
    const [a, b = a] = r.split('-').map(Number);
    for (let n = a; n <= b; n++) s.add(n);
  }
  return s;
}

const lineRef = (html) => html.replace(/\[\[(\d+)\]\]/g, '<button type="button" class="lref" data-l="$1">$1행</button>');

export function createCode() {
  const root = document.getElementById('code-ui');
  const list = root.querySelector('.code-parts');
  const nav = root.querySelector('.code-nav');
  let loading = null;

  function build(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    // a part list that no longer matches the file still shows every line: the rest goes into one last part
    const parts = PARTS.filter((p) => p.from <= lines.length);
    const end = parts.length ? Math.min(parts[parts.length - 1].to, lines.length) : 0;
    if (end < lines.length) parts.push({ from: end + 1, to: lines.length, title: '나머지', mark: '', note: '' });

    list.innerHTML = parts.map((p, i) => {
      const marks = p.mark ? markSet(p.mark) : new Set();
      let last = Math.min(p.to, lines.length);
      while (last > p.from && !lines[last - 1].trim()) last--;              // no blank lines at the bottom of a block
      let src = '';
      for (let n = p.from; n <= last; n++) {
        src += `<span class="l${marks.has(n) ? ' mk' : ''}" id="L${n}" data-n="${n}">${paint(lines[n - 1]) || ' '}</span>`;
      }
      return `<article class="part" id="part-${i}" aria-labelledby="part-${i}-h">
        <div class="note"><h3 id="part-${i}-h">${p.title}</h3>${lineRef(p.note)}</div>
        <pre class="src"><code>${src}</code></pre>
      </article>`;
    }).join('');
    nav.innerHTML = parts.map((p, i) => `<button type="button" data-part="${i}">${p.title}</button>`).join('');

    nav.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-part]');
      if (b) root.querySelector(`#part-${b.dataset.part}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.lref');
      if (!b) return;
      const line = root.querySelector(`#L${b.dataset.l}`);
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      line.classList.remove('flash');
      void line.offsetWidth;                                               // restart the flash on a second click
      line.classList.add('flash');
    });

    // the part in the upper third of the window is the one lit in the list
    const buttons = [...nav.children];
    const seen = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const i = Number(en.target.id.slice(5));
        buttons.forEach((b, k) => b.classList.toggle('on', k === i));
        const b = buttons[i];
        if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: b.offsetLeft - 12, behavior: 'smooth' });
      }
    }, { root, rootMargin: '-15% 0px -70% 0px' });
    list.querySelectorAll('.part').forEach((el) => seen.observe(el));

    // a note stays beside its code while scrolling, unless it is taller than the window
    const notes = [...list.querySelectorAll('.note')];
    const fit = () => notes.forEach((n) => n.classList.toggle('stick', n.offsetHeight < root.clientHeight - 110));
    new ResizeObserver(fit).observe(root);
    fit();
  }

  function enter() {
    loading ??= fetch(FILE)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(build)
      .catch(() => {
        loading = null;                                                    // try again on the next visit
        list.innerHTML = '<p class="code-msg">코드 파일을 불러오지 못했어요. 새로고침해 주세요.</p>';
      });
  }

  return { enter };
}
