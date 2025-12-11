import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateHelpTicketDto {
  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsOptional()
  @IsString()
  queue?: string;

  @IsString()
  @IsNotEmpty()
  requesterId!: string;

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

  @IsOptional()
  @IsString()
  worklogId?: string;
}

class ActDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class ListQueryDto {
  @IsOptional() @IsString()
  status?: 'OPEN' | 'ACCEPTED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';

  @IsOptional() @IsString()
  requesterId?: string;

  @IsOptional() @IsString()
  assigneeId?: string;

  @IsOptional() @IsString()
  queue?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsString()
  limit?: string;

  @IsOptional() @IsString()
  cursor?: string;
}

@Controller('help-tickets')
export class HelpTicketsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query() q: ListQueryDto) {
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.requesterId) where.requesterId = q.requesterId;
    if (q.assigneeId) where.assigneeId = q.assigneeId;
    if (q.queue) where.queue = q.queue;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to) (where.createdAt as any).lte = new Date(q.to);
    }
    const limit = Math.min(parseInt(q.limit || '20', 10) || 20, 100);
    const items = await this.prisma.helpTicket.findMany({
      where,
      take: limit,
      skip: q.cursor ? 1 : 0,
      ...(q.cursor ? { cursor: { id: q.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { requester: true, assignee: true, worklog: true },
    });
    const nextCursor = items.length === limit ? items[items.length - 1].id : undefined;
    return {
      items: items.map((t: any) => ({
        id: t.id,
        category: t.category,
        queue: t.queue || null,
        status: t.status,
        requester: t.requester ? { id: t.requester.id, name: t.requester.name } : null,
        assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
        worklogTitle: (t as any).worklog?.title ?? null,
        slaMinutes: t.slaMinutes ?? undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        resolvedAt: t.resolvedAt || null,
      })),
      nextCursor,
    };
  }

  @Get('summary')
  async summary(@Query() q: ListQueryDto) {
    const where: any = {};
    if (q.requesterId) where.requesterId = q.requesterId;
    if (q.assigneeId) where.assigneeId = q.assigneeId;
    if (q.queue) where.queue = q.queue;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to) (where.createdAt as any).lte = new Date(q.to);
    }
    const rows = await (this.prisma as any).helpTicket.groupBy({
      by: ['status'],
      _count: { _all: true },
      where,
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count._all;
    // Ensure consistent keys
    for (const k of ['OPEN','ACCEPTED','IN_PROGRESS','BLOCKED','DONE','CANCELLED']) if (!(k in out)) out[k] = 0;
    return { counts: out };
  }

  @Post()
  async create(@Body() dto: CreateHelpTicketDto) {
    const ticket = await this.prisma.helpTicket.create({
      data: {
        category: dto.category,
        queue: dto.queue,
        requesterId: dto.requesterId,
        assigneeId: dto.assigneeId,
        // Prisma model has optional dueAt: DateTime?; only set when provided
        ...(dto.dueAt ? { dueAt: new Date(dto.dueAt) } : {}),
        slaMinutes: dto.slaMinutes,
        worklogId: dto.worklogId,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpRequested',
        userId: dto.requesterId,
        attrs: { assigneeId: dto.assigneeId, category: dto.category, worklogId: dto.worklogId },
      },
    });
    if (dto.assigneeId) {
      await this.prisma.notification.create({
        data: {
          userId: dto.assigneeId,
          type: 'HelpRequested',
          subjectType: 'HelpTicket',
          subjectId: ticket.id,
          payload: { ticketId: ticket.id, fromWorklogId: dto.worklogId },
        },
      });
    }
    return ticket;
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        assigneeId: dto.actorId,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpAccepted',
        userId: dto.actorId,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: ticket.requesterId,
        type: 'HelpAccepted',
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        payload: { ticketId: ticket.id },
      },
    });
    return ticket;
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpStarted',
        userId: dto.actorId,
      },
    });
    return ticket;
  }

  @Post(':id/decline')
  async decline(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpDeclined',
        userId: dto.actorId,
        attrs: { reason: dto.reason },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: ticket.requesterId,
        type: 'HelpDeclined',
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        payload: { reason: dto.reason },
      },
    });
    return ticket;
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: { status: 'DONE', resolvedAt: new Date() },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpResolved',
        userId: dto.actorId,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: ticket.requesterId,
        type: 'HelpResolved',
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        payload: { ticketId: ticket.id },
      },
    });
    return ticket;
  }
}
