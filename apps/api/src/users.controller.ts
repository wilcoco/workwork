import { Body, Controller, Get, Param, Put, Query, BadRequestException, NotFoundException, Post, Res } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { Delete } from '@nestjs/common';
import type { Response } from 'express';

class UpdateRoleDto {
  @IsString() @IsNotEmpty()
  @IsEnum({ CEO: 'CEO', EXEC: 'EXEC', MANAGER: 'MANAGER', INDIVIDUAL: 'INDIVIDUAL', EXTERNAL: 'EXTERNAL' } as any)
  role!: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL';
}

class UpdateOrgUnitDto {
  @IsString()
  orgUnitId!: string; // empty string => clear
}

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  private graphTokenCache: { token: string; expMs: number } | null = null;
  private teamsPhotoSyncInFlight = new Set<string>();

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

  private async fetchUserPhotoByUpn(upn: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    let token = await this.getGraphToken();
    let jwtHint = this.getJwtHint(token);
    let refreshed = false;
    const enc = encodeURIComponent(String(upn || '').trim());
    if (!enc) return null;

    const urls = [
      `https://graph.microsoft.com/v1.0/users/${enc}/photos/240x240/$value`,
      `https://graph.microsoft.com/v1.0/users/${enc}/photo/$value`,
    ];
    for (const url of urls) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401 && !refreshed && attempt === 0) {
          this.graphTokenCache = null;
          token = await this.getGraphToken();
          jwtHint = this.getJwtHint(token);
          refreshed = true;
          continue;
        }
        if (res.status === 404) break;
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
          throw new BadRequestException(`graph photo fetch failed (${res.status})${detail}`);
        }
        const ab = await res.arrayBuffer();
        const bytes = Buffer.from(ab);
        if (!bytes.length) return null;
        const contentType = String(res.headers.get('content-type') || 'image/jpeg');
        return { bytes, contentType };
      }
    }
    return null;
  }

  private getTeamsPhotoTtlMs(): number {
    const hours = Number(process.env.TEAMS_PHOTO_TTL_HOURS || '168');
    const safeHours = Number.isFinite(hours) ? Math.max(1, Math.min(hours, 24 * 365)) : 168;
    return safeHours * 60 * 60 * 1000;
  }

  private shouldAutoSyncTeamsPhoto(user: any): boolean {
    const enabled = String(process.env.TEAMS_PHOTO_AUTOSYNC || '1').toLowerCase();
    if (enabled === '0' || enabled === 'false') return false;
    if (!this.hasGraphConfig()) return false;
    if (!user) return false;
    if ((user as any).status && String((user as any).status) !== 'ACTIVE') return false;
    if (String((user as any).role || '').toUpperCase() === 'EXTERNAL') return false;
    const upn = String((user as any).teamsUpn || user.email || '').trim();
    if (!upn) return false;
    const updatedAtRaw = (user as any).teamsPhotoUpdatedAt || null;
    if (!updatedAtRaw) return true;
    const updatedAt = new Date(updatedAtRaw);
    const ageMs = Date.now() - updatedAt.getTime();
    return ageMs > this.getTeamsPhotoTtlMs();
  }

  private async autoSyncTeamsPhoto(user: any): Promise<void> {
    try {
      if (!this.shouldAutoSyncTeamsPhoto(user)) return;
      const id = String(user.id || '').trim();
      if (!id) return;
      if (this.teamsPhotoSyncInFlight.has(id)) return;
      this.teamsPhotoSyncInFlight.add(id);
      try {
        const upn = String((user as any).teamsUpn || user.email || '').trim();
        if (!upn) return;
        const photo = await this.fetchUserPhotoByUpn(upn);
        if (!photo) {
          await (this.prisma as any).user.update({
            where: { id },
            data: { teamsPhotoBytes: null, teamsPhotoContentType: null, teamsPhotoUpdatedAt: new Date() },
          });
          return;
        }
        await (this.prisma as any).user.update({
          where: { id },
          data: { teamsPhotoBytes: photo.bytes, teamsPhotoContentType: photo.contentType, teamsPhotoUpdatedAt: new Date() },
        });
      } finally {
        this.teamsPhotoSyncInFlight.delete(String(user.id || '').trim());
      }
    } catch {
      try {
        this.teamsPhotoSyncInFlight.delete(String(user?.id || '').trim());
      } catch {}
    }
  }

  private async requireCeo(actorId?: string) {
    if (!actorId) throw new BadRequestException('actorId required');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new BadRequestException('only CEO can perform this action');
    return actor;
  }

  @Get('me')
  async me(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { orgUnit: true } });
    if (!user) throw new NotFoundException('user not found');
    void this.autoSyncTeamsPhoto(user as any);
    return { id: user.id, email: user.email, teamsUpn: (user as any).teamsUpn || '', name: user.name, role: user.role, status: (user as any).status || 'ACTIVE', activatedAt: (user as any).activatedAt || null, teamName: user.orgUnit?.name || '', orgUnitId: user.orgUnitId || '' };
  }

  @Get()
  async list(
    @Query('orgUnitId') orgUnitId?: string,
    @Query('orgUnitIds') orgUnitIdsCsv?: string,
    @Query('includePending') includePending?: string,
    @Query('includeExternal') includeExternal?: string,
    @Query('userId') userId?: string,
  ) {
    const where: any = {};
    if (orgUnitId) {
      where.orgUnitId = orgUnitId;
    } else if (orgUnitIdsCsv) {
      const ids = String(orgUnitIdsCsv)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) where.orgUnitId = { in: ids };
    }
    const wantsPending = includePending === '1' || includePending === 'true';
    const wantsExternal = includeExternal === '1' || includeExternal === 'true';
    if (wantsPending) {
      if (!userId) throw new BadRequestException('userId required');
      const actor = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!actor || ((actor.role as any) !== 'CEO' && (actor.role as any) !== 'EXTERNAL')) {
        throw new BadRequestException('only CEO can include pending users');
      }
    } else {
      where.status = 'ACTIVE';
    }

    if (!wantsExternal) {
      where.role = { not: 'EXTERNAL' } as any;
    } else {
      if (!userId) throw new BadRequestException('userId required');
      const actor = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!actor || ((actor.role as any) !== 'CEO' && (actor.role as any) !== 'EXTERNAL')) {
        throw new BadRequestException('only CEO can include external users');
      }
    }
    const users = await (this.prisma as any).user.findMany({ where, include: { orgUnit: true }, orderBy: { name: 'asc' } });
    return {
      items: users.map((u: any) => ({
        id: u.id,
        email: u.email,
        teamsUpn: (u as any).teamsUpn || '',
        name: u.name,
        role: u.role,
        status: (u as any).status || 'ACTIVE',
        activatedAt: (u as any).activatedAt || null,
        orgUnitId: u.orgUnitId || '',
        orgName: u.orgUnit?.name || '',
      })),
    };
  }

  @Get('overdue')
  async overdue(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const now = new Date();
    const limit = 50;

    const [procTasksRaw, approvalsRaw, helpRaw, delRaw, initRaw] = await Promise.all([
      (this.prisma as any).processTaskInstance.findMany({
        where: {
          assigneeId: String(userId),
          status: { notIn: ['COMPLETED', 'SKIPPED'] as any },
          OR: [
            { plannedEndAt: { lt: now } },
            { deadlineAt: { lt: now } },
          ],
        },
        include: {
          instance: { select: { id: true, title: true, status: true } },
          initiative: { select: { id: true, title: true } },
        },
        orderBy: [{ plannedEndAt: 'asc' }, { deadlineAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.approvalRequest.findMany({
        where: {
          approverId: String(userId),
          status: 'PENDING' as any,
          dueAt: { lt: now },
        },
        select: { id: true, subjectType: true, subjectId: true, dueAt: true, createdAt: true },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.helpTicket.findMany({
        where: {
          assigneeId: String(userId),
          status: { notIn: ['DONE', 'CANCELLED'] as any },
          dueAt: { lt: now },
        },
        select: { id: true, category: true, queue: true, status: true, dueAt: true, createdAt: true },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.delegation.findMany({
        where: {
          delegateeId: String(userId),
          status: { notIn: ['DONE', 'REJECTED'] as any },
          dueAt: { lt: now },
        },
        include: {
          childInitiative: { select: { id: true, title: true } },
          delegator: { select: { id: true, name: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.initiative.findMany({
        where: {
          ownerId: String(userId),
          state: { notIn: ['DONE', 'CANCELLED'] as any },
          dueAt: { lt: now },
        },
        include: {
          keyResult: { include: { objective: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
    ]);

    const dueMs = (d: any) => {
      try {
        const dt = new Date(d);
        const t = dt.getTime();
        return Number.isFinite(t) ? t : NaN;
      } catch {
        return NaN;
      }
    };

    const items: any[] = [];

    for (const t of (procTasksRaw || [])) {
      const dueAt = (t as any).deadlineAt || (t as any).plannedEndAt || null;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      if (ms >= now.getTime()) continue;
      items.push({
        kind: 'PROCESS_TASK',
        id: String((t as any).id),
        dueAt: new Date(ms).toISOString(),
        overdueDays: Math.max(0, Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000))),
        title: String((t as any).name || ''),
        processInstanceId: String((t as any).instanceId || (t as any).instance?.id || ''),
        processTitle: String((t as any).instance?.title || ''),
        taskStatus: String((t as any).status || ''),
        initiativeId: String((t as any).initiative?.id || (t as any).initiativeId || ''),
        initiativeTitle: String((t as any).initiative?.title || ''),
        link: (t as any).instanceId ? `/process/instances/${encodeURIComponent(String((t as any).instanceId))}` : '',
      });
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
      if (ms >= now.getTime()) continue;
      const subjectType = String((a as any).subjectType || '');
      const subjectId = String((a as any).subjectId || '');
      const st = subjectType.toUpperCase();
      const title = (st === 'PROCESS')
        ? (procTitleMap.get(subjectId) || '프로세스 결재')
        : (st === 'WORKLOG' || st === 'WORKLOGS')
          ? (wlTitleMap.get(subjectId) || '업무일지 결재')
          : `${subjectType} 결재`;
      items.push({
        kind: 'APPROVAL',
        id: String((a as any).id),
        dueAt: new Date(ms).toISOString(),
        overdueDays: Math.max(0, Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000))),
        title,
        subjectType,
        subjectId,
        link: '/approvals/inbox',
      });
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

    for (const t of (helpRaw || [])) {
      const dueAt = (t as any).dueAt;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      if (ms >= now.getTime()) continue;
      const wlId = helpIdToWlId[String((t as any).id)] || '';
      const title = wlId ? (helpWlTitle.get(wlId) || '업무 요청') : '업무 요청';
      items.push({
        kind: 'HELP_TICKET',
        id: String((t as any).id),
        dueAt: new Date(ms).toISOString(),
        overdueDays: Math.max(0, Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000))),
        title,
        category: String((t as any).category || ''),
        status: String((t as any).status || ''),
        requestWorklogId: wlId || null,
        link: '/coops/inbox',
      });
    }

    for (const d of (delRaw || [])) {
      const dueAt = (d as any).dueAt;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      if (ms >= now.getTime()) continue;
      items.push({
        kind: 'DELEGATION',
        id: String((d as any).id),
        dueAt: new Date(ms).toISOString(),
        overdueDays: Math.max(0, Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000))),
        title: String((d as any).childInitiative?.title || '위임된 과제'),
        childInitiativeId: String((d as any).childInitiativeId || (d as any).childInitiative?.id || ''),
        delegatorName: String((d as any).delegator?.name || ''),
      });
    }

    for (const it of (initRaw || [])) {
      const dueAt = (it as any).dueAt;
      if (!dueAt) continue;
      const ms = dueMs(dueAt);
      if (!Number.isFinite(ms)) continue;
      if (ms >= now.getTime()) continue;
      const obj = (it as any)?.keyResult?.objective;
      const isKpi = !!(obj && (obj as any).pillar != null);
      items.push({
        kind: 'INITIATIVE',
        id: String((it as any).id),
        dueAt: new Date(ms).toISOString(),
        overdueDays: Math.max(0, Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000))),
        title: String((it as any).title || ''),
        initiativeType: isKpi ? 'KPI' : 'OKR',
        keyResultTitle: String((it as any)?.keyResult?.title || ''),
        objectiveTitle: String((it as any)?.keyResult?.objective?.title || ''),
      });
    }

    items.sort((a, b) => {
      const am = dueMs(a.dueAt);
      const bm = dueMs(b.dueAt);
      if (Number.isFinite(am) && Number.isFinite(bm) && am !== bm) return am - bm;
      return (Number(b.overdueDays || 0) - Number(a.overdueDays || 0));
    });

    const sliced = items.slice(0, limit);
    const counts = {
      total: sliced.length,
      processTasks: sliced.filter((x) => x.kind === 'PROCESS_TASK').length,
      approvals: sliced.filter((x) => x.kind === 'APPROVAL').length,
      helpTickets: sliced.filter((x) => x.kind === 'HELP_TICKET').length,
      delegations: sliced.filter((x) => x.kind === 'DELEGATION').length,
      initiatives: sliced.filter((x) => x.kind === 'INITIATIVE').length,
    };

    return { now: now.toISOString(), counts, items: sliced };
  }

  @Get(':id/photo')
  async photo(@Param('id') id: string, @Res() res: Response) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: String(id) } });
    if (!user) throw new NotFoundException('user not found');
    const bytes: Buffer | null = (user as any).teamsPhotoBytes || null;
    const ct = String((user as any).teamsPhotoContentType || 'image/jpeg');
    const updatedAt = (user as any).teamsPhotoUpdatedAt ? new Date((user as any).teamsPhotoUpdatedAt) : null;
    if (!bytes || !bytes.length) throw new NotFoundException('photo not found');
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (updatedAt) res.setHeader('Last-Modified', updatedAt.toUTCString());
    res.status(200);
    res.end(bytes);
  }

  @Post(':id/sync-teams-photo')
  async syncTeamsPhoto(@Param('id') id: string, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    const user = await (this.prisma as any).user.findUnique({ where: { id: String(id) } });
    if (!user) throw new NotFoundException('user not found');
    const upn = String((user as any).teamsUpn || user.email || '').trim();
    if (!upn) throw new BadRequestException('teamsUpn/email required');
    const photo = await this.fetchUserPhotoByUpn(upn);
    if (!photo) {
      await (this.prisma as any).user.update({
        where: { id: String(id) },
        data: { teamsPhotoBytes: null, teamsPhotoContentType: null, teamsPhotoUpdatedAt: new Date() },
      });
      return { ok: true, id: String(id), updated: false, reason: 'no photo' };
    }
    await (this.prisma as any).user.update({
      where: { id: String(id) },
      data: { teamsPhotoBytes: photo.bytes, teamsPhotoContentType: photo.contentType, teamsPhotoUpdatedAt: new Date() },
    });
    return { ok: true, id: String(id), updated: true };
  }

  @Post('sync-teams-photos')
  async syncTeamsPhotos(@Query('actorId') actorId?: string, @Query('limit') limit?: string) {
    await this.requireCeo(actorId);
    const take = Math.max(1, Math.min(500, parseInt(String(limit || '50'), 10) || 50));
    const users = await (this.prisma as any).user.findMany({
      where: { status: 'ACTIVE', teamsUpn: { not: null } },
      select: { id: true, email: true, teamsUpn: true },
      orderBy: { name: 'asc' },
      take,
    });

    let updated = 0;
    let skipped = 0;
    const failed: Array<{ id: string; error: string }> = [];

    for (const u of users || []) {
      const upn = String(u.teamsUpn || u.email || '').trim();
      if (!upn) {
        skipped++;
        continue;
      }
      try {
        const photo = await this.fetchUserPhotoByUpn(upn);
        if (!photo) {
          skipped++;
          continue;
        }
        await (this.prisma as any).user.update({
          where: { id: String(u.id) },
          data: { teamsPhotoBytes: photo.bytes, teamsPhotoContentType: photo.contentType, teamsPhotoUpdatedAt: new Date() },
        });
        updated++;
      } catch (e: any) {
        failed.push({ id: String(u.id), error: String(e?.message || 'failed') });
      }
    }
    return { ok: true, take, updated, skipped, failed };
  }

  @Put(':id/role')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    const nextRole = dto.role as any;
    const user = await this.prisma.user.update({ where: { id }, data: { role: nextRole, ...(nextRole === 'EXTERNAL' ? { orgUnitId: null } : {}) } });
    return { id: user.id, role: user.role };
  }

  @Put(':id/orgUnit')
  async updateOrgUnit(@Param('id') id: string, @Body() dto: UpdateOrgUnitDto, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('user not found');
    if ((existing.role as any) === 'EXTERNAL') {
      throw new BadRequestException('cannot assign orgUnit to external user');
    }
    const nextOrgUnitId = String(dto?.orgUnitId || '').trim();
    const user = await this.prisma.user.update({ where: { id }, data: { orgUnitId: nextOrgUnitId ? nextOrgUnitId : null } });
    const org = user.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } }) : null;
    return { id: user.id, orgUnitId: user.orgUnitId || '', orgName: org?.name || '' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    try {
      await this.prisma.user.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      throw new BadRequestException('삭제할 수 없습니다. 관련 데이터가 존재합니다.');
    }
  }
}

