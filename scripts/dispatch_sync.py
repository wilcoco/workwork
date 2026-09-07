#!/usr/bin/env python3
"""
배차 동기화 에이전트 — WorkWork(클라우드) → 사내 Oracle ERP(INSA.T_GA_CHA3_1)

동작(당겨오기/polling, outbound only — 방화벽 인바운드 불필요):
  1) WorkWork API에서 '오라클 반영 대기(PENDING)' 승인 배차 목록을 GET
  2) 각 건을 사내 Oracle INSA.T_GA_CHA3_1 에 INSERT (파워앱 Patch와 동일 매핑)
  3) 성공하면 WorkWork에 '반영 완료(SYNCED)' 표시 / 실패하면 error 기록(다음에 재시도)

이 스크립트는 기존 access_sync.py 와 같은 사내 PC/서버에서 돌리면 됩니다.

설치:
  pip install oracledb requests

스케줄러(윈도우 작업 스케줄러) 예: 1분마다
  python C:\scripts\dispatch_sync.py --once
또는 상주 모드:
  python C:\scripts\dispatch_sync.py --loop 60

⚠️ 안전장치: 기본은 DRY_RUN=1 (오라클에 실제로 쓰지 않고 INSERT문만 로그).
   컬럼 매핑·순번(CHASEQ) 규칙을 검증한 뒤 DRY_RUN=0 으로 켜세요.
"""

import argparse
import random
import logging
import os
import sys
import time
from datetime import datetime

import oracledb
import requests

# ═══════════════════════════════════ 설정 (환경변수) ═══════════════════════════════════
# Oracle — 반드시 INSA.T_GA_CHA3_1 에 INSERT 권한이 있는 계정
ORACLE_HOST = os.getenv("ORACLE_HOST", "59.28.45.1")
ORACLE_PORT = int(os.getenv("ORACLE_PORT", "1521"))
ORACLE_SID = os.getenv("ORACLE_SID", "")          # 구버전 SID 방식
ORACLE_SERVICE = os.getenv("ORACLE_SERVICE", "")  # 서비스명 방식(12c+)
ORACLE_USER = os.getenv("ORACLE_USER", "")
ORACLE_PASSWORD = os.getenv("ORACLE_PASSWORD", "")
ORACLE_THICK = os.getenv("ORACLE_THICK", "") == "1"  # 구버전 DB/한글 캐릭터셋이면 1 (Instant Client 필요)

# WorkWork(클라우드) API
API_URL = os.getenv("WORKWORK_API_URL", "https://workworkapi-production-dcac.up.railway.app")
SYNC_TOKEN = os.getenv("ORACLE_SYNC_TOKEN", "")   # 서버 환경변수와 동일해야 함

# 안전장치: 기본 미실행(로그만). 검증 후 "0"으로 바꿔 실제 기록.
DRY_RUN = os.getenv("DRY_RUN", "1") != "0"
BATCH = int(os.getenv("BATCH", "50"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler("dispatch_sync.log", encoding="utf-8")],
)
log = logging.getLogger("dispatch_sync")

_thick_done = False


def oracle_conn():
    global _thick_done
    if ORACLE_THICK and not _thick_done:
        oracledb.init_oracle_client()
        _thick_done = True
    if ORACLE_SERVICE:
        dsn = f"{ORACLE_HOST}:{ORACLE_PORT}/{ORACLE_SERVICE}"
    elif ORACLE_SID:
        dsn = oracledb.makedsn(ORACLE_HOST, ORACLE_PORT, sid=ORACLE_SID)
    else:
        raise RuntimeError("ORACLE_SERVICE 또는 ORACLE_SID 중 하나는 설정해야 합니다")
    return oracledb.connect(user=ORACLE_USER, password=ORACLE_PASSWORD, dsn=dsn)


def fetch_pending():
    r = requests.get(f"{API_URL}/api/car-dispatch/oracle/pending",
                     params={"token": SYNC_TOKEN, "limit": BATCH}, timeout=30)
    r.raise_for_status()
    return r.json().get("items", [])


def mark_synced(dispatch_id: str, seq):
    requests.post(f"{API_URL}/api/car-dispatch/oracle/mark",
                  json={"token": SYNC_TOKEN, "id": dispatch_id, "oracleSeq": seq}, timeout=30).raise_for_status()


def mark_error(dispatch_id: str, msg: str):
    try:
        requests.post(f"{API_URL}/api/car-dispatch/oracle/error",
                      json={"token": SYNC_TOKEN, "id": dispatch_id, "error": msg}, timeout=30)
    except Exception:
        pass


# 복합 PK(NOT NULL): CHAYMD, CHASEQ, CHADPT, CHANM, CHACSRT, CHAGBN — 하나라도 빈값이면 INSERT 불가.
PK_COLS = ["CHAYMD", "CHASEQ", "CHADPT", "CHANM", "CHACSRT", "CHAGBN"]
SEQ_MAX = 99999  # CHASEQ NUMBER(5)

