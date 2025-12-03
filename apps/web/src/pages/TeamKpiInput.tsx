import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';

type OrgUnit = { id: string; name: string; type: string; parentId?: string | null };

type Objective = any;

type ParentKr = { id: string; title: string; objective?: { title?: string; orgUnit?: { name?: string } } };

export function TeamKpiInput() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [parentKrs, setParentKrs] = useState<ParentKr[]>([]);
  const [error, setError] = useState<string | null>(null);

  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [myOrgUnitId, setMyOrgUnitId] = useState<string>('');

  // Create Objective (team OKR O)
  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oPillar, setOPillar] = useState<Pillar>('Q');
  const [oStart, setOStart] = useState('');
  const [oEnd, setOEnd] = useState('');
  const [oParentKrId, setOParentKrId] = useState('');

  // Create KR (KPI row)
  const [krTitle, setKrTitle] = useState('');
  const [krMetric, setKrMetric] = useState('');
  const [krBaseline, setKrBaseline] = useState<string>('');
  const [krTarget, setKrTarget] = useState<string>('');
  const [krUnit, setKrUnit] = useState('');
  const [krPillar, setKrPillar] = useState<Pillar>('Q');
  const [krCadence, setKrCadence] = useState<'' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY'>('');
  const [krDirection, setKrDirection] = useState<'AT_LEAST' | 'AT_MOST'>('AT_LEAST');
  const [taskRows, setTaskRows] = useState<Array<{ title: string; desc: string; months: boolean[] }>>([
    { title: '', desc: '', months: Array(12).fill(false) },
  ]);

  // (removed) separate initiative entry UI replaced by taskRows within KPI form

  useEffect(() => {
    async function loadOrg() {
      try {
        const res = await apiJson<{ items: OrgUnit[] }>(`/api/orgs`);
        setOrgs(res.items || []);
      } catch {}
    }
    loadOrg();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!userId) return;
        const me = await apiJson<{ role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'; orgUnitId?: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole((me as any).role || '');
        const orgId = (me as any).orgUnitId || '';
        setMyOrgUnitId(orgId);
        if (!orgUnitId && orgId) setOrgUnitId(orgId);
      } catch {}
    })();
  }, [userId]);

  useEffect(() => {
    async function loadObjectives() {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
        setObjectives(res.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      }
    }
    async function loadParentKrs() {
      try {
        if (!userId) return;
        const res = await apiJson<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`);
        setParentKrs(res.items || []);
      } catch {}
    }
    loadObjectives();
    loadParentKrs();
  }, [orgUnitId, userId]);

  async function createObjective() {
    try {
      setError(null);
      await apiJson('/api/okrs/objectives', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          title: oTitle,
          description: oDesc || undefined,
          periodStart: oStart,
          periodEnd: oEnd,
          orgUnitId: orgUnitId || undefined,
          alignsToKrId: oParentKrId || undefined,
          pillar: oPillar,
        }),
      });
      setOTitle(''); setODesc(''); setOStart(''); setOEnd(''); setOParentKrId('');
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
      setObjectives(res.items || []);
    } catch (e: any) {
      setError(e.message || '생성 실패');
    }
  }

  async function createKr() {
    try {
      setError(null);
      let objectiveId = (objectives.find((o: any) => !!o.pillar) as any)?.id;
      if (!objectiveId) {
        const now = new Date();
        const year = now.getFullYear();
        const created = await apiJson<{ id: string }>(`/api/okrs/objectives?context=team`, {
          method: 'POST',
          body: JSON.stringify({
            userId,
            title: '팀 KPI',
            description: undefined,
            periodStart: `${year}-01-01`,
            periodEnd: `${year}-12-31`,
            orgUnitId: orgUnitId || undefined,
            pillar: krPillar,
          }),
        });
        objectiveId = created.id;
      }
      const newKr = await apiJson<{ id: string }>(`/api/okrs/objectives/${encodeURIComponent(objectiveId)}/krs?context=team`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          title: krTitle,
          metric: krMetric,
          target: Number(krTarget),
          unit: krUnit,
          pillar: krPillar,
          baseline: krBaseline === '' ? undefined : Number(krBaseline),
          direction: krDirection,
          cadence: krCadence || undefined,
        }),
      });
      // Create initiatives for each task row
      for (const r of taskRows) {
        if (!r.title) continue;
        const sel = (r.months || []).map((v, i) => (v ? i : -1)).filter(i => i >= 0);
        let startAt: string | undefined = undefined;
        let endAt: string | undefined = undefined;
        if (sel.length) {
          const ms = Math.min(...sel);
          const me = Math.max(...sel);
          const ss = new Date(2026, ms, 1);
          const ee = new Date(2026, me + 1, 0);
          startAt = `${ss.getFullYear()}-${String(ss.getMonth()+1).padStart(2,'0')}-${String(ss.getDate()).padStart(2,'0')}`;
          endAt = `${ee.getFullYear()}-${String(ee.getMonth()+1).padStart(2,'0')}-${String(ee.getDate()).padStart(2,'0')}`;
        }
        await apiJson(`/api/initiatives`, {
          method: 'POST',
          body: JSON.stringify({
            keyResultId: newKr.id,
            ownerId: userId,
            title: r.title,
            description: r.desc || undefined,
            startAt,
            endAt,
          }),
        });
      }
      setKrTitle(''); setKrMetric(''); setKrTarget(''); setKrBaseline(''); setKrUnit(''); setKrPillar('Q'); setKrCadence(''); setKrDirection('AT_LEAST');
      setTaskRows([{ title: '', desc: '', months: Array(12).fill(false) }]);
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
      setObjectives(res.items || []);
    } catch (e: any) {
      setError(e.message || 'KR 생성 실패');
    }
  }

  // (removed) createInitiative helper — tasks are created alongside KPI now

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>팀 KPI 입력</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div>팀(조직) 선택</div>
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">선택</option>
            {orgs
              .filter((o) => o.type === 'TEAM')
              .filter((o) => {
                if (myRole === 'CEO') return true;
                if (myRole === 'MANAGER') return o.id === myOrgUnitId;
                if (myRole === 'EXEC') return (o.parentId || '') === (myOrgUnitId || '');
                return o.id === myOrgUnitId;
              })
              .map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.type === 'TEAM' ? '팀' : o.type === 'DIVISION' ? '실' : o.type === 'COMPANY' ? '회사' : o.type})</option>
            ))}
          </select>
        </div>
      </div>

      {myRole !== 'INDIVIDUAL' && (
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>KPI 입력</h3>
        <div className="resp-2">
          <select value={krPillar} onChange={(e) => setKrPillar(e.target.value as Pillar)}>
            <option value="Q">Quality (품질)</option>
            <option value="C">Cost (원가)</option>
            <option value="D">Delivery (납기)</option>
            <option value="DEV">Development (개발)</option>
            <option value="P">People (인재)</option>
          </select>
        </div>
        <input placeholder="KPI명" value={krTitle} onChange={(e) => setKrTitle(e.target.value)} />
        <input placeholder="KPI 내용(산식)" value={krMetric} onChange={(e) => setKrMetric(e.target.value)} />
        <div className="resp-3">
          <input type="number" step="any" placeholder="기준값(작년)" value={krBaseline} onChange={(e) => setKrBaseline(e.target.value)} />
          <input type="number" step="any" placeholder="목표값" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} />
          <input placeholder="단위(예: %, 건)" value={krUnit} onChange={(e) => setKrUnit(e.target.value)} />
        </div>
        <div className="resp-2">
          <select value={krDirection} onChange={(e) => setKrDirection(e.target.value as any)}>
            <option value="AT_LEAST">이상 (≥ 목표가 좋음)</option>
            <option value="AT_MOST">이하 (≤ 목표가 좋음)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={krCadence} onChange={(e) => setKrCadence(e.target.value as any)}>
            <option value="">평가 주기(선택)</option>
            <option value="MONTHLY">월</option>
            <option value="QUARTERLY">분기</option>
            <option value="HALF_YEARLY">반기</option>
            <option value="YEARLY">연간</option>
          </select>
        </div>
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 10, paddingTop: 10, display: 'grid', gap: 8 }}>
          <h4 style={{ margin: 0 }}>추진 과제</h4>
          {taskRows.map((r, i) => (
            <div key={i} className="card" style={{ padding: 8, display: 'grid', gap: 6 }}>
              <input placeholder="과제 제목" value={r.title} onChange={(e) => setTaskRows((prev) => prev.map((rr, idx) => idx === i ? { ...rr, title: e.target.value } : rr))} />
              <textarea placeholder="과제 내용" value={r.desc} onChange={(e) => setTaskRows((prev) => prev.map((rr, idx) => idx === i ? { ...rr, desc: e.target.value } : rr))} />
              <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12, 32px)', gap: 6, alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>'26 월 선택</div>
                {Array.from({ length: 12 }).map((_, m) => (
                  <div key={`ml-${i}-${m}`} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{m + 1}</div>
                ))}
                <div style={{ gridColumn: '1 / span 1' }} />
                {(r.months || []).map((on, m) => (
                  <div key={`mm-${i}-${m}`} onClick={() => setTaskRows((prev) => prev.map((rr, idx) => idx === i ? { ...rr, months: rr.months.map((v, j) => j === m ? !v : v) } : rr))} style={{ width: 32, height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setTaskRows((prev) => prev.filter((_, idx) => idx !== i))}>삭제</button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setTaskRows((prev) => [...prev, { title: '', desc: '', months: Array(12).fill(false) }])}>과제 추가</button>
            <button className="btn btn-primary" disabled={!userId || !orgUnitId || !krTitle || !krMetric || krTarget === '' || !krUnit} onClick={createKr}>KPI 생성</button>
          </div>
        </div>
      </div>
      )}

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: 0 }}>팀 KPI 목록</h3>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {(() => {
            const krs = objectives.filter((o: any) => !!o.pillar).flatMap((o) => (o.keyResults || []).map((kr: any) => ({ kr, obj: o })));
            if (!krs.length) return <div style={{ color: '#6b7280' }}>KPI가 없습니다.</div>;
            return (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {krs.map(({ kr, obj }: any) => (
                  <li key={kr.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600 }}>{obj?.title ? `${obj.title} / KR: ${kr.title}` : `KR: ${kr.title}`}</div>
                    <div style={{ color: '#334155' }}>({kr.baseline != null ? `${kr.baseline} → ` : ''}{kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                    <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.pillar || '-'}{kr.cadence ? ` · ${kr.cadence}` : ''}</div>
                    {(myRole === 'CEO' || myRole === 'EXEC' || myRole === 'MANAGER') && (
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          if (!confirm('해당 KR을 삭제할까요?')) return;
                          try {
                            await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}?userId=${encodeURIComponent(userId)}&context=team`, { method: 'DELETE' });
                            const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
                            setObjectives(res.items || []);
                          } catch (e: any) {
                            setError(e.message || '삭제 실패');
                          }
                        }}
                      >삭제</button>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: 0 }}>팀 KPI/TASKS</h3>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {objectives.filter((o: any) => !!o.pillar).map((o) => (
            <div key={o.id} className="card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>목표</span>
                <b>{o.title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{o.pillar || '-'}</span>
                {(myRole === 'CEO' || myRole === 'EXEC' || myRole === 'MANAGER') && (
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      if (!confirm('해당 목표를 삭제할까요?')) return;
                      try {
                        await apiJson(`/api/okrs/objectives/${encodeURIComponent(o.id)}?userId=${encodeURIComponent(userId)}&context=team`, { method: 'DELETE' });
                        const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
                        setObjectives(res.items || []);
                      } catch (e: any) {
                        setError(e.message || '삭제 실패');
                      }
                    }}
                  >삭제</button>
                )}
              </div>
              {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                <ul style={{ marginLeft: 18 }}>
                  {o.keyResults.map((kr: any) => (
                    <li key={kr.id}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <div style={{ fontWeight: 600 }}>{o.title} / KR: {kr.title}</div>
                          <div style={{ color: '#334155' }}>({kr.baseline != null ? `${kr.baseline} → ` : ''}{kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.pillar || '-'}{kr.cadence ? ` · ${kr.cadence}` : ''}{typeof kr.weight === 'number' ? ` · ${kr.weight}%` : ''}</div>
                          {(myRole === 'CEO' || myRole === 'EXEC' || myRole === 'MANAGER') && (
                            <button
                              className="btn btn-ghost"
                              onClick={async () => {
                                if (!confirm('해당 KR을 삭제할까요?')) return;
                                try {
                                  await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}?userId=${encodeURIComponent(userId)}&context=team`, { method: 'DELETE' });
                                  const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
                                  setObjectives(res.items || []);
                                } catch (e: any) {
                                  setError(e.message || '삭제 실패');
                                }
                              }}
                            >삭제</button>
                          )}
                        </div>
                        {Array.isArray(kr.initiatives) && kr.initiatives.length > 0 && (
                          <ul style={{ marginLeft: 18, color: '#374151', display: 'grid', gap: 4 }}>
                            {kr.initiatives.map((ii: any) => (
                              <li key={ii.id}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span>- {ii.title}</span>
                                  {(ii.startAt || ii.endAt) && (
                                    <span style={{ fontSize: 12, color: '#64748b' }}>{(() => {
                                      const lastDay = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                                      const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
                                      const s0 = ii.startAt ? new Date(ii.startAt) : null;
                                      const e0 = ii.endAt ? new Date(ii.endAt) : null;
                                      let s = s0;
                                      if (s0) {
                                        const sNext = addDays(s0, 1);
                                        if (s0.getDate() >= 28 && sNext.getDate() === 1) s = sNext;
                                      }
                                      let e = e0;
                                      if (e0) {
                                        const eNext = addDays(e0, 1);
                                        if (e0.getDate() >= 28 && eNext.getDate() === lastDay(eNext)) e = eNext;
                                      }
                                      const sy = s ? `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}` : '';
                                      const ey = e ? `${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,'0')}-${String(e.getDate()).padStart(2,'0')}` : '';
                                      return `(${sy}${sy || ey ? ' ~ ' : ''}${ey})`;
                                    })()}</span>
                                  )}
                                  <button
                                    className="btn btn-ghost"
                                    onClick={async () => {
                                      if (!confirm('해당 과제를 삭제할까요?')) return;
                                      try {
                                        await apiJson(`/api/initiatives/${encodeURIComponent(ii.id)}`, { method: 'DELETE' });
                                        const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
                                        setObjectives(res.items || []);
                                      } catch (e: any) {
                                        setError(e.message || '삭제 실패');
                                      }
                                    }}
                                  >삭제</button>
                                </div>
                                {Array.isArray(ii.children) && ii.children.length > 0 && (
                                  <ul style={{ marginLeft: 18 }}>
                                    {ii.children.map((ch: any) => (
                                      <li key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>· {ch.title}</span>
                                        {(ch.startAt || ch.endAt) && (
                                          <span style={{ fontSize: 12, color: '#94a3b8' }}>{(() => {
                                            const lastDay = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                                            const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
                                            const s0 = ch.startAt ? new Date(ch.startAt) : null;
                                            const e0 = ch.endAt ? new Date(ch.endAt) : null;
                                            let s = s0;
                                            if (s0) {
                                              const sNext = addDays(s0, 1);
                                              if (s0.getDate() >= 28 && sNext.getDate() === 1) s = sNext;
                                            }
                                            let e = e0;
                                            if (e0) {
                                              const eNext = addDays(e0, 1);
                                              if (e0.getDate() >= 28 && eNext.getDate() === lastDay(eNext)) e = eNext;
                                            }
                                            const sy = s ? `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}` : '';
                                            const ey = e ? `${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,'0')}-${String(e.getDate()).padStart(2,'0')}` : '';
                                            return `(${sy}${sy || ey ? ' ~ ' : ''}${ey})`;
                                          })()}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!objectives.length && <div style={{ color: '#6b7280' }}>선택한 팀의 OKR/KPI가 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
