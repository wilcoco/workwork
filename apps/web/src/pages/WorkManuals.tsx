import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';
import { StepFormEditor, StepFormData, parseTextToStepForms, serializeStepsToText, makeEmptyStep } from '../components/StepFormEditor';

type WorkManualDto = {
  id?: string;
  userId?: string;
  title: string;
  content?: string | null;
  authorName?: string | null;
  authorTeamName?: string | null;
  version?: number | null;
  versionUpAt?: string | null;
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
    setValidation(null);
    setAiQuestions(null);
    setAnswers({});
    setAnswerLinks({});
    setEditMode('text');
    setStepForms([]);
    setPhase(1);
  }, [selectedId]);

  function newManual() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    setSelectedId('');
    setEditing({ title: '', content: '', authorName: userName || '', authorTeamName: teamName || '' });
  }

  function editManual(m: WorkManualDto) {
    setSelectedId(String(m.id || ''));
    setEditing({ ...m, content: m.content || '', authorName: m.authorName || '', authorTeamName: m.authorTeamName || '' });
  }

  function switchToStructured(prefilled?: StepFormData[]) {
    if (!editing) return;
    if (prefilled && prefilled.length) {
      setStepForms(prefilled);
      setEditMode('structured');
      return;
    }
    const text = String(editing.content || '');
    const forms = parseTextToStepForms(text);
    if (!forms.length && text.trim().length > 0) {
      const ok = confirm('현재 메뉴얼에서 STEP 블록을 찾을 수 없습니다.\n\n빈 단계 하나로 구조화 편집을 시작할까요?');
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
    if (!userId) { alert('로그인이 필요합니다.'); return; }
    if (!editing?.id) { alert('먼저 메뉴얼을 저장해 주세요.'); return; }
    const content = String(editing.content || '').trim();
    if (!content) { alert('메뉴얼 내용을 먼저 입력해 주세요.'); return; }
    setDraftLoading(true);
    try {
      const r = await apiJson<{ draftContent: string; stepCount: number; summary: string }>(
        `/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/draft-steps`,
        { method: 'POST', body: JSON.stringify({ userId }) },
      );
      if (!r?.draftContent) throw new Error('AI 응답이 올바르지 않습니다.');
      const ok = confirm(`AI가 ${r.stepCount}개 STEP 초안을 생성했습니다.\n\n${r.summary}\n\n구조화 편집 모드로 전환하여 초안을 확인할까요?\n(현재 메뉴얼 내용은 이 초안으로 교체됩니다)`);
      if (!ok) return;
      setEditing(prev => prev ? { ...prev, content: r.draftContent } : prev);
      const forms = parseTextToStepForms(r.draftContent);
      switchToStructured(forms.length ? forms : undefined);
    } catch (e: any) {
      alert(e?.message || 'AI STEP 초안 생성에 실패했습니다.');
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

  function insertAiFormatTemplate() {
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
      const ok = confirm('현재 메뉴얼 내용 뒤에 AI 포맷 템플릿을 추가할까요?');
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
    if (!r.issues.length) alert('메뉴얼 점검 결과: 문제를 찾지 못했습니다.');
  }

  async function aiMakeQuestions() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing?.id) {
      alert('먼저 메뉴얼을 저장해 주세요.');
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
      });
    } catch (e: any) {
      alert(e?.message || 'AI 보완 질문 생성에 실패했습니다.');
    } finally {
      setAiQuestionsLoading(false);
    }
  }

  async function save() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing) return;
    const title = String(editing.title || '').trim();
    if (!title) {
      alert('업무명을 입력하세요.');
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
      alert('저장되었습니다.');
    } catch (e: any) {
      alert(e?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing?.id) return;
    const ok = confirm('이 메뉴얼을 삭제할까요?');
    if (!ok) return;
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await loadList('');
      alert('삭제되었습니다.');
    } catch (e: any) {
      alert(e?.message || '삭제에 실패했습니다.');
    }
  }

  async function aiToBpmn() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing?.id) {
      alert('먼저 메뉴얼을 저장해 주세요.');
      return;
    }

    const v = validateManual(String(editing.content || ''));
    const mustIssues = v.issues.filter((x) => x.severity === 'MUST');
    const shouldIssues = v.issues.filter((x) => x.severity === 'SHOULD');
    if (mustIssues.length) {
      setValidation({ issues: v.issues });
      alert(`AI로 BPMN 생성 전에 반드시 수정해야 할 항목이 ${mustIssues.length}개 있습니다. 아래 “메뉴얼 점검 결과”를 확인해 주세요.`);
      return;
    }
    if (shouldIssues.length) {
      setValidation({ issues: v.issues });
      const ok = confirm(`AI로 BPMN 생성 전에 보완하면 좋은 항목이 ${shouldIssues.length}개 있습니다.\n\n그래도 AI로 BPMN 생성을 진행할까요?`);
      if (!ok) return;
    }

    setAiLoading(true);
    try {
      const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/bpmn`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      const tmplTitle = String(r?.title || '').trim();
      const bpmnJson = r?.bpmnJson;
      if (!tmplTitle || !bpmnJson) throw new Error('AI 응답이 올바르지 않습니다.');

      const ok = confirm(`AI가 BPMN 초안을 만들었습니다.\n\n- 템플릿 제목: ${tmplTitle}\n\n이 초안으로 프로세스 템플릿을 생성할까요?`);
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
      alert('프로세스 템플릿이 생성되었습니다.');
      nav(`/process/templates?openId=${encodeURIComponent(id)}`);
    } catch (e: any) {
      alert(e?.message || 'AI BPMN 생성에 실패했습니다.');
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {[{n:1,l:'작성'},{n:2,l:'AI 분석/보완'},{n:3,l:'프로세스 생성'}].map((s, i) => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <div style={{ width: 24, height: 2, background: phase >= s.n ? '#0F3D73' : '#CBD5E1' }} />}
                  <button type="button" onClick={() => setPhase(s.n as 1|2|3)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: phase === s.n ? 800 : 500, border: 'none', cursor: 'pointer',
                      background: phase === s.n ? '#0F3D73' : phase > s.n ? '#E0E7FF' : '#F1F5F9',
                      color: phase === s.n ? '#fff' : phase > s.n ? '#0F3D73' : '#64748b' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', fontSize: 10, fontWeight: 800,
                      background: phase === s.n ? '#fff' : 'transparent', color: phase === s.n ? '#0F3D73' : 'inherit' }}>{s.n}</span>
                    {s.l}
                  </button>
                </div>
              ))}
            </div>
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
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{title}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{excerpt}</div>
                  </button>
                );
              })}
              {!items.length && !loading && (
                <div style={{ color: '#64748b', fontSize: 13 }}>아직 메뉴얼이 없습니다. “새 메뉴얼”을 눌러 작성해 주세요.</div>
              )}
            </div>
          </div>

          <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, background: '#FFFFFF', padding: 12, display: 'grid', gap: 10 }}>
            {!selected ? (
              <div style={{ color: '#64748b' }}>왼쪽에서 메뉴얼을 선택하거나 새로 만들어 주세요.</div>
            ) : phase === 1 ? (
              <>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>업무명</div>
                      <input value={selected.title} onChange={e => setEditing(p => p ? { ...p, title: e.target.value } : p)} placeholder="예: 금형 발주/관리" style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>작성자</div>
                      <input value={String((selected as any).authorName || '')} onChange={e => setEditing(p => p ? { ...p, authorName: e.target.value } : p)} placeholder="홍길동" style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>소속</div>
                      <input value={String((selected as any).authorTeamName || '')} onChange={e => setEditing(p => p ? { ...p, authorTeamName: e.target.value } : p)} placeholder="생산기술팀" style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
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
                <div style={{ fontWeight: 700, fontSize: 13 }}>업무 메뉴얼 내용</div>
                <textarea
                  value={String(selected.content || '')}
                  onChange={e => setEditing(p => p ? { ...p, content: e.target.value } : p)}
                  placeholder={'업무의 목적, 절차, 담당자, 필요 자료, 조건 등을 자유롭게 적어주세요.\n\n예시:\n- 금형 설계 도면 검토 후 발주서 작성\n- 협력사에 발주서 전달 및 납기 협의\n- 입고 시 품질 검사 후 결과 기록\n- 불합격 시 반품 처리 및 재발주'}
                  rows={16}
                  style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '10px 12px', resize: 'vertical' as any, lineHeight: 1.6, fontSize: 14 }}
                />
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
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
                      } catch (e: any) { alert(e?.message || 'AI 분석에 실패했습니다.'); }
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
                          const toApply = aiQuestions.questions.map((q, i) => ({
                            targetStepId: q.targetStepId, targetField: q.targetField, question: q.question, answer: answers[i] || '',
                          })).filter(a => a.answer.trim());
                          const r = await apiJson<{ summary: string; appliedCount: number; updatedContent: string; version: number }>(
                            `/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/apply-answers`,
                            { method: 'POST', body: JSON.stringify({ userId, answers: toApply }) },
                          );
                          setEditing(p => p ? { ...p, content: r.updatedContent, version: r.version } : p);
                          setStepForms(parseTextToStepForms(r.updatedContent));
                          setAnswers({}); setAnswerLinks({});
                          alert(`${r.appliedCount}개 항목 반영 완료!\n\n${r.summary}`);
                        } catch (e: any) { alert(e?.message || 'AI 반영에 실패했습니다.'); }
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
                <div style={{ fontWeight: 700, fontSize: 15 }}>최종 검토 및 프로세스 생성</div>
                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                  아래 메뉴얼 내용을 확인하세요. AI가 이 메뉴얼을 기반으로 BPMN 프로세스 템플릿을 생성합니다.
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
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button className="btn btn-outline" type="button" onClick={() => setPhase(2)}>← 이전: AI 분석/보완</button>
                  <button className="btn" type="button" onClick={aiToBpmn} disabled={aiLoading} style={{ padding: '8px 20px' }}>
                    {aiLoading ? '프로세스 생성중…' : 'AI로 프로세스 템플릿 생성'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
