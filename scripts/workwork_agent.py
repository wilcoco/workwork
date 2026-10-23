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
  - 메타데이터 카탈로그(oracle_catalog/)는 이 PC에만 있고, "관련 자료 찾기"는 여기서 검색해 발췌(화면 몇 개의 SQL·컬럼 사전)만 올린다
  - 허용 테이블 화이트리스트(ALLOWED_TABLES) 밖 조회 거부
  - SELECT/WITH로 시작하는 문장만 실행. INSERT/UPDATE/DELETE/DDL/세미콜론/주석/FOR UPDATE 거부
  - 접속 직후 세션을 읽기 전용 트랜잭션으로 전환 (SET TRANSACTION READ ONLY)
  - 문장당 타임아웃 20초 (call_timeout), 순차 실행, 문장 사이 300ms 간격
  - 바인드는 SQL에 쓰인 것만 전달
  - 자격증명·토큰은 .env(환경변수)로만: ORACLE_USER / ORACLE_PWD / ORACLE_DSN / WORKWORK_API_URL / ORACLE_SYNC_TOKEN
  - python-oracledb thin 모드 (Instant Client 불필요)

실행:  python workwork_agent.py --loop 60      (60초마다 작업 확인)
       python workwork_agent.py --once         (한 번만)
       python workwork_agent.py --proposals    (AI가 제안한 질의 보기)
       python workwork_agent.py --approve all  (제안을 사람이 검토해 y 로 등록 — 이 명령 없이는 새 질의가 생기지 않음)
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

VERSION = "1.3.1"

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

# ─── 메타데이터 카탈로그 (이 PC에만 존재, 클라우드로 올리지 않음) ─────────────
CATALOG_DIR = Path(os.getenv("CATALOG_DIR", str(SCRIPT_DIR / "oracle_catalog")))
_CATALOG = None


def load_catalog():
    """oracle_catalog/*.json → 메모리 인덱스. 민감(insa 앱, sensitive 테이블)은 처음부터 제외."""
    global _CATALOG
    if _CATALOG is not None:
        return _CATALOG
    import json
    cat = {"screens": [], "tables": {}, "codes": [], "generatedAt": ""}
    try:
        def rd(name):
            p = CATALOG_DIR / name
            if not p.exists():
                return None
            return json.loads(p.read_text(encoding="utf-8"))
        sc = rd("screens.json")
        if sc:
            cat["generatedAt"] = str(sc.get("generatedAt", "")) if isinstance(sc, dict) else ""
            for x in (sc.get("screens") if isinstance(sc, dict) else sc) or []:
                if str(x.get("app", "")).lower() == "insa" or x.get("sensitive"):
                    continue
                tables = {str(t).lower() for t in (x.get("tables") or [])}
                grids = x.get("grids") or []
                for g in grids:
                    tables |= {str(t).lower() for t in (g.get("tables") or [])}
                text = " ".join([str(x.get("id", "")), str(x.get("name", "")), str(x.get("menu") or ""), str(x.get("note") or ""), " ".join(tables),
                                 " ".join(str(g.get("title", "")) for g in grids), str(x.get("sql") or "")[:3000],
                                 " ".join(str(g.get("sql") or "")[:1500] for g in grids)]).lower()
                cat["screens"].append({"id": str(x.get("id", "")).lower(), "name": x.get("name", ""), "menu": x.get("menu"), "note": x.get("note") or "",
                                       "tables": sorted(tables), "binds": x.get("binds") or [], "sql": x.get("sql"),
                                       "grids": [{"title": g.get("title", ""), "sql": g.get("sql"), "tables": [str(t).lower() for t in (g.get("tables") or [])]} for g in grids],
                                       "_text": text})
        tb = rd("tables.json")
        if tb:
            for t in (tb.get("tables") if isinstance(tb, dict) else tb) or []:
                key = str(t.get("table", "")).lower()
                if not key or t.get("sensitive"):
                    continue
                cols = [{"name": str(c.get("name", "")).lower(), "type": c.get("type", ""), "comment": c.get("comment") or "", "code_ref": c.get("code_ref")} for c in (t.get("columns") or [])]
                cat["tables"][key] = {"table": key, "comment": t.get("comment") or "", "rows_approx": t.get("rows_approx"), "columns": cols,
                                      "_text": " ".join([key, str(t.get("comment") or "")] + [f"{c['name']} {c['comment']}" for c in cols]).lower()}
        cd = rd("codes.json")
        if cd:
            for g in (cd.get("groups") if isinstance(cd, dict) else cd) or []:
                items = [{"code": str(i.get("code", "")), "label": str(i.get("label", ""))} for i in (g.get("items") or [])]
                cat["codes"].append({"group": str(g.get("group", "")), "name": g.get("name") or "", "items": items,
                                     "_text": " ".join([str(g.get("group", "")), str(g.get("name") or "")] + [f"{i['code']} {i['label']}" for i in items]).lower()})
    except Exception as e:  # noqa: BLE001
        log.error("카탈로그 로드 실패: %s", e)
    _CATALOG = cat
    log.info("카탈로그 로드: 화면 %d · 테이블 %d · 코드그룹 %d", len(cat["screens"]), len(cat["tables"]), len(cat["codes"]))
    return cat


