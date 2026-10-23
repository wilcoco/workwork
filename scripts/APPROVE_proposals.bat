@echo off
chcp 65001 >nul
cd /d %~dp0
echo AI가 제안한 KPI 질의를 검토해 등록합니다. 각 제안마다 y(등록)/n(거절)/s(건너뜀)
python workwork_agent.py --approve all
pause
