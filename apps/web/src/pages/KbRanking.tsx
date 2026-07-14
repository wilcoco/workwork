import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

/** 지식 정리 랭킹 — AI 심사를 통과한 '지식 배지' 업무일지 수 상위 구성원 */
type Row = { userId: string; name: string; teamName: string; badgeCount: number; worklogCount: number };

export function KbRanking() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiJson<{ items: Row[] }>(`/api/worklogs/kb-ranking?month=${all ? 'all' : encodeURIComponent(month)}`)
      .then((r) => setRows(r.items || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [month, all]);

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>🏅 지식 정리 랭킹</h2>
        <input type="month" value={month} disabled={all} onChange={(e) => setMonth(e.target.value)} style={{ padding: '4px 8px', fontSize: 13 }} />
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 전체 기간
        </label>
      </div>
      <div style={{ fontSize: 13, color: '#64748b' }}>
        업무일지가 <b>원인 분석·재발방지·재사용 가능한 노하우</b>를 담고 있으면 AI 심사를 통과해 지식 배지 🏅를 받습니다.
        단순 결과 나열이 아닌, 다른 사람이 배울 수 있는 기록을 남긴 분들의 순위입니다.
      </div>
      {loading ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>로딩 중…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>아직 지식 배지를 받은 업무일지가 없습니다. 첫 주인공이 되어보세요!</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map((r, i) => (
            <div key={r.userId} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', background: i < 3 ? '#fffbeb' : '#fff' }}>
              <span style={{ fontSize: i < 3 ? 22 : 14, width: 34, textAlign: 'center', fontWeight: 700, color: '#64748b' }}>{medal(i)}</span>
              <span style={{ fontWeight: 700, flex: 1 }}>{r.name} <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>{r.teamName}</span></span>
              <span style={{ fontWeight: 800, color: '#b45309' }}>🏅 {r.badgeCount}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>/ 일지 {r.worklogCount}건</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
