import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { toast } from './Toast';
import { OneDriveFilePicker } from './OneDriveFilePicker';
import { uploadFile } from '../lib/upload';
import { escapeHtml, toSafeHtml } from '../lib/richText';

/**
 * 프로세스화 준비 코치 (AI 검토) — 매뉴얼을 프로세스로 만들기 전에
 * ① 준비도 진단(규칙) → ② 빈칸 질문(AI) + 답변(텍스트·파일·화면 이미지) → ③ AI 재작성 미리보기 → ④ 적용(버전 +1)
 * 준비도 80점 이상이면 팀장 승인 요청으로 이어진다.
 */
type Question = { id: number; stepId: string; field: string; question: string; choices?: string[] };
type Answer = { text: string; files: Array<{ url: string; name: string }>; images: string[] };
type Readiness = { score: number; hasSteps: boolean; stepCount: number; steps: Array<{ stepId: string; title: string; taskType: string; missing: string[] }>; gaps: any[]; summary: string[]; completeness: { score: number; items: Array<{ field: string; label: string; ok: boolean; hint: string }> } };
type Diag = { readiness: Readiness; threshold: number; questions: Question[]; source: string };

const FIELD_KO: Record<string, string> = { structure: '단계 구분', taskType: '단계 유형', assignee: '담당', method: '방법', completion: '완료조건', deadline: '기한', approvalLine: '결재선', branch: '반려 처리', coopTarget: '요청 대상', purpose: '목적', cycle: '주기', resources: '자원·연락처', reference: '관련 문서', screen: '화면 캡처', exceptions: '예외 대응' };

