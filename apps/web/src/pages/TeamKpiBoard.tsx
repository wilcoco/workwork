import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';

type OrgUnit = { id: string; name: string; type: string };

type KrRow = {
  id: string;
  pillar: Pillar | null;
  pillarLabel: string;
  kpiName: string;
  unit: string;
  cadence: string | '';
  baseline: number | null;
  target: number;
  weight: number | null;
  initiatives: Array<{ id: string; title: string; done?: boolean }>;
  latestValue?: number | null;
  latestPeriodEnd?: string | null;
  warn?: boolean;
  periods?: Array<{ label: string; value: number | null }>;
};

function toPillarLabel(p: Pillar | null | undefined): string {
  const map: Record<Pillar, string> = { Q: '품질 혁신', C: '생산성 혁신', D: '납기 혁신', DEV: '신차개발', P: '역량강화' };
  return p ? map[p] : '-';
}

export function TeamKpiBoard() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [rows, setRows] = useState<KrRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrgs() {
      try {
        const res = await apiJson<{ items: OrgUnit[] }>(`/api/orgs`);
        setOrgs(res.items || []);
      } catch {}
    }
    loadOrgs();
  }, []);

  useEffect(() => {
    async function loadBoard() {
      try {
        setError(null);
        if (!orgUnitId) { setRows([]); return; }
        const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(orgUnitId)}`);
        const items = res.items || [];
        const r: KrRow[] = [];
        for (const o of items) {
          const pillar: Pillar | null = (o.pillar as any) ?? null;
          if (!pillar) continue; // Only KPI objectives (pillar is set)
          for (const kr of (o.keyResults || [])) {
            r.push({
              id: kr.id,
              pillar,
              pillarLabel: toPillarLabel(pillar),
              kpiName: kr.title || '-',
              unit: kr.unit || '-',
              cadence: kr.cadence || '',
              baseline: typeof kr.baseline === 'number' ? kr.baseline : null,
              target: typeof kr.target === 'number' ? kr.target : 0,
              weight: typeof kr.weight === 'number' ? kr.weight : null,
              initiatives: Array.isArray(kr.initiatives) ? kr.initiatives.map((ii: any) => ({ id: ii.id, title: ii.title })).filter((x: { id: string; title: string }) => !!x.title) : [],
            });
          }
        }
        function labelForPeriod(cadence: string | '', ps?: string, pe?: string) {
          if (!ps) return '';
          const d = new Date(ps);
          const yy = String(d.getFullYear()).slice(2);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          if (cadence === 'QUARTERLY') {
            const q = Math.floor(d.getMonth() / 3) + 1;
            return `${yy}-Q${q}`;
          }
          if (cadence === 'WEEKLY') {
            const onejan = new Date(d.getFullYear(), 0, 1);
            const week = Math.ceil((((d as any) - (onejan as any)) / 86400000 + onejan.getDay() + 1) / 7);
            return `${yy}-W${String(week).padStart(2, '0')}`;
          }
          if (cadence === 'DAILY') return `${yy}-${mm}-${String(d.getDate()).padStart(2, '0')}`;
          return `${yy}-${mm}`;
        }

        const enhanced = await Promise.all(r.map(async (row) => {
          try {
            const pr = await apiJson<{ items: any[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(row.id)}`);
            const list = pr.items || [];
            const latest = list[0] || null;
            const latestValue = latest?.krValue ?? null;
            const latestPeriodEnd = latest?.periodEnd ?? null;
            let warn = false;
            if (latest && latestValue != null && latestPeriodEnd) {
              if (new Date(latestPeriodEnd) < new Date() && latestValue < row.target) warn = true;
            }
            const periods = list.slice(0, 6).map((e: any) => ({ label: labelForPeriod(row.cadence, e.periodStart, e.periodEnd), value: e.krValue ?? null }));
            // initiative done flags
            const inits = await Promise.all((row.initiatives || []).map(async (ii) => {
              try {
                const ir = await apiJson<{ items: any[] }>(`/api/progress?subjectType=INITIATIVE&subjectId=${encodeURIComponent(ii.id)}`);
                const done = (ir.items || []).some((x: any) => x.initiativeDone && new Date(x.periodEnd) <= new Date());
                return { ...ii, done };
              } catch {
                return { ...ii };
              }
            }));
            return { ...row, latestValue, latestPeriodEnd, warn, periods, initiatives: inits } as KrRow;
          } catch {
            return { ...row } as KrRow;
          }
        }));
        enhanced.sort((a, b) => a.pillarLabel.localeCompare(b.pillarLabel));
        setRows(enhanced);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      }
    }
    loadBoard();
  }, [orgUnitId]);

  const grouped = useMemo(() => {
    const map: Record<string, KrRow[]> = {};
    for (const row of rows) {
      const key = row.pillarLabel;
      if (!map[key]) map[key] = [];
      map[key].push(row);
    }
    return map;
  }, [rows]);

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>팀 KPI 보드</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div>팀 선택</div>
        <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
          <option value="">선택</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name} ({o.type === 'COMPANY' ? '회사' : o.type === 'DIVISION' ? '실' : o.type === 'TEAM' ? '팀' : o.type})</option>
          ))}
        </select>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="card" style={{ padding: 12, color: '#6b7280' }}>선택된 팀의 KPI가 없습니다.</div>
      ) : (
        Object.entries(grouped).map(([pillarLabel, items]) => (
          <div key={pillarLabel} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{pillarLabel}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>구 분</th>
                    <th style={th}>단위</th>
                    <th style={th}>주기</th>
                    <th style={th}>'24실적</th>
                    <th style={th}>'25목표</th>
                    <th style={th}>향상률</th>
                    <th style={th}>평가비중</th>
                    <th style={th}>월/분기 관리</th>
                    <th style={th}>주요 추진 계획</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const delta = r.baseline == null ? null : (r.target - r.baseline);
                    const arrow = delta == null ? '' : (delta >= 0 ? '▲' : '▼');
                    return (
                      <tr key={r.id} style={r.warn ? { background: '#fee2e2' } : undefined}>
                        <td style={td}>{r.kpiName}</td>
                        <td style={td}>{r.unit}</td>
                        <td style={td}>{r.cadence || '-'}</td>
                        <td style={td}>{r.baseline == null ? '-' : r.baseline}</td>
                        <td style={td}>{r.target}</td>
                        <td style={td}>{delta == null ? '-' : `${arrow} ${Math.abs(delta)}`}</td>
                        <td style={td}>{r.weight == null ? '-' : r.weight}</td>
                        <td style={td}>{r.periods && r.periods.length ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {r.periods.map((p, i) => (
                              <span key={i} style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>
                                {p.label}: {p.value == null ? '-' : p.value}
                              </span>
                            ))}
                          </div>
                        ) : '-'}</td>
                        <td style={td}>{r.initiatives.length ? (
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {r.initiatives.map((it, i) => (
                              <li key={it.id}>
                                {it.title} {it.done ? <span style={{ color: '#16a34a', fontWeight: 700 }}>(완료)</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '8px 6px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '8px 6px', verticalAlign: 'top' };
