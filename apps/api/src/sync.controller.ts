import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import { parseKstDate } from './lib/kst';

const SYNC_PUSH_KEY = process.env.SYNC_PUSH_KEY || '2002@cams';

type AccessRecordDto = {
  employee_id?: string;
  employee_name?: string;
  card_no?: string;
  userid?: string;
  deviceid?: string;
  secom_id?: string;
  e_idno?: string;
  e_id?: string;
  g_id?: string;
  access_time?: string;
  access_date?: string;
  access_type?: string;
  location?: string;
  gate?: string;
  direction?: string;
  department?: string;
  position?: string;
};

type SyncAccessRecordsDto = {
  records: AccessRecordDto[];
  source: 'TB_ACCESS' | 'T_SECOM_ALARM' | 'T_CAPS_ALARM';
};

@Controller('sync')
export class SyncController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Post('access-records')
  async syncAccessRecords(
    @Body() dto: SyncAccessRecordsDto,
    @Headers('x-sync-key') syncKey?: string,
  ) {
    if (syncKey !== SYNC_PUSH_KEY) {
      throw new UnauthorizedException('Invalid sync key');
    }

    const { records, source } = dto;
    if (!records || !Array.isArray(records)) {
      return { inserted: 0, skipped: 0, error: 'No records provided' };
    }

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const rec of records) {
      try {
        // 입출입 시각은 KST 벽시계(오프셋 없음)로 오므로 +09:00으로 해석 (UTC 오해 방지)
        const eventAt = parseKstDate(rec.access_time);
        if (!eventAt) {
          skipped++;
          continue;
        }

        // sourceId 생성: source + employee_id + access_time
        const sourceId = `${source}_${rec.employee_id || rec.e_idno || rec.secom_id || ''}_${rec.access_time || ''}`;

        if (source === 'TB_ACCESS') {
          // KtAccessLog 테이블
          await (this.prisma as any).ktAccessLog.upsert({
            where: { sourceId },
            update: {},
            create: {
              eventAt,
              cardNo: rec.card_no || null,
              employeeNo: rec.employee_id || rec.userid || null,
              personName: rec.employee_name || null,
              direction: rec.direction || null,
              gateName: rec.location || null,
              gateId: rec.gate || rec.deviceid || null,
              deviceId: rec.deviceid || null,
              resultCode: rec.access_type || null,
              rawData: rec,
              sourceId,
            },
          });
          inserted++;
        } else if (source === 'T_SECOM_ALARM') {
          // SecomAlarm 테이블
          await (this.prisma as any).secomAlarm.upsert({
            where: { sourceId },
            update: {},
            create: {
              eventAt,
              cardNo: rec.card_no || null,
              employeeNo: rec.employee_id || rec.secom_id || null,
              personName: rec.employee_name || null,
              direction: rec.direction || null,
              zoneName: rec.location || null,
              zoneId: rec.gate || null,
              deviceId: rec.deviceid || null,
              alarmType: rec.access_type || null,
              resultCode: null,
              rawData: rec,
              sourceId,
            },
          });
          inserted++;
        } else if (source === 'T_CAPS_ALARM') {
          // CapsAlarm 테이블
          await (this.prisma as any).capsAlarm.upsert({
            where: { sourceId },
            update: {},
            create: {
              eventAt,
              cardNo: rec.card_no || null,
              employeeNo: rec.employee_id || rec.e_idno || null,
              personName: rec.employee_name || null,
              direction: rec.direction || null,
              doorName: rec.location || null,
              doorId: rec.gate || rec.g_id || null,
              deviceId: rec.deviceid || null,
              alarmType: rec.access_type || null,
              resultCode: null,
              rawData: rec,
              sourceId,
            },
          });
          inserted++;
        } else {
          skipped++;
        }
      } catch (e: any) {
        if (e?.code === 'P2002') {
          skipped++;
        } else {
          errors.push(`${rec.employee_id}: ${e?.message || 'unknown'}`);
        }
      }
    }

    console.log(`[Sync] ${source}: inserted=${inserted}, skipped=${skipped}, errors=${errors.length}`);
    return { inserted, skipped, errors: errors.slice(0, 10) };
  }
}
