import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateGoalDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum({ QUALITATIVE: 'QUALITATIVE', QUANTITATIVE: 'QUANTITATIVE' } as any) kind?: 'QUALITATIVE' | 'QUANTITATIVE';
  @IsOptional() @IsString() metric?: string;
  @IsOptional() @IsNumber() target?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
}

class UpdateGoalDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum({ QUALITATIVE: 'QUALITATIVE', QUANTITATIVE: 'QUANTITATIVE' } as any) kind?: 'QUALITATIVE' | 'QUANTITATIVE';
  @IsOptional() @IsString() metric?: string;
  @IsOptional() @IsNumber() target?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
}

@Controller('my-goals')
export class MyGoalsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('userId') userId: string) {
    if (!userId) throw new Error('userId required');
    const items = await (this.prisma as any).userGoal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return { items };
  }

  @Post()
  async create(@Body() dto: CreateGoalDto) {
    const rec = await (this.prisma as any).userGoal.create({
      data: {
        userId: dto.userId,
        title: dto.title,
        description: dto.description,
        kind: (dto.kind as any) ?? 'QUALITATIVE',
        metric: dto.metric,
        target: dto.target as any,
        unit: dto.unit,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      },
    });
    return rec;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateGoalDto) {
    const rec = await (this.prisma as any).userGoal.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        kind: dto.kind as any,
        metric: dto.metric,
        target: dto.target as any,
        unit: dto.unit,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      },
    });
    return rec;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await (this.prisma as any).userGoal.delete({ where: { id } });
    return { ok: true };
  }
}
