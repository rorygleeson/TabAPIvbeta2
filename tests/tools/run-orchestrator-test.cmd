@echo off
setlocal EnableExtensions EnableDelayedExpansion

if "%~1"=="" (
  echo Usage: run-orchestrator-test.cmd 5 [good^|bad]
  echo        run-orchestrator-test.cmd 8 [good^|bad]
  echo        run-orchestrator-test.cmd 16 [good^|bad]
  echo        run-orchestrator-test.cmd 32 [good^|bad]
  echo        run-orchestrator-test.cmd 50 [good^|bad]
  echo        run-orchestrator-test.cmd 75 [good^|bad]
  echo.
  echo Mode defaults to GOOD when omitted.
  exit /b 1
)

set "APIURL=https://fbhuqhy5cf.execute-api.ap-southeast-2.amazonaws.com/poc"

if "%TAB_RECAP_API_KEY%"=="" (
  echo ERROR: TAB_RECAP_API_KEY is not set.
  echo Set it locally to the API Gateway key value. Do not commit it.
  exit /b 1
)

set "SIZE=%~1"
set "MODE=%~2"
if "%MODE%"=="" set "MODE=good"

if /I not "%MODE%"=="good" if /I not "%MODE%"=="bad" (
  echo ERROR: Unknown mode "%MODE%".
  echo Use GOOD or BAD.
  exit /b 1
)

set "ROOT=%~dp0..\.."
set "FIXTURE=%ROOT%\tests\fixtures\bettings-%SIZE%.json"

if not exist "%FIXTURE%" (
  echo ERROR: Fixture not found:
  echo %FIXTURE%
  exit /b 1
)

for /f %%i in ('node -p "\"test-api-%SIZE%-%MODE%-\" + new Date().toISOString().replace(/[-:TZ.]/g,\"\").slice(0,14)"') do set "RUNID=%%i"
set "OUTDIR=%ROOT%\tests\results\%RUNID%"
mkdir "%OUTDIR%" >nul 2>&1

set "POSTFILE=%FIXTURE%"
set "EXPECTED=202"

echo.
echo ============================================================
echo TAB KUBRICK PUBLIC API CLIENT TEST
echo ============================================================
echo Fixture : bettings-%SIZE%.json
echo Mode    : %MODE%
echo API     : %APIURL%
echo Results : %OUTDIR%
echo.

if /I "%MODE%"=="bad" goto prepare_bad

echo Client journey:
echo   1. Submit known-good canonical bettings.json
echo   2. Expect synchronous admission to succeed
echo   3. Expect HTTP 202 + jobId + RECEIVED
echo   4. Poll GET /jobs/{jobId}
echo   5. Wait for READY
echo   6. Download recap.html
echo.
goto post_job

:prepare_bad
set "POSTFILE=%OUTDIR%\invalid-bettings.json"
set "EXPECTED=400"

echo Client journey:
echo   1. Start from the selected known-good fixture
echo   2. Create a TEMPORARY invalid copy in the results folder
echo   3. Do NOT modify the source fixture
echo   4. POST the invalid canonical payload
echo   5. Expect synchronous admission rejection
echo   6. Expect HTTP 400 + errorCode and NO jobId
echo   7. Do NOT poll because no job should exist
echo.
echo [PREP] Creating temporary invalid payload...
echo Fault  : summary.totalBets is deliberately changed so it no longer matches bets.length

node -e "const fs=require('fs');const src=process.argv[1],dst=process.argv[2];const x=JSON.parse(fs.readFileSync(src,'utf8'));if(x.summary && typeof x.summary.totalBets==='number'){}else throw new Error('fixture summary.totalBets missing');x.summary.totalBets=x.summary.totalBets+1;fs.writeFileSync(dst,JSON.stringify(x,null,2)+'\n');" "%FIXTURE%" "%POSTFILE%"
if errorlevel 1 (
  echo FAILED - could not create temporary invalid payload.
  exit /b 1
)

echo Temporary payload: %POSTFILE%
echo Source fixture remains unchanged: %FIXTURE%
echo.
goto post_job

:post_job
echo [1/4] CLIENT - POST /jobs
echo Waiting for Kubrick synchronous admission decision...

curl.exe -sS -X POST "%APIURL%/jobs" ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: %TAB_RECAP_API_KEY%" ^
  --data-binary "@%POSTFILE%" ^
  -o "%OUTDIR%\create-response.json" ^
  -w "%%{http_code}" > "%OUTDIR%\create-http-status.txt"

if errorlevel 1 (
  echo FAILED - HTTP transport error calling POST /jobs.
  exit /b 1
)

set /p HTTPSTATUS=<"%OUTDIR%\create-http-status.txt"
echo HTTP status: !HTTPSTATUS!
echo Response:
type "%OUTDIR%\create-response.json"
echo.
echo.

set "JOBID="
set "APIERROR="
set "JOBSTATUS="

for /f "usebackq delims=" %%j in (`node -e "const fs=require('fs');try{const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.jobId)process.stdout.write(x.jobId)}catch(e){}" "%OUTDIR%\create-response.json"`) do set "JOBID=%%j"
for /f "usebackq delims=" %%e in (`node -e "const fs=require('fs');try{const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.errorCode)process.stdout.write(x.errorCode)}catch(e){}" "%OUTDIR%\create-response.json"`) do set "APIERROR=%%e"
for /f "usebackq delims=" %%s in (`node -e "const fs=require('fs');try{const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.status)process.stdout.write(x.status)}catch(e){}" "%OUTDIR%\create-response.json"`) do set "JOBSTATUS=%%s"

if /I "%MODE%"=="bad" goto verify_bad

