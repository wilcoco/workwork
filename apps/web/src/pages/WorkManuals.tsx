import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

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
  question: string;
  severity: 'MUST' | 'SHOULD';
  reason?: string;
};

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
    const content = String(editing.content || '');
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
        <h2 style={{ margin: 0 }}>업무 메뉴얼</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as any }}>
          <button className="btn btn-outline" type="button" onClick={newManual}>새 메뉴얼</button>
          <button className="btn btn-outline" type="button" onClick={insertAiFormatTemplate} disabled={!editing}>AI 포맷 템플릿</button>
          <button className="btn btn-outline" type="button" onClick={runValidate} disabled={!editing}>메뉴얼 점검</button>
          <button className="btn btn-outline" type="button" onClick={aiMakeQuestions} disabled={!editing?.id || aiQuestionsLoading}>{aiQuestionsLoading ? '질문 생성중…' : 'AI 보완 질문'}</button>
          <button className="btn" type="button" onClick={save} disabled={saving || loading || !editing}>{saving ? '저장중…' : '저장'}</button>
          <button className="btn btn-outline" type="button" onClick={remove} disabled={!editing?.id}>삭제</button>
          <button className="btn" type="button" onClick={aiToBpmn} disabled={!editing?.id || aiLoading}>{aiLoading ? 'AI 생성중…' : 'AI로 BPMN 생성'}</button>
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
            ) : (
              <>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 700 }}>작성자</div>
                      <input
                        value={String((selected as any).authorName || '')}
                        onChange={(e) => setEditing((prev) => (prev ? { ...prev, authorName: e.target.value } : prev))}
                        placeholder="예: 홍길동"
                        style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 700 }}>소속</div>
                      <input
                        value={String((selected as any).authorTeamName || '')}
                        onChange={(e) => setEditing((prev) => (prev ? { ...prev, authorTeamName: e.target.value } : prev))}
                        placeholder="예: 생산기술팀"
                        style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, fontSize: 12, color: '#64748b' }}>
                    <div>작성일: {selected.createdAt ? formatKstDatetime(selected.createdAt) : '-'}</div>
                    <div>수정일: {selected.updatedAt ? formatKstDatetime(selected.updatedAt) : '-'}</div>
                    <div>버전: {(selected as any).version ?? '-'}</div>
                    <div>버전업: {(selected as any).versionUpAt ? formatKstDatetime(String((selected as any).versionUpAt)) : '-'}</div>
                  </div>
                </div>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>업무명</div>
                  <input
                    value={selected.title}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                    placeholder="예: 금형 발주/관리"
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>업무 메뉴얼</div>
                  <textarea
                    value={String(selected.content || '')}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
                    placeholder="업무 목적, 입력/산출물, 단계별 절차, 담당/협조, 예외 처리, 참고 링크 등을 자유롭게 적어주세요."
                    rows={18}
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px', resize: 'vertical' as any }}
                  />
                </label>

                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
                  AI 자동생성 품질을 높이려면 “AI 포맷 템플릿”을 먼저 삽입하고, STEP/분기 형식으로 정리해 주세요. AI로 BPMN 생성 버튼은 이 메뉴얼 내용을 기반으로 프로세스 템플릿 초안을 생성합니다. 생성된 템플릿은 프로세스 템플릿 메뉴에서 수정/게시할 수 있습니다.
                </div>

                {validation && (
                  <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, background: '#F8FAFC', padding: 10, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 800 }}>메뉴얼 점검 결과</div>
                      <button className="btn btn-ghost" type="button" onClick={() => setValidation(null)}>닫기</button>
                    </div>
                    {!validation.issues.length ? (
                      <div style={{ fontSize: 13, color: '#64748b' }}>문제를 찾지 못했습니다.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {validation.issues
                          .slice()
                          .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'MUST' ? -1 : 1))
                          .map((it, idx) => (
                            <div key={idx} style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4 }}>
                              <span style={{ fontWeight: 800, color: it.severity === 'MUST' ? '#b91c1c' : '#0f172a' }}>{it.severity}</span>
                              {it.stepId ? <span style={{ marginLeft: 6, fontWeight: 800 }}>{it.stepId}</span> : null}
                              <span style={{ marginLeft: 6 }}>{it.issue}</span>
                              {it.suggestion ? <div style={{ marginTop: 2, color: '#64748b', fontSize: 12 }}>{it.suggestion}</div> : null}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {aiQuestions && (
                  <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, background: '#FFFFFF', padding: 10, display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 800 }}>AI 보완 질문</div>
                      <button className="btn btn-ghost" type="button" onClick={() => setAiQuestions(null)}>닫기</button>
                    </div>
                    {aiQuestions.summary ? (
                      <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.5 }}>{aiQuestions.summary}</div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#64748b' }}>요약 없음</div>
                    )}

                    {!!aiQuestions.issues.length && (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>누락/이슈</div>
                        {aiQuestions.issues.map((it, idx) => (
                          <div key={idx} style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 800, color: it.severity === 'MUST' ? '#b91c1c' : '#0f172a' }}>{it.severity}</span>
                            {it.stepId ? <span style={{ marginLeft: 6, fontWeight: 800 }}>{it.stepId}</span> : null}
                            <span style={{ marginLeft: 6 }}>{it.issue}</span>
                            {it.suggestion ? <div style={{ marginTop: 2, color: '#64748b', fontSize: 12 }}>{it.suggestion}</div> : null}
                          </div>
                        ))}
                      </div>
                    )}

                    {!!aiQuestions.questions.length && (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>질문</div>
                        {aiQuestions.questions.map((q, idx) => (
                          <div key={idx} style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 800, color: q.severity === 'MUST' ? '#b91c1c' : '#0f172a' }}>{q.severity}</span>
                            {q.stepId ? <span style={{ marginLeft: 6, fontWeight: 800 }}>{q.stepId}</span> : null}
                            <span style={{ marginLeft: 6 }}>{q.question}</span>
                            {q.reason ? <div style={{ marginTop: 2, color: '#64748b', fontSize: 12 }}>{q.reason}</div> : null}
                          </div>
                        ))}
                      </div>
                    )}

                    {!aiQuestions.issues.length && !aiQuestions.questions.length && (
                      <div style={{ fontSize: 13, color: '#64748b' }}>추가 이슈/질문이 없습니다.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