function draftToHtml(text: string): string {
  return String(text || '').split(/\r?\n/).map((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return '<p><br></p>';
    const img = line.match(/^\s*\[이미지:\s*(\S+?)\s*\]\s*$/);
    if (img) return `<p><img src="${escapeHtml(img[1])}"></p>`;
    if (/^###\s*STEP/i.test(line)) return `<h3>${escapeHtml(line)}</h3>`;
    if (/^##\s/.test(line)) return `<h2>${escapeHtml(line)}</h2>`;
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}

export function ManualCoach(props: {
  manualId: string; title: string; userId: string;
  onClose: () => void;
  onApplied?: (readinessScore: number) => void;
  onRequestApproval?: () => void;
  onMakeProcess?: () => void;
}) {
  const { manualId, title, userId, onClose, onApplied, onRequestApproval, onMakeProcess } = props;
  const [phase, setPhase] = useState<'diag' | 'ask' | 'preview' | 'done'>('diag');
  const [diag, setDiag] = useState<Diag | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [current, setCurrent] = useState<string>('');
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [round, setRound] = useState(1);

  async function diagnose() {
    setBusy('진단 중…'); setPhase('diag');
    try {
      const [d, m] = await Promise.all([
        apiJson<Diag>(`/api/work-manuals/${encodeURIComponent(manualId)}/ai/coach/diagnose`, { method: 'POST', body: JSON.stringify({ userId }) }),
        apiJson<any>(`/api/work-manuals/${encodeURIComponent(manualId)}?userId=${encodeURIComponent(userId)}`),
      ]);
      setDiag(d); setCurrent(String(m?.content || ''));
      const init: Record<number, Answer> = {}; for (const q of d.questions) init[q.id] = { text: '', files: [], images: [] };
      setAnswers(init);
      setPhase(d.questions.length ? 'ask' : 'done');
    } catch (e: any) { toast(e?.message || '진단 실패', 'error'); onClose(); }
    finally { setBusy(null); }
  }
  useEffect(() => { void diagnose(); /* eslint-disable-next-line */ }, [manualId]);

  const setA = (id: number, patch: Partial<Answer>) => setAnswers((prev) => ({ ...prev, [id]: { ...(prev[id] || { text: '', files: [], images: [] }), ...patch } }));
  const pickChoice = (id: number, c: string) => setA(id, { text: (answers[id]?.text ? `${answers[id].text} ` : '') + c });

  async function addImages(id: number, files: FileList | null) {
    if (!files?.length) return;
    setBusy('이미지 올리는 중…');
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) { const up = await uploadFile(f); urls.push(up.url); }
      setA(id, { images: [...(answers[id]?.images || []), ...urls] });
    } catch { toast('이미지 업로드 실패', 'error'); } finally { setBusy(null); }
  }

  async function rewrite(skipAnswers = false) {
    if (!diag) return;
    setBusy('AI가 매뉴얼을 다시 쓰는 중… (10~30초)');
    try {
      const qa = skipAnswers ? [] : diag.questions.map((q) => ({ stepId: q.stepId, field: q.field, q: q.question, a: answers[q.id]?.text || '', files: answers[q.id]?.files || [], images: answers[q.id]?.images || [] })).filter((x) => x.a.trim() || x.files.length || x.images.length);
      const r = await apiJson<any>(`/api/work-manuals/${encodeURIComponent(manualId)}/ai/coach/rewrite`, { method: 'POST', body: JSON.stringify({ userId, qa }) });
      setPreview(r); setPhase('preview');
    } catch (e: any) { toast(e?.message || '재작성 실패', 'error'); } finally { setBusy(null); }
  }

  async function apply() {
    if (!preview?.draft) return;
    setBusy('저장 중…');
    try {
      const r = await apiJson<any>(`/api/work-manuals/${encodeURIComponent(manualId)}/ai/coach/apply`, { method: 'POST', body: JSON.stringify({ userId, draft: preview.draft, attachments: preview.newFiles || [] }) });
      toast(`적용되었습니다 (v${r.version}) — 준비도 ${r.readiness.score}점`, 'success');
      onApplied?.(r.readiness.score);
      setRound((n) => n + 1);
      await diagnose(); // 다음 라운드 또는 완료
    } catch (e: any) { toast(e?.message || '적용 실패', 'error'); } finally { setBusy(null); }
  }

  const r = diag?.readiness; const th = diag?.threshold ?? 80;
  const scoreColor = (s: number) => (s >= th ? '#15803d' : s >= 50 ? '#b45309' : '#b91c1c');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 95, padding: 12 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 980, maxHeight: '92vh', overflow: 'auto', padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16 }}>🤖 AI 검토 — 프로세스화 준비 코치</b>
          <span style={{ fontSize: 13, color: '#64748b' }}>{title}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>라운드 {round}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm btn-outline" onClick={onClose}>닫기</button>
        </div>

        {busy && <div style={{ fontSize: 13, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px' }}>⏳ {busy}</div>}

        {r && (
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, alignItems: 'start' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>프로세스화 준비도</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: scoreColor(r.score), lineHeight: 1.1 }}>{r.score}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>/ 100 · 기준 {th}점</div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>매뉴얼 완성도</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(r.completeness.score) }}>{r.completeness.score}</div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#475569' }}>
                <b>프로세스 변환 필수</b> (80점 기준): 단계 구분 · 단계별 유형/담당/방법/완료조건/기한 · 결재 단계의 결재선/반려 처리 · 타팀 요청 대상.
                {r.summary.length > 0 && <span style={{ color: '#b45309' }}> 빠진 것: {r.summary.join(', ')}</span>}
                {r.hasSteps && !r.summary.length && <span style={{ color: '#15803d' }}> 모두 갖춰졌습니다.</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {r.completeness.items.map((it) => (
                  <span key={it.field} title={it.hint} style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px', border: `1px solid ${it.ok ? '#86efac' : '#fcd34d'}`, background: it.ok ? '#f0fdf4' : '#fffbeb', color: it.ok ? '#15803d' : '#b45309' }}>{it.ok ? '✓' : '△'} {it.label}</span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>완성도 기준 = 회사 매뉴얼 작성 가이드라인(주기·소요시간 / 행동 서술 / 자원·연락처 / 경로·산출물 / 예외 대응) + 작업표준서 요소(목적·적용범위, 관련 문서·양식). 80점 게이트에는 들어가지 않지만 질문으로 함께 채웁니다.</div>
              {r.hasSteps && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.steps.map((s) => (
                    <span key={s.stepId} style={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 6px', background: s.missing.length ? '#fff7ed' : '#f0fdf4' }}>
                      {s.stepId} {s.title}{s.taskType ? ` (${s.taskType})` : ''}{s.missing.length ? ` · 누락 ${s.missing.map((m) => FIELD_KO[m] || m).join('/')}` : ' ✓'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'ask' && diag && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, color: '#334155' }}>아래 질문에 아는 것만 답해 주세요. 보기를 누르면 답에 들어가고, 양식·규정 파일은 📁로, 시스템 화면은 🖼로 바로 붙일 수 있습니다. 답변을 바탕으로 AI가 매뉴얼을 프로세스에 맞는 양식으로 다시 쓰고, <b>적용 전에 미리 보여줍니다</b>.{diag.source === 'rule' && <span style={{ color: '#94a3b8' }}> (AI 응답 지연으로 기본 질문 사용)</span>}</div>
            {diag.questions.map((q) => {
              const a = answers[q.id] || { text: '', files: [], images: [] };
              return (
                <div key={q.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    <span style={{ fontSize: 10, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '1px 6px', marginRight: 6 }}>{q.stepId !== '*' ? `${q.stepId} · ` : ''}{FIELD_KO[q.field] || q.field}</span>
                    Q{q.id}. {q.question}
                  </div>
                  {q.choices?.length ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{q.choices.map((c) => <button key={c} type="button" className="btn btn-sm btn-outline" style={{ fontSize: 11 }} onClick={() => pickChoice(q.id, c)}>{c}</button>)}</div> : null}
                  <textarea rows={2} value={a.text} onChange={(e) => setA(q.id, { text: e.target.value })} placeholder="한두 문장이면 충분합니다 (모르면 비워두세요)" style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setPickerFor(q.id)}>📁 파일 첨부(OneDrive)</button>
                    <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>🖼 화면 이미지 올리기<input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void addImages(q.id, e.target.files); e.currentTarget.value = ''; }} /></label>
                    {a.files.map((f, i) => <span key={f.url} style={{ fontSize: 12, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 6px' }}>📎 {f.name} <button type="button" onClick={() => setA(q.id, { files: a.files.filter((_, j) => j !== i) })} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer' }}>×</button></span>)}
                  </div>
                  {a.images.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a.images.map((u, i) => <span key={u} style={{ position: 'relative' }}><img src={u} alt="" style={{ height: 64, borderRadius: 6, border: '1px solid #e5e7eb' }} /><button type="button" onClick={() => setA(q.id, { images: a.images.filter((_, j) => j !== i) })} style={{ position: 'absolute', top: -6, right: -6, border: 'none', background: '#dc2626', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer' }}>×</button></span>)}</div>}
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => void rewrite(true)} title="답변 없이 현재 내용만 STEP 양식으로 정리">양식만 정리</button>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void rewrite(false)}>답변 반영해서 다시 쓰기 → 미리보기</button>
            </div>
          </div>
        )}

        {phase === 'preview' && preview && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
              <b>미리보기</b>
              <span>준비도 <b style={{ color: scoreColor(preview.before) }}>{preview.before}</b> → <b style={{ color: scoreColor(preview.after) }}>{preview.after}</b>점</span>
              {preview.restoredImages > 0 && <span style={{ color: '#b45309' }}>그림 {preview.restoredImages}장은 끝의 "참고 화면"으로 보존</span>}
              {preview.afterReadiness?.summary?.length ? <span style={{ color: '#b45309' }}>아직 빠진 것: {preview.afterReadiness.summary.join(', ')}</span> : <span style={{ color: '#15803d' }}>필수 항목 모두 채워짐</span>}
            </div>
            {Array.isArray(preview.changes) && preview.changes.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#475569' }}>{preview.changes.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 8 }}>
              <div><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>현재 (원문)</div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, margin: 0, maxHeight: 420, overflow: 'auto', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, fontFamily: 'inherit' }}>{current || '(내용 없음)'}</pre></div>
              <div><div style={{ fontSize: 11, color: '#1d4ed8', marginBottom: 4 }}>AI가 다시 쓴 안 (적용 전)</div><div className="rich-body" style={{ fontSize: 12, lineHeight: 1.5, maxHeight: 420, overflow: 'auto', background: '#fff', border: '2px solid #bfdbfe', borderRadius: 8, padding: 10 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(draftToHtml(preview.draft)) }} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => setPhase('ask')}>← 답변 고치기</button>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void apply()}>이대로 적용 (새 버전으로 저장)</button>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>원문은 이전 버전으로 남습니다. 적용 후 자동으로 다시 진단해 부족하면 다음 라운드 질문이 이어집니다.</div>
          </div>
        )}

        {phase === 'done' && r && (
          <div style={{ display: 'grid', gap: 10 }}>
            {r.score >= th ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 12, fontSize: 13, color: '#166534' }}>
                ✅ 준비도 {r.score}점 — 프로세스로 변환하기 좋은 상태입니다. 이제 <b>팀장 승인</b>을 받으면 프로세스 만들기로 넘어갈 수 있습니다.
              </div>
            ) : (
              <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: 12, fontSize: 13, color: '#92400e' }}>
                준비도 {r.score}점 — 질문이 더 없어서 자동 보완이 끝났습니다. 남은 항목({r.summary.join(', ') || '없음'})은 매뉴얼을 직접 수정해 주세요.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => void diagnose()}>다시 진단</button>
              {r.score >= th && onRequestApproval && <button type="button" className="btn" style={{ background: '#2563eb', color: '#fff', border: 'none' }} onClick={onRequestApproval}>✅ 팀장 승인 요청</button>}
              {onMakeProcess && <button type="button" className="btn btn-primary" onClick={onMakeProcess}>프로세스 만들기 →</button>}
            </div>
          </div>
        )}

        {pickerFor != null && (
          <OneDriveFilePicker userId={userId} multiple onSelect={(files) => setA(pickerFor, { files: [...(answers[pickerFor]?.files || []), ...files.map((f) => ({ url: f.url, name: f.name || f.url }))] })} onClose={() => setPickerFor(null)} />
        )}
      </div>
    </div>
  );
}
