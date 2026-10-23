import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';

/**
 * 온톨로지 완성도 등급 · 운영 계기판 (임원)
 * "목표와 실행이 데이터로 맞물린 정도"를 결정론적 규칙으로 0~100점·등급 1~4로 보여준다.
 * 구독 등급 기준, 관리자 시험지 가동 조건(등급 3+), 투자자에게 보여줄 운영 수치의 근거.
 */
type Component = { key: string; label: string; weight: number; score: number; raw: Record<string, any>; hint: string };
type Data = {
  date: string; score: number; grade: number; gradeLabel: string; nextThreshold: number | null; gradeLabels: Record<string, string>;
  components: Component[]; teams: Array<{ orgUnitId: string; name: string; total: number; bound: number; fresh: number; linked: number }>;
  levers: Array<{ key: string; label: string; potential: number; score: number; weight: number; hint: string }>;
  history: Array<{ date: string; score: number; grade: number }>;
};

const GRADE_COLOR: Record<number, string> = { 1: '#b91c1c', 2: '#b45309', 3: '#0369a1', 4: '#15803d' };
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff' };

function rawText(c: Component): string {
  const r = c.raw || {};
  switch (c.key) {
    case 'kpiBound': return `${r.bound} / ${r.total} KPI`;
    case 'kpiFresh': return `${r.fresh} / ${r.total} KPI (${r.month})`;
    case 'kpiLinked': return `${r.linked} / ${r.total} KPI`;
    case 'manualReady': return `${r.ready} / ${r.total} 매뉴얼`;
    case 'processed': return `${r.processed} / ${r.total} 매뉴얼`;
    case 'logCoverage': return `${r.tagged} / ${r.total} 일지 (${r.days}일)`;
    case 'logWriters': return `${r.writers} / ${r.active} 명 (${r.days}일)`;
    case 'approvalLead': return r.avgHours != null ? `평균 ${r.avgHours}시간 · ${r.count}건` : '완료 건 없음';
    default: return JSON.stringify(r);
  }
}

