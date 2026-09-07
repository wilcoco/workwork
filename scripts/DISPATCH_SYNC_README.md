# 배차 → 오라클 동기화 에이전트 (dispatch_sync.py)

WorkWork에서 **배차가 최종 승인**되면 그 건이 클라우드에 `PENDING`으로 표시된다.
이 에이전트가 사내에서 그걸 당겨와 오라클 `INSA.T_GA_CHA3_1` 에 INSERT 한다.
(방향: 사내 → 밖으로 요청. 방화벽 인바운드 개방 불필요. access_sync.py 와 동일 원리)

## 설치 (access_sync.py 도는 사내 PC 권장)
    pip install oracledb requests
    copy dispatch_sync.env.example .env   # 값 채우기

## 실행
    # 스케줄러(1분마다) — 윈도우 작업 스케줄러
    python C:\scripts\dispatch_sync.py --once
    # 또는 상주
    python C:\scripts\dispatch_sync.py --loop 60

## 켜기 전 반드시 확인 (DRY_RUN=1 상태에서 로그로 검증)
1. **CHASEQ(순번) 규칙** — 파워앱 `Label32` 수식과 일치하는지. 기본은 "같은 배차일 MAX+1".
   다르면 `next_seq()` 함수만 수정.
2. **CHAYMD 형식** — ERP가 `20260907`(YYYYMMDD)인지 `2026-09-07`인지. `to_chaymd()` 조정.
3. **CHACSRT / CHAGBN 코드값** — 파워앱 드롭다운(DataCardValue252_1 / 260)의 실제 코드.
   `insert_one()` 의 TODO 두 줄 채우기.
4. **NOT NULL 컬럼** — 파워앱 `Defaults()`가 자동 채우던 컬럼(등록자·등록일시·상태 등)이
   테이블에 NOT NULL 로 있으면 INSERT 실패한다. 전체 컬럼 확인 후 binds 에 추가.

검증 끝나면 `.env` 의 `DRY_RUN=0` 으로 실제 기록 시작.

## 롤백/안전
- 실패 건은 자동으로 클라우드에 error 기록 + PENDING 유지 → 다음 폴링에 재시도.
- 오라클 계정은 이 테이블 INSERT 권한만 부여(다른 테이블/DELETE·UPDATE 불가) 권장.