echo [2/4] CLIENT - interpreting admission response...
if not "!HTTPSTATUS!"=="202" (
  echo FAILED - known-good payload was not accepted.
  if not "!APIERROR!"=="" echo API errorCode: !APIERROR!
  echo Client would STOP here and would NOT poll.
  exit /b 2
)

if "!JOBID!"=="" (
  echo FAILED - HTTP 202 did not return jobId.
  exit /b 2
)

if /I not "!JOBSTATUS!"=="RECEIVED" (
  echo FAILED - HTTP 202 did not return status RECEIVED.
  echo Returned status: !JOBSTATUS!
  exit /b 2
)

echo Admission result: ACCEPTED
echo Job ID          : !JOBID!
echo Initial status  : !JOBSTATUS!
echo Client action   : begin polling GET /jobs/{jobId}
echo.
goto poll_start

:verify_bad
echo [2/4] CLIENT - interpreting admission response...
if "!HTTPSTATUS!"=="202" (
  echo FAILED - invalid payload was ACCEPTED.
  if not "!JOBID!"=="" echo Unexpected Job ID: !JOBID!
  if not "!JOBSTATUS!"=="" echo Unexpected status: !JOBSTATUS!
  echo.
  echo This means Kubrick started a job for data that should have failed admission.
  echo Client simulation stops here because the admission contract has failed.
  exit /b 6
)

if not "!HTTPSTATUS!"=="400" (
  echo FAILED - invalid payload should return HTTP 400.
  echo Actual HTTP status: !HTTPSTATUS!
  if not "!APIERROR!"=="" echo API errorCode: !APIERROR!
  exit /b 6
)

if /I not "!APIERROR!"=="KUBRICK_INVALID_PAYLOAD" (
  echo FAILED - invalid payload did not return KUBRICK_INVALID_PAYLOAD.
  echo Actual errorCode: !APIERROR!
  exit /b 6
)

if not "!JOBID!"=="" (
  echo FAILED - rejected request unexpectedly returned jobId !JOBID!.
  exit /b 6
)

echo Admission result: REJECTED AS EXPECTED
echo HTTP status     : !HTTPSTATUS!
echo API errorCode   : !APIERROR!
echo Job ID          : none
echo Client action   : STOP - no polling because no job was accepted
echo.
echo [3/4] CLIENT - polling check
echo SKIPPED correctly: rejected admission has no jobId.
echo.
echo [4/4] RESULT
echo PASS - Kubrick rejected the invalid payload before client-side job polling began.
echo Source fixture was not modified.
echo Results: %OUTDIR%
echo.
exit /b 0

:poll_start
echo [3/4] CLIENT - polling GET /jobs/!JOBID! ...
set /a WAITED=0

:poll
curl.exe -sS "%APIURL%/jobs/!JOBID!" ^
  -H "x-api-key: %TAB_RECAP_API_KEY%" ^
  -o "%OUTDIR%\status-response.json" ^
  -w "%%{http_code}" > "%OUTDIR%\status-http-status.txt"

if errorlevel 1 (
  echo FAILED - HTTP transport error while polling.
  exit /b 1
)

set /p STATUSHTTP=<"%OUTDIR%\status-http-status.txt"
set "JOBSTATUS="
set "APIERROR="

for /f "usebackq delims=" %%s in (`node -e "const fs=require('fs');try{const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.status)process.stdout.write(x.status)}catch(e){}" "%OUTDIR%\status-response.json"`) do set "JOBSTATUS=%%s"
for /f "usebackq delims=" %%e in (`node -e "const fs=require('fs');try{const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.errorCode)process.stdout.write(x.errorCode)}catch(e){}" "%OUTDIR%\status-response.json"`) do set "APIERROR=%%e"

if not "!STATUSHTTP!"=="200" (
  echo FAILED - status request returned HTTP !STATUSHTTP!.
  if not "!APIERROR!"=="" echo API errorCode: !APIERROR!
  type "%OUTDIR%\status-response.json"
  echo.
  exit /b 3
)

echo Status after !WAITED!s: !JOBSTATUS!

if /I "!JOBSTATUS!"=="READY" goto ready
if /I "!JOBSTATUS!"=="FAILED" goto failed
if !WAITED! GEQ 180 goto timeout

>nul 2>&1 ping 127.0.0.1 -n 4
set /a WAITED+=3
goto poll

:ready
echo.
echo [4/4] CLIENT - READY, obtaining recap URL...
type "%OUTDIR%\status-response.json"
echo.

set "RECAPURL="
for /f "usebackq delims=" %%u in (`node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.recapUrl)process.stdout.write(x.recapUrl)" "%OUTDIR%\status-response.json"`) do set "RECAPURL=%%u"

if "!RECAPURL!"=="" (
  echo FAILED - READY response did not contain recapUrl.
  exit /b 3
)

echo Client action: download recap.html from returned presigned URL...
curl.exe -sS -L "!RECAPURL!" -o "%OUTDIR%\recap.html"
if errorlevel 1 exit /b 1

echo.
echo PASS - complete public client journey succeeded.
echo Admission : HTTP 202 ACCEPTED
echo Job ID    : !JOBID!
echo Status    : READY
echo Recap     : downloaded
echo Results   : %OUTDIR%
echo.
exit /b 0

:failed
echo.
echo FAILED - accepted job reached DynamoDB status FAILED.
echo This is a POST-acceptance job-processing failure, not an admission error.
type "%OUTDIR%\status-response.json"
echo.
exit /b 4

:timeout
echo.
echo FAILED - timed out waiting for READY after 180 seconds.
echo Last response:
type "%OUTDIR%\status-response.json"
echo.
exit /b 5
