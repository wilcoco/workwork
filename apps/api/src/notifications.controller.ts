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
    const where = { userId: q.userId, ...(q.onlyUnread === 'true' ? { readAt: null } : {}) } as any;
    const items = await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' } });
    return { items };
  }

  @Post('notifications/:id/read')
  async markRead(@Param('id') id: string, @Body() _dto: MarkReadDto) {
    const n = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return n;
  }
}