def catalog_summary():
    c = load_catalog()
    return {"screens": len(c["screens"]), "tables": len(c["tables"]), "codes": len(c["codes"]), "generatedAt": c.get("generatedAt", "")}


def discover(params: dict) -> dict:
    """KPI 토큰으로 로컬 카탈로그를 검색해 '발췌'만 돌려준다 (화면 몇 개의 SQL, 관련 테이블 컬럼, 코드그룹)."""
    c = load_catalog()
    toks = [str(t).lower() for t in (params.get("tokens") or []) if str(t).strip()]
    kpi = params.get("kpi") or {}
    for extra in [str(kpi.get("title", "")), str(kpi.get("metric", "")), str(params.get("hint", ""))]:
        for w in re.split(r"[\s()/·,%:\-]+", extra.lower()):
            if len(w) >= 2 and w not in toks:
                toks.append(w)
    toks = toks[:30]
    # 서버가 큰 값을 보내도 발췌 상한은 에이전트가 고정한다 (카탈로그 통째 유출 방지)
    max_s = min(int(params.get("maxScreens") or 6), 8)
    max_t = min(int(params.get("maxTables") or 8), 12)
    max_c = min(int(params.get("maxCodes") or 4), 6)

    def score(text: str, name: str = "", has_menu: bool = True, has_sql: bool = True) -> float:
        sc = sum(3 if (t in name.lower()) else (1 if t in text else 0) for t in toks)
        if sc and has_menu:
            sc += 1.5  # 사용자가 아는 화면 우선
        if sc and has_sql:
            sc += 1
        return sc

    screens = sorted(c["screens"], key=lambda x: -score(x["_text"], x["name"], bool(x["menu"]), bool(x["sql"] or any(g.get("sql") for g in x["grids"]))))
    screens = [x for x in screens if score(x["_text"], x["name"], bool(x["menu"]), True) > 0][:max_s]
    # 역검색: 화면이 쓰는 테이블 + 토큰이 걸리는 테이블
    ref_tables = []
    for x in screens:
        for t in x["tables"]:
            if t not in ref_tables:
                ref_tables.append(t)
    scored_tables = sorted(c["tables"].values(), key=lambda t: -score(t["_text"], t["table"]))
    for t in scored_tables:
        if score(t["_text"], t["table"]) > 0 and t["table"] not in ref_tables:
            ref_tables.append(t["table"])
    tables = [c["tables"][t] for t in ref_tables if t in c["tables"]][:max_t]
    codes = [g for g in sorted(c["codes"], key=lambda g: -score(g["_text"], g["name"])) if score(g["_text"], g["name"]) > 0][:max_c]
    strip = lambda d, keys: {k: v for k, v in d.items() if k in keys}  # noqa: E731
    return {
        "screens": [dict(strip(x, {"id", "name", "menu", "note", "tables", "binds"}), sql=(x["sql"] or "")[:2500] or None,
                         grids=[{"title": g["title"], "sql": (g["sql"] or "")[:1500] or None} for g in x["grids"][:3]]) for x in screens],
        "tables": [dict(strip(t, {"table", "comment", "rows_approx"}), columns=t["columns"][:60]) for t in tables],
        "codes": [dict(strip(g, {"group", "name"}), items=g["items"][:40]) for g in codes],
        "allowedTables": sorted(ALLOWED_TABLES),
        "tokens": toks,
    }


