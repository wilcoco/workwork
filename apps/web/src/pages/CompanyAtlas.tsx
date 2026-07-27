import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

/**
 * 🗺 회사 조감도 — 회사 전체 온톨로지를 한 장에: 회사 → 전략 기둥 → KPI(면적=투입시간),
 * 옆에 "목표 없는 실행" 섬. 전부가 아니라 요약+공백을 그린다 (개별 노드는 클릭→탐색기).
 */
type Goal = { krId: string; title: string; pillar: string | null; teamName: string; minutes: number; logs: number; people: number; ach: number | null; value: number | null; unit: string };
type Low = { activityId: string; name: string; domain: string | null; minutes: number; logs: number; people: number };
type Pulse = {
  month: string;
  align: { totalMinutes: number; linkedMinutes: number; pct: number | null };
  coverage: { totalGoals: number; withEvidence: number; matchedGoals: number };
  goals: Goal[]; lowContribution: Low[]; noEvidenceCount: number;
};

const PILLARS: Array<{ key: string; label: string; color: string }> = [
  { key: 'C', label: '생산성 혁신', color: '#2563eb' },
  { key: 'Q', label: '품질 혁신', color: '#16a34a' },
  { key: 'DEV', label: '신차 개발', color: '#7c3aed' },
  { key: 'P', label: '역량 강화', color: '#db2777' },
];

