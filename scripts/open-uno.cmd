@echo off
chcp 65001 >nul
setlocal
title UNO helper

for /l %%i in (1,1,90) do (
  netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
  if not errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    start "" "http://localhost:3000/"
    exit /b 0
  )
  ping -n 2 127.0.0.1 >nul
)
exit /b 1
