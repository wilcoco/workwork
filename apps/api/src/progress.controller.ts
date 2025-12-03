import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
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

  private startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  private endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
  private startOfWeekMon(d: Date) {
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    const res = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    res.setHours(0, 0, 0, 0);
    return res;
  }
  private endOfWeekSun(d: Date) {
    const start = this.startOfWeekMon(d);
    const res = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    return res;
  }
  private quarterOf(d: Date) { return Math.floor(d.getMonth() / 3); }
  private startOfQuarter(d: Date) { const q = this.quarterOf(d); return new Date(d.getFullYear(), q * 3, 1); }
  private endOfQuarter(d: Date) { const q = this.quarterOf(d); return new Date(d.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999); }

  private calcPeriod(cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | null | undefined, when: Date): { start: Date; end: Date } {
    const cd = cadence || 'MONTHLY';
    if (cd === 'DAILY') {
      const s = new Date(when.getFullYear(), when.getMonth(), when.getDate());
      const e = new Date(when.getFullYear(), when.getMonth(), when.getDate(), 23, 59, 59, 999);
      return { start: s, end: e };
    }
    if (cd === 'WEEKLY') return { start: this.startOfWeekMon(when), end: this.endOfWeekSun(when) };
    if (cd === 'QUARTERLY') return { start: this.startOfQuarter(when), end: this.endOfQuarter(when) };
    return { start: this.startOfMonth(when), end: this.endOfMonth(when) };
  }

  @Post()
  async create(@Body() dto: CreateProgressDto) {
    const when = dto.at ? new Date(dto.at) : new Date();
    let cadence: any = 'MONTHLY';
    if (dto.subjectType === 'KR') {
      const kr = await this.prisma.keyResult.findUnique({ where: { id: dto.subjectId } });
      if (!kr) throw new BadRequestException('invalid keyResultId');
      cadence = (kr as any).cadence || 'MONTHLY';
    } else {
      const init = await this.prisma.initiative.findUnique({ where: { id: dto.subjectId } });
      if (!init) throw new BadRequestException('invalid initiativeId');
      cadence = (init as any).cadence || 'MONTHLY';
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
  async list(@Query('subjectType') subjectType: 'KR' | 'INITIATIVE', @Query('subjectId') subjectId: string) {
    if (!subjectType || !subjectId) throw new BadRequestException('subjectType/subjectId required');
    const where: any = {};
    if (subjectType === 'KR') where.keyResultId = subjectId; else where.initiativeId = subjectId;
    const items = await this.prisma.progressEntry.findMany({ where, orderBy: { createdAt: 'desc' } });
    return { items };
  }
}
