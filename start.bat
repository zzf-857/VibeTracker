@echo off
title VibeTracker Quick Start Panel
color 0b

:menu
cls
echo ===================================================
echo              VibeTracker Quick Start Panel
echo ===================================================
echo  [1] Start development mode
echo  [2] Build and preview desktop app
echo  [3] Backup VibeTracker SQLite database
echo  [4] Run ESLint
echo  [5] Run unit tests
echo  [6] Build Windows installer
echo  [7] Exit
echo ===================================================
echo.
set /p opt="Choose an option (1-7), then press Enter: "

if "%opt%"=="1" goto op_dev
if "%opt%"=="2" goto op_build
if "%opt%"=="3" goto op_backup
if "%opt%"=="4" goto op_lint
if "%opt%"=="5" goto op_test
if "%opt%"=="6" goto op_package
if "%opt%"=="7" goto op_exit

echo.
echo [Error] Invalid option. Please choose 1 to 7.
pause
goto menu

:op_dev
echo.
echo Starting VibeTracker development mode...
npm run dev
pause
goto menu

:op_build
echo.
echo Building VibeTracker (frontend + Electron main process)...
call npm run build
if %errorlevel% neq 0 goto op_build_failed
echo.
echo Starting VibeTracker desktop preview...
npm run electron:run
pause
goto menu

:op_build_failed
echo.
echo [Error] Build failed. Please check the output above.
pause
goto menu

:op_backup
echo.
echo Backing up VibeTracker SQLite database...
set "BACKUP_DIR=database_backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

set "timestamp=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "timestamp=%timestamp: =0%"

if exist "%APPDATA%\VibeTracker\vibetracker.db" goto op_backup_copy
echo [Info] No VibeTracker database found at "%APPDATA%\VibeTracker\vibetracker.db".
pause
goto menu

:op_backup_copy
copy "%APPDATA%\VibeTracker\vibetracker.db" "%BACKUP_DIR%\vibetracker_backup_%timestamp%.db" >nul
echo [OK] Database backup saved to "%BACKUP_DIR%".
echo Backup file: vibetracker_backup_%timestamp%.db
pause
goto menu

:op_lint
echo.
echo Running ESLint...
call npm run lint
if %errorlevel% neq 0 (
    echo ESLint reported issues.
) else (
    echo [OK] ESLint passed.
)
pause
goto menu

:op_test
echo.
echo Running unit tests...
call npm run test:unit
pause
goto menu

:op_package
echo.
echo Building VibeTracker Windows installer...
call npm run package -- --publish never
pause
goto menu

:op_exit
exit
