import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

type CreateInitiativeDto = {
  title: string;
  goal?: string;
  description?: string;
  priority?: number;
  startDate?: string;
  dueDate?: string;
  assigneeId?: string;
  orgUnitId?: string;
};

type UpdateInitiativeDto = Partial<CreateInitiativeDto> & {
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  completedAt?: string | null;
};

type AddProgressDto = {
  content: string;
  progressPct?: number;
};

@Controller('key-initiatives')
export class KeyInitiativesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Query('actorId') actorId?: string,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('orgUnitId') orgUnitId?: string,
  ) {
    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (assigneeId) {
      where.assigneeId = assigneeId;
    }
    if (orgUnitId) {
      where.orgUnitId = orgUnitId;
    }

    const items = await (this.prisma as any).keyInitiative.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        orgUnit: { select: { id: true, name: true } },
        progress: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            createdBy: { select: { id: true, name: true } },
          },
        },
        _count: { select: { progress: true } },
      },
    });

    const now = new Date();

    return items.map((item: any) => {
      let warning: string | null = null;
      const dueDate = item.dueDate ? new Date(item.dueDate) : null;

      if (dueDate && item.status !== 'COMPLETED' && item.status !== 'CANCELLED') {
        const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) {
          warning = `기한 ${Math.abs(daysLeft)}일 초과`;
        } else if (daysLeft <= 3) {
          warning = `기한 ${daysLeft}일 남음`;
        } else if (daysLeft <= 7) {
          warning = `기한 ${daysLeft}일 남음`;
        }
      }

      const latestProgress = item.progress?.[0] || null;

      return {
        id: item.id,
        title: item.title,
        goal: item.goal,
        description: item.description,
        status: item.status,
        priority: item.priority,
        startDate: item.startDate?.toISOString().slice(0, 10) || null,
        dueDate: item.dueDate?.toISOString().slice(0, 10) || null,
        completedAt: item.completedAt?.toISOString().slice(0, 10) || null,
        assignee: item.assignee,
        createdBy: item.createdBy,
        orgUnit: item.orgUnit,
        progressCount: item._count.progress,
        latestProgress: latestProgress ? {
          id: latestProgress.id,
          content: latestProgress.content,
          progressPct: latestProgress.progressPct,
          createdBy: latestProgress.createdBy,
          createdAt: latestProgress.createdAt,
        } : null,
        warning,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const item = await (this.prisma as any).keyInitiative.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        orgUnit: { select: { id: true, name: true } },
        progress: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!item) return null;

    const now = new Date();
    const dueDate = item.dueDate ? new Date(item.dueDate) : null;
    let warning: string | null = null;

    if (dueDate && item.status !== 'COMPLETED' && item.status !== 'CANCELLED') {
      const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) {
        warning = `기한 ${Math.abs(daysLeft)}일 초과`;
      } else if (daysLeft <= 7) {
        warning = `기한 ${daysLeft}일 남음`;
      }
    }

    return {
      ...item,
      startDate: item.startDate?.toISOString().slice(0, 10) || null,
      dueDate: item.dueDate?.toISOString().slice(0, 10) || null,
      completedAt: item.completedAt?.toISOString().slice(0, 10) || null,
      warning,
    };
  }

  @Post()
  async create(
    @Body() dto: CreateInitiativeDto,
    @Query('actorId') actorId?: string,
  ) {
    if (!actorId) throw new Error('actorId 필요');

    const data: any = {
      title: dto.title,
      goal: dto.goal || null,
      description: dto.description || null,
      priority: dto.priority || 0,
      startDate: dto.startDate ? new Date(dto.startDate + 'T00:00:00+09:00') : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate + 'T23:59:59+09:00') : null,
      createdById: actorId,
    };

    if (dto.assigneeId) data.assigneeId = dto.assigneeId;
    if (dto.orgUnitId) data.orgUnitId = dto.orgUnitId;

    const created = await (this.prisma as any).keyInitiative.create({
      data,
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return created;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateInitiativeDto,
    @Query('actorId') actorId?: string,
  ) {
    const data: any = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.goal !== undefined) data.goal = dto.goal;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId || null;
    if (dto.orgUnitId !== undefined) data.orgUnitId = dto.orgUnitId || null;

    if (dto.startDate !== undefined) {
      data.startDate = dto.startDate ? new Date(dto.startDate + 'T00:00:00+09:00') : null;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate + 'T23:59:59+09:00') : null;
    }
    if (dto.completedAt !== undefined) {
      data.completedAt = dto.completedAt ? new Date(dto.completedAt + 'T00:00:00+09:00') : null;
    }

    if (dto.status === 'COMPLETED' && !dto.completedAt) {
      data.completedAt = new Date();
    }

    const updated = await (this.prisma as any).keyInitiative.update({
      where: { id },
      data,
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Query('actorId') actorId?: string) {
    await (this.prisma as any).keyInitiative.delete({ where: { id } });
    return { success: true };
  }

  @Post(':id/progress')
  async addProgress(
    @Param('id') id: string,
    @Body() dto: AddProgressDto,
    @Query('actorId') actorId?: string,
  ) {
    if (!actorId) throw new Error('actorId 필요');

    const progress = await (this.prisma as any).keyInitiativeProgress.create({
      data: {
        initiativeId: id,
        content: dto.content,
        progressPct: dto.progressPct ?? null,
        createdById: actorId,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (dto.progressPct !== undefined) {
      const newStatus = dto.progressPct >= 100 ? 'COMPLETED' : 'IN_PROGRESS';
      await (this.prisma as any).keyInitiative.update({
        where: { id },
        data: {
          status: newStatus,
          ...(newStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });
    }

    return progress;
  }

  @Get(':id/progress')
  async getProgress(@Param('id') id: string) {
    const items = await (this.prisma as any).keyInitiativeProgress.findMany({
      where: { initiativeId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
    return items;
  }

  @Delete(':id/progress/:progressId')
  async deleteProgress(
    @Param('id') id: string,
    @Param('progressId') progressId: string,
    @Query('actorId') actorId?: string,
  ) {
    await (this.prisma as any).keyInitiativeProgress.delete({
      where: { id: progressId },
    });
    return { success: true };
  }
}
