import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type OrgUnit = { id: string; name: string; type: string; parentId?: string | null };
type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';
type ProgressEntry = { krValue: number | null; periodStart: string; createdAt: string };

type Kr = {
  id: string; title: string; unit?: string | null; target?: number | null; baseline?: number | null;
  year25Target?: number | null; weight?: number | null; direction?: 'AT_LEAST' | 'AT_MOST' | null;
  pillar?: Pillar | null; metric?: string | null;
  latest?: number | null; latestMonth?: string | null;
  monthly?: (number | null)[]; // 선택 연도 1~12월 실적
};

const PILLARS: { key: Pillar; label: string; color: string; bg: string }[] = [
  { key: 'C', label: '생산성 혁신', color: '#2563eb', bg: '#eff6ff' },
  { key: 'Q', label: '품질 혁신', color: '#16a34a', bg: '#f0fdf4' },
  { key: 'D', label: '납기 혁신', color: '#d97706', bg: '#fffbeb' },
  { key: 'DEV', label: '신차 개발', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'P', label: '역량 강화', color: '#db2777', bg: '#fdf2f8' },
];

function kstMonth(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

// 값 v에 대한 달성률(%) — direction 반영
function achOf(kr: Kr, v: number | null | undefined, target?: number | null): number | null {
  const t = target ?? kr.target;
  if (v == null || t == null) return null;
  let pct: number;
  if (kr.direction === 'AT_MOST') {
    if (v <= 0) return 100;
    if (t === 0) return 0;
    pct = (t / v) * 100;
  } else {
    if (t === 0) return null;
    pct = (v / t) * 100;
  }
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}
const achColor = (p: number | null) => (p == null ? '#94a3b8' : p >= 100 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626');

// 누적 방식: %/율 지표는 평균, 수량 지표는 합계
const isRateKr = (kr: Kr) => String(kr.unit || '').includes('%') || String(kr.unit || '').includes('율');

// 선택월까지의 누적값 (avg | sum). 입력 없는 달은 제외.
function cumValue(kr: Kr, uptoIdx: number): { value: number | null; months: number; mode: 'avg' | 'sum' } {
  const mode: 'avg' | 'sum' = isRateKr(kr) ? 'avg' : 'sum';
  const vals: number[] = [];
  for (let i = 0; i <= uptoIdx; i++) {
    const v = kr.monthly?.[i];
    if (v != null) vals.push(v);
  }
  if (!vals.length) return { value: null, months: 0, mode };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { value: mode === 'avg' ? Math.round((sum / vals.length) * 100) / 100 : Math.round(sum * 100) / 100, months: vals.length, mode };
}

// 누적 달성률: 평균형은 목표 그대로, 합계형은 목표×입력개월 대비
function cumAch(kr: Kr, uptoIdx: number): number | null {
  const c = cumValue(kr, uptoIdx);
  if (c.value == null || kr.target == null) return null;
  return c.mode === 'avg' ? achOf(kr, c.value) : achOf(kr, c.value, kr.target * c.months);
}

// ── 미니 월별 바 차트 (SVG, 의존성 없음) ──────────────────────
function MiniBars({ kr, selIdx }: { kr: Kr; selIdx: number }) {
  const W = 300, H = 64, PAD = 2, GAP = 3;
  const monthly = kr.monthly || Array(12).fill(null);
  const vals = monthly.filter((v): v is number => v != null);
  const t = kr.target ?? null;
  const maxV = Math.max(...vals.map((v) => Math.abs(v)), t != null ? Math.abs(t) : 0, 1) * 1.1;
  const bw = (W - PAD * 2 - GAP * 11) / 12;
  const y = (v: number) => H - 12 - Math.max(0, (Math.abs(v) / maxV) * (H - 16));
  const targetY = t != null ? y(t) : null;
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {targetY != null && (
        <line x1={PAD} x2={W - PAD} y1={targetY} y2={targetY} stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={1} />
      )}
      {monthly.map((v, i) => {
        const x = PAD + i * (bw + GAP);
        if (v == null) {
          return <rect key={i} x={x} y={H - 14} width={bw} height={2} fill="#e2e8f0" rx={1} />;
        }
        const a = achOf(kr, v);
        const barY = y(v);
        return (
          <g key={i}>
            <rect x={x} y={barY} width={bw} height={H - 12 - barY} fill={achColor(a)} opacity={i === selIdx ? 1 : 0.55} rx={2}>
              <title>{`${i + 1}월: ${v.toLocaleString()}${kr.unit || ''}${a != null ? ` (달성 ${a}%)` : ''}`}</title>
            </rect>
            {i === selIdx && <rect x={x - 1} y={2} width={bw + 2} height={H - 14} fill="none" stroke="#0f172a" strokeWidth={1} rx={3} opacity={0.35} />}
          </g>
        );
      })}
      {[0, 2, 4, 6, 8, 10].map((i) => (
        <text key={i} x={PAD + i * (bw + GAP) + bw / 2} y={H - 2} fontSize={8} fill="#94a3b8" textAnchor="middle">{i + 1}</text>
      ))}
    </svg>
  );
}

// ── 팀 추이 라인차트 (월별/누적 가중 달성률) ──────────────────
function TrendChart({ monthlySeries, cumSeries, selIdx }: { monthlySeries: (number | null)[]; cumSeries: (number | null)[]; selIdx: number }) {
  const W = 680, H = 150, L = 34, R = 10, T = 12, B = 22;
  const maxY = Math.max(...[...monthlySeries, ...cumSeries].filter((v): v is number => v != null), 100) * 1.05;
  const x = (i: number) => L + (i / 11) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (s: (number | null)[]) => {
    let d = ''; let started = false;
    s.forEach((v, i) => {
      if (v == null) return;
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* 그리드 + 축 */}
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke={g === 100 ? '#94a3b8' : '#e2e8f0'} strokeWidth={1} strokeDasharray={g === 100 ? '4 3' : undefined} />
          <text x={L - 5} y={y(g) + 3} fontSize={9} fill="#94a3b8" textAnchor="end">{g}%</text>
        </g>
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={9} fill={i === selIdx ? '#0f172a' : '#94a3b8'} fontWeight={i === selIdx ? 700 : 400} textAnchor="middle">{i + 1}월</text>
      ))}
      {selIdx >= 0 && <line x1={x(selIdx)} x2={x(selIdx)} y1={T} y2={H - B} stroke="#0f172a" strokeWidth={1} opacity={0.15} />}
      {/* 월별(막대 느낌의 점+선), 누적(굵은 선) */}
      <path d={path(monthlySeries)} fill="none" stroke="#60a5fa" strokeWidth={2} />
      <path d={path(cumSeries)} fill="none" stroke="#0f3d73" strokeWidth={2.5} />
      {monthlySeries.map((v, i) => v != null && (
        <circle key={`m${i}`} cx={x(i)} cy={y(v)} r={3} fill="#60a5fa"><title>{`${i + 1}월 가중 달성률 ${v}%`}</title></circle>
      ))}
      {cumSeries.map((v, i) => v != null && (
        <circle key={`c${i}`} cx={x(i)} cy={y(v)} r={3.5} fill="#0f3d73"><title>{`${i + 1}월 누적 가중 달성률 ${v}%`}</title></circle>
      ))}
    </svg>
  );
}

