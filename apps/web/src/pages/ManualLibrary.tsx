import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';
import { ManualDocument } from '../components/ManualDocument';
import { ManualRelated } from '../components/ManualRelated';

/**
 * 전사 매뉴얼 열람(서재) — 누구나 다른 사람이 쓴 매뉴얼을 그림·양식이 적용된 모습 그대로 본다.
 * 프로세스화 전에 "사람 눈에 좋게 보이는" 단계: 그림 없는 매뉴얼은 배지로 드러나고, 본인 것은 바로 수정으로 이어진다.
 */
type LibItem = {
  id: string; userId: string; title: string; status: string;
  readinessScore: number | null; version: number; updatedAt: string;
  authorName: string; teamName: string; department: string;
  imageCount: number; hasRich: boolean; attachmentCount: number; snippet: string;
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DRAFT: { label: '초안', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  REVIEW: { label: '승인 대기', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  APPROVED: { label: '승인됨', color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
  REJECTED: { label: '반려', color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
};

export function ManualLibrary() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [noImageOnly, setNoImageOnly] = useState(false);
  const [open, setOpen] = useState<LibItem | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // 말로 수정하기 (본인 매뉴얼): 자연어 지시 → AI 수정 미리보기 → 적용(새 버전 저장)
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState<string | null>(null);
  const [nlPreview, setNlPreview] = useState<null | { draft: string; changes: string[]; before: number; after: number }>(null);

  async function nlEditRun() {
    if (!open || !nlText.trim()) return;
    setNlBusy('AI가 매뉴얼을 고치는 중… (10~30초)');
    try {
      const r = await apiJson<{ draft: string; changes: string[]; before: number; after: number }>(
        `/api/work-manuals/${encodeURIComponent(open.id)}/ai/nl-edit`,
        { method: 'POST', body: JSON.stringify({ userId, instruction: nlText.trim() }) },
      );
      setNlPreview(r);
    } catch (e: any) { toast(e?.message || '수정 실패 — 다시 시도해 주세요', 'error'); }
    finally { setNlBusy(null); }
  }

  async function nlEditApply() {
    if (!open || !nlPreview?.draft) return;
    setNlBusy('저장 중…');
    try {
      const r = await apiJson<any>(`/api/work-manuals/${encodeURIComponent(open.id)}/ai/coach/apply`,
        { method: 'POST', body: JSON.stringify({ userId, draft: nlPreview.draft }) });
      toast(`적용되었습니다 (v${r.version}) — 준비도 ${r?.readiness?.score ?? ''}점`, 'success');
      setNlPreview(null); setNlText('');
      // 본문·목록 갱신
      const m = await apiJson<any>(`/api/work-manuals/library/${encodeURIComponent(open.id)}?userId=${encodeURIComponent(userId)}`);
      setDetail(m);
      apiJson<{ items: LibItem[] }>(`/api/work-manuals/library?userId=${encodeURIComponent(userId)}`).then((rr) => setItems(rr.items || [])).catch(() => {});
    } catch (e: any) { toast(e?.message || '적용 실패', 'error'); }
    finally { setNlBusy(null); }
  }

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    apiJson<{ items: LibItem[] }>(`/api/work-manuals/library?userId=${encodeURIComponent(userId)}`)
      .then((r) => setItems(r.items || []))
      .catch((e: any) => toast(e?.message || '매뉴얼을 불러오지 못했습니다', 'error'))
      .finally(() => setLoading(false));
  }, [userId]);

  async function openDetail(it: LibItem) {
    setOpen(it); setDetail(null); setDetailLoading(true);
    setNlText(''); setNlPreview(null);
    try {
      const m = await apiJson<any>(`/api/work-manuals/library/${encodeURIComponent(it.id)}?userId=${encodeURIComponent(userId)}`);
      setDetail(m);
    } catch (e: any) { toast(e?.message || '본문을 불러오지 못했습니다', 'error'); setOpen(null); }
    finally { setDetailLoading(false); }
  }

  const teams = useMemo(() => Array.from(new Set(items.map((i) => i.teamName).filter(Boolean))).sort(), [items]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      if (team && i.teamName !== team) return false;
      if (status && i.status !== status) return false;
      if (noImageOnly && i.imageCount > 0) return false;
      if (term && !`${i.title} ${i.authorName} ${i.teamName} ${i.snippet}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, q, team, status, noImageOnly]);

  const withImg = items.filter((i) => i.imageCount > 0).length;

  if (!userId) return <div style={{ padding: 24, color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>업무 매뉴얼 열람 (전사)</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          전 구성원이 입력한 매뉴얼을 그림·양식이 적용된 모습 그대로 봅니다. <b>📷 그림 없음</b> 표시가 있는 매뉴얼은 화면 캡처·사진을 보태 주세요(본인 것은 바로 수정 가능).
        </div>
      </div>

      {/* 요약 + 필터 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#334155', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 999, padding: '3px 10px' }}>전체 {items.length}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 999, padding: '3px 10px' }}>📷 그림 포함 {withImg}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 999, padding: '3px 10px' }}>그림 없음 {items.length - withImg}</span>
        <span style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업무명·작성자·팀 검색" style={{ minWidth: 200 }} />
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">팀 전체</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">상태 전체</option>
          <option value="APPROVED">승인됨</option>
          <option value="REVIEW">승인 대기</option>
          <option value="DRAFT">초안</option>
          <option value="REJECTED">반려</option>
        </select>
        <label style={{ fontSize: 12, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={noImageOnly} onChange={(e) => setNoImageOnly(e.target.checked)} /> 그림 없는 것만
        </label>
      </div>

      {/* 목록 */}
      <div style={{ display: 'grid', gap: 8 }}>
        {loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>불러오는 중…</div>}
        {filtered.map((it) => {
          const st = STATUS_LABEL[String(it.status || 'DRAFT')] || STATUS_LABEL.DRAFT;
          const mine = it.userId === userId;
          return (
            <div key={it.id} onClick={() => void openDetail(it)}
              style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 5, cursor: 'pointer', background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, flex: 1, minWidth: 180 }}>
                  {it.title}
                  {it.attachmentCount > 0 && <span style={{ marginLeft: 6, fontSize: 12, color: '#0F3D73' }}>📎{it.attachmentCount}</span>}
                </span>
                {it.imageCount > 0 ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 999, padding: '2px 8px' }}>📷 그림 {it.imageCount}장</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 999, padding: '2px 8px' }}>📷 그림 없음</span>
                )}
                <span style={{ fontSize: 11, color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 999, padding: '2px 8px' }}>{st.label}</span>
                {mine && (
                  <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); nav(`/manuals/mine?edit=${encodeURIComponent(it.id)}`); }}
                    title="내 매뉴얼 입력 화면에서 바로 수정합니다">✏️ 수정</button>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {it.authorName || '(작성자 미상)'}{it.teamName ? ` · ${it.teamName}` : ''} · v{it.version} · {new Date(it.updatedAt).toLocaleDateString()}
                {it.snippet ? <span style={{ color: '#94a3b8' }}> — {it.snippet}</span> : null}
              </div>
            </div>
          );
        })}
        {!loading && !filtered.length && <div style={{ fontSize: 13, color: '#94a3b8' }}>조건에 맞는 매뉴얼이 없습니다.</div>}
      </div>

      {/* 상세 모달 — 그림·양식 적용된 원문 그대로 */}
      {open && (
        <div onClick={() => { setOpen(null); setDetail(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, maxWidth: 860, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 18, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 15, flex: 1 }}>📖 매뉴얼 열람</b>
              {open.userId === userId && (
                <button className="btn btn-sm btn-primary" onClick={() => nav(`/manuals/mine?edit=${encodeURIComponent(open.id)}`)}>✏️ 수정하기</button>
              )}
              <button className="btn btn-sm btn-outline" onClick={() => { setOpen(null); setDetail(null); }}>닫기</button>
            </div>
            {open.imageCount === 0 && (
              <div style={{ fontSize: 12.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '7px 10px' }}>
                📷 이 매뉴얼에는 그림이 없습니다. 화면 캡처나 현장 사진이 있으면 처음 보는 사람도 따라 하기 쉬워집니다.
                {open.userId === userId ? <b> 「✏️ 수정하기」에서 본문에 바로 붙여 넣거나(Ctrl+V), 「🤖 AI 검토」 질문에 이미지를 올려 주세요.</b> : ` 작성자(${open.authorName || '미상'})에게 전달해 주세요.`}
              </div>
            )}
            {/* 말로 수정하기 — 본인 매뉴얼만 */}
            {open.userId === userId && (
              <div style={{ border: '1px solid #ddd6fe', background: '#faf5ff', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
                <b style={{ fontSize: 13, color: '#6d28d9' }}>🗣 말로 수정하기</b>
                <div style={{ fontSize: 12, color: '#7c3aed' }}>예: “팀장 결재 단계를 추가해줘” · “발주 담당을 구매팀으로 바꿔” · “기한을 전부 3일로” — 지시한 부분만 고치고 나머지는 그대로 둡니다.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={nlText} onChange={(e) => setNlText(e.target.value)} disabled={!!nlBusy}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void nlEditRun(); }}
                    placeholder="매뉴얼을 어떻게 고칠지 평소 말하듯 적고 Enter" style={{ flex: 1 }} />
                  <button className="btn btn-primary" disabled={!!nlBusy || !nlText.trim()} onClick={() => void nlEditRun()}>
                    {nlBusy || '미리보기'}
                  </button>
                </div>
                {nlPreview && (
                  <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#166534' }}>
                      수정 미리보기 — 준비도 {nlPreview.before} → <b>{nlPreview.after}</b>점
                    </div>
                    {nlPreview.changes.map((c, i) => <div key={i} style={{ fontSize: 12, color: '#166534' }}>✓ {c}</div>)}
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, margin: 0, maxHeight: 220, overflow: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, fontFamily: 'inherit' }}>{nlPreview.draft}</pre>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-outline" disabled={!!nlBusy} onClick={() => setNlPreview(null)}>취소</button>
                      <button className="btn btn-sm btn-primary" disabled={!!nlBusy} onClick={() => void nlEditApply()}>이대로 적용 (새 버전 저장)</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <ManualRelated manualId={open.id} userId={userId}
              onOpenManual={(m) => {
                const it = items.find((x) => x.id === m.id);
                if (it) { void openDetail(it); return; }
                void openDetail({ id: m.id, userId: m.userId, title: m.title, status: '', readinessScore: null, version: 1, updatedAt: '', authorName: '', teamName: '', department: '', imageCount: 1, hasRich: false, attachmentCount: 0, snippet: '' } as LibItem);
              }} />
            {detailLoading && <div style={{ fontSize: 13, color: '#94a3b8' }}>본문 불러오는 중…</div>}
            {detail && <ManualDocument manual={detail} />}
          </div>
        </div>
      )}
    </div>
  );
}
