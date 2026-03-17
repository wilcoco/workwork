import { Body, Controller, Delete, Get, Param, Post, Put, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, IsDateString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateScheduleDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() milestones?: any;
  @IsOptional() @IsString() manualId?: string;
}

class UpdateScheduleDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() milestones?: any;
  @IsOptional() @IsString() status?: string;
}

@Controller('schedules')
export class SchedulesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('manualId') manualId?: string,
    @Query('status') status?: string,
  ) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (manualId) where.manualId = manualId;
    if (status) where.status = status;
    const items = await this.prisma.schedule.findMany({
      where,
      orderBy: { startDate: 'asc' },
      take: 100,
    });
    return { items };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const s = await this.prisma.schedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('일정을 찾을 수 없습니다.');
    return s;
  }

  @Post()
  async create(@Body() dto: CreateScheduleDto) {
    const uid = String(dto.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BadRequestException('user not found');

    const s = await this.prisma.schedule.create({
      data: {
        userId: uid,
        title: dto.title,
        description: dto.description || null,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        milestones: dto.milestones || null,
        manualId: dto.manualId || null,
      },
    });
    return s;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateScheduleDto) {
    const uid = String(dto.userId || '').trim();
    const s = await this.prisma.schedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('일정을 찾을 수 없습니다.');
    if (s.userId !== uid) throw new BadRequestException('소유자만 수정할 수 있습니다.');

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.milestones !== undefined) data.milestones = dto.milestones;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.prisma.schedule.update({ where: { id }, data });
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const s = await this.prisma.schedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('일정을 찾을 수 없습니다.');
    if (userId && s.userId !== userId) throw new BadRequestException('소유자만 삭제할 수 있습니다.');
    await this.prisma.schedule.delete({ where: { id } });
    return { ok: true };
  }

  // 매뉴얼에서 자동 생성
  @Post('from-manual/:manualId')
  async createFromManual(@Param('manualId') manualId: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const manual = await this.prisma.workManual.findUnique({ where: { id: manualId } });
    if (!manual) throw new NotFoundException('매뉴얼을 찾을 수 없습니다.');

    const phaseData = (manual.phaseData as any) || {};
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 3);

    const milestones = phaseData?.phase4?.milestones || [
      { name: '착수', date: now.toISOString().slice(0, 10), done: false },
      { name: '중간점검', date: new Date(now.getTime() + 45 * 86400000).toISOString().slice(0, 10), done: false },
      { name: '완료', date: endDate.toISOString().slice(0, 10), done: false },
    ];

    const s = await this.prisma.schedule.create({
      data: {
        userId: uid,
        manualId,
        title: manual.title + ' — 일정',
        description: `매뉴얼 「${manual.title}」에서 자동 생성된 일정`,
        startDate: now,
        endDate,
        milestones,
      },
    });
    return s;
  }
}