export function KpiReport() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [myRole, setMyRole] = useState('');
  const [month, setMonth] = useState(kstMonth());
  const [krs, setKrs] = useState<Kr[]>([]);
  const [loading, setLoading] = useState(false);

  const teams = useMemo(() => orgs.filter((o) => o.type === 'TEAM'), [orgs]);
  const isExec = myRole === 'CEO' || myRole === 'EXEC';
  const teamName = teams.find((t) => t.id === orgUnitId)?.name || '';
  const year = month.slice(0, 4);
  const selIdx = Math.max(0, Math.min(11, parseInt(month.slice(5, 7), 10) - 1));

  useEffect(() => {
    (async () => {
      try { const r = await apiJson<{ items: OrgUnit[] }>(`/api/orgs`); setOrgs(r.items || []); } catch { /* */ }
    })();
  }, []);
  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const me = await apiJson<{ role: string; orgUnitId?: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole(me.role || '');
        if (!orgUnitId && me.orgUnitId) setOrgUnitId(me.orgUnitId);
      } catch { /* */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function load() {
    if (!orgUnitId) { setKrs([]); return; }
    setLoading(true);
    try {
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(orgUnitId)}`);
      const objs = (res.items || []).filter((o: any) => o.pillar);
      const flat: Kr[] = [];
      for (const o of objs) for (const kr of (o.keyResults || [])) flat.push({ ...kr, pillar: kr.pillar || o.pillar });
      await Promise.all(flat.map(async (kr) => {
        try {
          const pr = await apiJson<{ items: ProgressEntry[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(kr.id)}`);
          const items = pr.items || []; // createdAt desc — 월별 첫 항목이 그 달의 최신값
          const monthly: (number | null)[] = Array(12).fill(null);
          for (const e of items) {
            const ps = String(e.periodStart);
            if (ps.slice(0, 4) !== year) continue;
            const mi = parseInt(ps.slice(5, 7), 10) - 1;
            if (mi < 0 || mi > 11) continue;
            if (monthly[mi] == null && e.krValue != null) monthly[mi] = e.krValue;
          }
          kr.monthly = monthly;
          // 선택 월 값(없으면 최근값 표시용)
          const m = items.find((e) => String(e.periodStart).slice(0, 7) === month);
          const pick = m || items[0];
          kr.latest = pick?.krValue ?? null;
          kr.latestMonth = pick ? String(pick.periodStart).slice(0, 7) : null;
        } catch { kr.latest = null; kr.monthly = Array(12).fill(null); }
      }));
      setKrs(flat);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgUnitId, month]);

  // 선택 월 가중 달성률 + 누적 가중 달성률
  const summary = useMemo(() => {
    let wsum = 0, wach = 0, done = 0, cwsum = 0, cwach = 0;
    for (const kr of krs) {
      const w = typeof kr.weight === 'number' && kr.weight > 0 ? kr.weight : 0;
      const a = achOf(kr, kr.monthly?.[selIdx]);
      const ca = cumAch(kr, selIdx);
      if (a != null) done++;
      if (w > 0 && a != null) { wsum += w; wach += w * Math.min(a, 100); }
      if (w > 0 && ca != null) { cwsum += w; cwach += w * Math.min(ca, 100); }
    }
    return {
      total: krs.length,
      done,
      weighted: wsum > 0 ? Math.round((wach / wsum) * 10) / 10 : null,
      cumWeighted: cwsum > 0 ? Math.round((cwach / cwsum) * 10) / 10 : null,
    };
  }, [krs, selIdx]);

  // 팀 추이 시리즈 (1~12월): 월별/누적 가중 달성률
  const trend = useMemo(() => {
    const monthlySeries: (number | null)[] = Array(12).fill(null);
    const cumSeries: (number | null)[] = Array(12).fill(null);
    for (let mi = 0; mi < 12; mi++) {
      let wsum = 0, wach = 0, cwsum = 0, cwach = 0;
      for (const kr of krs) {
        const w = typeof kr.weight === 'number' && kr.weight > 0 ? kr.weight : 0;
        if (w <= 0) continue;
        const a = achOf(kr, kr.monthly?.[mi]);
        if (a != null) { wsum += w; wach += w * Math.min(a, 100); }
        const ca = cumAch(kr, mi);
        if (ca != null) { cwsum += w; cwach += w * Math.min(ca, 100); }
      }
      monthlySeries[mi] = wsum > 0 ? Math.round((wach / wsum) * 10) / 10 : null;
      cumSeries[mi] = cwsum > 0 ? Math.round((cwach / cwsum) * 10) / 10 : null;
    }
    return { monthlySeries, cumSeries };
  }, [krs]);

  const byPillar = useMemo(() => PILLARS.map((p) => ({ p, list: krs.filter((k) => (k.pillar || 'C') === p.key) })).filter((g) => g.list.length), [krs]);

  return (
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div className="report-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>📊 팀 KPI 리포트</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} disabled={!isExec} style={{ padding: '6px 8px' }}>
            <option value="">팀 선택</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '6px 8px' }} />
          <button type="button" className="btn btn-sm" onClick={() => window.print()}>🖨 인쇄</button>
        </div>
      </div>

      {loading ? (
        <div>불러오는 중…</div>
      ) : !orgUnitId ? (
        <div style={{ color: '#64748b', padding: 24, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>팀을 선택하세요.</div>
      ) : krs.length === 0 ? (
        <div style={{ color: '#64748b', padding: 24, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>등록된 정량 KPI가 없습니다.</div>
      ) : (
        <>
          {/* 헤더 요약 배너 */}
          <div style={{ borderRadius: 16, padding: 20, background: 'linear-gradient(135deg,#0f3d73,#2563eb)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{year}년 KPI 리포트 · {month}</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{teamName}</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>KPI {summary.total}개 · {month.slice(5, 7)}월 실적 입력 {summary.done}개</div>
            </div>
            <div style={{ display: 'flex', gap: 26 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{month.slice(5, 7)}월 가중 달성률</div>
                <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>{summary.weighted != null ? `${summary.weighted}%` : '-'}</div>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,.3)', paddingLeft: 26 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>연간 누적 달성률</div>
                <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>{summary.cumWeighted != null ? `${summary.cumWeighted}%` : '-'}</div>
              </div>
            </div>
          </div>

          {/* 월별 추이 차트 */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 800 }}>월별 달성률 추이</div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#475569' }}>
                <span><span style={{ display: 'inline-block', width: 18, height: 3, background: '#60a5fa', verticalAlign: 'middle', marginRight: 4 }} />월별</span>
                <span><span style={{ display: 'inline-block', width: 18, height: 3, background: '#0f3d73', verticalAlign: 'middle', marginRight: 4 }} />누적</span>
              </div>
            </div>
            <TrendChart monthlySeries={trend.monthlySeries} cumSeries={trend.cumSeries} selIdx={selIdx} />
          </div>

          {/* 분야별 섹션 */}
          {byPillar.map(({ p, list }) => {
            const wsum = list.reduce((s, k) => s + (typeof k.weight === 'number' ? k.weight : 0), 0);
            return (
              <div key={p.key} style={{ border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: p.bg, borderBottom: `2px solid ${p.color}` }}>
                  <div style={{ fontWeight: 800, color: p.color }}>{p.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{list.length}개 · 비중합 {wsum}%</div>
                </div>
                <div style={{ display: 'grid', gap: 0 }}>
                  {list.map((kr, i) => {
                    const mv = kr.monthly?.[selIdx] ?? null;
                    const a = achOf(kr, mv);
                    const barPct = a == null ? 0 : Math.max(0, Math.min(a, 100));
                    const c = cumValue(kr, selIdx);
                    const ca = cumAch(kr, selIdx);
                    return (
                      <div key={kr.id} style={{ padding: '10px 14px', borderTop: i ? '1px solid #f1f5f9' : 'none', display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <div style={{ fontWeight: 700 }}>{kr.title}{kr.unit ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> ({kr.unit})</span> : null}</div>
                          <div style={{ fontSize: 13, color: '#475569' }}>
                            목표 <b>{kr.target ?? '-'}</b>
                            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                            {month.slice(5, 7)}월 실적 <b style={{ color: '#0f172a' }}>{mv != null ? mv.toLocaleString() : '-'}</b>
                            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                            누적{c.mode === 'avg' ? '(평균)' : '(합계)'} <b style={{ color: '#0f3d73' }}>{c.value != null ? c.value.toLocaleString() : '-'}</b>
                            {ca != null && <span style={{ marginLeft: 6, fontWeight: 800, color: achColor(ca) }}>{ca}%</span>}
                            {typeof kr.weight === 'number' ? <span style={{ marginLeft: 8, color: '#94a3b8' }}>비중 {kr.weight}%</span> : null}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          {/* 월별 미니 차트 */}
                          <MiniBars kr={kr} selIdx={selIdx} />
                          {/* 선택 월 달성률 바 */}
                          <div style={{ flex: 1, minWidth: 180, display: 'grid', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ flex: 1, height: 10, background: '#eef2f7', borderRadius: 999, overflow: 'hidden' }}>
                                <div style={{ width: `${barPct}%`, height: '100%', background: achColor(a), borderRadius: 999, transition: 'width .3s' }} />
                              </div>
                              <div style={{ minWidth: 56, textAlign: 'right', fontWeight: 800, color: achColor(a) }}>{a != null ? `${a}%` : '-'}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
                              <span>25목표 {kr.year25Target ?? '-'}</span>
                              <span>25실적 {kr.baseline ?? '-'}</span>
                              <span>26목표 {kr.target ?? '-'}</span>
                              <span>{kr.direction === 'AT_MOST' ? '↓ 이하 좋음' : '↑ 이상 좋음'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 월별 실적표 */}
          <details open style={{ border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', padding: '10px 14px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 800 }}>📋 월별 실적표 ({year}년)</summary>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th style={thS}>KPI</th>
                    <th style={thS}>목표</th>
                    {Array.from({ length: 12 }, (_, i) => (
                      <th key={i} style={{ ...thS, textAlign: 'right', background: i === selIdx ? '#eff6ff' : undefined }}>{i + 1}월</th>
                    ))}
                    <th style={{ ...thS, textAlign: 'right', color: '#0f3d73' }}>누적</th>
                    <th style={{ ...thS, textAlign: 'right', color: '#0f3d73' }}>달성률</th>
                  </tr>
                </thead>
                <tbody>
                  {krs.map((kr) => {
                    const c = cumValue(kr, 11); // 연간 누적(전체)
                    const ca = cumAch(kr, 11);
                    return (
                      <tr key={kr.id}>
                        <td style={{ ...tdS, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={kr.title}>
                          {kr.title}{kr.unit ? ` (${kr.unit})` : ''}
                        </td>
                        <td style={{ ...tdS, textAlign: 'right', color: '#64748b' }}>{kr.target ?? '-'}</td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const v = kr.monthly?.[i] ?? null;
                          const a = achOf(kr, v);
                          return (
                            <td key={i} style={{ ...tdS, textAlign: 'right', background: i === selIdx ? '#eff6ff' : undefined, color: v == null ? '#cbd5e1' : achColor(a), fontWeight: v == null ? 400 : 600 }}>
                              {v != null ? v.toLocaleString() : '·'}
                            </td>
                          );
                        })}
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 800, color: '#0f3d73' }}>{c.value != null ? c.value.toLocaleString() : '-'}</td>
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 800, color: achColor(ca) }}>{ca != null ? `${ca}%` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>누적: %·율 지표는 입력월 평균, 수량 지표는 합계 (합계형 달성률은 목표×입력개월 대비)</div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

const thS: React.CSSProperties = { borderBottom: '2px solid #e2e8f0', padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: '#475569', background: '#f8fafc' };
const tdS: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '5px 8px' };
