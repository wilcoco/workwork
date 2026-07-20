import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { mineWorklogActivities } from './lib/activity-miner';

/**
 * 온톨로지: 활동(Activity) 조회 API.
 * 등록/정합은 템플릿 저장 시 서버가 자동 수행(activity-resolver) — 여기는 읽기 전용.
 */
@Controller('activities')
export class ActivitiesController {
  constructor(private prisma: PrismaService) {}

  /** 업무일지에서 활동 추출·정합 (상향식 채굴, 팀장 이상). 반복 실행 시 미연결 일지만 이어서 처리 */
  @Post('mine-worklogs')
  async mineWorklogs(@Body() body: { actorId?: string; days?: number; onlyBadged?: boolean; limit?: number }) {
    const uid = String(body?.actorId || '').trim();
    if (!uid) throw new BadRequestException('actorId required');
    const actor = await (this.prisma as any).user.findUnique({ where: { id: uid }, select: { role: true } });
    if (!['CEO', 'EXEC', 'MANAGER'].includes(String(actor?.role || '').toUpperCase())) {
      throw new ForbiddenException('팀장 이상만 실행할 수 있습니다');
    }
    return mineWorklogActivities(this.prisma, { actorId: uid, days: body?.days ?? 180, onlyBadged: !!body?.onlyBadged, limit: body?.limit ?? 100 });
  }

  /** 활동 검색/목록 */
  @Get()
  async list(@Query('q') q?: string, @Query('limit') limitStr?: string) {
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

  /** 활동의 축적 지식(🏅 인증 일지) */
  @Get(':id/knowledge')
  async knowledge(@Param('id') id: string) {
    return this.knowledgeOf(id);
  }

  private async knowledgeOf(activityId: string) {
    const activity = await (this.prisma as any).activity.findUnique({ where: { id: activityId } });
    if (!activity) throw new BadRequestException('activity not found');
    const logs = await (this.prisma as any).worklog.findMany({
      where: { activityId, kbBadge: true, visibility: 'ALL' }, // 공개 일지만 (제한 일지 유출 방지)
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
  async dashboard() {
    const [activities, tplCounts, wlCounts, kbCounts, lastRuns] = await Promise.all([
      (this.prisma as any).activity.findMany({ orderBy: { createdAt: 'asc' } }),
      (this.prisma as any).processTaskTemplate.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null }, kbBadge: true }, _count: { _all: true } }),
      (this.prisma as any).worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _max: { date: true } }),
    ]);
    const m = (rows: any[], f = '_count') => new Map(rows.map((r: any) => [String(r.activityId), f === '_max' ? r._max.date : r._count._all]));
    const tplMap = m(tplCounts), wlMap = m(wlCounts), kbMap = m(kbCounts), lastMap = m(lastRuns, '_max');

    const items = activities.map((a: any) => ({
      id: a.id,
      name: a.name,
      taskType: a.taskType,
      roleHint: a.roleHint,
      aliasCount: Array.isArray(a.aliases) ? a.aliases.length : 0,
      templateUse: tplMap.get(String(a.id)) || 0,
      worklogCount: wlMap.get(String(a.id)) || 0,
      knowledgeCount: kbMap.get(String(a.id)) || 0,
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
}
