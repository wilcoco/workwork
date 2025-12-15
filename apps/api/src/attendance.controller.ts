import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateAttendanceDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  approverId?: string;

  @IsString()
  @IsIn(['OT', 'VACATION', 'EARLY_LEAVE'])
  type!: 'OT' | 'VACATION' | 'EARLY_LEAVE';

  @IsString()
  date!: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  startTime?: string; // HH:MM

  @IsOptional()
  @IsString()
  endTime?: string; // HH:MM

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('attendance')
export class AttendanceController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateAttendanceDto) {
    try {
      if (!dto.userId) throw new BadRequestException('userId가 필요합니다');
      if (!dto.date) throw new BadRequestException('date가 필요합니다');

      const baseDate = new Date(`${dto.date}T00:00:00.000Z`);
      if (isNaN(baseDate.getTime())) throw new BadRequestException('유효하지 않은 날짜입니다');

      let startAt: Date | undefined;
      let endAt: Date | undefined;
      if (dto.type === 'OT' || dto.type === 'EARLY_LEAVE') {
        if (!dto.startTime || !dto.endTime) throw new BadRequestException('시간을 입력해 주세요');
        const s = new Date(`${dto.date}T${dto.startTime}:00.000Z`);
        const e = new Date(`${dto.date}T${dto.endTime}:00.000Z`);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new BadRequestException('유효하지 않은 시간입니다');
        if (e <= s) throw new BadRequestException('종료 시간이 시작 시간보다 같거나 이를 수 없습니다');
        startAt = s;
        endAt = e;
      }

      const approverId = dto.approverId || dto.userId;

      const rec = await this.prisma.$transaction(async (tx) => {
        const attendance = await tx.attendanceRequest.create({
          data: {
            userId: dto.userId,
            type: dto.type,
            date: baseDate,
            startAt,
            endAt,
            reason: dto.reason,
          },
        });

        const approval = await tx.approvalRequest.create({
          data: {
            subjectType: 'ATTENDANCE',
            subjectId: attendance.id,
            approverId,
            requestedById: dto.userId,
          },
        });

        await tx.approvalStep.create({
          data: {
            requestId: approval.id,
            stepNo: 1,
            approverId,
            status: 'PENDING' as any,
          },
        });

        await tx.event.create({
          data: {
            subjectType: 'ATTENDANCE',
            subjectId: attendance.id,
            activity: 'ApprovalRequested',
            userId: dto.userId,
            attrs: { approverId, requestId: approval.id, steps: 1 },
          },
        });

        await tx.notification.create({
          data: {
            userId: approverId,
            type: 'ApprovalRequested',
            subjectType: 'ATTENDANCE',
            subjectId: attendance.id,
            payload: { requestId: approval.id, subjectType: 'ATTENDANCE' },
          },
        });

        return attendance;
      });

      return rec;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to create attendance', e);
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(e?.message || '근태 신청에 실패했습니다');
    }
  }

  @Get('calendar')
  async calendar(@Query('month') month?: string, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId가 필요합니다');
    const base = month ? new Date(month + '-01T00:00:00.000Z') : new Date();
    if (isNaN(base.getTime())) throw new BadRequestException('유효하지 않은 month');

    const year = base.getUTCFullYear();
    const mon = base.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    // fetch a bit wider range (one week before/after)
    const rangeStart = new Date(monthStart);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - 7);
    const rangeEnd = new Date(monthEnd);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 7);

    const items = await this.prisma.attendanceRequest.findMany({
      where: {
        userId,
        date: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: { date: 'asc' },
      include: { user: true },
    });

    type WeekAgg = { otHours: number; vacationHours: number; earlyLeaveHours: number };
    const weekMap = new Map<string, WeekAgg>();

    const getWeekKey = (d: Date): string => {
      // Monday-based week: find Monday of this week
      const day = d.getUTCDay(); // 0=Sun
      const offsetToMonday = (day + 6) % 7; // Sun->6, Mon->0, ...
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      monday.setUTCDate(monday.getUTCDate() - offsetToMonday);
      return monday.toISOString().slice(0, 10); // YYYY-MM-DD
    };

    const hoursBetween = (s: Date, e: Date): number => {
      const diffMs = e.getTime() - s.getTime();
      if (diffMs <= 0) return 0;
      return diffMs / (1000 * 60 * 60);
    };

    for (const it of items) {
      const d = it.date;
      const weekKey = getWeekKey(d as any as Date);
      let agg = weekMap.get(weekKey);
      if (!agg) {
        agg = { otHours: 0, vacationHours: 0, earlyLeaveHours: 0 };
        weekMap.set(weekKey, agg);
      }
      if (it.type === 'OT') {
        if (it.startAt && it.endAt) {
          agg.otHours += hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
        }
      } else if (it.type === 'VACATION') {
        agg.vacationHours += 8; // 1일 8시간
      } else if (it.type === 'EARLY_LEAVE') {
        if (it.startAt && it.endAt) {
          agg.earlyLeaveHours += hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
        }
      }
    }

    const result = items.map((it: { id: string; type: 'OT' | 'VACATION' | 'EARLY_LEAVE'; date: Date; startAt: Date | null; endAt: Date | null; reason: string | null; user: { name: string } }) => {
      const weekKey = getWeekKey(it.date as any as Date);
      const agg = weekMap.get(weekKey) || { otHours: 0, vacationHours: 0, earlyLeaveHours: 0 };
      const totalHours = 40 + agg.otHours - agg.vacationHours - agg.earlyLeaveHours;
      const overLimit = totalHours > 52;
      return {
        id: it.id,
        type: it.type,
        date: it.date,
        startAt: it.startAt,
        endAt: it.endAt,
        reason: it.reason,
        requesterName: it.user?.name ?? '',
        overLimit,
      };
    });

    return { items: result };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const rec = await this.prisma.attendanceRequest.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!rec) throw new BadRequestException('not found');

    return {
      id: rec.id,
      type: rec.type,
      date: rec.date,
      startAt: rec.startAt,
      endAt: rec.endAt,
      reason: rec.reason,
      requesterId: rec.userId,
      requesterName: rec.user?.name ?? '',
      createdAt: rec.createdAt,
    };
  }
}
