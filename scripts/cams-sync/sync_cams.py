#!/usr/bin/env python3
"""
CAMS 품의서/전표 동기화 스크립트 (Python)

사내 PC에서 실행하여 CAMS 데이터를 WorkWork API로 푸시합니다.

사용법:
    python sync_cams.py

환경변수 또는 아래 설정값 직접 수정:
    CAMS_BASE_URL     - CAMS 서버 URL
    WORKWORK_API_URL  - WorkWork API URL
    CAMS_SYNC_API_KEY - 동기화 API 키
"""

import os
import re
import time
import requests
from datetime import datetime

# ============================================================
# 설정 (환경변수 또는 직접 입력)
# ============================================================
CAMS_BASE_URL = os.getenv('CAMS_BASE_URL', 'http://cn.icams.co.kr')
WORKWORK_API_URL = os.getenv('WORKWORK_API_URL', 'https://api.workwork.kr')
CAMS_SYNC_API_KEY = os.getenv('CAMS_SYNC_API_KEY', '여기에_API_키_입력')

# ============================================================
# HTML 파싱 함수
# ============================================================

def fetch_cams_html(url: str) -> str:
    """CAMS 페이지를 가져와서 HTML 문자열로 반환"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    }

    res = requests.get(url, headers=headers, timeout=30)
    res.raise_for_status()

    # EUC-KR 디코딩 시도
    content_type = res.headers.get('content-type', '')
    if 'euc-kr' in content_type.lower() or 'ks_c_5601' in content_type.lower():
        res.encoding = 'euc-kr'
    else:
        # HTML 내 charset 확인
        if b'euc-kr' in res.content[:1024].lower() or b'ks_c_5601' in res.content[:1024].lower():
            res.encoding = 'euc-kr'

    return res.text


def strip_tags(html: str) -> str:
    """HTML 태그 제거"""
    return re.sub(r'<[^>]+>', '', html or '')


def decode_entities(text: str) -> str:
    """HTML 엔티티 디코딩"""
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    return text


def parse_grids(html: str) -> dict:
    """
    HTML에서 DataGrid span 파싱
    <span id="gridId_lblFIELD_N">value</span> 형태
    """
    pattern = r'<span[^>]*\bid=["\']?([A-Za-z0-9]+?)_lbl([A-Za-z]+)_?(\d+)["\']?[^>]*>([\s\S]*?)</span>'

    by_grid = {}

    for match in re.finditer(pattern, html, re.IGNORECASE):
        grid_id = match.group(1)
        field = match.group(2).lower()
        idx = int(match.group(3))
        inner_html = match.group(4)
        text = decode_entities(strip_tags(inner_html)).strip()

        if grid_id not in by_grid:
            by_grid[grid_id] = {'field_order': [], 'rows': {}}

        g = by_grid[grid_id]
        if field not in g['field_order']:
            g['field_order'].append(field)
        if idx not in g['rows']:
            g['rows'][idx] = {}
        g['rows'][idx][field] = text

    result = {}
    for grid_id, g in by_grid.items():
        indices = sorted([i for i in g['rows'].keys() if isinstance(i, int)])
        rows = [{'_index': idx, **g['rows'][idx]} for idx in indices]
        result[grid_id] = {
            'id': grid_id,
            'fields': g['field_order'],
            'rows': rows
        }

    return result


# ============================================================
# 품의서 처리
# ============================================================

def fetch_proposal_list() -> list:
    """품의서 목록 페이지에서 품의번호 목록 추출"""
    url = f"{CAMS_BASE_URL}/boss/mpu.aspx"
    print(f"[품의서] 목록 조회: {url}")

    html = fetch_cams_html(url)
    grids = parse_grids(html)
    main_grid = grids.get('myDataGrid')

    if not main_grid or not main_grid['rows']:
        print("[품의서] 목록이 비어있습니다")
        return []

    slp_nos = [row.get('slpno') for row in main_grid['rows'] if row.get('slpno')]
    print(f"[품의서] {len(slp_nos)}건 발견")
    return slp_nos


def fetch_proposal_detail(slp_no: str) -> dict:
    """품의서 상세 페이지에서 데이터 추출"""
    url = f"{CAMS_BASE_URL}/acco/mpu_list2.aspx?slp_no={slp_no}"
    print(f"[품의서] 상세 조회: {slp_no}")

    html = fetch_cams_html(url)
    grids = parse_grids(html)

    main_grid = grids.get('myDataGrid')
    file_grid = grids.get('myDataGrid2')

    if not main_grid or not main_grid['rows']:
        print(f"[품의서] {slp_no}: 상세 정보 없음")
        return None

    row = main_grid['rows'][0]

    # 첨부파일 처리
    attachments = []
    if file_grid and file_grid['rows']:
        for i, file_row in enumerate(file_grid['rows']):
            seq = i + 1
            filename = file_row.get('title', f'파일{seq}')
            download_url = f"{CAMS_BASE_URL}/acco/mpu_list2.aspx?slp_no={slp_no}&sort={seq}"
            attachments.append({
                'seq': seq,
                'filename': filename,
                'downloadUrl': download_url
            })

    return {
        'slpNo': row.get('slpno', slp_no),
        'title': row.get('title', ''),
        'purpose': row.get('aim', ''),
        'drafter': row.get('bscname', ''),
        'draftDate': row.get('pymd', ''),
        'dueDate': row.get('wymd', ''),
        'amount': row.get('samt', ''),
        'paymentTerm': row.get('gjo', ''),
        'vendor': '',
        'content': row.get('gjo', ''),
        'attachments': attachments
    }


# ============================================================
# 전표 처리
# ============================================================

def fetch_voucher_list() -> list:
    """전표 목록 페이지에서 전표번호 목록 추출"""
    url = f"{CAMS_BASE_URL}/boss/macco.aspx"
    print(f"[전표] 목록 조회: {url}")

    html = fetch_cams_html(url)
    grids = parse_grids(html)
    main_grid = grids.get('myDataGrid')

    if not main_grid or not main_grid['rows']:
        print("[전표] 목록이 비어있습니다")
        return []

    slp_nos = [row.get('slpno') for row in main_grid['rows'] if row.get('slpno')]
    print(f"[전표] {len(slp_nos)}건 발견")
    return slp_nos


def fetch_voucher_detail(slp_no: str) -> dict:
    """전표 상세 페이지에서 데이터 추출"""
    url = f"{CAMS_BASE_URL}/acco/macco_list.aspx?slp_no={slp_no}"
    print(f"[전표] 상세 조회: {slp_no}")

    html = fetch_cams_html(url)
    grids = parse_grids(html)

    main_grid = grids.get('myDataGrid') or grids.get('myDataGrid2')

    if not main_grid or not main_grid['rows']:
        print(f"[전표] {slp_no}: 상세 정보 없음")
        return None

    row = main_grid['rows'][0]

    return {
        'slpNo': row.get('slpno', slp_no),
        'title': row.get('aspnote', '') or row.get('title', ''),
        'drafter': row.get('sname', ''),
        'draftDate': row.get('pymd', ''),
        'amount': row.get('amt', ''),
        'status': row.get('status', ''),
        'txType': row.get('txtype', ''),
        'content': '',
        'attachments': []
    }


# ============================================================
# API 푸시
# ============================================================

def push_to_workwork(data_type: str, items: list) -> dict:
    """WorkWork API로 데이터 푸시"""
    url = f"{WORKWORK_API_URL}/api/cams/sync"
    print(f"[푸시] {data_type} {len(items)}건 → {url}")

    headers = {
        'Content-Type': 'application/json',
        'X-CAMS-API-KEY': CAMS_SYNC_API_KEY
    }

    payload = {
        'type': data_type,
        'items': items
    }

    res = requests.post(url, json=payload, headers=headers, timeout=60)

    if not res.ok:
        raise Exception(f"푸시 실패: HTTP {res.status_code} - {res.text}")

    result = res.json()
    print(f"[푸시] 결과: {result}")
    return result


# ============================================================
# 메인
# ============================================================

def main():
    print("=" * 50)
    print(f"CAMS 동기화 시작: {datetime.now().isoformat()}")
    print(f"CAMS: {CAMS_BASE_URL}")
    print(f"API: {WORKWORK_API_URL}")
    print("=" * 50)

    if CAMS_SYNC_API_KEY == '여기에_API_키_입력':
        print("ERROR: CAMS_SYNC_API_KEY를 설정해주세요!")
        return

    try:
        # 품의서 동기화
        proposal_slp_nos = fetch_proposal_list()
        proposals = []

        for slp_no in proposal_slp_nos:
            try:
                detail = fetch_proposal_detail(slp_no)
                if detail:
                    proposals.append(detail)
                time.sleep(0.5)  # 요청 간 딜레이
            except Exception as e:
                print(f"[품의서] {slp_no} 조회 실패: {e}")

        if proposals:
            push_to_workwork('proposals', proposals)

        # 전표 동기화
        voucher_slp_nos = fetch_voucher_list()
        vouchers = []

        for slp_no in voucher_slp_nos:
            try:
                detail = fetch_voucher_detail(slp_no)
                if detail:
                    vouchers.append(detail)
                time.sleep(0.5)
            except Exception as e:
                print(f"[전표] {slp_no} 조회 실패: {e}")

        if vouchers:
            push_to_workwork('vouchers', vouchers)

        print("=" * 50)
        print(f"동기화 완료: 품의서 {len(proposals)}건, 전표 {len(vouchers)}건")
        print("=" * 50)

    except Exception as e:
        print(f"동기화 실패: {e}")
        raise


if __name__ == '__main__':
    main()
