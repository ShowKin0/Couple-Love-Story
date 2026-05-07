@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: 静默启动（无参数时自我最小化重启）
if "%1"=="" (
    start /min "" cmd /c "%~f0" _minimized_
    exit /b
)

echo.
echo ╔══════════════════════════════════╗
echo ║    💕 情侣网站 — 一键部署        ║
echo ╚══════════════════════════════════╝
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未找到 Node.js，请先安装：https://nodejs.org
    pause
    exit /b 1
)

:: 检查 ngrok
where ngrok >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未找到 ngrok，请先下载：https://ngrok.com/download
    pause
    exit /b 1
)

:: 安装依赖
if not exist "node_modules\" (
    echo 📦 安装依赖中...
    call npm install
)

echo.

:: 启动服务
echo 🚀 启动 Web 服务...
start /min "Love Server" cmd /c "node server.js & pause"

:: 等待端口就绪
:wait
timeout /t 1 /nobreak >nul
netstat -an | find ":3000 " >nul 2>nul
if %errorlevel% neq 0 goto wait

:: 打开本地网站


:: 启动 ngrok
echo 🌐 启动内网穿透...
start /min "Ngrok Tunnel" cmd /c "ngrok http 3000"

:: 获取公网地址
echo ⏳ 获取公网地址（约需 10 秒）...
node get-ngrok-url.js > .ngrok.tmp
set /p NGROK_URL=<.ngrok.tmp
del .ngrok.tmp

:: 显示结果
cls
echo.
echo ╔══════════════════════════════════════════╗
echo ║                                          ║
echo ║     💕 部署成功！                        ║
echo ║                                          ║
echo ║  📍 本地: http://localhost:3000          ║
echo ║                                          ║
if defined NGROK_URL (
    echo ║  🌍 发给朋友:                          ║
    echo ║     %NGROK_URL%                       ║
) else (
    echo ║  ⚠️  获取公网地址失败                  ║
    echo ║  请查看 "Ngrok Tunnel" 窗口中的地址    ║
)
echo ║                                          ║
echo ║  浏览器已自动打开                        ║
echo ╚══════════════════════════════════════════╝
echo.
echo 按任意键关闭所有服务...
pause >nul

:: 关闭
echo.
echo 🛑 正在关闭服务...
taskkill /fi "WindowTitle eq Love Server" /f >nul 2>nul
taskkill /fi "WindowTitle eq Ngrok Tunnel" /f >nul 2>nul
echo ✅ 已关闭
timeout /t 2 /nobreak >nul
