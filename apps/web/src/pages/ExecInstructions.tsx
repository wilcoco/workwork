import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

type InstItem = {
  id: string; summary: string; status: string; source: string;
  author: { id: string; name: string }; createdAt: string;
  milestoneCount: number; doneCount: number; reviewCount: number;
};
type AttnItem = { id: string; title: string; status: string; dueAt: string | null; instructionId: string; summary?: string };

const KIND_STYLE: Record<string, { label: string; color: string }> = {
  overdue: { label: '기한 초과', color: '#dc2626' },
  stalled: { label: '무소식', color: '#d97706' },
  reviewNeglected: { label: '검수 방치', color: '#7c3aed' },
};

export function ExecInstructions() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<InstItem[]>([]);
  const [attn, setAttn] = useState<{ overdue: AttnItem[]; stalled: AttnItem[]; reviewNeglected: AttnItem[] } | null>(null);
  const [statusF, setStatusF] = useState('ACTIVE');
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusF !== 'ALL') qs.set('status', statusF);
      if (mine && userId) qs.set('authorId', userId);
      const res = await apiJson<{ items: InstItem[] }>(`/api/exec-instructions?${qs.toString()}`);
      setItems(res.items || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [statusF, mine]);
  // 접속 시 정체 감시 요약 + 넛지 스윕
  useEffect(() => { if (userId) apiJson(`/api/exec-instructions/attention?userId=${encodeURIComponent(userId)}`).then((r: any) => setAttn(r)).catch(() => {}); }, [userId]);

  const attnAll: Array<{ kind: string; it: AttnItem }> = attn
    ? [...attn.overdue.map((it) => ({ kind: 'overdue', it })), ...attn.reviewNeglected.map((it) => ({ kind: 'reviewNeglected', it })), ...attn.stalled.map((it) => ({ kind: 'stalled', it }))]
    : [];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: '4px 0', flex: 1 }}>경영지시 팔로우업</h2>
        <button onClick={() => nav('/exec-instructions/new')} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>+ 지시 등록</button>
        <Link to="/exec-instructions/strategy" style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #cbd5e1', color: '#334155', textDecoration: 'none' }}>전략 통일성</Link>
      </div>

      {attnAll.length > 0 && (
        <div style={{ border: '1px solid #fecaca', background: '#fff7f7', borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>🚨 주의 필요 ({attnAll.length})</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {attnAll.map(({ kind, it }) => (
              <Link key={kind + it.id} to={`/exec-instructions/${it.instructionId}`} style={{ display: 'flex', gap: 8, alignItems: 'center', textDecoration: 'none', color: '#334155', fontSize: 13 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: KIND_STYLE[kind].color, minWidth: 62 }}>{KIND_STYLE[kind].label}</span>
                <span style={{ fontWeight: 600 }}>{it.title}</span>
                {it.dueAt && <span style={{ color: '#94a3b8' }}>· 기한 {new Date(it.dueAt).toLocaleDateString('ko-KR')}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <option value="ACTIVE">진행 지시</option>
          <option value="ARCHIVED">보관됨</option>
          <option value="ALL">전체</option>
        </select>
        <label style={{ fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내가 지시한 것
        </label>
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>불러오는 중…</div> : items.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>지시가 없습니다.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((i) => {
            const pct = i.milestoneCount ? Math.round((i.doneCount / i.milestoneCount) * 100) : 0;
            return (
              <Link key={i.id} to={`/exec-instructions/${i.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, flex: 1 }}>{i.summary || '(내용 없음)'}</span>
                    {i.source === 'VOICE' && <span title="음성 지시" style={{ fontSize: 12 }}>🎤</span>}
                    {i.reviewCount > 0 && <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 20 }}>검수 {i.reviewCount}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, fontSize: 12, color: '#64748b' }}>
                    <span>지시자 {i.author?.name}</span>
                    <span>· {new Date(i.createdAt).toLocaleDateString('ko-KR')}</span>
                    <div style={{ flex: 1 }} />
                    <div style={{ width: 120, height: 6, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16a34a' : '#2563eb' }} />
                    </div>
                    <span>{i.doneCount}/{i.milestoneCount} 완료</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
