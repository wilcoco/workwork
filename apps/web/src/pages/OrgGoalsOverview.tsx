import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

// 전사 목표 현황 — 회사 → 실(DIVISION) → 팀(TEAM) → 개인 드릴다운으로
// 정량(KPI 지표 달성)과 정성(OKR 과제·중점 추진 과제) 진행상황을 모니터링

type Kpi = {
  krId: string; title: string; pillar: string | null; unit: string;
  target: number; direction: 'AT_LEAST' | 'AT_MOST';
  latestValue: number | null; latestAt: string | null;
  achievementPct: number | null; status: 'OK' | 'WARN' | 'NONE';
};

type QualObjective = {
  id: string; title: string; ownerName: string; status: string;
  krCount: number; initTotal: number; initDone: number; initActive: number;
};

type KiItem = {
  id: string; title: string; status: string; assigneeName: string | null;
  dueDate: string | null; alignsTo: string | null; latestPct: number | null; warning?: string | null;
};

type Member = {
  userId: string; name: string; role: string;
  quant: { count: number; ok: number; warn: number; noData: number };
  qual: { active: number; done: number; total: number };
  personal: { active: number; done: number; total: number };
  kiOpen: number; kiDelayed: number;
  lastWorklogAt: string | null;
};

type Unit = {
  id: string; name: string; type: string; parentId: string | null;
  kpis: Kpi[];
  qualObjectives: QualObjective[];
  keyInits: { total: number; inProgress: number; delayed: number; completed: number; items: KiItem[] };
  members: Member[];
};

type KpiDetail = {
  kr: {
    id: string; title: string; metric: string; unit: string; target: number;
    baseline: number | null; direction: 'AT_LEAST' | 'AT_MOST'; cadence: string;
    pillar: string | null; objTitle: string; orgName: string;
  };
  result: { latestValue: number | null; latestAt: string | null; achievementPct: number | null; status: 'OK' | 'WARN' | 'NONE'; entryCount: number };
  people: { userId: string; name: string; role: string; assignRole: string | null; assigned: boolean; lastValue: number | null; lastAt: string | null; count: number }[];
  trend: { id: string; krValue: number | null; actorName: string; periodStart: string; periodEnd: string; note: string | null; hasWorklog: boolean; createdAt: string }[];
};

const KI_LABELS: Record<string, string> = { NOT_STARTED: '미착수', IN_PROGRESS: '진행중', DELAYED: '지연', COMPLETED: '완료', CANCELLED: '취소' };
const TYPE_LABELS: Record<string, string> = { COMPANY: '회사', DIVISION: '실', TEAM: '팀' };

function fmtDate(d?: string | null) { return d ? String(d).slice(0, 10) : '—'; }

type Rollup = { kpiOk: number; kpiWarn: number; kpiNone: number; qualDone: number; qualTotal: number; kiOpen: number; kiDelayed: number; memberCount: number };

function emptyRollup(): Rollup { return { kpiOk: 0, kpiWarn: 0, kpiNone: 0, qualDone: 0, qualTotal: 0, kiOpen: 0, kiDelayed: 0, memberCount: 0 }; }

function addOwn(r: Rollup, u: Unit) {
  for (const k of u.kpis) {
    if (k.status === 'OK') r.kpiOk += 1; else if (k.status === 'WARN') r.kpiWarn += 1; else r.kpiNone += 1;
  }
  for (const q of u.qualObjectives) { r.qualDone += q.initDone; r.qualTotal += q.initTotal; }
  r.kiOpen += u.keyInits.total - u.keyInits.completed;
  r.kiDelayed += u.keyInits.delayed;
  r.memberCount += u.members.length;
}

function Sparkline({ values, target, direction }: { values: number[]; target: number; direction: 'AT_LEAST' | 'AT_MOST' }) {
  if (values.length === 0) return <span style={{ color: '#cbd5e1', fontSize: 12 }}>입력 없음</span>;
  const all = [...values, target];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const w = 240, h = 56, pad = 4;
  const xs = values.length === 1 ? [w / 2] : values.map((_, i) => pad + (i * (w - pad * 2)) / (values.length - 1));
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = values.map((v, i) => `${xs[i]},${y(v)}`).join(' ');
  const ty = y(target);
  const last = values[values.length - 1];
  const ok = direction === 'AT_LEAST' ? last >= target : last <= target;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <line x1={0} y1={ty} x2={w} y2={ty} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" />
      <polyline points={pts} fill="none" stroke={ok ? '#16a34a' : '#dc2626'} strokeWidth={2} />
      {values.map((v, i) => <circle key={i} cx={xs[i]} cy={y(v)} r={2.5} fill={ok ? '#16a34a' : '#dc2626'} />)}
    </svg>
  );
}

