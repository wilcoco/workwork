import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { achPct, cumAchPct, cumTargetOf, cumValueOf, kpiModeOf, monthAchPct, monthTargetOf } from '../lib/kpiCalc';

type OrgUnit = { id: string; name: string; type: string; parentId?: string | null };
type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';
type ProgressEntry = { krValue: number | null; periodStart: string; createdAt: string };

type KrEvidence = {
  krId: string;
  activities: Array<{ id: string; name: string; logs: number; minutes: number; linked?: boolean }>;
  people: Array<{ name: string; logs: number; minutes: number }>;
  totals: { logs: number; minutes: number; people: number };
  worklogs: Array<{ id: string; date: string; authorName: string; minutes: number; snippet: string }>;
};

// 업무일지 도입 시점 — 근거는 일지 기반이므로 그 이전 월엔 기록이 없다 (실측: 26년 5월부터 본격 사용)
const WORKLOG_SINCE = { y: 2026, m: 5 };
function evidencePeriodLabel(month: string): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  if (y < WORKLOG_SINCE.y || (y === WORKLOG_SINCE.y && m < WORKLOG_SINCE.m)) return `${m}월 · 일지 도입 전`;
  if (y === WORKLOG_SINCE.y) return `일지도입 ${WORKLOG_SINCE.m}월~${m}월`;
  return `1~${m}월`;
}

const fmtH = (min: number) => (min >= 60 ? `${Math.round(min / 6) / 10}h` : `${min}m`);

// ── KPI 온톨로지 맵 (활동 → KPI ← 수행자, 선 굵기 ∝ 투입시간) ──
function KpiOntoMap({ kr, ev, ach, periodLabel }: { kr: Kr; ev: KrEvidence; ach: number | null; periodLabel: string }) {
  const acts = ev.activities.slice(0, 8);
  const ppl = ev.people.slice(0, 8);
  const rows = Math.max(acts.length, ppl.length, 1);
  const W = 720, ROW = 46, TOP = 24, H = Math.max(rows * ROW + TOP * 2, 200);
  const maxMin = Math.max(...acts.map((a) => a.minutes), ...ppl.map((p) => p.minutes), 1);
  const lw = (m: number) => Math.max(1.5, (m / maxMin) * 8);
  const nodeY = (i: number, n: number) => TOP + (H - TOP * 2) * (n <= 1 ? 0.5 : i / (n - 1));
  const cy = H / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* 연결선 */}
      {acts.map((a, i) => {
        const y = nodeY(i, acts.length);
        return <path key={`la${a.id}`} d={`M 218 ${y} C 270 ${y}, 290 ${cy}, 330 ${cy}`} fill="none" stroke="#a78bfa" strokeWidth={lw(a.minutes)} opacity={0.55} />;
      })}
      {ppl.map((pp, i) => {
        const y = nodeY(i, ppl.length);
        return <path key={`lp${pp.name}${i}`} d={`M 502 ${y} C 450 ${y}, 430 ${cy}, 390 ${cy}`} fill="none" stroke="#60a5fa" strokeWidth={lw(pp.minutes)} opacity={0.55} />;
      })}
      {/* 활동 노드 (좌) */}
      {acts.map((a, i) => {
        const y = nodeY(i, acts.length);
        const linked = a.linked !== false;
        return (
          <g key={a.id}>
            <rect x={6} y={y - 17} width={212} height={34} rx={9}
              fill={linked ? '#f5f3ff' : '#f8fafc'} stroke={linked ? '#ddd6fe' : '#cbd5e1'} strokeDasharray={linked ? undefined : '4 3'} />
            <text x={14} y={y - 3} fontSize={11.5} fontWeight={700} fill={linked ? '#5b21b6' : '#475569'}>{a.name.length > 18 ? a.name.slice(0, 18) + '…' : a.name}{linked ? '' : ' ◦'}</text>
            <text x={14} y={y + 11} fontSize={10} fill={linked ? '#7c3aed' : '#64748b'}>{a.logs > 0 ? `일지 ${a.logs}건 · ${fmtH(a.minutes)}` : `${periodLabel} 기록 없음`}</text>
          </g>
        );
      })}
      {acts.length === 0 && <text x={110} y={cy} fontSize={12} fill="#94a3b8" textAnchor="middle">연결 활동 없음 (🎯 매칭 필요)</text>}
      {/* KPI 중심 노드 */}
      <rect x={330} y={cy - 34} width={60 + 0} height={0} fill="none" />
      <rect x={300} y={cy - 36} width={120} height={72} rx={14} fill="#0f3d73" />
      <text x={360} y={cy - 14} fontSize={12} fontWeight={800} fill="#fff" textAnchor="middle">{kr.title.length > 10 ? kr.title.slice(0, 10) + '…' : kr.title}</text>
      <text x={360} y={cy + 4} fontSize={11} fill="#bfdbfe" textAnchor="middle">{fmtH(ev.totals.minutes)} · {ev.totals.logs}건</text>
      <text x={360} y={cy + 22} fontSize={13} fontWeight={800} fill={ach == null ? '#94a3b8' : ach >= 100 ? '#4ade80' : ach >= 80 ? '#fbbf24' : '#f87171'} textAnchor="middle">{ach != null ? `달성 ${ach}%` : '실적 미입력'}</text>
      {/* 수행자 노드 (우) */}
      {ppl.map((pp, i) => {
        const y = nodeY(i, ppl.length);
        return (
          <g key={`${pp.name}${i}`}>
            <rect x={502} y={y - 17} width={212} height={34} rx={9} fill="#eff6ff" stroke="#bfdbfe" />
            <text x={512} y={y - 3} fontSize={11.5} fontWeight={700} fill="#1e40af">{pp.name}</text>
            <text x={512} y={y + 11} fontSize={10} fill="#3b82f6">일지 {pp.logs}건 · {fmtH(pp.minutes)}</text>
          </g>
        );
      })}
      {ppl.length === 0 && <text x={608} y={cy} fontSize={12} fill="#94a3b8" textAnchor="middle">{periodLabel} 수행 기록 없음</text>}
    </svg>
  );
}

