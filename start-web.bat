@echo off
echo ========================================
echo Starting Elixium Web Interface
echo ========================================

echo.
echo Step 1: Running ESLint fix...
call npx eslint . --fix
if %errorlevel% neq 0 (
    echo Warning: ESLint encountered errors, but continuing...
)

echo.
echo Step 2: Building the project...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo Step 3: Starting the server...
echo Node.js version:
node --version

echo.
echo Starting web server...
echo (restarts automatically if the process exits; close this window to stop)

:run
node --openssl-legacy-provider dist/src/elixium.js --web --port 1983
echo.
echo Server exited with code %errorlevel% at %date% %time% - restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto run