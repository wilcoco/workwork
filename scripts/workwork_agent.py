#!/usr/bin/env python3
"""
WorkWork 사내 데이터 에이전트 (읽기 전용)
=========================================
사내망 PC에서 돌며, 클라우드(WorkWork API)가 적어 둔 "조회 작업"(질의 ID + 바인드)을 가져와,
사내 PC의 agent_queries/<질의ID>.sql 을 SELECT로 실행하고 결과(연·월·값)만 클라우드로 올린다.
SQL 본문은 클라우드에 없다 — 클라우드가 뚫려도 미리 등록된 질의만 돈다.
클라우드는 오라클에 직접 접속하지 않는다 (outbound 폴링, 배차 연동과 같은 방식).

안전장치 (DB가 막아주지 않으므로 코드에서 강제):
  - SQL은 이 PC의 agent_queries/*.sql 에 등록된 것만 실행 (클라우드는 질의 ID만 전달)
  - 허용 테이블 화이트리스트(ALLOWED_TABLES) 밖 조회 거부
  - SELECT/WITH로 시작하는 문장만 실행. INSERT/UPDATE/DELETE/DDL/세미콜론/주석/FOR UPDATE 거부
  - 접속 직후 세션을 읽기 전용 트랜잭션으로 전환 (SET TRANSACTION READ ONLY)
  - 문장당 타임아웃 20초 (call_timeout), 순차 실행, 문장 사이 300ms 간격
  - 바인드는 SQL에 쓰인 것만 전달
  - 자격증명·토큰은 .env(환경변수)로만: ORACLE_USER / ORACLE_PWD / ORACLE_DSN / WORKWORK_API_URL / ORACLE_SYNC_TOKEN
  - python-oracledb thin 모드 (Instant Client 불필요)

실행:  python workwork_agent.py --loop 60     (60초마다 작업 확인)
       python workwork_agent.py --once        (한 번만)
"""
import argparse
import logging
import os
import re
import socket
import sys
import time
from pathlib import Path

import requests

try:
    import oracledb
except ImportError:  # pragma: no cover
    oracledb = None

VERSION = "1.1.0"

# ─── .env 로드 (스크립트 폴더) ────────────────────────────────────────────
SCRIPT_DIR = Path(getattr(sys, "_MEIPASS", None) and Path(sys.executable).resolve().parent or Path(__file__).resolve().parent)


def load_env():
    # 스크립트(또는 exe) 폴더의 .env 만 읽는다 — 다른 폴더의 .env 를 집지 않도록 경로 고정
    p = SCRIPT_DIR / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env()
API_URL = os.getenv("WORKWORK_API_URL", "https://workworkapi-production-dcac.up.railway.app").rstrip("/")
TOKEN = os.getenv("ORACLE_SYNC_TOKEN", "")
AGENT = os.getenv("AGENT_NAME", "default")
ORA_USER = os.getenv("ORACLE_USER", "")
ORA_PWD = os.getenv("ORACLE_PWD", "")
ORA_DSN = os.getenv("ORACLE_DSN", "59.28.45.1:1521/orcl")
CALL_TIMEOUT_MS = int(os.getenv("CALL_TIMEOUT_MS", "20000"))
GAP_SEC = float(os.getenv("QUERY_GAP_SEC", "0.3"))
MAX_ROWS = int(os.getenv("MAX_ROWS", "5000"))
QUERY_DIR = Path(os.getenv("QUERY_DIR", str(SCRIPT_DIR / "agent_queries")))
ALLOWED_TABLES = {t.strip().lower() for t in os.getenv("ALLOWED_TABLES", "t_zl_sil,t_zl_bul,t_zl_kld,t_zj_cod,t_doj,t_zm_pln2,t_zm_pln1,dual").split(",") if t.strip()}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler("workwork_agent.log", encoding="utf-8")])
log = logging.getLogger("agent")

DML_RX = re.compile(r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|commit|rollback|execute|exec|call|begin|declare|lock|rename|comment|analyze|audit|flashback|purge)\b", re.I)


def assert_read_only(sql: str) -> str:
    s = (sql or "").strip()
    if not re.match(r"^(select|with)\b", s, re.I):
        raise ValueError("SELECT/WITH 문장만 실행합니다")
    if ";" in s:
        raise ValueError("세미콜론 금지")
    if "--" in s or "/*" in s:
        raise ValueError("주석 금지")
    if DML_RX.search(s):
        raise ValueError("쓰기/구조변경 키워드 포함 — 거부")
    if re.search(r"\bfor\s+update\b", s, re.I):
        raise ValueError("FOR UPDATE 금지")
    if re.search(r"\bbin\$", s, re.I):
        raise ValueError("휴지통 객체 금지")
    # 테이블 화이트리스트: FROM/JOIN 뒤 식별자(서브쿼리 괄호 제외)가 전부 허용 목록 안이어야 한다
    # WITH 절(CTE) 이름은 이 문장 안에서만 쓰이는 임시 이름이므로 허용 집합에 더한다
    cte_names = {m.group(1).lower() for m in re.finditer(r"(?:\bwith\s+|,\s*)([a-zA-Z_]\w*)\s+as\s*\(", s, re.I)}
    allowed = ALLOWED_TABLES | cte_names
    for m in re.finditer(r"\b(from|join)\s+([a-zA-Z_][\w$.]*)", s, re.I):
        ident = m.group(2).lower().split(".")[-1]
        if ident not in allowed:
            raise ValueError(f"허용되지 않은 테이블: {ident} (ALLOWED_TABLES 참고)")
    return s


def load_queries() -> dict:
    """agent_queries/*.sql → {id: {sql, name, desc, binds, tables}}. 머리말 주석(-- name/desc/binds)은 분리하고 본문은 가드 검사."""
    reg = {}
    if not QUERY_DIR.exists():
        return reg
    for f in sorted(QUERY_DIR.glob("*.sql")):
        qid = f.stem
        if not re.match(r"^[A-Za-z0-9_\-]{1,80}$", qid):
            log.warning("질의 파일명 부적합(건너뜀): %s", f.name)
            continue
        meta = {"name": qid, "desc": "", "binds": []}
        body = []
        for line in f.read_text(encoding="utf-8").splitlines():
            mm = re.match(r"^\s*--\s*(name|desc|binds)\s*:\s*(.*)$", line, re.I)
            if mm:
                k, v = mm.group(1).lower(), mm.group(2).strip()
                meta[k] = [b.strip() for b in v.split(",") if b.strip()] if k == "binds" else v
            elif line.strip().startswith("--"):
                continue  # 기타 주석 줄 제거
            else:
                body.append(line)
        sql = "\n".join(body).strip()
        try:
            assert_read_only(sql)
        except ValueError as e:
            log.error("질의 %s 가드 실패(등록 안 함): %s", qid, e)
            continue
        tables = sorted({m.group(2).lower().split(".")[-1] for m in re.finditer(r"\b(from|join)\s+([a-zA-Z_][\w$.]*)", sql, re.I)})
        if not meta["binds"]:
            meta["binds"] = sorted({m.group(1) for m in re.finditer(r":([a-zA-Z_][a-zA-Z0-9_]*)", sql)})
        reg[qid] = {"sql": sql, "name": meta["name"], "desc": meta["desc"], "binds": meta["binds"], "tables": tables}
    return reg


QUERIES = {}


def api(method: str, path: str, **kw):
    url = f"{API_URL}{path}"
    r = requests.request(method, url, timeout=30, **kw)
    r.raise_for_status()
    return r.json() if r.text else {}


def heartbeat():
    global QUERIES
    QUERIES = load_queries()
    try:
        cat = [{"id": k, "name": v["name"], "binds": v["binds"], "tables": v["tables"]} for k, v in QUERIES.items()]
        api("POST", "/api/kpi-bindings/agent/heartbeat", json={"token": TOKEN, "agent": AGENT, "version": VERSION, "host": socket.gethostname(), "queries": cat})
    except Exception as e:  # noqa: BLE001
        log.warning("heartbeat 실패: %s", e)


def connect():
    if oracledb is None:
        raise RuntimeError("python-oracledb 가 설치되어 있지 않습니다: pip install oracledb")
    if not ORA_USER or not ORA_PWD:
        raise RuntimeError("ORACLE_USER / ORACLE_PWD 가 .env에 없습니다")
    conn = oracledb.connect(user=ORA_USER, password=ORA_PWD, dsn=ORA_DSN)
    conn.call_timeout = CALL_TIMEOUT_MS
    cur = conn.cursor()
    try:
        cur.execute("SET TRANSACTION READ ONLY")  # 이 세션에서는 쓰기가 DB 수준에서도 거부됨
    except Exception as e:  # noqa: BLE001
        log.warning("READ ONLY 트랜잭션 설정 실패(계속 진행, 코드 가드는 유지): %s", e)
    return conn


def run_sql(conn, sql: str, params: dict):
    sql = assert_read_only(sql)
    used = {m.group(1).lower() for m in re.finditer(r":([a-zA-Z_][a-zA-Z0-9_]*)", sql)}
    binds = {k: v for k, v in (params or {}).items() if k.lower() in used}
    cur = conn.cursor()
    cur.arraysize = 500
    cur.execute(sql, binds)
    cols = [d[0] for d in cur.description]
    rows = []
    for rec in cur:
        rows.append({cols[i]: (float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else (str(v) if v is not None else None)) for i, v in enumerate(rec)})
        if len(rows) >= MAX_ROWS:
            break
    cur.close()
    return rows


def run_once() -> int:
    heartbeat()
    jobs = api("GET", "/api/kpi-bindings/agent/jobs", params={"token": TOKEN, "agent": AGENT, "limit": 10}).get("items", [])
    if not jobs:
        return 0
    log.info("작업 %d건", len(jobs))
    conn = None
    try:
        conn = connect()
        for j in jobs:
            jid = j["id"]
            try:
                qid = str(j.get("queryId") or "")
                q = QUERIES.get(qid)
                if not q:
                    raise ValueError(f"등록되지 않은 질의 ID: {qid!r} (agent_queries 폴더 확인)")
                rows = run_sql(conn, q["sql"], j.get("params") or {})
                api("POST", "/api/kpi-bindings/agent/result", json={"token": TOKEN, "jobId": jid, "rows": rows})
                log.info("완료 %s (%s) rows=%d", jid, j.get("kind"), len(rows))
            except Exception as e:  # noqa: BLE001
                log.error("실패 %s: %s", jid, e)
                try:
                    api("POST", "/api/kpi-bindings/agent/result", json={"token": TOKEN, "jobId": jid, "error": str(e)[:900]})
                except Exception as e2:  # noqa: BLE001
                    log.error("오류 보고 실패: %s", e2)
            time.sleep(GAP_SEC)
    except Exception as e:  # noqa: BLE001
        log.error("접속/실행 오류: %s", e)
        for j in jobs:
            try:
                api("POST", "/api/kpi-bindings/agent/result", json={"token": TOKEN, "jobId": j["id"], "error": f"접속 오류: {str(e)[:800]}"})
            except Exception:  # noqa: BLE001
                pass
    finally:
        if conn is not None:
            try:
                conn.rollback()
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    return len(jobs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--loop", type=int, default=0, help="초 단위 폴링 간격")
    args = ap.parse_args()
    if not TOKEN:
        log.error("ORACLE_SYNC_TOKEN 이 .env에 없습니다")
        sys.exit(2)
    log.info("WorkWork 에이전트 v%s agent=%s api=%s dsn=%s", VERSION, AGENT, API_URL, ORA_DSN)
    if args.loop and args.loop > 0:
        while True:
            try:
                run_once()
            except Exception as e:  # noqa: BLE001
                log.error("루프 오류: %s", e)
            time.sleep(args.loop)
    else:
        run_once()


if __name__ == "__main__":
    main()
