import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

class ReportDto {
  @IsString()
  @IsNotEmpty()
  approverId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ShareDto {
  @IsArray()
  watcherIds!: string[];

  @IsOptional()
  @IsString()
  scope?: 'READ' | 'COMMENT';
}

class HelpItemDto {
  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsOptional()
  @IsString()
  queue?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaMinutes?: number;
}

class DelegateItemDto {
  @IsString()
  @IsNotEmpty()
  parentType!: string;

  @IsString()
  @IsNotEmpty()
  parentId!: string;

  @IsString()
  @IsNotEmpty()
  childInitiativeId!: string;

  @IsString()
  @IsNotEmpty()
  delegateeId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class CreateWorklogDto {
  @IsOptional()
  @IsString()
  initiativeId?: string;

  @IsOptional()
  @IsString()
  taskName?: string;

  @IsString()
  @IsNotEmpty()
  createdById!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  timeSpentMinutes?: number;

  @IsOptional()
  @IsString()
  blockerCode?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  attachments?: any;

  @IsOptional()
  report?: ReportDto;

  @IsOptional()
  share?: ShareDto;

  @IsOptional()
  help?: HelpItemDto[];

  @IsOptional()
  delegate?: DelegateItemDto[];

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @IsOptional()
  @IsEnum({ ALL: 'ALL', MANAGER_PLUS: 'MANAGER_PLUS', EXEC_PLUS: 'EXEC_PLUS', CEO_ONLY: 'CEO_ONLY' } as any)
  visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';

  @IsOptional()
  @IsString()
  processInstanceId?: string;

  @IsOptional()
  @IsString()
  taskInstanceId?: string;
}

class CreateSimpleWorklogDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() teamName!: string;
  @IsOptional() @IsString() taskName?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() content!: string;
  @IsOptional() @IsInt() @Min(0) timeSpentMinutes?: number;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsBoolean() urgent?: boolean;
  @IsOptional() @IsString() contentHtml?: string;
  @IsOptional() attachments?: any;
  @IsOptional() tags?: any;
  @IsOptional() @IsString() initiativeId?: string;
  @IsOptional() @IsString() userGoalId?: string;
  @IsOptional() @IsString() keyResultId?: string;
  @IsOptional() @IsEnum({ ALL: 'ALL', MANAGER_PLUS: 'MANAGER_PLUS', EXEC_PLUS: 'EXEC_PLUS', CEO_ONLY: 'CEO_ONLY' } as any)
  visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';
}

@Controller('worklogs')
export class WorklogsController {
  constructor(private prisma: PrismaService) {}

