import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export function ApprovalsMine() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
    // auto load when available
    if (uid) void load(uid);
  }, []);

  async function load(reqUserId?: string) {
    const uid = reqUserId || userId;
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const list = await apiJson<{ items: any[] }>(`/api/approvals?requestedById=${encodeURIComponent(uid)}&limit=50`);
      const baseItems = list.items || [];
      // enrich worklog subjects with title/date
      const enriched = await Promise.all(baseItems.map(async (a: any) => {
        let docTitle: string | undefined;
        let docDate: string | undefined;
        if (a.subjectType === 'Worklog' && a.subjectId) {
          try {
            const wl = await apiJson<any>(`/api/worklogs/${encodeURIComponent(a.subjectId)}`);
            const note: string = wl?.note || '';
            const first = (note || '').split(/\n+/)[0] || '';
            docTitle = first || '(제목 없음)';
            if (wl?.date) docDate = wl.date;
          } catch {}
        }
        return { ...a, docTitle, docDate };
      }));
      setItems(enriched);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>내가 올린 결재 진행</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <input placeholder="내 User ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={input} />
        <button onClick={() => load()} disabled={!userId || loading} style={primaryBtn}>{loading ? '로딩…' : '불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((it) => (
          <div key={it.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>{it.docTitle || `${it.subjectType} / ${it.subjectId}`}</b>
              <span style={chip}>{it.status}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(it.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 12, color: '#334155' }}>
              작성자: {it.requestedBy?.name || '-'} ({it.requestedBy?.id || '-'})
              {it.docDate ? <> · 문서일자: {new Date(it.docDate).toLocaleDateString()}</> : null}
              {it.currentApprover?.name ? <> · 현재 결재자: {it.currentApprover.name}</> : null}
            </div>
          </div>
        ))}
        {!items.length && <div>표시된 진행 내역 없음</div>}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
};
