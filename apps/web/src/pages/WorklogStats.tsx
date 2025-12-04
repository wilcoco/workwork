import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

export function WorklogStats() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ from: string; to: string; days: number; total: number; teams: Array<{ teamName: string; total: number; members: Array<{ userName: string; count: number }> }> } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiJson(`/api/worklogs/stats/weekly?days=${encodeURIComponent(String(days))}`);
      setData(r);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [days]);

  const maxCount = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const t of data.teams) {
      for (const mbr of t.members) m = Math.max(m, mbr.count);
    }
    return m;
  }, [data]);

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>업무 현황</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={30}>최근 30일</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? '새로고침…' : '새로고침'}</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {!data && !loading && <div style={{ color: '#64748b' }}>데이터가 없습니다.</div>}
      {data && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ color: '#475569' }}>기간: {new Date(data.from).toLocaleString()} ~ {new Date(data.to).toLocaleString()} · 합계 {data.total}건</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {data.teams.map((t) => (
              <div key={t.teamName} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>{t.teamName}</h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>총 {t.total}건</span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {t.members.map((m) => {
                    const ratio = maxCount > 0 ? (m.count / maxCount) : 0;
                    const width = Math.max(4, Math.round(ratio * 100));
                    return (
                      <div key={m.userName} style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontWeight: 600 }}>{m.userName}</div>
                          <div style={{ color: '#475569' }}>{m.count}</div>
                        </div>
                        <div style={{ height: 12, background: '#f1f5f9', borderRadius: 999 }}>
                          <div style={{ width: `${width}%`, height: 12, background: '#0F3D73', borderRadius: 999 }} />
                        </div>
                      </div>
                    );
                  })}
                  {t.members.length === 0 && <div style={{ color: '#94a3b8' }}>구성원 데이터가 없습니다.</div>}
                </div>
              </div>
            ))}
            {data.teams.length === 0 && <div style={{ color: '#94a3b8' }}>팀 데이터가 없습니다.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
