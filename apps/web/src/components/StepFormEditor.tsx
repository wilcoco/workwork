import { useState } from 'react';
import { toast, toastConfirm } from './Toast';

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
  assigneeHint: string;
  method: string;
  inputs: string;
  outputs: string;
  tools: string;
  relatedDocs: string;
  checkItems: string;
  worklogHint: string;
  completionCondition: string;
  contacts: string;
  risks: string;
  branches: BranchItem[];
  needsFiles: boolean;
  supplierName: string;
  supplierContact: string;
  cooperationTarget: string;
  approvalRouteType: string;
  approvalRoleCodes: string;
  emailTo: string;
  emailCc: string;
  emailSubject: string;
  emailBody: string;
  deadlineOffsetDays: string;
  slaHours: string;
};

type ManualIssue = {
  stepId?: string;
  issue: string;
  severity: 'MUST' | 'SHOULD';
  suggestion?: string;
};

export function makeEmptyStep(idx: number): StepFormData {
  return {
    stepId: `S${idx}`, title: '', taskType: 'WORKLOG', purpose: '', assigneeHint: '',
    method: '', inputs: '', outputs: '', tools: '', relatedDocs: '',
    checkItems: '', worklogHint: '', completionCondition: '', contacts: '', risks: '',
    branches: [], needsFiles: false,
    supplierName: '', supplierContact: '', cooperationTarget: '',
    approvalRouteType: '', approvalRoleCodes: '',
    emailTo: '', emailCc: '', emailSubject: '', emailBody: '',
    deadlineOffsetDays: '', slaHours: '',
  };
}

function xf(lines: string[], re: RegExp): string {
  for (const l of lines) { const m = l.trim().match(re); if (m) return String(m[1] || '').trim(); }
  return '';
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
      if (/^-\s*분기\s*:/i.test(trimmed)) { section = 'branch'; continue; }
      if (/^-\s*(담당자|작업방법|도구|관련문서|확인사항|연락처|위험대응|협력사담당자|협력사|내부협조|결재선|결재역할|이메일수신|이메일CC|이메일제목|이메일내용|기한|SLA|품질검사|안전점검)\s*:/i.test(trimmed)) { section = ''; continue; }

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

    }

    const qc = xf(lines, /^-\s*품질검사\s*:\s*(.+)$/i);
    const sc = xf(lines, /^-\s*안전점검\s*:\s*(.+)$/i);
    const ci = xf(lines, /^-\s*확인사항\s*:\s*(.+)$/i);
    const checkItems = ci || [qc, sc].filter(Boolean).join(', ');

    return {
      stepId: p.stepId, title: p.title, taskType, purpose, inputs, outputs,
      worklogHint, completionCondition, branches, needsFiles,
      assigneeHint: xf(lines, /^-\s*담당자\s*:\s*(.+)$/i),
      method: xf(lines, /^-\s*작업방법\s*:\s*(.+)$/i),
      tools: xf(lines, /^-\s*도구\s*:\s*(.+)$/i),
      relatedDocs: xf(lines, /^-\s*관련문서\s*:\s*(.+)$/i),
      checkItems,
      contacts: xf(lines, /^-\s*연락처\s*:\s*(.+)$/i),
      risks: xf(lines, /^-\s*위험대응\s*:\s*(.+)$/i),
      supplierName: xf(lines, /^-\s*협력사\s*:\s*(.+)$/i),
      supplierContact: xf(lines, /^-\s*협력사담당자\s*:\s*(.+)$/i),
      cooperationTarget: xf(lines, /^-\s*내부협조\s*:\s*(.+)$/i),
      approvalRouteType: xf(lines, /^-\s*결재선\s*:\s*(.+)$/i),
      approvalRoleCodes: xf(lines, /^-\s*결재역할\s*:\s*(.+)$/i),
      emailTo: xf(lines, /^-\s*이메일수신\s*:\s*(.+)$/i),
      emailCc: xf(lines, /^-\s*이메일CC\s*:\s*(.+)$/i),
      emailSubject: xf(lines, /^-\s*이메일제목\s*:\s*(.+)$/i),
      emailBody: xf(lines, /^-\s*이메일내용\s*:\s*(.+)$/i),
      deadlineOffsetDays: xf(lines, /^-\s*기한\s*:\s*(.+)$/i),
      slaHours: xf(lines, /^-\s*SLA\s*:\s*(.+)$/i),
    };
  });
}

