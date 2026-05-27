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
    @Query('verifiedOnly') verifiedOnly?: string,
    @Query('unverifiedOnly') unverifiedOnly?: string,
  ) {
    // 기본값: 이번 달
    const now = new Date();
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, mon] = targetMonth.split('-').map(Number);

    const monthStart = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, mon, 0, 23, 59, 59, 999));

    // OT 신청 조회 (APPROVED 상태만)
    const where: any = {
      type: { in: ['OT', 'HOLIDAY_WORK'] },
      date: { gte: monthStart, lte: monthEnd },
      status: 'PENDING', // 모든 상태 포함하려면 주석 처리
    };
    if (userId) where.userId = userId;

    // status 조건 제거 - 모든 OT 보여주기
    delete where.status;

    const otRequests = await (this.prisma as any).attendanceRequest.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startAt: 'asc' }],
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

      // 입출입 기록 조회
      let accessRecords: AccessRecord[] = [];
      let verificationNote = '';

      if (employeeNo) {
        try {
          accessRecords = await this.fetchAccessRecords(employeeNo, otDate);
        } catch (e: any) {
          verificationNote = `입출입 기록 조회 실패: ${e.message}`;
        }
      } else {
        verificationNote = '사번 정보 없음';
      }

      // OT 검증 로직
      const { verified, beforeRecord, afterRecord, note } = this.verifyOt(
        accessRecords,
        otStartAt,
        otEndAt,
        otDate,
      );

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
        verified,
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
      verified: results.filter((r) => r.verified).length,
      unverified: results.filter((r) => !r.verified).length,
      totalHours: results.reduce((sum, r) => sum + r.hours, 0),
      verifiedHours: results.filter((r) => r.verified).reduce((sum, r) => sum + r.hours, 0),
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
    beforeRecord: AccessRecord | null;
    afterRecord: AccessRecord | null;
    note: string;
  } {
    if (!otStart || !otEnd) {
      return { verified: false, beforeRecord: null, afterRecord: null, note: 'OT 시간 정보 없음' };
    }

    if (records.length === 0) {
      return { verified: false, beforeRecord: null, afterRecord: null, note: '입출입 기록 없음' };
    }

    // 시간순 정렬
    const sorted = [...records].sort(
      (a, b) => new Date(a.access_time).getTime() - new Date(b.access_time).getTime(),
    );

    // OT 시작 전 마지막 기록 (30분 여유)
    const startThreshold = new Date(otStart.getTime() - 30 * 60 * 1000);
    let beforeRecord: AccessRecord | null = null;
    for (const r of sorted) {
      const t = new Date(r.access_time);
      if (t <= otStart) {
        beforeRecord = r;
      }
    }

    // OT 종료 후 첫 기록 (자정 넘김 고려, 다음날 06시까지)
    const endThreshold = new Date(otEnd.getTime() + 6 * 60 * 60 * 1000);
    let afterRecord: AccessRecord | null = null;
    for (const r of sorted) {
      const t = new Date(r.access_time);
      if (t >= otEnd && t <= endThreshold) {
        afterRecord = r;
        break;
      }
    }

    // 검증 로직
    // 1. OT 시작 전 출입 기록이 있어야 함 (이미 회사에 있었음을 증명)
    // 2. OT 종료 후 퇴출 기록이 있어야 함 (OT 후 퇴근 증명)
    // 단, 실무적으로는 OT 시간대에 기록이 하나라도 있으면 인정하는 경우도 있음

    // 느슨한 검증: OT 시간대 전후로 기록이 있으면 OK
    const hasBeforeOrDuring = sorted.some((r) => {
      const t = new Date(r.access_time);
      return t <= otEnd;
    });
    const hasAfterOrDuring = sorted.some((r) => {
      const t = new Date(r.access_time);
      return t >= otStart;
    });

    const verified = hasBeforeOrDuring && hasAfterOrDuring;

    let note = '';
    if (!beforeRecord && !afterRecord) {
      note = 'OT 시간대 전후 기록 없음';
    } else if (!beforeRecord) {
      note = 'OT 시작 전 기록 없음 (출근 기록 미확인)';
    } else if (!afterRecord) {
      note = 'OT 종료 후 기록 없음 (퇴근 기록 미확인)';
    } else {
      note = '입출입 기록 확인됨';
    }

    return { verified, beforeRecord, afterRecord, note };
  }
}
