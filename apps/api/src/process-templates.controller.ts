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
        id: String(n.id),
        name: String(n.name || ''),
        description: n.description != null ? String(n.description) : undefined,
        assigneeHint: n.assigneeHint != null ? String(n.assigneeHint) : undefined,
        stageLabel: n.stageLabel != null ? String(n.stageLabel) : undefined,
        taskType: normTaskType(n.taskType),
        orderHint: typeof n.orderHint === 'number' ? n.orderHint : idx,
        predecessorIds: preds.length ? preds.join(',') : undefined,
        predecessorMode: anyXor ? 'ANY' : undefined,
        xorGroupKey: xorKey,
        xorCondition: xorCond,
        expectedOutput: n.expectedOutput != null ? String(n.expectedOutput) : undefined,
        worklogTemplateHint: n.worklogTemplateHint != null ? String(n.worklogTemplateHint) : undefined,
        linkToKpiType: n.linkToKpiType != null ? String(n.linkToKpiType) : undefined,
        approvalRouteType: n.approvalRouteType != null ? String(n.approvalRouteType) : undefined,
        approvalRoleCodes: toCsv(n.approvalRoleCodes),
        approvalUserIds: toCsv(n.approvalUserIds),
        isFinalApproval: n.isFinalApproval ? Boolean(n.isFinalApproval) : false,
        deadlineOffsetDays: typeof n.deadlineOffsetDays === 'number' ? n.deadlineOffsetDays : undefined,
        slaHours: typeof n.slaHours === 'number' ? n.slaHours : undefined,
        allowDelayReasonRequired: n.allowDelayReasonRequired ? Boolean(n.allowDelayReasonRequired) : false,
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

  @Get()
  async list(@Query('ownerId') ownerId?: string) {
    const where: any = {};
    if (ownerId) {
      where.ownerId = ownerId;
    }
    return this.prisma.processTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tasks: { orderBy: { orderHint: 'asc' } },
        owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
        updatedBy: { select: { id: true, name: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.prisma.processTemplate.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { orderHint: 'asc' } },
        owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
        updatedBy: { select: { id: true, name: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
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
            bpmnJson,
            resultInputRequired,
            expectedDurationDays,
            expectedCompletionCriteria,
            allowExtendDeadline,
            status,
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
                stageLabel: t.stageLabel,
                taskType: t.taskType,
                orderHint: typeof t.orderHint === 'number' ? t.orderHint : idx,
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
                xorGroupKey: t.xorGroupKey,
                xorCondition: t.xorCondition,
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
            await tx.processTaskTemplate.update({
              where: { id: newId },
              data: { predecessorIds: preds.length ? preds.join(',') : undefined, predecessorMode: t.predecessorMode },
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
        return tx.processTemplate.findUnique({
          where: { id: tmpl.id },
          include: {
            tasks: { orderBy: { orderHint: 'asc' } },
            owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
            createdBy: { select: { id: true, name: true } },
            updatedBy: { select: { id: true, name: true } },
            orgUnit: { select: { id: true, name: true } },
          },
        });
      });
    } catch (e: any) {
      throw new BadRequestException(`failed to create process template: ${e?.message || e}`);
    }
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
      resultInputRequired,
      expectedDurationDays,
      expectedCompletionCriteria,
      allowExtendDeadline,
      status,
      bpmnJson,
      tasks,
    } = body;

    if (ownerId) {
      const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
      if (!owner) throw new BadRequestException('invalid ownerId');
    }

    const effectiveActorId = actorId ? String(actorId) : (ownerId ? String(ownerId) : '');
    if (effectiveActorId) {
      const actor = await this.prisma.user.findUnique({ where: { id: effectiveActorId } });
      if (!actor) throw new BadRequestException('invalid actorId');
    }

    try {
    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.processTemplate.update({
        where: { id },
        data: {
          title,
          description,
          type,
          ownerId,
          ...(effectiveActorId ? { updatedById: effectiveActorId } : {}),
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
                stageLabel: t.stageLabel,
                taskType: t.taskType,
                orderHint: typeof t.orderHint === 'number' ? t.orderHint : idx,
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
                xorGroupKey: t.xorGroupKey,
                xorCondition: t.xorCondition,
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
            await tx.processTaskTemplate.update({
              where: { id: newId },
              data: { predecessorIds: preds.length ? preds.join(',') : undefined, predecessorMode: t.predecessorMode },
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
      }

      return tx.processTemplate.findUnique({
        where: { id },
        include: {
          tasks: { orderBy: { orderHint: 'asc' } },
          owner: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } },
          createdBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          orgUnit: { select: { id: true, name: true } },
        },
      });
    });
    } catch (e: any) {
      throw new BadRequestException(`failed to update process template: ${e?.message || e}`);
    }
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
    const { actorId } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const ok = await this.isExecOrCeo(actorId);
    if (!ok) throw new ForbiddenException('not allowed');
    const updated = await this.prisma.processTemplate.update({
      where: { id },
      data: ({ official: true } as any),
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
    return updated;
  }
}
