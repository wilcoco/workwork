import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { canViewWorklog } from './lib/worklog-visibility';

class InboxQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @IsString()
  onlyUnread?: string; // 'true' | 'false'

  @IsOptional()
  @IsString()
  type?: string; // filter by notification type (e.g., 'FeedbackAdded')

  @IsOptional()
  @IsString()
  limit?: string;
}

class MarkReadDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;
}

@Controller()
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get('inbox')
  async inbox(@Query() q: InboxQueryDto) {
    const limit = Math.min(parseInt(q.limit || '100', 10) || 100, 200);
    const where: any = { userId: q.userId };
    if (q.onlyUnread === 'true') where.readAt = null;
    if (q.type) where.type = q.type;
    const items = await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });

    // Enrich FeedbackAdded notifications with feedback details
    const feedbackNotifs = items.filter((n: any) => n.type === 'FeedbackAdded' && n.payload?.feedbackId);
    if (feedbackNotifs.length > 0) {
      const feedbackIds = feedbackNotifs.map((n: any) => n.payload.feedbackId);
      const feedbacks = await this.prisma.feedback.findMany({
        where: { id: { in: feedbackIds } },
        include: { author: { select: { id: true, name: true } } },
      });
      const fbMap: Record<string, any> = {};
      for (const fb of feedbacks) fbMap[fb.id] = fb;
      // 수신자가 볼 수 없는 공개범위의 업무일지 댓글은 알림에서도 내용을 노출하지 않는다.
      const recipient = await this.prisma.user.findUnique({ where: { id: String(q.userId) }, select: { id: true, role: true } });
      const wlFbIds = feedbacks.filter((f: any) => f.subjectType === 'Worklog').map((f: any) => String(f.subjectId));
      const wls = wlFbIds.length
        ? await this.prisma.worklog.findMany({ where: { id: { in: Array.from(new Set(wlFbIds)) } }, select: { id: true, visibility: true, createdById: true } })
        : [];
      const wlById = new Map(wls.map((w: any) => [String(w.id), w]));
      for (const n of feedbackNotifs) {
        const fb = fbMap[(n as any).payload?.feedbackId];
        if (fb && fb.subjectType === 'Worklog') {
          const wl = wlById.get(String(fb.subjectId));
          if (!wl || !canViewWorklog(recipient, wl)) continue; // 열람 불가 → enrich 생략
        }
        if (fb) {
          (n as any)._feedback = {
            id: fb.id,
            content: fb.content,
            authorId: fb.authorId,
            authorName: fb.author?.name,
            type: fb.type,
            createdAt: fb.createdAt,
          };
        }
      }
    }

    return { items };
  }

  @Post('notifications/:id/read')
  async markRead(@Param('id') id: string, @Body() _dto: MarkReadDto) {
    const n = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return n;
  }
}
