import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/** Context: the active page's `field code -> Korean label` resolver. */
const LabelContext = createContext<(field: string) => string>((f) => defaultLabelFor(f));
const useLabelFor = () => useContext(LabelContext);

/**
 * Generic browser for CAMS document pages (proposals, vouchers, ...).
 * The two CAMS document families share the same DataGrid mechanics, so
 * one component drives both — only the API path and a few display
 * strings differ.
 *
 * The component lists the user's documents on first load (backend hits
 * the upstream list page) and inline-expands each row into a single
 * "document" view (header + property sheet + sub-grids) when clicked.
 */
export interface CamsBrowserConfig {
  /** REST base under the API host, without trailing slash. e.g. `/api/proposals`. */
  apiPath: string;
  /** Page H2, e.g. `품의서`. */
  pageTitle: string;
  /** Document header label rendered in spaced caps, e.g. `품 의 서`. */
  docHeading: string;
  /** Word used for the empty-state message, e.g. `품의서`. */
  docNoun: string;
  /** Section label heuristic for the list grid (id === 'myDataGrid'). */
  listLabel: string;
  /**
   * Per-page label overrides applied on top of the shared default map.
   * The same upstream field code can mean different things on different
   * pages — e.g. `slpno` = 품의번호 on proposals but 전표번호 on vouchers.
   */
  labelOverrides?: Record<string, string>;
  /**
   * Document layout style. `proposal` renders a traditional Korean
   * 품의서 form (centered title, top-right 결재란, label-left field
   * tables). `voucher` renders a centered 전표 layout with a strictly
   * symmetric 차변/대변 ledger. Defaults to the generic property-sheet
   * layout used before this option existed.
   */
  format?: 'proposal' | 'voucher' | 'default';
}

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

interface Attachment {
  seq: number;
  filename: string;
  sortValue: string;
  slpNo: string;
}

interface ListResp {
  slpNo: string;
  sourceUrl: string;
  grids: Record<string, ParsedGrid>;
  count: number;
  items: Array<{ _grid: string; _index: number; [k: string]: string | number | undefined }>;
  attachments?: Attachment[];
  diagnostics?: ListDiagnostics;
}

export function CamsBrowser({ config }: { config: CamsBrowserConfig }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResp | null>(null);
  const [slpNoInput, setSlpNoInput] = useState<string>('');
  // Client-side filter applied to the already-fetched list. CAMS
  // upstream returns the page-sized batch as-is, so any further
  // narrowing has to happen here.
  const [filterText, setFilterText] = useState<string>('');
  const [userId] = useState(() => typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '');

  useEffect(() => {
    if (userId) void fetchList('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiPath, userId]);

  async function fetchList(slpNo: string) {
    const trimmed = String(slpNo || '').trim();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (trimmed) params.set('slpNo', trimmed);
      if (userId) params.set('actorId', userId);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiJson<ListResp>(`${config.apiPath}/list${qs}`);
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

  // Per-page label resolver (default map + optional config overrides).
  const labelFor = useMemo(() => {
    const overrides = config.labelOverrides;
    if (!overrides || Object.keys(overrides).length === 0) return defaultLabelFor;
    return (f: string) => overrides[f] ?? defaultLabelFor(f);
  }, [config.labelOverrides]);

  return (
    <LabelContext.Provider value={labelFor}>
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{config.pageTitle}</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        CAMS 회계 시스템(<code>cn.icams.co.kr</code>)에서 {config.docNoun}를 조회합니다. 번호없이 조회하면 내 {config.docNoun} 리스트가, <code>slp_no</code>를 넣으면 단일 {config.docNoun} 상세가 나옵니다. 리스트는 업스트림이 반환하는 만큼 한 번에 보여주며, 제목/이름/번호로 화면 내 검색이 가능합니다.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); void fetchList(slpNoInput); }}
        style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}
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

      {!isDetail && data && data.count > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="제목 / 이름 / 부서 / 번호로 화면 내 검색"
            style={{ flex: 1, minWidth: 240, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 10px', fontSize: 14 }}
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText('')}
              style={{ background: '#fff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}
            >
              지우기
            </button>
          )}
        </div>
      )}

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
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>조회된 {config.docNoun}가 없습니다.</div>
              {data.diagnostics && <DiagnosticsPanel d={data.diagnostics} />}
            </div>
          ) : isDetail ? (
            config.format === 'proposal' ? (
              <ProposalForm grids={grids} config={config} attachments={data?.attachments} />
            ) : config.format === 'voucher' ? (
              <VoucherForm grids={grids} config={config} />
            ) : (
              <Doc grids={grids} config={config} />
            )
          ) : (
            <ListWithExpand grids={grids} config={config} filterText={filterText} userId={userId} />
          )}
        </>
      )}
    </div>
    </LabelContext.Provider>
  );
}

/* ---------- List with inline-expandable detail ---------- */

