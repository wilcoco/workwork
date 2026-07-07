import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(private prisma: PrismaService) {}

  private compileBpmn(bpmn: any) {
    if (!bpmn || !Array.isArray(bpmn.nodes) || !Array.isArray(bpmn.edges)) return [] as any[];
    const nodes: Record<string, any> = {};
    for (const n of bpmn.nodes) if (n && n.id) nodes[String(n.id)] = n;
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, any[]>();
    for (const e of bpmn.edges) {
      const tgt = String(e.target);
      const src = String(e.source);
      // 루프백 엣지는 선행관계(incoming)에서 제외 — 포함하면 상호 선행 데드락으로 첫 태스크가 READY가 되지 못함
      if (!e.isLoopBack) {
        if (!incoming.has(tgt)) incoming.set(tgt, []);
        incoming.get(tgt)!.push(src);
      }
      if (!outgoing.has(src)) outgoing.set(src, []);
      outgoing.get(src)!.push(e);
    }
    const isTask = (n: any) => n && String(n.type).toLowerCase() === 'task';
    const isGateway = (n: any) => n && String(n.type).toLowerCase().startsWith('gateway');
    const isStart = (n: any) => n && String(n.type).toLowerCase() === 'start';
    const collectUpstreamTasks = (nodeId: string, seen = new Set<string>()): Set<string> => {
      if (seen.has(nodeId)) return new Set();
      seen.add(nodeId);
      const preds = incoming.get(nodeId) || [];
      const res = new Set<string>();
      for (const p of preds) {
        const pn = nodes[p];
        if (!pn) continue;
        if (isTask(pn)) res.add(String(pn.id));
        else if (isGateway(pn) || isStart(pn)) {
          const up = collectUpstreamTasks(String(pn.id), seen);
          for (const u of up) res.add(u);
        } else {
          const up = collectUpstreamTasks(String(pn.id), seen);
          for (const u of up) res.add(u);
        }
      }
      return res;
    };
    const toCsv = (v: any): string | undefined => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim().length > 0).map((x) => String(x).trim()).join(',');
      const s = String(v).trim();
      return s.length ? s : undefined;
    };
    const normTaskType = (t: any) => {
      const s = String(t || 'TASK').toUpperCase();
      return ['TASK', 'WORKLOG', 'COOPERATION', 'APPROVAL'].includes(s) ? s : 'TASK';
    };
    const normAssigneeType = (t: any) => {
      const s = String(t || '').toUpperCase();
      return ['USER', 'ORG_UNIT', 'ROLE'].includes(s) ? s : undefined;
    };
    // Build loopBack map from edges with isLoopBack: true
    const loopBackMap = new Map<string, { targetId: string; condition: string }>();
    for (const e of bpmn.edges) {
      if (e.isLoopBack) {
        const src = String(e.source);
        const tgt = String(e.target);
        // source is a task node (e.g. approval), target is a task node to loop back to
        const srcNode = nodes[src];
        const tgtNode = nodes[tgt];
        if (srcNode && tgtNode && (isTask(srcNode) || isGateway(srcNode))) {
          loopBackMap.set(isTask(srcNode) ? src : src, { targetId: tgt, condition: String(e.condition || "last.approval.status == 'REJECTED'") });
        }
      }
    }
    const isXor = (n: any) => n && String(n.type).toLowerCase() === 'gateway_xor';
    const isParallel = (n: any) => n && String(n.type).toLowerCase() === 'gateway_parallel';
    const taskNodes = bpmn.nodes.filter((n: any) => isTask(n));
    return taskNodes.map((n: any, idx: number) => {
      const preds = Array.from(collectUpstreamTasks(String(n.id)));
      const immPreds: string[] = incoming.get(String(n.id)) || [];
      let xorKey: string | undefined = undefined;
      let xorCond: string | undefined = undefined;
      let hasXorPred = false;
      let hasParallelPred = false;
      for (const pid of immPreds) {
        const pn = nodes[pid];
        if (isXor(pn)) {
          hasXorPred = true;
          if (!xorKey) {
            xorKey = String(pn.id);
            const outs = outgoing.get(String(pn.id)) || [];
            const edge = outs.find((e: any) => String(e.target) === String(n.id));
            if (edge && edge.condition) xorCond = String(edge.condition);
          }
        }
        if (isParallel(pn)) hasParallelPred = true;
      }
      // predecessorMode: XOR → 'ANY', Parallel join → 'ALL' (explicit), default → undefined (=ALL)
      const predecessorMode = hasXorPred ? 'ANY' : (hasParallelPred ? 'ALL' : undefined);
      // LoopBack: check if this task has outgoing loopBack edges
      let loopBackTargetId: string | undefined = undefined;
      let loopBackCondition: string | undefined = undefined;
      const lb = loopBackMap.get(String(n.id));
      if (lb) {
        loopBackTargetId = lb.targetId;
        loopBackCondition = lb.condition;
      }
      // Also check gateway-mediated loopback: if this task's outgoing goes to a gateway that has loopBack
      const taskOuts = outgoing.get(String(n.id)) || [];
      for (const e of taskOuts) {
        const tgtNode = nodes[String(e.target)];
        if (tgtNode && isGateway(tgtNode)) {
          const gwLb = loopBackMap.get(String(tgtNode.id));
          if (gwLb && !loopBackTargetId) {
            loopBackTargetId = gwLb.targetId;
            loopBackCondition = gwLb.condition;
          }
          // Also check gateway's outgoing for loopBack edges
          const gwOuts = outgoing.get(String(tgtNode.id)) || [];
          for (const ge of gwOuts) {
            if (ge.isLoopBack && !loopBackTargetId) {
              loopBackTargetId = String(ge.target);
              loopBackCondition = String(ge.condition || "last.approval.status == 'REJECTED'");
            }
          }
        }
      }
      return {
        id: String(n.id),
        name: String(n.name || ''),
        description: n.description != null ? String(n.description) : undefined,
        assigneeHint: n.assigneeHint != null ? String(n.assigneeHint) : undefined,
        assigneeType: normAssigneeType(n.assigneeType),
        assigneeUserId: n.assigneeUserId != null && String(n.assigneeUserId).trim() ? String(n.assigneeUserId).trim() : undefined,
        assigneeOrgUnitId: n.assigneeOrgUnitId != null && String(n.assigneeOrgUnitId).trim() ? String(n.assigneeOrgUnitId).trim() : undefined,
        assigneeRoleCode: n.assigneeRoleCode != null && String(n.assigneeRoleCode).trim() ? String(n.assigneeRoleCode).trim() : undefined,
        stageLabel: n.stageLabel != null ? String(n.stageLabel) : undefined,
        taskType: normTaskType(n.taskType),
        orderHint: typeof n.orderHint === 'number' ? n.orderHint : idx,
        predecessorIds: preds.length ? preds.join(',') : undefined,
        predecessorMode,
        xorGroupKey: xorKey,
        xorCondition: xorCond,
        expectedOutput: n.expectedOutput != null ? String(n.expectedOutput) : undefined,
        emailToTemplate: n.emailToTemplate != null ? String(n.emailToTemplate) : undefined,
        emailCcTemplate: n.emailCcTemplate != null ? String(n.emailCcTemplate) : undefined,
        emailSubjectTemplate: n.emailSubjectTemplate != null ? String(n.emailSubjectTemplate) : undefined,
        emailBodyTemplate: n.emailBodyTemplate != null ? String(n.emailBodyTemplate) : undefined,
        worklogTemplateHint: n.worklogTemplateHint != null ? String(n.worklogTemplateHint) : undefined,
        linkToKpiType: n.linkToKpiType != null ? String(n.linkToKpiType) : undefined,
        approvalRouteType: n.approvalRouteType != null ? String(n.approvalRouteType) : undefined,
        approvalRoleCodes: toCsv(n.approvalRoleCodes),
        approvalUserIds: toCsv(n.approvalUserIds),
        isFinalApproval: n.isFinalApproval ? Boolean(n.isFinalApproval) : false,
        deadlineOffsetDays: typeof n.deadlineOffsetDays === 'number' ? n.deadlineOffsetDays : undefined,
        slaHours: typeof n.slaHours === 'number' ? n.slaHours : undefined,
        allowDelayReasonRequired: n.allowDelayReasonRequired ? Boolean(n.allowDelayReasonRequired) : false,
        loopBackTargetId,
        loopBackCondition,
        maxLoopCount: typeof n.maxLoopCount === 'number' ? n.maxLoopCount : undefined,
      };
    });
  }
  
  private remapTaskIdsForDb(compiled: any[], prefix: string) {
    const map: Record<string, string> = {};
    for (const t of compiled) {
      const orig = String(t.id);
      map[orig] = `${prefix}__${orig}`;
    }
    return compiled.map((t: any) => {
      const orig = String(t.id);
      const newId = map[orig];
      const remapList = (csv?: string) =>
        csv ? csv.split(',').map((s) => s.trim()).filter(Boolean).map((x) => map[x] || `${prefix}__${x}`).join(',') : undefined;
      return {
        ...t,
        id: newId,
        predecessorIds: remapList(t.predecessorIds),
      };
    });
  }

  private hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  private bpmnStats(bpmn: any) {
    try {
      const nodesArr = Array.isArray(bpmn?.nodes) ? bpmn.nodes : [];
      const edgesArr = Array.isArray(bpmn?.edges) ? bpmn.edges : [];
      const nodes = nodesArr.length;
      const edges = edgesArr.length;
      const sig = [
        ...nodesArr.map((n: any) => `${n?.id}|${n?.type}|${n?.name || ''}|${n?.taskType || ''}|${n?.stageLabel || ''}|${n?.emailToTemplate || ''}|${n?.emailCcTemplate || ''}|${n?.emailSubjectTemplate || ''}|${this.hashString(String(n?.emailBodyTemplate || ''))}`),
        '---',
        ...edgesArr.map((e: any) => `${e?.source}->${e?.target}|${e?.condition || ''}`),
      ].join('\n');
      const hash = this.hashString(sig);
      return { nodes, edges, hash };
    } catch {
      return { nodes: 0, edges: 0, hash: 0 };
    }
  }

  private templateSnapshot(tmpl: any) {
    if (!tmpl) return null;
    const tasks = Array.isArray(tmpl?.tasks)
      ? tmpl.tasks.map((t: any) => ({
        id: t.id,
        name: t.name,
        taskType: t.taskType,
        orderHint: t.orderHint,
        stageLabel: t.stageLabel,
        predecessorIds: t.predecessorIds,
        predecessorMode: t.predecessorMode,
        xorGroupKey: t.xorGroupKey,
        xorCondition: t.xorCondition,
      }))
      : [];
    const bpmn = (tmpl as any).bpmnJson;
    return {
      id: tmpl.id,
      title: tmpl.title,
      description: tmpl.description,
      type: tmpl.type,
      ownerId: tmpl.ownerId,
      visibility: tmpl.visibility,
      orgUnitId: tmpl.orgUnitId,
      recurrenceType: tmpl.recurrenceType,
      recurrenceDetail: tmpl.recurrenceDetail,
      resultInputRequired: tmpl.resultInputRequired,
      expectedDurationDays: tmpl.expectedDurationDays,
      expectedCompletionCriteria: tmpl.expectedCompletionCriteria,
      allowExtendDeadline: tmpl.allowExtendDeadline,
      status: tmpl.status,
      official: (tmpl as any).official,
      tasks,
      bpmn: { stats: this.bpmnStats(bpmn) },
    };
  }

  private diffTemplateSnapshots(before: any, after: any) {
    const b = before || {};
    const a = after || {};
    const fields = [
      'title',
      'type',
      'visibility',
      'orgUnitId',
      'recurrenceType',
      'recurrenceDetail',
      'resultInputRequired',
      'expectedDurationDays',
      'expectedCompletionCriteria',
      'allowExtendDeadline',
      'status',
      'official',
    ];
    const changes: any[] = [];
    for (const f of fields) {
      const bv = (b as any)[f];
      const av = (a as any)[f];
      if (bv !== av) changes.push({ field: f, before: bv, after: av });
    }
    if ((b.description || '') !== (a.description || '')) {
      changes.push({
        field: 'description',
        before: String(b.description || '').slice(0, 2000),
        after: String(a.description || '').slice(0, 2000),
      });
    }
    const bt = Array.isArray(b.tasks) ? b.tasks : [];
    const at = Array.isArray(a.tasks) ? a.tasks : [];
    if (bt.length !== at.length) changes.push({ field: 'tasksCount', before: bt.length, after: at.length });
    const taskSig = (t: any) => {
      const parts = [t.taskType, t.name, t.stageLabel, t.predecessorIds, t.predecessorMode, t.xorGroupKey, t.xorCondition];
      return parts.map((x) => (x == null ? '' : String(x))).join('|');
    };
    const btSig = bt.map((t: any) => taskSig(t)).join(' > ');
    const atSig = at.map((t: any) => taskSig(t)).join(' > ');
    if (btSig !== atSig) changes.push({ field: 'tasks', before: btSig, after: atSig });
    const bb = (b as any).bpmn?.stats || {};
    const ab = (a as any).bpmn?.stats || {};
    if ((bb.nodes ?? 0) !== (ab.nodes ?? 0) || (bb.edges ?? 0) !== (ab.edges ?? 0) || (bb.hash ?? 0) !== (ab.hash ?? 0)) {
      changes.push({ field: 'bpmnStats', before: bb, after: ab });
    }
    return changes;
  }

  @Get()
  async list(@Query('ownerId') ownerId?: string, @Query('actorId') actorId?: string) {
    const where: any = {};
    if (ownerId) {
      where.ownerId = ownerId;
    }

    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: String(actorId) } })
      : null;
    if (actorId && !actor) {
      throw new BadRequestException('invalid actorId');
    }

    if (!actor) {
      where.status = 'ACTIVE';
      where.visibility = 'PUBLIC';
    } else {
      const actorIdStr = String(actor.id);
      const actorOrgUnitId = actor.orgUnitId ? String(actor.orgUnitId) : '';
      const activeOr: any[] = [{ ownerId: actorIdStr }, { visibility: 'PUBLIC' }];
      if (actorOrgUnitId) {
        activeOr.push({ visibility: 'ORG_UNIT', orgUnitId: actorOrgUnitId });
      }
      where.OR = [
        { status: 'DRAFT', ownerId: actorIdStr },
        {
          status: 'ACTIVE',
          OR: activeOr,
        },
      ];
    }
    const include: any = {
      tasks: { orderBy: { orderHint: 'asc' } },
      owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      orgUnit: { select: { id: true, name: true } },
    };
    return this.prisma.processTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include,
    });
  }

  /**
   * 시작 전 결재선 역할 해석 미리보기 — 템플릿의 approvalRoleCodes를 시작자 기준으로
   * 사람/후보 목록으로 풀어준다. 시작 화면이 이 결과로 "역할 확정" 빨간칸을 그린다.
   * (템플릿 시점에 '역할로 미룬' 빨간칸이 구동 시점으로 이월되는 지점)
   */
  /** 운영 중 접수된 구조 불일치 신고 목록 (템플릿 편집 화면 배지용) */
  @Get(':id/structure-gaps')
  async structureGaps(@Param('id') id: string) {
    const rows = await (this.prisma as any).event.findMany({
      where: { subjectType: 'ProcessTemplate', subjectId: id, activity: 'StructureGapReported' },
      orderBy: { ts: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((e: any) => ({
        id: e.id, ts: e.ts,
        note: e.attrs?.note || '',
        reporterName: e.attrs?.reporterName || null,
        instanceId: e.attrs?.instanceId || null,
        instanceTitle: e.attrs?.instanceTitle || null,
      })),
    };
  }

  @Get(':id/approval-roles')
  async approvalRolePreview(@Param('id') id: string, @Query('starterId') starterId?: string) {
    const tpl = await (this.prisma as any).processTemplate.findUnique({ where: { id }, include: { tasks: { orderBy: { orderHint: 'asc' } } } });
    if (!tpl) throw new BadRequestException('template not found');

    // 시작자 팀 팀장
    let starterMgrId: string | null = null;
    if (starterId) {
      const starter = await (this.prisma as any).user.findUnique({ where: { id: String(starterId) }, select: { orgUnitId: true } });
      if (starter?.orgUnitId) {
        const unit = await (this.prisma as any).orgUnit.findUnique({ where: { id: starter.orgUnitId }, select: { managerId: true } });
        starterMgrId = unit?.managerId || null;
      }
    }

    // 역할 코드가 참조하는 조직·임원 프리페치
    const orgIds = new Set<string>();
    let needExecs = false;
    for (const t of tpl.tasks || []) {
      for (const en of String((t as any).approvalRoleCodes || '').split(',').map((s: string) => s.trim()).filter(Boolean)) {
        if (en.startsWith('MGR:') && en !== 'MGR:STARTER') orgIds.add(en.slice(4));
        if (en === 'EXEC') needExecs = true;
        if (en.startsWith('EXEC:')) { needExecs = true; orgIds.add(en.slice(5)); }
      }
    }
    const orgs = orgIds.size
      ? await (this.prisma as any).orgUnit.findMany({ where: { id: { in: Array.from(orgIds) } }, select: { id: true, name: true, managerId: true } })
      : [];
    const orgMap = new Map(orgs.map((o: any) => [String(o.id), o]));
    const execs: any[] = needExecs
      ? await (this.prisma as any).user.findMany({ where: { role: { in: ['EXEC', 'CEO'] as any }, status: 'ACTIVE' as any }, select: { id: true, name: true, orgUnitId: true, orgUnit: { select: { name: true } } } })
      : [];
    // 이름 해석 대상 사용자 수집 (고정 사람 + 팀장들)
    const userIds = new Set<string>();
    if (starterMgrId) userIds.add(starterMgrId);
    for (const o of orgs) if (o.managerId) userIds.add(String(o.managerId));
    for (const t of tpl.tasks || []) {
      for (const en of String((t as any).approvalRoleCodes || '').split(',').map((s: string) => s.trim()).filter(Boolean)) {
        if (en.startsWith('U:')) userIds.add(en.slice(2));
      }
    }
    const usersById = new Map(
      (userIds.size
        ? await (this.prisma as any).user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true } })
        : []
      ).map((u: any) => [String(u.id), u.name]),
    );

    const tasks = (tpl.tasks || [])
      .map((t: any) => {
        const codes = String(t.approvalRoleCodes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        if (!codes.length) return null;
        const entries = codes.map((en: string) => {
          if (en.startsWith('U:')) {
            const uid = en.slice(2);
            return { code: en, label: usersById.get(uid) || '(사용자)', resolvedUserId: uid, resolvedName: usersById.get(uid) || null };
          }
          if (en === 'MGR:STARTER') {
            return { code: en, label: '시작자 팀 팀장', resolvedUserId: starterMgrId, resolvedName: starterMgrId ? usersById.get(starterMgrId) || null : null };
          }
          if (en.startsWith('MGR:')) {
            const org: any = orgMap.get(en.slice(4));
            const mid = org?.managerId || null;
            return { code: en, label: `${org?.name || '(조직)'} 팀장`, resolvedUserId: mid, resolvedName: mid ? usersById.get(mid) || null : null };
          }
          if (en === 'EXEC' || en.startsWith('EXEC:')) {
            const scope = en.startsWith('EXEC:') ? en.slice(5) : null;
            const cands = execs.filter((u) => !scope || String(u.orgUnitId || '') === scope)
              .map((u) => ({ id: u.id, name: u.name, orgName: u.orgUnit?.name || '' }));
            const scopeName: any = scope ? (orgMap.get(scope) as any)?.name : null;
            const one = cands.length === 1 ? cands[0] : null;
            return { code: en, label: scope ? `${scopeName || '(조직)'} 임원` : '임원', resolvedUserId: one?.id || null, resolvedName: one?.name || null, candidates: cands };
          }
          return { code: en, label: en, resolvedUserId: null, resolvedName: null };
        });
        return { taskTemplateId: t.id, name: t.name, entries };
      })
      .filter(Boolean);

    return { tasks };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Query('actorId') actorId?: string) {
    const include: any = {
      tasks: { orderBy: { orderHint: 'asc' } },
      owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      orgUnit: { select: { id: true, name: true } },
    };
    const tmpl = await this.prisma.processTemplate.findUnique({
      where: { id },
      include,
    });
    if (!tmpl) return tmpl;

    const status = String((tmpl as any)?.status || '').toUpperCase();
    const visibility = String((tmpl as any)?.visibility || '').toUpperCase();
    const actorIdStr = actorId ? String(actorId) : '';

    if (status === 'DRAFT') {
      if (!actorIdStr || String(tmpl.ownerId) !== actorIdStr) throw new ForbiddenException('not allowed');
      return tmpl;
    }

    if (visibility === 'PUBLIC') return tmpl;
    if (!actorIdStr) throw new ForbiddenException('not allowed');
    if (visibility === 'PRIVATE') {
      if (String(tmpl.ownerId) !== actorIdStr) throw new ForbiddenException('not allowed');
      return tmpl;
    }
    if (visibility === 'ORG_UNIT') {
      if (String(tmpl.ownerId) === actorIdStr) return tmpl;
      const actor = await this.prisma.user.findUnique({ where: { id: actorIdStr } });
      if (!actor) throw new BadRequestException('invalid actorId');
      if (actor.orgUnitId && tmpl.orgUnitId && String(actor.orgUnitId) === String(tmpl.orgUnitId)) return tmpl;
      throw new ForbiddenException('not allowed');
    }

    return tmpl;
  }

  @Post()
  async create(@Body() body: any) {
    const {
      title,
      description,
      type,
      ownerId,
      actorId,
      visibility,
      orgUnitId,
      recurrenceType,
      recurrenceDetail,
      resultInputRequired,
      expectedDurationDays,
      expectedCompletionCriteria,
      allowExtendDeadline,
      status,
      bpmnJson,
      tasks,
      sourceManualId,
    } = body;

    if (!ownerId) {
      throw new BadRequestException('ownerId required');
    }
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      throw new BadRequestException('invalid ownerId');
    }

    const actor = actorId ? await this.prisma.user.findUnique({ where: { id: String(actorId) } }) : null;
    if (actorId && !actor) {
      throw new BadRequestException('invalid actorId');
    }
    const createdById = actor ? String(actor.id) : String(ownerId);

    const compiled = this.compileBpmn(bpmnJson);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tmpl = await tx.processTemplate.create({
          data: {
            title,
            description,
            type,
            ownerId,
            createdById,
            updatedById: createdById,
            visibility,
            orgUnitId: orgUnitId ?? owner.orgUnitId ?? undefined,
            recurrenceType,
            recurrenceDetail,
            sourceManualId: sourceManualId ? String(sourceManualId) : undefined,
            bpmnJson,
            resultInputRequired,
            expectedDurationDays,
            expectedCompletionCriteria,
            allowExtendDeadline,
            status: 'DRAFT',
          },
        });
        const createdMap = new Map<string, string>();
        if (compiled && compiled.length) {
          for (const [idx, t] of compiled.entries()) {
            const created = await tx.processTaskTemplate.create({
              data: {
                processTemplateId: tmpl.id,
                name: t.name,
                description: t.description,
                assigneeHint: t.assigneeHint,
                assigneeType: t.assigneeType,
                assigneeUserId: t.assigneeUserId,
                assigneeOrgUnitId: t.assigneeOrgUnitId,
                assigneeRoleCode: t.assigneeRoleCode,
                stageLabel: t.stageLabel,
                taskType: t.taskType,
                orderHint: typeof t.orderHint === 'number' ? t.orderHint : idx,
                expectedOutput: t.expectedOutput,
                emailToTemplate: t.emailToTemplate,
                emailCcTemplate: t.emailCcTemplate,
                emailSubjectTemplate: t.emailSubjectTemplate,
                emailBodyTemplate: t.emailBodyTemplate,
                worklogTemplateHint: t.worklogTemplateHint,
                linkToKpiType: t.linkToKpiType,
                approvalRouteType: t.approvalRouteType,
                approvalRoleCodes: t.approvalRoleCodes,
                approvalUserIds: t.approvalUserIds,
                isFinalApproval: t.isFinalApproval,
                deadlineOffsetDays: t.deadlineOffsetDays,
                slaHours: t.slaHours,
                allowDelayReasonRequired: t.allowDelayReasonRequired,
                xorGroupKey: t.xorGroupKey,
                xorCondition: t.xorCondition,
                loopBackTargetId: t.loopBackTargetId,
                loopBackCondition: t.loopBackCondition,
                maxLoopCount: t.maxLoopCount,
              },
            });
            createdMap.set(String(t.id), created.id);
          }
          for (const t of compiled) {
            const newId = createdMap.get(String(t.id))!;
            const preds = (String(t.predecessorIds || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean) as string[])
              .map((pid) => createdMap.get(pid))
              .filter(Boolean) as string[];
            // Remap loopBackTargetId to the new DB-generated ID
            const remappedLoopBack = t.loopBackTargetId ? (createdMap.get(t.loopBackTargetId) || undefined) : undefined;
            await tx.processTaskTemplate.update({
              where: { id: newId },
              data: { predecessorIds: preds.length ? preds.join(',') : undefined, predecessorMode: t.predecessorMode, loopBackTargetId: remappedLoopBack },
            });
          }
        } else if (tasks && Array.isArray(tasks)) {
          await tx.processTaskTemplate.createMany({
            data: tasks.map((t: any, idx: number) => ({
              processTemplateId: tmpl.id,
              name: t.name,
              description: t.description,
              assigneeHint: t.assigneeHint,
              stageLabel: t.stageLabel,
              taskType: t.taskType,
              orderHint: t.orderHint ?? idx,
              predecessorIds: t.predecessorIds,
              assigneeType: t.assigneeType,
              assigneeUserId: t.assigneeUserId,
              assigneeOrgUnitId: t.assigneeOrgUnitId,
              assigneeRoleCode: t.assigneeRoleCode,
              cooperationTargetType: t.cooperationTargetType,
              cooperationTargetUserId: t.cooperationTargetUserId,
              cooperationTargetOrgUnitId: t.cooperationTargetOrgUnitId,
              cooperationTargetRoleCode: t.cooperationTargetRoleCode,
              expectedOutput: t.expectedOutput,
              emailToTemplate: t.emailToTemplate,
              emailCcTemplate: t.emailCcTemplate,
              emailSubjectTemplate: t.emailSubjectTemplate,
              emailBodyTemplate: t.emailBodyTemplate,
              worklogTemplateHint: t.worklogTemplateHint,
              linkToKpiType: t.linkToKpiType,
              approvalRouteType: t.approvalRouteType,
              approvalRoleCodes: t.approvalRoleCodes,
              approvalUserIds: t.approvalUserIds,
              isFinalApproval: t.isFinalApproval,
              deadlineOffsetDays: t.deadlineOffsetDays,
              slaHours: t.slaHours,
              allowDelayReasonRequired: t.allowDelayReasonRequired,
            })),
          });
        }
        const created = await tx.processTemplate.findUnique({
          where: { id: tmpl.id },
          include: {
            tasks: { orderBy: { orderHint: 'asc' } },
            owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
            createdBy: { select: { id: true, name: true } },
            updatedBy: { select: { id: true, name: true } },
            orgUnit: { select: { id: true, name: true } },
          },
        });
        const afterSnap = this.templateSnapshot(created);
        await tx.event.create({
          data: {
            subjectType: 'ProcessTemplate',
            subjectId: tmpl.id,
            activity: 'ProcessTemplateCreated',
            userId: createdById,
            attrs: { before: null, after: afterSnap, changes: this.diffTemplateSnapshots(null, afterSnap) },
          },
        });
        return created;
      });
    } catch (e: any) {
      throw new BadRequestException(`failed to create process template: ${e?.message || e}`);
    }
  }

  @Get(':id/history')
  async history(@Param('id') id: string, @Query('actorId') actorId?: string) {
    const tmpl = await this.getOne(id, actorId);
    if (!tmpl) return [];

    const rows = await this.prisma.event.findMany({
      where: {
        subjectType: 'ProcessTemplate',
        subjectId: id,
        activity: { in: ['ProcessTemplateCreated', 'ProcessTemplateUpdated', 'ProcessTemplatePublished', 'ProcessTemplatePromoted', 'ProcessTemplateDeleted'] } as any,
      },
      orderBy: { ts: 'desc' },
    });

    const userIds = Array.from(new Set((rows || []).map((r: any) => r.userId).filter(Boolean).map((x: any) => String(x))));
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = new Map<string, any>((users || []).map((u: any) => [String(u.id), u]));

    return (rows || []).map((e: any) => ({
      id: e.id,
      ts: e.ts,
      activity: e.activity,
      userId: e.userId,
      user: e.userId ? (userMap.get(String(e.userId)) || { id: String(e.userId), name: String(e.userId) }) : null,
      attrs: e.attrs,
    }));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const {
      title,
      description,
      type,
      ownerId,
      actorId,
      visibility,
      orgUnitId,
      recurrenceType,
      recurrenceDetail,
      scheduleEnabled,
      resultInputRequired,
      expectedDurationDays,
      expectedCompletionCriteria,
      allowExtendDeadline,
      status,
      bpmnJson,
      tasks,
    } = body;

    const actorIdStr = actorId ? String(actorId) : '';
    if (!actorIdStr) throw new BadRequestException('actorId required');
    const actor = await this.prisma.user.findUnique({ where: { id: actorIdStr } });
    if (!actor) throw new BadRequestException('invalid actorId');

    const existingTmpl = await this.prisma.processTemplate.findUnique({ where: { id } });
    if (!existingTmpl) throw new BadRequestException('template not found');

    const existingStatus = String((existingTmpl as any)?.status || '').toUpperCase();
    const nextStatus = status != null ? String(status || '').toUpperCase() : '';
    if (nextStatus && nextStatus !== existingStatus) throw new ForbiddenException('status change not allowed');

    const isOwner = String(existingTmpl.ownerId) === actorIdStr;
    const existingVis = String((existingTmpl as any)?.visibility || '').toUpperCase();
    const actorOrgUnitId = actor.orgUnitId ? String(actor.orgUnitId) : '';
    const tmplOrgUnitId = existingTmpl.orgUnitId ? String(existingTmpl.orgUnitId) : '';

    const isPublished = existingStatus === 'ACTIVE';
    const canEdit = !isPublished
      ? isOwner
      : existingVis === 'PUBLIC'
        ? true
        : existingVis === 'PRIVATE'
          ? isOwner
          : existingVis === 'ORG_UNIT'
            ? (isOwner || (actorOrgUnitId && tmplOrgUnitId && actorOrgUnitId === tmplOrgUnitId))
            : isOwner;
    if (!canEdit) throw new ForbiddenException('not allowed');

    const safeOwnerId = isOwner ? ownerId : undefined;
    const safeVisibility = isOwner ? visibility : undefined;
    const safeOrgUnitId = isOwner ? orgUnitId : undefined;

    if (safeOwnerId) {
      const owner = await this.prisma.user.findUnique({ where: { id: safeOwnerId } });
      if (!owner) throw new BadRequestException('invalid ownerId');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.processTemplate.findUnique({
          where: { id },
          include: { tasks: { orderBy: { orderHint: 'asc' } } },
        });

        await (tx as any).processTemplate.update({
          where: { id },
          data: {
            title,
            description,
            type,
            ownerId: safeOwnerId,
            updatedById: actorIdStr,
            visibility: safeVisibility,
            orgUnitId: safeOrgUnitId,
            recurrenceType,
            recurrenceDetail,
            scheduleEnabled: scheduleEnabled != null ? Boolean(scheduleEnabled) : undefined,
            bpmnJson,
            resultInputRequired,
            expectedDurationDays,
            expectedCompletionCriteria,
            allowExtendDeadline,
          },
        });

      const compiled = this.compileBpmn(bpmnJson);
      const existing = await tx.processTaskTemplate.findMany({ where: { processTemplateId: id }, select: { id: true } });
      const existingIds = existing.map((x: any) => x.id) as string[];
      const usedCount = existingIds.length
        ? await tx.processTaskInstance.count({ where: { taskTemplateId: { in: existingIds } } })
        : 0;

      if (compiled && compiled.length) {
        if (usedCount > 0) {
          // In-use: keep existing tasks unchanged to avoid FK violation. Only template metadata and bpmnJson updated above.
        } else {
          await tx.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
          const createdMap = new Map<string, string>();
          for (const [idx, t] of compiled.entries()) {
            const created = await tx.processTaskTemplate.create({
              data: {
                processTemplateId: id,
                name: t.name,
                description: t.description,
                assigneeHint: t.assigneeHint,
                assigneeType: t.assigneeType,
                assigneeUserId: t.assigneeUserId,
                assigneeOrgUnitId: t.assigneeOrgUnitId,
                assigneeRoleCode: t.assigneeRoleCode,
                stageLabel: t.stageLabel,
                taskType: t.taskType,
                orderHint: typeof t.orderHint === 'number' ? t.orderHint : idx,
                expectedOutput: t.expectedOutput,
                emailToTemplate: t.emailToTemplate,
                emailCcTemplate: t.emailCcTemplate,
                emailSubjectTemplate: t.emailSubjectTemplate,
                emailBodyTemplate: t.emailBodyTemplate,
                worklogTemplateHint: t.worklogTemplateHint,
                linkToKpiType: t.linkToKpiType,
                approvalRouteType: t.approvalRouteType,
                approvalRoleCodes: t.approvalRoleCodes,
                approvalUserIds: t.approvalUserIds,
                isFinalApproval: t.isFinalApproval,
                deadlineOffsetDays: t.deadlineOffsetDays,
                slaHours: t.slaHours,
                allowDelayReasonRequired: t.allowDelayReasonRequired,
                xorGroupKey: t.xorGroupKey,
                xorCondition: t.xorCondition,
                loopBackTargetId: t.loopBackTargetId,
                loopBackCondition: t.loopBackCondition,
                maxLoopCount: t.maxLoopCount,
              },
            });
            createdMap.set(String(t.id), created.id);
          }
          for (const t of compiled) {
            const newId = createdMap.get(String(t.id))!;
            const preds = (String(t.predecessorIds || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean) as string[])
              .map((pid) => createdMap.get(pid))
              .filter(Boolean) as string[];
            const remappedLoopBack = t.loopBackTargetId ? (createdMap.get(t.loopBackTargetId) || undefined) : undefined;
            await tx.processTaskTemplate.update({
              where: { id: newId },
              data: { predecessorIds: preds.length ? preds.join(',') : undefined, predecessorMode: t.predecessorMode, loopBackTargetId: remappedLoopBack },
            });
          }
        }
      } else if (Array.isArray(tasks)) {
        if (usedCount > 0) {
          // In-use: keep existing tasks unchanged.
        } else {
          await tx.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
          const dataToCreate = (tasks as any[]).map((t: any, idx: number) => ({
            processTemplateId: id,
            name: t.name,
            description: t.description,
            assigneeHint: t.assigneeHint,
            stageLabel: t.stageLabel,
            taskType: t.taskType,
            orderHint: t.orderHint ?? idx,
            predecessorIds: t.predecessorIds,
            assigneeType: t.assigneeType,
            assigneeUserId: t.assigneeUserId,
            assigneeOrgUnitId: t.assigneeOrgUnitId,
            assigneeRoleCode: t.assigneeRoleCode,
            cooperationTargetType: t.cooperationTargetType,
            cooperationTargetUserId: t.cooperationTargetUserId,
            cooperationTargetOrgUnitId: t.cooperationTargetOrgUnitId,
            cooperationTargetRoleCode: t.cooperationTargetRoleCode,
            expectedOutput: t.expectedOutput,
            emailToTemplate: t.emailToTemplate,
            emailCcTemplate: t.emailCcTemplate,
            emailSubjectTemplate: t.emailSubjectTemplate,
            emailBodyTemplate: t.emailBodyTemplate,
            worklogTemplateHint: t.worklogTemplateHint,
            linkToKpiType: t.linkToKpiType,
            approvalRouteType: t.approvalRouteType,
            approvalRoleCodes: t.approvalRoleCodes,
            approvalUserIds: t.approvalUserIds,
            isFinalApproval: t.isFinalApproval,
            deadlineOffsetDays: t.deadlineOffsetDays,
            slaHours: t.slaHours,
            allowDelayReasonRequired: t.allowDelayReasonRequired,
            xorGroupKey: t.xorGroupKey,
            xorCondition: t.xorCondition,
            predecessorMode: t.predecessorMode,
            loopBackTargetId: t.loopBackTargetId,
            loopBackCondition: t.loopBackCondition,
            maxLoopCount: t.maxLoopCount,
          }));
          if (dataToCreate.length) {
            await tx.processTaskTemplate.createMany({ data: dataToCreate });
          }
        }
      }

      const updated = await tx.processTemplate.findUnique({
        where: { id },
        include: ({
          tasks: { orderBy: { orderHint: 'asc' } },
          owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
          createdBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          orgUnit: { select: { id: true, name: true } },
        } as any),
      });
      const beforeSnap = this.templateSnapshot(before);
      const afterSnap = this.templateSnapshot(updated);
      await tx.event.create({
        data: {
          subjectType: 'ProcessTemplate',
          subjectId: id,
          activity: 'ProcessTemplateUpdated',
          userId: actorIdStr,
          attrs: { before: beforeSnap, after: afterSnap, changes: this.diffTemplateSnapshots(beforeSnap, afterSnap) },
        },
      });
      return updated;
      });
    } catch (e: any) {
      throw new BadRequestException(`failed to update process template: ${e?.message || e}`);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('actorId') actorId?: string) {
    const actorIdStr = actorId ? String(actorId) : '';
    if (!actorIdStr) throw new BadRequestException('actorId required');
    const actor = await this.prisma.user.findUnique({ where: { id: actorIdStr } });
    if (!actor) throw new BadRequestException('invalid actorId');
    const role = String((actor as any).role || '').toUpperCase();
    const isExec = role === 'CEO' || role === 'EXEC';

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.processTemplate.findUnique({
        where: { id },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
      if (!existing) throw new BadRequestException('template not found');

      const isOwner = String(existing.ownerId) === actorIdStr;
      if (!isOwner && !isExec) throw new ForbiddenException('not allowed');

      const inUse = await tx.processInstance.count({ where: { templateId: id } });
      if (inUse > 0) {
        throw new BadRequestException('이미 이 템플릿으로 생성된 프로세스가 있어 삭제할 수 없습니다.');
      }
      const beforeSnap = this.templateSnapshot(existing);
      await tx.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
      await tx.processTemplate.delete({ where: { id } });
      await tx.event.create({
        data: {
          subjectType: 'ProcessTemplate',
          subjectId: id,
          activity: 'ProcessTemplateDeleted',
          userId: actorIdStr,
          attrs: { before: beforeSnap, after: null, changes: this.diffTemplateSnapshots(beforeSnap, null) },
        },
      });
      return { ok: true };
    });
  }

  private async isExecOrCeo(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    const role = String(u?.role || '').toUpperCase();
    return role === 'CEO' || role === 'EXEC';
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Body() body: any) {
    const { actorId } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const actorIdStr = String(actorId);
    const actor = await this.prisma.user.findUnique({ where: { id: actorIdStr } });
    if (!actor) throw new BadRequestException('invalid actorId');

    const existing = await this.prisma.processTemplate.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('template not found');
    if (String(existing.ownerId) !== actorIdStr) throw new ForbiddenException('not allowed');

    const nextStatus = String((existing as any)?.status || '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'ACTIVE';
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.processTemplate.findUnique({
        where: { id },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
      const updated = await tx.processTemplate.update({
        where: { id },
        data: { status: nextStatus, updatedById: actorIdStr },
        include: {
          tasks: { orderBy: { orderHint: 'asc' } },
          owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
          createdBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          orgUnit: { select: { id: true, name: true } },
        },
      });
      const beforeSnap = this.templateSnapshot(before);
      const afterSnap = this.templateSnapshot(updated);
      await tx.event.create({
        data: {
          subjectType: 'ProcessTemplate',
          subjectId: id,
          activity: 'ProcessTemplatePublished',
          userId: actorIdStr,
          attrs: { before: beforeSnap, after: afterSnap, changes: this.diffTemplateSnapshots(beforeSnap, afterSnap) },
        },
      });
      return updated;
    });
  }

  @Patch(':id/schedule')
  async setSchedule(@Param('id') id: string, @Body() body: any) {
    const { actorId, scheduleEnabled, recurrenceType, recurrenceDetail } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const tmpl = await (this.prisma as any).processTemplate.findUnique({ where: { id } });
    if (!tmpl) throw new BadRequestException('template not found');
    if (String(tmpl.ownerId) !== String(actorId)) {
      const ok = await this.isExecOrCeo(actorId);
      if (!ok) throw new ForbiddenException('not allowed');
    }
    const enabled = scheduleEnabled === true || scheduleEnabled === 'true';
    let scheduleNextRunAt: Date | null = null;
    if (enabled && recurrenceType) {
      scheduleNextRunAt = this.computeNextRun(recurrenceType, recurrenceDetail || null, new Date());
    }
    return (this.prisma as any).processTemplate.update({
      where: { id },
      data: {
        scheduleEnabled: enabled,
        recurrenceType: recurrenceType ?? tmpl.recurrenceType,
        recurrenceDetail: recurrenceDetail !== undefined ? recurrenceDetail : tmpl.recurrenceDetail,
        scheduleNextRunAt: enabled ? scheduleNextRunAt : null,
        scheduleLastRunAt: enabled ? tmpl.scheduleLastRunAt : null,
        updatedById: String(actorId),
      },
    });
  }

  private computeNextRun(type: string, detailJson: string | null, from: Date): Date | null {
    let detail: any = {};
    try { detail = JSON.parse(detailJson || '{}'); } catch {}
    const hour = typeof detail.hour === 'number' ? detail.hour : 9;
    const t = type.toUpperCase();
    if (t === 'DAILY') {
      const next = new Date(from); next.setHours(hour, 0, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next;
    }
    if (t === 'WEEKLY') {
      const dow = typeof detail.dayOfWeek === 'number' ? detail.dayOfWeek : 1;
      const next = new Date(from); next.setHours(hour, 0, 0, 0);
      const diff = (dow - next.getDay() + 7) % 7 || 7;
      next.setDate(next.getDate() + diff);
      return next;
    }
    if (t === 'MONTHLY') {
      const dom = typeof detail.dayOfMonth === 'number' ? detail.dayOfMonth : 1;
      const next = new Date(from); next.setDate(dom); next.setHours(hour, 0, 0, 0);
      if (next <= from) { next.setMonth(next.getMonth() + 1); next.setDate(dom); }
      return next;
    }
    return null;
  }

  @Post(':id/promote')
  async promote(@Param('id') id: string, @Body() body: any) {
    const { actorId } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const ok = await this.isExecOrCeo(actorId);
    if (!ok) throw new ForbiddenException('not allowed');
    const existing = await this.prisma.processTemplate.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('template not found');
    const status = String((existing as any)?.status || '').toUpperCase();
    if (status !== 'ACTIVE') throw new BadRequestException('template not published');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.processTemplate.findUnique({
        where: { id },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
      const updated = await tx.processTemplate.update({
        where: { id },
        data: ({ official: true, updatedById: String(actorId) } as any),
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
      const beforeSnap = this.templateSnapshot(before);
      const afterSnap = this.templateSnapshot(updated);
      await tx.event.create({
        data: {
          subjectType: 'ProcessTemplate',
          subjectId: id,
          activity: 'ProcessTemplatePromoted',
          userId: String(actorId),
          attrs: { before: beforeSnap, after: afterSnap, changes: this.diffTemplateSnapshots(beforeSnap, afterSnap) },
        },
      });
      return updated;
    });
  }
}
