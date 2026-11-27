// Slope Guard 경사로 + 회전 코스 제어 (세 번째 시안)
// 보드: ESP32 DevKit V1 (30핀) / 모터 드라이버: L298N / IMU: MPU6050 / 속도센서: FC-03 2개
//
// 동작 요약
//  1. 0.02초마다 MPU6050으로 경사각, 좌우각, 회전 각속도를 구하고 엔코더로 실제 속도를 잰다.
//     모터 노이즈로 깨진 MPU6050 값(가속도 크기 이상, 뒤집힘, 자이로 포화)은 버리고 쓰지 않는다.
//  2. 목표 속도 = 기본속도 - K1 x 경사각 - K2 x 회전 각속도 (내리막, 급회전일수록 낮춘다)
//  3. 실제 속도가 목표보다 빠르면 출력을 끊고 전자제동, 느리면 스로틀 출력을 그대로 준다.
//     제동 세기 = 넘은 속도에 비례하는 값 + 넘은 상태가 이어진 만큼 쌓인 값 (비례 + 적분)
//  4. 제어 ON일 때 가속도계로 본 기울기가 0.1초(5샘플) 넘게 기준을 넘으면 넘어진 것으로 보고 멈춘다.
//     제어 OFF는 스로틀만 주는 일반 킥보드와 같아서 넘어져도 멈추지 않는다.
//  5. 계기판 LED: 제어 OFF는 초록, 제어 ON은 빨강, 제동하는 동안은 빨강이 빠르게 깜빡인다.
//     제어 ON에서 넘어져 멈추면 다음 주행이나 c 보정 전까지 빨강이 느리게 깜빡인다 (부저와 함께 경고).
//  6. IMU 보정(c)이 성공해야 주행(s, f, t)을 시작한다. IMU가 안 되면 넘어짐 감지가 동작하지 않기 때문이다.
//
// 코스
//  경사로 (s) : 출발대에서 출발해 경사판을 내려온다. 1.6 m 가면 정지.
//  직진   (f) : 폼보드 출발선에 뒷바퀴 축을 맞추고 출발. 방향을 0도로 유지하며 50 cm 가면 정지.
//  회전   (t) : 회전 시작점에 뒷바퀴 축을 맞추고 출발. 오른쪽 90도를 다 돌면 정지.
//               TURN_PIVOT = true : 바깥 바퀴는 앞으로, 안쪽 바퀴는 거꾸로 돌려 제자리에 가깝게 돈다.
//               TURN_PIVOT = false: 지나온 거리로 돌아 있어야 할 각도를 구해 반경 25 cm 호를 따라 돈다.
//
// 명령은 USB 시리얼 모니터(115200)와 블루투스 시리얼 어느 쪽으로 보내도 된다.
//  블루투스 이름: SlopeGuard_5 (노트북이나 안드로이드 휴대폰에서 페어링)
//  s : 경사로 주행 (3초 카운트다운)
//  f : 직진 주행 (3초 카운트다운)
//  t : 회전 주행 (3초 카운트다운)
//  x : 즉시 정지
//  c : 자이로 영점 다시 잡기 (평평한 곳에 가만히 두고 입력)
//  l : 왼쪽 바퀴만 2초 앞으로 (바퀴를 띄우고 사용, 끝나면 좌우 펄스 수 출력)
//  r : 오른쪽 바퀴만 2초 앞으로 (바퀴를 띄우고 사용, 끝나면 좌우 펄스 수 출력)
//  i : MPU6050 점검 (I2C 주소, WHO_AM_I, 값 5번 출력)
//  ? : 현재 상태와 명령 목록 보기
//
// 로그 형식 (CSV): t_ms,mode,slope,roll,speed,target,pwm,state,yaw,heading
//  slope 경사각(내리막 +), roll 좌우각, yaw 회전 각속도(오른쪽 +, deg/s), heading 누적 회전각(오른쪽 +, 도)
//  state: D = 스로틀 출력, C = 여유 구간(출력 끊음), B = 제동
//  로그는 USB와 블루투스(연결되어 있을 때)에 같이 나간다.

#include <Wire.h>
#include "BluetoothSerial.h"

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled. Select "ESP32 Dev Module" or "DOIT ESP32 DEVKIT V1" as the board.
#endif

// ---------------- 핀 배치 (부품표 기준) ----------------
const int PIN_ENC_L = 34;      // 왼쪽 속도센서 DO
const int PIN_ENC_R = 35;      // 오른쪽 속도센서 DO
const int PIN_SW    = 13;      // 제어 ON/OFF 슬라이드 스위치
const int PIN_ENA = 25, PIN_IN1 = 26, PIN_IN2 = 27;   // 왼쪽 모터
const int PIN_ENB = 33, PIN_IN3 = 16, PIN_IN4 = 17;   // 오른쪽 모터
const int PIN_BUZZER    = 18;
const int PIN_LED_RED   = 19;
const int PIN_LED_GREEN = 23;
const int PIN_SDA = 21, PIN_SCL = 22;

// ---------------- 블루투스 ----------------
const char *BT_NAME = "SlopeGuard_5";   // 페어링할 때 보이는 이름
BluetoothSerial SerialBT;
bool btConnected = false;

// ---------------- 모형 치수 (실측 후 수정) ----------------
const float WHEEL_DIA_M = 0.065;   // 바퀴 지름 (m)
const int   DISC_SLOTS  = 20;      // 엔코더 원판 구멍 수
const float M_PER_PULSE = PI * WHEEL_DIA_M / DISC_SLOTS;
const float TRACK_M     = 0.110;   // 좌우 뒷바퀴 간격 (m)

// ---------------- 주행 설정 ----------------
// 스로틀은 100%보다 낮게 둬야 내리막에서 평지보다 빨라질 여유가 생긴다.
const int   THROTTLE_PWM = 190;    // 탑승자가 당기는 스로틀 (0~255)

