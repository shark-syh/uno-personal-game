@echo off
chcp 65001 >nul
title UNO 本地网页游戏服务
cd /d "%~dp0"

echo ============================================
echo   UNO 本地网页游戏服务（单机 + 局域网联机）
echo   本机游玩:   http://localhost:3000
echo   关闭此窗口即停止服务
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装 Node.js 22 或更高版本。
  pause
  exit /b 1
)

set "UNO_ADMIN=0"
net session >nul 2>&1
if not errorlevel 1 set "UNO_ADMIN=1"

rem --- 防火墙放行 3000 端口（仅局域网需要；已存在则跳过）---
netsh advfirewall firewall show rule name="UNO-Local-3000" >nul 2>nul
if errorlevel 1 (
  if "%UNO_ADMIN%"=="1" (
    netsh advfirewall firewall add rule name="UNO-Local-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>nul
    if errorlevel 1 (
      echo [提示] 未能自动放行防火墙，其他设备可能无法访问。
    ) else (
      echo [防火墙] 已放行 3000 端口，局域网设备可以访问。
    )
  ) else (
    echo [提示] 防火墙尚未放行 3000 端口。
    echo        本机游玩不受影响；局域网联机请关闭窗口后，
    echo        右键本文件选「以管理员身份运行」一次即可。
  )
  echo.
)

rem --- 释放 3000 端口（上次未正常退出或重复双击时避免「端口被占用」假死）---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /F /PID %%p >nul 2>nul
ping -n 2 127.0.0.1 >nul

echo [启动] 正在启动本地服务...
echo        服务就绪后会自动打开浏览器；窗口里显示的「局域网联机」地址可发给好友。
echo.

rem --- 后台等待服务监听 3000 端口，再打开默认浏览器（最多 90 秒）---
start "" /min "%~dp0scripts\open-uno.cmd"

call npm start

echo.
echo 服务已停止。
pause
