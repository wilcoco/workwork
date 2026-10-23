import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { KpiBindingsService } from './kpi-bindings.service';

/**
 * KPI 바인딩 스케줄러 — 30분마다 돌며 "지금 돌 차례"인 바인딩을 실행한다.
 *  - INTERNAL/ODOO/REST: 서버에서 바로 실행·기록
 *  - ORACLE_AGENT: 작업 큐에 SYNC 작업을 넣어 두면 사내 에이전트가 가져가 실행
 * 실행 시각은 KST 02:00 이후(월초 마감 배치 회피), 주기는 바인딩별(기본 매월 1·16일).
 */
@Injectable()
export class KpiBindingSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KpiBindingSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 30 * 60 * 1000;

  constructor(private prisma: PrismaService, private svc: KpiBindingsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), this.INTERVAL_MS);
    setTimeout(() => void this.tick(), 60 * 1000); // 기동 1분 뒤 첫 점검
    this.logger.log(`KPI binding scheduler started (interval ${this.INTERVAL_MS / 60000}m)`);
  }
  onModuleDestroy() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async tick() {
    let bindings: any[] = [];
    try { bindings = await (this.prisma as any).kpiBinding.findMany({ where: { enabled: true } }); } catch (e) { this.logger.warn(`load failed: ${(e as any)?.message}`); return; }
    const now = new Date();
    const year = this.svc.currentYear();
    for (const b of bindings) {
      if (!this.svc.isDue(b, now)) continue;
      try {
        if (b.sourceType === 'ORACLE_AGENT') {
          await this.svc.enqueueAgentJob(b, 'SYNC', year, 'scheduler');
          // 1월에는 전년도도 한 번 더 (연말 마감 반영)
          if (this.svc.currentMonth() === 1) await this.svc.enqueueAgentJob(b, 'SYNC', year - 1, 'scheduler').catch(() => {});
          await (this.prisma as any).kpiBinding.update({ where: { id: b.id }, data: { lastRunAt: now } });
        } else {
          await this.svc.syncNow(b, year);
          if (this.svc.currentMonth() === 1) await this.svc.syncNow(b, year - 1).catch(() => {});
        }
        this.logger.log(`binding ${b.id} (${b.sourceType}) ran`);
      } catch (e) {
        this.logger.warn(`binding ${b.id} failed: ${(e as any)?.message}`);
      }
    }
  }
}
