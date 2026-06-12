import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// 정량(KPI 지표) / 정성(OKR 과제·중점추진과제) 통합 대시보드 API
// - GET /api/goals-dashboard/my?userId=        : 개인 업무 과제 (내 정량 지표 + 정성 과제 + 중점과제)
// - GET /api/goals-dashboard/org-overview      : 전사 → 실 → 팀 → 개인 진행 현황
@Controller('goals-dashboard')
export class GoalsDashboardController {
  constructor(private prisma: PrismaService) {}

  // 최신값 vs 목표값 (direction 반영) — TeamKpiBoard와 동일 규약
  private krStatus(latestValue: number | null, target: number | null, direction?: string | null): 'OK' | 'WARN' | 'NONE' {
    if (latestValue == null || target == null) return 'NONE';
    const dir = direction === 'AT_MOST' ? 'AT_MOST' : 'AT_LEAST';
    const violate = dir === 'AT_LEAST' ? latestValue < target : latestValue > target;
    return violate ? 'WARN' : 'OK';
  }

  private krAchievementPct(latestValue: number | null, target: number | null, direction?: string | null): number | null {
    if (latestValue == null || target == null || target === 0) return null;
    const dir = direction === 'AT_MOST' ? 'AT_MOST' : 'AT_LEAST';
    const pct = dir === 'AT_LEAST' ? (latestValue / target) * 100 : (target / Math.max(latestValue, 0.000001)) * 100;
    return Math.round(pct * 10) / 10;
  }

  private isAutoObjective(title?: string | null) {
    return String(title || '').toLowerCase().includes('auto objective');
  }

