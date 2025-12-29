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
    } = body || {};

    if (!templateId) throw new Error('templateId is required');
    if (!title) throw new Error('title is required');
    if (!startedById) throw new Error('startedById is required');

    const tmpl = await this.prisma.processTemplate.findUnique({
      where: { id: templateId },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
    if (!tmpl) throw new Error('template not found');

    const now = new Date();
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
        },
      });

      const taskCreates = (tmpl.tasks || []).map((t: any) => {
        const preds = parsePreds(t.predecessorIds);
        const initialStatus = preds.length === 0 ? 'READY' : 'NOT_STARTED';
        return {
          instanceId: inst.id,
          taskTemplateId: t.id,
          name: t.name,
          stageLabel: t.stageLabel || null,
          taskType: t.taskType,
          status: initialStatus,
        } as any;
      });

      if (taskCreates.length) {
        await tx.processTaskInstance.createMany({ data: taskCreates });
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
}