// V_BASE는 평지에서 스로틀만으로 나오는 속도보다 0.04 m/s쯤 높게 잡는다.
// 그래야 평지 직진에서는 제어가 개입하지 않는다. (스로틀 190 예상 속도 0.28 m/s, f 로그로 확인)
const float V_BASE = 0.32;         // 평지 목표 속도 (m/s)
const float V_MIN  = 0.10;         // 목표 속도 하한 (m/s)
const float K1     = 0.006;        // 내리막 1도당 목표 속도 감소량 (m/s)
const float K2     = 0.0015;       // 회전 각속도 1 deg/s당 목표 속도 감소량 (m/s)
const float ANGLE_DEADBAND = 3.0;  // 이 각도보다 완만하면 평지로 본다 (도)
const float YAW_DEADBAND   = 10.0; // 이 회전 각속도보다 작으면 직진으로 본다 (deg/s)
const float RECOVER_RATE   = 0.30; // 내리막, 회전이 끝난 뒤 목표 속도가 돌아오는 빠르기 (m/s per s)

const float MARGIN    = 0.03;      // 목표 속도 위아래 여유 구간 (m/s)
const float KP_BRAKE  = 600.0;     // 목표 초과 1 m/s 당 제동 PWM
const int   BRAKE_MAX = 255;
const int   BRAKE_STEP = 25;       // 20ms마다 제동 PWM을 올릴 수 있는 최대치 (감속도 상한)
// 비례 제동만 쓰면 내리막에서 중력과 제동력이 목표보다 빠른 속도에서 맞아 버린다.
// 목표를 넘은 만큼을 시간에 따라 쌓아 제동에 더해서(적분), 목표 속도까지 내려가게 한다.
const float KI_BRAKE  = 2000.0;    // 목표 초과 1 m/s가 1초 이어질 때 더해지는 제동 PWM (0이면 비례 제동만)

// 단락 제동이 약하면 true로 바꿔 역방향 구동으로 제동한다.
const bool  USE_REVERSE_BRAKE = false;
const float REVERSE_MIN_SPEED = 0.10;  // 이 속도 아래에서는 뒤로 밀리지 않게 단락 제동만 쓴다

// ---------------- 직진, 회전 설정 ----------------
const float STRAIGHT_DIST_M = 0.50; // 직진 주행 거리 (m)
const float TURN_RADIUS_M  = 0.25;  // 회전 반경 (m), 잘 안 넘어지면 줄여서 시험
const float TURN_ANGLE_DEG = 90.0;  // 이만큼 돌면 정지 (도)
const int   TURN_DIR       = 1;     // 1 오른쪽 회전, -1 왼쪽 회전
const float KH_STEER  = 0.02;       // 직진: 방향이 1도 틀어질 때 좌우 출력 차이
const float STEER_MAX = 0.6;        // 직진: 좌우 출력 차이 상한 (0.6이면 한쪽 160%, 반대쪽 40%)
const float KH_TURN   = 0.04;       // 회전: 돌아 있어야 할 각도와 1도 차이날 때 좌우 출력 차이
const float TURN_STEER_MAX = 1.6;   // 회전: 상한, 1을 넘으면 안쪽 바퀴가 거꾸로 돈다 (1.6이면 안쪽 -60%)
const bool  TURN_PIVOT     = true;  // true면 안쪽 바퀴를 거꾸로 돌려서 회전, false면 반경 25 cm 호를 따라 회전
const int   TURN_THROTTLE_PWM = 255; // 회전 코스 스로틀 (급회전 시나리오라 최대 출력)
const int   TURN_INNER_PWM = 255;   // 안쪽 바퀴 역회전 출력 (바깥과 같으면 제자리 회전, 80 안팎보다 낮으면 잘 안 돎)
const int   STOP_REVERSE_MS = 150;  // 90도를 다 돌면 바퀴를 반대로 최대 이 시간만큼 돌려 급정지 (0이면 단락 제동만)

// ---------------- 주행 종료 조건 ----------------
const float RUN_DIST_M      = 1.6;       // 경사로: 출발대 + 경사판 길이
const float TURN_RUN_DIST_M = 0.7;       // 회전: 호 39 cm + 여유 (90도를 못 돌았을 때 안전용)
const unsigned long RUN_TIME_MS = 8000;  // 최대 주행 시간
const unsigned long TURN_TIME_MS = 3000; // 회전: 이 시간 안에 90도를 못 돌면 정지 (안전용)
const unsigned long WHEEL_TEST_MS = 2000; // l, r 바퀴 테스트 시간

// ---------------- 넘어짐 판정 ----------------
// 자이로 적분값은 튀는 값이 쌓일 수 있어서, 넘어짐은 가속도계로 본 기울기로만 판정한다.
const float SAFE_ROLL_DEG  = 50.0;  // 좌우로 이 이상 기울면 넘어짐
const float SAFE_PITCH_DEG = 65.0;  // 앞뒤는 경사 30도 + 제동 감속을 고려해 더 크게 잡는다
const int   TILT_HOLD      = 5;     // 연속 5샘플(0.1초) 넘으면 넘어짐으로 판정

// ---------------- IMU 설정 ----------------
// MPU6050 보드의 X 화살표가 모형 앞쪽을 보게 장착한다.
// 핀이 위로 오게 뒤집어 붙였으면 IMU_UPSIDE_DOWN을 true로 둔다 (X축 기준으로 좌우로 굴려 뒤집기).
// 앞을 숙였을 때(내리막) 경사각이 음수로 나오면 PITCH_SIGN을 -1로 바꾼다.
// 손으로 모형을 오른쪽(시계 방향)으로 돌렸을 때 heading이 줄어들면 YAW_SIGN을 1로 바꾼다.
const int   MPU_ADDR   = 0x68;
const float ALPHA      = 0.98;     // 상보필터에서 자이로 비중
const int   PITCH_SIGN = 1;
const int   YAW_SIGN   = -1;
const bool  IMU_UPSIDE_DOWN = true;  // 핀이 위로 오게 뒤집어 붙였으면 true
const bool  USE_ACC_COMP = true;   // 엔코더로 구한 가감속을 가속도계 값에서 빼기
const float G = 9.81;
const float GYRO_SCALE = 32.8;     // ±1000 deg/s 범위 (LSB per deg/s)

