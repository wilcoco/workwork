import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateAttendanceDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  approverId?: string;

  // Multi-step approval line, in order. When provided, an
  // ApprovalRequest is created with one ApprovalStep per id and the
  // request flows step-by-step (same semantics as ApprovalsController).
  // When omitted, the legacy single-approver flow (`approverId`) is
  // used so existing callers keep working.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  approverIds?: string[];

  @IsString()
  @IsIn(['OT', 'VACATION', 'EARLY_LEAVE', 'FLEXIBLE', 'HOLIDAY_WORK', 'PUBLIC_DUTY', 'PARENTAL_LEAVE'])
  type!: 'OT' | 'VACATION' | 'EARLY_LEAVE' | 'FLEXIBLE' | 'HOLIDAY_WORK' | 'PUBLIC_DUTY' | 'PARENTAL_LEAVE';

  @IsString()
  date!: string; // YYYY-MM-DD (기간 신청 시 시작일)

  // 기간 신청 종료일(YYYY-MM-DD). 휴가/육아휴직 등 연속 기간을 한 건으로 신청할 때 사용.
  // 생략하면 date 하루짜리 신청.
  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  startTime?: string; // HH:MM (legacy)

  @IsOptional()
  @IsString()
  endTime?: string; // HH:MM (legacy)

  @IsOptional()
  @IsString()
  startAt?: string; // ISO datetime (new: e.g. 2026-05-26T17:00:00+09:00)

  @IsOptional()
  @IsString()
  endAt?: string; // ISO datetime (new: e.g. 2026-05-26T21:00:00+09:00)

  @IsOptional()
  @IsString()
  reason?: string;

  // 휴일 대체 신청 전용: 휴일 근무일 = date, 대체 휴무일 = altRestDate
  @IsOptional()
  @IsString()
  altRestDate?: string; // YYYY-MM-DD

  // 첨부파일: Array of { url, name, size?, type? }
  @IsOptional()
  @IsArray()
  attachments?: { url: string; name: string; size?: number; type?: string }[];
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

      // 기간 신청(휴가/육아휴직): endDate 가 오면 date~endDate 를 한 건으로 처리.
      // 기간 모드는 종일 휴무 유형에만 허용한다.
      const DAY_OFF_TYPES = ['VACATION', 'PUBLIC_DUTY', 'PARENTAL_LEAVE'] as const;
      const isDayOff = (DAY_OFF_TYPES as readonly string[]).includes(dto.type);
      let rangeEndDate: Date | undefined;
      if (dto.endDate) {
        if (!isDayOff) throw new BadRequestException('기간 신청은 휴가·공가·육아휴직만 가능합니다');
        const e = new Date(`${dto.endDate}T00:00:00.000Z`);
        if (isNaN(e.getTime())) throw new BadRequestException('유효하지 않은 종료일입니다');
        if (e.getTime() < baseDate.getTime()) throw new BadRequestException('종료일은 시작일보다 빠를 수 없습니다');
        // 시작일과 같으면 하루짜리이므로 endDate 는 저장하지 않는다.
        if (e.getTime() > baseDate.getTime()) rangeEndDate = e;
      }
      // 충돌 검사용 기간 끝(종료일 또는 시작일)
      const rangeEnd = rangeEndDate ?? baseDate;

      let startAt: Date | undefined;
      let endAt: Date | undefined;
      if (dto.type === 'OT' || dto.type === 'EARLY_LEAVE' || dto.type === 'FLEXIBLE' || dto.type === 'HOLIDAY_WORK') {
        // 새 포맷: startAt/endAt (ISO datetime) 우선, 없으면 기존 date+startTime/endTime 사용
        if (dto.startAt && dto.endAt) {
          const s = new Date(dto.startAt);
          const e = new Date(dto.endAt);
          if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new BadRequestException('유효하지 않은 시작/종료 일시입니다');
          startAt = s;
          endAt = e;
        } else if (dto.startTime && dto.endTime) {
          // 기존 포맷: date + startTime/endTime
          const s = new Date(`${dto.date}T${dto.startTime}:00+09:00`);
          let e = new Date(`${dto.date}T${dto.endTime}:00+09:00`);
          if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new BadRequestException('유효하지 않은 시간입니다');
          // 종료 시간이 시작 시간보다 이르면 자정을 넘긴 것으로 판단 (다음날)
          if (e <= s) {
            e = new Date(e.getTime() + 24 * 60 * 60 * 1000); // +1일
          }
          startAt = s;
          endAt = e;
        } else {
          throw new BadRequestException('시작/종료 일시를 입력해 주세요');
        }
      }

      // Resolve the approval line. Prefer the explicit ordered
      // `approverIds[]` (결재선); fall back to the single legacy
      // `approverId`; finally to self-approval if neither is set.
      const lineRaw = Array.isArray(dto.approverIds)
        ? dto.approverIds.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      // De-dupe consecutive duplicates so the user can't accidentally
      // create "A → A → B" lines that would auto-progress in a weird
      // way. Non-consecutive duplicates are preserved on purpose
      // (some companies do require the same person at two stages).
      const approverLine: string[] = [];
      for (const id of lineRaw) {
        if (approverLine[approverLine.length - 1] !== id) approverLine.push(id);
      }
      const firstApprover = approverLine[0] || dto.approverId || dto.userId;

      const rec = await (this.prisma as any).$transaction(async (tx: any) => {
        // 기간 겹침 검사: 새 신청 [baseDate, rangeEnd] 와 기존 신청 [date, endDate ?? date] 가
        // 겹치는지 본다. 기존.date <= 새.rangeEnd 인 후보를 받아, 기존.end >= 새.baseDate 인 것만 충돌.
        const overlapCandidates = await tx.attendanceRequest.findMany({
          where: {
            userId: dto.userId,
            date: { lte: rangeEnd },
            status: { notIn: ['REJECTED', 'CANCELLED', 'rejected', 'cancelled'] as any },
          },
          select: { id: true, type: true, date: true, endDate: true, startAt: true, endAt: true },
        });
        const overlapping = overlapCandidates.filter((r: any) => {
          const rEnd: Date = r.endDate ?? r.date;
          return rEnd.getTime() >= baseDate.getTime();
        });

        const DAY_OFF = DAY_OFF_TYPES as readonly string[];
        const typeKo = (t: string) => t === 'VACATION' ? '휴가' : t === 'PUBLIC_DUTY' ? '공가' : t === 'PARENTAL_LEAVE' ? '육아휴직' : '근태';
        if (isDayOff) {
          // 종일 휴무(휴가/공가/육아휴직)는 다른 "종일 휴무"와만 충돌. 시간제 근태(OT 등)와는 공존 가능.
          const dayOffHit = overlapping.find((r: any) => DAY_OFF.includes(r.type));
          if (dayOffHit) {
            throw new BadRequestException(rangeEndDate
              ? '신청 기간에 이미 휴가·공가·육아휴직이 있어 신청할 수 없습니다'
              : `해당 일자에 이미 휴가·공가·육아휴직이 있어 ${typeKo(dto.type)}를 신청할 수 없습니다`);
          }
        } else {
          // 시간제 근태(OT/조기퇴근/유연근무/휴일근무): 시간이 겹치는 "시간제 근태"와만 충돌.
          // 종일 휴무(휴가 등)와는 시간이 겹치지 않으므로 함께 신청 가능 (예: 휴가일 저녁 OT).
          if (startAt && endAt) {
            const timeHit = overlapping.find((r: any) =>
              !DAY_OFF.includes(r.type) && r.startAt && r.endAt &&
              new Date(r.startAt).getTime() < (endAt as Date).getTime() &&
              (startAt as Date).getTime() < new Date(r.endAt).getTime(),
            );
            if (timeHit) throw new BadRequestException('같은 시간대에 이미 다른 근태 신청이 있어 신청할 수 없습니다');
          }
        }

        // 휴일 대체 신청: HOLIDAY_WORK + HOLIDAY_REST 두 건 생성
        let attendance = null as any;
        if (dto.type === 'HOLIDAY_WORK') {
          if (!dto.altRestDate) throw new BadRequestException('대체 휴일을 선택해 주세요');

          const workDateUtc = baseDate;
          const restDateUtc = new Date(`${dto.altRestDate}T00:00:00.000Z`);
          if (isNaN(restDateUtc.getTime())) throw new BadRequestException('유효하지 않은 대체 휴일입니다');

          const holidayRec = await (tx as any).holiday.findUnique({ where: { date: workDateUtc } });
          const dowWork = workDateUtc.getUTCDay();
          if (!(dowWork === 0 || dowWork === 6 || holidayRec)) {
            throw new BadRequestException('휴일 대체 신청의 근무일은 토/일/공휴일만 가능합니다');
          }

          // 대체휴무는 하루치(8시간)와 맞바꾸는 제도이므로 휴일근무가 8시간 이상이어야 한다.
          // 8시간 미만은 OT로 신청해야 한다.
          const holidayWorkHours = (startAt && endAt) ? (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60) : 0;
          if (holidayWorkHours < 8) {
            throw new BadRequestException('휴일근무는 8시간 이상만 대체휴무로 신청할 수 있습니다. 8시간 미만은 OT로 신청하세요.');
          }

          // 같은 주(토~금)인지 확인
          const getWeekKey = (d: Date): string => {
            const day = d.getUTCDay();
            const diffToSat = -((day + 1) % 7);
            const sat = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToSat, 0, 0, 0, 0));
            return sat.toISOString().slice(0, 10);
          };
          const wk1 = getWeekKey(workDateUtc);
          const wk2 = getWeekKey(restDateUtc);
          if (wk1 !== wk2) throw new BadRequestException('대체 휴일은 같은 주(토~금) 안의 평일이어야 합니다');

          const dowRest = restDateUtc.getUTCDay();
          const holidayRest = await (tx as any).holiday.findUnique({ where: { date: restDateUtc } });
          if (!(dowRest >= 1 && dowRest <= 5) || holidayRest) {
            throw new BadRequestException('대체 휴일은 평일(월~금)이고 공휴일이 아니어야 합니다');
          }

          // 근무일/대체 휴무일 모두 휴가와는 함께 신청할 수 없다.
          const vacationOnWork = await tx.attendanceRequest.findFirst({
            where: {
              userId: dto.userId,
              type: 'VACATION',
              date: workDateUtc,
              status: { notIn: ['REJECTED', 'CANCELLED'] as any },
            },
          });
          if (vacationOnWork) {
            throw new BadRequestException('해당 휴일 근무일에 이미 휴가가 신청되어 있어 휴일 대체 신청을 할 수 없습니다');
          }
          const vacationOnRest = await tx.attendanceRequest.findFirst({
            where: {
              userId: dto.userId,
              type: 'VACATION',
              date: restDateUtc,
              status: { notIn: ['REJECTED', 'CANCELLED'] as any },
            },
          });
          if (vacationOnRest) {
            throw new BadRequestException('대체 휴일로 지정한 날에 이미 휴가가 신청되어 있어 휴일 대체 신청을 할 수 없습니다');
          }

          // 휴일 근무 시간 중복 체크 (create 전에 수행) - 같은 유형 + 다른 시간 기반 유형(OT, EARLY_LEAVE, FLEXIBLE)
          const timeBasedOverlap = await tx.attendanceRequest.findFirst({
            where: {
              userId: dto.userId,
              date: workDateUtc,
              type: { in: ['HOLIDAY_WORK', 'OT', 'EARLY_LEAVE', 'FLEXIBLE'] as any },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              status: { notIn: ['REJECTED', 'CANCELLED'] as any },
            },
          });
          if (timeBasedOverlap) {
            throw new BadRequestException('해당 시간에 이미 다른 근태 신청이 있습니다 (휴일근무/야근/조퇴/유연근무)');
          }

          // 근무일 레코드 (HOLIDAY_WORK)
          const workReq = await tx.attendanceRequest.create({
            data: {
              userId: dto.userId,
              type: 'HOLIDAY_WORK',
              date: workDateUtc,
              startAt,
              endAt,
              reason: dto.reason ? `${dto.reason} (대체휴일: ${dto.altRestDate})` : `대체휴일: ${dto.altRestDate}`,
              attachments: dto.attachments ? dto.attachments : undefined,
            },
          });

          // 대체 휴무일 레코드 (HOLIDAY_REST)
          const restReq = await tx.attendanceRequest.findFirst({
            where: {
              userId: dto.userId,
              type: 'HOLIDAY_REST',
              date: restDateUtc,
              status: { notIn: ['REJECTED', 'CANCELLED'] as any },
            },
          });
          if (restReq) {
            throw new BadRequestException('대체 휴일은 이미 신청되었습니다');
          }
          await tx.attendanceRequest.create({
            data: {
              userId: dto.userId,
              type: 'HOLIDAY_REST',
              date: restDateUtc,
              reason: dto.reason ? `${dto.reason} (휴일근무: ${dto.date})` : `휴일근무: ${dto.date}`,
            },
          });

          attendance = workReq;
        } else {
          // 같은 날 시간 기반 근태 신청 중복 방지 (OT/휴가/조퇴/유연근무 등 시간이 있는 유형 전체)
          if (startAt && endAt) {
            const timeBasedTypes = ['OT', 'EARLY_LEAVE', 'FLEXIBLE', 'HOLIDAY_WORK'] as any;
            if (timeBasedTypes.includes(dto.type)) {
              const overlap = await tx.attendanceRequest.findFirst({
                where: {
                  userId: dto.userId,
                  date: baseDate,
                  type: { in: timeBasedTypes },
                  startAt: { lt: endAt },
                  endAt: { gt: startAt },
                  status: { notIn: ['REJECTED', 'CANCELLED', 'rejected', 'cancelled'] as any },
                },
              });
              if (overlap) {
                console.log('[attendance] overlap found:', JSON.stringify({ id: overlap.id, status: overlap.status, type: overlap.type, date: overlap.date }));
                throw new BadRequestException(`해당 시간에 이미 다른 근태 신청이 있습니다 (휴일근무/야근/조퇴/유연근무) - 기존신청: ${overlap.id}, 상태: ${overlap.status}`);
              }
            }
          }
          attendance = await tx.attendanceRequest.create({
            data: {
              userId: dto.userId,
              type: dto.type,
              date: baseDate,
              endDate: rangeEndDate,
              startAt,
              endAt,
              reason: dto.reason,
              attachments: dto.attachments ? dto.attachments : undefined,
            },
          });
        }

        // The ApprovalRequest's `approverId` always points at the
        // *current* approver (i.e. the first step's approver at
        // creation time). Subsequent steps move the pointer forward
        // — see ApprovalsController#approve.
        const approval = await tx.approvalRequest.create({
          data: {
            subjectType: 'ATTENDANCE',
            subjectId: attendance.id,
            approverId: firstApprover,
            requestedById: dto.userId,
          },
        });

        // Build the actual ordered step list. If the user passed an
        // explicit `approverIds[]`, materialise one step per id.
        // Otherwise fall back to a single self-or-legacy step (keeps
        // backwards compatibility with older clients).
        const stepsToCreate = approverLine.length > 0 ? approverLine : [firstApprover];
        for (let i = 0; i < stepsToCreate.length; i += 1) {
          await tx.approvalStep.create({
            data: {
              requestId: approval.id,
              stepNo: i + 1,
              approverId: stepsToCreate[i],
              status: 'PENDING' as any,
            },
          });
        }

        await tx.event.create({
          data: {
            subjectType: 'ATTENDANCE',
            subjectId: attendance.id,
            activity: 'ApprovalRequested',
            userId: dto.userId,
            attrs: {
              approverId: firstApprover,
              requestId: approval.id,
              steps: stepsToCreate.length,
              line: stepsToCreate,
            },
          },
        });

        // Only notify the very first approver — later approvers will
        // be notified in turn when each prior step is approved (see
        // ApprovalsController#approve).
        await tx.notification.create({
          data: {
            userId: firstApprover,
            type: 'ApprovalRequested',
            subjectType: 'ATTENDANCE',
            subjectId: attendance.id,
            payload: { requestId: approval.id, subjectType: 'ATTENDANCE', requestedById: dto.userId },
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

    // 기간(endDate) 신청도 누락 없이: 시작일 <= rangeEnd 이고 종료일(없으면 시작일) >= rangeStart 인 건.
    const records = await (this.prisma as any).attendanceRequest.findMany({
      where: {
        ...(userId ? { userId } : {}),
        date: { lte: rangeEnd },
        OR: [
          { endDate: { gte: rangeStart } },
          { endDate: null, date: { gte: rangeStart } },
        ],
      },
      orderBy: { date: 'asc' },
      include: { user: true },
    });

    // 기간 안의 공휴일 (주말과 함께 휴가일수에서 제외)
    const holidayRows = await (this.prisma as any).holiday.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      select: { date: true },
    });
    const holidaySet = new Set<string>(holidayRows.map((h: any) => (h.date as Date).toISOString().slice(0, 10)));

    type WeekAgg = { otHours: number; vacationHours: number; earlyLeaveHours: number; holidayBaseHours: number };
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

    const ids = records.map((it: any) => it.id as string);

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

    // 기간 휴무(endDate 있는 휴가/공가/육아휴직)는 평일(주말·공휴일 제외)별 일자로 펼친다.
    // 그 외(시간 기반 근태, 하루짜리 휴무)는 기존대로 1건 = 1일.
    const DAY_OFF_TYPES = ['VACATION', 'PUBLIC_DUTY', 'PARENTAL_LEAVE'];
    type Occ = { it: any; day: Date };
    const occs: Occ[] = [];
    for (const it of records) {
      if (it.endDate && DAY_OFF_TYPES.includes(it.type)) {
        const startMs = Math.max((it.date as Date).getTime(), rangeStart.getTime());
        const endMs = Math.min((it.endDate as Date).getTime(), rangeEnd.getTime());
        let cur = new Date(startMs);
        cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), 0, 0, 0, 0));
        for (; cur.getTime() <= endMs; cur = new Date(cur.getTime() + 86400000)) {
          const dow = cur.getUTCDay();
          if (dow === 0 || dow === 6) continue; // 주말 제외
          if (holidaySet.has(cur.toISOString().slice(0, 10))) continue; // 공휴일 제외
          occs.push({ it, day: new Date(cur) });
        }
      } else {
        occs.push({ it, day: it.date as Date });
      }
    }

    for (const { it, day } of occs) {
      const weekKey = `${it.userId}::${getWeekKey(day)}`; // 개인별 주간 집계
      let agg = weekMap.get(weekKey);
      if (!agg) {
        agg = { otHours: 0, vacationHours: 0, earlyLeaveHours: 0, holidayBaseHours: 0 };
        weekMap.set(weekKey, agg);
      }
      if (it.type === 'OT') {
        if (it.startAt && it.endAt) {
          agg.otHours += hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
        }
      } else if (it.type === 'HOLIDAY_WORK') {
        if (it.startAt && it.endAt) {
          const h = hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
          agg.otHours += Math.max(0, h - 8);       // 8시간 초과분만 OT
          agg.holidayBaseHours += Math.min(h, 8);  // 8시간은 대체휴무와 맞교환(근무시간 인정, OT 아님)
        }
      } else if (DAY_OFF_TYPES.includes(it.type) || it.type === 'HOLIDAY_REST') {
        agg.vacationHours += 8; // 1일 8시간
      } else if (it.type === 'EARLY_LEAVE') {
        if (it.startAt && it.endAt) {
          agg.earlyLeaveHours += hoursBetween(it.startAt as any as Date, it.endAt as any as Date);
        }
      }
    }

    const result = occs.map(({ it, day }) => {
      const weekKey = `${it.userId}::${getWeekKey(day)}`; // 개인별 주간 집계
      const agg = weekMap.get(weekKey) || { otHours: 0, vacationHours: 0, earlyLeaveHours: 0, holidayBaseHours: 0 };
      const totalHours = 40 + agg.otHours + agg.holidayBaseHours - agg.vacationHours - agg.earlyLeaveHours;
      const overLimit = totalHours > 52;
      const recordStatus = it.status;
      const approvalStatus = statusMap.get(it.id);
      const status = recordStatus === 'CANCELLED' ? 'CANCELLED' : (approvalStatus || 'PENDING');
      return {
        id: it.id,
        userId: it.userId,
        type: it.type,
        date: day,
        endDate: it.endDate ?? null,
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
    @Query('type') type?: 'OT' | 'VACATION' | 'EARLY_LEAVE' | 'HOLIDAY_WORK',
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

    // 해당 주의 근태 신청 내역 (OT/휴가/조퇴/유연근무/휴일대체)
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
    let holidayBaseHours = 0; // 휴일근무 중 대체휴무와 맞교환된 부분(최대 8h): 근무시간 인정, OT 아님
    let flexibleAdjust = 0; // 유연근무는 기본 8시간으로 보고, 별도 조정은 사용하지 않는다 (향후 확장 대비 변수만 유지)

    // 일자별 세부 집계
    type DayAgg = { base: number; ot: number; vacation: number; earlyLeave: number; flexibleAdj: number; holidayBase: number };
    const dayAggMap = new Map<string, DayAgg>(); // key: YYYY-MM-DD
    const getDayAgg = (key: string): DayAgg => {
      let agg = dayAggMap.get(key);
      if (!agg) {
        agg = { base: dayBaseMap.get(key) ?? 0, ot: 0, vacation: 0, earlyLeave: 0, flexibleAdj: 0, holidayBase: 0 };
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
      } else if (it.type === 'VACATION' || it.type === 'PUBLIC_DUTY' || it.type === 'HOLIDAY_REST') {
        // 휴가/공가 1일 = 8시간 차감 (평일 기준, 공휴일은 이미 base에서 빠져 있으므로 추가 차감 없음)
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
      } else if (it.type === 'HOLIDAY_WORK') {
        if (it.startAt && it.endAt) {
          const h = hoursBetween(it.startAt, it.endAt);
          const otPortion = Math.max(0, h - 8);   // 8시간 초과분만 OT
          const basePortion = Math.min(h, 8);     // 8시간은 대체휴무와 맞교환(근무시간 인정)
          otHours += otPortion;
          agg.ot += otPortion;
          holidayBaseHours += basePortion;
          agg.holidayBase += basePortion;
        }
      }
    }

    // 현재 화면에서 선택 중인 신규 신청(아직 DB에 없는 것)을 가상으로 반영
    // 자정 넘김 처리 함수
    const adjustEndTime = (s: Date, e: Date): Date => {
      if (e <= s) return new Date(e.getTime() + 24 * 60 * 60 * 1000);
      return e;
    };
    if (type === 'OT') {
      if (startTime && endTime) {
        const s = new Date(`${dateStr}T${startTime}:00+09:00`);
        let e = new Date(`${dateStr}T${endTime}:00+09:00`);
        e = adjustEndTime(s, e);
        const h = hoursBetween(s, e);
        otHours += h;
        const key = dateStr;
        const agg = getDayAgg(key);
        agg.ot += h;
      }
    } else if (type === 'HOLIDAY_WORK') {
      if (startTime && endTime) {
        const s = new Date(`${dateStr}T${startTime}:00+09:00`);
        let e = new Date(`${dateStr}T${endTime}:00+09:00`);
        e = adjustEndTime(s, e);
        const h = hoursBetween(s, e);
        const otPortion = Math.max(0, h - 8);   // 8시간 초과분만 OT
        const basePortion = Math.min(h, 8);     // 8시간은 대체휴무와 맞교환
        otHours += otPortion;
        holidayBaseHours += basePortion;
        const key = dateStr;
        const agg = getDayAgg(key);
        agg.ot += otPortion;
        agg.holidayBase += basePortion;
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
        let e = new Date(`${dateStr}T${endTime}:00+09:00`);
        e = adjustEndTime(s, e);
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

    const weeklyHours = (baseHours + flexibleAdjust) + otHours + holidayBaseHours - vacationHours - earlyLeaveHours;

    // 일자별 totalHours 계산 (UI에서 breakdown 용도)
    const days: { date: string; totalHours: number }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(Date.UTC(weekStartUtc.getUTCFullYear(), weekStartUtc.getUTCMonth(), weekStartUtc.getUTCDate() + i, 0, 0, 0, 0));
      const key = d.toISOString().slice(0, 10);
      const agg = getDayAgg(key);
      const total = (agg.base + agg.flexibleAdj) + agg.ot + agg.holidayBase - agg.vacation - agg.earlyLeave;
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
      holidayBaseHours,
      weeklyHours,
      days,
    };
  }

  @Get('monthly-report')
  async monthlyReport(
    @Query('month') month?: string,
    @Query('actorId') actorId?: string,
    @Query('type') typeFilter?: string,
    @Query('userId') userIdFilter?: string,
  ) {
    // 임원(EXEC) 이상만 조회 가능
    if (!actorId) throw new ForbiddenException('actorId required');
    const actor = await (this.prisma as any).user.findUnique({ where: { id: String(actorId) } });
    if (!actor) throw new ForbiddenException('invalid actorId');
    const role = String(actor.role || '').toUpperCase();
    if (role !== 'CEO' && role !== 'EXEC') throw new ForbiddenException('임원 이상만 근태 리포트를 조회할 수 있습니다');

    const base = month ? new Date(month + '-01T00:00:00.000Z') : new Date();
    if (isNaN(base.getTime())) throw new BadRequestException('유효하지 않은 month');

    const year = base.getUTCFullYear();
    const mon = base.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    // 기간(endDate) 신청도 포함: 시작일 <= 월말 이고 종료일(없으면 시작일) >= 월초 인 건.
    const where: any = {
      date: { lte: monthEnd },
      OR: [
        { endDate: { gte: monthStart } },
        { endDate: null, date: { gte: monthStart } },
      ],
    };
    if (typeFilter) where.type = typeFilter;
    if (userIdFilter) where.userId = userIdFilter;

    const records = await (this.prisma as any).attendanceRequest.findMany({
      where,
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
      include: { user: { select: { id: true, name: true, orgUnit: { select: { name: true } } } } },
    });

    // 기간 휴무의 '휴가일수'는 해당 월 안의 평일(주말·공휴일 제외)만 집계한다.
    const holidayRows = await (this.prisma as any).holiday.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      select: { date: true },
    });
    const reportHolidaySet = new Set<string>(holidayRows.map((h: any) => (h.date as Date).toISOString().slice(0, 10)));
    const DAY_OFF_TYPES = ['VACATION', 'PUBLIC_DUTY', 'PARENTAL_LEAVE'];
    const weekdayCountInMonth = (startD: Date, endD: Date): number => {
      const startMs = Math.max(startD.getTime(), monthStart.getTime());
      const endMs = Math.min(endD.getTime(), monthEnd.getTime());
      let cur = new Date(startMs);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), 0, 0, 0, 0));
      let count = 0;
      for (; cur.getTime() <= endMs; cur = new Date(cur.getTime() + 86400000)) {
        const dow = cur.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        if (reportHolidaySet.has(cur.toISOString().slice(0, 10))) continue;
        count += 1;
      }
      return count;
    };

    // 결재 정보 조회 (모든 결재자 포함)
    const recordIds = records.map((r: any) => r.id);
    const approvals = recordIds.length ? await (this.prisma as any).approvalRequest.findMany({
      where: { subjectType: 'ATTENDANCE', subjectId: { in: recordIds } },
      include: {
        approver: { select: { id: true, name: true } },
        steps: {
          orderBy: { stepNo: 'asc' },
          include: { approver: { select: { id: true, name: true } } }
        }
      },
    }) : [];
    console.log('[근태리포트] approvals 샘플:', JSON.stringify(approvals.slice(0, 2), null, 2));
    const approvalMap = new Map<string, any>();
    for (const a of approvals) approvalMap.set(a.subjectId, a);

    const hoursBetween = (s: any, e: any): number => {
      if (!s || !e) return 0;
      const diffMs = new Date(e).getTime() - new Date(s).getTime();
      return diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
    };

    const items = records.map((it: any) => {
      const approval = approvalMap.get(it.id);
      let currentApproverName = '';
      let approvalSteps: Array<{ stepNo: number; approverName: string; status: string; decidedAt: string | null }> = [];

      if (approval) {
        // 스텝 상태 기준으로 최종 상태 계산 (DB 불일치 보정)
        const steps = approval.steps || [];
        const allStepsApproved = steps.length > 0 && steps.every((s: any) => s.status === 'APPROVED');
        const anyStepRejected = steps.some((s: any) => s.status === 'REJECTED');

        // 실제 최종 상태: 스텝 기준 또는 근태 상태 기준 중 확정된 것
        let computedFinalStatus = it.status;
        if (allStepsApproved) computedFinalStatus = 'APPROVED';
        else if (anyStepRejected) computedFinalStatus = 'REJECTED';

        const isFinal = computedFinalStatus === 'APPROVED' || computedFinalStatus === 'REJECTED';

        // 다단계 결재 정보 - 모든 단계 포함
        if (steps.length > 0) {
          approvalSteps = steps.map((s: any) => ({
            stepNo: s.stepNo,
            approverName: s.approver?.name || '(알 수 없음)',
            status: s.status || 'PENDING',
            decidedAt: s.actedAt || null,
          }));
        }

        // steps가 없으면 메인 결재자 사용
        if (approvalSteps.length === 0 && approval.approver) {
          approvalSteps = [{
            stepNo: 1,
            approverName: approval.approver.name || '(알 수 없음)',
            status: computedFinalStatus,
            decidedAt: approval.updatedAt || null,
          }];
        }

        // 현재 결재자 (PENDING 상태일 때만)
        if (!isFinal) {
          const pendingStep = steps.find((s: any) => s.status === 'PENDING');
          currentApproverName = pendingStep?.approver?.name || approval.approver?.name || '';
        }

        // 리턴할 상태는 계산된 최종 상태 사용
        it.status = computedFinalStatus;
      }

      // 휴가일수: 기간(endDate) 신청은 해당 월 평일 수, 하루짜리 휴무는 1일.
      let days: number | null = null;
      if (DAY_OFF_TYPES.includes(it.type) || it.type === 'HOLIDAY_REST') {
        days = it.endDate ? weekdayCountInMonth(it.date as Date, it.endDate as Date) : 1;
      }
      const workedHours = (it.type === 'OT' || it.type === 'EARLY_LEAVE' || it.type === 'FLEXIBLE' || it.type === 'HOLIDAY_WORK')
        ? hoursBetween(it.startAt, it.endAt)
        : null;
      // 휴일근무: 8시간은 대체휴무와 맞교환(compHours), 초과분만 OT(otHours)
      const isHolidayWork = it.type === 'HOLIDAY_WORK';
      const otHours = isHolidayWork && workedHours != null ? Math.max(0, workedHours - 8) : null;
      const compHours = isHolidayWork && workedHours != null ? Math.min(workedHours, 8) : null;
      return {
        id: it.id,
        userId: it.userId,
        userName: it.user?.name ?? it.userId,
        teamName: it.user?.orgUnit?.name ?? '',
        type: it.type,
        date: it.date,
        endDate: it.endDate ?? null,
        startAt: it.startAt,
        endAt: it.endAt,
        hours: workedHours,
        otHours,   // 휴일근무의 OT 초과분 (그 외 유형은 null)
        compHours, // 휴일근무의 대체휴무 맞교환분 (그 외 유형은 null)
        days,
        status: it.status,
        reason: it.reason,
        currentApproverName,
        approvalSteps,
      };
    });

    return { month: month || `${year}-${String(mon + 1).padStart(2, '0')}`, items };
  }

  @Patch(':id/cancel')
  async cancel(@Param('id') id: string, @Body('userId') userId: string) {
    const rec = await (this.prisma as any).attendanceRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('신청 건을 찾을 수 없습니다');
    if (rec.status !== 'PENDING') throw new BadRequestException('대기 중인 신청만 취소할 수 있습니다');
    if (userId && rec.userId !== userId) throw new BadRequestException('본인의 신청만 취소할 수 있습니다');
    return (this.prisma as any).attendanceRequest.update({
      where: { id },
      data: { status: 'CANCELLED' as any },
    });
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
      endDate: rec.endDate ?? null,
      startAt: rec.startAt,
      endAt: rec.endAt,
      reason: rec.reason,
      requesterId: rec.userId,
      requesterName: rec.user?.name ?? '',
      createdAt: rec.createdAt,
    };
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Query('actorId') actorId?: string) {
    if (!actorId) throw new ForbiddenException('actorId required');

    const actor = await (this.prisma as any).user.findUnique({ where: { id: actorId } });
    if (!actor) throw new ForbiddenException('invalid actorId');

    const role = String(actor.role || '').toUpperCase();
    if (role !== 'CEO' && role !== 'EXEC' && role !== 'ADMIN') {
      throw new ForbiddenException('관리자만 삭제할 수 있습니다');
    }

    const rec = await (this.prisma as any).attendanceRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('신청 건을 찾을 수 없습니다');

    // 관련 ApprovalRequest와 ApprovalStep도 삭제
    await this.prisma.$transaction(async (tx) => {
      const approval = await (tx as any).approvalRequest.findFirst({
        where: { subjectType: 'ATTENDANCE', subjectId: id },
      });
      if (approval) {
        await (tx as any).approvalStep.deleteMany({ where: { approvalRequestId: approval.id } });
        await (tx as any).approvalRequest.delete({ where: { id: approval.id } });
      }
      await (tx as any).attendanceRequest.delete({ where: { id } });
    });

    return { deleted: true, id };
  }
}
