import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';
import { OneDriveFilePicker } from '../components/OneDriveFilePicker';
import { RichTextEditor } from '../components/RichTextEditor';
import { htmlToPlainText, plainTextToHtml } from '../lib/richText';

/**
 * 내 업무 매뉴얼 — 전 구성원이 자기 업무를 자연어 매뉴얼로 입력하고,
 * 곧장 "프로세스 만들기"로 이어지는 진입점.
 * 본문은 리치 에디터(그림 포함, contentHtml)로 쓰고, 파서·AI용 텍스트 사본(content)을 같이 저장한다.
 * 저장한 매뉴얼은 팀장 승인(결재함 연동)을 받을 수 있다.
 */
type Attach = { url: string; name: string };
type Approval = { id: string; status: string; approverId: string; approverName: string; createdAt: string; anyActed: boolean };
type Manual = {
  id: string; title: string; content?: string; contentHtml?: string | null; status: string; qualityScore?: number;
  attachments?: Attach[] | null; approval?: Approval | null; reviewerName?: string; reviewComment?: string | null; reviewedAt?: string | null;
  createdAt: string; updatedAt: string;
};

const STD_TEMPLATE = [
  '### STEP S1 | (단계 이름)',
  '- taskType: WORKLOG   ← WORKLOG(업무일지) | APPROVAL(결재) | COOPERATION(타팀 요청)',
  '- 담당: (팀 또는 담당자)',
  '- 방법: (무엇을 어떻게 하는지)',
  '- 완료조건: (무엇이 되어 있어야 완료인지)',
  '- 기한: 시작 후 N일 이내',
  '',
  '### STEP S2 | (결재 단계라면)',
  '- taskType: APPROVAL',
  '- 결재선: (예: 팀장 → 공장장)',
  '- 반려 시: (예: S1로 돌아가 다시 작성)',
].join('\n');

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DRAFT: { label: '초안', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  REVIEW: { label: '승인 대기', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  APPROVED: { label: '승인됨', color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
  REJECTED: { label: '반려', color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
};

export function MyManuals() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<Manual[]>([]);
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0); // 에디터 내용 강제 재적용 카운터
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // 수정 중인 매뉴얼 id (null=새 작성)
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null); // 승인 요청/취소 처리 중인 매뉴얼
  // 가이드라인 점검 모달: 저장 직후 빠진 항목을 대화로 보완
  const [check, setCheck] = useState<null | { manualId: string; thenProcess: boolean; phase: 'loading' | 'ask'; checklist: Array<{ key: string; ok: boolean; note: string }>; questions: Array<{ id: number; category: string; question: string }> }>(null);
  const [checkAnswers, setCheckAnswers] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);

  const CAT_LABEL: Record<string, string> = { cycle: '주기·소요시간', action: '실행 방법', resources: '자원·연락처', visuals: '경로·산출물', exceptions: '예외 대응' };

  async function runGuidelineCheck(manualId: string, thenProcess: boolean) {
    setCheck({ manualId, thenProcess, phase: 'loading', checklist: [], questions: [] });
    setCheckAnswers({});
    try {
      const r = await apiJson<{ checklist: any[]; questions: any[] }>(`/api/work-manuals/${encodeURIComponent(manualId)}/ai/guideline-check`, {
        method: 'POST', body: JSON.stringify({ userId }),
      });
      if (!r.questions?.length) {
        setCheck(null);
        toast('가이드라인 점검 통과 — 빠진 항목이 없습니다. 👏', 'success');
        finishCheck(manualId, thenProcess);
        return;
      }
      setCheck({ manualId, thenProcess, phase: 'ask', checklist: r.checklist || [], questions: r.questions });
    } catch {
      // AI 실패 시 조용히 통과 (저장은 이미 완료됨)
      setCheck(null);
      finishCheck(manualId, thenProcess);
    }
  }

  function finishCheck(manualId: string, thenProcess: boolean) {
    if (thenProcess) nav(`/process/from-manual?manualId=${encodeURIComponent(manualId)}`);
    else void load();
  }

  async function applyCheckAnswers() {
    if (!check) return;
    const qa = check.questions.map((q) => ({ category: q.category, q: q.question, a: (checkAnswers[q.id] || '').trim() })).filter((x) => x.a);
    setApplying(true);
    try {
      if (qa.length) {
        await apiJson(`/api/work-manuals/${encodeURIComponent(check.manualId)}/ai/guideline-apply`, {
          method: 'POST', body: JSON.stringify({ userId, qa }),
        });
        toast(`답변 ${qa.length}건이 매뉴얼에 추가되었습니다.`, 'success');
      }
      const { manualId, thenProcess } = check;
      setCheck(null);
      finishCheck(manualId, thenProcess);
    } catch (e: any) {
      toast(e?.message || '반영 실패', 'error');
    } finally { setApplying(false); }
  }

  async function load() {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await apiJson<{ items: Manual[] }>(`/api/work-manuals?userId=${encodeURIComponent(userId)}`);
      setItems(r.items || []);
      // 프로세스화 여부: 내 매뉴얼을 원본으로 한 템플릿 존재 확인
      try {
        const tp = await apiJson<any[]>(`/api/process-templates?actorId=${encodeURIComponent(userId)}`);
        setProcessedIds(new Set((tp || []).map((t: any) => String(t.sourceManualId || '')).filter(Boolean)));
      } catch {}
    } catch (e: any) {
      toast(e?.message || '매뉴얼을 불러오지 못했습니다', 'error');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId]);

  function resetForm() {
    setTitle(''); setContentHtml(''); setAttachments([]); setEditingId(null);
    setEditorKey((k) => k + 1);
  }

  // 기존 매뉴얼을 입력 양식에 그대로 불러오기 (수정 모드)
  async function openForEdit(m: Manual) {
    setLoadingEdit(true);
    try {
      const d = await apiJson<Manual>(`/api/work-manuals/${encodeURIComponent(m.id)}?userId=${encodeURIComponent(userId)}`);
      setEditingId(m.id);
      setTitle(d.title || m.title || '');
      setContentHtml(d.contentHtml || plainTextToHtml(d.content || ''));
      setAttachments(Array.isArray(d.attachments) ? d.attachments : []);
      setEditorKey((k) => k + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      toast(e?.message || '매뉴얼을 불러오지 못했습니다', 'error');
    } finally { setLoadingEdit(false); }
  }

  function insertTemplate() {
    setContentHtml((prev) => (htmlToPlainText(prev).trim() ? prev + '<p><br></p>' : '') + plainTextToHtml(STD_TEMPLATE));
    setEditorKey((k) => k + 1);
  }

  async function save(thenProcess: boolean) {
    const content = htmlToPlainText(contentHtml);
    if (!title.trim() || !content.trim()) { toast('업무명과 내용을 입력하세요.', 'error'); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({ userId, title: title.trim(), content, contentHtml, attachments });
      if (editingId) {
        // 수정: 기존 매뉴얼 갱신 (작성자만, 버전 +1). 승인된 매뉴얼은 서버에서 초안으로 되돌아감(재승인 필요)
        const id = editingId;
        await apiJson(`/api/work-manuals/${encodeURIComponent(id)}`, { method: 'PUT', body });
        resetForm();
        toast('매뉴얼이 수정되었습니다.', 'success');
        if (thenProcess) { nav(`/process/from-manual?manualId=${encodeURIComponent(id)}`); return; }
        await load();
        return;
      }
      const created = await apiJson<{ id: string }>(`/api/work-manuals`, { method: 'POST', body });
      resetForm();
      toast('매뉴얼이 저장되었습니다. 가이드라인 점검 중...', 'success');
      if (created?.id) { void runGuidelineCheck(created.id, thenProcess); return; }
      await load();
    } catch (e: any) {
      toast(e?.message || '저장 실패', 'error');
    } finally { setSaving(false); }
  }

  /** 팀장 승인 요청 — 조직도 라인(팀 책임자 → 팀장 → 상위 조직 → 대표)으로 결재 상신 */
  async function requestApproval(m: Manual) {
    setBusyId(m.id);
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(m.id)}/status`, { method: 'POST', body: JSON.stringify({ userId, status: 'REVIEW' }) });
      toast('팀장에게 승인 요청을 보냈습니다. 결재함에서 처리됩니다.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message || '승인 요청 실패', 'error');
    } finally { setBusyId(null); }
  }

  /** 승인 요청 취소 (결재자가 아직 처리하지 않은 경우) → 초안으로 복귀 */
  async function cancelApproval(m: Manual) {
    setBusyId(m.id);
    try {
      if (m.approval?.id) await apiJson(`/api/approvals/${encodeURIComponent(m.approval.id)}/cancel`, { method: 'POST', body: JSON.stringify({ actorId: userId }) });
      else await apiJson(`/api/work-manuals/${encodeURIComponent(m.id)}/status`, { method: 'POST', body: JSON.stringify({ userId, status: 'DRAFT' }) });
      toast('승인 요청을 취소했습니다.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message || '취소 실패', 'error');
    } finally { setBusyId(null); }
  }

  if (!userId) return <div style={{ padding: 24, color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>내 업무 매뉴얼</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          내가 하는 업무를 평소 말하듯 적어주세요. 그림(화면 캡처)은 본문에 바로 붙여 넣을 수 있습니다. 적은 매뉴얼은 <b>팀장 승인</b>을 받거나 바로 <b>프로세스</b>로 만들 수 있습니다.
        </div>
      </div>

      {/* 새 매뉴얼 작성 / 기존 매뉴얼 수정 */}
      <div style={{ border: editingId ? '2px solid #0F3D73' : '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>{editingId ? '✏️ 매뉴얼 수정' : '새 매뉴얼 작성'}</b>
          {editingId && (
            <>
              <span style={{ fontSize: 12, color: '#64748b' }}>내용을 고치거나 파일을 추가/삭제한 뒤 저장하세요.</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-sm btn-outline" onClick={resetForm} disabled={saving}>수정 취소 (새 작성으로)</button>
            </>
          )}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="업무명 (예: 구매 발주 처리)" />
        <RichTextEditor
          value={contentHtml}
          onChange={setContentHtml}
          resetKey={editorKey}
          minHeight={280}
          placeholder={'예: 자재가 필요하면 발주 요청서를 작성한다. 팀장이 승인하고, 반려되면 다시 작성한다... 화면 캡처는 Ctrl+V로 바로 붙여 넣으세요.'}
        />
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>첨부파일 (OneDrive)</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowPicker(true)}>📁 파일 추가</button>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>내부 문서는 OneDrive에서 선택합니다.</span>
          </div>
          {attachments.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              {attachments.map((f, i) => (
                <div key={`${f.url}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 8px' }}>
                  <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: '#0F3D73', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || f.url}</a>
                  <button type="button" onClick={() => setAttachments((a) => a.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-outline" onClick={insertTemplate}>📋 표준 양식 넣기</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => void save(false)} disabled={saving}>{editingId ? '수정 저장' : '저장만'}</button>
          <button className="btn btn-primary" onClick={() => void save(true)} disabled={saving}>
            {saving ? '저장 중...' : editingId ? '수정 저장하고 프로세스 만들기 →' : '저장하고 바로 프로세스 만들기 →'}
          </button>
        </div>
      </div>

      {/* 내 매뉴얼 목록 */}
      <div style={{ display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 14 }}>내 매뉴얼 {items.length}개 {loading && <span style={{ fontWeight: 400, color: '#94a3b8' }}>· 로딩중</span>}</b>
        {items.map((m) => {
          const processed = processedIds.has(m.id);
          const st = STATUS_LABEL[String(m.status || 'DRAFT')] || STATUS_LABEL.DRAFT;
          const pending = m.status === 'REVIEW';
          const canRequest = !pending && m.status !== 'APPROVED';
          const canCancel = pending && (!m.approval || !m.approval.anyActed);
          const busy = busyId === m.id;
          const approverName = m.approval?.approverName || m.reviewerName || '';
          return (
            <div key={m.id} style={{ border: editingId === m.id ? '1px solid #0F3D73' : '1px solid #e5e7eb', background: editingId === m.id ? '#f0f6ff' : undefined, borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, flex: 1, minWidth: 160 }}>{m.title}{(m.attachments?.length ?? 0) > 0 ? <span style={{ marginLeft: 6, fontSize: 12, color: '#0F3D73' }}>📎{m.attachments!.length}</span> : null}</span>
                <span title={pending && approverName ? `승인자: ${approverName}` : undefined}
                  style={{ fontSize: 11, color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 999, padding: '2px 8px' }}>
                  {st.label}{pending && approverName ? ` · ${approverName}` : ''}
                </span>
                {processed ? (
                  <span style={{ fontSize: 11, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 999, padding: '2px 8px' }}>✓ 프로세스화 완료</span>
                ) : (
                  <span style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 999, padding: '2px 8px' }}>프로세스화 전</span>
                )}
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(m.updatedAt).toLocaleDateString()}</span>
              </div>
              {m.status === 'REJECTED' && m.reviewComment && (
                <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px' }}>
                  반려 사유{m.reviewerName ? ` (${m.reviewerName})` : ''}: {m.reviewComment}
                </div>
              )}
              {m.status === 'APPROVED' && (
                <div style={{ fontSize: 12, color: '#15803d' }}>
                  {m.reviewerName ? `${m.reviewerName} 승인` : '승인'}{m.reviewedAt ? ` · ${new Date(m.reviewedAt).toLocaleDateString()}` : ''}{m.reviewComment ? ` · ${m.reviewComment}` : ''} · 내용을 수정하면 다시 승인을 받아야 합니다.
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-primary" onClick={() => void openForEdit(m)} disabled={loadingEdit} title="입력한 양식 그대로 다시 열어 수정하고 파일을 추가합니다">✏️ 수정</button>
                <button className="btn btn-sm" onClick={() => nav(`/manuals?openId=${encodeURIComponent(m.id)}`)}>열기</button>
                <button className="btn btn-sm btn-outline" onClick={() => void runGuidelineCheck(m.id, false)} title="회사 작성 가이드라인(주기·소요시간/구체 서술/자원/경로/예외) 기준으로 빠진 부분을 점검하고 문답으로 보완합니다">📋 가이드 점검</button>
                {canRequest && (
                  <button className="btn btn-sm" disabled={busy} onClick={() => void requestApproval(m)} style={{ background: '#2563eb', color: '#fff', border: 'none' }}
                    title="조직도 라인(팀 책임자 → 팀장 → 상위 조직 → 대표)의 팀장에게 결재함으로 승인 요청을 보냅니다">
                    {busy ? '요청 중…' : m.status === 'REJECTED' ? '🔁 다시 승인 요청' : '✅ 팀장 승인 요청'}
                  </button>
                )}
                {canCancel && (
                  <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void cancelApproval(m)} style={{ color: '#dc2626', borderColor: '#fca5a5' }}>
                    {busy ? '취소 중…' : '승인 요청 취소'}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button className="btn btn-sm btn-outline" onClick={() => nav(`/process/from-manual?manualId=${encodeURIComponent(m.id)}`)}>
                  {processed ? '프로세스 다시 만들기' : '프로세스 만들기 →'}
                </button>
              </div>
            </div>
          );
        })}
        {!items.length && !loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>아직 작성한 매뉴얼이 없습니다. 위에서 첫 매뉴얼을 작성해 보세요.</div>}
      </div>

      {/* 가이드라인 점검 모달 */}
      {check && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 680, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 20, display: 'grid', gap: 10 }}>
            {check.phase === 'loading' ? (
              <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', padding: 8 }}>✓ 저장되었습니다 — 작성 가이드라인 기준으로 점검 중입니다...</div>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 800 }}>📋 가이드라인 점검 — 몇 가지만 보완해 주세요</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {check.checklist.map((c) => (
                    <span key={c.key} title={c.note} style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px', border: `1px solid ${c.ok ? '#86efac' : '#fcd34d'}`, background: c.ok ? '#f0fdf4' : '#fffbeb', color: c.ok ? '#15803d' : '#b45309' }}>
                      {c.ok ? '✓' : '△'} {CAT_LABEL[c.key] || c.key}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  회사 표준(주기·소요시간 / 따라 할 수 있는 서술 / 자원·연락처 / 경로·산출물 / 예외 대응) 중 빠진 부분입니다. <b>아는 것만 짧게</b> 답하면 매뉴얼에 자동 추가됩니다.
                </div>
                {check.questions.map((q) => (
                  <div key={q.id} style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      <span style={{ fontSize: 10, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '1px 6px', marginRight: 6 }}>{CAT_LABEL[q.category] || q.category}</span>
                      Q. {q.question}
                    </div>
                    <textarea rows={2} value={checkAnswers[q.id] || ''} placeholder="한두 문장이면 충분합니다 (모르면 비워두세요)"
                      onChange={(e) => setCheckAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))} />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn" disabled={applying} onClick={() => { const c = check; setCheck(null); if (c) finishCheck(c.manualId, c.thenProcess); }}>건너뛰기</button>
                  <button type="button" className="btn btn-primary" disabled={applying} onClick={() => void applyCheckAnswers()}>
                    {applying ? '반영 중...' : '답변을 매뉴얼에 추가'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {showPicker && (
        <OneDriveFilePicker
          userId={userId}
          multiple
          onSelect={(files) => setAttachments((a) => [...a, ...files.map((f) => ({ url: f.url, name: f.name || f.url }))])}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
