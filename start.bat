@echo off
:: 强制定制控制台为 UTF-8 编码，防止中文乱码
chcp 65001 >nul
title VibeTracker 快速启动控制面板
color 0b

:menu
cls
echo ===================================================
echo            VibeTracker 阶段性快速启动控制面板
echo ===================================================
echo  [1] 启动开发调试模式 (开启自动热更新 - 推荐)
echo  [2] 编译打包并启动生产预览 (接近真实客户端表现)
echo  [3] 一键备份 SQLite 数据库 (确保数据万无一失)
echo  [4] 运行代码规范检测 (ESLint 语法纠错)
echo  [5] 运行核心单元测试 (12/12 测试集)
echo  [6] 退出面板
echo ===================================================
echo.
set /p opt="请选择操作序号 (1-6) 并按回车: "

if "%opt%"=="1" (
    echo.
    echo 正在启动开发调试环境，请稍候...
    npm run dev
    pause
    goto menu
)

if "%opt%"=="2" (
    echo.
    echo 正在进行完整打包编译 (tsc frontend + tsc electron)...
    call npm run build
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 编译失败，请检查报错！
        pause
        goto menu
      )
    echo.
    echo 正在启动生产预览环境...
    npm run electron:start
    pause
    goto menu
)

if "%opt%"=="3" (
    echo.
    echo 正在读取系统路径并备份 SQLite 数据库...
    set "BACKUP_DIR=database_backups"
    if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
    
    :: 获取格式化后的时间戳
    set "timestamp=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
    :: 剔除时间戳中可能存在的空格(比如上午时段个位数小时产生的空格)
    set "timestamp=%timestamp: =0%"
    
    if exist "%APPDATA%\ai-tools-manager\devtracker.db" (
        copy "%APPDATA%\ai-tools-manager\devtracker.db" "%BACKUP_DIR%\devtracker_backup_%timestamp%.db" >nul
        echo [成功] 数据库文件已成功备份至根目录 "%BACKUP_DIR%" 下！
        echo 备份文件名: devtracker_backup_%timestamp%.db
    ) else (
        echo [提示] 尚未在该系统上发现真实生成的数据库文件。
        echo (数据库只有在您初次运行并创建项目后，才会自动在系统路径中创建)
    )
    pause
    goto menu
)

if "%opt%"=="4" (
    echo.
    echo 正在进行 ESLint 规范性检测...
    call npm run lint
    if %errorlevel% neq 0 (
        echo 检测到语法或规范警告。
    ) else (
        echo [完美] 代码检测 100% 通过！
    )
    pause
    goto menu
)

if "%opt%"=="5" (
    echo.
    echo 正在运行单元测试...
    call npm run test:unit
    pause
    goto menu
)

if "%opt%"=="6" (
    exit
)

echo [错误] 输入的序号无效，请输入 1 到 6 之间的数字。
pause
goto menu
