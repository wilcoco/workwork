import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from './prisma.service';
import { parseKstDate } from './lib/kst';

// DTO for KT Access (TB_ACCESS - 케이티텔레캅 복지동/정문)
class KtAccessItemDto {
  @IsString() eventAt!: string;
  @IsOptional() @IsString() cardNo?: string;
  @IsOptional() @IsString() employeeNo?: string;
  @IsOptional() @IsString() personName?: string;
  @IsOptional() @IsString() direction?: string;
  @IsOptional() @IsString() gateName?: string;
  @IsOptional() @IsString() gateId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() resultCode?: string;
  @IsOptional() rawData?: any;
  @IsString() sourceId!: string;
}

class KtAccessBulkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KtAccessItemDto)
  items!: KtAccessItemDto[];
}

// DTO for Secom (T_SECOM_ALARM - 에스원 함평공장)
class SecomAlarmItemDto {
  @IsString() eventAt!: string;
  @IsOptional() @IsString() cardNo?: string;
  @IsOptional() @IsString() employeeNo?: string;
  @IsOptional() @IsString() personName?: string;
  @IsOptional() @IsString() direction?: string;
  @IsOptional() @IsString() zoneName?: string;
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() alarmType?: string;
  @IsOptional() @IsString() resultCode?: string;
  @IsOptional() rawData?: any;
  @IsString() sourceId!: string;
}

class SecomAlarmBulkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecomAlarmItemDto)
  items!: SecomAlarmItemDto[];
}

// DTO for Caps (T_CAPS_ALARM - 캡스 사무실)
class CapsAlarmItemDto {
  @IsString() eventAt!: string;
  @IsOptional() @IsString() cardNo?: string;
  @IsOptional() @IsString() employeeNo?: string;
  @IsOptional() @IsString() personName?: string;
  @IsOptional() @IsString() direction?: string;
  @IsOptional() @IsString() doorName?: string;
  @IsOptional() @IsString() doorId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() alarmType?: string;
  @IsOptional() @IsString() resultCode?: string;
  @IsOptional() rawData?: any;
  @IsString() sourceId!: string;
}

class CapsAlarmBulkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapsAlarmItemDto)
  items!: CapsAlarmItemDto[];
}

@Controller('access-logs')
export class AccessLogController {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  // KT Telecop (TB_ACCESS)
  // ─────────────────────────────────────────────────────────────
  @Post('kt')
  async bulkInsertKt(@Body() dto: KtAccessBulkDto) {
    const results = { inserted: 0, skipped: 0, errors: [] as string[] };

    for (const item of dto.items) {
      try {
        const eventAt = parseKstDate(item.eventAt);
        if (!eventAt) { results.errors.push(`${item.sourceId}: 유효하지 않은 eventAt(${item.eventAt})`); continue; }
        await (this.prisma as any).ktAccessLog.upsert({
          where: { sourceId: item.sourceId },
          update: {},
          create: {
            eventAt,
            cardNo: item.cardNo,
            employeeNo: item.employeeNo,
            personName: item.personName,
            direction: item.direction,
            gateName: item.gateName,
            gateId: item.gateId,
            deviceId: item.deviceId,
            resultCode: item.resultCode,
            rawData: item.rawData,
            sourceId: item.sourceId,
          },
        });
        results.inserted++;
      } catch (e: any) {
        if (e?.code === 'P2002') {
          results.skipped++;
        } else {
          results.errors.push(`${item.sourceId}: ${e?.message || 'unknown'}`);
        }
      }
    }

    return { success: true, ...results };
  }

  @Get('kt')
  async listKt(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('gate') gate?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {};
    if (from || to) {
      where.eventAt = {};
      if (from) where.eventAt.gte = new Date(from);
      if (to) where.eventAt.lte = new Date(to);
    }
    if (gate) where.gateName = { contains: gate, mode: 'insensitive' };

    const items = await (this.prisma as any).ktAccessLog.findMany({
      where,
      orderBy: { eventAt: 'desc' },
      take: Math.min(parseInt(limit || '100', 10), 1000),
    });
    return { items };
  }

