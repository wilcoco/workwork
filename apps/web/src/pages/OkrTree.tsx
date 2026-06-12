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
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | ''>('');
  const [krProg, setKrProg] = useState<Record<string, { latestValue: number | null; latestPeriodEnd: string | null; latestCreatedAt: string | null; warn: boolean; history: Array<{ label: string; value: number | null; createdAt?: string | null }>; stalenessDays: number | null; status: 'On Track' | 'At Risk' | 'Off Track' | '-' }>>({});
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [filterDivisionId, setFilterDivisionId] = useState<string>('');
  const [filterTeamId, setFilterTeamId] = useState<string>('');
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [isMobile, setIsMobile] = useState(false);
  // 인라인 수정 상태 (본인 작성분 또는 대표)
  const [editObj, setEditObj] = useState<{ id: string; title: string; description: string } | null>(null);
  const [editKr, setEditKr] = useState<{ id: string; title: string; metric: string; target: string; unit: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  async function reloadMap() {
    const r = await apiJson<{ items: any[] }>(`/api/okrs/map`);
    setItems(r.items || []);
  }

  async function saveEditObj() {
    if (!editObj) return;
    if (!editObj.title.trim()) { alert('제목을 입력하세요'); return; }
    setEditSaving(true);
    try {
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(editObj.id)}?userId=${encodeURIComponent(userId)}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editObj.title, description: editObj.description || undefined }),
      });
      setEditObj(null);
      await reloadMap();
    } catch (e: any) {
      alert(e?.message || '수정 실패');
    } finally {
      setEditSaving(false);
    }
  }

  async function saveEditKr() {
    if (!editKr) return;
    if (!editKr.title.trim()) { alert('제목을 입력하세요'); return; }
    setEditSaving(true);
    try {
      await apiJson(`/api/okrs/krs/${encodeURIComponent(editKr.id)}?userId=${encodeURIComponent(userId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editKr.title,
          metric: editKr.metric || undefined,
          target: editKr.target !== '' ? Number(editKr.target) : undefined,
          unit: editKr.unit || undefined,
        }),
      });
      setEditKr(null);
      await reloadMap();
    } catch (e: any) {
      alert(e?.message || '수정 실패');
    } finally {
      setEditSaving(false);
    }
  }

  function roleLabel(r?: string) {
    if (r === 'CEO') return '대표';
    if (r === 'EXEC') return '임원';
    if (r === 'MANAGER') return '팀장';
    if (r === 'INDIVIDUAL') return '팀원';
    if (r === 'EXTERNAL') return '조직외';
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
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const o = await apiJson<{ items: any[] }>(`/api/orgs`);
        setOrgs(o.items || []);
      } catch {}
      try {
        const u = await apiJson<{ items: any[] }>(`/api/users`);
        setUsers(u.items || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const allKrs: Array<{ id: string; target: number | null; direction: 'AT_LEAST' | 'AT_MOST' | null }> = [];
        function collect(o: any) {
          for (const kr of (o?.keyResults || [])) {
            allKrs.push({ id: kr.id, target: typeof kr.target === 'number' ? kr.target : null, direction: (kr as any)?.direction ?? null });
            for (const child of (kr.children || [])) collect(child);
          }
        }
        for (const o of items) collect(o);
        const uid = userId || (typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '');
        if (!uid) { setKrProg({}); return; }
        function labelForPeriodMonthly(ps?: string) {
          if (!ps) return '';
          const d = new Date(ps);
          const yy = String(d.getFullYear()).slice(2);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          return `${yy}-${mm}`;
        }
        const entries = await Promise.all(allKrs.map(async (k) => {
          try {
            const pr = await apiJson<{ items: any[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(k.id)}&actorId=${encodeURIComponent(uid)}`);
            const latest = (pr.items || [])[0] || null;
            const latestValue = latest?.krValue ?? null;
            const latestPeriodEnd = latest?.periodEnd ?? null;
            const latestCreatedAt = latest?.createdAt ?? null;
            let warn = false;
            if (latest && latestValue != null && latestPeriodEnd && typeof k.target === 'number') {
              // direction unknown here; assume AT_LEAST for OKR default
              if (new Date(latestPeriodEnd) < new Date() && latestValue < (k.target as number)) warn = true;
            }
            const history = (pr.items || []).map((e: any) => ({ label: labelForPeriodMonthly(e.periodStart), value: e.krValue ?? null, createdAt: e.createdAt || null }));
            const stalenessDays = latestCreatedAt ? Math.floor((Date.now() - new Date(latestCreatedAt).getTime()) / (1000*60*60*24)) : null;
            let status: 'On Track' | 'At Risk' | 'Off Track' | '-' = '-';
            if (latestValue != null && typeof k.target === 'number' && k.target !== 0) {
              const dir = (k.direction || 'AT_LEAST') as 'AT_LEAST' | 'AT_MOST';
              const diff = dir === 'AT_LEAST' ? (latestValue - (k.target as number)) : ((k.target as number) - latestValue);
              const pct = diff / Math.abs(k.target as number);
              status = pct >= 0 ? 'On Track' : (pct >= -0.10 ? 'At Risk' : 'Off Track');
            }
            return [k.id, { latestValue, latestPeriodEnd, latestCreatedAt, warn, history, stalenessDays, status }] as [string, { latestValue: number | null; latestPeriodEnd: string | null; latestCreatedAt: string | null; warn: boolean; history: Array<{ label: string; value: number | null; createdAt?: string | null }>; stalenessDays: number | null; status: 'On Track' | 'At Risk' | 'Off Track' | '-' }];
          } catch {
            return [k.id, { latestValue: null, latestPeriodEnd: null, latestCreatedAt: null, warn: false, history: [] as Array<{ label: string; value: number | null; createdAt?: string | null }>, stalenessDays: null, status: '-' }] as [string, { latestValue: number | null; latestPeriodEnd: string | null; latestCreatedAt: string | null; warn: boolean; history: Array<{ label: string; value: number | null; createdAt?: string | null }>; stalenessDays: number | null; status: 'On Track' | 'At Risk' | 'Off Track' | '-' }];
          }
        }));
        const map: Record<string, { latestValue: number | null; latestPeriodEnd: string | null; latestCreatedAt: string | null; warn: boolean; history: Array<{ label: string; value: number | null; createdAt?: string | null }>; stalenessDays: number | null; status: 'On Track' | 'At Risk' | 'Off Track' | '-' }> = {};
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

  const divisions = useMemo(() => (orgs || []).filter((o: any) => o.type === 'DIVISION'), [orgs]);
  const teams = useMemo(() => (orgs || []).filter((o: any) => o.type === 'TEAM'), [orgs]);

  function matches(o: any): boolean {
    if (filterTeamId && String(o?.orgUnit?.id || '') !== filterTeamId) return false;
    if (filterDivisionId) {
      const ou = o?.orgUnit;
      const ok = String(ou?.id || '') === filterDivisionId || String((ou as any)?.parentId || '') === filterDivisionId;
      if (!ok) return false;
    }
    if (filterUserId && String(o?.owner?.id || '') !== filterUserId) return false;
    return true;
  }

  function hasMatch(o: any): boolean {
    if (matches(o)) return true;
    for (const kr of (o?.keyResults || [])) {
      for (const child of (kr?.children || [])) {
        if (hasMatch(child)) return true;
      }
    }
    return false;
  }

  const filteredRoots = useMemo(() => {
    const anyFilter = !!(filterTeamId || filterDivisionId || filterUserId);
    if (!anyFilter) return itemsSorted;
    return itemsSorted.filter((o: any) => hasMatch(o));
  }, [itemsSorted, filterTeamId, filterDivisionId, filterUserId]);

  function ObjectiveCard({ o, depth }: { o: any; depth: number }) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{`${roleLabel(o.owner?.role)}-${o.owner?.name || ''}`}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{(o.periodStart ? formatKstDatetime(o.periodStart) : '-') + ' ~ ' + (o.periodEnd ? formatKstDatetime(o.periodEnd) : '-')}</div>
          {(myRole === 'CEO' || o.owner?.id === userId) && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setEditObj({ id: o.id, title: o.title || '', description: o.description || '' })}
              >수정</button>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  if (!confirm('해당 Objective를 삭제할까요?\n하위 KR/과제/진척 기록이 함께 삭제됩니다.')) return;
                  try {
                    await apiJson(`/api/okrs/objectives/${encodeURIComponent(o.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                    await reloadMap();
                  } catch (e: any) {
                    alert(e?.message || '삭제 실패');
                  }
                }}
              >삭제</button>
            </>
          )}
        </div>
        {editObj && editObj.id === o.id ? (
          <div style={{ marginTop: 8, display: 'grid', gap: 6, background: '#F8FAFC', border: '1px solid #cbd5e1', borderRadius: 8, padding: 10 }}>
            <input
              value={editObj.title}
              onChange={(e) => setEditObj((p) => (p ? { ...p, title: e.target.value } : p))}
              placeholder="Objective 제목"
              style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, fontWeight: 700 }}
            />
            <textarea
              value={editObj.description}
              onChange={(e) => setEditObj((p) => (p ? { ...p, description: e.target.value } : p))}
              placeholder="설명 (선택)"
              rows={2}
              style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setEditObj(null)} disabled={editSaving}>취소</button>
              <button className="btn" onClick={saveEditObj} disabled={editSaving} style={{ background: '#0F3D73', color: '#fff' }}>{editSaving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
            {o.description && <div style={{ marginTop: 6, color: '#374151' }}>{o.description}</div>}
          </>
        )}

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
                    {(() => {
                      const st = krProg[kr.id]?.status;
                      const h = krProg[kr.id]?.history || [];
                      if (!h.length) {
                        return (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: '#f1f5f9', border: '1px solid #e5e7eb', borderRadius: 999, padding: '2px 6px' }}>
                            기록없음
                          </span>
                        );
                      }
                      return st && st !== '-' ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: st === 'On Track' ? '#065f46' : st === 'At Risk' ? '#92400e' : '#991b1b', background: st === 'On Track' ? '#d1fae5' : st === 'At Risk' ? '#fef3c7' : '#fee2e2', border: '1px solid', borderColor: st === 'On Track' ? '#10b981' : st === 'At Risk' ? '#f59e0b' : '#ef4444', borderRadius: 999, padding: '2px 6px' }}>
                          {st}
                        </span>
                      ) : null;
                    })()}
                    {(() => {
                      const h = krProg[kr.id]?.history || [];
                      const vals = h.slice(0, 6).map((e) => (typeof e.value === 'number' ? e.value : null)).reverse();
                      const defined = vals.filter((v) => v != null) as number[];
                      if (!defined.length) return null;
                      const w = 60, he = 24, pad = 2;
                      const min = Math.min(...defined, 0);
                      const max = Math.max(...defined, (kr.target || 0) as number);
                      const scaleY = (v: number) => {
                        if (max === min) return he/2;
                        return he - pad - ((v - min) / (max - min)) * (he - pad*2);
                      };
                      const pts = defined.map((v, i) => `${(i*(w/(defined.length-1))).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');
                      const tgtY = kr.target != null ? scaleY(kr.target) : null;
                      return (
                        <svg width={w} height={he}>
                          <polyline fill="none" stroke="#0F3D73" strokeWidth="1.5" points={pts} />
                          {tgtY != null && <line x1={0} x2={w} y1={tgtY} y2={tgtY} stroke="#94a3b8" strokeDasharray="2,2" />}
                        </svg>
                      );
                    })()}
                    {typeof krProg[kr.id]?.stalenessDays === 'number' && (
                      <span style={{ fontSize: 11, color: (krProg[kr.id]!.stalenessDays as number) >= 30 ? '#991b1b' : (krProg[kr.id]!.stalenessDays as number) >= 14 ? '#92400e' : '#475569' }}>⏱ {krProg[kr.id]?.stalenessDays}일</span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: 700, color: krProg[kr.id]?.warn ? '#991b1b' : '#0f172a' }}>
                      {'달성: '}{krProg[kr.id]?.latestValue == null ? '-' : `${krProg[kr.id]?.latestValue}${kr.unit ? ' ' + kr.unit : ''}`}
                    </span>
                    {(myRole === 'CEO' || kr.ownerId === userId || o.owner?.id === userId) && (
                      <>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setEditKr({ id: kr.id, title: kr.title || '', metric: kr.metric || '', target: kr.target != null ? String(kr.target) : '', unit: kr.unit || '' })}
                        >수정</button>
                        <button
                          className="btn btn-ghost"
                          onClick={async () => {
                            if (!confirm('해당 KR을 삭제할까요?\n하위 과제/진척 기록이 함께 삭제됩니다.')) return;
                            try {
                              await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                              await reloadMap();
                            } catch (e: any) {
                              alert(e?.message || '삭제 실패');
                            }
                          }}
                        >삭제</button>
                      </>
                    )}
                    <button className="btn btn-ghost" onClick={() => setExpanded((prev) => ({ ...prev, [kr.id]: !isOpen }))}>
                      {isOpen ? '접기' : `하위 보기 (${(kr.children || []).length})`}
                    </button>
                  </div>
                </div>
                {editKr && editKr.id === kr.id && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 6, background: '#F8FAFC', border: '1px solid #cbd5e1', borderRadius: 8, padding: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr', gap: 6 }}>
                      <input value={editKr.title} onChange={(e) => setEditKr((p) => (p ? { ...p, title: e.target.value } : p))} placeholder="KR 제목" style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
                      <input value={editKr.metric} onChange={(e) => setEditKr((p) => (p ? { ...p, metric: e.target.value } : p))} placeholder="지표명" style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
                      <input type="number" step="any" value={editKr.target} onChange={(e) => setEditKr((p) => (p ? { ...p, target: e.target.value } : p))} placeholder="목표값" style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
                      <input value={editKr.unit} onChange={(e) => setEditKr((p) => (p ? { ...p, unit: e.target.value } : p))} placeholder="단위" style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost" onClick={() => setEditKr(null)} disabled={editSaving}>취소</button>
                      <button className="btn" onClick={saveEditKr} disabled={editSaving} style={{ background: '#0F3D73', color: '#fff' }}>{editSaving ? '저장 중…' : '저장'}</button>
                    </div>
                  </div>
                )}
                {/* Child objectives under this KR */}
                {isOpen && kr.children?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    {[...kr.children].filter((c: any) => !c.pillar && hasMatch(c)).sort((a: any, b: any) => {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(220px, 1fr)) auto', alignItems: 'center', width: '100%' }}>
          <select value={filterDivisionId} onChange={(e) => { setFilterDivisionId(e.target.value); }} style={{ width: '100%' }}>
            <option value="">실(전체)</option>
            {divisions.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={filterTeamId} onChange={(e) => { setFilterTeamId(e.target.value); }} style={{ width: '100%' }}>
            <option value="">팀(전체)</option>
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select value={filterUserId} onChange={(e) => { setFilterUserId(e.target.value); }} style={{ width: '100%' }}>
            <option value="">이름(전체)</option>
            {users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button disabled={loading} onClick={() => window.location.reload()} className="btn btn-primary">새로고침</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {filteredRoots.map((o) => (
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
