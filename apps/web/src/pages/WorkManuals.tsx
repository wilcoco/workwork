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
  layerScore?: number | null;
  layer?: string | null;
  layerLabel?: string | null;
  stepScores?: StepScore[];
};

const LAYERS = ['skeleton', 'roles', 'io', 'decisions', 'exceptions', 'timing'] as const;
type LayerKey = typeof LAYERS[number];
const LAYER_META: Record<LayerKey, { label: string; icon: string; desc: string }> = {
  skeleton:   { label: '프로세스 골격',       icon: '1', desc: '단계 구조, 순서, 시작/끝' },
  roles:      { label: '역할과 담당자',       icon: '2', desc: '담당자, 결재자, 협조 대상' },
  io:         { label: '입력물/산출물',       icon: '3', desc: '필요 자료, 도구, 산출물' },
  decisions:  { label: '판단과 분기',         icon: '4', desc: '조건 분기, 완료 기준' },
  exceptions: { label: '예외와 에스컬레이션', icon: '5', desc: '이상 대응, 위험 요소' },
  timing:     { label: '시간과 SLA',         icon: '6', desc: '기한, SLA, 알림' },
};

type ManualTemplate = {
  docName: string;
  docNumber: string;
  department: string;
  approver: string;
  applicableSystem: string;
  purpose: string;
  scope: string;
  overview: string;
  triggerTiming: string;
  relatedDepts: string;
  relatedSystems: string;
  processFlow: string;
  systemProcedure: string;
  dataDefinition: string;
  responsibilities: string;
  exceptionHandling: string;
  relatedDocs: string;
  erpScreens: Array<{ imageUrl: string; description: string }>;
};

const EMPTY_TPL: ManualTemplate = {
  docName: '', docNumber: '', department: '', approver: '', applicableSystem: '',
  purpose: '', scope: '', overview: '', triggerTiming: '', relatedDepts: '',
  relatedSystems: '', processFlow: '', systemProcedure: '', dataDefinition: '',
  responsibilities: '', exceptionHandling: '', relatedDocs: '',
  erpScreens: [],
};

function serializeTemplate(tpl: ManualTemplate, title: string, author: string): string {
  return [
    '## 1. 기본 정보', `- 문서명: ${tpl.docName || title}`, `- 문서번호: ${tpl.docNumber}`,
    `- 업무명: ${title}`, `- 부서: ${tpl.department}`, `- 작성자: ${author}`,
    `- 승인자: ${tpl.approver}`, `- 적용 시스템: ${tpl.applicableSystem}`,
    '', '## 2. 업무 목적', tpl.purpose,
    '', '## 3. 적용 범위', tpl.scope,
    '', '## 4. 업무 개요', `- 업무 설명: ${tpl.overview}`, `- 업무 발생 시점: ${tpl.triggerTiming}`,
    `- 관련 부서: ${tpl.relatedDepts}`, `- 관련 시스템: ${tpl.relatedSystems}`,
    '', '## 5. 업무 흐름', tpl.processFlow,
    '', '## 6. 관련 데이터 정의', tpl.systemProcedure,
    '', '## 7. 데이터 저장 방식 및 접근 방법', tpl.dataDefinition,
    '', '## 8. ERP 화면 설명',
    ...(tpl.erpScreens.length ? tpl.erpScreens.map((s, i) =>
      `[화면 ${i + 1}]\n- 이미지: ${s.imageUrl}\n- 설명: ${s.description}`
    ) : ['']),
    '', '## 9. 업무 담당자', tpl.responsibilities,
    '', '## 10. 예외 처리', tpl.exceptionHandling,
    '', '## 11. 관련 문서', tpl.relatedDocs,
  ].join('\n');
}