  @Get('my')
  async my(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');

    // ── 정량: 내게 할당된 KPI 지표 (KeyResultAssignment) + 내가 owner인 팀 KPI KR
    const assigns = await this.prisma.keyResultAssignment.findMany({
      where: { userId },
      include: { keyResult: { include: { objective: { include: { orgUnit: { select: { name: true } } } } } } },
    });
    const ownedTeamKrs = await this.prisma.keyResult.findMany({
      where: { ownerId: userId, objective: { pillar: { not: null } } },
      include: { objective: { include: { orgUnit: { select: { name: true } } } } },
    });
    const krMap: Record<string, any> = {};
    for (const a of assigns) krMap[a.keyResultId] = a.keyResult;
    for (const kr of ownedTeamKrs) if (!krMap[kr.id]) krMap[kr.id] = kr;
    const krIds = Object.keys(krMap);

    // 각 KR의 최신 진척값 + 내 마지막 입력일
    const entries = krIds.length
      ? await this.prisma.progressEntry.findMany({
          where: { keyResultId: { in: krIds }, krValue: { not: null } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const latestByKr: Record<string, any> = {};
    const myLastByKr: Record<string, Date> = {};
    for (const e of entries) {
      if (e.keyResultId && !latestByKr[e.keyResultId]) latestByKr[e.keyResultId] = e;
      if (e.keyResultId && e.actorId === userId && !myLastByKr[e.keyResultId]) myLastByKr[e.keyResultId] = e.createdAt;
    }

    const quant = krIds.map((id) => {
      const kr = krMap[id];
      const latest = latestByKr[id] || null;
      const latestValue = latest?.krValue ?? null;
      return {
        krId: id,
        krTitle: kr.title,
        objTitle: kr.objective?.title || '',
        orgName: kr.objective?.orgUnit?.name || '',
        pillar: kr.objective?.pillar || null,
        metric: kr.metric,
        unit: kr.unit,
        target: kr.target,
        baseline: kr.baseline ?? null,
        direction: kr.direction || 'AT_LEAST',
        cadence: kr.cadence || 'MONTHLY',
        latestValue,
        latestAt: latest?.createdAt || null,
        achievementPct: this.krAchievementPct(latestValue, kr.target, kr.direction),
        status: this.krStatus(latestValue, kr.target, kr.direction),
        myLastInputAt: myLastByKr[id] || null,
      };
    });

    // ── 정성: 내가 owner인 과제 (Initiative) — 자동 생성(Auto Objective) 제외
    const inits = await this.prisma.initiative.findMany({
      where: { ownerId: userId, state: { not: 'CANCELLED' } },
      include: {
        keyResult: { include: { objective: { select: { title: true, pillar: true } } } },
        worklogs: { orderBy: { date: 'desc' }, take: 1, select: { date: true } },
        _count: { select: { worklogs: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const qual = inits
      .filter((i: any) => !this.isAutoObjective(i.keyResult?.objective?.title))
      .map((i: any) => ({
        id: i.id,
        title: i.title,
        objTitle: i.keyResult?.objective?.title || '',
        krTitle: i.keyResult?.title || '',
        isKpi: !!i.keyResult?.objective?.pillar,
        state: i.state,
        dueAt: i.dueAt,
        startAt: i.startAt,
        endAt: i.endAt,
        worklogCount: i._count?.worklogs ?? 0,
        lastWorklogAt: i.worklogs?.[0]?.date || null,
      }));

    // ── 중점 추진 과제: 내가 담당자이거나 등록자인 과제
    const kis = await (this.prisma as any).keyInitiative.findMany({
      where: { OR: [{ assigneeId: userId }, { createdById: userId }] },
      include: {
        alignsToObjective: { select: { id: true, title: true } },
        progress: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
    const now = new Date();
    const keyInits = kis.map((k: any) => {
      let warning: string | null = null;
      if (k.dueDate && k.status !== 'COMPLETED' && k.status !== 'CANCELLED') {
        const daysLeft = Math.ceil((new Date(k.dueDate).getTime() - now.getTime()) / 86400000);
        if (daysLeft < 0) warning = `기한 ${Math.abs(daysLeft)}일 초과`;
        else if (daysLeft <= 7) warning = `기한 ${daysLeft}일 남음`;
      }
      return {
        id: k.id,
        title: k.title,
        status: k.status,
        dueDate: k.dueDate,
        alignsTo: k.alignsToObjective?.title || null,
        latestProgress: k.progress?.[0]
          ? { content: k.progress[0].content, pct: k.progress[0].progressPct, at: k.progress[0].createdAt }
          : null,
        warning,
      };
    });

    const summary = {
      quantCount: quant.length,
      quantOk: quant.filter((q) => q.status === 'OK').length,
      quantWarn: quant.filter((q) => q.status === 'WARN').length,
      quantNoData: quant.filter((q) => q.status === 'NONE').length,
      qualActive: qual.filter((q) => q.state === 'ACTIVE' || q.state === 'PLANNED').length,
      qualDone: qual.filter((q) => q.state === 'DONE').length,
      kiOpen: keyInits.filter((k: any) => k.status !== 'COMPLETED' && k.status !== 'CANCELLED').length,
      kiDelayed: keyInits.filter((k: any) => k.status === 'DELAYED' || (k.warning || '').includes('초과')).length,
    };

    return { quant, qual, keyInits, summary };
  }

  @Get('org-overview')
  async orgOverview() {
    const units = await this.prisma.orgUnit.findMany({
      select: { id: true, name: true, type: true, parentId: true },
    });
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: true, orgUnitId: true },
    });

    // 팀 KPI(정량): pillar 있는 Objective의 KR + 최신값
    const teamObjs = await this.prisma.objective.findMany({
      where: { pillar: { not: null } },
      include: { keyResults: { include: { assignments: { select: { userId: true } } } } },
    });
    const allKrIds = teamObjs.flatMap((o) => o.keyResults.map((k) => k.id));
    const entries = allKrIds.length
      ? await this.prisma.progressEntry.findMany({
          where: { keyResultId: { in: allKrIds }, krValue: { not: null } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const latestByKr: Record<string, any> = {};
    for (const e of entries) {
      if (e.keyResultId && !latestByKr[e.keyResultId]) latestByKr[e.keyResultId] = e;
    }

    // 정성(OKR): pillar 없는 Objective + 하위 과제 상태 (Auto Objective 제외)
    const qualObjs = await this.prisma.objective.findMany({
      where: { pillar: null },
      include: {
        keyResults: { include: { initiatives: { select: { id: true, state: true, ownerId: true } } } },
        owner: { select: { id: true, name: true } },
      },
    });

    // 중점 추진 과제
    const kis = await (this.prisma as any).keyInitiative.findMany({
      include: {
        assignee: { select: { id: true, name: true } },
        alignsToObjective: { select: { title: true } },
        progress: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // 개인별 마지막 업무일지 일자 (전체 한 번에)
    const lastWl = await this.prisma.worklog.groupBy({
      by: ['createdById'],
      _max: { date: true },
    });
    const lastWlByUser: Record<string, Date | null> = {};
    for (const w of lastWl) lastWlByUser[w.createdById] = w._max.date;

    // 개인별 정량 할당 (KR assignments)
    const assigns = await this.prisma.keyResultAssignment.findMany({ select: { keyResultId: true, userId: true } });
    const assignsByUser: Record<string, string[]> = {};
    for (const a of assigns) {
      if (!assignsByUser[a.userId]) assignsByUser[a.userId] = [];
      assignsByUser[a.userId].push(a.keyResultId);
    }
    const krInfoById: Record<string, any> = {};
    for (const o of teamObjs) for (const k of o.keyResults) krInfoById[k.id] = { ...k, pillar: o.pillar, orgUnitId: o.orgUnitId };

    // 개인별 정성 과제 (Auto Objective 제외)
    const userInits = await this.prisma.initiative.findMany({
      where: { state: { not: 'CANCELLED' } },
      select: { id: true, state: true, ownerId: true, keyResult: { select: { objective: { select: { title: true, pillar: true } } } } },
    });
    const initsByUser: Record<string, { active: number; done: number; total: number }> = {};
    for (const i of userInits) {
      if (this.isAutoObjective((i as any).keyResult?.objective?.title)) continue;
      const u = i.ownerId;
      if (!initsByUser[u]) initsByUser[u] = { active: 0, done: 0, total: 0 };
      initsByUser[u].total += 1;
      if (i.state === 'DONE') initsByUser[u].done += 1;
      else if (i.state === 'ACTIVE' || i.state === 'PLANNED' || i.state === 'BLOCKED') initsByUser[u].active += 1;
    }

    const now = new Date();
    const result = units.map((unit) => {
      // 정량: 이 조직의 팀 KPI
      const unitObjs = teamObjs.filter((o) => o.orgUnitId === unit.id);
      const kpis = unitObjs.flatMap((o) =>
        o.keyResults.map((k) => {
          const latest = latestByKr[k.id] || null;
          const latestValue = latest?.krValue ?? null;
          return {
            krId: k.id,
            title: k.title,
            pillar: o.pillar,
            unit: k.unit,
            target: k.target,
            direction: k.direction || 'AT_LEAST',
            latestValue,
            latestAt: latest?.createdAt || null,
            achievementPct: this.krAchievementPct(latestValue, k.target, k.direction),
            status: this.krStatus(latestValue, k.target, k.direction),
          };
        }),
      );

      // 정성: 이 조직의 OKR (Auto Objective 제외)
      const unitQual = qualObjs
        .filter((o) => o.orgUnitId === unit.id && !this.isAutoObjective(o.title))
        .map((o) => {
          const allInits = o.keyResults.flatMap((k) => k.initiatives);
          return {
            id: o.id,
            title: o.title,
            ownerName: o.owner?.name || '',
            status: o.status,
            krCount: o.keyResults.length,
            initTotal: allInits.length,
            initDone: allInits.filter((i) => i.state === 'DONE').length,
            initActive: allInits.filter((i) => i.state === 'ACTIVE' || i.state === 'PLANNED' || i.state === 'BLOCKED').length,
          };
        });

      // 중점 추진 과제
      const unitKis = kis.filter((k: any) => k.orgUnitId === unit.id);
      const kiItems = unitKis.map((k: any) => {
        let warning: string | null = null;
        if (k.dueDate && k.status !== 'COMPLETED' && k.status !== 'CANCELLED') {
          const daysLeft = Math.ceil((new Date(k.dueDate).getTime() - now.getTime()) / 86400000);
          if (daysLeft < 0) warning = `기한 ${Math.abs(daysLeft)}일 초과`;
          else if (daysLeft <= 7) warning = `기한 ${daysLeft}일 남음`;
        }
        return {
          id: k.id,
          title: k.title,
          status: k.status,
          assigneeName: k.assignee?.name || null,
          dueDate: k.dueDate,
          alignsTo: k.alignsToObjective?.title || null,
          latestPct: k.progress?.[0]?.progressPct ?? null,
          warning,
        };
      });

      // 구성원별 현황
      const members = users
        .filter((u) => u.orgUnitId === unit.id)
        .map((u) => {
          const myKrIds = assignsByUser[u.id] || [];
          let ok = 0, warn = 0, noData = 0;
          for (const kid of myKrIds) {
            const k = krInfoById[kid];
            if (!k) continue;
            const latest = latestByKr[kid] || null;
            const st = this.krStatus(latest?.krValue ?? null, k.target, k.direction);
            if (st === 'OK') ok += 1; else if (st === 'WARN') warn += 1; else noData += 1;
          }
          const qi = initsByUser[u.id] || { active: 0, done: 0, total: 0 };
          const myKis = kis.filter((k: any) => k.assigneeId === u.id && k.status !== 'COMPLETED' && k.status !== 'CANCELLED');
          return {
            userId: u.id,
            name: u.name,
            role: u.role,
            quant: { count: myKrIds.length, ok, warn, noData },
            qual: qi,
            kiOpen: myKis.length,
            kiDelayed: myKis.filter((k: any) => k.status === 'DELAYED').length,
            lastWorklogAt: lastWlByUser[u.id] || null,
          };
        });

      return {
        id: unit.id,
        name: unit.name,
        type: unit.type,
        parentId: unit.parentId,
        kpis,
        qualObjectives: unitQual,
        keyInits: {
          total: kiItems.length,
          inProgress: kiItems.filter((k: any) => k.status === 'IN_PROGRESS').length,
          delayed: kiItems.filter((k: any) => k.status === 'DELAYED').length,
          completed: kiItems.filter((k: any) => k.status === 'COMPLETED').length,
          items: kiItems,
        },
        members,
      };
    });

    // 소속 조직이 없는 중점과제(전사 과제)도 누락 없이 반환
    const orphanKis = kis
      .filter((k: any) => !k.orgUnitId)
      .map((k: any) => ({
        id: k.id,
        title: k.title,
        status: k.status,
        assigneeName: k.assignee?.name || null,
        dueDate: k.dueDate,
        alignsTo: k.alignsToObjective?.title || null,
        latestPct: k.progress?.[0]?.progressPct ?? null,
      }));

    return { units: result, companyKeyInits: orphanKis };
  }
}
