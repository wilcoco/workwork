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

interface ListResp {
  slpNo: string;
  sourceUrl: string;
  grids: Record<string, ParsedGrid>;
  count: number;
  items: Array<{ _grid: string; _index: number; [k: string]: string | number | undefined }>;
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

  useEffect(() => {
    void fetchList('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiPath]);

  async function fetchList(slpNo: string) {
    const trimmed = String(slpNo || '').trim();
    setLoading(true);
    setError(null);
    try {
      const qs = trimmed ? `?slpNo=${encodeURIComponent(trimmed)}` : '';
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
              <ProposalForm grids={grids} config={config} />
            ) : config.format === 'voucher' ? (
              <VoucherForm grids={grids} config={config} />
            ) : (
              <Doc grids={grids} config={config} />
            )
          ) : (
            <ListWithExpand grids={grids} config={config} filterText={filterText} />
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
}: {
  grids: ParsedGrid[];
  config: CamsBrowserConfig;
  filterText: string;
}) {
  const labelFor = useLabelFor();
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
              visibleRows.map((row, i) => (
                <ListRow key={row._index} row={row} cols={cols} index={i} config={config} />
              ))
            )}
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
  config,
}: {
  row: GridRow;
  cols: string[];
  index: number;
  config: CamsBrowserConfig;
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
      const res = await apiJson<ListResp>(`${config.apiPath}/list?slpNo=${encodeURIComponent(slpNo)}`);
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
            {detail && (
              config.format === 'proposal' ? (
                <ProposalForm grids={Object.values(detail.grids || {})} config={config} />
              ) : config.format === 'voucher' ? (
                <VoucherForm grids={Object.values(detail.grids || {})} config={config} />
              ) : (
                <Doc grids={Object.values(detail.grids || {})} fallbackHeader={row} config={config} />
              )
            )}
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
  const others = grids.filter((g) =>
    g !== main && g !== files && g !== bidders && g !== approvers && g !== lineItems
    // Skip the redundant single-row debit/credit totals grids; the
    // voucher ledger already displays the totals on each side.
    && sectionLabelFor(g.id, g.fields, config) !== '_totals',
  );

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

function ProposalForm({ grids, config }: { grids: ParsedGrid[]; config: CamsBrowserConfig }) {
  const main =
    grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '품의 정보') || grids[0];
  const files = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '첨부파일');
  const bidders = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '입찰업체');
  const approvers = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '결재선');

  const m: Record<string, any> = (main?.rows?.[0] as any) || {};
  const get = (k: string) => String(m[k] ?? '').trim();
  const fmt = (k: string) => formatValue(k, m[k]);

  const slpno = get('slpno') || get('no');
  const date = fmt('date') || fmt('slpdt') || fmt('regdt');
  const sname = get('sname') || get('user') || get('name');
  const dept = get('dname') || get('dept') || get('deptnm');
  const title = get('title') || get('aspnote');
  const purpose = get('purpose');
  const duedate = fmt('duedate') || fmt('delvdt');
  const amountRaw = get('amount') || get('amt');
  const amount = amountRaw ? `${fmtAmt(parseAmt(amountRaw))} 원` : '';
  const payterm = get('payterm');
  const company = get('company') || get('vendor') || get('vendornm');
  const contents = get('contents') || get('content');

  return (
    <article style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '32px 28px', position: 'relative' }}>
      {/* Approval stamp box anchored top-right. */}
      {approvers && approvers.rows.length > 0 && (
        <div style={{ position: 'absolute', top: 24, right: 24 }}>
          <ApprovalBox grid={approvers} />
        </div>
      )}

      <h1 style={{ fontSize: 30, fontWeight: 800, textAlign: 'center', letterSpacing: '0.5em', margin: '0 0 32px 0', color: '#0f172a', textIndent: '0.5em' }}>
        품 의 서
      </h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 110 }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th style={formHeader}>품의번호</th>
            <td style={{ ...formCell, fontFamily: 'monospace' }}>{slpno}</td>
            <th style={formHeader}>기안일자</th>
            <td style={formCell}>{date}</td>
          </tr>
          <tr>
            <th style={formHeader}>기 안 자</th>
            <td style={formCell}>{sname}</td>
            <th style={formHeader}>부 서</th>
            <td style={formCell}>{dept}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 110 }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th style={formHeader}>제 목</th>
            <td style={{ ...formCell, fontWeight: 700, fontSize: 14 }} colSpan={3}>{title || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
          </tr>
          {purpose && (
            <tr>
              <th style={formHeader}>목 적</th>
              <td style={formCell} colSpan={3}>{purpose}</td>
            </tr>
          )}
          {(amount || payterm) && (
            <tr>
              <th style={formHeader}>소요금액</th>
              <td style={{ ...formCell, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{amount}</td>
              <th style={formHeader}>지급조건</th>
              <td style={formCell}>{payterm}</td>
            </tr>
          )}
          {(duedate || company) && (
            <tr>
              <th style={formHeader}>완료예정일</th>
              <td style={formCell}>{duedate}</td>
              <th style={formHeader}>관련업체</th>
              <td style={formCell}>{company}</td>
            </tr>
          )}
          {contents && (
            <tr>
              <th style={formHeader}>내 용</th>
              <td style={{ ...formCell, whiteSpace: 'pre-wrap', lineHeight: 1.7 }} colSpan={3}>{contents}</td>
            </tr>
          )}
        </tbody>
      </table>

      {files && files.rows.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            첨부파일 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({files.rows.length})</span>
          </h3>
          <CompactTable grid={files} />
        </section>
      )}

      {bidders && bidders.rows.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            입찰업체 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({bidders.rows.length})</span>
          </h3>
          <CompactTable grid={bidders} />
        </section>
      )}

      {/* Approval line table at bottom — gives the full audit trail
          in addition to the iconic stamp box at the top. */}
      {approvers && approvers.rows.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            결재선 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({approvers.rows.length})</span>
          </h3>
          <CompactTable
            grid={approvers}
            onlyFields={['signorder', 'approvalorder', 'position', 'rank', 'empname', 'sname', 'name', 'approvalstatus', 'signstatus', 'opinion', 'comment']}
          />
        </section>
      )}
    </article>
  );
}

