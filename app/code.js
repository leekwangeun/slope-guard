// Source code screen: the firmware prj_test3.ino, cut into parts by line number,
// each part with a note beside it. The file is fetched the first time the screen opens.

const FILE = 'firmware/prj_test3.ino';

// [[n]] in a note becomes a button that scrolls to line n and flashes it.
// mark: the lines a note talks about, drawn with a bar on the left ('48-56,61').
const PARTS = [
  {
    from: 1, to: 39, title: '동작 요약', mark: '7-9',
    note: `
      <p>ESP32에 올리는 펌웨어 전체가 이 파일 하나다. <code>setup()</code>이 전원을 켤 때 한 번 돌고,
      그 뒤로 <code>loop()</code>가 0.02초(50 Hz)마다 아래 순서를 되풀이한다.</p>
      <ul class="flow">
        <li>엔코더로 실제 속도 재기</li>
        <li>MPU6050으로 경사각, 좌우각, 회전 각속도 구하기</li>
        <li>넘어짐과 종료 조건 검사</li>
        <li>목표 속도 계산</li>
        <li>스로틀, 출력 끊음, 제동 중 하나를 모터에 주기</li>
        <li>CSV 로그 한 줄 보내기</li>
      </ul>
      <p>제어의 중심은 목표 속도 식이다. 내리막이 가파를수록, 빠르게 돌수록 목표를 낮추고,
      실제 속도가 목표를 넘으면 모터 출력을 끊고 전자 제동을 건다.</p>
      <p class="eq">목표 = V_BASE − K1 × 경사각 − K2 × |회전 각속도|</p>
      <p>코스는 세 가지다. <code>s</code> 경사로(1.6 m), <code>f</code> 직진(50 cm), <code>t</code> 오른쪽 90° 회전.</p>`,
  },
  {
    from: 40, to: 62, title: '라이브러리, 핀, 블루투스', mark: '48-56',
    note: `
      <p><code>Wire.h</code>는 MPU6050과 주고받는 I2C 통신, <code>BluetoothSerial.h</code>는 ESP32에 들어 있는
      블루투스 클래식으로 시리얼 포트를 하나 더 여는 라이브러리다. 보드를 잘못 고르면 블루투스 설정이 빠지는데,
      그때는 [[44]]의 <code>#error</code>가 컴파일 단계에서 바로 알려 준다.</p>
      <p>핀 번호는 부품표와 회로 연결도를 따른다. 34, 35번은 ESP32에서 입력만 되는 핀이라 출력이 필요 없는 속도센서에 썼다.
      모터 하나는 L298N 핀 세 개로 움직인다. IN 두 개가 방향을, EN이 PWM으로 세기를 정한다.</p>
      <table>
        <tr><th>왼쪽 모터</th><td>ENA 25, IN1 26, IN2 27</td></tr>
        <tr><th>오른쪽 모터</th><td>ENB 33, IN3 16, IN4 17</td></tr>
        <tr><th>속도센서</th><td>왼쪽 34, 오른쪽 35</td></tr>
        <tr><th>MPU6050</th><td>SDA 21, SCL 22</td></tr>
        <tr><th>계기판</th><td>부저 18, 빨간 LED 19, 초록 LED 23, 스위치 13</td></tr>
      </table>
      <p>블루투스 이름은 <code>SlopeGuard_5</code>다. 휴대폰의 Serial Bluetooth Terminal 앱으로 연결해 명령을 보내고 로그를 받는다.
      시뮬레이션 화면의 터미널이 이 앱을 본뜬 것이다.</p>`,
  },
  {
    from: 63, to: 94, title: '속도 제어 설정값', mark: '66,71,75-78,84,89',
    note: `
      <p>엔코더 원판은 한 바퀴에 구멍이 20개라, 펄스 하나는 바퀴 둘레의 1/20이다.</p>
      <p class="eq">M_PER_PULSE = π × 0.065 / 20 ≈ 0.0102 m</p>
      <p>스로틀을 255가 아니라 190으로 둔 것은, 탑승자가 스로틀을 끝까지 당기지 않아도 내리막에서는 평지보다 빨라지는 상황을 만들기 위해서다.
      평지 목표 <code>V_BASE</code> 0.32 m/s는 스로틀 190의 예상 평지 속도 0.28 m/s보다 0.04 높게 잡았다. 그래서 평지에서는 제어가 끼어들지 않는다.</p>
      <table>
        <tr><th>내리막</th><td>3° 이하</td><td>10°</td><td>20°</td><td>30°</td></tr>
        <tr><th>목표 속도</th><td>0.32</td><td>0.26</td><td>0.20</td><td>0.14 m/s</td></tr>
      </table>
      <p><code>K2</code> 0.0015는 회전 각속도 100 deg/s에서 목표를 0.15 m/s 낮춘다. 경사 3°, 회전 10 deg/s보다 작은 값은 0으로 봐서
      센서 잡음 때문에 목표가 흔들리지 않게 했다.</p>
      <p>제동 세기는 PWM(0~255)으로 정한다. <code>KP_BRAKE</code>는 넘은 속도에 비례하는 몫, <code>KI_BRAKE</code>는 넘은 상태가 이어진 시간만큼 쌓이는 몫이다.
      비례 제동만 쓰면 PC 시뮬레이션의 20° 경사에서 목표 0.20 m/s가 아니라 0.38 m/s에서 제동력과 중력이 맞아 더 내려가지 않아서 적분항을 더했다.</p>`,
  },
  {
    from: 95, to: 115, title: '직진, 회전, 종료 조건', mark: '96,100-101,104-107,110-113',
    note: `
      <p>직진 코스는 방향이 1° 틀어질 때마다 좌우 출력을 2%씩 다르게 줘서 0°로 되돌린다(<code>KH_STEER</code>). 차이는 60%까지만 준다.</p>
      <p>회전 코스는 급회전 시나리오라 스로틀을 255로 올렸다. <code>TURN_PIVOT</code>이 <code>true</code>면 바깥 바퀴는 앞으로,
      안쪽 바퀴는 거꾸로 같은 세기로 돌려 제자리에 가깝게 돈다. <code>false</code>면 반경 25 cm 호를 따라 돈다.
      90°를 다 돌면 바퀴를 반대로 최대 0.15초 돌려 급정지한다.</p>
      <p>어느 코스든 끝나는 조건이 있다. 경사로는 1.6 m(출발대와 경사판 길이), 회전은 0.7 m나 3초, 모든 코스는 8초다.
      차가 멈추지 않고 계속 달려 나가는 일을 막는 안전장치다.</p>`,
  },
  {
    from: 116, to: 147, title: '넘어짐 판정과 IMU 설정', mark: '118-120,131,134,137-140',
    note: `
      <p>넘어짐은 가속도계로 본 기울기로만 판정한다. 자이로를 적분한 각도는 튀는 값이 한 번 들어가면 그대로 쌓이지만,
      가속도계 각도는 샘플마다 새로 구하기 때문이다.</p>
      <p>좌우 50°, 앞뒤 65°를 5샘플(0.1초) 연속으로 넘어야 넘어짐으로 본다. 앞뒤 기준이 더 큰 것은 경사 30°에 제동 감속까지 더해져도
      넘어짐으로 착각하지 않게 하려는 것이다.</p>
      <p>MPU6050은 핀이 위로 오게 뒤집어 붙였다(<code>IMU_UPSIDE_DOWN</code>). 자이로는 ±1000 deg/s 범위라 1 deg/s가 32.8 LSB다(32768 / 1000).
      제자리 회전이나 넘어지는 순간에도 값이 포화되지 않게 넓은 범위를 골랐다.</p>
      <p>[[137]]부터의 네 기준(가속도 크기 0.5~1.5 g, z축 −0.1 g 이상, 자이로 960 deg/s 미만)은 모터 노이즈로 깨진 샘플을 거르는 데 쓴다.</p>`,
  },
  {
    from: 148, to: 193, title: '로그 출력과 상태 변수', mark: '152,161,186,190-192',
    note: `
      <p><code>logLine()</code>은 같은 줄을 USB 시리얼과 블루투스에 함께 보낸다. 블루투스는 연결되어 있을 때만 보낸다.</p>
      <p>엔코더 값에 붙은 <code>volatile</code>은 인터럽트가 언제든 바꾸는 변수라는 표시다. 컴파일러가 값을 레지스터에 담아 두고 재사용하지 않게 한다.
      <code>encMux</code>는 값을 읽는 도중에 인터럽트가 끼어들어 반쯤 바뀐 값을 읽는 일을 막는 잠금이다.</p>
      <p>FC-03 속도센서는 구멍이 지나가는 것만 보고 도는 방향은 모른다. 그래서 모터에 준 방향(<code>dirL</code>, <code>dirR</code>)을 펄스에 곱해,
      거꾸로 도는 바퀴는 거리에서 빼도록 했다.</p>
      <p><code>brakeI</code>는 제동 적분항, <code>tiltCount</code>는 기울기 기준을 넘은 연속 샘플 수,
      <code>tipAlarm</code>은 넘어져 멈춘 뒤 경고 LED를 켤지 정하는 값이다.</p>`,
  },
  {
    from: 194, to: 238, title: '엔코더: 속도와 거리', mark: '199,202-204,220-222,229',
    note: `
      <p>원판 구멍이 센서 홈을 지날 때마다 신호가 올라가고(RISING) 인터럽트 함수가 불린다. 이 함수는 직전 펄스와의 시간 간격을 잰다.</p>
      <ul>
        <li>2 ms보다 짧은 간격은 센서 떨림으로 보고 버린다. 속도로 치면 5 m/s가 넘어서 모형에서는 나올 수 없는 값이다.</li>
        <li>간격은 새 값 1, 이전 평균 3의 비율로 섞어 부드럽게 만든다.</li>
        <li>0.3초 넘게 펄스가 없으면 멈춘 것으로 본다.</li>
      </ul>
      <p class="eq">속도 = M_PER_PULSE / 펄스 간격</p>
      <p>[[221]]이 중요하다. 다음 펄스가 평소 간격보다 늦게 오고 있으면, 지금까지 기다린 시간을 간격으로 써서 속도를 낮춘다.
      감속을 다음 펄스가 올 때까지 기다리지 않고 바로 알아챈다.</p>
      <p>거리는 좌우 펄스 수의 평균에 펄스당 거리를 곱한다.</p>`,
  },
  {
    from: 239, to: 264, title: 'MPU6050 설정', mark: '251-254,260-261',
    note: `
      <p>MPU6050은 레지스터에 값을 써서 설정한다.</p>
      <table>
        <tr><th>0x6B ← 0x00</th><td>슬립 해제 (전원을 켜면 잠든 상태로 시작)</td></tr>
        <tr><th>0x1A ← 0x03</th><td>내부 저역통과 필터 약 44 Hz, 모터 진동 줄이기</td></tr>
        <tr><th>0x1B ← 0x10</th><td>자이로 ±1000 deg/s</td></tr>
        <tr><th>0x1C ← 0x00</th><td>가속도 ±2 g</td></tr>
      </table>
      <p>전원이 흔들려 센서가 리셋되면 다시 잠든 상태(값이 전부 0)가 된다. 그래서 이 설정을 켤 때만이 아니라
      <code>c</code> 보정과 <code>i</code> 점검 때도 다시 보낸다.</p>
      <p>I2C는 100 kHz로 둔다. 통신이 느릴수록 모터 노이즈에 덜 흔들린다. 통신이 막혀도 10 ms 안에 빠져나오게 해서 제어 주기가 멈추지 않게 했다.</p>`,
  },
  {
    from: 265, to: 324, title: '센서 읽기와 깨진 값 거르기', mark: '268-270,279-284,286-291,300-303',
    note: `
      <p>0x3B 레지스터부터 14바이트를 한 번에 읽는다. 가속도 x, y, z, 온도, 자이로 x, y, z 순서이고,
      값마다 상위 바이트가 먼저 오는 16비트 정수다.</p>
      <p class="eq">가속도(g) = 원시값 / 16384<br>각속도(deg/s) = 원시값 / 32.8</p>
      <p>센서를 X축 기준으로 뒤집어 붙였으므로 y, z 방향이 반대로 나온다. [[286]]에서 네 값의 부호를 바꿔 원래 방향으로 돌려 놓는다.</p>
      <p>가만히 있거나 주행 중인 모형에서 가속도 크기는 1 g 근처다. <code>sampleProblem()</code>은 이 범위를 벗어난 샘플을 깨진 값으로 본다.
      두 번째 시안에서는 평지에 서 있는데도 MPU6050 값이 튀어 "기울기 초과로 정지"가 나왔고, 세 번째 시안은 이 검사로 그런 샘플을 버린다.</p>`,
  },
  {
    from: 325, to: 423, title: '영점 보정과 IMU 점검', mark: '343-346,362-364,377-381,403-405',
    note: `
      <p><code>c</code>를 보내면 평평한 곳에 가만히 둔 채로 2초 동안 200번 읽고, 정상 샘플만 평균 낸다. 보정하는 동안 초록 LED가 깜빡인다.</p>
      <ul>
        <li>자이로 평균: 가만히 있어도 0이 아닌 값(바이어스)이다. 이후 읽는 값마다 빼 준다.</li>
        <li>가속도 평균으로 구한 각도: 바닥이나 센서가 살짝 기운 만큼을 0°로 삼는다.</li>
      </ul>
      <p>정상 샘플이 하나도 없으면 <code>imuReady</code>를 <code>false</code>로 두고, 버린 이유를 세어 가장 그럴듯한 원인을 알려 준다.
      I2C가 아예 안 되면 배선, z축이 거꾸로면 장착 방향 설정, 값이 전부 0이면 센서가 잠든 상태다.</p>
      <p><code>i</code> 점검은 I2C 주소 1~126에 차례로 신호를 보내 응답하는 장치를 찾고, WHO_AM_I 레지스터(0x75)가 0x68인지 확인한 뒤 값을 5번 보여 준다.</p>`,
  },
  {
    from: 424, to: 457, title: '자세 추정 (상보필터)', mark: '427-430,442,444-445,448-449,451-452',
    note: `
      <p>주기마다 센서를 읽어 경사각(pitch), 좌우각(roll), 회전 각속도(yaw)를 갱신한다. 깨진 샘플이면 아무것도 바꾸지 않고 이전 값을 쓴다.
      이때 마지막 시각도 그대로 두기 때문에, 다음 정상 샘플이 빠진 시간까지 이어서 적분한다(최대 0.1초).</p>
      <p>차가 가속하거나 제동하면 가속도계는 그 힘까지 함께 느껴서 기울어진 것으로 착각한다. 그래서 엔코더로 구한 가감속을 g로 나눠
      x축 가속도에서 뺀다([[442]]).</p>
      <p>각도는 두 센서를 섞어서 구한다. 자이로는 짧은 시간에는 정확하지만 적분 오차가 쌓이고, 가속도계는 오래 보면 정확하지만 진동에 흔들린다.</p>
      <p class="eq">각도 = 0.98 × (이전 각도 + 각속도 × dt)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ 0.02 × 가속도계 각도</p>
      <p>이 비율이면 가속도계 값이 약 1초에 걸쳐 반영된다(시간 상수 0.98 × 0.02초 / 0.02 ≈ 0.98초).
      회전각(heading)은 회전 각속도를 시간으로 적분해 쌓는다.</p>`,
  },
  {
    from: 458, to: 512, title: '모터 구동', mark: '462-469,496,506-507',
    note: `
      <p>L298N은 모터 하나에 IN 두 개와 EN 하나를 쓴다. <code>setMotor()</code>의 네 가지 모드는 다음과 같다.</p>
      <table>
        <tr><th>F</th><td>전진. IN 한쪽만 HIGH, EN에 PWM</td></tr>
        <tr><th>R</th><td>후진. IN을 반대로</td></tr>
        <tr><th>B</th><td>단락 제동. IN 둘 다 LOW로 두면 모터 단자가 이어져, 돌던 모터가 만드는 역기전력이 제동 전류를 흘린다. EN 듀티로 세기 조절</td></tr>
        <tr><th>C</th><td>출력 끊음. EN 0, 바퀴가 그냥 굴러간다</td></tr>
      </table>
      <p><code>driveForward(pwm, steer)</code>는 왼쪽에 pwm × (1 + steer), 오른쪽에 pwm × (1 − steer)를 준다.
      steer가 1을 넘으면 안쪽 바퀴 값이 음수가 되어 거꾸로 돈다. 거꾸로 돌릴 때는 <code>dirL</code>, <code>dirR</code>도 −1로 바꿔 엔코더 거리 계산에 반영한다.</p>
      <p>회전 코스의 제자리 회전은 바깥 바퀴를 255로 앞으로, 안쪽 바퀴를 255로 뒤로 돌린다([[506]]).</p>`,
  },
  {
    from: 513, to: 531, title: '조향', mark: '518,521,525-529',
    note: `
      <p>좌우 바퀴의 출력 차이(steer)를 정한다. "지금 돌아 있어야 할 각도"와 실제 회전각의 차이만큼 좌우를 나누는 방식이다.</p>
      <ul>
        <li>경사로: 0. 좌우 같은 출력으로 곧게 내려간다.</li>
        <li>직진: 목표 각도는 0°. 오른쪽으로 10° 틀어지면 steer가 −0.2가 되어 왼쪽 바퀴를 줄이고 오른쪽을 키워 되돌린다.</li>
        <li>회전(호): 지나온 거리를 반경으로 나눈 각도가 목표다. 반경만으로 정해지는 기본 비율(트랙 절반 / 반경 = 0.055 / 0.25 = 0.22)에
        각도 차이 보정을 더한다. 속도가 바뀌어도 같은 반경을 따라간다.</li>
      </ul>
      <p>제자리 회전(<code>TURN_PIVOT</code>)에서는 이 값을 쓰지 않고 고정 출력으로 돈다.</p>`,
  },
  {
    from: 532, to: 543, title: '목표 속도', mark: '534-538,540-541',
    note: `
      <p class="eq">목표 = max(V_BASE − K1 × 내리막 − K2 × |회전 각속도|, V_MIN)</p>
      <p>오르막(경사각 음수)과 3° 이하는 내리막을 0으로, 10 deg/s 이하는 회전을 0으로 본다. 그래서 평지 직진에서는 목표가 0.32 m/s 그대로다.</p>
      <p>목표가 내려갈 때는 바로 따라가고, 올라갈 때는 1초에 0.3 m/s씩만 올린다. 내리막이 끝나는 순간 목표가 확 올라가 스로틀이 갑자기 붙는 일을 막는다.</p>
      <p>예를 들어 20° 내리막에서 100 deg/s로 돌고 있으면 0.32 − 0.12 − 0.15 = 0.05지만, 하한 0.10 m/s에서 멈춘다.</p>`,
  },
  {
    from: 544, to: 593, title: '제동 제어', mark: '560,563,565-568,573-578,585-588',
    note: `
      <p>실제 속도에서 목표를 뺀 값(over)으로 세 갈래 중 하나를 고른다. 로그의 state 칸이 이 결과다.</p>
      <table>
        <tr><th>over &gt; 0.03</th><td>B 제동</td></tr>
        <tr><th>−0.03 &lt; over ≤ 0.03</th><td>C 출력 끊음 (쌓인 제동이 남아 있으면 B 유지)</td></tr>
        <tr><th>over ≤ −0.03</th><td>D 스로틀</td></tr>
      </table>
      <p class="eq">제동 PWM = 600 × over + 쌓인 제동<br>쌓인 제동 += 2000 × over × dt (0~255)</p>
      <p>비례항만 있으면 제동이 걸리려면 속도가 늘 목표를 넘어 있어야 한다. 경사에서는 중력이 계속 밀기 때문에, 그 힘을 버틸 만큼의 초과 속도가 남은 채로 멈춘다.
      적분항은 초과가 이어지는 동안 계속 커져서 그 몫을 맡고, 속도를 목표까지 끌어내린다.
      여유 구간(C)에서도 쌓인 값을 유지하는 이유가 이것이다. 출력을 끊는 순간 다시 빨라지기 때문이다.
      여유 구간 안에서 목표보다 느리면 over가 음수라 쌓인 값이 조금씩 줄어든다.</p>
      <p>제동은 20 ms에 25씩만 올린다([[567]]). 0에서 255까지 약 0.2초가 걸려서 한 번에 급제동하지 않는다.
      목표보다 확실히 느려지면 쌓인 값을 비우고 스로틀을 다시 준다.</p>
      <p>제어 OFF는 이 계산을 건너뛰고 늘 스로틀이다. <a href="#sim">02 경사 주행 시뮬레이션</a>의 그래프는 이 식으로 계산한 예상값이다.</p>`,
  },
  {
    from: 594, to: 610, title: '계기판 LED', mark: '599-602,604-608',
    note: `
      <table>
        <tr><th>주행 전</th><td>스위치 위치 그대로 (ON 빨강, OFF 초록)</td></tr>
        <tr><th>제어 ON 주행</th><td>빨강, 제동(B) 동안은 0.1초 간격으로 깜빡임</td></tr>
        <tr><th>제어 OFF 주행</th><td>초록</td></tr>
        <tr><th>넘어져 멈춘 뒤</th><td>빨강이 0.5초 간격으로 깜빡임 (다음 주행이나 <code>c</code> 전까지)</td></tr>
      </table>
      <p>스위치는 내부 풀업을 켠 입력이라 GND 쪽으로 밀면 LOW가 읽히고, 그것이 제어 ON이다.</p>`,
  },
  {
    from: 611, to: 655, title: '주행 시작', mark: '626,629-632,649-652',
    note: `
      <p>주행 명령을 받으면 그 순간의 스위치로 제어 ON/OFF를 정한다. 달리는 도중에 스위치를 바꾸면 다음 주행부터 반영된다.</p>
      <p>부저가 1초 간격으로 세 번 울린 뒤 출발한다. 시뮬레이션의 3, 2, 1 카운트다운이 이 순서를 따른다.</p>
      <p>출발 직전에 거리, 최고 속도, 적분항, 회전각, 넘어짐 기록을 모두 0으로 되돌리고 기준 시각도 지금으로 맞춘다.
      이것을 빼면 카운트다운 3초가 첫 주기의 dt로 들어가 적분값이 한 번에 크게 튄다.</p>
      <p>마지막에 CSV 머리줄을 보내서, 로그를 그대로 표 계산 프로그램에 붙여 넣을 수 있다.</p>`,
  },
  {
    from: 656, to: 695, title: '급정지와 주행 종료', mark: '662-667,670-680,685-687',
    note: `
      <p>회전 코스에서 90°를 다 돌면 <code>reversePulse()</code>가 도는 방향의 반대로 최대 출력을 짧게(최대 0.15초) 줘서 바로 세운다.
      주석에 적힌 대로, 회전하던 차체가 갑자기 서면 위쪽 무게추가 관성으로 계속 돌려고 해서 옆으로 넘어지기 쉬워진다.</p>
      <p>바퀴마다 속도가 0.12 m/s 아래로 떨어지면 그 바퀴는 단락 제동으로 바꾼다. 반대 출력을 계속 주면 바퀴가 거꾸로 돌기 시작하기 때문이다.</p>
      <p><code>stopRun()</code>은 어떤 이유로 끝나든 1초 동안 최대 단락 제동을 건 뒤 출력을 끊고,
      멈춘 이유와 요약 한 줄(코스, 모드, 최고 속도, 거리, 회전각, 버린 IMU 샘플 수)을 남긴다.</p>`,
  },
  {
    from: 696, to: 772, title: '명령 처리', mark: '708-709,743-752',
    note: `
      <p>명령은 글자 하나다. USB 시리얼을 먼저 보고, 없으면 블루투스를 본다.</p>
      <table>
        <tr><th><code>s</code> <code>f</code> <code>t</code></th><td>경사로, 직진, 회전 주행 (멈춰 있을 때만)</td></tr>
        <tr><th><code>x</code></th><td>즉시 정지 (주행 중)</td></tr>
        <tr><th><code>c</code> <code>i</code></th><td>영점 보정, IMU 점검</td></tr>
        <tr><th><code>l</code> <code>r</code></th><td>왼쪽, 오른쪽 바퀴만 2초</td></tr>
        <tr><th><code>?</code></th><td>상태와 명령 목록</td></tr>
      </table>
      <p>주행 명령은 IMU 보정이 성공했을 때만 시작한다([[744]]). IMU가 안 되면 넘어짐 감지가 동작하지 않기 때문이다.</p>
      <p>바퀴 시험(<code>l</code>, <code>r</code>)은 바퀴를 띄운 채 한쪽만 2초 돌리고 좌우 펄스 수를 보여 준다.
      돌린 쪽만 올라가야 배선과 방향이 맞은 것이다. 도중에 <code>x</code>를 보내면 바로 멈춘다.</p>`,
  },
  {
    from: 773, to: 797, title: 'setup', mark: '783-785,788-789,791-793',
    note: `
      <p>전원을 켜면 한 번 실행된다. 시리얼(115200)과 블루투스를 열고, 핀 방향을 정하고, 모터 출력을 끊어 둔다.</p>
      <p>스위치는 내부 풀업 입력이다. 34, 35번 핀은 내부 풀업이 없어서 속도센서 모듈의 풀업 저항을 쓴다.
      속도센서 신호가 올라갈 때마다 인터럽트 함수가 불리도록 연결한다.</p>
      <p>MPU6050을 깨우고 0.5초 기다린 뒤 바로 영점 보정을 한다. 그래서 전원을 켤 때 평평한 곳에 가만히 둬야 한다(초록 LED가 깜빡이는 2초).</p>`,
  },
  {
    from: 798, to: 877, title: 'loop: 한 주기', mark: '802-805,810-811,829-842,871-875',
    note: `
      <p>명령과 블루투스 상태는 매번 확인하고, 측정과 제어는 20 ms가 지났을 때만 한다. <code>delay()</code>로 기다리지 않고 시각을 비교하기 때문에
      기다리는 동안에도 명령을 놓치지 않는다.</p>
      <ul class="flow">
        <li><b>속도</b> 좌우 평균. 제자리 회전에서는 안쪽 바퀴가 거꾸로 돌아 평균이 0에 가까우므로 바깥 바퀴 속도를 쓴다.
        가감속은 이전 값 0.7, 새 값 0.3으로 섞어 자세 추정의 보정에 넘긴다.</li>
        <li><b>자세</b> 상보필터 갱신.</li>
        <li><b>넘어짐</b> 정상 샘플일 때만 카운트를 바꾼다. 5샘플 연속이면 제어 ON은 모터부터 멈추고([[835]]) 부저와 LED로 알린다.
        부저 함수 안에 0.5초 <code>delay</code>가 있어서, 순서가 바뀌면 그동안 모터가 계속 돈다. 제어 OFF는 로그 한 줄만 남기고 계속 달린다.</li>
        <li><b>종료</b> 회전은 90° 도달, 반대로 45° 쌓임(YAW_SIGN 설정 오류), 거리, 시간. 다른 코스는 거리와 8초.</li>
        <li><b>제어</b> 목표 속도, 조향, 제동 제어, LED.</li>
        <li><b>로그</b> CSV 한 줄(10칸).</li>
      </ul>
      <p><a href="#tip">04 전도 상황 시뮬레이션</a>은 이 넘어짐 판정(50°를 0.1초 넘으면 정지)을 보여 준다.</p>`,
  },
];

// ---------------- a small C++ colouring, one line at a time (the file has no block comments) ----------------
const KW = new Set('if else for while do return const volatile static void break continue switch case default true false sizeof unsigned signed'.split(' '));
const TY = new Set('int float double bool char long short byte String int16_t uint8_t portMUX_TYPE BluetoothSerial'.split(' '));
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b0x[0-9a-fA-F]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b)|([A-Za-z_]\w*)/g;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paint(line) {
  if (/^\s*#/.test(line)) return `<span class="t-pp">${esc(line)}</span>`;
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
    else if (TY.has(id)) cls = 'ty';
    else if (id.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(id)) cls = 'cn';     // constants: pins, gains, limits
    else if (/^\s*\(/.test(line.slice(at))) cls = 'fn';
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
  const meta = root.querySelector('.code-top .meta');
  let loading = null;

  function build(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    meta.textContent = `세 번째 시안 (11.25), ${lines.length}줄`;
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
        <div class="note"><h3 id="part-${i}-h">${p.title}</h3><p class="range">${p.from}~${last}행</p>${lineRef(p.note)}</div>
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
