import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/**
 * 회사 실행 현황판 (임원/IR용) — "회사의 시간이 어디로 흐르고, 무엇을 움직였나"
 * 온톨로지 증거사슬(일지→활동→KPI) 기반. 모자이크(기둥×KPI 시간배분) + 팀 실행 + 6개월 추이.
 */

type Goal = { krId: string; title: string; pillar: string | null; teamName: string; minutes: number; logs: number; people: number; ach: number | null; value: number | null; unit: string; target: number | null };
type Team = { name: string; totalMin: number; linkedMin: number; logs: number; pct: number | null };
type Trend = { month: string; totalMinutes: number; linkedMinutes: number; pct: number | null };
type Pulse = {
  month: string;
  align: { totalMinutes: number; linkedMinutes: number; pct: number | null };
  coverage: { totalGoals: number; withEvidence: number; matchedGoals: number };
  goals: Goal[];
  teams: Team[];
  lowContribution: Array<{ name: string; domain: string | null; minutes: number; logs: number; people: number }>;
  noEvidenceCount: number;
  trend: Trend[];
};

const PILLARS: Record<string, { label: string; color: string; light: string }> = {
  DEV: { label: '신차 개발', color: '#7c3aed', light: '#a78bfa' },
  C: { label: '생산성 혁신', color: '#2563eb', light: '#60a5fa' },
  Q: { label: '품질 혁신', color: '#16a34a', light: '#4ade80' },
  D: { label: '납기 혁신', color: '#d97706', light: '#fbbf24' },
  P: { label: '역량 강화', color: '#db2777', light: '#f472b6' },
};
const PORDER = ['DEV', 'C', 'Q', 'D', 'P'];
const h = (min: number) => Math.round(min / 60);
const kstMonth = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
const achColor = (p: number | null) => (p == null ? '#94a3b8' : p >= 100 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626');

// ── 모자이크: 세로 = 기둥(시간 비례), 가로 = KPI(시간 비례) ──
function Mosaic({ goals }: { goals: Goal[] }) {
  const W = 960, H = 420, GAP = 3, LABELW = 118;
  const byPillar = PORDER
    .map((p) => ({ p, info: PILLARS[p], list: goals.filter((g) => g.pillar === p && g.minutes > 0).sort((a, b) => b.minutes - a.minutes) }))
    .filter((x) => x.list.length);
  const total = byPillar.reduce((s, x) => s + x.list.reduce((s2, g) => s2 + g.minutes, 0), 0) || 1;
  let yCur = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {byPillar.map(({ p, info, list }) => {
        const pMin = list.reduce((s, g) => s + g.minutes, 0);
        const bandH = Math.max(34, (pMin / total) * (H - GAP * (byPillar.length - 1)));
        const y0 = yCur;
        yCur += bandH + GAP;
        let xCur = LABELW;
        const bandW = W - LABELW;
        return (
          <g key={p}>
            {/* 기둥 라벨 */}
            <rect x={0} y={y0} width={LABELW - 6} height={bandH} rx={8} fill={info.color} />
            <text x={(LABELW - 6) / 2} y={y0 + bandH / 2 - 7} fontSize={13} fontWeight={800} fill="#fff" textAnchor="middle">{info.label}</text>
            <text x={(LABELW - 6) / 2} y={y0 + bandH / 2 + 11} fontSize={11} fill="rgba(255,255,255,.85)" textAnchor="middle">{h(pMin).toLocaleString()}h · {Math.round((pMin / total) * 100)}%</text>
            {/* KPI 셀 */}
            {list.map((g) => {
              const w = (g.minutes / pMin) * (bandW - GAP * (list.length - 1));
              const x0 = xCur;
              xCur += w + GAP;
              const big = w > 90 && bandH > 40;
              const mid = w > 46;
              return (
                <g key={g.krId}>
                  <rect x={x0} y={y0} width={Math.max(w, 2)} height={bandH} rx={6} fill={info.light} opacity={0.92}>
                    <title>{`[${info.label}] ${g.title} (${g.teamName})\n${h(g.minutes)}h · 일지 ${g.logs}건 · ${g.people}명${g.ach != null ? `\n달성률 ${g.ach}%` : ''}`}</title>
                  </rect>
                  {/* 달성률 인디케이터 바 */}
                  {g.ach != null && mid && (
                    <rect x={x0 + 4} y={y0 + bandH - 8} width={Math.max((Math.min(g.ach, 100) / 100) * (w - 8), 2)} height={4} rx={2} fill={achColor(g.ach)} />
                  )}
                  {big && (
                    <>
                      <text x={x0 + 8} y={y0 + 18} fontSize={12} fontWeight={700} fill="#1e293b">{g.title.length > Math.floor(w / 9) ? g.title.slice(0, Math.floor(w / 9)) + '…' : g.title}</text>
                      <text x={x0 + 8} y={y0 + 34} fontSize={11} fill="#334155">{h(g.minutes)}h · {g.teamName}{g.ach != null ? ` · ${g.ach}%` : ''}</text>
                    </>
                  )}
                  {!big && mid && bandH > 30 && (
                    <text x={x0 + w / 2} y={y0 + bandH / 2 + 4} fontSize={10} fill="#1e293b" textAnchor="middle">{h(g.minutes)}h</text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ── 6개월 추이: 막대(투입 h) + 선(정렬률) ──
function TrendChart({ trend }: { trend: Trend[] }) {
  const W = 640, H = 170, L = 44, R = 44, T = 14, B = 26;
  const maxH = Math.max(...trend.map((t) => t.totalMinutes), 1);
  const x = (i: number) => L + ((i + 0.5) / trend.length) * (W - L - R);
  const bw = ((W - L - R) / trend.length) * 0.52;
  const yBar = (v: number) => T + (1 - v / maxH) * (H - T - B);
  const yPct = (v: number) => T + (1 - v / 100) * (H - T - B);
  let path = ''; let started = false;
  trend.forEach((t, i) => { if (t.pct == null) return; path += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${yPct(t.pct).toFixed(1)} `; started = true; });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={yPct(g)} y2={yPct(g)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={g === 100 ? '4 3' : undefined} />
          <text x={W - R + 6} y={yPct(g) + 4} fontSize={10} fill="#94a3b8">{g}%</text>
        </g>
      ))}
      {trend.map((t, i) => (
        <g key={t.month}>
          <rect x={x(i) - bw / 2} y={yBar(t.totalMinutes)} width={bw} height={H - B - yBar(t.totalMinutes)} rx={4} fill="#cbd5e1">
            <title>{`${t.month}: 실행 ${h(t.totalMinutes).toLocaleString()}h · 정렬 ${h(t.linkedMinutes).toLocaleString()}h`}</title>
          </rect>
          <rect x={x(i) - bw / 2} y={yBar(t.linkedMinutes)} width={bw} height={H - B - yBar(t.linkedMinutes)} rx={4} fill="#2563eb" opacity={0.85} />
          <text x={x(i)} y={H - 8} fontSize={10} fill="#64748b" textAnchor="middle">{t.month.slice(5)}월</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#0f172a" strokeWidth={2.5} />
      {trend.map((t, i) => t.pct != null && (
        <g key={`p${t.month}`}>
          <circle cx={x(i)} cy={yPct(t.pct)} r={4} fill="#0f172a" />
          <text x={x(i)} y={yPct(t.pct) - 8} fontSize={11} fontWeight={800} fill="#0f172a" textAnchor="middle">{t.pct}%</text>
        </g>
      ))}
    </svg>
  );
}

export function CompanyPulse() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [month, setMonth] = useState(kstMonth());
  const [d, setD] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true); setErr(null);
    apiJson<Pulse>(`/api/activities/company-pulse?actorId=${encodeURIComponent(userId)}&month=${encodeURIComponent(month)}`)
      .then(setD).catch((e) => setErr(e?.message || '로드 실패')).finally(() => setLoading(false));
  }, [month, userId]);

  const pillarSum = useMemo(() => {
    if (!d) return [];
    return PORDER.map((p) => {
      const list = d.goals.filter((g) => g.pillar === p);
      const min = list.reduce((s, g) => s + g.minutes, 0);
      const achs = list.map((g) => g.ach).filter((a): a is number => a != null);
      return { p, info: PILLARS[p], minutes: min, kpis: list.length, avgAch: achs.length ? Math.round(achs.reduce((s, a) => s + Math.min(a, 150), 0) / achs.length) : null };
    }).filter((x) => x.kpis > 0);
  }, [d]);

  const maxTeam = Math.max(...(d?.teams || []).map((t) => t.totalMin), 1);

  return (
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>🏢 회사 실행 현황판</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '6px 8px' }} />
        <button type="button" className="btn btn-sm" onClick={() => window.print()}>🖨 인쇄</button>
      </div>
      {err && <div style={{ color: '#dc2626' }}>{err}</div>}
      {loading || !d ? <div style={{ color: '#94a3b8' }}>불러오는 중…</div> : (
        <>
          {/* 히어로 */}
          <div style={{ borderRadius: 18, padding: '26px 28px', background: 'linear-gradient(120deg,#0b1f3a 0%,#0f3d73 55%,#1d4ed8 100%)', color: '#fff', display: 'flex', gap: 34, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 13, opacity: 0.8, letterSpacing: 1 }}>CAMS EXECUTION PULSE · {d.month}</div>
              <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.25, marginTop: 4 }}>회사의 시간이<br />전략을 향해 흐르고 있는가</div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>업무일지 {d.teams.reduce((s, t) => s + t.logs, 0).toLocaleString()}건의 실행 데이터 · AI+본인확정 분류 기반</div>
            </div>
            <Stat label="이번 달 총 실행" value={`${h(d.align.totalMinutes).toLocaleString()}h`} />
            <Stat label="전략 정렬률" value={d.align.pct != null ? `${d.align.pct}%` : '-'} accent />
            <Stat label="KPI 실행 커버리지" value={`${d.coverage.withEvidence}/${d.coverage.totalGoals}`} />
          </div>

          {/* 모자이크 */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>회사의 시간, 어디로 흘렀나</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>면적 = KPI 연결 투입시간 · 하단 바 = 달성률 (셀에 마우스를 올려보세요)</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <Mosaic goals={d.goals} />
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
              {pillarSum.map((x) => (
                <span key={x.p} style={{ fontSize: 12, color: '#475569' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: x.info.color, marginRight: 5, verticalAlign: 'middle' }} />
                  {x.info.label} {h(x.minutes)}h · KPI {x.kpis}개{x.avgAch != null ? ` · 평균달성 ${x.avgAch}%` : ''}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {/* 추이 */}
            <div style={panel}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>전략 정렬 추이 (6개월)</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>회색=총 실행시간 · 파랑=전략 연결시간 · 선=정렬률</div>
              <TrendChart trend={d.trend} />
            </div>
            {/* 팀 실행 */}
            <div style={panel}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>팀별 실행 · 정렬률</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {d.teams.filter((t) => t.totalMin > 0).slice(0, 10).map((t) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ minWidth: 86, fontWeight: 600, color: '#334155' }}>{t.name}</span>
                    <div style={{ flex: 1, height: 14, background: '#f1f5f9', borderRadius: 7, overflow: 'hidden', position: 'relative' }}>
                      <div style={{ width: `${(t.totalMin / maxTeam) * 100}%`, height: '100%', background: '#e2e8f0', borderRadius: 7 }} />
                      <div style={{ position: 'absolute', top: 0, left: 0, width: `${(t.linkedMin / maxTeam) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#0f3d73,#2563eb)', borderRadius: 7 }} />
                    </div>
                    <span style={{ minWidth: 104, textAlign: 'right', color: '#475569' }}>{h(t.totalMin)}h · <b style={{ color: t.pct != null && t.pct >= 50 ? '#16a34a' : '#d97706' }}>{t.pct != null ? `${t.pct}%` : '-'}</b></span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 주의 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={{ ...panel, borderLeft: '4px solid #d97706' }}>
              <div style={{ fontWeight: 800, color: '#b45309', marginBottom: 6 }}>⚠ 목표에 연결되지 않은 시간 TOP</div>
              {d.lowContribution.slice(0, 5).map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: '#475569' }}>
                  <span>{i + 1}. {a.name}</span><b style={{ color: '#b45309' }}>{h(a.minutes)}h</b>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>KPI 신설 또는 기본업무 인정 판단 대상</div>
            </div>
            <div style={{ ...panel, borderLeft: '4px solid #dc2626' }}>
              <div style={{ fontWeight: 800, color: '#b91c1c', marginBottom: 6 }}>🔴 이번 달 실행 증거 없는 KPI</div>
              <div style={{ fontSize: 40, fontWeight: 900, color: '#b91c1c' }}>{d.noEvidenceCount}<span style={{ fontSize: 16, color: '#94a3b8' }}> / {d.coverage.totalGoals}</span></div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>지표만 있고 실행이 잡히지 않는 목표 — KPI 기여 분석에서 상세 확인</div>
            </div>
            <div style={{ ...panel, borderLeft: '4px solid #16a34a' }}>
              <div style={{ fontWeight: 800, color: '#15803d', marginBottom: 6 }}>🏆 최다 투입 KPI</div>
              {d.goals.filter((g) => g.minutes > 0).slice(0, 3).map((g, i) => (
                <div key={g.krId} style={{ fontSize: 13, padding: '3px 0', color: '#475569' }}>
                  {i + 1}. <b>{g.title}</b> <span style={{ color: '#94a3b8' }}>({g.teamName})</span> — {h(g.minutes)}h · {g.people}명
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: accent ? 52 : 38, fontWeight: 900, lineHeight: 1.1, color: accent ? '#7dd3fc' : '#fff' }}>{value}</div>
    </div>
  );
}

const panel: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', padding: '14px 16px' };
