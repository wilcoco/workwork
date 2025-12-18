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
  @IsIn(['OT', 'VACATION', 'EARLY_LEAVE', 'FLEXIBLE'])
  type!: 'OT' | 'VACATION' | 'EARLY_LEAVE' | 'FLEXIBLE';

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
      if (dto.type === 'OT' || dto.type === 'EARLY_LEAVE' || dto.type === 'FLEXIBLE') {
        if (!dto.startTime || !dto.endTime) throw new BadRequestException('시간을 입력해 주세요');
        // 입력된 시간은 한국 시간(KST) 기준으로 해석한다.
        const s = new Date(`${dto.date}T${dto.startTime}:00+09:00`);
        const e = new Date(`${dto.date}T${dto.endTime}:00+09:00`);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new BadRequestException('유효하지 않은 시간입니다');
        if (e <= s) throw new BadRequestException('종료 시간이 시작 시간보다 같거나 이를 수 없습니다');
        startAt = s;
        endAt = e;
      }

      const approverId = dto.approverId || dto.userId;

      const rec = await (this.prisma as any).$transaction(async (tx: any) => {
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

    const items = await (this.prisma as any).attendanceRequest.findMany({
      where: {
        ...(userId ? { userId } : {}),
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

    const ids = items.map((it: any) => it.id as string);

    const approvals = ids.length
      ? await this.prisma.approvalRequest.findMany({
          where: {
            subjectType: 'ATTENDANCE',
            subjectId: { in: ids },
          },
          select: { subjectId: true, status: true },
        })
      : [];

    const statusMap = new Map<string, string>();
    for (const a of approvals) statusMap.set(a.subjectId, a.status as any);

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
      const status = statusMap.get(it.id) || 'PENDING';
      return {
        id: it.id,
        type: it.type,
        date: it.date,
        startAt: it.startAt,
        endAt: it.endAt,
        reason: it.reason,
        requesterName: it.user?.name ?? '',
        status,
        overLimit,
      };
    });

    return { items: result };
  }

  @Get('weekly-hours')
  async weeklyHours(
    @Query('userId') userId?: string,
    @Query('date') dateStr?: string, // 기준 일자 (YYYY-MM-DD)
    @Query('type') type?: 'OT' | 'VACATION' | 'EARLY_LEAVE',
    @Query('startTime') startTime?: string, // HH:MM
    @Query('endTime') endTime?: string,   // HH:MM
  ) {
    if (!userId) throw new BadRequestException('userId가 필요합니다');
    if (!dateStr) throw new BadRequestException('date가 필요합니다');

    // 기준 일자를 "캘린더 상의 날짜"로 보고, 토~금 주간을 계산한다.
    // DB에는 UTC로 저장되어 있으므로, 주간 범위도 UTC로 계산한다.
    const baseUtc = new Date(`${dateStr}T00:00:00Z`); // 해당 날짜의 UTC 자정
    if (isNaN(baseUtc.getTime())) throw new BadRequestException('유효하지 않은 date');

    // 토요일 시작 주 (0=Sun..6=Sat)
    const day = baseUtc.getUTCDay();
    const diffToSat = -((day + 1) % 7); // 토요일까지의 오프셋
    const weekStartUtc = new Date(Date.UTC(baseUtc.getUTCFullYear(), baseUtc.getUTCMonth(), baseUtc.getUTCDate() + diffToSat, 0, 0, 0, 0));
    const weekEndUtc = new Date(Date.UTC(weekStartUtc.getUTCFullYear(), weekStartUtc.getUTCMonth(), weekStartUtc.getUTCDate() + 6, 23, 59, 59, 999));

    // 주간 공휴일 조회 (법정/비법정 모두 근무일에서 제외)
    const holidays = await (this.prisma as any).holiday.findMany({
      where: {
        date: { gte: weekStartUtc, lte: weekEndUtc },
      },
    });
    const holidaySet = new Set<string>();
    for (const h of holidays as any[]) {
      const d = new Date(h.date);
      holidaySet.add(d.toISOString().slice(0, 10));
    }

    // 기본 근무시간: 해당 주의 평일(월~금) 중 공휴일이 아닌 날 8시간/일 (KST 캘린더 기준과 동일하게 취급)
    // 동시에 일자별 baseHours를 기록해 둔다. (키는 YYYY-MM-DD)
    let baseHours = 0;
    const dayBaseMap = new Map<string, number>(); // YYYY-MM-DD -> baseHours
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(Date.UTC(weekStartUtc.getUTCFullYear(), weekStartUtc.getUTCMonth(), weekStartUtc.getUTCDate() + i, 0, 0, 0, 0));
      const dow = d.getUTCDay();
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      let h = 0;
      if (dow >= 1 && dow <= 5 && !holidaySet.has(key)) {
        h = 8;
      }
      dayBaseMap.set(key, h);
      baseHours += h;
    }

    // 해당 주의 근태 신청 내역 (기존 OT/휴가/조퇴)
    const records = await (this.prisma as any).attendanceRequest.findMany({
      where: {
        userId,
        date: { gte: weekStartUtc, lte: weekEndUtc },
      },
      orderBy: { date: 'asc' },
    });

    let otHours = 0;
    let vacationHours = 0;
    let earlyLeaveHours = 0;
    let flexibleAdjust = 0; // 유연근무는 기본 8시간으로 보고, 별도 조정은 사용하지 않는다 (향후 확장 대비 변수만 유지)

    // 일자별 세부 집계
    type DayAgg = { base: number; ot: number; vacation: number; earlyLeave: number; flexibleAdj: number };
    const dayAggMap = new Map<string, DayAgg>(); // key: YYYY-MM-DD
    const getDayAgg = (key: string): DayAgg => {
      let agg = dayAggMap.get(key);
      if (!agg) {
        agg = { base: dayBaseMap.get(key) ?? 0, ot: 0, vacation: 0, earlyLeave: 0, flexibleAdj: 0 };
        dayAggMap.set(key, agg);
      }
      return agg;
    };

    const hoursBetween = (s: Date, e: Date): number => {
      const diffMs = e.getTime() - s.getTime();
      if (diffMs <= 0) return 0;
      return diffMs / (1000 * 60 * 60);
    };

    for (const it of records as any[]) {
      const d = new Date(it.date);
      const dow = d.getDay();
      const key = d.toISOString().slice(0, 10);
      const agg = getDayAgg(key);

      if (it.type === 'OT') {
        if (it.startAt && it.endAt) {
          const h = hoursBetween(it.startAt, it.endAt);
          otHours += h;
          agg.ot += h;
        }
      } else if (it.type === 'VACATION') {
        // 휴가 1일 = 8시간 차감 (평일 기준, 공휴일은 이미 base에서 빠져 있으므로 추가 차감 없음)
        if (dow >= 1 && dow <= 5 && !holidaySet.has(key)) {
          vacationHours += 8;
          agg.vacation += 8;
        }
      } else if (it.type === 'EARLY_LEAVE') {
        if (it.startAt && it.endAt) {
          const h = hoursBetween(it.startAt, it.endAt);
          earlyLeaveHours += h;
          agg.earlyLeave += h;
        }
      } else if (it.type === 'FLEXIBLE') {
        // 현재 규칙: 유연근무가 있어도 해당 평일은 기본 8시간 근무로 본다.
        // 실제 근무시간에 따른 추가/감산은 하지 않으므로 여기서는 조정하지 않는다.
      }
    }

    // 현재 화면에서 선택 중인 신규 신청(아직 DB에 없는 것)을 가상으로 반영
    if (type === 'OT') {
      if (startTime && endTime) {
        const s = new Date(`${dateStr}T${startTime}:00+09:00`);
        const e = new Date(`${dateStr}T${endTime}:00+09:00`);
        const h = hoursBetween(s, e);
        otHours += h;
        const key = dateStr;
        const agg = getDayAgg(key);
        agg.ot += h;
      }
    } else if (type === 'VACATION') {
      const d = new Date(`${dateStr}T00:00:00+09:00`);
      const dow = d.getDay();
      const key = d.toISOString().slice(0, 10);
      if (dow >= 1 && dow <= 5 && !holidaySet.has(key)) {
        vacationHours += 8;
        const agg = getDayAgg(key);
        agg.vacation += 8;
      }
    } else if (type === 'EARLY_LEAVE') {
      if (startTime && endTime) {
        const s = new Date(`${dateStr}T${startTime}:00+09:00`);
        const e = new Date(`${dateStr}T${endTime}:00+09:00`);
        const h = hoursBetween(s, e);
        earlyLeaveHours += h;
        const key = dateStr;
        const agg = getDayAgg(key);
        agg.earlyLeave += h;
      }
    } else if (type === 'FLEXIBLE') {
      // 현재 규칙: 유연근무 선택 시에도 하루 기본 8시간으로만 계산하고,
      // 주 52시간 계산에는 추가 가감하지 않는다.
    }

    const weeklyHours = (baseHours + flexibleAdjust) + otHours - vacationHours - earlyLeaveHours;

    // 일자별 totalHours 계산 (UI에서 breakdown 용도)
    const days: { date: string; totalHours: number }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(Date.UTC(weekStartUtc.getUTCFullYear(), weekStartUtc.getUTCMonth(), weekStartUtc.getUTCDate() + i, 0, 0, 0, 0));
      const key = d.toISOString().slice(0, 10);
      const agg = getDayAgg(key);
      const total = (agg.base + agg.flexibleAdj) + agg.ot - agg.vacation - agg.earlyLeave;
      days.push({ date: key, totalHours: total });
    }

    return {
      userId,
      weekStart: weekStartUtc,
      weekEnd: weekEndUtc,
      baseHours,
      otHours,
      vacationHours,
      earlyLeaveHours,
      weeklyHours,
      days,
    };
  }

  @Get('monthly-report')
  async monthlyReport(@Query('month') month?: string) {
    const base = month ? new Date(month + '-01T00:00:00.000Z') : new Date();
    if (isNaN(base.getTime())) throw new BadRequestException('유효하지 않은 month');

    const year = base.getUTCFullYear();
    const mon = base.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    const items = await (this.prisma as any).attendanceRequest.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      orderBy: { date: 'asc' },
      include: { user: true },
    });

    type WeekAgg = { otHours: number; vacationDays: number; earlyLeaveHours: number };
    type UserAgg = {
      userId: string;
      userName: string;
      otHoursTotal: number;
      vacationDays: number;
      earlyLeaveHoursTotal: number;
      weekly: { weekKey: string; weeklyHours: number }[];
    };

    const userWeekMap = new Map<string, Map<string, WeekAgg>>(); // userId -> weekKey -> agg

    const getWeekKey = (d: Date): string => {
      // 토요일 시작 주 (0=Sun..6=Sat)
      const day = d.getUTCDay();
      const diffToSat = -((day + 1) % 7);
      const sat = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToSat, 0, 0, 0, 0));
      return sat.toISOString().slice(0, 10); // YYYY-MM-DD (토요일 날짜)
    };

    const hoursBetween = (s: Date, e: Date): number => {
      const diffMs = e.getTime() - s.getTime();
      if (diffMs <= 0) return 0;
      return diffMs / (1000 * 60 * 60);
    };

    for (const it of items) {
      const uId = it.userId as string;
      if (!uId) continue;
      const d = it.date as any as Date;
      const weekKey = getWeekKey(d);

      let weekMap = userWeekMap.get(uId);
      if (!weekMap) {
        weekMap = new Map<string, WeekAgg>();
        userWeekMap.set(uId, weekMap);
      }
      let agg = weekMap.get(weekKey);
      if (!agg) {
        agg = { otHours: 0, vacationDays: 0, earlyLeaveHours: 0 };
        weekMap.set(weekKey, agg);
      }

      if (it.type === 'OT') {
        if (it.startAt && it.endAt) {
          agg.otHours += hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
        }
      } else if (it.type === 'VACATION') {
        agg.vacationDays += 1;
      } else if (it.type === 'EARLY_LEAVE') {
        if (it.startAt && it.endAt) {
          agg.earlyLeaveHours += hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
        }
      }
    }

    const userIds = Array.from(new Set(items.map((it: any) => it.userId).filter(Boolean))) as string[];
    const result: UserAgg[] = [];

    for (const userId of userIds) {
      const userItems = items.filter((it: any) => it.userId === userId);
      const name = userItems[0]?.user?.name ?? '';
      const weekMap = userWeekMap.get(userId) ?? new Map<string, WeekAgg>();

      let otHoursTotal = 0;
      let vacationDays = 0;
      let earlyLeaveHoursTotal = 0;
      const weekly: { weekKey: string; weeklyHours: number }[] = [];

      const sortedWeeks = Array.from(weekMap.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [weekKey, agg] of sortedWeeks) {
        otHoursTotal += agg.otHours;
        vacationDays += agg.vacationDays;
        earlyLeaveHoursTotal += agg.earlyLeaveHours;

        // 단순화된 주당 근무시간: 기본 40시간에서 휴가/조퇴를 빼고 OT를 더한다.
        const weeklyHours = 40 + agg.otHours - (agg.vacationDays * 8) - agg.earlyLeaveHours;
        weekly.push({ weekKey, weeklyHours });
      }

      result.push({
        userId,
        userName: name,
        otHoursTotal,
        vacationDays,
        earlyLeaveHoursTotal,
        weekly,
      });
    }

    return { month: month || `${year}-${String(mon + 1).padStart(2, '0')}`, items: result };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const rec = await (this.prisma as any).attendanceRequest.findUnique({
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
