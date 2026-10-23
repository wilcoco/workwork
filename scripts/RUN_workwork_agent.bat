@echo off
chcp 65001 >nul
cd /d %~dp0
echo WorkWork 데이터 에이전트 시작 (60초 간격). 새 질의 승인은 별도 창에서: python3 workwork_agent.py --approve all
python3 workwork_agent.py --loop 60
pause