// MPU6050 값 검증 기준 (이 범위를 벗어난 샘플은 깨진 값으로 보고 버린다)
const float ACC_MIN_G  = 0.5;      // 가속도 크기 하한 (g)
const float ACC_MAX_G  = 1.5;      // 가속도 크기 상한 (g)
const float AZ_MIN_G   = -0.1;     // z축이 음수면 뒤집힌 값, 실제로는 옆으로 누워도 0 근처
const float GYRO_LIMIT = 960.0;    // 포화(1000 deg/s) 근처 값

// 바퀴가 뒤로 돌면 해당 쪽을 -1로 바꾼다.
const int LEFT_DIR  = 1;
const int RIGHT_DIR = 1;

const unsigned long DT_MS = 20;    // 제어 주기 (0.02초)

// =====================================================
// USB로는 항상, 블루투스로는 연결되어 있을 때만 보낸다.
void logLine(const String &s) {
  Serial.println(s);
  if (SerialBT.hasClient()) SerialBT.println(s);
}

// 엔코더 (인터럽트에서 갱신)
portMUX_TYPE encMux = portMUX_INITIALIZER_UNLOCKED;
volatile unsigned long lastUsL = 0, lastUsR = 0;
volatile unsigned long periodUsL = 0, periodUsR = 0;
volatile long countL = 0, countR = 0;
// 속도센서는 도는 방향을 모르므로, 모터에 준 방향(앞 +1, 뒤 -1)으로 펄스에 부호를 붙인다.
volatile int dirL = 1, dirR = 1;

// IMU
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
float pitchOffset = 0, rollOffset = 0;
float pitch = 0, roll = 0;          // 상보필터 결과 (제어에 사용)
float accPitchNow = 0, accRollNow = 0;   // 가속도계만으로 본 기울기 (넘어짐 판정에 사용)
float yawRate = 0;                  // 회전 각속도 (오른쪽 +, deg/s)
float heading = 0;                  // 출발 후 누적 회전각 (오른쪽 +, 도)
unsigned long imuReject = 0;        // 버린 샘플 수 (읽기 실패 포함)

// 주행 상태
const int COURSE_SLOPE    = 0;
const int COURSE_TURN     = 1;
const int COURSE_STRAIGHT = 2;
int course = COURSE_SLOPE;
bool running = false;
bool imuReady = false;             // IMU 보정(c)이 성공했는지
bool controlOn = true;
unsigned long runStartMs = 0;
unsigned long lastLoopMs = 0;
unsigned long lastImuUs = 0;
float speedNow = 0, speedPrev = 0, accLong = 0;
float targetSpeed = V_BASE;
int brakePwm = 0;
float brakeI = 0;                  // 쌓인 제동 (적분항, PWM 단위)
int outPwm = 0;
char outState = 'C';
float maxSpeed = 0;                // 주행 중 최고 속도 (끝날 때 요약에 사용)
int tiltCount = 0;                 // 기울기 기준을 넘은 연속 샘플 수
bool tiltLogged = false;           // 제어 OFF에서 넘어짐을 로그에 남겼는지
bool tipAlarm = false;             // 제어 ON에서 넘어져 멈춘 뒤 경고 표시 중인지

// ---------------- 엔코더 인터럽트 ----------------
void IRAM_ATTR encoderPulse(volatile unsigned long &lastUs, volatile unsigned long &periodUs,
                            volatile long &count, int dir) {
  unsigned long now = micros();
  unsigned long dt = now - lastUs;
  if (dt < 2000) return;                 // 센서 떨림으로 생기는 짧은 펄스 무시

  portENTER_CRITICAL_ISR(&encMux);
  if (dt > 300000) periodUs = 0;         // 오래 멈춰 있다가 다시 돌기 시작한 경우
  else if (periodUs == 0) periodUs = dt;
  else periodUs = (periodUs * 3 + dt) / 4;  // 최근 주기를 부드럽게 평균
  lastUs = now;
  count += dir;
  portEXIT_CRITICAL_ISR(&encMux);
}

void IRAM_ATTR isrLeft()  { encoderPulse(lastUsL, periodUsL, countL, dirL); }
void IRAM_ATTR isrRight() { encoderPulse(lastUsR, periodUsR, countR, dirR); }

float wheelSpeed(volatile unsigned long &lastUs, volatile unsigned long &periodUs) {
  portENTER_CRITICAL(&encMux);
  unsigned long last = lastUs;
  unsigned long period = periodUs;
  portEXIT_CRITICAL(&encMux);

  unsigned long since = micros() - last;
  if (period == 0 || since > 300000) return 0;
  if (since > period) period = since;    // 펄스가 늦게 오면 그만큼 느려진 것으로 본다
  return M_PER_PULSE / (period / 1000000.0);
}

float distanceM() {
  portENTER_CRITICAL(&encMux);
  long l = countL, r = countR;
  portEXIT_CRITICAL(&encMux);
  return (l + r) / 2.0 * M_PER_PULSE;
}

void resetEncoder() {
  portENTER_CRITICAL(&encMux);
  countL = 0;
  countR = 0;
  portEXIT_CRITICAL(&encMux);
}

// ---------------- MPU6050 ----------------
bool mpuWrite(byte reg, byte val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

// 슬립 해제와 측정 범위 설정. 전원이 흔들려 센서가 리셋되면 다시 잠든 상태(값 0)가 되므로
// c 보정과 i 점검 때도 다시 보낸다. 네 번 모두 성공하면 true.
bool mpuConfig() {
  bool ok = true;
  ok = mpuWrite(0x6B, 0x00) && ok;   // 슬립 해제
  ok = mpuWrite(0x1A, 0x03) && ok;   // 내부 저역통과 필터 약 44Hz (모터 진동 줄이기)
  ok = mpuWrite(0x1B, 0x10) && ok;   // 자이로 ±1000 deg/s (제자리 회전, 넘어질 때 포화되지 않게)
  ok = mpuWrite(0x1C, 0x00) && ok;   // 가속도 ±2g
  return ok;
}

void mpuInit() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);  // 100kHz: 모터 노이즈에 덜 민감하게
  Wire.setTimeOut(10);    // 통신이 막혀도 10ms 안에 빠져나오게
  mpuConfig();
}

