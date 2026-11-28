// Source code screen: the firmware prj_test3.ino, cut into parts by line number,
// each part with a short note beside it. The file is fetched the first time the screen opens.

const FILE = 'firmware/prj_test3.ino';

// [[n]] in a note becomes a button that scrolls to line n and flashes it.
// mark: the lines a note talks about ('48-56,61').
const PARTS = [
  {
    from: 1, to: 39, title: '머리말 주석', mark: '7-9',
    note: `
      <p>20 ms마다 실제 속도, 경사각, 회전 각속도를 재고, 목표 속도와 비교해서 스로틀, 출력 끊음, 제동 중 하나를 고른다.</p>
      <p class="eq">목표 속도 = V_BASE − K1 × 경사각 − K2 × |회전 각속도|</p>
      <p>내리막이 가파를수록, 빨리 돌수록 목표 속도가 낮아진다.</p>`,
  },
  {
    from: 40, to: 62, title: '핀, 블루투스', mark: '43-45,48-49',
    note: `
      <p>아두이노 IDE에서 보드를 ESP32 Dev Module로 고르지 않으면 블루투스 설정이 빠져서 [[43]]~45행에서 컴파일이 멈춘다.</p>
      <p>속도센서를 GPIO 34, 35번에 꽂은 건 입력 전용 핀이라서다. 이 두 핀은 내부 풀업 저항이 없어서 센서 모듈에 달린 풀업 저항을 쓴다.</p>
      <p>휴대폰의 Serial Bluetooth Terminal 앱에서 블루투스 이름 SlopeGuard_5로 연결한다. 시뮬레이션 화면의 터미널이 이 앱을 따라 만든 것.</p>`,
  },
  {
    from: 63, to: 94, title: '제어 상수', mark: '64-66,71,75-78,89',
    note: `
      <p class="eq">펄스 하나 = 바퀴 둘레 / 원판 구멍 수<br>= π × 0.065 m / 20 ≈ 1.02 cm</p>
      <p>스로틀 PWM(최대 255)을 일부러 190에 뒀다. 끝까지 안 당겨도 내리막에서는 빨라지는 상황을 만들려고.
      V_BASE 0.32 m/s는 스로틀 190의 평지 예상 속도 0.28 m/s보다 조금 높아서 평지에서는 제어가 안 걸린다.</p>
      <p>목표 속도는 내리막 1°마다 0.006 m/s(K1), 회전 각속도 1 deg/s마다 0.0015 m/s(K2)씩 내려가고, 0.10 m/s(V_MIN) 밑으로는 안 내려간다.</p>
      <table>
        <tr><th>내리막</th><td>3° 이하</td><td>10°</td><td>20°</td><td>30°</td></tr>
        <tr><th>목표 속도 (m/s)</th><td>0.32</td><td>0.26</td><td>0.20</td><td>0.14</td></tr>
      </table>
      <p>처음엔 비례 제동만 넣었는데, PC 시뮬레이션 20° 경사에서 속도가 목표 속도 0.20 m/s가 아니라 0.38 m/s에서 더 안 내려갔다. 그래서 적분 제동(KI_BRAKE)을 추가했다.</p>`,
  },
  {
    from: 95, to: 115, title: '직진, 회전 상수', mark: '96,100-101,104-107,110-113',
    note: `
      <p>직진 코스는 50 cm를 간다. 방향이 1° 틀어질 때마다 좌우 출력을 2%씩(KH_STEER 0.02) 다르게 줘서 0°로 되돌리고, 그 차이는 60%(STEER_MAX)까지만 준다.</p>
      <p>회전 코스는 급회전 상황이라 스로틀 PWM을 255(최대)로 올렸다. TURN_PIVOT이 true면 바깥 바퀴는 앞으로, 안쪽 바퀴는 뒤로 같은 세기(255)로 돌려서 거의 제자리에서 돈다.
      90°를 다 돌면 바퀴를 반대로 최대 0.15초 돌려 세운다.</p>
      <p>종료 조건은 경사로 1.6 m(출발대와 경사판 길이), 회전 0.7 m 또는 3초, 모든 코스 공통 8초다. 차가 코스 밖으로 달려 나가지 않게 넣은 값.</p>`,
  },
  {
    from: 116, to: 147, title: '넘어짐, IMU 상수', mark: '118-120,131,134',
    note: `
      <p>넘어짐은 가속도계로 본 각도로만 판정한다. 좌우 50° 또는 앞뒤 65°를 5샘플(0.1초) 연속으로 넘어야 넘어진 것으로 본다.
      자이로 적분값은 튄 값이 한 번 들어가면 계속 남아서 판정에 쓰지 않는다.</p>
      <p>앞뒤 기준이 좌우보다 큰 건, 30° 경사에서 제동까지 걸리면 앞뒤 각도가 크게 나와서.</p>
      <p>자이로 범위를 ±1000 deg/s로 넓혀서 원시값 32.8이 1 deg/s다(32768 / 1000). 제자리 회전에서도 측정 범위를 넘지 않는다.</p>`,
  },
  {
    from: 148, to: 193, title: '전역 변수', mark: '156-161',
    note: `
      <p>엔코더 변수는 인터럽트 안에서 바뀌어서 volatile을 붙였다. loop에서 읽을 때는 읽는 도중에 값이 바뀌지 않게 encMux로 잠근다.</p>
      <p>FC-03 속도센서는 바퀴가 어느 쪽으로 도는지 모른다. 그래서 모터에 준 방향(dirL, dirR, 앞 +1, 뒤 −1)을 펄스에 곱해서 거꾸로 도는 바퀴는 거리에서 빠지게 했다.</p>`,
  },
  {
    from: 194, to: 238, title: '엔코더', mark: '199,202-204,220-222',
    note: `
      <p>펄스 간격이 2 ms보다 짧으면 버린다. 속도로 치면 1.02 cm / 2 ms ≈ 5 m/s라서 센서 떨림일 수밖에 없다.</p>
      <p>펄스 주기는 (이전 평균 × 3 + 새 간격) / 4로 부드럽게 하고, 0.3초 넘게 펄스가 없으면 멈춘 것(0 m/s)으로 본다.</p>
      <p class="eq">속도 = 1.02 cm / 펄스 주기</p>
      <p>[[221]]: 다음 펄스가 평소 주기보다 늦어지고 있으면 기다린 시간을 주기로 써서 속도를 바로 낮춘다. 이게 없으면 감속이 펄스 하나만큼 늦게 잡힌다.</p>`,
  },
  {
    from: 239, to: 264, title: 'MPU6050 설정', mark: '247-248,252-254,260-261',
    note: `
      <p>내부 저역통과 필터를 약 44 Hz로 켜서 모터 진동을 줄이고, 자이로는 ±1000 deg/s, 가속도는 ±2 g 범위로 둔다.</p>
      <p>전원이 흔들려 센서가 리셋되면 다시 잠든 상태(값이 전부 0)가 된다. 그래서 켤 때만이 아니라 c(영점 보정), i(IMU 점검) 명령 때도 설정을 다시 쓴다.</p>
      <p>I2C 통신 속도는 모터 노이즈 때문에 100 kHz로 낮췄고, 통신이 막혀도 10 ms 안에 빠져나오게 타임아웃을 걸었다.</p>`,
  },
  {
    from: 265, to: 324, title: 'MPU6050 읽기', mark: '279-284,286-291,300-303',
    note: `
      <p>원시값을 가속도는 16384, 각속도는 32.8로 나눠 g와 deg/s로 바꾼다. 핀이 위로 오게 뒤집어 붙여서 가속도와 자이로의 y, z축 부호를 바꿔 읽는다.</p>
      <p>[[300]]~303행은 두 번째 시안 때문에 넣었다. 평지에 가만히 서 있는데 값이 튀어서 "기울기 초과로 정지"가 떴다.
      지금은 가속도 크기가 0.5~1.5 g 밖이거나, z축이 −0.1 g보다 작거나(뒤집힌 값), 자이로가 960 deg/s를 넘는(포화) 샘플을 버린다.</p>`,
  },
  {
    from: 325, to: 423, title: '보정과 점검', mark: '343-346,377-381,385,392-395,403-405',
    note: `
      <p>c 명령은 10 ms 간격으로 200번(2초) 읽은 정상 샘플의 평균으로 영점을 잡는다. 자이로 평균은 바이어스라서 이후 매번 빼고 그때의 경사각과 좌우각은 0°로 삼는다.
      그래서 평평한 바닥에서 해야 한다.</p>
      <p>정상 샘플이 하나도 없으면 imuReady가 false로 남아서 주행이 시작되지 않는다. 버린 이유(읽기 실패, 가속도 크기, z축 음수, 자이로 포화)별 개수를 보고
      배선, 장착 방향, 센서 잠듦 중 원인을 짐작해 출력한다.</p>
      <p>i 명령은 I2C 주소 1~126을 훑어 응답하는 장치를 찾고, WHO_AM_I 레지스터가 0x68인지 본 뒤 센서 값을 5번 보여 준다.</p>`,
  },
  {
    from: 424, to: 457, title: '상보필터', mark: '442,444-445,448-449,451-452',
    note: `
      <p class="eq">각도 = 0.98 × (이전 각도 + 각속도 × dt) + 0.02 × 가속도계 각도</p>
      <p>자이로는 짧게 보면 정확하지만 오차가 쌓인다. 가속도계는 진동에 흔들리지만 길게 보면 맞다.
      0.98이면 가속도계 쪽이 1초쯤 걸려 따라온다(시간 상수 0.98 × 0.02 s / 0.02 ≈ 1 s).</p>
      <p>[[442]]: 가속하거나 제동하면 가속도계가 그걸 기울기로 읽어서 엔코더로 잰 가감속(m/s²)을 g로 나눠 빼 준다.</p>
      <p>회전각(heading)은 회전 각속도를 시간으로 적분해서 쌓는다. 오른쪽이 +.</p>
      <p>깨진 샘플은 건너뛰고 다음 샘플에서 빠진 시간까지 한 번에 적분한다(최대 0.1초).</p>`,
  },
  {
    from: 458, to: 512, title: '모터', mark: '462-469,496,506-507',
    note: `
      <p>L298N은 모터 하나에 IN 두 개(방향)와 EN 하나(세기)를 쓴다.</p>
      <p>B(단락 제동)는 IN 두 개를 다 LOW로 둔다. 모터 단자가 이어지면 돌던 모터가 발전기처럼 전류를 흘리고 그게 제동력이 된다. 세기는 EN 핀의 PWM 듀티(0~255).</p>
      <p>C는 출력만 끊는다. 바퀴는 그냥 굴러간다.</p>
      <p>좌우 출력이 pwm × (1 + steer), pwm × (1 − steer)라서 steer가 1을 넘으면 안쪽 바퀴 값이 음수가 돼서 거꾸로 돈다.
      제자리 회전은 바깥 바퀴 255로 앞, 안쪽 바퀴 255로 뒤([[506]]).</p>`,
  },
  {
    from: 513, to: 531, title: '조향', mark: '521,525-528',
    note: `
      <p>직진은 heading(출발 후 누적 회전각)을 0°로 돌려놓는 비례 제어다. steer = −0.02 × heading이라 오른쪽으로 10° 틀어지면 steer가 −0.2가 되고,
      왼쪽 바퀴 출력이 줄고 오른쪽이 늘어서 되돌아온다. ±0.6에서 자른다.</p>
      <p>호를 따라 돌 때는 지나온 거리 / 반경으로 지금 돌아 있어야 할 각도를 구하고 기본값 0.22(트랙 절반 0.055 m / 반경 0.25 m)에
      각도 차이 1°당 0.04(KH_TURN)를 더한다. 속도가 바뀌어도 반경이 유지된다.</p>
      <p>지금 설정(TURN_PIVOT = true)에서는 회전 쪽 계산이 쓰이지 않는다.</p>`,
  },
  {
    from: 532, to: 543, title: '목표 속도', mark: '534-538,540-541',
    note: `
      <p>3° 이하 경사와 오르막은 내리막 0°로, 10 deg/s 이하 회전은 0 deg/s로 친다. 센서 잡음 때문에 평지 직진에서 목표 속도가 흔들리지 않게 하려는 것.</p>
      <p>목표 속도가 내려갈 땐 바로, 올라갈 땐 초당 0.3 m/s씩. 내리막이 끝나자마자 스로틀이 확 붙지 않게.</p>
      <p>20° 내리막에서 100 deg/s로 돌면 0.32 − 0.006 × 20 − 0.0015 × 100 = 0.05 m/s인데, 하한 0.10 m/s에서 잘린다.</p>`,
  },
  {
    from: 544, to: 593, title: '제동', mark: '560,563,565-568,573-578,585-588',
    note: `
      <p>over = 실제 속도 − 목표 속도. 로그의 state 칸이 아래 결과다.</p>
      <table>
        <tr><th>over &gt; 0.03 m/s</th><td>B 제동</td></tr>
        <tr><th>±0.03 m/s 안</th><td>C 출력 끊음 (쌓인 제동이 1 이상 남아 있으면 B)</td></tr>
        <tr><th>over ≤ −0.03 m/s</th><td>D 스로틀 (쌓인 제동은 0으로 비움)</td></tr>
      </table>
      <p class="eq">제동 PWM = 600 × over + 쌓인 값 (0~255)<br>쌓인 값 += 2000 × over × dt (0~255)</p>
      <p>비례만 쓰면 내리막에서 중력을 버틸 만큼 속도가 목표 속도를 넘은 채로 멈춘다(앞의 0.38 m/s). 쌓인 값이 그만큼을 메워서 목표 속도까지 내려간다.
      예를 들어 0.05 m/s 넘은 상태로 1초가 지나면 100이 쌓인다. ±0.03 안에서도 쌓인 값을 계속 거는 건, 거기서 끊으면 다시 빨라지기 때문.</p>
      <p>[[567]]: 제동 PWM은 20 ms에 25씩만 올려서 0에서 255까지 0.2초쯤 걸린다.</p>
      <p><a href="#sim">02 경사 주행</a> 그래프가 이 식으로 계산한 값이다.</p>`,
  },
  {
    from: 594, to: 610, title: 'LED', mark: '599-602,604-608',
    note: `
      <p>주행 전에는 스위치 위치를 보여 준다(ON 빨강, OFF 초록). 제어 ON으로 달리다 제동(B)하면 빨강이 0.1초 간격으로 깜빡이고,
      넘어져 멈춘 뒤에는 다음 주행이나 c 전까지 0.5초 간격으로 깜빡인다.</p>
      <p>스위치는 풀업 입력이라 GND 쪽(LOW)이 제어 ON.</p>`,
  },
  {
    from: 611, to: 655, title: '주행 시작', mark: '626,629-632,649-651',
    note: `
      <p>출발 명령(s, f, t)을 받는 순간 스위치를 한 번 읽어 제어 ON/OFF를 정한다. 달리는 중에 스위치를 바꾸면 다음 주행부터 반영된다.</p>
      <p>부저가 1초 간격으로 세 번 울린 뒤 출발한다. 시뮬레이션의 3, 2, 1 카운트다운이 이것.</p>
      <p>[[649]]~651행: 기준 시각을 카운트다운이 끝난 뒤로 맞춘다. 안 하면 카운트다운 3초가 첫 주기의 dt로 들어가서 제동 적분값 같은 계산이 한 번에 튄다.</p>`,
  },
  {
    from: 656, to: 695, title: '주행 끝', mark: '662-667,670-680,685-693',
    note: `
      <p>회전 코스에서 90°를 다 돌면 도는 방향과 반대로 PWM 255를 최대 0.15초 줘서 급정지한다.
      바퀴 속도가 0.12 m/s 아래로 떨어지면 그 바퀴만 단락 제동으로 바꿔서 거꾸로 돌지 않게 했다.</p>
      <p>멈추는 이유(거리 도달, 시간 초과, 수동 정지, 기울기 초과, 회전 완료)가 뭐든 1초 동안 단락 제동 255를 건 뒤 출력을 끊고
      요약 한 줄(코스, 모드, 최고 속도, 주행 거리, 회전각, 버린 IMU 샘플 수)을 남긴다.</p>`,
  },
  {
    from: 696, to: 772, title: '명령', mark: '708-709,743-752',
    note: `
      <p>명령은 글자 하나다. s 경사로, f 직진, t 회전, x 정지, c 영점, i IMU 점검, l과 r 바퀴 하나, ? 상태. USB 시리얼을 먼저 보고 없으면 블루투스를 본다.</p>
      <p>[[744]]~747행: IMU 보정(c)이 성공하지 않았으면 출발하지 않는다. IMU 값이 안 나오는 채로 달리면 넘어져도 못 멈춘다.</p>
      <p>l, r은 바퀴를 띄워 놓고 한쪽만 스로틀 190으로 2초 돌려서 펄스가 그쪽에서만 올라가는지 보는 배선 확인용. 도중에 x를 보내면 바로 멈춘다.</p>`,
  },
  {
    from: 773, to: 797, title: 'setup', mark: '775-776,786,788-789,791-793',
    note: `
      <p>전원을 켜면 한 번 돈다. 시리얼(115200)과 블루투스를 열고, 모터 출력을 끊어 두고, 속도센서 신호가 올라갈 때(RISING)마다 인터럽트가 불리게 연결한다.</p>
      <p>그다음 바로 영점 보정까지 한다. 그래서 전원을 켤 때는 평평한 곳에 가만히 둬야 한다. 보정하는 2초 동안 초록 LED가 깜빡인다.</p>`,
  },
  {
    from: 798, to: 877, title: 'loop', mark: '803,810,830-831,835-838,871-875',
    note: `
      <p>millis()로 시각만 비교해서 20 ms마다 측정과 제어를 한다. delay로 기다리지 않아서 그 사이에도 명령은 계속 받는다.</p>
      <p>[[810]]: 제자리 회전에서는 안쪽 바퀴가 거꾸로 돌아 좌우 평균이 0 근처라, 바깥 바퀴 속도만 쓴다.</p>
      <p>[[835]]: 넘어지면(5샘플 연속) 모터부터 세우고 부저를 0.5초 울린다. beep() 안에 0.5초 delay가 있어서 순서가 바뀌면 그동안 바퀴가 계속 돈다.</p>
      <p>제어 OFF는 넘어져도 "기울기 초과 (제어 OFF라 멈추지 않음)" 한 줄만 남기고 계속 달린다. <a href="#tip">04 전도 상황</a>이 이 차이를 보여 준다.</p>
      <p>주기마다 끝에 CSV 로그 한 줄(t_ms, mode, slope, roll, speed, target, pwm, state, yaw, heading)을 보낸다.</p>`,
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
