/**
 * BPMN 완성도 린터 — 결정론적 규칙으로 "빨간칸(미완성 지점)"을 찾는다.
 *
 * 설계 원칙: 질문(슬롯)은 코드 규칙이 만들고(같은 그래프면 항상 같은 결과),
 * 보기(값)는 제한된 풀(조직/사람/열거된 경로)에서 고른다. AI가 질문을 만들지 않는다.
 * error = 템플릿 완성을 막는 항목, warn = 확인 권장(무시 가능).
 */

export type LintSeverity = 'error' | 'warn';

export type LintFinding = {
  /** 안정적 식별자: code + 대상 id (무시 처리 추적용) */
  id: string;
  code:
    | 'NO_START'
    | 'NO_END'
    | 'NO_TASK'
    | 'EDGE_BROKEN'
    | 'APPROVAL_LINE_MISSING'
    | 'APPROVAL_NO_REJECT_PATH'
    | 'XOR_NO_CONDITION'
    | 'XOR_SINGLE_PATH'
    | 'ASSIGNEE_MISSING'
    | 'NODE_DEAD_END'
    | 'UNREACHABLE'
    | 'NO_PATH_TO_END';
  severity: LintSeverity;
  nodeId?: string;
  edgeId?: string;
  nodeName?: string;
  message: string;
};

function displayName(n: any): string {
  const t = String(n?.type || '');
  return String(n?.name || '').trim() || (t === 'start' ? '시작' : t === 'end' ? '종료' : t.startsWith('gateway') ? '분기' : String(n?.id || ''));
}

export function lintBpmn(json: any): LintFinding[] {
  const findings: LintFinding[] = [];
  const nodes: any[] = Array.isArray(json?.nodes) ? json.nodes : [];
  const edges: any[] = Array.isArray(json?.edges) ? json.edges : [];
  if (!nodes.length) return findings; // 아직 생성 전이면 조용히
  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));

  const starts = nodes.filter((n) => String(n.type) === 'start');
  const ends = nodes.filter((n) => String(n.type) === 'end');
  const tasks = nodes.filter((n) => String(n.type) === 'task');

  if (!starts.length) findings.push({ id: 'NO_START', code: 'NO_START', severity: 'error', message: '시작(start) 노드가 없습니다.' });
  if (!ends.length) findings.push({ id: 'NO_END', code: 'NO_END', severity: 'error', message: '종료(end) 노드가 없습니다.' });
  if (!tasks.length) findings.push({ id: 'NO_TASK', code: 'NO_TASK', severity: 'error', message: '업무 단계(task)가 1개 이상 필요합니다.' });

  const out = (id: any) => edges.filter((e) => String(e.source) === String(id));

  // 끊어진 연결 (없는 노드를 가리키는 엣지)
  for (const e of edges) {
    if (!nodeById.has(String(e.source)) || !nodeById.has(String(e.target))) {
      findings.push({ id: `EDGE_BROKEN:${e.id}`, code: 'EDGE_BROKEN', severity: 'error', edgeId: String(e.id), message: '존재하지 않는 노드를 가리키는 연결이 있습니다.' });
    }
  }

  for (const n of tasks) {
    const nm = displayName(n);
    const tt = String(n.taskType || '').toUpperCase();

    if (tt === 'APPROVAL') {
      // 결재선 미지정 — 서버도 이 조건으로 템플릿 생성을 거부한다
      const hasLine = String(n.approvalUserIds || '').trim() || n.assigneeUserId || n.assigneeOrgUnitId;
      if (!hasLine) {
        findings.push({ id: `APPROVAL_LINE:${n.id}`, code: 'APPROVAL_LINE_MISSING', severity: 'error', nodeId: String(n.id), nodeName: nm, message: `결재 단계 「${nm}」 — 누가 결재하나요? 결재선을 순서대로 지정하세요.` });
      }
      // 반려 경로 없음 — "반려되면 어떻게 되나요?" (전결이면 무시 가능)
      const outs = out(n.id);
      const hasReject = outs.some((e) => e.isLoopBack || /REJECTED/i.test(String(e.condition || '')));
      if (outs.length && !hasReject) {
        findings.push({ id: `APPROVAL_REJECT:${n.id}`, code: 'APPROVAL_NO_REJECT_PATH', severity: 'warn', nodeId: String(n.id), nodeName: nm, message: `결재 단계 「${nm}」 — 반려되면 어떻게 되나요? 반려 경로가 없습니다.` });
      }
    } else {
      // 담당 미지정 — 팀/사람 지정 또는 "시작 시 수동 배정"을 명시적으로 선택
      const hasAssignee = n.assigneeUserId || n.assigneeOrgUnitId || String(n.assigneeType || '').trim();
      if (!hasAssignee) {
        findings.push({ id: `ASSIGNEE:${n.id}`, code: 'ASSIGNEE_MISSING', severity: 'warn', nodeId: String(n.id), nodeName: nm, message: `「${nm}」 — 어느 팀이 담당하나요? (지정하지 않으면 프로세스 시작 시 수동 배정)` });
      }
    }

    // 다음 단계로 가는 연결이 없는 태스크
    if (!out(n.id).length) {
      findings.push({ id: `DEADEND:${n.id}`, code: 'NODE_DEAD_END', severity: 'warn', nodeId: String(n.id), nodeName: nm, message: `「${nm}」에서 다음 단계로 가는 연결이 없습니다.` });
    }
  }

  // XOR 분기: 갈림길인데 조건이 없으면 실행 시 경로를 고를 수 없다
  for (const g of nodes.filter((n) => String(n.type) === 'gateway_xor')) {
    const nm = displayName(g);
    const outs = out(g.id);
    const noCond = outs.filter((e) => !String(e.condition || '').trim() && !e.isLoopBack);
    if (outs.length >= 2 && noCond.length >= 2) {
      findings.push({ id: `XOR:${g.id}`, code: 'XOR_NO_CONDITION', severity: 'error', nodeId: String(g.id), nodeName: nm, message: `분기 「${nm}」 — 어떤 조건에서 갈라지나요? 조건 없는 경로가 ${noCond.length}개입니다.` });
    } else if (outs.length >= 2 && noCond.length === 1) {
      findings.push({ id: `XOR:${g.id}`, code: 'XOR_NO_CONDITION', severity: 'warn', nodeId: String(g.id), nodeName: nm, message: `분기 「${nm}」의 경로 1개에 조건이 없습니다. (나머지 조건에 해당하지 않을 때의 기본 경로라면 무시해도 됩니다)` });
    } else if (outs.length === 1) {
      findings.push({ id: `XOR1:${g.id}`, code: 'XOR_SINGLE_PATH', severity: 'warn', nodeId: String(g.id), nodeName: nm, message: `분기 「${nm}」에서 나가는 경로가 1개뿐입니다. 분기가 필요 없다면 정리하세요.` });
    }
  }

  // 도달성: 시작에서 연결을 따라갈 수 없는 단계 / 종료 미도달
  if (starts.length) {
    const visited = new Set<string>();
    const queue = starts.map((s) => String(s.id));
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const e of out(cur)) {
        const t = String(e.target);
        if (!visited.has(t)) queue.push(t);
      }
    }
    for (const n of tasks) {
      if (!visited.has(String(n.id))) {
        findings.push({ id: `UNREACH:${n.id}`, code: 'UNREACHABLE', severity: 'warn', nodeId: String(n.id), nodeName: displayName(n), message: `「${displayName(n)}」이(가) 시작과 연결되어 있지 않습니다.` });
      }
    }
    if (ends.length && !ends.some((e2) => visited.has(String(e2.id)))) {
      findings.push({ id: 'NO_PATH_END', code: 'NO_PATH_TO_END', severity: 'warn', message: '시작에서 종료까지 이어지는 경로가 없습니다.' });
    }
  }

  // error 먼저, 같은 severity는 발견 순서 유지
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