  private async getScopeOrgUnitIdsForViewer(viewerId: string): Promise<Set<string>> {
    if (!viewerId) throw new BadRequestException('viewerId required');
    const actor = await this.prisma.user.findUnique({ where: { id: viewerId } });
    if (!actor) throw new BadRequestException('viewer not found');

    const role = (actor.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | undefined;
    const ids = new Set<string>();

    if (role === 'CEO' || role === 'EXTERNAL') {
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
      .filter((u: any) => String(u.managerId || '') === String(viewerId))
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

    if (role === 'INDIVIDUAL') {
      if ((actor as any).orgUnitId) ids.add(String((actor as any).orgUnitId));
      return ids;
    }

    return ids;
  }

  private async getOverdueContextForUser(userId: string): Promise<string> {
    if (!userId) return '';
    const now = new Date();
    const kstYmd = (d: any) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(d));
    const kstDayStartMs = (d: any) => {
      const ymd = kstYmd(d);
      return new Date(`${ymd}T00:00:00+09:00`).getTime();
    };
    const kstTodayStart = new Date(`${kstYmd(now)}T00:00:00+09:00`);
    const dueMs = (d: any) => {
      try {
        const dt = new Date(d);
        const t = dt.getTime();
        return Number.isFinite(t) ? t : NaN;
      } catch {
        return NaN;
      }
    };

    const overdueDaysKst = (dueTimeMs: number) => {
      const d0 = kstDayStartMs(dueTimeMs);
      const n0 = kstDayStartMs(now);
      if (!Number.isFinite(d0) || !Number.isFinite(n0)) return 0;
      return Math.max(0, Math.floor((n0 - d0) / (24 * 60 * 60 * 1000)));
    };

    const [me, procTasksRaw, procInstRaw, approvalsRaw, helpRaw, delRaw, initRaw] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: String(userId) }, select: { id: true, name: true } }),
      (this.prisma as any).processTaskInstance.findMany({
        where: {
          assigneeId: String(userId),
          status: { notIn: ['COMPLETED', 'SKIPPED'] as any },
          OR: [
            { plannedEndAt: { lt: kstTodayStart } },
            { deadlineAt: { lt: kstTodayStart } },
          ],
        },
        include: { instance: { select: { id: true, title: true } } },
        orderBy: [{ plannedEndAt: 'asc' }, { deadlineAt: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
      this.prisma.processInstance.findMany({
        where: {
          status: 'ACTIVE',
          endAt: null,
          expectedEndAt: { lt: kstTodayStart },
          OR: [
            { startedById: String(userId) },
            { tasks: { some: { assigneeId: String(userId) } } },
          ],
        },
        select: { id: true, title: true, status: true, expectedEndAt: true },
        orderBy: [{ expectedEndAt: 'asc' }, { startAt: 'asc' }],
        take: 50,
      }),
      this.prisma.approvalRequest.findMany({
        where: { approverId: String(userId), status: 'PENDING' as any, dueAt: { lt: kstTodayStart } },
        select: { id: true, subjectType: true, subjectId: true, dueAt: true },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
      this.prisma.helpTicket.findMany({
        where: { assigneeId: String(userId), status: { notIn: ['DONE', 'CANCELLED'] as any } },
        select: { id: true, category: true, queue: true, status: true, dueAt: true, slaMinutes: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }],
        take: 50,
      }),
      this.prisma.delegation.findMany({
        where: { delegateeId: String(userId), status: { notIn: ['DONE', 'REJECTED'] as any }, dueAt: { lt: kstTodayStart } },
        include: { childInitiative: { select: { id: true, title: true } }, delegator: { select: { name: true } } },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
      this.prisma.initiative.findMany({
        where: { ownerId: String(userId), state: { notIn: ['DONE', 'CANCELLED'] as any }, dueAt: { lt: kstTodayStart } },
        select: { id: true, title: true, dueAt: true },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
    ]);

    const lines: string[] = [];
    const push = (s: string) => {
      const v = String(s || '').trim();
      if (!v) return;
      if (lines.length >= 30) return;
      lines.push(v);
    };

    const assigneeName = String((me as any)?.name || '').trim() || String(userId);

    for (const p of (procInstRaw || [])) {
      const dueAt = (p as any).expectedEndAt || null;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      const overdueDays = overdueDaysKst(ms);
      if (overdueDays <= 0) continue;
      const procTitle = String((p as any)?.title || '').trim();
      push(`- [프로세스] ${procTitle || '프로세스'} · 담당자=${assigneeName} · 마감=${kstYmd(ms)} · 초과=${overdueDays}일`);
    }

    for (const t of (procTasksRaw || [])) {
      const dueAt = (t as any).plannedEndAt || (t as any).deadlineAt || null;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      const procTitle = String((t as any)?.instance?.title || '');
      const taskTitle = String((t as any)?.name || '');
      const overdueDays = overdueDaysKst(ms);
      if (overdueDays <= 0) continue;
      push(`- [프로세스] ${procTitle} / ${taskTitle} · 담당자=${assigneeName} · 마감=${kstYmd(ms)} · 초과=${overdueDays}일`);
    }

    const approvalIdsWorklog: string[] = [];
    const approvalIdsProcess: string[] = [];
    for (const a of (approvalsRaw || [])) {
      const st = String((a as any).subjectType || '').toUpperCase();
      const sid = String((a as any).subjectId || '');
      if ((st === 'WORKLOG' || st === 'WORKLOGS') && sid) approvalIdsWorklog.push(sid);
      if (st === 'PROCESS' && sid) approvalIdsProcess.push(sid);
    }
    const [worklogs, procs] = await Promise.all([
      approvalIdsWorklog.length
        ? this.prisma.worklog.findMany({ where: { id: { in: approvalIdsWorklog } }, select: { id: true, note: true } })
        : Promise.resolve([] as any[]),
      approvalIdsProcess.length
        ? (this.prisma as any).processInstance.findMany({ where: { id: { in: approvalIdsProcess } }, select: { id: true, title: true } })
        : Promise.resolve([] as any[]),
    ]);
    const wlTitleMap = new Map<string, string>();
    for (const w of (worklogs || [])) {
      const raw = String((w as any).note || '').trim();
      const title = raw.split('\n')[0] || raw || '';
      wlTitleMap.set(String((w as any).id), title);
    }
    const procTitleMap = new Map<string, string>();
    for (const p of (procs || [])) {
      procTitleMap.set(String((p as any).id), String((p as any).title || ''));
    }

    for (const a of (approvalsRaw || [])) {
      const dueAt = (a as any).dueAt;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      const st = String((a as any).subjectType || '').toUpperCase();
      const sid = String((a as any).subjectId || '');
      const title = (st === 'PROCESS')
        ? (procTitleMap.get(sid) || '프로세스 결재')
        : (st === 'WORKLOG' || st === 'WORKLOGS')
          ? (wlTitleMap.get(sid) || '업무일지 결재')
          : `${st || 'APPROVAL'} 결재`;
      const overdueDays = overdueDaysKst(ms);
      if (overdueDays <= 0) continue;
      push(`- [결재] ${title} · 담당자=${assigneeName} · 마감=${kstYmd(ms)} · 초과=${overdueDays}일`);
    }

    const helpIds = (helpRaw || []).map((t: any) => String(t.id)).filter(Boolean);
    const helpReqEvents = helpIds.length
      ? await this.prisma.event.findMany({ where: { subjectType: 'HelpTicket', activity: 'HelpRequested', subjectId: { in: helpIds } } })
      : [];
    const helpWorklogIds = new Set<string>();
    const helpIdToWlId: Record<string, string> = {};
    for (const ev of (helpReqEvents || [])) {
      const wlId = String(((ev as any).attrs as any)?.worklogId || '').trim();
      if (!wlId) continue;
      helpIdToWlId[String((ev as any).subjectId)] = wlId;
      helpWorklogIds.add(wlId);
    }
    const helpWls = helpWorklogIds.size
      ? await this.prisma.worklog.findMany({ where: { id: { in: Array.from(helpWorklogIds) } }, select: { id: true, note: true } })
      : [];
    const helpWlTitle = new Map<string, string>();
    for (const w of (helpWls || [])) {
      const raw = String((w as any).note || '').trim();
      const title = raw.split('\n')[0] || raw || '';
      helpWlTitle.set(String((w as any).id), title);
    }

    for (const h of (helpRaw || [])) {
      const dueAtRaw = (h as any).dueAt;
      const createdAtRaw = (h as any).createdAt;
      const slaMinutes = Number((h as any).slaMinutes || 0) || 0;
      let ms = dueAtRaw ? dueMs(dueAtRaw) : NaN;
      if (!Number.isFinite(ms) && slaMinutes > 0 && createdAtRaw) {
        const cMs = dueMs(createdAtRaw);
        if (Number.isFinite(cMs)) {
          ms = cMs + (slaMinutes * 60 * 1000);
        }
      }
      if (!Number.isFinite(ms)) continue;
      const overdueDays = overdueDaysKst(ms);
      if (overdueDays <= 0) continue;
      const wlId = helpIdToWlId[String((h as any).id)] || '';
      const cat = String((h as any).category || '').trim();
      const title = wlId ? (helpWlTitle.get(wlId) || '업무 요청') : (cat || '업무 요청');
      push(`- [업무요청] ${title} · 담당자=${assigneeName} · 마감=${kstYmd(ms)} · 초과=${overdueDays}일`);
    }
    for (const d of (delRaw || [])) {
      const dueAt = (d as any).dueAt;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      const title = String((d as any)?.childInitiative?.title || '위임');
      const from = String((d as any)?.delegator?.name || '').trim();
      const overdueDays = overdueDaysKst(ms);
      if (overdueDays <= 0) continue;
      push(`- [위임] ${title}${from ? ` (from=${from})` : ''} · 담당자=${assigneeName} · 마감=${kstYmd(ms)} · 초과=${overdueDays}일`);
    }
    for (const it of (initRaw || [])) {
      const dueAt = (it as any).dueAt;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      const title = String((it as any).title || '');
      const overdueDays = overdueDaysKst(ms);
      if (overdueDays <= 0) continue;
      push(`- [내 과제] ${title} · 담당자=${assigneeName} · 마감=${kstYmd(ms)} · 초과=${overdueDays}일`);
    }

    if (!lines.length) return '없음';
    return lines.join('\n');
  }

  @Post()
  async create(@Body() dto: CreateWorklogDto) {
    // Determine initiative: use provided, or (if process context provided) auto-create under user's OKR scaffold
    let initiativeIdFinal = dto.initiativeId;
    if (!initiativeIdFinal && dto.processInstanceId && dto.taskInstanceId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
      if (!user) throw new BadRequestException('createdBy user not found');
      const inst = await this.prisma.processInstance.findUnique({ where: { id: dto.processInstanceId } });
      if (!inst) throw new BadRequestException('invalid processInstanceId');
      const task = await this.prisma.processTaskInstance.findUnique({ where: { id: dto.taskInstanceId } });
      if (!task || task.instanceId !== inst.id) throw new BadRequestException('invalid taskInstanceId');

      // Try reuse initiative already on the task
      if (task.initiativeId) {
        initiativeIdFinal = task.initiativeId;
      } else {
        // Ensure user has a team/org unit
        let orgUnitId = user.orgUnitId;
        if (!orgUnitId) {
          const team = await this.prisma.orgUnit.create({ data: { name: `Auto Team - ${user.name}`, type: 'TEAM' } });
          await this.prisma.user.update({ where: { id: user.id }, data: { orgUnitId: team.id } });
          orgUnitId = team.id;
        }
        // Ensure default objective and KR for process worklogs
        let objective = await this.prisma.objective.findFirst({ where: { title: 'Process Auto Objective', orgUnitId } });
        if (!objective) {
          const now = new Date();
          const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
          objective = await this.prisma.objective.create({
            data: { title: 'Process Auto Objective', orgUnitId, ownerId: user.id, periodStart: now, periodEnd: end, status: 'ACTIVE' as any },
          });
        }
        let kr = await this.prisma.keyResult.findFirst({ where: { title: 'Process Auto KR', objectiveId: objective.id } });
        if (!kr) {
          kr = await this.prisma.keyResult.create({
            data: { title: 'Process Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: user.id, objectiveId: objective.id },
          });
        }
        const title = `${inst.title} · ${task.name}`;
        let initiative = await this.prisma.initiative.findFirst({ where: { title, keyResultId: kr.id, ownerId: user.id } });
        if (!initiative) {
          initiative = await this.prisma.initiative.create({ data: { title, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
        }
        initiativeIdFinal = initiative.id;
        await this.prisma.processTaskInstance.update({ where: { id: task.id }, data: { initiativeId: initiative.id } });
      }
    }

    if (!initiativeIdFinal && !dto.processInstanceId && !dto.taskInstanceId && dto.taskName) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
      if (!user) throw new BadRequestException('createdBy user not found');

      let orgUnitId = user.orgUnitId;
      let orgUnitName = '';
      if (orgUnitId) {
        const ou = await this.prisma.orgUnit.findUnique({ where: { id: orgUnitId } });
        orgUnitName = String(ou?.name || '');
      }
      if (!orgUnitId) {
        const team = await this.prisma.orgUnit.create({ data: { name: `Auto Team - ${user.name}`, type: 'TEAM' } });
        await this.prisma.user.update({ where: { id: user.id }, data: { orgUnitId: team.id } });
        orgUnitId = team.id;
        orgUnitName = team.name;
      }

      const now = new Date();
      const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const objTitle = `Auto Objective - ${orgUnitName || String(orgUnitId)}`;
      let objective = await this.prisma.objective.findFirst({ where: { title: objTitle, orgUnitId } });
      if (!objective) {
        objective = await this.prisma.objective.create({
          data: { title: objTitle, orgUnitId, ownerId: user.id, periodStart: now, periodEnd: end, status: 'ACTIVE' as any },
        });
      }
      let kr = await this.prisma.keyResult.findFirst({ where: { title: 'Auto KR', objectiveId: objective.id } });
      if (!kr) {
        kr = await this.prisma.keyResult.create({
          data: { title: 'Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: user.id, objectiveId: objective.id },
        });
      }

      const taskName = String(dto.taskName || '').trim();
      if (!taskName) throw new BadRequestException('taskName required');
      let initiative = await this.prisma.initiative.findFirst({ where: { title: taskName, keyResultId: kr.id, ownerId: user.id } });
      if (!initiative) {
        initiative = await this.prisma.initiative.create({ data: { title: taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
      }
      initiativeIdFinal = initiative.id;
    }

    if (!initiativeIdFinal) {
      throw new BadRequestException('initiativeId or taskName or processInstanceId/taskInstanceId required');
    }

    // Resolve KST date (YYYY-MM-DD -> KST midnight; default: today @ KST midnight)
    let dateVal: Date;
    if (dto.date) {
      const s = String(dto.date);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        dateVal = new Date(`${s}T00:00:00+09:00`);
      } else {
        dateVal = new Date(s);
      }
    } else {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const y = kst.getUTCFullYear();
      const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
      const d = String(kst.getUTCDate()).padStart(2, '0');
      dateVal = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
    }
    // 1) Create worklog
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiativeIdFinal,
        createdById: dto.createdById,
        progressPct: dto.progressPct ?? 0,
        timeSpentMinutes: dto.timeSpentMinutes ?? 0,
        blockerCode: dto.blockerCode,
        note: dto.note,
        attachments: dto.attachments ?? undefined,
        date: dateVal,
        urgent: !!dto.urgent,
        visibility: (dto.visibility as any) ?? 'ALL',
      },
    });

    // 2) Events
    await this.prisma.event.create({
      data: {
        subjectType: 'Worklog',
        subjectId: wl.id,
        activity: 'WorklogCreated',
        userId: dto.createdById,
        attrs: { initiativeId: initiativeIdFinal },
      },
    });
    if ((dto.progressPct ?? 0) > 0 || (dto.timeSpentMinutes ?? 0) > 0) {
      await this.prisma.event.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          activity: 'ProgressReported',
          userId: dto.createdById,
          attrs: { progressPct: dto.progressPct ?? 0, timeSpentMinutes: dto.timeSpentMinutes ?? 0 },
        },
      });
    }
    if (dto.blockerCode) {
      await this.prisma.event.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          activity: 'BlockerRaised',
          userId: dto.createdById,
          attrs: { blockerCode: dto.blockerCode },
        },
      });
    }

    // 3) Optional: Approval submission (report to manager)
    let approvalId: string | undefined;
    if (dto.report?.approverId) {
      const req = await this.prisma.approvalRequest.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          approverId: dto.report.approverId,
          requestedById: dto.createdById,
          dueAt: dto.report.dueAt ? new Date(dto.report.dueAt) : undefined,
        },
      });
      approvalId = req.id;
      await this.prisma.event.create({
        data: {
          subjectType: 'Worklog',
          subjectId: wl.id,
          activity: 'ApprovalRequested',
          userId: dto.createdById,
          attrs: { approverId: dto.report.approverId, requestId: req.id },
        },
      });
      await this.prisma.notification.create({
        data: {
          userId: dto.report.approverId,
          type: 'ApprovalRequested',
          subjectType: 'Worklog',
          subjectId: wl.id,
          payload: { requestId: req.id },
        },
      });
    }

    // 4) Optional: Share
    const shares: string[] = [];
    if (dto.share?.watcherIds?.length) {
      for (const watcherId of dto.share.watcherIds) {
        const share = await this.prisma.share.create({
          data: {
            subjectType: 'Worklog',
            subjectId: wl.id,
            watcherId,
            scope: (dto.share.scope as any) ?? 'READ',
          },
        });
        shares.push(share.id);
        await this.prisma.event.create({
          data: {
            subjectType: 'Worklog',
            subjectId: wl.id,
            activity: 'Shared',
            userId: dto.createdById,
            attrs: { watcherId, scope: dto.share.scope ?? 'READ' },
          },
        });
        await this.prisma.notification.create({
          data: {
            userId: watcherId,
            type: 'Shared',
            subjectType: 'Worklog',
            subjectId: wl.id,
            payload: { worklogId: wl.id },
          },
        });
      }
    }

    // 5) Optional: Help requests
    const tickets: string[] = [];
    if (dto.help?.length) {
      for (const h of dto.help) {
        const t = await this.prisma.helpTicket.create({
          data: {
            category: h.category,
            queue: h.queue,
            requesterId: dto.createdById,
            assigneeId: h.assigneeId,
            dueAt: h.dueAt ? new Date(h.dueAt) : undefined,
            slaMinutes: h.slaMinutes,
          },
        });
        tickets.push(t.id);
        await this.prisma.event.create({
          data: {
            subjectType: 'HelpTicket',
            subjectId: t.id,
            activity: 'HelpRequested',
            userId: dto.createdById,
            attrs: { worklogId: wl.id, category: h.category },
          },
        });
        if (h.assigneeId) {
          await this.prisma.notification.create({
            data: {
              userId: h.assigneeId,
              type: 'HelpRequested',
              subjectType: 'HelpTicket',
              subjectId: t.id,
              payload: { ticketId: t.id, fromWorklogId: wl.id },
            },
          });
        }
      }
    }

    // 6) Optional: Delegations
    const delegations: string[] = [];
    if (dto.delegate?.length) {
      for (const d of dto.delegate) {
        const del = await this.prisma.delegation.create({
          data: {
            parentType: d.parentType,
            parentId: d.parentId,
            childInitiativeId: d.childInitiativeId,
            delegatorId: dto.createdById,
            delegateeId: d.delegateeId,
            dueAt: d.dueAt ? new Date(d.dueAt) : undefined,
          },
        });
        delegations.push(del.id);
        await this.prisma.event.create({
          data: {
            subjectType: d.parentType,
            subjectId: d.parentId,
            activity: 'Delegated',
            userId: dto.createdById,
            attrs: { delegationId: del.id, childInitiativeId: d.childInitiativeId, delegateeId: d.delegateeId, fromWorklogId: wl.id },
          },
        });
        await this.prisma.notification.create({
          data: {
            userId: d.delegateeId,
            type: 'Delegated',
            subjectType: 'Delegation',
            subjectId: del.id,
            payload: { delegationId: del.id },
          },
        });
      }
    }

    return { worklog: wl, approvalId, shareIds: shares, helpTicketIds: tickets, delegationIds: delegations };
  }