function StatusDot({ status }: { status: 'OK' | 'WARN' | 'NONE' }) {
  const color = status === 'OK' ? '#22c55e' : status === 'WARN' ? '#ef4444' : '#cbd5e1';
  return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color }} />;
}

function MiniBar({ done, total, color = '#3b82f6' }: { done: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 7, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  );
}

export function OrgGoalsOverview() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [companyKis, setCompanyKis] = useState<KiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<KpiDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  async function openKpi(krId: string) {
    setDetail(null);
    setDetailErr(null);
    setDetailLoading(true);
    try {
      const res = await apiJson<KpiDetail>(`/api/goals-dashboard/kpi-detail?krId=${encodeURIComponent(krId)}`);
      setDetail(res);
    } catch (e: any) {
      setDetailErr(`${e?.message || '상세를 불러오지 못했습니다'}${e?.status ? ` (HTTP ${e.status})` : ''}`);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ units: Unit[]; companyKeyInits: KiItem[] }>('/api/goals-dashboard/org-overview');
        setUnits(res.units || []);
        setCompanyKis(res.companyKeyInits || []);
        // 기본: 실/회사 레벨은 펼침
        const o: Record<string, boolean> = {};
        for (const u of res.units || []) {
          if (u.type !== 'TEAM') o[u.id] = true;
        }
        setOpen(o);
      } catch (e: any) {
        setError(`${e?.message || '데이터를 불러오지 못했습니다'}${e?.status ? ` (HTTP ${e.status})` : ''}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const byParent = useMemo(() => {
    const m: Record<string, Unit[]> = {};
    for (const u of units) {
      const key = u.parentId || '__root__';
      if (!m[key]) m[key] = [];
      m[key].push(u);
    }
    return m;
  }, [units]);

  const unitById = useMemo(() => {
    const m: Record<string, Unit> = {};
    for (const u of units) m[u.id] = u;
    return m;
  }, [units]);

  // 하위 조직 포함 롤업
  const rollups = useMemo(() => {
    const m: Record<string, Rollup> = {};
    const compute = (id: string): Rollup => {
      if (m[id]) return m[id];
      const r = emptyRollup();
      const u = unitById[id];
      if (u) addOwn(r, u);
      for (const c of byParent[id] || []) {
        const cr = compute(c.id);
        r.kpiOk += cr.kpiOk; r.kpiWarn += cr.kpiWarn; r.kpiNone += cr.kpiNone;
        r.qualDone += cr.qualDone; r.qualTotal += cr.qualTotal;
        r.kiOpen += cr.kiOpen; r.kiDelayed += cr.kiDelayed;
        r.memberCount += cr.memberCount;
      }
      m[id] = r;
      return r;
    };
    for (const u of units) compute(u.id);
    return m;
  }, [units, byParent, unitById]);

  const total = useMemo(() => {
    const r = emptyRollup();
    for (const u of units) addOwn(r, u);
    return r;
  }, [units]);

  const th: React.CSSProperties = { borderBottom: '1px solid #e2e8f0', padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '6px 8px', fontSize: 12, verticalAlign: 'top' };

  function UnitCard({ unit, depth }: { unit: Unit; depth: number }) {
    const r = rollups[unit.id] || emptyRollup();
    const kpiTotal = r.kpiOk + r.kpiWarn + r.kpiNone;
    const isOpen = !!open[unit.id];
    const children = byParent[unit.id] || [];
    const hasDetail = unit.kpis.length > 0 || unit.qualObjectives.length > 0 || unit.keyInits.items.length > 0 || unit.members.length > 0;

    return (
      <div style={{ marginLeft: depth * 18 }}>
        <div
          onClick={() => setOpen((p) => ({ ...p, [unit.id]: !p[unit.id] }))}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer',
            padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0',
            background: unit.type === 'COMPANY' ? '#0F3D73' : unit.type === 'DIVISION' ? '#EFF6FF' : '#fff',
            color: unit.type === 'COMPANY' ? '#fff' : '#0f172a', marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.75 }}>{isOpen ? '▼' : '▶'}</span>
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: unit.type === 'COMPANY' ? 'rgba(255,255,255,0.2)' : '#e2e8f0', color: unit.type === 'COMPANY' ? '#fff' : '#475569', fontWeight: 700 }}>
            {TYPE_LABELS[unit.type] || unit.type}
          </span>
          <span style={{ fontWeight: 800 }}>{unit.name}</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>👥 {r.memberCount}</span>
          <span style={{ fontSize: 12 }}>
            📊 {kpiTotal > 0 ? (<>
              <b style={{ color: unit.type === 'COMPANY' ? '#86efac' : '#16a34a' }}>{r.kpiOk}</b>
              {' / '}<b style={{ color: unit.type === 'COMPANY' ? '#fca5a5' : '#dc2626' }}>{r.kpiWarn}</b>
              {' / '}<span style={{ opacity: 0.7 }}>{r.kpiNone}</span>
              <span style={{ opacity: 0.6, fontSize: 11 }}> (달성/미달/미입력)</span>
            </>) : <span style={{ opacity: 0.6 }}>지표 없음</span>}
          </span>
          <span style={{ fontSize: 12 }}>
            🎯 {r.qualTotal > 0 ? `과제 ${r.qualDone}/${r.qualTotal} 완료` : '과제 없음'}
          </span>
          <span style={{ fontSize: 12 }}>
            🚩 {r.kiOpen > 0 ? (<>{r.kiOpen}건 진행{r.kiDelayed > 0 && <b style={{ color: unit.type === 'COMPANY' ? '#fca5a5' : '#dc2626' }}> · 지연 {r.kiDelayed}</b>}</>) : '—'}
          </span>
        </div>

        {isOpen && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
            {hasDetail && (
              <div style={{ marginLeft: 18, padding: 12, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#fafbfc', display: 'grid', gap: 12 }}>
                {unit.kpis.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>📊 정량 지표 (팀 KPI) <span style={{ fontWeight: 400, color: '#94a3b8' }}>— 클릭 시 개인 계획·실행·결과 추적</span></div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}></th><th style={th}>지표</th><th style={th}>최신값 / 목표</th><th style={th}>달성률</th><th style={th}>최근 입력</th></tr></thead>
                      <tbody>
                        {unit.kpis.map((k) => (
                          <tr key={k.krId} onClick={() => openKpi(k.krId)} style={{ background: k.status === 'WARN' ? '#FEF2F2' : undefined, cursor: 'pointer' }} title="개인 계획·실행·결과 추적">
                            <td style={td}><StatusDot status={k.status} /></td>
                            <td style={{ ...td, color: '#1d4ed8', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{k.pillar ? `[${k.pillar}] ` : ''}{k.title}</td>
                            <td style={td}><b>{k.latestValue ?? '—'}</b> / {k.target}{k.unit ? ` ${k.unit}` : ''} <span style={{ fontSize: 10, color: '#94a3b8' }}>({k.direction === 'AT_MOST' ? '이하' : '이상'})</span></td>
                            <td style={td}>{k.achievementPct != null ? `${k.achievementPct}%` : '—'}</td>
                            <td style={td}>{fmtDate(k.latestAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {unit.qualObjectives.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 4 }}>🎯 정성 목표 (OKR)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>목표</th><th style={th}>책임자</th><th style={th}>과제 진행</th></tr></thead>
                      <tbody>
                        {unit.qualObjectives.map((o) => (
                          <tr key={o.id}>
                            <td style={td}>{o.title}</td>
                            <td style={td}>{o.ownerName || '—'}</td>
                            <td style={td}><MiniBar done={o.initDone} total={o.initTotal} color="#16a34a" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {unit.keyInits.items.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>🚩 중점 추진 과제</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>과제</th><th style={th}>담당</th><th style={th}>상태</th><th style={th}>진행률</th><th style={th}>기한</th></tr></thead>
                      <tbody>
                        {unit.keyInits.items.map((k) => (
                          <tr key={k.id} style={{ background: k.status === 'DELAYED' ? '#FEF2F2' : undefined }}>
                            <td style={td}>{k.title}{k.alignsTo && <div style={{ fontSize: 10, color: '#0F3D73' }}>🎯 {k.alignsTo}</div>}</td>
                            <td style={td}>{k.assigneeName || '—'}</td>
                            <td style={td}>{KI_LABELS[k.status] || k.status}{k.warning ? <span style={{ color: '#dc2626', fontSize: 11 }}> ⚠ {k.warning}</span> : null}</td>
                            <td style={td}>{k.latestPct != null ? `${k.latestPct}%` : '—'}</td>
                            <td style={td}>{fmtDate(k.dueDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {unit.members.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>👥 구성원별 현황</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>이름</th>
                          <th style={th}>정량 지표 (달성/미달/미입력)</th>
                          <th style={th}>정성 과제 (완료/전체)</th>
                          <th style={th}>개인 업무</th>
                          <th style={th}>중점 과제</th>
                          <th style={th}>최근 일지</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unit.members.map((mb) => {
                          const staleDays = mb.lastWorklogAt ? Math.floor((Date.now() - new Date(mb.lastWorklogAt).getTime()) / 86400000) : null;
                          return (
                            <tr key={mb.userId}>
                              <td style={{ ...td, fontWeight: 600 }}>{mb.name}</td>
                              <td style={td}>
                                {mb.quant.count > 0
                                  ? (<><b style={{ color: '#16a34a' }}>{mb.quant.ok}</b> / <b style={{ color: '#dc2626' }}>{mb.quant.warn}</b> / <span style={{ color: '#94a3b8' }}>{mb.quant.noData}</span></>)
                                  : <span style={{ color: '#cbd5e1' }}>—</span>}
                              </td>
                              <td style={td}>{mb.qual.total > 0 ? <MiniBar done={mb.qual.done} total={mb.qual.total} color="#16a34a" /> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                              <td style={td}>{(mb.personal?.total ?? 0) > 0 ? <span style={{ fontSize: 12 }}>진행 {mb.personal.active} · 완료 {mb.personal.done}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                              <td style={td}>
                                {mb.kiOpen > 0 ? (<>{mb.kiOpen}건{mb.kiDelayed > 0 && <b style={{ color: '#dc2626' }}> · 지연 {mb.kiDelayed}</b>}</>) : <span style={{ color: '#cbd5e1' }}>—</span>}
                              </td>
                              <td style={{ ...td, color: staleDays != null && staleDays > 3 ? '#d97706' : undefined }}>
                                {fmtDate(mb.lastWorklogAt)}{staleDays != null && staleDays > 0 ? ` (${staleDays}일 전)` : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {children.map((c) => <UnitCard key={c.id} unit={c} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  const roots = (byParent['__root__'] || []).slice().sort((a, b) => (a.type === 'COMPANY' ? -1 : 1) - (b.type === 'COMPANY' ? -1 : 1));
  const kpiTotal = total.kpiOk + total.kpiWarn + total.kpiNone;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>전사 목표 현황</h2>
      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>}

      {!loading && units.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div style={{ padding: 12, background: '#EFF6FF', border: '1px solid #bfdbfe', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 700 }}>📊 정량 지표 (전사)</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{kpiTotal}개</div>
              <div style={{ fontSize: 12, color: '#475569' }}>달성 <b style={{ color: '#16a34a' }}>{total.kpiOk}</b> · 미달 <b style={{ color: '#dc2626' }}>{total.kpiWarn}</b> · 미입력 <b style={{ color: '#94a3b8' }}>{total.kpiNone}</b></div>
            </div>
            <div style={{ padding: 12, background: '#F0FDF4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#166534', fontWeight: 700 }}>🎯 정성 과제 (전사)</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{total.qualTotal}개</div>
              <div style={{ fontSize: 12, color: '#475569' }}>완료 <b style={{ color: '#16a34a' }}>{total.qualDone}</b></div>
            </div>
            <div style={{ padding: 12, background: '#FFFBEB', border: '1px solid #fde68a', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>🚩 중점 추진 과제</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{total.kiOpen}건 진행</div>
              <div style={{ fontSize: 12, color: '#475569' }}>지연 <b style={{ color: '#dc2626' }}>{total.kiDelayed}</b></div>
            </div>
          </div>

          <div>
            {roots.map((u) => <UnitCard key={u.id} unit={u} depth={0} />)}
          </div>

          {companyKis.length > 0 && (
            <div style={{ padding: 12, border: '1px solid #fde68a', background: '#FFFBEB', borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>🚩 전사 중점 추진 과제 (부서 미지정)</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {companyKis.map((k) => (
                  <div key={k.id} style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#e2e8f0', color: '#475569', fontWeight: 700 }}>{KI_LABELS[k.status] || k.status}</span>
                    <span style={{ fontWeight: 600 }}>{k.title}</span>
                    {k.latestPct != null && <span style={{ color: '#3b82f6', fontWeight: 700, fontSize: 12 }}>{k.latestPct}%</span>}
                    {k.assigneeName && <span style={{ color: '#64748b', fontSize: 12 }}>{k.assigneeName}</span>}
                    {k.dueDate && <span style={{ color: '#64748b', fontSize: 12 }}>기한 {fmtDate(k.dueDate)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {(detail || detailLoading || detailErr) && (
        <div
          onClick={() => { setDetail(null); setDetailErr(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 16px', overflowY: 'auto' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#0F3D73', color: '#fff' }}>
              <div style={{ fontWeight: 800 }}>📊 KPI 추적 — 목표 → 개인 계획 → 실행 → 결과</div>
              <button onClick={() => { setDetail(null); setDetailErr(null); }} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 18, display: 'grid', gap: 16 }}>
              {detailLoading && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>}
              {detailErr && <div style={{ color: '#ef4444', fontSize: 13 }}>{detailErr}</div>}
              {detail && (
                <>
                  {/* ① 목표 + ④ 결과 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{detail.kr.orgName} · {detail.kr.objTitle}</div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{detail.kr.pillar ? `[${detail.kr.pillar}] ` : ''}{detail.kr.title}</div>
                      <div style={{ fontSize: 12, color: '#475569' }}>
                        목표 <b>{detail.kr.target}{detail.kr.unit ? ` ${detail.kr.unit}` : ''}</b> {detail.kr.direction === 'AT_MOST' ? '이하' : '이상'}
                        {detail.kr.baseline != null && <> · 기준 {detail.kr.baseline}</>}
                        {detail.kr.cadence && <> · {detail.kr.cadence}</>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>현재 결과</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: detail.result.status === 'OK' ? '#16a34a' : detail.result.status === 'WARN' ? '#dc2626' : '#94a3b8' }}>
                        {detail.result.latestValue ?? '—'}{detail.kr.unit ? ` ${detail.kr.unit}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: '#475569' }}>
                        {detail.result.achievementPct != null ? `달성률 ${detail.result.achievementPct}%` : '미입력'} · {fmtDate(detail.result.latestAt)}
                      </div>
                    </div>
                  </div>

                  {/* ③ 실행 추세 */}
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fafbfc' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 6 }}>📈 실행 추세 <span style={{ fontWeight: 400, color: '#94a3b8' }}>(입력 {detail.result.entryCount}건, 주황 점선 = 목표)</span></div>
                    <Sparkline
                      values={detail.trend.map((t) => t.krValue).filter((v): v is number => v != null)}
                      target={detail.kr.target}
                      direction={detail.kr.direction}
                    />
                  </div>

                  {/* ② 개인 계획 + 실행 */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 4 }}>👤 개인 계획·실행 <span style={{ fontWeight: 400, color: '#94a3b8' }}>(할당 구성원 + 입력 기여자)</span></div>
                    {detail.people.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#cbd5e1' }}>할당된 구성원이 없습니다. 팀 KPI 입력 화면에서 참여자를 지정하세요.</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={th}>이름</th><th style={th}>구분</th><th style={th}>최근 입력값</th><th style={th}>입력 횟수</th><th style={th}>최근 입력일</th></tr></thead>
                        <tbody>
                          {detail.people.map((p) => (
                            <tr key={p.userId} style={{ background: !p.assigned ? '#FFFBEB' : undefined }}>
                              <td style={{ ...td, fontWeight: 600 }}>{p.name || '—'}</td>
                              <td style={td}>{p.assigned ? <span style={{ color: '#16a34a' }}>할당{p.assignRole ? ` (${p.assignRole})` : ''}</span> : <span style={{ color: '#d97706' }}>입력만</span>}</td>
                              <td style={td}>{p.lastValue != null ? <b>{p.lastValue}</b> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                              <td style={td}>{p.count}</td>
                              <td style={td}>{fmtDate(p.lastAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* 실행 이력 (시계열 테이블) */}
                  {detail.trend.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>🗂 입력 이력</div>
                      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr><th style={th}>일자</th><th style={th}>값</th><th style={th}>입력자</th><th style={th}>비고</th></tr></thead>
                          <tbody>
                            {detail.trend.slice().reverse().map((t) => (
                              <tr key={t.id}>
                                <td style={td}>{fmtDate(t.createdAt)}</td>
                                <td style={{ ...td, fontWeight: 600 }}>{t.krValue ?? '—'}</td>
                                <td style={td}>{t.actorName || '—'}{t.hasWorklog && <span title="업무일지에서 입력" style={{ marginLeft: 4 }}>📝</span>}</td>
                                <td style={{ ...td, color: '#64748b' }}>{t.note || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
