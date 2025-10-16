import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function MeGoals() {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<any[]>([]); // initiatives
  const [goals, setGoals] = useState<any[]>([]); // user goals
  const [myOkrs, setMyOkrs] = useState<any[]>([]);
  const [parentKrs, setParentKrs] = useState<any[]>([]);
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fType, setFType] = useState<'PROJECT' | 'OPERATIONAL'>('PROJECT');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [fCadence, setFCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');
  const [fAnchor, setFAnchor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [inits, myg, me, pks, mokrs] = await Promise.all([
        apiJson<{ items: any[] }>(`/api/initiatives/my?userId=${encodeURIComponent(userId)}`),
        apiJson<{ items: any[] }>(`/api/my-goals?userId=${encodeURIComponent(userId)}`),
        apiJson<{ id: string; name: string; role: string; teamName: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`),
        apiJson<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`),
        apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`),
      ]);
      setItems(inits.items || []);
      setGoals(myg.items || []);
      setMyRole((me.role as any) || '');
      setParentKrs(pks.items || []);
      setMyOkrs(mokrs.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const projects = items.filter((it) => it.type === 'PROJECT');
  const ops = items.filter((it) => it.type === 'OPERATIONAL');
  const [createOpen, setCreateOpen] = useState(false);
  const [gTitle, setGTitle] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gKind, setGKind] = useState<'QUALITATIVE' | 'QUANTITATIVE'>('QUALITATIVE');
  const [gMetric, setGMetric] = useState('');
  const [gTarget, setGTarget] = useState<string>('');
  const [gUnit, setGUnit] = useState('');
  const [gStart, setGStart] = useState('');
  const [gEnd, setGEnd] = useState('');
  const [creating, setCreating] = useState(false);

  // Build my O-KR under a parent KR
  const [roleSaving, setRoleSaving] = useState(false);
  const [parentKrId, setParentKrId] = useState('');
  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oStart, setOStart] = useState('');
  const [oEnd, setOEnd] = useState('');
  const [krTitle, setKrTitle] = useState('');
  const [krMetric, setKrMetric] = useState('');
  const [krTarget, setKrTarget] = useState<string>('');
  const [krUnit, setKrUnit] = useState('');
  const [krType, setKrType] = useState<'PROJECT' | 'OPERATIONAL'>('PROJECT');
  const [okrCreating, setOkrCreating] = useState(false);

  function toYmd(v?: string) {
    if (!v) return '';
    const d = new Date(v);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function beginEdit(it: any) {
    setEditingId(it.id);
    setFTitle(it.title || '');
    setFDesc(it.description || '');
    setFType(it.type || 'PROJECT');
    setFStart(toYmd(it.startAt));
    setFEnd(toYmd(it.endAt));
    setFCadence((it.cadence as any) || '');
    setFAnchor(it.cadenceAnchor || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setSaving(false);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/initiatives/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: fTitle || undefined,
          description: fDesc || undefined,
          type: fType,
          startAt: fStart || undefined,
          endAt: fEnd || undefined,
          cadence: fCadence || undefined,
          cadenceAnchor: fAnchor || undefined,
        }),
      });
      await load();
      setEditingId(null);
    } catch (e: any) {
      setError(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', display: 'grid', gap: 12, background: '#F8FAFC', padding: 12, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>내 목표</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCreateOpen((v) => !v)} style={ghostBtn}>{createOpen ? '닫기' : '신규 목표'}</button>
          <button disabled={!userId || loading} onClick={load} style={primaryBtn}>{loading ? '새로고침…' : '새로고침'}</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>내 역할 및 상위 O-KR 선택</h3>
        <div style={card}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
              <select value={myRole} onChange={async (e) => {
                const role = e.target.value as any;
                setMyRole(role);
                if (!userId) return;
                try {
                  setRoleSaving(true);
                  await apiJson(`/api/users/${encodeURIComponent(userId)}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
                  const p = await apiJson<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`);
                  setParentKrs(p.items || []);
                } finally {
                  setRoleSaving(false);
                }
              }} style={{ ...input, appearance: 'auto' as any }}>
                <option value="">역할 선택</option>
                <option value="CEO">대표이사</option>
                <option value="EXEC">임원</option>
                <option value="MANAGER">팀장</option>
                <option value="INDIVIDUAL">직원</option>
              </select>
              <select value={parentKrId} onChange={(e) => setParentKrId(e.target.value)} disabled={!myRole || myRole === 'CEO'} style={{ ...input, appearance: 'auto' as any }}>
                <option value="">상위 O-KR 선택 ({myRole === 'CEO' ? '최상위' : '필수'})</option>
                {parentKrs.map((kr) => (
                  <option key={kr.id} value={kr.id}>
                    [{kr.objective?.orgUnit?.name || '-'}] {kr.objective?.title} / KR: {kr.title}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              역할 변경 후 상위 O-KR 목록이 갱신됩니다. 대표이사는 상위 선택 없이 최상위 O를 생성합니다.
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>나의 O-KR 구성</h3>
        <div style={card}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input value={oTitle} onChange={(e) => setOTitle(e.target.value)} placeholder="나의 Objective 제목" style={input} />
              <input value={krTitle} onChange={(e) => setKrTitle(e.target.value)} placeholder="첫 Key Result 제목" style={input} />
            </div>
            <textarea value={oDesc} onChange={(e) => setODesc(e.target.value)} placeholder="Objective 설명" style={{ ...input, minHeight: 70 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input type="date" value={oStart} onChange={(e) => setOStart(e.target.value)} style={input} />
              <input type="date" value={oEnd} onChange={(e) => setOEnd(e.target.value)} style={input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <input value={krMetric} onChange={(e) => setKrMetric(e.target.value)} placeholder="KR 메트릭(예: %, 건수)" style={input} />
              <input type="number" step="any" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} placeholder="KR 목표값" style={input} />
              <input value={krUnit} onChange={(e) => setKrUnit(e.target.value)} placeholder="KR 단위(예: %, 건)" style={input} />
            </div>
            <div>
              <select value={krType} onChange={(e) => setKrType(e.target.value as any)} style={{ ...input, width: 'auto', appearance: 'auto' as any }}>
                <option value="PROJECT">프로젝트형 (간트)</option>
                <option value="OPERATIONAL">오퍼레이션형 (KPI)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={primaryBtn}
                disabled={okrCreating || !userId || !oTitle || !krTitle || !krMetric || !krTarget || !krUnit || !oStart || !oEnd || (!parentKrId && myRole !== 'CEO')}
                onClick={async () => {
                  try {
                    setOkrCreating(true);
                    const obj = await apiJson<{ id: string }>(`/api/okrs/objectives`, {
                      method: 'POST',
                      body: JSON.stringify({
                        userId,
                        title: oTitle,
                        description: oDesc || undefined,
                        periodStart: oStart,
                        periodEnd: oEnd,
                        alignsToKrId: myRole === 'CEO' ? undefined : (parentKrId || undefined),
                      }),
                    });
                    await apiJson(`/api/okrs/objectives/${encodeURIComponent((obj as any).id)}/krs`, {
                      method: 'POST',
                      body: JSON.stringify({
                        userId,
                        title: krTitle,
                        metric: krMetric,
                        target: Number(krTarget),
                        unit: krUnit,
                        type: krType,
                      }),
                    });
                    setOTitle(''); setODesc(''); setOStart(''); setOEnd(''); setKrTitle(''); setKrMetric(''); setKrTarget(''); setKrUnit(''); setKrType('PROJECT');
                    const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
                    setMyOkrs(mokrs.items || []);
                  } catch (e: any) {
                    setError(e.message || 'O-KR 생성 실패');
                  } finally {
                    setOkrCreating(false);
                  }
                }}
              >{okrCreating ? '생성중…' : 'O + KR 생성'}</button>
            </div>
          </div>
        </div>
      </section>

      {createOpen && (
        <div style={card}>
          <div style={{ display: 'grid', gap: 8 }}>
            <input value={gTitle} onChange={(e) => setGTitle(e.target.value)} placeholder="제목" style={input} />
            <textarea value={gDesc} onChange={(e) => setGDesc(e.target.value)} placeholder="설명" style={{ ...input, minHeight: 80 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select value={gKind} onChange={(e) => setGKind(e.target.value as any)} style={{ ...input, appearance: 'auto' as any }}>
                <option value="QUALITATIVE">QUALITATIVE</option>
                <option value="QUANTITATIVE">QUANTITATIVE</option>
              </select>
              <input value={gMetric} onChange={(e) => setGMetric(e.target.value)} placeholder="메트릭(예: %, 건수)" style={input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input type="number" step="any" value={gTarget} onChange={(e) => setGTarget(e.target.value)} placeholder="목표값" style={input} />
              <input value={gUnit} onChange={(e) => setGUnit(e.target.value)} placeholder="단위(예: %, 건)" style={input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input type="date" value={gStart} onChange={(e) => setGStart(e.target.value)} style={input} />
              <input type="date" value={gEnd} onChange={(e) => setGEnd(e.target.value)} style={input} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={primaryBtn}
                disabled={!gTitle || creating}
                onClick={async () => {
                  try {
                    setCreating(true);
                    await apiJson('/api/my-goals', {
                      method: 'POST',
                      body: JSON.stringify({
                        userId,
                        title: gTitle,
                        description: gDesc || undefined,
                        kind: gKind,
                        metric: gMetric || undefined,
                        target: gTarget ? Number(gTarget) : undefined,
                        unit: gUnit || undefined,
                        startAt: gStart || undefined,
                        endAt: gEnd || undefined,
                      }),
                    });
                    // reset form and reload
                    setGTitle(''); setGDesc(''); setGKind('QUALITATIVE'); setGMetric(''); setGTarget(''); setGUnit(''); setGStart(''); setGEnd('');
                    setCreateOpen(false);
                    await load();
                  } catch (e: any) {
                    setError(e.message || '생성 실패');
                  } finally {
                    setCreating(false);
                  }
                }}
              >{creating ? '생성중…' : '생성'}</button>
            </div>
          </div>
        </div>
      )}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>나의 O-KR 목록</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {myOkrs.map((o) => (
            <div key={o.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                  {o.orgUnit?.name || '-'}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  {(o.periodStart ? formatKstDatetime(o.periodStart) : '-') + ' ~ ' + (o.periodEnd ? formatKstDatetime(o.periodEnd) : '-')}
                </div>
              </div>
              <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
              {o.description && <div style={{ marginTop: 6, color: '#374151' }}>{o.description}</div>}
              {o.alignsToKr && (
                <div style={{ marginTop: 6, color: '#6b7280', fontSize: 13 }}>
                  상위: {o.alignsToKr.objective?.title} / KR: {o.alignsToKr.title}
                </div>
              )}
              {o.keyResults?.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                  {o.keyResults.map((kr: any) => (
                    <div key={kr.id} style={{ fontSize: 13, color: '#334155' }}>• KR: {kr.title} ({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''}) [{kr.type}]</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!myOkrs.length && <div style={{ color: '#64748b' }}>아직 나의 O-KR이 없습니다. 상단에서 역할/상위 O-KR을 선택하고 생성하세요.</div>}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>내 목표 목록</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {goals.map((g) => (
            <div key={g.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                  {g.kind}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  {(g.startAt ? formatKstDatetime(g.startAt) : '-') + ' ~ ' + (g.endAt ? formatKstDatetime(g.endAt) : '-')}
                </div>
              </div>
              <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{g.title}</div>
              {g.description && <div style={{ marginTop: 6, color: '#374151' }}>{g.description}</div>}
              {(g.metric || g.target || g.unit) && (
                <div style={{ marginTop: 6, color: '#475569', fontSize: 13 }}>
                  지표: {g.metric || '-'} / 목표: {g.target ?? '-'} {g.unit || ''}
                </div>
              )}
            </div>
          ))}
          {!goals.length && <div style={{ color: '#64748b' }}>아직 등록된 목표가 없습니다. 상단의 "신규 목표" 버튼으로 추가하세요.</div>}
        </div>
      </section>

      {/* 개인 과제 섹션은 추후 별도 페이지로 분리 예정 */}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '8px 12px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '8px 12px',
  fontWeight: 600,
};
