import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 온톨로지 완성도 등급 + 운영 계기판 (2단계).
 * "목표와 실행이 데이터로 맞물려 있는 정도"를 결정론적 규칙으로 0~100점·등급 1~4로 계산한다.
 * AI는 쓰지 않는다 — 같은 데이터면 항상 같은 점수. 구독 등급·관리자 시험지 가동 조건(등급 3+)·투자자 수치의 근거.
 *
 * 구성 요소(가중치 합 100):
 *  kpiBound     25  KPI 데이터 연결 비율 (올해 활성 팀 KPI 중 바인딩된 것)
 *  kpiFresh     10  KPI 실적 최신성 (직전 마감월 값이 있는 KPI 비율)
 *  kpiLinked    10  KPI 담당·활동 연결 비율 (담당자 있고 온톨로지 활동에 연결)
 *  manualReady  10  매뉴얼 프로세스화 준비도 80+ 비율
 *  processed    10  매뉴얼 프로세스화 비율 (템플릿이 만들어진 매뉴얼)
 *  logCoverage  15  업무일지 목표 연결 커버리지 (최근 30일 일지 중 KR/KI에 연결된 비율)
 *  logWriters   10  업무일지 작성자 비율 (최근 30일, 활성 구성원 중 1건 이상)
 *  approvalLead 10  결재 리드타임 (최근 30일 평균, 자동 승인 제외; ≤24h=100, ≥96h=0)
 * 등급: ≥80 → 4 판단 가능 / ≥60 → 3 데이터 기반 / ≥40 → 2 연결 중 / 그 외 1 기록 시작
 */
export type Component = { key: string; label: string; weight: number; score: number; raw: Record<string, any>; hint: string };
const KST = 9 * 3600000;
export const GRADE_LABEL: Record<number, string> = { 1: '기록 시작', 2: '연결 중', 3: '데이터 기반', 4: '판단 가능' };

