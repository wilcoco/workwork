import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';

type OrgUnit = { id: string; name: string; type: string };

type Objective = any;

type ParentKr = { id: string; title: string; objective?: { title?: string; orgUnit?: { name?: string }; owner?: { name?: string; role?: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | string } } };

export function TeamOkrInput() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [parentKrs, setParentKrs] = useState<ParentKr[]>([]);
  const [error, setError] = useState<string | null>(null);

  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');

  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oPillar, setOPillar] = useState<Pillar>('Q');
  const [oStart, setOStart] = useState('');
  const [oEnd, setOEnd] = useState('');
  const [oParentKrId, setOParentKrId] = useState('');

  const [krObjectiveId, setKrObjectiveId] = useState('');
  const [krTitle, setKrTitle] = useState('');
  const [krMetric, setKrMetric] = useState('');
  const [krTarget, setKrTarget] = useState<string>('');
  const [krUnit, setKrUnit] = useState('');
  const [krType, setKrType] = useState<'PROJECT' | 'OPERATIONAL'>('PROJECT');
  const [krPillar, setKrPillar] = useState<Pillar>('Q');
  const [krCadence, setKrCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');
  const [krWeight, setKrWeight] = useState<string>('');

  const [initKrId, setInitKrId] = useState('');
  const [initTitle, setInitTitle] = useState('');
  const [initStart, setInitStart] = useState('');
  const [initEnd, setInitEnd] = useState('');
  const [initCadence, setInitCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');

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
        const me = await apiJson<{ role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole((me as any).role || '');
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
    if (!krObjectiveId) return;
    try {
      setError(null);
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(krObjectiveId)}/krs`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          title: krTitle,
          metric: krMetric,
          target: Number(krTarget),
          unit: krUnit,
          type: krType,
          pillar: krPillar,
          cadence: krCadence || undefined,
          weight: krWeight === '' ? undefined : Number(krWeight),
        }),
      });
      setKrObjectiveId(''); setKrTitle(''); setKrMetric(''); setKrTarget(''); setKrUnit(''); setKrType('PROJECT'); setKrPillar('Q'); setKrCadence(''); setKrWeight('');
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
      await apiJson(`/api/initiatives`, {
        method: 'POST',
        body: JSON.stringify({
          keyResultId: initKrId,
          ownerId: userId,
          title: initTitle,
          startAt: initStart || undefined,
          endAt: initEnd || undefined,
          cadence: initCadence || undefined,
        }),
      });
      setInitTitle(''); setInitStart(''); setInitEnd(''); setInitCadence('');
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
      setObjectives(res.items || []);
    } catch (e: any) {
      setError(e.message || '이니셔티브 생성 실패');
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>팀 OKR 입력</h2>
      {error && <div style={{ color: '#red' }}>{error}</div>}

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
        <h3 style={{ margin: 0 }}>팀 목표 생성 (Objective)</h3>
        <div className="resp-3">
          <input placeholder="목표 제목" value={oTitle} onChange={(e) => setOTitle(e.target.value)} />
          <select value={oPillar} onChange={(e) => setOPillar(e.target.value as Pillar)}>
            <option value="Q">Q</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="DEV">Dev</option>
            <option value="P">P</option>
          </select>
          <select value={oParentKrId} onChange={(e) => setOParentKrId(e.target.value)}>
            <option value="">상위 KR 선택(선택)</option>
            {parentKrs.map((kr) => (
              <option key={kr.id} value={kr.id}>[{(kr.objective?.owner?.role === 'CEO' ? '대표이사' : kr.objective?.owner?.role === 'EXEC' ? '임원' : kr.objective?.owner?.role === 'MANAGER' ? '팀장' : kr.objective?.owner?.role === 'INDIVIDUAL' ? '직원' : kr.objective?.owner?.role) + '-' + (kr.objective?.owner?.name || '')}] {kr.objective?.title} / {kr.title}</option>
            ))}
          </select>
        </div>
        <input placeholder="설명(선택)" value={oDesc} onChange={(e) => setODesc(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={oStart} onChange={(e) => setOStart(e.target.value)} />
          <input type="date" value={oEnd} onChange={(e) => setOEnd(e.target.value)} />
          <button className="btn btn-primary" disabled={!userId || !orgUnitId || !oTitle || !oStart || !oEnd} onClick={createObjective}>생성</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>KR 입력</h3>
        <div className="resp-2">
          <select value={krObjectiveId} onChange={(e) => setKrObjectiveId(e.target.value)}>
            <option value="">목표 선택</option>
            {objectives.map((o) => (
              <option key={o.id} value={o.id}>[{o.orgUnit?.name || '-'}] {o.title}</option>
            ))}
          </select>
          <select value={krPillar} onChange={(e) => setKrPillar(e.target.value as Pillar)}>
            <option value="Q">Q</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="DEV">Dev</option>
            <option value="P">P</option>
          </select>
        </div>
        <input placeholder="KR 제목" value={krTitle} onChange={(e) => setKrTitle(e.target.value)} />
        <div className="resp-3">
          <input placeholder="메트릭(예: %, 건수)" value={krMetric} onChange={(e) => setKrMetric(e.target.value)} />
          <input type="number" step="any" placeholder="목표값" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} />
          <input placeholder="단위(예: %, 건)" value={krUnit} onChange={(e) => setKrUnit(e.target.value)} />
        </div>
        <div className="resp-3">
          <select value={krType} onChange={(e) => setKrType(e.target.value as any)}>
            <option value="PROJECT">프로젝트형</option>
            <option value="OPERATIONAL">오퍼레이션형</option>
          </select>
          <select value={krCadence} onChange={(e) => setKrCadence(e.target.value as any)}>
            <option value="">주기(선택)</option>
            <option value="DAILY">일</option>
            <option value="WEEKLY">주</option>
            <option value="MONTHLY">월</option>
          </select>
          <input type="number" step="any" placeholder="평가비중(%)" value={krWeight} onChange={(e) => setKrWeight(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={!userId || !orgUnitId || !krObjectiveId || !krTitle || !krMetric || !krTarget || !krUnit} onClick={createKr}>KR 생성</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>주요 추진 계획 (Initiatives)</h3>
        <div className="resp-2">
          <select value={initKrId} onChange={(e) => setInitKrId(e.target.value)}>
            <option value="">KR 선택</option>
            {objectives.flatMap((o) => (o.keyResults || []).map((kr: any) => (
              <option key={kr.id} value={kr.id}>[{o.title}] {kr.title}</option>
            )))}
          </select>
          <input placeholder="과제 제목" value={initTitle} onChange={(e) => setInitTitle(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={initStart} onChange={(e) => setInitStart(e.target.value)} />
          <input type="date" value={initEnd} onChange={(e) => setInitEnd(e.target.value)} />
          <select value={initCadence} onChange={(e) => setInitCadence(e.target.value as any)}>
            <option value="">주기(선택)</option>
            <option value="DAILY">일</option>
            <option value="WEEKLY">주</option>
            <option value="MONTHLY">월</option>
          </select>
          <button className="btn btn-primary" disabled={!initKrId || !initTitle} onClick={createInitiative}>추가</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: 0 }}>팀 OKR 목록</h3>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {objectives.map((o) => (
            <div key={o.id} className="card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>목표</span>
                <b>{o.title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{o.pillar || '-'}</span>
                {myRole === 'CEO' && (
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      if (!confirm('해당 목표를 삭제할까요?')) return;
                      try {
                        await apiJson(`/api/okrs/objectives/${encodeURIComponent(o.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
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
                          <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>지표</span>
                          <div style={{ fontWeight: 600 }}>{kr.title}</div>
                          <div style={{ color: '#334155' }}>({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.pillar || '-'}{kr.cadence ? ` · ${kr.cadence}` : ''}{typeof kr.weight === 'number' ? ` · ${kr.weight}%` : ''}</div>
                          {myRole === 'CEO' && (
                            <button
                              className="btn btn-ghost"
                              onClick={async () => {
                                if (!confirm('해당 KR을 삭제할까요?')) return;
                                try {
                                  await apiJson(`/api/okrs/krs/${encodeURIComponent(kr.id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
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
          {!objectives.length && <div style={{ color: '#6b7280' }}>선택한 팀의 OKR이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