export function serializeStepsToText(steps: StepFormData[]): string {
  const blocks: string[] = [];
  for (const s of steps) {
    const L: string[] = [];
    L.push(`### STEP ${s.stepId} | ${s.title || '(단계 제목)'}`);
    L.push(`- taskType: ${s.taskType || 'WORKLOG'}`);
    if (s.purpose) L.push(`- 목적: ${s.purpose}`);
    if (s.assigneeHint) L.push(`- 담당자: ${s.assigneeHint}`);
    if (s.method) L.push(`- 작업방법: ${s.method}`);
    if (s.needsFiles || s.inputs) {
      L.push(`- 입력/필요자료(파일·양식·링크):`);
      if (s.inputs) { for (const x of s.inputs.split(',').map(v => v.trim()).filter(Boolean)) L.push(`  - ${x}`); } else L.push(`  -`);
    }
    if (s.tools) L.push(`- 도구: ${s.tools}`);
    if (s.relatedDocs) L.push(`- 관련문서: ${s.relatedDocs}`);
    if (s.outputs) { L.push(`- 산출물:`); for (const x of s.outputs.split(',').map(v => v.trim()).filter(Boolean)) L.push(`  - ${x}`); }
    if (s.checkItems) L.push(`- 확인사항: ${s.checkItems}`);
    if (s.taskType === 'WORKLOG' || s.worklogHint) {
      L.push(`- 업무일지(필수):`); L.push(`  - 기록할 내용:`);
      if (s.worklogHint) { for (const x of s.worklogHint.split(',').map(v => v.trim()).filter(Boolean)) L.push(`    - ${x}`); } else L.push(`    -`);
    }
    if (s.completionCondition) { L.push(`- 완료조건:`); for (const x of s.completionCondition.split(',').map(v => v.trim()).filter(Boolean)) L.push(`  - ${x}`); }
    if (s.contacts) L.push(`- 연락처: ${s.contacts}`);
    if (s.risks) L.push(`- 위험대응: ${s.risks}`);
    if (s.supplierName) L.push(`- 협력사: ${s.supplierName}`);
    if (s.supplierContact) L.push(`- 협력사담당자: ${s.supplierContact}`);
    if (s.cooperationTarget) L.push(`- 내부협조: ${s.cooperationTarget}`);
    if (s.taskType === 'APPROVAL' || s.approvalRouteType) {
      if (s.approvalRouteType) L.push(`- 결재선: ${s.approvalRouteType}`);
      if (s.approvalRoleCodes) L.push(`- 결재역할: ${s.approvalRoleCodes}`);
    }
    if (s.emailTo) L.push(`- 이메일수신: ${s.emailTo}`);
    if (s.emailCc) L.push(`- 이메일CC: ${s.emailCc}`);
    if (s.emailSubject) L.push(`- 이메일제목: ${s.emailSubject}`);
    if (s.emailBody) L.push(`- 이메일내용: ${s.emailBody}`);
    if (s.deadlineOffsetDays) L.push(`- 기한: ${s.deadlineOffsetDays}`);
    if (s.slaHours) L.push(`- SLA: ${s.slaHours}`);
    if (s.branches.length) {
      L.push(`- 분기:`);
      for (const b of s.branches) { const lbl = b.label ? `${b.label}: ` : ''; L.push(`  - ${lbl}${b.condition} -> ${b.targetStepId}`); }
    }
    blocks.push(L.join('\n'));
  }
  return blocks.join('\n\n');
}

const IS: React.CSSProperties = { border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 13 };
const LS: React.CSSProperties = { fontSize: 12, fontWeight: 700 };

type StepFormEditorProps = {
  steps: StepFormData[];
  onChange: (steps: StepFormData[]) => void;
  validationIssues?: ManualIssue[];
};

