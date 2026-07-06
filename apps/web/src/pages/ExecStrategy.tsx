import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

type Result = {
  groups: Array<{ theme: string; instructionIds: string[]; note?: string }>;
  contradictions: Array<{ aId: string; bId: string; note: string }>;
  orphans: string[];
  generatedBy?: 'ai' | 'heuristic';
};
type Synth = { id: string; result: Result; createdAt: string } | null;

// 누적 지시 교차 해석: 주제 그룹 / 모순 쌍 / 고아 지시. "없는 통일성은 지어내지 않음".
export function ExecStrategy() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [synth, setSynth] = useState<Synth>(null);
  const [running, setRunning] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  async function loadLatest() {
    try { setSynth(await apiJson<Synth>('/api/exec-instructions/strategy/latest')); } catch { setSynth(null); }
  }
  useEffect(() => {
    void loadLatest();
    apiJson<{ items: Array<{ id: string; summary: string }> }>('/api/exec-instructions?status=ALL')
      .then((r) => { const m: Record<string, string> = {}; (r.items || []).forEach((i) => (m[i.id] = i.summary)); setSummaries(m); })
      .catch(() => {});
  }, []);

  async function run() {
    setRunning(true);
    try { setSynth(await apiJson<Synth>('/api/exec-instructions/strategy/run', { method: 'POST', body: JSON.stringify({ actorId: userId }) })); }
    catch {} finally { setRunning(false); }
  }

  const r = synth?.result;
  const label = (iid: string) => summaries[iid] || iid;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: '4px 0', flex: 1 }}>전략 통일성</h2>
        <Link to="/exec-instructions" style={{ color: '#64748b', fontSize: 13, textDecoration: 'none' }}>지시 목록</Link>
        <button disabled={running} onClick={run} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{running ? '분석 중…' : '지금 분석'}</button>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>누적된 지시를 교차 해석해 주제 그룹·모순·고아 지시를 찾습니다. 새 지시 3건마다 자동 재분석됩니다.</p>

      {!r ? (
        <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>아직 분석 결과가 없습니다. "지금 분석"을 눌러 주세요.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {synth && new Date(synth.createdAt).toLocaleString('ko-KR')} · {r.generatedBy === 'heuristic' ? '규칙 기반(AI 미사용)' : 'AI 분석'}
          </div>

          <Section title={`주제 그룹 (${r.groups.length})`} color="#2563eb">
            {r.groups.length === 0 ? <Empty /> : r.groups.map((g, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{g.theme} {g.instructionIds.length >= 3 && <span style={{ fontSize: 11, background: '#fef9c3', color: '#a16207', padding: '2px 8px', borderRadius: 20, marginLeft: 6 }}>반복 감지</span>}</div>
                {g.note && <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{g.note}</div>}
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {g.instructionIds.map((iid) => <li key={iid} style={{ fontSize: 13 }}><Link to={`/exec-instructions/${iid}`} style={{ color: '#334155' }}>{label(iid)}</Link></li>)}
                </ul>
              </div>
            ))}
          </Section>

          <Section title={`모순 쌍 (${r.contradictions.length})`} color="#dc2626">
            {r.contradictions.length === 0 ? <Empty /> : r.contradictions.map((c, i) => (
              <div key={i} style={{ border: '1px solid #fecaca', background: '#fff7f7', borderRadius: 10, padding: 12, fontSize: 13 }}>
                <div style={{ color: '#b91c1c', fontWeight: 600 }}>{c.note}</div>
                <div style={{ marginTop: 4 }}>· <Link to={`/exec-instructions/${c.aId}`}>{label(c.aId)}</Link></div>
                <div>· <Link to={`/exec-instructions/${c.bId}`}>{label(c.bId)}</Link></div>
              </div>
            ))}
          </Section>

          <Section title={`고아 지시 (${r.orphans.length})`} color="#94a3b8">
            {r.orphans.length === 0 ? <Empty /> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {r.orphans.map((iid) => <li key={iid} style={{ fontSize: 13 }}><Link to={`/exec-instructions/${iid}`} style={{ color: '#334155' }}>{label(iid)}</Link></li>)}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 700, color, borderBottom: `2px solid ${color}22`, paddingBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}
function Empty() { return <div style={{ color: '#cbd5e1', fontSize: 13 }}>없음</div>; }