// ── 빨간칸을 닫는 패치 함수들 (새 json 객체 반환) ──────────────────────────

const nextId = (prefix: string) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

function patchNode(json: any, nodeId: string, patch: Record<string, any>) {
  return { ...json, nodes: (json.nodes || []).map((n: any) => (String(n.id) === String(nodeId) ? { ...n, ...patch } : n)) };
}

/** 담당 조직 지정 */
export function fixAssigneeOrg(json: any, nodeId: string, orgUnitId: string) {
  return patchNode(json, nodeId, { assigneeType: 'ORG_UNIT', assigneeOrgUnitId: orgUnitId, assigneeUserId: undefined });
}

/** 결재선(순서 있는 사용자 id 목록) 지정 */
export function fixApprovalLine(json: any, nodeId: string, userIds: string[]) {
  return patchNode(json, nodeId, { approvalUserIds: userIds.join(',') });
}

/** 반려 시 이전 단계로 되돌림: 루프백 엣지 추가 + 전진 엣지에 승인 조건 보강 */
export function fixRejectLoopback(json: any, nodeId: string) {
  const edges: any[] = json.edges || [];
  // 이전 단계 = 이 노드로 들어오는 (루프백 아닌) 엣지의 출발지 중 task 우선
  const preds = edges.filter((e) => String(e.target) === String(nodeId) && !e.isLoopBack).map((e) => String(e.source));
  const nodeById = new Map((json.nodes || []).map((n: any) => [String(n.id), n]));
  const predTask = preds.find((p) => String((nodeById.get(p) as any)?.type) === 'task') || preds[0];
  if (!predTask) return json;
  const newEdges = edges.map((e) => {
    // 전진 엣지(루프백 아님, 조건 없음)에 승인 조건을 채워 분기를 완성
    if (String(e.source) === String(nodeId) && !e.isLoopBack && !String(e.condition || '').trim()) {
      return { ...e, condition: "last.approval.status == 'APPROVED'" };
    }
    return e;
  });
  newEdges.push({ id: nextId('e_rej'), source: String(nodeId), target: predTask, condition: "last.approval.status == 'REJECTED'", isLoopBack: true });
  return { ...json, edges: newEdges };
}

