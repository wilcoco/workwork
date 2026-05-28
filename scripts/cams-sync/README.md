# CAMS 동기화 스크립트

사내 PC/서버에서 CAMS 데이터를 수집하여 WorkWork API로 푸시합니다.

## Python 버전 (권장)

### 설치

```bash
# 1. Python 3.8+ 설치
# https://www.python.org/downloads/

# 2. 필요 패키지 설치
pip install requests
```

### 설정

`sync_cams.py` 파일 상단의 설정 수정:
```python
CAMS_BASE_URL = 'http://cn.icams.co.kr'
WORKWORK_API_URL = 'https://api.workwork.kr'
CAMS_SYNC_API_KEY = '여기에_API_키_입력'
```

또는 환경변수로 설정.

### 수동 실행

```bash
python sync_cams.py
```

### Windows 작업 스케줄러 설정

1. `run_sync.bat` 파일에서 API 키 수정
2. 작업 스케줄러 실행 (Win+R → `taskschd.msc`)
3. 기본 작업 만들기
   - 이름: CAMS 동기화
   - 트리거: 매일 오전 7:00
   - 동작: 프로그램 시작 → `run_sync.bat` 경로 선택
4. 완료

---

## Node.js 버전 (대안)

### 설치

```bash
# 1. Node.js 설치 (v18 이상)
# 2. 의존성 설치
npm init -y
npm install iconv-lite
```

### 실행

```bash
node sync-cams.js
```

### Linux Cron 설정

```bash
# crontab -e
0 7 * * * cd /opt/cams-sync && source .env && node sync-cams.js >> /var/log/cams-sync.log 2>&1
```

---

## API 키 발급

1. Railway Dashboard → Variables
2. 새 변수 추가: `CAMS_SYNC_API_KEY` = 랜덤 문자열
3. 같은 키를 스크립트에도 설정

## 로그 확인

- Windows: `sync_log.txt` 파일
- Linux: `/var/log/cams-sync.log`

## 문제 해결

### 연결 실패
- CAMS 서버가 사내망에서만 접근 가능한지 확인
- 방화벽 설정 확인

### API 키 오류
- Railway와 스크립트의 API 키가 동일한지 확인

### 인코딩 깨짐
- Python은 자동 처리됨
- Node.js: `npm install iconv-lite`
