@echo off
setlocal
cd /d "%~dp0"

if not exist input mkdir input
if not exist working mkdir working

where python >nul 2>nul
if not errorlevel 1 (
  python normaliser.py
  exit /b %errorlevel%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 normaliser.py
  exit /b %errorlevel%
)

echo ERROR: Python 3 was not found in PATH.
echo Install Python 3 or make it available as python or py.
exit /b 1
