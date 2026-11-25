# Slope Guard

상황 적응형 속도 제어기 (개인형 이동수단) 웹 시연 페이지

- 바로 보기: https://leekwangeun.github.io/slope-guard/
- 설계도: https://leekwangeun.github.io/slope-guard/#model
- 경사 주행 시뮬레이션: https://leekwangeun.github.io/slope-guard/#sim
- 전도 상황 시뮬레이션: https://leekwangeun.github.io/slope-guard/#tip

three.js(WebGPU, 안 되는 기기에서는 WebGL 2)로 그린다. 모형과 질감은 코드로 만들고, 시뮬레이션 값은 펌웨어 prj_test3.ino의 제어 수식으로 계산한 예상값이다(실측 아님).

## 내 컴퓨터에서 열기

`열기.bat`을 실행하거나 `python serve.py`. 같은 와이파이의 휴대폰에서도 보려면 `python serve.py --lan`.
