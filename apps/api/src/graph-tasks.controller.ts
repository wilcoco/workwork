import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import { DataverseService } from './dataverse.service';

/**
 * Microsoft Graph API proxy for Teams Planner / To-Do Tasks.
 *
 * Token flow:
 *  1. User logs in via Entra SSO → access_token + refresh_token stored on User row
 *  2. This controller reads the token, refreshes if expired, and proxies Graph calls
 */

@Controller('graph-tasks')
export class GraphTasksController {
  constructor(private prisma: PrismaService, private dataverse: DataverseService) {}

  /**
   * GET /api/graph-tasks/dataverse-user-roles?email=xxx
   * Inspect security roles assigned to a Dataverse systemuser.
   */
  @Public()
  @Get('dataverse-user-roles')
  async dataverseUserRoles(@Query('email') email: string) {
    if (!this.dataverse.isConfigured()) return { ok: false, error: 'Dataverse not configured.' };
    if (!email) return { ok: false, error: 'email required' };
    try {
      const sysuser = await this.dataverse.findSystemUserByEmail(email);
      if (!sysuser) return { ok: false, error: `No systemuser for ${email}` };
      // Expand roles via systemuserroles_association
      const resp = await this.dataverse.get(
        `/api/data/v9.2/systemusers(${sysuser.systemuserid})?$expand=systemuserroles_association($select=roleid,name,_businessunitid_value)`,
      );
      const roles = (resp?.systemuserroles_association || []).map((r: any) => ({
        roleid: r.roleid,
        name: r.name,
        businessUnitId: r._businessunitid_value,
      }));
      // Also check if any has prvCreatemsdyn_operationset privilege directly
      return {
        ok: true,
        systemuserid: sysuser.systemuserid,
        fullname: sysuser.fullname,
        email: sysuser.internalemailaddress,
        isdisabled: sysuser.isdisabled,
        azureObjectId: sysuser.azureactivedirectoryobjectid,
        roleCount: roles.length,
        roles,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /**
   * GET /api/graph-tasks/dataverse-action-params?name=msdyn_PssUpdateV2
   * Inspect the parameter signature of an SDK message (action).
   */
  @Public()
  @Get('dataverse-action-params')
  async dataverseActionParams(@Query('name') name: string) {
    if (!this.dataverse.isConfigured()) return { ok: false, error: 'Dataverse not configured.' };
    if (!name) return { ok: false, error: 'name required' };
    try {
      const nameEsc = name.replace(/'/g, "''");
      // Step 1: find sdkmessage
      const msgs = await this.dataverse.get(
        `/api/data/v9.2/sdkmessages?$filter=name eq '${nameEsc}'&$select=sdkmessageid,name&$top=1`,
      );
      const msg = msgs?.value?.[0];
      if (!msg) return { ok: false, error: `SDK message not found: ${name}` };

      // Step 2: find sdkmessagepair for this message
      const pairs = await this.dataverse.get(
        `/api/data/v9.2/sdkmessagepairs?$filter=_sdkmessageid_value eq ${msg.sdkmessageid}&$select=sdkmessagepairid`,
      );
      const pair = pairs?.value?.[0];
      if (!pair) return { ok: true, sdkmessageid: msg.sdkmessageid, note: 'No sdkmessagepair' };

      // Step 3: find sdkmessagerequest
      const requests = await this.dataverse.get(
        `/api/data/v9.2/sdkmessagerequests?$filter=_sdkmessagepairid_value eq ${pair.sdkmessagepairid}&$select=sdkmessagerequestid,name`,
      );
      const request = requests?.value?.[0];
      if (!request) return { ok: true, sdkmessagepairid: pair.sdkmessagepairid, note: 'No sdkmessagerequest' };

      // Step 4: find fields
      const fields = await this.dataverse.get(
        `/api/data/v9.2/sdkmessagerequestfields?$filter=_sdkmessagerequestid_value eq ${request.sdkmessagerequestid}&$select=name,clrparser,optional,position&$orderby=position`,
      );
      return {
        ok: true,
        action: name,
        requestName: request.name,
        parameters: (fields?.value || []).map((f: any) => ({
          position: f.position,
          name: f.name,
          optional: f.optional,
          type: f.clrparser,
        })),
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /**
   * GET /api/graph-tasks/dataverse-actions?filter=Pss
   * List available SDK messages (actions) containing the filter string.
   */
  @Public()
  @Get('dataverse-actions')
  async dataverseActions(@Query('filter') filter: string) {
    if (!this.dataverse.isConfigured()) {
      return { ok: false, error: 'Dataverse not configured.' };
    }
    try {
      const q = (filter || 'msdyn').replace(/'/g, "''");
      const resp = await this.dataverse.get(
        `/api/data/v9.2/sdkmessages?$filter=contains(name,'${q}')&$select=name,isprivate&$top=200&$orderby=name`,
      );
      const items = (resp?.value || []).map((r: any) => ({ name: r.name, isprivate: r.isprivate }));
      return { ok: true, filter: q, count: items.length, items };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /**
   * GET /api/graph-tasks/dataverse-test?plannerTaskId=xxx&email=xxx&subject=xxx
   * Diagnostic: full flow — Graph API GET task (by email) → Dataverse search by subject.
   */
  @Public()
  @Get('dataverse-test')
  async dataverseTest(
    @Query('plannerTaskId') plannerTaskId: string,
    @Query('email') email: string,
    @Query('subject') subjectOverride: string,
  ) {
    if (!this.dataverse.isConfigured()) {
      return { ok: false, error: 'Dataverse not configured. Set DATAVERSE_* env vars on the server.' };
    }
    const result: any = { ok: true, envUrl: this.dataverse.getEnvUrl() };

    // Step 1: Dataverse token + schema sample
    try {
      const tok = await this.dataverse.getToken();
      result.dvTokenLength = tok.length;
    } catch (e: any) {
      return { ok: false, step: 'dv-token', error: e?.message };
    }

    let taskSample: any = null;
    try {
      const sample = await this.dataverse.get('/api/data/v9.2/msdyn_projecttasks?$top=1');
      taskSample = sample?.value?.[0] || null;
    } catch (e: any) {
      return { ...result, ok: false, step: 'dv-sample-task', error: e?.message };
    }
    result.taskSampleFields = taskSample ? Object.keys(taskSample).filter(k => !k.startsWith('@')) : [];
    result.taskSampleId = taskSample?.msdyn_projecttaskid || null;

    // Project sample
    const projectSample = await this.dataverse.getSampleProject();
    result.projectSampleFields = projectSample ? Object.keys(projectSample).filter(k => !k.startsWith('@')) : [];
    result.projectSampleId = projectSample?.msdyn_projectid || null;

    // Step 2: Try direct mapping (likely null)
    if (plannerTaskId) {
      result.directMatch = await this.dataverse.findProjectTaskByPlannerId(plannerTaskId);
    }

    // Step 3: If email provided, use Graph API to get Planner task title
    let subject = subjectOverride || '';
    if (!subject && plannerTaskId && email) {
      try {
        const user = await (this.prisma as any).user.findFirst({
          where: {
            OR: [
              { teamsUpn: { equals: email, mode: 'insensitive' } },
              { email: { equals: email, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (user) {
          const graphToken = await this.getGraphToken(user.id);
          const task: any = await this.graphGet(graphToken, `/planner/tasks/${plannerTaskId}`);
          subject = String(task?.title || '');
          result.graphTaskTitle = subject;
          result.graphPlanId = task?.planId || null;
        }
      } catch (e: any) {
        result.graphError = e?.message || String(e);
      }
    }

    // Step 4: Fetch Graph plan title (to filter Dataverse project)
    let planTitle = '';
    if (result.graphPlanId && email) {
      try {
        const user = await (this.prisma as any).user.findFirst({
          where: {
            OR: [
              { teamsUpn: { equals: email, mode: 'insensitive' } },
              { email: { equals: email, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (user) {
          const graphToken = await this.getGraphToken(user.id);
          const plan: any = await this.graphGet(graphToken, `/planner/plans/${result.graphPlanId}`);
          planTitle = String(plan?.title || '');
          result.graphPlanTitle = planTitle;
        }
      } catch (e: any) {
        result.graphPlanError = e?.message || String(e);
      }
    }

    // Step 5: Find Dataverse project matching the plan title
    let projectMatchId: string | null = null;
    if (planTitle) {
      try {
        const projects = await this.dataverse.findProjectsBySubject(planTitle);
        result.projectMatches = projects.map((p: any) => ({
          id: p.msdyn_projectid,
          subject: p.msdyn_subject,
        }));
        if (projects.length === 1) {
          projectMatchId = projects[0].msdyn_projectid;
        }
      } catch (e: any) {
        result.projectMatchError = e?.message || String(e);
      }
    }

    // Step 6: Search Dataverse tasks by subject, filtered by project if possible
    if (subject) {
      try {
        const matches = await this.dataverse.findProjectTasksBySubject(subject, projectMatchId || undefined);
        const enriched = await Promise.all(
          matches.map(async (m: any) => {
            const parents = await this.dataverse.buildTaskParentChain(m.msdyn_projecttaskid).catch(() => []);
            const breadcrumb = [
              ...parents.map(p => p.subject),
              m.msdyn_subject,
            ].join(' > ');
            return {
              id: m.msdyn_projecttaskid,
              subject: m.msdyn_subject,
              progress: m.msdyn_progress,
              outlineLevel: m.msdyn_outlinelevel,
              displaySequence: m.msdyn_displaysequence,
              projectId: m._msdyn_project_value,
              parentTaskId: m._msdyn_parenttask_value || null,
              bucketId: m._msdyn_projectbucket_value || null,
              parents,
              breadcrumb,
            };
          }),
        );
        result.subjectSearch = {
          subject,
          filteredByProjectId: projectMatchId,
          count: matches.length,
          matches: enriched,
        };

        // Step 7: Look up systemuserid for impersonation (PSS requires Project license)
        let callerSystemUserId: string | undefined;
        if (email) {
          try {
            const sysuser = await this.dataverse.findSystemUserByEmail(email);
            if (sysuser) {
              callerSystemUserId = sysuser.systemuserid;
              result.caller = {
                systemuserid: sysuser.systemuserid,
                fullname: sysuser.fullname,
                email: sysuser.internalemailaddress,
                isdisabled: sysuser.isdisabled,
              };
            } else {
              result.callerLookupError = `No systemuser found for email ${email}`;
            }
          } catch (e: any) {
            result.callerLookupError = e?.message || String(e);
          }
        }

        // Step 8: If exactly one match, attempt a no-op write via OperationSet 3-step flow
        if (matches.length === 1) {
          const task = matches[0];
          const currentDesc = String(task.msdyn_description || '');
          const newDesc = currentDesc.endsWith(' ') ? currentDesc.trimEnd() : currentDesc + ' ';
          try {
            const res = await this.dataverse.updateProjectTaskViaOperationSet(
              task.msdyn_projecttaskid,
              task._msdyn_project_value,
              { description: newDesc },
              { executorCallerId: callerSystemUserId },
            );
            result.writeTest = {
              ok: true,
              method: 'Mixed mode (Create/Update=AppUser, Execute impersonated)',
              executorCallerSystemUserId: callerSystemUserId,
              response: res,
            };
          } catch (e: any) {
            result.writeTest = {
              ok: false,
              method: 'Mixed mode (Create/Update=AppUser, Execute impersonated)',
              executorCallerSystemUserId: callerSystemUserId,
              error: e?.message || String(e),
            };
          }
        }
      } catch (e: any) {
        result.subjectSearchError = e?.message || String(e);
      }
    }

    return result;
  }

  // ─── Helper: decode JWT to inspect scopes ─────────────────

  private decodeTokenScopes(token: string): string {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return '(invalid token)';
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return String(payload.scp || payload.scope || '(no scp claim)');
    } catch {
      return '(decode failed)';
    }
  }

  // ─── Helper: get a valid Graph access token ─────────────────

  private async getGraphToken(userId: string): Promise<string> {
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        graphAccessToken: true,
        graphRefreshToken: true,
        graphTokenExpiry: true,
        entraTenantId: true,
      },
    });
    if (!user?.graphAccessToken) {
      throw new BadRequestException('Graph API 토큰이 없습니다. 팀즈(Entra) SSO로 다시 로그인해주세요.');
    }

    // If token is still valid (with 5 min buffer), return it
    const expiry = user.graphTokenExpiry ? new Date(user.graphTokenExpiry).getTime() : 0;
    if (expiry > Date.now() + 5 * 60 * 1000) {
      return user.graphAccessToken;
    }

    // Try refresh
    if (!user.graphRefreshToken) {
      throw new BadRequestException('Graph API 토큰이 만료되었습니다. 다시 로그인해주세요.');
    }

    const tenantId = String(user.entraTenantId || process.env.ENTRA_TENANT_ID || '').trim();
    const clientId = String(process.env.ENTRA_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.ENTRA_CLIENT_SECRET || '').trim();
    if (!tenantId || !clientId || !clientSecret) {
      throw new BadRequestException('Entra 설정이 누락되었습니다.');
    }

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: user.graphRefreshToken,
      scope: 'openid profile email offline_access Tasks.ReadWrite Group.Read.All Files.ReadWrite.All',
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.access_token) {
      // Clear stale tokens
      try {
        await (this.prisma as any).user.update({
          where: { id: userId },
          data: { graphAccessToken: null, graphRefreshToken: null, graphTokenExpiry: null },
        });
      } catch {}
      throw new BadRequestException('Graph API 토큰 갱신 실패. 다시 로그인해주세요.');
    }

    const newExpiry = new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000);
    await (this.prisma as any).user.update({
      where: { id: userId },
      data: {
        graphAccessToken: json.access_token,
        graphRefreshToken: json.refresh_token || user.graphRefreshToken,
        graphTokenExpiry: newExpiry,
      },
    });

    return json.access_token;
  }

  private async graphGet(token: string, path: string) {
    const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`Graph API error ${resp.status}: ${text.slice(0, 300)}`);
    }
    return resp.json();
  }

  private async graphPatch(token: string, path: string, body: any) {
    const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`Graph API error ${resp.status}: ${text.slice(0, 300)}`);
    }
    // PATCH on Planner returns 204 No Content on success
    if (resp.status === 204) return { ok: true };
    return resp.json().catch(() => ({ ok: true }));
  }

  // ─── Endpoints ──────────────────────────────────────────────

  /**
   * POST /api/graph-tasks/sync-my-tasks
   * Fetches user's own Planner tasks from Graph and upserts them into PlannerTaskCache.
   * Called on SSO login and when visiting the home page.
   * Body: { userId }
   */
  @Post('sync-my-tasks')
  async syncMyTasks(@Body() body: { userId: string }) {
    if (!body.userId) throw new BadRequestException('userId required');
    const token = await this.getGraphToken(body.userId);

    // Fetch all tasks assigned to this user from Graph
    const data = await this.graphGet(token, '/me/planner/tasks');
    const tasks: any[] = data?.value || [];

    // Resolve plan names (batch)
    const planIds = [...new Set(tasks.map((t: any) => t.planId).filter(Boolean))];
    const planMeta: Record<string, { title: string; groupName: string }> = {};
    for (const pid of planIds) {
      try {
        const plan = await this.graphGet(token, `/planner/plans/${pid}?$select=title,owner`);
        let groupName = '';
        if (plan?.owner) {
          try {
            const grp = await this.graphGet(token, `/groups/${plan.owner}?$select=displayName`);
            groupName = grp?.displayName || '';
          } catch {}
        }
        planMeta[pid] = { title: plan?.title || '', groupName };
      } catch {
        planMeta[pid] = { title: '', groupName: '' };
      }
    }

    // Upsert each task into cache
    const now = new Date();
    let synced = 0;
    for (const t of tasks) {
      try {
        await (this.prisma as any).plannerTaskCache.upsert({
          where: {
            graphTaskId_userId: { graphTaskId: t.id, userId: body.userId },
          },
          update: {
            title: t.title || '',
            dueDateTime: t.dueDateTime ? new Date(t.dueDateTime) : null,
            percentComplete: t.percentComplete ?? 0,
            priority: t.priority ?? 5,
            planName: planMeta[t.planId]?.title || null,
            groupName: planMeta[t.planId]?.groupName || null,
            syncedAt: now,
          },
          create: {
            graphTaskId: t.id,
            userId: body.userId,
            title: t.title || '',
            dueDateTime: t.dueDateTime ? new Date(t.dueDateTime) : null,
            percentComplete: t.percentComplete ?? 0,
            priority: t.priority ?? 5,
            planName: planMeta[t.planId]?.title || null,
            groupName: planMeta[t.planId]?.groupName || null,
            syncedAt: now,
          },
        });
        synced++;
      } catch (e: any) {
        console.warn(`[sync-my-tasks] upsert failed for task ${t.id}:`, e?.message);
      }
    }

    // Remove tasks from cache that no longer exist in Graph for this user
    const graphTaskIds = tasks.map((t: any) => t.id);
    if (graphTaskIds.length > 0) {
      await (this.prisma as any).plannerTaskCache.deleteMany({
        where: {
          userId: body.userId,
          graphTaskId: { notIn: graphTaskIds },
        },
      });
    }

    return { ok: true, synced, total: tasks.length };
  }

  /**
   * GET /api/graph-tasks/overdue-tasks?userId=xxx&scope=mine|all
   * Returns overdue Planner tasks from the PlannerTaskCache DB table.
   * scope=mine (default): only current user's cached tasks
   * scope=all: all users' cached tasks (company-wide)
   */
  @Get('overdue-tasks')
  async getOverdueTasks(
    @Query('userId') userId: string,
    @Query('scope') scope?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    const now = new Date();

    const where: any = {
      dueDateTime: { lt: now },
      percentComplete: { lt: 100 },
    };
    if (scope !== 'all') {
      where.userId = userId;
    }

    const rows = await (this.prisma as any).plannerTaskCache.findMany({
      where,
      orderBy: { dueDateTime: 'asc' },
      include: {
        user: { select: { name: true, orgUnit: { select: { name: true } } } },
      },
      take: 200,
    });

    const tasks = rows.map((r: any) => ({
      id: r.graphTaskId,
      title: r.title,
      dueDateTime: r.dueDateTime,
      percentComplete: r.percentComplete,
      priority: r.priority,
      planName: r.planName || '',
      groupName: r.groupName || '',
      assigneeName: r.user?.name || '',
      assigneeTeam: r.user?.orgUnit?.name || '',
      syncedAt: r.syncedAt,
    }));

    return { tasks };
  }

  /**
   * GET /api/graph-tasks/my-tasks?userId=xxx
   * Returns all Planner tasks assigned to the current user across all plans.
   */
  @Get('my-tasks')
  async getMyTasks(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const token = await this.getGraphToken(userId);

    // Graph API: list tasks assigned to me
    const data = await this.graphGet(token, '/me/planner/tasks');
    const tasks: any[] = data?.value || [];

    // Enrich with plan names (batch unique planIds)
    const planIds = [...new Set(tasks.map((t: any) => t.planId).filter(Boolean))];
    const planNames: Record<string, string> = {};
    for (const pid of planIds) {
      try {
        const plan = await this.graphGet(token, `/planner/plans/${pid}`);
        planNames[pid] = plan?.title || '';
      } catch {
        planNames[pid] = '';
      }
    }

    // Enrich with task details (description, checklist) for each task
    const enriched = await Promise.all(
      tasks.map(async (t: any) => {
        let details: any = null;
        try {
          details = await this.graphGet(token, `/planner/tasks/${t.id}/details`);
        } catch {}
        return {
          id: t.id,
          title: t.title,
          planId: t.planId,
          planName: planNames[t.planId] || '',
          bucketId: t.bucketId,
          percentComplete: t.percentComplete, // 0, 50, 100
          priority: t.priority, // 1=urgent, 3=important, 5=medium, 9=low
          startDateTime: t.startDateTime,
          dueDateTime: t.dueDateTime,
          createdDateTime: t.createdDateTime,
          completedDateTime: t.completedDateTime,
          description: details?.description || '',
          checklist: details?.checklist || {},
          etag: t['@odata.etag'] || '',
          detailsEtag: details?.['@odata.etag'] || '',
        };
      }),
    );

    // Sort: incomplete first, then by due date
    enriched.sort((a, b) => {
      if (a.percentComplete === 100 && b.percentComplete !== 100) return 1;
      if (a.percentComplete !== 100 && b.percentComplete === 100) return -1;
      const da = a.dueDateTime ? new Date(a.dueDateTime).getTime() : Infinity;
      const db = b.dueDateTime ? new Date(b.dueDateTime).getTime() : Infinity;
      return da - db;
    });

    return { tasks: enriched };
  }

  /**
   * PATCH /api/graph-tasks/:taskId/progress
   * Update task progress: { userId, percentComplete, etag }
   * percentComplete: 0 (not started), 50 (in progress), 100 (completed)
   */
  @Patch(':taskId/progress')
  async updateProgress(
    @Param('taskId') taskId: string,
    @Body() body: { userId: string; percentComplete: number; etag: string },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');
    if (body.percentComplete === undefined) throw new BadRequestException('percentComplete required');
    if (!body.etag) throw new BadRequestException('etag required');

    const token = await this.getGraphToken(body.userId);

    const result = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': body.etag,
      },
      body: JSON.stringify({ percentComplete: body.percentComplete }),
    });

    if (!result.ok) {
      const text = await result.text().catch(() => '');
      throw new BadRequestException(`태스크 업데이트 실패 (${result.status}): ${text.slice(0, 300)}`);
    }

    return { ok: true, percentComplete: body.percentComplete };
  }

  /**
   * PATCH /api/graph-tasks/:taskId/details
   * Update task details (description): { userId, description, detailsEtag }
   */
  @Patch(':taskId/details')
  async updateDetails(
    @Param('taskId') taskId: string,
    @Body() body: { userId: string; description: string; detailsEtag: string },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');
    if (!body.detailsEtag) throw new BadRequestException('detailsEtag required');

    const token = await this.getGraphToken(body.userId);

    const result = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${taskId}/details`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': body.detailsEtag,
      },
      body: JSON.stringify({ description: body.description }),
    });

    if (!result.ok) {
      const text = await result.text().catch(() => '');
      throw new BadRequestException(`상세 업데이트 실패 (${result.status}): ${text.slice(0, 300)}`);
    }

    return { ok: true };
  }

  /**
   * POST /api/graph-tasks/:taskId/sync-worklog
   * Append worklog content to a Planner task's description.
   * Also optionally update progress.
   * Body: { userId, title, content, date, percentComplete? }
   */
  @Post(':taskId/sync-worklog')
  async syncWorklog(
    @Param('taskId') taskId: string,
    @Body() body: {
      userId: string;
      title: string;
      content: string;
      date?: string;
      percentComplete?: number;
      attachments?: Array<{ url: string; name: string }>;
    },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');
    const token = await this.getGraphToken(body.userId);

    // Fetch current task details to get etag + existing description
    let details: any;
    try {
      details = await this.graphGet(token, `/planner/tasks/${taskId}/details`);
    } catch {
      throw new BadRequestException('Planner 태스크 상세 정보를 가져올 수 없습니다.');
    }
    const detailsEtag = details?.['@odata.etag'] || '';
    if (!detailsEtag) throw new BadRequestException('태스크 etag를 가져올 수 없습니다.');

    const existing = String(details?.description || '').trim();
    const dateStr = body.date || new Date().toISOString().slice(0, 10);
    const newEntry = `\n\n--- 업무일지 (${dateStr}) ---\n제목: ${body.title || '(제목 없음)'}\n${body.content || ''}`.trim();
    const merged = existing ? `${existing}\n${newEntry}` : newEntry;

    // Update description (max 32KB for Planner description)
    const desc = merged.length > 30000 ? merged.slice(-30000) : merged;

    // Build patch body: description + optional file references
    const patchBody: any = { description: desc };

    // Add attachments as external references (only NEW ones — do NOT re-send existing refs)
    if (body.attachments?.length) {
      const existingRefs = details?.references || {};
      const newRefs: Record<string, any> = {};
      for (const att of body.attachments) {
        if (!att.url) continue;
        // Planner reference key: URL with special chars percent-encoded
        const encodedUrl = att.url
          .replace(/%/g, '%25')
          .replace(/\./g, '%2E')
          .replace(/:/g, '%3A')
          .replace(/#/g, '%23')
          .replace(/@/g, '%40');
        // Skip if already exists
        if (existingRefs[encodedUrl]) continue;
        newRefs[encodedUrl] = {
          '@odata.type': '#microsoft.graph.plannerExternalReference',
          alias: att.name || '첨부파일',
          type: 'Other',
        };
      }
      if (Object.keys(newRefs).length > 0) {
        patchBody.references = newRefs;
      }
    }

    const patchRes = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${taskId}/details`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': detailsEtag,
      },
      body: JSON.stringify(patchBody),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '');
      const scopes = this.decodeTokenScopes(token);
      console.error(`[sync-worklog] PATCH failed: status=${patchRes.status}, scopes=${scopes}, body=${text.slice(0, 500)}`);

      // Planner Premium: Graph API PATCH is blocked. Fall back to Dataverse.
      if (patchRes.status === 403 && this.dataverse.isConfigured()) {
        // Step A: Try attaching files as Planner references via a separate minimal PATCH
        // (references-only, no description). Premium may allow references PATCH even when
        // description PATCH is blocked.
        let plannerReferencesAdded = 0;
        const bodyForDataverse = { ...body };
        if (body.attachments?.length) {
          try {
            const freshDetails: any = await this.graphGet(token, `/planner/tasks/${taskId}/details`);
            const freshEtag = freshDetails?.['@odata.etag'];
            const existingRefs = freshDetails?.references || {};
            const newRefs: Record<string, any> = {};
            for (const att of body.attachments) {
              if (!att?.url) continue;
              const key = att.url
                .replace(/%/g, '%25')
                .replace(/\./g, '%2E')
                .replace(/:/g, '%3A')
                .replace(/#/g, '%23')
                .replace(/@/g, '%40');
              if (existingRefs[key]) continue;
              newRefs[key] = {
                '@odata.type': '#microsoft.graph.plannerExternalReference',
                alias: att.name || '첨부파일',
                type: 'Other',
              };
            }
            const newCount = Object.keys(newRefs).length;
            if (newCount > 0 && freshEtag) {
              const refRes = await fetch(
                `https://graph.microsoft.com/v1.0/planner/tasks/${taskId}/details`,
                {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'If-Match': freshEtag,
                  },
                  body: JSON.stringify({ references: newRefs }),
                },
              );
              if (refRes.ok) {
                plannerReferencesAdded = newCount;
                // Strip attachments so syncViaDataverse doesn't re-add them as text links
                bodyForDataverse.attachments = [];
                console.log(`[sync-worklog] refs-only PATCH succeeded: ${newCount} attachments → Planner`);
              } else {
                const rt = await refRes.text().catch(() => '');
                console.error(`[sync-worklog] refs-only PATCH failed (${refRes.status}): ${rt.slice(0, 200)}`);
              }
            }
          } catch (e: any) {
            console.error(`[sync-worklog] refs-only PATCH error: ${e?.message}`);
          }
        }

        // Step B: Run Dataverse flow for description + progress
        try {
          const dvResult = await this.syncViaDataverse(taskId, bodyForDataverse, token);
          return { ok: true, method: 'dataverse', plannerReferencesAdded, ...dvResult };
        } catch (dvErr: any) {
          console.error(`[sync-worklog] Dataverse fallback failed: ${dvErr?.message}`);
          throw new BadRequestException(
            `Planner Premium 업무 동기화 실패 (Graph 403 + Dataverse fallback): ${dvErr?.message || String(dvErr)}`,
          );
        }
      }
      if (patchRes.status === 403) {
        throw new BadRequestException(`Planner PATCH 403. 토큰 스코프: [${scopes}]. 응답: ${text.slice(0, 200)}`);
      }
      throw new BadRequestException(`업무일지 동기화 실패 (${patchRes.status}): ${text.slice(0, 300)}`);
    }

    // Update progress (percentComplete)
    let progressUpdated = false;
    let taskTitle = '';
    let planTitleGraph = '';
    try {
      const taskData: any = await this.graphGet(token, `/planner/tasks/${taskId}`);
      taskTitle = String(taskData?.title || '');
      const planId = String(taskData?.planId || '');
      if (planId) {
        const plan: any = await this.graphGet(token, `/planner/plans/${planId}`);
        planTitleGraph = String(plan?.title || '');
      }
      if (body.percentComplete !== undefined && body.percentComplete !== null) {
        // Small delay to let Graph API settle after description patch (etag conflict prevention)
        await new Promise(r => setTimeout(r, 1000));
        const taskRefresh: any = await this.graphGet(token, `/planner/tasks/${taskId}`);
        const taskEtag = taskRefresh?.['@odata.etag'] || '';
        if (!taskEtag) {
          console.error('[sync-worklog] progress update failed: no etag from task');
        } else {
          const progressRes = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'If-Match': taskEtag,
            },
            body: JSON.stringify({ percentComplete: body.percentComplete }),
          });
          if (!progressRes.ok) {
            const errText = await progressRes.text().catch(() => '');
            console.error(`[sync-worklog] progress update failed (${progressRes.status}): ${errText.slice(0, 300)}`);
          } else {
            progressUpdated = true;
          }
        }
      }
    } catch (e: any) {
      console.error(`[sync-worklog] post-patch task/plan fetch failed: ${e?.message}`);
    }

    const breadcrumb = [planTitleGraph, taskTitle].filter(Boolean).join(' > ');
    return { ok: true, method: 'graph', progressUpdated, breadcrumb, planTitle: planTitleGraph, taskTitle };
  }

  /**
   * Dataverse fallback for Planner Premium tasks (Graph PATCH returns 403).
   * Flow: Graph task/plan titles → Dataverse project/task match → OperationSet update.
   */
  private async syncViaDataverse(
    taskId: string,
    body: {
      userId: string;
      title: string;
      content: string;
      date?: string;
      percentComplete?: number;
      attachments?: Array<{ url: string; name: string }>;
    },
    graphToken: string,
  ): Promise<{
    dvTaskId: string;
    dvProjectId: string;
    opsetId: string;
    progressUpdated: boolean;
    breadcrumb: string;
    parents: Array<{ id: string; subject: string; outlineLevel?: number }>;
  }> {
    // 1. Look up user's email for impersonation
    const user = await (this.prisma as any).user.findUnique({
      where: { id: body.userId },
      select: { teamsUpn: true, email: true },
    });
    const email: string | undefined = user?.teamsUpn || user?.email;
    if (!email) throw new Error('사용자 이메일/UPN을 찾을 수 없음 (impersonation 불가)');

    // 2. Graph: fetch task to get title + planId
    const task: any = await this.graphGet(graphToken, `/planner/tasks/${taskId}`);
    const subject = String(task?.title || '').trim();
    const planId = String(task?.planId || '').trim();
    if (!subject) throw new Error('Planner 태스크 제목을 가져올 수 없음');
    if (!planId) throw new Error('Planner 태스크 planId를 가져올 수 없음');

    // 3. Graph: fetch plan title
    const plan: any = await this.graphGet(graphToken, `/planner/plans/${planId}`);
    const planTitle = String(plan?.title || '').trim();
    if (!planTitle) throw new Error('Planner plan 제목을 가져올 수 없음');

    // 4. Dataverse: match project by plan title
    const projects = await this.dataverse.findProjectsBySubject(planTitle);
    if (projects.length === 0) {
      throw new Error(`Dataverse에서 플랜과 일치하는 프로젝트 없음: "${planTitle}"`);
    }
    if (projects.length > 1) {
      throw new Error(
        `동일한 제목의 Dataverse 프로젝트가 ${projects.length}개 존재: "${planTitle}" — 식별 불가`,
      );
    }
    const projectId: string = projects[0].msdyn_projectid;

    // 5. Dataverse: match task by subject + projectId
    const dvTasks = await this.dataverse.findProjectTasksBySubject(subject, projectId);
    if (dvTasks.length === 0) {
      throw new Error(`Dataverse에서 일치하는 태스크 없음: "${subject}" (프로젝트: "${planTitle}")`);
    }
    if (dvTasks.length > 1) {
      throw new Error(
        `Dataverse 태스크가 ${dvTasks.length}개 매칭: "${subject}" — 식별 불가`,
      );
    }
    const dvTask: any = dvTasks[0];
    const dvTaskId: string = dvTask.msdyn_projecttaskid;

    // 6. Build description: existing Dataverse description + new entry (with OneDrive links).
    // Files stay on OneDrive — we only append the sharing URLs, no duplication.
    const existing = String(dvTask.msdyn_description || '').trim();
    const dateStr = body.date || new Date().toISOString().slice(0, 10);
    const attachmentLines = (body.attachments || [])
      .filter(a => a?.url)
      .map(a => `📎 ${a.name || '첨부파일'}: ${a.url}`)
      .join('\n');
    const newEntry = [
      `\n\n--- 업무일지 (${dateStr}) ---`,
      `제목: ${body.title || '(제목 없음)'}`,
      body.content || '',
      attachmentLines,
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
    const merged = existing ? `${existing}\n${newEntry}` : newEntry;
    const desc = merged.length > 30000 ? merged.slice(-30000) : merged;

    // 7. Look up systemuser for Execute impersonation (needs Project license + Write on msdyn_operationset).
    // If DATAVERSE_EXECUTOR_EMAIL is set, use that (single service user). Otherwise use the requesting user.
    const executorEmail = (process.env.DATAVERSE_EXECUTOR_EMAIL || email).trim();
    const sysuser = await this.dataverse.findSystemUserByEmail(executorEmail);
    const executorCallerId: string | undefined = sysuser?.systemuserid;
    if (!executorCallerId) {
      throw new Error(`Dataverse systemuser를 찾을 수 없음: ${executorEmail}`);
    }

    // 8. Build update fields (description + optional progress)
    const fields: { description?: string; progress?: number } = { description: desc };
    let progressUpdated = false;
    if (body.percentComplete !== undefined && body.percentComplete !== null) {
      // Planner percentComplete (0-100) → Dataverse msdyn_progress (0-1 decimal)
      fields.progress = Math.max(0, Math.min(1, Number(body.percentComplete) / 100));
      progressUpdated = true;
    }

    // 9. Execute OperationSet mixed-mode flow (description + progress)
    const res = await this.dataverse.updateProjectTaskViaOperationSet(
      dvTaskId,
      projectId,
      fields,
      { executorCallerId },
    );

    // 10. Build parent breadcrumb for traceability in the response
    const parents = await this.dataverse.buildTaskParentChain(dvTaskId).catch(() => []);
    const breadcrumb = [
      planTitle,
      ...parents.map(p => p.subject),
      subject,
    ]
      .filter(Boolean)
      .join(' > ');

    return {
      dvTaskId,
      dvProjectId: projectId,
      opsetId: res.opsetId,
      progressUpdated,
      breadcrumb,
      parents,
    };
  }

  /**
   * GET /api/graph-tasks/test-write?userId=xxx&taskId=xxx
   * Diagnostic: test if token can PATCH a Planner task (no-op update).
   */
  @Public()
  @Get('test-write')
  async testWrite(
    @Query('userId') userId: string,
    @Query('upn') upn: string,
    @Query('email') email: string,
    @Query('taskId') taskId: string,
  ) {
    if (!taskId) throw new BadRequestException('taskId required');
    let resolvedUserId = userId;
    if (!resolvedUserId && (upn || email)) {
      const key = (upn || email).trim().toLowerCase();
      const user = await (this.prisma as any).user.findFirst({
        where: {
          OR: [
            { teamsUpn: { equals: key, mode: 'insensitive' } },
            { email: { equals: key, mode: 'insensitive' } },
          ],
        },
        select: { id: true, teamsUpn: true, email: true, name: true },
      });
      if (!user) return { ok: false, error: `User not found for upn/email: ${key}` };
      resolvedUserId = user.id;
    }
    if (!resolvedUserId) throw new BadRequestException('userId or upn or email required');
    const token = await this.getGraphToken(resolvedUserId);
    const scopes = this.decodeTokenScopes(token);

    // Try GET task
    let task: any;
    try {
      task = await this.graphGet(token, `/planner/tasks/${taskId}`);
    } catch (e: any) {
      return { ok: false, step: 'GET task', error: e?.message, scopes };
    }

    // Try GET task details
    let details: any;
    try {
      details = await this.graphGet(token, `/planner/tasks/${taskId}/details`);
    } catch (e: any) {
      return { ok: false, step: 'GET task/details', error: e?.message, scopes };
    }

    const etag = details?.['@odata.etag'] || '';
    const desc = String(details?.description || '');

    // Try PATCH task details (append a space then trim — effectively no-op)
    const testDesc = desc.endsWith(' ') ? desc.trimEnd() : desc + ' ';
    const patchRes = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${taskId}/details`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: JSON.stringify({ description: testDesc }),
    });

    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '');
      return { ok: false, step: 'PATCH task/details', status: patchRes.status, error: text.slice(0, 500), scopes, etag: etag.slice(0, 30) };
    }

    return { ok: true, scopes, taskTitle: task?.title };
  }

  /**
   * GET /api/graph-tasks/plans?userId=xxx
   * List all plans the user has access to.
   */
  @Get('plans')
  async getPlans(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const token = await this.getGraphToken(userId);
    const data = await this.graphGet(token, '/me/planner/plans');
    const plans = (data?.value || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      createdDateTime: p.createdDateTime,
      owner: p.owner,
    }));
    return { plans };
  }

  // ─── Planner task creation ─────────────────────────────────

  /**
   * POST /api/graph-tasks/create-task
   * Create a new Planner task and assign it to a user.
   * Body: { userId, planId, title, assigneeUpn?, dueDate?, description? }
   */
  @Post('create-task')
  async createTask(
    @Body() body: {
      userId: string;
      planId: string;
      title: string;
      assigneeUpn?: string;
      dueDate?: string;
      description?: string;
    },
  ) {
    if (!body.userId || !body.planId || !body.title) {
      throw new BadRequestException('userId, planId, title required');
    }
    const token = await this.getGraphToken(body.userId);

    // Look up assignee's Azure AD user ID by UPN/email
    let assigneeAadId: string | null = null;
    if (body.assigneeUpn) {
      try {
        const userInfo: any = await this.graphGet(token, `/users/${encodeURIComponent(body.assigneeUpn)}?$select=id`);
        assigneeAadId = userInfo?.id || null;
      } catch {
        console.warn(`[create-task] Could not resolve UPN: ${body.assigneeUpn}`);
      }
    }

    // Build task payload
    const taskBody: any = {
      planId: body.planId,
      title: body.title,
    };
    if (body.dueDate) {
      taskBody.dueDateTime = new Date(body.dueDate).toISOString();
    }
    if (assigneeAadId) {
      taskBody.assignments = {
        [assigneeAadId]: {
          '@odata.type': '#microsoft.graph.plannerAssignment',
          orderHint: ' !',
        },
      };
    }

    // Create task
    const resp = await fetch('https://graph.microsoft.com/v1.0/planner/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskBody),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new BadRequestException(`태스크 생성 실패 (${resp.status}): ${errText.slice(0, 300)}`);
    }
    const task: any = await resp.json();

    // If description provided, update task details
    if (body.description && task.id) {
      try {
        await new Promise(r => setTimeout(r, 500));
        const details: any = await this.graphGet(token, `/planner/tasks/${task.id}/details`);
        const detailsEtag = details?.['@odata.etag'] || '';
        if (detailsEtag) {
          await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${task.id}/details`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'If-Match': detailsEtag,
            },
            body: JSON.stringify({ description: body.description }),
          });
        }
      } catch (e: any) {
        console.warn(`[create-task] description update failed: ${e?.message}`);
      }
    }

    return { ok: true, taskId: task.id, title: task.title };
  }

  // ─── OneDrive file browsing ─────────────────────────────────

  /**
   * GET /api/graph-tasks/onedrive/files?userId=xxx&folderId=root&search=keyword
   * Browse OneDrive files. folderId defaults to 'root'.
   */
  @Get('onedrive/files')
  async onedriveFiles(
    @Query('userId') userId: string,
    @Query('folderId') folderId?: string,
    @Query('search') search?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    const token = await this.getGraphToken(userId);

    let data: any;
    if (search && search.trim()) {
      // Search across all OneDrive files
      data = await this.graphGet(
        token,
        `/me/drive/root/search(q='${encodeURIComponent(search.trim())}')?$top=50&$select=id,name,size,lastModifiedDateTime,webUrl,folder,file&$orderby=lastModifiedDateTime desc`,
      );
    } else {
      // List children of a folder
      const folder = folderId && folderId !== 'root' ? `/me/drive/items/${encodeURIComponent(folderId)}` : '/me/drive/root';
      data = await this.graphGet(
        token,
        `${folder}/children?$top=100&$select=id,name,size,lastModifiedDateTime,webUrl,folder,file&$orderby=name asc`,
      );
    }

    const items = (data?.value || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      lastModified: f.lastModifiedDateTime,
      webUrl: f.webUrl,
      isFolder: !!f.folder,
      childCount: f.folder?.childCount,
      mimeType: f.file?.mimeType,
    }));
    return { items };
  }

  /**
   * POST /api/graph-tasks/onedrive/share-link
   * Create an organization-scoped sharing link so any colleague in the same
   * M365 tenant can open the file. Falls back to webUrl if createLink fails.
   */
  @Post('onedrive/share-link')
  async onedriveShareLink(
    @Body() body: { userId: string; fileId: string; fileName?: string },
  ) {
    if (!body.userId || !body.fileId) throw new BadRequestException('userId and fileId required');
    const token = await this.getGraphToken(body.userId);
    const fileId = encodeURIComponent(body.fileId);

    // Try createLink with organization scope (requires Files.ReadWrite.All)
    try {
      const f: any = (globalThis as any).fetch;
      const resp = await f(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/createLink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'view', scope: 'organization' }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const shareUrl = data?.link?.webUrl || '';
        if (shareUrl) {
          return { url: shareUrl, name: body.fileName || '' };
        }
      }
    } catch {
      // fall through to webUrl fallback
    }

    // Fallback: return file webUrl (owner-only access)
    const file: any = await this.graphGet(
      token,
      `/me/drive/items/${fileId}?$select=id,name,webUrl`,
    );
    const shareUrl = file?.webUrl || '';
    if (!shareUrl) {
      throw new BadRequestException('파일 URL을 가져올 수 없습니다.');
    }
    return { url: shareUrl, name: body.fileName || file?.name || '' };
  }
}
