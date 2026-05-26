#!/usr/bin/env python3
"""
입출입 데이터 동기화 스크립트
Oracle DB → WorkWork API

사용법:
  python access_sync.py [--days N] [--table TABLE_NAME]

옵션:
  --days N      동기화할 일수 (기본: 1)
  --table NAME  특정 테이블만 동기화 (kt, secom, caps 중 하나)

설치:
  pip install oracledb requests

스케줄러 예시 (Windows 작업 스케줄러):
  매일 01:00에 실행: python C:\scripts\access_sync.py --days 1
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta

import oracledb
import requests

# ═══════════════════════════════════════════════════════════════════════════════
# 설정
# ═══════════════════════════════════════════════════════════════════════════════

# Oracle 접속 정보
ORACLE_HOST = os.getenv("ORACLE_HOST", "59.3.91.1")
ORACLE_PORT = int(os.getenv("ORACLE_PORT", "1521"))
ORACLE_SID = os.getenv("ORACLE_SID", "orcl")
ORACLE_USER = os.getenv("ORACLE_USER", "jor")
ORACLE_PASSWORD = os.getenv("ORACLE_PASSWORD", "jor")

# WorkWork API 정보
API_URL = os.getenv("WORKWORK_API_URL", "https://workworkapi-production-dcac.up.railway.app")

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("access_sync.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# Oracle 연결
# ═══════════════════════════════════════════════════════════════════════════════

def get_oracle_connection():
    """Oracle DB 연결 생성"""
    dsn = oracledb.makedsn(ORACLE_HOST, ORACLE_PORT, sid=ORACLE_SID)
    conn = oracledb.connect(user=ORACLE_USER, password=ORACLE_PASSWORD, dsn=dsn)
    return conn


# ═══════════════════════════════════════════════════════════════════════════════
# 테이블별 동기화 함수
# ═══════════════════════════════════════════════════════════════════════════════

def sync_kt_access(conn, from_date: datetime, to_date: datetime) -> dict:
    """
    TB_ACCESS (케이티텔레캅 - 복지동, 정문) 동기화

    ※ 실제 테이블 컬럼명은 DB 구조에 따라 수정 필요
    """
    cursor = conn.cursor()

    # 예시 쿼리 - 실제 컬럼명에 맞게 수정 필요
    query = """
    SELECT
        ROWID AS SOURCE_ID,
        EVENT_TIME AS EVENT_AT,
        CARD_NO,
        EMP_NO AS EMPLOYEE_NO,
        NAME AS PERSON_NAME,
        IN_OUT AS DIRECTION,
        GATE_NAME,
        GATE_ID,
        DEVICE_ID,
        RESULT_CODE
    FROM TB_ACCESS
    WHERE EVENT_TIME >= :from_date
      AND EVENT_TIME < :to_date
    ORDER BY EVENT_TIME
    """

    try:
        cursor.execute(query, {"from_date": from_date, "to_date": to_date})
        columns = [col[0].lower() for col in cursor.description]

        items = []
        for row in cursor:
            item = dict(zip(columns, row))
            # datetime 변환
            if item.get("event_at"):
                item["eventAt"] = item.pop("event_at").isoformat()
            # 필드명 매핑
            item["sourceId"] = str(item.pop("source_id", ""))
            item["cardNo"] = item.pop("card_no", None)
            item["employeeNo"] = item.pop("employee_no", None)
            item["personName"] = item.pop("person_name", None)
            item["gateName"] = item.pop("gate_name", None)
            item["gateId"] = item.pop("gate_id", None)
            item["deviceId"] = item.pop("device_id", None)
            item["resultCode"] = item.pop("result_code", None)
            item["rawData"] = {k: str(v) if v else None for k, v in item.items() if k not in ["eventAt", "sourceId"]}
            items.append(item)

        logger.info(f"[KT] {len(items)}건 조회됨")

        if items:
            resp = requests.post(
                f"{API_URL}/api/access-logs/kt",
                json={"items": items},
                timeout=60,
            )
            resp.raise_for_status()
            result = resp.json()
            logger.info(f"[KT] API 응답: {result}")
            return result
        return {"inserted": 0, "skipped": 0}

    except oracledb.DatabaseError as e:
        logger.error(f"[KT] Oracle 에러: {e}")
        # 테이블이 없거나 컬럼명이 다른 경우
        return {"error": str(e)}
    finally:
        cursor.close()


def sync_secom_alarm(conn, from_date: datetime, to_date: datetime) -> dict:
    """
    T_SECOM_ALARM (에스원 - 함평공장) 동기화

    ※ 실제 테이블 컬럼명은 DB 구조에 따라 수정 필요
    """
    cursor = conn.cursor()

    # 예시 쿼리 - 실제 컬럼명에 맞게 수정 필요
    query = """
    SELECT
        ROWID AS SOURCE_ID,
        ALARM_TIME AS EVENT_AT,
        CARD_NO,
        EMP_NO AS EMPLOYEE_NO,
        NAME AS PERSON_NAME,
        IN_OUT AS DIRECTION,
        ZONE_NAME,
        ZONE_ID,
        DEVICE_ID,
        ALARM_TYPE,
        RESULT_CODE
    FROM T_SECOM_ALARM
    WHERE ALARM_TIME >= :from_date
      AND ALARM_TIME < :to_date
    ORDER BY ALARM_TIME
    """

    try:
        cursor.execute(query, {"from_date": from_date, "to_date": to_date})
        columns = [col[0].lower() for col in cursor.description]

        items = []
        for row in cursor:
            item = dict(zip(columns, row))
            if item.get("event_at"):
                item["eventAt"] = item.pop("event_at").isoformat()
            item["sourceId"] = str(item.pop("source_id", ""))
            item["cardNo"] = item.pop("card_no", None)
            item["employeeNo"] = item.pop("employee_no", None)
            item["personName"] = item.pop("person_name", None)
            item["zoneName"] = item.pop("zone_name", None)
            item["zoneId"] = item.pop("zone_id", None)
            item["deviceId"] = item.pop("device_id", None)
            item["alarmType"] = item.pop("alarm_type", None)
            item["resultCode"] = item.pop("result_code", None)
            item["rawData"] = {k: str(v) if v else None for k, v in item.items() if k not in ["eventAt", "sourceId"]}
            items.append(item)

        logger.info(f"[SECOM] {len(items)}건 조회됨")

        if items:
            resp = requests.post(
                f"{API_URL}/api/access-logs/secom",
                json={"items": items},
                timeout=60,
            )
            resp.raise_for_status()
            result = resp.json()
            logger.info(f"[SECOM] API 응답: {result}")
            return result
        return {"inserted": 0, "skipped": 0}

    except oracledb.DatabaseError as e:
        logger.error(f"[SECOM] Oracle 에러: {e}")
        return {"error": str(e)}
    finally:
        cursor.close()


def sync_caps_alarm(conn, from_date: datetime, to_date: datetime) -> dict:
    """
    T_CAPS_ALARM (캡스 - 사무실) 동기화

    ※ 실제 테이블 컬럼명은 DB 구조에 따라 수정 필요
    """
    cursor = conn.cursor()

    # 예시 쿼리 - 실제 컬럼명에 맞게 수정 필요
    query = """
    SELECT
        ROWID AS SOURCE_ID,
        ALARM_TIME AS EVENT_AT,
        CARD_NO,
        EMP_NO AS EMPLOYEE_NO,
        NAME AS PERSON_NAME,
        IN_OUT AS DIRECTION,
        DOOR_NAME,
        DOOR_ID,
        DEVICE_ID,
        ALARM_TYPE,
        RESULT_CODE
    FROM T_CAPS_ALARM
    WHERE ALARM_TIME >= :from_date
      AND ALARM_TIME < :to_date
    ORDER BY ALARM_TIME
    """

    try:
        cursor.execute(query, {"from_date": from_date, "to_date": to_date})
        columns = [col[0].lower() for col in cursor.description]

        items = []
        for row in cursor:
            item = dict(zip(columns, row))
            if item.get("event_at"):
                item["eventAt"] = item.pop("event_at").isoformat()
            item["sourceId"] = str(item.pop("source_id", ""))
            item["cardNo"] = item.pop("card_no", None)
            item["employeeNo"] = item.pop("employee_no", None)
            item["personName"] = item.pop("person_name", None)
            item["doorName"] = item.pop("door_name", None)
            item["doorId"] = item.pop("door_id", None)
            item["deviceId"] = item.pop("device_id", None)
            item["alarmType"] = item.pop("alarm_type", None)
            item["resultCode"] = item.pop("result_code", None)
            item["rawData"] = {k: str(v) if v else None for k, v in item.items() if k not in ["eventAt", "sourceId"]}
            items.append(item)

        logger.info(f"[CAPS] {len(items)}건 조회됨")

        if items:
            resp = requests.post(
                f"{API_URL}/api/access-logs/caps",
                json={"items": items},
                timeout=60,
            )
            resp.raise_for_status()
            result = resp.json()
            logger.info(f"[CAPS] API 응답: {result}")
            return result
        return {"inserted": 0, "skipped": 0}

    except oracledb.DatabaseError as e:
        logger.error(f"[CAPS] Oracle 에러: {e}")
        return {"error": str(e)}
    finally:
        cursor.close()


# ═══════════════════════════════════════════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="입출입 데이터 동기화")
    parser.add_argument("--days", type=int, default=1, help="동기화할 일수 (기본: 1)")
    parser.add_argument("--table", type=str, choices=["kt", "secom", "caps"], help="특정 테이블만 동기화")
    args = parser.parse_args()

    to_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    from_date = to_date - timedelta(days=args.days)

    logger.info(f"═══════════════════════════════════════════════════")
    logger.info(f"입출입 데이터 동기화 시작")
    logger.info(f"기간: {from_date.strftime('%Y-%m-%d')} ~ {to_date.strftime('%Y-%m-%d')}")
    logger.info(f"API: {API_URL}")
    logger.info(f"═══════════════════════════════════════════════════")

    try:
        conn = get_oracle_connection()
        logger.info("Oracle 연결 성공")
    except Exception as e:
        logger.error(f"Oracle 연결 실패: {e}")
        sys.exit(1)

    results = {}

    try:
        if args.table is None or args.table == "kt":
            logger.info("─── TB_ACCESS (케이티텔레캅) 동기화 ───")
            results["kt"] = sync_kt_access(conn, from_date, to_date)

        if args.table is None or args.table == "secom":
            logger.info("─── T_SECOM_ALARM (에스원) 동기화 ───")
            results["secom"] = sync_secom_alarm(conn, from_date, to_date)

        if args.table is None or args.table == "caps":
            logger.info("─── T_CAPS_ALARM (캡스) 동기화 ───")
            results["caps"] = sync_caps_alarm(conn, from_date, to_date)

    finally:
        conn.close()
        logger.info("Oracle 연결 종료")

    logger.info(f"═══════════════════════════════════════════════════")
    logger.info(f"동기화 완료: {json.dumps(results, ensure_ascii=False)}")
    logger.info(f"═══════════════════════════════════════════════════")


if __name__ == "__main__":
    main()
