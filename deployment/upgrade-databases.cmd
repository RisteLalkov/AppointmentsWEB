@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "Appointments.Api.dll" (
  echo Place this file in the published API folder beside Appointments.Api.dll.
  pause
  exit /b 1
)
echo Stop ALL API and Web application pools before continuing.
echo This upgrades the databases configured in this API folder. It does not add sample data.
pause
if exist "Appointments.Api.exe" (
  .\Appointments.Api.exe --migrate
) else (
  dotnet .\Appointments.Api.dll --migrate
)
if not "%ERRORLEVEL%"=="0" (
  echo.
  echo DATABASE UPGRADE FAILED. Keep the complete error above. Do not start the application yet.
  pause
  exit /b 1
)
echo.
echo Database upgrade finished successfully.
pause
