@echo off
chcp 65001 >nul
cd /d %~dp0
echo WorkWork 데이터 에이전트 시작 (60초 간격, 창을 닫으면 멈춥니다)
python workwork_agent.py --loop 60
pause
