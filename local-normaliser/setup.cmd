@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo TAB LOCAL NORMALISER - SETUP
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or not in PATH.
  exit /b 1
)
if not exist input mkdir input
if not exist working mkdir working
echo Installing local validator dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 exit /b 1
echo.
echo Setup complete.
echo Put TAB monthly CSV files in:
echo   %CD%\input
echo Then run:
echo   run.cmd
