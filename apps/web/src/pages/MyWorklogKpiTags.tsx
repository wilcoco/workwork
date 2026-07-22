import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/**
 * 내 일지 KPI 분류 — AI가 자동 배정한 일지↔KPI 태그를 본인이 검토·수정.
 * 칩 토글 = 즉시 저장(그 일지의 분류를 통째로 확정, USER가 정본).
 */

type Tag = { goalType: string; goalId: string; source: 'AI' | 'USER' };
type Item = { id: string; date: string; minutes: number; snippet: string; tags: Tag[] };
type Kpi = { id: string; title: string; unit: string };

function kstMonth(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
}

export function MyWorklogKpiTags() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [month, setMonth] = useState(kstMonth());
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyAi, setOnlyAi] = useState(false);

  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const r = await apiJson<{ kpis: Kpi[]; items: Item[] }>(`/api/worklogs/my-kpi-tags?userId=${encodeURIComponent(userId)}&month=${encodeURIComponent(month)}`);
      setKpis(r.kpis || []);
      setItems(r.items || []);
    } catch (e: any) { setErr(e?.message || '로드 실패'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month, userId]);

  const kpiTitle = (id: string) => kpis.find((k) => k.id === id)?.title || '(다른 팀 KPI)';

  // 칩 토글: 해당 일지의 KR 목록을 계산해 통째로 저장 (USER 확정)
  async function saveTags(it: Item, nextKrIds: string[]) {
    setSavingId(it.id);
    try {
      await apiJson(`/api/worklogs/${encodeURIComponent(it.id)}/kpi-tags`, {
        method: 'PUT',
        body: JSON.stringify({ userId, krIds: nextKrIds }),
      });
      setItems((prev) => prev.map((x) => x.id === it.id
        ? { ...x, tags: nextKrIds.length ? nextKrIds.map((kid) => ({ goalType: 'KR', goalId: kid, source: 'USER' as const })) : [{ goalType: 'NONE', goalId: '', source: 'USER' as const }] }
        : x));
    } catch (e: any) { alert(e?.message || '저장 실패'); }
    finally { setSavingId(null); }
  }

  function toggle(it: Item, krId: string) {
    const cur = it.tags.filter((t) => t.goalType === 'KR').map((t) => t.goalId);
    const next = cur.includes(krId) ? cur.filter((x) => x !== krId) : [...cur, krId];
    void saveTags(it, next);
  }

  const shown = onlyAi ? items.filter((it) => it.tags.some((t) => t.source === 'AI')) : items;
  const aiCount = items.filter((it) => it.tags.some((t) => t.source === 'AI')).length;
  const confirmedCount = items.filter((it) => it.tags.length > 0 && it.tags.every((t) => t.source === 'USER')).length;

  return (
    <div className="content" style={{ display: 'grid', gap: 14, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>🏷 내 일지 KPI 분류</h2>
        <label style={{ fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={onlyAi} onChange={(e) => setOnlyAi(e.target.checked)} /> AI 배정만 보기
        </label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '6px 8px' }} />
      </div>
      <div style={{ fontSize: 13, color: '#64748b' }}>
        AI가 자동 배정한 분류(<span style={aiBadge}>AI</span>)를 확인하고 틀리면 칩을 눌러 고치세요. 한 번이라도 수정하면 <span style={userBadge}>확정</span>되어 AI가 다시 건드리지 않습니다.
        {items.length > 0 && <span style={{ marginLeft: 8 }}>이번 달 {items.length}건 · AI 배정 {aiCount} · 본인 확정 {confirmedCount}</span>}
      </div>
      {err && <div style={{ color: '#dc2626' }}>{err}</div>}
      {kpis.length === 0 && !loading && (
        <div style={emptyBox}>소속 팀에 등록된 KPI가 없습니다. 팀장이 팀 KPI를 등록하면 분류할 수 있어요.</div>
      )}

      {loading ? <div style={{ color: '#94a3b8' }}>불러오는 중…</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {shown.map((it) => {
            const cur = it.tags.filter((t) => t.goalType === 'KR').map((t) => t.goalId);
            const isNone = it.tags.some((t) => t.goalType === 'NONE');
            const isUser = it.tags.length > 0 && it.tags.every((t) => t.source === 'USER');
            const hasAi = it.tags.some((t) => t.source === 'AI');
            return (
              <div key={it.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', background: '#fff', opacity: savingId === it.id ? 0.6 : 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
                  <b style={{ fontSize: 13 }}>{new Date(it.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</b>
                  {it.minutes > 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>{Math.round(it.minutes / 6) / 10}h</span>}
                  <span style={{ fontSize: 13, color: '#475569', flex: 1, minWidth: 200 }}>{it.snippet || '(내용 없음)'}</span>
                  {isUser && <span style={userBadge}>확정</span>}
                  {!isUser && hasAi && <span style={aiBadge}>AI</span>}
                  {it.tags.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>미분류</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {kpis.map((k) => {
                    const on = cur.includes(k.id);
                    return (
                      <button key={k.id} type="button" disabled={savingId === it.id} onClick={() => toggle(it, k.id)}
                        style={{
                          fontSize: 12, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                          border: on ? '1.5px solid #0f3d73' : '1px solid #cbd5e1',
                          background: on ? '#0f3d73' : '#fff', color: on ? '#fff' : '#475569', fontWeight: on ? 700 : 400,
                        }}>
                        {k.title}
                      </button>
                    );
                  })}
                  <button type="button" disabled={savingId === it.id} onClick={() => void saveTags(it, [])}
                    style={{
                      fontSize: 12, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                      border: isNone ? '1.5px solid #b45309' : '1px dashed #cbd5e1',
                      background: isNone ? '#fef3c7' : '#fff', color: isNone ? '#92400e' : '#94a3b8', fontWeight: isNone ? 700 : 400,
                    }}>
                    해당 없음
                  </button>
                </div>
              </div>
            );
          })}
          {!shown.length && <div style={emptyBox}>{onlyAi ? 'AI 배정된 일지가 없습니다.' : '이번 달 일지가 없습니다.'}</div>}
        </div>
      )}
    </div>
  );
}

const aiBadge: React.CSSProperties = { fontSize: 10, fontWeight: 700, background: '#ede9fe', color: '#6d28d9', borderRadius: 8, padding: '1px 7px' };
const userBadge: React.CSSProperties = { fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#15803d', borderRadius: 8, padding: '1px 7px' };
const emptyBox: React.CSSProperties = { color: '#94a3b8', padding: 16, textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: 10, fontSize: 13 };
