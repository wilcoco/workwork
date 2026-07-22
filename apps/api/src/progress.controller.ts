import { BadRequestException, Body, Controller, Get, Post, Query, ForbiddenException } from '@nestjs/common';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { isAncestorOrgManager } from './lib/org-hierarchy';

class CreateProgressDto {
  @IsEnum({ KR: 'KR', INITIATIVE: 'INITIATIVE' } as any)
  subjectType!: 'KR' | 'INITIATIVE';

  @IsString() @IsNotEmpty()
  subjectId!: string; // keyResultId or initiativeId

  @IsString() @IsNotEmpty()
  actorId!: string;

  @IsOptional() @IsString()
  worklogId?: string;

  @IsOptional() @IsNumber()
  krValue?: number;

  @IsOptional() @IsBoolean()
  initiativeDone?: boolean;

  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsDateString()
  at?: string; // reference datetime to determine the period; default now
}

@Controller('progress')
export class ProgressController {
  constructor(private prisma: PrismaService) {}

  // KST helpers (UTC+9)
  private readonly KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  private toKst(utc: Date) { return new Date(utc.getTime() + this.KST_OFFSET_MS); }
  private fromKst(kst: Date) { return new Date(kst.getTime() - this.KST_OFFSET_MS); }

  private startOfMonthK(dK: Date) { return new Date(dK.getFullYear(), dK.getMonth(), 1, 0, 0, 0, 0); }
  private endOfMonthK(dK: Date) { return new Date(dK.getFullYear(), dK.getMonth() + 1, 0, 23, 59, 59, 999); }
  private startOfWeekMonK(dK: Date) {
    const day = dK.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    const res = new Date(dK.getFullYear(), dK.getMonth(), dK.getDate() + diff, 0, 0, 0, 0);
    return res;
  }
  private endOfWeekSunK(dK: Date) {
    const start = this.startOfWeekMonK(dK);
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
  }
  private quarterOfK(dK: Date) { return Math.floor(dK.getMonth() / 3); }
  private startOfQuarterK(dK: Date) { const q = this.quarterOfK(dK); return new Date(dK.getFullYear(), q * 3, 1, 0, 0, 0, 0); }
  private endOfQuarterK(dK: Date) { const q = this.quarterOfK(dK); return new Date(dK.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999); }
  private startOfHalfYearK(dK: Date) { const h = dK.getMonth() < 6 ? 0 : 6; return new Date(dK.getFullYear(), h, 1, 0, 0, 0, 0); }
  private endOfHalfYearK(dK: Date) { const h = dK.getMonth() < 6 ? 6 : 12; return new Date(dK.getFullYear(), h, 0, 23, 59, 59, 999); }
  private startOfYearK(dK: Date) { return new Date(dK.getFullYear(), 0, 1, 0, 0, 0, 0); }
  private endOfYearK(dK: Date) { return new Date(dK.getFullYear(), 12, 0, 23, 59, 59, 999); }

  // Compute period boundaries in KST, return as UTC Date
  private calcPeriod(cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY' | null | undefined, whenUtc: Date): { start: Date; end: Date } {
    const cd = cadence || 'MONTHLY';
    const wK = this.toKst(whenUtc);
    if (cd === 'DAILY') {
      const sK = new Date(wK.getFullYear(), wK.getMonth(), wK.getDate(), 0, 0, 0, 0);
      const eK = new Date(wK.getFullYear(), wK.getMonth(), wK.getDate(), 23, 59, 59, 999);
      return { start: this.fromKst(sK), end: this.fromKst(eK) };
    }
    if (cd === 'WEEKLY') {
      const sK = this.startOfWeekMonK(wK);
      const eK = this.endOfWeekSunK(wK);
      return { start: this.fromKst(sK), end: this.fromKst(eK) };
    }
    if (cd === 'QUARTERLY') {
      const sK = this.startOfQuarterK(wK);
      const eK = this.endOfQuarterK(wK);
      return { start: this.fromKst(sK), end: this.fromKst(eK) };
    }
    if (cd === 'HALF_YEARLY') {
      const sK = this.startOfHalfYearK(wK);
      const eK = this.endOfHalfYearK(wK);
      return { start: this.fromKst(sK), end: this.fromKst(eK) };
    }
    if (cd === 'YEARLY') {
      const sK = this.startOfYearK(wK);
      const eK = this.endOfYearK(wK);
      return { start: this.fromKst(sK), end: this.fromKst(eK) };
    }
    const sK = this.startOfMonthK(wK);
    const eK = this.endOfMonthK(wK);
    return { start: this.fromKst(sK), end: this.fromKst(eK) };
  }

