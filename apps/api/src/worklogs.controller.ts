import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { canViewWorklog } from './lib/worklog-visibility';
import { callAI } from './llm/ai-client';

class ReportDto {
  @IsString()
  @IsNotEmpty()
  approverId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ShareDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  watcherIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  externalRecipientEmails?: string[];

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

  @IsOptional()
  @IsString()
  keywords?: string;
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
  @IsOptional() structuredData?: any;
  @IsOptional() @IsString() keywords?: string;
}

// Power Automate / 외부 웹훅용 DTO
class WebhookWorklogDto {
  @IsOptional() @IsString() apiKey?: string; // 간단한 인증용
  @IsString() @IsNotEmpty() email!: string; // 사용자 이메일로 찾기
  @IsString() @IsNotEmpty() title!: string; // 제목
  @IsOptional() @IsString() content?: string; // 내용
  @IsOptional() @IsString() notes?: string; // Notes (content와 합쳐짐)
  @IsOptional() @IsString() date?: string; // 업무시작시간 (ISO or yyyy-MM-dd)
  @IsOptional() @IsInt() @Min(0) timeSpentMinutes?: number; // 업무소요시간
  @IsOptional() @IsString() department?: string; // 부서 (참고용)
  @IsOptional() @IsString() visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';
  @IsOptional() @IsString() source?: string; // 출처 표시 (예: 'PowerAutomate', 'SharePoint')
}

@Controller('worklogs')
export class WorklogsController {
  constructor(private prisma: PrismaService) {}

  /**
   * GET /api/worklogs/team-daily-stats
   * 홈 상단 요약: 어제/오늘(업무일지 기준일, KST)에 팀별로 몇 건 작성됐는지 +
   * 팀 인원수 대비 인당 작성 건수. (어제 일지를 오늘 올릴 수 있어 두 날짜 모두 표시)
   */
  @Get('team-daily-stats')
  async teamDailyStats() {
    const kstYmd = (d: Date) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);

    const now = new Date();
    const todayYmd = kstYmd(now);
    const todayStart = new Date(`${todayYmd}T00:00:00+09:00`);
    const yStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const tEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const yesterdayYmd = kstYmd(yStart);

    // 업무일지 기준일(date)이 어제~오늘인 건 — 작성자 소속(orgUnitId)별로 집계
    const worklogs = await this.prisma.worklog.findMany({
      where: { date: { gte: yStart, lt: tEnd } },
      select: { date: true, createdBy: { select: { orgUnitId: true } } },
    });

