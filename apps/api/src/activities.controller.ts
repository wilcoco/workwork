import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { mineWorklogActivities } from './lib/activity-miner';
import { mergeSimilarActivities } from './lib/activity-merge';
import { mineWorklogEntities } from './lib/entity-miner';
import { mapWorklogsToTeamKpis } from './lib/worklog-kpi-mapper';
import { bigramSim, normalizeActivityName, type ActivityLite } from './lib/activity-match';
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

  /** 활동 확인(승격) — AUTO(AI채굴)를 사람이 확인해 CONFIRMED로 (임원 이상). Foundry의 상태 승격에 해당 */
  @Post(':id/confirm')
  async confirmActivity(@Param('id') id: string, @Body() body: { actorId?: string }) {
    await this.assertExec(String(body?.actorId || ''));
    const a = await (this.prisma as any).activity.update({ where: { id }, data: { status: 'CONFIRMED' } });
    return { id: a.id, status: a.status };
  }

  /** 대상(설비·차종·고객사·부품·시스템) 채굴 — 일지에서 두 번째 객체 타입 추출 (임원 이상) */
  @Post('mine-entities')
  async mineEntities(@Body() body: { actorId?: string; days?: number; limit?: number }) {
    const uid = String(body?.actorId || '').trim();
    await this.assertExec(uid);
    return mineWorklogEntities(this.prisma, { days: body?.days ?? 180, limit: body?.limit ?? 100 });
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

  /** 일지→팀 KPI 배치 분류: 업무내용을 읽어 작성자 팀의 KPI에 태깅 (임원 이상). 반복 실행 = 이어서 처리.
   *  reclassify=true: KPI 목록이 바뀐 뒤 AI 태그만 재판정(USER 확정 보호). orgUnitId로 팀 한정, cutoff로 반복 수렴 */
  @Post('map-worklog-kpis')
  async mapWorklogKpis(@Body() body: { actorId?: string; limit?: number; reclassify?: boolean; orgUnitId?: string; cutoff?: string }) {
    const uid = String(body?.actorId || '').trim();
    if (!uid) throw new BadRequestException('actorId required');
    await this.assertExec(uid);
    return mapWorklogsToTeamKpis(this.prisma, {
      actorId: uid,
      limit: body?.limit,
      reclassify: body?.reclassify === true,
      orgUnitId: String(body?.orgUnitId || '').trim() || undefined,
      cutoff: String(body?.cutoff || '').trim() || undefined,
    });
  }

  /** 탑다운 매칭: KPI(KeyResult)·중점과제(KeyInitiative)를 활동과 연결 (팀장 이상) */
  @Post('map-goals')
  async mapGoals(@Body() body: { actorId?: string; enrich?: boolean }) {
    const uid = String(body?.actorId || '').trim();
    if (!uid) throw new BadRequestException('actorId required');
    await this.assertExec(uid);
    // enrich: 링크 1개뿐인 목표(구 단일매칭 백필분)도 재스캔해 다중 연결로 확장
    const enrich = body?.enrich === true;
    const acts = await (this.prisma as any).activity.findMany({ select: { id: true, name: true, normName: true, aliases: true, domain: true } });
    if (!acts.length) return { kpiMapped: 0, initiativeMapped: 0, note: '활동이 없습니다 — 먼저 추출/체계 정리를 실행하세요' };
    const actsLite: ActivityLite[] = acts.map((a: any) => ({ id: a.id, name: a.name, normName: a.normName, aliases: Array.isArray(a.aliases) ? a.aliases : [] }));
    const domainOf = new Map<string, string>(acts.map((a: any) => [a.id, a.domain || '']));

    // 매칭률 개선: 활동 전체(수천 개)를 프롬프트에 넣지 않고, 목표 텍스트별로
    // 유사도 상위 후보만 추려 그 안에서 고르게 한다(후보 밖 ID는 무시).
    // 후보 검색은 긴 설명문이 아니라 짧은 키(제목/산식)별로 — 긴 문자열은 bigram이 희석돼 후보가 안 잡힌다.
    // 주의: activity-match.shortlist()는 동일명 정합용 0.45 컷이 있어 여기선 부적합 →
    // 컷 없이 bigram 직접 랭킹(상위 25, 최소 0.08). 최종 판정은 AI가 후보 안에서 보수적으로.
    const candsForKeys = (keys: string[]) => {
      const best = new Map<string, { id: string; name: string; score: number }>();
      for (const key of keys) {
        const norm = normalizeActivityName(String(key || ''));
        if (norm.length < 2) continue;
        for (const a of actsLite) {
          let score = bigramSim(norm, a.normName);
          for (const al of a.aliases || []) score = Math.max(score, bigramSim(norm, normalizeActivityName(al)));
          // 포함 관계 부스트: 짧은 KPI 키가 활동명에 통째로 들어있으면(예: '도장품질' ⊂ '도장품질검사') 강한 후보
          if (score < 0.6 && (a.normName.includes(norm) || norm.includes(a.normName))) score = 0.6;
          const prev = best.get(a.id);
          if (!prev || score > prev.score) best.set(a.id, { id: a.id, name: a.name, score });
        }
      }
      return Array.from(best.values()).filter((c) => c.score >= 0.08).sort((a, b) => b.score - a.score).slice(0, 25);
    };
    const diag = { withCands: 0, aiCalls: 0, aiErrors: [] as string[], aiItems: 0, nulls: 0, invalidIds: 0 };
    // 다중 연결(1:N): 목표 하나가 여러 활동과 관련될 수 있다 — AI가 후보 중 관련 활동을 최대 5개까지 고른다.
    const mapBatch = async (rows: Array<{ id: string; text: string; keys: string[] }>, model: string): Promise<Map<string, string[]>> => {
      const out = new Map<string, string[]>();
      const prepped = rows.map((r) => ({
        ...r,
        cands: candsForKeys(r.keys),
      })).filter((r) => r.cands.length > 0);
      diag.withCands += prepped.length;
      const CHUNK = 8;
      for (let st = 0; st < prepped.length; st += CHUNK) {
        const chunk = prepped.slice(st, st + CHUNK);
        try {
          const user = chunk.map((r, j) =>
            `#${st + j} ${r.text}\n  후보: ${r.cands.map((c) => `[${c.id}] ${c.name}${domainOf.get(c.id) ? `(${domainOf.get(c.id)})` : ''}`).join(' | ')}`
          ).join('\n\n') + '\n\n출력: { "items": [{ "index": number, "activityIds": string[] }] }';
          const res = await callAI({
            model: 'claude',
            system: `너는 회사 목표와 활동 사전을 연결하는 사서다. 반드시 JSON만 출력한다.
각 ${model}이(가) 해당 항목의 [후보] 활동 중 어떤 활동들의 성과/개선과 직접 관련되는지 판정하라.
반드시 그 항목의 후보 안에서만 고르고, 직접 관련이 확실한 것만 0~5개 나열하라(관련도 높은 순).
확실치 않으면 빈 배열. 잘못된 연결이 더 해롭다.`,
            user,
            temperature: 0.1, maxTokens: 2000,
            jsonSchema: { name: 'goal_map', schema: { type: 'object' as const, properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, activityIds: { type: 'array', items: { type: 'string' } } }, required: ['index', 'activityIds'] } } }, required: ['items'] } },
          });
          diag.aiCalls++;
          for (const m of res?.parsed?.items || []) {
            diag.aiItems++;
            const idx = Number(m.index) - st;
            const row = chunk[idx];
            if (!row) continue;
            // 해당 행의 후보 안에서만 인정 (전체 사전 대비 오연결 방지)
            const valid = (Array.isArray(m.activityIds) ? m.activityIds : [])
              .filter((aid: any) => row.cands.some((c) => c.id === aid))
              .slice(0, 5);
            diag.invalidIds += (Array.isArray(m.activityIds) ? m.activityIds.length : 0) - valid.length;
            if (valid.length) out.set(row.id, valid as string[]);
            else diag.nulls++;
          }
        } catch (e: any) {
          diag.aiErrors.push(String(e?.message || e).slice(0, 160));
          console.error('[ontology] map-goals chunk failed:', e?.message?.slice(0, 120));
        }
      }
      return out;
    };
    // 링크 저장: 조인 테이블 upsert + 대표(primary) 컬럼은 비어있을 때 첫 번째로 채움
    const saveLinks = async (goalType: 'KR' | 'KI', goalId: string, activityIds: string[]) => {
      for (const aid of activityIds) {
        await (this.prisma as any).goalActivityLink.upsert({
          where: { goalType_goalId_activityId: { goalType, goalId, activityId: aid } },
          create: { goalType, goalId, activityId: aid },
          update: {},
        });
      }
      const model = goalType === 'KR' ? (this.prisma as any).keyResult : (this.prisma as any).keyInitiative;
      const cur = await model.findUnique({ where: { id: goalId }, select: { activityId: true } });
      if (!cur?.activityId && activityIds[0]) await model.update({ where: { id: goalId }, data: { activityId: activityIds[0] } });
    };

    // 스캔 대상 = 링크 없는 목표 (enrich 모드면 링크 1개짜리도 재스캔해 다중 연결로 확장)
    const allLinks = await (this.prisma as any).goalActivityLink.findMany({ select: { goalType: true, goalId: true } });
    const linkCount = new Map<string, number>();
    for (const l of allLinks) {
      const key = `${l.goalType}:${l.goalId}`;
      linkCount.set(key, (linkCount.get(key) || 0) + 1);
    }
    const needsScan = (type: 'KR' | 'KI', id: string) => {
      const c = linkCount.get(`${type}:${id}`) || 0;
      return c === 0 || (enrich && c <= 1);
    };

    // KPI (팀 KPI 지표) — Auto Objective 컨테이너 하위·정크(Auto KR 등)는 제외
    const krs = (await (this.prisma as any).keyResult.findMany({
      where: { NOT: { objective: { title: { startsWith: 'Auto Objective' } } } }, take: 400,
      select: { id: true, title: true, metric: true, objective: { select: { title: true } } },
    })).filter((k: any) => needsScan('KR', k.id) && String(k.title || '').trim().length >= 2 && !/^auto kr/i.test(String(k.title || '').trim()));
    const krMap = await mapBatch(krs.map((k: any) => ({
      id: k.id,
      text: `KPI: ${k.title}${k.metric ? ` (산식: ${k.metric})` : ''} / 목표: ${k.objective?.title || ''}`,
      keys: [k.title, k.metric].filter(Boolean),
    })), 'KPI 지표');
    for (const [id, aids] of krMap) await saveLinks('KR', id, aids);

    // 중점과제
    const kis = (await (this.prisma as any).keyInitiative.findMany({
      take: 400,
      select: { id: true, title: true, goal: true },
    })).filter((k: any) => needsScan('KI', k.id));
    const kiMap = await mapBatch(kis.map((k: any) => ({
      id: k.id,
      text: `과제: ${k.title}${k.goal ? ` / 목표: ${String(k.goal).slice(0, 80)}` : ''}`,
      keys: [k.title],
    })), '중점과제');
    for (const [id, aids] of kiMap) await saveLinks('KI', id, aids);

    return { kpiScanned: krs.length, kpiMapped: krMap.size, initiativeScanned: kis.length, initiativeMapped: kiMap.size, diag: { ...diag, aiErrors: diag.aiErrors.slice(0, 3) } };
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
      status: a.status || 'AUTO',
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
        where: { status: { notIn: ['COMPLETED', 'CANCELLED'] as any } }, // KeyInitiativeStatus에 'DONE' 없음 — 'DONE' 사용 시 Prisma 검증에러로 500
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

  /**
   * KPI 기여 분석 (임원): 선택 월에 대해
   *  ① 목표(KPI)별 투입시간·일지·인원·실적/달성률 랭킹 — "무엇이 KPI를 움직였나"
   *  ② 시간은 많이 쓰는데 어떤 목표에도 연결 안 된 활동 — "돈 안 되는 시간 어디에 쓰나"
   *  ③ 이번 달 실행 증거(일지) 없는 KPI
   * 기여 판정 = 결정론적 조인 두 갈래의 합집합:
   *  (a) 활동 링크: worklog.activityId == keyResult.activityId (🎯 매칭 전제)
   *  (b) 실적 입력: ProgressEntry(worklogId, keyResultId) — 일지에서 지표값을 직접 입력한 증거
   */
  @Get('kpi-contribution')
  async kpiContribution(@Query('actorId') actorId?: string, @Query('month') monthStr?: string) {
    await this.assertExec(actorId);
    const month = /^\d{4}-\d{2}$/.test(String(monthStr || '')) ? String(monthStr) : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    return this.computeMonthContribution(month);
  }

  /** 월별 기여 계산 코어 — kpi-contribution 과 company-pulse(현황판/추이)가 공유 */
  private async computeMonthContribution(month: string) {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(`${month}-01T00:00:00+09:00`);
    const end = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+09:00`);

    // Activity 는 관계(relation) 없는 독립 모델 — 조인 대신 별도 조회 후 Map 매핑
    const [worklogs, entries, krs, kiLinks, actRows, kpiTags] = await Promise.all([
      (this.prisma as any).worklog.findMany({
        where: { date: { gte: start, lt: end } },
        select: { id: true, activityId: true, timeSpentMinutes: true, createdById: true, createdBy: { select: { orgUnit: { select: { name: true } } } } },
      }),
      (this.prisma as any).progressEntry.findMany({
        where: { periodStart: { gte: start, lt: end }, NOT: { keyResultId: null } },
        orderBy: { createdAt: 'desc' },
        select: { keyResultId: true, worklogId: true, krValue: true },
      }),
      (this.prisma as any).keyResult.findMany({
        where: { NOT: { objective: { title: { startsWith: 'Auto Objective' } } } },
        select: {
          id: true, title: true, unit: true, target: true, direction: true, pillar: true, activityId: true,
          objective: { select: { title: true, pillar: true, orgUnit: { select: { name: true } } } },
        },
      }),
      (this.prisma as any).goalActivityLink.findMany({ select: { goalType: true, goalId: true, activityId: true } }),
      (this.prisma as any).activity.findMany({ select: { id: true, name: true, domain: true } }),
      (this.prisma as any).worklogGoalTag.findMany({ where: { goalType: 'KR' }, select: { worklogId: true, goalId: true } }),
    ]);
    const actInfo = new Map<string, { name: string; domain: string | null }>(
      (actRows as any[]).map((a) => [String(a.id), { name: a.name, domain: a.domain || null }]),
    );
    // 목표별 연결 활동 (다중, 조인 테이블 기준 + 레거시 단일컬럼 병합)
    const krActIds = new Map<string, Set<string>>();
    for (const l of kiLinks as any[]) {
      if (l.goalType !== 'KR') continue;
      const s = krActIds.get(String(l.goalId)) || new Set<string>();
      s.add(String(l.activityId));
      krActIds.set(String(l.goalId), s);
    }
    // 증거 ③: 일지→KPI 분류 태그 (AI 배치 + 본인 분류)
    const tagWlByKr = new Map<string, Set<string>>();
    const taggedWl = new Set<string>();
    for (const t of kpiTags as any[]) {
      if (!t.goalId) continue;
      const s = tagWlByKr.get(String(t.goalId)) || new Set<string>();
      s.add(String(t.worklogId));
      tagWlByKr.set(String(t.goalId), s);
      taggedWl.add(String(t.worklogId));
    }

    // 지표별 실적(월 최신값) + 실적 입력에 연결된 일지들
    const valByKr = new Map<string, number>();
    const entryWlByKr = new Map<string, Set<string>>();
    const entryLinkedWl = new Set<string>();
    for (const e of entries) {
      const kid = String(e.keyResultId);
      if (e.krValue != null && !valByKr.has(kid)) valByKr.set(kid, e.krValue); // createdAt desc → 첫 값이 최신
      if (e.worklogId) {
        const s = entryWlByKr.get(kid) || new Set<string>();
        s.add(String(e.worklogId));
        entryWlByKr.set(kid, s);
        entryLinkedWl.add(String(e.worklogId));
      }
    }

    // 활동별 월 일지 묶음
    const wlByActivity = new Map<string, any[]>();
    for (const w of worklogs) {
      if (!w.activityId) continue;
      const arr = wlByActivity.get(String(w.activityId)) || [];
      arr.push(w);
      wlByActivity.set(String(w.activityId), arr);
    }
    const wlById = new Map(worklogs.map((w: any) => [String(w.id), w]));

    const achOf = (kr: any, v: number | null): number | null => {
      if (v == null || kr.target == null) return null;
      let pct: number;
      if (kr.direction === 'AT_MOST') {
        if (v <= 0) return 100;
        if (kr.target === 0) return 0;
        pct = (kr.target / v) * 100;
      } else {
        if (kr.target === 0) return null;
        pct = (v / kr.target) * 100;
      }
      return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
    };

    // KPI(필러 있는 지표)만 대상
    const kpiKrs = krs.filter((k: any) => k.pillar || k.objective?.pillar);
    const goals = kpiKrs.map((kr: any) => {
      // 연결 활동들(다중) — 조인 테이블 + 레거시 컬럼 병합
      const aidSet = new Set<string>(krActIds.get(String(kr.id)) || []);
      if (kr.activityId) aidSet.add(String(kr.activityId));
      const evidence = new Map<string, any>();
      for (const aid of aidSet) for (const w of wlByActivity.get(aid) || []) evidence.set(String(w.id), w);
      for (const wid of entryWlByKr.get(String(kr.id)) || []) {
        const w = wlById.get(wid);
        if (w) evidence.set(wid, w);
      }
      // ③ 분류 태그 경로 (해당 월 일지만 — wlById가 월 범위)
      for (const wid of tagWlByKr.get(String(kr.id)) || []) {
        const w = wlById.get(wid);
        if (w) evidence.set(wid, w);
      }
      const evArr = Array.from(evidence.values());
      const minutes = evArr.reduce((s, w) => s + (w.timeSpentMinutes || 0), 0);
      const people = new Set(evArr.map((w) => w.createdById)).size;
      const value = valByKr.get(String(kr.id)) ?? null;
      const actNames = Array.from(aidSet).map((aid) => actInfo.get(aid)?.name).filter(Boolean) as string[];
      return {
        krId: kr.id, title: kr.title, unit: kr.unit || '', target: kr.target,
        pillar: kr.pillar || kr.objective?.pillar || null,
        teamName: kr.objective?.orgUnit?.name || '',
        activityName: actNames.length ? actNames.slice(0, 3).join(', ') + (actNames.length > 3 ? ` 외 ${actNames.length - 3}` : '') : null,
        activityCount: aidSet.size,
        value, ach: achOf(kr, value),
        minutes, logs: evArr.length, people,
      };
    }).sort((a: any, b: any) => b.minutes - a.minutes);

    // 목표(지표·중점과제) 어딘가에 연결된 활동 집합 (조인 테이블 전체 + 레거시)
    const linkedActIds = new Set<string>();
    for (const l of kiLinks as any[]) linkedActIds.add(String(l.activityId));
    for (const k of krs) if (k.activityId) linkedActIds.add(String(k.activityId));

    // ② 시간多·기여低: 이번 달 투입시간 상위인데 어떤 목표에도 연결 안 된 활동
    const lowAgg = new Map<string, { name: string; domain: string | null; minutes: number; logs: number; people: Set<string> }>();
    for (const [aid, arr] of wlByActivity) {
      if (linkedActIds.has(aid)) continue;
      const minutes = arr.reduce((s, w) => s + (w.timeSpentMinutes || 0), 0);
      if (minutes <= 0) continue;
      const info = actInfo.get(aid);
      lowAgg.set(aid, {
        name: info?.name || '(활동)', domain: info?.domain || null,
        minutes, logs: arr.length, people: new Set(arr.map((w: any) => w.createdById)),
      });
    }
    const lowContribution = Array.from(lowAgg.entries())
      .map(([activityId, v]) => ({ activityId, name: v.name, domain: v.domain, minutes: v.minutes, logs: v.logs, people: v.people.size }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 20);

    // 전략 정렬률: 이번 달 전체 일지 시간 중 목표 연결(활동 링크 or 실적 입력) 시간 비율
    let totalMinutes = 0, linkedMinutes = 0;
    const teamAgg = new Map<string, { totalMin: number; linkedMin: number; logs: number }>();
    for (const w of worklogs) {
      const t = w.timeSpentMinutes || 0;
      totalMinutes += t;
      const isLinked = (w.activityId && linkedActIds.has(String(w.activityId))) || entryLinkedWl.has(String(w.id)) || taggedWl.has(String(w.id));
      if (isLinked) linkedMinutes += t;
      const tn = w.createdBy?.orgUnit?.name || '(팀없음)';
      const e = teamAgg.get(tn) || { totalMin: 0, linkedMin: 0, logs: 0 };
      e.totalMin += t; e.logs++;
      if (isLinked) e.linkedMin += t;
      teamAgg.set(tn, e);
    }
    const teams = Array.from(teamAgg.entries())
      .map(([name, e]) => ({ name, totalMin: e.totalMin, linkedMin: e.linkedMin, logs: e.logs, pct: e.totalMin > 0 ? Math.round((e.linkedMin / e.totalMin) * 1000) / 10 : null }))
      .sort((a, b) => b.totalMin - a.totalMin);

    const noEvidence = goals.filter((g: any) => g.logs === 0 && g.value == null).map((g: any) => ({ krId: g.krId, title: g.title, teamName: g.teamName, pillar: g.pillar }));

    return {
      month,
      align: { totalMinutes, linkedMinutes, pct: totalMinutes > 0 ? Math.round((linkedMinutes / totalMinutes) * 1000) / 10 : null },
      coverage: { totalGoals: goals.length, withEvidence: goals.filter((g: any) => g.logs > 0 || g.value != null).length, matchedGoals: kpiKrs.filter((k: any) => k.activityId || krActIds.has(String(k.id))).length },
      goals,
      teams,
      lowContribution,
      noEvidence,
    };
  }

  /**
   * 회사 실행 현황판 (임원): 이번 달 상세 + 최근 6개월 추이를 한 번에.
   * "회사의 시간이 어디로 흐르고(기둥·팀·KPI 모자이크), 무엇을 움직였나"를 그래픽으로 보여주는 데이터.
   */
  @Get('company-pulse')
  async companyPulse(@Query('actorId') actorId?: string, @Query('month') monthStr?: string) {
    await this.assertExec(actorId);
    const month = /^\d{4}-\d{2}$/.test(String(monthStr || '')) ? String(monthStr) : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    // 선택 월 포함 최근 6개월
    const months: string[] = [];
    let [y, m] = month.split('-').map(Number);
    for (let i = 0; i < 6; i++) {
      months.unshift(`${y}-${String(m).padStart(2, '0')}`);
      m--; if (m === 0) { m = 12; y--; }
    }
    const results = [] as Array<{ month: string; data: any }>;
    for (const mm of months) results.push({ month: mm, data: await this.computeMonthContribution(mm) });
    const cur = results[results.length - 1].data;
    return {
      month,
      align: cur.align,
      coverage: cur.coverage,
      goals: cur.goals,
      teams: cur.teams,
      lowContribution: cur.lowContribution,
      noEvidenceCount: (cur.noEvidence || []).length,
      trend: results.map((r) => ({
        month: r.month,
        totalMinutes: r.data.align.totalMinutes,
        linkedMinutes: r.data.align.linkedMinutes,
        pct: r.data.align.pct,
      })),
    };
  }
}
