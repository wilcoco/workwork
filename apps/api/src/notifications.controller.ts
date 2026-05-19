import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

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
      for (const n of feedbackNotifs) {
        const fb = fbMap[(n as any).payload?.feedbackId];
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
