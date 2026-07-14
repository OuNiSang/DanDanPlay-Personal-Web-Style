@echo off
setlocal
chcp 65001 >nul

set "MANAGER=%~dp0scripts\manage-style.ps1"

if not exist "%MANAGER%" (
  echo [ERROR] Missing scripts\manage-style.ps1
  pause
  exit /b 1
)

where pwsh.exe >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoLogo -NoProfile -File "%MANAGER%" -Action menu
) else (
  pwsh.exe -NoLogo -NoProfile -File "%MANAGER%" -Action menu
)

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
