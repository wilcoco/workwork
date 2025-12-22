import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
// TeamKpiBoard: 최근 실적 셀 레이아웃 조정용 빌드 트리거 주석

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
  year25Target?: number | null;
  target: number;
  weight: number | null;
  direction?: 'AT_LEAST' | 'AT_MOST' | null;
  analysis25?: string | null;
  initiatives: Array<{ id: string; title: string; startAt?: string | null; endAt?: string | null; done?: boolean }>;
  latestValue?: number | null;
  latestPeriodEnd?: string | null;
  warn?: boolean;
  bg?: 'red' | 'orange' | null;
  periods?: Array<{ label: string; value: number | null }>;
  history?: Array<{ label: string; value: number | null; createdAt?: string | null }>;
  latestCreatedAt?: string | null;
  stalenessDays?: number | null;
  status?: 'On Track' | 'At Risk' | 'Off Track' | '-';
  coverage?: { numActive: number; numTotal: number; pct: number } | null;
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
  const [groupShowLimit, setGroupShowLimit] = useState<Record<string, number>>({});

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
              year25Target: typeof (kr as any).year25Target === 'number' ? (kr as any).year25Target : null,
              target: typeof kr.target === 'number' ? kr.target : 0,
              weight: typeof kr.weight === 'number' ? kr.weight : null,
              direction: (kr as any)?.direction ?? null,
              analysis25: (kr as any)?.analysis25 ?? null,
              initiatives: Array.isArray(kr.initiatives) ? kr.initiatives.map((ii: any) => ({ id: ii.id, title: ii.title, startAt: ii.startAt || null, endAt: ii.endAt || null })).filter((x: { id: string; title: string }) => !!x.title) : [],
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
          if (cadence === 'HALF_YEARLY') {
            const h = d.getMonth() < 6 ? 'H1' : 'H2';
            return `${yy}-${h}`;
          }
          if (cadence === 'YEARLY') {
            return `${d.getFullYear()}`;
          }
          if (cadence === 'WEEKLY') {
            const onejan = new Date(d.getFullYear(), 0, 1);
            const week = Math.ceil((((d as any) - (onejan as any)) / 86400000 + onejan.getDay() + 1) / 7);
            return `${yy}-W${String(week).padStart(2, '0')}`;
          }
          if (cadence === 'DAILY') return `${yy}-${mm}-${String(d.getDate()).padStart(2, '0')}`;
          return `${yy}-${mm}`;
        }

        function lastCompletedPeriodEnd(cadence: string | ''): Date {
          const now = new Date();
          const y = now.getFullYear();
          const m = now.getMonth(); // 0-11
          if (cadence === 'QUARTERLY') {
            const q = Math.floor(m / 3); // 0..3 current quarter
            const prevQEnd = q === 0 ? new Date(y - 1, 12, 0, 23, 59, 59, 999) : new Date(y, q * 3, 0, 23, 59, 59, 999);
            return prevQEnd;
          }
          if (cadence === 'HALF_YEARLY') {
            if (m < 6) return new Date(y - 1, 12, 0, 23, 59, 59, 999); // previous year end
            return new Date(y, 6, 0, 23, 59, 59, 999); // Jun end
          }
          if (cadence === 'YEARLY') {
            return new Date(y - 1, 12, 0, 23, 59, 59, 999);
          }
          // MONTHLY default
          return new Date(y, m, 0, 23, 59, 59, 999);
        }

        function monthRange(d: Date): { from: string; to: string } {
          const y = d.getFullYear();
          const m = d.getMonth();
          const from = new Date(y, m, 1);
          const to = new Date(y, m + 1, 0, 23, 59, 59, 999);
          const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
          return { from: fmt(from), to: fmt(to) };
        }

        const enhanced = await Promise.all(r.map(async (row) => {
          try {
            const pr = await apiJson<{ items: any[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(row.id)}`);
            const list = pr.items || [];
            const latest = list[0] || null;
            const latestValue = latest?.krValue ?? null;
            const latestPeriodEnd = latest?.periodEnd ?? null;
            const latestCreatedAt = latest?.createdAt ?? null;
            // Compute warnings: only based on latest vs target and direction
            let warn = false;
            let bg: 'red' | 'orange' | null = null;
            if (latestValue != null) {
              const dir = row.direction || 'AT_LEAST';
              const violate = dir === 'AT_LEAST' ? (latestValue < row.target) : (latestValue > row.target);
              if (violate) { bg = 'orange'; warn = true; }
            }
            // group by cadence period label and take latest per period (list already desc by createdAt)
            const seen: Record<string, { label: string; value: number | null }> = {};
            for (const e of list) {
              const label = labelForPeriod('MONTHLY', e.periodStart, e.periodEnd);
              if (!label) continue;
              if (!seen[label]) seen[label] = { label, value: e.krValue ?? null };
            }
            const grouped = Object.values(seen);
            // cap number of chips by cadence
            const cap = row.cadence === 'DAILY' ? 14 : row.cadence === 'WEEKLY' ? 8 : row.cadence === 'QUARTERLY' ? 4 : row.cadence === 'YEARLY' ? 1 : row.cadence === 'HALF_YEARLY' ? 2 : 6;
            const periods = grouped.slice(0, cap);
            // full history for dropdown (monthly labels)
            const history = list.map((e: any) => ({ label: labelForPeriod('MONTHLY', e.periodStart, e.periodEnd), value: e.krValue ?? null, createdAt: e.createdAt || null }));
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
            // staleness days
            const stalenessDays = latestCreatedAt ? Math.floor((Date.now() - new Date(latestCreatedAt).getTime()) / (1000*60*60*24)) : null;
            // status by variance threshold
            let status: 'On Track' | 'At Risk' | 'Off Track' | '-' = '-';
            if (latestValue != null && typeof row.target === 'number' && row.target !== 0) {
              const dir = row.direction || 'AT_LEAST';
              const diff = dir === 'AT_LEAST' ? (latestValue - row.target) : (row.target - latestValue);
              const pct = diff / Math.abs(row.target);
              status = pct >= 0 ? 'On Track' : (pct >= -0.10 ? 'At Risk' : 'Off Track');
            }
            // coverage this month: active initiatives with worklogs / total initiatives
            let coverage: { numActive: number; numTotal: number; pct: number } | null = null;
            try {
              const { from, to } = monthRange(new Date());
              const wl = await apiJson<{ items: any[] }>(`/api/worklogs/search?krId=${encodeURIComponent(row.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=1000`);
              const set = new Set<string>();
              for (const it of (wl.items || [])) {
                const anyIt: any = it as any;
                if (anyIt?.taskName && anyIt?.id) {
                  // We don't have initiativeId in mapped item; fallback by taskName uniqueness
                  set.add(anyIt.taskName as string);
                }
              }
              const numActive = set.size;
              const numTotal = (inits || []).length || 0;
              const pct = numTotal > 0 ? Math.min(1, numActive / numTotal) : 0;
              coverage = { numActive, numTotal, pct };
            } catch {}
            return { ...row, latestValue, latestPeriodEnd, latestCreatedAt, stalenessDays, status, warn, bg, periods, history, initiatives: inits, coverage } as KrRow;
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
                    <th style={th}>관리 주기</th>
                    <th style={th}>25년 목표</th>
                    <th style={th}>25년 실적</th>
                    <th style={th}>26년 목표</th>
                    <th style={th}>26년 실적</th>
                    <th style={th}>그래프</th>
                    <th style={th}>평가비중</th>
                    <th style={th}>주요 추진 계획</th>
                  </tr>
                </thead>
                <tbody>
                  {(items.slice(0, groupShowLimit[pillarLabel] || 10)).map((r) => {
                    const delta = r.baseline == null ? null : (r.target - r.baseline);
                    const arrow = delta == null ? '' : (delta >= 0 ? '▲' : '▼');
                    return (
                      <tr key={r.id} style={r.bg === 'red' ? { background: '#fee2e2' } : r.bg === 'orange' ? { background: '#ffedd5' } : undefined}>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontWeight: 600 }}>{r.kpiName}</div>
                            {r.status && r.status !== '-' && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: r.status === 'On Track' ? '#065f46' : r.status === 'At Risk' ? '#92400e' : '#991b1b', background: r.status === 'On Track' ? '#d1fae5' : r.status === 'At Risk' ? '#fef3c7' : '#fee2e2', border: '1px solid', borderColor: r.status === 'On Track' ? '#10b981' : r.status === 'At Risk' ? '#f59e0b' : '#ef4444', borderRadius: 999, padding: '2px 6px' }}>
                                {r.status}
                              </span>
                            )}
                          </div>
                          {r.analysis25 && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#4b5563' }}>{r.analysis25}</div>
                          )}
                        </td>
                        <td style={td}>{r.unit}</td>
                        <td style={td}>{'월'}</td>
                        <td style={td}>{r.year25Target == null ? '-' : r.year25Target}</td>
                        <td style={td}>{r.baseline == null ? '-' : r.baseline}</td>
                        <td style={td}>{r.target == null ? '-' : r.target}</td>
                        <td style={td}>{(() => {
                          const h = r.history || [];
                          if (!h.length) return '-';
                          const latest = h[0];
                          const latestDate = latest.createdAt ? new Date(latest.createdAt).toISOString().slice(0,10) : '-';
                          return (
                            <div style={{ display: 'grid', gap: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{latest.value == null ? '-' : latest.value}</span>
                              </div>
                              <div style={{ fontSize: 12, color: '#64748b' }}>입력일자 {latestDate}</div>
                              <details>
                                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b' }}>더보기</summary>
                                <div style={{ marginTop: 4 }}>
                                  <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 4 }}>
                                    {h.map((e, i) => {
                                      const d = e.createdAt ? new Date(e.createdAt).toISOString().slice(0,10) : '-';
                                      return (
                                        <li key={i}>
                                          <div>{e.value == null ? '-' : e.value}</div>
                                          <div style={{ fontSize: 12, color: '#64748b' }}>입력일자 {d}</div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              </details>
                            </div>
                          );
                        })()}</td>
                        <td style={td}>{(() => {
                          const h = r.history || [];
                          if (!h.length) return '-';
                          const vals = h.slice(0, 12).map((e) => (typeof e.value === 'number' ? e.value : null)).reverse();
                          const defined = vals.filter((v) => v != null) as number[];
                          if (!defined.length) return '-';
                          const w = 140, he = 40, pad = 4;
                          const min = Math.min(...defined, 0);
                          const max = Math.max(...defined, r.target || 0);
                          const scaleY = (v: number) => {
                            if (max === min) return he / 2;
                            return he - pad - ((v - min) / (max - min)) * (he - pad * 2);
                          };
                          const pts = defined.map((v, i) => `${(i * (w / Math.max(defined.length - 1, 1))).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');
                          const tgtY = scaleY(r.target || 0);
                          return (
                            <div style={{ minWidth: 140 }}>
                              <svg width={w} height={he}>
                                <polyline fill="none" stroke="#0F3D73" strokeWidth="1.5" points={pts} />
                                {r.target != null && <line x1={0} x2={w} y1={tgtY} y2={tgtY} stroke="#94a3b8" strokeDasharray="2,2" />}
                              </svg>
                            </div>
                          );
                        })()}</td>
                        <td style={td}>{r.weight == null ? '-' : r.weight}</td>
                        <td style={td}>{r.initiatives.length ? (
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {r.initiatives.map((it, i) => (
                              <li key={it.id}>
                                {it.title} {(() => {
                                  const fmt = (s?: string | null) => s ? `${new Date(s).getFullYear()}-${String(new Date(s).getMonth()+1).padStart(2,'0')}-${String(new Date(s).getDate()).padStart(2,'0')}` : '';
                                  const s = fmt(it.startAt);
                                  const e = fmt(it.endAt);
                                  return (s || e) ? <span style={{ color: '#475569' }}> ({s}{s||e?' ~ ':''}{e})</span> : null;
                                })()} {it.done ? <span style={{ color: '#16a34a', fontWeight: 700 }}>(완료)</span> : null}
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
            {items.length > (groupShowLimit[pillarLabel] || 10) && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button className="btn" onClick={() => setGroupShowLimit((prev) => ({ ...prev, [pillarLabel]: (prev[pillarLabel] || 10) + 10 }))}>더보기</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '8px 6px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '8px 6px', verticalAlign: 'top' };
