@echo off
chcp 65001 >nul
cd /d %~dp0
pip install -q pyinstaller oracledb requests
pyinstaller --onefile --name workwork_agent --collect-all oracledb workwork_agent.py
echo.
echo dist\workwork_agent.exe 생성 완료. 같은 폴더에 .env 를 두고 실행:  workwork_agent.exe --loop 60
pause
