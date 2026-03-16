import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';
import { StepFormEditor, StepFormData, parseTextToStepForms, serializeStepsToText, makeEmptyStep } from '../components/StepFormEditor';
import { toast, toastConfirm } from '../components/Toast';

type WorkManualDto = {
  id?: string;
  userId?: string;
  title: string;
  content?: string | null;
  authorName?: string | null;
  authorTeamName?: string | null;
  version?: number | null;
  versionUpAt?: string | null;
  status?: string;
  reviewerId?: string | null;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  qualityScore?: number;
  createdAt?: string;
  updatedAt?: string;
};

type ManualIssue = {
  stepId?: string;
  issue: string;
  severity: 'MUST' | 'SHOULD';
  suggestion?: string;
};

type ManualQuestion = {
  stepId?: string;
  targetStepId?: string;
  targetField?: string;
  question: string;
  severity: 'MUST' | 'SHOULD';
  reason?: string;
  source?: 'rule' | 'ai';
};

type StepScore = {
  stepId: string;
  title: string;
  score: number;
  missingFields: string[];
};

const FILE_FIELDS = new Set(['inputs', 'relatedDocs', 'outputs', 'emailTo', 'emailSubject']);

function isFileField(q: ManualQuestion): boolean {
  if (!q.targetField) return false;
  return FILE_FIELDS.has(q.targetField);
}

type AiQuestionsResult = {
  summary: string;
  issues: ManualIssue[];
  questions: ManualQuestion[];
  score?: number;
  stepScores?: StepScore[];
};

type ParsedStep = {
  stepId: string;
  title: string;
  raw: string;
};

function parseStepsFromManual(text: string): ParsedStep[] {
  const lines = String(text || '').split(/\r?\n/);
  const out: ParsedStep[] = [];
  let cur: { stepId: string; title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(/^###\s*STEP\s+(S\d+)\s*\|\s*(.+)\s*$/i);
    if (m) {
      if (cur) {
        out.push({ stepId: cur.stepId, title: cur.title, raw: `### STEP ${cur.stepId} | ${cur.title}\n${cur.lines.join('\n')}`.trim() });
      }
      cur = { stepId: String(m[1] || '').toUpperCase(), title: String(m[2] || '').trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) {
    out.push({ stepId: cur.stepId, title: cur.title, raw: `### STEP ${cur.stepId} | ${cur.title}\n${cur.lines.join('\n')}`.trim() });
  }
  return out;
}

function validateManual(text: string): { issues: ManualIssue[]; steps: ParsedStep[] } {
  const content = String(text || '');
  const steps = parseStepsFromManual(content);
  const issues: ManualIssue[] = [];

  if (!steps.length) {
    if (content.trim().length > 0) {
      issues.push({ severity: 'MUST', issue: 'STEP 블록을 찾을 수 없습니다. “### STEP S1 | 단계명” 형식으로 작성해 주세요.' });
    } else {
      issues.push({ severity: 'MUST', issue: '메뉴얼 내용이 비어 있습니다.' });
    }
    return { issues, steps };
  }

  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.stepId)) {
      issues.push({ severity: 'MUST', stepId: s.stepId, issue: 'STEP ID가 중복되었습니다.' });
    }
    seen.add(s.stepId);
  }

  const stepIdSet = new Set(steps.map((s) => s.stepId));
  const refs: Array<{ from: string; to: string; raw: string }> = [];

  for (const s of steps) {
    const lines = s.raw.split(/\r?\n/);
    let taskType = '';
    for (const line of lines) {
      const m = line.match(/^\s*-\s*taskType\s*:\s*([A-Za-z_]+)\s*$/i);
      if (m) {
        taskType = String(m[1] || '').toUpperCase();
        break;
      }
    }
    if (!taskType) {
      issues.push({ severity: 'MUST', stepId: s.stepId, issue: 'taskType이 필요합니다. (WORKLOG/APPROVAL/COOPERATION)' });
    } else if (taskType === 'TASK') {
      issues.push({ severity: 'MUST', stepId: s.stepId, issue: 'TASK는 예외입니다. WORKLOG/APPROVAL/COOPERATION 중 하나로 지정해 주세요.' });
    } else if (!['WORKLOG', 'APPROVAL', 'COOPERATION'].includes(taskType)) {
      issues.push({ severity: 'MUST', stepId: s.stepId, issue: `지원하지 않는 taskType입니다: ${taskType}` });
    }

    const hasPurpose = /\n\s*-\s*목적\s*:/i.test(`\n${s.raw}`);
    const hasInputs = /\n\s*-\s*입력\s*\//i.test(`\n${s.raw}`) || /필요자료\s*\(/i.test(s.raw) || /\n\s*-\s*입력\s*:/i.test(`\n${s.raw}`);
    const hasOutputs = /\n\s*-\s*산출물\s*:/i.test(`\n${s.raw}`);
    const hasDone = /\n\s*-\s*완료조건\s*:/i.test(`\n${s.raw}`);
    const hasWorklog = /업무일지/i.test(s.raw);
    const hasBranch = /\n\s*-\s*분기\s*:/i.test(`\n${s.raw}`);

    if (!hasPurpose) issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: '목적을 적어주면 좋습니다.' });
    if (!hasInputs) issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: '입력/필요자료(파일·양식·링크)를 적어주면 좋습니다.' });
    if (!hasOutputs) issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: '산출물을 적어주면 좋습니다.' });
    if (!hasDone) issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: '완료조건을 적어주면 좋습니다.' });

    if (taskType === 'WORKLOG' && !hasWorklog) {
      issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: 'WORKLOG 단계라면 업무일지(기록할 내용)를 구체화하면 AI 품질이 좋아집니다.' });
    }
    if (taskType === 'APPROVAL' && !hasBranch) {
      issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: 'APPROVAL 단계라면 분기(승인/반려 -> 다음 STEP) 또는 승인 기준을 적어주면 좋습니다.' });
    }

    for (const line of lines) {
      if (!line.includes('->')) continue;
      const m = line.match(/->\s*(S\d+)\s*$/i);
      if (!m) {
        issues.push({ severity: 'MUST', stepId: s.stepId, issue: `분기 대상 STEP 표기가 올바르지 않습니다: ${line.trim()}` });
        continue;
      }
      refs.push({ from: s.stepId, to: String(m[1] || '').toUpperCase(), raw: line.trim() });

      const before = String(line.split('->')[0] || '').trim();
      const cond = before.includes(':') ? String(before.split(':').slice(1).join(':')).trim() : '';
      if (!cond) {
        issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: `분기 조건식이 비어 있습니다: ${line.trim()}`, suggestion: "예: last.approval.status == 'APPROVED'" });
      } else if (!/(==|!=)/.test(cond)) {
        issues.push({ severity: 'SHOULD', stepId: s.stepId, issue: `조건식은 == 또는 != 를 포함해야 런타임에서 평가할 수 있습니다: ${cond}` });
      }
    }
  }

  for (const r of refs) {
    if (!stepIdSet.has(r.to)) {
      issues.push({ severity: 'MUST', stepId: r.from, issue: `분기에서 참조한 STEP이 존재하지 않습니다: ${r.raw}` });
    }
  }

  return { issues, steps };
}

