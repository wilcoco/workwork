@echo off
REM CAMS 동기화 실행 (Windows)
REM 작업 스케줄러에서 이 파일을 실행하도록 설정하세요

cd /d %~dp0

REM 환경변수 설정
set CAMS_BASE_URL=http://cn.icams.co.kr
set WORKWORK_API_URL=https://api.workwork.kr
set CAMS_SYNC_API_KEY=여기에_API_키_입력

REM Python 실행
python sync_cams.py >> sync_log.txt 2>&1

echo 완료: %date% %time% >> sync_log.txt