  // ─────────────────────────────────────────────────────────────
  // Secom (T_SECOM_ALARM)
  // ─────────────────────────────────────────────────────────────
  @Post('secom')
  async bulkInsertSecom(@Body() dto: SecomAlarmBulkDto) {
    const results = { inserted: 0, skipped: 0, errors: [] as string[] };

    for (const item of dto.items) {
      try {
        const eventAt = parseKstDate(item.eventAt);
        if (!eventAt) { results.errors.push(`${item.sourceId}: 유효하지 않은 eventAt(${item.eventAt})`); continue; }
        await (this.prisma as any).secomAlarm.upsert({
          where: { sourceId: item.sourceId },
          update: {},
          create: {
            eventAt,
            cardNo: item.cardNo,
            employeeNo: item.employeeNo,
            personName: item.personName,
            direction: item.direction,
            zoneName: item.zoneName,
            zoneId: item.zoneId,
            deviceId: item.deviceId,
            alarmType: item.alarmType,
            resultCode: item.resultCode,
            rawData: item.rawData,
            sourceId: item.sourceId,
          },
        });
        results.inserted++;
      } catch (e: any) {
        if (e?.code === 'P2002') {
          results.skipped++;
        } else {
          results.errors.push(`${item.sourceId}: ${e?.message || 'unknown'}`);
        }
      }
    }

    return { success: true, ...results };
  }

  @Get('secom')
  async listSecom(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('zone') zone?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {};
    if (from || to) {
      where.eventAt = {};
      if (from) where.eventAt.gte = new Date(from);
      if (to) where.eventAt.lte = new Date(to);
    }
    if (zone) where.zoneName = { contains: zone, mode: 'insensitive' };

    const items = await (this.prisma as any).secomAlarm.findMany({
      where,
      orderBy: { eventAt: 'desc' },
      take: Math.min(parseInt(limit || '100', 10), 1000),
    });
    return { items };
  }

  // ─────────────────────────────────────────────────────────────
  // Caps (T_CAPS_ALARM)
  // ─────────────────────────────────────────────────────────────
  @Post('caps')
  async bulkInsertCaps(@Body() dto: CapsAlarmBulkDto) {
    const results = { inserted: 0, skipped: 0, errors: [] as string[] };

    for (const item of dto.items) {
      try {
        const eventAt = parseKstDate(item.eventAt);
        if (!eventAt) { results.errors.push(`${item.sourceId}: 유효하지 않은 eventAt(${item.eventAt})`); continue; }
        await (this.prisma as any).capsAlarm.upsert({
          where: { sourceId: item.sourceId },
          update: {},
          create: {
            eventAt,
            cardNo: item.cardNo,
            employeeNo: item.employeeNo,
            personName: item.personName,
            direction: item.direction,
            doorName: item.doorName,
            doorId: item.doorId,
            deviceId: item.deviceId,
            alarmType: item.alarmType,
            resultCode: item.resultCode,
            rawData: item.rawData,
            sourceId: item.sourceId,
          },
        });
        results.inserted++;
      } catch (e: any) {
        if (e?.code === 'P2002') {
          results.skipped++;
        } else {
          results.errors.push(`${item.sourceId}: ${e?.message || 'unknown'}`);
        }
      }
    }

    return { success: true, ...results };
  }

  @Get('caps')
  async listCaps(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('door') door?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {};
    if (from || to) {
      where.eventAt = {};
      if (from) where.eventAt.gte = new Date(from);
      if (to) where.eventAt.lte = new Date(to);
    }
    if (door) where.doorName = { contains: door, mode: 'insensitive' };

    const items = await (this.prisma as any).capsAlarm.findMany({
      where,
      orderBy: { eventAt: 'desc' },
      take: Math.min(parseInt(limit || '100', 10), 1000),
    });
    return { items };
  }
}
