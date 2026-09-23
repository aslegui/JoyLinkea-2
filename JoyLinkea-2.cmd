@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo JoyLinkea-2 requiere Node.js 22 o superior.
  pause
  exit /b 1
)
if not exist node_modules\ws (
  echo Faltan dependencias. Ejecuta npm install en esta carpeta.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5182/"
node src\server.js
if errorlevel 1 pause
