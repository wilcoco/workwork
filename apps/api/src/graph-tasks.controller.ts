import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Microsoft Graph API proxy for Teams Planner / To-Do Tasks.
 *
 * Token flow:
 *  1. User logs in via Entra SSO → access_token + refresh_token stored on User row
 *  2. This controller reads the token, refreshes if expired, and proxies Graph calls
 */

@Controller('graph-tasks')
export class GraphTasksController {
  constructor(private prisma: PrismaService) {}

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
      scope: 'openid profile email offline_access Tasks.ReadWrite Group.Read.All Files.Read.All',
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
      throw new BadRequestException(`업무일지 동기화 실패 (${patchRes.status}): ${text.slice(0, 300)}`);
    }

    // Update progress (percentComplete)
    let progressUpdated = false;
    if (body.percentComplete !== undefined && body.percentComplete !== null) {
      // Small delay to let Graph API settle after description patch (etag conflict prevention)
      await new Promise(r => setTimeout(r, 1000));
      const taskData: any = await this.graphGet(token, `/planner/tasks/${taskId}`);
      const taskEtag = taskData?.['@odata.etag'] || '';
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

    return { ok: true, progressUpdated };
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
   * Get the webUrl for a OneDrive file (same-org users can access).
   * Falls back to webUrl from file metadata (no write permission needed).
   */
  @Post('onedrive/share-link')
  async onedriveShareLink(
    @Body() body: { userId: string; fileId: string; fileName?: string },
  ) {
    if (!body.userId || !body.fileId) throw new BadRequestException('userId and fileId required');
    const token = await this.getGraphToken(body.userId);

    // Get file metadata (webUrl) — read-only, no Files.ReadWrite needed
    const file: any = await this.graphGet(
      token,
      `/me/drive/items/${encodeURIComponent(body.fileId)}?$select=id,name,webUrl`,
    );
    const shareUrl = file?.webUrl || '';
    if (!shareUrl) {
      throw new BadRequestException('파일 URL을 가져올 수 없습니다.');
    }
    return { url: shareUrl, name: body.fileName || file?.name || '' };
  }
}
