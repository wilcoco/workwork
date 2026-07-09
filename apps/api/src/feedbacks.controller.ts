import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from './prisma.service';
import { canViewWorklog } from './lib/worklog-visibility';

class CreateFeedbackDto {
  @IsString()
  @IsNotEmpty()
  subjectType!: string;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsString()
  @IsNotEmpty()
  authorId!: string;

  @IsOptional()
  @IsEnum({ GENERAL: 'GENERAL', RUBRIC: 'RUBRIC', INSTRUCTION: 'INSTRUCTION' })
  type?: 'GENERAL' | 'RUBRIC' | 'INSTRUCTION';

  // INSTRUCTION-only fields. Ignored otherwise.
  @IsOptional()
  @IsString()
  instructionAssigneeId?: string;

  @IsOptional()
  @IsString()
  instructionTitle?: string;

  @IsOptional()
  @IsString()
  instructionDueDate?: string; // ISO date

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsBoolean()
  actionRequired?: boolean;

  @IsOptional()
  @IsString()
  targetUserId?: string; // notify specific user (e.g., owner)
}

@Controller('feedbacks')
export class FeedbacksController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateFeedbackDto) {
    const fb = await this.prisma.feedback.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        authorId: dto.authorId,
        type: (dto.type as any) ?? 'GENERAL',
        content: dto.content,
        rating: dto.rating,
        actionRequired: dto.actionRequired ?? false,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        activity: 'FeedbackAdded',
        userId: dto.authorId,
        attrs: { rating: dto.rating, actionRequired: dto.actionRequired ?? false },
      },
    });
    if (dto.targetUserId) {
      await this.prisma.notification.create({
        data: {
          userId: dto.targetUserId,
          type: 'FeedbackAdded',
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          payload: { feedbackId: fb.id },
        },
      });
    }

    // If this is a Worklog INSTRUCTION comment, materialise it as a task.
    let instructionId: string | undefined;
    if (dto.type === 'INSTRUCTION' && dto.subjectType === 'Worklog') {
      let assigneeId = (dto.instructionAssigneeId || '').trim();
      if (!assigneeId) {
        // Default: the worklog author
        const wl = await (this.prisma as any).worklog.findUnique({
          where: { id: dto.subjectId },
          select: { createdById: true },
        });
        assigneeId = wl?.createdById || dto.authorId;
      }
      const due = dto.instructionDueDate
        ? new Date(dto.instructionDueDate)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const title = (dto.instructionTitle || dto.content.split(/\n/)[0] || '업무 지시').slice(0, 200);
      const ins = await (this.prisma as any).worklogInstruction.create({
        data: {
          sourceFeedbackId: fb.id,
          sourceWorklogId: dto.subjectId,
          assignerId: dto.authorId,
          assigneeId,
          title,
          description: dto.content,
          dueDate: isNaN(due.getTime()) ? null : due,
          status: 'OPEN',
        },
      });
      instructionId = ins.id;
      // Notify the assignee.
      if (assigneeId && assigneeId !== dto.authorId) {
        try {
          await this.prisma.notification.create({
            data: {
              userId: assigneeId,
              type: 'InstructionAssigned',
              subjectType: 'WorklogInstruction',
              subjectId: ins.id,
              payload: { worklogId: dto.subjectId, feedbackId: fb.id, title },
            },
          });
        } catch {}
      }
    }

    return { ...fb, instructionId };
  }

  @Get()
  async list(
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('worklogAuthorId') worklogAuthorId?: string,
    @Query('excludeAuthorId') excludeAuthorId?: string,
    @Query('excludeType') excludeType?: string,
    @Query('limit') limitStr?: string,
    @Query('viewerId') viewerId?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 100);
    // 업무일지 댓글은 그 업무일지의 공개 범위를 넘어 보이면 안 된다 → viewer 기준으로 필터링.
    const viewer = viewerId
      ? await this.prisma.user.findUnique({ where: { id: String(viewerId) }, select: { id: true, role: true } })
      : null;
    // 제한된 일지의 댓글이 제외돼도 limit 만큼 채우도록 넉넉히 조회 후 잘라낸다.
    const isWorklog = subjectType === 'Worklog';
    const fetchTake = isWorklog ? Math.min(limit * 4, 400) : limit;
    const where: any = {};
    if (subjectType) where.subjectType = subjectType;
    if (subjectId) where.subjectId = subjectId;
    if (excludeAuthorId) where.authorId = { not: excludeAuthorId };
    if (excludeType) where.type = { not: excludeType };

    // worklogAuthorId: 특정 사용자가 작성한 업무일지에 달린 댓글만 조회
    if (worklogAuthorId && subjectType === 'Worklog') {
      const myWorklogs = await this.prisma.worklog.findMany({
        where: { createdById: worklogAuthorId },
        select: { id: true },
        take: 500,
        orderBy: { createdAt: 'desc' },
      });
      const wlIds = myWorklogs.map((w) => w.id);
      if (wlIds.length > 0) {
        where.subjectId = { in: wlIds };
      } else {
        return { items: [] };
      }
    }
    const rawItems = await this.prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: fetchTake,
      include: { author: { include: { orgUnit: { select: { id: true, name: true } } } } },
    });

    // 공개 범위 필터: Worklog 댓글은 viewer가 그 일지를 볼 수 있을 때만 노출
    let items = rawItems;
    if (isWorklog && rawItems.length) {
      const wlIds = Array.from(new Set(rawItems.map((it: any) => String(it.subjectId)).filter(Boolean)));
      const wls = await this.prisma.worklog.findMany({
        where: { id: { in: wlIds } },
        select: { id: true, visibility: true, createdById: true },
      });
      const wlById = new Map(wls.map((w: any) => [String(w.id), w]));
      items = rawItems.filter((it: any) => {
        const wl = wlById.get(String(it.subjectId));
        if (!wl) return false; // 원 일지가 없거나 삭제됨 → 노출 안 함
        return canViewWorklog(viewer, wl);
      });
    }
    items = items.slice(0, limit);

    // Pull instructions linked to any of these feedbacks in one query.
    const fbIds = items.map((it: any) => it.id);
    const instructions = fbIds.length
      ? await (this.prisma as any).worklogInstruction.findMany({
          where: { sourceFeedbackId: { in: fbIds } },
          include: { assignee: { select: { id: true, name: true } } },
        })
      : [];
    const insByFb: Record<string, any> = {};
    for (const i of instructions as any[]) insByFb[i.sourceFeedbackId] = i;
    return {
      items: items.map((it: any) => {
        const ins = insByFb[it.id];
        return {
          id: it.id,
          subjectType: it.subjectType,
          subjectId: it.subjectId,
          authorId: it.authorId,
          authorName: it.author?.name,
          authorTeam: it.author?.orgUnit?.name || null,
          type: it.type,
          content: it.content,
          rating: it.rating ?? null,
          actionRequired: it.actionRequired ?? false,
          createdAt: it.createdAt,
          instruction: ins
            ? {
                id: ins.id,
                assigneeId: ins.assigneeId,
                assigneeName: ins.assignee?.name || '',
                dueDate: ins.dueDate,
                status: ins.status,
                completedWorklogId: ins.completedWorklogId,
              }
            : null,
        };
      }),
    };
  }
}
