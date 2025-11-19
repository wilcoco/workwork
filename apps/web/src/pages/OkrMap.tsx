import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

function KrNode({ kr, childKrId, setChildKrId, childTitle, setChildTitle, childDesc, setChildDesc, childStart, setChildStart, childEnd, setChildEnd, onSubmitChild }: { kr: any; childKrId: string; setChildKrId: (v: string) => void; childTitle: string; setChildTitle: (v: string) => void; childDesc: string; setChildDesc: (v: string) => void; childStart: string; setChildStart: (v: string) => void; childEnd: string; setChildEnd: (v: string) => void; onSubmitChild: (krId: string, orgUnitId?: string) => Promise<void> }) {
  return (
    <li style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>KR</span>
        <div style={{ fontWeight: 600 }}>{kr.title}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.type}</div>
      </div>
      <div style={{ marginLeft: 18, marginTop: 6 }}>
        {childKrId !== kr.id ? (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setChildKrId(kr.id);
          }}>하위 목표 추가</button>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSubmitChild(kr.id, kr.orgUnitId);
            }}
            style={{ display: 'grid', gap: 6, maxWidth: 640 }}
          >
            <input placeholder="하위 목표 제목" value={childTitle} onChange={(e) => setChildTitle(e.target.value)} required />
            <input placeholder="설명(선택)" value={childDesc} onChange={(e) => setChildDesc(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="date" value={childStart} onChange={(e) => setChildStart(e.target.value)} required />
              <input type="date" value={childEnd} onChange={(e) => setChildEnd(e.target.value)} required />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm">생성</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChildKrId('')}>취소</button>
            </div>
          </form>
        )}
      </div>
      {Array.isArray(kr.children) && kr.children.length > 0 && (
        <ul style={{ marginLeft: 18 }}>
          {kr.children.map((child: any) => (
            <ObjNode
              key={child.id}
              obj={child}
              krObjId={''}
              setKrObjId={() => {}}
              krTitle={''}
              setKrTitle={() => {}}
              krMetric={''}
              setKrMetric={() => {}}
              krTarget={''}
              setKrTarget={() => {}}
              krUnit={''}
              setKrUnit={() => {}}
              krType={''}
              setKrType={() => {}}
              onSubmitKr={async () => {}}
              childKrId={childKrId}
              setChildKrId={setChildKrId}
              childTitle={childTitle}
              setChildTitle={setChildTitle}
              childDesc={childDesc}
              setChildDesc={setChildDesc}
              childStart={childStart}
              setChildStart={setChildStart}
              childEnd={childEnd}
              setChildEnd={setChildEnd}
              onSubmitChild={onSubmitChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ObjNode({ obj, krObjId, setKrObjId, krTitle, setKrTitle, krMetric, setKrMetric, krTarget, setKrTarget, krUnit, setKrUnit, krType, setKrType, onSubmitKr, childKrId, setChildKrId, childTitle, setChildTitle, childDesc, setChildDesc, childStart, setChildStart, childEnd, setChildEnd, onSubmitChild }: { obj: any; krObjId: string; setKrObjId: (v: string) => void; krTitle: string; setKrTitle: (v: string) => void; krMetric: string; setKrMetric: (v: string) => void; krTarget: number | ''; setKrTarget: (v: number | '') => void; krUnit: string; setKrUnit: (v: string) => void; krType: string; setKrType: (v: string) => void; onSubmitKr: (objectiveId: string) => Promise<void>; childKrId: string; setChildKrId: (v: string) => void; childTitle: string; setChildTitle: (v: string) => void; childDesc: string; setChildDesc: (v: string) => void; childStart: string; setChildStart: (v: string) => void; childEnd: string; setChildEnd: (v: string) => void; onSubmitChild: (krId: string, orgUnitId?: string) => Promise<void> }) {
  return (
    <li style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>O</span>
          <div style={{ fontWeight: 700 }}>{obj.title}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>[{obj.orgUnit?.name || '-'}] {obj.owner?.name || ''} ({obj.owner?.role || ''})</div>
        </div>
        {obj.description && <div style={{ color: '#374151' }}>{obj.description}</div>}
        <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(obj.periodStart).toLocaleDateString()} ~ {new Date(obj.periodEnd).toLocaleDateString()} · {obj.status}</div>
      </div>
      <div style={{ marginLeft: 18, marginTop: 6 }}>
        {krObjId !== obj.id ? (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setKrObjId(obj.id);
          }}>정량 KR 추가</button>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSubmitKr(obj.id);
            }}
            style={{ display: 'grid', gap: 6, maxWidth: 640 }}
          >
            <input placeholder="KR 제목" value={krTitle} onChange={(e) => setKrTitle(e.target.value)} required />
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="지표" value={krMetric} onChange={(e) => setKrMetric(e.target.value)} required />
              <input type="number" placeholder="목표값" value={krTarget} onChange={(e) => setKrTarget(e.target.value === '' ? '' : Number(e.target.value))} required />
              <input placeholder="단위" value={krUnit} onChange={(e) => setKrUnit(e.target.value)} required />
              <select value={krType} onChange={(e) => setKrType(e.target.value)}>
                <option value="PROJECT">PROJECT</option>
                <option value="OPERATIONAL">OPERATIONAL</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm">추가</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKrObjId('')}>취소</button>
            </div>
          </form>
        )}
      </div>
      {Array.isArray(obj.keyResults) && obj.keyResults.length > 0 && (
        <ul style={{ marginLeft: 18 }}>
          {obj.keyResults.map((kr: any) => (
            <KrNode
              key={kr.id}
              kr={kr}
              childKrId={childKrId}
              setChildKrId={setChildKrId}
              childTitle={childTitle}
              setChildTitle={setChildTitle}
              childDesc={childDesc}
              setChildDesc={setChildDesc}
              childStart={childStart}
              setChildStart={setChildStart}
              childEnd={childEnd}
              setChildEnd={setChildEnd}
              onSubmitChild={onSubmitChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OkrMap() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [topOrgId, setTopOrgId] = useState('');
  const [topTitle, setTopTitle] = useState('');
  const [topDesc, setTopDesc] = useState('');
  function dateStr(d: Date) { return d.toISOString().slice(0, 10); }
  const [topStart, setTopStart] = useState(dateStr(new Date()));
  const [topEnd, setTopEnd] = useState(dateStr(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)));

  const [krObjId, setKrObjId] = useState('');
  const [krTitle, setKrTitle] = useState('');
  const [krMetric, setKrMetric] = useState('');
  const [krTarget, setKrTarget] = useState<number | ''>('');
  const [krUnit, setKrUnit] = useState('');
  const [krType, setKrType] = useState('PROJECT');

  const [childKrId, setChildKrId] = useState('');
  const [childTitle, setChildTitle] = useState('');
  const [childDesc, setChildDesc] = useState('');
  const [childStart, setChildStart] = useState(dateStr(new Date()));
  const [childEnd, setChildEnd] = useState(dateStr(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)));

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ items: any[] }>(`/api/okrs/map`);
        setItems(res.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      } finally {
        setLoading(false);
      }
    }
    load();
    async function loadOrgs() {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/orgs`);
        setOrgs(res.items || []);
      } catch {}
    }
    loadOrgs();
  }, []);

  async function createTopObjective(e: React.FormEvent) {
    e.preventDefault();
    try {
      const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
      await apiJson(`/api/okrs/objectives`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: topTitle, description: topDesc || undefined, periodStart: topStart, periodEnd: topEnd, orgUnitId: topOrgId || undefined })
      });
      setTopTitle('');
      setTopDesc('');
      setTopOrgId('');
      await reload();
    } catch (e: any) {
      setError(e.message || '생성 실패');
    }
  }

  async function onSubmitKr(objectiveId: string) {
    try {
      const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(objectiveId)}/krs`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: krTitle, metric: krMetric, target: krTarget === '' ? 0 : Number(krTarget), unit: krUnit, type: krType })
      });
      setKrObjId('');
      setKrTitle('');
      setKrMetric('');
      setKrTarget('');
      setKrUnit('');
      setKrType('PROJECT');
      await reload();
    } catch (e: any) {
      setError(e.message || 'KR 추가 실패');
    }
  }

  async function onSubmitChild(krId: string, orgUnitId?: string) {
    try {
      const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
      await apiJson(`/api/okrs/objectives`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: childTitle, description: childDesc || undefined, periodStart: childStart, periodEnd: childEnd, alignsToKrId: krId, orgUnitId })
      });
      setChildKrId('');
      setChildTitle('');
      setChildDesc('');
      setChildStart(dateStr(new Date()));
      setChildEnd(dateStr(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)));
      await reload();
    } catch (e: any) {
      setError(e.message || '하위 목표 추가 실패');
    }
  }

  async function reload() {
    try {
      const res = await apiJson<{ items: any[] }>(`/api/okrs/map`);
      setItems(res.items || []);
    } catch {}
  }

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>전사 목표</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>상위 목표 생성</h3>
        <form onSubmit={createTopObjective} style={{ display: 'grid', gap: 8 }}>
          <select value={topOrgId} onChange={(e) => setTopOrgId(e.target.value)} required>
            <option value="">조직 선택</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.type})</option>
            ))}
          </select>
          <input placeholder="목표 제목" value={topTitle} onChange={(e) => setTopTitle(e.target.value)} required />
          <input placeholder="설명(선택)" value={topDesc} onChange={(e) => setTopDesc(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={topStart} onChange={(e) => setTopStart(e.target.value)} required />
            <input type="date" value={topEnd} onChange={(e) => setTopEnd(e.target.value)} required />
          </div>
          <button className="btn btn-primary">생성</button>
        </form>
      </div>
      {loading ? (
        <div>로딩중…</div>
      ) : (
        <ul>
          {items.map((o) => (
            <ObjNode
              key={o.id}
              obj={o}
              krObjId={krObjId}
              setKrObjId={setKrObjId}
              krTitle={krTitle}
              setKrTitle={setKrTitle}
              krMetric={krMetric}
              setKrMetric={setKrMetric}
              krTarget={krTarget}
              setKrTarget={setKrTarget}
              krUnit={krUnit}
              setKrUnit={setKrUnit}
              krType={krType}
              setKrType={setKrType}
              onSubmitKr={onSubmitKr}
              childKrId={childKrId}
              setChildKrId={setChildKrId}
              childTitle={childTitle}
              setChildTitle={setChildTitle}
              childDesc={childDesc}
              setChildDesc={setChildDesc}
              childStart={childStart}
              setChildStart={setChildStart}
              childEnd={childEnd}
              setChildEnd={setChildEnd}
              onSubmitChild={onSubmitChild}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
