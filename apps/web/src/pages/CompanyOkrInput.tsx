import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';

export function CompanyOkrInput() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [objectives, setObjectives] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [userId, setUserId] = useState<string>('');

  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oPillar, setOPillar] = useState<Pillar>('Q');
  const [oStart, setOStart] = useState('');
  const [oEnd, setOEnd] = useState('');

  const [krObjectiveId, setKrObjectiveId] = useState('');
  const [krTitle, setKrTitle] = useState('');
  const [krMetric, setKrMetric] = useState('');
  const [krBaseline, setKrBaseline] = useState<string>('');
  const [krTarget, setKrTarget] = useState<string>('');
  const [krUnit, setKrUnit] = useState('');
  const [krType, setKrType] = useState<'PROJECT' | 'OPERATIONAL'>('OPERATIONAL');
  const [krPillar, setKrPillar] = useState<Pillar>('Q');
  const [krCadence, setKrCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');

  useEffect(() => {
    async function load() {
      try {
        const os = await apiJson<{ items: any[] }>('/api/orgs');
        setOrgs(os.items || []);
      } catch {}
    }
    load();
  }, []);

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
    setUserId(uid);
    if (!uid) return;
    (async () => {
      try {
        const me = await apiJson<{ role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        setMyRole((me as any).role || '');
      } catch {}
    })();
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
        setObjectives(res.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      }
    }
    load();
  }, [orgUnitId]);

  async function createObjective() {
    try {
      setError(null);
      const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
      await apiJson('/api/okrs/objectives', {
        method: 'POST',
        body: JSON.stringify({ userId, title: oTitle, description: oDesc || undefined, periodStart: oStart, periodEnd: oEnd, orgUnitId: orgUnitId || undefined, pillar: oPillar }),
      });
      setOTitle(''); setODesc(''); setOStart(''); setOEnd('');
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
      const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(krObjectiveId)}/krs`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: krTitle, metric: krMetric, target: Number(krTarget), unit: krUnit, type: krType, pillar: krPillar, baseline: krBaseline === '' ? undefined : Number(krBaseline), cadence: krCadence || undefined }),
      });
      setKrObjectiveId(''); setKrTitle(''); setKrMetric(''); setKrTarget(''); setKrBaseline(''); setKrUnit(''); setKrType('OPERATIONAL'); setKrPillar('Q'); setKrCadence('');
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives${orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ''}`);
      setObjectives(res.items || []);
    } catch (e: any) {
      setError(e.message || 'KR 생성 실패');
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>전사 OKR 입력</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div>조직 선택</div>
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">전체</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.type === 'COMPANY' ? '회사' : o.type === 'DIVISION' ? '실' : o.type === 'TEAM' ? '팀' : o.type})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>상위 목표 생성</h3>
        <div className="resp-2">
          <input placeholder="목표 제목" value={oTitle} onChange={(e) => setOTitle(e.target.value)} />
          <select value={oPillar} onChange={(e) => setOPillar(e.target.value as Pillar)}>
            <option value="Q">Q</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="DEV">Dev</option>
            <option value="P">P</option>
          </select>
        </div>
        <input placeholder="설명(선택)" value={oDesc} onChange={(e) => setODesc(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={oStart} onChange={(e) => setOStart(e.target.value)} />
          <input type="date" value={oEnd} onChange={(e) => setOEnd(e.target.value)} />
          <button className="btn btn-primary" disabled={!oTitle || !oStart || !oEnd} onClick={createObjective}>생성</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>KR 생성</h3>
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
          <input type="number" step="any" placeholder="베이스라인" value={krBaseline} onChange={(e) => setKrBaseline(e.target.value)} />
          <input type="number" step="any" placeholder="목표값" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} />
        </div>
        <div className="resp-3">
          <input placeholder="단위(예: %, 건)" value={krUnit} onChange={(e) => setKrUnit(e.target.value)} />
          <select value={krType} onChange={(e) => setKrType(e.target.value as any)}>
            <option value="OPERATIONAL">오퍼레이션형</option>
            <option value="PROJECT">프로젝트형</option>
          </select>
          <select value={krCadence} onChange={(e) => setKrCadence(e.target.value as any)}>
            <option value="">주기(선택)</option>
            <option value="DAILY">일</option>
            <option value="WEEKLY">주</option>
            <option value="MONTHLY">월</option>
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" disabled={!krObjectiveId || !krTitle || !krMetric || !krTarget || !krUnit} onClick={createKr}>KR 생성</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: 0 }}>목표/지표 목록</h3>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {objectives.map((o) => (
            <div key={o.id} className="card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>목표</span>
                <b>{o.title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>[{o.orgUnit?.name || '-'}] {o.pillar || '-'}</span>
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>지표</span>
                        <div style={{ fontWeight: 600 }}>{kr.title}</div>
                        <div style={{ color: '#334155' }}>({kr.metric} / {kr.baseline != null ? `${kr.baseline} → ` : ''}{kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.pillar || '-'}{kr.cadence ? ` · ${kr.cadence}` : ''}</div>
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!objectives.length && <div style={{ color: '#6b7280' }}>해당 조직의 목표가 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