type Kr = {
  id: string; title: string; unit?: string | null; target?: number | null; baseline?: number | null;
  year25Target?: number | null; weight?: number | null; direction?: 'AT_LEAST' | 'AT_MOST' | null;
  pillar?: Pillar | null; metric?: string | null; aggregation?: 'AVG' | 'SUM' | 'LAST' | 'PROGRESS' | null;
  analysis25?: string | null; initiatives?: Array<{ id: string; title: string }>;
  latest?: number | null; latestMonth?: string | null;
  monthly?: (number | null)[]; // 선택 연도 1~12월 실적
};

const PILLARS: { key: Pillar; label: string; color: string; bg: string }[] = [
  { key: 'C', label: '생산성 혁신', color: '#2563eb', bg: '#eff6ff' },
  { key: 'Q', label: '품질 혁신', color: '#16a34a', bg: '#f0fdf4' },
  { key: 'DEV', label: '신차 개발', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'P', label: '역량 강화', color: '#db2777', bg: '#fdf2f8' },
];

const kstYm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 7); // periodStart는 UTC — KST 월로 변환해 비교(월경계 버그 방지)

function kstMonth(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

// 리포트 기본월 = 전월 — 진행 중인 달은 실적이 미완이라 리포트 기준으로 부적합 (사용자는 월 선택으로 이동 가능)
function kstPrevMonth(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

// 달성률·누적 계산은 공용 유틸(lib/kpiCalc.ts) 사용 — 화면별 사본 금지
const achColor = (p: number | null) => (p == null ? '#94a3b8' : p >= 100 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626');
const cumValue = (kr: Kr, uptoIdx: number) => cumValueOf(kr, kr.monthly, uptoIdx);
const cumAch = (kr: Kr, uptoIdx: number) => cumAchPct(kr, kr.monthly, uptoIdx);

const CUM_LABEL: Record<string, string> = { avg: '평균', sum: '합계', last: '최신누계', progress: '최신진척' };
const MODE_BADGE: Record<string, { label: string; title: string }> = {
  avg: { label: '월별 독립측정', title: '매월 독립적으로 측정되는 지표 — 누적은 입력월 평균, 달성률은 목표 대비' },
  sum: { label: '월별 누계(합산)', title: '월별 발생량이 쌓이는 지표 — 누적은 합산, 달성률은 경과월 안분 목표 대비(6월=연간목표×6/12)' },
  last: { label: '누계값 입력', title: '입력값 자체가 연초부터의 누계 — 누적은 최신 입력값, 달성률은 경과월 안분 목표 대비' },
  progress: { label: '진척율 입력', title: '매월 목표 대비 진척율을 입력 — 누적은 최신 진척율, 달성률은 목표에 그대로 대비(안분 없음)' },
};

// ── 미니 월별 바 차트 (SVG, 의존성 없음) ──────────────────────
function MiniBars({ kr, selIdx }: { kr: Kr; selIdx: number }) {
  const W = 300, H = 64, PAD = 2, GAP = 3;
  const monthly = kr.monthly || Array(12).fill(null);
  const vals = monthly.filter((v): v is number => v != null);
  const t = monthTargetOf(kr, 11); // 목표선 — 합산형은 월 안분(÷12), 누계형은 연간, 평균형은 목표 그대로
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
        const a = monthAchPct(kr, v, i);
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
  const [month, setMonth] = useState(kstPrevMonth());
  const [krs, setKrs] = useState<Kr[]>([]);
  const [loading, setLoading] = useState(false);
  // 온톨로지 실행 근거 (연결 활동 + 근거 일지) — 보고서에 "숫자의 근거"를 함께 싣는다
  const [evidence, setEvidence] = useState<Record<string, KrEvidence>>({});
  const [evOpen, setEvOpen] = useState(false); // 근거 상세 전체 펼침 (인쇄용)
  const [mapKr, setMapKr] = useState<Kr | null>(null); // 온톨로지 맵 모달 대상

  useEffect(() => {
    if (!orgUnitId) { setEvidence({}); return; }
    apiJson<{ items: KrEvidence[] }>(`/api/okrs/kpi-evidence?orgUnitId=${encodeURIComponent(orgUnitId)}&month=${encodeURIComponent(month)}&userId=${encodeURIComponent(userId)}&cumulative=1`)
      .then((r) => {
        const map: Record<string, KrEvidence> = {};
        for (const it of r.items || []) map[it.krId] = it;
        setEvidence(map);
      })
      .catch(() => setEvidence({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgUnitId, month]);

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
            const ym = kstYm(String(e.periodStart));
            if (ym.slice(0, 4) !== year) continue;
            const mi = parseInt(ym.slice(5, 7), 10) - 1;
            if (mi < 0 || mi > 11) continue;
            if (monthly[mi] == null && e.krValue != null) monthly[mi] = e.krValue;
          }
          kr.monthly = monthly;
          // 선택 월 값(없으면 최근값 표시용)
          const m = items.find((e) => kstYm(String(e.periodStart)) === month);
          const pick = m || items[0];
          kr.latest = pick?.krValue ?? null;
          kr.latestMonth = pick ? kstYm(String(pick.periodStart)) : null;
        } catch { kr.latest = null; kr.monthly = Array(12).fill(null); }
      }));
      setKrs(flat);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgUnitId, month]);

  // 집계 방식을 리포트에서 바로 변경 — 저장 즉시 누적·달성률 재계산(krs 상태에서 파생)
  async function saveAggregation(krId: string, val: string) {
    const prev = krs.find((k) => k.id === krId)?.aggregation ?? null;
    setKrs((list) => list.map((k) => (k.id === krId ? { ...k, aggregation: (val || null) as Kr['aggregation'] } : k)));
    try {
      await apiJson(`/api/okrs/krs/${encodeURIComponent(krId)}?userId=${encodeURIComponent(userId)}`, {
        method: 'PUT',
        body: JSON.stringify({ aggregation: val || 'NONE' }),
      });
    } catch (e: any) {
      setKrs((list) => list.map((k) => (k.id === krId ? { ...k, aggregation: prev } : k)));
      alert(e?.message || '집계 방식 저장에 실패했습니다');
    }
  }

  // 선택 월 가중 달성률 + 누적 가중 달성률
  const summary = useMemo(() => {
    let wsum = 0, wach = 0, done = 0, cwsum = 0, cwach = 0;
    for (const kr of krs) {
      const w = typeof kr.weight === 'number' && kr.weight > 0 ? kr.weight : 0;
      const a = monthAchPct(kr, kr.monthly?.[selIdx], selIdx);
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
        const a = monthAchPct(kr, kr.monthly?.[mi], mi);
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEvOpen((v) => !v)}>
            {evOpen ? '📎 근거 접기' : '📎 근거 펼치기'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => window.print()}>🖨 인쇄</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -8 }}>
        ※ 실행 근거는 업무일지 기반입니다 — 일지 시스템은 2026년 5월 도입되어 그 이전 월의 실행 기록은 없습니다.
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
                    const a = monthAchPct(kr, mv, selIdx);
                    const c = cumValue(kr, selIdx);
                    const ca = cumAch(kr, selIdx);
                    const ev = evidence[kr.id];
                    const hm = ev ? (ev.totals.minutes >= 60 ? `${Math.round(ev.totals.minutes / 6) / 10}h` : `${ev.totals.minutes}m`) : '';
                    return (
                      <div key={kr.id} style={{ padding: '12px 14px', borderTop: i ? '1px solid #f1f5f9' : 'none', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        {/* ① 달성률 크게 — 합산·누계형은 경과월 안분 목표 기준. 100% 초과면 페이스 초과임을 연간 대비와 함께 명시 */}
                        <div style={{ width: 96, textAlign: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, color: achColor(ca) }}>{ca != null ? `${Math.round(ca)}%` : '-'}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                            누적 달성{(c.mode === 'sum' || c.mode === 'last') ? <span style={{ display: 'block', fontSize: 9.5 }}>(~{parseInt(month.slice(5, 7), 10)}월 목표 기준)</span> : null}
                          </div>
                          {(() => {
                            if (!(c.mode === 'sum' || c.mode === 'last') || ca == null || ca <= 100) return null;
                            const annual = achPct(kr, c.value);
                            return (
                              <div style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '2px 4px', marginTop: 2 }}
                                title={`경과월 안분 목표(${cumTargetOf(kr, selIdx)?.toLocaleString()}) 대비 초과 달성 — 연간 목표(${kr.target?.toLocaleString()}) 기준으로는 ${annual ?? '-'}% 진행`}>
                                페이스 초과 · 연간 {annual ?? '-'}%
                              </div>
                            );
                          })()}
                          <div style={{ fontSize: 11, color: achColor(a), fontWeight: 700, marginTop: 1 }}>{month.slice(5, 7)}월 {a != null ? `${a}%` : '-'}</div>
                        </div>
                        {/* ② 지표 정보 + 월별 차트 (고정폭 — 남는 공간은 근거 카드가 사용) */}
                        <div style={{ flex: '0 1 320px', minWidth: 300, display: 'grid', gap: 6 }}>
                          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                            {kr.title}{kr.unit ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> ({kr.unit})</span> : null}
                            <select
                              value={kr.aggregation ?? ''}
                              onChange={(e) => void saveAggregation(kr.id, e.target.value)}
                              title={`${MODE_BADGE[c.mode].title} — 여기서 바꾸면 즉시 저장되고 누적·달성률이 재계산됩니다.`}
                              style={{ fontSize: 10, fontWeight: 700, color: c.mode === 'avg' ? '#0369a1' : c.mode === 'sum' ? '#92400e' : c.mode === 'progress' ? '#6d28d9' : '#166534', background: c.mode === 'avg' ? '#e0f2fe' : c.mode === 'sum' ? '#fef3c7' : c.mode === 'progress' ? '#ede9fe' : '#dcfce7', borderRadius: 8, padding: '1px 4px', border: '1px solid transparent', cursor: 'pointer' }}
                            >
                              <option value="">{`자동 · ${MODE_BADGE[kpiModeOf({ ...kr, aggregation: null })].label}`}</option>
                              <option value="AVG">월별 독립측정 (누적=평균)</option>
                              <option value="SUM">월별 누계 (누적=합산)</option>
                              <option value="LAST">누계값 입력 (누적=최신값)</option>
                              <option value="PROGRESS">진척율 입력 (최신값·목표 그대로 대비)</option>
                            </select>
                          </div>
                          {kr.metric && (
                            <div style={{ fontSize: 11.5, color: '#64748b', whiteSpace: 'pre-wrap', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, padding: '5px 8px' }}>
                              <span style={{ fontWeight: 700, color: '#475569' }}>산식·세부</span> {kr.metric}
                            </div>
                          )}
                          <div style={{ fontSize: 13, color: '#475569' }}>
                            목표 <b>{kr.target ?? '-'}</b>
                            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                            {month.slice(5, 7)}월 실적 <b style={{ color: '#0f172a' }}>{mv != null ? mv.toLocaleString() : '-'}</b>
                            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                            누적({CUM_LABEL[c.mode]}) <b style={{ color: '#0f3d73' }}>{c.value != null ? c.value.toLocaleString() : '-'}</b>
                            {(c.mode === 'sum' || c.mode === 'last') && c.value != null && kr.target != null && (
                              <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 12 }}
                                title={`달성률은 경과월 안분 목표(${cumTargetOf(kr, selIdx)?.toLocaleString()}) 대비 · 연간 목표(${kr.target.toLocaleString()}) 대비로는 ${achPct(kr, c.value) ?? '-'}%`}>
                                연간 대비 {achPct(kr, c.value) ?? '-'}%
                              </span>
                            )}
                            {typeof kr.weight === 'number' ? <span style={{ marginLeft: 8, color: '#94a3b8' }}>비중 {kr.weight}%</span> : null}
                          </div>
                          <MiniBars kr={kr} selIdx={selIdx} />
                          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
                            <span>25목표 {kr.year25Target ?? '-'}</span>
                            <span>25실적 {kr.baseline ?? '-'}</span>
                            <span>26목표 {kr.target ?? '-'}</span>
                            <span>{kr.direction === 'AT_MOST' ? '↓ 이하 좋음' : '↑ 이상 좋음'}</span>
                          </div>
                          {(kr.initiatives || []).length > 0 && (
                            <div style={{ fontSize: 11.5, color: '#64748b' }}>
                              <span style={{ fontWeight: 700, color: '#475569' }}>추진 계획</span>{' '}
                              {(kr.initiatives || []).map((it) => it.title).filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        {/* ③ 실행 근거 + 온톨로지 (남은 폭 전체 사용) */}
                        <div style={{ flex: '1 1 280px', minWidth: 250, background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 5, alignContent: 'start' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>📎 실행 근거 ({evidencePeriodLabel(month)})</span>
                            {ev && (
                              <button type="button" onClick={() => setMapKr(kr)}
                                style={{ marginLeft: 'auto', fontSize: 11, color: '#6d28d9', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>
                                🕸 관련 업무 실적
                              </button>
                            )}
                          </div>
                          {!ev || (ev.totals.logs === 0 && ev.activities.length === 0) ? (
                            <div style={{ fontSize: 12, color: '#dc2626' }}>근거 없음 — 이 지표를 뒷받침하는 일지가 없습니다</div>
                          ) : (
                            <>
                              <div style={{ fontSize: 13, color: '#334155' }}>일지 <b>{ev.totals.logs}건</b> · <b>{hm}</b> · {ev.totals.people}명</div>
                              {ev.activities.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {ev.activities.slice(0, 4).map((ac) => (
                                    <span key={ac.id} style={{ fontSize: 11, background: ac.linked !== false ? '#f5f3ff' : '#fff', color: ac.linked !== false ? '#6d28d9' : '#475569', border: ac.linked !== false ? '1px solid #ddd6fe' : '1px dashed #cbd5e1', borderRadius: 10, padding: '1px 8px' }}>
                                      {ac.name}{ac.logs > 0 ? ` ${ac.logs}건·${fmtH(ac.minutes)}` : ''}
                                    </span>
                                  ))}
                                  {ev.activities.length > 4 && <span style={{ fontSize: 11, color: '#94a3b8' }}>외 {ev.activities.length - 4}</span>}
                                </div>
                              )}
                              {evOpen && ev.worklogs.slice(0, 6).map((w) => (
                                <a key={w.id} href={`/worklogs/${w.id}`} target="_blank" rel="noreferrer"
                                  style={{ display: 'flex', gap: 6, fontSize: 12, color: '#334155', textDecoration: 'none', alignItems: 'baseline' }}>
                                  <span style={{ color: '#94a3b8', minWidth: 38 }}>{new Date(w.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</span>
                                  <b style={{ minWidth: 48 }}>{w.authorName}</b>
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.snippet}</span>
                                </a>
                              ))}
                              {evOpen && ev.totals.logs > 6 && (
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>외 {ev.totals.logs - 6}건 — 전체는 🕸 관련 업무 실적에서</div>
                              )}
                            </>
                          )}
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
                          const a = monthAchPct(kr, v, i);
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

      {/* 🕸 KPI 온톨로지 맵 모달: 활동 → KPI ← 수행자 (선 굵기 = 투입시간) */}
      {mapKr && evidence[mapKr.id] && (
        <div onClick={() => setMapKr(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 800, width: '100%', maxHeight: '82vh', overflow: 'auto', padding: 20, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>🕸 {mapKr.title}</b>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{teamName} · {evidencePeriodLabel(month)} 누적 · 활동 → KPI ← 수행자 (선 굵기 = 투입시간 · ◦점선 = 근거 일지에서 발견된 활동, 🎯 미연결)</span>
              <button type="button" onClick={() => setMapKr(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>
            <KpiOntoMap kr={mapKr} ev={evidence[mapKr.id]} ach={monthAchPct(mapKr, mapKr.monthly?.[selIdx] ?? null, selIdx)} periodLabel={evidencePeriodLabel(month)} />
            {evidence[mapKr.id].worklogs.length > 0 && (
              <div style={{ display: 'grid', gap: 3, borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>근거 일지</div>
                {evidence[mapKr.id].worklogs.map((w) => (
                  <a key={w.id} href={`/worklogs/${w.id}`} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', gap: 8, fontSize: 12, color: '#334155', textDecoration: 'none', alignItems: 'baseline' }}>
                    <span style={{ color: '#94a3b8', minWidth: 40 }}>{new Date(w.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</span>
                    <b style={{ minWidth: 52 }}>{w.authorName}</b>
                    {w.minutes > 0 && <span style={{ color: '#7c3aed', minWidth: 34 }}>{fmtH(w.minutes)}</span>}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.snippet}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const thS: React.CSSProperties = { borderBottom: '2px solid #e2e8f0', padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: '#475569', background: '#f8fafc' };
const tdS: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '5px 8px' };
