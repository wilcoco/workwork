import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/** 전사 매뉴얼 입력·프로세스화 현황 (팀장 이상) */
type ManualChip = { id: string; title: string; processed: boolean; updatedAt: string };
type Row = {
  userId: string; name: string; role: string; teamName: string;
  manualCount: number; processedCount: number; rate: number | null;
  staleCount: number; avgQuality: number | null; staleTitles: string[];
  manuals: ManualChip[];
};

export function ManualCoverageReport() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<{ users: number; usersWithManual: number; manuals: number; processed: number } | null>(null);
  const [error, setError] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ title: string; content: string; authorName: string; updatedAt: string } | null>(null);

  async function openManual(id: string) {
    try {
      const m = await apiJson<any>(`/api/work-manuals/report/manual/${encodeURIComponent(id)}?actorId=${encodeURIComponent(userId)}`);
      setViewer({ title: m.title, content: m.content || '', authorName: m.authorName || '', updatedAt: m.updatedAt });
    } catch (e: any) { alert(e?.message || '매뉴얼을 열 수 없습니다'); }
  }

  useEffect(() => {
    if (!userId) return;
    apiJson<{ items: Row[]; totals: any }>(`/api/work-manuals/report/coverage?actorId=${encodeURIComponent(userId)}`)
      .then((r) => { setRows(r.items || []); setTotals(r.totals || null); })
      .catch((e) => setError(e?.message || '조회 실패'));
  }, [userId]);

  const teams = useMemo(() => Array.from(new Set(rows.map((r) => r.teamName).filter(Boolean))).sort(), [rows]);
  const filtered = useMemo(() => rows.filter((r) => !teamFilter || r.teamName === teamFilter), [rows, teamFilter]);
  // 미입력 → 정체 → 진척 순으로 챙길 사람이 위로
  const sorted = useMemo(() => [...filtered].sort((a, b) => (a.manualCount - b.manualCount) || (b.staleCount - a.staleCount) || ((a.rate ?? 101) - (b.rate ?? 101))), [filtered]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13 };

  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>매뉴얼 입력 현황 (전사)</h2>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ padding: '4px 8px', fontSize: 13 }}>
          <option value="">전체 팀</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {totals && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: '대상 구성원', value: `${totals.users}명` },
            { label: '매뉴얼 입력자', value: `${totals.usersWithManual}명 (${totals.users ? Math.round((totals.usersWithManual / totals.users) * 100) : 0}%)` },
            { label: '전체 매뉴얼', value: `${totals.manuals}개` },
            { label: '프로세스화 완료', value: `${totals.processed}개 (${totals.manuals ? Math.round((totals.processed / totals.manuals) * 100) : 0}%)` },
          ].map((c) => (
            <div key={c.label} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 16px' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>구성원</th><th style={th}>팀</th>
              <th style={{ ...th, textAlign: 'right' }}>매뉴얼</th>
              <th style={{ ...th, textAlign: 'right' }}>프로세스화</th>
              <th style={{ ...th, textAlign: 'right' }}>진척율</th>
              <th style={{ ...th, textAlign: 'right' }}>정체(7일+)</th>
              <th style={{ ...th, textAlign: 'right' }}>품질점수</th>
              <th style={th}>비고</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => ([
              <tr key={r.userId} onClick={() => r.manualCount > 0 && setExpanded((prev) => { const n = new Set(prev); n.has(r.userId) ? n.delete(r.userId) : n.add(r.userId); return n; })}
                style={{ cursor: r.manualCount > 0 ? 'pointer' : undefined, ...(r.manualCount === 0 ? { background: '#fef2f2' } : r.staleCount > 0 ? { background: '#fffbeb' } : {}) }}>
                <td style={{ ...td, fontWeight: 600 }}>{r.manualCount > 0 ? (expanded.has(r.userId) ? '▾ ' : '▸ ') : ''}{r.name}</td>
                <td style={{ ...td, color: '#64748b' }}>{r.teamName || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.manualCount || <span style={{ color: '#dc2626', fontWeight: 700 }}>0</span>}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.processedCount}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: r.rate == null ? '#94a3b8' : r.rate >= 60 ? '#16a34a' : r.rate > 0 ? '#d97706' : '#dc2626' }}>
                  {r.rate == null ? '—' : `${r.rate}%`}
                </td>
                <td style={{ ...td, textAlign: 'right', color: r.staleCount ? '#d97706' : '#94a3b8', fontWeight: r.staleCount ? 700 : 400 }}>{r.staleCount || '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>{r.avgQuality ?? '—'}</td>
                <td style={{ ...td, fontSize: 11, color: '#94a3b8', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.manualCount === 0 ? '매뉴얼 미입력' : r.staleCount > 0 ? `프로세스화 정체: ${r.staleTitles.join(', ')}` : ''}
                </td>
              </tr>,
              expanded.has(r.userId) && r.manuals?.length ? (
                <tr key={`${r.userId}-x`}>
                  <td colSpan={8} style={{ ...td, background: '#f8fafc' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.manuals.map((m) => (
                        <button key={m.id} type="button" onClick={(e) => { e.stopPropagation(); void openManual(m.id); }}
                          title={`${new Date(m.updatedAt).toLocaleDateString()} · 클릭하면 내용을 봅니다`}
                          style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                            border: `1px solid ${m.processed ? '#86efac' : '#fcd34d'}`,
                            background: m.processed ? '#f0fdf4' : '#fffbeb',
                            color: m.processed ? '#15803d' : '#92400e' }}>
                          {m.processed ? '✓' : '○'} {m.title}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null,
            ]))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>
        빨간 행 = 매뉴얼 미입력 · 노란 행 = 입력했지만 7일 넘게 프로세스화가 안 된 매뉴얼 있음(내용이 부족해 진전이 안 되는 후보).
        행을 클릭하면 작성한 매뉴얼이 펼쳐지고, 매뉴얼을 클릭하면 내용을 볼 수 있습니다. (✓=프로세스화 완료, ○=전)
      </div>

      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 760, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <b style={{ fontSize: 16, flex: 1 }}>{viewer.title}</b>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{viewer.authorName} · {new Date(viewer.updatedAt).toLocaleDateString()}</span>
              <button className="btn btn-sm" onClick={() => setViewer(null)}>닫기</button>
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: '#334155' }}>{viewer.content || '(내용 없음)'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
