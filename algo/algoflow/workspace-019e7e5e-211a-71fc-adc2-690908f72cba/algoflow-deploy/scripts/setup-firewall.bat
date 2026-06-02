@echo off
:: ============================================================================
:: AlgoFlow — Windows Firewall Setup (Run as Administrator)
:: ============================================================================
:: Opens the active AlgoFlow port for cross-device whiteboard sync.
:: Right-click this file → "Run as administrator"
:: ============================================================================

set "PORT="

if not "%~1"=="" (
    set "PORT=%~1"
) else if exist "%~dp0..\data\server-port.txt" (
    set /p PORT=<"%~dp0..\data\server-port.txt"
)

if "%PORT%"=="" set "PORT=3001"

echo.
echo ===================================================
echo   AlgoFlow — Windows Firewall Setup (Port %PORT%)
echo ===================================================
echo.

:: Check for admin privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script requires Administrator privileges.
    echo Right-click and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

:: Add inbound rule
echo Adding inbound firewall rule for port %PORT%...
netsh advfirewall firewall add rule ^
    name="AlgoFlow Whiteboard Sync (TCP %PORT%)" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=%PORT% ^
    profile=private

if %errorLevel% equ 0 (
    echo.
    echo [OK] Firewall rule added successfully.
) else (
    echo.
    echo [ERROR] Failed to add firewall rule.
)

:: Get local IP
echo.
echo ===================================================
echo   Network Information
echo ===================================================
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "IP=%%a"
    goto :found_ip
)
:found_ip
set IP=%IP: =%
echo   Local IP Address:  %IP%
echo   WebSocket Port:    %PORT%
echo   WebSocket URL:     ws://%IP%:%PORT%
echo.
echo   Configure your tablet to connect to:
echo   ┌─────────────────────────────────────────┐
echo   │  ws://%IP%:%PORT%
echo   └─────────────────────────────────────────┘
echo.
echo [NOTE] If your router uses dynamic IP assignment, this address
echo may change. Consider setting a static IP in your router settings.
echo.
pause
