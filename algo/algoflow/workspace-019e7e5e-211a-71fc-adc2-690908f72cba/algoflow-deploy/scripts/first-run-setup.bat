@echo off
setlocal
echo.
echo ===================================================
echo   AlgoFlow - Windows first-run setup
echo ===================================================
echo.

where node >nul 2>&1
if %errorLevel% neq 0 (
  echo [ERROR] Node.js not found. Install Node 22+ from https://nodejs.org/
  exit /b 1
)

for /f "tokens=*" %%v in ('node -p "process.version"') do set NODEVER=%%v
echo [OK] Node.js %NODEVER%

where g++ >nul 2>&1
if %errorLevel% equ 0 (echo [OK] g++ found) else (echo [WARN] g++ not found - see docs\COMPILERS.md)

where python >nul 2>&1
if %errorLevel% equ 0 (echo [OK] python found) else (
  where python3 >nul 2>&1
  if %errorLevel% equ 0 (echo [OK] python3 found) else (echo [WARN] Python not found - see docs\COMPILERS.md)
)

echo.
echo Installing npm dependencies...
cd /d "%~dp0.."
call npm install
if %errorLevel% neq 0 exit /b 1

echo.
echo [OK] Setup complete. Start AlgoFlow with:
echo   npm start
echo.
echo Optional: run scripts\setup-firewall.bat as Admin for tablet sync.
pause
