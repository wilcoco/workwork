import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';

/** 암묵지 카드 한 장: 증상 → 확인 순서 → 조치. 편집·확인·보관은 권한 있을 때만 */
export type KCard = { id: string; title: string; symptom: string; checks: string[]; action: string; tags?: string[]; status: string; sourceType: string; sourceId?: string | null; sourceExcerpt?: string | null; confidence: number; useCount: number; ownerName?: string; teamName?: string; activityName?: string; confirmedByName?: string; createdAt: string; canEdit?: boolean };
const STATUS: Record<string, { t: string; c: string; bg: string }> = { DRAFT: { t: 'AI 추출 · 확인 필요', c: '#b45309', bg: '#fffbeb' }, CONFIRMED: { t: '확인됨', c: '#15803d', bg: '#f0fdf4' }, ARCHIVED: { t: '보관', c: '#94a3b8', bg: '#f8fafc' } };

export function KnowledgeCardView({ card, userId, compact, onChanged }: { card: KCard; userId: string; compact?: boolean; onChanged?: (c: KCard) => void }) {
  const [open, setOpen] = useState(!compact);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: card.title, symptom: card.symptom, checks: (card.checks || []).join('\n'), action: card.action, tags: (card.tags || []).join(', ') });
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState(false);
  useEffect(() => { setF({ title: card.title, symptom: card.symptom, checks: (card.checks || []).join('\n'), action: card.action, tags: (card.tags || []).join(', ') }); }, [card.id, card.title, card.symptom, card.action]);
  const st = STATUS[card.status] || STATUS.DRAFT;
  async function save(extra: Record<string, any> = {}) {
    setBusy(true);
    try { const r = await apiJson<KCard>(`/api/knowledge-cards/${card.id}`, { method: 'PUT', body: JSON.stringify({ userId, title: f.title, symptom: f.symptom, checks: f.checks.split('\n').map((x) => x.trim()).filter(Boolean), action: f.action, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean), ...extra }) }); setEdit(false); onChanged?.(r); toast(extra.confirm ? '확인했습니다 — 이제 프로세스·검색에 보입니다' : extra.archive ? '보관했습니다' : '저장했습니다', 'success'); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }
  async function useIt() { if (used) return; setUsed(true); try { await apiJson(`/api/knowledge-cards/${card.id}/use`, { method: 'POST', body: JSON.stringify({ userId }) }); } catch {} }
  return (
    <div style={{ border: `1px solid ${card.status === 'DRAFT' ? '#fcd34d' : '#e5e7eb'}`, borderRadius: 10, padding: compact ? 10 : 14, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: compact ? 'pointer' : 'default' }} onClick={() => compact && setOpen((v) => !v)}>
        <span style={{ fontSize: 14 }}>🧠</span>
        {edit ? <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 200 }} /> : <b style={{ fontSize: compact ? 13 : 14 }}>{card.title}</b>}
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: st.bg, color: st.c, fontWeight: 700 }}>{st.t}</span>
        {!compact && <span style={{ fontSize: 11, color: '#64748b' }}>{card.teamName}{card.ownerName ? ` · ${card.ownerName}` : ''}{card.activityName ? ` · 활동: ${card.activityName}` : ''}</span>}
        <span style={{ flex: 1 }} />
        {card.useCount > 0 && <span style={{ fontSize: 10, color: '#94a3b8' }}>도움 {card.useCount}</span>}
        {compact && <span style={{ fontSize: 11, color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>}
      </div>
      {open && (
        <div style={{ display: 'grid', gap: 8, marginTop: 8, fontSize: 13 }}>
          <div><div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700 }}>증상 · 상황</div>{edit ? <textarea rows={2} value={f.symptom} onChange={(e) => setF({ ...f, symptom: e.target.value })} style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{card.symptom}</div>}</div>
          <div><div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 700 }}>확인 순서</div>{edit ? <textarea rows={4} value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} placeholder="한 줄에 하나" style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }} /> : <ol style={{ margin: '2px 0 0 18px', padding: 0 }}>{(card.checks || []).map((c, i) => <li key={i}>{c}</li>)}</ol>}</div>
          <div><div style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>조치</div>{edit ? <textarea rows={3} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{card.action}</div>}</div>
          {edit ? <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="태그 (쉼표로)" style={{ fontSize: 12 }} /> : (card.tags || []).length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(card.tags || []).map((t) => <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}>#{t}</span>)}</div>}
          {!compact && card.sourceExcerpt && <div style={{ fontSize: 11, color: '#94a3b8', borderLeft: '2px solid #e2e8f0', paddingLeft: 8 }}>출처({card.sourceType === 'WORKLOG' ? '업무일지' : card.sourceType === 'MANUAL' ? '매뉴얼' : '직접 작성'}): {card.sourceExcerpt}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {card.status === 'CONFIRMED' && <button className="btn btn-sm btn-outline" disabled={used} onClick={() => void useIt()}>{used ? '👍 감사합니다' : '👍 도움이 됐어요'}</button>}
            {card.canEdit && !edit && <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setEdit(true)}>수정</button>}
            {card.canEdit && edit && <><button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void save()}>저장</button><button className="btn btn-sm btn-outline" onClick={() => setEdit(false)}>취소</button></>}
            {card.canEdit && card.status === 'DRAFT' && !edit && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void save({ confirm: true })}>✅ 맞습니다 (확인)</button>}
            {card.canEdit && card.status !== 'ARCHIVED' && !edit && <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void save({ archive: true })}>{card.status === 'DRAFT' ? '틀림 · 버리기' : '보관'}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** 프로세스 인스턴스·활동과 관련된 확인 카드 패널 */
export function RelatedKnowledgeCards({ userId, instanceId, activityId, q }: { userId: string; instanceId?: string; activityId?: string; q?: string }) {
  const [items, setItems] = useState<KCard[]>([]);
  useEffect(() => {
    if (!userId) return;
    const p = new URLSearchParams({ userId }); if (instanceId) p.set('instanceId', instanceId); if (activityId) p.set('activityId', activityId); if (q) p.set('q', q);
    apiJson<{ items: KCard[] }>(`/api/knowledge-cards/related?${p.toString()}`).then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, [userId, instanceId, activityId, q]);
  if (!items.length) return null;
  return (
    <div style={{ border: '1px solid #c7d2fe', background: '#eef2ff', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3730a3', marginBottom: 6 }}>🧠 이 일에 쓸 수 있는 현장 지식 {items.length}장 — 전에 같은 문제를 겪은 동료의 기록</div>
      <div style={{ display: 'grid', gap: 6 }}>{items.map((c) => <KnowledgeCardView key={c.id} card={c} userId={userId} compact />)}</div>
    </div>
  );
}