export function CompanyMaturity() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setD(await apiJson<Data>(`/api/ops-metrics/maturity?userId=${encodeURIComponent(userId)}`)); setErr(null); }
    catch (e: any) { setErr(e?.message || '불러오기 실패'); }
  }
  useEffect(() => { if (userId) void load(); /* eslint-disable-next-line */ }, [userId]);

  async function snapshot() {
    setBusy(true);
    try { await apiJson(`/api/ops-metrics/snapshot`, { method: 'POST', body: JSON.stringify({ userId }) }); toast('오늘 스냅샷을 기록했습니다', 'success'); await load(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }

  if (err) return <div style={{ padding: 24, color: '#b91c1c' }}>{err}</div>;
  if (!d) return <div style={{ padding: 24, color: '#94a3b8' }}>계산 중…</div>;
  const color = GRADE_COLOR[d.grade] || '#334155';
  const hist = d.history || [];
  const W = 420, H = 90;
  const path = hist.length > 1 ? hist.map((h, i) => `${i === 0 ? 'M' : 'L'}${(i / (hist.length - 1)) * W},${H - (h.score / 100) * H}`).join(' ') : '';

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>온톨로지 완성도 · 운영 계기판</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          대표의 목표와 현장의 실행이 <b>데이터로 맞물린 정도</b>를 같은 규칙으로 매일 측정합니다. AI 판단은 없고, 같은 데이터면 항상 같은 점수입니다. 등급 3(데이터 기반)부터 관리자 시험지를 켤 수 있습니다.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, alignItems: 'stretch' }}>
        <div style={{ ...card, textAlign: 'center', display: 'grid', alignContent: 'center', gap: 4 }}>
          <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '.06em' }}>완성도 점수 · {d.date}</div>
          <div style={{ fontSize: 48, fontWeight: 800, color, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{d.score}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color }}>등급 {d.grade} · {d.gradeLabel}</div>
          {d.nextThreshold != null && <div style={{ fontSize: 11, color: '#64748b' }}>등급 {d.grade + 1}까지 {Math.round((d.nextThreshold - d.score) * 10) / 10}점</div>}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 6, fontSize: 10, color: '#94a3b8' }}>
            {[1, 2, 3, 4].map((g) => <span key={g} style={{ padding: '1px 6px', borderRadius: 999, border: `1px solid ${g <= d.grade ? color : '#e5e7eb'}`, color: g <= d.grade ? color : '#94a3b8' }}>{g} {d.gradeLabels[String(g)]}</span>)}
          </div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 13 }}>90일 추세</b><span style={{ fontSize: 11, color: '#94a3b8' }}>매일 03:00 스냅샷 · {hist.length}일 기록</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void snapshot()}>오늘 기록</button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <svg viewBox={`-6 -6 ${W + 12} ${H + 24}`} width="100%" height={H + 30} style={{ display: 'block', maxWidth: 720 }}>
              {[40, 60, 80].map((t) => <line key={t} x1={0} x2={W} y1={H - (t / 100) * H} y2={H - (t / 100) * H} stroke="#e5e7eb" strokeDasharray="3 3" />)}
              {[40, 60, 80].map((t) => <text key={t} x={W + 2} y={H - (t / 100) * H + 3} fontSize={8} fill="#94a3b8">{t}</text>)}
              {path && <path d={path} fill="none" stroke={color} strokeWidth={2} />}
              {hist.map((h, i) => <circle key={h.date} cx={hist.length > 1 ? (i / (hist.length - 1)) * W : W / 2} cy={H - (h.score / 100) * H} r={2.5} fill={GRADE_COLOR[h.grade] || color} />)}
              {hist.length === 0 && <text x={W / 2} y={H / 2} fontSize={11} fill="#94a3b8" textAnchor="middle">아직 스냅샷이 없습니다 — 오늘 03:00 이후 자동 기록되거나 "오늘 기록"을 누르세요</text>}
              {hist.length > 0 && <text x={0} y={H + 14} fontSize={9} fill="#94a3b8">{hist[0].date}</text>}
              {hist.length > 1 && <text x={W} y={H + 14} fontSize={9} fill="#94a3b8" textAnchor="end">{hist[hist.length - 1].date}</text>}
            </svg>
          </div>
        </div>
      </div>

      <div style={card}>
        <b style={{ fontSize: 13 }}>구성 요소</b>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {d.components.map((c) => (
            <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 120px 60px', gap: 10, alignItems: 'center', fontSize: 13 }} title={c.hint}>
              <div><b>{c.label}</b><div style={{ fontSize: 10, color: '#94a3b8' }}>가중치 {c.weight}</div></div>
              <div style={{ height: 12, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${c.score}%`, height: '100%', background: c.score >= 80 ? '#22c55e' : c.score >= 50 ? '#f59e0b' : '#ef4444' }} /></div>
              <div style={{ fontSize: 12, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{rawText(c)}</div>
              <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.score}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>항목에 마우스를 올리면 정의가 보입니다. 점수 = Σ(구성 점수 × 가중치) / 100.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
        <div style={card}>
          <b style={{ fontSize: 13 }}>다음 등급을 위해 효과가 큰 조치</b>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {d.levers.map((l, i) => (
              <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                <span style={{ fontWeight: 800, color: '#0F3D73' }}>{i + 1}</span>
                <div style={{ flex: 1 }}><b>{l.label}</b> <span style={{ color: '#64748b' }}>현재 {l.score}점 · 가중치 {l.weight}</span><div style={{ fontSize: 12, color: '#475569' }}>{l.hint}</div></div>
                <span style={{ fontSize: 12, color: '#15803d', whiteSpace: 'nowrap' }}>최대 +{l.potential}점</span>
              </div>
            ))}
          </div>
        </div>
        <div style={card}>
          <b style={{ fontSize: 13 }}>팀별 KPI 연결 현황</b>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: '#64748b', background: '#f8fafc' }}><th style={{ textAlign: 'left', padding: 6 }}>팀</th><th style={{ padding: 6 }}>KPI</th><th style={{ padding: 6 }}>데이터 연결</th><th style={{ padding: 6 }}>최신 실적</th><th style={{ padding: 6 }}>담당·활동</th></tr></thead>
              <tbody>
                {d.teams.map((t) => (
                  <tr key={t.orgUnitId} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6, fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{t.total}</td>
                    <td style={{ padding: 6, textAlign: 'center', color: t.bound ? '#15803d' : '#94a3b8' }}>{t.bound}</td>
                    <td style={{ padding: 6, textAlign: 'center', color: t.fresh === t.total ? '#15803d' : t.fresh ? '#b45309' : '#b91c1c' }}>{t.fresh}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{t.linked}</td>
                  </tr>
                ))}
                {!d.teams.length && <tr><td colSpan={5} style={{ padding: 10, color: '#94a3b8', textAlign: 'center' }}>활성 팀 KPI가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
