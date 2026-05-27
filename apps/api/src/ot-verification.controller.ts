import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

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
};

const CAMS_API_URL = 'https://selfservice.icams.co.kr';
const CAMS_API_KEY = process.env.ERP_API_KEY || '6147';

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

    const monthStart = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, mon, 0, 23, 59, 59, 999));

    // 요청자 권한 확인
    let isExec = false;
    if (actorId) {
      const actor = await (this.prisma as any).user.findUnique({
        where: { id: actorId },
        select: { role: true },
      });
      isExec = actor?.role === 'CEO' || actor?.role === 'EXEC';
    }

    // OT 신청 조회
    const where: any = {
      type: { in: ['OT', 'HOLIDAY_WORK'] },
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

      // 입출입 기록 조회 (OT 날짜 전후 1일씩 포함)
      let accessRecords: AccessRecord[] = [];
      let verificationNote = '';

      if (employeeNo) {
        try {
          const otDateObj = new Date(otDate);
          const dayBefore = new Date(otDateObj);
          dayBefore.setDate(dayBefore.getDate() - 1);
          const dayAfter = new Date(otDateObj);
          dayAfter.setDate(dayAfter.getDate() + 1);
          const startDateStr = dayBefore.toISOString().slice(0, 10);
          const endDateStr = dayAfter.toISOString().slice(0, 10);
          accessRecords = await this.fetchAccessRecords(employeeNo, startDateStr, endDateStr);
        } catch (e: any) {
          verificationNote = `입출입 기록 조회 실패: ${e.message}`;
        }
      } else {
        verificationNote = '사번 정보 없음';
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
        verified: finalStatus === 'OK',
        verificationStatus: finalStatus,
        beforeRecord,
        afterRecord,
        allRecords: accessRecords,
        verificationNote,
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

    return { month: targetMonth, items: results, summary };
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

  private extractEmployeeNo(email: string): string | null {
    if (!email) return null;
    // 이메일에서 사번 추출 시도 (예: 103485@company.com → 103485)
    const match = email.match(/^(\d+)@/);
    if (match) return match[1];
    // 이메일 앞부분이 숫자가 아니면 null
    return null;
  }

  private async fetchAccessRecords(
    employeeId: string,
    startDate: string,
    endDate?: string,
  ): Promise<AccessRecord[]> {
    if (!CAMS_API_KEY) {
      console.warn('[OT-Verification] ERP_API_KEY not configured');
      return [];
    }

    const params = new URLSearchParams({
      employee_id: employeeId,
      start_date: startDate,
      end_date: endDate || startDate,
      limit: '500',
    });

    try {
      const response = await fetch(
        `${CAMS_API_URL}/api/erp/access-records?${params}`,
        {
          headers: { 'x-api-key': CAMS_API_KEY },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`CAMS API error: ${response.status} - ${text}`);
      }

      const data = await response.json();
      return data.records || [];
    } catch (e: any) {
      console.error('[OT-Verification] CAMS API error:', e.message);
      throw e;
    }
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

    // OT 날짜의 시작 (당일 00:00 KST = 전날 15:00 UTC)
    const otDateObj = new Date(otDate + 'T00:00:00+09:00');
    const otDateStart = otDateObj.getTime();
    const otDateEnd = otDateStart + 24 * 60 * 60 * 1000; // 다음날 00:00

    // 평일 OT의 경우: 출근(아침)~OT종료(저녁) 패턴
    // - beforeRecord: OT 시작 전, 당일 아침~OT시작 사이 기록 (출근)
    // - afterRecord: OT 종료 후 기록 (퇴근)

    // beforeRecord: OT 시작 전 마지막 기록 (당일 06:00 이후 ~ OT 시작)
    const morningThreshold = otDateStart + 6 * 60 * 60 * 1000; // 당일 06:00 KST
    let beforeRecord: AccessRecord | null = null;
    for (const r of sorted) {
      const t = new Date(r.access_time).getTime();
      if (t <= otStart.getTime()) {
        beforeRecord = r;
      }
    }

    // afterRecord: OT 종료 후 첫 기록 (다음날 06시까지)
    const endThreshold = otEnd.getTime() + 6 * 60 * 60 * 1000;
    let afterRecord: AccessRecord | null = null;
    for (const r of sorted) {
      const t = new Date(r.access_time).getTime();
      if (t >= otEnd.getTime() && t <= endThreshold) {
        afterRecord = r;
        break;
      }
    }

    // 검증 로직 개선
    let verificationStatus: VerificationStatus = 'OK';
    let note = '';

    const hasBefore = !!beforeRecord;
    const hasAfter = !!afterRecord;

    // 출근 기록이 전날 밤인 경우 체크 (당일 06:00 이전)
    const beforeTime = beforeRecord ? new Date(beforeRecord.access_time).getTime() : 0;
    const isBeforePreviousNight = beforeRecord && beforeTime < morningThreshold;

    if (!hasBefore && !hasAfter) {
      // 둘 다 없음 → 빨강
      verificationStatus = 'FAIL';
      note = '출근/퇴근 기록 없음';
    } else if (!hasBefore) {
      // 출근 기록만 없음 → 노랑
      verificationStatus = 'WARN';
      note = '출근 기록 미확인 (OT 전 입출입 없음)';
    } else if (!hasAfter) {
      // 퇴근 기록만 없음 → 노랑
      verificationStatus = 'WARN';
      note = '퇴근 기록 미확인 (OT 후 입출입 없음)';
    } else if (isBeforePreviousNight) {
      // 출근 기록이 전날 밤 → 노랑 (들어올 때 안 찍었을 가능성)
      verificationStatus = 'WARN';
      note = '출근 기록이 전날 밤 (입실 미태깅 의심)';
    } else {
      // 둘 다 있고 정상 → 초록
      verificationStatus = 'OK';
      note = '입출입 기록 확인됨';
    }

    const verified = verificationStatus === 'OK';

    return { verified, verificationStatus, beforeRecord, afterRecord, note };
  }
}
