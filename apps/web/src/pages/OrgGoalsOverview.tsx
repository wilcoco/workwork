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
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>📊 정량 지표 (팀 KPI)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}></th><th style={th}>지표</th><th style={th}>최신값 / 목표</th><th style={th}>달성률</th><th style={th}>최근 입력</th></tr></thead>
                      <tbody>
                        {unit.kpis.map((k) => (
                          <tr key={k.krId} style={{ background: k.status === 'WARN' ? '#FEF2F2' : undefined }}>
                            <td style={td}><StatusDot status={k.status} /></td>
                            <td style={td}>{k.pillar ? `[${k.pillar}] ` : ''}{k.title}</td>
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
    </div>
  );
}
