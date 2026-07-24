import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { mineWorklogActivities } from './lib/activity-miner';
import { mineWorklogEntities } from './lib/entity-miner';
import { mapWorklogsToTeamKpis } from './lib/worklog-kpi-mapper';
import { callAI } from './llm/ai-client';

/**
 * 온톨로지 오토파일럿 — 수동 버튼에 의존하던 파이프라인을 자동 운영으로 전환한다.
 * 원칙: 증분·저위험 작업만 자동(채굴·대상·분류·KPI태깅), 파괴적 작업(병합)은 수동 유지.
 *
 * - 매일 새벽(KST 03~05시): 신규 일지 채굴(활동·대상), 미분류 활동 정리, 일지→KPI 태깅
 * - 매주 월요일 아침(KST 07~09시): 임원 대상 '온톨로지 주간 다이제스트' 알림 발행
 * - ONTOLOGY_AUTOPILOT=0 으로 전체 비활성화 가능. 비용 가드: 회당 처리량 상한.
 */
@Injectable()
export class OntologySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OntologySchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 60 * 60 * 1000; // 1시간마다 깨어나 시간창 판정
  private running = false;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.ONTOLOGY_AUTOPILOT === '0') {
      this.logger.log('Ontology autopilot disabled (ONTOLOGY_AUTOPILOT=0)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.INTERVAL_MS);
    this.logger.log('Ontology autopilot started (hourly tick; nightly pipeline + Monday digest)');
  }

  onModuleDestroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private kstNow() {
    return new Date(Date.now() + 9 * 3600 * 1000);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const kst = this.kstNow();
      const hour = kst.getUTCHours();
      const dow = kst.getUTCDay(); // 1=월
      const today = kst.toISOString().slice(0, 10);

      // 매일 새벽 03~05시: 증분 파이프라인 (하루 1회 — Event 마커로 멱등)
      if (hour >= 3 && hour < 5) {
        if (!(await this.ranToday('OntologyPipelineRun', today))) await this.nightlyPipeline(today);
      }
      // 월요일 07~09시: 주간 다이제스트 (주 1회)
      if (dow === 1 && hour >= 7 && hour < 9) {
        if (!(await this.ranToday('OntologyDigest', today))) await this.weeklyDigest(today);
      }
    } catch (e: any) {
      this.logger.error(`autopilot tick failed: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  private async ranToday(activity: string, day: string): Promise<boolean> {
    const since = new Date(`${day}T00:00:00+09:00`);
    const n = await (this.prisma as any).event.count({ where: { activity, ts: { gte: since } } }).catch(() => 0);
    return n > 0;
  }

  private async markRun(activity: string, attrs: any) {
    await (this.prisma as any).event.create({ data: { subjectType: 'Ontology', subjectId: 'autopilot', activity, attrs } }).catch(() => {});
  }

  /** 야간 증분 파이프라인 — 저위험·멱등 작업만. 회당 상한으로 비용 가드 */
  private async nightlyPipeline(day: string) {
    this.logger.log('[autopilot] nightly pipeline start');
    const stats: any = { day };
    try {
      // 1) 신규 일지 → 활동 채굴 (최대 200건/일)
      const m1 = await mineWorklogActivities(this.prisma, { days: 14, limit: 200 });
      stats.activityMine = { scanned: m1.scanned, linked: m1.linked, created: m1.created };
    } catch (e: any) { stats.activityMineError = e?.message?.slice(0, 120); }
    try {
      // 2) 신규 일지 → 대상 채굴 (최대 200건/일)
      const m2 = await mineWorklogEntities(this.prisma, { days: 14, limit: 200 });
      stats.entityMine = { scanned: m2.scanned, linked: m2.linked, created: m2.created };
    } catch (e: any) { stats.entityMineError = e?.message?.slice(0, 120); }
    try {
      // 3) 미분류 활동 도메인 정리 (최대 90개/일 — 30개 청크 3회)
      stats.organize = await this.organizeBatch(90);
    } catch (e: any) { stats.organizeError = e?.message?.slice(0, 120); }
    try {
      // 4) 일지 → KPI 태깅 (태그 없는 일지만, 최대 300건/일)
      const m4 = await mapWorklogsToTeamKpis(this.prisma, { limit: 300 });
      stats.kpiTag = { scanned: m4.scanned, tagged: m4.tagged, none: m4.none, remaining: m4.remaining };
    } catch (e: any) { stats.kpiTagError = e?.message?.slice(0, 120); }
    await this.markRun('OntologyPipelineRun', stats);
    this.logger.log(`[autopilot] nightly pipeline done: ${JSON.stringify(stats)}`);
  }

  /** 활동 도메인 분류 (activities.controller organize와 동일 로직의 축약판) */
  private async organizeBatch(cap: number): Promise<{ classified: number; remaining: number }> {
    const DOMAINS = ['영업', '연구개발', '금형', '생산-사출', '생산-도장', '생산-조립', '생산관리', '품질', '구매·자재', '물류', '설비·보전', '경영지원', '안전·환경', '기타'];
    const acts = await (this.prisma as any).activity.findMany({ where: { domain: null }, select: { id: true, name: true, roleHint: true }, take: cap });
    let classified = 0;
    for (let start = 0; start < acts.length; start += 30) {
      const chunk = acts.slice(start, start + 30);
      try {
        const res = await callAI({
          model: 'claude',
          system: `너는 자동차 부품 제조사(캠스)의 업무 체계 분류 담당이다. 반드시 JSON만 출력한다.\n각 활동을 대분류(domain)와 중분류(category)로 분류하라.\n- domain은 반드시 다음 중 하나: ${DOMAINS.join(', ')}\n- category는 2~8자 명사형 소그룹.\n출력: { "items": [{ "index": number, "domain": string, "category": string }] }`,
          user: chunk.map((a: any, j: number) => `#${start + j} ${a.name}`).join('\n'),
          temperature: 0.1, maxTokens: 3000,
          jsonSchema: { name: 'organize', schema: { type: 'object' as const, properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, domain: { type: 'string' }, category: { type: 'string' } }, required: ['index', 'domain'] } } }, required: ['items'] } },
        });
        for (const m of res?.parsed?.items || []) {
          const a = chunk[Number(m.index) - start];
          if (!a) continue;
          const domain = DOMAINS.includes(String(m.domain)) ? String(m.domain) : '기타';
          await (this.prisma as any).activity.update({ where: { id: a.id }, data: { domain, category: String(m.category || '').trim().slice(0, 20) || null } });
          classified++;
        }
      } catch (e: any) { this.logger.error(`organize chunk failed: ${e?.message?.slice(0, 100)}`); }
    }
    const remaining = await (this.prisma as any).activity.count({ where: { domain: null } });
    return { classified, remaining };
  }

  /** 주간 다이제스트 — 임원·CEO에게 알림 발행 */
  private async weeklyDigest(day: string) {
    this.logger.log('[autopilot] weekly digest start');
    const weekAgo = new Date(Date.now() - 7 * 86400 * 1000);
    const p = this.prisma as any;
    const [newActs, unclassified, wlWeek, wlLinkedWeek, taggedWeek, orphan1, kpiNoEvi] = await Promise.all([
      p.activity.count({ where: { createdAt: { gte: weekAgo } } }),
      p.activity.count({ where: { domain: null } }),
      p.worklog.count({ where: { createdAt: { gte: weekAgo } } }),
      p.worklog.count({ where: { createdAt: { gte: weekAgo }, activityId: { not: null } } }),
      p.worklogGoalTag.groupBy({ by: ['worklogId'], where: { createdAt: { gte: weekAgo }, goalType: { in: ['KR', 'KI'] } } }).then((r: any[]) => r.length).catch(() => 0),
      // 목표 미연결 실행 상위 활동 (최근 7일 일지 기준)
      p.worklog.groupBy({ by: ['activityId'], where: { createdAt: { gte: weekAgo }, activityId: { not: null } }, _count: { _all: true }, orderBy: { _count: { activityId: 'desc' } }, take: 30 }).catch(() => []),
      // 실행 증거 없는 KPI 수 (링크·태그 모두 0)
      (async () => {
        const krs = await p.keyResult.findMany({ where: { NOT: { objective: { title: { startsWith: 'Auto Objective' } } } }, select: { id: true } });
        const ids = krs.map((k: any) => k.id);
        const [links, tags] = await Promise.all([
          p.goalActivityLink.findMany({ where: { goalType: 'KR', goalId: { in: ids } }, select: { goalId: true } }),
          p.worklogGoalTag.groupBy({ by: ['goalId'], where: { goalType: 'KR', goalId: { in: ids } } }).catch(() => []),
        ]);
        const has = new Set([...links.map((l: any) => String(l.goalId)), ...(tags as any[]).map((t) => String(t.goalId))]);
        return ids.filter((id: string) => !has.has(String(id))).length;
      })(),
    ]);

    // 고아 활동 상위 3 (목표에 연결 안 된 활동 중 이번 주 일지 많은 것)
    const linkedActIds = new Set<string>(
      (await p.goalActivityLink.findMany({ select: { activityId: true } })).map((l: any) => String(l.activityId)),
    );
    const orphanTop: string[] = [];
    for (const r of orphan1 as any[]) {
      if (orphanTop.length >= 3) break;
      if (linkedActIds.has(String(r.activityId))) continue;
      const a = await p.activity.findUnique({ where: { id: r.activityId }, select: { name: true } });
      if (a) orphanTop.push(`${a.name}(${r._count._all}건)`);
    }

    const summary = [
      `이번 주 일지 ${wlWeek}건 중 활동 연결 ${wlLinkedWeek}건 · KPI 태깅 ${taggedWeek}건`,
      `신규 활동 ${newActs}개${unclassified ? ` · 미분류 ${unclassified}개` : ''}`,
      `실행 증거 없는 KPI ${kpiNoEvi}개`,
      orphanTop.length ? `목표 없는 실행: ${orphanTop.join(', ')}` : '',
    ].filter(Boolean).join(' | ');

    const execs = await p.user.findMany({ where: { role: { in: ['CEO', 'EXEC'] }, status: 'ACTIVE', NOT: { name: { in: ['김정중', '김선구'] } } }, select: { id: true } });
    for (const u of execs) {
      await p.notification.create({
        data: { userId: u.id, type: 'OntologyDigest', subjectType: 'Ontology', subjectId: 'weekly', payload: { day, summary, newActs, unclassified, wlWeek, wlLinkedWeek, taggedWeek, kpiNoEvi, orphanTop } },
      }).catch(() => {});
    }
    await this.markRun('OntologyDigest', { day, summary, recipients: execs.length });
    this.logger.log(`[autopilot] weekly digest sent to ${execs.length} execs: ${summary}`);
  }
}
