@echo off
setlocal EnableExtensions EnableDelayedExpansion

if "%~1"=="" (
  echo Usage: run-orchestrator-test.cmd 5
  echo        run-orchestrator-test.cmd 8
  echo        run-orchestrator-test.cmd 16
  echo        run-orchestrator-test.cmd 32
  echo        run-orchestrator-test.cmd 50
  echo        run-orchestrator-test.cmd 75
  exit /b 1
)

if "%TAB_RECAP_API_URL%"=="" (
  echo ERROR: TAB_RECAP_API_URL is not set.
  echo Example: set TAB_RECAP_API_URL=https://abc123.execute-api.ap-southeast-2.amazonaws.com/poc
  exit /b 1
)

if "%TAB_RECAP_API_KEY%"=="" (
  echo ERROR: TAB_RECAP_API_KEY is not set.
  echo Set it locally to the API Gateway key value. Do not commit it.
  exit /b 1
)

set "SIZE=%~1"
set "ROOT=%~dp0..\.."
set "FIXTURE=%ROOT%\tests\fixtures\bettings-%SIZE%.json"

if not exist "%FIXTURE%" (
  echo ERROR: Fixture not found:
  echo %FIXTURE%
  exit /b 1
)

set "APIURL=%TAB_RECAP_API_URL%"
if "%APIURL:~-1%"=="/" set "APIURL=%APIURL:~0,-1%"

for /f %%i in ('node -p "\"test-api-%SIZE%-\" + new Date().toISOString().replace(/[-:TZ.]/g,\"\").slice(0,14)"') do set "RUNID=%%i"
set "OUTDIR=%ROOT%\tests\results\%RUNID%"
mkdir "%OUTDIR%" >nul 2>&1

echo.
echo === TAB Orchestrator API Test ===
echo Fixture: bettings-%SIZE%.json
echo Results: %OUTDIR%
echo.

echo [1/4] POST /jobs ...
curl.exe -sS -X POST "%APIURL%/jobs" ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: %TAB_RECAP_API_KEY%" ^
  --data-binary "@%FIXTURE%" ^
  -o "%OUTDIR%\create-response.json"
if errorlevel 1 exit /b 1

type "%OUTDIR%\create-response.json"
echo.

for /f "usebackq delims=" %%j in (`node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.jobId)process.stdout.write(x.jobId)" "%OUTDIR%\create-response.json"`) do set "JOBID=%%j"

if "%JOBID%"=="" (
  echo FAILED - POST /jobs did not return jobId.
  exit /b 2
)

echo Job ID: %JOBID%
echo.
echo [2/4] Polling GET /jobs/%JOBID% ...
set /a WAITED=0

:poll
curl.exe -sS "%APIURL%/jobs/%JOBID%" ^
  -H "x-api-key: %TAB_RECAP_API_KEY%" ^
  -o "%OUTDIR%\status-response.json"
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%s in (`node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.status)process.stdout.write(x.status)" "%OUTDIR%\status-response.json"`) do set "JOBSTATUS=%%s"

echo Status: !JOBSTATUS!

if /I "!JOBSTATUS!"=="READY" goto ready
if /I "!JOBSTATUS!"=="FAILED" goto failed
if !WAITED! GEQ 180 goto timeout

>nul 2>&1 ping 127.0.0.1 -n 4
set /a WAITED+=3
goto poll

:ready
echo.
echo [3/4] READY - obtaining recap URL...
type "%OUTDIR%\status-response.json"
echo.

for /f "usebackq delims=" %%u in (`node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.recapUrl)process.stdout.write(x.recapUrl)" "%OUTDIR%\status-response.json"`) do set "RECAPURL=%%u"

if "!RECAPURL!"=="" (
  echo FAILED - READY response did not contain recapUrl.
  exit /b 3
)

echo [4/4] Downloading recap.html from presigned URL...
curl.exe -sS -L "!RECAPURL!" -o "%OUTDIR%\recap.html"
if errorlevel 1 exit /b 1

echo.
echo PASS - API to Orchestrator to Planner to Rendering SQS to Builder completed.
echo Job ID : %JOBID%
echo Status : READY
echo Results: %OUTDIR%
echo.
exit /b 0

:failed
echo.
echo FAILED - job reached FAILED.
type "%OUTDIR%\status-response.json"
echo.
exit /b 4

:timeout
echo.
echo FAILED - timed out waiting for READY after 180 seconds.
type "%OUTDIR%\status-response.json"
echo.
exit /b 5