// 가속도는 g 단위, 각속도는 deg/s 단위로 돌려준다.
bool mpuRead(float &ax, float &ay, float &az, float &gx, float &gy, float &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)14) != 14) return false;

  int16_t raw[7];
  for (int i = 0; i < 7; i++) {
    int hi = Wire.read();
    int lo = Wire.read();
    raw[i] = (int16_t)((hi << 8) | lo);
  }

  ax = raw[0] / 16384.0;
  ay = raw[1] / 16384.0;
  az = raw[2] / 16384.0;
  gx = raw[4] / GYRO_SCALE;     // raw[3]은 온도
  gy = raw[5] / GYRO_SCALE;
  gz = raw[6] / GYRO_SCALE;

  if (IMU_UPSIDE_DOWN) {   // X축 기준으로 뒤집으면 Y, Z 방향이 반대로 나온다
    ay = -ay;
    az = -az;
    gy = -gy;
    gz = -gz;
  }
  return true;
}

// 샘플 검사 결과 (0 정상, 1 가속도 크기 이상, 2 z축 음수, 3 자이로 포화)
const int IMU_OK = 0, IMU_BAD_ACC = 1, IMU_BAD_AZ = 2, IMU_BAD_GYRO = 3;

// 정상 주행에서는 나올 수 없는 값인지 확인한다.
int sampleProblem(float ax, float ay, float az, float gx, float gy, float gz) {
  float accMag = sqrt(ax * ax + ay * ay + az * az);
  if (accMag < ACC_MIN_G || accMag > ACC_MAX_G) return IMU_BAD_ACC;
  if (az < AZ_MIN_G) return IMU_BAD_AZ;
  if (fabs(gx) > GYRO_LIMIT || fabs(gy) > GYRO_LIMIT || fabs(gz) > GYRO_LIMIT) return IMU_BAD_GYRO;
  return IMU_OK;
}

bool isBadSample(float ax, float ay, float az, float gx, float gy, float gz) {
  return sampleProblem(ax, ay, az, gx, gy, gz) != IMU_OK;
}

String problemName(int p) {
  if (p == IMU_BAD_ACC)  return "가속도 크기 이상";
  if (p == IMU_BAD_AZ)   return "z축 음수";
  if (p == IMU_BAD_GYRO) return "자이로 포화";
  return "정상";
}

// 읽은 값 한 줄 (IMU_UPSIDE_DOWN 보정이 들어간 값, 가만히 두면 az가 +1 근처여야 정상)
String imuValueText(float ax, float ay, float az, float gx, float gy, float gz) {
  return "ax " + String(ax, 2) + ", ay " + String(ay, 2) + ", az " + String(az, 2) +
         " g (크기 " + String(sqrt(ax * ax + ay * ay + az * az), 2) + "), gx " + String(gx, 1) +
         ", gy " + String(gy, 1) + ", gz " + String(gz, 1) + " deg/s";
}

// 평평한 곳에 가만히 둔 상태에서 2초 동안 평균을 내서 영점을 잡는다.
void calibrateImu() {
  mpuConfig();
  delay(50);

  float sax = 0, say = 0, saz = 0, sgx = 0, sgy = 0, sgz = 0;
  int n = 0;
  int readFail = 0, accFail = 0, azFail = 0, gyroFail = 0;
  float lax = 0, lay = 0, laz = 0, lgx = 0, lgy = 0, lgz = 0;   // 마지막으로 읽은 값
  bool gotValue = false;

  for (int i = 0; i < 200; i++) {
    float ax, ay, az, gx, gy, gz;
    if (!mpuRead(ax, ay, az, gx, gy, gz)) {
      readFail++;
    } else {
      lax = ax; lay = ay; laz = az; lgx = gx; lgy = gy; lgz = gz;
      gotValue = true;
      int p = sampleProblem(ax, ay, az, gx, gy, gz);
      if (p == IMU_OK) {
        sax += ax; say += ay; saz += az; sgx += gx; sgy += gy; sgz += gz;
        n++;
      } else if (p == IMU_BAD_ACC) accFail++;
      else if (p == IMU_BAD_AZ) azFail++;
      else gyroFail++;
    }
    digitalWrite(PIN_LED_GREEN, (i / 10) % 2);   // 보정 중에는 초록 LED 깜빡임
    delay(10);
  }
  digitalWrite(PIN_LED_GREEN, HIGH);

  if (n < 200) {
    logLine("버린 샘플: 읽기 실패 " + String(readFail) + ", 가속도 크기 이상 " + String(accFail) +
            ", z축 음수 " + String(azFail) + ", 자이로 포화 " + String(gyroFail));
    if (gotValue) logLine("마지막 값: " + imuValueText(lax, lay, laz, lgx, lgy, lgz));
  }

  if (n == 0) {
    imuReady = false;
    logLine("MPU6050 보정 실패 (정상 샘플 0/200)");
    if (readFail == 200) {
      logLine("원인: I2C 통신이 안 됨. SDA D21, SCL D22, VCC 3V3, GND 배선을 보고 i로 주소를 확인");
    } else if (azFail >= accFail && azFail >= gyroFail) {
      logLine("원인: z축이 거꾸로 나옴. IMU_UPSIDE_DOWN을 " + String(IMU_UPSIDE_DOWN ? "false" : "true") + "로 바꾸기");
    } else if (accFail >= gyroFail) {
      logLine("원인: 가속도 크기가 1g 근처가 아님. 값이 전부 0이면 센서가 잠든 상태라 배터리, USB를 모두 뺐다가 다시 켜기");
    } else {
      logLine("원인: 자이로 값이 너무 큼. 보정 중에 모형이 움직였거나 센서가 덜렁거림");
    }
    return;
  }

  gyroBiasX = sgx / n;
  gyroBiasY = sgy / n;
  gyroBiasZ = sgz / n;
  pitchOffset = atan2(-sax / n, saz / n) * RAD_TO_DEG;
  rollOffset  = atan2( say / n, saz / n) * RAD_TO_DEG;
  pitch = roll = 0;
  heading = 0;
  lastImuUs = micros();
  imuReady = true;
  logLine("보정 완료 (정상 샘플 " + String(n) + "/200)");
}

