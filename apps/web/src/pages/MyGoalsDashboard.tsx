import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

// 내 업무 과제 — 개인 단위 정량(KPI 지표) / 정성(OKR 과제) / 중점 추진 과제 통합 뷰

type QuantItem = {
  krId: string;
  krTitle: string;
  objTitle: string;
  orgName: string;
  pillar: string | null;
  metric: string;
  unit: string;
  target: number;
  baseline: number | null;
  direction: 'AT_LEAST' | 'AT_MOST';
  cadence: string;
  latestValue: number | null;
  latestAt: string | null;
  achievementPct: number | null;
  status: 'OK' | 'WARN' | 'NONE';
  myLastInputAt: string | null;
};

type QualItem = {
  id: string;
  title: string;
  objTitle: string;
  krTitle: string;
  isKpi: boolean;
  state: 'PLANNED' | 'ACTIVE' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  dueAt: string | null;
  startAt: string | null;
  endAt: string | null;
  worklogCount: number;
  lastWorklogAt: string | null;
};

type KiItem = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  alignsTo: string | null;
  latestProgress: { content: string; pct: number | null; at: string } | null;
  warning: string | null;
};

type Summary = {
  quantCount: number; quantOk: number; quantWarn: number; quantNoData: number;
  qualActive: number; qualDone: number; kiOpen: number; kiDelayed: number;
};

const STATE_LABELS: Record<string, string> = { PLANNED: '계획', ACTIVE: '진행', BLOCKED: '차단', DONE: '완료', CANCELLED: '취소' };
const STATE_COLORS: Record<string, string> = { PLANNED: '#94a3b8', ACTIVE: '#3b82f6', BLOCKED: '#ef4444', DONE: '#22c55e', CANCELLED: '#64748b' };
const KI_LABELS: Record<string, string> = { NOT_STARTED: '미착수', IN_PROGRESS: '진행중', DELAYED: '지연', COMPLETED: '완료', CANCELLED: '취소' };
const KI_COLORS: Record<string, string> = { NOT_STARTED: '#94a3b8', IN_PROGRESS: '#3b82f6', DELAYED: '#ef4444', COMPLETED: '#22c55e', CANCELLED: '#64748b' };

function fmtDate(d?: string | null) {
  return d ? String(d).slice(0, 10) : '—';
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#fff', background: color }}>
      {text}
    </span>
  );
}

function AchieveBar({ pct, status }: { pct: number | null; status: 'OK' | 'WARN' | 'NONE' }) {
  if (pct == null) return <span style={{ color: '#94a3b8', fontSize: 12 }}>입력 없음</span>;
  const capped = Math.max(0, Math.min(120, pct));
  const color = status === 'OK' ? '#22c55e' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
      <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, capped)}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
    </div>
  );
}

