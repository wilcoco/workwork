import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { mineWorklogActivities } from './lib/activity-miner';
import { mergeSimilarActivities } from './lib/activity-merge';
import { callAI } from './llm/ai-client';

/** 체계 대분류 — 제한된 풀 (AI는 이 안에서만 고른다) */
const DOMAINS = ['영업', '연구개발', '금형', '생산-사출', '생산-도장', '생산-조립', '생산관리', '품질', '구매·자재', '물류', '설비·보전', '경영지원', '안전·환경', '기타'];

/**
 * 온톨로지: 활동(Activity) 조회 API.
 * 등록/정합은 템플릿 저장 시 서버가 자동 수행(activity-resolver) — 여기는 읽기 전용.
 */
@Controller('activities')
export class ActivitiesController {
  constructor(private prisma: PrismaService) {}

  /** 활동 지도는 전사 실행·목표 데이터를 한눈에 펼치므로 임원 이상 전용. 반환값 = 뷰어 role */
  private async assertExec(uid?: string): Promise<string> {
    const id = String(uid || '').trim();
    if (!id) throw new BadRequestException('actorId required');
    const actor = await (this.prisma as any).user.findUnique({ where: { id }, select: { role: true } });
    const role = String(actor?.role || '').toUpperCase();
    if (!['CEO', 'EXEC'].includes(role)) throw new ForbiddenException('임원 이상만 볼 수 있습니다');
    return role;
  }

  /** 업무일지에서 활동 추출·정합 (상향식 채굴, 임원 이상). 반복 실행 시 미연결 일지만 이어서 처리 */
  @Post('mine-worklogs')
  async mineWorklogs(@Body() body: { actorId?: string; days?: number; onlyBadged?: boolean; limit?: number }) {
    const uid = String(body?.actorId || '').trim();
    if (!uid) throw new BadRequestException('actorId required');
    await this.assertExec(uid);
    return mineWorklogActivities(this.prisma, { actorId: uid, days: body?.days ?? 180, onlyBadged: !!body?.onlyBadged, limit: body?.limit ?? 100 });
  }

  /** 유사 활동 병합 — 잘게 쪼개진 활동을 하나의 반복작업으로 통합 (임원 이상). 반복 실행 시 남은 후보 이어서 처리 */
  @Post('merge-similar')
  async mergeSimilar(@Body() body: { actorId?: string; limit?: number; threshold?: number; dryRun?: boolean }) {
    const uid = String(body?.actorId || '').trim();
    await this.assertExec(uid);
    return mergeSimilarActivities(this.prisma, { actorId: uid, limit: body?.limit, threshold: body?.threshold, dryRun: !!body?.dryRun });
  }