@Injectable()
export class OpsMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsMetricsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.snapshotIfDue(), 30 * 60 * 1000);
    setTimeout(() => void this.snapshotIfDue(), 2 * 60 * 1000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  kstDate(d = new Date()) { return new Date(d.getTime() + KST).toISOString().slice(0, 10); }
  pct(n: number, d: number) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

  async compute(): Promise<{ score: number; grade: number; components: Component[]; teams: any[]; date: string }> {
    const now = new Date();
    const k = new Date(now.getTime() + KST);
    const year = k.getUTCFullYear();
    const since30 = new Date(now.getTime() - 30 * 86400000);
    // 직전 마감월
    const prevM = k.getUTCMonth() === 0 ? { y: year - 1, m: 12 } : { y: year, m: k.getUTCMonth() };
    const pmStart = new Date(Date.UTC(prevM.y, prevM.m - 1, 1) - KST), pmEnd = new Date(Date.UTC(prevM.y, prevM.m, 0, 23, 59, 59, 999) - KST);

    // ── KPI (올해 활성 팀 목표의 KR)
    const krs: any[] = await this.prisma.keyResult.findMany({
      where: { objective: { status: { in: ['ACTIVE', 'LOCKED'] as any }, pillar: { not: null } } },
      select: { id: true, ownerId: true, activityId: true, objective: { select: { orgUnitId: true, orgUnit: { select: { name: true } } } }, assignments: { select: { id: true } }, binding: { select: { id: true, lastError: true } } },
    });
    const krIds = krs.map((k2) => k2.id);
    const fresh: any[] = krIds.length ? await this.prisma.progressEntry.findMany({ where: { keyResultId: { in: krIds }, periodStart: { gte: pmStart, lte: pmEnd }, krValue: { not: null } }, distinct: ['keyResultId'], select: { keyResultId: true } }) : [];
    const freshSet = new Set(fresh.map((f) => f.keyResultId));
    const bound = krs.filter((k2) => k2.binding && !k2.binding.lastError).length;
    const linked = krs.filter((k2) => (k2.ownerId || k2.assignments.length) && k2.activityId).length;

    // ── 매뉴얼
    const [manualTotal, manualReady, templatesWithManual] = await Promise.all([
      (this.prisma as any).workManual.count(),
      (this.prisma as any).workManual.count({ where: { readinessScore: { gte: 80 } } }),
      (this.prisma as any).processTemplate.findMany({ where: { sourceManualId: { not: null } }, distinct: ['sourceManualId'], select: { sourceManualId: true } }),
    ]);

    // ── 업무일지 (30일)
    const logs: any[] = await this.prisma.worklog.findMany({ where: { date: { gte: since30 } }, select: { id: true, createdById: true } });
    const logIds = logs.map((l) => l.id);
    const tagged: any[] = logIds.length ? await (this.prisma as any).worklogGoalTag.findMany({ where: { worklogId: { in: logIds }, goalType: { in: ['KR', 'KI'] } }, distinct: ['worklogId'], select: { worklogId: true } }) : [];
    const activeUsers = await this.prisma.user.count({ where: { status: 'ACTIVE' as any, role: { in: ['INDIVIDUAL', 'MANAGER', 'EXEC'] as any }, orgUnitId: { not: null } } });
    const writers = new Set(logs.map((l) => l.createdById)).size;

    // ── 결재 리드타임 (30일, 완료건, 자동승인 제외)
    const reqs: any[] = await (this.prisma as any).approvalRequest.findMany({ where: { status: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: since30 } }, select: { createdAt: true, updatedAt: true } });
    const hours = reqs.map((r) => (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 3600000).filter((h) => h >= 1 / 60);
    const lead = hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null;
    const leadScore = lead == null ? 0 : Math.max(0, Math.min(100, Math.round((1 - (lead - 24) / 72) * 100)));

    const components: Component[] = [
      { key: 'kpiBound', label: 'KPI 데이터 연결', weight: 25, score: this.pct(bound, krs.length), raw: { bound, total: krs.length }, hint: '팀 KPI 실적이 오라클·Odoo·내부 데이터에서 자동으로 오는 비율. 자기신고를 데이터로 바꾸는 핵심 지표' },
      { key: 'kpiFresh', label: 'KPI 실적 최신성', weight: 10, score: this.pct(freshSet.size, krs.length), raw: { fresh: freshSet.size, total: krs.length, month: `${prevM.y}-${String(prevM.m).padStart(2, '0')}` }, hint: '직전 마감월 실적이 들어와 있는 KPI 비율' },
      { key: 'kpiLinked', label: 'KPI 담당·활동 연결', weight: 10, score: this.pct(linked, krs.length), raw: { linked, total: krs.length }, hint: '담당자가 있고 온톨로지 활동에 연결된 KPI 비율 — 일지·프로세스와 지표가 이어지는 조건' },
      { key: 'manualReady', label: '매뉴얼 준비도 80+', weight: 10, score: this.pct(manualReady, manualTotal), raw: { ready: manualReady, total: manualTotal }, hint: '프로세스로 바꿀 수 있는 수준(80점 이상)까지 보완된 매뉴얼 비율' },
      { key: 'processed', label: '매뉴얼 프로세스화', weight: 10, score: this.pct(templatesWithManual.length, manualTotal), raw: { processed: templatesWithManual.length, total: manualTotal }, hint: '프로세스 템플릿까지 만들어진 매뉴얼 비율' },
      { key: 'logCoverage', label: '일지 목표 연결 커버리지', weight: 15, score: this.pct(tagged.length, logs.length), raw: { tagged: tagged.length, total: logs.length, days: 30 }, hint: '최근 30일 업무일지 중 KPI·중점과제에 연결된 비율 — 실행이 목표에 묶이는 정도' },
      { key: 'logWriters', label: '일지 작성자 비율', weight: 10, score: this.pct(writers, activeUsers), raw: { writers, active: activeUsers, days: 30 }, hint: '최근 30일 활성 구성원 중 일지를 1건 이상 쓴 비율' },
      { key: 'approvalLead', label: '결재 리드타임', weight: 10, score: leadScore, raw: { avgHours: lead, count: hours.length, days: 30 }, hint: '상신→최종 처리 평균 시간(자동 승인 제외). 24시간 이내=100점, 96시간 이상=0점' },
    ];
    const score = Math.round(components.reduce((s, c) => s + (c.score * c.weight) / 100, 0) * 10) / 10;
    const grade = score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1;

    // 팀별 KPI 연결 현황
    const byTeam = new Map<string, { name: string; total: number; bound: number; fresh: number; linked: number }>();
    for (const k2 of krs) {
      const id = k2.objective?.orgUnitId || '-'; const t = byTeam.get(id) || { name: k2.objective?.orgUnit?.name || '(미지정)', total: 0, bound: 0, fresh: 0, linked: 0 };
      t.total++; if (k2.binding && !k2.binding.lastError) t.bound++; if (freshSet.has(k2.id)) t.fresh++; if ((k2.ownerId || k2.assignments.length) && k2.activityId) t.linked++;
      byTeam.set(id, t);
    }
    const teams = Array.from(byTeam.entries()).map(([id, t]) => ({ orgUnitId: id, ...t })).sort((a, b) => b.total - a.total);
    return { score, grade, components, teams, date: this.kstDate(now) };
  }

  async snapshotIfDue() {
    try {
      const k = new Date(Date.now() + KST);
      if (k.getUTCHours() < 3) return;
      const date = this.kstDate();
      const exists = await (this.prisma as any).opsMetricDaily.findUnique({ where: { date } });
      if (exists) return;
      const r = await this.compute();
      await (this.prisma as any).opsMetricDaily.create({ data: { date, score: r.score, grade: r.grade, components: r.components } });
      this.logger.log(`ops metric snapshot ${date}: ${r.score} (grade ${r.grade})`);
    } catch (e) { this.logger.warn(`snapshot failed: ${(e as any)?.message}`); }
  }

  async history(days = 90) {
    return (this.prisma as any).opsMetricDaily.findMany({ orderBy: { date: 'desc' }, take: days, select: { date: true, score: true, grade: true, components: true } });
  }
}
