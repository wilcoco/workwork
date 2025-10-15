import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
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
  @IsString()
  @IsNotEmpty()
  initiativeId!: string;

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
}

class CreateSimpleWorklogDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() teamName!: string;
  @IsString() @IsNotEmpty() taskName!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() content!: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() contentHtml?: string;
  @IsOptional() attachments?: any;
}

@Controller('worklogs')
export class WorklogsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateWorklogDto) {
    // 1) Create worklog
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: dto.initiativeId,
        createdById: dto.createdById,
        progressPct: dto.progressPct ?? 0,
        timeSpentMinutes: dto.timeSpentMinutes ?? 0,
        blockerCode: dto.blockerCode,
        note: dto.note,
        attachments: dto.attachments ?? undefined,
      },
    });

    // 2) Events
    await this.prisma.event.create({
      data: {
        subjectType: 'Worklog',
        subjectId: wl.id,
        activity: 'WorklogCreated',
        userId: dto.createdById,
        attrs: { initiativeId: dto.initiativeId },
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
    // 0) Ensure team exists (create if needed)
    let team = await this.prisma.orgUnit.findFirst({ where: { name: dto.teamName, type: 'TEAM' } });
    if (!team) {
      team = await this.prisma.orgUnit.create({ data: { name: dto.teamName, type: 'TEAM' } });
    }

    // 1) If user belongs to different team, allow team change
    const user = await this.prisma.user.update({ where: { id: dto.userId }, data: { orgUnitId: team.id } });

    // 2) Ensure Objective/KR exist for the team (Auto buckets)
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

    // 3) Ensure Initiative exists for taskName (owner=user)
    let initiative = await this.prisma.initiative.findFirst({ where: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id } });
    if (!initiative) {
      initiative = await this.prisma.initiative.create({ data: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
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
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiative.id,
        createdById: user.id,
        note,
        attachments: attachmentsJson as any,
        date: dto.date ? new Date(dto.date) : undefined,
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

    const items = await this.prisma.worklog.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { date: 'desc' },
      include: { createdBy: { include: { orgUnit: true } }, initiative: true },
    });
    const nextCursor = items.length === limit ? items[items.length - 1].id : undefined;
    const mapped = items.map((it) => {
      const lines = (it.note || '').split(/\n+/);
      const title = lines[0] || '';
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      return { id: it.id, date: it.date, title, excerpt, userName: it.createdBy?.name, teamName: it.createdBy?.orgUnit?.name, taskName: it.initiative?.title };
    });
    return { items: mapped, nextCursor };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wl = await this.prisma.worklog.findUnique({ where: { id } });
    return wl;
  }
}