export function CompanyAtlas() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [month, setMonth] = useState(() => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7));
  const [data, setData] = useState<Pulse | null>(null);
  const [error, setError] = useState('');
  const [selPillar, setSelPillar] = useState<string | null>(null); // 기둥 클릭 → 화면 내 KPI 전개 (현황판 이동 없음)

  useEffect(() => {
    setData(null);
    apiJson<Pulse>(`/api/activities/company-pulse?actorId=${encodeURIComponent(userId)}&month=${month}`)
      .then(setData)
      .catch((e) => setError(e?.message || '조회 실패'));
  }, [month]);

  const shiftMonth = (d: number) => {
    const [y, m] = month.split('-').map(Number);
    const t = new Date(y, m - 1 + d, 1);
    setMonth(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`);
  };

  const layout = useMemo(() => {
    if (!data) return null;
    const W = 1240, H = 780, CX = 470, CY = 392;
    const hrs = (min: number) => Math.round(min / 60);
    // 기둥별 KPI 묶기
    const byPillar = new Map<string, Goal[]>();
    for (const g of data.goals) {
      const k = g.pillar || '_';
      (byPillar.get(k) || byPillar.set(k, []).get(k)!).push(g);
    }
    const pillarHours = (k: string) => hrs((byPillar.get(k) || []).reduce((s, g) => s + g.minutes, 0));
    const maxPH = Math.max(1, ...PILLARS.map((p) => pillarHours(p.key)));
    // 기둥 배치: 중심 둘레 원형 (12시부터 시계방향)
    const pillars = PILLARS.map((p, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / PILLARS.length;
      const ph = pillarHours(p.key);
      const r = 20 + Math.sqrt(ph / maxPH) * 34; // 크기 = 시간 비중
      return { ...p, ang, hours: ph, r, x: CX + Math.cos(ang) * 218, y: CY + Math.sin(ang) * 218 };
    });
    // KPI 위성 배치: 기둥 바깥 방향 부채꼴, 상위 8개 (면적=시간)
    const maxKpiMin = Math.max(60, ...data.goals.map((g) => g.minutes));
    const kpiNodes: Array<Goal & { x: number; y: number; r: number; color: string; more?: number }> = [];
    for (const p of pillars) {
      const gs = (byPillar.get(p.key) || []).slice().sort((a, b) => b.minutes - a.minutes);
      const shown = gs.slice(0, 8);
      const fan = Math.min(2.4, 0.5 + shown.length * 0.3); // 부채꼴 각도(rad)
      shown.forEach((g, i) => {
        const a = shown.length === 1 ? p.ang : p.ang - fan / 2 + (fan * i) / (shown.length - 1);
        const dist = p.r + 52 + (i % 2) * 44;
        const r = 7 + Math.sqrt(g.minutes / maxKpiMin) * 24;
        kpiNodes.push({ ...g, x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist, r, color: p.color, more: i === shown.length - 1 && gs.length > 8 ? gs.length - 8 : undefined });
      });
    }
    // 목표 없는 실행 섬 (우측): 미정렬 상위 활동
    const orphanMin = Math.max(0, data.align.totalMinutes - data.align.linkedMinutes);
    const island = data.lowContribution.slice(0, 8).map((a, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const r = 8 + Math.sqrt(a.minutes / maxKpiMin) * 24;
      return { ...a, r, x: 1000 + col * 118, y: 180 + row * 118 };
    });
    return { W, H, CX, CY, pillars, kpiNodes, island, orphanMin, hrs };
  }, [data]);

  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  const achColor = (ach: number | null) => (ach == null ? '#94a3b8' : ach >= 100 ? '#16a34a' : ach >= 50 ? '#d97706' : '#dc2626');
  // 제목을 자르지 않고 여러 줄로 감싼다 (per 글자수 단위)
  const wrapLines = (t: string, per: number, max = 4): string[] => {
    const out: string[] = [];
    for (let i = 0; i < t.length && out.length < max; i += per) out.push(t.slice(i, i + per));
    if (t.length > per * max) out[max - 1] = out[max - 1].slice(0, per - 1) + '…';
    return out;
  };

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>🗺 회사 조감도</h2>
          <div style={{ fontSize: 12, color: '#64748b' }}>회사 → 전략 기둥 → KPI (면적 = 투입시간) · 우측 = 목표 없는 실행 · 노드 클릭 = 탐색기로 파고들기</div>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-sm btn-outline" onClick={() => shiftMonth(-1)}>◀</button>
          <b style={{ fontSize: 15 }}>{month}</b>
          <button className="btn btn-sm btn-outline" onClick={() => shiftMonth(1)}>▶</button>
        </div>
      </div>

      {!data || !layout ? (
        <div style={{ padding: 40, color: '#94a3b8' }}>조감도를 그리는 중…</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${layout.W} ${layout.H}`} style={{ width: '100%', height: 'auto', border: '1px solid #e5e7eb', borderRadius: 14, background: '#fcfcfd' }}>
            {/* 간선: 회사→기둥, 기둥→KPI */}
            {layout.pillars.map((p) => (
              <line key={`pl${p.key}`} x1={layout.CX} y1={layout.CY} x2={p.x} y2={p.y} stroke={p.color} strokeOpacity={0.3} strokeWidth={2.5} />
            ))}
            {layout.kpiNodes.map((g, i) => {
              const p = layout.pillars.find((x) => x.key === (g.pillar || ''))!;
              return <line key={`kl${i}`} x1={p.x} y1={p.y} x2={g.x} y2={g.y} stroke={g.color} strokeOpacity={0.2} strokeWidth={1.2} />;
            })}

            {/* 섬 구역 */}
            <rect x={920} y={90} width={300} height={560} rx={16} fill="#f5f3ff" stroke="#c4b5fd" strokeDasharray="6 4" />
            <text x={1070} y={122} textAnchor="middle" fontSize={13} fontWeight={800} fill="#5b21b6">🔎 목표 없는 실행</text>
            <text x={1070} y={140} textAnchor="middle" fontSize={11} fill="#7c3aed">{layout.hrs(layout.orphanMin).toLocaleString()}h ({data.align.pct != null ? (100 - data.align.pct).toFixed(1) : '?'}%) — 전략 밖에서 도는 시간</text>
            {layout.island.map((a, i) => (
              <g key={`is${i}`} onClick={() => nav(`/process/ontology?type=activity&id=${encodeURIComponent(a.activityId)}`)} style={{ cursor: 'pointer' }}>
                <circle cx={a.x} cy={a.y} r={a.r} fill="#ede9fe" stroke="#8b5cf6" strokeWidth={1.5} />
                <title>{a.name} — {layout.hrs(a.minutes)}h · 일지 {a.logs}건 · {a.people}명</title>
                {wrapLines(a.name, 12).map((ln, li) => (
                  <text key={li} x={a.x} y={a.y + a.r + 12 + li * 11} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#5b21b6">{ln}</text>
                ))}
                <text x={a.x} y={a.y + 4} textAnchor="middle" fontSize={9} fontWeight={800} fill="#6d28d9">{layout.hrs(a.minutes)}h</text>
              </g>
            ))}

            {/* KPI 노드 */}
            {layout.kpiNodes.map((g, i) => (
              <g key={`k${i}`} onClick={() => nav(`/process/ontology?type=keyResult&id=${encodeURIComponent(g.krId)}`)} style={{ cursor: 'pointer' }}>
                <circle cx={g.x} cy={g.y} r={g.r} fill={`${g.color}18`} stroke={g.logs === 0 ? '#dc2626' : g.color} strokeWidth={g.logs === 0 ? 1.5 : 2} strokeDasharray={g.logs === 0 ? '3 3' : undefined} />
                {g.ach != null && <circle cx={g.x} cy={g.y} r={g.r + 3.5} fill="none" stroke={achColor(g.ach)} strokeWidth={2} strokeOpacity={0.85} strokeDasharray={`${Math.min(100, Math.max(0, g.ach)) / 100 * 2 * Math.PI * (g.r + 3.5)} 999`} transform={`rotate(-90 ${g.x} ${g.y})`} />}
                <title>{g.title} ({g.teamName}) — {layout.hrs(g.minutes)}h · 일지 {g.logs}건 · {g.people}명{g.ach != null ? ` · 달성률 ${g.ach}%` : ''}</title>
                {g.r >= 13 && <text x={g.x} y={g.y + 3.5} textAnchor="middle" fontSize={9.5} fontWeight={800} fill={g.color}>{layout.hrs(g.minutes)}h</text>}
                {wrapLines(g.title, 12).map((ln, li) => (
                  <text key={li} x={g.x} y={g.y + g.r + 11 + li * 10.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#334155">{ln}</text>
                ))}
                {g.more ? <text x={g.x + g.r + 4} y={g.y - g.r} fontSize={9.5} fontWeight={800} fill="#7c3aed">+{g.more}</text> : null}
              </g>
            ))}

            {/* 기둥 노드 */}
            {layout.pillars.map((p) => (
              <g key={`p${p.key}`} onClick={() => setSelPillar(selPillar === p.key ? null : p.key)} style={{ cursor: 'pointer' }}>
                <title>{p.label} — 클릭하면 이 기둥의 KPI 전체가 아래에 펼쳐집니다</title>
                <circle cx={p.x} cy={p.y} r={p.r} fill={p.hours === 0 ? '#fef2f2' : `${p.color}22`} stroke={p.hours === 0 ? '#dc2626' : p.color} strokeWidth={2.5} strokeDasharray={p.hours === 0 ? '5 4' : undefined} />
                <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize={12} fontWeight={800} fill={p.hours === 0 ? '#dc2626' : p.color}>{p.label}</text>
                <text x={p.x} y={p.y + 13} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={p.hours === 0 ? '#dc2626' : '#475569'}>{p.hours === 0 ? '실행 0' : `${p.hours.toLocaleString()}h`}</text>
              </g>
            ))}

            {/* 중심: 회사 */}
            <g>
              <circle cx={layout.CX} cy={layout.CY} r={62} fill="#0f3d73" />
              <text x={layout.CX} y={layout.CY - 14} textAnchor="middle" fontSize={13} fontWeight={800} fill="#fff">캠스</text>
              <text x={layout.CX} y={layout.CY + 5} textAnchor="middle" fontSize={11} fill="#cbd5e1">{layout.hrs(data.align.totalMinutes).toLocaleString()}h 실행</text>
              <text x={layout.CX} y={layout.CY + 21} textAnchor="middle" fontSize={11} fontWeight={700} fill="#7dd3fc">정렬 {data.align.pct ?? '?'}%</text>
            </g>
          </svg>

          {selPillar && (() => {
            const pInfo = PILLARS.find((x) => x.key === selPillar)!;
            const list = data.goals.filter((g) => (g.pillar || '') === selPillar).slice().sort((a, b) => b.minutes - a.minutes);
            const hrs = (min: number) => Math.round(min / 60);
            return (
              <div style={{ border: `2px solid ${pInfo.color}44`, background: `${pInfo.color}08`, borderRadius: 14, padding: '12px 16px', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <b style={{ color: pInfo.color, fontSize: 15 }}>{pInfo.label}</b>
                  <span style={{ fontSize: 12, color: '#64748b' }}>KPI {list.length}개 · {hrs(list.reduce((s2, g) => s2 + g.minutes, 0)).toLocaleString()}h — KPI를 누르면 온톨로지 탐색기에서 활동·기여 일지까지 이어집니다</span>
                  <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={() => setSelPillar(null)}>접기 ✕</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
                  {list.map((g) => (
                    <div key={g.krId} onClick={() => nav(`/process/ontology?type=keyResult&id=${encodeURIComponent(g.krId)}`)}
                      style={{ display: 'grid', gap: 2, padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{g.title}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span>{g.teamName}</span>
                        <span style={{ color: '#0369a1' }}>{hrs(g.minutes)}h · 일지 {g.logs}건 · {g.people}명</span>
                        {g.ach != null && <span style={{ fontWeight: 700, color: achColor(g.ach) }}>달성 {g.ach}%</span>}
                        {g.logs === 0 && <span style={{ color: '#dc2626' }}>실행 증거 없음</span>}
                      </div>
                    </div>
                  ))}
                  {list.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>이 기둥에 연결된 KPI가 없습니다</div>}
                </div>
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: '#64748b', alignItems: 'center' }}>
            <span>⬤ 면적 = 월 투입시간 (자기신고, 복수 KPI 태그는 중복 계상)</span>
            <span style={{ color: '#16a34a' }}>◠ 테두리 호 = 달성률</span>
            <span style={{ color: '#dc2626' }}>◌ 점선 = 실행 증거 없는 KPI ({data.noEvidenceCount}개)</span>
            <span style={{ color: '#7c3aed' }}>▨ 보라 섬 = 목표에 연결 안 된 실행</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-outline" onClick={() => nav('/process/strategy-map')}>전략 정렬 지도 →</button>
          </div>
        </>
      )}
    </div>
  );
}

export default CompanyAtlas;