function ListWithExpand({
  grids,
  config,
  filterText,
  userId,
}: {
  grids: ParsedGrid[];
  config: CamsBrowserConfig;
  filterText: string;
  userId: string;
}) {
  const labelFor = useLabelFor();
  // Single-open accordion: each row keeps its own `open` boolean,
  // and the parent assigns each row a stable `myKey`. When a row
  // opens itself, it calls `requestExclusiveOpen(myKey)` which causes
  // the parent to bump `closeSignal` and remember which key just
  // opened. Every other row sees the new signal and closes itself.
  // Declared above the early-return for stable hook order.
  const [closeSignal, setCloseSignal] = useState({ n: 0, owner: '' });

  const listGrid = grids.find((g) => g.fields.includes('slpno')) || grids[0];
  if (!listGrid) return null;

  // Reorder columns so the most useful ones come first.
  const colOrder = ['slpno', 'date', 'title', 'aspnote', 'sname', 'dname', 'amt', 'amount', 'status', 'state'];
  const cols = [
    ...colOrder.filter((c) => listGrid.fields.includes(c)),
    ...listGrid.fields.filter((c) => !colOrder.includes(c)),
  ];

  // Client-side filter: case-insensitive substring across every visible
  // cell so a user can search by title, drafter, dept or any free text.
  const q = filterText.trim().toLowerCase();
  const visibleRows = q
    ? listGrid.rows.filter((row) => cols.some((c) => String(row[c] ?? '').toLowerCase().includes(q)))
    : listGrid.rows;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', fontSize: 12, color: '#475569' }}>
        총 <strong>{listGrid.rows.length}</strong>건{q && <> · 검색결과 <strong>{visibleRows.length}</strong>건</>}
      </div>
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
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 2} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                  검색 결과 없음
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => {
                const key = String(row['slpno'] ?? row._index ?? i);
                return (
                  <ListRow
                    key={key}
                    rowKey={key}
                    row={row}
                    cols={cols}
                    index={i}
                    config={config}
                    closeSignal={closeSignal}
                    requestExclusiveOpen={(k) => setCloseSignal((s) => ({ n: s.n + 1, owner: k }))}
                    userId={userId}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListRow({
  rowKey,
  row,
  cols,
  index,
  config,
  closeSignal,
  requestExclusiveOpen,
  userId,
}: {
  rowKey: string;
  row: GridRow;
  cols: string[];
  index: number;
  config: CamsBrowserConfig;
  closeSignal: { n: number; owner: string };
  requestExclusiveOpen: (key: string) => void;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slpNo = String(row['slpno'] ?? '').trim();

  // Auto-close whenever the parent emits a new "open exclusive"
  // signal owned by some other row. Skipping when `owner === rowKey`
  // keeps the row that just opened, well, open.
  useEffect(() => {
    if (closeSignal.n > 0 && closeSignal.owner !== rowKey) setOpen(false);
  }, [closeSignal, rowKey]);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    requestExclusiveOpen(rowKey);
    if (!slpNo || detail || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('slpNo', slpNo);
      if (userId) params.set('actorId', userId);
      const res = await apiJson<ListResp>(`${config.apiPath}/list?${params.toString()}`);
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
            {detail && (() => {
              const detailGrids = Object.values(detail.grids || {});
              const isEmpty = detailGrids.length === 0
                || detailGrids.every((g) => !g.rows || g.rows.length === 0);
              if (isEmpty) {
                return (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, fontSize: 13, color: '#92400e' }}>
                      서버가 CAMS 상세 페이지를 불러왔으나 파싱 가능한 데이터가 없습니다.
                      {detail.sourceUrl && (
                        <> <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', marginLeft: 6 }}>원본 페이지 열기 ↗</a></>
                      )}
                    </div>
                    {detail.diagnostics && <DiagnosticsPanel d={detail.diagnostics} />}
                  </div>
                );
              }
              return config.format === 'proposal' ? (
                <ProposalForm grids={detailGrids} config={config} fallbackHeader={row} attachments={detail.attachments} />
              ) : config.format === 'voucher' ? (
                <VoucherForm grids={detailGrids} config={config} fallbackHeader={row} />
              ) : (
                <Doc grids={detailGrids} fallbackHeader={row} config={config} />
              );
            })()}
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------- Single document layout ---------- */

function Doc({
  grids,
  fallbackHeader,
  config,
}: {
  grids: ParsedGrid[];
  fallbackHeader?: GridRow;
  config: CamsBrowserConfig;
}) {
  const labelFor = useLabelFor();
  const main =
    grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '품의 정보') ||
    grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '전표 정보') ||
    grids[0];
  const files = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '첨부파일');
  const bidders = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '입찰업체');
  const approvers = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '결재선');
  const lineItems = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '전표 명세');
  const others = grids.filter((g) => {
    if (g === main || g === files || g === bidders || g === approvers || g === lineItems) return false;
    // Only suppress the redundant single-row debit/credit totals grids
    // when the voucher ledger above has already rendered the totals.
    // If we couldn't identify a line-items grid, keep the totals grid
    // visible so the user never silently loses data.
    if (lineItems && sectionLabelFor(g.id, g.fields, config) === '_totals') return false;
    return true;
  });

  const mainRow: Record<string, any> = (main?.rows?.[0] as any) || {};
  const get = (k: string) => String(mainRow[k] ?? fallbackHeader?.[k] ?? '').trim();
  const title = get('title') || get('aspnote') || get('purpose') || '제목 없음';
  const slpNo = get('slpno') || get('no');
  const date = formatValue('date', get('date') || get('slpdt') || get('accdate'));
  const amount = get('amount') || get('amt');
  const status = formatValue('status', get('status') || get('state'));
  const author = get('sname') || get('user') || get('name');
  const dept = get('dname') || get('dept');

  // Fields already promoted to the header bar (or pure ASP.NET noise).
  const headerSkip = new Set([
    'title', 'aspnote', 'purpose', 'slpno', 'no', 'date', 'sname', 'dname',
    'status', 'state', 'user', 'name', 'dept',
    ...PROPERTY_SHEET_SKIP,
  ]);
  // Long free-text fields are pulled out of the property sheet and
  // rendered as full-width blocks at the bottom for readability.
  const longTextFields = ['contents', 'content', 'remarks', 'memo', 'note', 'description', 'detail', 'reason', 'opinion', 'comment', 'aspnote'];
  const longTexts = longTextFields
    .map((k) => [k, get(k)] as const)
    .filter(([k, v]) => v.length > 0 && !(k === 'aspnote' && v === title));

  return (
    <article style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
      <header style={{ borderBottom: '2px solid #0F3D73', paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 1, marginBottom: 4 }}>{config.docHeading}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{title}</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#475569', marginTop: 6 }}>
          {slpNo && <span><b>번호</b> {slpNo}</span>}
          {date && <span><b>일자</b> {date}</span>}
          {author && <span><b>기안자</b> {author}{dept ? ` (${dept})` : ''}</span>}
          {amount && <span><b>금액</b> {amount}</span>}
          {status && <span style={{ marginLeft: 'auto' }}><Badge>{status}</Badge></span>}
        </div>
      </header>

      {main && main.rows.length > 0 && (
        <PropertySheet
          grid={main}
          skipFields={new Set([...headerSkip, ...longTextFields])}
          highlight={{ amount, amt: amount }}
        />
      )}

      {lineItems && lineItems.rows.length > 0 && (
        <DocSection title="전표 명세" gridId={lineItems.id} count={lineItems.rows.length}>
          <VoucherLedger grid={lineItems} />
        </DocSection>
      )}

      {approvers && approvers.rows.length > 0 && (
        <DocSection title="결재선" gridId={approvers.id} count={approvers.rows.length}>
          {/* Approval line shown compactly: only the columns that matter
              for understanding the chain. The raw grid often has 8+
              columns (sabun, dept code, signed-on timestamp, ...). */}
          <CompactTable grid={approvers} onlyFields={APPROVER_VISIBLE_FIELDS} />
        </DocSection>
      )}

      {bidders && bidders.rows.length > 0 && (
        <DocSection title="입찰업체" gridId={bidders.id} count={bidders.rows.length}>
          <CompactTable grid={bidders} />
        </DocSection>
      )}

      {files && files.rows.length > 0 && (
        <DocSection title="첨부파일" gridId={files.id} count={files.rows.length}>
          <CompactTable grid={files} />
        </DocSection>
      )}

      {others.map((g) => (
        <DocSection key={g.id} title={sectionLabelFor(g.id, g.fields, config)} gridId={g.id} count={g.rows.length}>
          <CompactTable grid={g} />
        </DocSection>
      ))}

      {/* Long free-text content goes at the bottom, full width, reading-friendly. */}
      {longTexts.map(([k, v]) => (
        <LongContent key={k} label={labelFor(k)} text={v} />
      ))}
    </article>
  );
}

