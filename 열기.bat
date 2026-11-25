@echo off
cd /d "%~dp0"
title Slope Guard
echo Slope Guard 화면을 브라우저로 엽니다.
echo 이 창을 닫으면 화면도 더 이상 동작하지 않습니다.
echo.
where py >nul 2>nul
if not errorlevel 1 (
  py -3 serve.py %*
  goto end
)
where python >nul 2>nul
if not errorlevel 1 (
  python serve.py %*
  goto end
)
echo Python이 설치되어 있지 않아 열 수 없습니다.
echo https://www.python.org 에서 Python을 설치한 뒤 다시 실행해 주세요.
:end
echo.
pause
