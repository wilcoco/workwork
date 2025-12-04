import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from './prisma.service';

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
  @IsEnum({ GENERAL: 'GENERAL', RUBRIC: 'RUBRIC' })
  type?: 'GENERAL' | 'RUBRIC';

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
    return fb;
  }

  @Get()
  async list(
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 100);
    const where: any = {};
    if (subjectType) where.subjectType = subjectType;
    if (subjectId) where.subjectId = subjectId;
    const items = await this.prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { author: true },
    });
    return {
      items: items.map((it: any) => ({
        id: it.id,
        subjectType: it.subjectType,
        subjectId: it.subjectId,
        authorId: it.authorId,
        authorName: it.author?.name,
        content: it.content,
        rating: it.rating ?? null,
        actionRequired: it.actionRequired ?? false,
        createdAt: it.createdAt,
      })),
    };
  }
}