MAX_OUTBOUND_BYTES = int(os.getenv("MAX_OUTBOUND_BYTES", str(96 * 1024)))  # 한 번에 클라우드로 보내는 payload 상한
OUTBOUND_LOG = SCRIPT_DIR / "outbound_payloads.log"


def _log_outbound(path: str, body) -> int:
    """클라우드로 나가는 모든 payload를 로컬에 기록(크기·키·요약). '무엇이 나갔는가'를 사람이 나중에 확인할 수 있게."""
    import json
    raw = json.dumps(body, ensure_ascii=False) if body is not None else ""
    size = len(raw.encode("utf-8"))
    summary = ""
    if isinstance(body, dict):
        if "result" in body and isinstance(body["result"], dict):
            r = body["result"]
            summary = f"DISCOVER 발췌: 화면 {[x.get('id') for x in r.get('screens', [])]} 테이블 {[t.get('table') for t in r.get('tables', [])]} 코드 {[c.get('group') for c in r.get('codes', [])]}"
        elif "rows" in body:
            summary = f"rows={len(body.get('rows') or [])}"
        elif "queries" in body:
            summary = f"heartbeat queries={len(body.get('queries') or [])} catalog={body.get('catalog')}"
        else:
            summary = ",".join(k for k in body.keys() if k not in ("token",))
    try:
        with OUTBOUND_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} POST {path} {size}B {summary}\n")
    except Exception:  # noqa: BLE001
        pass
    return size


def api(method: str, path: str, **kw):
    url = f"{API_URL}{path}"
    if method.upper() == "POST" and "json" in kw:
        size = _log_outbound(path, kw["json"])
        if size > MAX_OUTBOUND_BYTES:
            raise ValueError(f"클라우드 전송 거부: payload {size}B > 상한 {MAX_OUTBOUND_BYTES}B (카탈로그 통째 전송 방지)")
    r = requests.request(method, url, timeout=30, **kw)
    r.raise_for_status()
    return r.json() if r.text else {}


def heartbeat():
    global QUERIES
    QUERIES = load_queries()
    try:
        cat = [{"id": k, "name": v["name"], "binds": v["binds"], "tables": v["tables"]} for k, v in QUERIES.items()]
        api("POST", "/api/kpi-bindings/agent/heartbeat", json={"token": TOKEN, "agent": AGENT, "version": VERSION, "host": socket.gethostname(), "queries": cat, "catalog": catalog_summary()})
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
    # 1) DISCOVER: 오라클 접속 없이 로컬 카탈로그 검색만
    sql_jobs = []
    for j in jobs:
        if j.get("kind") == "DISCOVER":
            try:
                t0 = time.time()
                hits = discover(j.get("params") or {})
                api("POST", "/api/kpi-bindings/agent/result", json={"token": TOKEN, "jobId": j["id"], "result": hits})
                log.info("DISCOVER %s 완료 화면 %d·테이블 %d (%.2fs)", j["id"], len(hits["screens"]), len(hits["tables"]), time.time() - t0)
            except Exception as e:  # noqa: BLE001
                log.error("DISCOVER %s 실패: %s", j["id"], e)
                try:
                    api("POST", "/api/kpi-bindings/agent/result", json={"token": TOKEN, "jobId": j["id"], "error": str(e)[:900]})
                except Exception:  # noqa: BLE001
                    pass
        else:
            sql_jobs.append(j)
    if not sql_jobs:
        return len(jobs)
    # 2) SYNC/PREVIEW: 등록 질의를 오라클에서 읽기 전용 실행
    conn = None
    try:
        conn = connect()
        for j in sql_jobs:
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
        for j in sql_jobs:
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


def write_query_file(qid: str, name: str, desc: str, binds: list, sql: str) -> Path:
    QUERY_DIR.mkdir(parents=True, exist_ok=True)
    f = QUERY_DIR / f"{qid}.sql"
    head = [f"-- name: {name}", f"-- desc: {desc}".replace("\n", " ")]
    # 머리말 binds = 제안이 적어 준 것 ∪ SQL 본문에 실제 쓰인 것 (추가 바인드 누락 방지)
    used = sorted({m.group(1) for m in re.finditer(r":([a-zA-Z_][a-zA-Z0-9_]*)", sql)})
    all_binds = list(dict.fromkeys([*(binds or []), *used]))
    if all_binds:
        head.append(f"-- binds: {', '.join(all_binds)}")
    f.write_text("\n".join(head) + "\n" + sql.strip() + "\n", encoding="utf-8")
    return f


