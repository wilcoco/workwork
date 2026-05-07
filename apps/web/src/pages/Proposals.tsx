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

export function Proposals() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResp | null>(null);
  const [slpNoInput, setSlpNoInput] = useState<string>('');

  useEffect(() => {
    // First load: no slpNo → backend hits the list page (/boss/mpu.aspx)
    // and returns the user's full proposal list.
    void fetchList('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchList(slpNo: string) {
    const trimmed = String(slpNo || '').trim();
    setLoading(true);
    setError(null);
    try {
      const qs = trimmed ? `?slpNo=${encodeURIComponent(trimmed)}` : '';
      const res = await apiJson<ListResp>(`/api/proposals/list${qs}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || '조회 실패');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const grids = data?.grids ? Object.values(data.grids) : [];
  const isDetail = Boolean(data?.slpNo);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>품의서</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        CAMS 회계 시스템(<code>cn.icams.co.kr</code>)에서 품의서를 조회합니다. 번호없이 조회하면 내 품의서 리스트가, <code>slp_no</code>를 넣으면 단일 품의서 상세가 나옵니다.
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
            placeholder="비워두면 리스트 조회"
            style={{ marginLeft: 8, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 10px', fontSize: 14, width: 200 }}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{ background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? '조회 중…' : '조회'}
        </button>
        {isDetail && (
          <button
            type="button"
            onClick={() => { setSlpNoInput(''); void fetchList(''); }}
            style={{ background: '#fff', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
          >
            ← 리스트로
          </button>
        )}
      </form>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
            {isDetail ? (
              <>슬립번호 <strong>{data.slpNo}</strong> · 그리드 <strong>{grids.length}</strong>개 · 행 합계 <strong>{data.count}</strong>건</>
            ) : (
              <>리스트 · <strong>{data.count}</strong>건</>
            )}
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
          ) : isDetail ? (
            <ProposalDoc grids={grids} />
          ) : (
            <ListWithExpand grids={grids} />
          )}
        </>
      )}
    </div>
  );
}

/* ---------- List view with inline-expandable detail ---------- */

function ListWithExpand({ grids }: { grids: ParsedGrid[] }) {
  // Find the main list grid. On `/boss/mpu.aspx` it is `myDataGrid` and
  // its rows expose a `slpno` field we can use to fetch the detail page.
  const listGrid =
    grids.find((g) => g.fields.includes('slpno')) ||
    grids[0];
  if (!listGrid) return null;

  // Reorder columns so the most useful ones come first; drop noisy ones
  // we don't want in the row summary. Status/amount go to the right.
  const colOrder = ['slpno', 'date', 'title', 'sname', 'dname', 'amt', 'amount', 'status', 'state'];
  const cols = [
    ...colOrder.filter((c) => listGrid.fields.includes(c)),
    ...listGrid.fields.filter((c) => !colOrder.includes(c)),
  ];

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
              <th style={{ ...th, width: 32 }}></th>
              <th style={{ ...th, width: 40 }}>#</th>
              {cols.map((c) => (
                <th key={c} style={th}>{labelFor(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listGrid.rows.map((row, i) => (
              <ListRow key={row._index} row={row} cols={cols} index={i} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListRow({
  row,
  cols,
  index,
}: {
  row: GridRow;
  cols: string[];
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slpNo = String(row['slpno'] ?? '').trim();

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!slpNo || detail || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<ListResp>(`/api/proposals/list?slpNo=${encodeURIComponent(slpNo)}`);
      setDetail(res);
    } catch (e: any) {
      setError(e?.message || '조회 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr
        onClick={toggle}
        style={{ borderTop: '1px solid #e5e7eb', cursor: slpNo ? 'pointer' : 'default', background: open ? '#f8fafc' : undefined }}
      >
        <td style={{ ...td, width: 32, color: '#64748b', textAlign: 'center' }}>
          {slpNo ? (open ? '▾' : '▸') : ''}
        </td>
        <td style={{ ...td, color: '#94a3b8', width: 40 }}>{index + 1}</td>
        {cols.map((c) => (
          <td key={c} style={td}>{String(row[c] ?? '')}</td>
        ))}
      </tr>
      {open && (
        <tr style={{ background: '#f8fafc', borderTop: '1px solid #e5e7eb' }}>
          <td colSpan={cols.length + 2} style={{ padding: 16 }}>
            {loading && <div style={{ fontSize: 13, color: '#64748b' }}>조회 중…</div>}
            {error && (
              <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10 }}>
                {error}
              </div>
            )}
            {detail && <ProposalDoc grids={Object.values(detail.grids || {})} fallbackHeader={row} />}
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------- Single proposal rendered as a document ---------- */

/**
 * Render the four DataGrids of a single proposal as a typical Korean
 * approval document: header (title / slpno / amount / status), a
 * 2-column property sheet for the main info, and small tables for
 * attachments, bidders, and the approval line.
 */
function ProposalDoc({
  grids,
  fallbackHeader,
}: {
  grids: ParsedGrid[];
  /** Row from the parent list, used to fill in title/amount when the
   *  detail page doesn't repeat them. */
  fallbackHeader?: GridRow;
}) {
  const main = grids.find((g) => sectionLabelFor(g.id, g.fields) === '품의 정보') || grids[0];
  const files = grids.find((g) => sectionLabelFor(g.id, g.fields) === '첨부파일');
  const bidders = grids.find((g) => sectionLabelFor(g.id, g.fields) === '입찰업체');
  const approvers = grids.find((g) => sectionLabelFor(g.id, g.fields) === '결재선');
  const others = grids.filter((g) => g !== main && g !== files && g !== bidders && g !== approvers);

  const mainRow: Record<string, any> = (main?.rows?.[0] as any) || {};
  const get = (k: string) => String(mainRow[k] ?? fallbackHeader?.[k] ?? '').trim();
  const title = get('title') || get('purpose') || '제목 없음';
  const slpNo = get('slpno') || get('no');
  const date = get('date');
  const amount = get('amount') || get('amt');
  const status = get('status') || get('state');
  const author = get('sname') || get('user') || get('name');
  const dept = get('dname') || get('dept');

  return (
    <article style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
      {/* Document header */}
      <header style={{ borderBottom: '2px solid #0F3D73', paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 1, marginBottom: 4 }}>품 의 서</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{title}</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#475569', marginTop: 6 }}>
          {slpNo && <span><b>품의번호</b> {slpNo}</span>}
          {date && <span><b>기안일자</b> {date}</span>}
          {author && <span><b>기안자</b> {author}{dept ? ` (${dept})` : ''}</span>}
          {status && <span style={{ marginLeft: 'auto' }}><Badge>{status}</Badge></span>}
        </div>
      </header>

      {/* Property sheet for the main info grid */}
      {main && main.rows.length > 0 && (
        <PropertySheet grid={main} skipFields={new Set(['title', 'purpose', 'slpno', 'no', 'date', 'sname', 'dname', 'status', 'state', 'user', 'name', 'dept'])} highlight={{ amount: amount, amt: amount }} />
      )}

      {/* Approval line */}
      {approvers && approvers.rows.length > 0 && (
        <DocSection title="결재선" gridId={approvers.id} count={approvers.rows.length}>
          <CompactTable grid={approvers} />
        </DocSection>
      )}

      {/* Bidders */}
      {bidders && bidders.rows.length > 0 && (
        <DocSection title="입찰업체" gridId={bidders.id} count={bidders.rows.length}>
          <CompactTable grid={bidders} />
        </DocSection>
      )}

      {/* Attachments */}
      {files && files.rows.length > 0 && (
        <DocSection title="첨부파일" gridId={files.id} count={files.rows.length}>
          <CompactTable grid={files} />
        </DocSection>
      )}

      {/* Anything we couldn't classify still gets shown so no data is hidden. */}
      {others.map((g) => (
        <DocSection key={g.id} title={sectionLabelFor(g.id, g.fields)} gridId={g.id} count={g.rows.length}>
          <CompactTable grid={g} />
        </DocSection>
      ))}
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', background: '#EEF2FF', color: '#3730A3', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
      {children}
    </span>
  );
}

function PropertySheet({
  grid,
  skipFields,
  highlight,
}: {
  grid: ParsedGrid;
  skipFields?: Set<string>;
  /** Fields to render with emphasized styling (e.g. amount). */
  highlight?: Record<string, string | undefined>;
}) {
  const row = grid.rows[0] || {};
  const entries = grid.fields
    .filter((f) => !(skipFields && skipFields.has(f)))
    .map((f) => [f, String((row as any)[f] ?? '').trim()] as const)
    .filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {entries.map(([f, v], i) => {
            const isHighlight = highlight && Object.prototype.hasOwnProperty.call(highlight, f);
            return (
              <tr key={f} style={{ borderTop: i === 0 ? 'none' : '1px solid #e5e7eb' }}>
                <th style={{ background: '#f8fafc', padding: '10px 12px', width: 140, textAlign: 'left', color: '#475569', fontSize: 12, fontWeight: 700, verticalAlign: 'top' }}>
                  {labelFor(f)}
                </th>
                <td style={{ padding: '10px 12px', color: isHighlight ? '#0f172a' : '#1e293b', fontWeight: isHighlight ? 700 : 400, whiteSpace: 'pre-wrap' }}>
                  {v}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocSection({
  title,
  gridId,
  count,
  children,
}: {
  title: string;
  gridId: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: 0 }}>{title}</h3>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>({count})</span>
        <span style={{ fontSize: 10, color: '#cbd5e1', marginLeft: 'auto', fontFamily: 'monospace' }}>{gridId}</span>
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>{children}</div>
    </section>
  );
}

function CompactTable({ grid }: { grid: ParsedGrid }) {
  return (
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
  // List page: `myDataGrid` (no trailing digit) is the only multi-row list
  // grid. We must match it exactly here so the detail page's main info
  // grid (e.g. `myDataGrid2`) is NOT misclassified as the list — it
  // happens to share the `sname/dname/status` field names.
  if (id === 'myDataGrid') return '내 품의서';
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
    // List page (myDataGrid)
    sname: '기안자',
    dname: '부서',
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