export function StepFormEditor({ steps, onChange, validationIssues }: StepFormEditorProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded(p => ({ ...p, [id]: !p[id] }));
  function us(i: number, p: Partial<StepFormData>) { onChange(steps.map((s, idx) => (idx === i ? { ...s, ...p } : s))); }
  function addStep() {
    const n = steps.length ? Math.max(...steps.map(s => { const m = s.stepId.match(/\d+/); return m ? +m[0] : 0; })) + 1 : 1;
    onChange([...steps, makeEmptyStep(n)]);
  }
  async function removeStep(i: number) {
    if (steps.length <= 1) { toast('최소 1개의 단계가 필요합니다.', 'warning'); return; }
    if (!(await toastConfirm(`${steps[i].stepId} 단계를 삭제할까요?`))) return;
    onChange(steps.filter((_, idx) => idx !== i));
  }
  function moveStep(i: number, d: -1 | 1) {
    const t = i + d; if (t < 0 || t >= steps.length) return;
    const n = [...steps]; [n[i], n[t]] = [n[t], n[i]]; onChange(n);
  }
  function addBranch(si: number) { onChange(steps.map((s, i) => i !== si ? s : { ...s, branches: [...s.branches, { label: '', condition: '', targetStepId: '' }] })); }
  function ubr(si: number, bi: number, p: Partial<BranchItem>) { onChange(steps.map((s, i) => i !== si ? s : { ...s, branches: s.branches.map((b, j) => j === bi ? { ...b, ...p } : b) })); }
  function rbr(si: number, bi: number) { onChange(steps.map((s, i) => i !== si ? s : { ...s, branches: s.branches.filter((_, j) => j !== bi) })); }

  const hasDetail = (s: StepFormData) => !!(s.method || s.tools || s.relatedDocs || s.checkItems || s.contacts || s.risks || s.worklogHint || s.supplierName || s.cooperationTarget || s.approvalRouteType || s.approvalRoleCodes || s.deadlineOffsetDays || s.slaHours || s.emailTo || s.emailSubject || s.branches.length);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
        각 업무 단계(노드)의 정보를 입력하세요. 저장 시 자동으로 AI 호환 포맷으로 변환됩니다.
      </div>
      {steps.map((step, si) => {
        const sIss = (validationIssues || []).filter(x => x.stepId === step.stepId);
        const isOpen = expanded[step.stepId] ?? hasDetail(step);
        const detailCount = [step.method, step.tools, step.relatedDocs, step.checkItems, step.contacts, step.risks, step.worklogHint, step.supplierName || step.cooperationTarget, step.approvalRouteType, step.deadlineOffsetDays || step.slaHours, step.emailTo, step.branches.length ? 'Y' : ''].filter(Boolean).length;
        return (
          <section key={step.stepId + '-' + si} aria-label={`${step.stepId} ${step.title || '단계'}`} style={{ border: sIss.some(x => x.severity === 'MUST') ? '2px solid #dc2626' : '1px solid #E5E7EB', borderRadius: 10, background: '#FAFBFC', padding: 12, display: 'grid', gap: 10 }}>
            {/* === Header === */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#0F3D73' }}>{step.stepId}</div>
              <input value={step.title} onChange={e => us(si, { title: e.target.value })} placeholder="단계 제목" style={{ flex: 1, ...IS, fontWeight: 700 }} />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => moveStep(si, -1)} disabled={si === 0} aria-label={`${step.stepId} 위로 이동`} style={{ padding: '2px 6px', fontSize: 12 }}>&#9650;</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1} aria-label={`${step.stepId} 아래로 이동`} style={{ padding: '2px 6px', fontSize: 12 }}>&#9660;</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeStep(si)} aria-label={`${step.stepId} 삭제`} style={{ padding: '2px 6px', fontSize: 12, color: '#dc2626' }}>&#10005;</button>
              </div>
            </div>
            {/* === Basic fields (always visible) === */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={LS}>유형 (taskType)</div>
                <select value={step.taskType} onChange={e => us(si, { taskType: e.target.value as StepFormData['taskType'] })} style={IS}>
                  <option value="">-- 선택 --</option>
                  <option value="WORKLOG">WORKLOG (업무일지)</option>
                  <option value="APPROVAL">APPROVAL (결재)</option>
                  <option value="COOPERATION">COOPERATION (협조)</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={LS}>목적</div>
                <input value={step.purpose} onChange={e => us(si, { purpose: e.target.value })} placeholder="이 단계의 목적" style={IS} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={LS}>담당자/역할</div>
                <input value={step.assigneeHint} onChange={e => us(si, { assigneeHint: e.target.value })} placeholder="예: 생산기술팀 대리" style={IS} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={LS}>입력/필요자료<label style={{ marginLeft: 8, fontWeight: 400 }}><input type="checkbox" checked={step.needsFiles} onChange={e => us(si, { needsFiles: e.target.checked })} style={{ marginRight: 4 }} />파일첨부</label></div>
                <input value={step.inputs} onChange={e => us(si, { inputs: e.target.value })} placeholder="파일, 양식, 링크 (쉼표 구분)" style={IS} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <div style={LS}>산출물</div>
                <input value={step.outputs} onChange={e => us(si, { outputs: e.target.value })} placeholder="이 단계의 산출물 (쉼표 구분)" style={IS} />
              </label>
            </div>
            <label style={{ display: 'grid', gap: 4 }}>
              <div style={LS}>완료조건</div>
              <input value={step.completionCondition} onChange={e => us(si, { completionCondition: e.target.value })} placeholder="이 단계가 완료되는 조건" style={IS} />
            </label>
            {/* === Detail toggle === */}
            <button type="button" onClick={() => toggle(step.stepId)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: 12, color: '#475569', fontWeight: 600 }}>
              <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
              상세 필드 {detailCount > 0 && <span style={{ background: '#0F3D73', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>{detailCount}</span>}
            </button>
            {/* === Detail fields (collapsible) === */}
            {isOpen && (
              <div style={{ display: 'grid', gap: 10, paddingLeft: 8, borderLeft: '2px solid #E5E7EB' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <div style={LS}>작업 방법/절차</div>
                  <input value={step.method} onChange={e => us(si, { method: e.target.value })} placeholder="작업 수행 방법, 절차, 주의사항" style={IS} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <div style={LS}>도구/장비/시스템</div>
                    <input value={step.tools} onChange={e => us(si, { tools: e.target.value })} placeholder="필요한 도구, 장비, IT 시스템" style={IS} />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <div style={LS}>관련문서 (도면/시방서/양식)</div>
                    <input value={step.relatedDocs} onChange={e => us(si, { relatedDocs: e.target.value })} placeholder="도면번호, 시방서, 양식명, OneDrive 링크 등" style={IS} />
                  </label>
                </div>
                <label style={{ display: 'grid', gap: 4 }}>
                  <div style={LS}>확인/검증 사항</div>
                  <input value={step.checkItems} onChange={e => us(si, { checkItems: e.target.value })} placeholder="품질, 안전, 규정, 기준 등 확인 항목" style={IS} />
                </label>
                {(step.taskType === 'WORKLOG' || step.taskType === '' || step.worklogHint) && (
                  <label style={{ display: 'grid', gap: 4 }}>
                    <div style={LS}>업무일지 기록 내용</div>
                    <input value={step.worklogHint} onChange={e => us(si, { worklogHint: e.target.value })} placeholder="업무일지에 기록해야 할 내용 (쉼표 구분)" style={IS} />
                  </label>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <div style={LS}>관련 연락처</div>
                    <input value={step.contacts} onChange={e => us(si, { contacts: e.target.value })} placeholder="내부: 팀/담당자, 외부: 협력사/연락처" style={IS} />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <div style={LS}>위험/이상 시 대응</div>
                    <input value={step.risks} onChange={e => us(si, { risks: e.target.value })} placeholder="이상 발생 시 조치, 에스컬레이션 경로" style={IS} />
                  </label>
                </div>
                {(step.taskType === 'COOPERATION' || step.supplierName || step.cooperationTarget) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 4 }}><div style={LS}>협력사</div><input value={step.supplierName} onChange={e => us(si, { supplierName: e.target.value })} placeholder="협력사명" style={IS} /></label>
                    <label style={{ display: 'grid', gap: 4 }}><div style={LS}>협력사 담당자</div><input value={step.supplierContact} onChange={e => us(si, { supplierContact: e.target.value })} placeholder="이름/연락처" style={IS} /></label>
                    <label style={{ display: 'grid', gap: 4 }}><div style={LS}>내부 협조 부서/인원</div><input value={step.cooperationTarget} onChange={e => us(si, { cooperationTarget: e.target.value })} placeholder="팀명, 담당자" style={IS} /></label>
                  </div>
                )}
                {(step.taskType === 'APPROVAL' || step.approvalRouteType) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <div style={LS}>결재선 유형</div>
                      <select value={step.approvalRouteType} onChange={e => us(si, { approvalRouteType: e.target.value })} style={IS}>
                        <option value="">-- 선택 --</option><option value="SEQUENTIAL">순차결재</option><option value="PARALLEL">병렬결재</option><option value="ANY_ONE">임의 1인 결재</option>
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}><div style={LS}>결재 역할/상위자</div><input value={step.approvalRoleCodes} onChange={e => us(si, { approvalRoleCodes: e.target.value })} placeholder="예: 팀장, 부장, 임원" style={IS} /></label>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 4 }}><div style={LS}>기한 (시작일 기준 +N일)</div><input value={step.deadlineOffsetDays} onChange={e => us(si, { deadlineOffsetDays: e.target.value })} placeholder="예: 3 (시작일+3일)" style={IS} /></label>
                  <label style={{ display: 'grid', gap: 4 }}><div style={LS}>SLA (시간)</div><input value={step.slaHours} onChange={e => us(si, { slaHours: e.target.value })} placeholder="예: 24 (24시간 이내)" style={IS} /></label>
                </div>
                {(step.emailTo || step.emailSubject) ? (
                  <div style={{ display: 'grid', gap: 8, background: '#F1F5F9', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>이메일 통보 설정</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label style={{ display: 'grid', gap: 4 }}><div style={LS}>수신자</div><input value={step.emailTo} onChange={e => us(si, { emailTo: e.target.value })} placeholder="수신자 이메일/역할" style={IS} /></label>
                      <label style={{ display: 'grid', gap: 4 }}><div style={LS}>CC</div><input value={step.emailCc} onChange={e => us(si, { emailCc: e.target.value })} placeholder="CC" style={IS} /></label>
                    </div>
                    <label style={{ display: 'grid', gap: 4 }}><div style={LS}>제목 템플릿</div><input value={step.emailSubject} onChange={e => us(si, { emailSubject: e.target.value })} placeholder="예: [{itemCode}] {stepTitle} 완료" style={IS} /></label>
                    <label style={{ display: 'grid', gap: 4 }}><div style={LS}>본문 템플릿</div><textarea value={step.emailBody} onChange={e => us(si, { emailBody: e.target.value })} placeholder="이메일 본문 (HTML 가능)" rows={3} style={{ ...IS, resize: 'vertical' as const }} /></label>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => us(si, { emailTo: ' ' })} style={{ fontSize: 11, justifySelf: 'start', color: '#64748b' }}>+ 이메일 통보 설정</button>
                )}
                {(step.taskType === 'APPROVAL' || step.branches.length > 0) && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={LS}>분기 (조건 → 대상 STEP)</div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => addBranch(si)} style={{ fontSize: 11, padding: '2px 8px' }}>+ 분기 추가</button>
                    </div>
                    {step.branches.map((br, bi) => (
                      <div key={bi} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 28px', gap: 6, alignItems: 'center' }}>
                        <input value={br.label} onChange={e => ubr(si, bi, { label: e.target.value })} placeholder="라벨" style={{ ...IS, fontSize: 12 }} />
                        <input value={br.condition} onChange={e => ubr(si, bi, { condition: e.target.value })} placeholder="조건식 (last.approval.status == 'APPROVED')" style={{ ...IS, fontSize: 12 }} />
                        <select value={br.targetStepId} onChange={e => ubr(si, bi, { targetStepId: e.target.value })} style={{ ...IS, fontSize: 12 }}>
                          <option value="">→ STEP</option>
                          {steps.filter((_, fi) => fi !== si).map(t => (<option key={t.stepId} value={t.stepId}>{t.stepId} {t.title ? `| ${t.title}` : ''}</option>))}
                        </select>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => rbr(si, bi)} style={{ fontSize: 11, color: '#dc2626', padding: '2px 4px' }}>&#10005;</button>
                      </div>
                    ))}
                    {!step.branches.length && step.taskType === 'APPROVAL' && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>결재 단계라면 승인/반려 분기를 추가하세요.</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!!sIss.length && (
              <div style={{ background: '#FEF2F2', borderRadius: 6, padding: '6px 8px', display: 'grid', gap: 4 }}>
                {sIss.map((iss, ii) => (
                  <div key={ii} style={{ fontSize: 12, color: iss.severity === 'MUST' ? '#b91c1c' : '#0f172a' }}>
                    <span style={{ fontWeight: 700 }}>{iss.severity}</span> {iss.issue}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <button className="btn btn-outline" type="button" onClick={addStep} aria-label="새 단계 추가" style={{ justifySelf: 'start' }}>+ 단계 추가</button>
    </div>
  );
}
