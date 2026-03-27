import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';
import { StepFormEditor, StepFormData, parseTextToStepForms, serializeStepsToText, makeEmptyStep } from '../components/StepFormEditor';

// ─── Types ────────────────────────────────────────────────
type BaseTypeDef = {
  id: string;
  name: string;
  icon: string;
  group: string;
  userDescription: string;
  examples: string;
  primaryOutput: string;
  targetModule: string;
};

type OptionItem = { id: string; label: string; targetModule: string; note?: string };
type OptionGroup = { id: string; label: string; description: string; multiSelect: boolean; items: OptionItem[] };

type ManualDto = {
  id?: string;
  userId?: string;
  title: string;
  content?: string | null;
  authorName?: string;
  authorTeamName?: string;
  department?: string;
  baseType?: string;
  options?: any;
  phaseData?: any;
  currentPhase?: number;
  status?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
};

type Phase2Response = {
  roundNum: number;
  questions: string[];
  structuredSoFar: string;
  summary: string;
  completionRate: number;
};

type Phase4Response = {
  manualContent: string;
  title: string;
  summary: string;
  securityItems: Array<{ systemName: string; original: string; replacement: string }>;
};

// ─── Styles ───────────────────────────────────────────────
const S = {
  card: { border: '1px solid #E5E7EB', borderRadius: 12, background: '#fff', padding: 16 } as React.CSSProperties,
  input: { border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  label: { fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 4 } as React.CSSProperties,
  muted: { fontSize: 12, color: '#64748b' } as React.CSSProperties,
  primary: '#0F3D73',
  accent: '#2563eb',
};

const DEPARTMENTS = [
  '설계팀', '신차개발팀', '개발팀', '금형개발팀',
  '생산팀', '제2공장 생산팀', '생산기술팀', '양산품질팀',
  '영업팀', '회계팀', '자재관리팀', '전산팀',
];

const PHASE_LABELS = [
  { n: 1, label: '업무 등록' },
  { n: 2, label: 'AI 구조화' },
  { n: 3, label: '옵션 선택' },
  { n: 4, label: '산출물 생성' },
  { n: 5, label: '암묵지 보완' },
];

const PROC_PHASE_LABELS = [
  { n: 1, label: '업무 입력' },
  { n: 2, label: '프로세스 단계 편집' },
  { n: 3, label: 'BPMN 프로세스 생성' },
];

// ═══════════════════════════════════════════════════════════
export function WorkManualExt() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const userName = typeof localStorage !== 'undefined' ? localStorage.getItem('userName') || '' : '';
  const teamName = typeof localStorage !== 'undefined' ? localStorage.getItem('teamName') || '' : '';

  // ─── State ──────────────────────────────────────────────
  const [baseTypes, setBaseTypes] = useState<BaseTypeDef[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<ManualDto[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [manual, setManual] = useState<ManualDto | null>(null);
  const [phase, setPhase] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Work Mode: classic(기존) / skill-plus(스킬추가) / skill-center(스킬중심)
  const [workMode, setWorkMode] = useState<'classic' | 'skill-plus' | 'skill-center'>('skill-plus');
  const [showModeConfirm, setShowModeConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState<'classic' | 'skill-plus' | 'skill-center' | null>(null);
  const [skillCenterDone, setSkillCenterDone] = useState(false);

  // KPI Tracking
  const [kpi, setKpi] = useState<{ startedAt: number; aiCalls: number; moduleAttempts: number; moduleSuccesses: number; rating: number | null }>({ startedAt: 0, aiCalls: 0, moduleAttempts: 0, moduleSuccesses: 0, rating: null });
  const [showRating, setShowRating] = useState(false);
  const bumpAiCall = useCallback(() => setKpi(prev => ({ ...prev, aiCalls: prev.aiCalls + 1 })), []);
  const bumpModuleAttempt = useCallback((success: boolean) => setKpi(prev => ({ ...prev, moduleAttempts: prev.moduleAttempts + 1, moduleSuccesses: prev.moduleSuccesses + (success ? 1 : 0) })), []);

  // Phase 1
  const [selectedBaseType, setSelectedBaseType] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState(teamName);
  const [freeText, setFreeText] = useState('');
  const [relatedDocs, setRelatedDocs] = useState<Array<{ label: string; url: string }>>([]);

  // Phase 2
  const [p2Loading, setP2Loading] = useState(false);
  const [p2Questions, setP2Questions] = useState<string[]>([]);
  const [p2Answers, setP2Answers] = useState<string[]>([]);
  const [p2Structured, setP2Structured] = useState('');
  const [p2Summary, setP2Summary] = useState('');
  const [p2CompletionRate, setP2CompletionRate] = useState(0);
  const [p2Round, setP2Round] = useState(1);
  const [p2Error, setP2Error] = useState('');

  // Phase 3
  const [p3Recommended, setP3Recommended] = useState<string[]>([]);
  const [p3Selected, setP3Selected] = useState<Record<string, string[]>>({});
  const [p3Loading, setP3Loading] = useState(false);

  // Phase 4
  const [p4Loading, setP4Loading] = useState(false);
  const [p4Content, setP4Content] = useState('');
  const [p4Summary, setP4Summary] = useState('');
  const [p4Security, setP4Security] = useState<Array<{ systemName: string; original: string; replacement: string }>>([]);

  // Phase 5
  const [p5Loading, setP5Loading] = useState(false);
  const [p5Questions, setP5Questions] = useState<Array<{ id: number; question: string }>>([]);
  const [p5Answers, setP5Answers] = useState<Record<number, string>>({});
  const [p5Final, setP5Final] = useState('');
  const [p5Summary, setP5Summary] = useState('');

  // BPMN / procedure-specific state
  const [bpmnJson, setBpmnJson] = useState<any>(null);
  const [bpmnLoading, setBpmnLoading] = useState(false);
  const [bpmnTemplateId, setBpmnTemplateId] = useState('');

  // Procedure flow: StepFormEditor + AI validation
  const [stepForms, setStepForms] = useState<StepFormData[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [procAiLoading, setProcAiLoading] = useState(false);
  const [procAiResult, setProcAiResult] = useState<{ summary: string; questions: Array<{ severity: string; question: string; targetStepId?: string; targetField?: string }> } | null>(null);
  const [procQualityScore, setProcQualityScore] = useState<number | null>(null);

  // Module integration
  const [modKbCreated, setModKbCreated] = useState(false);
  const [modSchedCreated, setModSchedCreated] = useState(false);
  const [modAlarmCreated, setModAlarmCreated] = useState(false);
  const [modLoading, setModLoading] = useState('');

  // AI model selection: 'openai' (저가) | 'claude' (고가/고품질)
  const [aiModel, setAiModel] = useState<'openai' | 'claude'>('openai');

  // Skill File + Q&A
  const [skillFile, setSkillFile] = useState<any>(null);
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillTab, setSkillTab] = useState<'overview' | 'steps' | 'faq' | 'modules' | 'qa'>('overview');
  const [qaMessages, setQaMessages] = useState<Array<{ role: 'user' | 'ai'; text: string; relatedSteps?: string[]; suggestedFollowUp?: string[] }>>([]);
  const [qaInput, setQaInput] = useState('');
  const [qaLoading, setQaLoading] = useState(false);
  const [showSkillPanel, setShowSkillPanel] = useState(false);
  const [sfModLoading, setSfModLoading] = useState('');
  const [sfModCreated, setSfModCreated] = useState<Record<string, boolean>>({});

  // ─── Load base types + list ─────────────────────────────
  useEffect(() => {
    apiJson<{ baseTypes: BaseTypeDef[]; optionGroups: OptionGroup[] }>('/api/work-manuals/ext/base-types')
      .then(r => { setBaseTypes(r.baseTypes || []); setOptionGroups(r.optionGroups || []); })
      .catch(() => {});
  }, []);

  const loadList = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await apiJson<{ items: ManualDto[] }>(`/api/work-manuals?userId=${encodeURIComponent(userId)}`);
      const all = Array.isArray(r?.items) ? r.items : [];
      setItems(all.filter(x => !!x.baseType));
    } catch { setItems([]); }
  }, [userId]);

  useEffect(() => { void loadList(); }, [loadList]);

  // ─── Select / New ───────────────────────────────────────
  function selectManual(m: ManualDto) {
    setSelectedId(String(m.id || ''));
    setManual(m);
    setPhase(m.currentPhase || 1);
    setSelectedBaseType(m.baseType || '');
    setTitle(m.title || '');
    setDepartment(m.department || m.authorTeamName || teamName);
    setFreeText(m.phaseData?.phase1?.freeText || m.content || '');
    setRelatedDocs(Array.isArray(m.phaseData?.phase1?.relatedDocs) ? m.phaseData.phase1.relatedDocs : []);
    // restore phase states
    if (m.phaseData?.phase4?.manualContent) setP4Content(m.phaseData.phase4.manualContent);
    if (m.phaseData?.phase5?.finalContent) setP5Final(m.phaseData.phase5.finalContent);
    // procedure: restore stepForms from content if Phase >= 2
    if (m.baseType === 'procedure' && (m.currentPhase || 1) >= 2 && m.content) {
      const forms = parseTextToStepForms(m.content);
      setStepForms(forms.length ? forms : [makeEmptyStep(1)]);
    } else {
      setStepForms([]);
    }
    setP2Questions([]); setP2Answers([]); setP2Structured(''); setP2Round(1); setP2CompletionRate(0); setP2Error('');
    setP3Recommended([]); setP3Selected({});
    setP4Summary(''); setP4Security([]);
    setP5Questions([]); setP5Answers({}); setP5Final(''); setP5Summary('');
    setProcAiResult(null); setProcQualityScore(null);
    setBpmnJson(null); setBpmnTemplateId('');
    setSkillCenterDone(false);
  }

  function newManual() {
    setSelectedId('');
    setManual(null);
    setPhase(1);
    setSelectedBaseType('');
    setTitle('');
    setDepartment(teamName);
    setFreeText('');
    setRelatedDocs([]);
    setP2Questions([]); setP2Answers([]); setP2Structured(''); setP2Round(1); setP2CompletionRate(0); setP2Error('');
    setP3Recommended([]); setP3Selected({});
    setP4Content(''); setP4Summary(''); setP4Security([]);
    setP5Questions([]); setP5Answers({}); setP5Final(''); setP5Summary('');
    setStepForms([]); setProcAiResult(null); setProcQualityScore(null);
    setBpmnJson(null); setBpmnTemplateId('');
    setSkillCenterDone(false);
    setKpi({ startedAt: 0, aiCalls: 0, moduleAttempts: 0, moduleSuccesses: 0, rating: null });
    setShowRating(false);
  }

  // ─── Mode switch with confirmation ────────────────────
  function handleModeSwitch(next: 'classic' | 'skill-plus' | 'skill-center') {
    if (next === workMode) return;
    if ((isProcedure ? phase >= 3 : phase >= 4) && (p4Content || skillFile || bpmnJson)) {
      setPendingMode(next);
      setShowModeConfirm(true);
    } else {
      setWorkMode(next);
    }
  }
  function confirmModeSwitch() {
    if (pendingMode) setWorkMode(pendingMode);
    setPendingMode(null);
    setShowModeConfirm(false);
  }

  const isProcedure = selectedBaseType === 'procedure';
  const phaseLabels = isProcedure ? PROC_PHASE_LABELS : PHASE_LABELS;

  // ─── Phase 1: Save & Continue ───────────────────────────
  async function savePhase1() {
    if (!userId) { toast('로그인이 필요합니다.', 'warning'); return; }
    if (!selectedBaseType) { toast('기본형을 선택해 주세요.', 'warning'); return; }
    if (!title.trim()) { toast('업무명을 입력해 주세요.', 'warning'); return; }
    if (!freeText.trim()) { toast('업무 내용을 입력해 주세요.', 'warning'); return; }

    setSaving(true);
    if (!kpi.startedAt) setKpi(prev => ({ ...prev, startedAt: Date.now() }));
    try {
      const phaseData = {
        phase1: { baseType: selectedBaseType, department, jobTitle: title, author: userName, freeText, relatedDocs: relatedDocs.filter(d => d.url.trim()) },
      };
      if (manual?.id) {
        const updated = await apiJson<ManualDto>(`/api/work-manuals/${encodeURIComponent(manual.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ userId, title, content: freeText, authorName: userName, authorTeamName: teamName, department, baseType: selectedBaseType, phaseData, currentPhase: 1 }),
        });
        setManual(updated);
        setSelectedId(String(updated.id || ''));
      } else {
        const created = await apiJson<ManualDto>('/api/work-manuals', {
          method: 'POST',
          body: JSON.stringify({ userId, title, content: freeText, authorName: userName, authorTeamName: teamName, department, baseType: selectedBaseType, phaseData, currentPhase: 1 }),
        });
        setManual(created);
        setSelectedId(String(created.id || ''));
      }
      toast('저장 완료', 'success');
      setPhase(2);
      await loadList();
    } catch (e: any) { toast(e?.message || '저장 실패', 'error'); }
    finally { setSaving(false); }
  }

  // ─── Procedure: auto-trigger AI draft steps on Phase 2 entry
  useEffect(() => {
    if (phase === 2 && selectedBaseType === 'procedure' && manual?.id && stepForms.length === 0 && !draftLoading) {
      void procDraftSteps();
    }
  }, [phase, selectedBaseType, manual?.id]);

  // ─── Procedure: AI Draft Steps (자유텍스트 → STEP 변환) ────
  async function procDraftSteps() {
    if (!manual?.id) return;
    setDraftLoading(true);
    try {
      // 먼저 content를 최신 freeText로 저장
      await apiJson(`/api/work-manuals/${encodeURIComponent(manual.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ userId, title, content: freeText, authorName: userName, authorTeamName: teamName }),
      });
      const r = await apiJson<{ draftContent: string; stepCount: number; summary: string }>(
        `/api/work-manuals/${encodeURIComponent(manual.id)}/ai/draft-steps`,
        { method: 'POST', body: JSON.stringify({ userId, aiModel }) },
      );
      bumpAiCall();
      if (!r?.draftContent) throw new Error('AI 응답이 올바르지 않습니다.');
      const forms = parseTextToStepForms(r.draftContent);
      setStepForms(forms.length ? forms : [makeEmptyStep(1)]);
      // content도 STEP 형식으로 업데이트
      await apiJson(`/api/work-manuals/${encodeURIComponent(manual.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ userId, title, content: r.draftContent, authorName: userName, authorTeamName: teamName, currentPhase: 2 }),
      });
      toast(`AI가 ${r.stepCount}개 프로세스 단계를 생성했습니다.`, 'success');
    } catch (e: any) { toast(e?.message || 'AI STEP 변환 실패', 'error'); }
    finally { setDraftLoading(false); }
  }

  // ─── Procedure: AI Validation (StepFormEditor 검증) ────
  async function procAiValidate() {
    if (!manual?.id || !stepForms.some(s => s.title.trim())) return;
    setProcAiLoading(true);
    try {
      // 먼저 현재 steps를 content에 저장
      const content = serializeStepsToText(stepForms);
      await apiJson(`/api/work-manuals/${encodeURIComponent(manual.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ userId, title, content, authorName: userName, authorTeamName: teamName }),
      });
      const r = await apiJson<{ summary: string; issues: any[]; questions: any[]; score?: number }>(
        `/api/work-manuals/${encodeURIComponent(manual.id)}/ai/questions`,
        { method: 'POST', body: JSON.stringify({ userId, aiModel }) },
      );
      bumpAiCall();
      setProcAiResult({
        summary: String(r?.summary || ''),
        questions: Array.isArray(r?.questions) ? r.questions : [],
      });
      if (typeof r?.score === 'number') setProcQualityScore(r.score);
    } catch (e: any) { toast(e?.message || 'AI 검증 실패', 'error'); }
    finally { setProcAiLoading(false); }
  }

  // ─── Procedure: Save steps & generate BPMN ────
  async function procSaveAndBpmn(autoAdvance = false) {
    if (!manual?.id || !stepForms.some(s => s.title.trim())) return;
    setBpmnLoading(true);
    try {
      const content = serializeStepsToText(stepForms);
      await apiJson(`/api/work-manuals/${encodeURIComponent(manual.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ userId, title, content, authorName: userName, authorTeamName: teamName, currentPhase: 3 }),
      });
      const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ai/bpmn`, {
        method: 'POST',
        body: JSON.stringify({ userId, aiModel }),
      });
      bumpAiCall();
      if (r?.bpmnJson) {
        setBpmnJson(r.bpmnJson);
        if (autoAdvance) setPhase(3);
        toast('BPMN 프로세스가 생성되었습니다!', 'success');
      } else {
        throw new Error('BPMN 응답이 올바르지 않습니다.');
      }
    } catch (e: any) {
      if (autoAdvance) setPhase(3);
      toast(e?.message || 'BPMN 생성 실패', 'error');
    }
    finally { setBpmnLoading(false); }
  }

  // ─── Skill File: Generate / Load / Q&A ───────────────────
  async function generateSkillFile() {
    if (!manual?.id) return;
    setSkillLoading(true);
    try {
      const r = await apiJson<{ skillFile: any }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/skill-file`, {
        method: 'POST', body: JSON.stringify({ userId, aiModel }),
      });
      bumpAiCall();
      setSkillFile(r.skillFile);
      setShowSkillPanel(true);
      toast('업무 스킬 파일이 생성되었습니다!', 'success');
    } catch (e: any) { toast(e?.message || '스킬 파일 생성 실패', 'error'); }
    finally { setSkillLoading(false); }
  }

  async function loadSkillFile() {
    if (!manual?.id) return;
    try {
      const r = await apiJson<{ skillFile: any }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/skill-file?userId=${encodeURIComponent(userId)}`);
      setSkillFile(r.skillFile);
    } catch { /* no skill file yet */ }
  }

  useEffect(() => { if (manual?.id) loadSkillFile(); }, [manual?.id]);

  async function sendQaQuestion(q?: string) {
    const question = q || qaInput.trim();
    if (!manual?.id || !question) return;
    setQaMessages(prev => [...prev, { role: 'user', text: question }]);
    setQaInput('');
    setQaLoading(true);
    try {
      const r = await apiJson<{ answer: string; relatedSteps: string[]; suggestedFollowUp: string[] }>(
        `/api/work-manuals/${encodeURIComponent(manual.id)}/skill-qa`,
        { method: 'POST', body: JSON.stringify({ userId, question, aiModel }) },
      );
      bumpAiCall();
      setQaMessages(prev => [...prev, { role: 'ai', text: r.answer, relatedSteps: r.relatedSteps, suggestedFollowUp: r.suggestedFollowUp }]);
    } catch (e: any) {
      setQaMessages(prev => [...prev, { role: 'ai', text: `오류: ${e?.message || 'Q&A 실패'}` }]);
    }
    finally { setQaLoading(false); }
  }

  async function skillFileToBpmn() {
    if (!manual?.id) return;
    setBpmnLoading(true);
    try {
      const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/skill-file/to-bpmn`, {
        method: 'POST', body: JSON.stringify({ userId, aiModel }),
      });
      if (r?.bpmnJson) { setBpmnJson(r.bpmnJson); toast('Skill File 기반 BPMN이 생성되었습니다!', 'success'); }
    } catch (e: any) { toast(e?.message || 'BPMN 변환 실패', 'error'); }
    finally { setBpmnLoading(false); }
  }

  async function createSkillModule(moduleKey: string) {
    if (!manual?.id) return;
    setSfModLoading(moduleKey);
    const endpointMap: Record<string, string> = {
      bpmn_engine: 'skill-file/to-bpmn',
      schedule_mgmt: 'skill-file/to-schedule',
      knowledge_base: 'skill-file/to-knowledge-base',
      periodic_alarm_report: 'skill-file/to-periodic-alarm',
    };
    const ep = endpointMap[moduleKey];
    if (!ep) { setSfModLoading(''); return; }
    try {
      const bodyPayload: any = { userId };
      if (moduleKey === 'bpmn_engine') bodyPayload.aiModel = aiModel;
      await apiJson(`/api/work-manuals/${encodeURIComponent(manual.id)}/${ep}`, {
        method: 'POST', body: JSON.stringify(bodyPayload),
      });
      setSfModCreated(prev => ({ ...prev, [moduleKey]: true }));
      bumpModuleAttempt(true);
      toast(`Skill File → ${moduleKey} 모듈 생성 완료!`, 'success');
    } catch (e: any) { bumpModuleAttempt(false); toast(e?.message || '모듈 생성 실패', 'error'); }
    finally { setSfModLoading(''); }
  }

  // ─── Phase 2: AI Questions (non-procedure) ─────────────────────
  async function loadPhase2Questions() {
    if (!manual?.id) return;
    setP2Loading(true);
    setP2Error('');
    try {
      const r = await apiJson<Phase2Response>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase2`, {
        method: 'POST',
        body: JSON.stringify({ userId, roundNum: p2Round, aiModel }),
      });
      bumpAiCall();
      setP2Questions(r.questions || []);
      setP2Answers(new Array((r.questions || []).length).fill(''));
      setP2Structured(r.structuredSoFar || '');
      setP2Summary(r.summary || '');
      setP2CompletionRate(r.completionRate || 0);
      if (!(r.questions || []).length) setP2Error('AI가 질문을 생성하지 못했습니다. 다시 시도해 주세요.');
    } catch (e: any) {
      const msg = e?.message || 'AI 질문 생성 실패';
      setP2Error(msg);
      toast(msg, 'error');
    }
    finally { setP2Loading(false); }
  }

  async function submitPhase2Answers() {
    if (!manual?.id) return;
    const filled = p2Answers.filter(a => a.trim());
    if (!filled.length) { toast('답변을 하나 이상 입력해 주세요.', 'warning'); return; }
    setP2Loading(true);
    try {
      const r = await apiJson<{ ok: boolean; completedRounds: number; nextRound?: { roundNum: number; questions: string[]; structuredSoFar: string; summary: string; completionRate: number } }>(
        `/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase2/answer`, {
          method: 'POST',
          body: JSON.stringify({ userId, roundNum: p2Round, answers: p2Answers, aiQuestions: p2Questions, aiModel }),
        });
      if (p2Round < 3) {
        setP2Round(prev => prev + 1);
        // 백엔드가 다음 라운드 질문을 함께 반환하면 바로 적용 (2차 API 호출 불필요)
        if (r.nextRound?.questions?.length) {
          setP2Questions(r.nextRound.questions);
          setP2Answers(new Array(r.nextRound.questions.length).fill(''));
          setP2Structured(r.nextRound.structuredSoFar || '');
          setP2Summary(r.nextRound.summary || '');
          setP2CompletionRate(r.nextRound.completionRate || 0);
          setP2Loading(false);
          toast(`Round ${p2Round} 완료`, 'success');
          return;
        }
        setP2Questions([]); setP2Answers([]);
        toast(`Round ${p2Round} 완료. 다음 질문을 생성합니다.`, 'success');
      } else {
        toast('AI 구조화 질문 완료!', 'success');
        setPhase(3);
      }
    } catch (e: any) { toast(e?.message || '답변 저장 실패', 'error'); }
    finally { setP2Loading(false); }
  }

  useEffect(() => {
    if (phase === 2 && manual?.id && p2Questions.length === 0 && !p2Loading && selectedBaseType !== 'procedure') {
      void loadPhase2Questions();
    }
  }, [phase, manual?.id, p2Round, selectedBaseType]);

  // ─── Phase 3: Options ──────────────────────────────────
  async function loadPhase3() {
    if (!manual?.id) return;
    setP3Loading(true);
    try {
      const r = await apiJson<{ recommendedOptionIds: string[]; optionGroups: OptionGroup[] }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase3`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setP3Recommended(r.recommendedOptionIds || []);
      if (r.optionGroups?.length) setOptionGroups(r.optionGroups);
      // pre-select recommended
      const sel: Record<string, string[]> = {};
      for (const grp of (r.optionGroups || optionGroups)) {
        sel[grp.id] = grp.items.filter(it => (r.recommendedOptionIds || []).includes(it.id)).map(it => it.id);
      }
      setP3Selected(sel);
    } catch (e: any) { toast(e?.message || '옵션 로드 실패', 'error'); }
    finally { setP3Loading(false); }
  }

  async function savePhase3() {
    if (!manual?.id) return;
    setSaving(true);
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase3/save`, {
        method: 'POST',
        body: JSON.stringify({ userId, selectedOptions: p3Selected }),
      });
      toast('옵션 저장 완료', 'success');
      setPhase(4);
    } catch (e: any) { toast(e?.message || '옵션 저장 실패', 'error'); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    if (phase === 3 && manual?.id && !p3Loading && p3Recommended.length === 0) {
      void loadPhase3();
    }
  }, [phase, manual?.id, selectedBaseType]);

  // ─── Phase 4: Generate Output ──────────────────────────
  async function generatePhase4() {
    if (!manual?.id) return;
    setP4Loading(true);
    try {
      const r = await apiJson<Phase4Response>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase4`, {
        method: 'POST',
        body: JSON.stringify({ userId, aiModel }),
      });
      bumpAiCall();
      setP4Content(r.manualContent || '');
      setP4Summary(r.summary || '');
      setP4Security(r.securityItems || []);
      if (r.title) setTitle(r.title);
      toast('산출물 생성 완료!', 'success');

      // 업무 절차 기본형이면 자동으로 BPMN 변환 시작 (Phase 3에서 이미 생성된 경우 스킵)
      if (selectedBaseType === 'procedure' && r.manualContent && !bpmnJson) {
        void autoBpmnConvert();
      }
    } catch (e: any) { toast(e?.message || '산출물 생성 실패', 'error'); }
    finally { setP4Loading(false); }
  }

  async function autoBpmnConvert() {
    if (!manual?.id) return;
    setBpmnLoading(true);
    try {
      const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ai/bpmn`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      bumpAiCall();
      if (r?.bpmnJson) {
        setBpmnJson(r.bpmnJson);
        toast('BPMN 프로세스 구조가 생성되었습니다.', 'success');
      }
    } catch (e: any) { toast(e?.message || 'BPMN 변환 실패', 'error'); }
    finally { setBpmnLoading(false); }
  }

  async function createBpmnTemplate() {
    if (!manual?.id || !bpmnJson) return;
    setModLoading('bpmn_engine');
    try {
      const created = await apiJson<{ id: string }>('/api/process-templates', {
        method: 'POST',
        body: JSON.stringify({
          title: title || manual.title || '업무 프로세스',
          description: `매뉴얼 「${manual.title}」에서 AI로 생성된 BPMN 프로세스`,
          type: 'PROJECT',
          ownerId: userId,
          actorId: userId,
          visibility: 'PRIVATE',
          bpmnJson,
          tasks: [],
        }),
      });
      const tmplId = String(created?.id || '').trim();
      if (!tmplId) throw new Error('프로세스 템플릿 생성 실패');
      // 자동 발행 — 바로 프로세스 시작 가능하도록
      try {
        await apiJson(`/api/process-templates/${encodeURIComponent(tmplId)}/publish`, {
          method: 'POST',
          body: JSON.stringify({ actorId: userId }),
        });
      } catch { /* publish 실패해도 DRAFT 템플릿은 유지 */ }
      setBpmnTemplateId(tmplId);
      bumpModuleAttempt(true);
      toast('프로세스 템플릿이 생성·발행되었습니다!', 'success');
    } catch (e: any) { bumpModuleAttempt(false); toast(e?.message || '프로세스 템플릿 생성 실패', 'error'); }
    finally { setModLoading(''); }
  }

  useEffect(() => {
    if (phase === 4 && manual?.id && !p4Content && !p4Loading) {
      void generatePhase4();
    }
  }, [phase, manual?.id]);

  // ─── Phase 5: Tacit Knowledge ──────────────────────────
  async function loadPhase5() {
    if (!manual?.id) return;
    setP5Loading(true);
    try {
      const r = await apiJson<{ questions: Array<{ id: number; question: string }>; currentContent: string }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase5`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setP5Questions(r.questions || []);
      setP5Answers({});
    } catch (e: any) { toast(e?.message || '암묵지 질문 로드 실패', 'error'); }
    finally { setP5Loading(false); }
  }

  async function completePhase5() {
    if (!manual?.id) return;
    const answers = p5Questions.map(q => ({ question: q.question, answer: p5Answers[q.id] || '' })).filter(a => a.answer.trim());
    setP5Loading(true);
    try {
      const r = await apiJson<{ finalContent: string; summary: string }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase5/complete`, {
        method: 'POST',
        body: JSON.stringify({ userId, answers, aiModel }),
      });
      bumpAiCall();
      setP5Final(r.finalContent || '');
      setP5Summary(r.summary || '');
      setShowRating(true);
      toast('매뉴얼 완성!', 'success');
      await loadList();
    } catch (e: any) { toast(e?.message || '완료 실패', 'error'); }
    finally { setP5Loading(false); }
  }

  useEffect(() => {
    if (phase === 5 && manual?.id && p5Questions.length === 0 && !p5Loading) {
      void loadPhase5();
    }
  }, [phase, manual?.id]);

  // ─── Module integration helpers ─────────────────────────
  const MODULE_MAP: Record<string, { label: string; icon: string; desc: string; endpoint: string }> = {
    knowledge_base: { label: '지식베이스 등록', icon: '📚', desc: '시스템 조작/계산 매뉴얼을 지식베이스에 등록합니다.', endpoint: '/api/knowledge-base/from-manual/' },
    schedule_mgmt: { label: '일정 생성', icon: '📅', desc: '개발 프로젝트 일정을 자동 생성합니다.', endpoint: '/api/schedules/from-manual/' },
    periodic_alarm_report: { label: '주기알람 등록', icon: '🔔', desc: '점검/관리 주기 알람을 등록합니다.', endpoint: '/api/periodic-alarms/from-manual/' },
    bpmn_engine: { label: 'BPMN 프로세스', icon: '⚙️', desc: '업무 절차를 BPMN 프로세스 템플릿으로 변환합니다.', endpoint: '' },
  };

  const applicableModules = useMemo(() => {
    const bt = baseTypes.find(b => b.id === selectedBaseType);
    if (!bt) return [];
    const modules = [bt.targetModule];
    // add modules from selected options
    for (const grp of optionGroups) {
      for (const it of grp.items) {
        if ((p3Selected[grp.id] || []).includes(it.id) && it.targetModule && it.targetModule !== 'none') {
          if (!modules.includes(it.targetModule)) modules.push(it.targetModule);
        }
      }
    }
    return modules.filter(m => !!MODULE_MAP[m]);
  }, [selectedBaseType, baseTypes, optionGroups, p3Selected]);

  async function createModuleIntegration(moduleKey: string) {
    if (!manual?.id) return;

    // BPMN 연동: AI로 BPMN 생성 → 프로세스 템플릿 생성 → 편집기 이동
    if (moduleKey === 'bpmn_engine') {
      setModLoading('bpmn_engine');
      try {
        const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ai/bpmn`, {
          method: 'POST',
          body: JSON.stringify({ userId }),
        });
        const tmplTitle = String(r?.title || manual.title || '').trim();
        const bpmnJson = r?.bpmnJson;
        if (!bpmnJson) throw new Error('AI BPMN 응답이 올바르지 않습니다.');

        const created = await apiJson<{ id: string }>('/api/process-templates', {
          method: 'POST',
          body: JSON.stringify({
            title: tmplTitle,
            description: `매뉴얼 「${manual.title}」에서 AI로 생성된 BPMN 프로세스`,
            type: 'PROJECT',
            ownerId: userId,
            actorId: userId,
            visibility: 'PRIVATE',
            bpmnJson,
            tasks: [],
          }),
        });
        const tmplId = String(created?.id || '').trim();
        if (!tmplId) throw new Error('프로세스 템플릿 생성 실패');
        // 자동 발행
        try {
          await apiJson(`/api/process-templates/${encodeURIComponent(tmplId)}/publish`, {
            method: 'POST',
            body: JSON.stringify({ actorId: userId }),
          });
        } catch { /* publish 실패해도 DRAFT 유지 */ }
        setModKbCreated(false); // reset
        bumpAiCall(); bumpModuleAttempt(true);
        toast('BPMN 프로세스 템플릿이 생성·발행되었습니다.', 'success');
        nav(`/process/templates?openId=${encodeURIComponent(tmplId)}`);
      } catch (e: any) { bumpModuleAttempt(false); toast(e?.message || 'BPMN 생성 실패', 'error'); }
      finally { setModLoading(''); }
      return;
    }

    const mod = MODULE_MAP[moduleKey];
    if (!mod || !mod.endpoint) return;
    setModLoading(moduleKey);
    try {
      await apiJson(mod.endpoint + encodeURIComponent(manual.id), {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      if (moduleKey === 'knowledge_base') setModKbCreated(true);
      else if (moduleKey === 'schedule_mgmt') setModSchedCreated(true);
      else if (moduleKey === 'periodic_alarm_report') setModAlarmCreated(true);
      bumpModuleAttempt(true);
      toast(`${mod.label} 완료!`, 'success');
    } catch (e: any) { bumpModuleAttempt(false); toast(e?.message || `${mod.label} 실패`, 'error'); }
    finally { setModLoading(''); }
  }

  function isModuleCreated(moduleKey: string) {
    if (moduleKey === 'knowledge_base') return modKbCreated;
    if (moduleKey === 'schedule_mgmt') return modSchedCreated;
    if (moduleKey === 'periodic_alarm_report') return modAlarmCreated;
    return false;
  }

  // ─── Toggle option helper ──────────────────────────────
  function toggleOption(groupId: string, itemId: string) {
    setP3Selected(prev => {
      const cur = prev[groupId] || [];
      const next = cur.includes(itemId) ? cur.filter(x => x !== itemId) : [...cur, itemId];
      return { ...prev, [groupId]: next };
    });
  }

  // ─── Render ─────────────────────────────────────────────
  const btGroups = useMemo(() => {
    const map: Record<string, BaseTypeDef[]> = {};
    for (const bt of baseTypes) {
      if (!map[bt.group]) map[bt.group] = [];
      map[bt.group].push(bt);
    }
    return map;
  }, [baseTypes]);

  if (!userId) {
    return <div className="content" style={{ color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12, marginRight: showSkillPanel && skillFile ? 490 : 0, transition: 'margin-right 0.2s ease-out' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>업무 매뉴얼 외재화</h2>
          {/* AI Model Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: 2 }}>
            <button type="button" onClick={() => setAiModel('openai')}
              style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: aiModel === 'openai' ? 700 : 400, border: 'none', cursor: 'pointer',
                background: aiModel === 'openai' ? '#fff' : 'transparent', color: aiModel === 'openai' ? '#0f172a' : '#64748b',
                boxShadow: aiModel === 'openai' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              GPT-4o mini
            </button>
            <button type="button" onClick={() => setAiModel('claude')}
              style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: aiModel === 'claude' ? 700 : 400, border: 'none', cursor: 'pointer',
                background: aiModel === 'claude' ? '#D97706' : 'transparent', color: aiModel === 'claude' ? '#fff' : '#64748b',
                boxShadow: aiModel === 'claude' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none' }}>
              Claude
            </button>
          </div>
          {manual && (
            <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {phaseLabels.map((s, i) => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <div style={{ width: 20, height: 2, background: phase >= s.n ? S.primary : '#CBD5E1' }} />}
                  <button type="button"
                    onClick={() => { if (s.n <= (manual.currentPhase || 1) + 1) setPhase(s.n); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 16, fontSize: 11, fontWeight: phase === s.n ? 800 : 500, border: 'none', cursor: 'pointer',
                      background: phase === s.n ? S.primary : phase > s.n ? '#E0E7FF' : '#F1F5F9',
                      color: phase === s.n ? '#fff' : phase > s.n ? S.primary : '#64748b',
                    }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', fontSize: 9, fontWeight: 800, background: phase === s.n ? '#fff' : 'transparent', color: phase === s.n ? S.primary : 'inherit' }}>{s.n}</span>
                    {s.label}
                  </button>
                </div>
              ))}
            </nav>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" type="button" onClick={() => nav('/manuals')}>기존 매뉴얼</button>
          <button className="btn btn-outline" type="button" onClick={newManual}>새 매뉴얼</button>
        </div>
      </div>

      {/* ── 모드 선택 대메뉴 (procedure: Phase 3+, 기타: Phase 4+) ── */}
      {((isProcedure ? phase >= 3 : phase >= 4)) && manual && (
        <div style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '2px solid #E2E8F0' }}>
          {([
            { key: 'classic' as const, label: '기존 방식', icon: '📄', desc: '5단계 위저드 + from-manual 모듈', color: '#475569' },
            { key: 'skill-plus' as const, label: '확장 모드', icon: '🧠', desc: '기존 흐름 + Q&A 챗봇, 인수인계 사이드 패널', color: '#0F3D73' },
            { key: 'skill-center' as const, label: '스킬 중심 버전', icon: '⚡', desc: 'Skill File 허브 → 모든 모듈 생성', color: '#7C3AED' },
          ]).map((m) => {
            const active = workMode === m.key;
            return (
              <button key={m.key} type="button" onClick={() => handleModeSwitch(m.key)}
                style={{
                  flex: 1, padding: '10px 12px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s',
                  background: active ? (m.key === 'classic' ? '#F1F5F9' : m.key === 'skill-plus' ? '#EFF6FF' : '#F5F3FF') : '#fff',
                  borderBottom: active ? `3px solid ${m.color}` : '3px solid transparent',
                }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: active ? 800 : 600, fontSize: 13, color: active ? m.color : '#64748b' }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.3 }}>{m.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── 모드 전환 확인 다이얼로그 ── */}
      {showModeConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>모드 변경 확인</div>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 16 }}>
              모드를 변경하면 현재 Phase 4/5의 표시 방식이 달라집니다.<br />
              기존에 생성된 산출물과 모듈 데이터는 <strong>유지</strong>됩니다.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" type="button" onClick={() => { setShowModeConfirm(false); setPendingMode(null); }}>취소</button>
              <button className="btn" type="button" onClick={confirmModeSwitch} style={{ padding: '8px 20px' }}>변경</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, alignItems: 'start' }}>
        {/* Sidebar */}
        <div style={{ ...S.card, display: 'grid', gap: 8, padding: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>내 매뉴얼</div>
          <div style={{ display: 'grid', gap: 4, maxHeight: '70vh', overflowY: 'auto' }}>
            {items.map(m => {
              const active = String(m.id) === selectedId;
              const bt = baseTypes.find(b => b.id === m.baseType);
              return (
                <button key={String(m.id)} type="button" className="btn btn-ghost" onClick={() => selectManual(m)}
                  style={{ justifyContent: 'flex-start', textAlign: 'left', border: active ? '1px solid #0F3D73' : '1px solid transparent', background: active ? '#EFF6FF' : 'transparent', padding: '8px 8px', borderRadius: 8, display: 'grid', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {bt && <span style={{ fontSize: 14 }}>{bt.icon}</span>}
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{m.title || '(제목 없음)'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    Phase {m.currentPhase || 1} · {m.department || m.authorTeamName || ''}
                  </div>
                </button>
              );
            })}
            {!items.length && <div style={S.muted}>아직 매뉴얼이 없습니다.</div>}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ ...S.card, display: 'grid', gap: 12 }}>
          {/* ═══ Phase 1: 업무 등록 ═══ */}
          {phase === 1 && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>1단계: 업무 등록</div>
              <div style={S.muted}>업무의 기본형을 선택하고, 하시는 업무를 자유롭게 입력해 주세요.</div>

              {/* Base type cards */}
              {Object.entries(btGroups).map(([group, types]) => (
                <div key={group}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>{group}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(types.length, 3)}, 1fr)`, gap: 8 }}>
                    {types.map(bt => {
                      const sel = selectedBaseType === bt.id;
                      return (
                        <button key={bt.id} type="button" onClick={() => setSelectedBaseType(bt.id)}
                          style={{
                            border: sel ? '2px solid #0F3D73' : '1px solid #E5E7EB', borderRadius: 10, padding: 12, background: sel ? '#EFF6FF' : '#fff', cursor: 'pointer', textAlign: 'left', display: 'grid', gap: 4, transition: 'all 0.15s',
                          }}>
                          <div style={{ fontSize: 20 }}>{bt.icon}</div>
                          <div style={{ fontWeight: 800, fontSize: 14, color: sel ? S.primary : '#0f172a' }}>{bt.name}</div>
                          <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{bt.userDescription}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>예: {bt.examples}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'grid', gap: 3 }}>
                  <div style={S.label}>업무명 *</div>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 채용 프로세스, ERP 전표처리" style={S.input} />
                </label>
                <label style={{ display: 'grid', gap: 3 }}>
                  <div style={S.label}>소속 부서</div>
                  <select value={department} onChange={e => setDepartment(e.target.value)} style={{ ...S.input, appearance: 'auto' as any }}>
                    <option value="">선택</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
              </div>

              <label style={{ display: 'grid', gap: 3 }}>
                <div style={S.label}>업무 내용 (자유 입력) *</div>
                <div style={S.muted}>하시는 업무를 편하게 적어주세요. 완벽하지 않아도 됩니다. AI가 추가 질문으로 보완합니다.</div>
                <textarea value={freeText} onChange={e => setFreeText(e.target.value)}
                  placeholder={'예: 매달 월초에 전월 생산실적을 ERP에서 뽑아서 엑셀로 정리하고\n팀장님 결재 받은 다음에 경영지원팀에 보내요.\n가끔 수치가 안 맞으면 MES 데이터랑 대조해야 해요.'}
                  rows={6} style={{ ...S.input, resize: 'vertical' as any, lineHeight: 1.6 }} />
              </label>

              {/* 관련 문서 (OneDrive 링크) */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={S.label}>관련 문서 (OneDrive 링크)</div>
                  <button type="button" className="btn btn-outline" onClick={() => setRelatedDocs(prev => [...prev, { label: '', url: '' }])}
                    style={{ padding: '3px 10px', fontSize: 11 }}>+ 문서 추가</button>
                </div>
                {relatedDocs.length === 0 && (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>참고 문서가 있으면 OneDrive 공유 링크를 추가해 주세요. (선택사항)</div>
                )}
                {relatedDocs.map((doc, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, alignItems: 'center' }}>
                    <input value={doc.label} onChange={e => setRelatedDocs(prev => prev.map((d, j) => j === i ? { ...d, label: e.target.value } : d))}
                      placeholder="문서명 (예: 생산실적 양식)" style={{ ...S.input, fontSize: 12 }} />
                    <input value={doc.url} onChange={e => setRelatedDocs(prev => prev.map((d, j) => j === i ? { ...d, url: e.target.value } : d))}
                      placeholder="https://onedrive.live.com/...  또는 SharePoint 링크" style={{ ...S.input, fontSize: 12 }} />
                    <button type="button" onClick={() => setRelatedDocs(prev => prev.filter((_, j) => j !== i))}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 16, padding: '0 4px' }}>×</button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" type="button" onClick={savePhase1} disabled={saving || !selectedBaseType || !title.trim() || !freeText.trim()}
                  style={{ padding: '8px 24px' }}>
                  {saving ? '저장 중...' : isProcedure ? '다음: 프로세스 단계 변환 →' : '다음: AI 구조화 →'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ Phase 2 ═══ */}
          {phase === 2 && isProcedure && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>2단계: 프로세스 단계 편집</div>
                  <div style={S.muted}>AI가 변환한 프로세스 단계를 확인하고, BPMN에 필요한 세부 항목을 보완하세요.</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-outline" type="button" onClick={procAiValidate}
                    disabled={procAiLoading || !stepForms.some(s => s.title.trim())}
                    style={{ fontSize: 11 }}>{procAiLoading ? 'AI 검증중…' : 'AI 검증'}</button>
                  <button className="btn btn-sm btn-outline" type="button" onClick={procDraftSteps}
                    disabled={draftLoading}
                    style={{ fontSize: 11 }}>{draftLoading ? '변환중…' : 'AI 재변환'}</button>
                </div>
              </div>

              {/* 로딩: AI가 STEP 변환 중 */}
              {draftLoading && stepForms.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>AI가 업무를 프로세스 단계로 변환하고 있습니다...</div>
                  <div style={{ fontSize: 12 }}>자유 입력한 내용을 분석하여 STEP 구조로 변환 중입니다.</div>
                </div>
              )}

              {/* StepFormEditor */}
              {stepForms.length > 0 && (
                <StepFormEditor steps={stepForms} onChange={setStepForms} validationIssues={procAiResult?.questions?.filter(q => q.severity === 'MUST').map(q => ({ stepId: q.targetStepId, issue: q.question, severity: q.severity as 'MUST' | 'SHOULD' }))} />
              )}

              {/* AI 검증 결과 */}
              {procAiLoading && !procAiResult && (
                <div style={{ border: '1px solid #E0E7FF', borderRadius: 10, background: '#F8FAFC', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1e40af', marginBottom: 4 }}>AI 검증 중...</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>프로세스 단계를 BPMN 관점에서 분석하고 있습니다.</div>
                </div>
              )}
              {procAiResult && (
                <div style={{ border: '1px solid #E0E7FF', borderRadius: 10, background: '#F8FAFC', padding: 12, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1e40af' }}>AI 검증 결과</div>
                    {procQualityScore !== null && (
                      <span style={{ fontWeight: 800, fontSize: 13, color: procQualityScore >= 70 ? '#16a34a' : procQualityScore >= 40 ? '#ca8a04' : '#dc2626' }}>{procQualityScore}점</span>
                    )}
                  </div>
                  {procAiResult.summary && (
                    <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.7, background: '#fff', borderRadius: 8, padding: '8px 10px', border: '1px solid #E5E7EB' }}>
                      {procAiResult.summary}
                    </div>
                  )}
                  {procAiResult.questions.length > 0 ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#374151' }}>보완 필요 ({procAiResult.questions.length}개) — 위 단계에서 직접 수정하세요</div>
                      {procAiResult.questions.map((q, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, paddingLeft: 8, borderLeft: `3px solid ${q.severity === 'MUST' ? '#ef4444' : '#a5b4fc'}`, background: '#fff', borderRadius: 6, padding: '6px 8px 6px 12px' }}>
                          <span style={{ fontWeight: 700, color: q.severity === 'MUST' ? '#dc2626' : '#6366f1', fontSize: 10, marginRight: 4 }}>{q.severity === 'MUST' ? '필수' : '권장'}</span>
                          {q.targetStepId && <span style={{ fontSize: 10, background: '#E0E7FF', color: '#3730a3', borderRadius: 4, padding: '1px 4px', marginRight: 4 }}>{q.targetStepId}</span>}
                          {q.targetField && <span style={{ fontSize: 10, background: '#F0FDF4', color: '#166534', borderRadius: 4, padding: '1px 4px', marginRight: 4 }}>{q.targetField}</span>}
                          {q.question}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', textAlign: 'center', padding: 6 }}>모든 항목이 충분히 작성되었습니다!</div>
                  )}
                </div>
              )}

              {/* 완성도 점수 바 */}
              {procQualityScore !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>완성도</div>
                  <div style={{ flex: 1, height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(procQualityScore, 100)}%`, borderRadius: 3, transition: 'width 0.5s ease',
                      background: procQualityScore >= 70 ? '#16a34a' : procQualityScore >= 40 ? '#ca8a04' : '#dc2626' }} />
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: procQualityScore >= 70 ? '#16a34a' : procQualityScore >= 40 ? '#ca8a04' : '#dc2626', minWidth: 36, textAlign: 'right' }}>{procQualityScore}점</div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn btn-outline" type="button" onClick={() => setPhase(1)}>← 이전: 업무 입력</button>
                <button className="btn" type="button"
                  disabled={!stepForms.some(s => s.title.trim())}
                  onClick={() => { void procSaveAndBpmn(true); }}
                  style={{ padding: '8px 24px' }}>다음: BPMN 프로세스 생성 →</button>
              </div>
            </div>
          )}

          {/* ═══ Phase 2 (non-procedure): AI 구조화 질문 ═══ */}
          {phase === 2 && !isProcedure && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>2단계: AI 구조화 질문</div>
                  <div style={S.muted}>AI가 업무를 더 잘 이해하기 위해 질문합니다. 아는 만큼만 답해 주세요. (Round {p2Round}/3)</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(p2CompletionRate, 100)}%`, background: p2CompletionRate >= 70 ? '#16a34a' : '#f59e0b', borderRadius: 3, transition: 'width 0.5s' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: p2CompletionRate >= 70 ? '#16a34a' : '#f59e0b' }}>{p2CompletionRate}%</span>
                </div>
              </div>

              {p2Loading && !p2Questions.length && (
                <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>AI가 질문을 생성하고 있습니다...</div>
              )}

              {!p2Loading && p2Error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: '#DC2626', marginBottom: 8 }}>{p2Error}</div>
                  <button className="btn" type="button" onClick={() => { setP2Error(''); loadPhase2Questions(); }}
                    style={{ padding: '6px 20px', fontSize: 12 }}>
                    다시 시도
                  </button>
                </div>
              )}

              {p2Structured && (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', marginBottom: 6 }}>지금까지 정리된 내용</div>
                  <div style={{ fontSize: 12, color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p2Structured}</div>
                </div>
              )}

              {p2Questions.length > 0 && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {p2Questions.map((q, i) => (
                    <div key={i} style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: S.primary }}>{q}</div>
                      <textarea value={p2Answers[i] || ''} onChange={e => setP2Answers(prev => { const next = [...prev]; next[i] = e.target.value; return next; })}
                        placeholder="자유롭게 답변해 주세요 (모르면 비워둬도 됩니다)" rows={2}
                        style={{ ...S.input, resize: 'vertical' as any, lineHeight: 1.5 }} />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn btn-outline" type="button" onClick={() => setPhase(1)}>← 이전</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {p2Round <= 3 && p2Questions.length > 0 && (
                    <button className="btn" type="button" onClick={submitPhase2Answers} disabled={p2Loading}
                      style={{ padding: '8px 20px' }}>
                      {p2Loading ? '처리 중...' : p2Round < 3 ? `답변 제출 → Round ${p2Round + 1}` : '답변 제출 → 옵션 선택'}
                    </button>
                  )}
                  <button className="btn btn-outline" type="button" onClick={() => setPhase(3)}
                    style={{ fontSize: 11 }}>건너뛰기 →</button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ Phase 3 (procedure): BPMN 프로세스 생성 ═══ */}
          {phase === 3 && isProcedure && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>3단계: BPMN 프로세스 생성</div>
                <div style={S.muted}>프로세스 단계를 BPMN 그래프로 변환하고, 프로세스 템플릿을 생성합니다.</div>
              </div>

              {/* BPMN 변환 중 */}
              {bpmnLoading && !bpmnJson && (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>BPMN 프로세스를 생성하고 있습니다...</div>
                  <div style={{ fontSize: 12 }}>프로세스 단계를 분석하여 노드/엣지로 변환 중입니다.</div>
                </div>
              )}

              {/* BPMN 결과 미리보기 */}
              {bpmnJson && (
                <div style={{ border: '2px solid #0F3D73', borderRadius: 12, padding: 16, background: '#EFF6FF' }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0F3D73', marginBottom: 10 }}>BPMN 프로세스 구조</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div style={{ background: '#fff', border: '1px solid #BFDBFE', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: '#1e40af', marginBottom: 6 }}>노드 ({(bpmnJson.nodes || []).length}개)</div>
                      <div style={{ display: 'grid', gap: 3 }}>
                        {(bpmnJson.nodes || []).map((n: any, i: number) => (
                          <div key={i} style={{ fontSize: 11, color: '#0f172a', display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: '#64748b', minWidth: 60 }}>
                              {n.type === 'start' ? '🟢 시작' : n.type === 'end' ? '🔴 종료' : n.type === 'gateway_xor' ? '🔶 분기' : `📋 ${n.taskType || 'TASK'}`}
                            </span>
                            <span style={{ fontWeight: 600 }}>{n.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid #BFDBFE', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: '#1e40af', marginBottom: 6 }}>흐름 ({(bpmnJson.edges || []).length}개)</div>
                      <div style={{ display: 'grid', gap: 3 }}>
                        {(bpmnJson.edges || []).map((e: any, i: number) => {
                          const src = (bpmnJson.nodes || []).find((n: any) => n.id === e.source);
                          const tgt = (bpmnJson.nodes || []).find((n: any) => n.id === e.target);
                          return (
                            <div key={i} style={{ fontSize: 11, color: '#334155' }}>
                              {src?.name || e.source} → {tgt?.name || e.target}
                              {e.condition && <span style={{ color: '#64748b', fontSize: 10 }}> ({e.condition})</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* 프로세스 템플릿 생성 / 편집기 이동 */}
                  {!bpmnTemplateId ? (
                    <button className="btn" type="button" onClick={createBpmnTemplate} disabled={modLoading === 'bpmn_engine'}
                      style={{ width: '100%', padding: '12px 24px', fontSize: 14, fontWeight: 800, background: '#0F3D73' }}>
                      {modLoading === 'bpmn_engine' ? '프로세스 템플릿 생성 중...' : '프로세스 템플릿 생성'}
                    </button>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 8, padding: 10, textAlign: 'center', fontWeight: 700, fontSize: 13, color: '#166534' }}>
                        프로세스 템플릿이 생성되었습니다!
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <button className="btn btn-outline" type="button"
                          onClick={() => window.open(`/process/templates?openId=${encodeURIComponent(bpmnTemplateId)}`, '_blank')}
                          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>
                          프로세스 편집기 (새 탭)
                        </button>
                        <button className="btn" type="button"
                          onClick={() => nav(`/process/templates?openId=${encodeURIComponent(bpmnTemplateId)}`)}
                          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>
                          프로세스 편집기로 이동 →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* BPMN 변환 실패 시 */}
              {!bpmnLoading && !bpmnJson && (
                <div style={{ border: '1px solid #FCD34D', borderRadius: 10, background: '#FFFBEB', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#92400E', marginBottom: 8 }}>BPMN 변환이 아직 완료되지 않았습니다.</div>
                  <button className="btn" type="button" onClick={() => { void procSaveAndBpmn(); }} style={{ padding: '8px 20px', fontSize: 13 }}>
                    BPMN 변환 시작
                  </button>
                </div>
              )}

              {/* 옵션 선택 (procedure도 추가 옵션 선택 가능) */}
              {!p3Loading && optionGroups.length > 0 && (
                <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 2 }}>추가 옵션 선택</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>기본 BPMN 프로세스 외에 추가로 포함할 콘텐츠와 기능을 선택하세요.</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {optionGroups.map(grp => (
                      <div key={grp.id}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 4 }}>{grp.label}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {grp.items.map(it => {
                            const sel = (p3Selected[grp.id] || []).includes(it.id);
                            const rec = p3Recommended.includes(it.id);
                            return (
                              <button key={it.id} type="button" onClick={() => toggleOption(grp.id, it.id)}
                                style={{
                                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: sel ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s',
                                  border: sel ? '1.5px solid #0F3D73' : '1px solid #CBD5E1',
                                  background: sel ? '#EFF6FF' : '#fff',
                                  color: sel ? '#0F3D73' : '#374151',
                                }}>
                                {it.label}
                                {rec && !sel && <span style={{ marginLeft: 4, fontSize: 10, color: '#f59e0b' }}>추천</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn btn-outline" type="button" onClick={() => setPhase(2)}>← 이전: 프로세스 단계 편집</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline" type="button" onClick={() => nav('/manuals')}>매뉴얼 목록으로</button>
                  <button className="btn" type="button" onClick={() => { void savePhase3(); }} disabled={saving} style={{ padding: '8px 24px' }}>
                    {saving ? '저장 중...' : '다음: 산출물 생성 →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ Phase 3 (non-procedure): 옵션 선택 ═══ */}
          {phase === 3 && !isProcedure && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>3단계: 옵션 선택</div>
                <div style={S.muted}>AI가 입력 내용을 분석하여 추천한 옵션입니다. 필요에 따라 수정해 주세요.</div>
              </div>

              {p3Loading ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>옵션을 분석하고 있습니다...</div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {optionGroups.map(grp => (
                    <div key={grp.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 2 }}>{grp.label}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{grp.description}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {grp.items.map(it => {
                          const sel = (p3Selected[grp.id] || []).includes(it.id);
                          const rec = p3Recommended.includes(it.id);
                          return (
                            <button key={it.id} type="button" onClick={() => toggleOption(grp.id, it.id)}
                              style={{
                                padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: sel ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s',
                                border: sel ? '1.5px solid #0F3D73' : '1px solid #CBD5E1',
                                background: sel ? '#EFF6FF' : '#fff',
                                color: sel ? S.primary : '#374151',
                              }}>
                              {it.label}
                              {rec && !sel && <span style={{ marginLeft: 4, fontSize: 10, color: '#f59e0b' }}>추천</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn btn-outline" type="button" onClick={() => setPhase(2)}>← 이전</button>
                <button className="btn" type="button" onClick={savePhase3} disabled={saving}
                  style={{ padding: '8px 24px' }}>
                  {saving ? '저장 중...' : '다음: 산출물 생성 →'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ Phase 4: 산출물 생성 ═══ */}
          {phase === 4 && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                  4단계: {selectedBaseType === 'procedure' ? '프로세스 생성' : '산출물 생성'}
                </div>
                <div style={S.muted}>
                  {selectedBaseType === 'procedure'
                    ? 'AI가 입력된 정보를 BPMN 프로세스로 변환합니다. 매뉴얼 → BPMN 변환 → 프로세스 템플릿 순으로 자동 진행됩니다.'
                    : 'AI가 입력된 정보를 바탕으로 구조화된 매뉴얼을 생성합니다.'}
                </div>
              </div>

              {/* ── 모드별 안내 배너 ── */}
              {workMode === 'skill-plus' && skillFile && (
                <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: 10, fontSize: 12, color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>🧠 <strong>스킬 추가 모드</strong> — 기존 모듈 생성 + Skill File 기반 보강 기능 활성</span>
                  <button className="btn" type="button" onClick={() => { setShowSkillPanel(true); setSkillTab('modules'); }}
                    style={{ fontSize: 10, padding: '3px 10px', whiteSpace: 'nowrap' }}>Skill 패널 열기</button>
                </div>
              )}
              {workMode === 'skill-plus' && !skillFile && manual?.content && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: 10, fontSize: 12, color: '#92400E', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>💡 Skill File을 생성하면 Q&A/인수인계/정밀 모듈 생성 기능을 추가로 사용할 수 있습니다.</span>
                  <button className="btn" type="button" onClick={generateSkillFile} disabled={skillLoading}
                    style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}>
                    {skillLoading ? '생성 중...' : '스킬 파일 생성'}
                  </button>
                </div>
              )}
              {workMode === 'skill-center' && !skillFile && manual?.content && (
                <div style={{ background: '#F5F3FF', border: '2px solid #DDD6FE', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#7C3AED', marginBottom: 6 }}>⚡ 스킬 중심 모드 — Skill File 필요</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>이 모드에서는 Skill File이 모든 모듈 생성의 중심입니다. 먼저 Skill File을 생성해주세요.</div>
                  <button className="btn" type="button" onClick={generateSkillFile} disabled={skillLoading}
                    style={{ padding: '8px 24px', background: '#7C3AED' }}>
                    {skillLoading ? '스킬 파일 생성 중...' : '🧠 스킬 파일 생성'}
                  </button>
                </div>
              )}
              {workMode === 'skill-center' && skillFile && (
                <div style={{ background: '#F5F3FF', border: '2px solid #DDD6FE', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#7C3AED', marginBottom: 4 }}>⚡ 스킬 중심 모드 — Skill File → 모듈 직접 생성</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>구조화된 Skill File에서 직접 모듈을 생성합니다. 기존 from-manual보다 정확도가 높습니다.</div>
                  <button className="btn" type="button" onClick={() => { setShowSkillPanel(true); setSkillTab('modules'); }}
                    style={{ padding: '6px 16px', fontSize: 12, background: '#7C3AED' }}>
                    📋 Skill File 모듈 생성 패널 열기
                  </button>
                </div>
              )}

              {/* 로딩: 매뉴얼 생성 중 */}
              {p4Loading && !p4Content && (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    {selectedBaseType === 'procedure' ? 'BPMN 형식 매뉴얼을 생성하고 있습니다...' : '매뉴얼을 생성하고 있습니다...'}
                  </div>
                  <div style={{ fontSize: 12 }}>기본형과 옵션에 따라 최적화된 산출물을 만들고 있습니다.</div>
                </div>
              )}

              {p4Summary && (
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: 10, fontSize: 13, color: '#166534' }}>
                  {p4Summary}
                </div>
              )}

              {p4Security.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#b91c1c', marginBottom: 4 }}>보안정보 {p4Security.length}건 감지 (분리 저장됨)</div>
                  {p4Security.map((s, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#7f1d1d' }}>{s.systemName}: {s.replacement}</div>
                  ))}
                </div>
              )}

              {p4Content && (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, maxHeight: selectedBaseType === 'procedure' ? 300 : 500, overflow: 'auto' }}>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7, color: '#0f172a', margin: 0 }}>{p4Content}</pre>
                </div>
              )}

              {/* ── 업무 절차 기본형: BPMN 자동 변환 플로우 (classic/skill-plus만) ── */}
              {workMode !== 'skill-center' && selectedBaseType === 'procedure' && p4Content && (
                <div style={{ border: '2px solid #0F3D73', borderRadius: 12, padding: 16, background: '#EFF6FF' }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0F3D73', marginBottom: 10 }}>⚙️ BPMN 프로세스 변환</div>

                  {/* BPMN 변환 중 */}
                  {bpmnLoading && !bpmnJson && (
                    <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>BPMN 프로세스를 생성하고 있습니다...</div>
                      <div style={{ fontSize: 11 }}>매뉴얼의 STEP 구조를 분석하여 프로세스 노드/엣지로 변환 중입니다.</div>
                    </div>
                  )}

                  {/* BPMN 미리보기 */}
                  {bpmnJson && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div style={{ background: '#fff', border: '1px solid #BFDBFE', borderRadius: 8, padding: 10 }}>
                          <div style={{ fontWeight: 700, fontSize: 11, color: '#1e40af', marginBottom: 6 }}>노드 ({(bpmnJson.nodes || []).length}개)</div>
                          <div style={{ display: 'grid', gap: 3 }}>
                            {(bpmnJson.nodes || []).map((n: any, i: number) => (
                              <div key={i} style={{ fontSize: 11, color: '#0f172a', display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ fontSize: 10, color: '#64748b', minWidth: 60 }}>
                                  {n.type === 'start' ? '🟢 시작' : n.type === 'end' ? '🔴 종료' : n.type === 'gateway_xor' ? '🔶 분기' : `📋 ${n.taskType || 'TASK'}`}
                                </span>
                                <span style={{ fontWeight: 600 }}>{n.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ background: '#fff', border: '1px solid #BFDBFE', borderRadius: 8, padding: 10 }}>
                          <div style={{ fontWeight: 700, fontSize: 11, color: '#1e40af', marginBottom: 6 }}>흐름 ({(bpmnJson.edges || []).length}개)</div>
                          <div style={{ display: 'grid', gap: 3 }}>
                            {(bpmnJson.edges || []).map((e: any, i: number) => {
                              const src = (bpmnJson.nodes || []).find((n: any) => n.id === e.source);
                              const tgt = (bpmnJson.nodes || []).find((n: any) => n.id === e.target);
                              return (
                                <div key={i} style={{ fontSize: 11, color: '#334155' }}>
                                  {src?.name || e.source} → {tgt?.name || e.target}
                                  {e.condition && <span style={{ color: '#64748b', fontSize: 10 }}> ({e.condition})</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* 프로세스 템플릿 생성 / 편집기 이동 */}
                      {!bpmnTemplateId ? (
                        <button className="btn" type="button" onClick={createBpmnTemplate} disabled={modLoading === 'bpmn_engine'}
                          style={{ padding: '10px 24px', fontSize: 14, fontWeight: 800, background: '#0F3D73' }}>
                          {modLoading === 'bpmn_engine' ? '프로세스 템플릿 생성 중...' : '✅ 프로세스 템플릿 생성'}
                        </button>
                      ) : (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 8, padding: 10, textAlign: 'center', fontWeight: 700, fontSize: 13, color: '#166534' }}>
                            프로세스 템플릿이 생성되었습니다!
                          </div>
                          <button className="btn" type="button"
                            onClick={() => nav(`/process/templates?openId=${encodeURIComponent(bpmnTemplateId)}`)}
                            style={{ padding: '10px 24px', fontSize: 14, fontWeight: 800 }}>
                            🔧 프로세스 편집기에서 확인/수정 →
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* BPMN 변환 실패 시 수동 버튼 */}
                  {!bpmnLoading && !bpmnJson && p4Content && (
                    <button className="btn" type="button" onClick={autoBpmnConvert} style={{ padding: '8px 20px', fontSize: 12 }}>
                      BPMN 변환 재시도
                    </button>
                  )}
                </div>
              )}

              {/* ── 다른 기본형: 기존 모듈 연동 (classic/skill-plus만) ── */}
              {workMode !== 'skill-center' && selectedBaseType !== 'procedure' && p4Content && applicableModules.length > 0 && (
                <div style={{ border: '1px solid #C7D2FE', borderRadius: 10, padding: 12, background: '#EEF2FF' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#3730a3', marginBottom: 8 }}>모듈 연동</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {applicableModules.filter(mk => mk !== 'bpmn_engine').map(mk => {
                      const mod = MODULE_MAP[mk];
                      if (!mod) return null;
                      const created = isModuleCreated(mk);
                      return (
                        <div key={mk} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: '1px solid #E0E7FF', borderRadius: 8, padding: '8px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>{mod.icon}</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 12, color: '#1e1b4b' }}>{mod.label}</div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{mod.desc}</div>
                            </div>
                          </div>
                          <button className="btn" type="button" disabled={created || modLoading === mk}
                            onClick={() => createModuleIntegration(mk)}
                            style={{ padding: '5px 14px', fontSize: 11, background: created ? '#16a34a' : undefined, whiteSpace: 'nowrap' }}>
                            {modLoading === mk ? '처리 중...' : created ? '완료 ✓' : '등록'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn btn-outline" type="button" onClick={() => setPhase(3)}>← 이전</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!p4Content && !p4Loading && (
                    <button className="btn" type="button" onClick={generatePhase4}>산출물 생성</button>
                  )}
                  {p4Content && (
                    <button className="btn" type="button" onClick={() => setPhase(5)} style={{ padding: '8px 24px' }}>
                      다음: 암묵지 보완 →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ Phase 5: 암묵지 보완 (classic / skill-plus) ═══ */}
          {phase === 5 && workMode !== 'skill-center' && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>5단계: 암묵지 보완</div>
                <div style={S.muted}>경험에서 나오는 노하우나 주의사항을 추가해 주세요. 답하기 어려운 질문은 건너뛰셔도 됩니다.</div>
              </div>

              {p5Loading && !p5Questions.length && (
                <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>질문을 준비하고 있습니다...</div>
              )}

              {p5Final ? (
                <>
                  {p5Summary && (
                    <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: 10, fontSize: 13, color: '#166534' }}>
                      {p5Summary}
                    </div>
                  )}
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, maxHeight: 500, overflow: 'auto' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 8 }}>최종 매뉴얼</div>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7, color: '#0f172a', margin: 0 }}>{p5Final}</pre>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <button className="btn btn-outline" type="button" onClick={() => nav('/manuals')}>기존 매뉴얼로 이동</button>
                    <button className="btn" type="button" onClick={newManual} style={{ padding: '8px 24px' }}>새 매뉴얼 작성</button>
                  </div>
                </>
              ) : (
                <>
                  {p5Questions.map(q => (
                    <div key={q.id} style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: S.primary }}>{q.question}</div>
                      <textarea value={p5Answers[q.id] || ''} onChange={e => setP5Answers(prev => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="경험이나 노하우를 자유롭게 적어주세요 (건너뛰기 가능)" rows={2}
                        style={{ ...S.input, resize: 'vertical' as any, lineHeight: 1.5 }} />
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <button className="btn btn-outline" type="button" onClick={() => setPhase(4)}>← 이전</button>
                    <button className="btn" type="button" onClick={completePhase5} disabled={p5Loading}
                      style={{ padding: '8px 24px' }}>
                      {p5Loading ? '처리 중...' : '매뉴얼 완성'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ Phase 5: Skill File Q&A + 인수인계 (skill-center) ═══ */}
          {phase === 5 && workMode === 'skill-center' && (
            <div style={{ display: 'grid', gap: 12, animation: 'phase-fade 0.25s ease-out' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#7C3AED' }}>5단계: 스킬 파일 활용</div>
                <div style={S.muted}>Skill File 기반 Q&A로 업무 지식을 검증하고, 인수인계 가이드를 확인하세요.</div>
              </div>

              {skillFile ? (() => {
                const sd = skillFile.skillData || {};
                return (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {/* 인수인계 가이드 */}
                    {sd.handover && (
                      <div style={{ border: '2px solid #DDD6FE', borderRadius: 10, padding: 12, background: '#F5F3FF' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#7C3AED', marginBottom: 8 }}>📋 인수인계 가이드</div>
                        {sd.handover.criticalPoints?.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 12, color: '#DC2626', marginBottom: 4 }}>⚠ 핵심 주의사항</div>
                            {sd.handover.criticalPoints.map((p: string, i: number) => <div key={i} style={{ fontSize: 12, color: '#7f1d1d', paddingLeft: 8, marginBottom: 2 }}>• {p}</div>)}
                          </div>
                        )}
                        {sd.handover.firstWeekGuide?.length > 0 && (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12, color: '#5B21B6', marginBottom: 4 }}>📅 첫 주 가이드</div>
                            {sd.handover.firstWeekGuide.map((g: string, i: number) => <div key={i} style={{ fontSize: 12, color: '#475569', paddingLeft: 8, marginBottom: 2 }}>• {g}</div>)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 암묵지/노하우 */}
                    {sd.tacitKnowledge?.length > 0 && (
                      <div style={{ border: '1px solid #FDE68A', borderRadius: 10, padding: 12, background: '#FFFBEB' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#92400E', marginBottom: 8 }}>💡 암묵지 / 노하우</div>
                        {sd.tacitKnowledge.map((tk: any, i: number) => (
                          <div key={i} style={{ fontSize: 12, color: '#78350F', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600 }}>[{String(tk.category ?? '')}]</span> {String(tk.content ?? '')}
                            {tk.context && <span style={{ color: '#92400E' }}> — {String(tk.context ?? '')}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Q&A 인라인 */}
                    <div style={{ border: '2px solid #E2E8F0', borderRadius: 10, padding: 12, background: '#FAFBFC' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 8 }}>💬 업무 Q&A</div>
                      <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 6, marginBottom: 8 }}>
                        {qaMessages.length === 0 && (
                          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: 12 }}>이 업무에 대해 궁금한 것을 질문해보세요.</div>
                        )}
                        {qaMessages.map((m, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                            <div style={{
                              maxWidth: '85%', padding: '8px 12px',
                              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                              background: m.role === 'user' ? '#7C3AED' : '#F1F5F9',
                              color: m.role === 'user' ? '#fff' : '#0f172a', fontSize: 12, lineHeight: 1.6,
                            }}>
                              <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                              {m.suggestedFollowUp?.length ? (
                                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {m.suggestedFollowUp.map((sq, j) => (
                                    <button key={j} type="button" onClick={() => sendQaQuestion(sq)}
                                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: 'pointer' }}>{sq}</button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {qaLoading && <div style={{ fontSize: 12, color: '#64748b', padding: 8 }}>답변 생성 중...</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input value={qaInput} onChange={e => setQaInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQaQuestion(); } }}
                          placeholder="질문을 입력하세요..." style={{ flex: 1, padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, outline: 'none' }} />
                        <button className="btn" type="button" onClick={() => sendQaQuestion()} disabled={qaLoading || !qaInput.trim()}
                          style={{ padding: '8px 16px', fontSize: 12, background: '#7C3AED' }}>전송</button>
                      </div>
                    </div>

                    {/* 완료 상태 */}
                    {skillCenterDone && (
                      <div style={{ background: '#F0FDF4', border: '2px solid #86EFAC', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#166534', marginBottom: 4 }}>스킬 파일 검증 완료</div>
                        <div style={{ fontSize: 12, color: '#15803d' }}>인수인계 가이드와 Q&A가 확인되었습니다.</div>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <button className="btn btn-outline" type="button" onClick={() => setPhase(4)}>← 이전</button>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-outline" type="button" onClick={() => { setShowSkillPanel(true); setSkillTab('overview'); }}>📋 전체 스킬 파일 보기</button>
                        {!skillCenterDone ? (
                          <button className="btn" type="button" onClick={() => { setSkillCenterDone(true); setShowRating(true); }}
                            style={{ padding: '8px 24px', background: '#7C3AED' }}>
                            스킬 파일 검증 완료
                          </button>
                        ) : (
                          <button className="btn" type="button" onClick={newManual} style={{ padding: '8px 24px' }}>새 매뉴얼 작성</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Skill File이 필요합니다</div>
                  <button className="btn" type="button" onClick={generateSkillFile} disabled={skillLoading}
                    style={{ padding: '8px 24px', background: '#7C3AED' }}>
                    {skillLoading ? '생성 중...' : '🧠 스킬 파일 생성'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* No selection */}
          {!manual && phase === 1 && !selectedBaseType && baseTypes.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>로딩 중...</div>
          )}
        </div>
      </div>

      {/* ═══ Skill File 패널 (슬라이드 오버) ═══ */}
      {showSkillPanel && skillFile && (() => {
        const sd = skillFile.skillData || {};
        const tabs: Array<{ key: typeof skillTab; label: string }> = [
          { key: 'overview', label: '개요' },
          { key: 'steps', label: '단계' },
          { key: 'faq', label: 'FAQ' },
          { key: 'modules', label: '모듈 생성' },
          { key: 'qa', label: 'Q&A' },
        ];
        return (
          <div style={{ position: 'fixed', top: 0, right: 0, width: 480, height: '100vh', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 1000, display: 'flex', flexDirection: 'column', animation: 'slide-in 0.2s ease-out' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>📋</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>업무 스킬 파일</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>v{skillFile.version} · {sd.meta?.domain || sd.meta?.baseType || ''}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline" type="button" onClick={skillFileToBpmn} disabled={bpmnLoading} style={{ fontSize: 11, padding: '4px 10px' }}>
                  {bpmnLoading ? '변환 중...' : 'BPMN 생성'}
                </button>
                <button type="button" onClick={() => setShowSkillPanel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#64748b', padding: '2px 6px' }}>✕</button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', background: '#FAFBFC' }}>
              {tabs.map(t => (
                <button key={t.key} type="button" onClick={() => setSkillTab(t.key)}
                  style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: skillTab === t.key ? 700 : 400, border: 'none', borderBottom: skillTab === t.key ? '2px solid #0F3D73' : '2px solid transparent', background: 'transparent', cursor: 'pointer', color: skillTab === t.key ? '#0F3D73' : '#64748b' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

              {/* Overview Tab */}
              {skillTab === 'overview' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ background: '#EFF6FF', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af', marginBottom: 4 }}>{sd.meta?.title}</div>
                    <div style={{ fontSize: 12, color: '#334155' }}>{sd.overview?.purpose}</div>
                  </div>
                  {sd.overview?.scope && <div style={{ fontSize: 12, color: '#475569' }}><strong>적용 범위:</strong> {sd.overview.scope}</div>}
                  {sd.overview?.triggerConditions?.length > 0 && (
                    <div><div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', marginBottom: 4 }}>시작 조건</div>
                      {sd.overview.triggerConditions.map((c: string, i: number) => <div key={i} style={{ fontSize: 12, color: '#475569', paddingLeft: 8 }}>• {c}</div>)}
                    </div>
                  )}
                  {sd.actors?.length > 0 && (
                    <div><div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', marginBottom: 4 }}>역할</div>
                      {sd.actors.map((a: any, i: number) => (
                        <div key={i} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, padding: 8, marginBottom: 4 }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{a.role} {a.department ? `(${a.department})` : ''}</div>
                          {a.responsibilities?.map((r: string, j: number) => <div key={j} style={{ fontSize: 11, color: '#64748b', paddingLeft: 8 }}>- {r}</div>)}
                        </div>
                      ))}
                    </div>
                  )}
                  {sd.exceptions?.length > 0 && (
                    <div><div style={{ fontWeight: 700, fontSize: 12, color: '#DC2626', marginBottom: 4 }}>예외 상황</div>
                      {sd.exceptions.map((e: any, i: number) => (
                        <div key={i} style={{ background: '#FEF2F2', borderRadius: 6, padding: 8, marginBottom: 4, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#991B1B' }}>{e.situation}</div>
                          <div style={{ color: '#475569' }}>대응: {e.response}</div>
                          {e.escalation && <div style={{ color: '#64748b', fontSize: 11 }}>에스컬레이션: {e.escalation}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {sd.handover && (
                    <div><div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', marginBottom: 4 }}>인수인계 가이드</div>
                      {sd.handover.criticalPoints?.map((p: string, i: number) => <div key={i} style={{ fontSize: 12, color: '#DC2626', paddingLeft: 8 }}>⚠ {p}</div>)}
                      {sd.handover.firstWeekGuide?.map((g: string, i: number) => <div key={i} style={{ fontSize: 12, color: '#475569', paddingLeft: 8 }}>• {g}</div>)}
                    </div>
                  )}
                </div>
              )}

              {/* Steps Tab */}
              {skillTab === 'steps' && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {(sd.steps || []).map((step: any, i: number) => (
                    <div key={step.id || i} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ background: step.taskType === 'APPROVAL' ? '#DC2626' : step.taskType === 'COOPERATION' ? '#D97706' : '#0F3D73', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{step.taskType || 'WORKLOG'}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{step.id} {step.name}</span>
                      </div>
                      {step.actor && <div style={{ fontSize: 11, color: '#64748b' }}>담당: {step.actor}</div>}
                      {step.purpose && <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{step.purpose}</div>}
                      {step.method && <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>방법: {step.method}</div>}
                      {step.tips?.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {step.tips.map((t: string, j: number) => <div key={j} style={{ fontSize: 11, color: '#16a34a', paddingLeft: 8 }}>💡 {t}</div>)}
                        </div>
                      )}
                      {step.commonMistakes?.length > 0 && (
                        <div style={{ marginTop: 2 }}>
                          {step.commonMistakes.map((m: string, j: number) => <div key={j} style={{ fontSize: 11, color: '#DC2626', paddingLeft: 8 }}>⚠ {m}</div>)}
                        </div>
                      )}
                    </div>
                  ))}
                  {sd.decisions?.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#7C3AED', marginBottom: 4 }}>분기점</div>
                      {sd.decisions.map((d: any, i: number) => (
                        <div key={i} style={{ background: '#F5F3FF', borderRadius: 6, padding: 8, marginBottom: 4, fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{d.afterStep} 이후: {d.question}</div>
                          {d.conditions?.map((c: any, j: number) => <div key={j} style={{ paddingLeft: 8, color: '#6D28D9' }}>→ {c.condition}: {c.nextStep}</div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* FAQ Tab */}
              {skillTab === 'faq' && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {(sd.faq || []).map((f: any, i: number) => (
                    <div key={i} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#0F3D73', marginBottom: 4 }}>Q. {f.question}</div>
                      <div style={{ fontSize: 12, color: '#334155' }}>{f.answer}</div>
                    </div>
                  ))}
                  {sd.tacitKnowledge?.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', marginBottom: 4 }}>암묵지 / 노하우</div>
                      {sd.tacitKnowledge.map((tk: any, i: number) => (
                        <div key={i} style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: 8, marginBottom: 4, fontSize: 12 }}>
                          <span style={{ fontWeight: 600 }}>[{String(tk.category ?? '')}]</span> {String(tk.content ?? '')}
                          {tk.context && <div style={{ color: '#92400E', fontSize: 11 }}>상황: {String(tk.context ?? '')}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Modules Tab */}
              {skillTab === 'modules' && (() => {
                const SF_MODULES: Array<{ key: string; icon: string; label: string; desc: string; forTypes: string[] }> = [
                  { key: 'bpmn_engine', icon: '🔄', label: 'BPMN 프로세스', desc: 'steps+decisions → 워크플로우', forTypes: ['procedure'] },
                  { key: 'schedule_mgmt', icon: '📅', label: '일정/마일스톤', desc: 'steps → 일정 + 마일스톤 자동 생성', forTypes: ['dev_project'] },
                  { key: 'knowledge_base', icon: '📚', label: '지식베이스', desc: 'steps+faq+tacit → 구조화된 지식 문서', forTypes: ['system_operation', 'calculation'] },
                  { key: 'periodic_alarm_report', icon: '⏰', label: '주기 알람/점검', desc: 'steps → 체크리스트 + 주기 알람', forTypes: ['inspection_mgmt'] },
                ];
                const bt = sd.meta?.baseType || manual?.baseType || '';
                return (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ background: '#EFF6FF', borderRadius: 8, padding: 10, fontSize: 12, color: '#1e40af' }}>
                      Skill File의 구조화된 데이터를 기반으로 각 모듈을 생성합니다.<br/>
                      기존 방식(매뉴얼 텍스트 → 모듈)보다 <strong>정확도가 높습니다</strong>.
                    </div>

                    <div style={{ display: 'grid', gap: 6 }}>
                      {SF_MODULES.map(mod => {
                        const isPrimary = mod.forTypes.includes(bt);
                        const created = sfModCreated[mod.key];
                        return (
                          <div key={mod.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isPrimary ? '#F0FDF4' : '#fff', border: `1px solid ${isPrimary ? '#BBF7D0' : '#E2E8F0'}`, borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 18 }}>{mod.icon}</span>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a' }}>
                                  {mod.label}
                                  {isPrimary && <span style={{ marginLeft: 6, fontSize: 10, background: '#16a34a', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>주 모듈</span>}
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b' }}>{mod.desc}</div>
                              </div>
                            </div>
                            <button className="btn" type="button"
                              disabled={created || sfModLoading === mod.key}
                              onClick={() => createSkillModule(mod.key)}
                              style={{ padding: '5px 14px', fontSize: 11, background: created ? '#16a34a' : undefined, whiteSpace: 'nowrap' }}>
                              {sfModLoading === mod.key ? '생성 중...' : created ? '완료 ✓' : '생성'}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: 10, fontSize: 11, color: '#92400E' }}>
                      <strong>비교 검증 방법:</strong> Phase 4의 기존 모듈 생성(방안A)과 여기서의 Skill File 기반 생성(방안B)을 각각 실행한 뒤 결과를 비교할 수 있습니다. 두 방안 모두 독립적으로 동작합니다.
                    </div>
                  </div>
                );
              })()}

              {/* Q&A Chat Tab */}
              {skillTab === 'qa' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>이 업무에 대해 궁금한 것을 자유롭게 질문하세요. Skill File을 기반으로 답변합니다.</div>
                  <div style={{ flex: 1, overflow: 'auto', display: 'grid', gap: 8, alignContent: 'start' }}>
                    {qaMessages.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '85%', padding: '8px 12px', borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          background: m.role === 'user' ? '#0F3D73' : '#F1F5F9', color: m.role === 'user' ? '#fff' : '#0f172a', fontSize: 12, lineHeight: 1.6,
                        }}>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                          {m.relatedSteps?.length ? <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>관련 단계: {m.relatedSteps.join(', ')}</div> : null}
                          {m.suggestedFollowUp?.length ? (
                            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {m.suggestedFollowUp.map((sq, j) => (
                                <button key={j} type="button" onClick={() => sendQaQuestion(sq)}
                                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                  {sq}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {qaLoading && <div style={{ fontSize: 12, color: '#64748b', padding: 8 }}>답변 생성 중...</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #E2E8F0', paddingTop: 8 }}>
                    <input value={qaInput} onChange={e => setQaInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQaQuestion(); } }}
                      placeholder="질문을 입력하세요..." style={{ flex: 1, padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, outline: 'none' }} />
                    <button className="btn" type="button" onClick={() => sendQaQuestion()} disabled={qaLoading || !qaInput.trim()} style={{ padding: '8px 16px', fontSize: 12 }}>전송</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Skill File floating button (skill-plus / skill-center only) */}
      {workMode !== 'classic' && manual && !showSkillPanel && (
        <button type="button" onClick={() => { if (skillFile) setShowSkillPanel(true); else generateSkillFile(); }}
          disabled={skillLoading}
          style={{ position: 'fixed', bottom: 24, right: 24, width: 56, height: 56, borderRadius: '50%', background: skillFile ? '#0F3D73' : '#D97706', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 22, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
          title={skillFile ? '스킬 파일 보기' : '스킬 파일 생성'}>
          {skillLoading ? '⏳' : skillFile ? '📋' : '🧠'}
        </button>
      )}

      {/* ── 만족도 평가 + KPI 대시보드 ── */}
      {showRating && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 460, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a', marginBottom: 12, textAlign: 'center' }}>매뉴얼 작성 완료</div>

            {/* KPI 요약 */}
            {kpi.startedAt > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                <div style={{ background: '#F1F5F9', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{Math.round((Date.now() - kpi.startedAt) / 60000)}분</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>소요 시간</div>
                </div>
                <div style={{ background: '#F1F5F9', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{kpi.aiCalls}회</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>AI 호출</div>
                </div>
                <div style={{ background: '#F1F5F9', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: kpi.moduleSuccesses > 0 ? '#16a34a' : '#64748b' }}>{kpi.moduleSuccesses}/{kpi.moduleAttempts}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>모듈 성공/시도</div>
                </div>
                <div style={{ background: '#F1F5F9', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#7C3AED' }}>
                    {{ classic: '📄', 'skill-plus': '🧠', 'skill-center': '⚡' }[workMode]}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{{ classic: '기존 방식', 'skill-plus': '확장 모드', 'skill-center': '스킬 중심' }[workMode]}</div>
                </div>
              </div>
            )}

            {/* 만족도 평점 */}
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#475569', marginBottom: 8 }}>이 모드의 작성 경험은 어땠나요?</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" onClick={() => setKpi(prev => ({ ...prev, rating: n }))}
                    style={{
                      width: 40, height: 40, borderRadius: '50%', border: kpi.rating === n ? '2px solid #7C3AED' : '2px solid #E2E8F0',
                      background: kpi.rating === n ? '#F5F3FF' : '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 700,
                      color: kpi.rating === n ? '#7C3AED' : '#94a3b8',
                    }}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 4, padding: '0 20px' }}>
                <span>불만족</span><span>매우 만족</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn" type="button" onClick={() => { setShowRating(false); }}
                style={{ padding: '8px 28px' }}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes phase-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}