def cmd_proposals(approve_id: str | None, auto_yes: bool = False):
    """클라우드의 승인 대기 제안을 보여주고, 사람이 y 를 눌러야 agent_queries 에 등록한다. 자동 실행 경로는 없다."""
    params = {"token": TOKEN, "agent": AGENT}
    if approve_id and approve_id != "all":
        params["id"] = approve_id
    items = api("GET", "/api/kpi-bindings/agent/proposals", params=params).get("items", [])
    if not items:
        print("승인 대기 제안이 없습니다.")
        return
    for p in items:
        print("=" * 78)
        print(f"제안 {p['id']}  ·  질의ID {p['queryId']}  ·  확신도 {p.get('confidence', 0)}")
        print(f"KPI: {(p.get('kpi') or {}).get('title', '-')} ({(p.get('kpi') or {}).get('unit', '')})")
        print(f"이름: {p['name']}")
        print(f"근거 화면: {p.get('screenRef') or '-'}")
        print(f"테이블: {', '.join(p.get('tables') or [])}  바인드: {', '.join(p.get('binds') or [])}  추가바인드: {p.get('extraBinds') or {}}")
        print(f"이유: {p.get('rationale') or '-'}")
        if p.get("caveats"):
            print(f"주의: {p['caveats']}")
        print("-" * 78)
        print(p["sql"])
        print("-" * 78)
        try:
            assert_read_only(p["sql"])
            guard = "통과"
        except ValueError as e:
            guard = f"실패 — {e}"
        print(f"가드·화이트리스트 검사: {guard}")
        if not approve_id:
            continue
        if guard != "통과":
            print("→ 가드를 통과하지 못해 등록할 수 없습니다. (ALLOWED_TABLES 확장은 .env 에서 직접)")
            continue
        qid = p["queryId"]
        if (QUERY_DIR / f"{qid}.sql").exists():
            print(f"→ 이미 {qid}.sql 이 있습니다. 덮어쓰려면 파일을 먼저 지우세요.")
            continue
        ans = "y" if auto_yes else input("이 질의를 등록할까요? (y=등록 / n=거절 / s=건너뜀) ").strip().lower()
        if ans == "y":
            f = write_query_file(qid, p["name"], f"{p.get('screenRef', '')} {p.get('rationale', '')}".strip(), p.get("binds") or [], p["sql"])
            api("POST", f"/api/kpi-bindings/agent/proposals/{p['id']}/registered", json={"token": TOKEN, "agent": AGENT, "queryId": qid, "host": socket.gethostname()})
            print(f"→ 등록 완료: {f}  (KPI 연결이 자동 생성되었습니다. 다음 작업 주기에 수집됩니다)")
        elif ans == "n":
            api("POST", f"/api/kpi-bindings/agent/proposals/{p['id']}/declined", json={"token": TOKEN, "agent": AGENT})
            print("→ 거절 처리")
        else:
            print("→ 건너뜀")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--loop", type=int, default=0, help="초 단위 폴링 간격")
    ap.add_argument("--proposals", action="store_true", help="승인 대기 제안 보기(등록 안 함)")
    ap.add_argument("--approve", metavar="ID|all", help="제안을 검토·승인해 agent_queries 에 등록 (사람이 y 입력)")
    ap.add_argument("--yes", action="store_true", help="--approve 시 확인 없이 등록 (가드 통과분만)")
    args = ap.parse_args()
    if not TOKEN:
        log.error("ORACLE_SYNC_TOKEN 이 .env에 없습니다")
        sys.exit(2)
    log.info("WorkWork 에이전트 v%s agent=%s api=%s dsn=%s", VERSION, AGENT, API_URL, ORA_DSN)
    if args.proposals or args.approve:
        cmd_proposals(args.approve, args.yes)
        heartbeat()  # 등록 질의 목록 갱신 보고
        return
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
