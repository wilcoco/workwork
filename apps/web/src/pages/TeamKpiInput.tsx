import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';

type OrgUnit = { id: string; name: string; type: string };

type Objective = any;

type ParentKr = { id: string; title: string; objective?: { title?: string; orgUnit?: { name?: string } } };

export function TeamKpiInput() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [parentKrs, setParentKrs] = useState<ParentKr[]>([]);
  const [error, setError] = useState<string | null>(null);

  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);

  // Create Objective (team OKR O)
  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oPillar, setOPillar] = useState<Pillar>('Q');
  const [oStart, setOStart] = useState('');
  const [oEnd, setOEnd] = useState('');
  const [oParentKrId, setOParentKrId] = useState('');

  // Create KR (KPI row)
  const [krObjectiveId, setKrObjectiveId] = useState('');
  const [krTitle, setKrTitle] = useState('');
  const [krBaseline, setKrBaseline] = useState<string>('');
  const [krTarget, setKrTarget] = useState<string>('');
  const [krUnit, setKrUnit] = useState('');
  const [krPillar, setKrPillar] = useState<Pillar>('Q');
  const [krCadence, setKrCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');

  // Initiative under KR (추진 과제)
  const [initKrId, setInitKrId] = useState('');
  const [initTitle, setInitTitle] = useState('');
  const [gStartIdx, setGStartIdx] = useState<number | null>(null);
  const [gEndIdx, setGEndIdx] = useState<number | null>(null);
  const ganttDays = useMemo(() => {
    const days: Date[] = [];
    const d0 = new Date(); d0.setHours(0,0,0,0);
    for (let i = 0; i < 30; i++) { const d = new Date(d0); d.setDate(d0.getDate() + i); days.push(d); }
    return days;
  }, []);
  function resetGantt() { setGStartIdx(null); setGEndIdx(null); }

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
    if (!krObjectiveId) return;
    try {
      setError(null);
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(krObjectiveId)}/krs`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          title: krTitle,
          target: Number(krTarget),
          unit: krUnit,
          pillar: krPillar,
          baseline: krBaseline === '' ? undefined : Number(krBaseline),
          cadence: krCadence || undefined,
        }),
      });
      setKrObjectiveId(''); setKrTitle(''); setKrTarget(''); setKrBaseline(''); setKrUnit(''); setKrPillar('Q'); setKrCadence('');
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
      setObjectives(res.items || []);
    } catch (e: any) {
      setError(e.message || 'KR 생성 실패');
    }
  }

  async function createInitiative() {
    if (!initKrId) return;
    try {
      setError(null);
      const sIdx = gStartIdx != null && gEndIdx != null ? Math.min(gStartIdx, gEndIdx) : gStartIdx;
      const eIdx = gStartIdx != null && gEndIdx != null ? Math.max(gStartIdx, gEndIdx) : gEndIdx;
      const startAt = sIdx != null ? ganttDays[sIdx].toISOString().slice(0,10) : '';
      const endAt = eIdx != null ? ganttDays[eIdx].toISOString().slice(0,10) : '';
      await apiJson(`/api/initiatives`, {
        method: 'POST',
        body: JSON.stringify({
          keyResultId: initKrId,
          ownerId: userId,
          title: initTitle,
          startAt: startAt || undefined,
          endAt: endAt || undefined,
        }),
      });
      setInitTitle(''); resetGantt();
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
      setObjectives(res.items || []);
    } catch (e: any) {
      setError(e.message || '이니셔티브 생성 실패');
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>팀 KPI 입력</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div>팀(조직) 선택</div>
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">선택</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.type})</option>
            ))}
          </select>
        </div>
      </div>

      

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>KPI 입력</h3>
        <div className="resp-2">
          <select value={krObjectiveId} onChange={(e) => setKrObjectiveId(e.target.value)}>
            <option value="">목표 선택</option>
            {objectives.map((o) => (
              <option key={o.id} value={o.id}>[{o.orgUnit?.name || '-'}] {o.title}</option>
            ))}
          </select>
          <select value={krPillar} onChange={(e) => setKrPillar(e.target.value as Pillar)}>
            <option value="Q">Quality (품질)</option>
            <option value="C">Cost (원가)</option>
            <option value="D">Delivery (납기)</option>
            <option value="DEV">Development (개발)</option>
            <option value="P">People (인재)</option>
          </select>
        </div>
        <input placeholder="KPI명" value={krTitle} onChange={(e) => setKrTitle(e.target.value)} />
        <div className="resp-3">
          <input type="number" step="any" placeholder="기준값(선택)" value={krBaseline} onChange={(e) => setKrBaseline(e.target.value)} />
          <input type="number" step="any" placeholder="목표값" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} />
          <input placeholder="단위(예: %, 건)" value={krUnit} onChange={(e) => setKrUnit(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={krCadence} onChange={(e) => setKrCadence(e.target.value as any)}>
            <option value="">주기(선택)</option>
            <option value="DAILY">일</option>
            <option value="WEEKLY">주</option>
            <option value="MONTHLY">월</option>
          </select>
          <button className="btn btn-primary" disabled={!userId || !orgUnitId || !krObjectiveId || !krTitle || !krTarget || !krUnit} onClick={createKr}>KPI 생성</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>추진 과제 (Tasks)</h3>
        <div className="resp-2">
          <select value={initKrId} onChange={(e) => setInitKrId(e.target.value)}>
            <option value="">KR 선택</option>
            {objectives.flatMap((o) => (o.keyResults || []).map((kr: any) => (
              <option key={kr.id} value={kr.id}>[{o.title}] {kr.title}</option>
            )))}
          </select>
          <input placeholder="과제 제목" value={initTitle} onChange={(e) => setInitTitle(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ganttDays.length}, 24px)`, gap: 2, overflowX: 'auto', paddingBottom: 4 }}>
            {ganttDays.map((d, idx) => {
              const s = gStartIdx != null ? Math.min(gStartIdx, gEndIdx ?? gStartIdx) : null;
              const e = gStartIdx != null ? Math.max(gStartIdx, gEndIdx ?? gStartIdx) : null;
              const on = s != null && e != null && idx >= s && idx <= e;
              return (
                <div key={idx} onClick={() => {
                  if (gStartIdx == null) setGStartIdx(idx);
                  else if (gEndIdx == null) setGEndIdx(idx);
                  else { setGStartIdx(idx); setGEndIdx(null); }
                }} title={`${d.getMonth()+1}/${d.getDate()}`}
                  style={{ width: 24, height: 18, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc' }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={resetGantt}>선택 초기화</button>
            <div style={{ color: '#64748b', fontSize: 12 }}>
              {(() => {
                const s = gStartIdx != null ? ganttDays[Math.min(gStartIdx, gEndIdx ?? gStartIdx)] : null;
                const e = gStartIdx != null ? ganttDays[Math.max(gStartIdx, gEndIdx ?? gStartIdx)] : null;
                return s && e ? `${s.getMonth()+1}/${s.getDate()} ~ ${e.getMonth()+1}/${e.getDate()}` : '기간 선택';
              })()}
            </div>
            <button className="btn btn-primary" disabled={!initKrId || !initTitle || gStartIdx == null} onClick={createInitiative}>추가</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: 0 }}>팀 KPI/OKR 목록</h3>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {objectives.map((o) => (
            <div key={o.id} className="card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>목표</span>
                <b>{o.title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{o.pillar || '-'}</span>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (!confirm('해당 목표를 삭제할까요?')) return;
                    try {
                      await apiJson(`/api/okrs/objectives/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
                      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
                      setObjectives(res.items || []);
                    } catch (e: any) {
                      setError(e.message || '삭제 실패');
                    }
                  }}
                >삭제</button>
              </div>
              {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                <ul style={{ marginLeft: 18 }}>
                  {o.keyResults.map((kr: any) => (
                    <li key={kr.id}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>지표</span>
                          <div style={{ fontWeight: 600 }}>{kr.title}</div>
                          <div style={{ color: '#334155' }}>({kr.baseline != null ? `${kr.baseline} → ` : ''}{kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.pillar || '-'}{kr.cadence ? ` · ${kr.cadence}` : ''}{typeof kr.weight === 'number' ? ` · ${kr.weight}%` : ''}</div>
                          <button
                            className="btn btn-ghost"
                            onClick={async () => {
                              if (!confirm('해당 KR을 삭제할까요?')) return;
                              try {
                                await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}`, { method: 'DELETE' });
                                const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
                                setObjectives(res.items || []);
                              } catch (e: any) {
                                setError(e.message || '삭제 실패');
                              }
                            }}
                          >삭제</button>
                        </div>
                        {Array.isArray(kr.initiatives) && kr.initiatives.length > 0 && (
                          <ul style={{ marginLeft: 18, color: '#374151' }}>
                            {kr.initiatives.map((ii: any) => (
                              <li key={ii.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>- {ii.title}</span>
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
