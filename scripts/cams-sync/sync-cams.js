#!/usr/bin/env node
/**
 * CAMS 품의서/전표 동기화 스크립트
 *
 * 사내 서버에서 실행하여 CAMS 데이터를 Railway API로 푸시합니다.
 *
 * 사용법:
 *   node sync-cams.js
 *
 * 환경변수:
 *   CAMS_BASE_URL     - CAMS 서버 URL (기본: http://cn.icams.co.kr)
 *   WORKWORK_API_URL  - WorkWork API URL (예: https://api.workwork.kr)
 *   CAMS_SYNC_API_KEY - 동기화 API 키
 *
 * 매일 아침 cron으로 실행:
 *   0 7 * * * /usr/bin/node /path/to/sync-cams.js >> /var/log/cams-sync.log 2>&1
 */

const CAMS_BASE_URL = process.env.CAMS_BASE_URL || 'http://cn.icams.co.kr';
const WORKWORK_API_URL = process.env.WORKWORK_API_URL || 'https://api.workwork.kr';
const CAMS_SYNC_API_KEY = process.env.CAMS_SYNC_API_KEY;

if (!CAMS_SYNC_API_KEY) {
  console.error('ERROR: CAMS_SYNC_API_KEY 환경변수가 필요합니다');
  process.exit(1);
}

// EUC-KR 디코딩을 위한 iconv-lite (필요시 설치: npm install iconv-lite)
let iconv;
try {
  iconv = require('iconv-lite');
} catch (e) {
  console.warn('WARN: iconv-lite 없음, UTF-8로만 디코딩합니다. EUC-KR 페이지는 깨질 수 있습니다.');
  console.warn('      npm install iconv-lite 로 설치하세요.');
}

/**
 * CAMS 페이지를 가져와서 HTML 문자열로 반환
 */
async function fetchCamsHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  // EUC-KR 디코딩 시도
  if (iconv) {
    const head = buf.slice(0, 1024).toString('ascii');
    const isEucKr = /charset\s*=\s*["']?(euc-kr|ks_c_5601)/i.test(head);
    if (isEucKr) {
      return iconv.decode(buf, 'euc-kr');
    }
  }

  return buf.toString('utf8');
}

/**
 * HTML에서 DataGrid span 파싱
 * <span id="gridId_lblFIELD_N">value</span> 형태
 */