# CHAYMD — VARCHAR2(8) 문자열 "YYYYMMDD" (파워앱 Date 를 이 형식 문자열로). KST 기준.
def to_chaymd(iso: str) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    kst = datetime.utcfromtimestamp(dt.timestamp() + 9 * 3600)
    return kst.strftime("%Y%m%d")


# 순번(CHASEQ) — 같은 CHAYMD 안에서 MAX+1(날짜별 순번). NUMBER(5) 초과나 레거시 난수 충돌 대비 폴백.
def next_seq(cur, chaymd: str) -> int:
    cur.execute("SELECT NVL(MAX(CHASEQ),0)+1 FROM INSA.T_GA_CHA3_1 WHERE CHAYMD = :ymd", {"ymd": chaymd})
    n = int(cur.fetchone()[0])
    if n <= SEQ_MAX:
        return n
    return random.randint(1, SEQ_MAX)  # 그날 순번이 5자리를 넘으면(레거시 난수 등) 난수 폴백


def insert_one(cur, item: dict) -> int:
    chaymd = to_chaymd(item["chaymd"])
    base = {
        "CHANM": (item.get("chanm") or "").strip(),      # 신청자 + 동승자
        "CHADPT": (item.get("chadpt") or "").strip(),     # 부서
        "CHACSRT": (item.get("chacsrt") or "").strip(),   # 차량 "봉고(EV)" 형태 전체
        "CHAGBN": (item.get("chagbn") or "").strip(),     # 구분 (시내/시외/교육/기타)
        "CHAYMD": chaymd,                                  # 배차일 VARCHAR2(8)
        "CHAPLACE": (item.get("chaplace") or "").strip(), # 행선지 (NULL 허용)
        "CHARSN": (item.get("charsn") or "").strip(),     # 사유 (NULL 허용)
    }
    # PK 컬럼(CHASEQ 제외) 빈값 검사 — 비면 NOT NULL·PK 위반이므로 아예 시도하지 않고 명확히 실패
    missing = [c for c in PK_COLS if c != "CHASEQ" and not base.get(c)]
    if missing:
        raise ValueError(f"PK 필수값 누락: {', '.join(missing)} (배차 신청 정보 확인 필요)")

    cols = list(base.keys()) + ["CHASEQ"]
    # PK 중복/순번 충돌 시 순번을 다시 뽑아 최대 5회 재시도
    for attempt in range(5):
        seq = next_seq(cur, chaymd)
        binds = {**base, "CHASEQ": seq}
        vals = ", ".join(f":{k}" for k in cols)
        sql = f"INSERT INTO INSA.T_GA_CHA3_1 ({', '.join(cols)}) VALUES ({vals})"
        if DRY_RUN:
            log.info(f"[DRY_RUN] {sql}  binds={binds}")
            return seq
        try:
            cur.execute(sql, binds)
            return seq
        except oracledb.IntegrityError:
            if attempt == 4:
                raise
            continue  # 순번 충돌 → 재채번


def run_once():
    if not SYNC_TOKEN:
        log.error("ORACLE_SYNC_TOKEN 미설정 — 종료")
        return
    items = fetch_pending()
    if not items:
        log.info("반영 대기 배차 없음")
        return
    log.info(f"반영 대기 {len(items)}건 (DRY_RUN={DRY_RUN})")
    conn = None
    try:
        conn = oracle_conn()
        for item in items:
            did = item["id"]
            try:
                with conn.cursor() as cur:
                    seq = insert_one(cur, item)
                if not DRY_RUN:
                    conn.commit()
                    mark_synced(did, seq)
                    log.info(f"기록 완료: {did} → CHASEQ={seq} ({item.get('chanm')})")
                else:
                    log.info(f"[DRY_RUN] 완료 표시 생략: {did}")
            except Exception as e:  # noqa: BLE001
                if conn:
                    conn.rollback()
                log.error(f"기록 실패: {did} — {e}")
                mark_error(did, str(e))
    finally:
        if conn:
            conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="한 번만 실행 (스케줄러용)")
    ap.add_argument("--loop", type=int, metavar="SEC", help="상주 모드: SEC초마다 반복")
    args = ap.parse_args()
    log.info(f"dispatch_sync 시작 | API={API_URL} | ORACLE={ORACLE_HOST}:{ORACLE_PORT} | DRY_RUN={DRY_RUN}")
    if args.loop:
        while True:
            try:
                run_once()
            except Exception as e:  # noqa: BLE001
                log.error(f"루프 오류: {e}")
            time.sleep(args.loop)
    else:
        run_once()


if __name__ == "__main__":
    main()
