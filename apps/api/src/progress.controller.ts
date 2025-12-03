import { BadRequestException, Body, Controller, Get, Post, Query, ForbiddenException } from '@nestjs/common';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

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

  // Compute period boundaries in KST, return as UTC Date
  private calcPeriod(cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | null | undefined, whenUtc: Date): { start: Date; end: Date } {
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
        const isMgr = (user.role as any) === 'MANAGER';
        if (!(isMgr && sameTeam)) throw new ForbiddenException('only team manager can update team KPI');
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
        const isMgr = (user.role as any) === 'MANAGER';
        if (!(isMgr && sameTeam)) throw new ForbiddenException('only team manager can update team KPI');
      } else {
        if (user.id !== (init as any).ownerId) throw new ForbiddenException('only initiative owner can update this OKR');
      }
    }
    const { start, end } = this.calcPeriod(cadence, when);
    const rec = await this.prisma.progressEntry.create({
      data: {
        worklogId: dto.worklogId,
        actorId: dto.actorId,
        keyResultId: dto.subjectType === 'KR' ? dto.subjectId : null,
        initiativeId: dto.subjectType === 'INITIATIVE' ? dto.subjectId : null,
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
}