// I2C 버스에서 응답하는 주소를 찾고, MPU6050 값을 5번 읽어 보여 준다. 보정이 안 될 때 원인 찾기용.
void imuCheck() {
  String found = "";
  for (int addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) found += " 0x" + String(addr, HEX);
  }
  if (found.length() == 0) {
    logLine("I2C 장치 없음: SDA D21, SCL D22, VCC 3V3, GND 배선 확인");
    return;
  }
  logLine("I2C 장치:" + found + " (MPU6050은 0x68, 0x69만 나오면 AD0 핀이 VCC에 닿은 것)");

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);   // WHO_AM_I
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)1) == 1) {
    logLine("WHO_AM_I 0x" + String(Wire.read(), HEX) + " (MPU6050이면 0x68)");
  } else {
    logLine("0x68에서 WHO_AM_I 읽기 실패");
  }

  logLine("설정 쓰기 " + String(mpuConfig() ? "성공" : "실패"));
  delay(50);
  for (int i = 0; i < 5; i++) {
    float ax, ay, az, gx, gy, gz;
    if (!mpuRead(ax, ay, az, gx, gy, gz)) {
      logLine("읽기 실패");
    } else {
      logLine(imuValueText(ax, ay, az, gx, gy, gz) + ", 판정 " +
              problemName(sampleProblem(ax, ay, az, gx, gy, gz)));
    }
    delay(100);
  }
}

// 정상 샘플을 읽어 반영했으면 true, 읽기 실패나 깨진 샘플이면 false.
bool updateImu() {
  float ax, ay, az, gx, gy, gz;
  if (!mpuRead(ax, ay, az, gx, gy, gz) || isBadSample(ax, ay, az, gx, gy, gz)) {
    imuReject++;
    return false;   // lastImuUs를 그대로 두면 다음 정상 샘플이 빠진 시간까지 이어서 적분한다
  }

  unsigned long now = micros();
  float dt = (now - lastImuUs) / 1000000.0;
  lastImuUs = now;
  if (dt > 0.1) dt = 0.1;   // 오래 끊겼다 돌아와도 한 번에 크게 적분하지 않게

  gx -= gyroBiasX;
  gy -= gyroBiasY;
  gz -= gyroBiasZ;

  // 가감속하면 가속도계가 기울기로 착각하므로, 엔코더로 구한 가감속만큼 빼준다.
  if (USE_ACC_COMP) ax -= PITCH_SIGN * accLong / G;

  accPitchNow = atan2(-ax, az) * RAD_TO_DEG - pitchOffset;
  accRollNow  = atan2( ay, az) * RAD_TO_DEG - rollOffset;

  // 상보필터: 짧은 시간은 자이로, 긴 시간은 가속도계를 믿는다.
  pitch = ALPHA * (pitch + gy * dt) + (1 - ALPHA) * accPitchNow;
  roll  = ALPHA * (roll  + gx * dt) + (1 - ALPHA) * accRollNow;

  yawRate = YAW_SIGN * gz;
  heading += yawRate * dt;
  return true;
}

float slopeDeg() { return PITCH_SIGN * pitch; }   // 내리막이 양수

// ---------------- 모터 ----------------
// mode: 'F' 전진, 'R' 후진, 'B' 단락 제동, 'C' 출력 끊음
void setMotor(int en, int inA, int inB, int dir, char mode, int pwm) {
  if (mode == 'F' || mode == 'R') {
    bool forward = (mode == 'F') == (dir > 0);
    digitalWrite(inA, forward ? HIGH : LOW);
    digitalWrite(inB, forward ? LOW : HIGH);
    analogWrite(en, pwm);
  } else if (mode == 'B') {
    digitalWrite(inA, LOW);      // 양쪽을 같은 값으로 두면 모터 단자가 단락되어 제동
    digitalWrite(inB, LOW);
    analogWrite(en, pwm);        // EN 듀티로 제동 세기 조절
  } else {
    analogWrite(en, 0);
  }
}

void motors(char mode, int pwm) {
  pwm = constrain(pwm, 0, 255);
  setMotor(PIN_ENA, PIN_IN1, PIN_IN2, LEFT_DIR,  mode, pwm);
  setMotor(PIN_ENB, PIN_IN3, PIN_IN4, RIGHT_DIR, mode, pwm);
}

// 바퀴 하나를 cmd만큼 돌린다. cmd가 음수면 거꾸로 돈다.
void driveWheel(int en, int inA, int inB, int dir, float cmd, volatile int &wheelDir) {
  int pwm = constrain((int)fabs(cmd), 0, 255);
  wheelDir = (cmd < 0) ? -1 : 1;
  setMotor(en, inA, inB, dir, (cmd < 0) ? 'R' : 'F', pwm);
}

void driveWheels(float left, float right) {
  driveWheel(PIN_ENA, PIN_IN1, PIN_IN2, LEFT_DIR,  left,  dirL);
  driveWheel(PIN_ENB, PIN_IN3, PIN_IN4, RIGHT_DIR, right, dirR);
}

// 전진하면서 좌우 출력을 나눈다. steer가 +면 오른쪽으로 돈다 (왼쪽 바퀴가 더 빠름).
// steer가 1보다 크면 안쪽 바퀴는 거꾸로 돌아서 더 작은 반경으로 돈다.
void driveForward(int pwm, float steer) {
  driveWheels(pwm * (1 + steer), pwm * (1 - steer));
}

