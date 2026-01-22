import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { PrismaService } from './prisma.service';

class UpsertTeamDailyEvalDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  ymd!: string;

  @IsString()
  @IsNotEmpty()
  orgUnitId!: string;

  @IsString()
  @IsIn(['BLUE', 'GREEN', 'YELLOW', 'RED'])
  status!: 'BLUE' | 'GREEN' | 'YELLOW' | 'RED';

  @IsOptional()
  @IsString()
  comment?: string;
}

@Controller('worklog-evals')
export class WorklogEvalsController {
  constructor(private prisma: PrismaService) {}

  private kstYmd(d: Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  private async getScopeOrgUnitIds(userId: string): Promise<Set<string>> {
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor) throw new BadRequestException('user not found');

    const role = (actor.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | undefined;
    const ids = new Set<string>();

    if (role === 'CEO') {
      const all = await this.prisma.orgUnit.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
      for (const u of all || []) {
        if (/^personal\s*-/i.test(String((u as any).name || ''))) continue;
        ids.add(String((u as any).id));
      }
      return ids;
    }

    const all = await this.prisma.orgUnit.findMany({
      select: { id: true, name: true, parentId: true, managerId: true },
      orderBy: { name: 'asc' },
    });
    const units = (all || []).filter((u: any) => !/^personal\s*-/i.test(String(u.name || '')));

    const children = new Map<string | null, Array<{ id: string; name: string }>>();
    for (const u of units) {
      const k = (u as any).parentId || null;
      if (!children.has(k)) children.set(k, []);
      children.get(k)!.push({ id: String((u as any).id), name: String((u as any).name) });
    }

    const roots = units
      .filter((u: any) => String(u.managerId || '') === String(userId))
      .map((u: any) => ({ id: String(u.id), name: String(u.name) }));

    const seen = new Map<string, string>();
    const stack = [...roots];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id)) continue;
      seen.set(cur.id, cur.name);
      const kids = children.get(cur.id) || [];
      for (const k of kids) stack.push(k);
    }

    const managedIds = Array.from(seen.keys());
    if (role === 'EXEC') {
      managedIds.forEach((id) => ids.add(id));
      return ids;
    }

    if (role === 'MANAGER') {
      if (managedIds.length > 0) {
        managedIds.forEach((id) => ids.add(id));
      } else if ((actor as any).orgUnitId) {
        ids.add(String((actor as any).orgUnitId));
      }
      return ids;
    }

    return ids;
  }

  private async assertCanEvaluate(userId: string): Promise<void> {
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor) throw new BadRequestException('user not found');
    const role = (actor.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | undefined;
    if (!(role === 'CEO' || role === 'EXEC' || role === 'MANAGER')) throw new ForbiddenException('no permission');
  }

  @Get('team-daily')
  async listTeamDaily(
    @Query('userId') userId?: string,
    @Query('ymd') ymd?: string,
    @Query('orgUnitIds') orgUnitIdsCsv?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    if (!ymd) throw new BadRequestException('ymd required');
    await this.assertCanEvaluate(String(userId));

    const scopeIds = await this.getScopeOrgUnitIds(String(userId));
    if (scopeIds.size === 0) return { items: [] };

    const requestedIds: string[] = [];
    if (orgUnitIdsCsv) {
      String(orgUnitIdsCsv)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => requestedIds.push(id));
    }

    const orgUnitIds = requestedIds.length > 0 ? requestedIds.filter((id) => scopeIds.has(String(id))) : Array.from(scopeIds);
    if (orgUnitIds.length === 0) return { items: [] };

    const rows = await (this.prisma as any).worklogTeamDailyEval.findMany({
      where: { evaluatorId: String(userId), ymd: String(ymd), orgUnitId: { in: orgUnitIds } },
      include: { orgUnit: true },
      orderBy: [{ orgUnit: { name: 'asc' } }, { updatedAt: 'desc' }],
    });

    return {
      items: (rows || []).map((r: any) => ({
        id: String(r.id),
        ymd: String(r.ymd),
        orgUnitId: String(r.orgUnitId),
        orgUnitName: String(r.orgUnit?.name || ''),
        evaluatorId: String(r.evaluatorId),
        status: String(r.status),
        comment: r.comment != null ? String(r.comment) : null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  @Post('team-daily')
  async upsertTeamDaily(@Query('userId') userId?: string, @Body() dto?: UpsertTeamDailyEvalDto) {
    if (!userId) throw new BadRequestException('userId required');
    if (!dto) throw new BadRequestException('body required');
    await this.assertCanEvaluate(String(userId));

    const scopeIds = await this.getScopeOrgUnitIds(String(userId));
    if (!scopeIds.has(String(dto.orgUnitId))) throw new ForbiddenException('out of scope');

    let comment: string | null | undefined = dto.comment != null ? String(dto.comment).trim() : undefined;
    if (comment !== undefined && comment.length === 0) comment = null;

    const update: any = { status: dto.status };
    if (comment !== undefined) update.comment = comment;

    const create: any = { ymd: dto.ymd, orgUnitId: dto.orgUnitId, evaluatorId: String(userId), status: dto.status };
    if (comment !== undefined) create.comment = comment;

    const rec = await (this.prisma as any).worklogTeamDailyEval.upsert({
      where: { ymd_orgUnitId_evaluatorId: { ymd: dto.ymd, orgUnitId: dto.orgUnitId, evaluatorId: String(userId) } },
      create,
      update,
      include: { orgUnit: true },
    });

    return {
      id: String(rec.id),
      ymd: String(rec.ymd),
      orgUnitId: String(rec.orgUnitId),
      orgUnitName: String(rec.orgUnit?.name || ''),
      evaluatorId: String(rec.evaluatorId),
      status: String(rec.status),
      comment: rec.comment != null ? String(rec.comment) : null,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    };
  }

  @Get('team-monthly')
  async teamMonthly(@Query('userId') userId?: string, @Query('month') month?: string, @Query('orgUnitIds') orgUnitIdsCsv?: string) {
    if (!userId) throw new BadRequestException('userId required');
    if (!month) throw new BadRequestException('month required');
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new BadRequestException('invalid month');
    await this.assertCanEvaluate(String(userId));

    const scopeIds = await this.getScopeOrgUnitIds(String(userId));
    if (scopeIds.size === 0) return { month: String(month), items: [], totals: { BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0, score: 0 } };

    const requestedIds: string[] = [];
    if (orgUnitIdsCsv) {
      String(orgUnitIdsCsv)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => requestedIds.push(id));
    }
    const orgUnitIds = requestedIds.length > 0 ? requestedIds.filter((id) => scopeIds.has(String(id))) : Array.from(scopeIds);
    if (orgUnitIds.length === 0) return { month: String(month), items: [], totals: { BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0, score: 0 } };

    const prefix = `${String(month)}-`;

    const rows = await (this.prisma as any).worklogTeamDailyEval.findMany({
      where: { evaluatorId: String(userId), ymd: { startsWith: prefix }, orgUnitId: { in: orgUnitIds } },
      include: { orgUnit: true },
      orderBy: [{ orgUnit: { name: 'asc' } }, { ymd: 'asc' }],
      take: 10000,
    });

    const byTeam = new Map<string, any>();
    const totals = { BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 } as any;

    for (const r of rows || []) {
      const ouId = String((r as any).orgUnitId);
      const ouName = String((r as any).orgUnit?.name || '');
      const status = String((r as any).status) as 'BLUE' | 'GREEN' | 'YELLOW' | 'RED';

      if (!byTeam.has(ouId)) {
        byTeam.set(ouId, { orgUnitId: ouId, orgUnitName: ouName, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 });
      }
      const cur = byTeam.get(ouId)!;
      cur[status] = (cur[status] || 0) + 1;
      totals[status] = (totals[status] || 0) + 1;
    }

    const scoreOf = (x: any) => (Number(x.BLUE || 0) * 2) + (Number(x.GREEN || 0) * 1) + (Number(x.YELLOW || 0) * 0) + (Number(x.RED || 0) * -1);

    const items = Array.from(byTeam.values())
      .map((x) => ({ ...x, score: scoreOf(x) }))
      .sort((a: any, b: any) => (b.score - a.score) || String(a.orgUnitName).localeCompare(String(b.orgUnitName)));

    const totalScore = scoreOf(totals);

    return { month: String(month), items, totals: { ...totals, score: totalScore } };
  }

  @Get('team-monthly-drilldown')
  async teamMonthlyDrilldown(
    @Query('userId') userId?: string,
    @Query('month') month?: string,
    @Query('orgUnitId') orgUnitId?: string,
    @Query('status') status?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    if (!month) throw new BadRequestException('month required');
    if (!/^[0-9]{4}-[0-9]{2}$/.test(String(month))) throw new BadRequestException('invalid month');
    if (!orgUnitId) throw new BadRequestException('orgUnitId required');
    if (!status) throw new BadRequestException('status required');
    if (!['BLUE', 'GREEN', 'YELLOW', 'RED'].includes(String(status))) throw new BadRequestException('invalid status');
    await this.assertCanEvaluate(String(userId));

    const scopeIds = await this.getScopeOrgUnitIds(String(userId));
    if (!scopeIds.has(String(orgUnitId))) throw new ForbiddenException('out of scope');

    const prefix = `${String(month)}-`;
    const evalRows = await (this.prisma as any).worklogTeamDailyEval.findMany({
      where: { evaluatorId: String(userId), orgUnitId: String(orgUnitId), ymd: { startsWith: prefix }, status: String(status) },
      select: { ymd: true },
      orderBy: { ymd: 'asc' },
      take: 10000,
    });
    const ymds = Array.from(new Set((evalRows || []).map((r: any) => String(r.ymd)))).filter(Boolean);
    if (ymds.length === 0) {
      return { month: String(month), orgUnitId: String(orgUnitId), status: String(status), ymds: [], groups: [] };
    }

    const [yy, mm] = String(month).split('-').map((s) => parseInt(s, 10));
    if (!yy || !mm) throw new BadRequestException('invalid month');
    const monthStart = new Date(Date.UTC(yy, mm - 1, 1, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(yy, mm, 1, 0, 0, 0));
    const from = new Date(monthStart.getTime() - (24 * 60 * 60 * 1000));
    const to = new Date(monthEnd.getTime() + (24 * 60 * 60 * 1000));

    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (userId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: String(userId) } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | undefined;
      if (role === 'CEO') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    const baseWhere: any = {
      date: { gte: from, lt: to },
      createdBy: { orgUnitId: String(orgUnitId) },
    };
    const where: any = {
      AND: [
        baseWhere,
        {
          OR: [
            { createdById: String(userId) },
            { visibility: { in: visibilityIn as any } },
          ],
        },
      ],
    };

    const worklogs = await (this.prisma as any).worklog.findMany({
      where,
      include: { createdBy: { include: { orgUnit: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 10000,
    });

    const ymdSet = new Set(ymds);
    const byDay = new Map<string, any[]>();
    for (const it of worklogs || []) {
      const ymd = this.kstYmd(new Date((it as any).date));
      if (!ymdSet.has(ymd)) continue;
      if (!byDay.has(ymd)) byDay.set(ymd, []);
      const lines = String((it as any).note || '').split(/\n+/);
      const title = lines[0] || '';
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      byDay.get(ymd)!.push({
        id: String((it as any).id),
        createdAt: (it as any).createdAt,
        date: (it as any).date,
        timeSpentMinutes: Number((it as any).timeSpentMinutes || 0),
        title,
        excerpt,
        createdById: String((it as any).createdById || ''),
        userName: String((it as any)?.createdBy?.name || ''),
        orgUnitId: String((it as any)?.createdBy?.orgUnitId || ''),
        teamName: String((it as any)?.createdBy?.orgUnit?.name || ''),
        urgent: Boolean((it as any)?.urgent || false),
      });
    }

    const groups = Array.from(byDay.entries())
      .map(([ymd, items]) => {
        const minutes = (items || []).reduce((s, x: any) => s + Number(x.timeSpentMinutes || 0), 0);
        return { ymd, count: (items || []).length, minutes, items };
      })
      .sort((a, b) => String(b.ymd).localeCompare(String(a.ymd)));

    return { month: String(month), orgUnitId: String(orgUnitId), status: String(status), ymds, groups };
  }
}
