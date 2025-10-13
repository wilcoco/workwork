import { Body, Controller, Post } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateShareDto {
  @IsString()
  @IsNotEmpty()
  subjectType!: string;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsString()
  @IsNotEmpty()
  watcherId!: string;

  @IsOptional()
  @IsEnum({ READ: 'READ', COMMENT: 'COMMENT' })
  scope?: 'READ' | 'COMMENT';
}

@Controller('shares')
export class SharesController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateShareDto) {
    const share = await this.prisma.share.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        watcherId: dto.watcherId,
        scope: (dto.scope as any) ?? 'READ',
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        activity: 'Shared',
        attrs: { watcherId: dto.watcherId, scope: dto.scope ?? 'READ' },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: dto.watcherId,
        type: 'Shared',
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        payload: { scope: dto.scope ?? 'READ' },
      },
    });
    return share;
  }
}
