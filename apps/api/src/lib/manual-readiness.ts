/**
 * 매뉴얼 → 프로세스 변환 준비도 (결정론적 규칙).
 * "프로세스가 잘 구성되려면 매뉴얼에 무엇이 있어야 하나"를 같은 기준으로 점수화한다.
 * AI는 질문·재작성만 맡고, 점수와 빈칸 판정은 항상 이 코드가 한다.
 *
 * 배점(100):
 *  - 구조 20: STEP 블록 2개 이상 20 / 1개 12 / 없음 0
 *  - 단계 공통 65 (단계별 평균): taskType 15, 담당 15, 완료조건·산출물 15, 방법 10, 기한 10
 *  - 결재 15: APPROVAL 단계가 있으면 결재선 8 + 반려·분기 7 / 없는데 본문에 결재·승인 언급 있으면 0 / 언급도 없으면 15
 */
export type ReadinessGap = { stepId: string; stepTitle: string; field: string; label: string };
export type ReadinessStep = { stepId: string; title: string; taskType: string; has: Record<string, boolean>; missing: string[] };
export type Completeness = { score: number; items: Array<{ field: string; label: string; ok: boolean; hint: string }> };
export type Readiness = { score: number; hasSteps: boolean; stepCount: number; steps: ReadinessStep[]; gaps: ReadinessGap[]; summary: string[]; completeness: Completeness };

export const READINESS_THRESHOLD = 80;

const FIELD_LABEL: Record<string, string> = {
  structure: '단계 구분(### STEP)', taskType: '단계 유형(taskType)', assignee: '담당(팀/담당자)', method: '수행 방법', completion: '완료조건·산출물', deadline: '기한',
  approvalLine: '결재선', branch: '반려·예외 시 처리', coopTarget: '요청 대상(타팀/협력사)',
  // 매뉴얼 완성도(회사 작성 가이드라인 + 작업표준서 요소) — 80점 게이트에는 안 들어가고 질문·체크리스트로만
  purpose: '목적·적용 범위', cycle: '업무 주기·소요시간', resources: '자원(담당 연락처·시스템·도구)', reference: '관련 문서·양식(첨부)', screen: '화면 캡처·경로', exceptions: '예외·비상 대응',
};
export const READINESS_FIELD_LABEL = FIELD_LABEL;

