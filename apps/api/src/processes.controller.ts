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
          select: {
            id: true,
            name: true,
            stageLabel: true,
            taskType: true,
            status: true,
            assigneeId: true,
            plannedStartAt: true,
            plannedEndAt: true,
            actualStartAt: true,
            actualEndAt: true,
            deadlineAt: true,
          },
        },
      },
    });
    const now = new Date();
    const result = await Promise.all(
      rows.map(async (r: any) => {
        const delayed = r.status === 'ACTIVE' && r.expectedEndAt && new Date(r.expectedEndAt).getTime() < now.getTime();
        const ids: string[] = Array.from(
          new Set(
            (r.tasks || [])
              .map((t: any) => t.assigneeId as string | undefined)
              .filter((x: string | undefined): x is string => !!x)
          )
        ) as string[];
        const users: any[] = ids.length
          ? await (this.prisma as any).user.findMany({ where: { id: { in: ids as any } }, include: { orgUnit: true } })
          : [];
        const aggMap = new Map<string, { total: number; completed: number; inProgress: number; ready: number; notStarted: number; skipped: number; overdue: number }>();
        for (const id of ids) aggMap.set(id, { total: 0, completed: 0, inProgress: 0, ready: 0, notStarted: 0, skipped: 0, overdue: 0 });
        for (const t of r.tasks || []) {
          const uid = t.assigneeId as string | undefined;
          if (!uid) continue;
          const m = aggMap.get(uid)!;
          m.total += 1;
          const s = String(t.status).toUpperCase();
          if (s === 'COMPLETED') m.completed += 1;
          else if (s === 'IN_PROGRESS') m.inProgress += 1;
          else if (s === 'READY') m.ready += 1;
          else if (s === 'NOT_STARTED' || s === 'CHAIN_WAIT') m.notStarted += 1;
          else if (s === 'SKIPPED') m.skipped += 1;
          if (t.plannedEndAt && s !== 'COMPLETED' && s !== 'SKIPPED') {
            if (new Date(t.plannedEndAt).getTime() < now.getTime()) m.overdue += 1;
          }
        }
        const assignees = (users as any[])
          .map((u) => ({ id: u.id, name: u.name, orgUnitId: u.orgUnitId || u.orgUnit?.id || '', orgName: u.orgUnit?.name || '', counts: aggMap.get(u.id)! }));
        const userMap = new Map<string, any>();
        for (const u of users as any[]) userMap.set(u.id, u);
        const tasks = (r.tasks || []).map((t: any) => {
          const u = t.assigneeId ? userMap.get(t.assigneeId) : null;
          const assignee = u ? { id: u.id, name: u.name, orgName: u.orgUnit?.name || '' } : null;
          return {
            id: t.id,
            name: t.name,
            stageLabel: t.stageLabel,
            taskType: t.taskType,
            status: t.status,
            assigneeId: t.assigneeId,
            plannedStartAt: t.plannedStartAt,
            plannedEndAt: t.plannedEndAt,
            actualStartAt: t.actualStartAt,
            actualEndAt: t.actualEndAt,
            deadlineAt: t.deadlineAt,
            assignee,
          };
        });
        return {
          id: r.id,
          title: r.title,
          status: r.status,
          startAt: r.startAt,
          expectedEndAt: r.expectedEndAt,
          endAt: r.endAt,
          template: r.template,
          startedBy: r.startedBy,
          initiative: r.initiative,
          delayed,
          tasks,
          assignees,
        };
      })
    );
    return result;
  }

  @Get('my')
  async myProcesses(@Query('userId') userId?: string) {
    if (!userId) return [];
    const taskInstances = await this.prisma.processTaskInstance.findMany({
      where: { assigneeId: userId },
      select: { instanceId: true },
    });
    const startedInstances = await this.prisma.processInstance.findMany({
      where: { startedById: userId },
      select: { id: true },
    });
    const instanceIds = Array.from(new Set([
      ...taskInstances.map((t: any) => t.instanceId),
      ...startedInstances.map((i: any) => i.id),
    ]));
    if (!instanceIds.length) return [];
    const rows = await this.prisma.processInstance.findMany({
      where: { id: { in: instanceIds } },
      orderBy: { startAt: 'desc' },
      include: {
        template: { select: { id: true, title: true } },
        startedBy: { select: { id: true, name: true } },
        tasks: { select: { id: true, status: true, assigneeId: true } },
      },
    });
    return rows.map((r: any) => {
      const myTasks = (r.tasks || []).filter((t: any) => t.assigneeId === userId);
      const total = myTasks.length;
      const completed = myTasks.filter((t: any) => t.status === 'COMPLETED').length;
      const inProgress = myTasks.filter((t: any) => t.status === 'IN_PROGRESS' || t.status === 'READY').length;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        startAt: r.startAt,
        endAt: r.endAt,
        template: r.template,
        startedBy: r.startedBy,
        myTaskSummary: { total, completed, inProgress },
      };
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

  private async autoCreateApprovalIfNeeded(tx: any, instanceId: string, tmpl: any): Promise<void> {
    if (String(tmpl?.taskType || '').toUpperCase() !== 'APPROVAL') return;
    const ready = await tx.processTaskInstance.findMany({ where: { instanceId, taskTemplateId: tmpl.id, status: 'READY' } });
    for (const t of ready) {
      await this.autoCreateApprovalForTaskInstance(tx, instanceId, t.id);
    }
  }

  private async autoCreateApprovalForTaskInstance(tx: any, instanceId: string, taskInstanceId: string): Promise<string | null> {
    const t = await tx.processTaskInstance.findUnique({ where: { id: taskInstanceId } });
    if (!t || t.instanceId !== instanceId) return null;
    if (t.approvalRequestId) return t.approvalRequestId; // already linked
    const inst = await tx.processInstance.findUnique({ where: { id: instanceId }, include: { startedBy: true } });
    if (!inst) return null;
    const approverId = t.assigneeId || undefined;
    const requesterId = inst.startedById;
    if (!approverId || !requesterId) return null;
    const req = await tx.approvalRequest.create({ data: { subjectType: 'PROCESS', subjectId: instanceId, approverId, requestedById: requesterId } });
    await tx.notification.create({ data: { userId: approverId, type: 'ApprovalRequested', subjectType: 'PROCESS', subjectId: instanceId, payload: { requestId: req.id } } });
    await tx.processTaskInstance.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS', actualStartAt: new Date(), approvalRequestId: req.id } });
    return req.id as string;
  }

  private async buildApprovalHtml(tx: any, instanceId: string): Promise<string> {
    const inst = await (tx as any).processInstance.findUnique({ where: { id: instanceId }, include: { startedBy: true, template: true } });
    const tasks = await (tx as any).processTaskInstance.findMany({ where: { instanceId }, orderBy: [{ stageLabel: 'asc' as any }, { createdAt: 'asc' as any }] });
    const completed = tasks.filter((x: any) => String(x.status).toUpperCase() === 'COMPLETED');
    const wlIds = completed.map((x: any) => x.worklogId).filter(Boolean) as string[];
    const wls = wlIds.length ? await (tx as any).worklog.findMany({ where: { id: { in: wlIds } } }) : [];
    const wlMap = new Map<string, any>();
    for (const w of wls) wlMap.set(w.id, w);
    const safe = (s: any) => (s == null ? '' : String(s));
    const row = (cols: string[]) => `<tr>${cols.map((c) => `<td style="padding:4px 6px;border:1px solid #e5e7eb;vertical-align:top;">${c}</td>`).join('')}</tr>`;
    const head = (cols: string[]) => `<tr>${cols.map((c) => `<th style=\"padding:6px;border:1px solid #e5e7eb;background:#f9fafb;text-align:left;\">${c}</th>`).join('')}</tr>`;
    const rows = completed.map((t: any, idx: number) => {
      const wl = t.worklogId ? wlMap.get(t.worklogId) : null;
      const when = t.actualEndAt ? new Date(t.actualEndAt).toLocaleString() : '';
      const html = (wl?.attachments as any)?.contentHtml || '';
      return row([String(idx + 1), `${safe(t.name)}${t.stageLabel ? ` · ${safe(t.stageLabel)}` : ''}`, safe(t.taskType), when, html ? `<div style=\"font-size:12px;color:#334155;\">${html}</div>` : '-']);
    });
    const header = `<div style=\"font-weight:700;font-size:16px;margin:6px 0;\">${safe(inst?.title)}</div>`;
    const table = `<table style=\"border-collapse:collapse;width:100%;margin-top:8px;\">${head(['#','단계/과제','유형','완료시각','관련 업무일지 요약'])}${rows.join('')}</table>`;
    const meta = `<div style=\"margin:6px 0;color:#64748b;font-size:12px;\">시작: ${inst?.startAt ? new Date(inst.startAt).toLocaleString() : ''} · 시작자: ${safe(inst?.startedBy?.name)}</div>`;
    return `${header}${meta}${table}`;
  }

  @Get(':id/approval-summary')
  async approvalSummary(@Param('id') id: string) {
    const html = await this.buildApprovalHtml(this.prisma as any, id);
    return { html } as any;
  }

  private async ensureInitiativeForUserProcess(tx: any, userId: string, inst: any, taskName: string): Promise<string> {
    if (inst?.initiativeId) return inst.initiativeId as string;
    const user = await (tx as any).user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('user not found');
    let orgUnitId = user.orgUnitId as string | undefined;
    if (!orgUnitId) {
      const team = await (tx as any).orgUnit.create({ data: { name: `Auto Team - ${user.name}`, type: 'TEAM' } });
      await (tx as any).user.update({ where: { id: user.id }, data: { orgUnitId: team.id } });
      orgUnitId = team.id;
    }
    let objective = await (tx as any).objective.findFirst({ where: { title: 'Process Auto Objective', orgUnitId } });
    if (!objective) {
      const now = new Date();
      const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      objective = await (tx as any).objective.create({ data: { title: 'Process Auto Objective', orgUnitId, ownerId: user.id, periodStart: now, periodEnd: end, status: 'ACTIVE' as any } });
    }
    let kr = await (tx as any).keyResult.findFirst({ where: { title: 'Process Auto KR', objectiveId: objective.id } });
    if (!kr) {
      kr = await (tx as any).keyResult.create({ data: { title: 'Process Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: user.id, objectiveId: objective.id } });
    }
    const title = `${inst.title} · ${taskName}`;
    let initiative = await (tx as any).initiative.findFirst({ where: { title, keyResultId: kr.id, ownerId: user.id } });
    if (!initiative) {
      initiative = await (tx as any).initiative.create({ data: { title, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
    }
    return initiative.id as string;
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

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return (this.prisma as any).processInstance.findUnique({
      where: { id },
      include: {
        template: { include: { tasks: { orderBy: { orderHint: 'asc' } } } },
        startedBy: true,
        initiative: true,
        tasks: {
          orderBy: [{ stageLabel: 'asc' }, { createdAt: 'asc' }],
          include: {
            assignee: { select: { id: true, name: true } },
            worklogs: {
              select: { id: true, note: true, createdAt: true, createdById: true, createdBy: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
  }

  @Get(':id/timeline')
  async timeline(@Param('id') id: string) {
    const tasks = await (this.prisma as any).processTaskInstance.findMany({
      where: { instanceId: id },
      orderBy: [{ stageLabel: 'asc' as any }, { createdAt: 'asc' as any }],
      select: {
        id: true,
        name: true,
        stageLabel: true,
        taskType: true,
        status: true,
        actualStartAt: true,
        actualEndAt: true,
        worklogId: true,
        cooperationId: true,
        approvalRequestId: true,
        assigneeId: true,
      },
    });
    const worklogIds = Array.from(new Set(tasks.map((t: any) => t.worklogId).filter(Boolean)));
    const coopIds = Array.from(new Set(tasks.map((t: any) => t.cooperationId).filter(Boolean)));
    const apprIds = Array.from(new Set(tasks.map((t: any) => t.approvalRequestId).filter(Boolean)));

    const worklogs = worklogIds.length
      ? await (this.prisma as any).worklog.findMany({
          where: { id: { in: worklogIds } },
          include: { createdBy: { select: { id: true, name: true } } },
        })
      : [];
    const wlMap = new Map<string, any>();
    for (const w of worklogs) wlMap.set(w.id, w);

    const coops = coopIds.length
      ? await (this.prisma as any).helpTicket.findMany({
          where: { id: { in: coopIds } },
          include: { assignee: { select: { id: true, name: true } } },
        })
      : [];
    const coopMap = new Map<string, any>();
    for (const c of coops) coopMap.set(c.id, c);

    // For cooperation, also pull linked worklogs if present
    const coopWlIds = Array.from(
      new Set(coops.map((c: any) => c.worklogId).filter(Boolean))
    );
    const coopWorklogs = coopWlIds.length
      ? await (this.prisma as any).worklog.findMany({ where: { id: { in: coopWlIds } }, include: { createdBy: { select: { id: true, name: true } } } })
      : [];
    const coopWlMap = new Map<string, any>();
    for (const w of coopWorklogs) coopWlMap.set(w.id, w);

    const approvals = apprIds.length
      ? await (this.prisma as any).approvalRequest.findMany({
          where: { id: { in: apprIds } },
          include: {
            steps: { orderBy: { stepNo: 'asc' } },
            requestedBy: { select: { id: true, name: true } },
          },
        })
      : [];
    const apprMap = new Map<string, any>();
    for (const a of approvals) apprMap.set(a.id, a);

    const result = tasks.map((t: any) => {
      const wl = t.worklogId ? wlMap.get(t.worklogId) : null;
      const coop = t.cooperationId ? coopMap.get(t.cooperationId) : null;
      const coopWl = coop?.worklogId ? coopWlMap.get(coop.worklogId) : null;
      const appr = t.approvalRequestId ? apprMap.get(t.approvalRequestId) : null;
      return {
        id: t.id,
        name: t.name,
        stageLabel: t.stageLabel,
        taskType: t.taskType,
        status: t.status,
        actualStartAt: t.actualStartAt,
        actualEndAt: t.actualEndAt,
        worklog: wl
          ? {
              id: wl.id,
              title: wl.title || wl.note || '',
              createdAt: wl.createdAt,
              createdBy: wl.createdBy ? { id: wl.createdBy.id, name: wl.createdBy.name } : null,
              contentHtml: (wl.attachments as any)?.contentHtml || wl.contentHtml || null,
            }
          : null,
        cooperation: coop
          ? {
              id: coop.id,
              category: coop.category,
              status: coop.status,
              assignee: coop.assignee ? { id: coop.assignee.id, name: coop.assignee.name } : null,
              dueAt: coop.dueAt,
              worklog: coopWl
                ? {
                    id: coopWl.id,
                    title: coopWl.title || coopWl.note || '',
                    createdAt: coopWl.createdAt,
                    createdBy: coopWl.createdBy ? { id: coopWl.createdBy.id, name: coopWl.createdBy.name } : null,
                    contentHtml: (coopWl.attachments as any)?.contentHtml || coopWl.contentHtml || null,
                  }
                : null,
            }
          : null,
        approval: appr
          ? {
              id: appr.id,
              status: appr.status,
              requestedBy: appr.requestedBy ? { id: appr.requestedBy.id, name: appr.requestedBy.name } : null,
              dueAt: appr.dueAt,
              steps: (appr.steps || []).map((s: any) => ({
                stepNo: s.stepNo,
                approverId: s.approverId,
                status: s.status,
                actedAt: s.actedAt,
                comment: s.comment || null,
              })),
            }
          : null,
      };
    });

    return { tasks: result } as any;
  }

  @Post()
  async start(@Body() body: any) {
    try {
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

      if (!templateId) throw new BadRequestException('templateId is required');
      if (!title) throw new BadRequestException('title is required');
      if (!startedById) throw new BadRequestException('startedById is required');

      const tmpl = await this.prisma.processTemplate.findUnique({
        where: { id: templateId },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
      if (!tmpl) throw new BadRequestException('template not found');
      const starter = await this.prisma.user.findUnique({ where: { id: startedById } });
      if (!starter) throw new BadRequestException('startedBy user not found');
      // initiative is optional; if provided but not found, ignore silently
      let linkedInitiativeId: string | undefined = undefined;
      if (initiativeId) {
        const exists = await this.prisma.initiative.findUnique({ where: { id: initiativeId } });
        if (exists) linkedInitiativeId = initiativeId;
      }

      const now = new Date();
      const assignMap = new Map<string, string>(); // legacy single-assignee override
      const assignListMap = new Map<string, string[]>(); // multi-assignee chain override
      if (Array.isArray(taskAssignees)) {
        for (const a of taskAssignees) {
          if (a && a.taskTemplateId && a.assigneeId) {
            const key = String(a.taskTemplateId);
            const arr = assignListMap.get(key) || [];
            arr.push(String(a.assigneeId));
            assignListMap.set(key, arr);
            assignMap.set(key, String(a.assigneeId));
          }
        }
      } else if (taskAssignees && typeof taskAssignees === 'object') {
        for (const k of Object.keys(taskAssignees)) {
          const v = (taskAssignees as any)[k];
          if (Array.isArray(v)) {
            const arr = (v as any[]).map((x) => String(x)).filter(Boolean);
            if (arr.length) assignListMap.set(String(k), arr);
            if (arr.length) assignMap.set(String(k), arr[arr.length - 1]);
          } else if (v) {
            assignMap.set(String(k), String(v));
          }
        }
      }
      const expectedEndAt = tmpl.expectedDurationDays ? addDays(now, Number(tmpl.expectedDurationDays)) : null;

      return await this.prisma.$transaction(async (tx) => {
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
            initiativeId: linkedInitiativeId,
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

        const taskCreates: any[] = [];
        for (const t of (tmpl.tasks || [])) {
          const preds = parsePreds(t.predecessorIds);
          const initialStatus = preds.length === 0 ? 'READY' : 'NOT_STARTED';
          let baseAssigneeId: string | undefined = undefined;
          if (t.assigneeType === 'USER' && t.assigneeUserId) {
            baseAssigneeId = String(t.assigneeUserId);
          } else if (t.assigneeType === 'ORG_UNIT' && t.assigneeOrgUnitId) {
            baseAssigneeId = undefined;
          } else if (t.assigneeType === 'ROLE' && t.assigneeRoleCode) {
            const code = String(t.assigneeRoleCode).toUpperCase();
            if ((code.includes('TEAM') && code.includes('LEAD')) || code === 'MANAGER' || code === 'TEAM_LEAD') {
              baseAssigneeId = undefined;
            }
          }
          const overrideList = assignListMap.get(String(t.id));
          const defaultChain: string[] = String(t.approvalUserIds || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          const chain = (overrideList && overrideList.length ? overrideList : defaultChain).filter(Boolean);
          const plan = planMap.get(String(t.id)) || {};
          if (chain.length > 0) {
            chain.forEach((aid, idx) => {
              taskCreates.push({
                instanceId: inst.id,
                taskTemplateId: t.id,
                name: t.name,
                stageLabel: t.stageLabel || null,
                taskType: t.taskType,
                status: idx === 0 ? initialStatus : 'CHAIN_WAIT',
                assigneeId: String(aid),
                initiativeId: linkedInitiativeId,
                plannedStartAt: plan.plannedStartAt,
                plannedEndAt: plan.plannedEndAt,
                deadlineAt: plan.deadlineAt,
              } as any);
            });
          } else {
            // single assignee fallback
            const assigneeId = assignMap.get(String(t.id)) || baseAssigneeId;
            taskCreates.push({
              instanceId: inst.id,
              taskTemplateId: t.id,
              name: t.name,
              stageLabel: t.stageLabel || null,
              taskType: t.taskType,
              status: initialStatus,
              assigneeId,
              initiativeId: linkedInitiativeId,
              plannedStartAt: plan.plannedStartAt,
              plannedEndAt: plan.plannedEndAt,
              deadlineAt: plan.deadlineAt,
            } as any);
          }
        }

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
          const finalCreates: any[] = [];
          // remap through actual template list to resolve ROLE/ORG manager for entries missing assignee
          for (const rec of taskCreates) {
            let assigneeId = rec.assigneeId as string | undefined;
            const t = (tmpl.tasks || []).find((tt: any) => tt.id === rec.taskTemplateId);
            if (t) {
              if (!assigneeId && t.assigneeType === 'ORG_UNIT' && t.assigneeOrgUnitId) {
                assigneeId = orgMgrMap.get(String(t.assigneeOrgUnitId)) || undefined;
              }
              if (!assigneeId && t.assigneeType === 'ROLE' && t.assigneeRoleCode) {
                const code = String(t.assigneeRoleCode).toUpperCase();
                if ((code.includes('TEAM') && code.includes('LEAD')) || code === 'MANAGER' || code === 'TEAM_LEAD') {
                  assigneeId = starterManagerId;
                }
              }
            }
            finalCreates.push({ ...rec, assigneeId });
          }
          await tx.processTaskInstance.createMany({ data: finalCreates });
        }

        // Auto-select XOR branch if initial READY tasks are XOR siblings
        await this.autoSelectXorAtInit(tx, inst.id);

        const initialApprovals = await tx.processTaskInstance.findMany({
          where: { instanceId: inst.id, taskType: 'APPROVAL', status: 'READY' },
          select: { id: true },
        });
        for (const t of initialApprovals) {
          await this.autoCreateApprovalForTaskInstance(tx, inst.id, t.id);
        }

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
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('POST /processes start error', e);
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(e?.message || 'failed to start process');
    }
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
      await this.autoCreateApprovalIfNeeded(tx, instanceId, dt);
    }

    // XOR groups: evaluate conditions
    if (byGroup.size) {
      const inst = await tx.processInstance.findUnique({ where: { id: instanceId }, include: { startedBy: true } });
      const lastTask = await tx.processTaskInstance.findFirst({
        where: { instanceId, taskTemplateId: justCompletedTemplateId },
        orderBy: { actualEndAt: 'desc' },
        select: { approvalRequestId: true },
      });
      const lastApprovalReqId = lastTask?.approvalRequestId || null;
      const lastApproval = lastApprovalReqId
        ? await tx.approvalRequest.findUnique({ where: { id: lastApprovalReqId }, select: { id: true, status: true } })
        : null;
      const ctx = {
        itemCode: inst?.itemCode || null,
        moldCode: inst?.moldCode || null,
        carModelCode: inst?.carModelCode || null,
        initiativeId: inst?.initiativeId || null,
        startedBy: { id: inst?.startedById || '', role: inst?.startedBy?.role || '' },
        last: lastApproval ? { approval: { id: lastApproval.id, status: lastApproval.status } } : {},
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
          await this.autoCreateApprovalIfNeeded(tx, instanceId, selected);
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
          // attempt auto-create for any APPROVAL-type in this group as well
          for (const dt of list) {
            await this.autoCreateApprovalIfNeeded(tx, instanceId, dt);
          }
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
      // only auto-select when each template in the group has at least one READY instance (ignore CHAIN_WAIT)
      const templateIds = list.map((x: any) => x.id);
      const instTasks = await tx.processTaskInstance.findMany({ where: { instanceId, taskTemplateId: { in: templateIds } } });
      if (!instTasks.length) continue;
      const byTpl = new Map<string, any[]>();
      for (const it of instTasks) {
        const arr = byTpl.get(it.taskTemplateId) || [];
        arr.push(it);
        byTpl.set(it.taskTemplateId, arr);
      }
      const allHaveReady = templateIds.every((tid: string) => (byTpl.get(tid) || []).some((it: any) => String(it.status).toUpperCase() === 'READY'));
      if (!allHaveReady) continue;
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

  @Post(':id/tasks/:taskId/link-worklog')
  async linkWorklog(@Param('id') id: string, @Param('taskId') taskId: string, @Body() body: any) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.processTaskInstance.findUnique({ where: { id: taskId } });
      if (!task || task.instanceId !== id) throw new BadRequestException('task not found');
      const { worklogId } = body || {};
      if (!worklogId) throw new BadRequestException('worklogId required');
      // Link worklog to task without completing it
      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: { 
          status: task.status === 'READY' ? 'IN_PROGRESS' : task.status,
          actualStartAt: task.actualStartAt || new Date(),
        },
      });
      // Also link worklog to this task instance via a join or just store in worklog
      await tx.worklog.update({
        where: { id: worklogId },
        data: { processTaskInstanceId: taskId },
      });
      return updated;
    });
  }

  @Post(':id/tasks/:taskId/start')
  async startTask(@Param('id') id: string, @Param('taskId') taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.processInstance.findUnique({ where: { id } });
      if (!inst) throw new BadRequestException('instance not found');
      const task = await tx.processTaskInstance.findUnique({ where: { id: taskId } });
      if (!task || task.instanceId !== id) throw new BadRequestException('task not found');
      const st = String(task.status).toUpperCase();
      if (st !== 'READY') throw new BadRequestException('task is not READY');
      const ok = await this.allPredecessorsCompleted(tx, id, task.taskTemplateId);
      if (!ok) throw new BadRequestException('predecessors not completed');
      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS', actualStartAt: new Date() },
      });

      if (String(task.taskType).toUpperCase() === 'APPROVAL') {
        await this.autoCreateApprovalForTaskInstance(tx, id, taskId);
      }
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
      if (!task || task.instanceId !== id) throw new BadRequestException('task not found');
      const linkData: any = {};
      if (body && typeof body === 'object') {
        if (body.worklogId) linkData.worklogId = String(body.worklogId);
        if (body.cooperationId) linkData.cooperationId = String(body.cooperationId);
        if (body.approvalRequestId) linkData.approvalRequestId = String(body.approvalRequestId);
      }
      // If approvalRequestId not provided for an APPROVAL task, auto-create it now
      if (!linkData.approvalRequestId) {
        const tmpl = await tx.processTaskTemplate.findUnique({ where: { id: task.taskTemplateId } });
        if (String(tmpl?.taskType || '').toUpperCase() === 'APPROVAL') {
          const reqId = await this.autoCreateApprovalForTaskInstance(tx, id, task.id);
          if (reqId) linkData.approvalRequestId = reqId;
        }
      }
      const isApprovalTask = String(task.taskType).toUpperCase() === 'APPROVAL';
      if (isApprovalTask) {
        const appr = linkData.approvalRequestId
          ? await tx.approvalRequest.findUnique({ where: { id: String(linkData.approvalRequestId) }, select: { status: true } })
          : null;
        const st = String(appr?.status || '').toUpperCase();
        const alreadyFinal = st === 'APPROVED' || st === 'REJECTED' || st === 'EXPIRED';
        if (!alreadyFinal) {
          const updated = await tx.processTaskInstance.update({
            where: { id: taskId },
            data: { status: 'IN_PROGRESS', actualStartAt: task.actualStartAt || new Date(), actualEndAt: null, ...linkData },
          });
          return updated;
        }
      }

      const updated = await tx.processTaskInstance.update({
        where: { id: taskId },
        data: { status: 'COMPLETED', actualEndAt: new Date(), ...linkData },
      });
      // Promote next chain assignee for the same template if any
      const nextChain = await tx.processTaskInstance.findFirst({
        where: { instanceId: id, taskTemplateId: task.taskTemplateId, status: 'CHAIN_WAIT' },
        orderBy: { createdAt: 'asc' },
      });
      if (nextChain) {
        const nextTmpl = await tx.processTaskTemplate.findUnique({ where: { id: nextChain.taskTemplateId } });
        if (String(nextTmpl?.taskType || '').toUpperCase() === 'APPROVAL') {
          await this.autoCreateApprovalForTaskInstance(tx, id, nextChain.id);
        } else {
          await tx.processTaskInstance.update({ where: { id: nextChain.id }, data: { status: 'READY' } });
        }
      } else {
        await this.unlockReadyDownstreams(tx, id, task.taskTemplateId);
      }
      // Optionally, set instance completed if all tasks are done or skipped
      const remain = await tx.processTaskInstance.count({ where: { instanceId: id, status: { notIn: ['COMPLETED', 'SKIPPED'] } } });
      if (remain === 0) {
        await tx.processInstance.update({ where: { id }, data: { status: 'COMPLETED', endAt: new Date() } });
      }
      return updated;
    });
  }

  async finalizeTasksLinkedToApprovalRequest(tx: any, approvalRequestId: string, actorId: string, decisionReason?: string) {
    const tasks = await tx.processTaskInstance.findMany({ where: { approvalRequestId } });
    if (!tasks.length) return;

    const unlockKeys = new Set<string>();
    for (const t of tasks) {
      const st = String(t.status).toUpperCase();
      if (st === 'COMPLETED' || st === 'SKIPPED') continue;
      await tx.processTaskInstance.update({
        where: { id: t.id },
        data: { status: 'COMPLETED', actualEndAt: new Date(), decidedById: actorId, decisionReason: decisionReason || null },
      });
      const nextChain = await tx.processTaskInstance.findFirst({
        where: { instanceId: t.instanceId, taskTemplateId: t.taskTemplateId, status: 'CHAIN_WAIT' },
        orderBy: { createdAt: 'asc' },
      });
      if (nextChain) {
        const nextTmpl = await tx.processTaskTemplate.findUnique({ where: { id: nextChain.taskTemplateId } });
        if (String(nextTmpl?.taskType || '').toUpperCase() === 'APPROVAL') {
          await this.autoCreateApprovalForTaskInstance(tx, t.instanceId, nextChain.id);
        } else {
          await tx.processTaskInstance.update({ where: { id: nextChain.id }, data: { status: 'READY' } });
        }
      } else {
        unlockKeys.add(`${t.instanceId}::${t.taskTemplateId}`);
      }
      const remain = await tx.processTaskInstance.count({ where: { instanceId: t.instanceId, status: { notIn: ['COMPLETED', 'SKIPPED'] } } });
      if (remain === 0) {
        await tx.processInstance.update({ where: { id: t.instanceId }, data: { status: 'COMPLETED', endAt: new Date() } });
      }
    }

    for (const key of unlockKeys) {
      const [instanceId, templateId] = key.split('::');
      if (!instanceId || !templateId) continue;
      await this.unlockReadyDownstreams(tx, instanceId, templateId);
    }
  }
}
