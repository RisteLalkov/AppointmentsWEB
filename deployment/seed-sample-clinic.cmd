@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "Appointments.Api.dll" (
  echo Place this file in the published API folder beside Appointments.Api.dll.
  pause
  exit /b 1
)
set "sample_clinic=%~1"
if not defined sample_clinic set "sample_clinic=main"
echo Adding sample data to clinic: %sample_clinic%
echo The API uses its existing server database settings.
set "Preview__AllowSeed=true"
set "Database__ApplyMigrations=false"
dotnet .\Appointments.Api.dll --seed-preview --clinic "%sample_clinic%"
if errorlevel 1 (
  echo.
  echo SAMPLE DATA FAILED. Keep the full error message above.
  pause
  exit /b 1
)
echo.
echo Sample data added successfully. Existing accounts and appointments were preserved.
echo No login credentials were created or changed.
pause
