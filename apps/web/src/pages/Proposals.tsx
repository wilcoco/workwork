import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

interface ProposalRow {
  index: number;
  title?: string;
  // Any additional `myDataGrid2_lblXXX_N` fields are returned dynamically
  // (e.g. date, amount, status). We render them generically.
  [key: string]: string | number | undefined;
}

interface ListResp {
  slpNo: string;
  count: number;
  items: ProposalRow[];
  sourceUrl: string;
}

export function Proposals() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResp | null>(null);

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchList() {
    setLoading(true);
    setError(null);
    try {
      // No slp_no -> backend hits the unfiltered list endpoint and returns
      // every proposal the upstream page exposes.
      const res = await apiJson<ListResp>(`/api/proposals/list`);
      // Show latest first. Upstream typically renders oldest at the top of
      // its DataGrid, so we reverse by row index DESC.
      const sorted = {
        ...res,
        items: [...(res.items || [])].sort((a, b) => Number(b.index) - Number(a.index)),
      };
      setData(sorted);
    } catch (e: any) {
      setError(e?.message || '조회 실패');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Build a stable column list across all rows so the table is uniform even
  // when one row is missing a field.
  const columns = (() => {
    const set = new Set<string>();
    for (const row of data?.items || []) {
      for (const k of Object.keys(row)) {
        if (k === 'index') continue;
        set.add(k);
      }
    }
    // Put 'title' first if present, then the rest alphabetically.
    const ordered: string[] = [];
    if (set.has('title')) {
      ordered.push('title');
      set.delete('title');
    }
    return [...ordered, ...Array.from(set).sort()];
  })();

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>품의서</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        CAMS 회계 시스템(<code>cn.icams.co.kr</code>)에서 결재 품의서 리스트를 조회합니다.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={fetchList}
          disabled={loading}
          style={{ background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? '조회 중…' : '새로고침'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
            조회 결과: <strong>{data.count}</strong>건
            {data.sourceUrl && (
              <> · <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8' }}>원본 페이지 열기 ↗</a></>
            )}
          </div>

          {data.items.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: 24, fontSize: 14, border: '1px dashed #cbd5e1', borderRadius: 12 }}>
              조회된 품의서가 없습니다.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={th}>#</th>
                    {columns.map((c) => (
                      <th key={c} style={th}>{labelFor(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row, i) => (
                    <tr key={row.index} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ ...td, color: '#94a3b8', width: 40 }}>{i + 1}</td>
                      {columns.map((c) => (
                        <td key={c} style={td}>{String(row[c] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 12, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', color: '#1e293b', verticalAlign: 'top' };

function labelFor(field: string): string {
  // Map common upstream field names to Korean labels. Unknown fields show
  // the raw key so we don't hide data.
  const map: Record<string, string> = {
    title: '제목',
    no: '번호',
    date: '일자',
    amt: '금액',
    amount: '금액',
    state: '상태',
    status: '상태',
    name: '작성자',
    user: '작성자',
    dept: '부서',
  };
  return map[field] || field;
}
