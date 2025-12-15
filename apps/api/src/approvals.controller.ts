import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from './prisma.service';

class CreateApprovalDto {
  @IsString()
  @IsNotEmpty()
  subjectType!: string;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsOptional()
  @IsString()
  approverId?: string; // when steps[] provided, approverId will default to first step's approver

  @IsString()
  @IsNotEmpty()
  requestedById!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApprovalStepInput)
  steps?: CreateApprovalStepInput[];
}

class ActApprovalDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

class CreateApprovalStepInput {
  @IsString()
  @IsNotEmpty()
  approverId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ListApprovalsQueryDto {
  @IsOptional() @IsString()
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

  @IsOptional() @IsString()
  requestedById?: string;

  @IsOptional() @IsString()
  approverId?: string;

  @IsOptional() @IsString()
  subjectType?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsString()
  limit?: string;

  @IsOptional() @IsString()
  cursor?: string;
}

@Controller('approvals')
export class ApprovalsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query() q: ListApprovalsQueryDto) {
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.requestedById) where.requestedById = q.requestedById;
    if (q.approverId) where.approverId = q.approverId;
    if (q.subjectType) where.subjectType = q.subjectType;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to) (where.createdAt as any).lte = new Date(q.to);
    }
    const limit = Math.min(parseInt(q.limit || '20', 10) || 20, 100);
    const items = await this.prisma.approvalRequest.findMany({
      where,
      take: limit,
      skip: q.cursor ? 1 : 0,
      ...(q.cursor ? { cursor: { id: q.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: true,
        approver: true,
        steps: {
          orderBy: { stepNo: 'asc' },
          include: { approver: true },
        },
      },
    });
    const nextCursor = items.length === limit ? items[items.length - 1].id : undefined;
    return {
      items: items.map((a: any) => ({
        id: a.id,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        status: a.status,
        requestedBy: a.requestedBy ? { id: a.requestedBy.id, name: a.requestedBy.name } : null,
        currentApprover: a.approver ? { id: a.approver.id, name: a.approver.name } : null,
        dueAt: a.dueAt || null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        steps: (a.steps || []).map((s: any) => ({
          id: s.id,
          stepNo: s.stepNo,
          approverId: s.approverId,
          approver: s.approver ? { id: s.approver.id, name: s.approver.name } : null,
          status: s.status,
          actedAt: s.actedAt || null,
          comment: s.comment || null,
        })),
      })),
      nextCursor,
    };
  }

  @Get('summary')
  async summary(@Query() q: ListApprovalsQueryDto) {
    const where: any = {};
    if (q.requestedById) where.requestedById = q.requestedById;
    if (q.approverId) where.approverId = q.approverId;
    if (q.subjectType) where.subjectType = q.subjectType;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to) (where.createdAt as any).lte = new Date(q.to);
    }
    const rows = await (this.prisma as any).approvalRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
      where,
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count._all;
    for (const k of ['PENDING','APPROVED','REJECTED','EXPIRED']) if (!(k in out)) out[k] = 0;
    return { counts: out };
  }

  @Post()
  async create(@Body() dto: CreateApprovalDto) {
    const steps = Array.isArray(dto.steps) ? dto.steps.filter(s => s && s.approverId) : [];
    const firstApprover = steps.length > 0 ? steps[0].approverId : dto.approverId;
    if (!firstApprover) throw new BadRequestException('approverId or steps[0].approverId is required');

    const req = await this.prisma.approvalRequest.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        approverId: firstApprover,
        requestedById: dto.requestedById,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });

    // Create steps if provided
    if (steps.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await this.prisma.approvalStep.create({
          data: {
            requestId: req.id,
            stepNo: i + 1,
            approverId: s.approverId,
            status: 'PENDING' as any,
            actedAt: undefined,
            comment: undefined,
          },
        });
      }
    }

    await this.prisma.event.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        activity: 'ApprovalRequested',
        userId: dto.requestedById,
        attrs: { approverId: firstApprover, requestId: req.id, steps: steps.length },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: firstApprover,
        type: 'ApprovalRequested',
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        payload: { requestId: req.id },
      },
    });
    return req;
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ActApprovalDto) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: 'asc' } } } });
    if (!req) throw new BadRequestException('request not found');

    if (!req.steps || req.steps.length === 0) {
      // single-step legacy
      const updated = await this.prisma.approvalRequest.update({ where: { id }, data: { status: 'APPROVED' } });
      // If this approval is for a car dispatch, also mark the dispatch as approved
      if (updated.subjectType === 'CAR_DISPATCH') {
        await (this.prisma as any).carDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
      }
      await this.prisma.event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalGranted', userId: dto.actorId, attrs: { requestId: id, comment: dto.comment } } });
      await this.prisma.notification.create({ data: { userId: updated.requestedById, type: 'ApprovalGranted', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id } } });
      return updated;
    }

    // multi-step
    const pending = req.steps.find((s: any) => s.status === 'PENDING');
    if (!pending) {
      // nothing to approve; idempotent
      return req;
    }
    if (pending.approverId !== dto.actorId) throw new BadRequestException('not current approver');

    await this.prisma.approvalStep.update({ where: { id: pending.id }, data: { status: 'APPROVED' as any, comment: dto.comment, actedAt: new Date() } });
    await this.prisma.event.create({ data: { subjectType: 'ApprovalStep', subjectId: pending.id, activity: 'ApprovalStepApproved', userId: dto.actorId, attrs: { requestId: id, stepNo: pending.stepNo } } });

    // find next step
    const next = req.steps.find((s: any) => s.stepNo === pending.stepNo + 1);
    if (next) {
      // advance current approver to next step
      await this.prisma.approvalRequest.update({ where: { id }, data: { approverId: next.approverId } });
      // keep request pending, notify next approver
      await this.prisma.notification.create({ data: { userId: next.approverId, type: 'ApprovalRequested', subjectType: req.subjectType, subjectId: req.subjectId, payload: { requestId: id } } });
      await this.prisma.event.create({ data: { subjectType: req.subjectType, subjectId: req.subjectId, activity: 'ApprovalRequested', userId: dto.actorId, attrs: { requestId: id, nextStepNo: next.stepNo } } });
      return await this.prisma.approvalRequest.findUnique({ where: { id }, include: { steps: true } });
    } else {
      // last step approved -> finalize
      const updated = await this.prisma.approvalRequest.update({ where: { id }, data: { status: 'APPROVED' } });
      await this.prisma.event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalGranted', userId: dto.actorId, attrs: { requestId: id } } });
      await this.prisma.notification.create({ data: { userId: updated.requestedById, type: 'ApprovalGranted', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id } } });
      return updated;
    }
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: ActApprovalDto) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: 'asc' } } } });
    if (!req) throw new BadRequestException('request not found');

    if (!req.steps || req.steps.length === 0) {
      const updated = await this.prisma.approvalRequest.update({ where: { id }, data: { status: 'REJECTED' } });
      if (updated.subjectType === 'CAR_DISPATCH') {
        await (this.prisma as any).carDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
      }
      await this.prisma.event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalRejected', userId: dto.actorId, attrs: { requestId: id, reason: dto.comment } } });
      await this.prisma.notification.create({ data: { userId: updated.requestedById, type: 'ApprovalRejected', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id, reason: dto.comment } } });
      return updated;
    }

    const pending = req.steps.find((s: any) => s.status === 'PENDING');
    if (!pending) return req;
    if (pending.approverId !== dto.actorId) throw new BadRequestException('not current approver');

    await this.prisma.approvalStep.update({ where: { id: pending.id }, data: { status: 'REJECTED' as any, comment: dto.comment, actedAt: new Date() } });
    const updated = await this.prisma.approvalRequest.update({ where: { id }, data: { status: 'REJECTED' } });
    await this.prisma.event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalRejected', userId: dto.actorId, attrs: { requestId: id, stepNo: pending.stepNo, reason: dto.comment } } });
    await this.prisma.notification.create({ data: { userId: updated.requestedById, type: 'ApprovalRejected', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id, reason: dto.comment } } });
    return updated;
  }
}
