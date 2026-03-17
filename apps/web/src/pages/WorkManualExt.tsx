import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';

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

  // BPMN auto-conversion for procedure type
  const [bpmnJson, setBpmnJson] = useState<any>(null);
  const [bpmnLoading, setBpmnLoading] = useState(false);
  const [bpmnTemplateId, setBpmnTemplateId] = useState('');

  // Module integration
  const [modKbCreated, setModKbCreated] = useState(false);
  const [modSchedCreated, setModSchedCreated] = useState(false);
  const [modAlarmCreated, setModAlarmCreated] = useState(false);
  const [modLoading, setModLoading] = useState('');

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
    setP2Questions([]); setP2Answers([]); setP2Structured(''); setP2Round(1); setP2CompletionRate(0);
    setP3Recommended([]); setP3Selected({});
    setP4Content(''); setP4Summary(''); setP4Security([]);
    setP5Questions([]); setP5Answers({}); setP5Final(''); setP5Summary('');
  }

  // ─── Phase 1: Save & Continue ───────────────────────────
  async function savePhase1() {
    if (!userId) { toast('로그인이 필요합니다.', 'warning'); return; }
    if (!selectedBaseType) { toast('기본형을 선택해 주세요.', 'warning'); return; }
    if (!title.trim()) { toast('업무명을 입력해 주세요.', 'warning'); return; }
    if (!freeText.trim()) { toast('업무 내용을 입력해 주세요.', 'warning'); return; }

    setSaving(true);
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

  // ─── Phase 2: AI Questions ──────────────────────────────
  async function loadPhase2Questions() {
    if (!manual?.id) return;
    setP2Loading(true);
    try {
      const r = await apiJson<Phase2Response>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase2`, {
        method: 'POST',
        body: JSON.stringify({ userId, roundNum: p2Round }),
      });
      setP2Questions(r.questions || []);
      setP2Answers(new Array((r.questions || []).length).fill(''));
      setP2Structured(r.structuredSoFar || '');
      setP2Summary(r.summary || '');
      setP2CompletionRate(r.completionRate || 0);
    } catch (e: any) { toast(e?.message || 'AI 질문 생성 실패', 'error'); }
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
          body: JSON.stringify({ userId, roundNum: p2Round, answers: p2Answers }),
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
        toast(`Round ${p2Round} 완료. 다음 질문을 생성합니다.`, 'success');
      } else {
        toast('AI 구조화 질문 완료!', 'success');
        setPhase(3);
      }
    } catch (e: any) { toast(e?.message || '답변 저장 실패', 'error'); }
    finally { setP2Loading(false); }
  }

  useEffect(() => {
    if (phase === 2 && manual?.id && p2Questions.length === 0 && !p2Loading) {
      void loadPhase2Questions();
    }
  }, [phase, manual?.id, p2Round]);

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
  }, [phase, manual?.id]);

  // ─── Phase 4: Generate Output ──────────────────────────
  async function generatePhase4() {
    if (!manual?.id) return;
    setP4Loading(true);
    try {
      const r = await apiJson<Phase4Response>(`/api/work-manuals/${encodeURIComponent(manual.id)}/ext/phase4`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setP4Content(r.manualContent || '');
      setP4Summary(r.summary || '');
      setP4Security(r.securityItems || []);
      if (r.title) setTitle(r.title);
      toast('산출물 생성 완료!', 'success');

      // 업무 절차 기본형이면 자동으로 BPMN 변환 시작
      if (selectedBaseType === 'procedure' && r.manualContent) {
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
      setBpmnTemplateId(tmplId);
      toast('프로세스 템플릿이 생성되었습니다!', 'success');
    } catch (e: any) { toast(e?.message || '프로세스 템플릿 생성 실패', 'error'); }
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
        body: JSON.stringify({ userId, answers }),
      });
      setP5Final(r.finalContent || '');
      setP5Summary(r.summary || '');
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
        setModKbCreated(false); // reset
        toast('BPMN 프로세스 템플릿이 생성되었습니다.', 'success');
        nav(`/process/templates?openId=${encodeURIComponent(tmplId)}`);
      } catch (e: any) { toast(e?.message || 'BPMN 생성 실패', 'error'); }
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
      toast(`${mod.label} 완료!`, 'success');
    } catch (e: any) { toast(e?.message || `${mod.label} 실패`, 'error'); }
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
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>업무 매뉴얼 외재화</h2>
          {manual && (
            <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {PHASE_LABELS.map((s, i) => (
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
                  {saving ? '저장 중...' : '다음: AI 구조화 →'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ Phase 2: AI 구조화 질문 ═══ */}
          {phase === 2 && (
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

          {/* ═══ Phase 3: 옵션 선택 ═══ */}
          {phase === 3 && (
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

              {/* ── 업무 절차 기본형: BPMN 자동 변환 플로우 ── */}
              {selectedBaseType === 'procedure' && p4Content && (
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

              {/* ── 다른 기본형: 기존 모듈 연동 ── */}
              {selectedBaseType !== 'procedure' && p4Content && applicableModules.length > 0 && (
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

          {/* ═══ Phase 5: 암묵지 보완 ═══ */}
          {phase === 5 && (
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

          {/* No selection */}
          {!manual && phase === 1 && !selectedBaseType && baseTypes.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>로딩 중...</div>
          )}
        </div>
      </div>

      <style>{`@keyframes phase-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