const T = {
  border: '1px solid #E5E7EB',
  borderFocus: '1px solid #0F3D73',
  radius: 8,
  radiusLg: 12,
  radiusPill: 20,
  input: { border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' } as React.CSSProperties,
  card: { border: '1px solid #E5E7EB', borderRadius: 12, background: '#FFFFFF', padding: 12 } as React.CSSProperties,
  muted: '#64748b',
  primary: '#0F3D73',
  danger: '#b91c1c',
  bg: '#FAFBFC',
  bgSubtle: '#F8FAFC',
  textSm: { fontSize: 12, color: '#64748b' } as React.CSSProperties,
  label: { fontWeight: 700, fontSize: 13 } as React.CSSProperties,
};

export function WorkManuals() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const userName = typeof localStorage !== 'undefined' ? localStorage.getItem('userName') || '' : '';
  const teamName = typeof localStorage !== 'undefined' ? localStorage.getItem('teamName') || '' : '';

  const [items, setItems] = useState<WorkManualDto[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editing, setEditing] = useState<WorkManualDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestionsLoading, setAiQuestionsLoading] = useState(false);
  const [validation, setValidation] = useState<{ issues: ManualIssue[] } | null>(null);
  const [aiQuestions, setAiQuestions] = useState<AiQuestionsResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [answerLinks, setAnswerLinks] = useState<Record<number, { name: string; url: string }[]>>({});
  const [applyLoading, setApplyLoading] = useState(false);
  const [editMode, setEditMode] = useState<'text' | 'structured'>('text');
  const [stepForms, setStepForms] = useState<StepFormData[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [phase, setPhase] = useState<1 | 2 | 3>(1);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [qaRound, setQaRound] = useState(0);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [stepScores, setStepScores] = useState<StepScore[]>([]);
  const [reviewQueue, setReviewQueue] = useState<WorkManualDto[]>([]);
  const [orgUsers, setOrgUsers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [reviewerPickOpen, setReviewerPickOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  const selected = useMemo(() => {
    if (!editing) return null;
    return editing;
  }, [editing]);

  const loadList = useCallback(async (openId?: string) => {
    if (!userId) {
      setItems([]);
      setSelectedId('');
      setEditing(null);
      return;
    }

    setLoading(true);
    try {
      const r = await apiJson<{ items: WorkManualDto[] }>(`/api/work-manuals?userId=${encodeURIComponent(userId)}`);
      const rows = Array.isArray(r?.items) ? r.items : [];
      setItems(rows);

      const nextId = String(openId || rows?.[0]?.id || '').trim();
      if (nextId) {
        const found = rows.find((x) => String(x.id) === nextId) || null;
        if (found) {
          setSelectedId(String(found.id));
          setEditing({
            ...found,
            content: found.content || '',
            authorName: found.authorName || '',
            authorTeamName: found.authorTeamName || '',
          });
          return;
        }
      }
      if (rows.length) {
        setSelectedId(String(rows[0].id || ''));
        setEditing({
          ...rows[0],
          content: rows[0].content || '',
          authorName: rows[0].authorName || '',
          authorTeamName: rows[0].authorTeamName || '',
        });
      } else {
        setSelectedId('');
        setEditing(null);
      }
    } catch {
      setItems([]);
      setSelectedId('');
      setEditing(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (userId) {
      apiJson<{ items: WorkManualDto[] }>(`/api/work-manuals/review-queue?userId=${encodeURIComponent(userId)}`)
        .then(r => setReviewQueue(Array.isArray(r?.items) ? r.items : []))
        .catch(() => setReviewQueue([]));
      apiJson<{ items: Array<{ id: string; name: string; role: string }> }>(`/api/users?take=200`)
        .then(r => setOrgUsers(Array.isArray(r?.items) ? r.items : []))
        .catch(() => setOrgUsers([]));
    }
  }, [userId, items]);

  useEffect(() => {
    setValidation(null);
    setAiQuestions(null);
    setAnswers({});
    setAnswerLinks({});
    setEditMode('text');
    setStepForms([]);
    setPhase(1);
    setQaRound(0);
    setQualityScore(null);
    setStepScores([]);
  }, [selectedId]);

  async function requestReview(reviewerId: string) {
    if (!editing?.id) return;
    setStatusLoading(true);
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/status`, {
        method: 'POST',
        body: JSON.stringify({ userId, status: 'REVIEW', reviewerId }),
      });
      toast('검토 요청이 전송되었습니다.', 'success');
      setReviewerPickOpen(false);
      await loadList(String(editing.id));
    } catch (e: any) { toast(e?.message || '검토 요청에 실패했습니다.', 'error'); }
    finally { setStatusLoading(false); }
  }

  async function reviewDecision(manualId: string, decision: 'APPROVED' | 'REJECTED', comment?: string) {
    setStatusLoading(true);
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(manualId)}/review`, {
        method: 'POST',
        body: JSON.stringify({ userId, decision, comment }),
      });
      toast(decision === 'APPROVED' ? '승인 완료' : '반려 완료', 'success');
      await loadList(selectedId || '');
    } catch (e: any) { toast(e?.message || '처리에 실패했습니다.', 'error'); }
    finally { setStatusLoading(false); }
  }

  async function revertToDraft() {
    if (!editing?.id) return;
    setStatusLoading(true);
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/status`, {
        method: 'POST',
        body: JSON.stringify({ userId, status: 'DRAFT' }),
      });
      toast('초안 상태로 되돌렸습니다.', 'success');
      await loadList(String(editing.id));
    } catch (e: any) { toast(e?.message || '상태 변경에 실패했습니다.', 'error'); }
    finally { setStatusLoading(false); }
  }

  function newManual() {
    if (!userId) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    setSelectedId('');
    setEditing({ title: '', content: '', authorName: userName || '', authorTeamName: teamName || '' });
  }

  function editManual(m: WorkManualDto) {
    setSelectedId(String(m.id || ''));
    setEditing({ ...m, content: m.content || '', authorName: m.authorName || '', authorTeamName: m.authorTeamName || '' });
  }

  async function switchToStructured(prefilled?: StepFormData[]) {
    if (!editing) return;
    if (prefilled && prefilled.length) {
      setStepForms(prefilled);
      setEditMode('structured');
      return;
    }
    const text = String(editing.content || '');
    const forms = parseTextToStepForms(text);
    if (!forms.length && text.trim().length > 0) {
      const ok = await toastConfirm('현재 메뉴얼에서 STEP 블록을 찾을 수 없습니다.\n\n빈 단계 하나로 구조화 편집을 시작할까요?');
      if (!ok) return;
      setStepForms([makeEmptyStep(1)]);
    } else if (!forms.length) {
      setStepForms([makeEmptyStep(1)]);
    } else {
      setStepForms(forms);
    }
    setEditMode('structured');
  }

  async function aiDraftSteps() {
    if (!userId) { toast('로그인이 필요합니다.', 'warning'); return; }
    if (!editing?.id) { toast('먼저 메뉴얼을 저장해 주세요.', 'warning'); return; }
    const content = String(editing.content || '').trim();
    if (!content) { toast('메뉴얼 내용을 먼저 입력해 주세요.', 'warning'); return; }
    setDraftLoading(true);
    try {
      const r = await apiJson<{ draftContent: string; stepCount: number; summary: string }>(
        `/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/draft-steps`,
        { method: 'POST', body: JSON.stringify({ userId }) },
      );
      if (!r?.draftContent) throw new Error('AI 응답이 올바르지 않습니다.');
      const ok = await toastConfirm(`AI가 ${r.stepCount}개 STEP 초안을 생성했습니다.\n\n${r.summary}\n\n구조화 편집 모드로 전환하여 초안을 확인할까요?\n(현재 메뉴얼 내용은 이 초안으로 교체됩니다)`);
      if (!ok) return;
      setEditing(prev => prev ? { ...prev, content: r.draftContent } : prev);
      const forms = parseTextToStepForms(r.draftContent);
      switchToStructured(forms.length ? forms : undefined);
    } catch (e: any) {
      toast(e?.message || 'AI STEP 초안 생성에 실패했습니다.', 'error');
    } finally {
      setDraftLoading(false);
    }
  }

  function switchToText() {
    if (stepForms.length) {
      const text = serializeStepsToText(stepForms);
      setEditing((prev) => (prev ? { ...prev, content: text } : prev));
    }
    setEditMode('text');
  }

  async function insertAiFormatTemplate() {
    if (!editing) return;
    const title = String(editing.title || '').trim();
    const headerTitle = title ? `(${title})` : '(업무명)';
    const tpl = `[AI용 BPMN 메뉴얼 포맷 v1] ${headerTitle}

### STEP S1 | (단계 제목)
- taskType: WORKLOG
- 목적:
- 입력/필요자료(파일·양식·링크):
  -
- 산출물:
  -
- 업무일지(필수):
  - 기록할 내용:
    -
- 완료조건:
  -

### STEP S2 | 결재 요청
- taskType: APPROVAL
- 입력/필요자료(파일·양식·링크):
  -
- 완료조건:
  - 결재 완료
- 분기:
  - 승인: last.approval.status == 'APPROVED' -> S3
  - 반려: last.approval.status == 'REJECTED' -> S4

### STEP S3 | (승인 후)
- taskType: WORKLOG

### STEP S4 | (반려 후)
- taskType: WORKLOG

[조건식 규칙]
- 사용 가능 연산자: ==, !=, &&, ||
- 사용 가능 변수: last.approval.status, startedBy.role, itemCode, moldCode, carModelCode, initiativeId
`;

    const cur = String(editing.content || '');
    if (cur.trim().length > 0) {
      const ok = await toastConfirm('현재 메뉴얼 내용 뒤에 AI 포맷 템플릿을 추가할까요?');
      if (!ok) return;
    }
    setEditing((prev) => {
      if (!prev) return prev;
      const prevText = String(prev.content || '');
      const nextText = prevText.trim().length > 0 ? `${prevText.replace(/\s*$/, '')}\n\n${tpl}` : tpl;
      return { ...prev, content: nextText };
    });
  }

  function runValidate() {
    if (!editing) return;
    const r = validateManual(String(editing.content || ''));
    setValidation({ issues: r.issues });
    if (!r.issues.length) toast('메뉴얼 점검 결과: 문제를 찾지 못했습니다.', 'success');
  }

  async function aiMakeQuestions() {
    if (!userId) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (!editing?.id) {
      toast('먼저 메뉴얼을 저장해 주세요.', 'warning');
      return;
    }
    setAiQuestionsLoading(true);
    try {
      const r = await apiJson<AiQuestionsResult>(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/questions`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setAiQuestions({
        summary: String(r?.summary || '').trim(),
        issues: Array.isArray(r?.issues) ? r.issues : [],
        questions: Array.isArray(r?.questions) ? r.questions : [],
        score: r?.score,
        stepScores: r?.stepScores,
      });
      if (typeof r?.score === 'number') setQualityScore(r.score);
      if (Array.isArray(r?.stepScores)) setStepScores(r.stepScores);
      setQaRound(prev => prev + 1);
    } catch (e: any) {
      toast(e?.message || 'AI 보완 질문 생성에 실패했습니다.', 'error');
    } finally {
      setAiQuestionsLoading(false);
    }
  }

  async function save() {
    if (!userId) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (!editing) return;
    const title = String(editing.title || '').trim();
    if (!title) {
      toast('업무명을 입력하세요.', 'warning');
      return;
    }
    const content = editMode === 'structured' && stepForms.length
      ? serializeStepsToText(stepForms)
      : String(editing.content || '');
    if (editMode === 'structured' && stepForms.length) {
      setEditing((prev) => (prev ? { ...prev, content } : prev));
    }
    const authorName = String((editing as any)?.authorName ?? userName ?? '').trim();
    const authorTeamName = String((editing as any)?.authorTeamName ?? teamName ?? '').trim();
    setSaving(true);
    try {
      if (editing.id) {
        await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}`, {
          method: 'PUT',
          body: JSON.stringify({ userId, title, content, authorName, authorTeamName }),
        });
        await loadList(String(editing.id));
      } else {
        const created = await apiJson<WorkManualDto>(`/api/work-manuals`, {
          method: 'POST',
          body: JSON.stringify({ userId, title, content, authorName, authorTeamName }),
        });
        await loadList(String(created?.id || ''));
      }
      toast('저장되었습니다.', 'success');
    } catch (e: any) {
      toast(e?.message || '저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!userId) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (!editing?.id) return;
    const ok = await toastConfirm('이 메뉴얼을 삭제할까요?');
    if (!ok) return;
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await loadList('');
      toast('삭제되었습니다.', 'success');
    } catch (e: any) {
      toast(e?.message || '삭제에 실패했습니다.', 'error');
    }
  }

  async function aiToBpmn() {
    if (!userId) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (!editing?.id) {
      toast('먼저 메뉴얼을 저장해 주세요.', 'warning');
      return;
    }

    const v = validateManual(String(editing.content || ''));
    const mustIssues = v.issues.filter((x) => x.severity === 'MUST');
    const shouldIssues = v.issues.filter((x) => x.severity === 'SHOULD');
    if (mustIssues.length) {
      setValidation({ issues: v.issues });
      toast(`AI로 BPMN 생성 전에 반드시 수정해야 할 항목이 ${mustIssues.length}개 있습니다. 아래 “메뉴얼 점검 결과”를 확인해 주세요.`, 'error');
      return;
    }
    if (shouldIssues.length) {
      setValidation({ issues: v.issues });
      const ok = await toastConfirm(`AI로 BPMN 생성 전에 보완하면 좋은 항목이 ${shouldIssues.length}개 있습니다.\n\n그래도 AI로 BPMN 생성을 진행할까요?`);
      if (!ok) return;
    }

    setAiLoading(true);
    try {
      // ... (rest of the code remains the same)
      const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/bpmn`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      const tmplTitle = String(r?.title || '').trim();
      const bpmnJson = r?.bpmnJson;
      if (!tmplTitle || !bpmnJson) throw new Error('AI 응답이 올바르지 않습니다.');

      const ok = await toastConfirm(`AI가 BPMN 초안을 만들었습니다.\n\n템플릿 제목: ${tmplTitle}\n\n이 초안으로 프로세스 템플릿을 생성할까요?`);
      if (!ok) return;

      const created = await apiJson<any>(`/api/process-templates`, {
        method: 'POST',
        body: JSON.stringify({
          title: tmplTitle,
          description: '',
          type: 'PROJECT',
          ownerId: userId,
          actorId: userId,
          visibility: 'PRIVATE',
          bpmnJson,
          tasks: [],
        }),
      });
      const id = String(created?.id || '').trim();
      if (!id) throw new Error('템플릿 생성 응답이 올바르지 않습니다.');
      toast('프로세스 템플릿이 생성되었습니다.', 'success');
      nav(`/process/templates?openId=${encodeURIComponent(id)}`);
    } catch (e: any) {
      toast(e?.message || 'AI BPMN 생성에 실패했습니다.', 'error');
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' as any }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2 style={{ margin: 0 }}>업무 메뉴얼</h2>
          {selected && (
            <nav aria-label="메뉴얼 작성 단계" role="navigation" style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {[{n:1,l:'작성'},{n:2,l:'AI 분석/보완'},{n:3,l:'프로세스 생성'}].map((s, i) => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <div style={{ width: 24, height: 2, background: phase >= s.n ? '#0F3D73' : '#CBD5E1' }} aria-hidden="true" />}
                  <button type="button" onClick={() => setPhase(s.n as 1|2|3)}
                    aria-current={phase === s.n ? 'step' : undefined}
                    aria-label={`${s.n}단계: ${s.l}${phase === s.n ? ' (현재)' : phase > s.n ? ' (완료)' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: phase === s.n ? 800 : 500, border: 'none', cursor: 'pointer', minHeight: 36,
                      background: phase === s.n ? '#0F3D73' : phase > s.n ? '#E0E7FF' : '#F1F5F9',
                      color: phase === s.n ? '#fff' : phase > s.n ? '#0F3D73' : '#64748b' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', fontSize: 10, fontWeight: 800,
                      background: phase === s.n ? '#fff' : 'transparent', color: phase === s.n ? '#0F3D73' : 'inherit' }} aria-hidden="true">{s.n}</span>
                    {s.l}
                  </button>
                </div>
              ))}
            </nav>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as any }}>
          <button className="btn btn-outline" type="button" onClick={newManual}>새 메뉴얼</button>
          <button className="btn" type="button" onClick={save} disabled={saving || loading || !editing}>{saving ? '저장중…' : '저장'}</button>
          {editing?.id && <button className="btn btn-outline" type="button" onClick={remove} style={{ color: '#b91c1c' }}>삭제</button>}
        </div>
      </div>

      {!userId ? (
        <div style={{ color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, background: '#FFFFFF', padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontWeight: 800 }}>내 메뉴얼</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{loading ? '로딩…' : `${items.length}개`}</div>
            </div>
            <div style={{ display: 'grid', gap: 6, maxHeight: '70vh', overflowY: 'auto' }}>
              {items.map((m) => {
                const active = String(m.id || '') === String(selectedId || '');
                const title = String(m.title || '').trim() || '(제목 없음)';
                const excerpt = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
                return (
                  <button
                    key={String(m.id)}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => editManual(m)}
                    style={{
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      border: active ? '1px solid #0F3D73' : '1px solid transparent',
                      background: active ? '#EFF6FF' : 'transparent',
                      padding: '10px 10px',
                      borderRadius: 10,
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', flex: 1 }}>{title}</div>
                      {m.status && m.status !== 'DRAFT' && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                          background: m.status === 'APPROVED' ? '#DCFCE7' : m.status === 'REVIEW' ? '#DBEAFE' : m.status === 'REJECTED' ? '#FEE2E2' : '#F1F5F9',
                          color: m.status === 'APPROVED' ? '#16a34a' : m.status === 'REVIEW' ? '#2563eb' : m.status === 'REJECTED' ? '#dc2626' : '#64748b' }}>
                          {m.status === 'APPROVED' ? '승인' : m.status === 'REVIEW' ? '검토중' : m.status === 'REJECTED' ? '반려' : m.status}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{excerpt}</div>
                  </button>
                );
              })}
              {!items.length && !loading && (
                <div style={{ color: '#64748b', fontSize: 13 }}>아직 메뉴얼이 없습니다. “새 메뉴얼”을 눌러 작성해 주세요.</div>
              )}
            </div>
            {reviewQueue.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '1px solid #E5E7EB', paddingTop: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: '#2563eb', marginBottom: 6 }}>검토 요청 ({reviewQueue.length})</div>
                {reviewQueue.map(rq => (
                  <button key={String(rq.id)} type="button" className="btn btn-ghost" onClick={() => editManual(rq)}
                    style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '6px 8px', borderRadius: 8, display: 'grid', gap: 2, border: String(rq.id) === selectedId ? '1px solid #2563eb' : '1px solid transparent', background: String(rq.id) === selectedId ? '#EFF6FF' : 'transparent', width: '100%' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{String(rq.title || '').trim() || '(제목 없음)'}</div>
                    <div style={{ fontSize: 11, color: '#2563eb' }}>{rq.authorName} · {rq.qualityScore ?? 0}점</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...T.card, display: 'grid', gap: 10 }}>
            {!selected ? (
              <div style={{ color: T.muted }}>왼쪽에서 메뉴얼을 선택하거나 새로 만들어 주세요.</div>
            ) : <div key={`phase-${phase}`} style={{ animation: 'phase-fade 0.25s ease-out', display: 'grid', gap: 10 }}>{phase === 1 ? (
              <>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={T.label}>업무명</div>
                      <input value={selected.title} onChange={e => setEditing(p => p ? { ...p, title: e.target.value } : p)} placeholder="예: 금형 발주/관리" style={T.input} />
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={T.label}>작성자</div>
                      <input value={String((selected as any).authorName || '')} onChange={e => setEditing(p => p ? { ...p, authorName: e.target.value } : p)} placeholder="홍길동" style={T.input} />
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={T.label}>소속</div>
                      <input value={String((selected as any).authorTeamName || '')} onChange={e => setEditing(p => p ? { ...p, authorTeamName: e.target.value } : p)} placeholder="생산기술팀" style={T.input} />
                    </label>
                  </div>
                  {selected.createdAt && (
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#94a3b8' }}>
                      <span>작성: {formatKstDatetime(selected.createdAt)}</span>
                      <span>수정: {selected.updatedAt ? formatKstDatetime(selected.updatedAt) : '-'}</span>
                      <span>v{(selected as any).version ?? 1}</span>
                    </div>
                  )}
                </div>
                <div style={T.label}>업무 메뉴얼 내용</div>
                <textarea
                  value={String(selected.content || '')}
                  onChange={e => setEditing(p => p ? { ...p, content: e.target.value } : p)}
                  placeholder={'업무의 목적, 절차, 담당자, 필요 자료, 조건 등을 자유롭게 적어주세요.\n\n예시:\n- 금형 설계 도면 검토 후 발주서 작성\n- 협력사에 발주서 전달 및 납기 협의\n- 입고 시 품질 검사 후 결과 기록\n- 불합격 시 반품 처리 및 재발주'}
                  rows={16}
                  style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '10px 12px', resize: 'vertical' as any, lineHeight: 1.6, fontSize: 14 }}
                />
                <div style={{ ...T.textSm, lineHeight: 1.5 }}>
                  자유로운 형식으로 작성하세요. 다음 단계에서 AI가 분석하여 프로세스 단계로 자동 분해합니다.
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn" type="button"
                    disabled={!String(selected.content || '').trim() || !editing?.id || draftLoading}
                    onClick={async () => {
                      if (!editing?.id) { await save(); }
                      if (!editing?.id) return;
                      setDraftLoading(true);
                      try {
                        const r = await apiJson<{ draftContent: string; stepCount: number; summary: string }>(
                          `/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/draft-steps`,
                          { method: 'POST', body: JSON.stringify({ userId }) },
                        );
                        if (!r?.draftContent) throw new Error('AI 응답 오류');
                        setEditing(p => p ? { ...p, content: r.draftContent } : p);
                        const forms = parseTextToStepForms(r.draftContent);
                        setStepForms(forms.length ? forms : [makeEmptyStep(1)]);
                        setEditMode('structured');
                        setPhase(2);
                        void aiMakeQuestions();
                      } catch (e: any) { toast(e?.message || 'AI 분석에 실패했습니다.', 'error'); }
                      finally { setDraftLoading(false); }
                    }}
                    style={{ padding: '8px 20px' }}
                  >
                    {draftLoading ? 'AI 분석중…' : '다음: AI 분석 →'}
                  </button>
                </div>
              </>
            ) : phase === 2 ? (
              <>
                {qualityScore !== null && (
                  <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, background: '#fff', padding: '10px 14px', display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>매뉴얼 완성도</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {qaRound > 0 && <span style={{ fontSize: 11, color: '#64748b' }}>{qaRound}차 보완</span>}
                        <span style={{ fontWeight: 800, fontSize: 15, color: qualityScore >= 70 ? '#16a34a' : qualityScore >= 40 ? '#ca8a04' : '#dc2626' }}>{qualityScore}점</span>
                      </div>
                    </div>
                    <div style={{ height: 8, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(qualityScore, 100)}%`, borderRadius: 4, transition: 'width 0.5s ease',
                        background: qualityScore >= 70 ? '#16a34a' : qualityScore >= 40 ? '#ca8a04' : '#dc2626' }} />
                    </div>
                    {stepScores.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as any, marginTop: 2 }}>
                        {stepScores.map(ss => (
                          <span key={ss.stepId} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10,
                            background: ss.score >= 70 ? '#F0FDF4' : ss.score >= 40 ? '#FFFBEB' : '#FEF2F2',
                            color: ss.score >= 70 ? '#16a34a' : ss.score >= 40 ? '#92400E' : '#dc2626' }}>
                            {ss.stepId} {ss.score}점
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>프로세스 단계 편집</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className={editMode === 'structured' ? 'btn btn-sm' : 'btn btn-sm btn-outline'} type="button"
                      onClick={() => { if (editMode !== 'structured') switchToStructured(); }} style={{ fontSize: 12, padding: '4px 10px' }}>구조화</button>
                    <button className={editMode === 'text' ? 'btn btn-sm' : 'btn btn-sm btn-outline'} type="button"
                      onClick={() => { if (editMode !== 'text') switchToText(); }} style={{ fontSize: 12, padding: '4px 10px' }}>텍스트</button>
                    <button className="btn btn-sm btn-outline" type="button" onClick={aiMakeQuestions} disabled={!editing?.id || aiQuestionsLoading}
                      style={{ fontSize: 12, padding: '4px 10px' }}>{aiQuestionsLoading ? '분석중…' : 'AI 재분석'}</button>
                  </div>
                </div>
                {prevContent !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                    <span style={{ color: '#92400E' }}>AI가 메뉴얼을 수정했습니다.</span>
                    <button className="btn btn-sm btn-outline" type="button" style={{ fontSize: 11, padding: '2px 10px', color: '#92400E', borderColor: '#FCD34D' }}
                      onClick={() => { setEditing(p => p ? { ...p, content: prevContent } : p); setStepForms(parseTextToStepForms(prevContent)); setPrevContent(null); toast('이전 내용으로 되돌렸습니다.', 'info'); }}>
                      되돌리기
                    </button>
                  </div>
                )}
                {editMode === 'structured' ? (
                  <StepFormEditor steps={stepForms} onChange={setStepForms} validationIssues={validation?.issues} />
                ) : (
                  <textarea value={String(selected.content || '')} onChange={e => setEditing(p => p ? { ...p, content: e.target.value } : p)} rows={14}
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px', resize: 'vertical' as any, fontSize: 13 }} />
                )}
                {aiQuestions && !!aiQuestions.questions.length && (
                  <div style={{ border: '1px solid #E0E7FF', borderRadius: 10, background: '#F8FAFC', padding: 12, display: 'grid', gap: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>AI가 추가 정보를 요청합니다 ({aiQuestions.questions.length}개)</div>
                    {aiQuestions.summary && <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{aiQuestions.summary}</div>}
                    {aiQuestions.questions.map((q, idx) => {
                      const isFile = isFileField(q);
                      const links = answerLinks[idx] || [];
                      return (
                        <div key={idx} style={{ display: 'grid', gap: 5, background: '#fff', borderRadius: 8, padding: '8px 10px', border: '1px solid #E5E7EB' }}>
                          <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 800, color: q.source === 'rule' ? '#b45309' : '#6366f1', fontSize: 10, background: q.source === 'rule' ? '#FEF3C7' : '#EEF2FF', borderRadius: 3, padding: '1px 4px', marginRight: 4 }}>{q.source === 'rule' ? '규칙' : 'AI'}</span>
                            <span style={{ fontWeight: 800, color: q.severity === 'MUST' ? '#b91c1c' : '#6366f1', fontSize: 11 }}>{q.severity}</span>
                            {q.targetStepId && <span style={{ marginLeft: 6, fontSize: 11, background: '#E0E7FF', color: '#3730a3', borderRadius: 4, padding: '1px 5px' }}>{q.targetStepId}</span>}
                            {q.targetField && <span style={{ marginLeft: 4, fontSize: 11, background: isFile ? '#FEF9C3' : '#F0FDF4', color: isFile ? '#92400E' : '#166534', borderRadius: 4, padding: '1px 5px' }}>{q.targetField}{isFile ? ' 📎' : ''}</span>}
                            <span style={{ marginLeft: 6 }}>{q.question}</span>
                          </div>
                          {isFile ? (
                            <div style={{ display: 'grid', gap: 4 }}>
                              {links.map((lk, li) => (
                                <div key={li} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#0369a1' }}>
                                  <a href={lk.url} target="_blank" rel="noreferrer" style={{ color: '#0369a1' }}>📎 {lk.name || lk.url}</a>
                                  <button type="button" style={{ fontSize: 10, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}
                                    onClick={() => setAnswerLinks(prev => ({ ...prev, [idx]: (prev[idx] || []).filter((_, i) => i !== li) }))}>✕</button>
                                </div>
                              ))}
                              <div style={{ display: 'flex', gap: 4 }}>
                                <input id={`ln-${idx}`} placeholder="파일명" style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 6px', fontSize: 12, width: 120 }} />
                                <input id={`lu-${idx}`} placeholder="OneDrive 링크" style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 6px', fontSize: 12, flex: 1 }} />
                                <button type="button" className="btn btn-outline" style={{ fontSize: 11, padding: '3px 8px' }}
                                  onClick={() => {
                                    const ne = document.getElementById(`ln-${idx}`) as HTMLInputElement;
                                    const ue = document.getElementById(`lu-${idx}`) as HTMLInputElement;
                                    const url = (ue?.value || '').trim(); const name = (ne?.value || '').trim() || url;
                                    if (!url) return;
                                    setAnswerLinks(prev => ({ ...prev, [idx]: [...(prev[idx] || []), { name, url }] }));
                                    if (ne) ne.value = ''; if (ue) ue.value = '';
                                    setAnswers(prev => ({ ...prev, [idx]: [...links, { name, url }].map(l => `[${l.name}](${l.url})`).join(', ') }));
                                  }}>추가</button>
                              </div>
                            </div>
                          ) : (
                            <input value={answers[idx] || ''} onChange={e => setAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                              placeholder="답변 (모름/없음 시 건너뜀)" style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }} />
                          )}
                        </div>
                      );
                    })}
                    <button className="btn" type="button" disabled={applyLoading || !Object.values(answers).some(v => v.trim())}
                      onClick={async () => {
                        if (!editing?.id || !aiQuestions) return;
                        setApplyLoading(true);
                        try {
                          setPrevContent(String(editing.content || ''));
                          const toApply = aiQuestions.questions.map((q, i) => ({
                            targetStepId: q.targetStepId, targetField: q.targetField, question: q.question, answer: answers[i] || '',
                          })).filter(a => a.answer.trim());
                          const r = await apiJson<{ summary: string; appliedCount: number; updatedContent: string; version: number; remainingIssues?: any[]; score?: number; stepScores?: StepScore[] }>(
                            `/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/apply-answers`,
                            { method: 'POST', body: JSON.stringify({ userId, answers: toApply }) },
                          );
                          setEditing(p => p ? { ...p, content: r.updatedContent, version: r.version } : p);
                          setStepForms(parseTextToStepForms(r.updatedContent));
                          setAnswers({}); setAnswerLinks({});
                          if (typeof r?.score === 'number') setQualityScore(r.score);
                          if (Array.isArray(r?.stepScores)) setStepScores(r.stepScores);
                          const remainCount = Array.isArray(r?.remainingIssues) ? r.remainingIssues.length : 0;
                          toast(`${r.appliedCount}개 항목 반영 완료! — ${r.summary}${remainCount > 0 ? ` (보완 가능 항목 ${remainCount}개 남음)` : ''}`, 'success', 6000);
                          if (remainCount > 0) {
                            setAiQuestions(prev => prev ? { ...prev, questions: (r.remainingIssues || []).map((q: any) => ({ ...q, targetStepId: q.stepId, source: q.source || 'rule' })), score: r.score, stepScores: r.stepScores } : prev);
                          } else {
                            setAiQuestions(null);
                          }
                        } catch (e: any) { toast(e?.message || 'AI 반영에 실패했습니다.', 'error'); }
                        finally { setApplyLoading(false); }
                      }}
                      style={{ justifySelf: 'start', fontSize: 13 }}
                    >{applyLoading ? 'AI 반영중…' : `AI 자동반영 (${Object.values(answers).filter(v => v.trim()).length}개)`}</button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button className="btn btn-outline" type="button" onClick={() => { switchToText(); setPhase(1); }}>← 이전: 작성</button>
                  <button className="btn" type="button" onClick={() => { if (editMode === 'structured' && stepForms.length) { setEditing(p => p ? { ...p, content: serializeStepsToText(stepForms) } : p); } setPhase(3); }}
                    style={{ padding: '8px 20px' }}>다음: 프로세스 생성 →</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>최종 검토 및 프로세스 생성</div>
                  {selected.status && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                      background: selected.status === 'APPROVED' ? '#DCFCE7' : selected.status === 'REVIEW' ? '#DBEAFE' : selected.status === 'REJECTED' ? '#FEE2E2' : '#F1F5F9',
                      color: selected.status === 'APPROVED' ? '#16a34a' : selected.status === 'REVIEW' ? '#2563eb' : selected.status === 'REJECTED' ? '#dc2626' : '#64748b' }}>
                      {selected.status === 'APPROVED' ? '승인됨' : selected.status === 'REVIEW' ? '검토 대기중' : selected.status === 'REJECTED' ? '반려됨' : '초안'}
                    </span>
                  )}
                </div>

                {selected.status === 'REJECTED' && selected.reviewComment && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#dc2626', marginBottom: 4 }}>반려 사유</div>
                    <div style={{ fontSize: 13, color: '#0f172a' }}>{selected.reviewComment}</div>
                    <button className="btn btn-sm btn-outline" type="button" style={{ marginTop: 6, fontSize: 11 }} disabled={statusLoading}
                      onClick={revertToDraft}>{statusLoading ? '처리중…' : '초안으로 되돌려 수정하기'}</button>
                  </div>
                )}

                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                  {selected.status === 'APPROVED'
                    ? '매뉴얼이 승인되었습니다. AI로 프로세스 템플릿을 생성할 수 있습니다.'
                    : selected.status === 'REVIEW'
                    ? '팀장 검토 대기 중입니다. 승인되면 프로세스를 생성할 수 있습니다.'
                    : '아래 메뉴얼 내용을 확인 후, 팀장에게 검토를 요청하세요. 승인 후 프로세스를 생성할 수 있습니다.'}
                </div>
                <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{selected.title || '(업무명 없음)'}</div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, color: '#0f172a', margin: 0, maxHeight: 400, overflow: 'auto' }}>{String(selected.content || '').trim() || '(내용 없음)'}</pre>
                </div>
                {(() => { const v = validateManual(String(selected.content || '')); const musts = v.issues.filter(x => x.severity === 'MUST'); return musts.length > 0 ? (
                  <div style={{ background: '#FEF2F2', borderRadius: 8, padding: 10, display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#b91c1c' }}>필수 수정 사항 ({musts.length}개)</div>
                    {musts.map((it, i) => <div key={i} style={{ fontSize: 12, color: '#b91c1c' }}>{it.stepId ? `[${it.stepId}] ` : ''}{it.issue}</div>)}
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>이전 단계에서 수정한 뒤 다시 시도하세요.</div>
                  </div>
                ) : null; })()}

                {/* 검토자인 경우: 승인/반려 버튼 */}
                {selected.status === 'REVIEW' && selected.reviewerId === userId && (
                  <div style={{ border: '1px solid #DBEAFE', borderRadius: 10, background: '#EFF6FF', padding: 12, display: 'grid', gap: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#1d4ed8' }}>검토 결정</div>
                    <textarea id="review-comment" placeholder="코멘트 (선택)" rows={2}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '6px 8px', fontSize: 13, resize: 'vertical' as any }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" type="button" disabled={statusLoading} style={{ background: '#16a34a', color: '#fff' }}
                        onClick={() => reviewDecision(String(selected.id), 'APPROVED', (document.getElementById('review-comment') as HTMLTextAreaElement)?.value)}>
                        {statusLoading ? '처리중…' : '승인'}
                      </button>
                      <button className="btn btn-outline" type="button" disabled={statusLoading} style={{ color: '#dc2626', borderColor: '#dc2626' }}
                        onClick={() => reviewDecision(String(selected.id), 'REJECTED', (document.getElementById('review-comment') as HTMLTextAreaElement)?.value)}>
                        {statusLoading ? '처리중…' : '반려'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 검토 요청 (DRAFT 또는 REJECTED 상태) */}
                {(!selected.status || selected.status === 'DRAFT' || selected.status === 'REJECTED') && selected.userId === userId && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {!reviewerPickOpen ? (
                      <button className="btn btn-outline" type="button" onClick={() => setReviewerPickOpen(true)} disabled={statusLoading}
                        style={{ justifySelf: 'start', color: '#2563eb', borderColor: '#2563eb' }}>팀장에게 검토 요청</button>
                    ) : (
                      <div style={{ border: '1px solid #DBEAFE', borderRadius: 8, background: '#F8FAFC', padding: 10, display: 'grid', gap: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>검토자 선택</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as any }}>
                          {orgUsers.filter(u => u.id !== userId && ['CEO', 'EXEC', 'MANAGER'].includes(u.role)).map(u => (
                            <button key={u.id} className="btn btn-sm btn-outline" type="button" disabled={statusLoading}
                              onClick={() => requestReview(u.id)} style={{ fontSize: 12 }}>{u.name} ({u.role})</button>
                          ))}
                          {orgUsers.filter(u => u.id !== userId && ['CEO', 'EXEC', 'MANAGER'].includes(u.role)).length === 0 && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>검토 가능한 관리자가 없습니다.</div>
                          )}
                        </div>
                        <button className="btn btn-sm btn-outline" type="button" onClick={() => setReviewerPickOpen(false)} style={{ justifySelf: 'start', fontSize: 11 }}>취소</button>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button className="btn btn-outline" type="button" onClick={() => setPhase(2)}>← 이전: AI 분석/보완</button>
                  {selected.status === 'APPROVED' ? (
                    <button className="btn" type="button" onClick={aiToBpmn} disabled={aiLoading} style={{ padding: '8px 20px' }}>
                      {aiLoading ? '프로세스 생성중…' : 'AI로 프로세스 템플릿 생성'}
                    </button>
                  ) : (
                    <button className="btn" type="button" disabled style={{ padding: '8px 20px', opacity: 0.5 }}>
                      승인 후 프로세스 생성 가능
                    </button>
                  )}
                </div>
              </>
            )}</div>}
          </div>
        </div>
      )}
      <style>{`@keyframes phase-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