function parseGrids(html) {
  const re = /<span[^>]*\bid=["']?([A-Za-z0-9]+?)_lbl([A-Za-z]+)_?(\d+)["']?[^>]*>([\s\S]*?)<\/span>/gi;
  const byGrid = {};
  let m;

  while ((m = re.exec(html)) !== null) {
    const gridId = m[1];
    const field = m[2].toLowerCase();
    const idx = Number(m[3]);
    const innerHtml = m[4];
    const text = stripTags(innerHtml).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();

    if (!byGrid[gridId]) byGrid[gridId] = { fieldOrder: [], rows: {} };
    const g = byGrid[gridId];
    if (!g.fieldOrder.includes(field)) g.fieldOrder.push(field);
    if (!g.rows[idx]) g.rows[idx] = {};
    g.rows[idx][field] = text;
  }

  const out = {};
  for (const [gridId, g] of Object.entries(byGrid)) {
    const indices = Object.keys(g.rows).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    const rows = indices.map(idx => ({ _index: idx, ...g.rows[idx] }));
    out[gridId] = { id: gridId, fields: g.fieldOrder, rows };
  }
  return out;
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

/**
 * 품의서 목록 페이지에서 품의번호 목록 추출
 */
async function fetchProposalList() {
  const url = `${CAMS_BASE_URL}/boss/mpu.aspx`;
  console.log(`[품의서] 목록 조회: ${url}`);

  const html = await fetchCamsHtml(url);
  const grids = parseGrids(html);
  const mainGrid = grids['myDataGrid'];

  if (!mainGrid || !mainGrid.rows.length) {
    console.log('[품의서] 목록이 비어있습니다');
    return [];
  }

  // slpno 필드에서 품의번호 추출
  const slpNos = mainGrid.rows
    .map(row => row.slpno)
    .filter(Boolean);

  console.log(`[품의서] ${slpNos.length}건 발견`);
  return slpNos;
}

/**
 * 품의서 상세 페이지에서 데이터 추출
 */
async function fetchProposalDetail(slpNo) {
  const url = `${CAMS_BASE_URL}/acco/mpu_list2.aspx?slp_no=${encodeURIComponent(slpNo)}`;
  console.log(`[품의서] 상세 조회: ${slpNo}`);

  const html = await fetchCamsHtml(url);
  const grids = parseGrids(html);

  // myDataGrid = 메인 정보, myDataGrid2 = 첨부파일
  const mainGrid = grids['myDataGrid'];
  const fileGrid = grids['myDataGrid2'];

  if (!mainGrid || !mainGrid.rows.length) {
    console.log(`[품의서] ${slpNo}: 상세 정보 없음`);
    return null;
  }

  const row = mainGrid.rows[0];

  // 첨부파일 처리
  const attachments = [];
  if (fileGrid && fileGrid.rows.length > 0) {
    for (let i = 0; i < fileGrid.rows.length; i++) {
      const fileRow = fileGrid.rows[i];
      const seq = i + 1;
      const filename = fileRow.title || `파일${seq}`;
      const downloadUrl = `${CAMS_BASE_URL}/acco/mpu_list2.aspx?slp_no=${encodeURIComponent(slpNo)}&sort=${seq}`;
      attachments.push({ seq, filename, downloadUrl });
    }
  }

  return {
    slpNo: row.slpno || slpNo,
    title: row.title || '',
    purpose: row.aim || '',
    drafter: row.bscname || '',
    draftDate: row.pymd || '',
    dueDate: row.wymd || '',
    amount: row.samt || '',
    paymentTerm: row.gjo || '',
    vendor: '', // 여러 필드에 흩어져 있을 수 있음
    content: row.gjo || '', // 내용이 gjo에 있는 경우
    attachments,
  };
}

/**
 * 전표 목록 페이지에서 전표번호 목록 추출
 */
async function fetchVoucherList() {
  const url = `${CAMS_BASE_URL}/boss/macco.aspx`;
  console.log(`[전표] 목록 조회: ${url}`);

  const html = await fetchCamsHtml(url);
  const grids = parseGrids(html);
  const mainGrid = grids['myDataGrid'];

  if (!mainGrid || !mainGrid.rows.length) {
    console.log('[전표] 목록이 비어있습니다');
    return [];
  }

  const slpNos = mainGrid.rows
    .map(row => row.slpno)
    .filter(Boolean);

  console.log(`[전표] ${slpNos.length}건 발견`);
  return slpNos;
}

/**
 * 전표 상세 페이지에서 데이터 추출
 */
async function fetchVoucherDetail(slpNo) {
  const url = `${CAMS_BASE_URL}/acco/macco_list.aspx?slp_no=${encodeURIComponent(slpNo)}`;
  console.log(`[전표] 상세 조회: ${slpNo}`);

  const html = await fetchCamsHtml(url);
  const grids = parseGrids(html);

  const mainGrid = grids['myDataGrid'] || grids['myDataGrid2'];

  if (!mainGrid || !mainGrid.rows.length) {
    console.log(`[전표] ${slpNo}: 상세 정보 없음`);
    return null;
  }

  const row = mainGrid.rows[0];

  return {
    slpNo: row.slpno || slpNo,
    title: row.aspnote || row.title || '',
    drafter: row.sname || '',
    draftDate: row.pymd || '',
    amount: row.amt || '',
    status: row.status || '',
    txType: row.txtype || '',
    content: '',
    attachments: [], // 전표는 첨부파일 구조가 다를 수 있음
  };
}

/**
 * WorkWork API로 데이터 푸시
 */
async function pushToWorkWork(type, items) {
  const url = `${WORKWORK_API_URL}/api/cams/sync`;
  console.log(`[푸시] ${type} ${items.length}건 → ${url}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CAMS-API-KEY': CAMS_SYNC_API_KEY,
    },
    body: JSON.stringify({ type, items }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`푸시 실패: HTTP ${res.status} - ${text}`);
  }

  const result = await res.json();
  console.log(`[푸시] 결과:`, result);
  return result;
}

/**
 * 메인 동기화 실행
 */
async function main() {
  console.log('========================================');
  console.log(`CAMS 동기화 시작: ${new Date().toISOString()}`);
  console.log(`CAMS: ${CAMS_BASE_URL}`);
  console.log(`API: ${WORKWORK_API_URL}`);
  console.log('========================================');

  try {
    // 품의서 동기화
    const proposalSlpNos = await fetchProposalList();
    const proposals = [];

    for (const slpNo of proposalSlpNos) {
      try {
        const detail = await fetchProposalDetail(slpNo);
        if (detail) proposals.push(detail);
        // 요청 간 딜레이 (CAMS 서버 부하 방지)
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`[품의서] ${slpNo} 조회 실패:`, e.message);
      }
    }

    if (proposals.length > 0) {
      await pushToWorkWork('proposals', proposals);
    }

    // 전표 동기화
    const voucherSlpNos = await fetchVoucherList();
    const vouchers = [];

    for (const slpNo of voucherSlpNos) {
      try {
        const detail = await fetchVoucherDetail(slpNo);
        if (detail) vouchers.push(detail);
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`[전표] ${slpNo} 조회 실패:`, e.message);
      }
    }

    if (vouchers.length > 0) {
      await pushToWorkWork('vouchers', vouchers);
    }

    console.log('========================================');
    console.log(`동기화 완료: 품의서 ${proposals.length}건, 전표 ${vouchers.length}건`);
    console.log('========================================');

  } catch (e) {
    console.error('동기화 실패:', e);
    process.exit(1);
  }
}

main();