bool pivotTurn() { return course == COURSE_TURN && TURN_PIVOT; }

int throttlePwm() { return pivotTurn() ? TURN_THROTTLE_PWM : THROTTLE_PWM; }

// 스로틀 출력. 회전 코스(TURN_PIVOT)는 바깥 바퀴를 앞으로, 안쪽 바퀴를 거꾸로 돌린다.
void driveThrottle(float steer) {
  if (pivotTurn()) {
    if (TURN_DIR > 0) driveWheels(TURN_THROTTLE_PWM, -TURN_INNER_PWM);   // 오른쪽 회전: 왼쪽이 바깥
    else              driveWheels(-TURN_INNER_PWM, TURN_THROTTLE_PWM);   // 왼쪽 회전: 오른쪽이 바깥
  } else {
    driveForward(THROTTLE_PWM, steer);
  }
}

// ---------------- 조향 (직진, 회전) ----------------
// "지금 돌아 있어야 할 각도"와 실제 회전각의 차이만큼 좌우 출력을 나눈다.
// 직진은 0도, 회전은 지나온 거리(호 길이) / 반경 만큼. 속도가 바뀌어도 같은 반경을 따라간다.
// 경사로는 좌우 같은 출력(0)으로 직진한다.
float computeSteer() {
  if (course == COURSE_SLOPE) return 0;

  if (course == COURSE_STRAIGHT) {
    return constrain(-KH_STEER * heading, -STEER_MAX, STEER_MAX);
  }

  // 회전: 오른쪽 회전 기준으로 계산한 뒤 TURN_DIR로 방향을 맞춘다.
  float arcDeg = distanceM() / TURN_RADIUS_M * RAD_TO_DEG;
  float ref = min(arcDeg, TURN_ANGLE_DEG);
  float ff = (TRACK_M / 2) / TURN_RADIUS_M;   // 반경에서 바로 나오는 좌우 출력 비율
  float s = ff + KH_TURN * (ref - TURN_DIR * heading);
  return TURN_DIR * constrain(s, -STEER_MAX, TURN_STEER_MAX);
}

// ---------------- 목표 속도와 제어 ----------------
void updateTarget(float dt) {
  float s = slopeDeg();
  float downhill = (s > ANGLE_DEADBAND) ? s : 0;
  float turn = fabs(yawRate);
  if (turn < YAW_DEADBAND) turn = 0;
  float newTarget = max(V_BASE - K1 * downhill - K2 * turn, V_MIN);

  if (newTarget < targetSpeed) targetSpeed = newTarget;          // 내려갈 때는 바로
  else targetSpeed = min(newTarget, targetSpeed + RECOVER_RATE * dt);  // 올라올 때는 천천히
}

// 제동 출력. 정방향으로 달리는 중이면 USE_REVERSE_BRAKE 설정에 따라 역방향 구동으로 제동한다.
void applyBrake(int pwm) {
  if (USE_REVERSE_BRAKE && speedNow > REVERSE_MIN_SPEED) motors('R', pwm);
  else motors('B', pwm);
}

void control(float steer, float dt) {
  if (!controlOn) {                 // 제어 OFF: 스로틀 그대로
    driveThrottle(steer);
    outPwm = throttlePwm();
    outState = 'D';
    brakePwm = 0;
    brakeI = 0;
    return;
  }

  float over = speedNow - targetSpeed;

  // 목표보다 확실히 느리지 않으면 초과분을 쌓는다 (목표보다 느려지면 쌓인 값이 줄어든다).
  if (over > -MARGIN) brakeI = constrain(brakeI + KI_BRAKE * over * dt, 0.0f, (float)BRAKE_MAX);

  if (over > MARGIN) {              // 목표보다 빠름 → 제동 (비례 + 적분)
    int want = constrain((int)(KP_BRAKE * over + brakeI), 0, BRAKE_MAX);
    if (want > brakePwm + BRAKE_STEP) brakePwm += BRAKE_STEP;
    else brakePwm = want;

    applyBrake(brakePwm);
    outPwm = brakePwm;
    outState = 'B';
  } else if (over > -MARGIN) {      // 여유 구간 → 쌓인 제동이 있으면 유지, 없으면 출력만 끊음
    if (brakeI >= 1) {
      brakePwm = (int)brakeI;
      applyBrake(brakePwm);
      outPwm = brakePwm;
      outState = 'B';
    } else {
      motors('C', 0);
      brakePwm = 0;
      outPwm = 0;
      outState = 'C';
    }
  } else {                          // 목표보다 느림 → 스로틀 그대로
    driveThrottle(steer);
    brakePwm = 0;
    brakeI = 0;
    outPwm = throttlePwm();
    outState = 'D';
  }
}

// ---------------- 계기판 LED ----------------
// 제어 OFF는 초록, 제어 ON은 빨강. 제어 ON 주행에서 제동하는 동안은 빨강이 빠르게 깜빡인다.
// 주행 전에는 스위치 위치를 그대로 보여 줘서 출발 전에 모드를 확인할 수 있다.
// 넘어져서 멈춘 뒤에는 빨강이 느리게(0.5초 간격) 깜빡여서 넘어짐 경고를 보여 준다.
void updateLeds(unsigned long now) {
  if (!running && tipAlarm) {
    digitalWrite(PIN_LED_RED, (now / 500) % 2 ? HIGH : LOW);
    digitalWrite(PIN_LED_GREEN, LOW);
    return;
  }
  bool on = running ? controlOn : (digitalRead(PIN_SW) == LOW);
  bool red = on;
  if (running && on && outState == 'B') red = (now / 100) % 2;
  digitalWrite(PIN_LED_RED, red ? HIGH : LOW);
  digitalWrite(PIN_LED_GREEN, on ? LOW : HIGH);
}