  /** 체계 정리 — 미분류 활동을 대분류(고정 풀)/중분류로 AI 분류 (임원 이상) */
  @Post('organize')
  async organize(@Body() body: { actorId?: string }) {
    const uid = String(body?.actorId || '').trim();
    if (!uid) throw new BadRequestException('actorId required');
    await this.assertExec(uid);
    const acts = await (this.prisma as any).activity.findMany({
      where: { domain: null },
      select: { id: true, name: true, taskType: true, roleHint: true },
      take: 300,
    });
    if (!acts.length) return { classified: 0, remaining: 0 };
    let classified = 0;
    const CHUNK = 30;
    for (let start = 0; start < acts.length; start += CHUNK) {
      const chunk = acts.slice(start, start + CHUNK);
      try {
        const res = await callAI({
          model: 'claude',
          system: `너는 자동차 부품 제조사(캠스)의 업무 체계 분류 담당이다. 반드시 JSON만 출력한다.
각 활동을 대분류(domain)와 중분류(category)로 분류하라.
- domain은 반드시 다음 중 하나: ${DOMAINS.join(', ')}
- category는 2~8자 명사형 소그룹 (예: 발주, 검사, 견적, 보고서, 결재, 일정관리). 비슷한 활동은 같은 category로.
출력: { "items": [{ "index": number, "domain": string, "category": string }] }`,
          user: chunk.map((a: any, j: number) => `#${start + j} ${a.name}${a.roleHint ? ` (담당: ${a.roleHint})` : ''}`).join('\n'),
          temperature: 0.1, maxTokens: 3000,
          jsonSchema: {
            name: 'organize',
            schema: { type: 'object' as const, properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, domain: { type: 'string' }, category: { type: 'string' } }, required: ['index', 'domain'] } } }, required: ['items'] },
          },
        });
        for (const m of res?.parsed?.items || []) {
          const idx = Number(m.index) - start;
          const a = chunk[idx];
          if (!a) continue;
          const domain = DOMAINS.includes(String(m.domain)) ? String(m.domain) : '기타'; // 풀 밖 값 방지
          const category = String(m.category || '').trim().slice(0, 20) || null;
          await (this.prisma as any).activity.update({ where: { id: a.id }, data: { domain, category } });
          classified++;
        }
      } catch (e: any) {
        console.error('[ontology] organize chunk failed:', e?.message?.slice(0, 150));
      }
    }
    const remaining = await (this.prisma as any).activity.count({ where: { domain: null } });
    return { classified, remaining };
  }

  /** 탑다운 매칭: KPI(KeyResult)·중점과제(KeyInitiative)를 활동과 연결 (팀장 이상) */
  @Post('map-goals')
  async mapGoals(@Body() body: { actorId?: string }) {
    const uid = String(body?.actorId || '').trim();
    if (!uid) throw new BadRequestException('actorId required');
    await this.assertExec(uid);
    const acts = await (this.prisma as any).activity.findMany({ select: { id: true, name: true, domain: true } });
    if (!acts.length) return { kpiMapped: 0, initiativeMapped: 0, note: '활동이 없습니다 — 먼저 추출/체계 정리를 실행하세요' };
    const actList = acts.map((a: any) => `[${a.id}] ${a.name}${a.domain ? ` (${a.domain})` : ''}`).join('\n');

    const mapBatch = async (rows: Array<{ id: string; text: string }>, model: string): Promise<Map<string, string>> => {
      const out = new Map<string, string>();
      const CHUNK = 25;
      for (let st = 0; st < rows.length; st += CHUNK) {
        const chunk = rows.slice(st, st + CHUNK);
        try {
          const res = await callAI({
            model: 'claude',
            system: `너는 회사 목표와 활동 사전을 연결하는 사서다. 반드시 JSON만 출력한다.
각 ${model}이(가) 아래 [활동 목록] 중 어떤 활동의 성과/개선과 직접 관련되는지 판정하라.
직접 관련이 확실할 때만 activityId를 지정하고, 애매하면 null. 잘못된 연결이 더 해롭다.
[활동 목록]\n${actList}`,
            user: chunk.map((r, j) => `#${st + j} ${r.text}`).join('\n') + '\n\n출력: { "items": [{ "index": number, "activityId": string|null }] }',
            temperature: 0.1, maxTokens: 1500,
            jsonSchema: { name: 'goal_map', schema: { type: 'object' as const, properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, activityId: { type: ['string', 'null'] } }, required: ['index'] } } }, required: ['items'] } },
          });
          for (const m of res?.parsed?.items || []) {
            const idx = Number(m.index) - st;
            const row = chunk[idx];
            const vid = m.activityId && acts.some((a: any) => a.id === m.activityId) ? String(m.activityId) : null;
            if (row && vid) out.set(row.id, vid);
          }
        } catch (e: any) { console.error('[ontology] map-goals chunk failed:', e?.message?.slice(0, 120)); }
      }
      return out;
    };

    // KPI (팀 KPI 지표)
    const krs = await (this.prisma as any).keyResult.findMany({
      where: { activityId: null }, take: 200,
      select: { id: true, title: true, metric: true, objective: { select: { title: true } } },
    });
    const krMap = await mapBatch(krs.map((k: any) => ({ id: k.id, text: `KPI: ${k.title}${k.metric ? ` (산식: ${k.metric})` : ''} / 목표: ${k.objective?.title || ''}` })), 'KPI 지표');
    for (const [id, aid] of krMap) await (this.prisma as any).keyResult.update({ where: { id }, data: { activityId: aid } });

    // 중점과제
    const kis = await (this.prisma as any).keyInitiative.findMany({
      where: { activityId: null }, take: 200,
      select: { id: true, title: true, goal: true },
    });
    const kiMap = await mapBatch(kis.map((k: any) => ({ id: k.id, text: `과제: ${k.title}${k.goal ? ` / 목표: ${String(k.goal).slice(0, 80)}` : ''}` })), '중점과제');
    for (const [id, aid] of kiMap) await (this.prisma as any).keyInitiative.update({ where: { id }, data: { activityId: aid } });

    return { kpiScanned: krs.length, kpiMapped: krMap.size, initiativeScanned: kis.length, initiativeMapped: kiMap.size };
  }

  /** 활동 검색/목록 */
  @Get()
  async list(@Query('q') q?: string, @Query('limit') limitStr?: string, @Query('actorId') actorId?: string) {
    await this.assertExec(actorId);
    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 200);
    const where: any = q?.trim() ? { name: { contains: q.trim(), mode: 'insensitive' } } : {};
    const items = await (this.prisma as any).activity.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit });
    return { items };
  }

  /** 특정 프로세스 태스크(인스턴스)의 활동 + 축적 지식 — 일지 작성 화면의 "이 작업의 과거 지식" */
  @Get('for-task/:taskInstanceId')
  async forTask(@Param('taskInstanceId') taskInstanceId: string) {
    const ti = await (this.prisma as any).processTaskInstance.findUnique({
      where: { id: taskInstanceId },
      select: { taskTemplate: { select: { activityId: true } } },
    });
    const activityId = ti?.taskTemplate?.activityId;
    if (!activityId) return { activity: null, knowledge: [] };
    return this.knowledgeOf(activityId);
  }

  /** 활동의 축적 지식(🏅 인증 일지) — 활동 지도(임원 이상)에서 호출, 모든 공개범위 자료 활용 */
  @Get(':id/knowledge')
  async knowledge(@Param('id') id: string, @Query('actorId') actorId?: string) {
    const role = await this.assertExec(actorId);
    const vis = role === 'CEO' ? undefined : { in: ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'] };
    return this.knowledgeOf(id, vis);
  }

  /** visibilityFilter 미지정(공개 ALL만) = 일반 구성원용(for-task). undefined 전달 = 전체 */
  private async knowledgeOf(activityId: string, visibilityFilter: any = 'ALL') {
    const activity = await (this.prisma as any).activity.findUnique({ where: { id: activityId } });
    if (!activity) throw new BadRequestException('activity not found');
    const logs = await (this.prisma as any).worklog.findMany({
      where: { activityId, kbBadge: true, ...(visibilityFilter !== undefined ? { visibility: visibilityFilter } : {}) },
      orderBy: { date: 'desc' },
      take: 5,
      select: { id: true, note: true, kbBadgeNote: true, date: true, createdBy: { select: { name: true } } },
    });
    const knowledge = logs.map((w: any) => {
      const lines = String(w.note || '').replace(/<[^>]+>/g, ' ').split(/\n+/);
      return {
        id: w.id,
        title: (lines[0] || '').trim().slice(0, 120),
        excerpt: lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 240),
        badgeNote: w.kbBadgeNote || '',
        authorName: w.createdBy?.name || '',
        date: w.date,
      };
    });
    return { activity: { id: activity.id, name: activity.name, taskType: activity.taskType, criteria: activity.criteria, roleHint: activity.roleHint, aliases: activity.aliases || [] }, knowledge };
  }

  /**
   * 회사 활동 지도 대시보드 — 활동별 사용도(프로세스)·실행량(일지)·지식 밀도(🏅).
   * "회사가 무슨 일을 하고, 어디에 지식이 쌓였고, 어디가 비어 있는가"의 조망.
   */
  @Get('dashboard/overview')
  async dashboard(@Query('actorId') actorId?: string) {
    await this.assertExec(actorId);
    const [activities, tplCounts, wlCounts, kbCounts, lastRuns, kpiCounts, kiCounts] = await Promise.all([
      (this.prisma as any).activity.findMany({ orderBy: { createdAt: 'asc' } }),
      (this.prisma as any).processTaskTemplate.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null }, kbBadge: true }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _max: { date: true } }),
      (this.prisma as any).keyResult.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
      (this.prisma as any).keyInitiative.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
    ]);
    const m = (rows: any[], f = '_count') => new Map(rows.map((r: any) => [String(r.activityId), f === '_max' ? r._max.date : r._count._all]));
    const tplMap = m(tplCounts), wlMap = m(wlCounts), kbMap = m(kbCounts), lastMap = m(lastRuns, '_max');
    const kpiMap = m(kpiCounts), kiMap2 = m(kiCounts);

    const items = activities.map((a: any) => ({
      id: a.id,
      name: a.name,
      taskType: a.taskType,
      roleHint: a.roleHint,
      domain: a.domain || null,
      category: a.category || null,
      aliasCount: Array.isArray(a.aliases) ? a.aliases.length : 0,
      templateUse: tplMap.get(String(a.id)) || 0,
      worklogCount: wlMap.get(String(a.id)) || 0,
      knowledgeCount: kbMap.get(String(a.id)) || 0,
      kpiCount: kpiMap.get(String(a.id)) || 0,
      initiativeCount: kiMap2.get(String(a.id)) || 0,
      lastRunAt: lastMap.get(String(a.id)) || null,
      createdAt: a.createdAt,
    }));

    const totals = {
      activities: items.length,
      withKnowledge: items.filter((x: any) => x.knowledgeCount > 0).length,
      executedActivities: items.filter((x: any) => x.worklogCount > 0).length,
      totalKnowledge: items.reduce((s: number, x: any) => s + x.knowledgeCount, 0),
      byType: {
        WORKLOG: items.filter((x: any) => x.taskType === 'WORKLOG').length,
        APPROVAL: items.filter((x: any) => x.taskType === 'APPROVAL').length,
        COOPERATION: items.filter((x: any) => x.taskType === 'COOPERATION').length,
      },
    };
    // 조망 인사이트: 많이 실행되는데 지식이 없는 활동(리스크) / 지식 밀집 활동(자산)
    const risky = [...items].filter((x: any) => x.worklogCount >= 3 && x.knowledgeCount === 0).sort((a: any, b: any) => b.worklogCount - a.worklogCount).slice(0, 10);
    const rich = [...items].filter((x: any) => x.knowledgeCount > 0).sort((a: any, b: any) => b.knowledgeCount - a.knowledgeCount).slice(0, 10);
    return { totals, items, risky, rich };
  }

  /**
   * 전략 정렬 지도 — 탑다운(전략 기둥 ▸ Objective ▸ KR/과제)과 바텀업(활동 ▸ 일지)을 잇는다.
   * 각 목표에 연결된 활동의 실행량(일지)·지식(🏅)을 굴려올려, "선언된 목표에 실행 증거가 있는가",
   * "실행은 많은데 목표에 연결 안 된 활동은 무엇인가"를 양방향으로 대조한다. (임원 이상)
   */
  @Get('strategy-map')
  async strategyMap(@Query('actorId') actorId?: string) {
    await this.assertExec(actorId);
    const [objectives, initiatives, activities, wlCounts, kbCounts] = await Promise.all([
      (this.prisma as any).objective.findMany({
        select: {
          id: true, title: true, pillar: true, parentId: true,
          orgUnit: { select: { name: true } },
          keyResults: { select: { id: true, title: true, metric: true, unit: true, target: true, activityId: true } },
        },
      }),
      (this.prisma as any).keyInitiative.findMany({
        where: { status: { not: 'DONE' } },
        select: { id: true, title: true, status: true, activityId: true, alignsToObjectiveId: true, orgUnit: { select: { name: true } } },
      }),
      (this.prisma as any).activity.findMany({ select: { id: true, name: true, domain: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null }, kbBadge: true }, _count: { _all: true } }),
    ]);

    const wlMap = new Map(wlCounts.map((r: any) => [String(r.activityId), r._count._all]));
    const kbMap = new Map(kbCounts.map((r: any) => [String(r.activityId), r._count._all]));
    const actMap = new Map((activities as any[]).map((a) => [String(a.id), a]));
    const evi = (activityId: string | null) => {
      if (!activityId) return { activityId: null, activityName: null, domain: null, worklogCount: 0, knowledgeCount: 0 };
      const a = actMap.get(String(activityId));
      return { activityId, activityName: a?.name || '(삭제된 활동)', domain: a?.domain || null, worklogCount: Number(wlMap.get(String(activityId)) || 0), knowledgeCount: Number(kbMap.get(String(activityId)) || 0) };
    };

    // 과제를 정렬된 Objective별로 묶기
    const kiByObj = new Map<string, any[]>();
    for (const ki of initiatives) {
      if (!ki.alignsToObjectiveId) continue;
      const arr = kiByObj.get(ki.alignsToObjectiveId) || [];
      arr.push({ id: ki.id, title: ki.title, status: ki.status, orgUnitName: ki.orgUnit?.name || null, ...evi(ki.activityId) });
      kiByObj.set(ki.alignsToObjectiveId, arr);
    }

    const objOut = objectives.map((o: any) => {
      const krs = (o.keyResults || []).map((k: any) => ({ id: k.id, title: k.title, metric: k.metric, unit: k.unit, target: k.target, ...evi(k.activityId) }));
      const kis = kiByObj.get(o.id) || [];
      const goals = [...krs, ...kis];
      const worklogs = goals.reduce((s, g) => s + g.worklogCount, 0);
      const knowledge = goals.reduce((s, g) => s + g.knowledgeCount, 0);
      const linkedGoals = goals.filter((g) => g.activityId).length;
      return {
        id: o.id, title: o.title, pillar: o.pillar || null,
        orgUnitName: o.orgUnit?.name || null,
        auto: /^Auto Objective/i.test(o.title || ''),
        krs, initiatives: kis,
        exec: { worklogs, knowledge, totalGoals: goals.length, linkedGoals, unlinkedGoals: goals.length - linkedGoals },
      };
    });

    // 역방향 공백: 실행(일지)은 많은데 어떤 목표에도 연결 안 된 활동 상위 12
    const linkedActIds = new Set<string>();
    for (const o of objOut) for (const g of [...o.krs, ...o.initiatives]) if (g.activityId) linkedActIds.add(String(g.activityId));
    const orphanActivities = (activities as any[])
      .map((a) => ({ id: a.id, name: a.name, domain: a.domain || null, worklogCount: Number(wlMap.get(String(a.id)) || 0), knowledgeCount: Number(kbMap.get(String(a.id)) || 0) }))
      .filter((a) => !linkedActIds.has(String(a.id)) && a.worklogCount >= 3)
      .sort((a, b) => b.worklogCount - a.worklogCount)
      .slice(0, 12);

    const totalGoals = objOut.reduce((s: number, o: any) => s + o.exec.totalGoals, 0);
    const linkedGoals = objOut.reduce((s: number, o: any) => s + o.exec.linkedGoals, 0);
    const totals = {
      objectives: objOut.length,
      goals: totalGoals,
      linkedGoals,
      // 실행 증거 없는 목표: 연결 활동 일지 0 (또는 미연결)
      deadGoals: objOut.reduce((s: number, o: any) => s + [...o.krs, ...o.initiatives].filter((g: any) => g.worklogCount === 0).length, 0),
      orphanActivities: orphanActivities.length,
    };
    return { totals, objectives: objOut, orphanActivities };
  }
}
