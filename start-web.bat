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
node dist/src/elixium.js --web --port 1983

pause