// ---------------- 주행 시작과 종료 ----------------
void beep(int ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

String courseName() {
  if (course == COURSE_TURN) return "회전";
  if (course == COURSE_STRAIGHT) return "직진";
  return "경사로";
}

void startRun(int c) {
  course = c;
  controlOn = (digitalRead(PIN_SW) == LOW);   // 스위치를 GND 쪽으로 두면 제어 ON
  logLine(courseName() + " 주행, 제어 " + String(controlOn ? "ON" : "OFF"));

  for (int i = 0; i < 3; i++) {   // 카운트다운
    beep(150);
    delay(850);
  }
  resetEncoder();
  dirL = 1;
  dirR = 1;
  targetSpeed = V_BASE;
  brakePwm = 0;
  brakeI = 0;
  speedPrev = 0;
  accLong = 0;
  maxSpeed = 0;
  heading = 0;
  tiltCount = 0;
  tiltLogged = false;
  tipAlarm = false;
  imuReject = 0;

  // 카운트다운 3초가 첫 주기의 dt에 들어가지 않게 기준 시각을 지금으로 맞춘다.
  lastImuUs = micros();
  runStartMs = millis();
  lastLoopMs = runStartMs;
  running = true;
  logLine("t_ms,mode,slope,roll,speed,target,pwm,state,yaw,heading");
}

// 도는 방향의 반대로 최대 출력을 잠깐 줘서 바로 세운다.
// 회전 중이던 차체가 갑자기 멈추면 위쪽 무게추가 관성으로 계속 돌려고 해서 옆으로 넘어지기 쉬워진다.
// 바퀴마다 속도가 STOP_SPEED 아래로 떨어지면 그 바퀴는 단락 제동으로 바꿔서 거꾸로 돌아가지 않게 한다.
const float STOP_SPEED = 0.12;   // 이 속도보다 느린 바퀴는 반대로 밀지 않는다 (m/s)

void reversePulse() {
  bool pushL = wheelSpeed(lastUsL, periodUsL) >= STOP_SPEED;
  bool pushR = wheelSpeed(lastUsR, periodUsR) >= STOP_SPEED;
  if (pushL) setMotor(PIN_ENA, PIN_IN1, PIN_IN2, LEFT_DIR,  (dirL > 0) ? 'R' : 'F', 255);
  else       setMotor(PIN_ENA, PIN_IN1, PIN_IN2, LEFT_DIR,  'B', 255);
  if (pushR) setMotor(PIN_ENB, PIN_IN3, PIN_IN4, RIGHT_DIR, (dirR > 0) ? 'R' : 'F', 255);
  else       setMotor(PIN_ENB, PIN_IN3, PIN_IN4, RIGHT_DIR, 'B', 255);

  unsigned long start = millis();
  while ((pushL || pushR) && millis() - start < (unsigned long)STOP_REVERSE_MS) {
    if (pushL && wheelSpeed(lastUsL, periodUsL) < STOP_SPEED) {
      setMotor(PIN_ENA, PIN_IN1, PIN_IN2, LEFT_DIR, 'B', 255);
      pushL = false;
    }
    if (pushR && wheelSpeed(lastUsR, periodUsR) < STOP_SPEED) {
      setMotor(PIN_ENB, PIN_IN3, PIN_IN4, RIGHT_DIR, 'B', 255);
      pushR = false;
    }
    delay(2);
  }
}

void stopRun(const char *reason) {
  running = false;
  motors('B', 255);               // 1초 동안 제동 후 출력 차단
  delay(1000);
  motors('C', 0);
  logLine(reason);
  logLine("요약: " + courseName() + ", 모드 " + String(controlOn ? "ON" : "OFF") +
          ", 최고 속도 " + String(maxSpeed, 3) + " m/s" +
          ", 주행 거리 " + String(distanceM(), 2) + " m" +
          ", 회전각 " + String(heading, 1) + "도" +
          ", IMU 버린 샘플 " + String(imuReject) + "개");
}

// ---------------- 명령 ----------------
void printStatus() {
  logLine("[상태] 스위치 " + String(digitalRead(PIN_SW) == LOW ? "제어 ON" : "제어 OFF") +
          ", 경사각 " + String(slopeDeg(), 1) + "도, 좌우각 " + String(roll, 1) + "도" +
          ", 방향 " + String(heading, 1) + "도" +
          ", IMU 버린 샘플 " + String(imuReject) + "개" +
          ", 블루투스 " + String(SerialBT.hasClient() ? "연결됨" : "연결 안 됨"));
  logLine("[명령] s 경사로, f 직진, t 회전, x 정지, c 영점, i IMU 점검, l 왼쪽 바퀴, r 오른쪽 바퀴, ? 상태");
}

// USB 시리얼과 블루투스 중 먼저 들어온 글자 하나를 읽는다. 없으면 -1.
int readCommand() {
  if (Serial.available()) return Serial.read();
  if (SerialBT.available()) return SerialBT.read();
  return -1;
}

// 바퀴 하나만 스로틀 출력으로 2초 돌리고, 좌우 속도센서 펄스 수를 보여 준다.
// 돌린 쪽 펄스만 올라가고 반대쪽은 0이어야 정상이다. 도중에 x를 보내면 바로 멈춘다.
void wheelTest(bool left) {
  logLine(String(left ? "왼쪽" : "오른쪽") + " 바퀴 테스트 (" + String(WHEEL_TEST_MS / 1000.0, 1) + "초)");
  resetEncoder();
  dirL = 1;
  dirR = 1;

  if (left) setMotor(PIN_ENA, PIN_IN1, PIN_IN2, LEFT_DIR,  'F', THROTTLE_PWM);
  else      setMotor(PIN_ENB, PIN_IN3, PIN_IN4, RIGHT_DIR, 'F', THROTTLE_PWM);

  unsigned long start = millis();
  while (millis() - start < WHEEL_TEST_MS) {
    if (readCommand() == 'x') break;
    delay(10);
  }
  motors('B', 255);
  delay(300);
  motors('C', 0);

  portENTER_CRITICAL(&encMux);
  long l = countL, r = countR;
  portEXIT_CRITICAL(&encMux);
  logLine("펄스 수: 왼쪽 " + String(l) + "개, 오른쪽 " + String(r) + "개");
}

void checkCommand() {
  int c = readCommand();
  if (c < 0) return;

  if ((c == 's' || c == 'f' || c == 't') && !running) {
    if (!imuReady) {
      logLine("IMU 보정이 안 돼서 주행을 시작하지 않음 (i로 확인하고 c로 보정)");
      return;
    }
    if (c == 's') startRun(COURSE_SLOPE);
    else if (c == 'f') startRun(COURSE_STRAIGHT);
    else startRun(COURSE_TURN);
  }
  else if (c == 'x' && running) stopRun("수동 정지");
  else if (c == 'c' && !running) { tipAlarm = false; calibrateImu(); }
  else if (c == 'i' && !running) imuCheck();
  else if (c == 'l' && !running) wheelTest(true);
  else if (c == 'r' && !running) wheelTest(false);
  else if (c == '?') printStatus();
}

// 블루투스가 연결되거나 끊기면 알려 준다.
void checkBluetooth() {
  bool now = SerialBT.hasClient();
  if (now == btConnected) return;
  btConnected = now;
  if (now) {
    logLine("블루투스 연결됨");
    printStatus();
  } else {
    logLine("블루투스 연결 끊김");
  }
}

// =====================================================
void setup() {
  Serial.begin(115200);
  SerialBT.begin(BT_NAME);

  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_SW, INPUT_PULLUP);
  pinMode(PIN_ENC_L, INPUT);       // 34, 35번은 입력 전용, 풀업은 센서 모듈에 있음
  pinMode(PIN_ENC_R, INPUT);
  motors('C', 0);

  attachInterrupt(digitalPinToInterrupt(PIN_ENC_L), isrLeft, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_R), isrRight, RISING);

  mpuInit();
  delay(500);
  calibrateImu();
  logLine("준비 완료, s 경사로 / f 직진 / t 회전 (블루투스 이름 " + String(BT_NAME) + ")");
  lastLoopMs = millis();
}

