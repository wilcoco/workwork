import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type OrgUnit = { id: string; name: string; type: string; parentId?: string | null };
type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';

type Kr = {
  id: string;
  title: string;
  unit?: string | null;
  target?: number | null;
  baseline?: number | null;
  direction?: 'AT_LEAST' | 'AT_MOST' | null;
  pillar?: Pillar | null;
  metric?: string | null;
  objectiveTitle?: string;
};

type ProgressEntry = { id: string; krValue: number | null; periodStart: string; periodEnd: string; createdAt: string };

const PILLAR_LABEL: Record<string, string> = { Q: '품질', C: '생산성', D: '납기', DEV: '개발', P: '역량' };

function kstMonth(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

export function KpiResultInput() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [myRole, setMyRole] = useState('');
  const [month, setMonth] = useState(kstMonth());
  const [krs, setKrs] = useState<Kr[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry[]>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teams = useMemo(() => orgs.filter((o) => o.type === 'TEAM'), [orgs]);
  const isExec = myRole === 'CEO' || myRole === 'EXEC';

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: OrgUnit[] }>(`/api/orgs`);
        setOrgs(res.items || []);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const me = await apiJson<{ role: string; orgUnitId?: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole(me.role || '');
        if (!orgUnitId && me.orgUnitId) setOrgUnitId(me.orgUnitId);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const monthStart = `${month}-01`;

  async function load() {
    if (!orgUnitId) { setKrs([]); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(orgUnitId)}`);
      const objs = (res.items || []).filter((o: any) => o.pillar); // 팀 KPI(정량) 목표만
      const flat: Kr[] = [];
      for (const o of objs) {
        for (const kr of (o.keyResults || [])) {
          flat.push({
            id: kr.id, title: kr.title, unit: kr.unit, target: kr.target, baseline: kr.baseline,
            direction: kr.direction, pillar: kr.pillar || o.pillar, metric: kr.metric, objectiveTitle: o.title,
          });
        }
      }
      setKrs(flat);
      // 각 KR의 진행이력 조회
      const pmap: Record<string, ProgressEntry[]> = {};
      await Promise.all(flat.map(async (kr) => {
        try {
          const pr = await apiJson<{ items: ProgressEntry[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(kr.id)}`);
          pmap[kr.id] = pr.items || [];
        } catch { pmap[kr.id] = []; }
      }));
      setProgress(pmap);
      // 선택 월의 기존 값으로 입력 프리필
      const init: Record<string, string> = {};
      for (const kr of flat) {
        const monthEntry = (pmap[kr.id] || []).find((e) => String(e.periodStart).slice(0, 7) === month);
        init[kr.id] = monthEntry?.krValue != null ? String(monthEntry.krValue) : '';
      }
      setInputs(init);
    } catch (e: any) {
      setError(e?.message || 'KPI를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgUnitId, month]);

  function latestOf(krId: string): ProgressEntry | null {
    const list = progress[krId] || [];
    return list.length ? list[0] : null; // 서버가 createdAt desc 정렬
  }

  function achievement(kr: Kr, value: number | null | undefined): number | null {
    if (value == null || kr.target == null || kr.target === 0) return null;
    const pct = kr.direction === 'AT_MOST' ? (kr.target / value) * 100 : (value / kr.target) * 100;
    return Math.round(pct * 10) / 10;
  }

  async function save(kr: Kr) {
    const raw = (inputs[kr.id] ?? '').trim();
    if (raw === '') { alert('실적값을 입력하세요'); return; }
    const v = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(v)) { alert('숫자만 입력하세요'); return; }
    setSavingId(kr.id);
    try {
      await apiJson('/api/progress', {
        method: 'POST',
        body: JSON.stringify({ subjectType: 'KR', subjectId: kr.id, actorId: userId, krValue: v, at: monthStart }),
      });
      // 해당 KR 진행이력만 갱신
      const pr = await apiJson<{ items: ProgressEntry[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(kr.id)}`);
      setProgress((m) => ({ ...m, [kr.id]: pr.items || [] }));
    } catch (e: any) {
      alert(e?.message || '저장에 실패했습니다');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>KPI 실적 입력 (수동)</h2>
      <div style={{ color: '#475569', fontSize: 13 }}>
        팀과 월을 선택해 KPI별 실적값을 직접 입력합니다. 업무일지를 거치지 않고 바로 기록됩니다.
        KPI <b>내용</b>(명/산식/목표 등) 등록은 「정량 목표(팀 KPI) 입력」 메뉴에서 합니다.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>팀</span>
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} disabled={!isExec} style={{ padding: '6px 8px' }}>
            <option value="">팀 선택</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>월</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '6px 8px' }} />
        </label>
        <button type="button" className="btn btn-sm" onClick={() => void load()} style={{ alignSelf: 'flex-end' }}>새로고침</button>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>불러오는 중…</div>
      ) : krs.length === 0 ? (
        <div style={{ color: '#64748b', padding: 20, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>
          {orgUnitId ? '이 팀에 등록된 정량 KPI가 없습니다. 「정량 목표(팀 KPI) 입력」에서 먼저 등록하세요.' : '팀을 선택하세요.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '6px 8px' }}>구분</th>
                <th style={{ padding: '6px 8px' }}>KPI</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>목표</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{month} 실적</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>달성률</th>
                <th style={{ padding: '6px 8px' }}>최근 입력</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {krs.map((kr) => {
                const last = latestOf(kr.id);
                const inputVal = inputs[kr.id] ?? '';
                const numVal = inputVal.trim() === '' ? null : Number(inputVal.replace(/,/g, ''));
                const pct = achievement(kr, numVal);
                return (
                  <tr key={kr.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ fontSize: 11, background: '#eef2ff', color: '#3730a3', borderRadius: 6, padding: '1px 6px' }}>{kr.pillar ? (PILLAR_LABEL[kr.pillar] || kr.pillar) : '-'}</span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{kr.title}{kr.unit ? ` (${kr.unit})` : ''}</div>
                      {kr.metric && <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', maxWidth: 320 }}>{kr.metric}</div>}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{kr.target != null ? kr.target.toLocaleString() : '-'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <input
                        inputMode="decimal"
                        value={inputVal}
                        onChange={(e) => setInputs((m) => ({ ...m, [kr.id]: e.target.value }))}
                        style={{ width: 90, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'right' }}
                        placeholder="값"
                      />
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: pct == null ? '#94a3b8' : pct >= 100 ? '#16a34a' : '#b45309' }}>
                      {pct != null ? `${pct}%` : '-'}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#475569', fontSize: 12 }}>
                      {last && last.krValue != null ? `${last.krValue.toLocaleString()} (${String(last.periodStart).slice(0, 7)})` : '-'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <button type="button" className="btn btn-sm" disabled={savingId === kr.id} onClick={() => void save(kr)}>
                        {savingId === kr.id ? '저장…' : '저장'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
