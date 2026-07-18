import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/**
 * 회사 활동 지도 (온톨로지 대시보드)
 * 회사가 수행하는 활동 전체를 한 화면에서 조망: 어디서 쓰이고(프로세스),
 * 얼마나 실행되고(일지), 지식이 어디에 쌓였고(🏅), 어디가 비어 있는가(리스크).
 */
type Item = { id: string; name: string; taskType?: string | null; roleHint?: string | null; aliasCount: number; templateUse: number; worklogCount: number; knowledgeCount: number; lastRunAt?: string | null };
type Overview = {
  totals: { activities: number; withKnowledge: number; executedActivities: number; totalKnowledge: number; byType: Record<string, number> };
  items: Item[]; risky: Item[]; rich: Item[];
};
type Knowledge = { activity: { id: string; name: string; taskType?: string; criteria?: string; roleHint?: string; aliases?: string[] }; knowledge: Array<{ id: string; title: string; excerpt: string; badgeNote: string; authorName: string; date: string }> };

const TYPE_KO: Record<string, string> = { WORKLOG: '업무', APPROVAL: '결재', COOPERATION: '협조' };

export function ActivityMap() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [sel, setSel] = useState<Knowledge | null>(null);

  useEffect(() => {
    apiJson<Overview>('/api/activities/dashboard/overview')
      .then(setData)
      .catch((e) => setError(e?.message || '조회 실패'));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter((it) => (!q.trim() || it.name.includes(q.trim())) && (!typeF || it.taskType === typeF))
      .sort((a, b) => (b.knowledgeCount - a.knowledgeCount) || (b.worklogCount - a.worklogCount) || (b.templateUse - a.templateUse));
  }, [data, q, typeF]);

  async function openKnowledge(id: string) {
    try { setSel(await apiJson<Knowledge>(`/api/activities/${encodeURIComponent(id)}/knowledge`)); } catch {}
  }

  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;
  if (!data) return <div style={{ padding: 24, color: '#94a3b8' }}>회사 활동 지도를 불러오는 중…</div>;

  const t = data.totals;
  const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 16px' };
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13 };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>🗺 회사 활동 지도</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          프로세스 템플릿을 만들 때마다 회사의 <b>활동 사전</b>이 자동으로 자랍니다. 각 활동에 실행 기록(일지)과 인증 지식(🏅)이 쌓입니다.
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: '등록된 활동', value: `${t.activities}개`, sub: `업무 ${t.byType.WORKLOG} · 결재 ${t.byType.APPROVAL} · 협조 ${t.byType.COOPERATION}` },
          { label: '실행된 활동', value: `${t.executedActivities}개`, sub: '일지가 1건 이상 연결됨' },
          { label: '지식 보유 활동', value: `${t.withKnowledge}개`, sub: `전체의 ${t.activities ? Math.round((t.withKnowledge / t.activities) * 100) : 0}%` },
          { label: '축적 지식(🏅)', value: `${t.totalKnowledge}건`, sub: 'AI 인증 통과 기록' },
        ].map((c) => (
          <div key={c.label} style={card}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{c.value}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 인사이트: 지식 공백 리스크 / 지식 자산 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
        <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#991b1b', marginBottom: 6 }}>⚠ 지식 공백 — 자주 하는데 정리된 지식이 없는 활동</div>
          {data.risky.length === 0 ? <div style={{ fontSize: 12, color: '#b91c1c' }}>해당 없음</div> : data.risky.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: '#7f1d1d' }}>· {r.name} <span style={{ color: '#b91c1c' }}>(일지 {r.worklogCount}건, 지식 0)</span></div>
          ))}
        </div>
        <div style={{ ...card, borderColor: '#fcd34d', background: '#fffbeb' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#92400e', marginBottom: 6 }}>🏅 지식 자산 — 인증 지식이 밀집된 활동</div>
          {data.rich.length === 0 ? <div style={{ fontSize: 12, color: '#b45309' }}>아직 없음 — 일지 지식인증이 쌓이면 여기 나타납니다</div> : data.rich.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: '#78350f', cursor: 'pointer' }} onClick={() => void openKnowledge(r.id)}>· {r.name} <b>🏅{r.knowledgeCount}</b></div>
          ))}
        </div>
      </div>

      {/* 활동 목록 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="활동 검색" style={{ padding: '5px 10px', fontSize: 13 }} />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} style={{ padding: '5px 8px', fontSize: 13 }}>
          <option value="">전체 유형</option>
          <option value="WORKLOG">업무</option>
          <option value="APPROVAL">결재</option>
          <option value="COOPERATION">협조</option>
        </select>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length}개 · 활동을 클릭하면 축적 지식을 봅니다</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>활동</th><th style={th}>유형</th><th style={th}>담당 힌트</th>
              <th style={{ ...th, textAlign: 'right' }}>프로세스 사용</th>
              <th style={{ ...th, textAlign: 'right' }}>실행(일지)</th>
              <th style={{ ...th, textAlign: 'right' }}>지식 🏅</th>
              <th style={th}>최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <tr key={it.id} onClick={() => void openKnowledge(it.id)} style={{ cursor: 'pointer', background: it.knowledgeCount > 0 ? '#fffdf5' : undefined }}>
                <td style={{ ...td, fontWeight: 600 }}>{it.name}{it.aliasCount > 0 && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>+별칭{it.aliasCount}</span>}</td>
                <td style={td}>{TYPE_KO[String(it.taskType)] || it.taskType || '—'}</td>
                <td style={{ ...td, color: '#64748b', fontSize: 12 }}>{it.roleHint || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{it.templateUse}</td>
                <td style={{ ...td, textAlign: 'right' }}>{it.worklogCount}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: it.knowledgeCount ? 800 : 400, color: it.knowledgeCount ? '#b45309' : '#94a3b8' }}>{it.knowledgeCount || '—'}</td>
                <td style={{ ...td, fontSize: 12, color: '#94a3b8' }}>{it.lastRunAt ? new Date(it.lastRunAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>아직 등록된 활동이 없습니다. 프로세스 템플릿을 저장하면 활동이 자동 등록됩니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 활동 지식 모달 */}
      {sel && (
        <div onClick={() => setSel(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 680, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 16, flex: 1 }}>{sel.activity.name}</b>
              <span style={{ fontSize: 12, color: '#64748b' }}>{TYPE_KO[String(sel.activity.taskType)] || ''}</span>
              <button className="btn btn-sm" onClick={() => setSel(null)}>닫기</button>
            </div>
            {sel.activity.roleHint && <div style={{ fontSize: 12, color: '#64748b' }}>담당: {sel.activity.roleHint}</div>}
            {sel.activity.criteria && <div style={{ fontSize: 12, color: '#0f766e' }}>판단기준: {sel.activity.criteria}</div>}
            {Array.isArray(sel.activity.aliases) && sel.activity.aliases.length > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8' }}>별칭: {sel.activity.aliases.join(', ')}</div>
            )}
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>🏅 축적 지식 {sel.knowledge.length}건</div>
            {sel.knowledge.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>이 활동으로 실행한 일지가 지식 인증을 받으면 여기 쌓입니다.</div>}
            {sel.knowledge.map((k) => (
              <div key={k.id} style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{k.title} <span style={{ fontWeight: 400, fontSize: 11, color: '#92400e' }}>— {k.authorName} · {new Date(k.date).toLocaleDateString()}</span></div>
                {k.excerpt && <div style={{ fontSize: 12, color: '#78350f', marginTop: 2 }}>{k.excerpt}</div>}
                {k.badgeNote && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>“{k.badgeNote}”</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