function VoucherForm({ grids, config }: { grids: ParsedGrid[]; config: CamsBrowserConfig }) {
  const main =
    grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '전표 정보') ||
    grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '품의 정보') ||
    grids[0];
  const lineItems = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '전표 명세');
  const files = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '첨부파일');
  const approvers = grids.find((g) => sectionLabelFor(g.id, g.fields, config) === '결재선');

  const m: Record<string, any> = (main?.rows?.[0] as any) || {};
  const get = (k: string) => String(m[k] ?? '').trim();
  const fmt = (k: string) => formatValue(k, m[k]);

  const slpno = get('slpno') || get('no');
  const slpdt = fmt('slpdt') || fmt('accdate') || fmt('date');
  const inpdt = fmt('inpdt') || fmt('inputdate');
  const sname = get('sname') || get('drafter') || get('regname');
  const trtype = get('trantype') || get('tranggu') || get('trgubun') || get('dealtype');
  const apryn = get('apryn') || get('signyn') || get('approveyn');
  const cancelyn = get('cancelyn') || get('canceln');
  const aprdt = fmt('aprdt') || fmt('apdt') || fmt('signdt') || fmt('signdate');

  return (
    <article style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '32px 28px', position: 'relative' }}>
      {approvers && approvers.rows.length > 0 && (
        <div style={{ position: 'absolute', top: 24, right: 24 }}>
          <ApprovalBox grid={approvers} />
        </div>
      )}

      <h1 style={{ fontSize: 30, fontWeight: 800, textAlign: 'center', letterSpacing: '0.5em', margin: '0 0 32px 0', color: '#0f172a', textIndent: '0.5em' }}>
        전 표
      </h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 110 }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th style={formHeader}>전표번호</th>
            <td style={{ ...formCell, fontFamily: 'monospace' }}>{slpno}</td>
            <th style={formHeader}>기표일자</th>
            <td style={formCell}>{slpdt}</td>
          </tr>
          <tr>
            <th style={formHeader}>품의자</th>
            <td style={formCell}>{sname}</td>
            <th style={formHeader}>거래형태</th>
            <td style={formCell}>{trtype}</td>
          </tr>
          {(inpdt || aprdt) && (
            <tr>
              <th style={formHeader}>입력일</th>
              <td style={formCell}>{inpdt}</td>
              <th style={formHeader}>결재일</th>
              <td style={formCell}>{aprdt}</td>
            </tr>
          )}
          {(apryn || cancelyn) && (
            <tr>
              <th style={formHeader}>결재여부</th>
              <td style={formCell}>{apryn}</td>
              <th style={formHeader}>취소여부</th>
              <td style={formCell}>{cancelyn}</td>
            </tr>
          )}
        </tbody>
      </table>

      {lineItems && lineItems.rows.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <div style={{ border: '1px solid #94a3b8', borderRadius: 4, overflow: 'hidden' }}>
            <VoucherLedger grid={lineItems} />
          </div>
        </section>
      )}

      {files && files.rows.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            첨부파일 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({files.rows.length})</span>
          </h3>
          <CompactTable grid={files} />
        </section>
      )}

      {approvers && approvers.rows.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            결재선 <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>({approvers.rows.length})</span>
          </h3>
          <CompactTable
            grid={approvers}
            onlyFields={['signorder', 'approvalorder', 'position', 'rank', 'empname', 'sname', 'name', 'approvalstatus', 'signstatus', 'opinion', 'comment']}
          />
        </section>
      )}
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
  const drcrKey = ['drcr', 'drcrgb', 'drcrgubun', 'gubun'].find((k) => fields.has(k));
  const acctCdKey = ['acctcd', 'accountcd', 'acctcode'].find((k) => fields.has(k));
  const acctNmKey = ['acctnm', 'accountnm', 'acctname'].find((k) => fields.has(k));
  const amtKey = ['amount', 'amt', 'totamt'].find((k) => fields.has(k));
  const noteKey = ['summary', 'aspnote', 'note', 'remarks', 'content', 'contents'].find((k) => fields.has(k));
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <LedgerSide title="차변" rows={debitRows} total={debitTotal} showAcctNm={showAcctNm} showCost={showCost} />
      <LedgerSide title="대변" rows={creditRows} total={creditTotal} showAcctNm={showAcctNm} showCost={showCost} borderLeft />
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
}: {
  title: string;
  rows: Array<{ acctcd?: string; acctnm?: string; amt: number; note?: string; costgb?: string; costown?: string; _index: number }>;
  total: number;
  showAcctNm: boolean;
  showCost: boolean;
  borderLeft?: boolean;
}) {
  // Total table column count for the totals row's `colSpan`.
  const totalCols = 1 /* 계정코드 */ + (showAcctNm ? 1 : 0) + 1 /* 적요 */ + (showCost ? 2 : 0) + 1 /* 금액 */;
  return (
    <div style={{ borderLeft: borderLeft ? '1px solid #e5e7eb' : 'none' }}>
      <div style={{ background: '#f8fafc', padding: '8px 12px', fontSize: 12, fontWeight: 800, color: title === '차변' ? '#0F3D73' : '#9F1239', borderBottom: '1px solid #e5e7eb' }}>
        {title}
      </div>
      {rows.length === 0 ? (
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
  const cols = onlyFields
    ? (() => {
        const filtered = onlyFields.filter((f) => grid.fields.includes(f));
        return filtered.length > 0 ? filtered : grid.fields;
      })()
    : grid.fields;
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
                <td key={c} style={td}>{formatValue(c, row[c])}</td>
              ))}
            </tr>
          ))}
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
  if (fset.has('filename') || fset.has('imgsort') || fset.has('sort')) return '첨부파일';
  // Voucher line items typically have an account/debit/credit shape.
  // Single-row totals grids on the voucher detail page (one for debit
  // total, one for credit total). VoucherLedger already shows totals
  // beneath each side, so these grids are redundant — Doc filters them
  // out by checking for this label.
  if (
    (fset.has('dramt') || fset.has('drsum') || fset.has('drtot') || fset.has('debitsum') ||
     fset.has('cramt') || fset.has('crsum') || fset.has('crtot') || fset.has('creditsum'))
    && !fset.has('acctcd')
  ) return '_totals';
  if (fset.has('debit') || fset.has('credit') || fset.has('acctcd') || fset.has('acctnm')) return '전표 명세';
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
