
type BranchItem = {
  label: string;
  condition: string;
  targetStepId: string;
};

export type StepFormData = {
  stepId: string;
  title: string;
  taskType: 'WORKLOG' | 'APPROVAL' | 'COOPERATION' | '';
  purpose: string;
  inputs: string;
  outputs: string;
  worklogHint: string;
  completionCondition: string;
  branches: BranchItem[];
  needsFiles: boolean;
  extra: string;
};

type ManualIssue = {
  stepId?: string;
  issue: string;
  severity: 'MUST' | 'SHOULD';
  suggestion?: string;
};

export function makeEmptyStep(idx: number): StepFormData {
  return {
    stepId: `S${idx}`,
    title: '',
    taskType: 'WORKLOG',
    purpose: '',
    inputs: '',
    outputs: '',
    worklogHint: '',
    completionCondition: '',
    branches: [],
    needsFiles: false,
    extra: '',
  };
}

function parseStepsFromText(text: string): Array<{ stepId: string; title: string; raw: string }> {
  const lines = String(text || '').split(/\r?\n/);
  const out: Array<{ stepId: string; title: string; raw: string }> = [];
  let cur: { stepId: string; title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^###\s*STEP\s+(S\d+)\s*\|\s*(.+)\s*$/i);
    if (m) {
      if (cur) out.push({ stepId: cur.stepId, title: cur.title, raw: `### STEP ${cur.stepId} | ${cur.title}\n${cur.lines.join('\n')}`.trim() });
      cur = { stepId: String(m[1] || '').toUpperCase(), title: String(m[2] || '').trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) out.push({ stepId: cur.stepId, title: cur.title, raw: `### STEP ${cur.stepId} | ${cur.title}\n${cur.lines.join('\n')}`.trim() });
  return out;
}

export function parseTextToStepForms(text: string): StepFormData[] {
  const parsed = parseStepsFromText(text);
  if (!parsed.length) return [];
  return parsed.map((p) => {
    const lines = p.raw.split(/\r?\n/);
    let taskType: StepFormData['taskType'] = '';
    let purpose = '';
    let inputs = '';
    let outputs = '';
    let worklogHint = '';
    let completionCondition = '';
    let needsFiles = false;
    const branches: BranchItem[] = [];
    const extraLines: string[] = [];

    let section = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (i === 0 && /^###\s*STEP/i.test(trimmed)) continue;

      const ttMatch = trimmed.match(/^-\s*taskType\s*:\s*([A-Za-z_]+)\s*$/i);
      if (ttMatch) {
        const raw = String(ttMatch[1] || '').toUpperCase();
        if (['WORKLOG', 'APPROVAL', 'COOPERATION'].includes(raw)) taskType = raw as StepFormData['taskType'];
        else taskType = '';
        section = '';
        continue;
      }

      if (/^-\s*목적\s*:/i.test(trimmed)) {
        purpose = trimmed.replace(/^-\s*목적\s*:\s*/i, '').trim();
        section = 'purpose';
        continue;
      }
      if (/^-\s*(입력|필요자료)/i.test(trimmed)) {
        inputs = trimmed.replace(/^-\s*(입력\/필요자료\(파일·양식·링크\)|입력\/필요자료|입력|필요자료)\s*:\s*/i, '').trim();
        section = 'inputs';
        needsFiles = true;
        continue;
      }
      if (/^-\s*산출물\s*:/i.test(trimmed)) {
        outputs = trimmed.replace(/^-\s*산출물\s*:\s*/i, '').trim();
        section = 'outputs';
        continue;
      }
      if (/^-\s*업무일지/i.test(trimmed)) {
        worklogHint = trimmed.replace(/^-\s*업무일지[^:]*:\s*/i, '').trim();
        section = 'worklog';
        continue;
      }
      if (/^-\s*완료조건\s*:/i.test(trimmed)) {
        completionCondition = trimmed.replace(/^-\s*완료조건\s*:\s*/i, '').trim();
        section = 'done';
        continue;
      }
      if (/^-\s*분기\s*:/i.test(trimmed)) {
        section = 'branch';
        continue;
      }

      if (section === 'branch' && trimmed.includes('->')) {
        const arrowIdx = trimmed.indexOf('->');
        const left = trimmed.slice(0, arrowIdx).trim().replace(/^-\s*/, '');
        const right = trimmed.slice(arrowIdx + 2).trim();
        const colonIdx = left.indexOf(':');
        const label = colonIdx >= 0 ? left.slice(0, colonIdx).trim() : '';
        const condition = colonIdx >= 0 ? left.slice(colonIdx + 1).trim() : left;
        branches.push({ label, condition, targetStepId: right.toUpperCase() });
        continue;
      }

      if (section && /^\s{2,}-/.test(line)) {
        const val = trimmed.replace(/^-\s*/, '').trim();
        if (!val) continue;
        if (section === 'purpose') purpose = purpose ? `${purpose}, ${val}` : val;
        else if (section === 'inputs') inputs = inputs ? `${inputs}, ${val}` : val;
        else if (section === 'outputs') outputs = outputs ? `${outputs}, ${val}` : val;
        else if (section === 'worklog') worklogHint = worklogHint ? `${worklogHint}, ${val}` : val;
        else if (section === 'done') completionCondition = completionCondition ? `${completionCondition}, ${val}` : val;
        continue;
      }

      if (trimmed && !section) extraLines.push(trimmed);
    }

    return { stepId: p.stepId, title: p.title, taskType, purpose, inputs, outputs, worklogHint, completionCondition, branches, needsFiles, extra: extraLines.join('\n') };
  });
}

export function serializeStepsToText(steps: StepFormData[]): string {
  const blocks: string[] = [];
  for (const s of steps) {
    const lines: string[] = [];
    lines.push(`### STEP ${s.stepId} | ${s.title || '(단계 제목)'}`);
    lines.push(`- taskType: ${s.taskType || 'WORKLOG'}`);
    if (s.purpose) lines.push(`- 목적: ${s.purpose}`);
    if (s.needsFiles || s.inputs) {
      lines.push(`- 입력/필요자료(파일·양식·링크):`);
      if (s.inputs) {
        for (const item of s.inputs.split(',').map((x) => x.trim()).filter(Boolean)) lines.push(`  - ${item}`);
      } else {
        lines.push(`  -`);
      }
    }
    if (s.outputs) {
      lines.push(`- 산출물:`);
      for (const item of s.outputs.split(',').map((x) => x.trim()).filter(Boolean)) lines.push(`  - ${item}`);
    }
    if (s.taskType === 'WORKLOG' || s.worklogHint) {
      lines.push(`- 업무일지(필수):`);
      lines.push(`  - 기록할 내용:`);
      if (s.worklogHint) {
        for (const item of s.worklogHint.split(',').map((x) => x.trim()).filter(Boolean)) lines.push(`    - ${item}`);
      } else {
        lines.push(`    -`);
      }
    }
    if (s.completionCondition) {
      lines.push(`- 완료조건:`);
      for (const item of s.completionCondition.split(',').map((x) => x.trim()).filter(Boolean)) lines.push(`  - ${item}`);
    }
    if (s.branches.length) {
      lines.push(`- 분기:`);
      for (const b of s.branches) {
        const lbl = b.label ? `${b.label}: ` : '';
        lines.push(`  - ${lbl}${b.condition} -> ${b.targetStepId}`);
      }
    }
    if (s.extra) lines.push(s.extra);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

type StepFormEditorProps = {
  steps: StepFormData[];
  onChange: (steps: StepFormData[]) => void;
  validationIssues?: ManualIssue[];
};

export function StepFormEditor({ steps, onChange, validationIssues }: StepFormEditorProps) {

  function updateStep(idx: number, patch: Partial<StepFormData>) {
    onChange(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const nextNum = steps.length ? Math.max(...steps.map((s) => { const m = s.stepId.match(/\d+/); return m ? Number(m[0]) : 0; })) + 1 : 1;
    onChange([...steps, makeEmptyStep(nextNum)]);
  }

  function removeStep(idx: number) {
    if (steps.length <= 1) { alert('최소 1개의 단계가 필요합니다.'); return; }
    if (!confirm(`${steps[idx].stepId} 단계를 삭제할까요?`)) return;
    onChange(steps.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  function addBranch(stepIdx: number) {
    onChange(steps.map((s, i) => {
      if (i !== stepIdx) return s;
      return { ...s, branches: [...s.branches, { label: '', condition: '', targetStepId: '' }] };
    }));
  }

  function updateBranch(stepIdx: number, branchIdx: number, patch: Partial<BranchItem>) {
    onChange(steps.map((s, i) => {
      if (i !== stepIdx) return s;
      return { ...s, branches: s.branches.map((b, bi) => (bi === branchIdx ? { ...b, ...patch } : b)) };
    }));
  }

  function removeBranch(stepIdx: number, branchIdx: number) {
    onChange(steps.map((s, i) => {
      if (i !== stepIdx) return s;
      return { ...s, branches: s.branches.filter((_, bi) => bi !== branchIdx) };
    }));
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
        각 업무 단계(노드)의 정보를 입력하세요. 저장 시 자동으로 AI 호환 포맷으로 변환됩니다.
      </div>

      {steps.map((step, si) => {
        const stepIssues = (validationIssues || []).filter((x) => x.stepId === step.stepId);
        return (
          <div
            key={step.stepId + '-' + si}
            style={{
              border: stepIssues.some((x) => x.severity === 'MUST') ? '2px solid #dc2626' : '1px solid #E5E7EB',
              borderRadius: 10,
              background: '#FAFBFC',
              padding: 12,
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#0F3D73' }}>{step.stepId}</div>
              <input
                value={step.title}
                onChange={(e) => updateStep(si, { title: e.target.value })}
                placeholder="단계 제목"
                style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontWeight: 700 }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => moveStep(si, -1)} disabled={si === 0} style={{ padding: '2px 6px', fontSize: 12 }}>&#9650;</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1} style={{ padding: '2px 6px', fontSize: 12 }}>&#9660;</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeStep(si)} style={{ padding: '2px 6px', fontSize: 12, color: '#dc2626' }}>&#10005;</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>유형 (taskType)</div>
                <select
                  value={step.taskType}
                  onChange={(e) => updateStep(si, { taskType: e.target.value as StepFormData['taskType'] })}
                  style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                >
                  <option value="">-- 선택 --</option>
                  <option value="WORKLOG">WORKLOG (업무일지)</option>
                  <option value="APPROVAL">APPROVAL (결재)</option>
                  <option value="COOPERATION">COOPERATION (협조)</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>목적</div>
                <input
                  value={step.purpose}
                  onChange={(e) => updateStep(si, { purpose: e.target.value })}
                  placeholder="이 단계의 목적"
                  style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  입력/필요자료
                  <label style={{ marginLeft: 8, fontWeight: 400 }}>
                    <input type="checkbox" checked={step.needsFiles} onChange={(e) => updateStep(si, { needsFiles: e.target.checked })} style={{ marginRight: 4 }} />
                    파일 첨부 필요
                  </label>
                </div>
                <input
                  value={step.inputs}
                  onChange={(e) => updateStep(si, { inputs: e.target.value })}
                  placeholder="파일, 양식, 링크 등 (쉼표 구분)"
                  style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>산출물</div>
                <input
                  value={step.outputs}
                  onChange={(e) => updateStep(si, { outputs: e.target.value })}
                  placeholder="이 단계의 산출물 (쉼표 구분)"
                  style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                />
              </label>
            </div>

            {(step.taskType === 'WORKLOG' || step.taskType === '' || step.worklogHint) && (
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>업무일지 기록 내용</div>
                <input
                  value={step.worklogHint}
                  onChange={(e) => updateStep(si, { worklogHint: e.target.value })}
                  placeholder="업무일지에 기록해야 할 내용 (쉼표 구분)"
                  style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                />
              </label>
            )}

            <label style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>완료조건</div>
              <input
                value={step.completionCondition}
                onChange={(e) => updateStep(si, { completionCondition: e.target.value })}
                placeholder="이 단계가 완료되는 조건 (쉼표 구분)"
                style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
              />
            </label>

            {(step.taskType === 'APPROVAL' || step.branches.length > 0) && (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>분기 (조건 → 대상 STEP)</div>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => addBranch(si)} style={{ fontSize: 11, padding: '2px 8px' }}>+ 분기 추가</button>
                </div>
                {step.branches.map((br, bi) => (
                  <div key={bi} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 28px', gap: 6, alignItems: 'center' }}>
                    <input
                      value={br.label}
                      onChange={(e) => updateBranch(si, bi, { label: e.target.value })}
                      placeholder="라벨"
                      style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                    />
                    <input
                      value={br.condition}
                      onChange={(e) => updateBranch(si, bi, { condition: e.target.value })}
                      placeholder="조건식 (예: last.approval.status == 'APPROVED')"
                      style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                    />
                    <select
                      value={br.targetStepId}
                      onChange={(e) => updateBranch(si, bi, { targetStepId: e.target.value })}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                    >
                      <option value="">→ STEP</option>
                      {steps.filter((_, fi) => fi !== si).map((t) => (
                        <option key={t.stepId} value={t.stepId}>{t.stepId} {t.title ? `| ${t.title}` : ''}</option>
                      ))}
                    </select>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeBranch(si, bi)} style={{ fontSize: 11, color: '#dc2626', padding: '2px 4px' }}>&#10005;</button>
                  </div>
                ))}
                {!step.branches.length && step.taskType === 'APPROVAL' && (
                  <div style={{ fontSize: 12, color: '#64748b' }}>결재 단계라면 승인/반려 분기를 추가하세요.</div>
                )}
              </div>
            )}

            {!!stepIssues.length && (
              <div style={{ background: '#FEF2F2', borderRadius: 6, padding: '6px 8px', display: 'grid', gap: 4 }}>
                {stepIssues.map((iss, ii) => (
                  <div key={ii} style={{ fontSize: 12, color: iss.severity === 'MUST' ? '#b91c1c' : '#0f172a' }}>
                    <span style={{ fontWeight: 700 }}>{iss.severity}</span> {iss.issue}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button className="btn btn-outline" type="button" onClick={addStep} style={{ justifySelf: 'start' }}>+ 단계 추가</button>
    </div>
  );
}
