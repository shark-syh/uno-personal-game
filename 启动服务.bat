@echo off
chcp 65001 >nul
title UNO 本地服务
cd /d %~dp0

echo ============================================
echo   UNO 单机版 - 本地服务
echo   启动后浏览器打开: http://localhost:3000
echo   关闭此窗口即停止服务
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装 Node.js 22 或更高版本。
  pause
  exit /b 1
)

if not exist node_modules (
  echo [提示] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo.
echo [启动] 正在启动本地服务...
echo.
call npm run dev

echo.
echo 服务已停止。
pause
