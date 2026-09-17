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

echo [1/6] Uploading bettings.json...
aws s3 cp "%FIXTURE%" "s3://tab-recap-vbeta1/working/%JOBID%/bettings.json" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo [2/6] Creating DynamoDB test job...
node -e "const fs=require('fs');const id=process.env.JOBID,now=new Date().toISOString();fs.writeFileSync(process.env.OUTDIR+'\\job.json',JSON.stringify({jobId:{S:id},status:{S:'RECEIVED'},createdAt:{S:now},updatedAt:{S:now}},null,2));"
aws dynamodb put-item --table-name tab-recap-vbeta1-jobs --item "file://%OUTDIR%\job.json" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo [3/6] Creating planner event...
node -e "const fs=require('fs');const id=process.env.JOBID;fs.writeFileSync(process.env.OUTDIR+'\\event.json',JSON.stringify({schemaVersion:'1.0',jobId:id,bettingsS3Key:'working/'+id+'/bettings.json',testMode:true},null,2));"

echo [4/6] Invoking planner...
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

echo [5/6] Downloading scene.json...
aws s3 cp "s3://tab-recap-vbeta1/working/%JOBID%/scene.json" "%OUTDIR%\scene.json" --region ap-southeast-2
if errorlevel 1 exit /b 1

echo [6/6] Final scene.json:
type "%OUTDIR%\scene.json"

echo.
echo PASS - planner reached RENDERING.
echo Results: %OUTDIR%
echo.

node -e "const fs=require('fs');const id=process.env.JOBID;fs.writeFileSync(process.env.OUTDIR+'\\render-message.json',JSON.stringify({schemaVersion:'1.0',jobId:id,bettingsS3Key:'working/'+id+'/bettings.json',sceneS3Key:'working/'+id+'/scene.json'},null,2));"

echo === NEXT: MANUAL BUILDER HANDOFF ===
echo Job ID          : %JOBID%
echo Bettings S3 Key : working/%JOBID%/bettings.json
echo Scene S3 Key    : working/%JOBID%/scene.json
echo Render message  : %OUTDIR%\render-message.json
echo.
echo After the rendering queue exists, send this message manually with:
echo aws sqs send-message --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-rendering --message-body file://%OUTDIR%\render-message.json --region ap-southeast-2
echo.
echo NOTE: This script does NOT send the SQS message automatically.
echo.
endlocal