// 라벨 뒤 값이 비어 있거나 "(미정)", "-", "없음", "TBD" 등 자리표시자면 "없음"으로 본다
const PLACEHOLDER = /^[\s(（\[]*(미정|미확정|TBD|해당\s*없음|없음|N\/A|-|\?)?[\s)）\]]*$/i;
function hasValue(text: string, labels: string): boolean {
  const rx = new RegExp(`\\n\\s*-\\s*(?:${labels})\\s*:\\s*([^\\n]*)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) { const v = String(m[1] || '').trim(); if (!PLACEHOLDER.test(v) && !(/미정|미확정|TBD/i.test(v) && v.length < 40)) return true; }
  return false;
}
const L = {
  assignee: '담당|담당자|수행자|수행|주관|담당\\s*팀',
  method: '방법|작업방법|절차|수행방법|작업내용',
  completion: '완료조건|산출물|완료기준|결과물|완료',
  deadline: '기한|소요시간|SLA|납기|기간',
  approvalLine: '결재선|결재자|승인자|결재역할',
  branch: '반려\\s*시|반려시|분기|예외|반려|불합격\\s*시|NG\\s*시',
  coopTarget: '요청대상|요청\\s*대상|협력사|내부협조|요청\\s*팀|수신|요청처',
};
const RX = { taskType: /\n\s*-\s*taskType\s*:\s*(WORKLOG|APPROVAL|COOPERATION)\b/i };

export function splitSteps(content: string): Array<{ stepId: string; title: string; body: string }> {
  const lines = String(content || '').split(/\r?\n/);
  const out: Array<{ stepId: string; title: string; body: string[] }> = [];
  let cur: { stepId: string; title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^###\s*STEP\s+(S\d+)\s*\|\s*(.+?)\s*$/i);
    if (m) { if (cur) out.push(cur); cur = { stepId: m[1].toUpperCase(), title: m[2].trim(), body: [] }; continue; }
    if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ stepId: s.stepId, title: s.title, body: s.body.join('\n') }));
}

/**
 * 매뉴얼 완성도 체크리스트 (문서 전체 기준, 각 ~17점).
 * 근거: 회사 매뉴얼 작성 가이드라인(주기·소요시간 / 따라 할 수 있는 행동 서술 / 인적·물적 자원 / 시스템 경로·산출물 / 예외 대응)
 *      + 작업표준서(SOP) 공통 요소(목적·적용범위, 관련 문서·양식, 기록).
 */
export function computeCompleteness(content: string): Completeness {
  const t = `\n${String(content || '')}`;
  const items = [
    { field: 'purpose', ok: /(목적|적용\s*범위|개요)\s*[:：]/.test(t) || /이\s*(업무|절차)는/.test(t), hint: '이 업무가 왜 필요하고 어디까지 적용되는지 한두 문장' },
    { field: 'cycle', ok: /(주기|소요시간|매일|매주|매월|분기|연\s*\d|수시|\d+\s*(분|시간|일)\s*(소요|걸림|이내))/.test(t), hint: '얼마나 자주 하고 한 번에 얼마나 걸리는지' },
    { field: 'resources', ok: /(연락처|담당자\s*[:：]|내선|전화|시스템\s*[:：]|ERP|MES|Odoo|오라클|도구\s*[:：]|장비\s*[:：])/i.test(t), hint: '누구에게 묻는지(연락처), 어떤 시스템·도구를 쓰는지' },
    { field: 'reference', ok: /(관련\s*문서|양식|첨부|참고\s*(문서|자료)|서식|체크리스트|\.xlsx|\.docx|\.pdf|sharepoint\.com|onedrive)/i.test(t), hint: '쓰는 양식·체크리스트·규정 파일을 첨부' },
    { field: 'screen', ok: /\[이미지:/.test(t) || /(화면|메뉴\s*>|경로\s*[:：]|클릭|버튼|탭\s)/.test(t), hint: '시스템 화면 캡처나 메뉴 경로' },
    { field: 'exceptions', ok: /(예외|비상|위험\s*대응|장애\s*시|고장\s*시|불량\s*시|안\s*될\s*때|막혔을\s*때|반려\s*시|NG\s*시)/.test(t), hint: '막혔을 때 누구에게 넘기고 어떻게 되돌리는지' },
  ].map((x) => ({ ...x, label: FIELD_LABEL[x.field] || x.field }));
  const okCount = items.filter((x) => x.ok).length;
  return { score: Math.round((okCount / items.length) * 100), items };
}

export function computeReadiness(content: string): Readiness {
  const text = String(content || '');
  const steps = splitSteps(text);
  const gaps: ReadinessGap[] = [];
  const stepInfos: ReadinessStep[] = [];
  if (!steps.length) {
    gaps.push({ stepId: '*', stepTitle: '', field: 'structure', label: FIELD_LABEL.structure });
    const mentionsApproval = /결재|승인|품의/.test(text);
    const completeness0 = computeCompleteness(text);
    for (const it of completeness0.items) if (!it.ok) gaps.push({ stepId: '*', stepTitle: '', field: it.field, label: it.label });
    return { score: 0, hasSteps: false, stepCount: 0, steps: [], gaps, summary: [`단계(### STEP S1 | …)로 나뉘어 있지 않습니다${mentionsApproval ? ' · 결재 단계가 있어 보이니 결재선·반려 처리도 필요합니다' : ''}`], completeness: completeness0 };
  }
  const structure = steps.length >= 2 ? 20 : 12;
  let common = 0;
  let approvalSteps = 0, approvalLineOk = 0, branchOk = 0;
  for (const s of steps) {
    const t = `\n${s.body}`;
    const ttm = t.match(RX.taskType);
    const taskType = ttm ? ttm[1].toUpperCase() : '';
    const has: Record<string, boolean> = {
      taskType: !!taskType,
      assignee: hasValue(t, L.assignee) || (taskType === 'COOPERATION' && hasValue(t, L.coopTarget)),
      method: hasValue(t, L.method),
      completion: hasValue(t, L.completion),
      deadline: hasValue(t, L.deadline),
    };
    common += (has.taskType ? 15 : 0) + (has.assignee ? 15 : 0) + (has.completion ? 15 : 0) + (has.method ? 10 : 0) + (has.deadline ? 10 : 0);
    const missing: string[] = [];
    for (const k of ['taskType', 'assignee', 'method', 'completion', 'deadline']) if (!has[k]) missing.push(k);
    if (taskType === 'APPROVAL') {
      approvalSteps += 1;
      const a = hasValue(t, L.approvalLine), b = hasValue(t, L.branch);
      has.approvalLine = a; has.branch = b;
      if (a) approvalLineOk += 1; else missing.push('approvalLine');
      if (b) branchOk += 1; else missing.push('branch');
    }
    if (taskType === 'COOPERATION') {
      has.coopTarget = hasValue(t, L.coopTarget);
      if (!has.coopTarget) missing.push('coopTarget');
    }
    for (const f of missing) gaps.push({ stepId: s.stepId, stepTitle: s.title, field: f, label: FIELD_LABEL[f] || f });
    stepInfos.push({ stepId: s.stepId, title: s.title, taskType, has, missing });
  }
  const commonAvg = common / steps.length; // 0..65
  let approval = 15;
  if (approvalSteps > 0) approval = (approvalLineOk / approvalSteps) * 8 + (branchOk / approvalSteps) * 7;
  else if (/결재|승인|품의/.test(text)) { approval = 0; gaps.push({ stepId: '*', stepTitle: '', field: 'taskType', label: '결재 단계(taskType: APPROVAL)가 없음 — 본문에 결재·승인 언급 있음' }); }
  let score = Math.round(Math.min(100, structure + commonAvg + approval));
  // 필수 중의 필수: 모든 단계에 유형(taskType)과 담당이 있어야 프로세스에 사람을 배정할 수 있다 → 하나라도 없으면 80 미만으로 고정
  const hardMissing = stepInfos.some((s) => !s.has.taskType || !s.has.assignee);
  if (hardMissing) score = Math.min(score, READINESS_THRESHOLD - 1);
  const summary: string[] = [];
  if (hardMissing) summary.push('단계 유형·담당은 모든 단계에 있어야 80점 이상 가능');
  const byField = new Map<string, number>();
  for (const g of gaps) byField.set(g.field, (byField.get(g.field) || 0) + 1);
  for (const [f, n] of byField) summary.push(`${FIELD_LABEL[f] || f} 누락 ${n}곳`);
  const completeness = computeCompleteness(text);
  for (const it of completeness.items) if (!it.ok) gaps.push({ stepId: '*', stepTitle: '', field: it.field, label: it.label });
  return { score, hasSteps: true, stepCount: steps.length, steps: stepInfos, gaps, summary, completeness };
}

/** STEP 번호를 등장 순서대로 S1..Sn으로 다시 매긴다 (AI가 흐름을 나누며 S1을 두 번 쓰는 경우 등). "-> S2" 같은 참조도 함께 치환 */
export function renumberSteps(text: string): string {
  const lines = String(text || '').split(/\r?\n/);
  const map = new Map<string, string>(); // 등장 순서: oldId@occurrence → newId (중복 old id는 두 번째부터 새 번호)
  let n = 0; const seen = new Map<string, number>(); const order: Array<[number, string]> = [];
  const out = lines.map((line) => {
    const m = line.match(/^(###\s*STEP\s+)(S\d+)(\s*\|.*)$/i);
    if (!m) return line;
    n += 1; const oldId = m[2].toUpperCase(); const k = (seen.get(oldId) || 0) + 1; seen.set(oldId, k);
    const newId = `S${n}`; map.set(`${oldId}#${k}`, newId); order.push([n, oldId]);
    return `${m[1]}${newId}${m[3]}`;
  });
  // 본문 참조(-> S2, S1로) 치환: 중복이 없던 id만 안전하게 치환
  const uniq = new Map<string, string>();
  for (const [idx, oldId] of order) if ((seen.get(oldId) || 0) === 1) uniq.set(oldId, `S${idx}`);
  return out.map((line) => /^###\s*STEP/i.test(line) ? line : line.replace(/\bS(\d+)\b/g, (w) => uniq.get(w.toUpperCase()) || w)).join('\n');
}

/** STEP 텍스트 → 리치 에디터 HTML. "[이미지: url]" 줄은 <img>로 복원하므로 본문 그림이 제자리에 유지된다. */
export function stepTextToHtml(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  return String(text || '').split(/\r?\n/).map((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return '<p><br></p>';
    const img = line.match(/^\s*\[이미지:\s*(\S+?)\s*\]\s*$/);
    if (img) return `<p><img src="${esc(img[1])}"></p>`;
    if (/^###\s*STEP/i.test(line)) return `<h3>${esc(line)}</h3>`;
    if (/^##\s/.test(line)) return `<h2>${esc(line)}</h2>`;
    return `<p>${esc(line)}</p>`;
  }).join('');
}

/** AI 없이도 쓸 수 있는 규칙 기반 질문 (AI 실패 시 폴백) */
export function fallbackQuestions(r: Readiness, max = 5): Array<{ id: number; stepId: string; field: string; question: string; choices?: string[] }> {
  const qs: Array<{ id: number; stepId: string; field: string; question: string; choices?: string[] }> = [];
  const push = (stepId: string, field: string, question: string, choices?: string[]) => { if (qs.length < max) qs.push({ id: qs.length + 1, stepId, field, question, choices }); };
  if (!r.hasSteps) {
    push('*', 'structure', '이 업무는 몇 단계로 나뉩니까? 순서대로 단계 이름만 적어 주세요. (예: 요청서 작성 → 팀장 승인 → 발주 → 입고 확인)');
    push('*', 'taskType', '각 단계 중 결재(승인)를 받는 단계와 다른 팀에 요청하는 단계가 있다면 어느 단계입니까?');
    push('*', 'assignee', '각 단계는 누가(어느 팀/직책) 수행합니까?');
    return qs;
  }
  for (const g of r.gaps) {
    const where = g.stepId === '*' ? '' : `[${g.stepId} ${g.stepTitle}] `;
    switch (g.field) {
      case 'taskType': push(g.stepId, g.field, `${where}이 단계는 어떤 종류입니까?`, ['업무일지로 처리(WORKLOG)', '결재를 받음(APPROVAL)', '다른 팀에 요청(COOPERATION)']); break;
      case 'assignee': push(g.stepId, g.field, `${where}이 단계는 누가(팀 또는 직책) 수행합니까?`); break;
      case 'method': push(g.stepId, g.field, `${where}무엇을 어떻게 합니까? 시스템·양식이 있으면 함께 적어 주세요.`); break;
      case 'completion': push(g.stepId, g.field, `${where}무엇이 되어 있으면 이 단계가 끝난 것입니까? (문서·데이터·상태)`); break;
      case 'deadline': push(g.stepId, g.field, `${where}직전 단계가 끝난 뒤 며칠 안에 끝나야 합니까?`, ['당일', '3일', '1주', '2주', '정해진 기한 없음']); break;
      case 'approvalLine': push(g.stepId, g.field, `${where}결재는 누구 순서로 받습니까? (예: 팀장 → 공장장)`); break;
      case 'branch': push(g.stepId, g.field, `${where}반려되면 어느 단계로 돌아갑니까?`); break;
      case 'coopTarget': push(g.stepId, g.field, `${where}어느 팀(또는 협력사)에 무엇을 요청하고, 무엇을 돌려받아야 합니까?`); break;
      case 'purpose': push('*', g.field, '이 업무는 왜 필요하고(목적), 어떤 경우에 적용됩니까(범위)?'); break;
      case 'cycle': push('*', g.field, '이 업무는 얼마나 자주 하고, 한 번에 얼마나 걸립니까?', ['매일', '매주', '매월', '수시(요청 시)']); break;
      case 'resources': push('*', g.field, '어떤 시스템·장비를 쓰고, 막히면 누구에게(연락처) 물어봅니까?'); break;
      case 'reference': push('*', g.field, '이 업무에서 쓰는 양식·체크리스트·규정 파일이 있으면 첨부해 주세요. (없으면 "없음")'); break;
      case 'screen': push('*', g.field, '시스템 화면이 있으면 캡처 이미지를 올리거나 메뉴 경로를 적어 주세요.'); break;
      case 'exceptions': push('*', g.field, '중간에 막히거나 잘못됐을 때(장애·불량·반려) 누구에게 넘기고 어떻게 되돌립니까?'); break;
    }
  }
  return qs;
}
