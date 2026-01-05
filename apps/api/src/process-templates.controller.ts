import { Body, Controller, Delete, Get, Param, Post, Put, Query, BadRequestException, ForbiddenException } from '@nestjs/common';
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
      if (!incoming.has(tgt)) incoming.set(tgt, []);
      incoming.get(tgt)!.push(src);
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
    const taskNodes = bpmn.nodes.filter((n: any) => isTask(n));
    return taskNodes.map((n: any, idx: number) => {
      const preds = Array.from(collectUpstreamTasks(String(n.id)));
      const immPreds: string[] = incoming.get(String(n.id)) || [];
      let xorKey: string | undefined = undefined;
      let xorCond: string | undefined = undefined;
      const anyXor = immPreds.some((pid) => {
        const pn = nodes[pid];
        const hit = pn && String(pn.type).toLowerCase() === 'gateway_xor';
        if (hit && !xorKey) {
          xorKey = String(pn.id);
          // capture the edge condition from XOR gateway to this task
          const outs = outgoing.get(String(pn.id)) || [];
          const edge = outs.find((e: any) => String(e.target) === String(n.id));
          if (edge && edge.condition) xorCond = String(edge.condition);
        }
        return hit;
      });
      return {
        name: n.name,
        description: n.description,
        assigneeHint: n.assigneeHint,
        stageLabel: n.stageLabel,
        taskType: n.taskType || 'TASK',
        orderHint: n.orderHint ?? idx,
        predecessorIds: preds.length ? preds.join(',') : undefined,
        predecessorMode: anyXor ? 'ANY' : undefined,
        xorGroupKey: xorKey,
        xorCondition: xorCond,
        expectedOutput: n.expectedOutput,
        worklogTemplateHint: n.worklogTemplateHint,
        linkToKpiType: n.linkToKpiType,
        approvalRouteType: n.approvalRouteType,
        approvalRoleCodes: n.approvalRoleCodes,
        approvalUserIds: n.approvalUserIds,
        isFinalApproval: n.isFinalApproval,
        deadlineOffsetDays: n.deadlineOffsetDays,
        slaHours: n.slaHours,
        allowDelayReasonRequired: n.allowDelayReasonRequired,
      };
    });
  }

  @Get()
  async list(@Query('ownerId') ownerId?: string) {
    const where: any = {};
    if (ownerId) {
      where.ownerId = ownerId;
    }
    return this.prisma.processTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.prisma.processTemplate.findUnique({
      where: { id },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
  }

  @Post()
  async create(@Body() body: any) {
    const {
      title,
      description,
      type,
      ownerId,
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
    } = body;

    const compiled = this.compileBpmn(bpmnJson);
    return this.prisma.processTemplate.create({
      data: {
        title,
        description,
        type,
        ownerId,
        visibility,
        orgUnitId,
        recurrenceType,
        recurrenceDetail,
        bpmnJson,
        resultInputRequired,
        expectedDurationDays,
        expectedCompletionCriteria,
        allowExtendDeadline,
        status,
        tasks: (compiled && compiled.length)
          ? { create: compiled }
          : tasks && Array.isArray(tasks)
          ? {
              create: tasks.map((t: any, idx: number) => ({
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
            }
          : undefined,
      },
      include: { tasks: true },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const {
      title,
      description,
      type,
      ownerId,
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
    } = body;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.processTemplate.update({
        where: { id },
        data: {
          title,
          description,
          type,
          ownerId,
          visibility,
          orgUnitId,
          recurrenceType,
          recurrenceDetail,
          bpmnJson,
          resultInputRequired,
          expectedDurationDays,
          expectedCompletionCriteria,
          allowExtendDeadline,
          status,
        },
      });

      const compiled = this.compileBpmn(bpmnJson);
      if ((compiled && compiled.length) || Array.isArray(tasks)) {
        await tx.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
        const dataToCreate = (compiled && compiled.length)
          ? compiled.map((t: any) => ({ processTemplateId: id, ...t }))
          : (tasks as any[]).map((t: any, idx: number) => ({
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
              worklogTemplateHint: t.worklogTemplateHint,
              linkToKpiType: t.linkToKpiType,
              approvalRouteType: t.approvalRouteType,
              approvalRoleCodes: t.approvalRoleCodes,
              approvalUserIds: t.approvalUserIds,
              isFinalApproval: t.isFinalApproval,
              deadlineOffsetDays: t.deadlineOffsetDays,
              slaHours: t.slaHours,
              allowDelayReasonRequired: t.allowDelayReasonRequired,
            }));
        if (dataToCreate.length) {
          await tx.processTaskTemplate.createMany({ data: dataToCreate });
        }
      }

      return tx.processTemplate.findUnique({
        where: { id },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.prisma.$transaction(async (tx) => {
      const inUse = await tx.processInstance.count({ where: { templateId: id } });
      if (inUse > 0) {
        throw new BadRequestException('이미 이 템플릿으로 생성된 프로세스가 있어 삭제할 수 없습니다.');
      }
      await tx.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
      await tx.processTemplate.delete({ where: { id } });
      return { ok: true };
    });
  }

  private async isExecOrCeo(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    const role = String(u?.role || '').toUpperCase();
    return role === 'CEO' || role === 'EXEC';
  }

  @Post(':id/promote')
  async promote(@Param('id') id: string, @Body() body: any) {
    const { actorId, visibility } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const ok = await this.isExecOrCeo(actorId);
    if (!ok) throw new ForbiddenException('not allowed');
    const vis = String(visibility || 'PUBLIC').toUpperCase();
    if (!['PUBLIC', 'ORG_UNIT'].includes(vis)) throw new BadRequestException('invalid visibility');
    const updated = await this.prisma.processTemplate.update({
      where: { id },
      data: { status: 'ACTIVE', visibility: vis as any },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
    return updated;
  }
}