/** Columns we deem worth showing in the approval line. Anything else
 *  (sabun, dept codes, sign timestamps, internal flags) is hidden to
 *  keep the table scannable. */
const APPROVER_VISIBLE_FIELDS = [
  'approvalorder', 'signorder',
  'empname', 'sname', 'name',
  'position',
  'dname', 'dept',
  'approvalstatus', 'signstatus', 'status',
  'opinion', 'comment',
];

function LongContent({ label, text }: { label: string; text: string }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>{label}</h3>
      <div
        style={{
          background: '#FAFAF7',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 16,
          fontSize: 14,
          lineHeight: 1.7,
          color: '#1e293b',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', background: '#EEF2FF', color: '#3730A3', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
      {children}
    </span>
  );
}

/* ---------- Traditional Korean 품의서 / 전표 form layouts ---------- */

// Cell styles shared by the formal document layouts. The borders are
// intentionally a touch darker than the rest of the UI so the form
// reads like a printed Korean office document.
const formCell: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #94a3b8',
  fontSize: 13,
  color: '#0f172a',
  verticalAlign: 'top',
  background: '#fff',
  lineHeight: 1.55,
};

const formHeader: React.CSSProperties = {
  ...formCell,
  background: '#f1f5f9',
  fontWeight: 700,
  textAlign: 'center',
  width: 110,
  whiteSpace: 'nowrap',
};

/**
 * Renders the upstream `결재선` grid as the iconic Korean approval
 * stamp box (one column per approver, three rows: 직책 / 사원명 /
 * 결재상태). Anchored to the top-right of the document by the parent.
 */