export function MyGoalsDashboard() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [quant, setQuant] = useState<QuantItem[]>([]);
  const [qual, setQual] = useState<QualItem[]>([]);
  const [keyInits, setKeyInits] = useState<KiItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDoneQual, setShowDoneQual] = useState(false);
  const [showClosedKi, setShowClosedKi] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ quant: QuantItem[]; qual: QualItem[]; keyInits: KiItem[]; summary: Summary }>(
          `/api/goals-dashboard/my?userId=${encodeURIComponent(userId)}`,
        );
        setQuant(res.quant || []);
        setQual(res.qual || []);
        setKeyInits(res.keyInits || []);
        setSummary(res.summary || null);
      } catch (e: any) {
        setError(`${e?.message || '데이터를 불러오지 못했습니다'}${e?.status ? ` (HTTP ${e.status})` : ''}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  const th: React.CSSProperties = { borderBottom: '2px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '8px 10px', fontSize: 13, verticalAlign: 'top' };

  const qualVisible = qual.filter((q) => showDoneQual || (q.state !== 'DONE' && q.state !== 'CANCELLED'));
  const kiVisible = keyInits.filter((k) => showClosedKi || (k.status !== 'COMPLETED' && k.status !== 'CANCELLED'));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>내 업무 과제</h2>
        <Link to="/quick" className="btn" style={{ padding: '6px 14px', background: '#0F3D73', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          + 업무일지 작성
        </Link>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div style={{ padding: 14, background: '#EFF6FF', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 700 }}>📊 정량 목표 (KPI 지표)</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{summary.quantCount}<span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}> 개 지표</span></div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
              달성 <b style={{ color: '#16a34a' }}>{summary.quantOk}</b> · 미달 <b style={{ color: '#dc2626' }}>{summary.quantWarn}</b> · 미입력 <b style={{ color: '#94a3b8' }}>{summary.quantNoData}</b>
            </div>
          </div>
          <div style={{ padding: 14, background: '#F0FDF4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: '#166534', fontWeight: 700 }}>🎯 정성 목표 (OKR 과제)</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{summary.qualActive}<span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}> 개 진행</span></div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>완료 <b style={{ color: '#16a34a' }}>{summary.qualDone}</b></div>
          </div>
          <div style={{ padding: 14, background: '#FFFBEB', border: '1px solid #fde68a', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>🚩 중점 추진 과제</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{summary.kiOpen}<span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}> 개 진행</span></div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>지연 <b style={{ color: '#dc2626' }}>{summary.kiDelayed}</b></div>
          </div>
        </div>
      )}

      {/* 정량 목표 */}
      <section>
        <h3 style={{ margin: '4px 0 8px', fontSize: 15 }}>📊 정량 목표 — 내게 할당된 KPI 지표</h3>
        {quant.length === 0 ? (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8 }}>할당된 KPI 지표가 없습니다. 팀 KPI에서 담당자로 지정되면 여기에 표시됩니다.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>지표</th>
                  <th style={th}>목표</th>
                  <th style={th}>최신값</th>
                  <th style={th}>달성률</th>
                  <th style={th}>상태</th>
                  <th style={th}>내 마지막 입력</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {quant.map((q) => (
                  <tr key={q.krId} style={{ background: q.status === 'WARN' ? '#FEF2F2' : undefined }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{q.krTitle}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{q.orgName}{q.pillar ? ` · ${q.pillar}` : ''} · {q.objTitle}</div>
                    </td>
                    <td style={td}>{q.target}{q.unit ? ` ${q.unit}` : ''} <span style={{ fontSize: 11, color: '#94a3b8' }}>({q.direction === 'AT_MOST' ? '이하' : '이상'})</span></td>
                    <td style={{ ...td, fontWeight: 700 }}>{q.latestValue != null ? `${q.latestValue}${q.unit ? ` ${q.unit}` : ''}` : '—'}</td>
                    <td style={td}><AchieveBar pct={q.achievementPct} status={q.status} /></td>
                    <td style={td}>
                      {q.status === 'OK' && <Badge text="달성" color="#22c55e" />}
                      {q.status === 'WARN' && <Badge text="미달" color="#ef4444" />}
                      {q.status === 'NONE' && <Badge text="미입력" color="#94a3b8" />}
                    </td>
                    <td style={td}>{fmtDate(q.myLastInputAt)}</td>
                    <td style={td}><Link to="/quick" style={{ fontSize: 12, color: '#0F3D73', fontWeight: 600 }}>지표 입력 →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 정성 목표 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: '4px 0 8px', fontSize: 15 }}>🎯 정성 목표 — 내 OKR 과제</h3>
          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showDoneQual} onChange={(e) => setShowDoneQual(e.target.checked)} /> 완료 포함
          </label>
        </div>
        {qualVisible.length === 0 ? (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8 }}>진행 중인 OKR 과제가 없습니다.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>과제</th>
                  <th style={th}>소속 목표</th>
                  <th style={th}>상태</th>
                  <th style={th}>기간</th>
                  <th style={th}>일지</th>
                  <th style={th}>최근 일지</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {qualVisible.map((q) => (
                  <tr key={q.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{q.title}</td>
                    <td style={td}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{q.objTitle}</div>
                      {q.krTitle && <div style={{ fontSize: 11, color: '#94a3b8' }}>{q.isKpi ? 'KPI' : 'KR'}: {q.krTitle}</div>}
                    </td>
                    <td style={td}><Badge text={STATE_LABELS[q.state] || q.state} color={STATE_COLORS[q.state] || '#94a3b8'} /></td>
                    <td style={{ ...td, fontSize: 12 }}>{fmtDate(q.startAt)} ~ {fmtDate(q.endAt || q.dueAt)}</td>
                    <td style={td}>{q.worklogCount}건</td>
                    <td style={td}>{fmtDate(q.lastWorklogAt)}</td>
                    <td style={td}><Link to="/quick" style={{ fontSize: 12, color: '#0F3D73', fontWeight: 600 }}>일지 작성 →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 중점 추진 과제 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: '4px 0 8px', fontSize: 15 }}>🚩 중점 추진 과제 — 내 담당 과제</h3>
          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showClosedKi} onChange={(e) => setShowClosedKi(e.target.checked)} /> 완료 포함
          </label>
        </div>
        {kiVisible.length === 0 ? (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8 }}>
            담당 중인 중점 추진 과제가 없습니다. <Link to="/key-initiatives" style={{ color: '#0F3D73' }}>중점 추진 과제 보기</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {kiVisible.map((k) => (
              <div key={k.id} style={{ padding: 12, border: '1px solid #fde68a', background: '#FFFBEB', borderRadius: 10, display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge text={KI_LABELS[k.status] || k.status} color={KI_COLORS[k.status] || '#94a3b8'} />
                  <span style={{ fontWeight: 700 }}>{k.title}</span>
                  {k.latestProgress?.pct != null && <span style={{ fontSize: 12, color: '#3b82f6', fontWeight: 700 }}>{k.latestProgress.pct}%</span>}
                  {k.warning && <span style={{ fontSize: 12, color: k.warning.includes('초과') ? '#dc2626' : '#d97706', fontWeight: 600 }}>⚠ {k.warning}</span>}
                  {k.dueDate && <span style={{ fontSize: 12, color: '#64748b' }}>기한 {fmtDate(k.dueDate)}</span>}
                </div>
                {k.alignsTo && <div style={{ fontSize: 12, color: '#0F3D73' }}>🎯 OKR: {k.alignsTo}</div>}
                {k.latestProgress && (
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    최근 진행 ({fmtDate(k.latestProgress.at)}): {k.latestProgress.content.slice(0, 120)}{k.latestProgress.content.length > 120 ? '…' : ''}
                  </div>
                )}
                <div><Link to="/quick" style={{ fontSize: 12, color: '#0F3D73', fontWeight: 600 }}>일지로 진행 기록 →</Link></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