void loop() {
  checkBluetooth();
  checkCommand();

  unsigned long now = millis();
  if (now - lastLoopMs < DT_MS) return;
  float dt = (now - lastLoopMs) / 1000.0;
  lastLoopMs = now;

  // 1. 속도 측정 (양쪽 바퀴 평균, 안쪽 바퀴를 거꾸로 돌리는 회전에서는 바깥 바퀴 속도)
  float vL = dirL * wheelSpeed(lastUsL, periodUsL);
  float vR = dirR * wheelSpeed(lastUsR, periodUsR);
  if (pivotTurn()) speedNow = (TURN_DIR > 0) ? vL : vR;
  else speedNow = (vL + vR) / 2.0;
  float a = (speedNow - speedPrev) / dt;
  accLong = 0.7 * accLong + 0.3 * constrain(a, -5.0f, 5.0f);
  speedPrev = speedNow;

  // 2. 경사각, 좌우각, 회전 각속도 추정 (깨진 샘플이면 이전 값 유지)
  bool imuOk = updateImu();

  if (!running) {
    updateLeds(now);
    return;
  }
  if (speedNow > maxSpeed) maxSpeed = speedNow;

  // 3. 넘어짐 감지와 종료 조건
  //    가속도계 기울기가 연속 TILT_HOLD 샘플 기준을 넘어야 넘어짐으로 본다 (튀는 값 한두 개는 무시).
  //    제어 ON: 바로 멈추고 경고한다.
  //    제어 OFF: 일반 킥보드처럼 멈추지 않고, 넘어진 시점만 로그에 한 번 남긴다.
  if (imuOk) {
    bool tilted = fabs(accRollNow) > SAFE_ROLL_DEG || fabs(accPitchNow) > SAFE_PITCH_DEG;
    tiltCount = tilted ? tiltCount + 1 : 0;
  }
  if (tiltCount >= TILT_HOLD) {
    if (controlOn) {
      motors('B', 255);           // 경고음(delay)보다 먼저 모터부터 멈춘다
      digitalWrite(PIN_LED_RED, HIGH);
      digitalWrite(PIN_LED_GREEN, LOW);
      beep(500);                  // 넘어짐은 부저와 빨간 LED로 알린다
      tipAlarm = true;
      stopRun("기울기 초과로 정지");
      return;
    }
    if (!tiltLogged) {
      logLine("기울기 초과 (제어 OFF라 멈추지 않음)");
      tiltLogged = true;
    }
  }

  if (course == COURSE_TURN) {
    if (TURN_DIR * heading >= TURN_ANGLE_DEG) {
      if (STOP_REVERSE_MS > 0) reversePulse();   // 제어 ON, OFF 모두 같은 방식으로 멈춘다
      stopRun("회전 완료");
      return;
    }
    if (TURN_DIR * heading <= -TURN_ANGLE_DEG / 2) { stopRun("방향이 반대로 쌓임, YAW_SIGN 확인"); return; }
    if (distanceM() >= TURN_RUN_DIST_M) { stopRun("주행 거리 도달"); return; }
    if (now - runStartMs >= TURN_TIME_MS) { stopRun("회전 시간 초과"); return; }
  } else if (course == COURSE_STRAIGHT) {
    if (distanceM() >= STRAIGHT_DIST_M) { stopRun("주행 거리 도달"); return; }
  } else {
    if (distanceM() >= RUN_DIST_M) { stopRun("주행 거리 도달"); return; }
  }
  if (now - runStartMs >= RUN_TIME_MS) { stopRun("주행 시간 초과"); return; }

  // 4. 목표 속도 계산과 제어
  updateTarget(dt);
  control(computeSteer(), dt);
  updateLeds(now);

  // 5. 로그
  String s = String(now - runStartMs) + "," + (controlOn ? "ON" : "OFF") + "," +
             String(slopeDeg(), 1) + "," + String(roll, 1) + "," +
             String(speedNow, 3) + "," + String(targetSpeed, 3) + "," +
             String(outPwm) + "," + outState + "," +
             String(yawRate, 1) + "," + String(heading, 1);
  logLine(s);
}
