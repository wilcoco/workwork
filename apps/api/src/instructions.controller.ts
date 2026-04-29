import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * WorklogInstruction (= a task generated from a worklog INSTRUCTION comment).
 *
 * - GET  /api/instructions?assigneeId=&status=OPEN[,IN_PROGRESS]&limit=
 *     List instructions, optionally filtered by assignee/status.
 * - POST /api/instructions/:id/complete  body { worklogId, userId }
 *     Mark an instruction DONE and link the completing worklog.
 * - POST /api/instructions/:id/status    body { status, userId }
 *     Update status manually (assignee can self-update).
 */
@Controller('instructions')
export class InstructionsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Query('assigneeId') assigneeId?: string,
    @Query('assignerId') assignerId?: string,
    @Query('status') statusCsv?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 200);
    const where: any = {};
    if (assigneeId) where.assigneeId = assigneeId;
    if (assignerId) where.assignerId = assignerId;
    if (statusCsv) {
      const parts = String(statusCsv)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (parts.length === 1) where.status = parts[0];
      else if (parts.length > 1) where.status = { in: parts };
    }
    const rows = await (this.prisma as any).worklogInstruction.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        assigner: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
    return {
      items: rows.map((r: any) => ({
        id: r.id,
        sourceFeedbackId: r.sourceFeedbackId,
        sourceWorklogId: r.sourceWorklogId,
        assignerId: r.assignerId,
        assignerName: r.assigner?.name || '',
        assigneeId: r.assigneeId,
        assigneeName: r.assignee?.name || '',
        title: r.title,
        description: r.description,
        dueDate: r.dueDate,
        status: r.status,
        completedWorklogId: r.completedWorklogId,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
      })),
    };
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() body: { worklogId?: string; userId?: string }) {
    const worklogId = String(body?.worklogId || '').trim();
    const userId = String(body?.userId || '').trim();
    if (!worklogId) throw new BadRequestException('worklogId is required');
    const ins = await (this.prisma as any).worklogInstruction.findUnique({ where: { id } });
    if (!ins) throw new NotFoundException('instruction not found');
    // Only the assignee or the assigner may close. (Permissive for now.)
    if (userId && userId !== ins.assigneeId && userId !== ins.assignerId) {
      // Allow other roles silently for now.
    }
    const updated = await (this.prisma as any).worklogInstruction.update({
      where: { id },
      data: {
        status: 'DONE',
        completedWorklogId: worklogId,
        completedAt: new Date(),
      },
    });
    // Notify assigner.
    try {
      if (ins.assignerId && ins.assignerId !== userId) {
        await this.prisma.notification.create({
          data: {
            userId: ins.assignerId,
            type: 'InstructionCompleted',
            subjectType: 'WorklogInstruction',
            subjectId: ins.id,
            payload: { worklogId, title: ins.title },
          },
        });
      }
    } catch {}
    return updated;
  }

  @Post(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() body: { status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'; userId?: string },
  ) {
    const next = String(body?.status || '').toUpperCase();
    const valid = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
    if (!valid.includes(next)) throw new BadRequestException('invalid status');
    const ins = await (this.prisma as any).worklogInstruction.findUnique({ where: { id } });
    if (!ins) throw new NotFoundException('instruction not found');
    const data: any = { status: next };
    if (next === 'DONE') {
      data.completedAt = new Date();
    } else {
      data.completedAt = null;
      data.completedWorklogId = null;
    }
    return (this.prisma as any).worklogInstruction.update({ where: { id }, data });
  }
}
