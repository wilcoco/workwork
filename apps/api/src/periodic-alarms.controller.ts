import { Body, Controller, Delete, Get, Param, Post, Put, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsNumber } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateAlarmDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() intervalDays?: number;
  @IsOptional() @IsString() cronExpression?: string;
  @IsOptional() checkItems?: any;
  @IsOptional() @IsString() manualId?: string;
}

class UpdateAlarmDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() intervalDays?: number;
  @IsOptional() @IsString() cronExpression?: string;
  @IsOptional() checkItems?: any;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('periodic-alarms')
export class PeriodicAlarmsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('manualId') manualId?: string,
    @Query('isActive') isActive?: string,
  ) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (manualId) where.manualId = manualId;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    const items = await this.prisma.periodicAlarm.findMany({
      where,
      orderBy: { nextRunAt: 'asc' },
      take: 100,
    });
    return { items };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const a = await this.prisma.periodicAlarm.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('주기알람을 찾을 수 없습니다.');
    return a;
  }

  @Post()
  async create(@Body() dto: CreateAlarmDto) {
    const uid = String(dto.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BadRequestException('user not found');

    const intervalDays = dto.intervalDays || 30;
    const nextRunAt = new Date();
    nextRunAt.setDate(nextRunAt.getDate() + intervalDays);

    const a = await this.prisma.periodicAlarm.create({
      data: {
        userId: uid,
        title: dto.title,
        description: dto.description || null,
        intervalDays,
        cronExpression: dto.cronExpression || null,
        nextRunAt,
        checkItems: dto.checkItems || null,
        manualId: dto.manualId || null,
      },
    });
    return a;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAlarmDto) {
    const uid = String(dto.userId || '').trim();
    const a = await this.prisma.periodicAlarm.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('주기알람을 찾을 수 없습니다.');
    if (a.userId !== uid) throw new BadRequestException('소유자만 수정할 수 있습니다.');

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.intervalDays !== undefined) {
      data.intervalDays = dto.intervalDays;
      const next = new Date();
      next.setDate(next.getDate() + dto.intervalDays);
      data.nextRunAt = next;
    }
    if (dto.cronExpression !== undefined) data.cronExpression = dto.cronExpression;
    if (dto.checkItems !== undefined) data.checkItems = dto.checkItems;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.periodicAlarm.update({ where: { id }, data });
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const a = await this.prisma.periodicAlarm.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('주기알람을 찾을 수 없습니다.');
    if (userId && a.userId !== userId) throw new BadRequestException('소유자만 삭제할 수 있습니다.');
    await this.prisma.periodicAlarm.delete({ where: { id } });
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
    const options = (manual.options as any) || {};
    const selectedFreq = Object.values(options).flat().find((o: any) =>
      ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(String(o))
    );
    const intervalMap: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };
    const intervalDays = intervalMap[String(selectedFreq)] || 30;

    const nextRunAt = new Date();
    nextRunAt.setDate(nextRunAt.getDate() + intervalDays);

    const checkItems = phaseData?.phase4?.checkItems || [
      { label: '점검 항목 1', done: false },
      { label: '점검 항목 2', done: false },
    ];

    const a = await this.prisma.periodicAlarm.create({
      data: {
        userId: uid,
        manualId,
        title: manual.title + ' — 주기알람',
        description: `매뉴얼 「${manual.title}」에서 자동 생성된 주기 점검 알람`,
        intervalDays,
        nextRunAt,
        checkItems,
      },
    });
    return a;
  }

  // 실행 완료 처리 (다음 주기로 이동)
  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() body: { userId: string }) {
    const a = await this.prisma.periodicAlarm.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('주기알람을 찾을 수 없습니다.');

    const now = new Date();
    const nextRunAt = new Date(now);
    nextRunAt.setDate(nextRunAt.getDate() + a.intervalDays);

    const updated = await this.prisma.periodicAlarm.update({
      where: { id },
      data: { lastRunAt: now, nextRunAt },
    });
    return updated;
  }
}