function parseTemplateFromContent(content: string): ManualTemplate | null {
  if (!content.includes('## 1. 기본 정보')) return null;
  const tpl = { ...EMPTY_TPL };
  const sec = (hdr: string, next?: string): string => {
    const i = content.indexOf(hdr); if (i < 0) return '';
    const s = i + hdr.length;
    const e = next ? content.indexOf(next, s) : content.length;
    return content.slice(s, e >= 0 ? e : content.length).trim();
  };
  const fld = (block: string, name: string): string => {
    const m = block.match(new RegExp(`-\\s*${name}\\s*:\\s*(.*)`));
    return m ? m[1].trim() : '';
  };
  const s1 = sec('## 1. 기본 정보', '## 2.');
  tpl.docName = fld(s1, '문서명'); tpl.docNumber = fld(s1, '문서번호');
  tpl.department = fld(s1, '부서'); tpl.approver = fld(s1, '승인자');
  tpl.applicableSystem = fld(s1, '적용 시스템');
  tpl.purpose = sec('## 2. 업무 목적', '## 3.');
  tpl.scope = sec('## 3. 적용 범위', '## 4.');
  const s4 = sec('## 4. 업무 개요', '## 5.');
  tpl.overview = fld(s4, '업무 설명'); tpl.triggerTiming = fld(s4, '업무 발생 시점');
  tpl.relatedDepts = fld(s4, '관련 부서'); tpl.relatedSystems = fld(s4, '관련 시스템');
  tpl.processFlow = sec('## 5. 업무 흐름', '## 6.');
  tpl.systemProcedure = sec('## 6. 관련 데이터 정의', '## 7.');
  tpl.dataDefinition = sec('## 7. 데이터 저장 방식 및 접근 방법', '## 8.');
  const erpRaw = sec('## 8. ERP 화면 설명', '## 9.');
  if (erpRaw) {
    tpl.erpScreens = erpRaw.split(/\[화면\s*\d+\]/).filter(b => b.trim()).map(block => ({
      imageUrl: fld(block, '이미지'),
      description: fld(block, '설명'),
    }));
  }
  tpl.responsibilities = sec('## 9. 업무 담당자', '## 10.');
  tpl.exceptionHandling = sec('## 10. 예외 처리', '## 11.');
  tpl.relatedDocs = sec('## 11. 관련 문서');
  return tpl;
}

function templateToStepForms(tpl: ManualTemplate): StepFormData[] {
  const flowLines = tpl.processFlow.split('\n').map(l => l.trim())
    .filter(l => /^\d+\.?\s/.test(l) || /^-\s/.test(l));
  if (!flowLines.length) return [makeEmptyStep(1)];
  return flowLines.map((line, i) => {
    const title = line.replace(/^\d+\.?\s*/, '').replace(/^-\s*/, '').trim();
    const step = makeEmptyStep(i + 1);
    step.title = title; step.taskType = 'WORKLOG';
    if (i === 0) step.purpose = tpl.purpose;
    return step;
  });
}