/** 반려 시 프로세스 종료: 종료 노드로 반려 조건 엣지 추가 */
export function fixRejectToEnd(json: any, nodeId: string) {
  const end = (json.nodes || []).find((n: any) => String(n.type) === 'end');
  if (!end) return json;
  const edges = (json.edges || []).map((e: any) => {
    if (String(e.source) === String(nodeId) && !e.isLoopBack && !String(e.condition || '').trim()) {
      return { ...e, condition: "last.approval.status == 'APPROVED'" };
    }
    return e;
  });
  edges.push({ id: nextId('e_rej_end'), source: String(nodeId), target: String(end.id), condition: "last.approval.status == 'REJECTED'" });
  return { ...json, edges };
}

/** 엣지 조건 지정 */
export function fixEdgeCondition(json: any, edgeId: string, condition: string) {
  return { ...json, edges: (json.edges || []).map((e: any) => (String(e.id) === String(edgeId) ? { ...e, condition: condition || undefined } : e)) };
}

/** 끊어진 엣지 삭제 */
export function fixRemoveEdge(json: any, edgeId: string) {
  return { ...json, edges: (json.edges || []).filter((e: any) => String(e.id) !== String(edgeId)) };
}

/** 시작/종료 노드 추가 + 자동 연결 (시작: 들어오는 연결 없는 태스크로, 종료: 나가는 연결 없는 태스크에서) */
export function fixAddStartEnd(json: any, which: 'start' | 'end') {
  const nodes: any[] = json.nodes || [];
  const edges: any[] = json.edges || [];
  const tasks = nodes.filter((n) => String(n.type) === 'task');
  const id = nextId(which);
  const newNode = { id, type: which, name: which === 'start' ? 'Start' : 'End' };
  const newEdges = [...edges];
  if (which === 'start') {
    const heads = tasks.filter((t) => !edges.some((e) => String(e.target) === String(t.id) && !e.isLoopBack));
    for (const h of heads.length ? heads : tasks.slice(0, 1)) newEdges.push({ id: nextId('e_s'), source: id, target: String(h.id) });
  } else {
    const tails = tasks.filter((t) => !edges.some((e) => String(e.source) === String(t.id) && !e.isLoopBack));
    for (const t of tails.length ? tails : tasks.slice(-1)) newEdges.push({ id: nextId('e_e'), source: String(t.id), target: id });
  }
  return { ...json, nodes: [...nodes, newNode], edges: newEdges };
}

/** 커버리지 누락분을 태스크로 추가. afterNodeId가 있으면 그 노드의 전진 엣지 사이에 끼워 넣는다. */
export function fixInsertTask(json: any, opts: { name: string; taskType?: string; description?: string; afterNodeId?: string | null }) {
  const id = nextId('n_cov');
  const node: any = { id, type: 'task', name: opts.name, taskType: opts.taskType || 'WORKLOG' };
  if (opts.description) node.description = opts.description;
  const nodes = [...(json.nodes || []), node];
  const edges = [...(json.edges || [])];
  const after = opts.afterNodeId && nodes.some((n: any) => String(n.id) === String(opts.afterNodeId)) ? String(opts.afterNodeId) : null;
  if (after) {
    const outIdx = edges.findIndex((e) => String(e.source) === after && !e.isLoopBack);
    if (outIdx >= 0) {
      // after → X 를 after → new → X 로 스플라이스 (기존 조건은 after→new 구간에 유지)
      const old = edges[outIdx];
      edges[outIdx] = { ...old, target: id };
      edges.push({ id: nextId('e_cov'), source: id, target: String(old.target) });
    } else {
      edges.push({ id: nextId('e_cov'), source: after, target: id });
    }
  }
  return { ...json, nodes, edges };
}

/** 태스크를 종료 노드에 연결 (막다른 단계 해소) */
export function fixConnectToEnd(json: any, nodeId: string) {
  const end = (json.nodes || []).find((n: any) => String(n.type) === 'end');
  if (!end) return fixAddStartEnd(json, 'end');
  return { ...json, edges: [...(json.edges || []), { id: nextId('e_de'), source: String(nodeId), target: String(end.id) }] };
}
