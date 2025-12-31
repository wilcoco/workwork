import { Body, Controller, Get, Param, Post, Query, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

function parsePreds(s?: string | null): string[] {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function addDays(d: Date, days: number): Date {
  const dt = new Date(d.getTime());
  dt.setDate(dt.getDate() + days);
  return dt;
}

@Controller('processes')
export class ProcessesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('templateId') templateId?: string, @Query('status') status?: string) {
    const where: any = {};
    if (templateId) where.templateId = templateId;
    if (status) where.status = status;
    const rows = await this.prisma.processInstance.findMany({
      where,
      orderBy: { startAt: 'desc' },
      include: {
        template: { select: { id: true, title: true } },
        startedBy: { select: { id: true, name: true, role: true } },
        initiative: { select: { id: true, title: true } },
        tasks: {
          orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, stageLabel: true, taskType: true, status: true },
        },
      },
    });
    const now = new Date();
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      startAt: r.startAt,
      expectedEndAt: r.expectedEndAt,
      endAt: r.endAt,
      template: r.template,
      startedBy: r.startedBy,
      initiative: r.initiative,
      delayed: r.status === 'ACTIVE' && r.expectedEndAt && new Date(r.expectedEndAt).getTime() < now.getTime(),
      tasks: r.tasks,
    }));
  }

  private getCtxValue(ctx: any, path: string): any {
    const parts = String(path).split('.').map((s) => s.trim()).filter(Boolean);
    let cur: any = ctx;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  private evalCondition(cond: string, ctx: any): boolean {
    if (!cond || typeof cond !== 'string') return false;
    const orClauses = cond.split('||');
    for (const orc of orClauses) {
      const andClauses = orc.split('&&');
      let okAnd = true;
      for (let raw of andClauses) {
        const c = raw.trim();
        if (!c) continue;
        const m = c.match(/^([a-zA-Z_][\w\.]*?)\s*(==|!=)\s*(.+)$/);
        if (!m) { okAnd = false; break; }
        const [, left, op, rightRaw] = m;
        let rhs: any = rightRaw.trim();
        if ((rhs.startsWith("'") && rhs.endsWith("'")) || (rhs.startsWith('"') && rhs.endsWith('"'))) rhs = rhs.slice(1, -1);
        else if (/^\d+(?:\.\d+)?$/.test(rhs)) rhs = parseFloat(rhs);
        else if (/^(true|false)$/i.test(rhs)) rhs = /^true$/i.test(rhs);
        else if (/^null$/i.test(rhs)) rhs = null;
        else rhs = String(rhs);
        const lhs = this.getCtxValue(ctx, left);
        const eq = lhs === rhs;
        const res = op === '==' ? eq : !eq;
        if (!res) { okAnd = false; break; }
      }
      if (okAnd) return true;
    }
    return false;
  }

  @Post(':id/tasks/:taskId/force-complete')
  async forceComplete(@Param('id') id: string, @Param('taskId') taskId: string, @Body() body: any) {
    const { actorId, reason } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const isExec = await this.isExecOrCeo(actorId);
    if (!isExec) throw new ForbiddenException('not allowed');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.processTaskInstance.findUnique({ where: { id: taskId } });
      if (!task || task.instanceId !== id) throw new BadRequestException('task not found');
      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: { status: 'COMPLETED', actualEndAt: new Date(), decidedById: actorId, decisionReason: reason || 'force-complete' },
      });
      await this.unlockReadyDownstreams(tx, id, task.taskTemplateId);
      return updated;
    });
  }

  @Post(':id/tasks/:taskId/rollback')
  async rollback(@Param('id') id: string, @Param('taskId') taskId: string, @Body() body: any) {
    const { actorId, reason } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    const isExec = await this.isExecOrCeo(actorId);
    if (!isExec) throw new ForbiddenException('not allowed');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.processTaskInstance.findUnique({ where: { id: taskId } });
      if (!task || task.instanceId !== id) throw new BadRequestException('task not found');
      // Rolling back only affects this task; downstream READY tasks will remain until business decides otherwise
      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: {
          status: 'NOT_STARTED',
          actualStartAt: null,
          actualEndAt: null,
          worklogId: null,
          cooperationId: null,
          approvalRequestId: null,
          decidedById: actorId,
          decisionReason: reason || 'rollback',
        },
      });
      return updated;
    });
  }

  @Get('inbox')
  async inbox(@Query('assigneeId') assigneeId?: string, @Query('status') status?: string) {
    if (!assigneeId) return [];
    const where: any = { assigneeId };
    if (status) where.status = status;
    else where.status = { in: ['READY', 'IN_PROGRESS'] } as any;
    const items = await this.prisma.processTaskInstance.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { instance: { include: { template: true } } },
    });
    return items.map((t: any) => ({
      id: t.id,
      name: t.name,
      stageLabel: t.stageLabel,
      taskType: t.taskType,
      status: t.status,
      instance: { id: t.instance.id, title: t.instance.title, status: t.instance.status, templateTitle: t.instance.template?.title },
    }));
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.prisma.processInstance.findUnique({
      where: { id },
      include: {
        template: true,
        startedBy: true,
        initiative: true,
        tasks: { orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  @Post()
  async start(@Body() body: any) {
    const {
      templateId,
      title,
      startedById,
      itemCode,
      moldCode,
      carModelCode,
      taskAssignees,
      taskPlans,
      initiativeId,
    } = body || {};

    if (!templateId) throw new Error('templateId is required');
    if (!title) throw new Error('title is required');
    if (!startedById) throw new Error('startedById is required');

    const tmpl = await this.prisma.processTemplate.findUnique({
      where: { id: templateId },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
    if (!tmpl) throw new Error('template not found');
    const starter = await this.prisma.user.findUnique({ where: { id: startedById } });

    const now = new Date();
    const assignMap = new Map<string, string>();
    if (Array.isArray(taskAssignees)) {
      for (const a of taskAssignees) {
        if (a && a.taskTemplateId && a.assigneeId) assignMap.set(String(a.taskTemplateId), String(a.assigneeId));
      }
    } else if (taskAssignees && typeof taskAssignees === 'object') {
      for (const k of Object.keys(taskAssignees)) {
        const v = (taskAssignees as any)[k];
        if (v) assignMap.set(String(k), String(v));
      }
    }
    const expectedEndAt = tmpl.expectedDurationDays ? addDays(now, Number(tmpl.expectedDurationDays)) : null;

    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.processInstance.create({
        data: {
          templateId,
          title,
          startedById,
          status: 'ACTIVE',
          startAt: now,
          expectedEndAt: expectedEndAt ?? undefined,
          itemCode: itemCode || undefined,
          moldCode: moldCode || undefined,
          carModelCode: carModelCode || undefined,
          initiativeId: initiativeId || undefined,
        },
      });

      // build plan map
      const planMap = new Map<string, { plannedStartAt?: Date; plannedEndAt?: Date; deadlineAt?: Date }>();
      if (Array.isArray(taskPlans)) {
        for (const p of taskPlans) {
          if (!p || !p.taskTemplateId) continue;
          const rec: any = {};
          if (p.plannedStartAt) rec.plannedStartAt = new Date(p.plannedStartAt);
          if (p.plannedEndAt) rec.plannedEndAt = new Date(p.plannedEndAt);
          if (p.deadlineAt) rec.deadlineAt = new Date(p.deadlineAt);
          planMap.set(String(p.taskTemplateId), rec);
        }
      } else if (taskPlans && typeof taskPlans === 'object') {
        for (const k of Object.keys(taskPlans)) {
          const v = (taskPlans as any)[k];
          if (!v) continue;
          const rec: any = {};
          if (v.plannedStartAt) rec.plannedStartAt = new Date(v.plannedStartAt);
          if (v.plannedEndAt) rec.plannedEndAt = new Date(v.plannedEndAt);
          if (v.deadlineAt) rec.deadlineAt = new Date(v.deadlineAt);
          planMap.set(String(k), rec);
        }
      }

      const taskCreates = (tmpl.tasks || []).map((t: any) => {
        const preds = parsePreds(t.predecessorIds);
        const initialStatus = preds.length === 0 ? 'READY' : 'NOT_STARTED';
        let assigneeId: string | undefined = undefined;
        if (t.assigneeType === 'USER' && t.assigneeUserId) {
          assigneeId = String(t.assigneeUserId);
        } else if (t.assigneeType === 'ORG_UNIT' && t.assigneeOrgUnitId) {
          // assign to org unit manager
          assigneeId = undefined;
        } else if (t.assigneeType === 'ROLE' && t.assigneeRoleCode) {
          // basic ROLE mapping: TEAM_LEAD or MANAGER -> starter's org manager
          const code = String(t.assigneeRoleCode).toUpperCase();
          if ((code.includes('TEAM') && code.includes('LEAD')) || code === 'MANAGER' || code === 'TEAM_LEAD') {
            // resolve later if we have starter org
            assigneeId = undefined;
          }
        }
        // override by provided mapping
        assigneeId = assignMap.get(String(t.id)) || assigneeId;
        const plan = planMap.get(String(t.id)) || {};
        return {
          instanceId: inst.id,
          taskTemplateId: t.id,
          name: t.name,
          stageLabel: t.stageLabel || null,
          taskType: t.taskType,
          status: initialStatus,
          assigneeId,
          initiativeId: initiativeId || undefined,
          plannedStartAt: plan.plannedStartAt,
          plannedEndAt: plan.plannedEndAt,
          deadlineAt: plan.deadlineAt,
        } as any;
      });

      if (taskCreates.length) {
        // fill ORG_UNIT manager and ROLE=TEAM_LEAD/MANAGER with starter's org manager
        let starterManagerId: string | undefined = undefined;
        if (starter?.orgUnitId) {
          const unit = await tx.orgUnit.findUnique({ where: { id: starter.orgUnitId } });
          starterManagerId = unit?.managerId || undefined;
        }
        // prefetch org managers referenced by tasks
        const orgUnitIds: string[] = Array.from(
          new Set(
            (tmpl.tasks || [])
              .map((t: any) => (t.assigneeType === 'ORG_UNIT' ? String(t.assigneeOrgUnitId || '') : ''))
              .filter((s: string) => !!s)
          )
        ) as string[];
        const orgUnits = orgUnitIds.length ? await tx.orgUnit.findMany({ where: { id: { in: orgUnitIds } } }) : [];
        const orgMgrMap = new Map<string, string | undefined>();
        for (const ou of orgUnits) orgMgrMap.set(ou.id, ou.managerId || undefined);
        // prepare final records
        const finalCreates = (tmpl.tasks || []).map((t: any, idx: number) => {
          const base = taskCreates[idx];
          let assigneeId = base.assigneeId as string | undefined;
          if (!assigneeId && t.assigneeType === 'ORG_UNIT' && t.assigneeOrgUnitId) {
            // lookup manager of specified org unit
            assigneeId = orgMgrMap.get(String(t.assigneeOrgUnitId)) || undefined;
          }
          if (!assigneeId && t.assigneeType === 'ROLE' && t.assigneeRoleCode) {
            const code = String(t.assigneeRoleCode).toUpperCase();
            if ((code.includes('TEAM') && code.includes('LEAD')) || code === 'MANAGER' || code === 'TEAM_LEAD') {
              assigneeId = starterManagerId;
            }
          }
          return { ...base, assigneeId };
        });
        await tx.processTaskInstance.createMany({ data: finalCreates });
      }

      // Auto-select XOR branch if initial READY tasks are XOR siblings
      await this.autoSelectXorAtInit(tx, inst.id);

      const full = await tx.processInstance.findUnique({
        where: { id: inst.id },
        include: {
          template: true,
          startedBy: true,
          initiative: true,
          tasks: { orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }] },
        },
      });
      return full;
    });
  }

  private async isExecOrCeo(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    const role = String(u?.role || '').toUpperCase();
    return role === 'CEO' || role === 'EXEC';
  }

  private async isApproverForInstance(tx: any, instanceId: string, userId: string): Promise<boolean> {
    // Check approval tasks assigned directly
    const tasks = await tx.processTaskInstance.findMany({
      where: { instanceId, taskType: 'APPROVAL' },
      select: { assigneeId: true, approvalRequestId: true },
    });
    if (tasks.some((t: any) => t.assigneeId && t.assigneeId === userId)) return true;
    const reqIds = tasks.map((t: any) => t.approvalRequestId).filter(Boolean) as string[];
    if (reqIds.length) {
      const reqs = await tx.approvalRequest.findMany({ where: { id: { in: reqIds } }, select: { approverId: true } });
      if (reqs.some((r: any) => r.approverId === userId)) return true;
    }
    return false;
  }

  @Post(':id/stop')
  async stop(@Param('id') id: string, @Body() body: any) {
    const { actorId, stopType, reason } = body || {};
    if (!actorId || !stopType || !reason) throw new BadRequestException('actorId, stopType, reason required');
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.processInstance.findUnique({ where: { id } });
      if (!inst) throw new BadRequestException('instance not found');
      const isExec = await this.isExecOrCeo(actorId);
      const isStarter = inst.startedById === actorId;
      const approver = await this.isApproverForInstance(tx, id, actorId);
      if (!isExec && !isStarter && !approver) throw new ForbiddenException('not allowed to stop');
      const type = String(stopType).toUpperCase();
      if (type !== 'SUSPENDED' && type !== 'ABORTED') throw new BadRequestException('invalid stopType');
      await tx.processStopEvent.create({
        data: {
          processInstanceId: id,
          stoppedById: actorId,
          stopType: type,
          reason: String(reason),
        },
      });
      const data: any = { status: type, updatedAt: new Date() };
      if (type === 'ABORTED') data.endAt = new Date();
      return tx.processInstance.update({ where: { id }, data });
    });
  }

  @Post(':id/resume')
  async resume(@Param('id') id: string, @Body() body: any) {
    const { actorId, reason } = body || {};
    if (!actorId) throw new BadRequestException('actorId required');
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.processInstance.findUnique({ where: { id } });
      if (!inst) throw new BadRequestException('instance not found');
      if (String(inst.status).toUpperCase() !== 'SUSPENDED') throw new BadRequestException('not suspended');
      const isExec = await this.isExecOrCeo(actorId);
      const isStarter = inst.startedById === actorId;
      const approver = await this.isApproverForInstance(tx, id, actorId);
      if (!isExec && !isStarter && !approver) throw new ForbiddenException('not allowed to resume');
      // optional: event log via generic Event
      return tx.processInstance.update({ where: { id }, data: { status: 'ACTIVE', updatedAt: new Date() } });
    });
  }

  @Post(':id/modify')
  async modify(@Param('id') id: string, @Body() body: any) {
    const { actorId, reason, reassign, skipTaskIds, update } = body || {};
    if (!actorId || !reason) throw new BadRequestException('actorId and reason required');
    const isExec = await this.isExecOrCeo(actorId);
    if (!isExec) throw new ForbiddenException('not allowed');
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.processInstance.findUnique({ where: { id } });
      if (!inst) throw new BadRequestException('instance not found');

      const now = new Date();
      const skippedTemplateIds: string[] = [];
      const changes: any[] = [];

      if (Array.isArray(skipTaskIds) && skipTaskIds.length) {
        const tasks = await tx.processTaskInstance.findMany({ where: { id: { in: skipTaskIds }, instanceId: id } });
        const targetIds = tasks.filter((t: any) => String(t.status).toUpperCase() === 'NOT_STARTED').map((t: any) => t.id);
        if (targetIds.length) {
          await tx.processTaskInstance.updateMany({
            where: { id: { in: targetIds } },
            data: { status: 'SKIPPED', actualEndAt: now, decidedById: actorId, decisionReason: reason },
          });
          for (const t of tasks) {
            if (targetIds.includes(t.id)) skippedTemplateIds.push(t.taskTemplateId);
            if (targetIds.includes(t.id)) {
              changes.push({ type: 'skip', taskId: t.id, name: t.name, before: { status: 'NOT_STARTED' }, after: { status: 'SKIPPED' } });
            }
          }
        }
      }

      if (Array.isArray(reassign) && reassign.length) {
        for (const r of reassign) {
          const task = await tx.processTaskInstance.findFirst({ where: { id: String(r.taskId), instanceId: id } });
          if (!task) continue;
          if (String(task.status).toUpperCase() !== 'NOT_STARTED') continue;
          await tx.processTaskInstance.update({ where: { id: task.id }, data: { assigneeId: String(r.assigneeId) } });
          changes.push({ type: 'reassign', taskId: task.id, name: task.name, before: { assigneeId: task.assigneeId || null }, after: { assigneeId: String(r.assigneeId) } });
        }
      }

      if (Array.isArray(update) && update.length) {
        for (const u of update) {
          const task = await tx.processTaskInstance.findFirst({ where: { id: String(u.taskId), instanceId: id } });
          if (!task) continue;
          if (String(task.status).toUpperCase() !== 'NOT_STARTED') continue;
          const data: any = {};
          if (u.stageLabel !== undefined) data.stageLabel = u.stageLabel || null;
          if (u.deadlineAt !== undefined) data.deadlineAt = u.deadlineAt ? new Date(u.deadlineAt) : null;
          if (u.plannedStartAt !== undefined) data.plannedStartAt = u.plannedStartAt ? new Date(u.plannedStartAt) : null;
          if (u.plannedEndAt !== undefined) data.plannedEndAt = u.plannedEndAt ? new Date(u.plannedEndAt) : null;
          if (Object.keys(data).length) {
            await tx.processTaskInstance.update({ where: { id: task.id }, data });
            const before: any = {
              stageLabel: task.stageLabel || null,
              deadlineAt: task.deadlineAt ? task.deadlineAt.toISOString() : null,
              plannedStartAt: task.plannedStartAt ? task.plannedStartAt.toISOString() : null,
              plannedEndAt: task.plannedEndAt ? task.plannedEndAt.toISOString() : null,
            };
            const after: any = {
              stageLabel: data.stageLabel ?? before.stageLabel,
              deadlineAt: data.deadlineAt ? (data.deadlineAt as Date).toISOString() : (data.deadlineAt === null ? null : before.deadlineAt),
              plannedStartAt: data.plannedStartAt ? (data.plannedStartAt as Date).toISOString() : (data.plannedStartAt === null ? null : before.plannedStartAt),
              plannedEndAt: data.plannedEndAt ? (data.plannedEndAt as Date).toISOString() : (data.plannedEndAt === null ? null : before.plannedEndAt),
            };
            changes.push({ type: 'update', taskId: task.id, name: task.name, before, after });
          }
        }
      }

      if (skippedTemplateIds.length) {
        const uniq = Array.from(new Set(skippedTemplateIds));
        for (const tid of uniq) {
          await this.unlockReadyDownstreams(tx, id, tid);
        }
      }

      await tx.processInstance.update({
        where: { id },
        data: { version: { increment: 1 }, modifiedById: actorId, modifiedAt: now, modificationReason: String(reason) },
      });

      // audit event
      await tx.event.create({
        data: {
          subjectType: 'ProcessInstance',
          subjectId: id,
          activity: 'PROCESS_MODIFY',
          userId: actorId,
          attrs: { reason: String(reason), changes },
        },
      });

      return tx.processInstance.findUnique({
        where: { id },
        include: {
          template: true,
          startedBy: true,
          initiative: true,
          tasks: { orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }] },
        },
      });
    });
  }

  @Get(':id/modifications')
  async listModifications(@Param('id') id: string) {
    const rows = await this.prisma.event.findMany({
      where: { subjectType: 'ProcessInstance', subjectId: id, activity: 'PROCESS_MODIFY' },
      orderBy: { ts: 'desc' },
    });
    return rows.map((e: any) => ({ ts: e.ts, userId: e.userId, reason: (e.attrs as any)?.reason, changes: (e.attrs as any)?.changes || [] }));
  }

  private async allPredecessorsCompleted(tx: any, instanceId: string, taskTemplateId: string): Promise<boolean> {
    const tmpl = await tx.processTaskTemplate.findUnique({ where: { id: taskTemplateId } });
    if (!tmpl) return true;
    const preds = parsePreds(tmpl.predecessorIds);
    if (preds.length === 0) return true;
    const predInstances = await tx.processTaskInstance.findMany({
      where: { instanceId, taskTemplateId: { in: preds } },
      select: { id: true, status: true },
    });
    if (String(tmpl.predecessorMode || '').toUpperCase() === 'ANY') {
      return predInstances.some((pi: any) => String(pi.status).toUpperCase() === 'COMPLETED');
    }
    if (predInstances.length < preds.length) return false;
    return predInstances.every((pi: any) => {
      const s = String(pi.status).toUpperCase();
      return s === 'COMPLETED' || s === 'SKIPPED';
    });
  }

  private async unlockReadyDownstreams(tx: any, instanceId: string, justCompletedTemplateId: string): Promise<void> {
    // find downstream templates whose predecessorIds include justCompletedTemplateId
    const allTemplates = await tx.processTaskTemplate.findMany({ where: { processTemplate: { instances: { some: { id: instanceId } } } } });
    const candidates = allTemplates.filter((t: any) => parsePreds(t.predecessorIds).includes(justCompletedTemplateId));
    if (!candidates.length) return;

    const okTemplates: any[] = [];
    for (const dt of candidates) {
      const ok = await this.allPredecessorsCompleted(tx, instanceId, dt.id);
      if (ok) okTemplates.push(dt);
    }
    if (!okTemplates.length) return;

    // partition by xor group
    const byGroup = new Map<string, any[]>();
    const noGroup: any[] = [];
    for (const dt of okTemplates) {
      const g = String(dt.xorGroupKey || '');
      if (!g) noGroup.push(dt);
      else {
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(dt);
      }
    }

    // non-XOR tasks: mark READY
    for (const dt of noGroup) {
      await tx.processTaskInstance.updateMany({ where: { instanceId, taskTemplateId: dt.id, status: { in: ['NOT_STARTED', 'ON_HOLD'] } }, data: { status: 'READY' } });
    }

    // XOR groups: evaluate conditions
    if (byGroup.size) {
      const inst = await tx.processInstance.findUnique({ where: { id: instanceId }, include: { startedBy: true } });
      const ctx = {
        itemCode: inst?.itemCode || null,
        moldCode: inst?.moldCode || null,
        carModelCode: inst?.carModelCode || null,
        initiativeId: inst?.initiativeId || null,
        startedBy: { id: inst?.startedById || '', role: inst?.startedBy?.role || '' },
      };
      for (const [g, list] of byGroup.entries()) {
        let selected: any | null = null;
        for (const t of list) {
          const cond = String(t.xorCondition || '').trim();
          if (cond && this.evalCondition(cond, ctx)) { selected = t; break; }
        }
        if (selected) {
          // mark selected READY; skip siblings
          await tx.processTaskInstance.updateMany({
            where: { instanceId, taskTemplateId: selected.id, status: { in: ['NOT_STARTED', 'ON_HOLD'] } },
            data: { status: 'READY' },
          });
          const siblingIds = list.map((x: any) => x.id).filter((id: string) => id !== selected.id);
          if (siblingIds.length) {
            await tx.processTaskInstance.updateMany({
              where: { instanceId, taskTemplateId: { in: siblingIds }, status: { in: ['NOT_STARTED', 'READY'] } },
              data: { status: 'SKIPPED', actualEndAt: new Date() },
            });
          }
        } else {
          // no condition matched: make all group tasks READY (user will choose), if not already skipped
          await tx.processTaskInstance.updateMany({
            where: { instanceId, taskTemplateId: { in: list.map((x: any) => x.id) }, status: { in: ['NOT_STARTED', 'ON_HOLD'] } },
            data: { status: 'READY' },
          });
        }
      }
    }
  }

  private async autoSelectXorAtInit(tx: any, instanceId: string): Promise<void> {
    const inst = await tx.processInstance.findUnique({ where: { id: instanceId }, include: { startedBy: true, template: true } });
    if (!inst) return;
    const templates = await tx.processTaskTemplate.findMany({ where: { processTemplateId: inst.templateId, xorGroupKey: { not: null } } });
    if (!templates.length) return;
    const ctx = {
      itemCode: inst.itemCode || null,
      moldCode: inst.moldCode || null,
      carModelCode: inst.carModelCode || null,
      initiativeId: inst.initiativeId || null,
      startedBy: { id: inst.startedById || '', role: inst.startedBy?.role || '' },
    };
    // group by xorGroupKey
    const groups = new Map<string, any[]>();
    for (const t of templates) {
      const g = String(t.xorGroupKey || '');
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(t);
    }
    for (const [g, list] of groups.entries()) {
      // only auto-select when all tasks in the group are READY (i.e., initial fan-out)
      const instTasks = await tx.processTaskInstance.findMany({ where: { instanceId, taskTemplateId: { in: list.map((x: any) => x.id) } } });
      if (!instTasks.length) continue;
      if (!instTasks.every((it: any) => it.status === 'READY')) continue;
      let selected: any | null = null;
      for (const t of list) {
        const cond = String(t.xorCondition || '').trim();
        if (cond && this.evalCondition(cond, ctx)) { selected = t; break; }
      }
      if (selected) {
        await tx.processTaskInstance.updateMany({ where: { instanceId, taskTemplateId: selected.id, status: 'READY' }, data: { status: 'READY' } });
        const siblingIds = list.map((x: any) => x.id).filter((id: string) => id !== selected.id);
        if (siblingIds.length) {
          await tx.processTaskInstance.updateMany({ where: { instanceId, taskTemplateId: { in: siblingIds }, status: { in: ['NOT_STARTED', 'READY'] } }, data: { status: 'SKIPPED', actualEndAt: new Date() } });
        }
      }
    }
  }

  @Post(':id/tasks/:taskId/start')
  async startTask(@Param('id') id: string, @Param('taskId') taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.processInstance.findUnique({ where: { id } });
      if (!inst) throw new Error('instance not found');
      const task = await tx.processTaskInstance.findUnique({ where: { id: taskId } });
      if (!task || task.instanceId !== id) throw new Error('task not found');
      const ok = await this.allPredecessorsCompleted(tx, id, task.taskTemplateId);
      if (!ok) throw new Error('predecessors not completed');
      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS', actualStartAt: new Date() },
      });
      // XOR runtime selection: if this task belongs to an XOR group, skip sibling branch tasks
      const tmpl = await tx.processTaskTemplate.findUnique({ where: { id: task.taskTemplateId } });
      const groupKey = tmpl?.xorGroupKey || null;
      if (groupKey) {
        const groupTemplates = await tx.processTaskTemplate.findMany({
          where: { processTemplate: { instances: { some: { id } } }, xorGroupKey: groupKey },
          select: { id: true },
        });
        const groupTemplateIds = groupTemplates.map((g: any) => g.id).filter((tid: string) => tid !== task.taskTemplateId);
        if (groupTemplateIds.length) {
          const others = await tx.processTaskInstance.findMany({
            where: { instanceId: id, taskTemplateId: { in: groupTemplateIds }, status: { in: ['NOT_STARTED', 'READY'] } },
            select: { id: true },
          });
          if (others.length) {
            await tx.processTaskInstance.updateMany({
              where: { id: { in: others.map((o: any) => o.id) } },
              data: { status: 'SKIPPED', actualEndAt: new Date() },
            });
          }
        }
      }
      return updated;
    });
  }

  @Post(':id/tasks/:taskId/complete')
  async completeTask(@Param('id') id: string, @Param('taskId') taskId: string, @Body() body: any) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.processTaskInstance.findUnique({ where: { id: taskId } });
      if (!task || task.instanceId !== id) throw new Error('task not found');
      const linkData: any = {};
      if (body && typeof body === 'object') {
        if (body.worklogId) linkData.worklogId = String(body.worklogId);
        if (body.cooperationId) linkData.cooperationId = String(body.cooperationId);
        if (body.approvalRequestId) linkData.approvalRequestId = String(body.approvalRequestId);
      }
      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: { status: 'COMPLETED', actualEndAt: new Date(), ...linkData },
      });
      await this.unlockReadyDownstreams(tx, id, task.taskTemplateId);
      // Optionally, set instance completed if all tasks are done or skipped
      const remain = await tx.processTaskInstance.count({ where: { instanceId: id, status: { notIn: ['COMPLETED', 'SKIPPED'] } } });
      if (remain === 0) {
        await tx.processInstance.update({ where: { id }, data: { status: 'COMPLETED', endAt: new Date() } });
      }
      return updated;
    });
  }
}