const MIN_QUALITY_SCORE = 60;

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
  const [template, setTemplate] = useState<ManualTemplate>({ ...EMPTY_TPL });
  const [approverOpen, setApproverOpen] = useState(false);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [qaRound, setQaRound] = useState(0);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [stepScores, setStepScores] = useState<StepScore[]>([]);
  const [reviewQueue, setReviewQueue] = useState<WorkManualDto[]>([]);
  const [orgUsers, setOrgUsers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [reviewerPickOpen, setReviewerPickOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [qaStep, setQaStep] = useState<'feedback' | 'input'>('feedback');
  const [currentLayer, setCurrentLayer] = useState<LayerKey>('skeleton');
  const [layerScores, setLayerScores] = useState<Record<string, number>>({});
  const [layerDone, setLayerDone] = useState<Set<string>>(new Set());

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
    setTemplate({ ...EMPTY_TPL });
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
    setTemplate({ ...EMPTY_TPL });
    setStepForms([makeEmptyStep(1)]);
    setEditMode('structured');
    setPhase(1);
    setAiQuestions(null);
  }

  function editManual(m: WorkManualDto) {
    setSelectedId(String(m.id || ''));
    setEditing({ ...m, content: m.content || '', authorName: m.authorName || '', authorTeamName: m.authorTeamName || '' });
    const content = m.content || '';
    const parsed = parseTemplateFromContent(content);
    if (parsed) {
      setTemplate(parsed);
      setPhase(1);
    } else {
      setTemplate({ ...EMPTY_TPL });
      const forms = parseTextToStepForms(content);
      setStepForms(forms.length ? forms : [makeEmptyStep(1)]);
      setEditMode('structured');
      setPhase(forms.length ? 2 : 1);
    }
    setAiQuestions(null);
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

  async function aiMakeQuestions(layer?: LayerKey) {
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
      const body: any = { userId };
      if (layer) body.layer = layer;
      const r = await apiJson<AiQuestionsResult>(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/questions`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAiQuestions({
        summary: String(r?.summary || '').trim(),
        issues: Array.isArray(r?.issues) ? r.issues : [],
        questions: Array.isArray(r?.questions) ? r.questions : [],
        score: r?.score,
        layerScore: r?.layerScore,
        layer: r?.layer,
        layerLabel: r?.layerLabel,
        stepScores: r?.stepScores,
      });
      if (typeof r?.score === 'number') setQualityScore(r.score);
      if (Array.isArray(r?.stepScores)) setStepScores(r.stepScores);
      if (layer && typeof r?.layerScore === 'number') {
        setLayerScores(prev => ({ ...prev, [layer]: r.layerScore as number }));
      }
      setQaRound(prev => prev + 1);
      setQaStep('feedback');
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
    const authorName = String((editing as any)?.authorName ?? userName ?? '').trim();
    const content = phase === 1
      ? serializeTemplate(template, title, authorName)
      : editMode === 'structured' && stepForms.length
        ? serializeStepsToText(stepForms)
        : String(editing.content || '');
    if (editMode === 'structured' && stepForms.length) {
      setEditing((prev) => (prev ? { ...prev, content } : prev));
    }
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
              {[{n:1,l:'템플릿 입력'},{n:2,l:'프로세스 단계'},{n:3,l:'검토/생성'}].map((s, i) => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <div style={{ width: 24, height: 2, background: phase >= s.n ? '#0F3D73' : '#CBD5E1' }} aria-hidden="true" />}
                  <button type="button" onClick={() => setPhase(s.n as 1 | 2 | 3)}
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
          <button className="btn" type="button" onClick={() => nav('/manuals/ext')} style={{ background: '#7c3aed', color: '#fff' }}>AI 매뉴얼 외재화</button>
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
                {/* ====== Phase 1: 제조업 표준 매뉴얼 템플릿 ====== */}
                {/* --- 1. 업무 정의 --- */}
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', borderBottom: '2px solid #0F3D73', paddingBottom: 4 }}>1. 업무 정의</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>업무명</div>
                      <input value={selected.title} onChange={e => setEditing(p => p ? { ...p, title: e.target.value } : p)} placeholder="예: 생산실적 입력" style={T.input} />
                    </label>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>작성자</div>
                      <input value={String((selected as any).authorName || '')} onChange={e => setEditing(p => p ? { ...p, authorName: e.target.value } : p)} placeholder="홍길동" style={T.input} />
                    </label>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>소속(부서)</div>
                      <input value={String((selected as any).authorTeamName || '')} onChange={e => setEditing(p => p ? { ...p, authorTeamName: e.target.value } : p)} placeholder="생산기술팀" style={T.input} />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>문서명</div>
                      <input value={template.docName} onChange={e => setTemplate(p => ({ ...p, docName: e.target.value }))} placeholder="생산실적 입력 매뉴얼" style={T.input} />
                    </label>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>문서번호</div>
                      <input value={template.docNumber} onChange={e => setTemplate(p => ({ ...p, docNumber: e.target.value }))} placeholder="PRD-MAN-001" style={T.input} />
                    </label>
                    <div style={{ display: 'grid', gap: 3, position: 'relative' as any }}>
                      <div style={T.label}>승인자</div>
                      <input value={template.approver}
                        onChange={e => { setTemplate(p => ({ ...p, approver: e.target.value })); setApproverOpen(true); }}
                        onFocus={() => setApproverOpen(true)}
                        placeholder="이름 검색" style={T.input} autoComplete="off" />
                      {approverOpen && (() => {
                        const q = template.approver.trim().toLowerCase();
                        const filtered = orgUsers.filter(u => !q || u.name.toLowerCase().includes(q));
                        if (!filtered.length) return null;
                        return (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
                            {filtered.map(u => (
                              <button key={u.id} type="button"
                                onMouseDown={e => { e.preventDefault(); setTemplate(p => ({ ...p, approver: u.name })); setApproverOpen(false); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#EFF6FF')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                <span style={{ fontWeight: 600 }}>{u.name}</span>
                                <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>{u.role}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>적용 시스템</div>
                      <input value={template.applicableSystem} onChange={e => setTemplate(p => ({ ...p, applicableSystem: e.target.value }))} placeholder="ERP / MES / WMS" style={T.input} />
                    </label>
                  </div>
                  {selected.createdAt && (
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#94a3b8' }}>
                      <span>작성: {formatKstDatetime(selected.createdAt)}</span>
                      <span>수정: {selected.updatedAt ? formatKstDatetime(selected.updatedAt) : '-'}</span>
                      <span>v{(selected as any).version ?? 1}</span>
                    </div>
                  )}
                  <label style={{ display: 'grid', gap: 3 }}>
                    <div style={T.label}>업무 목적</div>
                    <textarea value={template.purpose} onChange={e => setTemplate(p => ({ ...p, purpose: e.target.value }))}
                      placeholder="예: 생산 실적을 정확히 관리하기 위함" rows={2} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13 }} />
                  </label>
                  <label style={{ display: 'grid', gap: 3 }}>
                    <div style={T.label}>적용 범위</div>
                    <textarea value={template.scope} onChange={e => setTemplate(p => ({ ...p, scope: e.target.value }))}
                      placeholder="예: 생산팀, 자재팀, 품질관리팀" rows={2} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13 }} />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>업무 설명</div>
                      <textarea value={template.overview} onChange={e => setTemplate(p => ({ ...p, overview: e.target.value }))}
                        placeholder="업무의 전체 흐름 설명" rows={2} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13 }} />
                    </label>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>업무 발생 시점</div>
                      <textarea value={template.triggerTiming} onChange={e => setTemplate(p => ({ ...p, triggerTiming: e.target.value }))}
                        placeholder="예: 매일 생산 완료 후" rows={2} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13 }} />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>관련 부서</div>
                      <input value={template.relatedDepts} onChange={e => setTemplate(p => ({ ...p, relatedDepts: e.target.value }))} placeholder="생산팀, 품질팀" style={T.input} />
                    </label>
                    <label style={{ display: 'grid', gap: 3 }}>
                      <div style={T.label}>관련 시스템</div>
                      <input value={template.relatedSystems} onChange={e => setTemplate(p => ({ ...p, relatedSystems: e.target.value }))} placeholder="ERP, MES" style={T.input} />
                    </label>
                  </div>
                </div>

                {/* --- 2. 업무 흐름 --- */}
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', borderBottom: '2px solid #0F3D73', paddingBottom: 4 }}>2. 업무 흐름</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>번호 목록으로 업무의 전체 흐름을 적어주세요. (프로세스 단계로 자동 변환됩니다)</div>
                  <textarea value={template.processFlow} onChange={e => setTemplate(p => ({ ...p, processFlow: e.target.value }))}
                    placeholder={'1. 생산 계획 확인\n2. 작업 지시 등록\n3. 생산 작업 수행\n4. 생산 실적 입력\n5. 품질 검사\n6. 재고 반영'}
                    rows={6} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                </div>

                {/* --- 3. 관련 데이터 정의 --- */}
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', borderBottom: '2px solid #0F3D73', paddingBottom: 4 }}>3. 관련 데이터 정의</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>업무에 사용되는 데이터 항목, 코드, 필수 여부 등을 정리하세요.</div>
                  <textarea value={template.systemProcedure} onChange={e => setTemplate(p => ({ ...p, systemProcedure: e.target.value }))}
                    placeholder={'- 품목코드: 제품 식별 코드 (필수)\n- 작업지시번호: 생산 지시 번호 (필수)\n- 생산수량: 생산 수량 (필수)\n- 불량수량: 불량 발생 수량 (선택)\n- 작업자: 작업 담당자 (선택)\n- LOT번호: 추적 관리용 (필수)'}
                    rows={6} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                </div>

                {/* --- 4. 데이터 저장 방식 및 접근 방법 --- */}
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', borderBottom: '2px solid #0F3D73', paddingBottom: 4 }}>4. 데이터 저장 방식 및 접근 방법</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>데이터가 저장되는 시스템, 테이블/화면, 접근 경로 등을 기술하세요.</div>
                  <textarea value={template.dataDefinition} onChange={e => setTemplate(p => ({ ...p, dataDefinition: e.target.value }))}
                    placeholder={'- 저장 시스템: ERP (SAP)\n- 메뉴 경로: 생산관리 → 생산실적 입력\n- 테이블/화면: PPORD (생산 오더)\n- 접근 권한: 생산팀 전원 (조회), 관리자 (수정)\n- 백업 주기: 일 1회 자동 백업'}
                    rows={5} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                </div>

                {/* --- 5. ERP 화면 설명 --- */}
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', borderBottom: '2px solid #0F3D73', paddingBottom: 4 }}>5. ERP 화면 설명</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>ERP/MES 화면을 순서대로 설명하세요. 좌측에 화면 이미지 URL, 우측에 조작 방법을 입력합니다.</div>
                    </div>
                    <button className="btn btn-sm btn-outline" type="button"
                      onClick={() => setTemplate(p => ({ ...p, erpScreens: [...p.erpScreens, { imageUrl: '', description: '' }] }))}
                      style={{ fontSize: 11, whiteSpace: 'nowrap' as any }}>+ 화면 추가</button>
                  </div>
                  {template.erpScreens.length === 0 && (
                    <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center' as any, padding: 16, border: '1px dashed #CBD5E1', borderRadius: 8 }}>
                      아직 등록된 화면이 없습니다. "화면 추가" 버튼을 눌러 ERP 화면을 추가하세요.
                    </div>
                  )}
                  {template.erpScreens.map((scr, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, background: '#FAFBFC' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontWeight: 700, fontSize: 12, color: '#374151' }}>화면 {idx + 1} — 이미지</div>
                          <button type="button" onClick={() => setTemplate(p => ({ ...p, erpScreens: p.erpScreens.filter((_, i) => i !== idx) }))}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>삭제</button>
                        </div>
                        <input value={scr.imageUrl}
                          onChange={e => setTemplate(p => ({ ...p, erpScreens: p.erpScreens.map((s, i) => i === idx ? { ...s, imageUrl: e.target.value } : s) }))}
                          placeholder="이미지 URL (예: https://drive.google.com/...)" style={T.input} />
                        {scr.imageUrl && (
                          <div style={{ border: '1px solid #E5E7EB', borderRadius: 6, overflow: 'hidden', maxHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                            <img src={scr.imageUrl} alt={`화면 ${idx + 1}`}
                              style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' as any }}
                              onError={e => (e.currentTarget.style.display = 'none')} />
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#374151' }}>화면 {idx + 1} — 조작 방법</div>
                        <textarea value={scr.description}
                          onChange={e => setTemplate(p => ({ ...p, erpScreens: p.erpScreens.map((s, i) => i === idx ? { ...s, description: e.target.value } : s) }))}
                          placeholder={'1. 메뉴에서 [생산관리] > [생산실적] 클릭\n2. 작업지시 번호를 선택\n3. 생산수량 입력\n4. [저장] 클릭'}
                          rows={6} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* --- 6. 예외 처리 / 담당자 / 관련 문서 --- */}
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', borderBottom: '2px solid #0F3D73', paddingBottom: 4 }}>6. 예외 처리 · 담당자 · 관련 문서</div>
                  <label style={{ display: 'grid', gap: 3 }}>
                    <div style={T.label}>업무 담당자</div>
                    <textarea value={template.responsibilities} onChange={e => setTemplate(p => ({ ...p, responsibilities: e.target.value }))}
                      placeholder={'- 업무 수행: 생산 담당자\n- 업무 검토: 생산 관리자\n- 데이터 관리: 전산팀'}
                      rows={3} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                  </label>
                  <label style={{ display: 'grid', gap: 3 }}>
                    <div style={T.label}>예외 처리</div>
                    <textarea value={template.exceptionHandling} onChange={e => setTemplate(p => ({ ...p, exceptionHandling: e.target.value }))}
                      placeholder={'- 생산 수량 오류 → 수정 요청 후 재입력\n- 품목 코드 오류 → 품목 마스터 확인\n- 시스템 오류 → 전산팀 문의'}
                      rows={3} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                  </label>
                  <label style={{ display: 'grid', gap: 3 }}>
                    <div style={T.label}>관련 문서</div>
                    <textarea value={template.relatedDocs} onChange={e => setTemplate(p => ({ ...p, relatedDocs: e.target.value }))}
                      placeholder={'- 생산 계획서\n- 작업 지시서\n- 생산 실적 보고서'}
                      rows={2} style={{ ...T.input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
                  </label>
                </div>

                {/* --- 하단 버튼 --- */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button className="btn" type="button"
                    disabled={!selected.title?.trim() || !template.processFlow.trim()}
                    onClick={() => {
                      const authorN = String((selected as any).authorName || userName || '');
                      const content = serializeTemplate(template, selected.title, authorN);
                      setEditing(p => p ? { ...p, content } : p);
                      const forms = templateToStepForms(template);
                      setStepForms(forms);
                      setEditMode('structured');
                      setAiQuestions(null);
                      setPhase(2);
                    }}
                    style={{ padding: '8px 20px' }}>다음: 프로세스 단계 변환 →</button>
                </div>
              </>
            ) : phase === 2 ? (
              <>
                {/* ====== Phase 2: StepFormEditor + AI 검증 ====== */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>프로세스 단계 편집</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>템플릿에서 변환된 단계를 확인하고, BPMN에 필요한 세부 항목을 보완하세요.</div>
                  </div>
                  <button className="btn btn-sm btn-outline" type="button"
                    disabled={!editing?.id || aiQuestionsLoading || !stepForms.some(s => s.title.trim())}
                    onClick={async () => {
                      if (!editing?.id) { await save(); }
                      if (!editing?.id) return;
                      setEditing(p => p ? { ...p, content: serializeStepsToText(stepForms) } : p);
                      setTimeout(() => void aiMakeQuestions(), 100);
                    }}
                    style={{ fontSize: 11 }}>{aiQuestionsLoading ? 'AI 검증중…' : 'AI 검증'}</button>
                </div>
                <StepFormEditor steps={stepForms} onChange={setStepForms} validationIssues={validation?.issues} />

                {/* AI 검증 결과 */}
                {aiQuestionsLoading && !aiQuestions && (
                  <div style={{ border: '1px solid #E0E7FF', borderRadius: 10, background: '#F8FAFC', padding: 16, textAlign: 'center' as any }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1e40af', marginBottom: 4 }}>AI 검증 중...</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>프로세스 단계를 BPMN 관점에서 분석하고 있습니다.</div>
                  </div>
                )}
                {aiQuestions && (
                  <div style={{ border: '1px solid #E0E7FF', borderRadius: 10, background: '#F8FAFC', padding: 12, display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#1e40af' }}>AI 검증 결과</div>
                      {qualityScore !== null && (
                        <span style={{ fontWeight: 800, fontSize: 13, color: qualityScore >= 70 ? '#16a34a' : qualityScore >= 40 ? '#ca8a04' : '#dc2626' }}>{qualityScore}점</span>
                      )}
                    </div>
                    {aiQuestions.summary && (
                      <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.7, background: '#fff', borderRadius: 8, padding: '8px 10px', border: '1px solid #E5E7EB' }}>
                        {aiQuestions.summary}
                      </div>
                    )}
                    {aiQuestions.questions.length > 0 ? (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#374151' }}>보완 필요 ({aiQuestions.questions.length}개) — 위 단계에서 직접 수정하세요</div>
                        {aiQuestions.questions.map((q, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, paddingLeft: 8, borderLeft: `3px solid ${q.severity === 'MUST' ? '#ef4444' : '#a5b4fc'}`, background: '#fff', borderRadius: 6, padding: '6px 8px 6px 12px' }}>
                            <span style={{ fontWeight: 700, color: q.severity === 'MUST' ? '#dc2626' : '#6366f1', fontSize: 10, marginRight: 4 }}>{q.severity === 'MUST' ? '필수' : '권장'}</span>
                            {q.targetStepId && <span style={{ fontSize: 10, background: '#E0E7FF', color: '#3730a3', borderRadius: 4, padding: '1px 4px', marginRight: 4 }}>{q.targetStepId}</span>}
                            {q.targetField && <span style={{ fontSize: 10, background: '#F0FDF4', color: '#166534', borderRadius: 4, padding: '1px 4px', marginRight: 4 }}>{q.targetField}</span>}
                            {q.question}
                          </div>
                        ))}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', textAlign: 'center' as any, padding: 6 }}>모든 항목이 충분히 작성되었습니다!</div>
                    )}
                  </div>
                )}

                {/* 완성도 점수 바 */}
                {qualityScore !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>완성도</div>
                    <div style={{ flex: 1, height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(qualityScore, 100)}%`, borderRadius: 3, transition: 'width 0.5s ease',
                        background: qualityScore >= MIN_QUALITY_SCORE ? '#16a34a' : qualityScore >= 40 ? '#ca8a04' : '#dc2626' }} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: qualityScore >= MIN_QUALITY_SCORE ? '#16a34a' : qualityScore >= 40 ? '#ca8a04' : '#dc2626', minWidth: 36, textAlign: 'right' as any }}>{qualityScore}점</div>
                  </div>
                )}

                {/* 하단 네비 */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
                  <button className="btn btn-outline" type="button" onClick={() => setPhase(1)}>← 이전: 템플릿</button>
                  <button className="btn" type="button"
                    disabled={!stepForms.some(s => s.title.trim())}
                    onClick={() => {
                      setEditing(p => p ? { ...p, content: serializeStepsToText(stepForms) } : p);
                      setPhase(3);
                    }}
                    style={{ padding: '8px 20px' }}>다음: 검토/프로세스 생성 →</button>
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

                {/* 품질 게이트 */}
                {qualityScore !== null && qualityScore < MIN_QUALITY_SCORE && (!selected.status || selected.status === 'DRAFT' || selected.status === 'REJECTED') && (
                  <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#92400E' }}>완성도 {qualityScore}점 — 검토 요청에는 {MIN_QUALITY_SCORE}점 이상이 필요합니다.</div>
                    <div style={{ fontSize: 12, color: '#92400E', marginTop: 4 }}>이전 단계에서 AI 검증을 실행하고 부족한 항목을 보완하세요.</div>
                  </div>
                )}

                {/* 검토 요청 (DRAFT 또는 REJECTED 상태) */}
                {(!selected.status || selected.status === 'DRAFT' || selected.status === 'REJECTED') && selected.userId === userId && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {!reviewerPickOpen ? (
                      <button className="btn btn-outline" type="button" onClick={() => setReviewerPickOpen(true)}
                        disabled={statusLoading || (qualityScore !== null && qualityScore < MIN_QUALITY_SCORE)}
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
                  <button className="btn btn-outline" type="button" onClick={() => setPhase(2)}>← 이전: 프로세스 단계</button>
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
