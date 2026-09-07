@echo off
REM ── 배차 에이전트 EXE 빌드 (Windows에서 실행) ──────────────────────
REM 사내 Windows PC에서 이 파일을 더블클릭하면 dispatch_sync.exe 가 생성됩니다.
chcp 65001 >nul
echo [1/3] 필요한 패키지 설치...
python -m pip install --upgrade pip
python -m pip install pyinstaller oracledb requests
echo [2/3] EXE 빌드...
pyinstaller --onefile --name dispatch_sync --collect-all oracledb dispatch_sync.py
echo [3/3] 완료. dist\dispatch_sync.exe 를 확인하세요.
echo   실행: dispatch_sync.exe --loop 60   (같은 폴더에 .env 필요)
pause
