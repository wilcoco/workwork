import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

class ReportDto {
  @IsString()
  @IsNotEmpty()
  approverId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ShareDto {
  @IsArray()
  watcherIds!: string[];

  @IsOptional()
  @IsString()
  scope?: 'READ' | 'COMMENT';
}

class HelpItemDto {
  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsOptional()
  @IsString()
  queue?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaMinutes?: number;
}

class DelegateItemDto {
  @IsString()
  @IsNotEmpty()
  parentType!: string;

  @IsString()
  @IsNotEmpty()
  parentId!: string;

  @IsString()
  @IsNotEmpty()
  childInitiativeId!: string;

  @IsString()
  @IsNotEmpty()
  delegateeId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class CreateWorklogDto {
  @IsOptional()
  @IsString()
  initiativeId?: string;

  @IsString()
  @IsNotEmpty()
  createdById!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  timeSpentMinutes?: number;

  @IsOptional()
  @IsString()
  blockerCode?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  attachments?: any;

  @IsOptional()
  report?: ReportDto;

  @IsOptional()
  share?: ShareDto;

  @IsOptional()
  help?: HelpItemDto[];

  @IsOptional()
  delegate?: DelegateItemDto[];

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @IsOptional()
  @IsEnum({ ALL: 'ALL', MANAGER_PLUS: 'MANAGER_PLUS', EXEC_PLUS: 'EXEC_PLUS', CEO_ONLY: 'CEO_ONLY' } as any)
  visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';

  @IsOptional()
  @IsString()
  processInstanceId?: string;

  @IsOptional()
  @IsString()
  taskInstanceId?: string;
}

class CreateSimpleWorklogDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() teamName!: string;
  @IsOptional() @IsString() taskName?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() content!: string;
  @IsOptional() @IsInt() @Min(0) timeSpentMinutes?: number;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsBoolean() urgent?: boolean;
  @IsOptional() @IsString() contentHtml?: string;
  @IsOptional() attachments?: any;
  @IsOptional() tags?: any;
  @IsOptional() @IsString() initiativeId?: string;
  @IsOptional() @IsString() userGoalId?: string;
  @IsOptional() @IsString() keyResultId?: string;
  @IsOptional() @IsEnum({ ALL: 'ALL', MANAGER_PLUS: 'MANAGER_PLUS', EXEC_PLUS: 'EXEC_PLUS', CEO_ONLY: 'CEO_ONLY' } as any)
  visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';
}

@Controller('worklogs')
export class WorklogsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateWorklogDto) {
    // Determine initiative: use provided, or (if process context provided) auto-create under user's OKR scaffold
    let initiativeIdFinal = dto.initiativeId;
    if (!initiativeIdFinal && dto.processInstanceId && dto.taskInstanceId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
      if (!user) throw new BadRequestException('createdBy user not found');
      const inst = await this.prisma.processInstance.findUnique({ where: { id: dto.processInstanceId } });
      if (!inst) throw new BadRequestException('invalid processInstanceId');
      const task = await this.prisma.processTaskInstance.findUnique({ where: { id: dto.taskInstanceId } });
      if (!task || task.instanceId !== inst.id) throw new BadRequestException('invalid taskInstanceId');

      // Try reuse initiative already on the task
      if (task.initiativeId) {
        initiativeIdFinal = task.initiativeId;
      } else {
        // Ensure user has a team/org unit
        let orgUnitId = user.orgUnitId;
        if (!orgUnitId) {
          const team = await this.prisma.orgUnit.create({ data: { name: `Auto Team - ${user.name}`, type: 'TEAM' } });
          await this.prisma.user.update({ where: { id: user.id }, data: { orgUnitId: team.id } });
          orgUnitId = team.id;
        }
        // Ensure default objective and KR for process worklogs
        let objective = await this.prisma.objective.findFirst({ where: { title: 'Process Auto Objective', orgUnitId } });
        if (!objective) {
          const now = new Date();
          const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
          objective = await this.prisma.objective.create({
            data: { title: 'Process Auto Objective', orgUnitId, ownerId: user.id, periodStart: now, periodEnd: end, status: 'ACTIVE' as any },
          });
        }
        let kr = await this.prisma.keyResult.findFirst({ where: { title: 'Process Auto KR', objectiveId: objective.id } });
        if (!kr) {
          kr = await this.prisma.keyResult.create({
            data: { title: 'Process Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: user.id, objectiveId: objective.id },
          });
        }
        const title = `${inst.title} · ${task.name}`;
        let initiative = await this.prisma.initiative.findFirst({ where: { title, keyResultId: kr.id, ownerId: user.id } });
        if (!initiative) {
          initiative = await this.prisma.initiative.create({ data: { title, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
        }
        initiativeIdFinal = initiative.id;
        await this.prisma.processTaskInstance.update({ where: { id: task.id }, data: { initiativeId: initiative.id } });
      }
    }

    if (!initiativeIdFinal) {
      throw new BadRequestException('initiativeId or processInstanceId/taskInstanceId required');
    }

    // Resolve KST date (YYYY-MM-DD -> KST midnight; default: today @ KST midnight)
    let dateVal: Date;
    if (dto.date) {
      const s = String(dto.date);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        dateVal = new Date(`${s}T00:00:00+09:00`);
      } else {
        dateVal = new Date(s);
      }
    } else {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const y = kst.getUTCFullYear();
      const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
      const d = String(kst.getUTCDate()).padStart(2, '0');
      dateVal = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
    }
    // 1) Create worklog
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiativeIdFinal,
        createdById: dto.createdById,
        progressPct: dto.progressPct ?? 0,
        timeSpentMinutes: dto.timeSpentMinutes ?? 0,
        blockerCode: dto.blockerCode,
        note: dto.note,
        attachments: dto.attachments ?? undefined,
        date: dateVal,
        urgent: !!dto.urgent,
        visibility: (dto.visibility as any) ?? 'ALL',
      },
    });