    // 팀별 활성 인원수
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { orgUnitId: true },
    });
    const orgs = await this.prisma.orgUnit.findMany({ select: { id: true, name: true, type: true } });
    const nameById = new Map<string, string>();
    const typeById = new Map<string, string>();
    for (const o of orgs) { nameById.set(o.id, o.name); typeById.set(o.id, String(o.type || '')); }

    type Row = { orgUnitId: string; teamName: string; headcount: number; yesterdayCount: number; todayCount: number };
    const rows = new Map<string, Row>();
    const ensure = (orgUnitId: string | null): Row => {
      const key = orgUnitId || '__none__';
      let r = rows.get(key);
      if (!r) {
        r = { orgUnitId: key, teamName: orgUnitId ? (nameById.get(orgUnitId) || '미지정 팀') : '소속 미지정', headcount: 0, yesterdayCount: 0, todayCount: 0 };
        rows.set(key, r);
      }
      return r;
    };

    for (const u of users) ensure(u.orgUnitId).headcount += 1;
    for (const w of worklogs) {
      const r = ensure(w.createdBy?.orgUnitId ?? null);
      if (w.date.getTime() < todayStart.getTime()) r.yesterdayCount += 1;
      else r.todayCount += 1;
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const teams = Array.from(rows.values())
      // 팀(TEAM)만 대상 — 실(DIVISION)·회사(COMPANY) 등 상위 조직 및 소속 미지정 제외.
      // 단, '에스콘'은 팀 유형이 아니어도 예외로 포함한다.
      .filter((r) => typeById.get(r.orgUnitId) === 'TEAM' || r.teamName.includes('에스콘'))
      // 어제/오늘 업무일지 작성 기록이 있는 팀만
      .filter((r) => r.yesterdayCount > 0 || r.todayCount > 0)
      .map((r) => ({
        orgUnitId: r.orgUnitId,
        teamName: r.teamName,
        headcount: r.headcount,
        yesterdayCount: r.yesterdayCount,
        todayCount: r.todayCount,
        yesterdayPerCapita: r.headcount > 0 ? round1(r.yesterdayCount / r.headcount) : null,
        todayPerCapita: r.headcount > 0 ? round1(r.todayCount / r.headcount) : null,
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName, 'ko'));

    const totals = teams.reduce(
      (acc, t) => {
        acc.headcount += t.headcount;
        acc.yesterdayCount += t.yesterdayCount;
        acc.todayCount += t.todayCount;
        return acc;
      },
      { headcount: 0, yesterdayCount: 0, todayCount: 0 },
    );

    return { yesterday: yesterdayYmd, today: todayYmd, teams, totals };
  }

  /**
   * PATCH /api/worklogs/:id/planner-info
   * Merge Planner/Project sync metadata (breadcrumb, taskId, titles) into structuredData.planner
   */
  @Patch(':id/planner-info')
  async updatePlannerInfo(
    @Param('id') id: string,
    @Body() body: {
      userId: string;
      taskId?: string;
      taskTitle?: string;
      planTitle?: string;
      breadcrumb?: string;
      method?: 'graph' | 'dataverse';
      parents?: Array<{ id: string; subject: string; outlineLevel?: number }>;
      dvTaskId?: string;
      dvProjectId?: string;
    },
  ) {
    const wl = await (this.prisma as any).worklog.findUnique({ where: { id } });
    if (!wl) throw new BadRequestException('Worklog not found');
    if (wl.createdById !== body.userId) throw new BadRequestException('Unauthorized');
    const current = (wl.structuredData as any) || {};
    const next = {
      ...current,
      planner: {
        ...(current.planner || {}),
        taskId: body.taskId,
        taskTitle: body.taskTitle,
        planTitle: body.planTitle,
        breadcrumb: body.breadcrumb,
        method: body.method,
        parents: body.parents,
        dvTaskId: body.dvTaskId,
        dvProjectId: body.dvProjectId,
        syncedAt: new Date().toISOString(),
      },
    };
    await (this.prisma as any).worklog.update({
      where: { id },
      data: { structuredData: next },
    });
    return { ok: true, planner: next.planner };
  }

  private graphTokenCache: { token: string; expMs: number } | null = null;

  private hasGraphConfig(): boolean {
    const tenantId = String(process.env.MS_GRAPH_TENANT_ID || process.env.ENTRA_TENANT_ID || '').trim();
    const clientId = String(process.env.MS_GRAPH_CLIENT_ID || process.env.ENTRA_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.MS_GRAPH_CLIENT_SECRET || process.env.ENTRA_CLIENT_SECRET || '').trim();
    return !!(tenantId && clientId && clientSecret);
  }

  private getGraphConfig() {
    const tenantId = String(process.env.MS_GRAPH_TENANT_ID || process.env.ENTRA_TENANT_ID || '').trim();
    const clientId = String(process.env.MS_GRAPH_CLIENT_ID || process.env.ENTRA_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.MS_GRAPH_CLIENT_SECRET || process.env.ENTRA_CLIENT_SECRET || '').trim();
    if (!tenantId) throw new BadRequestException('MS_GRAPH_TENANT_ID (or ENTRA_TENANT_ID) required');
    if (!clientId) throw new BadRequestException('MS_GRAPH_CLIENT_ID (or ENTRA_CLIENT_ID) required');
    if (!clientSecret) throw new BadRequestException('MS_GRAPH_CLIENT_SECRET (or ENTRA_CLIENT_SECRET) required');
    return { tenantId, clientId, clientSecret };
  }

  private async getGraphToken(): Promise<string> {
    const now = Date.now();
    if (this.graphTokenCache && this.graphTokenCache.expMs > (now + 30_000)) {
      return this.graphTokenCache.token;
    }
    const { tenantId, clientId, clientSecret } = this.getGraphConfig();
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(String(json?.error_description || json?.error || `graph token failed (${res.status})`));
    }
    const token = String(json?.access_token || '').trim();
    const expiresInSec = Number(json?.expires_in || 0) || 0;
    if (!token) throw new BadRequestException('graph token missing access_token');
    this.graphTokenCache = { token, expMs: now + (expiresInSec * 1000) };
    return token;
  }

  private getJwtHint(token: string): string {
    try {
      const parts = String(token || '').split('.');
      if (parts.length < 2) return '';
      let b64 = String(parts[1] || '').replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4;
      if (pad) b64 = b64 + '='.repeat(4 - pad);
      const raw = Buffer.from(b64, 'base64').toString('utf8');
      const j: any = raw ? JSON.parse(raw) : null;
      if (!j) return '';

      const out: string[] = [];
      const aud = String(j?.aud || '').trim();
      const tid = String(j?.tid || '').trim();
      const scp = String(j?.scp || '').trim();
      const rolesArr = Array.isArray(j?.roles) ? j.roles : [];
      const roles = (rolesArr || []).map((r: any) => String(r || '').trim()).filter(Boolean).join(',');

      if (aud) out.push(`aud=${aud}`);
      if (tid) out.push(`tid=${tid}`);
      if (roles) out.push(`roles=${roles}`);
      if (scp) out.push(`scp=${scp}`);
      if (!roles && !scp) out.push('roles/scp=empty');

      return out.length ? out.join(' ') : '';
    } catch {
      return '';
    }
  }

  private getWebBase(): string {
    const configured = String(process.env.WEB_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    return 'http://localhost:5173';
  }

  private async sendGraphMailFromUser(senderUpn: string, toEmail: string, subject: string, contentText: string): Promise<void> {
    if (!this.hasGraphConfig()) throw new BadRequestException('MS_GRAPH_* config required');
    const from = String(senderUpn || '').trim();
    const to = String(toEmail || '').trim();
    if (!from) throw new BadRequestException('mail sender missing');
    if (!to) throw new BadRequestException('mail recipient missing');

    let token = await this.getGraphToken();
    let jwtHint = this.getJwtHint(token);
    let refreshed = false;
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`;
    const body = {
      message: {
        subject,
        body: { contentType: 'Text', content: contentText },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401 && !refreshed && attempt === 0) {
        this.graphTokenCache = null;
        token = await this.getGraphToken();
        jwtHint = this.getJwtHint(token);
        refreshed = true;
        continue;
      }
      if (!res.ok) {
        const ct = String(res.headers.get('content-type') || '');
        const www = String(res.headers.get('www-authenticate') || '').trim();
        const reqId = String(res.headers.get('request-id') || res.headers.get('x-ms-request-id') || '').trim();
        const diag = String(res.headers.get('x-ms-ags-diagnostic') || '').trim();
        const detailParts: string[] = [];
        try {
          const text = await res.text();
          if (ct.includes('application/json')) {
            const j: any = text ? JSON.parse(text) : null;
            const code = String(j?.error?.code || '').trim();
            const msg = String(j?.error?.message || '').trim();
            const parts = [code, msg].filter(Boolean);
            if (parts.length) detailParts.push(parts.join(' - '));
          } else {
            const snippet = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
            if (snippet) detailParts.push(snippet);
          }
        } catch {}
        if (jwtHint) detailParts.push(jwtHint);
        if (reqId) detailParts.push(`request-id=${reqId}`);
        if (diag) detailParts.push(`diag=${diag.replace(/\s+/g, ' ').slice(0, 200)}`);
        if (www) {
          const snippet = www.replace(/\s+/g, ' ').slice(0, 200);
          if (snippet) detailParts.push(snippet);
        }
        const detail = detailParts.length ? `: ${detailParts.join(' | ')}` : '';
        throw new BadRequestException(`graph sendMail failed (${res.status})${detail}`);
      }
      return;
    }
  }

  private async assertCeo(userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: String(userId) } });
    if (!actor) throw new ForbiddenException('only CEO or admin can perform this action');
    const role = String((actor as any).role || '');
    if (role === 'CEO') return;
    // Admin allowlist by email/UPN (env: ADMIN_EMAILS, comma-separated)
    const defaultAdmins = ['json@cams2002.onmicrosoft.com'];
    const envAdmins = String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const admins = new Set([...defaultAdmins.map((s) => s.toLowerCase()), ...envAdmins]);
    const email = String((actor as any).email || '').toLowerCase();
    const upn = String((actor as any).teamsUpn || '').toLowerCase();
    if (admins.has(email) || admins.has(upn)) return;
    throw new ForbiddenException('only CEO or admin can perform this action');
  }

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
        keywords: dto.keywords || undefined,
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
          payload: { requestId: req.id, requestedById: dto.createdById },
        },
      });
    }

    // 4) Optional: Share
    const shares: string[] = [];
    const watcherIdsForShare = dto.share?.watcherIds || [];
    const shareScope = (dto.share?.scope as any) ?? 'READ';
    if (watcherIdsForShare.length) {
      for (const watcherId of watcherIdsForShare) {
        const share = await this.prisma.share.create({
          data: {
            subjectType: 'Worklog',
            subjectId: wl.id,
            watcherId,
            scope: shareScope,
          },
        });
        shares.push(share.id);
        await this.prisma.event.create({
          data: {
            subjectType: 'Worklog',
            subjectId: wl.id,
            activity: 'Shared',
            userId: dto.createdById,
            attrs: { watcherId, scope: shareScope },
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

    const externalEmailsRaw = dto.share?.externalRecipientEmails || [];
    const externalEmails = Array.from(
      new Map(
        externalEmailsRaw
          .map((e) => String(e || '').trim())
          .map((e): [string, string] => [e.toLowerCase(), e])
          .filter(([k]) => !!k),
      ).values(),
    );
    if (externalEmails.length) {
      const sender = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
      const senderUpn = String(process.env.MS_GRAPH_MAIL_SENDER_UPN || (sender as any)?.teamsUpn || sender?.email || '').trim();
      if (!senderUpn) throw new BadRequestException('mail sender missing');

      const initiative = await this.prisma.initiative.findUnique({ where: { id: initiativeIdFinal }, select: { title: true } });
      const initTitle = String((initiative as any)?.title || '').trim();
      const worklogUrl = `${this.getWebBase()}/worklogs/${encodeURIComponent(wl.id)}`;

      const noteRaw = String((wl as any)?.note || '').trim();
      const noteSnippet = noteRaw.length > 800 ? `${noteRaw.slice(0, 800)}...` : noteRaw;
      const subject = `업무일지 공유${initTitle ? `: ${initTitle}` : ''}`;
      const contentText = [
        '업무일지가 공유되었습니다.',
        initTitle ? `제목: ${initTitle}` : null,
        (sender as any)?.name ? `작성자: ${(sender as any).name}` : null,
        `링크: ${worklogUrl}`,
        noteSnippet ? `\n내용:\n${noteSnippet}` : null,
      ].filter(Boolean).join('\n');

      for (const email of externalEmails) {
        await this.sendGraphMailFromUser(senderUpn, email, subject, contentText);
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
        // Ensure team & OKR scaffolding exists.
        // Use the user's EXISTING team when available. Only fall back to
        // dto.teamName if the user has no team yet. NEVER create new OrgUnits
        // here — team management is an admin function.
        let team: any = null;
        if (user.orgUnitId) {
          team = await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } });
        }
        if (!team) {
          // Try to find existing team by teamName; only create if truly none exists
          if (dto.teamName) {
            team = await this.prisma.orgUnit.findFirst({ where: { name: dto.teamName, type: 'TEAM' } });
          }
          if (!team) {
            const safeName = String(dto.teamName || `Auto-${user.id.slice(0, 8)}`).trim();
            team = await this.prisma.orgUnit.create({ data: { name: safeName, type: 'TEAM' } });
          }
          user = await this.prisma.user.update({ where: { id: dto.userId }, data: { orgUnitId: team.id } });
        }
        if (team) {
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
    if (!initiativeId) throw new BadRequestException('initiativeId 해결 실패: 팀/과제 설정을 확인하세요');
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
        structuredData: (dto as any).structuredData ?? undefined,
        date: dateValSimple,
        urgent: !!dto.urgent,
        visibility: (dto.visibility as any) ?? 'ALL',
        keywords: (dto as any).keywords || undefined,
      },
    });
    await this.prisma.event.create({ data: { subjectType: 'Worklog', subjectId: wl.id, activity: 'WorklogCreated', userId: user.id, attrs: { simple: true } } });
    return { id: wl.id, initiativeId };
  }

  /**
   * POST /api/worklogs/webhook
   * Power Automate / 외부 시스템에서 업무일지를 자동 생성하는 웹훅 엔드포인트
   * 사용자는 email로 찾고, 팀/과제는 자동 생성
   */
  @Post('webhook')
  async createFromWebhook(@Body() dto: WebhookWorklogDto) {
    // 간단한 API 키 검증 (환경변수에서 설정 가능)
    const expectedKey = process.env.WORKLOG_WEBHOOK_API_KEY || '';
    if (expectedKey && dto.apiKey !== expectedKey) {
      throw new ForbiddenException('Invalid API key');
    }

    // 이메일로 사용자 찾기
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) {
      throw new BadRequestException(`User not found with email: ${dto.email}`);
    }

    // 팀 확인/생성
    let team: any = null;
    if (user.orgUnitId) {
      team = await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } });
    }
    if (!team) {
      const teamName = dto.department || `Auto-${user.id.slice(0, 8)}`;
      team = await this.prisma.orgUnit.findFirst({ where: { name: teamName, type: 'TEAM' } });
      if (!team) {
        team = await this.prisma.orgUnit.create({ data: { name: teamName, type: 'TEAM' } });
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { orgUnitId: team.id } });
    }

    // OKR 구조 자동 생성
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

    // Initiative (과제) 생성/재사용
    const taskName = dto.source ? `[${dto.source}] 자동 업무` : '자동 업무';
    let initiative = await this.prisma.initiative.findFirst({ where: { title: taskName, keyResultId: kr.id, ownerId: user.id } });
    if (!initiative) {
      initiative = await this.prisma.initiative.create({ data: { title: taskName, keyResultId: kr.id, ownerId: user.id, state: 'ACTIVE' as any } });
    }

    // 날짜 파싱
    let dateVal: Date;
    if (dto.date) {
      const s = String(dto.date);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        dateVal = new Date(`${s}T00:00:00+09:00`);
      } else {
        dateVal = new Date(s);
      }
      if (isNaN(dateVal.getTime())) {
        const now = new Date();
        const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        dateVal = new Date(`${kst.toISOString().slice(0, 10)}T00:00:00+09:00`);
      }
    } else {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      dateVal = new Date(`${kst.toISOString().slice(0, 10)}T00:00:00+09:00`);
    }

    // 내용 조합
    const contentParts = [dto.content, dto.notes].filter(Boolean);
    const fullContent = contentParts.join('\n\n---\n\n');
    const note = `${dto.title}\n\n${fullContent}`;

    // 업무일지 생성
    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiative.id,
        createdById: user.id,
        note,
        timeSpentMinutes: dto.timeSpentMinutes ?? 0,
        date: dateVal,
        visibility: (dto.visibility as any) ?? 'ALL',
        structuredData: dto.source ? { source: dto.source, webhook: true } : { webhook: true },
      },
    });

    await this.prisma.event.create({
      data: { subjectType: 'Worklog', subjectId: wl.id, activity: 'WorklogCreated', userId: user.id, attrs: { webhook: true, source: dto.source } },
    });

    return { success: true, worklogId: wl.id, userId: user.id, date: dateVal.toISOString() };
  }

  /**
   * Get all descendant org unit IDs for a given parent team name.
   * Used for hierarchical filtering when selecting parent teams.
   */
  private async getDescendantOrgUnitIds(parentTeamName: string): Promise<Set<string>> {
    const parent = await this.prisma.orgUnit.findFirst({
      where: { name: parentTeamName },
      select: { id: true },
    });
    if (!parent) return new Set();

    const all = await this.prisma.orgUnit.findMany({
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    });
    const units = (all || []).filter((u: any) => !/^personal\s*-/i.test(String(u.name || '')));

    const children = new Map<string | null, Array<{ id: string; name: string }>>();
    for (const u of units) {
      const k = (u as any).parentId || null;
      if (!children.has(k)) children.set(k, []);
      children.get(k)!.push({ id: String((u as any).id), name: String((u as any).name) });
    }

    const ids = new Set<string>();
    ids.add(String(parent.id));

    const stack = [String(parent.id)];
    while (stack.length) {
      const curId = stack.pop()!;
      const kids = children.get(curId) || [];
      for (const k of kids) {
        if (!ids.has(k.id)) {
          ids.add(k.id);
          stack.push(k.id);
        }
      }
    }

    return ids;
  }

  @Get('search')
  async search(
    @Query('dept') deptName?: string,
    @Query('team') teamName?: string,
    @Query('user') userName?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('offset') offsetStr?: string,
    @Query('withTotal') withTotalStr?: string,
    @Query('kind') kind?: 'OKR' | 'KPI',
    @Query('krId') krId?: string,
    @Query('initiativeId') initiativeId?: string,
    @Query('urgent') urgentStr?: string,
    @Query('viewerId') viewerId?: string,
    @Query('tag') tagFilter?: string,
    @Query('includeApprovalDocs') includeApprovalDocsStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '20', 10) || 20, 100);
    const includeApprovalDocs = (() => {
      const v = String(includeApprovalDocsStr || '').toLowerCase();
      return v === '1' || v === 'true';
    })();
    const offsetNum = Math.max(0, parseInt(offsetStr || '0', 10) || 0);
    const useOffset = !cursor && offsetNum > 0;
    const wantTotal = (() => {
      const v = String(withTotalStr || '').toLowerCase();
      return v === '1' || v === 'true';
    })();
    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) (where.date as any).gte = new Date(from);
      if (to) (where.date as any).lte = new Date(to);
    }
    if (q) {
      where.AND = [
        ...(where.AND || []),
        { OR: [
          { note: { contains: q, mode: 'insensitive' as any } },
          { keywords: { contains: q, mode: 'insensitive' as any } },
        ] },
      ];
    }
    // 실(부서) 필터: 하위 팀 모두 포함
    const hierarchicalDepts = ['경영관리실', '연구개발실', '생산실', '함평공장', '품질경영실'];
    if (deptName && hierarchicalDepts.includes(deptName)) {
      const descendantIds = await this.getDescendantOrgUnitIds(deptName);
      if (descendantIds.size > 0) {
        where.createdBy = { orgUnitId: { in: Array.from(descendantIds) } };
      } else {
        where.createdBy = { orgUnit: { name: deptName } };
      }
    }
    // 팀 필터: 특정 팀만 (실 필터보다 우선)
    if (teamName) {
      where.createdBy = { orgUnit: { name: teamName } };
    }
    if (userName) where.createdBy = { ...(where.createdBy || {}), name: { contains: userName, mode: 'insensitive' as any } };
    if (tagFilter) {
      where.tags = { path: ['hashTags'], array_contains: [tagFilter] };
    }
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

    // NOTE: We previously tried to filter approval-doc worklogs at
    // the DB level via `NOT: { structuredData: { path: ['kind'],
    // equals: 'APPROVAL_DOC' } }`. That breaks for the (vast) set of
    // legacy rows whose `structuredData` is NULL: in Postgres,
    // `NOT (jsonb_path_query(NULL, ...) = 'X')` evaluates to NULL,
    // which excludes the row from the WHERE result. The whole list
    // ended up empty. We now apply this exclusion in JS after the
    // fetch instead.
    const finalWhere = {
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
    };

    // Fetch a wider page than `limit` so we still have `limit`-many
    // rows after filtering out approval-doc worklogs in JS. The factor
    // 3 is empirical: in practice approval docs are << 1/3 of the feed.
    const fetchTake = includeApprovalDocs ? limit : limit * 3;
    const [itemsRaw, total] = await Promise.all([
      this.prisma.worklog.findMany({
        where: finalWhere,
        take: fetchTake,
        skip: cursor ? 1 : useOffset ? offsetNum : 0,
        ...(cursor ? { cursor: { id: cursor } } : {}),
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        include: { createdBy: { include: { orgUnit: true } }, initiative: true },
      }),
      wantTotal ? this.prisma.worklog.count({ where: finalWhere }) : Promise.resolve(undefined),
    ]);
    const items = (includeApprovalDocs
      ? itemsRaw
      : itemsRaw.filter((it: any) => {
          const sd = (it as any).structuredData;
          return !(sd && typeof sd === 'object' && (sd as any).kind === 'APPROVAL_DOC');
        })
    ).slice(0, limit);
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
        kbBadge: (it as any).kbBadge ?? false,
        kbBadgeNote: (it as any).kbBadgeNote ?? undefined,
        structuredData: (it as any).structuredData ?? undefined,
        tags: (it as any).tags ?? undefined,
        keywords: (it as any).keywords ?? undefined,
      };
    });
    return { items: mapped, nextCursor, ...(wantTotal ? { total } : {}) };
  }

  /** 작성자의 누적 지식 인증 횟수 (배지 인장에 표시) */
  @Get('kb-count')
  async kbCount(@Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) return { count: 0 };
    const count = await (this.prisma as any).worklog.count({ where: { createdById: uid, kbBadge: true } });
    return { count };
  }

  /** 지식 정리 랭킹 — 월별(기본 이번 달, month=all 전체) 배지 수 상위 구성원 */
  @Get('kb-ranking')
  async kbRanking(@Query('month') month?: string) {
    const isAll = month === 'all';
    let range: { gte: Date; lt: Date } | null = null;
    if (!isAll) {
      const now = new Date();
      const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [y, mo] = m.split('-').map(Number);
      const nextM = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
      range = { gte: new Date(`${m}-01T00:00:00+09:00`), lt: new Date(`${nextM}-01T00:00:00+09:00`) };
    }
    const badgeWhere: any = { kbBadge: true, ...(range ? { date: range } : {}) };
    const badges = await (this.prisma as any).worklog.groupBy({ by: ['createdById'], where: badgeWhere, _count: { _all: true } });
    const totals = await (this.prisma as any).worklog.groupBy({ by: ['createdById'], where: range ? { date: range } : {}, _count: { _all: true } });
    const totalMap = new Map(totals.map((t: any) => [String(t.createdById), t._count._all]));
    const userIds = badges.map((b: any) => String(b.createdById));
    const users = userIds.length
      ? await (this.prisma as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, orgUnit: { select: { name: true } } } })
      : [];
    const uMap = new Map(users.map((u: any) => [String(u.id), u]));
    const items = badges
      .map((b: any) => {
        const u: any = uMap.get(String(b.createdById));
        return {
          userId: b.createdById,
          name: u?.name || '(알 수 없음)',
          teamName: u?.orgUnit?.name || '',
          badgeCount: b._count._all,
          worklogCount: totalMap.get(String(b.createdById)) || 0,
        };
      })
      .sort((a: any, b: any) => b.badgeCount - a.badgeCount)
      .slice(0, 50);
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Query('viewerId') viewerId?: string) {
    const wl = await (this.prisma as any).worklog.findUnique({
      where: { id },
      include: {
        initiative: { include: { keyResult: { include: { objective: true } } } },
        createdBy: { include: { orgUnit: true } },
      },
    });
    if (!wl) return null;
    // 공개 범위 검사: 제한된 일지는 열람 권한이 있어야 반환. (작성자/역할 통과 외에 이 일지의 결재자도 허용)
    if (String(wl.visibility || 'ALL').toUpperCase() !== 'ALL') {
      const viewer = viewerId
        ? await (this.prisma as any).user.findUnique({ where: { id: String(viewerId) }, select: { id: true, role: true } })
        : null;
      let allowed = canViewWorklog(viewer, wl);
      if (!allowed && viewerId) {
        // 결재 대상 일지라면 결재자(단계 포함)에게는 열람 허용
        const appr = await (this.prisma as any).approvalRequest.findFirst({
          where: {
            subjectType: 'Worklog', subjectId: id,
            OR: [{ approverId: String(viewerId) }, { steps: { some: { approverId: String(viewerId) } } }],
          },
          select: { id: true },
        });
        allowed = !!appr;
      }
      if (!allowed) throw new ForbiddenException('이 업무일지를 열람할 권한이 없습니다');
    }
    const task = await (this.prisma as any).processTaskInstance.findFirst({ where: { worklogId: id }, include: { instance: true } });
    const process = task
      ? {
          instance: { id: task.instanceId, title: (task as any).instance?.title || '' },
          task: { id: task.id, name: task.name },
        }
      : null;
    return { ...wl, process } as any;
  }

  @Get(':id/supplements')
  async getSupplements(@Param('id') id: string) {
    const items = await (this.prisma as any).worklogSupplement.findMany({
      where: { worklogId: id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
    return { items };
  }

  /**
   * 업무일지 작성 직후 AI 보완 질문 — 더 충실한 일지를 위해 빠진 것만 최대 3개 묻는다.
   * (결과/수치, 문제·배운 점, 다음 계획 관점) 답변은 보충 기록(supplement)으로 저장된다.
   * AI 실패 시 빈 배열 반환 — 작성 흐름을 절대 막지 않는다.
   */
  @Post(':id/ai/questions')
  async aiFollowupQuestions(@Param('id') id: string, @Body() body: { userId?: string }) {
    const uid = String(body?.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const wl = await (this.prisma as any).worklog.findUnique({
      where: { id },
      select: { id: true, note: true, structuredData: true, createdById: true },
    });
    if (!wl) throw new BadRequestException('worklog not found');
    if (wl.createdById !== uid) throw new ForbiddenException('본인의 업무일지에만 사용할 수 있습니다');

    const text = String(wl.note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
    if (text.length < 10) return { questions: [] };

    const sys = `당신은 업무일지를 "회사의 재사용 가능한 지식"으로 체계화하도록 돕는 코치입니다. 반드시 JSON만 출력하세요.
대부분의 일지는 표면적인 처리 결과 나열에 그칩니다. 아래 일지를 읽고, 지식이 되도록 다음 관점 중 "빠져 있는 것만" 골라 최대 3개 질문하세요:

1. 원인: 문제/불량/지연이 언급됐다면 — 근본 원인이 무엇이었는지
2. 재발방지: 같은 문제가 다시 생기지 않게 무엇을 바꿨는지(또는 바꿔야 하는지)
3. 지식 체계화: 이 경험에서 "다른 사람이 같은 일을 할 때 알아야 할" 노하우·기준·절차가 있는지 (예: 판단 기준 수치, 주의할 함정, 더 빠른 방법)

규칙:
- 이미 일지에 적혀 있는 내용은 절대 묻지 마세요.
- 문제/이슈 언급이 전혀 없는 단순 일지라면 3번(지식 체계화) 관점만 1개 물으세요.
- 한두 문장으로 바로 답할 수 있게 구체적으로 물으세요.
- 물을 것이 없으면 빈 배열을 반환하세요. 억지로 만들지 마세요.

출력 JSON: { "questions": [{ "id": number, "question": string }] }`;

    try {
      const result = await callAI({
        system: sys,
        user: `[업무일지]\n${text}`,
        model: 'claude',
        temperature: 0.3,
        maxTokens: 800,
        jsonSchema: {
          name: 'worklog_questions',
          schema: {
            type: 'object' as const,
            properties: {
              questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' }, question: { type: 'string' } }, required: ['id', 'question'] } },
            },
            required: ['questions'],
          },
        },
      });
      const questions = (Array.isArray(result?.parsed?.questions) ? result.parsed.questions : [])
        .map((q: any, i: number) => ({ id: typeof q?.id === 'number' ? q.id : i + 1, question: String(q?.question || '').trim() }))
        .filter((q: any) => q.question)
        .slice(0, 3);
      return { questions };
    } catch {
      return { questions: [] }; // AI 실패는 조용히 — 작성 흐름 유지
    }
  }

  /**
   * 지식 배지 판정 — 일지 본문 + 보충 문답을 보고 "다른 구성원이 재사용할 수 있는
   * 업무 지식"이 정리됐는지 엄격 판정. 합격 시 kbBadge 부여(+칭찬 한 줄).
   * 배지는 한 번 받으면 유지(재판정으로 회수하지 않음).
   */
  @Post(':id/ai/kb-review')
  async aiKbReview(@Param('id') id: string, @Body() body: { userId?: string }) {
    const uid = String(body?.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const wl = await (this.prisma as any).worklog.findUnique({
      where: { id },
      select: { id: true, note: true, createdById: true, kbBadge: true, kbBadgeNote: true },
    });
    if (!wl) throw new BadRequestException('worklog not found');
    if (wl.createdById !== uid) throw new ForbiddenException('본인의 업무일지에만 사용할 수 있습니다');
    if (wl.kbBadge) return { awarded: true, reason: wl.kbBadgeNote || '', already: true };

    const sups = await (this.prisma as any).worklogSupplement.findMany({
      where: { worklogId: id }, orderBy: { createdAt: 'asc' }, select: { content: true },
    });
    const strip = (s: string) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const text = [strip(wl.note || ''), ...sups.map((s: any) => strip(s.content || ''))].filter(Boolean).join('\n\n').slice(0, 8000);
    if (text.length < 30) return { awarded: false, reason: '' };

    const sys = `당신은 구성원의 기록 문화를 키우는 격려형 심사관입니다. 반드시 JSON만 출력하세요.
아래 업무일지(보충 문답 포함)에 "다른 구성원에게 도움이 될 만한 내용"이 담겨 있는지 너그럽게 판정하세요.

합격 기준 (하나라도 '시도'가 보이면 합격 — 완벽하지 않아도 됩니다):
- 문제의 원인을 짚으려 한 흔적
- 재발방지·개선을 위해 무엇을 했는지(하려는지)
- 다른 사람에게 도움될 노하우·기준·팁·주의점
- 구체적인 수치나 과정 설명이 담긴 성실한 기록

불합격 (이 경우만): 한두 줄짜리 "완료했습니다"식 나열, 내용이 거의 없는 형식적 기록.
애매하면 합격시키고 격려하세요.

출력 JSON: { "awarded": boolean, "reason": string }
- awarded=true면 reason에 어떤 점이 좋은 기록인지 한 문장 칭찬
- awarded=false면 reason은 빈 문자열`;

    try {
      const result = await callAI({
        system: sys,
        user: `[업무일지 + 보충 문답]\n${text}`,
        model: 'claude',
        temperature: 0.2,
        maxTokens: 500,
        jsonSchema: {
          name: 'kb_review',
          schema: {
            type: 'object' as const,
            properties: { awarded: { type: 'boolean' }, reason: { type: 'string' } },
            required: ['awarded', 'reason'],
          },
        },
      });
      const awarded = !!result?.parsed?.awarded;
      const reason = String(result?.parsed?.reason || '').trim().slice(0, 300);
      if (awarded) {
        await (this.prisma as any).worklog.update({ where: { id }, data: { kbBadge: true, kbBadgeNote: reason || null } });
        await (this.prisma as any).event.create({
          data: { subjectType: 'Worklog', subjectId: id, activity: 'KnowledgeBadgeAwarded', userId: uid, attrs: { reason } },
        }).catch(() => {});
      }
      return { awarded, reason };
    } catch {
      return { awarded: false, reason: '' }; // AI 실패는 조용히
    }
  }

  @Post(':id/supplements')
  async createSupplement(
    @Param('id') id: string,
    @Body() body: { userId: string; content?: string; attachments?: any },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');
    const wl = await (this.prisma as any).worklog.findUnique({ where: { id } });
    if (!wl) throw new BadRequestException('worklog not found');
    if (wl.createdById !== body.userId) throw new ForbiddenException('본인의 업무일지에만 수정보완을 작성할 수 있습니다');
    if (!body.content?.trim() && !body.attachments) throw new BadRequestException('내용 또는 첨부파일이 필요합니다');
    const item = await (this.prisma as any).worklogSupplement.create({
      data: {
        worklogId: id,
        userId: body.userId,
        content: body.content?.trim() || null,
        attachments: body.attachments || null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    return item;
  }

  @Post('bulk-delete')
  async bulkDeleteWorklogs(@Body() body: { ids: string[] }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (!ids.length) throw new BadRequestException('ids required');
    let deleted = 0;
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        const r = await this.deleteWorklog(id, userId);
        if ((r as any)?.deleted) deleted += 1;
      } catch (e: any) {
        failed.push({ id, error: e?.message || String(e) });
      }
    }
    return { ok: true, requested: ids.length, deleted, failed };
  }

  @Post(':id/delete')
  async deleteWorklog(@Param('id') id: string, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    return this.prisma.$transaction(async (tx) => {
      const wl = await (tx as any).worklog.findUnique({ where: { id } });
      if (!wl) return { ok: true, deleted: false };

      const parsePreds = (s: any): string[] =>
        String(s || '')
          .split(',')
          .map((x) => String(x || '').trim())
          .filter(Boolean);

      await (tx as any).progressEntry.deleteMany({ where: { worklogId: id } });
      await (tx as any).feedback.deleteMany({ where: { subjectType: 'Worklog', subjectId: id } });
      await (tx as any).share.deleteMany({ where: { subjectType: 'Worklog', subjectId: id } });
      await (tx as any).notification.deleteMany({ where: { subjectType: 'Worklog', subjectId: id } });
      await (tx as any).event.deleteMany({ where: { subjectType: 'Worklog', subjectId: id } });

      const legacyTask = await (tx as any).processTaskInstance.findFirst({ where: { worklogId: id } });
      const linkedTask = wl.processTaskInstanceId
        ? await (tx as any).processTaskInstance.findUnique({ where: { id: String(wl.processTaskInstanceId) } })
        : null;
      const completionTask = legacyTask || linkedTask;

      if (completionTask && String(completionTask.instanceId || '') && String(completionTask.taskTemplateId || '')) {
        const isCompleted = String(completionTask.status || '').toUpperCase() === 'COMPLETED';
        const directWorklogMatch = String(completionTask.worklogId || '') === String(id);
        let implicitWorklogMatch = false;
        if (!completionTask.worklogId && String(wl.processTaskInstanceId || '') === String(completionTask.id)) {
          const others = await (tx as any).worklog.count({
            where: { processTaskInstanceId: String(completionTask.id), id: { not: String(id) } },
          });
          implicitWorklogMatch = (others || 0) === 0;
        }
        const isCompletionWorklog = directWorklogMatch || implicitWorklogMatch;

        if (isCompleted && isCompletionWorklog) {
          const instanceId = String(completionTask.instanceId);
          const taskTemplateId = String(completionTask.taskTemplateId);

          const tmpl = await (tx as any).processTaskTemplate.findUnique({ where: { id: taskTemplateId } });
          const processTemplateId = String((tmpl as any)?.processTemplateId || '');
          if (processTemplateId) {
            const all = await (tx as any).processTaskTemplate.findMany({ where: { processTemplateId } });
            const directDownstream = (all || []).filter((t: any) => parsePreds(t.predecessorIds).includes(taskTemplateId));
            const downstreamTemplateIds = directDownstream.map((t: any) => String(t.id));

            if (downstreamTemplateIds.length) {
              const progressed = await (tx as any).processTaskInstance.findFirst({
                where: {
                  instanceId,
                  taskTemplateId: { in: downstreamTemplateIds },
                  status: { in: ['IN_PROGRESS', 'COMPLETED', 'SKIPPED'] },
                },
                select: { id: true },
              });
              if (progressed) throw new BadRequestException('하위 단계가 진행되어 삭제할 수 없습니다');
            }

            const chainProgressed = await (tx as any).processTaskInstance.findFirst({
              where: {
                instanceId,
                taskTemplateId,
                id: { not: String(completionTask.id) },
                status: { in: ['IN_PROGRESS', 'COMPLETED'] },
              },
              select: { id: true },
            });
            if (chainProgressed) throw new BadRequestException('하위 단계가 진행되어 삭제할 수 없습니다');

            await (tx as any).processTaskInstance.update({
              where: { id: String(completionTask.id) },
              data: {
                status: 'NOT_STARTED',
                actualStartAt: null,
                actualEndAt: null,
                worklogId: null,
                cooperationId: null,
                approvalRequestId: null,
                decidedById: String(userId || ''),
                decisionReason: 'worklog deleted',
              },
            });

            const inst = await (tx as any).processInstance.findUnique({ where: { id: instanceId }, select: { status: true } });
            if (String((inst as any)?.status || '').toUpperCase() === 'COMPLETED') {
              await (tx as any).processInstance.update({ where: { id: instanceId }, data: { status: 'ACTIVE', endAt: null } });
            }

            for (const dt of directDownstream) {
              const preds = parsePreds((dt as any).predecessorIds);
              if (!preds.length) continue;
              const predInstances = await (tx as any).processTaskInstance.findMany({
                where: { instanceId, taskTemplateId: { in: preds } },
                select: { taskTemplateId: true, status: true },
              });
              const mode = String((dt as any).predecessorMode || '').toUpperCase();
              let ok = true;
              if (mode === 'ANY') {
                ok = predInstances.some((pi: any) => String(pi.status).toUpperCase() === 'COMPLETED');
              } else {
                if (predInstances.length < preds.length) ok = false;
                else {
                  ok = predInstances.every((pi: any) => {
                    const s = String(pi.status).toUpperCase();
                    return s === 'COMPLETED' || s === 'SKIPPED';
                  });
                }
              }
              if (!ok) {
                await (tx as any).processTaskInstance.updateMany({
                  where: { instanceId, taskTemplateId: String(dt.id), status: 'READY' },
                  data: { status: 'NOT_STARTED', actualStartAt: null, actualEndAt: null },
                });
              }
            }

            await (tx as any).processTaskInstance.updateMany({
              where: { instanceId, taskTemplateId, status: 'READY' },
              data: { status: 'CHAIN_WAIT', actualStartAt: null, actualEndAt: null },
            });
          }
        }
      }

      await (tx as any).processTaskInstance.updateMany({ where: { worklogId: id }, data: { worklogId: null } });

      await (tx as any).worklog.delete({ where: { id } });
      return { ok: true, deleted: true };
    });
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
      // Hierarchical team filtering: when filtering by parent teams, include all descendants
      const hierarchicalTeams = ['생산실', '품질경영실', '경영관리실', '함평공장', '연구개발실'];
      if (teamName && hierarchicalTeams.includes(teamName)) {
        const descendantIds = await this.getDescendantOrgUnitIds(teamName);
        if (descendantIds.size > 0) {
          userWhere.orgUnitId = { in: Array.from(descendantIds) };
        } else {
          userWhere.orgUnit = { name: teamName };
        }
      } else if (teamName) {
        userWhere.orgUnit = { name: teamName };
      }
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
      // Hierarchical team filtering: when filtering by parent teams, include all descendants
      const hierarchicalTeams = ['생산실', '품질경영실', '경영관리실', '함평공장', '연구개발실'];
      if (teamName && hierarchicalTeams.includes(teamName)) {
        const descendantIds = await this.getDescendantOrgUnitIds(teamName);
        if (descendantIds.size > 0) {
          userWhere.orgUnitId = { in: Array.from(descendantIds) };
        } else {
          userWhere.orgUnit = { name: teamName };
        }
      } else if (teamName) {
        userWhere.orgUnit = { name: teamName };
      }
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
    // Hierarchical team filtering: when filtering by parent teams, include all descendants
    const hierarchicalTeams = ['생산실', '품질경영실', '경영관리실', '함평공장', '연구개발실'];
    if (teamName && hierarchicalTeams.includes(teamName)) {
      const descendantIds = await this.getDescendantOrgUnitIds(teamName);
      if (descendantIds.size > 0) {
        createdByWhere.orgUnitId = { in: Array.from(descendantIds) };
      } else {
        createdByWhere.orgUnit = { name: teamName };
      }
    } else if (teamName) {
      createdByWhere.orgUnit = { name: teamName };
    }
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

    // See the comment in `search()` — the JSON-path NOT filter empties
    // the list when `structuredData` is NULL on legacy rows. Filter
    // approval-doc worklogs out in JS after fetch instead.
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
    const itemsRaw = await (this.prisma as any).worklog.findMany({
      where,
      include: { createdBy: { include: { orgUnit: true } } },
      orderBy: { date: 'desc' },
      take: 1000,
    });
    const items = itemsRaw.filter((it: any) => {
      const sd = it?.structuredData;
      return !(sd && typeof sd === 'object' && (sd as any).kind === 'APPROVAL_DOC');
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

    // Build an explicit scope description so the LLM reports ONLY the
    // filtered subset. Without this, the prompt's "각 팀에 대해 / 각 구성원에 대해"
    // boilerplate makes the model write as if every team/member existed.
    const filterTeam = String(teamName || '').trim();
    const filterUser = String(userName || '').trim();
    const teamsInData = Array.from(byTeamUser.keys());
    const usersInData: string[] = [];
    for (const inner of byTeamUser.values()) for (const u of inner.keys()) usersInData.push(u);
    const scopeBits: string[] = [];
    if (filterTeam) scopeBits.push(`팀=${filterTeam}`);
    if (filterUser) scopeBits.push(`구성원=${filterUser}`);
    const scopeLabel = scopeBits.length ? scopeBits.join(', ') : '전체';
    const isSingleTeam = filterTeam || teamsInData.length === 1;
    const isSingleUser = !!filterUser || usersInData.length === 1;
    const dataIsEmpty = teamsInData.length === 0;

    const teamSectionRule = isSingleTeam
      ? `- **단일 팀(${filterTeam || teamsInData[0] || '대상 팀'})만 분석합니다.** 다른 팀은 데이터에 없으므로 절대 언급하지 마세요.`
      : `- 데이터에 등장한 팀(${teamsInData.join(', ') || '없음'})만 분석합니다. 그 외 팀은 언급 금지.`;
    const userSectionRule = isSingleUser
      ? `- **단일 구성원(${filterUser || usersInData[0] || '대상 구성원'})만 평가합니다.** 다른 사람은 절대 언급하지 마세요.`
      : `- 데이터에 등장한 구성원(${usersInData.slice(0, 20).join(', ') || '없음'})만 평가합니다. 그 외 사람은 언급 금지.`;

    const sys = `당신은 제조업(사출/도장/조립) 회사의 **경영진** 관점에서 업무를 분석·평가하는 경영 보좌 AI입니다.

## 분석 범위 (반드시 준수)
- 적용된 필터: **${scopeLabel}**
- 아래 [업무일지 데이터] 에 등장한 팀/구성원만 다룹니다. 데이터에 없는 팀이나 사람은 절대 언급하거나 추정하지 마세요.
${teamSectionRule}
${userSectionRule}
- 데이터가 비어있다면 "해당 범위에 업무일지 데이터가 없습니다" 라고만 답하고, 일반론을 만들지 마세요.

## 역할
- 단순 취합/정리가 아니라, 경영진이 해당 팀과 구성원의 업무를 **검토·평가**하는 시각으로 작성하세요.
- 업무 기여도, 업무량, 집중도, 지연 리스크를 평가하세요.
- 긍정적 성과는 인정하되, 개선이 필요한 부분은 구체적 **개선 지침(Directive)** 으로 제시하세요.

## 출력 형식
### 📊 종합 경영 평가
- 분석 대상(${scopeLabel})의 상태를 2~3문장으로 평가
${isSingleTeam ? '' : `
### 📋 팀별 분석
데이터에 등장한 팀에 대해서만:
- **[팀명]**
  - 평가: (잘한 점 / 부족한 점)
  - 주요 성과:
  - 우려 사항:
  - 개선 지침:`}
${isSingleUser ? `
### 👤 구성원 평가
- **[이름]${filterTeam ? ` (${filterTeam})` : ''}**
  - 업무량/기여도: (상/중/하)
  - 핵심 업무:
  - 평가 코멘트:` : `
### 👤 구성원별 평가
데이터에 등장한 구성원에 대해서만:
- **[이름] ([팀명])**
  - 업무량/기여도: (상/중/하)
  - 핵심 업무:
  - 평가 코멘트:`}

### ⚠️ 리스크 및 주의사항
- 지연/병목/의존성 리스크

### 📌 경영진 개선 지침
- 분석 대상 범위에서 개선해야 할 사항을 구체적 지시 형태로 작성

## 규칙
- 넘겨받은 텍스트에 없는 추정은 하지 마세요.
- 업무일지가 부실하거나 누락된 구성원이 있으면 해당 사실을 지적하세요.
- 평가는 공정하고 건설적으로, 지침은 실행 가능하게 작성하세요.`;

    const user = `기간: ${kstYmd(from)} ~ ${kstYmd(to)} (총 ${days}일)\n적용된 필터: ${scopeLabel}\n\n경영진 관점에서 위 범위의 업무를 분석·평가해 주세요. 위 범위 밖의 팀/구성원은 절대 언급하지 마세요.\n\n${q ? `[경영진 추가 질의]\n${q}\n\n이 질의에 대해 별도 섹션에서 상세히 답변해 주세요.\n\n` : ''}${statusContext ? `[현재 진행 현황]\n${statusContext}\n\n` : ''}${evaluationContext ? `[업무 평가(팀장/임원)]\n${evaluationContext}\n\n` : ''}[업무일지 데이터]${dataIsEmpty ? '\n(해당 범위에 업무일지 데이터가 없습니다)' : `\n${context}`}`;
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
        model: 'gpt-4.1',
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

    // Persist into shared CompanyDataChat history so that other users can
    // browse/expand past worklog AI analyses on the 업무일지 AI 분석 page.
    let chatId: string | null = null;
    if (summary) {
      const filterParts: string[] = [];
      if (filterTeam) filterParts.push(`팀=${filterTeam}`);
      if (filterUser) filterParts.push(`구성원=${filterUser}`);
      const periodLabel = `${kstYmd(from)} ~ ${kstYmd(to)}`;
      const filterLabel = filterParts.length ? filterParts.join(', ') : '전체';
      const userQ = String(question || '').trim();
      const qHeader = `[업무일지 AI 분석] ${periodLabel} | ${filterLabel}${userQ ? ` | 추가질의: ${userQ}` : ''}`;
      try {
        const chat = await (this.prisma as any).companyDataChat.create({
          data: {
            userId: viewerId,
            question: qHeader,
            answer: summary,
            dataIds: [],
            source: 'worklog-ai-summary',
          },
        });
        chatId = String(chat?.id || '') || null;
      } catch {}
    }

    return { from: from.toISOString(), to: to.toISOString(), days, summary, chatId };
  }

  /** 반복 업무 패턴 감지 → 매뉴얼 작성 제안 */
  @Post('suggest-manuals')
  async suggestManuals(@Body() body: { userId?: string; orgUnitId?: string; days?: number; viewerId?: string; team?: string; user?: string }) {
    const days = body.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: any = { date: { gte: since } };

    // 위 AI 분석과 동일한 팀/구성원 스코프 적용
    const viewerId = String(body.viewerId || body.userId || '').trim();
    if (viewerId) {
      const scopeOrgUnitIds = await this.getScopeOrgUnitIdsForViewer(viewerId);
      if (scopeOrgUnitIds.size > 0) {
        const createdByWhere: any = { orgUnitId: { in: Array.from(scopeOrgUnitIds) } };
        // Hierarchical team filtering: when filtering by parent teams, include all descendants
        const hierarchicalTeams = ['생산실', '품질경영실', '경영관리실', '함평공장', '연구개발실'];
        if (body.team && hierarchicalTeams.includes(body.team)) {
          const descendantIds = await this.getDescendantOrgUnitIds(body.team);
          if (descendantIds.size > 0) {
            createdByWhere.orgUnitId = { in: Array.from(descendantIds) };
          } else {
            createdByWhere.orgUnit = { name: body.team };
          }
        } else if (body.team) {
          createdByWhere.orgUnit = { name: body.team };
        }
        if (body.user) createdByWhere.name = { contains: body.user, mode: 'insensitive' as any };
        where.createdBy = createdByWhere;
      }
    } else {
      if (body.userId) where.createdById = body.userId;
      if (body.orgUnitId) where.createdBy = { orgUnitId: body.orgUnitId };
    }

    const worklogs = await this.prisma.worklog.findMany({
      where,
      orderBy: { date: 'asc' },
      include: { initiative: true, createdBy: { select: { id: true, name: true } } },
    });

    if (!worklogs.length) {
      return { suggestions: [], message: '분석할 업무일지가 없습니다.' };
    }

    // Count task frequencies
    const taskFreq = new Map<string, { count: number; title: string; users: Set<string>; hashTags: Set<string>; latestNote: string }>();
    for (const wl of worklogs) {
      const key = wl.initiative?.title || '';
      if (!key) continue;
      const existing = taskFreq.get(key) || { count: 0, title: key, users: new Set(), hashTags: new Set(), latestNote: '' };
      existing.count++;
      if (wl.createdBy) existing.users.add((wl.createdBy as any).name || (wl.createdBy as any).id);
      const tags = (wl as any).tags;
      if (tags?.hashTags && Array.isArray(tags.hashTags)) {
        for (const ht of tags.hashTags) existing.hashTags.add(ht);
      }
      existing.latestNote = String(wl.note || '').slice(0, 300);
      taskFreq.set(key, existing);
    }

    // Filter tasks with >= 3 occurrences as "repeated"
    const repeated = Array.from(taskFreq.values())
      .filter(t => t.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    if (!repeated.length) {
      return { suggestions: [], message: `최근 ${days}일간 3회 이상 반복된 업무가 없습니다.` };
    }

    // Check if manuals already exist for these tasks
    const existingManuals = await (this.prisma as any).workManual.findMany({
      where: { title: { in: repeated.map(r => r.title) } },
      select: { title: true },
    });
    const existingTitles = new Set((existingManuals || []).map((m: any) => m.title));

    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();

    // Build suggestions
    const suggestions = repeated.map(r => ({
      taskTitle: r.title,
      frequency: r.count,
      users: Array.from(r.users),
      hashTags: Array.from(r.hashTags),
      hasManual: existingTitles.has(r.title),
      latestNote: r.latestNote,
    }));

    // If AI available, get AI analysis
    let aiAnalysis: string | null = null;
    if (apiKey) {
      try {
        const context = suggestions.map((s, i) =>
          `${i + 1}. "${s.taskTitle}" - ${s.frequency}회 반복, 담당: ${s.users.join(', ')}, 태그: ${s.hashTags.join(', ') || '없음'}, 매뉴얼 존재: ${s.hasManual ? '있음' : '없음'}`
        ).join('\n');

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: '당신은 제조업 업무 프로세스 전문가입니다. 반복 업무 패턴을 분석하여 매뉴얼 작성 우선순위와 제안을 한국어로 간결하게 작성하세요.' },
              { role: 'user', content: `다음은 최근 ${days}일간 반복된 업무 목록입니다:\n\n${context}\n\n매뉴얼이 없는 업무 중 매뉴얼 작성이 가장 필요한 순서대로 정리하고, 각 업무에 대해 매뉴얼에 포함해야 할 핵심 내용을 2-3줄로 제안해 주세요.` },
            ],
            temperature: 0.3,
            max_tokens: 1500,
          }),
        });
        const data = await resp.json();
        aiAnalysis = String(data?.choices?.[0]?.message?.content || '').trim() || null;
      } catch {}
    }

    return { suggestions, aiAnalysis, days };
  }
}
