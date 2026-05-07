import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

interface GridRow {
  _index: number;
  [key: string]: string | number | undefined;
}

interface ParsedGrid {
  id: string;
  fields: string[];
  rows: GridRow[];
}

interface ListDiagnostics {
  htmlLength: number;
  lblIdsFoundSample: string[];
  idSample?: string[];
  classSample?: string[];
  looksLikeLogin: boolean;
  looksLikeError: boolean;
  bodyTextSnippet: string;
  htmlSnippet?: string;
  hint: string;
}

interface ListResp {
  slpNo: string;
  sourceUrl: string;
  grids: Record<string, ParsedGrid>;
  count: number;
  // Flat list across all grids (legacy). Each row is tagged with `_grid`.
  items: Array<{ _grid: string; _index: number; [k: string]: string | number | undefined }>;
  diagnostics?: ListDiagnostics;
}

// Default `slp_no` to load when the page first opens. The user can change
// this in the input field on the page.
const DEFAULT_SLP_NO = '103485';

export function Proposals() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResp | null>(null);
  const [slpNoInput, setSlpNoInput] = useState<string>(DEFAULT_SLP_NO);

  useEffect(() => {
    void fetchList(DEFAULT_SLP_NO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchList(slpNo: string) {
    const trimmed = String(slpNo || '').trim();
    if (!trimmed) {
      setError('품의서 번호(slp_no)를 입력하세요.');
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<ListResp>(`/api/proposals/list?slpNo=${encodeURIComponent(trimmed)}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || '조회 실패');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const grids = data?.grids ? Object.values(data.grids) : [];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>품의서</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        CAMS 회계 시스템(<code>cn.icams.co.kr</code>)에서 단일 품의서 상세를 조회합니다. <code>slp_no</code>는 품의 번호입니다.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); void fetchList(slpNoInput); }}
        style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <label style={{ fontSize: 13, color: '#475569' }}>
          slp_no
          <input
            value={slpNoInput}
            onChange={(e) => setSlpNoInput(e.target.value)}
            placeholder="예: 103485"
            style={{ marginLeft: 8, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 10px', fontSize: 14, width: 140 }}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{ background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? '조회 중…' : '조회'}
        </button>
      </form>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
            슬립번호 <strong>{data.slpNo}</strong> · 그리드 <strong>{grids.length}</strong>개 · 행 합계 <strong>{data.count}</strong>건
            {data.sourceUrl && (
              <> · <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8' }}>원본 페이지 열기 ↗</a></>
            )}
          </div>

          {data.count === 0 ? (
            <div style={{ padding: 16, fontSize: 13, border: '1px dashed #cbd5e1', borderRadius: 12, color: '#475569', display: 'grid', gap: 10 }}>
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>조회된 품의서가 없습니다.</div>
              {data.diagnostics && (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700, color: '#334155' }}>업스트림 진단</div>
                  <div><b>원인 추정:</b> {data.diagnostics.hint}</div>
                  <div><b>HTML 크기:</b> {data.diagnostics.htmlLength.toLocaleString()} 바이트</div>
                  <div><b>로그인 페이지 감지:</b> {data.diagnostics.looksLikeLogin ? '예' : '아니오'}</div>
                  <div><b>에러 페이지 감지:</b> {data.diagnostics.looksLikeError ? '예' : '아니오'}</div>
                  {data.diagnostics.lblIdsFoundSample.length > 0 && (
                    <div>
                      <b>발견된 lbl span id 샘플:</b>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', marginTop: 4, wordBreak: 'break-all' }}>
                        {data.diagnostics.lblIdsFoundSample.join(', ')}
                      </div>
                    </div>
                  )}
                  {data.diagnostics.bodyTextSnippet && (
                    <div>
                      <b>응답 본문 발췌:</b>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                        {data.diagnostics.bodyTextSnippet}
                      </div>
                    </div>
                  )}
                  {(data.diagnostics.idSample?.length || data.diagnostics.classSample?.length) ? (
                    <details>
                      <summary style={{ cursor: 'pointer', color: '#1d4ed8' }}>구조 ID/Class 샘플</summary>
                      {data.diagnostics.idSample?.length ? (
                        <div style={{ marginTop: 6 }}>
                          <b>id 샘플:</b>
                          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                            {data.diagnostics.idSample.join(' | ')}
                          </div>
                        </div>
                      ) : null}
                      {data.diagnostics.classSample?.length ? (
                        <div style={{ marginTop: 6 }}>
                          <b>class 샘플:</b>
                          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                            {data.diagnostics.classSample.join(' | ')}
                          </div>
                        </div>
                      ) : null}
                    </details>
                  ) : null}
                  {data.diagnostics.htmlSnippet && (
                    <details>
                      <summary style={{ cursor: 'pointer', color: '#1d4ed8' }}>원시 HTML 발췌 (앞 4000자)</summary>
                      <pre style={{ fontFamily: 'monospace', fontSize: 11, color: '#334155', background: '#0f172a0a', padding: 8, borderRadius: 6, marginTop: 6, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                        {data.diagnostics.htmlSnippet}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {grids.map((g) => (
                <GridSection key={g.id} grid={g} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GridSection({ grid }: { grid: ParsedGrid }) {
  const sectionLabel = sectionLabelFor(grid.id, grid.fields);
  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      <header style={{ background: '#f8fafc', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 14 }}>{sectionLabel}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{grid.id} · {grid.rows.length}행</div>
      </header>
      {grid.rows.length === 0 ? (
        <div style={{ padding: 14, fontSize: 13, color: '#94a3b8' }}>행 없음</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                <th style={th}>#</th>
                {grid.fields.map((c) => (
                  <th key={c} style={th}>{labelFor(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, i) => (
                <tr key={row._index} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ ...td, color: '#94a3b8', width: 40 }}>{i + 1}</td>
                  {grid.fields.map((c) => (
                    <td key={c} style={td}>{String(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Best-effort label for a DataGrid based on its id and the fields it
 * exposes. The grid ids on the upstream page are not stable enough to
 * hard-code, so we fall back to a heuristic: file-related fields look
 * like a file grid, bidder-related ones like a bidder grid, etc.
 */
function sectionLabelFor(id: string, fields: string[]): string {
  const fset = new Set(fields.map((f) => f.toLowerCase()));
  if (fset.has('approvalstatus') || fset.has('approvalorder') || fset.has('empno') || fset.has('signorder')) return '결재선';
  if (fset.has('bidamount') || fset.has('bidamt') || fset.has('biddername')) return '입찰업체';
  if (fset.has('filename') || fset.has('imgsort') || fset.has('sort')) return '첨부파일';
  if (fset.has('title') || fset.has('purpose') || fset.has('amount') || fset.has('amt')) return '품의 정보';
  return id;
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 12, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', color: '#1e293b', verticalAlign: 'top' };

function labelFor(field: string): string {
  // Map common upstream field codes to Korean labels. Unknown fields fall
  // through to the raw key so we don't hide data.
  const map: Record<string, string> = {
    // Main info
    title: '제목',
    purpose: '목적',
    no: '품의번호',
    slpno: '품의번호',
    date: '기안일자',
    duedate: '완료예정일',
    amount: '소요금액',
    amt: '소요금액',
    payterm: '지급조건',
    company: '관련업체',
    contents: '내용',
    content: '내용',
    user: '기안자',
    name: '기안자',
    state: '상태',
    status: '상태',
    dept: '부서',
    imgsort: 'imgsort',
    final: '전결',
    // Files
    filename: '파일명',
    sort: 'SORT',
    // Bidders
    biddername: '업체명',
    bidamount: '입찰금액',
    bidamt: '입찰금액',
    // Approvers
    empno: '사번',
    approvalorder: '결재순서',
    signorder: '결재순서',
    position: '직책',
    empname: '사원명',
    approvalstatus: '결재상태',
    signstatus: '결재상태',
    opinion: '결재의견',
    comment: '결재의견',
  };
  return map[field] || field;
}
