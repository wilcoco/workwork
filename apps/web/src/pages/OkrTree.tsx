import { useEffect, useMemo, useState, Fragment } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function OkrTree() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // KR.id -> expanded
  const defaultExpandDepth = 99; // 기본으로 대부분의 하위 트리를 펼침
  const [userId, setUserId] = useState<string>('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [krProg, setKrProg] = useState<Record<string, { latestValue: number | null; latestPeriodEnd: string | null; warn: boolean }>>({});

  function roleLabel(r?: string) {
    if (r === 'CEO') return '대표';
    if (r === 'EXEC') return '임원';
    if (r === 'MANAGER') return '팀장';
    if (r === 'INDIVIDUAL') return '팀원';
    return r || '';
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await apiJson<{ items: any[] }>(`/api/okrs/map`);
        setItems(r.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const allKrs: Array<{ id: string; target: number | null }> = [];
        function collect(o: any) {
          for (const kr of (o?.keyResults || [])) {
            allKrs.push({ id: kr.id, target: typeof kr.target === 'number' ? kr.target : null });
            for (const child of (kr.children || [])) collect(child);
          }
        }
        for (const o of items) collect(o);
        const uid = userId || (typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '');
        if (!uid) { setKrProg({}); return; }
        const entries = await Promise.all(allKrs.map(async (k) => {
          try {
            const pr = await apiJson<{ items: any[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(k.id)}&actorId=${encodeURIComponent(uid)}`);
            const latest = (pr.items || [])[0] || null;
            const latestValue = latest?.krValue ?? null;
            const latestPeriodEnd = latest?.periodEnd ?? null;
            let warn = false;
            if (latest && latestValue != null && latestPeriodEnd && typeof k.target === 'number') {
              if (new Date(latestPeriodEnd) < new Date() && latestValue < (k.target as number)) warn = true;
            }
            return [k.id, { latestValue, latestPeriodEnd, warn }] as const;
          } catch {
            return [k.id, { latestValue: null, latestPeriodEnd: null, warn: false }] as const;
          }
        }));
        const map: Record<string, { latestValue: number | null; latestPeriodEnd: string | null; warn: boolean }> = {};
        for (const [id, v] of entries) map[id] = v;
        setKrProg(map);
      } catch {}
    })();
  }, [items, userId]);

  useEffect(() => {
    (async () => {
      const uid = localStorage.getItem('userId') || '';
      setUserId(uid);
      if (!uid) return;
      try {
        const me = await apiJson<{ id: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | '' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        setMyRole((me as any).role || '');
      } catch {}
    })();
  }, []);

  const itemsSorted = useMemo(() => {
    const order: Record<string, number> = { CEO: 0, EXEC: 1, MANAGER: 2, INDIVIDUAL: 3 } as any;
    const onlyOkrs = items.filter((o: any) => !o.pillar);
    return [...onlyOkrs].sort((a, b) => {
      const ra = order[(a?.owner?.role as any) || 'INDIVIDUAL'] ?? 99;
      const rb = order[(b?.owner?.role as any) || 'INDIVIDUAL'] ?? 99;
      if (ra !== rb) return ra - rb;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }, [items]);

  function ObjectiveCard({ o, depth }: { o: any; depth: number }) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{`${roleLabel(o.owner?.role)}-${o.owner?.name || ''}`}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{(o.periodStart ? formatKstDatetime(o.periodStart) : '-') + ' ~ ' + (o.periodEnd ? formatKstDatetime(o.periodEnd) : '-')}</div>
          {myRole === 'CEO' && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (!confirm('해당 Objective를 삭제할까요?')) return;
                try {
                  await apiJson(`/api/okrs/objectives/${encodeURIComponent(o.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                  const r = await apiJson<{ items: any[] }>(`/api/okrs/map`);
                  setItems(r.items || []);
                } catch (e: any) {
                  alert(e?.message || '삭제 실패');
                }
              }}
            >삭제</button>
          )}
        </div>
        <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
        {o.description && <div style={{ marginTop: 6, color: '#374151' }}>{o.description}</div>}

        {/* KRs */}
        {o.keyResults?.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {o.keyResults.map((kr: any) => {
              const lv = krProg[kr.id]?.latestValue;
              const lpe = krProg[kr.id]?.latestPeriodEnd ? new Date(krProg[kr.id]!.latestPeriodEnd as any) : null;
              const pe = o.periodEnd ? new Date(o.periodEnd) : null;
              let bg: string | undefined = undefined;
              if (pe) {
                const deadline = new Date(pe.getFullYear(), pe.getMonth() + 1, 0, 23, 59, 59, 999);
                const passed = new Date() > deadline;
                const entered = !!lpe && lpe.getTime() >= deadline.getTime();
                if (passed && !entered) bg = '#fee2e2';
                else if (lv != null && typeof kr.target === 'number') {
                  const dir = (kr as any)?.direction || 'AT_LEAST';
                  const violate = dir === 'AT_LEAST' ? (lv < kr.target) : (lv > kr.target);
                  if (violate) bg = '#ffedd5';
                }
              } else if (lv != null && typeof kr.target === 'number') {
                const dir = (kr as any)?.direction || 'AT_LEAST';
                const violate = dir === 'AT_LEAST' ? (lv < kr.target) : (lv > kr.target);
                if (violate) bg = '#ffedd5';
              }
              const defaultOpen = depth < defaultExpandDepth;
              const isOpen = (expanded[kr.id] ?? defaultOpen) as boolean;
              return (
              <div key={kr.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: bg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>KR:</div>
                  <div>{kr.title}</div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(() => {
                      const lv = krProg[kr.id]?.latestValue;
                      const tgt = typeof kr.target === 'number' ? kr.target : null;
                      const dir = (kr as any)?.direction || 'AT_LEAST';
                      const achieved = lv != null && tgt != null && (dir === 'AT_LEAST' ? (lv >= tgt) : (lv <= tgt));
                      if (lv == null || tgt == null) return null;
                      return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: achieved ? '#065f46' : '#991b1b', background: achieved ? '#d1fae5' : '#fee2e2', border: '1px solid', borderColor: achieved ? '#10b981' : '#ef4444', borderRadius: 999, padding: '2px 6px' }}>
                          {achieved ? '달성' : '미달'}
                        </span>
                      );
                    })()}
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      {kr.metric}
                      {kr.target != null ? ` / ${kr.target}${kr.unit ? ' ' + kr.unit : ''}` : ''}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: krProg[kr.id]?.warn ? '#991b1b' : '#0f172a' }}>
                      {'달성: '}{krProg[kr.id]?.latestValue == null ? '-' : `${krProg[kr.id]?.latestValue}${kr.unit ? ' ' + kr.unit : ''}`}
                    </span>
                    {myRole === 'CEO' && (
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          if (!confirm('해당 KR을 삭제할까요?')) return;
                          try {
                            await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                            const r = await apiJson<{ items: any[] }>(`/api/okrs/map`);
                            setItems(r.items || []);
                          } catch (e: any) {
                            alert(e?.message || '삭제 실패');
                          }
                        }}
                      >삭제</button>
                    )}
                    <button className="btn btn-ghost" onClick={() => setExpanded((prev) => ({ ...prev, [kr.id]: !isOpen }))}>
                      {isOpen ? '접기' : `하위 보기 (${(kr.children || []).length})`}
                    </button>
                  </div>
                </div>
                {/* Child objectives under this KR */}
                {isOpen && kr.children?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    {[...kr.children].filter((c: any) => !c.pillar).sort((a: any, b: any) => {
                      const order: Record<string, number> = { CEO: 0, EXEC: 1, MANAGER: 2, INDIVIDUAL: 3 } as any;
                      const ra = order[(a?.owner?.role as any) || 'INDIVIDUAL'] ?? 99;
                      const rb = order[(b?.owner?.role as any) || 'INDIVIDUAL'] ?? 99;
                      if (ra !== rb) return ra - rb;
                      return String(a.title || '').localeCompare(String(b.title || ''));
                    }).map((child: any) => (
                      <ObjectiveCard key={child.id} o={child} depth={depth + 1} />
                    ))}
                  </div>
                )}
              </div>
            );})}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12, maxWidth: 1080, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>OKR 조회</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={loading} onClick={() => window.location.reload()} className="btn btn-primary">새로고침</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {itemsSorted.map((o) => (
          <ObjectiveCard key={o.id} o={o} depth={0} />
        ))}
        {!items.length && !loading && <div style={{ color: '#64748b' }}>표시할 OKR이 없습니다.</div>}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};