  @Post('simple')
  async createSimple(@Body() dto: CreateSimpleWorklogDto) {
    let initiativeId = dto.initiativeId;
    let user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new Error('user not found');
    if (!initiativeId) {
      if (dto.keyResultId) {
        // Use selected KR to create/reuse an initiative for the task
        const kr = await this.prisma.keyResult.findUnique({ where: { id: dto.keyResultId } });
        if (!kr) throw new BadRequestException('invalid keyResultId');
        if (!dto.taskName) throw new BadRequestException('taskName required when keyResultId is provided');
        let initiative = await this.prisma.initiative.findFirst({ where: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id } });
        if (!initiative) {
          initiative = await this.prisma.initiative.create({ data: { title: dto.taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
        }
        initiativeId = initiative.id;
      } else {
        // Ensure team & OKR scaffolding exists
        let team = await this.prisma.orgUnit.findFirst({ where: { name: dto.teamName, type: 'TEAM' } });
        if (!team) {
          team = await this.prisma.orgUnit.create({ data: { name: dto.teamName, type: 'TEAM' } });
        }
        user = await this.prisma.user.update({ where: { id: dto.userId }, data: { orgUnitId: team.id } });
        const periodStart = new Date();
        const periodEnd = new Date(periodStart.getTime() + 1000 * 60 * 60 * 24 * 365);
        let objective = await this.prisma.objective.findFirst({ where: { title: `Auto Objective - ${team.name}`, orgUnitId: team.id } });
        if (!objective) {
          objective = await this.prisma.objective.create({
            data: { title: `Auto Objective - ${team.name}`, orgUnitId: team.id, ownerId: user.id, periodStart, periodEnd, status: 'ACTIVE' as any },
          });
        }
        let kr = await this.prisma.keyResult.findFirst({ where: { title: 'Auto KR', objectiveId: objective.id } });
        if (!kr) {
          kr = await this.prisma.keyResult.create({
            data: { title: 'Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: user.id, objectiveId: objective.id },
          });
        }

        if (dto.userGoalId) {
          const goal = await (this.prisma as any).userGoal.findUnique({ where: { id: dto.userGoalId } });
          if (!goal || goal.userId !== user.id) {
            throw new BadRequestException('invalid userGoalId');
          }
          let initiative = await this.prisma.initiative.findFirst({ where: { userGoalId: goal.id, ownerId: user.id } as any });
          if (!initiative) {
            initiative = await this.prisma.initiative.create({
              data: { title: goal.title, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any, userGoalId: goal.id } as any,
            });
          }
          initiativeId = initiative.id;
        } else {
          const taskName = String(dto.taskName || dto.title || '').trim();
          if (!taskName) throw new BadRequestException('taskName required when initiativeId/userGoalId is not provided');
          let initiative = await this.prisma.initiative.findFirst({ where: { title: taskName, keyResultId: kr.id, ownerId: user.id } });
          if (!initiative) {
            initiative = await this.prisma.initiative.create({ data: { title: taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
          }
          initiativeId = initiative.id;
        }
      }
    }

    // 4) Create worklog
    // Build plain text for search (strip HTML when provided)
    const plainFromHtml = dto.contentHtml
      ? dto.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const contentPlain = dto.content || plainFromHtml || '';
    const note = `${dto.title}\n\n${contentPlain}`;
    const rawAttachments: any = (dto as any).attachments;
    const files = Array.isArray(rawAttachments?.files)
      ? rawAttachments.files
      : (Array.isArray(rawAttachments) ? rawAttachments : []);
    const photos = Array.isArray(rawAttachments?.photos) ? rawAttachments.photos : [];
    const attachmentsJson = dto.contentHtml || rawAttachments
      ? {
          contentHtml: dto.contentHtml,
          files,
          ...(photos.length ? { photos } : {}),
        }
      : undefined;
    if (!initiativeId) {
      throw new BadRequestException('initiativeId or taskName required');
    }
    // Resolve Worklog.date in KST
    let dateValSimple: Date;
    if (dto.date) {
      const s = String(dto.date);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        dateValSimple = new Date(`${s}T00:00:00+09:00`);
      } else {
        dateValSimple = new Date(s);
      }
    } else {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const y = kst.getUTCFullYear();
      const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
      const d = String(kst.getUTCDate()).padStart(2, '0');
      dateValSimple = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
    }
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiativeId,
        createdById: user.id,
        note,
        timeSpentMinutes: dto.timeSpentMinutes ?? 0,
        attachments: attachmentsJson as any,
        tags: (dto as any).tags as any,
        date: dateValSimple,
        urgent: !!dto.urgent,
        visibility: (dto.visibility as any) ?? 'ALL',
      },
    });
    await this.prisma.event.create({ data: { subjectType: 'Worklog', subjectId: wl.id, activity: 'WorklogCreated', userId: user.id, attrs: { simple: true } } });
    return { id: wl.id, initiativeId };
  }

  @Get('search')
  async search(
    @Query('team') teamName?: string,
    @Query('user') userName?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: 'OKR' | 'KPI',
    @Query('krId') krId?: string,
    @Query('initiativeId') initiativeId?: string,
    @Query('urgent') urgentStr?: string,
    @Query('viewerId') viewerId?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '20', 10) || 20, 100);
    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) (where.date as any).gte = new Date(from);
      if (to) (where.date as any).lte = new Date(to);
    }
    if (q) where.note = { contains: q, mode: 'insensitive' as any };
    if (teamName) where.createdBy = { orgUnit: { name: teamName } };
    if (userName) where.createdBy = { ...(where.createdBy || {}), name: { contains: userName, mode: 'insensitive' as any } };
    if (typeof urgentStr === 'string') {
      const v = urgentStr.toLowerCase();
      if (v === 'true' || v === '1') (where as any).urgent = true;
      if (v === 'false' || v === '0') (where as any).urgent = false;
    }

    // Determine viewer visibility rights
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    let viewer: any = null;
    if (viewerId) {
      viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | undefined;
      if (role === 'CEO' || role === 'EXTERNAL') {
        visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      } else if (role === 'EXEC') {
        visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      } else if (role === 'MANAGER') {
        visibilityIn = ['ALL', 'MANAGER_PLUS'];
      } else {
        visibilityIn = ['ALL'];
      }
    }

    const items = await this.prisma.worklog.findMany({
      where: {
        ...where,
        ...(kind === 'OKR' ? { initiative: { keyResult: { objective: { pillar: null } } } } : {}),
        ...(kind === 'KPI' ? { initiative: { keyResult: { NOT: { objective: { pillar: null } } } } } : {}),
        ...(krId ? { initiative: { keyResultId: krId } } : {}),
        ...(initiativeId ? { initiativeId } : {}),
        ...(viewerId
          ? {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            }
          : { visibility: { in: visibilityIn as any } }),
      },
      take: limit,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { date: 'desc' },
      include: { createdBy: { include: { orgUnit: true } }, initiative: true },
    });
    const nextCursor = items.length === limit ? items[items.length - 1].id : undefined;
    const mapped = items.map((it: any) => {
      const lines = (it.note || '').split(/\n+/);
      const title = lines[0] || '';
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      return {
        id: it.id,
        userId: it.createdById,
        date: it.date,
        createdAt: it.createdAt,
        visibility: it.visibility,
        timeSpentMinutes: it.timeSpentMinutes,
        title,
        excerpt,
        userName: it.createdBy?.name,
        teamName: it.createdBy?.orgUnit?.name,
        taskName: it.initiative?.title,
        attachments: (it as any).attachments ?? undefined,
        note: it.note ?? undefined,
        urgent: (it as any).urgent ?? false,
      };
    });
    return { items: mapped, nextCursor };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wl = await (this.prisma as any).worklog.findUnique({
      where: { id },
      include: {
        initiative: { include: { keyResult: { include: { objective: true } } } },
        createdBy: { include: { orgUnit: true } },
      },
    });
    if (!wl) return null;
    const task = await (this.prisma as any).processTaskInstance.findFirst({ where: { worklogId: id }, include: { instance: true } });
    const process = task
      ? {
          instance: { id: task.instanceId, title: (task as any).instance?.title || '' },
          task: { id: task.id, name: task.name },
        }
      : null;
    return { ...wl, process } as any;
  }

  @Get('stats/weekly')
  async weeklyStats(@Query('days') daysStr?: string, @Query('team') teamName?: string, @Query('user') userName?: string, @Query('viewerId') viewerId?: string) {
    const days = Math.max(1, Math.min(parseInt(daysStr || '7', 10) || 7, 30));
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    // Resolve user filters first (so we can keep Worklog queries simple + index-friendly)
    let filterUserIds: string[] | null = null;
    if (teamName || userName) {
      const userWhere: any = {};
      if (teamName) userWhere.orgUnit = { name: teamName };
      if (userName) userWhere.name = { contains: userName, mode: 'insensitive' as any };
      const users = await (this.prisma as any).user.findMany({
        where: userWhere,
        select: { id: true },
      });
      const ids = (users || []).map((u: any) => String(u.id));
      if (!ids.length) {
        return { from: from.toISOString(), to: now.toISOString(), days, total: 0, teams: [] };
      }
      filterUserIds = ids;
    }

    // Visibility filter
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (viewerId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | undefined;
      if (role === 'CEO' || role === 'EXTERNAL') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    const baseWhere: any = { date: { gte: from, lte: now } };
    if (filterUserIds) baseWhere.createdById = { in: filterUserIds };
    const visibilityWhere = viewerId
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            },
          ],
        }
      : { ...baseWhere, visibility: { in: visibilityIn as any } };

    // DB-side aggregation
    const agg = await (this.prisma as any).worklog.groupBy({
      by: ['createdById'],
      where: visibilityWhere,
      _count: { _all: true },
      _sum: { timeSpentMinutes: true },
    });

    const userIds = (agg || []).map((r: any) => String(r.createdById));
    if (!userIds.length) {
      return { from: from.toISOString(), to: now.toISOString(), days, total: 0, teams: [] };
    }

    const users = await (this.prisma as any).user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, orgUnit: { select: { name: true } } },
    });
    const userMap = new Map<string, { name: string; teamName: string }>();
    for (const u of (users || [])) {
      userMap.set(String(u.id), {
        name: String(u.name || '익명'),
        teamName: String(u.orgUnit?.name || '미지정팀'),
      });
    }

    // Recent per user (window function) for UI preview
    const RECENT_LIMIT = 3;
    const recentRows: Array<{ id: string; createdById: string; createdAt: Date; date: Date; note: string | null }> = await (this.prisma as any).$queryRaw(
      Prisma.sql`
        SELECT x.id, x."createdById" AS "createdById", x."createdAt" AS "createdAt", x."date" AS "date", x.note
        FROM (
          SELECT w.id, w."createdById", w."createdAt", w."date", w.note,
                 row_number() OVER (PARTITION BY w."createdById" ORDER BY w."createdAt" DESC, w.id DESC) AS rn
          FROM "Worklog" w
          WHERE w."date" >= ${from} AND w."date" <= ${now}
            AND w."createdById" IN (${Prisma.join(userIds)})
            AND (
              ${viewerId ? Prisma.sql`(w."createdById" = ${viewerId} OR w."visibility" = ANY(ARRAY[${Prisma.join(visibilityIn)}]::"WorklogVisibility"[]))` : Prisma.sql`(w."visibility" = ANY(ARRAY[${Prisma.join(visibilityIn)}]::"WorklogVisibility"[]))`}
            )
        ) x
        WHERE x.rn <= ${RECENT_LIMIT}
      `
    );

    const recentByUser = new Map<string, Array<{ id: string; title: string; createdAt: any; date: any }>>();
    for (const r of (recentRows || [])) {
      const uid = String((r as any).createdById);
      const lines = String((r as any).note || '').split(/\n+/);
      const title = lines[0] || '(제목 없음)';
      if (!recentByUser.has(uid)) recentByUser.set(uid, []);
      recentByUser.get(uid)!.push({ id: String((r as any).id), title, createdAt: (r as any).createdAt, date: (r as any).date });
    }

    type Bucket = { [userName: string]: { count: number; minutes: number; recent: Array<{ id: string; title: string; createdAt?: any; date?: any }> } };
    const byTeam = new Map<string, Bucket>();
    for (const r of (agg || [])) {
      const uid = String(r.createdById);
      const info = userMap.get(uid) || { name: '익명', teamName: '미지정팀' };
      const team = info.teamName;
      const user = info.name;
      if (!byTeam.has(team)) byTeam.set(team, {});
      const bucket = byTeam.get(team)!;
      bucket[user] = {
        count: Number(r._count?._all || 0),
        minutes: Number(r._sum?.timeSpentMinutes || 0),
        recent: recentByUser.get(uid) || [],
      };
    }

    const teams = Array.from(byTeam.entries()).map(([teamName, bucket]) => {
      const members = Object.entries(bucket)
        .map(([userName, v]) => ({ userName, count: v.count, minutes: v.minutes, recent: v.recent }))
        .sort((a, b) => (b.count - a.count) || (b.minutes - a.minutes));
      const total = members.reduce((s, m) => s + m.count, 0);
      return { teamName, total, members };
    }).sort((a, b) => b.total - a.total);
    const total = teams.reduce((s, t) => s + t.total, 0);
    return { from: from.toISOString(), to: now.toISOString(), days, total, teams };
  }

  @Get('stats/daily')
  async dailyStats(
    @Query('days') daysStr?: string,
    @Query('teamId') teamId?: string,
    @Query('orgUnitIds') orgUnitIdsCsv?: string,
    @Query('userId') userId?: string,
    @Query('viewerId') viewerId?: string,
  ) {
    const days = Math.max(1, Math.min(parseInt(daysStr || '7', 10) || 7, 30));
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    const kstYmd = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

    // Visibility filter
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (viewerId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | undefined;
      if (role === 'CEO' || role === 'EXTERNAL') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    // Resolve filter user ids
    let filterUserIds: string[] | null = null;
    const orgUnitIds: string[] = [];
    if (teamId) orgUnitIds.push(String(teamId));
    if (orgUnitIdsCsv) {
      String(orgUnitIdsCsv)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => orgUnitIds.push(id));
    }
    if (orgUnitIds.length > 0) {
      const users = await this.prisma.user.findMany({ where: { orgUnitId: { in: orgUnitIds } }, select: { id: true } });
      const ids = (users || []).map((u: any) => String(u.id));
      if (!ids.length) {
        return { from: from.toISOString(), to: now.toISOString(), days, totalCount: 0, totalMinutes: 0, groups: [] };
      }
      filterUserIds = ids;
    }
    if (userId) {
      filterUserIds = [String(userId)];
    }

    const baseWhere: any = { date: { gte: from, lte: now } };
    if (filterUserIds) baseWhere.createdById = { in: filterUserIds };
    const visibilityWhere = viewerId
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            },
          ],
        }
      : { ...baseWhere, visibility: { in: visibilityIn as any } };

    const items = await this.prisma.worklog.findMany({
      where: visibilityWhere,
      include: { createdBy: { include: { orgUnit: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 2000,
    });

    let totalCount = 0;
    let totalMinutes = 0;
    const byDay = new Map<string, any[]>();
    for (const it of (items || [])) {
      totalCount += 1;
      totalMinutes += Number((it as any).timeSpentMinutes || 0);
      const ymd = kstYmd(new Date((it as any).date || (it as any).createdAt));
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
        createdById: String((it as any).createdById),
        userName: String((it as any).createdBy?.name || ''),
        orgUnitId: String((it as any).createdBy?.orgUnitId || ''),
        teamName: String((it as any).createdBy?.orgUnit?.name || ''),
        urgent: !!(it as any).urgent,
      });
    }

    const groups = Array.from(byDay.entries())
      .map(([ymd, rows]) => {
        const sorted = (rows || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const count = sorted.length;
        const minutes = sorted.reduce((s: number, r: any) => s + (Number(r.timeSpentMinutes) || 0), 0);
        return { ymd, count, minutes, items: sorted };
      })
      .sort((a, b) => String(b.ymd).localeCompare(String(a.ymd)));

    return { from: from.toISOString(), to: now.toISOString(), days, totalCount, totalMinutes, groups };
  }

  @Get('stats/weekly/details')
  async weeklyDetails(
    @Query('days') daysStr?: string,
    @Query('team') teamName?: string,
    @Query('user') userName?: string,
    @Query('viewerId') viewerId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const days = Math.max(1, Math.min(parseInt(daysStr || '7', 10) || 7, 30));
    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    const limit = Math.max(20, Math.min(parseInt(limitStr || '120', 10) || 120, 500));

    // Resolve user filters (team/user) to createdById IN (...) for better performance
    let filterUserIds: string[] | null = null;
    if (teamName || userName) {
      const userWhere: any = {};
      if (teamName) userWhere.orgUnit = { name: teamName };
      if (userName) userWhere.name = { contains: userName, mode: 'insensitive' as any };
      const users = await (this.prisma as any).user.findMany({ where: userWhere, select: { id: true } });
      const ids = (users || []).map((u: any) => String(u.id));
      if (!ids.length) {
        return { from: from.toISOString(), to: now.toISOString(), days, totalCount: 0, totalMinutes: 0, items: [], nextCursor: null, hasMore: false };
      }
      filterUserIds = ids;
    }

    // Visibility filter (same rules as weeklyStats)
    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (viewerId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | undefined;
      if (role === 'CEO' || role === 'EXTERNAL') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    // Cursor parsing: `${createdAtISO}|${id}`
    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const raw = String(cursor);
      const idx = raw.indexOf('|');
      if (idx > 0) {
        const ts = raw.slice(0, idx);
        const id = raw.slice(idx + 1);
        const d = new Date(ts);
        if (!isNaN(d.getTime()) && id) {
          cursorCreatedAt = d;
          cursorId = id;
        }
      }
    }

    const baseWhere: any = { date: { gte: from, lte: now } };
    if (filterUserIds) baseWhere.createdById = { in: filterUserIds };
    const visibilityWhere = viewerId
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            },
          ],
        }
      : { ...baseWhere, visibility: { in: visibilityIn as any } };

    const pagingWhere = (cursorCreatedAt && cursorId)
      ? {
          OR: [
            { createdAt: { lt: cursorCreatedAt } },
            { createdAt: cursorCreatedAt, id: { lt: cursorId } },
          ],
        }
      : {};

    const finalWhere = Object.keys(pagingWhere).length
      ? { AND: [visibilityWhere, pagingWhere] }
      : visibilityWhere;

    // Totals (for header) via DB aggregate (not limited by pagination)
    const totals = await (this.prisma as any).worklog.aggregate({
      where: visibilityWhere,
      _count: { _all: true },
      _sum: { timeSpentMinutes: true },
    });
    const totalCount = Number(totals?._count?._all || 0);
    const totalMinutes = Number(totals?._sum?.timeSpentMinutes || 0);

    const items = await (this.prisma as any).worklog.findMany({
      where: finalWhere,
      include: {
        createdBy: { include: { orgUnit: true } },
        initiative: { include: { keyResult: { include: { objective: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = (items || []).length > limit;
    const page = hasMore ? (items || []).slice(0, limit) : (items || []);
    const last = page.length ? page[page.length - 1] : null;
    const nextCursor = last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null;

    const mapped = page.map((it: any) => {
      const lines = String(it.note || '').split(/\n+/);
      const title = lines[0] || '';
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      return {
        id: it.id,
        createdAt: it.createdAt,
        date: it.date,
        timeSpentMinutes: it.timeSpentMinutes ?? 0,
        title,
        excerpt,
        userName: it.createdBy?.name,
        teamName: it.createdBy?.orgUnit?.name,
        taskName: it.initiative?.title,
        objectiveTitle: it.initiative?.keyResult?.objective?.title,
        keyResultTitle: it.initiative?.keyResult?.title,
        initiativeTitle: it.initiative?.title,
      };
    });

    return { from: from.toISOString(), to: now.toISOString(), days, totalCount, totalMinutes, items: mapped, nextCursor, hasMore };
  }

  @Get('ai/summary')
  async aiSummary(
    @Query('days') daysStr?: string,
    @Query('team') teamName?: string,
    @Query('user') userName?: string,
    @Query('viewerId') viewerId?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('question') question?: string,
    @Query('includeProcess') includeProcess?: string,
    @Query('includeHelp') includeHelp?: string,
    @Query('includeApprovals') includeApprovals?: string,
    @Query('includeEvaluation') includeEvaluation?: string,
  ) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) {
      throw new BadRequestException('Missing OPENAI_API_KEY (or *_CAMS / *_IAT). Set it as a Railway env var.');
    }
    if (!viewerId) throw new BadRequestException('viewerId required');
    const kstYmd = (d: any) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(d));
    const now = new Date();
    const todayYmd = kstYmd(now);
    const defaultDays = Math.max(1, Math.min(parseInt(daysStr || '3', 10) || 3, 30));
    const from = (fromStr && /^\d{4}-\d{2}-\d{2}$/.test(String(fromStr)))
      ? new Date(`${String(fromStr)}T00:00:00+09:00`)
      : new Date(new Date(`${todayYmd}T00:00:00+09:00`).getTime() - (defaultDays - 1) * 24 * 60 * 60 * 1000);
    const to = (toStr && /^\d{4}-\d{2}-\d{2}$/.test(String(toStr)))
      ? new Date(`${String(toStr)}T23:59:59.999+09:00`)
      : new Date(`${todayYmd}T23:59:59.999+09:00`);
    const days = Math.max(1, Math.min(30, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1));
    const baseWhere: any = { date: { gte: from, lte: to } };

    const scopeOrgUnitIds = await this.getScopeOrgUnitIdsForViewer(String(viewerId));
    if (scopeOrgUnitIds.size === 0) {
      return { from: from.toISOString(), to: to.toISOString(), days, summary: '' };
    }

    const createdByWhere: any = {
      ...(baseWhere.createdBy || {}),
      orgUnitId: { in: Array.from(scopeOrgUnitIds) },
    };
    if (teamName) createdByWhere.orgUnit = { name: teamName };
    if (userName) createdByWhere.name = { contains: userName, mode: 'insensitive' as any };
    baseWhere.createdBy = createdByWhere;

    let visibilityIn: Array<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'> = ['ALL'];
    if (viewerId) {
      const viewer = await this.prisma.user.findUnique({ where: { id: viewerId } });
      const role = (viewer?.role as any) as 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | undefined;
      if (role === 'CEO' || role === 'EXTERNAL') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
      else if (role === 'EXEC') visibilityIn = ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
      else if (role === 'MANAGER') visibilityIn = ['ALL', 'MANAGER_PLUS'];
      else visibilityIn = ['ALL'];
    }

    const where = viewerId
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdById: viewerId },
                { visibility: { in: visibilityIn as any } },
              ],
            },
          ],
        }
      : { ...baseWhere, visibility: { in: visibilityIn as any } };
    const items = await (this.prisma as any).worklog.findMany({
      where,
      include: { createdBy: { include: { orgUnit: true } } },
      orderBy: { date: 'desc' },
      take: 1000,
    });
    // Build compact context (limit per user)
    const byTeamUser = new Map<string, Map<string, string[]>>();
    for (const it of items) {
      const team = (it as any)?.createdBy?.orgUnit?.name || '미지정팀';
      const user = (it as any)?.createdBy?.name || '익명';
      const lines = String(it.note || '').split(/\n+/);
      const title = (lines[0] || '').slice(0, 120);
      const excerpt = lines.slice(1).join(' ').trim().slice(0, 200);
      if (!byTeamUser.has(team)) byTeamUser.set(team, new Map());
      const inner = byTeamUser.get(team)!;
      if (!inner.has(user)) inner.set(user, []);
      const arr = inner.get(user)!;
      if (arr.length < 6) arr.push(`- ${title}${excerpt ? ` — ${excerpt}` : ''}`);
    }
    const parts: string[] = [];
    for (const [team, users] of byTeamUser) {
      parts.push(`팀: ${team}`);
      for (const [user, notes] of users) {
        parts.push(`  구성원: ${user}`);
        notes.forEach(n => parts.push(`    ${n}`));
      }
    }
    const context = parts.join('\n');

    const wantsProcess = includeProcess === '1' || includeProcess === 'true';
    const wantsHelp = includeHelp === '1' || includeHelp === 'true';
    const wantsApprovals = includeApprovals === '1' || includeApprovals === 'true';
    const wantsEvaluation = includeEvaluation === '1' || includeEvaluation === 'true';

    const targetUserIds = (async () => {
      if (teamName || userName) {
        const createdByWhere2: any = { orgUnitId: { in: Array.from(scopeOrgUnitIds) } };
        if (teamName) createdByWhere2.orgUnit = { name: teamName };
        if (userName) createdByWhere2.name = { contains: userName, mode: 'insensitive' as any };
        const us = await this.prisma.user.findMany({ where: createdByWhere2, select: { id: true, name: true, orgUnitId: true, orgUnit: { select: { name: true } } }, take: 50 });
        return (us || []).map((u: any) => ({ id: String(u.id), name: String(u.name || ''), orgUnitId: String(u.orgUnitId || ''), team: String(u.orgUnit?.name || '') }));
      }
      const u = await this.prisma.user.findUnique({ where: { id: String(viewerId) }, select: { id: true, name: true, orgUnitId: true, orgUnit: { select: { name: true } } } });
      return u ? [{ id: String(u.id), name: String((u as any).name || ''), orgUnitId: String((u as any).orgUnitId || ''), team: String((u as any).orgUnit?.name || '') }] : [];
    })();

    const whoList = await targetUserIds;
    const whoIds = whoList.map((x) => x.id).filter(Boolean);
    const statusLines: string[] = [];
    const spush = (s: string) => {
      const v = String(s || '').trim();
      if (!v) return;
      if (statusLines.length >= 60) return;
      statusLines.push(v);
    };
    if (wantsProcess && whoIds.length) {
      const tasks = await (this.prisma as any).processTaskInstance.findMany({
        where: { assigneeId: { in: whoIds }, status: { notIn: ['COMPLETED', 'SKIPPED'] as any } },
        include: { instance: { select: { id: true, title: true } } },
        orderBy: [{ plannedEndAt: 'asc' }, { deadlineAt: 'asc' }, { createdAt: 'asc' }],
        take: 30,
      });
      spush(`[프로세스 진행중] ${Number((tasks || []).length)}건`);
      for (const t of (tasks || []).slice(0, 12)) {
        const dueAt = (t as any).plannedEndAt || (t as any).deadlineAt || null;
        const due = dueAt ? kstYmd(dueAt) : '';
        const assigneeId = String((t as any).assigneeId || '');
        const who = whoList.find((x) => x.id === assigneeId);
        const whoName = String(who?.name || assigneeId);
        const whoTeam = String(who?.team || '');
        const procTitle = String((t as any)?.instance?.title || '').trim();
        const taskTitle = String((t as any)?.name || '').trim();
        const st = String((t as any)?.status || '').trim();
        spush(`- ${procTitle}${taskTitle ? ` / ${taskTitle}` : ''} · 담당자=${whoName}${whoTeam ? `(${whoTeam})` : ''} · 상태=${st}${due ? ` · 마감=${due}` : ''}`);
      }
    }
    if (wantsHelp && whoIds.length) {
      const tickets = await this.prisma.helpTicket.findMany({
        where: { assigneeId: { in: whoIds }, status: { notIn: ['DONE', 'CANCELLED'] as any } },
        include: { requester: { select: { name: true } }, assignee: { select: { id: true, name: true, orgUnit: { select: { name: true } } } } },
        orderBy: [{ createdAt: 'asc' }],
        take: 30,
      });
      spush(`[업무요청 진행중] ${Number((tickets || []).length)}건`);
      for (const t of (tickets || []).slice(0, 12)) {
        const dueAt = (t as any).dueAt;
        const due = dueAt ? kstYmd(dueAt) : '';
        const whoName = String((t as any)?.assignee?.name || '').trim() || String((t as any).assigneeId || '').trim();
        const whoTeam = String((t as any)?.assignee?.orgUnit?.name || '').trim();
        const cat = String((t as any)?.category || '').trim();
        const st = String((t as any)?.status || '').trim();
        const req = String((t as any)?.requester?.name || '').trim();
        spush(`- ${cat || '업무요청'} · 담당자=${whoName}${whoTeam ? `(${whoTeam})` : ''} · 상태=${st}${due ? ` · 마감=${due}` : ''}${req ? ` · 요청자=${req}` : ''}`);
      }
    }
    if (wantsApprovals && whoIds.length) {
      const approvals = await this.prisma.approvalRequest.findMany({
        where: { approverId: { in: whoIds }, status: 'PENDING' as any },
        select: { id: true, approverId: true, subjectType: true, subjectId: true, dueAt: true, createdAt: true },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 30,
      });
      spush(`[결재 대기] ${Number((approvals || []).length)}건`);
      for (const a of (approvals || []).slice(0, 12)) {
        const dueAt = (a as any).dueAt;
        const due = dueAt ? kstYmd(dueAt) : '';
        const who = whoList.find((x) => x.id === String((a as any).approverId || ''));
        const whoName = String(who?.name || String((a as any).approverId || ''));
        const whoTeam = String(who?.team || '');
        const st = String((a as any)?.subjectType || '').trim();
        spush(`- ${st || '결재'} · 담당자=${whoName}${whoTeam ? `(${whoTeam})` : ''}${due ? ` · 마감=${due}` : ''}`);
      }
    }

    const statusContext = statusLines.length ? statusLines.join('\n') : '';

    const evalLines: string[] = [];
    const epush = (s: string) => {
      const v = String(s || '').trim();
      if (!v) return;
      if (evalLines.length >= 80) return;
      evalLines.push(v);
    };

    if (wantsEvaluation) {
      const dayMs = 24 * 60 * 60 * 1000;
      const ymds: string[] = [];
      for (let i = 0; i < days; i += 1) {
        ymds.push(kstYmd(new Date(from.getTime() + i * dayMs)));
      }

      const teamIdsSet = new Set<string>();
      for (const it of items || []) {
        const ouId = String((it as any)?.createdBy?.orgUnitId || '').trim();
        if (ouId && scopeOrgUnitIds.has(ouId)) teamIdsSet.add(ouId);
      }
      for (const u of whoList || []) {
        const ouId = String((u as any)?.orgUnitId || '').trim();
        if (ouId && scopeOrgUnitIds.has(ouId)) teamIdsSet.add(ouId);
      }
      let teamIds = Array.from(teamIdsSet);
      if (!teamIds.length) {
        teamIds = Array.from(scopeOrgUnitIds).slice(0, 12);
      }

      const teamEvalRows = teamIds.length
        ? await (this.prisma as any).worklogTeamDailyEval.findMany({
            where: {
              ymd: { in: ymds },
              orgUnitId: { in: teamIds },
              evaluator: { role: { in: ['CEO', 'EXEC', 'MANAGER'] as any } },
            },
            include: {
              orgUnit: true,
              evaluator: { select: { id: true, name: true, role: true } },
            },
            orderBy: [{ orgUnit: { name: 'asc' } }, { ymd: 'asc' }, { updatedAt: 'desc' }],
            take: 2000,
          })
        : [];

      const byTeam = new Map<string, { name: string; counts: any; comments: Array<{ ymd: string; evaluatorName: string; evaluatorRole: string; status: string; comment: string }> }>();
      for (const r of teamEvalRows || []) {
        const ouId = String((r as any).orgUnitId || '');
        const ouName = String((r as any)?.orgUnit?.name || ouId);
        if (!byTeam.has(ouId)) byTeam.set(ouId, { name: ouName, counts: { BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 }, comments: [] });
        const cur = byTeam.get(ouId)!;
        const st = String((r as any).status || '').toUpperCase();
        if (cur.counts[st] != null) cur.counts[st] += 1;
        const cmt = String((r as any).comment || '').trim();
        if (cmt) {
          cur.comments.push({
            ymd: String((r as any).ymd || ''),
            evaluatorName: String((r as any)?.evaluator?.name || ''),
            evaluatorRole: String((r as any)?.evaluator?.role || ''),
            status: st,
            comment: cmt.slice(0, 160),
          });
        }
      }

      if (byTeam.size) {
        epush('[팀 평가(팀장/임원)]');
        for (const t of Array.from(byTeam.values())) {
          const c = t.counts;
          const base = `- ${t.name} · 파랑 ${c.BLUE || 0} / 초록 ${c.GREEN || 0} / 노랑 ${c.YELLOW || 0} / 빨강 ${c.RED || 0}`;
          const cmts = (t.comments || []).slice(-3).map((x) => `${x.ymd} ${x.status} · 평가자=${x.evaluatorName}(${x.evaluatorRole}) · ${x.comment}`);
          epush(cmts.length ? `${base}\n  ${cmts.map((x) => `- ${x}`).join('\n  ')}` : base);
        }
      }

      if (whoIds.length) {
        const fbRows = await this.prisma.feedback.findMany({
          where: {
            subjectType: 'User',
            subjectId: { in: whoIds },
            createdAt: { gte: from, lte: to },
            author: { role: { in: ['CEO', 'EXEC', 'MANAGER'] as any } },
          },
          include: { author: true },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });

        const whoById = new Map<string, any>();
        for (const u of whoList || []) whoById.set(String((u as any).id), u);

        const byUser = new Map<string, any[]>();
        for (const f of fbRows || []) {
          const sid = String((f as any).subjectId || '');
          if (!sid) continue;
          if (!byUser.has(sid)) byUser.set(sid, []);
          byUser.get(sid)!.push(f as any);
        }

        if (byUser.size) {
          epush('[개인 평가(팀장/임원)]');
          for (const [uid, arr] of byUser) {
            const u = whoById.get(uid);
            const name = String(u?.name || uid);
            const team = String(u?.team || '').trim();
            const header = `- ${team ? `${team} / ` : ''}${name} · ${arr.length}건`;
            const previews = (arr || []).slice(0, 3).map((x: any) => {
              const ymd = x.createdAt ? kstYmd(new Date(x.createdAt)) : '';
              const authorName = String(x?.author?.name || '');
              const authorRole = String(x?.author?.role || '');
              const rating = x.rating != null ? ` · 평점=${x.rating}` : '';
              const content = String(x.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
              return `${ymd} · 평가자=${authorName}(${authorRole})${rating} · ${content}`;
            });
            epush(previews.length ? `${header}\n  ${previews.map((x: string) => `- ${x}`).join('\n  ')}` : header);
          }
        }
      }
    }

    const evaluationContext = evalLines.length ? evalLines.join('\n') : '';
    const q = String(question || '').trim();
    const sys = '당신은 제조업(사출/도장/조립) 환경의 팀 리더 보조 AI입니다. 최근 업무일지와(선택 시) 현재 진행 현황/평가 정보를 바탕으로 팀별/개인별 진행 상황을 한국어로 간결하게 요약하고, 리스크/의존성/다음 액션을 bullet로 정리하세요. 넘겨받은 텍스트에 없는 추정은 하지 마세요.';
    const user = `기간: ${kstYmd(from)} ~ ${kstYmd(to)} (총 ${days}일)\n\n요약을 작성해 주세요.\n- 팀별로 먼저 요약\n- 개인별 한줄 요약\n- 마지막에 전체 하이라이트 3개, 리스크 3개, 다음 액션 3개\n\n${q ? `[추가 문의사항]\n${q}\n\n추가 문의사항이 있으면 별도 섹션에서 답변해 주세요.\n\n` : ''}${statusContext ? `[현재 진행 현황]\n${statusContext}\n\n` : ''}${evaluationContext ? `[업무 평가(팀장/임원)]\n${evaluationContext}\n\n` : ''}[업무일지 데이터]\n${context}`;
    // Call OpenAI
    const f: any = (globalThis as any).fetch;
    if (!f) {
      throw new BadRequestException('Server fetch not available. Please use Node 18+ or provide a fetch polyfill.');
    }
    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`OpenAI error: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    const summary = String(data?.choices?.[0]?.message?.content || '').trim();
    return { from: from.toISOString(), to: to.toISOString(), days, summary };
  }
}
