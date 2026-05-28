# CAMS 동기화 스크립트

사내 서버에서 CAMS 데이터를 수집하여 WorkWork API로 푸시합니다.

## 설치

```bash
# 1. 스크립트 복사
scp sync-cams.js 사내서버:/opt/cams-sync/

# 2. Node.js 설치 (v18 이상)
# Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. 의존성 설치 (EUC-KR 디코딩용)
cd /opt/cams-sync
npm init -y
npm install iconv-lite
```

## 환경변수 설정

```bash
# /opt/cams-sync/.env 파일 생성
CAMS_BASE_URL=http://cn.icams.co.kr
WORKWORK_API_URL=https://api.workwork.kr
CAMS_SYNC_API_KEY=여기에_API_키_입력
```

## 수동 실행

```bash
cd /opt/cams-sync
source .env && node sync-cams.js
```

## Cron 설정 (매일 아침 7시)

```bash
# crontab -e
0 7 * * * cd /opt/cams-sync && source .env && /usr/bin/node sync-cams.js >> /var/log/cams-sync.log 2>&1
```

## API 키 발급

Railway 환경변수에 `CAMS_SYNC_API_KEY` 추가:
1. Railway Dashboard → Variables
2. 새 변수 추가: `CAMS_SYNC_API_KEY` = 안전한 랜덤 문자열 (예: `openssl rand -hex 32`)
3. 같은 키를 사내 서버 환경변수에도 설정

## 로그 확인

```bash
tail -f /var/log/cams-sync.log
```

## 문제 해결

### EUC-KR 깨짐
```bash
npm install iconv-lite
```

### 연결 실패
- CAMS 서버가 사내망에서만 접근 가능한지 확인
- 방화벽 설정 확인

### API 키 오류
- Railway와 사내 서버의 API 키가 동일한지 확인
