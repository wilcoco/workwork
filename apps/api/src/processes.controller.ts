import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
    return this.prisma.processInstance.findMany({
      where,
      orderBy: { startAt: 'desc' },
      include: {
        template: { select: { id: true, title: true } },
        tasks: {
          orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, stageLabel: true, taskType: true, status: true },
        },
      },
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
        return {
          instanceId: inst.id,
          taskTemplateId: t.id,
          name: t.name,
          stageLabel: t.stageLabel || null,
          taskType: t.taskType,
          status: initialStatus,
          assigneeId,
          initiativeId: initiativeId || undefined,
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

      const full = await tx.processInstance.findUnique({
        where: { id: inst.id },
        include: {
          template: true,
          tasks: { orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }] },
        },
      });
      return full;
    });
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
    if (predInstances.length < preds.length) return false; // some predecessor instances may not exist (data issue)
    return predInstances.every((pi: any) => String(pi.status).toUpperCase() === 'COMPLETED');
  }

  private async unlockReadyDownstreams(tx: any, instanceId: string, justCompletedTemplateId: string): Promise<void> {
    // find downstream templates whose predecessorIds include justCompletedTemplateId
    const allTemplates = await tx.processTaskTemplate.findMany({ where: { processTemplate: { instances: { some: { id: instanceId } } } } });
    const downstreams = allTemplates.filter((t: any) => parsePreds(t.predecessorIds).includes(justCompletedTemplateId));
    if (!downstreams.length) return;
    for (const dt of downstreams) {
      const ok = await this.allPredecessorsCompleted(tx, instanceId, dt.id);
      if (!ok) continue;
      await tx.processTaskInstance.updateMany({
        where: { instanceId, taskTemplateId: dt.id, status: { in: ['NOT_STARTED', 'ON_HOLD'] } },
        data: { status: 'READY' },
      });
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
      // Optionally, set instance completed if all tasks completed
      const remain = await tx.processTaskInstance.count({ where: { instanceId: id, status: { not: 'COMPLETED' } } });
      if (remain === 0) {
        await tx.processInstance.update({ where: { id }, data: { status: 'COMPLETED', endAt: new Date() } });
      }
      return updated;
    });
  }
}
