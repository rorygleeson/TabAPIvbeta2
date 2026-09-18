@echo off
setlocal EnableExtensions

if "%~1"=="" (
  echo Usage: run-planner-test.cmd 5
  echo        run-planner-test.cmd 16
  echo        run-planner-test.cmd 32
  echo        run-planner-test.cmd 75
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

for /f %%i in ('node -p "\"test-step10-%SIZE%-\" + new Date().toISOString().replace(/[-:TZ.]/g,\"\").slice(0,14)"') do set "JOBID=%%i"

set "OUTDIR=%ROOT%\tests\results\%JOBID%"
mkdir "%OUTDIR%" >nul 2>&1

echo.
echo === TAB Planner Test ===
echo Fixture: bettings-%SIZE%.json
echo Job ID : %JOBID%
echo.

echo [1/9] Uploading bettings.json...
aws s3 cp "%FIXTURE%" "s3://tab-recap-vbeta1/working/%JOBID%/bettings.json" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo [2/9] Creating DynamoDB test job...
node -e "const fs=require('fs');const id=process.env.JOBID,now=new Date().toISOString();fs.writeFileSync(process.env.OUTDIR+'\\job.json',JSON.stringify({jobId:{S:id},status:{S:'RECEIVED'},createdAt:{S:now},updatedAt:{S:now}},null,2));"
aws dynamodb put-item --table-name tab-recap-vbeta1-jobs --item "file://%OUTDIR%\job.json" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo [3/9] Creating planner event...
node -e "const fs=require('fs');const id=process.env.JOBID;fs.writeFileSync(process.env.OUTDIR+'\\event.json',JSON.stringify({schemaVersion:'1.0',jobId:id,bettingsS3Key:'working/'+id+'/bettings.json',testMode:true},null,2));"

echo [4/9] Invoking planner...
aws lambda invoke --function-name tab-recap-vbeta1-scene-planner --payload "fileb://%OUTDIR%\event.json" --cli-binary-format raw-in-base64-out --cli-read-timeout 300 --region ap-southeast-2 "%OUTDIR%\response.json"
if errorlevel 1 exit /b 1

echo.
type "%OUTDIR%\response.json"
echo.

findstr /c:"RENDERING" "%OUTDIR%\response.json" >nul
if errorlevel 1 (
  echo.
  echo FAILED - planner did not reach RENDERING.
  echo Output saved in: %OUTDIR%
  echo.
  echo Recent logs for this job:
  aws logs tail /aws/lambda/tab-recap-vbeta1-scene-planner --since 10m --region ap-southeast-2 | findstr "%JOBID%"
  exit /b 2
)

echo [5/9] Downloading scene.json...
aws s3 cp "s3://tab-recap-vbeta1/working/%JOBID%/scene.json" "%OUTDIR%\scene.json" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo [6/9] Final scene.json:
type "%OUTDIR%\scene.json"

echo.
echo [7/9] Waiting for Builder to finish...
set /a WAITED=0

:wait_ready
for /f "usebackq delims=" %%s in (`aws dynamodb get-item --table-name tab-recap-vbeta1-jobs --key "{\"jobId\":{\"S\":\"%JOBID%\"}}" --projection-expression "#s,recapS3Key,#e" --expression-attribute-names "{\"#s\":\"status\",\"#e\":\"error\"}" --region ap-southeast-2 --query "Item.status.S" --output text 2^>nul`) do set "JOBSTATUS=%%s"

if /I "%JOBSTATUS%"=="READY" goto ready
if /I "%JOBSTATUS%"=="FAILED" goto builder_failed

if %WAITED% GEQ 90 goto builder_timeout

>nul 2>&1 ping 127.0.0.1 -n 4
set /a WAITED+=3
goto wait_ready

:ready
echo [8/9] Builder reached READY.

for /f "usebackq delims=" %%k in (`aws dynamodb get-item --table-name tab-recap-vbeta1-jobs --key "{\"jobId\":{\"S\":\"%JOBID%\"}}" --projection-expression "recapS3Key" --region ap-southeast-2 --query "Item.recapS3Key.S" --output text`) do set "RECAPKEY=%%k"

if "%RECAPKEY%"=="" (
  echo FAILED - READY job has no recapS3Key.
  exit /b 3
)

echo [9/9] Downloading recap.html...
aws s3 cp "s3://tab-recap-vbeta1/%RECAPKEY%" "%OUTDIR%\recap.html" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo.
echo PASS - end-to-end Planner -> Rendering SQS -> Builder completed.
echo Job ID   : %JOBID%
echo Status   : READY
echo Recap key: %RECAPKEY%
echo Results  : %OUTDIR%
echo.
exit /b 0

:builder_failed
echo.
echo FAILED - Builder set job status to FAILED.
aws dynamodb get-item --table-name tab-recap-vbeta1-jobs --key "{\"jobId\":{\"S\":\"%JOBID%\"}}" --region ap-southeast-2 --output json
echo.
echo Recent Builder logs for this job:
aws logs tail /aws/lambda/tab-recap-vbeta1-builder-recap --since 10m --region ap-southeast-2 | findstr "%JOBID%"
exit /b 4

:builder_timeout
echo.
echo FAILED - timed out waiting for Builder READY after 90 seconds.
aws dynamodb get-item --table-name tab-recap-vbeta1-jobs --key "{\"jobId\":{\"S\":\"%JOBID%\"}}" --region ap-southeast-2 --output json
echo.
echo Recent Planner logs for this job:
aws logs tail /aws/lambda/tab-recap-vbeta1-scene-planner --since 10m --region ap-southeast-2 | findstr "%JOBID%"
echo.
echo Recent Builder logs for this job:
aws logs tail /aws/lambda/tab-recap-vbeta1-builder-recap --since 10m --region ap-southeast-2 | findstr "%JOBID%"
exit /b 5