function ApprovalBox({ grid }: { grid: ParsedGrid }) {
  if (!grid || grid.rows.length === 0) return null;
  const positionKey = grid.fields.find((f) => /^(position|rank)$/i.test(f));
  const nameKey = grid.fields.find((f) => /^(empname|sname|name)$/i.test(f));
  const statusKey = grid.fields.find((f) => /(approvalstatus|signstatus)$/i.test(f));

  const cellW = 56;
  const cell: React.CSSProperties = {
    border: '1px solid #94a3b8',
    width: cellW,
    fontSize: 11,
    textAlign: 'center',
    padding: 4,
    background: '#fff',
    color: '#0f172a',
  };
  const labelCell: React.CSSProperties = {
    ...cell,
    width: 22,
    background: '#f1f5f9',
    fontWeight: 800,
    writingMode: 'vertical-rl' as any,
    letterSpacing: '0.3em',
  };

  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
      <tbody>
        <tr>
          <th rowSpan={3} style={labelCell}>결재</th>
          {grid.rows.map((r) => (
            <th key={`p-${r._index}`} style={{ ...cell, height: 22, background: '#f1f5f9', fontWeight: 700 }}>
              {positionKey ? String((r as any)[positionKey] ?? '') : ''}
            </th>
          ))}
        </tr>
        <tr>
          {grid.rows.map((r) => (
            <td key={`n-${r._index}`} style={{ ...cell, height: 44, fontSize: 12 }}>
              {nameKey ? String((r as any)[nameKey] ?? '') : ''}
            </td>
          ))}
        </tr>
        <tr>
          {grid.rows.map((r) => {
            const code = statusKey ? String((r as any)[statusKey] ?? '').trim() : '';
            const stamped = code === '02';
            return (
              <td key={`s-${r._index}`} style={{ ...cell, height: 22 }}>
                {stamped ? (
                  <span style={{ color: '#dc2626', fontWeight: 800, letterSpacing: '0.05em' }}>완료</span>
                ) : (
                  <span style={{ color: '#cbd5e1' }}>·</span>
                )}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Positional column mapping declared by the user, off-by-one fixed:
 * the upstream detail grid does NOT emit a leading "번" sequence
 * column, and 지급조건 / 관련업체 are absent. The layout is:
 *
 *   index  ko-label      type
 *   0      품의번호      identifier (mono)
 *   1      제목          title
 *   2      목적          purpose
 *   3      기안자        drafter
 *   4      기안일자      date (YYYYMMDD → YYYY-MM-DD)
 *   5      완료예정일    date
 *   6      소요금액      amount (`1,234,567 원`)
 *   7      내용          long text — rendered as wide bottom box
 *
 * Index 8+ (파일명/imgsort/전결/etc.) is hidden; file metadata is
 * shown via the separate 첨부파일 grid below.
 */
const PROPOSAL_FIELD_LAYOUT: Array<{ label: string; kind: 'text' | 'mono' | 'date' | 'amount' }> = [
  { label: '품의번호',   kind: 'mono' },
  { label: '제목',       kind: 'text' },
  { label: '목적',       kind: 'text' },
  { label: '기안자',     kind: 'text' },
  { label: '기안일자',   kind: 'date' },
  { label: '완료예정일', kind: 'date' },
  { label: '소요금액',   kind: 'amount' },
  { label: '내용',       kind: 'text' },
];
const PROPOSAL_CONTENTS_INDEX = 7; // 내용 — rendered separately at the bottom.

function ProposalForm({
  grids,
  config,
  fallbackHeader,
  attachments,
}: {
  grids: ParsedGrid[];
  config: CamsBrowserConfig;
  fallbackHeader?: GridRow;
  attachments?: Attachment[];
}) {
  const approvers = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '결재선');
  // Main info: take the first grid that has any row and isn't the
  // approval line. We do NOT use a label heuristic here — the user
  // said positions are authoritative.
  const main =
    grids.find((g) => g !== approvers && g.rows.length > 0) ||
    grids[0];
  const row: Record<string, any> = (main?.rows?.[0] as any) || {};
  const mainFields = main?.fields || [];

  // Resolve cell value by POSITION in the upstream `<grid>_lbl<FIELD>_<n>`
  // sequence, with fallback to the row data we already had from the
  // list view (so inline-expanded cards never look emptier than the
  // outer list row).
  const valueAt = (idx: number): string => {
    const fieldCode = mainFields[idx];
    if (fieldCode != null) {
      const v = row[fieldCode];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    // Fallback: try the same position on the list-level row.
    if (fallbackHeader) {
      const fbKeys = Object.keys(fallbackHeader).filter((k) => k !== '_index' && k !== '_grid');
      const fk = fbKeys[idx];
      if (fk) {
        const v = (fallbackHeader as any)[fk];
        if (v != null && String(v).trim()) return String(v).trim();
      }
    }
    return '';
  };

  const fmtCell = (idx: number): string => {
    const raw = valueAt(idx);
    if (!raw) return '';
    const layout = PROPOSAL_FIELD_LAYOUT[idx];
    if (!layout) return raw;
    if (layout.kind === 'date') {
      // Reuse the YYYYMMDD -> YYYY-MM-DD formatter via a date-like field hint.
      return formatValue('date', raw);
    }
    if (layout.kind === 'amount') {
      const n = parseAmt(raw);
      return n ? `${fmtAmt(n)} 원` : raw;
    }
    return raw;
  };

  const contents = valueAt(PROPOSAL_CONTENTS_INDEX);

  return (
    <article style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '32px 28px', position: 'relative' }}>
      {approvers && approvers.rows.length > 0 && (
        <div style={{ position: 'absolute', top: 24, right: 24 }}>
          <ApprovalBox grid={approvers} />
        </div>
      )}
      <h1 style={{ fontSize: 30, fontWeight: 800, textAlign: 'center', letterSpacing: '0.5em', margin: '0 0 24px 0', color: '#0f172a', textIndent: '0.5em' }}>
        품 의 서
      </h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 110 }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[0].label}</th>
            <td style={{ ...formCell, fontFamily: 'monospace' }} colSpan={3}>{fmtCell(0)}</td>
          </tr>
          <tr>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[1].label}</th>
            <td style={{ ...formCell, fontWeight: 700 }} colSpan={3}>
              {fmtCell(1) || <span style={{ color: '#cbd5e1' }}>—</span>}
            </td>
          </tr>
          <tr>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[2].label}</th>
            <td style={{ ...formCell, whiteSpace: 'pre-wrap' }} colSpan={3}>
              {fmtCell(2) || <span style={{ color: '#cbd5e1' }}>—</span>}
            </td>
          </tr>
          <tr>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[3].label}</th>
            <td style={formCell}>{fmtCell(3)}</td>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[4].label}</th>
            <td style={formCell}>{fmtCell(4)}</td>
          </tr>
          <tr>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[5].label}</th>
            <td style={formCell}>{fmtCell(5)}</td>
            <th style={formHeader}>{PROPOSAL_FIELD_LAYOUT[6].label}</th>
            <td style={{ ...formCell, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmtCell(6)}</td>
          </tr>
        </tbody>
      </table>

      {/* 내용 — 큰 박스 (positional index 10, last) */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
          {PROPOSAL_FIELD_LAYOUT[PROPOSAL_CONTENTS_INDEX].label}
        </div>
        <div
          style={{
            border: '1px solid #94a3b8',
            borderRadius: 4,
            padding: '14px 16px',
            background: '#FAFAF7',
            minHeight: 140,
            fontSize: 13,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: contents ? '#1e293b' : '#cbd5e1',
          }}
        >
          {contents || '— 내용 없음 —'}
        </div>
      </section>

      {/* 첨부파일 — 내용 바로 아래 */}
      {attachments && attachments.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            첨부파일 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({attachments.length})</span>
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                  <th style={th}>#</th>
                  <th style={th}>파일명</th>
                  <th style={th}>열기</th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((att) => {
                  const camsUrl = `http://cn.icams.co.kr/acco/mpu_list2.aspx?slp_no=${att.slpNo}&sort=${att.sortValue}`;
                  return (
                    <tr key={att.seq} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ ...td, color: '#94a3b8', width: 40 }}>{att.seq}</td>
                      <td style={td}>{att.filename}</td>
                      <td style={td}>
                        <a
                          href={camsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#1d4ed8', textDecoration: 'underline', fontSize: 12 }}
                        >
                          열기 ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  );
}

/**
 * Positional column mapping for the voucher detail header grid.
 * The upstream emits its fields in this exact order:
 *
 *   index  ko-label    type
 *   0      순번        sequence (hidden)
 *   1      전표번호    identifier (mono)
 *   2      기표일자    date (YYYYMMDD → YYYY-MM-DD)
 *   3      입력일      datetime (already formatted, e.g. "2026-05-06 오전 10:36:58")
 *   4      거래형태    string (대체/입금/출금/etc.)
 *   5      결재여부    string (미결/결재/etc.)
 *   6      취소여부    Y/N
 *   7      품의자      string (e.g. "203347 정슬아")
 *   8      결재일      date
 */
const VOUCHER_HEADER_LAYOUT: Array<{ label: string; kind: 'text' | 'mono' | 'date' }> = [
  { label: '순번',     kind: 'text' }, // index 0 — hidden in render
  { label: '전표번호', kind: 'mono' },
  { label: '기표일자', kind: 'date' },
  { label: '입력일',   kind: 'text' },
  { label: '거래형태', kind: 'text' },
  { label: '결재여부', kind: 'text' },
  { label: '취소여부', kind: 'text' },
  { label: '품의자',   kind: 'text' },
  { label: '결재일',   kind: 'date' },
];

function VoucherForm({
  grids,
  config,
  fallbackHeader,
}: {
  grids: ParsedGrid[];
  config: CamsBrowserConfig;
  fallbackHeader?: GridRow;
}) {
  const approvers = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '결재선');
  const files = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '첨부파일');
  const lineItems = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '전표 명세');
  // Header info: first non-hidden grid (skip approvers/files/lineItems
  // and the single-row debit/credit totals grids).
  const headerGrid =
    grids.find((g) =>
      g !== approvers && g !== files && g !== lineItems
      && sectionLabelFor(g.id, g.fields, config) !== '_totals'
      && g.rows.length > 0,
    ) || grids[0];
  const row: Record<string, any> = (headerGrid?.rows?.[0] as any) || {};
  const fields = headerGrid?.fields || [];

  const valueAt = (idx: number): string => {
    const fc = fields[idx];
    if (fc != null) {
      const v = row[fc];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    if (fallbackHeader) {
      const fbKeys = Object.keys(fallbackHeader).filter((k) => k !== '_index' && k !== '_grid');
      const fk = fbKeys[idx];
      if (fk) {
        const v = (fallbackHeader as any)[fk];
        if (v != null && String(v).trim()) return String(v).trim();
      }
    }
    return '';
  };

  const fmtCell = (idx: number): string => {
    const raw = valueAt(idx);
    if (!raw) return '';
    const layout = VOUCHER_HEADER_LAYOUT[idx];
    if (!layout) return raw;
    if (layout.kind === 'date') return formatValue('date', raw);
    return raw;
  };

  return (
    <article style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '32px 28px', position: 'relative' }}>
      {approvers && approvers.rows.length > 0 && (
        <div style={{ position: 'absolute', top: 24, right: 24 }}>
          <ApprovalBox grid={approvers} />
        </div>
      )}
      <h1 style={{ fontSize: 30, fontWeight: 800, textAlign: 'center', letterSpacing: '0.5em', margin: '0 0 24px 0', color: '#0f172a', textIndent: '0.5em' }}>
        전 표
      </h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 110 }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[1].label}</th>
            <td style={{ ...formCell, fontFamily: 'monospace' }}>{fmtCell(1)}</td>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[2].label}</th>
            <td style={formCell}>{fmtCell(2)}</td>
          </tr>
          <tr>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[3].label}</th>
            <td style={formCell}>{fmtCell(3)}</td>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[4].label}</th>
            <td style={formCell}>{fmtCell(4)}</td>
          </tr>
          <tr>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[5].label}</th>
            <td style={formCell}>{fmtCell(5)}</td>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[6].label}</th>
            <td style={formCell}>{fmtCell(6)}</td>
          </tr>
          <tr>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[7].label}</th>
            <td style={formCell}>{fmtCell(7)}</td>
            <th style={formHeader}>{VOUCHER_HEADER_LAYOUT[8].label}</th>
            <td style={formCell}>{fmtCell(8)}</td>
          </tr>
        </tbody>
      </table>

      {/* 차/대 명세 ledger */}
      {lineItems && lineItems.rows.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>전표 명세</div>
          <div style={{ border: '1px solid #94a3b8', borderRadius: 4, overflow: 'hidden' }}>
            <VoucherLedger grid={lineItems} />
          </div>
        </section>
      )}

      {/* 첨부파일 */}
      {files && files.rows.length > 0 && (() => {
        // 전표번호: fmtCell(1) 또는 fallbackHeader에서 직접 가져오기
        const slpNo = fmtCell(1) || String(fallbackHeader?.['slpno'] ?? fallbackHeader?.['no'] ?? '').trim();
        return (
          <section style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
              첨부파일 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({files.rows.length})</span>
            </div>
            <FileTable grid={files} slpNo={slpNo} baseUrl="http://cn.icams.co.kr/acco/macco_list2.aspx" />
          </section>
        );
      })()}
    </article>
  );
}

