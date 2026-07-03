import { Controller, Get, Post, Body, Param, Query, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// OT 검증 페이지에서 승인/반려를 최종 확정할 수 있는 단 한 계정.
// 홍정수 대표의 Teams/M365 로그인 계정(User.email = M365 UPN). 시스템 전반의 관리자 식별 이메일과 동일.
// (소문자로 저장 — 비교 시 양쪽 소문자로 맞춰 대소문자 차이 방지)
const OT_OVERRIDE_EMAIL = 'json@cams2002.onmicrosoft.com';
const isOtOverrideUser = (email?: string | null) => String(email || '').trim().toLowerCase() === OT_OVERRIDE_EMAIL;

type AccessRecord = {
  id: number;
  source: string;
  employee_id: string;
  employee_name: string;
  access_time: string;
  access_date: string;
  location: string;
  gate: string;
  direction: string;
  access_type: string;
};

type VerificationStatus = 'OK' | 'WARN' | 'FAIL' | 'NO_DATA';

type OtWithVerification = {
  id: string;
  userId: string;
  userName: string;
  employeeNo: string | null;
  teamName: string;
  date: string;
  startAt: string;
  endAt: string;
  hours: number;
  reason: string | null;
  status: string;
  // 검증 결과
  verified: boolean;
  verificationStatus: VerificationStatus;
  beforeRecord: AccessRecord | null;
  afterRecord: AccessRecord | null;
  allRecords: AccessRecord[];
  verificationNote: string;
  isHolidayWorkDuplicate: boolean; // 대체근무일과 중복 여부
};

@Controller('ot-verification')
export class OtVerificationController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getOtVerification(
    @Query('month') month?: string,
    @Query('userId') userId?: string,
    @Query('actorId') actorId?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
    @Query('unverifiedOnly') unverifiedOnly?: string,
  ) {
    // 기본값: 이번 달
    const now = new Date();
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, mon] = targetMonth.split('-').map(Number);

    // KST 기준 월 시작/종료
    const lastDay = new Date(year, mon, 0).getDate();
    const monthStart = new Date(`${year}-${String(mon).padStart(2, '0')}-01T00:00:00+09:00`);
    const monthEnd = new Date(`${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59+09:00`);

    // 요청자 권한 확인
    let isExec = false;
    let canOverride = false; // 승인/반려 최종 확정 권한 (지정 계정만)
    if (actorId) {
      const actor = await (this.prisma as any).user.findUnique({
        where: { id: actorId },
        select: { role: true, email: true },
      });
      isExec = actor?.role === 'CEO' || actor?.role === 'EXEC';
      canOverride = isOtOverrideUser(actor?.email);
    }

    // OT 신청 조회 (HOLIDAY_WORK 제외, OT만)
    const where: any = {
      type: 'OT',
      date: { gte: monthStart, lte: monthEnd },
    };

    // 임원이 아니면 본인 기록만
    if (!isExec && actorId) {
      where.userId = actorId;
    } else if (userId) {
      where.userId = userId;
    }

    const otRequests = await (this.prisma as any).attendanceRequest.findMany({
      where,
      orderBy: [{ date: 'desc' }, { startAt: 'desc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            orgUnit: { select: { name: true } },
          },
        },
      },
    });

    // 같은 기간의 HOLIDAY_WORK 조회 (대체근무일 체크용)
    const holidayWorkWhere: any = {
      type: 'HOLIDAY_WORK',
      date: { gte: monthStart, lte: monthEnd },
    };
    if (!isExec && actorId) {
      holidayWorkWhere.userId = actorId;
    } else if (userId) {
      holidayWorkWhere.userId = userId;
    }
    const holidayWorkRecords = await (this.prisma as any).attendanceRequest.findMany({
      where: holidayWorkWhere,
      select: { userId: true, date: true },
    });
    // userId+date 조합으로 Set 생성
    const holidayWorkSet = new Set<string>();
    for (const hw of holidayWorkRecords) {
      const dateStr = new Date(hw.date).toISOString().slice(0, 10);
      holidayWorkSet.add(`${hw.userId}:${dateStr}`);
    }

    // 결재 상태 조회
    const otIds = otRequests.map((r: any) => r.id);
    const approvals = otIds.length
      ? await this.prisma.approvalRequest.findMany({
          where: { subjectType: 'ATTENDANCE', subjectId: { in: otIds } },
          select: { subjectId: true, status: true },
        })
      : [];
    const approvalStatusMap = new Map<string, string>();
    for (const a of approvals) approvalStatusMap.set(a.subjectId, a.status as string);

    // 사번 조회를 위한 사용자 정보
    const userIds = [...new Set(otRequests.map((r: any) => r.userId))];
    const users = await (this.prisma as any).user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true, employeeNo: true },
    });
    const userMap = new Map<string, { email: string; name: string; employeeNo: string | null }>();
    for (const u of users) userMap.set(u.id, { email: u.email, name: u.name, employeeNo: u.employeeNo });

    // CAMS API로 입출입 기록 조회
    const startDate = monthStart.toISOString().slice(0, 10);
    const endDate = monthEnd.toISOString().slice(0, 10);

    const results: OtWithVerification[] = [];

    for (const ot of otRequests) {
      const user = userMap.get(ot.userId);
      const approvalStatus = approvalStatusMap.get(ot.id) || ot.status || 'PENDING';

      // 사번: User.employeeNo 필드 사용
      const employeeNo = user?.employeeNo || null;

      const otDate = new Date(ot.date).toISOString().slice(0, 10);
      const otStartAt = ot.startAt ? new Date(ot.startAt) : null;
      const otEndAt = ot.endAt ? new Date(ot.endAt) : null;

      // 대체근무일 여부 체크
      const isHolidayWorkDate = holidayWorkSet.has(`${ot.userId}:${otDate}`);

      // 입출입 기록 조회 (OT 날짜 전후 1일씩 포함)
      let accessRecords: AccessRecord[] = [];
      let verificationNote = '';

      // 대체근무일에 OT 신청된 경우 비고 표시
      if (isHolidayWorkDate) {
        verificationNote = '⚠️ 대체근무일(휴일근무)과 중복 - OT 대신 휴일근무 신청 필요';
      }

      const userName = ot.user?.name || user?.name || '';
      if (employeeNo || userName) {
        try {
          // OT 날짜만 조회 (해당 날짜의 첫 기록=출근, 마지막 기록=퇴근)
          accessRecords = await this.fetchAccessRecords(employeeNo || '', otDate, otDate, userName);
        } catch (e: any) {
          verificationNote = `입출입 기록 조회 실패: ${e.message}`;
        }
      } else {
        verificationNote = '사번/이름 정보 없음';
      }

      // OT 검증 로직
      const { verified, verificationStatus, beforeRecord, afterRecord, note } = this.verifyOt(
        accessRecords,
        otStartAt,
        otEndAt,
        otDate,
      );

      // 사번 없으면 NO_DATA 상태로
      const finalStatus: VerificationStatus = !employeeNo ? 'NO_DATA' : verificationStatus;
      if (!verificationNote) verificationNote = note;

      const hours = otStartAt && otEndAt
        ? (otEndAt.getTime() - otStartAt.getTime()) / (1000 * 60 * 60)
        : 0;

      const item: OtWithVerification = {
        id: ot.id,
        userId: ot.userId,
        userName: ot.user?.name || user?.name || '',
        employeeNo,
        teamName: ot.user?.orgUnit?.name || '',
        date: otDate,
        startAt: otStartAt?.toISOString() || '',
        endAt: otEndAt?.toISOString() || '',
        hours,
        reason: ot.reason,
        status: approvalStatus,
        verified: finalStatus === 'OK' && !isHolidayWorkDate,
        verificationStatus: isHolidayWorkDate ? 'WARN' : finalStatus,
        beforeRecord,
        afterRecord,
        allRecords: accessRecords,
        verificationNote,
        isHolidayWorkDuplicate: isHolidayWorkDate,
      };

      // 필터링
      if (verifiedOnly === 'true' && !verified) continue;
      if (unverifiedOnly === 'true' && verified) continue;

      results.push(item);
    }

    // 요약 통계
    const summary = {
      total: results.length,
      verified: results.filter((r) => r.verificationStatus === 'OK').length,
      warn: results.filter((r) => r.verificationStatus === 'WARN').length,
      fail: results.filter((r) => r.verificationStatus === 'FAIL').length,
      noData: results.filter((r) => r.verificationStatus === 'NO_DATA').length,
      totalHours: results.reduce((sum, r) => sum + r.hours, 0),
      verifiedHours: results.filter((r) => r.verificationStatus === 'OK').reduce((sum, r) => sum + r.hours, 0),
    };

    return { month: targetMonth, items: results, summary, canOverride };
  }

  // OT 승인/반려 최종 확정 (지정 계정만). 실제 결재 상태 + 근태 상태를 확정하고 결재 단계도 맞춘다.
  @Post(':id/decision')
  async overrideDecision(
    @Param('id') id: string,
    @Body() body: { actorId?: string; decision?: string; comment?: string },
  ) {
    const actorId = String(body?.actorId || '');
    if (!actorId) throw new ForbiddenException('로그인 정보가 필요합니다');
    const actor = await (this.prisma as any).user.findUnique({
      where: { id: actorId },
      select: { email: true, name: true },
    });
    if (!actor || !isOtOverrideUser(actor.email)) {
      throw new ForbiddenException('OT 승인/반려를 최종 확정할 권한이 없습니다');
    }

    const decision = String(body?.decision || '').toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new BadRequestException("decision은 'APPROVED' 또는 'REJECTED'여야 합니다");
    }

    const ot = await (this.prisma as any).attendanceRequest.findUnique({
      where: { id },
      select: { id: true, type: true },
    });
    if (!ot) throw new BadRequestException('대상 OT 신청을 찾을 수 없습니다');

    const now = new Date();
    const comment = String(body?.comment || '').trim() || `OT검증 최종확정 (${actor.name || ''})`;

    await (this.prisma as any).$transaction(async (tx: any) => {
      // 결재요청 + 단계 갱신 (승인이면 모든 단계 APPROVED, 반려면 모든 단계 REJECTED)
      const approval = await tx.approvalRequest.findFirst({
        where: { subjectType: 'ATTENDANCE', subjectId: id },
        include: { steps: true },
      });
      if (approval) {
        await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: decision } });
        for (const s of approval.steps || []) {
          await tx.approvalStep.update({ where: { id: s.id }, data: { status: decision, actedAt: now, comment } });
        }
      }
      // 근태 상태 동기화
      await tx.attendanceRequest.update({ where: { id }, data: { status: decision } });
      // 감사 로그
      await tx.event.create({
        data: {
          subjectType: 'ATTENDANCE',
          subjectId: id,
          activity: 'OtDecisionOverride',
          userId: actorId,
          attrs: { decision, by: actor.email, comment },
        },
      });
    });

    return { ok: true, id, status: decision };
  }

  @Get('access-records')
  async getAccessRecords(
    @Query('employeeId') employeeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!employeeId) throw new BadRequestException('employeeId 필요');
    if (!startDate) throw new BadRequestException('startDate 필요');

    const records = await this.fetchAccessRecords(
      employeeId,
      startDate,
      endDate || startDate,
    );

    return { count: records.length, records };
  }

  @Get('daily-report')
  async dailyAccessReport(
    @Query('date') date?: string,
    @Query('actorId') actorId?: string,
  ) {
    if (!date) throw new BadRequestException('date 필요 (YYYY-MM-DD)');

    // 권한 확인
    let isExec = false;
    if (actorId) {
      const actor = await (this.prisma as any).user.findUnique({
        where: { id: actorId },
        select: { role: true },
      });
      isExec = actor?.role === 'CEO' || actor?.role === 'EXEC';
    }
    if (!isExec) throw new BadRequestException('임원 권한 필요');

    const startAt = new Date(date + 'T00:00:00+09:00');
    const endAt = new Date(date + 'T23:59:59+09:00');

    // 해당 날짜 전체 입출입 기록 조회
    const ktLogs = await (this.prisma as any).ktAccessLog.findMany({
      where: { eventAt: { gte: startAt, lte: endAt } },
      orderBy: { eventAt: 'asc' },
    });
    const secomLogs = await (this.prisma as any).secomAlarm.findMany({
      where: { eventAt: { gte: startAt, lte: endAt } },
      orderBy: { eventAt: 'asc' },
    });
    const capsLogs = await (this.prisma as any).capsAlarm.findMany({
      where: { eventAt: { gte: startAt, lte: endAt } },
      orderBy: { eventAt: 'asc' },
    });

    // 해당 날짜 OT 신청 조회 (KST 기준 동일하게)
    const otRequests = await (this.prisma as any).attendanceRequest.findMany({
      where: {
        type: 'OT',
        date: { gte: startAt, lte: endAt },
      },
      include: {
        user: { select: { id: true, name: true, employeeNo: true } },
      },
    });

    const formatLog = (log: any, source: string) => ({
      source,
      eventAt: log.eventAt?.toISOString() || '',
      employeeNo: log.employeeNo || '',
      personName: log.personName || '',
      location: log.gateName || log.zoneName || log.doorName || '',
      direction: log.direction || '',
    });

    const allAccessRecords = [
      ...ktLogs.map((l: any) => formatLog(l, 'KT')),
      ...secomLogs.map((l: any) => formatLog(l, 'SECOM')),
      ...capsLogs.map((l: any) => formatLog(l, 'CAPS')),
    ].sort((a, b) => new Date(a.eventAt).getTime() - new Date(b.eventAt).getTime());

    const otList = otRequests.map((ot: any) => ({
      id: ot.id,
      userId: ot.userId,
      userName: ot.user?.name || '',
      employeeNo: ot.user?.employeeNo || '',
      startAt: ot.startAt?.toISOString() || '',
      endAt: ot.endAt?.toISOString() || '',
      reason: ot.reason || '',
    }));

    return {
      date,
      summary: {
        ktCount: ktLogs.length,
        secomCount: secomLogs.length,
        capsCount: capsLogs.length,
        totalAccessRecords: allAccessRecords.length,
        otCount: otList.length,
      },
      accessRecords: allAccessRecords,
      otRequests: otList,
    };
  }

  private extractEmployeeNo(email: string): string | null {
    if (!email) return null;
    // 이메일에서 사번 추출 시도 (예: 103485@company.com → 103485)
    const match = email.match(/^(\d+)@/);
    if (match) return match[1];
    // 이메일 앞부분이 숫자가 아니면 null
    return null;
  }

  private async fetchAccessRecords(
    employeeNo: string,
    startDate: string,
    endDate?: string,
    personName?: string,
  ): Promise<AccessRecord[]> {
    // 로컬 DB에서 조회 (KtAccessLog, SecomAlarm, CapsAlarm 통합)
    const startAt = new Date(startDate + 'T00:00:00+09:00');
    const endAt = new Date((endDate || startDate) + 'T23:59:59+09:00');

    console.log(`[OT-Verification] 입출입 조회: employeeNo=${employeeNo}, personName=${personName}, startDate=${startDate}, endDate=${endDate}`);

    const results: AccessRecord[] = [];

    // 1. KtAccessLog (케이티텔레캅 - 복지동, 정문) - 해당 날짜 전체 조회
    const ktLogs = await (this.prisma as any).ktAccessLog.findMany({
      where: { eventAt: { gte: startAt, lte: endAt } },
      orderBy: { eventAt: 'asc' },
    });
    // 사번 또는 이름 일치하는 것만 결과에 추가
    const ktFiltered = ktLogs.filter((log: any) =>
      (employeeNo && log.employeeNo === employeeNo) ||
      (personName && log.personName === personName)
    );
    for (const log of ktFiltered) {
      results.push({
        id: log.id,
        source: 'KT',
        employee_id: log.employeeNo || '',
        employee_name: log.personName || '',
        access_time: log.eventAt?.toISOString() || '',
        access_date: log.eventAt?.toISOString().slice(0, 10) || '',
        location: log.gateName || '',
        gate: log.gateId || '',
        direction: log.direction || '',
        access_type: 'ACCESS',
      });
    }

    // 2. SecomAlarm (에스원 - 함평공장) - 해당 날짜 전체 조회, 이름으로 필터
    const secomLogs = await (this.prisma as any).secomAlarm.findMany({
      where: { eventAt: { gte: startAt, lte: endAt } },
      orderBy: { eventAt: 'asc' },
    });
    const secomFiltered = secomLogs.filter((log: any) => personName && log.personName === personName);
    const secomCount = secomFiltered.length;
    for (const log of secomFiltered) {
      results.push({
        id: log.id,
        source: 'SECOM',
        employee_id: log.employeeNo || '',
        employee_name: log.personName || '',
        access_time: log.eventAt?.toISOString() || '',
        access_date: log.eventAt?.toISOString().slice(0, 10) || '',
        location: log.zoneName || '',
        gate: log.zoneId || '',
        direction: log.direction || '',
        access_type: log.alarmType || 'ACCESS',
      });
    }

    // 3. CapsAlarm (캡스 - 사무실) - 해당 날짜 전체 조회
    const capsLogs = await (this.prisma as any).capsAlarm.findMany({
      where: { eventAt: { gte: startAt, lte: endAt } },
      orderBy: { eventAt: 'asc' },
    });
    const capsFiltered = capsLogs.filter((log: any) =>
      (employeeNo && log.employeeNo === employeeNo) ||
      (personName && log.personName === personName)
    );
    for (const log of capsFiltered) {
      results.push({
        id: log.id,
        source: 'CAPS',
        employee_id: log.employeeNo || '',
        employee_name: log.personName || '',
        access_time: log.eventAt?.toISOString() || '',
        access_date: log.eventAt?.toISOString().slice(0, 10) || '',
        location: log.doorName || '',
        gate: log.doorId || '',
        direction: log.direction || '',
        access_type: log.alarmType || 'ACCESS',
      });
    }

    // 시간순 정렬
    results.sort((a, b) => new Date(a.access_time).getTime() - new Date(b.access_time).getTime());

    console.log(`[OT-Verification] 입출입 조회 결과:`);
    console.log(`  KT: 전체=${ktLogs.length}, 매칭=${ktFiltered.length}`);
    console.log(`  SECOM: 전체=${secomLogs.length}, 매칭=${secomCount}`);
    console.log(`  CAPS: 전체=${capsLogs.length}, 매칭=${capsFiltered.length}`);
    console.log(`  최종 결과: ${results.length}건`);
    return results;
  }

  private verifyOt(
    records: AccessRecord[],
    otStart: Date | null,
    otEnd: Date | null,
    otDate: string,
  ): {
    verified: boolean;
    verificationStatus: VerificationStatus;
    beforeRecord: AccessRecord | null;
    afterRecord: AccessRecord | null;
    note: string;
  } {
    if (!otStart || !otEnd) {
      return { verified: false, verificationStatus: 'NO_DATA', beforeRecord: null, afterRecord: null, note: 'OT 시간 정보 없음' };
    }

    if (records.length === 0) {
      return { verified: false, verificationStatus: 'FAIL', beforeRecord: null, afterRecord: null, note: '입출입 기록 없음' };
    }

    // 시간순 정렬
    const sorted = [...records].sort(
      (a, b) => new Date(a.access_time).getTime() - new Date(b.access_time).getTime(),
    );

    // 단순 로직: 첫 기록 = 출근, 마지막 기록 = 퇴근
    const firstRecord = sorted[0];
    const lastRecord = sorted[sorted.length - 1];

    const firstTime = new Date(firstRecord.access_time);
    const lastTime = new Date(lastRecord.access_time);

    // 검증: 퇴근 시간이 OT 종료 시간 이후인지
    let verificationStatus: VerificationStatus = 'OK';
    let note = '';

    if (sorted.length === 1) {
      // 기록이 1개뿐
      verificationStatus = 'WARN';
      note = `입출입 기록 1건만 있음 (${firstTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })})`;
    } else if (lastTime.getTime() < otEnd.getTime()) {
      // 마지막 기록이 OT 종료 전
      verificationStatus = 'WARN';
      note = `퇴근(${lastTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })})이 OT종료(${otEnd.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })}) 전`;
    } else {
      // 정상
      verificationStatus = 'OK';
      note = `출근 ${firstTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} / 퇴근 ${lastTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })}`;
    }

    const verified = verificationStatus === 'OK';

    return { verified, verificationStatus, beforeRecord: firstRecord, afterRecord: lastRecord, note };
  }
}