    // 2) Events
    await this.prisma.event.create({
      data: {
        subjectType: 'Worklog',
        subjectId: wl.id,
        activity: 'WorklogCreated',
        userId: dto.createdById,
        attrs: { initiativeId: initiativeIdFinal },
      },
    });
    if ((dto.progressPct ?? 0) > 0 || (dto.timeSpentMinutes ?? 0) > 0) {
      await this.prisma.event.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          activity: 'ProgressReported',
          userId: dto.createdById,
          attrs: { progressPct: dto.progressPct ?? 0, timeSpentMinutes: dto.timeSpentMinutes ?? 0 },
        },
      });
    }
    if (dto.blockerCode) {
      await this.prisma.event.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          activity: 'BlockerRaised',
          userId: dto.createdById,
          attrs: { blockerCode: dto.blockerCode },
        },
      });
    }

    // 3) Optional: Approval submission (report to manager)
    let approvalId: string | undefined;
    if (dto.report?.approverId) {
      const req = await this.prisma.approvalRequest.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          approverId: dto.report.approverId,
          requestedById: dto.createdById,
          dueAt: dto.report.dueAt ? new Date(dto.report.dueAt) : undefined,
        },
      });
      approvalId = req.id;
      await this.prisma.event.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          activity: 'ApprovalRequested',
          userId: dto.createdById,
          attrs: { approverId: dto.report.approverId, requestId: req.id },
        },
      });
      await this.prisma.notification.create({
        data: {
          userId: dto.report.approverId,
          type: 'ApprovalRequested',
          subjectType: 'Worklog',
          subjectId: wl.id,
          payload: { requestId: req.id },
        },
      });
    }

    // 4) Optional: Share
    const shares: string[] = [];
    if (dto.share?.watcherIds?.length) {
      for (const watcherId of dto.share.watcherIds) {
        const share = await this.prisma.share.create({
          data: {
            subjectType: 'Worklog',
            subjectId: wl.id,
            watcherId,
            scope: (dto.share.scope as any) ?? 'READ',
          },
        });
        shares.push(share.id);
        await this.prisma.event.create({
          data: {
            subjectType: 'Worklog',
            subjectId: wl.id,
            activity: 'Shared',
            userId: dto.createdById,
            attrs: { watcherId, scope: dto.share.scope ?? 'READ' },
          },
        });
        await this.prisma.notification.create({
          data: {
            userId: watcherId,
            type: 'Shared',
            subjectType: 'Worklog',
            subjectId: wl.id,
            payload: { worklogId: wl.id },
          },
        });
      }
    }

    // 5) Optional: Help requests
    const tickets: string[] = [];
    if (dto.help?.length) {
      for (const h of dto.help) {
        const t = await this.prisma.helpTicket.create({
          data: {
            category: h.category,
            queue: h.queue,
            requesterId: dto.createdById,
            assigneeId: h.assigneeId,
            dueAt: h.dueAt ? new Date(h.dueAt) : undefined,
            slaMinutes: h.slaMinutes,
          },
        });
        tickets.push(t.id);
        await this.prisma.event.create({
          data: {
            subjectType: 'HelpTicket',
            subjectId: t.id,
            activity: 'HelpRequested',
            userId: dto.createdById,
            attrs: { worklogId: wl.id, category: h.category },
          },
        });
        if (h.assigneeId) {
          await this.prisma.notification.create({
            data: {
              userId: h.assigneeId,
              type: 'HelpRequested',
              subjectType: 'HelpTicket',
              subjectId: t.id,
              payload: { ticketId: t.id, fromWorklogId: wl.id },
            },
          });
        }
      }
    }

    // 6) Optional: Delegations
    const delegations: string[] = [];
    if (dto.delegate?.length) {
      for (const d of dto.delegate) {
        const del = await this.prisma.delegation.create({
          data: {
            parentType: d.parentType,
            parentId: d.parentId,
            childInitiativeId: d.childInitiativeId,
            delegatorId: dto.createdById,
            delegateeId: d.delegateeId,
            dueAt: d.dueAt ? new Date(d.dueAt) : undefined,
          },
        });
        delegations.push(del.id);
        await this.prisma.event.create({
          data: {
            subjectType: d.parentType,
            subjectId: d.parentId,
            activity: 'Delegated',
            userId: dto.createdById,
            attrs: { delegationId: del.id, childInitiativeId: d.childInitiativeId, delegateeId: d.delegateeId, fromWorklogId: wl.id },
          },
        });
        await this.prisma.notification.create({
          data: {
            userId: d.delegateeId,
            type: 'Delegated',
            subjectType: 'Delegation',
            subjectId: del.id,
            payload: { delegationId: del.id },
          },
        });
      }
    }

    return { worklog: wl, approvalId, shareIds: shares, helpTicketIds: tickets, delegationIds: delegations };
  }

  @Post('simple')
  async createSimple(@Body() dto: CreateSimpleWorklogDto) {
    let initiativeId = dto.initiativeId;
    let user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new Error('user not found');
    if (!initiativeId) {
      if (dto.keyResultId) {
        // Use selected KR to create/reuse an initiative for the task
        const kr = await this.prisma.keyResult.findUnique({ where: { id: dto.keyResultId } });
        if (!kr) throw new BadRequestException('invalid keyResultId');
        if (!dto.taskName) throw new BadRequestException('taskName required when keyResultId is provided');
        let initiative = await this.prisma.initiative.findFirst({ where: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id } });
        if (!initiative) {
          initiative = await this.prisma.initiative.create({ data: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
        }
        initiativeId = initiative.id;
      } else {
        // Ensure team & OKR scaffolding exists
        let team = await this.prisma.orgUnit.findFirst({ where: { name: dto.teamName, type: 'TEAM' } });
        if (!team) {
          team = await this.prisma.orgUnit.create({ data: { name: dto.teamName, type: 'TEAM' } });
        }
        user = await this.prisma.user.update({ where: { id: dto.userId }, data: { orgUnitId: team.id } });
        const periodStart = new Date();
        const periodEnd = new Date(periodStart.getTime() + 1000 * 60 * 60 * 24 * 365);
        let objective = await this.prisma.objective.findFirst({ where: { title: `Auto Objective - ${team.name}`, orgUnitId: team.id } });
        if (!objective) {
          objective = await this.prisma.objective.create({
            data: { title: `Auto Objective - ${team.name}`, orgUnitId: team.id, ownerId: user.id, periodStart, periodEnd, status: 'ACTIVE' as any },
          });
        }
        let kr = await this.prisma.keyResult.findFirst({ where: { title: 'Auto KR', objectiveId: objective.id } });
        if (!kr) {
          kr = await this.prisma.keyResult.create({
            data: { title: 'Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: user.id, objectiveId: objective.id },
          });
        }

        if (dto.userGoalId) {
          const goal = await (this.prisma as any).userGoal.findUnique({ where: { id: dto.userGoalId } });
          if (!goal || goal.userId !== user.id) {
            throw new BadRequestException('invalid userGoalId');
          }
          let initiative = await this.prisma.initiative.findFirst({ where: { userGoalId: goal.id, ownerId: user.id } as any });
          if (!initiative) {
            initiative = await this.prisma.initiative.create({
              data: { title: goal.title, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any, userGoalId: goal.id } as any,
            });
          }
          initiativeId = initiative.id;
        } else {
          if (!dto.taskName) {
            throw new BadRequestException('taskName required when initiativeId/userGoalId is not provided');
          }
          let initiative = await this.prisma.initiative.findFirst({ where: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id } });
          if (!initiative) {
            initiative = await this.prisma.initiative.create({ data: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
          }
          initiativeId = initiative.id;
        }
      }
    }

    // 4) Create worklog
    // Build plain text for search (strip HTML when provided)
    const plainFromHtml = dto.contentHtml
      ? dto.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const contentPlain = dto.content || plainFromHtml || '';
    const note = `${dto.title}\n\n${contentPlain}`;
    const attachmentsJson = dto.contentHtml || (dto as any).attachments
      ? { contentHtml: dto.contentHtml, files: (dto as any).attachments?.files ?? (dto as any).attachments ?? [] }
      : undefined;
    if (!initiativeId) {
      throw new BadRequestException('initiativeId or taskName required');
    }
    // Resolve Worklog.date in KST
    let dateValSimple: Date;
    if (dto.date) {
      const s = String(dto.date);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        dateValSimple = new Date(`${s}T00:00:00+09:00`);
      } else {
        dateValSimple = new Date(s);
      }
    } else {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const y = kst.getUTCFullYear();
      const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
      const d = String(kst.getUTCDate()).padStart(2, '0');
      dateValSimple = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
    }
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiativeId,
        createdById: user.id,
        note,
        timeSpentMinutes: dto.timeSpentMinutes ?? 0,
        attachments: attachmentsJson as any,
        tags: (dto as any).tags as any,
        date: dateValSimple,
        urgent: !!dto.urgent,
        visibility: (dto.visibility as any) ?? 'ALL',
      },
    });
    await this.prisma.event.create({ data: { subjectType: 'Worklog', subjectId: wl.id, activity: 'WorklogCreated', userId: user.id, attrs: { simple: true } } });
    return { id: wl.id };
  }

  @Get('search')
  async search(
    @Query('team') teamName?: string,
    @Query('user') userName?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: 'OKR' | 'KPI',
    @Query('krId') krId?: string,
    @Query('initiativeId') initiativeId?: string,
    @Query('urgent') urgentStr?: string,
    @Query('viewerId') viewerId?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '20', 10) || 20, 100);
    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) (where.date as any).gte = new Date(from);
      if (to) (where.date as any).lte = new Date(to);
    }
    if (q) where.note = { contains: q, mode: 'insensitive' as any };
    if (teamName) where.createdBy = { orgUnit: { name: teamName } };
    if (userName) where.createdBy = { ...(where.createdBy || {}), name: { contains: userName, mode: 'insensitive' as any } };
    if (typeof urgentStr === 'string') {
      const v = urgentStr.toLowerCase();
      if (v === 'true' || v === '1') (where as any).urgent = true;
      if (v === 'false' || v === '0') (where as any).urgent = false;
    }

    // Determine viewer visibility rights
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    let viewer: any = null;
    if (viewerId) {
      viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | undefined;
      if (role === 'CEO') {
        visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      } else if (role === 'EXEC') {
        visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      } else if (role === 'MANAGER') {
        visibilityIn = ['ALL', 'MANAGER_PLUS'];
      } else {
        visibilityIn = ['ALL'];
      }
    }

    const items = await this.prisma.worklog.findMany({
      where: {
        ...where,
        ...(kind === 'OKR' ? { initiative: { keyResult: { objective: { pillar: null } } } } : {}),
        ...(kind === 'KPI' ? { initiative: { keyResult: { NOT: { objective: { pillar: null } } } } } : {}),
        ...(krId ? { initiative: { keyResultId: krId } } : {}),
        ...(initiativeId ? { initiativeId } : {}),
        ...(viewerId
          ? {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            }
          : { visibility: { in: visibilityIn as any } }),
      },
      take: limit,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { date: 'desc' },
      include: { createdBy: { include: { orgUnit: true } }, initiative: true },
    });
    const nextCursor = items.length === limit ? items[items.length - 1].id : undefined;
    const mapped = items.map((it: any) => {
      const lines = (it.note || '').split(/\n+/);
      const title = lines[0] || '';
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      return {
        id: it.id,
        date: it.date,
        title,
        excerpt,
        userName: it.createdBy?.name,
        teamName: it.createdBy?.orgUnit?.name,
        taskName: it.initiative?.title,
        attachments: (it as any).attachments ?? undefined,
        note: it.note ?? undefined,
        urgent: (it as any).urgent ?? false,
      };
    });
    return { items: mapped, nextCursor };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wl = await (this.prisma as any).worklog.findUnique({
      where: { id },
      include: {
        initiative: { include: { keyResult: { include: { objective: true } } } },
        createdBy: { include: { orgUnit: true } },
      },
    });
    if (!wl) return null;
    const task = await (this.prisma as any).processTaskInstance.findFirst({ where: { worklogId: id }, include: { instance: true } });
    const process = task
      ? {
          instance: { id: task.instanceId, title: (task as any).instance?.title || '' },
          task: { id: task.id, name: task.name },
        }
      : null;
    return { ...wl, process } as any;
  }

  @Get('stats/weekly')
  async weeklyStats(@Query('days') daysStr?: string, @Query('team') teamName?: string, @Query('user') userName?: string, @Query('viewerId') viewerId?: string) {
    const days = Math.max(1, Math.min(parseInt(daysStr || '7', 10) || 7, 30));
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    // Resolve user filters first (so we can keep Worklog queries simple + index-friendly)
    let filterUserIds: string[] | null = null;
    if (teamName || userName) {
      const userWhere: any = {};
      if (teamName) userWhere.orgUnit = { name: teamName };
      if (userName) userWhere.name = { contains: userName, mode: 'insensitive' as any };
      const users = await (this.prisma as any).user.findMany({
        where: userWhere,
        select: { id: true },
      });
      const ids = (users || []).map((u: any) => String(u.id));
      if (!ids.length) {
        return { from: from.toISOString(), to: now.toISOString(), days, total: 0, teams: [] };
      }
      filterUserIds = ids;
    }

    // Visibility filter
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (viewerId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | undefined;
      if (role === 'CEO') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    const baseWhere: any = { date: { gte: from, lte: now } };
    if (filterUserIds) baseWhere.createdById = { in: filterUserIds };
    const visibilityWhere = viewerId
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            },
          ],
        }
      : { ...baseWhere, visibility: { in: visibilityIn as any } };

    // DB-side aggregation
    const agg = await (this.prisma as any).worklog.groupBy({
      by: ['createdById'],
      where: visibilityWhere,
      _count: { _all: true },
      _sum: { timeSpentMinutes: true },
    });

    const userIds = (agg || []).map((r: any) => String(r.createdById));
    if (!userIds.length) {
      return { from: from.toISOString(), to: now.toISOString(), days, total: 0, teams: [] };
    }

    const users = await (this.prisma as any).user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, orgUnit: { select: { name: true } } },
    });
    const userMap = new Map<string, { name: string; teamName: string }>();
    for (const u of (users || [])) {
      userMap.set(String(u.id), {
        name: String(u.name || '익명'),
        teamName: String(u.orgUnit?.name || '미지정팀'),
      });
    }

    // Recent per user (window function) for UI preview
    const RECENT_LIMIT = 3;
    const recentRows: Array<{ id: string; createdById: string; createdAt: Date; date: Date; note: string | null }> = await (this.prisma as any).$queryRaw(
      Prisma.sql`
        SELECT x.id, x."createdById" AS "createdById", x."createdAt" AS "createdAt", x."date" AS "date", x.note
        FROM (
          SELECT w.id, w."createdById", w."createdAt", w."date", w.note,
                 row_number() OVER (PARTITION BY w."createdById" ORDER BY w."createdAt" DESC, w.id DESC) AS rn
          FROM "Worklog" w
          WHERE w."date" >= ${from} AND w."date" <= ${now}
            AND w."createdById" IN (${Prisma.join(userIds)})
            AND (
              ${viewerId ? Prisma.sql`(w."createdById" = ${viewerId} OR w."visibility" = ANY(ARRAY[${Prisma.join(visibilityIn)}]::"WorklogVisibility"[]))` : Prisma.sql`(w."visibility" = ANY(ARRAY[${Prisma.join(visibilityIn)}]::"WorklogVisibility"[]))`}
            )
        ) x
        WHERE x.rn <= ${RECENT_LIMIT}
      `
    );

    const recentByUser = new Map<string, Array<{ id: string; title: string; createdAt: any; date: any }>>();
    for (const r of (recentRows || [])) {
      const uid = String((r as any).createdById);
      const lines = String((r as any).note || '').split(/\n+/);
      const title = lines[0] || '(제목 없음)';
      if (!recentByUser.has(uid)) recentByUser.set(uid, []);
      recentByUser.get(uid)!.push({ id: String((r as any).id), title, createdAt: (r as any).createdAt, date: (r as any).date });
    }

    type Bucket = { [userName: string]: { count: number; minutes: number; recent: Array<{ id: string; title: string; createdAt?: any; date?: any }> } };
    const byTeam = new Map<string, Bucket>();
    for (const r of (agg || [])) {
      const uid = String(r.createdById);
      const info = userMap.get(uid) || { name: '익명', teamName: '미지정팀' };
      const team = info.teamName;
      const user = info.name;
      if (!byTeam.has(team)) byTeam.set(team, {});
      const bucket = byTeam.get(team)!;
      bucket[user] = {
        count: Number(r._count?._all || 0),
        minutes: Number(r._sum?.timeSpentMinutes || 0),
        recent: recentByUser.get(uid) || [],
      };
    }

    const teams = Array.from(byTeam.entries()).map(([teamName, bucket]) => {
      const members = Object.entries(bucket)
        .map(([userName, v]) => ({ userName, count: v.count, minutes: v.minutes, recent: v.recent }))
        .sort((a, b) => (b.count - a.count) || (b.minutes - a.minutes));
      const total = members.reduce((s, m) => s + m.count, 0);
      return { teamName, total, members };
    }).sort((a, b) => b.total - a.total);
    const total = teams.reduce((s, t) => s + t.total, 0);
    return { from: from.toISOString(), to: now.toISOString(), days, total, teams };
  }

  @Get('stats/weekly/details')
  async weeklyDetails(
    @Query('days') daysStr?: string,
    @Query('team') teamName?: string,
    @Query('user') userName?: string,
    @Query('viewerId') viewerId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const days = Math.max(1, Math.min(parseInt(daysStr || '7', 10) || 7, 30));
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    const limit = Math.max(20, Math.min(parseInt(limitStr || '120', 10) || 120, 500));

    // Resolve user filters (team/user) to createdById IN (...) for better performance
    let filterUserIds: string[] | null = null;
    if (teamName || userName) {
      const userWhere: any = {};
      if (teamName) userWhere.orgUnit = { name: teamName };
      if (userName) userWhere.name = { contains: userName, mode: 'insensitive' as any };
      const users = await (this.prisma as any).user.findMany({ where: userWhere, select: { id: true } });
      const ids = (users || []).map((u: any) => String(u.id));
      if (!ids.length) {
        return { from: from.toISOString(), to: now.toISOString(), days, totalCount: 0, totalMinutes: 0, items: [], nextCursor: null, hasMore: false };
      }
      filterUserIds = ids;
    }

    // Visibility filter (same rules as weeklyStats)
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (viewerId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | undefined;
      if (role === 'CEO') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    // Cursor parsing: `${createdAtISO}|${id}`
    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const raw = String(cursor);
      const idx = raw.indexOf('|');
      if (idx > 0) {
        const ts = raw.slice(0, idx);
        const id = raw.slice(idx + 1);
        const d = new Date(ts);
        if (!isNaN(d.getTime()) && id) {
          cursorCreatedAt = d;
          cursorId = id;
        }
      }
    }

    const baseWhere: any = { date: { gte: from, lte: now } };
    if (filterUserIds) baseWhere.createdById = { in: filterUserIds };
    const visibilityWhere = viewerId
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            },
          ],
        }
      : { ...baseWhere, visibility: { in: visibilityIn as any } };

    const pagingWhere = (cursorCreatedAt && cursorId)
      ? {
          OR: [
            { createdAt: { lt: cursorCreatedAt } },
            { createdAt: cursorCreatedAt, id: { lt: cursorId } },
          ],
        }
      : {};

    const finalWhere = Object.keys(pagingWhere).length
      ? { AND: [visibilityWhere, pagingWhere] }
      : visibilityWhere;

    // Totals (for header) via DB aggregate (not limited by pagination)
    const totals = await (this.prisma as any).worklog.aggregate({
      where: visibilityWhere,
      _count: { _all: true },
      _sum: { timeSpentMinutes: true },
    });
    const totalCount = Number(totals?._count?._all || 0);
    const totalMinutes = Number(totals?._sum?.timeSpentMinutes || 0);

    const items = await (this.prisma as any).worklog.findMany({
      where: finalWhere,
      include: {
        createdBy: { include: { orgUnit: true } },
        initiative: { include: { keyResult: { include: { objective: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = (items || []).length > limit;
    const page = hasMore ? (items || []).slice(0, limit) : (items || []);
    const last = page.length ? page[page.length - 1] : null;
    const nextCursor = last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null;

    const mapped = page.map((it: any) => {
      const lines = String(it.note || '').split(/\n+/);
      const title = lines[0] || '';
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      return {
        id: it.id,
        createdAt: it.createdAt,
        date: it.date,
        timeSpentMinutes: it.timeSpentMinutes ?? 0,
        title,
        excerpt,
        userName: it.createdBy?.name,
        teamName: it.createdBy?.orgUnit?.name,
        taskName: it.initiative?.title,
        objectiveTitle: it.initiative?.keyResult?.objective?.title,
        keyResultTitle: it.initiative?.keyResult?.title,
        initiativeTitle: it.initiative?.title,
      };
    });

    return { from: from.toISOString(), to: now.toISOString(), days, totalCount, totalMinutes, items: mapped, nextCursor, hasMore };
  }

  @Get('ai/summary')
  async aiSummary(@Query('days') daysStr?: string, @Query('team') teamName?: string, @Query('user') userName?: string, @Query('viewerId') viewerId?: string) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) {
      throw new BadRequestException('Missing OPENAI_API_KEY (or *_CAMS / *_IAT). Set it as a Railway env var.');
    }
    const days = Math.max(1, Math.min(parseInt(daysStr || '7', 10) || 7, 30));
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const where: any = { date: { gte: from, lte: now } };
    if (teamName) where.createdBy = { orgUnit: { name: teamName } };
    if (userName) where.createdBy = { ...(where.createdBy || {}), name: { contains: userName, mode: 'insensitive' as any } };
    const items = await (this.prisma as any).worklog.findMany({
      where,
      include: { createdBy: { include: { orgUnit: true } } },
      orderBy: { date: 'desc' },
      take: 1000,
    });
    // Build compact context (limit per user)
    const byTeamUser = new Map<string, Map<string, string[]>>();
    for (const it of items) {
      const team = (it as any)?.createdBy?.orgUnit?.name || '미지정팀';
      const user = (it as any)?.createdBy?.name || '익명';
      const lines = String(it.note || '').split(/\n+/);
      const title = (lines[0] || '').slice(0, 120);
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      if (!byTeamUser.has(team)) byTeamUser.set(team, new Map());
      const inner = byTeamUser.get(team)!;
      if (!inner.has(user)) inner.set(user, []);
      const arr = inner.get(user)!;
      if (arr.length < 6) arr.push(`- ${title}${excerpt ? ` — ${excerpt}` : ''}`);
    }
    const parts: string[] = [];
    for (const [team, users] of byTeamUser) {
      parts.push(`팀: ${team}`);
      for (const [user, notes] of users) {
        parts.push(`  구성원: ${user}`);
        notes.forEach(n => parts.push(`    ${n}`));
      }
    }
    const context = parts.join('\n');
    const sys = '당신은 제조업(사출/도장/조립) 환경의 팀 리더 보조 AI입니다. 최근 업무일지를 바탕으로 팀별/개인별 진행 상황을 한국어로 간결하게 요약하고, 리스크/의존성/다음 액션을 bullet로 정리하세요. 넘겨받은 텍스트에 없는 추정은 하지 마세요.';
    const user = `최근 ${days}일 업무일지 요약을 작성해 주세요. 팀별로 먼저 요약 후, 개인별 한줄 요약을 제시하고 마지막에 전체 하이라이트 3개와 리스크 3개, 다음 액션 3개를 제안해 주세요.\n\n데이터:\n${context}`;
    // Call OpenAI
    const f: any = (globalThis as any).fetch;
    if (!f) {
      throw new BadRequestException('Server fetch not available. Please use Node 18+ or provide a fetch polyfill.');
    }
    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`OpenAI error: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    const summary = String(data?.choices?.[0]?.message?.content || '').trim();
    return { from: from.toISOString(), to: now.toISOString(), days, summary };
  }
}