function PropertySheet({
  grid,
  skipFields,
  highlight,
}: {
  grid: ParsedGrid;
  skipFields?: Set<string>;
  highlight?: Record<string, string | undefined>;
}) {
  const labelFor = useLabelFor();
  const row = grid.rows[0] || {};
  const entries = grid.fields
    .filter((f) => !(skipFields && skipFields.has(f)))
    .map((f) => [f, formatValue(f, (row as any)[f])] as const)
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
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>{children}</div>
    </section>
  );
}

/**
 * Render voucher line items in the traditional Korean 전표 (T-account)
 * layout: 차변 (debit) on the left, 대변 (credit) on the right, with
 * matching account name / amount / 적요 columns and a totals row at
 * the bottom that should be equal on both sides.
 *
 * Two upstream shapes are supported:
 *
 *  - Separate `debit` and `credit` columns per row. Rows with a
 *    non-zero debit appear on the left; rows with a non-zero credit
 *    appear on the right. A single row can show on both sides if it
 *    has values in both columns.
 *
 *  - A single `drcr` flag column plus an amount column. The flag
 *    classifies the row to one side.
 */
function VoucherLedger({ grid }: { grid: ParsedGrid }) {
  const fields = new Set(grid.fields);
  const hasDebit = fields.has('debit');
  const hasCredit = fields.has('credit');
  // The 차대구분 column has been seen as `drcr`, `drcrgb`, or `drcrgubun`
  // depending on the upstream version. Try them in order.
  // Field-code aliases observed across CAMS versions. The `asp*`
  // prefixed names are the ones the user confirmed for the current
  // upstream (aspdcsg=차대구분, aspacd=계정코드/계정명, aspamt=금액).
  const drcrKey = ['aspdcsg', 'drcr', 'drcrgb', 'drcrgubun', 'gubun'].find((k) => fields.has(k));
  const acctCdKey = ['aspacd', 'acctcd', 'accountcd', 'acctcode'].find((k) => fields.has(k));
  const acctNmKey = ['acctnm', 'accountnm', 'acctname'].find((k) => fields.has(k));
  const amtKey = ['aspamt', 'amount', 'amt', 'totamt'].find((k) => fields.has(k));
  const noteKey = ['aspnote', 'summary', 'note', 'remarks', 'content', 'contents'].find((k) => fields.has(k));
  const costGbKey = ['costgb', 'costgubun', 'cstgb'].find((k) => fields.has(k));
  const costOwnKey = ['costown', 'costownr', 'cstown'].find((k) => fields.has(k));

  type LedgerRow = {
    acctcd?: string;
    acctnm?: string;
    amt: number;
    note?: string;
    costgb?: string;
    costown?: string;
    _index: number;
  };
  const debitRows: LedgerRow[] = [];
  const creditRows: LedgerRow[] = [];

  for (const row of grid.rows) {
    const acctcd = acctCdKey ? String((row as any)[acctCdKey] ?? '') : undefined;
    const acctnm = acctNmKey ? String((row as any)[acctNmKey] ?? '') : undefined;
    const note = noteKey ? String((row as any)[noteKey] ?? '') : undefined;
    const costgb = costGbKey ? String((row as any)[costGbKey] ?? '') : undefined;
    const costown = costOwnKey ? String((row as any)[costOwnKey] ?? '') : undefined;
    if (hasDebit || hasCredit) {
      const d = parseAmt((row as any).debit);
      const c = parseAmt((row as any).credit);
      if (d > 0) debitRows.push({ acctcd, acctnm, amt: d, note, costgb, costown, _index: row._index });
      if (c > 0) creditRows.push({ acctcd, acctnm, amt: c, note, costgb, costown, _index: row._index });
    } else if (drcrKey) {
      const flag = String((row as any)[drcrKey] ?? '').trim();
      const amt = amtKey ? parseAmt((row as any)[amtKey]) : 0;
      const entry: LedgerRow = { acctcd, acctnm, amt, note, costgb, costown, _index: row._index };
      if (/^(차|차변|D|DR|debit|1)$/i.test(flag)) debitRows.push(entry);
      else if (/^(대|대변|C|CR|credit|2)$/i.test(flag)) creditRows.push(entry);
      else debitRows.push(entry); // default to debit if ambiguous
    } else {
      // No way to classify — fall back to plain table rendering.
      return <CompactTable grid={grid} />;
    }
  }

  const debitTotal = debitRows.reduce((s, r) => s + r.amt, 0);
  const creditTotal = creditRows.reduce((s, r) => s + r.amt, 0);
  const showAcctNm = Boolean(acctNmKey);
  const showCost = Boolean(costGbKey) || Boolean(costOwnKey);

  // Pad both sides to the same row count so the heights match.
  const maxRows = Math.max(debitRows.length, creditRows.length);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <LedgerSide title="차변" rows={debitRows} total={debitTotal} showAcctNm={showAcctNm} showCost={showCost} minRows={maxRows} />
      <LedgerSide title="대변" rows={creditRows} total={creditTotal} showAcctNm={showAcctNm} showCost={showCost} borderLeft minRows={maxRows} />
    </div>
  );
}

