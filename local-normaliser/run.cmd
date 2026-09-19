@echo off
setlocal
cd /d "%~dp0"
if not exist input mkdir input
if not exist working mkdir working
if not exist node_modules (
  echo Validator dependencies are not installed.
  echo Run setup.cmd once before using the Normaliser.
  exit /b 1
)
python normaliser.py
