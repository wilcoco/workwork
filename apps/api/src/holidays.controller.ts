import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class UpsertHolidayDto {
  @IsString()
  actorId!: string;

  @IsString()
  @IsDateString()
  date!: string; // YYYY-MM-DD

  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isLegal?: boolean;
}

@Controller('holidays')
export class HolidaysController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('year') yearStr?: string) {
    const now = new Date();
    const year = parseInt(yearStr || String(now.getFullYear()), 10);
    if (!year || Number.isNaN(year)) throw new BadRequestException('invalid year');
    const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(year + 1, 0, 0, 23, 59, 59, 999));
    const items = await (this.prisma as any).holiday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    return { items };
  }

  @Post()
  async upsert(@Body() dto: UpsertHolidayDto) {
    const actor = await this.prisma.user.findUnique({ where: { id: dto.actorId } });
    const role = actor?.role as any;
    if (!actor || (role !== 'CEO' && role !== 'EXEC')) {
      throw new BadRequestException('only EXEC/CEO can manage holidays');
    }

    const dateKst = new Date(`${dto.date}T00:00:00+09:00`);
    if (isNaN(dateKst.getTime())) throw new BadRequestException('invalid date');

    const existing = await (this.prisma as any).holiday.findUnique({ where: { date: dateKst } });
    if (existing) {
      const updated = await (this.prisma as any).holiday.update({
        where: { id: existing.id },
        data: {
          name: dto.name,
          isLegal: typeof dto.isLegal === 'boolean' ? dto.isLegal : existing.isLegal,
        },
      });
      return updated;
    }

    const created = await (this.prisma as any).holiday.create({
      data: {
        date: dateKst,
        name: dto.name,
        isLegal: dto.isLegal ?? true,
        createdBy: dto.actorId,
      },
    });
    return created;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('actorId') actorId?: string) {
    if (!actorId) throw new BadRequestException('actorId required');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    const role = actor?.role as any;
    if (!actor || (role !== 'CEO' && role !== 'EXEC')) {
      throw new BadRequestException('only EXEC/CEO can manage holidays');
    }

    await (this.prisma as any).holiday.delete({ where: { id } });
    return { ok: true };
  }
}