function LedgerSide({
  title,
  rows,
  total,
  showAcctNm,
  showCost,
  borderLeft,
  minRows,
}: {
  title: string;
  rows: Array<{ acctcd?: string; acctnm?: string; amt: number; note?: string; costgb?: string; costown?: string; _index: number }>;
  total: number;
  showAcctNm: boolean;
  showCost: boolean;
  borderLeft?: boolean;
  minRows?: number;
}) {
  // Total table column count for the totals row's `colSpan`.
  const totalCols = 1 /* 계정코드 */ + (showAcctNm ? 1 : 0) + 1 /* 적요 */ + (showCost ? 2 : 0) + 1 /* 금액 */;
  return (
    <div style={{ borderLeft: borderLeft ? '1px solid #e5e7eb' : 'none' }}>
      <div style={{ background: '#f8fafc', padding: '8px 12px', fontSize: 12, fontWeight: 800, color: title === '차변' ? '#0F3D73' : '#9F1239', borderBottom: '1px solid #e5e7eb' }}>
        {title}
      </div>
      {rows.length === 0 && !minRows ? (
        <div style={{ padding: 14, fontSize: 12, color: '#cbd5e1' }}>—</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 90 }} />
            {showAcctNm && <col />}
            <col />
            {showCost && <col style={{ width: 80 }} />}
            {showCost && <col style={{ width: 90 }} />}
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={th}>계정코드</th>
              {showAcctNm && <th style={th}>계정명</th>}
              <th style={th}>적요</th>
              {showCost && <th style={th}>원가구분</th>}
              {showCost && <th style={th}>원가소속</th>}
              <th style={{ ...th, textAlign: 'right' }}>금액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r._index}-${i}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ ...td, fontFamily: 'monospace', color: '#64748b' }}>{r.acctcd || ''}</td>
                {showAcctNm && <td style={td}>{r.acctnm || ''}</td>}
                <td style={{ ...td, color: '#64748b' }}>{r.note || ''}</td>
                {showCost && <td style={td}>{r.costgb || ''}</td>}
                {showCost && <td style={td}>{r.costown || ''}</td>}
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmtAmt(r.amt)}
                </td>
              </tr>
            ))}
            {/* Pad with empty rows so 차변/대변 heights match */}
            {minRows != null && rows.length < minRows && Array.from({ length: minRows - rows.length }).map((_, i) => (
              <tr key={`pad-${i}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={td} colSpan={totalCols}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #cbd5e1', background: '#fafafa' }}>
              <td style={td} colSpan={totalCols - 1}>
                <span style={{ fontWeight: 700, color: '#475569' }}>{title}합계</span>
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
                {fmtAmt(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function parseAmt(v: any): number {
  if (v == null) return 0;
  const s = String(v).replace(/[,\s₩]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

/**
 * Convert raw upstream values into something a human can read:
 *
 *  - 8-digit dates (`20260507`) on date-like fields → `2026-05-07`.
 *  - 2-digit approval status codes (`01`, `02`, …) → Korean labels.
 *
 * Anything else passes through. Returns an empty string for null/empty.
 */
function formatValue(field: string, raw: string | number | undefined): string {
  if (raw == null) return '';
  const v = String(raw).trim();
  if (!v) return '';
  // Date-like fields whose value is YYYYMMDD.
  if (/(^date$|date$|^d?dt$|dt$|^day$|day$)/i.test(field) && /^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  // Approval status codes — same scheme is used on both proposals and
  // vouchers. Codes outside this list pass through so we never hide
  // unknown values.
  if (/^(approvalstatus|signstatus|status|state)$/i.test(field)) {
    const map: Record<string, string> = {
      '00': '미결',
      '01': '대기',
      '02': '완료',
      '03': '반려',
      '04': '취소',
      '05': '회수',
      '06': '진행중',
    };
    if (map[v]) return map[v];
  }
  return v;
}

/** Field codes that are pure ASP.NET internals and should never be
 *  shown in the property sheet (they appear with junk values like `0`). */
const PROPERTY_SHEET_SKIP = new Set(['imgsort', 'gfile']);

function CompactTable({ grid, onlyFields }: { grid: ParsedGrid; onlyFields?: string[] }) {
  const labelFor = useLabelFor();
  // If `onlyFields` is provided, restrict to that intersection while
  // preserving the requested order. Empty (no overlap) falls back to the
  // grid's own field order so we never end up with a 0-column table.
  // Also filter out _href fields as they're used for linking, not display.
  const cols = onlyFields
    ? (() => {
        const filtered = onlyFields.filter((f) => grid.fields.includes(f) && !f.endsWith('_href'));
        return filtered.length > 0 ? filtered : grid.fields.filter((f) => !f.endsWith('_href'));
      })()
    : grid.fields.filter((f) => !f.endsWith('_href'));

  // Render cell with optional link if _href field exists
  const renderCell = (row: any, field: string) => {
    const value = formatValue(field, row[field]);
    const hrefField = `${field}_href`;
    const href = row[hrefField] as string | undefined;
    if (href && value) {
      // Make relative URLs absolute using CAMS base URL
      const fullUrl = href.startsWith('http') ? href : `http://cn.icams.co.kr${href.startsWith('/') ? '' : '/'}${href}`;
      return (
        <a href={fullUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>
          {value}
        </a>
      );
    }
    return value;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#fafafa', textAlign: 'left' }}>
            <th style={th}>#</th>
            {cols.map((c) => (
              <th key={c} style={th}>{labelFor(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => (
            <tr key={row._index} style={{ borderTop: '1px solid #e5e7eb' }}>
              <td style={{ ...td, color: '#94a3b8', width: 40 }}>{i + 1}</td>
              {cols.map((c) => (
                <td key={c} style={td}>{renderCell(row, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 첨부파일 테이블 - 각 파일에 CAMS 다운로드 링크 추가 */
function FileTable({ grid, slpNo, baseUrl }: { grid: ParsedGrid; slpNo: string; baseUrl: string }) {
  const labelFor = useLabelFor();
  // sort/imgsort 필드 찾기
  const sortField = grid.fields.find((f) => /^(sort|imgsort|seq|sno)$/i.test(f));
  // 표시할 컬럼 (href 제외, 불필요한 필드 제외)
  const cols = grid.fields.filter((f) => !f.endsWith('_href') && !['gfile', 'imgsort'].includes(f.toLowerCase()));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#fafafa', textAlign: 'left' }}>
            <th style={th}>#</th>
            {cols.map((c) => (
              <th key={c} style={th}>{labelFor(c)}</th>
            ))}
            <th style={th}>다운로드</th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => {
            const sortValue = sortField ? String(row[sortField] ?? '') : String(i + 1);
            const downloadUrl = slpNo && sortValue
              ? `${baseUrl}?slp_no=${encodeURIComponent(slpNo)}&sort=${encodeURIComponent(sortValue)}`
              : '';
            return (
              <tr key={row._index} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ ...td, color: '#94a3b8', width: 40 }}>{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} style={td}>{formatValue(c, row[c])}</td>
                ))}
                <td style={td}>
                  {downloadUrl ? (
                    <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#1d4ed8', textDecoration: 'underline', fontSize: 12 }}
                    >
                      열기 ↗
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticsPanel({ d }: { d: ListDiagnostics }) {
  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
      <div style={{ fontWeight: 700, color: '#334155' }}>업스트림 진단</div>
      <div><b>원인 추정:</b> {d.hint}</div>
      <div><b>HTML 크기:</b> {d.htmlLength.toLocaleString()} 바이트</div>
      <div><b>로그인 페이지 감지:</b> {d.looksLikeLogin ? '예' : '아니오'}</div>
      <div><b>에러 페이지 감지:</b> {d.looksLikeError ? '예' : '아니오'}</div>
      {d.lblIdsFoundSample.length > 0 && (
        <div>
          <b>발견된 lbl span id 샘플:</b>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', marginTop: 4, wordBreak: 'break-all' }}>
            {d.lblIdsFoundSample.join(', ')}
          </div>
        </div>
      )}
      {d.bodyTextSnippet && (
        <div>
          <b>응답 본문 발췌:</b>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, whiteSpace: 'pre-wrap' }}>
            {d.bodyTextSnippet}
          </div>
        </div>
      )}
      {d.htmlSnippet && (
        <details>
          <summary style={{ cursor: 'pointer', color: '#1d4ed8' }}>원시 HTML 발췌 (앞 4000자)</summary>
          <pre style={{ fontFamily: 'monospace', fontSize: 11, color: '#334155', background: '#0f172a0a', padding: 8, borderRadius: 6, marginTop: 6, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {d.htmlSnippet}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * Best-effort label for a DataGrid based on its id and the fields it
 * exposes. The grid ids on the upstream page are not stable enough to
 * fully hard-code, so we fall back to a heuristic.
 */
function sectionLabelFor(id: string, fields: string[], config: CamsBrowserConfig): string {
  const fset = new Set(fields.map((f) => f.toLowerCase()));
  // List page: `myDataGrid` (no trailing digit) is the only multi-row
  // list grid. Match it exactly so the detail page's main info grid is
  // not misclassified.
  if (id === 'myDataGrid') return config.listLabel;
  if (fset.has('approvalstatus') || fset.has('approvalorder') || fset.has('empno') || fset.has('signorder')) return '결재선';
  if (fset.has('bidamount') || fset.has('bidamt') || fset.has('biddername')) return '입찰업체';
  if (fset.has('filename') || fset.has('fname') || fset.has('imgsort') || fset.has('sort') || fset.has('file') || fset.has('attach') || fset.has('gfile')) return '첨부파일';
  // Voucher line items typically have an account/debit/credit shape.
  // Single-row totals grids on the voucher detail page (one for debit
  // total, one for credit total). VoucherLedger already shows totals
  // beneath each side, so these grids are redundant — Doc filters them
  // out by checking for this label.
  if (
    (fset.has('dramt') || fset.has('drsum') || fset.has('drtot') || fset.has('debitsum') ||
     fset.has('cramt') || fset.has('crsum') || fset.has('crtot') || fset.has('creditsum') ||
     // Some upstream versions use literal Korean field codes for the
     // single-row totals grids (차변합계 / 대변합계).
     fset.has('차변합계') || fset.has('대변합계'))
    && !fset.has('acctcd') && !fset.has('aspacd')
  ) return '_totals';
  // 전표 명세: either the legacy debit/credit/acctcd shape or the
  // current upstream's `asp*` field codes (aspdcsg=차대구분,
  // aspacd=계정코드, aspamt=금액).
  if (
    fset.has('debit') || fset.has('credit') || fset.has('acctcd') || fset.has('acctnm') ||
    fset.has('aspdcsg') || fset.has('aspacd') || fset.has('aspamt')
  ) return '전표 명세';
  if (fset.has('aspnote')) return '전표 정보';
  if (fset.has('title') || fset.has('purpose') || fset.has('amount') || fset.has('amt')) return '품의 정보';
  // Fallback: never expose the raw upstream grid id (e.g. `myDataGrid7`)
  // to the user — they don't care about ASP.NET internals.
  return '기타 정보';
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 12, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', color: '#1e293b', verticalAlign: 'top' };

function defaultLabelFor(field: string): string {
  // Korean labels for the field codes we've actually seen in the
  // PowerApps source plus the ones the upstream pages typically expose.
  // Unknown codes fall through to the raw key so we never hide data.
  // Per-page overrides (see `CamsBrowserConfig.labelOverrides`) layer
  // on top of this for codes whose meaning depends on the document
  // family (e.g. `slpno` = 품의번호 on proposals but 전표번호 on vouchers).
  const map: Record<string, string> = {
    // — Identifiers / who / when
    slpno: '슬립번호',
    no: '번호',
    seq: '순번',
    sno: '순번',
    seq2: '연번',
    lineno: '연번',
    lno: '연번',
    sname: '기안자',
    user: '기안자',
    name: '기안자',
    drafter: '품의자',
    regname: '품의자',
    empno: '사번',
    empname: '사원명',
    sabun: '사번',
    position: '직책',
    rank: '직급',
    dname: '부서',
    dept: '부서',
    deptcd: '부서코드',
    deptnm: '부서명',
    date: '일자',
    sdate: '시작일',
    edate: '종료일',
    slpdt: '기표일자',
    accdate: '기표일자',
    inpdt: '입력일',
    inputdate: '입력일',
    duedate: '완료예정일',
    delvdt: '납기일',
    regdt: '등록일',
    updt: '수정일',
    aprdt: '결재일',
    apdt: '결재일',
    signdt: '결재일',
    signdate: '결재일',
    // — Subject / content
    title: '제목',
    aspnote: '적요',
    purpose: '목적',
    summary: '적요',
    contents: '내용',
    content: '내용',
    description: '설명',
    detail: '세부내용',
    note: '비고',
    memo: '메모',
    remarks: '비고',
    reason: '사유',
    // — Transaction
    trantype: '거래형태',
    tranggu: '거래형태',
    trgubun: '거래형태',
    dealtype: '거래형태',
    // — Approval / cancel flags
    apryn: '결재여부',
    signyn: '결재여부',
    approveyn: '결재여부',
    cancelyn: '취소여부',
    canceln: '취소여부',
    // — Money / terms
    amount: '금액',
    amt: '금액',
    prdamt: '예산금액',
    bplnno: '예산번호',
    payterm: '지급조건',
    paymethod: '지급방법',
    paydate: '지급일',
    currency: '통화',
    rate: '환율',
    vat: '부가세',
    suptamt: '공급가액',
    taxamt: '세액',
    totamt: '합계금액',
    // — Vendor / bidders
    company: '관련업체',
    vendor: '거래처',
    vendornm: '거래처명',
    bizno: '사업자번호',
    biddername: '업체명',
    bidamount: '입찰금액',
    bidamt: '입찰금액',
    // — Status
    state: '상태',
    status: '상태',
    final: '전결',
    // — Files
    filename: '파일명',
    fname: '파일명',
    filesize: '파일크기',
    sort: '구분',
    imgsort: '구분',
    gfile: 'GFILE',
    // — Approvals
    approvalorder: '결재순서',
    signorder: '결재순서',
    approvalstatus: '결재상태',
    signstatus: '결재상태',
    opinion: '결재의견',
    comment: '결재의견',
    // — Voucher accounting
    acctcd: '계정코드',
    acctnm: '계정명',
    accountcd: '계정코드',
    accountnm: '계정명',
    acctcode: '계정코드',
    acctname: '계정명',
    debit: '차변',
    credit: '대변',
    drcr: '차대구분',
    drcrgb: '차대구분',
    drcrgubun: '차대구분',
    gubun: '구분',
    dramt: '차변합계',
    drsum: '차변합계',
    drtot: '차변합계',
    debitsum: '차변합계',
    cramt: '대변합계',
    crsum: '대변합계',
    crtot: '대변합계',
    creditsum: '대변합계',
    costgb: '원가구분',
    costgubun: '원가구분',
    cstgb: '원가구분',
    costown: '원가소속',
    costownr: '원가소속',
    cstown: '원가소속',
    slpkind: '전표종류',
    slptype: '전표종류',
  };
  return map[field] || field;
}
