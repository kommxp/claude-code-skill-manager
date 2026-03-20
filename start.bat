@echo off
chcp 65001 >nul
title Skill Manager

set DIR=%~dp0

echo.
echo   Skill Manager - Claude Code
echo   ============================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

if not exist "%DIR%node_modules" (
    echo [SETUP] Installing backend dependencies...
    cd /d "%DIR%"
    call npm install
)

if not exist "%DIR%dist\index.html" (
    if exist "%DIR%client\package.json" (
        echo [BUILD] Installing frontend dependencies...
        cd /d "%DIR%client"
        call npm install --legacy-peer-deps
        echo [BUILD] Building frontend...
        call npm run build
    )
)

cd /d "%DIR%"
set RETRIES=0

:start_loop
node server/index.js
if %errorlevel% equ 0 goto :done

set /a RETRIES+=1
if %RETRIES% gtr 5 (
    echo.
    echo   [ERROR] Crashed 5 times. Check the logs.
    pause
    goto :done
)

echo.
echo   [WARN] Restarting in 3s... (%RETRIES%/5)
timeout /t 3 /nobreak >nul
goto :start_loop

:done
