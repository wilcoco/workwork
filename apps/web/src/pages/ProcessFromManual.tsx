import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';
import { BpmnEditor } from '../components/BpmnEditor';

/**
 * 자연어 업무 매뉴얼 → AI 보완 질문 → BPMN 프로세스 템플릿 완성 → (선택) 수동 편집 → 발행
 * 완성된 템플릿은 바로 "새 프로세스 시작"으로 실행할 수 있다.
 */
export function ProcessFromManual() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [aiModel, setAiModel] = useState<'openai' | 'claude'>('claude');
  const [loading, setLoading] = useState('');
  // 업무 메뉴얼 화면에서 기존 매뉴얼을 가지고 진입한 경우 (?manualId=)
  const initialManualId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('manualId') || '' : '';
  const [loadedFromManual, setLoadedFromManual] = useState(false);

  // step 1
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [manualId, setManualId] = useState('');

  // step 2
  const [questions, setQuestions] = useState<Array<{ id: number; question: string }>>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  // step 3
  const [bpmnTitle, setBpmnTitle] = useState('');
  const [bpmnJsonText, setBpmnJsonText] = useState('');

  // step 4
  const [templateId, setTemplateId] = useState('');

  useEffect(() => {
    if (!initialManualId || !userId) return;
    (async () => {
      try {
        const m = await apiJson<{ id: string; title: string; content?: string }>(
          `/api/work-manuals/${encodeURIComponent(initialManualId)}?userId=${encodeURIComponent(userId)}`,
        );
        setManualId(m.id);
        setTitle(String(m.title || ''));
        setContent(String(m.content || ''));
        setLoadedFromManual(true);
      } catch (e: any) {
        toast(e?.message || '매뉴얼을 불러오지 못했습니다.', 'error');
      }
    })();
  }, [initialManualId, userId]);

  const taskCount = useMemo(() => {
    try {
      const j = JSON.parse(bpmnJsonText || '{}');
      return (j.nodes || []).filter((n: any) => String(n?.type) === 'task').length;
    } catch { return 0; }
  }, [bpmnJsonText]);

  async function ensureManual(): Promise<string> {
    const t = title.trim();
    const c = content.trim();
    if (!t) throw new Error('업무명을 입력하세요.');
    if (!c) throw new Error('업무 매뉴얼 내용을 입력하세요.');
    // 기존 매뉴얼에서 진입한 경우: 매뉴얼은 읽기 전용 소스로만 사용 (내용 수정은 업무 메뉴얼 화면에서)
    if (loadedFromManual && manualId) return manualId;
    if (manualId) {
      await apiJson(`/api/work-manuals/${encodeURIComponent(manualId)}`, {
        method: 'PUT',
        body: JSON.stringify({ userId, title: t, content: c }),
      });
      return manualId;
    }
    const created = await apiJson<{ id: string }>('/api/work-manuals', {
      method: 'POST',
      body: JSON.stringify({ userId, title: t, content: c }),
    });
    setManualId(created.id);
    return created.id;
  }

  async function askQuestions() {
    setLoading('questions');
    try {
      const mid = await ensureManual();
      const r = await apiJson<{ questions: Array<{ id: number; question: string }> }>(
        `/api/work-manuals/${encodeURIComponent(mid)}/ai/bpmn-questions`,
        { method: 'POST', body: JSON.stringify({ userId, aiModel }) },
      );
      const qs = r.questions || [];
      if (qs.length === 0) {
        toast('보완할 정보가 없습니다. 바로 프로세스를 생성합니다.', 'success');
        await generate(mid, []);
        return;
      }
      setQuestions(qs);
      setAnswers({});
      setStep(2);
    } catch (e: any) {
      toast(e?.message || '질문 생성 실패', 'error');
    } finally {
      setLoading('');
    }
  }

  async function generate(mid?: string, answerList?: Array<{ question: string; answer: string }>) {
    setLoading('generate');
    try {
      const id = mid || (await ensureManual());
      const ans = answerList ?? questions
        .map((q) => ({ question: q.question, answer: (answers[q.id] || '').trim() }))
        .filter((a) => a.answer);
      const r = await apiJson<{ title: string; bpmnJson: any }>(
        `/api/work-manuals/${encodeURIComponent(id)}/ai/bpmn`,
        { method: 'POST', body: JSON.stringify({ userId, aiModel, answers: ans }) },
      );
      if (!r?.bpmnJson) throw new Error('AI BPMN 응답이 올바르지 않습니다.');
      setBpmnTitle(String(r.title || title).trim());
      setBpmnJsonText(JSON.stringify(r.bpmnJson, null, 2));
      setStep(3);
    } catch (e: any) {
      toast(e?.message || 'BPMN 생성 실패', 'error');
    } finally {
      setLoading('');
    }
  }

  async function createTemplate() {
    setLoading('create');
    try {
      let bpmnJson: any;
      try { bpmnJson = JSON.parse(bpmnJsonText || '{}'); } catch { throw new Error('BPMN JSON이 올바르지 않습니다.'); }
      if (!Array.isArray(bpmnJson?.nodes) || !bpmnJson.nodes.some((n: any) => String(n?.type) === 'task')) {
        throw new Error('업무 단계(task)가 1개 이상 필요합니다.');
      }
      // 결재 단계는 결재선(또는 담당)을 반드시 명시해야 실행 시 결재가 올바르게 돌아간다
      const missingLine = bpmnJson.nodes.filter((n: any) =>
        String(n?.type) === 'task' && String(n?.taskType || '').toUpperCase() === 'APPROVAL'
        && !String(n?.approvalUserIds || '').trim() && !n?.assigneeUserId && !n?.assigneeOrgUnitId);
      if (missingLine.length) {
        throw new Error(`결재 단계에 결재선이 없습니다: ${missingLine.map((n: any) => `「${n.name}」`).join(', ')} — 그래프에서 해당 결재 노드를 클릭해 "결재선"에 결재자를 순서대로 추가하세요.`);
      }
      const created = await apiJson<{ id: string }>('/api/process-templates', {
        method: 'POST',
        body: JSON.stringify({
          title: bpmnTitle.trim() || title.trim(),
          description: `매뉴얼 「${title.trim()}」에서 AI로 생성된 BPMN 프로세스`,
          type: 'PROJECT',
          ownerId: userId,
          actorId: userId,
          visibility: 'PRIVATE',
          bpmnJson,
          tasks: [],
          sourceManualId: manualId || undefined,
        }),
      });
      const tid = String(created?.id || '').trim();
      if (!tid) throw new Error('템플릿 생성 실패');
      try {
        await apiJson(`/api/process-templates/${encodeURIComponent(tid)}/publish`, {
          method: 'POST',
          body: JSON.stringify({ actorId: userId }),
        });
      } catch { /* 발행 실패 시 DRAFT로 유지 — 템플릿 화면에서 게시 가능 */ }
      setTemplateId(tid);
      setStep(4);
      toast('프로세스 템플릿이 완성되었습니다.', 'success');
    } catch (e: any) {
      toast(e?.message || '템플릿 생성 실패', 'error');
    } finally {
      setLoading('');
    }
  }

  function reset() {
    setStep(1); setTitle(''); setContent(''); setManualId('');
    setQuestions([]); setAnswers({}); setBpmnTitle(''); setBpmnJsonText(''); setTemplateId('');
    setLoadedFromManual(false);
    if (initialManualId) nav('/process/from-manual', { replace: true });
  }

  if (!userId) {
    return <div className="content" style={{ color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;
  }

  const stepLabels = ['매뉴얼 입력', 'AI 보완 질문', '검토·수정', '완성'];

  return (
    <div className="content" style={{ display: 'grid', gap: 14, maxWidth: step === 3 ? undefined : 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>매뉴얼로 프로세스 만들기</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 2 }}>
          {(['claude', 'openai'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setAiModel(m)}
              style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: aiModel === m ? 700 : 400, border: 'none', cursor: 'pointer',
                background: aiModel === m ? '#fff' : 'transparent', color: aiModel === m ? '#0f172a' : '#64748b',
                boxShadow: aiModel === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {m === 'claude' ? 'Claude' : 'GPT'}
            </button>
          ))}
        </div>
      </div>

      {/* 진행 단계 표시 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {stepLabels.map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
              fontWeight: step === i + 1 ? 700 : 400,
              color: step > i + 1 ? '#16a34a' : step === i + 1 ? '#0F3D73' : '#94a3b8',
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                background: step > i + 1 ? '#dcfce7' : step === i + 1 ? '#0F3D73' : '#f1f5f9',
                color: step > i + 1 ? '#16a34a' : step === i + 1 ? '#fff' : '#94a3b8',
              }}>{step > i + 1 ? '✓' : i + 1}</span>
              {label}
            </span>
            {i < stepLabels.length - 1 && <span style={{ color: '#cbd5e1' }}>→</span>}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {loadedFromManual
              ? '업무 메뉴얼에서 불러온 내용입니다. 내용 수정이 필요하면 업무 메뉴얼 화면에서 수정 후 다시 시도하세요.'
              : '업무를 평소 말로 설명하듯 적어주세요. AI가 부족한 정보를 질문으로 보완한 뒤 실행 가능한 업무 프로세스로 만들어 드립니다.'}
          </div>
          <label>업무명
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 구매 발주 처리" readOnly={loadedFromManual} />
          </label>
          <label>업무 매뉴얼 (자연어)
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14} readOnly={loadedFromManual}
              style={loadedFromManual ? { background: '#f8fafc', color: '#475569' } : undefined}
              placeholder={'예: 자재가 필요하면 자재관리팀 담당자가 발주 요청서를 작성한다.\n경영관리팀장이 발주를 승인하고, 반려되면 요청서를 다시 작성한다.\n승인되면 발주서를 발송하고 48시간 내 입고를 확인한다.'} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={askQuestions} disabled={!!loading}>
              {loading === 'questions' ? 'AI 분석 중...' : loading === 'generate' ? '프로세스 생성 중...' : '다음 — AI 보완 질문 받기'}
            </button>
            <button className="btn" onClick={() => void generate()} disabled={!!loading}>질문 생략하고 바로 생성</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            실행 가능한 프로세스를 만들기 위해 AI가 확인이 필요한 항목입니다. 아는 것만 답해도 됩니다 (빈 답변은 건너뜁니다).
          </div>
          {questions.map((q) => (
            <div key={q.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Q{q.id}. {q.question}</div>
              <textarea rows={2} value={answers[q.id] || ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="답변 입력 (모르면 비워두세요)" />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)} disabled={!!loading}>← 매뉴얼 수정</button>
            <button className="btn btn-primary" onClick={() => void generate()} disabled={!!loading}>
              {loading === 'generate' ? '프로세스 생성 중...' : '답변 반영해 프로세스 생성'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            AI가 만든 프로세스 초안입니다. 필요하면 노드를 눌러 이름·담당·기한을 수정하세요.
            <b> 결재(마름모) 단계는 노드를 클릭해 결재선(결재자 순서)을 반드시 지정해야 완성할 수 있습니다.</b>{' '}
            일반 단계의 담당이 비어 있으면 프로세스 시작 시 시작자에게 배정됩니다.
          </div>
          <label>프로세스 이름
            <input value={bpmnTitle} onChange={(e) => setBpmnTitle(e.target.value)} />
          </label>
          <div style={{ fontSize: 12, color: '#64748b' }}>업무 단계 {taskCount}개</div>
          <BpmnEditor jsonText={bpmnJsonText} onChangeJson={setBpmnJsonText} height={560} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setStep(questions.length ? 2 : 1)} disabled={!!loading}>← 이전</button>
            <button className="btn" onClick={() => void generate()} disabled={!!loading}>
              {loading === 'generate' ? '재생성 중...' : 'AI 다시 생성'}
            </button>
            <button className="btn btn-primary" onClick={createTemplate} disabled={!!loading}>
              {loading === 'create' ? '완성 중...' : '템플릿 완성 (생성·발행)'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>✓ 업무 프로세스 템플릿이 완성되었습니다.</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            「{bpmnTitle || title}」 — 이제 이 템플릿으로 실제 프로세스를 시작할 수 있습니다. 원본 매뉴얼은 업무 메뉴얼 목록에 저장되어 있습니다.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => nav(`/process/start?templateId=${encodeURIComponent(templateId)}`)}>
              새 프로세스 시작 →
            </button>
            <button className="btn" onClick={() => nav(`/process/templates?openId=${encodeURIComponent(templateId)}`)}>템플릿 상세 보기</button>
            <button className="btn" onClick={reset}>다른 매뉴얼로 또 만들기</button>
          </div>
        </div>
      )}
    </div>
  );
}
