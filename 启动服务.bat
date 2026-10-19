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

rem --- 防火墙放行 3000 端口（需要管理员权限；失败只提示，不影响本机游玩）---
netsh advfirewall firewall show rule name="UNO-Local-3000" >nul 2>nul
if errorlevel 1 (
  netsh advfirewall firewall add rule name="UNO-Local-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>nul
  if errorlevel 1 (
    echo [提示] 没有管理员权限，未能自动放行防火墙。
    echo        其他设备若连不上，请右键本 bat 选「以管理员身份运行」一次，
    echo        或在 Windows 防火墙弹窗出现时点「允许访问」。
  ) else (
    echo [防火墙] 已放行 3000 端口，局域网设备可以访问。
  )
  echo.
)

rem --- 释放 3000 端口（上次未正常退出或重复双击时避免「端口被占用」假死）---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /F /PID %%p >nul 2>nul

echo [启动] 正在启动本地服务...
echo        启动后窗口会显示「局域网联机」地址，把那个地址告诉好友。
echo.

rem --- 3 秒后自动打开浏览器（服务就绪前有短暂等待）---
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

call npm start

echo.
echo 服务已停止。
pause
