import { Fragment, useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function MeGoals() {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<any[]>([]); // initiatives
  const [goals, setGoals] = useState<any[]>([]); // user goals
  const [myOkrs, setMyOkrs] = useState<any[]>([]);
  const [parentKrs, setParentKrs] = useState<any[]>([]);
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [myName, setMyName] = useState<string>('');
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

  const [teamOrgId, setTeamOrgId] = useState('');
  const [teamKrs, setTeamKrs] = useState<any[]>([]);
  const [tKrId, setTKrId] = useState('');
  const [tInitTitle, setTInitTitle] = useState('');
  const [tStart, setTStart] = useState('');
  const [tEnd, setTEnd] = useState('');
  const [tCadence, setTCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');
  const [tSaving, setTSaving] = useState(false);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      async function getOrDefault<T>(path: string, def: T): Promise<T> {
        try {
          return await apiJson<T>(path);
        } catch (e: any) {
          const msg = String(e?.message || '');
          const status = Number(e?.status || 0);
          if (status === 404 || msg.startsWith('Non-JSON response')) return def as T;
          throw e;
        }
      }
      const inits = await getOrDefault<{ items: any[] }>(`/api/initiatives/my?userId=${encodeURIComponent(userId)}`, { items: [] });
      const myg = await getOrDefault<{ items: any[] }>(`/api/my-goals?userId=${encodeURIComponent(userId)}`, { items: [] });
      const me = await getOrDefault<{ id: string; name: string; role: string; teamName: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`, { id: '', name: '', role: '', teamName: '' } as any);
      const orgs = await getOrDefault<{ items: any[] }>(`/api/orgs`, { items: [] });
      const myTeam = (orgs.items || []).find((o: any) => String(o?.name || '') === String((me as any).teamName || ''));
      const orgId = myTeam?.id || '';
      setTeamOrgId(orgId);
      if (orgId) {
        const teamObjs = await getOrDefault<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(orgId)}`, { items: [] });
        const krs = (teamObjs.items || []).flatMap((o: any) => (o.keyResults || []).map((kr: any) => ({
          id: kr.id,
          title: kr.title,
          metric: kr.metric,
          target: kr.target,
          unit: kr.unit,
          objective: { id: o.id, title: o.title },
        })));
        setTeamKrs(krs);
      } else {
        setTeamKrs([]);
      }
      const pks = await getOrDefault<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`, { items: [] });
      const mokrs = await getOrDefault<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`, { items: [] });
      setItems(inits.items || []);
      setGoals(myg.items || []);
      setMyRole(((me as any).role as any) || '');
      setMyName(((me as any).name as any) || '');
      setParentKrs(pks.items || []);
      setMyOkrs(mokrs.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function createPersonalTasks() {
    if (!userId || !pKrId || !pTitle) return;
    try {
      setError(null);
      const parent = await apiJson(`/api/initiatives`, {
        method: 'POST',
        body: JSON.stringify({
          keyResultId: pKrId,
          ownerId: userId,
          title: pTitle,
        }),
      });
      for (let i = 0; i < pRows.length; i++) {
        const row = pRows[i];
        const sel = row.months.map((v, idx) => (v ? idx : -1)).filter((v) => v >= 0);
        if (!sel.length) continue;
        const mStart = Math.min(...sel);
        const mEnd = Math.max(...sel);
        const s = new Date(2026, mStart, 1);
        const e = new Date(2026, mEnd + 1, 0);
        const sYmd = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;
        const eYmd = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2,'0')}-${String(e.getDate()).padStart(2,'0')}`;
        const title = row.title?.trim() || `세부 ${i + 1}`;
        await apiJson(`/api/initiatives`, {
          method: 'POST',
          body: JSON.stringify({
            keyResultId: pKrId,
            ownerId: userId,
            title,
            startAt: sYmd,
            endAt: eYmd,
            parentId: parent.id,
          }),
        });
      }
      setPTitle(''); setPRows([{ title: '', months: Array(12).fill(false) }]);
      const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
      setMyOkrs(mokrs.items || []);
    } catch (e: any) {
      setError(e.message || '과제 생성 실패');
    }
  }

  const [pKrId, setPKrId] = useState('');
  const [pTitle, setPTitle] = useState('');
  const [pRows, setPRows] = useState<Array<{ title: string; months: boolean[] }>>([{ title: '', months: Array(12).fill(false) }]);
  function togglePMonth(rIdx: number, mIdx: number) {
    setPRows((prev) => prev.map((r, i) => i === rIdx ? { ...r, months: r.months.map((v, j) => j === mIdx ? !v : v) } : r));
  }
  function addPRow() { setPRows((prev) => [...prev, { title: '', months: Array(12).fill(false) }]); }
  function removePRow(idx: number) { setPRows((prev) => prev.filter((_, i) => i !== idx)); }
  const myKrs = useMemo(() => myOkrs.flatMap((o: any) => (o.keyResults || []).map((kr: any) => ({ kr, obj: o }))), [myOkrs]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  

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
  
  const [okrCreating, setOkrCreating] = useState(false);
  const [extraKrs, setExtraKrs] = useState<Array<{ title: string; metric: string; target: string; unit: string }>>([]);

  const [oMonths, setOMonths] = useState<boolean[]>(() => Array(12).fill(false));
  const months2026 = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1)), []);
  function toggleOMonth(idx: number) {
    setOMonths((prev) => prev.map((v, i) => (i === idx ? !v : v)));
  }

  // Per-objective KR create form state
  const [krForm, setKrForm] = useState<Record<string, { title: string; metric: string; target: string; unit: string; saving?: boolean }>>({});

  function setKrField(objId: string, field: keyof (typeof krForm)[string], value: any) {
    setKrForm((prev) => {
      const base = prev[objId] ?? { title: '', metric: '', target: '', unit: '' };
      return { ...prev, [objId]: { ...base, [field]: value } };
    });
  }

  async function addKr(objId: string) {
    const f = krForm[objId] || { title: '', metric: '', target: '', unit: '' };
    if (!userId || !f.title || !f.metric || !f.target || !f.unit) return;
    setKrForm((prev) => ({ ...prev, [objId]: { ...(prev[objId] || f), saving: true } }));
    try {
      const payload: any = { userId, title: f.title, metric: f.metric, target: Number(f.target), unit: f.unit };
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(objId)}/krs`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
      setMyOkrs(mokrs.items || []);
      setKrForm((prev) => ({ ...prev, [objId]: { title: '', metric: '', target: '', unit: '' } }));
    } catch (e: any) {
      setError(e.message || 'KR 추가 실패');
    } finally {
      setKrForm((prev) => ({ ...prev, [objId]: { ...(prev[objId] || f), saving: false } }));
    }
  }

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

  async function createTeamInitiative() {
    if (!userId || !tKrId || !tInitTitle) return;
    setTSaving(true);
    setError(null);
    try {
      await apiJson(`/api/initiatives`, {
        method: 'POST',
        body: JSON.stringify({
          keyResultId: tKrId,
          ownerId: userId,
          title: tInitTitle,
          startAt: tStart || undefined,
          endAt: tEnd || undefined,
          cadence: tCadence || undefined,
        }),
      });
      setTInitTitle(''); setTStart(''); setTEnd(''); setTCadence(''); setTKrId('');
      await load();
    } catch (e: any) {
      setError(e.message || '세부 과제 생성 실패');
    } finally {
      setTSaving(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12, maxWidth: 960, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>나의 OKR</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!userId || loading} onClick={load} className="btn btn-primary">{loading ? '새로고침…' : '새로고침'}</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>내 역할 및 상위 O-KR 선택</h3>
        <div style={card}>
          <div className="stack-1-2">
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
            <select value={parentKrId} onChange={(e) => setParentKrId(e.target.value)} style={{ ...input, appearance: 'auto' as any }}>
              <option value="">상위 O-KR 선택(선택)</option>
              {parentKrs.map((kr) => (
                <option key={kr.id} value={kr.id}>
                  [{(kr.objective?.owner?.role === 'CEO' ? '대표이사' : kr.objective?.owner?.role === 'EXEC' ? '임원' : kr.objective?.owner?.role === 'MANAGER' ? '팀장' : kr.objective?.owner?.role === 'INDIVIDUAL' ? '직원' : kr.objective?.owner?.role) + '-' + (kr.objective?.owner?.name || '')}] {kr.objective?.title} / KR: {kr.title}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            역할 변경 후 상위 O-KR 목록이 갱신됩니다. 대표이사는 상위 선택 없이 최상위 O를 생성합니다.
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>나의 개선목표(O) 및 목표성과(KR)</h3>
        <div style={card}>
          <div className="stack-1-2">
            <input value={oTitle} onChange={(e) => setOTitle(e.target.value)} placeholder="나의 Objective 제목" style={input} />
            <input value={krTitle} onChange={(e) => setKrTitle(e.target.value)} placeholder="첫 Key Result 제목" style={input} />
          </div>
          <textarea value={oDesc} onChange={(e) => setODesc(e.target.value)} placeholder="Objective 설명" style={{ ...input, minHeight: 70 }} />
          <div className="stack-3">
            <input value={krMetric} onChange={(e) => setKrMetric(e.target.value)} placeholder="KR 내용/측정 기준" style={input} />
            <input type="number" step="any" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} placeholder="측정 수치" style={input} />
            <input value={krUnit} onChange={(e) => setKrUnit(e.target.value)} placeholder="단위" style={input} />
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12, 32px)', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>기간(2026)</div>
            {months2026.map((_, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{i + 1}</div>
            ))}
            <div style={{ gridColumn: '1 / span 1' }} />
            {oMonths.map((on, i) => (
              <div key={`m-${i}`} onClick={() => toggleOMonth(i)}
                style={{ width: 32, height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }} />
            ))}
          </div>
            {extraKrs.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                {extraKrs.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gap: 6, border: '1px dashed #e5e7eb', borderRadius: 8, padding: 8 }}>
                    <div className="resp-2">
                      <input value={row.title} onChange={(e) => {
                        const v = e.target.value; setExtraKrs((prev) => prev.map((r, idx) => idx === i ? { ...r, title: v } : r));
                      }} placeholder="추가 KR 제목" style={input} />
                      <input value={row.metric} onChange={(e) => {
                        const v = e.target.value; setExtraKrs((prev) => prev.map((r, idx) => idx === i ? { ...r, metric: v } : r));
                      }} placeholder="KR 내용/측정 기준" style={input} />
                    </div>
                    <div className="resp-3">
                      <input type="number" step="any" value={row.target} onChange={(e) => {
                        const v = e.target.value; setExtraKrs((prev) => prev.map((r, idx) => idx === i ? { ...r, target: v } : r));
                      }} placeholder="측정 수치" style={input} />
                      <input value={row.unit} onChange={(e) => {
                        const v = e.target.value; setExtraKrs((prev) => prev.map((r, idx) => idx === i ? { ...r, unit: v } : r));
                      }} placeholder="단위" style={input} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost" onClick={() => setExtraKrs((prev) => prev.filter((_r, idx) => idx !== i))}>행 제거</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setExtraKrs((prev) => [...prev, { title: '', metric: '', target: '', unit: '' }])}>KR 행 추가</button>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={okrCreating || !userId || !oTitle || !krTitle || !krMetric || !krTarget || !krUnit || !oMonths.some(Boolean)}
                onClick={async () => {
                  try {
                    setOkrCreating(true);
                    const sel = oMonths.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
                    if (!sel.length) throw new Error('기간(월)을 선택하세요');
                    const mStart = Math.min(...sel);
                    const mEnd = Math.max(...sel);
                    const s = new Date(2026, mStart, 1);
                    const e = new Date(2026, mEnd + 1, 0);
                    const periodStart = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
                    const periodEnd = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
                    const krs = [
                      { title: krTitle, metric: krMetric, target: Number(krTarget), unit: krUnit },
                      ...extraKrs
                        .filter((r) => r.title && r.metric && r.target !== '' && r.unit)
                        .map((r) => ({ title: r.title, metric: r.metric, target: Number(r.target), unit: r.unit })),
                    ];
                    await apiJson<{ id: string }>(`/api/okrs/objectives`, {
                      method: 'POST',
                      body: JSON.stringify({
                        userId,
                        title: oTitle,
                        description: oDesc || undefined,
                        periodStart,
                        periodEnd,
                        alignsToKrId: parentKrId || undefined,
                        krs,
                      }),
                    });
                    setOTitle(''); setODesc(''); setOStart(''); setOEnd(''); setKrTitle(''); setKrMetric(''); setKrTarget(''); setKrUnit('');
                    setOMonths(Array(12).fill(false));
                    setExtraKrs([]);
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
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>나의 추진 과제 (Tasks)</h3>
        <div style={card}>
          <div className="resp-2">
            <select value={pKrId} onChange={(e) => setPKrId(e.target.value)} style={{ ...input, appearance: 'auto' as any }}>
              <option value="">내 KR 선택</option>
              {myKrs.map(({ kr, obj }) => (
                <option key={kr.id} value={kr.id}>[{obj.title}] {kr.title}</option>
              ))}
            </select>
            <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="부모 과제 제목" style={input} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px repeat(12, 32px)', gap: 6, alignItems: 'center' }}>
              <div />
              {months2026.map((_, i) => (
                <div key={i} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{i + 1}</div>
              ))}
              {pRows.map((row, rIdx) => (
                <Fragment key={`row-${rIdx}`}>
                  <div key={`pt-${rIdx}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input placeholder={`세부 제목 ${rIdx + 1}`} value={row.title} onChange={(e) => setPRows((prev) => prev.map((rr, i) => i === rIdx ? { ...rr, title: e.target.value } : rr))} style={input} />
                    <button className="btn btn-ghost" onClick={() => removePRow(rIdx)}>삭제</button>
                  </div>
                  {row.months.map((on, mIdx) => (
                    <div key={`pm-${rIdx}-${mIdx}`} onClick={() => togglePMonth(rIdx, mIdx)}
                      style={{ width: 32, height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }} />
                  ))}
                </Fragment>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={addPRow}>세부 추가</button>
              <button className="btn btn-primary" disabled={!userId || !pKrId || !pTitle} onClick={createPersonalTasks}>추가</button>
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>나의 O-KR 목록</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {myOkrs.map((o) => (
            <div key={o.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                  {`${(myRole === 'CEO' ? '대표이사' : myRole === 'EXEC' ? '임원' : myRole === 'MANAGER' ? '팀장' : myRole === 'INDIVIDUAL' ? '직원' : myRole)}-${myName || ''}`}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  {(o.periodStart ? formatKstDatetime(o.periodStart) : '-') + ' ~ ' + (o.periodEnd ? formatKstDatetime(o.periodEnd) : '-')}
                </div>
                {myRole === 'CEO' && (
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      if (!confirm('해당 Objective를 삭제할까요?')) return;
                      try {
                        await apiJson(`/api/okrs/objectives/${encodeURIComponent(o.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                        const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
                        setMyOkrs(mokrs.items || []);
                      } catch (e: any) {
                        setError(e.message || '삭제 실패');
                      }
                    }}
                  >삭제</button>
                )}
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
                    <div key={kr.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' }}>
                      <span>• {o.title} / KR: {kr.title} ({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''})</span>
                      {myRole === 'CEO' && (
                        <button
                          className="btn btn-ghost"
                          style={{ marginLeft: 'auto' }}
                          onClick={async () => {
                            if (!confirm('해당 KR을 삭제할까요?')) return;
                            try {
                              await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                              const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
                              setMyOkrs(mokrs.items || []);
                            } catch (e: any) {
                              setError(e.message || '삭제 실패');
                            }
                          }}
                        >삭제</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                <div className="resp-2">
                  <input value={(krForm[o.id]?.title) || ''} onChange={(e) => setKrField(o.id, 'title', e.target.value)} placeholder="추가 KR 제목" style={input} />
                  <input value={(krForm[o.id]?.metric) || ''} onChange={(e) => setKrField(o.id, 'metric', e.target.value)} placeholder="KR 내용/측정 기준" style={input} />
                </div>
                <div className="resp-3">
                  <input type="number" step="any" value={(krForm[o.id]?.target) || ''} onChange={(e) => setKrField(o.id, 'target', e.target.value)} placeholder="측정 수치" style={input} />
                  <input value={(krForm[o.id]?.unit) || ''} onChange={(e) => setKrField(o.id, 'unit', e.target.value)} placeholder="단위" style={input} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-primary" disabled={!userId || krForm[o.id]?.saving || !krForm[o.id]?.title || !krForm[o.id]?.metric || !krForm[o.id]?.target || !krForm[o.id]?.unit}
                          onClick={() => addKr(o.id)}>{krForm[o.id]?.saving ? '추가중…' : 'KR 추가'}</button>
                </div>
              </div>
            </div>
          ))}
          {!myOkrs.length && <div style={{ color: '#64748b' }}>아직 나의 O-KR이 없습니다. 상단에서 역할/상위 O-KR을 선택하고 생성하세요.</div>}
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
