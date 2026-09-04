@echo off
title Hearth
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo Bun isn't installed. Get it from https://bun.sh and run this again.
  pause
  exit /b 1
)

echo Checking dependencies...
call bun install --silent

REM Give the server a moment to bind before the browser goes looking.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:7870"

echo.
echo   Hearth is starting. Close this window to stop it.
echo.
bun run src/serve.ts

echo.
echo Hearth stopped.
pause
