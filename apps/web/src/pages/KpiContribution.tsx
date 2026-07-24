import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

/**
 * KPI 기여 분석 (임원 전용) — 온톨로지의 경영 산출물.
 *  ① 이번 달 KPI를 움직인 업무 랭킹 (목표별 투입시간·일지·인원·실적)
 *  ② 시간은 많이 쓰는데 어떤 목표에도 연결 안 된 활동
 *  ③ 실행 증거 없는 KPI
 */

type Goal = {
  krId: string; title: string; unit: string; target: number | null; pillar: string | null;
  teamName: string; activityName: string | null; value: number | null; ach: number | null;
  minutes: number; logs: number; people: number;
};
type LowItem = { activityId: string; name: string; domain: string | null; minutes: number; logs: number; people: number };
type Data = {
  month: string;
  align: { totalMinutes: number; linkedMinutes: number; pct: number | null };
  coverage: { totalGoals: number; withEvidence: number; matchedGoals: number };
  goals: Goal[];
  lowContribution: LowItem[];
  noEvidence: Array<{ krId: string; title: string; teamName: string; pillar: string | null }>;
};

const PILLAR_INFO: Record<string, { label: string; color: string; bg: string }> = {
  C: { label: '생산성', color: '#2563eb', bg: '#eff6ff' },
  Q: { label: '품질', color: '#16a34a', bg: '#f0fdf4' },
  DEV: { label: '신차개발', color: '#7c3aed', bg: '#f5f3ff' },
  P: { label: '역량', color: '#db2777', bg: '#fdf2f8' },
};
const achColor = (p: number | null) => (p == null ? '#94a3b8' : p >= 100 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626');
const fmtH = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${min}m`);

function kstMonth(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
}

export function KpiContribution() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [month, setMonth] = useState(kstMonth());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);
  const [wlMapping, setWlMapping] = useState<string | null>(null); // 일지→KPI 배치 분류 진행표시
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [reclassTeam, setReclassTeam] = useState(''); // ''=전체 (재분류 범위)

  useEffect(() => {
    apiJson<{ items: Array<{ id: string; name: string; type: string }> }>('/api/orgs')
      .then((r) => setTeams((r.items || []).filter((o) => o.type === 'TEAM').map(({ id, name }) => ({ id, name }))))
      .catch(() => {});
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const d = await apiJson<Data>(`/api/activities/kpi-contribution?actorId=${encodeURIComponent(userId)}&month=${encodeURIComponent(month)}`);
      setData(d);
    } catch (e: any) { setErr(e?.message || '로드 실패'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month, userId]);

  // 🎯 목표-활동 매칭 실행 (미연결 지표만 스캔하므로 반복 클릭 = 이어서 개선)
  async function runMapping() {
    setMapping(true);
    try {
      const r = await apiJson<{ kpiScanned: number; kpiMapped: number; initiativeScanned: number; initiativeMapped: number }>(
        `/api/activities/map-goals`, { method: 'POST', body: JSON.stringify({ actorId: userId }) });
      alert(`🎯 매칭 완료\nKPI: ${r.kpiMapped}/${r.kpiScanned}건 신규 연결\n중점과제: ${r.initiativeMapped}/${r.initiativeScanned}건 신규 연결`);
      await load();
    } catch (e: any) { alert(e?.message || '매칭 실패'); }
    finally { setMapping(false); }
  }

  // 🤖 일지→팀 KPI 배치 분류: 남은 일지가 0이 될 때까지 자동 반복 (최대 12회)
  async function runWorklogKpiMapping() {
    if (!confirm('전체 미분류 업무일지를 AI가 읽어 작성자 팀의 KPI에 분류합니다.\n(일지 수천 건 기준 수 분~수십 분, AI 비용 발생)\n시작할까요?')) return;
    let totTagged = 0, totNone = 0;
    try {
      for (let i = 1; i <= 12; i++) {
        setWlMapping(`분류 중… ${i}회차 (누적 ${totTagged}건 태깅)`);
        const r = await apiJson<{ scanned: number; tagged: number; tags: number; none: number; remaining: number; aiErrors: string[] }>(
          `/api/activities/map-worklog-kpis`, { method: 'POST', body: JSON.stringify({ actorId: userId, limit: 300 }) });
        totTagged += r.tagged; totNone += r.none;
        if (r.aiErrors?.length) { alert(`중단: ${r.aiErrors[0]}`); break; }
        if (r.remaining <= 0 || r.scanned === 0) break;
      }
      alert(`🤖 일지→KPI 분류 완료\nKPI 태깅: ${totTagged}건 · 해당없음: ${totNone}건`);
      await load();
    } catch (e: any) { alert(e?.message || '분류 실패'); }
    finally { setWlMapping(null); }
  }

  // ♻️ AI 재분류: KPI 목록 변경 후 AI 태그만 재판정 (본인 확정은 보호). 팀 선택 시 그 팀만.
  async function runReclassify() {
    const teamName = reclassTeam ? (teams.find((t) => t.id === reclassTeam)?.name || '선택 팀') : '전체 팀';
    if (!confirm(`♻️ AI 재분류 — ${teamName}\n\nKPI 목록이 바뀐 뒤 사용하세요. AI가 배정한 태그를 현재 KPI 기준으로 다시 판정합니다.\n· 본인이 확정한 분류(USER)는 절대 건드리지 않습니다\n· ${reclassTeam ? '해당 팀' : '전체'} 일지 대상 (AI 비용 발생)\n\n시작할까요?`)) return;
    const cutoff = new Date().toISOString(); // 반복 수렴 기준(이후 갱신된 일지는 건너뜀)
    let totTagged = 0, totNone = 0;
    try {
      for (let i = 1; i <= 16; i++) {
        setWlMapping(`재분류 ${i}회차… (누적 ${totTagged}건)`);
        const r = await apiJson<{ scanned: number; tagged: number; none: number; remaining: number; aiErrors: string[] }>(
          `/api/activities/map-worklog-kpis`, { method: 'POST', body: JSON.stringify({ actorId: userId, limit: 200, reclassify: true, orgUnitId: reclassTeam || undefined, cutoff }) });
        totTagged += r.tagged; totNone += r.none;
        if (r.aiErrors?.length) { alert(`중단: ${r.aiErrors[0]}`); break; }
        if (r.remaining <= 0 || r.scanned === 0) break;
      }
      alert(`♻️ 재분류 완료 (${teamName})\nKPI 태깅: ${totTagged}건 · 해당없음: ${totNone}건`);
      await load();
    } catch (e: any) { alert(e?.message || '재분류 실패'); }
    finally { setWlMapping(null); }
  }

  const maxMin = Math.max(...(data?.goals || []).map((g) => g.minutes), 1);

  return (
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>💰 KPI 기여 분석</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '6px 8px' }} />
          <button type="button" className="btn btn-sm" disabled={mapping} onClick={() => void runMapping()}>
            {mapping ? '매칭 중…' : '🎯 목표-활동 매칭 실행'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!wlMapping} onClick={() => void runWorklogKpiMapping()}>
            {wlMapping || '🤖 일지→KPI 분류(AI)'}
          </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <select value={reclassTeam} onChange={(e) => setReclassTeam(e.target.value)} disabled={!!wlMapping} style={{ padding: '5px 6px', fontSize: 12 }}>
              <option value="">전체 팀</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!!wlMapping} onClick={() => void runReclassify()} title="KPI 목록 변경 후: AI 태그만 재판정 (본인 확정 보호)">
              ♻️ AI 재분류
            </button>
          </span>
          <Link to="/process/strategy-map" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>전략 정렬 지도 →</Link>
        </div>
      </div>

      {err && <div style={{ color: '#dc2626' }}>{err}</div>}
      {loading || !data ? <div style={{ color: '#94a3b8' }}>불러오는 중…</div> : (
        <>
          {/* 요약 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div style={card}>
              <div style={cardLabel}>전략 정렬률 (이번 달)</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: data.align.pct != null && data.align.pct >= 50 ? '#16a34a' : '#d97706' }}>
                {data.align.pct != null ? `${data.align.pct}%` : '-'}
              </div>
              <div style={cardSub}>전체 일지 {fmtH(data.align.totalMinutes)} 중 목표 연결 {fmtH(data.align.linkedMinutes)}</div>
            </div>
            <div style={card}>
              <div style={cardLabel}>KPI 실행 커버리지</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: '#0f3d73' }}>{data.coverage.withEvidence}<span style={{ fontSize: 16, color: '#94a3b8' }}> / {data.coverage.totalGoals}</span></div>
              <div style={cardSub}>이번 달 실행 증거(일지·실적)가 있는 KPI</div>
            </div>
            <div style={card}>
              <div style={cardLabel}>🎯 활동 매칭된 KPI</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: '#7c3aed' }}>{data.coverage.matchedGoals}<span style={{ fontSize: 16, color: '#94a3b8' }}> / {data.coverage.totalGoals}</span></div>
              <div style={cardSub}>낮으면 '🎯 매칭 실행'으로 연결률을 올리세요</div>
            </div>
          </div>

          {/* ① 목표별 기여 랭킹 */}
          <div style={panel}>
            <div style={panelTitle}>① 이번 달 KPI를 움직인 업무 (투입시간 랭킹)</div>
            {data.goals.filter((g) => g.minutes > 0 || g.value != null).length === 0 ? (
              <div style={emptyBox}>이번 달 KPI에 연결된 실행 기록이 없습니다. 🎯 매칭을 먼저 실행해 보세요.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {data.goals.filter((g) => g.minutes > 0 || g.value != null).map((g) => {
                  const pi = g.pillar ? PILLAR_INFO[g.pillar] : null;
                  return (
                    <div key={g.krId} style={{ border: '1px solid #f1f5f9', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        {pi && <span style={{ fontSize: 11, fontWeight: 700, color: pi.color, background: pi.bg, padding: '2px 8px', borderRadius: 20 }}>{pi.label}</span>}
                        <b>{g.title}</b>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{g.teamName}</span>
                        {g.activityName && <span style={{ fontSize: 12, color: '#7c3aed' }}>· 활동: {g.activityName}</span>}
                        <div style={{ flex: 1 }} />
                        <span style={{ fontSize: 13, color: '#475569' }}>
                          실적 <b style={{ color: '#0f172a' }}>{g.value != null ? g.value.toLocaleString() : '-'}</b>{g.unit ? ` ${g.unit}` : ''} / 목표 {g.target ?? '-'}
                          {g.ach != null && <b style={{ marginLeft: 6, color: achColor(g.ach) }}>{g.ach}%</b>}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 12, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round((g.minutes / maxMin) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#0f3d73,#2563eb)', borderRadius: 999 }} />
                        </div>
                        <span style={{ minWidth: 150, textAlign: 'right', fontSize: 13, color: '#334155' }}>
                          <b>{fmtH(g.minutes)}</b> · 일지 {g.logs} · {g.people}명
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ② 시간多·기여低 */}
          <div style={panel}>
            <div style={{ ...panelTitle, color: '#b45309' }}>② 시간은 많이 쓰는데 어떤 목표에도 연결 안 된 활동</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              KPI·중점과제 어디에도 연결되지 않은 활동의 이번 달 투입시간입니다. 정말 필요 없는 일인지, 목표 연결이 빠진 것인지 검토하세요.
            </div>
            {data.lowContribution.length === 0 ? (
              <div style={emptyBox}>없음 — 모든 실행 시간이 목표에 연결되어 있습니다.</div>
            ) : (
              <div style={{ display: 'grid', gap: 4 }}>
                {data.lowContribution.map((a, i) => (
                  <div key={a.activityId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 10px', borderRadius: 8, background: i < 3 ? '#fffbeb' : '#fff', border: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span style={{ minWidth: 20, color: '#94a3b8', fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{a.name}</span>
                    {a.domain && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 20 }}>{a.domain}</span>}
                    <span style={{ minWidth: 130, textAlign: 'right', color: '#b45309' }}><b>{fmtH(a.minutes)}</b> · 일지 {a.logs} · {a.people}명</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ③ 실행 증거 없는 KPI */}
          <div style={panel}>
            <div style={{ ...panelTitle, color: '#b91c1c' }}>③ 이번 달 실행 증거 없는 KPI ({data.noEvidence.length})</div>
            {data.noEvidence.length === 0 ? (
              <div style={emptyBox}>없음 — 모든 KPI에 실행 기록이 있습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.noEvidence.map((g) => {
                  const pi = g.pillar ? PILLAR_INFO[g.pillar] : null;
                  return (
                    <span key={g.krId} style={{ fontSize: 12, border: '1px solid #fecaca', background: '#fff7f7', color: '#991b1b', padding: '4px 10px', borderRadius: 20 }}>
                      {pi ? `[${pi.label}] ` : ''}{g.title}{g.teamName ? ` · ${g.teamName}` : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', padding: '14px 16px' };
const cardLabel: React.CSSProperties = { fontSize: 12, color: '#64748b', fontWeight: 700 };
const cardSub: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginTop: 2 };
const panel: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', padding: '14px 16px' };
const panelTitle: React.CSSProperties = { fontWeight: 800, marginBottom: 10 };
const emptyBox: React.CSSProperties = { color: '#94a3b8', padding: 14, textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: 10, fontSize: 13 };
