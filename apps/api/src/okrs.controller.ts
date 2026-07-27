import { Body, Controller, Get, Param, Post, Put, Query, Delete, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { AuditLogService } from './audit-log.service';
import { isAncestorOrgManager } from './lib/org-hierarchy';

class CreateObjectiveDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsString() alignsToKrId?: string;
  @IsOptional() @IsString() orgUnitId?: string;
  // Optional: create multiple KRs together
  // Using any[] for simplicity; validated minimally at runtime
  @IsOptional() krs?: Array<{ title: string; metric: string; target: number; unit: string; type?: 'PROJECT' | 'OPERATIONAL'; analysis25?: string }>;
  @IsOptional() @IsEnum({ Q: 'Q', C: 'C', D: 'D', DEV: 'DEV', P: 'P' } as any)
  pillar?: 'Q' | 'C' | 'D' | 'DEV' | 'P';
}

class CreateKeyResultDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() metric!: string;
  @IsNumber() target!: number;
  @IsString() @IsNotEmpty() unit!: string;
  @IsOptional() @IsEnum({ PROJECT: 'PROJECT', OPERATIONAL: 'OPERATIONAL' } as any)
  type?: 'PROJECT' | 'OPERATIONAL';
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsEnum({ Q: 'Q', C: 'C', D: 'D', DEV: 'DEV', P: 'P' } as any)
  pillar?: 'Q' | 'C' | 'D' | 'DEV' | 'P';
  @IsOptional() @IsNumber()
  baseline?: number;
  @IsOptional() @IsNumber()
  year25Target?: number;
  @IsOptional() @IsEnum({ AT_LEAST: 'AT_LEAST', AT_MOST: 'AT_MOST' } as any)
  direction?: 'AT_LEAST' | 'AT_MOST';
  @IsOptional() @IsEnum({ DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', QUARTERLY: 'QUARTERLY', HALF_YEARLY: 'HALF_YEARLY', YEARLY: 'YEARLY' } as any)
  cadence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
  @IsOptional()
  participants?: string[];
  @IsOptional() @IsString()
  analysis25?: string;
}

class UpdateObjectiveDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() periodStart?: string;
  @IsOptional() @IsDateString() periodEnd?: string;
  @IsOptional() @IsEnum({ Q: 'Q', C: 'C', D: 'D', DEV: 'DEV', P: 'P' } as any)
  pillar?: 'Q' | 'C' | 'D' | 'DEV' | 'P';
}

class UpdateKeyResultDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() metric?: string;
  @IsOptional() @IsNumber() target?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsEnum({ PROJECT: 'PROJECT', OPERATIONAL: 'OPERATIONAL' } as any)
  type?: 'PROJECT' | 'OPERATIONAL';
  @IsOptional() @IsEnum({ Q: 'Q', C: 'C', D: 'D', DEV: 'DEV', P: 'P' } as any)
  pillar?: 'Q' | 'C' | 'D' | 'DEV' | 'P';
  @IsOptional() @IsNumber() baseline?: number;
  @IsOptional() @IsNumber() year25Target?: number;
  @IsOptional() @IsEnum({ AT_LEAST: 'AT_LEAST', AT_MOST: 'AT_MOST' } as any)
  direction?: 'AT_LEAST' | 'AT_MOST';
  @IsOptional() @IsEnum({ DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', QUARTERLY: 'QUARTERLY', HALF_YEARLY: 'HALF_YEARLY', YEARLY: 'YEARLY' } as any)
  cadence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
  @IsOptional() @IsString() analysis25?: string;
}

@Controller('okrs')
export class OkrsController {
  constructor(private prisma: PrismaService, private audit: AuditLogService) {}

  // Recursively delete an Objective: delete its KRs (and their initiatives + child objectives aligned to those KRs),
  // delete child Objectives by parentId as well, then delete the Objective itself.
  private async deleteObjectiveCascade(id: string, tx: any): Promise<void> {
    // Delete all KRs under this Objective (recursively handles aligned objectives and initiatives)
    const krs = await tx.keyResult.findMany({ where: { objectiveId: id }, select: { id: true } });
    for (const kr of krs) {
      await this.deleteKrCascade(kr.id, tx);
    }
    // Delete child objectives by parent relation if any
    const children = await tx.objective.findMany({ where: ({ parentId: id } as any), select: { id: true } });
    for (const ch of children) {
      await this.deleteObjectiveCascade(ch.id, tx);
    }
    // Finally delete this objective
    await tx.objective.delete({ where: { id } });
  }

  private async deleteInitiativeCascade(id: string, tx: any): Promise<void> {
    const children = await tx.initiative.findMany({ where: { parentId: id }, select: { id: true } });
    for (const ch of children) {
      await this.deleteInitiativeCascade(ch.id, tx);
    }
    const items = await tx.checklistItem.findMany({ where: { initiativeId: id }, select: { id: true } });
    if (items.length > 0) {
      await tx.checklistTick.deleteMany({ where: { checklistItemId: { in: items.map((i: any) => i.id) } } });
    }
    await tx.checklistItem.deleteMany({ where: { initiativeId: id } });
    await tx.worklog.deleteMany({ where: { initiativeId: id } });
    await tx.delegation.deleteMany({ where: { childInitiativeId: id } });
    await tx.initiative.delete({ where: { id } });
  }

  // Recursively delete a Key Result: delete any child Objectives aligned to this KR (and their trees),
  // then delete its initiatives, then the KR itself.
  private async deleteKrCascade(id: string, tx: any): Promise<void> {
    // Delete objectives aligned to this KR (recursive)
    const alignedObjs = await tx.objective.findMany({ where: ({ alignsToKrId: id } as any), select: { id: true } });
    for (const o of alignedObjs) {
      await this.deleteObjectiveCascade(o.id, tx);
    }
    const inits = await tx.initiative.findMany({ where: { keyResultId: id }, select: { id: true } });
    for (const ii of inits) {
      await this.deleteInitiativeCascade(ii.id, tx);
    }
    // Delete progress entries and assignments pointing to this KR (e.g., team KPI progress)
    await tx.progressEntry.deleteMany({ where: { keyResultId: id } });
    await (tx as any).keyResultAssignment.deleteMany({ where: { keyResultId: id } });
    // Delete the KR itself
    await tx.keyResult.delete({ where: { id } });
  }

  @Get('parent-krs')
  async parentKrs(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { orgUnit: true } });
    if (!user) throw new NotFoundException('user not found');

    // Return KRs from ALL higher roles (ignoring org hierarchy)
    const role = (user.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL';
    let roles: Array<'CEO' | 'EXEC' | 'MANAGER'> = [];
    if (role === 'CEO') {
      roles = [];
    } else if (role === 'EXEC') {
      roles = ['CEO'];
    } else if (role === 'MANAGER') {
      roles = ['EXEC', 'CEO'];
    } else {
      roles = ['MANAGER', 'EXEC', 'CEO'];
    }

    if (roles.length === 0) return { items: [] };

    const items = await this.prisma.keyResult.findMany({
      where: { objective: { owner: { role: { in: roles as any } }, NOT: { title: { startsWith: 'Auto Objective' } } } },
      orderBy: { createdAt: 'desc' },
      include: { objective: { include: { owner: true, orgUnit: true } } },
    });
    return { items };
  }

  @Get('my')
  async myOkrs(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const items = await this.prisma.objective.findMany({
      where: { ownerId: userId, NOT: { title: { startsWith: 'Auto Objective' } } },
      orderBy: { createdAt: 'desc' },
      include: ({ keyResults: true, alignsToKr: { include: { objective: true } }, orgUnit: true } as any),
    });
    return { items };
  }

  @Post('objectives')
  async createObjective(@Body() dto: CreateObjectiveDto, @Query('context') context?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException('user not found');
    // Validation: parent KR is optional for ALL roles.
    // 정렬(상위 KR 수신)이 기본 권장이지만, 임원/팀장/팀원도 상위 없이 자체 시작(비정렬 트리 루트)이 가능하다.
    // 비정렬로 시작한 Objective의 KR은 하위 역할의 '상위 O-KR 선택' 목록에 자동으로 나타나므로
    // 임원→팀장→팀원, 팀장→팀원 등 어느 레벨에서든 새 캐스케이드를 시작할 수 있다.
    let parentKr: any = null;
    if (dto.alignsToKrId) {
      parentKr = await this.prisma.keyResult.findUnique({
        where: { id: dto.alignsToKrId },
        include: { objective: { include: { owner: true, orgUnit: true } } },
      });
      if (!parentKr) throw new BadRequestException('parent KR not found');
    }

    if (dto.orgUnitId) {
      const org = await this.prisma.orgUnit.findUnique({ where: { id: dto.orgUnitId } });
      if (!org) throw new BadRequestException('org unit not found');
    }
    const orgUnitId = dto.orgUnitId || user.orgUnitId;
    if (!orgUnitId) {
      throw new BadRequestException('org unit required');
    }
    // Team KPI permission when context=team
    if (context === 'team') {
      const isCEO = (user.role as any) === 'CEO';
      const isSameTeam = !!user.orgUnitId && user.orgUnitId === orgUnitId; // 같은 팀 소속이면 허용
      // 상위 조직(실/본부) 책임자·임원은 산하 팀 KPI 관리 가능 (조상 체인 전체 판정)
      const isUpperMgr = !isCEO && !isSameTeam && (await isAncestorOrgManager(this.prisma, user, orgUnitId));
      if (!isCEO && !isSameTeam && !isUpperMgr) {
        throw new ForbiddenException('not allowed to create team KPI');
      }
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.objective.create({
        data: ({
          title: dto.title,
          description: dto.description,
          orgUnitId,
          ownerId: user.id,
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          alignsToKrId: dto.alignsToKrId,
          pillar: (dto.pillar as any) ?? undefined,
          status: 'ACTIVE' as any,
        } as any),
      });
      // Mirror as UserGoal so it appears in worklog goal selection
      try {
        await (tx as any).userGoal.create({
          data: {
            userId: user.id,
            title: dto.title,
            description: dto.description ?? undefined,
            startAt: dto.periodStart ? new Date(dto.periodStart) : undefined,
            endAt: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
          },
        });
      } catch {}
      // Optional bulk KRs
      if (Array.isArray(dto.krs) && dto.krs.length > 0) {
        for (const k of dto.krs) {
          if (!k || !k.title || !k.metric || typeof k.target !== 'number' || !k.unit) continue;
          await tx.keyResult.create({
            data: ({
              objectiveId: rec.id,
              title: k.title,
              metric: (k.metric ?? ''),
              target: k.target,
              unit: k.unit,
              ownerId: user.id,
              weight: 1,
              type: (k.type as any) ?? 'PROJECT',
              pillar: dto.pillar as any,
            } as any),
          });
        }
      }
      return rec;
    });
    return result;
  }

  @Post('objectives/:id/krs')
  async createKr(@Param('id') objectiveId: string, @Body() dto: CreateKeyResultDto, @Query('context') context?: string) {
    const obj = await this.prisma.objective.findUnique({ where: { id: objectiveId }, include: { orgUnit: true } });
    if (!obj) throw new Error('objective not found');
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException('user not found');
    if (context === 'team') {
      const isCEO = (user.role as any) === 'CEO';
      const isSameTeam = !!user.orgUnitId && user.orgUnitId === (obj as any).orgUnitId; // 같은 팀 소속이면 허용
      // 상위 조직(실/본부) 책임자·임원은 산하 팀 KPI 관리 가능 (조상 체인 전체 판정)
      const isUpperMgr = !isCEO && !isSameTeam && (await isAncestorOrgManager(this.prisma, user, (obj as any).orgUnitId));
      if (!isCEO && !isSameTeam && !isUpperMgr) {
        throw new ForbiddenException('not allowed to create team KPI');
      }
    }
    const rec = await this.prisma.$transaction(async (tx) => {
      const kr = await tx.keyResult.create({
        data: ({
          objectiveId,
          title: dto.title,
          metric: (dto.metric ?? ''),
          target: dto.target,
          unit: dto.unit,
          ownerId: dto.userId,
          weight: dto.weight ?? 1,
          type: (dto.type as any) ?? undefined,
          pillar: (dto.pillar as any) ?? undefined,
          baseline: dto.baseline as any,
          year25Target: (dto.year25Target as any) ?? undefined,
          direction: (dto.direction as any) ?? undefined,
          cadence: (dto.cadence as any) ?? undefined,
          analysis25: dto.analysis25 ?? undefined,
        } as any),
      });
      // KPI participants: always include creator (팀장) as default participant, plus any explicit participants
      const baseIds: string[] = [];
      if (dto.userId) baseIds.push(dto.userId);
      if (Array.isArray(dto.participants)) baseIds.push(...dto.participants);
      const uniq = Array.from(new Set(baseIds.filter((id) => !!id)));
      if (uniq.length > 0) {
        await (tx as any).keyResultAssignment.createMany({
          data: uniq.map((uid) => ({ keyResultId: kr.id, userId: uid })),
          skipDuplicates: true,
        } as any);
      }
      return kr;
    });
    return rec;
  }

  @Put('objectives/:id')
  async updateObjective(@Param('id') id: string, @Body() dto: UpdateObjectiveDto, @Query('userId') userId?: string) {
    // 본인(Objective owner) 또는 대표만 수정 가능
    if (!userId) throw new BadRequestException('userId required');
    const exists = await this.prisma.objective.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('objective not found');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor) throw new ForbiddenException('not allowed');
    const sameTeam = !!actor.orgUnitId && actor.orgUnitId === (exists as any).orgUnitId; // 같은 팀 소속이면 수정 허용
    // 상위 조직(실/본부) 책임자·임원은 산하 팀 목표 수정 가능
    const allowed = (actor.role as any) === 'CEO' || exists.ownerId === userId || sameTeam
      || (await isAncestorOrgManager(this.prisma, actor, (exists as any).orgUnitId));
    if (!allowed) throw new ForbiddenException('소속 팀(또는 산하 팀)의 목표만 수정할 수 있습니다');
    const data: any = {
      title: dto.title,
      description: dto.description,
      periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
      periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
      pillar: (dto.pillar as any) ?? undefined,
    };
    const rec = await this.prisma.objective.update({ where: { id }, data });
    await this.audit.log('Objective', id, 'ObjectiveUpdated', userId, this.audit.diff(exists, dto, ['title', 'description', 'periodStart', 'periodEnd', 'pillar']));
    return rec;
  }

  @Put('krs/:id')
  async updateKr(@Param('id') id: string, @Body() dto: UpdateKeyResultDto, @Query('userId') userId?: string) {
    // 본인(KR owner 또는 상위 Objective owner) 또는 대표만 수정 가능
    if (!userId) throw new BadRequestException('userId required');
    const kr = await this.prisma.keyResult.findUnique({ where: { id }, include: { objective: true } });
    if (!kr) throw new NotFoundException('key result not found');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor) throw new ForbiddenException('not allowed');
    const sameTeam = !!actor.orgUnitId && actor.orgUnitId === (kr as any).objective?.orgUnitId; // 같은 팀 소속이면 수정 허용
    // 상위 조직(실/본부) 책임자·임원은 산하 팀 KPI 수정 가능
    const allowed = (actor.role as any) === 'CEO' || kr.ownerId === userId || (kr as any).objective?.ownerId === userId || sameTeam
      || (await isAncestorOrgManager(this.prisma, actor, (kr as any).objective?.orgUnitId));
    if (!allowed) throw new ForbiddenException('소속 팀(또는 산하 팀)의 KPI만 수정할 수 있습니다');
    const data: any = {
      title: dto.title,
      metric: dto.metric,
      target: typeof dto.target === 'number' ? dto.target : undefined,
      unit: dto.unit,
      weight: typeof dto.weight === 'number' ? dto.weight : undefined,
      type: (dto.type as any) ?? undefined,
      pillar: (dto.pillar as any) ?? undefined,
      baseline: typeof dto.baseline === 'number' ? dto.baseline : undefined,
      year25Target: typeof dto.year25Target === 'number' ? dto.year25Target : undefined,
      direction: (dto.direction as any) ?? undefined,
      cadence: (dto.cadence as any) ?? undefined,
      analysis25: typeof dto.analysis25 === 'string' ? dto.analysis25 : undefined,
    };
    const rec = await this.prisma.keyResult.update({ where: { id }, data });
    await this.audit.log('KeyResult', id, 'KrUpdated', userId, this.audit.diff(kr, dto, ['title', 'metric', 'target', 'unit', 'weight', 'type', 'pillar', 'baseline', 'year25Target', 'direction', 'cadence', 'analysis25']));
    return rec;
  }

  /**
   * KPI 실행 근거 (온톨로지): 팀의 각 KPI에 대해 해당 월의 연결 활동·근거 일지·투입시간을 반환.
   * 실적 입력 화면에서 "숫자와 실행의 대사(對査)"용 — 근거=활동링크 ∪ 일지분류태그 ∪ 실적입력 일지.
   * 일지 본문은 공개범위(visibility)에 따라 마스킹.
   */
  @Get('kpi-evidence')
  async kpiEvidence(@Query('orgUnitId') orgUnitId?: string, @Query('month') monthStr?: string, @Query('userId') userId?: string, @Query('krId') krIdParam?: string) {
    if (!orgUnitId && !krIdParam) throw new BadRequestException('orgUnitId or krId required');
    const viewer = userId ? await this.prisma.user.findUnique({ where: { id: String(userId) }, select: { role: true, id: true } }) : null;
    const role = String(viewer?.role || '').toUpperCase();
    const canSee = (vis: string, authorId: string) => {
      if (viewer?.id === authorId) return true;
      if (role === 'CEO') return true;
      if (vis === 'ALL') return true;
      if (vis === 'MANAGER_PLUS') return ['MANAGER', 'EXEC'].includes(role);
      if (vis === 'EXEC_PLUS') return role === 'EXEC';
      return false; // CEO_ONLY 등
    };
    const month = /^\d{4}-\d{2}$/.test(String(monthStr || '')) ? String(monthStr) : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const start = new Date(`${month}-01T00:00:00+09:00`);
    const end = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+09:00`);

    // 대상 KPI: krId 단건(현황판 셀 클릭) 또는 팀 전체(실적입력/리포트)
    const krIds: string[] = [];
    const legacyAct = new Map<string, string>();
    if (krIdParam) {
      const kr: any = await this.prisma.keyResult.findUnique({ where: { id: String(krIdParam) }, select: { id: true, activityId: true } as any });
      if (!kr) return { month, items: [] };
      krIds.push(String(kr.id));
      if (kr.activityId) legacyAct.set(String(kr.id), String(kr.activityId));
    } else {
      const objs = await this.prisma.objective.findMany({
        where: { orgUnitId: String(orgUnitId) },
        select: { title: true, pillar: true, keyResults: { select: { id: true, activityId: true } } },
      });
      for (const o of objs) {
        if (!o.pillar || String(o.title || '').startsWith('Auto Objective')) continue;
        for (const kr of o.keyResults) {
          krIds.push(kr.id);
          if ((kr as any).activityId) legacyAct.set(kr.id, String((kr as any).activityId));
        }
      }
    }
    if (!krIds.length) return { month, items: [] };

    const [links, tags, entries] = await Promise.all([
      (this.prisma as any).goalActivityLink.findMany({ where: { goalType: 'KR', goalId: { in: krIds } }, select: { goalId: true, activityId: true } }),
      (this.prisma as any).worklogGoalTag.findMany({ where: { goalType: 'KR', goalId: { in: krIds } }, select: { goalId: true, worklogId: true } }),
      this.prisma.progressEntry.findMany({ where: { keyResultId: { in: krIds }, periodStart: { gte: start, lt: end }, NOT: { worklogId: null } }, select: { keyResultId: true, worklogId: true } }),
    ]);
    // KR별 활동 집합
    const actByKr = new Map<string, Set<string>>();
    for (const kid of krIds) actByKr.set(kid, new Set(legacyAct.has(kid) ? [legacyAct.get(kid)!] : []));
    for (const l of links) actByKr.get(String(l.goalId))?.add(String(l.activityId));
    const allActIds = Array.from(new Set(Array.from(actByKr.values()).flatMap((s) => Array.from(s))));
    const acts = allActIds.length ? await (this.prisma as any).activity.findMany({ where: { id: { in: allActIds } }, select: { id: true, name: true } }) : [];
    const actName = new Map(acts.map((a: any) => [String(a.id), String(a.name)]));

    // 해당 월 일지 (팀 무관 — 활동/태그가 가리키는 일지)
    const tagWlByKr = new Map<string, Set<string>>();
    for (const t of tags) {
      const s = tagWlByKr.get(String(t.goalId)) || new Set<string>();
      s.add(String(t.worklogId));
      tagWlByKr.set(String(t.goalId), s);
    }
    const entryWlByKr = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!e.worklogId) continue;
      const s = entryWlByKr.get(String(e.keyResultId)) || new Set<string>();
      s.add(String(e.worklogId));
      entryWlByKr.set(String(e.keyResultId), s);
    }
    const monthWls = await (this.prisma as any).worklog.findMany({
      where: { date: { gte: start, lt: end } },
      select: { id: true, date: true, note: true, timeSpentMinutes: true, activityId: true, visibility: true, createdById: true, createdBy: { select: { name: true } } },
    });
    const wlById = new Map(monthWls.map((w: any) => [String(w.id), w]));
    const wlByAct = new Map<string, any[]>();
    for (const w of monthWls) {
      if (!w.activityId) continue;
      const arr = wlByAct.get(String(w.activityId)) || [];
      arr.push(w);
      wlByAct.set(String(w.activityId), arr);
    }

    const items = krIds.map((kid) => {
      const evidence = new Map<string, any>();
      for (const aid of actByKr.get(kid) || []) for (const w of wlByAct.get(aid) || []) evidence.set(String(w.id), w);
      for (const wid of tagWlByKr.get(kid) || []) { const w = wlById.get(wid); if (w) evidence.set(wid, w); }
      for (const wid of entryWlByKr.get(kid) || []) { const w = wlById.get(wid); if (w) evidence.set(wid, w); }
      const evArr = Array.from(evidence.values()).sort((a, b) => (b.timeSpentMinutes || 0) - (a.timeSpentMinutes || 0));
      const minutes = evArr.reduce((s, w) => s + (w.timeSpentMinutes || 0), 0);
      const people = new Set(evArr.map((w) => w.createdById)).size;
      return {
        krId: kid,
        activities: Array.from(actByKr.get(kid) || []).map((aid) => ({ id: aid, name: actName.get(aid) || '(활동)' })).slice(0, 8),
        totals: { logs: evArr.length, minutes, people },
        worklogs: evArr.slice(0, krIdParam ? 15 : 8).map((w) => {
          const visible = canSee(String(w.visibility || 'ALL'), String(w.createdById));
          return {
            id: w.id,
            date: w.date,
            authorName: w.createdBy?.name || '',
            minutes: w.timeSpentMinutes || 0,
            snippet: visible ? String(w.note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) : '(비공개 일지)',
          };
        }),
      };
    });
    return { month, items };
  }

  @Get('krs/:id')
  async getKr(@Param('id') id: string) {
    const kr = await this.prisma.keyResult.findUnique({
      where: { id },
      select: { id: true, title: true, metric: true, target: true, unit: true, objectiveId: true },
    });
    if (!kr) throw new NotFoundException('key result not found');
    return kr;
  }

  // KPI only: objectives/KRs where the user is explicitly assigned as a participant
  @Get('my-kpis')
  async myKpis(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const assigns = await this.prisma.keyResultAssignment.findMany({
      where: { userId },
      include: {
        keyResult: {
          include: {
            objective: true,
            initiatives: { include: { children: true } },
          },
        },
      },
    });
    const byObj: Record<string, any> = {};
    for (const a of assigns) {
      const kr = a.keyResult as any;
      const obj = kr.objective as any;
      if (!byObj[obj.id]) {
        byObj[obj.id] = { ...obj, keyResults: [] as any[] };
      }
      // avoid duplicate KR entries if multiple assignments somehow exist
      if (!(byObj[obj.id].keyResults as any[]).some((k: any) => k.id === kr.id)) {
        byObj[obj.id].keyResults.push(kr);
      }
    }
    return { items: Object.values(byObj) };
  }

  @Delete('objectives/:id')
  async deleteObjective(@Param('id') id: string, @Query('userId') userId?: string, @Query('context') context?: string) {
    const exists = await this.prisma.objective.findUnique({ where: { id }, include: { orgUnit: true } });
    if (!exists) throw new Error('objective not found');
    if (!userId) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('not allowed');
    const isCEO = (user.role as any) === 'CEO';
    const sameTeam = !!user.orgUnitId && user.orgUnitId === (exists as any)?.orgUnitId;
    // Allow CEO or the owner of the objective, or any same-team member in team context
    // (팀 컨텍스트에서는 상위 조직 책임자·임원도 산하 팀 목표를 정리할 수 있다)
    const allowed = isCEO || exists.ownerId === userId
      || (context === 'team' && (sameTeam || (await isAncestorOrgManager(this.prisma, user, (exists as any)?.orgUnitId))));
    if (!allowed) throw new ForbiddenException('not allowed');
    console.log('[okrs] deleteObjective', { id, DATABASE_URL: process.env.DATABASE_URL });
    await this.prisma.$transaction(async (tx) => {
      await this.deleteObjectiveCascade(id, tx);
    });
    await this.audit.log('Objective', id, 'ObjectiveDeleted', userId, {
      snapshot: { title: exists.title, ownerId: exists.ownerId, orgUnitId: (exists as any).orgUnitId, periodStart: exists.periodStart, periodEnd: exists.periodEnd, pillar: (exists as any).pillar, context },
    });
    return { ok: true };
  }

  @Delete('krs/:id')
  async deleteKr(@Param('id') id: string, @Query('userId') userId?: string, @Query('context') context?: string) {
    const kr = await this.prisma.keyResult.findUnique({ where: { id }, include: { objective: { include: { orgUnit: true } } } });
    if (!kr) throw new Error('key result not found');
    if (!userId) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('not allowed');
    const isCEO = (user.role as any) === 'CEO';
    const sameTeam = !!user.orgUnitId && user.orgUnitId === (kr.objective as any)?.orgUnitId;
    // Allow CEO always
    let allowed = isCEO;
    // Allow owner for general OKR (KR owner 또는 상위 Objective owner)
    if (!allowed && (!context || context !== 'team')) {
      allowed = kr.ownerId === userId || (kr as any).objective?.ownerId === userId;
    }
    // Team KPI context: allow any same-team member, or 상위 조직(실/본부) 책임자·임원 (조상 체인 전체 판정)
    if (!allowed && context === 'team') {
      allowed = sameTeam || (await isAncestorOrgManager(this.prisma, user, (kr.objective as any)?.orgUnitId));
    }
    if (!allowed) throw new ForbiddenException('not allowed');
    console.log('[okrs] deleteKr', { id, DATABASE_URL: process.env.DATABASE_URL, context, role: user.role, sameTeam });
    await this.prisma.$transaction(async (tx) => {
      await this.deleteKrCascade(id, tx);
    });
    await this.audit.log('KeyResult', id, 'KrDeleted', userId, {
      snapshot: { title: kr.title, metric: kr.metric, target: kr.target, unit: kr.unit, ownerId: kr.ownerId, objectiveId: kr.objectiveId, objectiveTitle: (kr as any).objective?.title, context },
    });
    return { ok: true };
  }

  @Get('map')
  async okrMap(@Query('orgUnitId') orgUnitId?: string) {
    // Load all objectives with their KRs and minimal owner/org info ('Auto Objective …' 숨김)
    const all = await this.prisma.objective.findMany({
      where: { NOT: { title: { startsWith: 'Auto Objective' } } },
      orderBy: { createdAt: 'asc' },
      include: ({ keyResults: true, owner: { select: { id: true, name: true, role: true } }, orgUnit: true } as any),
    });
    const objectives = orgUnitId ? all.filter((o: any) => o.orgUnitId === orgUnitId) : all;
    // Build index by KR id -> child objectives aligned to it
    const byKr: Record<string, any[]> = {};
    for (const o of objectives) {
      const krId = (o as any).alignsToKrId as string | null;
      if (krId) {
        if (!byKr[krId]) byKr[krId] = [];
        byKr[krId].push(o);
      }
    }
    const objById: Record<string, any> = {};
    for (const o of objectives) objById[o.id] = o;

    function mapObjective(o: any): any {
      const krs = (o.keyResults || []).map((kr: any) => ({
        id: kr.id,
        title: kr.title,
        metric: kr.metric,
        target: kr.target,
        unit: kr.unit,
        year25Target: (kr as any).year25Target,
        baseline: kr.baseline,
        type: kr.type,
        pillar: kr.pillar,
        direction: kr.direction,
        cadence: kr.cadence,
        orgUnitId: o.orgUnitId,
        children: (byKr[kr.id] || []).map(mapObjective),
      }));
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        owner: o.owner,
        orgUnit: o.orgUnit,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
        status: o.status,
        pillar: o.pillar,
        keyResults: krs,
      };
    }

    // Roots: objectives that do not align to any KR
    const roots = objectives.filter((o: any) => !o.alignsToKrId);
    return { items: roots.map(mapObjective) };
  }

  @Get('objectives')
  async listObjectives(@Query('orgUnitId') orgUnitId?: string) {
    // 업무일지 작성 시 자동 생성되는 'Auto Objective …' 컨테이너는 OKR 화면에서 숨김(삭제 아님)
    const where: any = { NOT: { title: { startsWith: 'Auto Objective' } } };
    if (orgUnitId) where.orgUnitId = orgUnitId;
    const items = await this.prisma.objective.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: ({ keyResults: { include: { initiatives: { include: { children: true } }, assignments: { include: { user: true } } } }, owner: { select: { id: true, name: true, role: true } }, orgUnit: true } as any),
    });
    return { items };
  }
}