  @Post()
  async create(@Body() dto: CreateProgressDto) {
    // Treat 'at' as KST date when provided in YYYY-MM-DD
    let when: Date;
    if (dto.at) {
      const s = String(dto.at);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        when = new Date(`${s}T00:00:00+09:00`);
      } else {
        when = new Date(s);
      }
    } else {
      when = new Date();
    }
    let cadence: any = 'MONTHLY';
    const user = await this.prisma.user.findUnique({ where: { id: dto.actorId } });
    if (!user) throw new BadRequestException('actor not found');
    if (dto.subjectType === 'KR') {
      const kr = await this.prisma.keyResult.findUnique({ where: { id: dto.subjectId }, include: { objective: true } });
      if (!kr) throw new BadRequestException('invalid keyResultId');
      cadence = (kr as any).cadence || 'MONTHLY';
      const isTeamKpi = !!(kr as any)?.objective?.pillar;
      if (isTeamKpi) {
        const sameTeam = !!user.orgUnitId && user.orgUnitId === ((kr as any)?.objective as any)?.orgUnitId;
        const isCeo = (user.role as any) === 'CEO';
        // 팀 KPI는 대표(CEO), 같은 팀 소속, 해당 KR 할당자, 또는 상위 조직(실/본부) 책임자·임원이 입력 가능
        const assigned = await this.prisma.keyResultAssignment.findFirst({ where: { keyResultId: dto.subjectId, userId: user.id } });
        const upperMgr = !isCeo && !sameTeam && !assigned
          && (await isAncestorOrgManager(this.prisma, user, ((kr as any)?.objective as any)?.orgUnitId));
        if (!(isCeo || sameTeam || assigned || upperMgr)) throw new ForbiddenException('소속 팀(또는 산하 팀) 구성원만 KPI 실적을 입력할 수 있습니다');
        // Unify KPI progress input cadence to MONTHLY
        cadence = 'MONTHLY' as any;
      } else {
        if (user.id !== (kr as any).ownerId) throw new ForbiddenException('only KR owner can update this OKR');
      }
    } else {
      const init = await this.prisma.initiative.findUnique({ where: { id: dto.subjectId }, include: { keyResult: { include: { objective: true } } } });
      if (!init) throw new BadRequestException('invalid initiativeId');
      cadence = (init as any).cadence || 'MONTHLY';
      const isTeamKpi = !!(init as any)?.keyResult?.objective?.pillar;
      if (isTeamKpi) {
        const sameTeam = !!user.orgUnitId && user.orgUnitId === (((init as any)?.keyResult as any)?.objective as any)?.orgUnitId;
        const isCeo = (user.role as any) === 'CEO';
        // 팀 KPI는 대표(CEO), 같은 팀 소속, 해당 KR 할당자, 또는 상위 조직(실/본부) 책임자·임원이 입력 가능
        const assigned = (init as any).keyResultId
          ? await this.prisma.keyResultAssignment.findFirst({ where: { keyResultId: (init as any).keyResultId, userId: user.id } })
          : null;
        const upperMgr = !isCeo && !sameTeam && !assigned
          && (await isAncestorOrgManager(this.prisma, user, (((init as any)?.keyResult as any)?.objective as any)?.orgUnitId));
        if (!(isCeo || sameTeam || assigned || upperMgr)) throw new ForbiddenException('소속 팀(또는 산하 팀) 구성원만 KPI 실적을 입력할 수 있습니다');
      } else {
        if (user.id !== (init as any).ownerId) throw new ForbiddenException('only initiative owner can update this OKR');
      }
    }
    const { start, end } = this.calcPeriod(cadence, when);
    // If KR progress comes from a worklog, infer initiativeId from that worklog to record task-level association
    let inferredInitiativeId: string | null = null;
    if (dto.worklogId) {
      try {
        const wl = await this.prisma.worklog.findUnique({ where: { id: dto.worklogId } });
        inferredInitiativeId = (wl as any)?.initiativeId ?? null;
      } catch {}
    }
    const rec = await this.prisma.progressEntry.create({
      data: {
        worklogId: dto.worklogId,
        actorId: dto.actorId,
        keyResultId: dto.subjectType === 'KR' ? dto.subjectId : null,
        initiativeId: dto.subjectType === 'INITIATIVE' ? dto.subjectId : (dto.subjectType === 'KR' ? inferredInitiativeId : null),
        periodStart: start,
        periodEnd: end,
        krValue: typeof dto.krValue === 'number' ? dto.krValue : null,
        initiativeDone: typeof dto.initiativeDone === 'boolean' ? dto.initiativeDone : null,
        note: dto.note ?? undefined,
      },
    });
    return rec;
  }

  @Get()
  async list(@Query('subjectType') subjectType: 'KR' | 'INITIATIVE', @Query('subjectId') subjectId: string, @Query('actorId') actorId?: string) {
    if (!subjectType || !subjectId) throw new BadRequestException('subjectType/subjectId required');
    const where: any = {};
    if (subjectType === 'KR') where.keyResultId = subjectId; else where.initiativeId = subjectId;
    if (actorId) where.actorId = actorId;
    const items = await this.prisma.progressEntry.findMany({ where, orderBy: { createdAt: 'desc' } });
    return { items };
  }

  /**
   * 내 KPI 이번 달 입력 현황 — 업무일지 작성 화면의 "실적 미입력 KPI" 넛지용.
   * 나에게 할당된 KPI(KeyResultAssignment)별 이번 달(KST) 실적 입력 여부.
   */
  @Get('my-kpi-month')
  async myKpiMonth(@Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const assigns = await (this.prisma as any).keyResultAssignment.findMany({
      where: { userId: uid },
      include: { keyResult: { select: { id: true, title: true, unit: true, target: true, objective: { select: { title: true } } } } },
    });
    if (!assigns.length) return { items: [] };
    const valid = assigns.filter((a: any) => a.keyResult && !/^Auto /i.test(String(a.keyResult.title || '')) && !/^Auto Objective/i.test(String(a.keyResult.objective?.title || '')));
    const krIds = valid.map((a: any) => a.keyResult.id);
    const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const start = new Date(`${month}-01T00:00:00+09:00`);
    const end = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+09:00`);
    const entries = await this.prisma.progressEntry.findMany({
      where: { keyResultId: { in: krIds }, actorId: uid, periodStart: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      select: { keyResultId: true, krValue: true },
    });
    const latestVal = new Map<string, number>();
    for (const e of entries) {
      const k = String(e.keyResultId);
      if (e.krValue != null && !latestVal.has(k)) latestVal.set(k, e.krValue); // desc → 첫 값이 최신
    }
    const filled = new Set(entries.map((e) => String(e.keyResultId)));
    return {
      month,
      items: valid.map((a: any) => ({
        krId: a.keyResult.id,
        title: a.keyResult.title,
        unit: a.keyResult.unit || '',
        target: a.keyResult.target ?? null,
        filled: filled.has(String(a.keyResult.id)),
        value: latestVal.get(String(a.keyResult.id)) ?? null,
      })),
    };
  }
}
