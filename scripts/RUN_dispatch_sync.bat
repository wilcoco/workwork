@echo off
REM 배차 에이전트 상주 실행 (같은 폴더의 .env 사용, 1분마다)
chcp 65001 >nul
cd /d %~dp0
dispatch_sync.exe --loop 60
