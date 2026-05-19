import { Controller, Get, Post, Query, Body, Param, BadRequestException, UseGuards, Header, Req, Res } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * SharePoint file synchronization controller.
 * Integrates SharePoint files with the company data AI RAG system.
 */
@Controller('sharepoint-sync')
@UseGuards(JwtAuthGuard)
export class SharePointSyncController {
  constructor(private prisma: PrismaService) {}

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
      scope: 'openid profile email offline_access Tasks.ReadWrite Group.Read.All Files.ReadWrite.All Sites.Read.All',
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

  /**
   * GET /sharepoint-sync/site-id
   * Get SharePoint site ID from hostname and path.
   * Example: /sharepoint-sync/site-id?hostname=cams2002.sharepoint.com&sitePath=/sites/msteams_03d426
   */
  @Get('site-id')
  async getSiteId(@Query('userId') userId: string, @Query('hostname') hostname: string, @Query('sitePath') sitePath: string) {
    if (!userId) throw new BadRequestException('userId required');
    if (!hostname || !sitePath) throw new BadRequestException('hostname, sitePath required');

    const token = await this.getGraphToken(userId);
    const fetchFn: any = (globalThis as any).fetch;

    const resp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}?$select=id,name,webUrl`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`Failed to get site ID: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    return { id: data.id, name: data.name, webUrl: data.webUrl };
  }

  /**
   * GET /sharepoint-sync/files
   * List SharePoint files or list items from a given site.
   * Requires user's Graph access token.
   */
  @Get('files')
  async listSharePointFiles(
    @Query('userId') userId: string,
    @Query('siteId') siteId?: string,
    @Query('listName') listName?: string, // e.g., 'WorkReports'
    @Query('startDate') startDate?: string, // Filter by start date (ISO format)
    @Query('limit') limit?: string, // Limit number of items (default: 100)
  ) {
    if (!userId) throw new BadRequestException('userId required');

    const token = await this.getGraphToken(userId);

    // If siteId not provided, use default SharePoint site
    const targetSiteId = siteId || 'root';

    const fetchFn: any = (globalThis as any).fetch;
    const maxItems = limit ? parseInt(limit, 10) : 100; // Default to 100

    // If listName is provided, read list items; otherwise read drive files
    if (listName) {
      // Get list ID by name
      const listsResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/lists?$filter=displayName eq '${listName}'`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listsResp.ok) {
        const text = await listsResp.text().catch(() => '');
        throw new BadRequestException(`Failed to get list: ${listsResp.status} ${text}`);
      }
      const listsData = await listsResp.json();
      const list = listsData.value?.[0];
      if (!list) {
        throw new BadRequestException(`List '${listName}' not found`);
      }

      // Get list items using SharePoint Search API to avoid list view threshold
      // Search API can handle large lists better than list items API
      const searchUrl = `https://graph.microsoft.com/v1.0/search/query`;
      const searchBody = {
        requests: [{
          entityTypes: ['listItem'],
          query: {
            queryString: `path:"${list.webUrl}"` // Filter by specific list URL
          },
          from: 0,
          size: maxItems,
          sortProperties: [{
            name: 'Created',
            isDescending: true
          }]
        }]
      };

      const searchResp = await fetchFn(searchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchBody),
      });

      if (!searchResp.ok) {
        const text = await searchResp.text().catch(() => '');
        throw new BadRequestException(`Failed to search list items: ${searchResp.status} ${text}`);
      }

      const searchData = await searchResp.json();
      const items = (searchData.value?.[0]?.hitsContainers?.[0]?.hits || []).map((hit: any) => ({
        id: hit.resource.id,
        name: hit.resource.fields?.Title || hit.resource.id,
        webUrl: hit.resource.webUrl,
        fields: hit.resource.fields,
        lastModified: hit.resource.fields?.LastModifiedTime,
        created: hit.resource.fields?.Created,
      }));

      return { items, total: items.length, listId: list.id, listName: list.displayName };
    } else {
      // Read drive files with optional date filter and limit
      let filesUrl = `https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/root/children?$orderby=createdDateTime desc&$top=${maxItems}`;
      if (startDate) {
        filesUrl += `&$filter=createdDateTime ge '${startDate}'`;
      }

      const resp = await fetchFn(filesUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new BadRequestException(`Graph API error: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      const files = (data.value || [])
        .filter((item: any) => item.file && !item.folder) // Only files, not folders
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          webUrl: item.webUrl,
          size: item.size,
          lastModified: item.lastModifiedDateTime,
          created: item.createdDateTime,
        }));

      return { files, total: files.length };
    }
  }

  /**
   * POST /sharepoint-sync/sync
   * Sync a specific SharePoint file or list item to OpenAI vector store.
   */
  @Post('sync')
  async syncFile(
    @Body() body: {
      userId: string;
      siteId?: string;
      fileId: string;
      listId?: string; // Optional: if syncing from a SharePoint list
      title?: string;
      description?: string;
    },
  ) {
    if (!body.userId || !body.fileId) throw new BadRequestException('userId, fileId required');

    const token = await this.getGraphToken(body.userId);

    const targetSiteId = body.siteId || 'root';

    const fetchFn: any = (globalThis as any).fetch;

    let fileName: string;
    let content: string;
    let mimeType: string;
    let webUrl: string;

    // If listId is provided, sync from SharePoint List
    if (body.listId) {
      const itemResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/lists/${body.listId}/items/${body.fileId}?$expand=fields`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!itemResp.ok) {
        throw new BadRequestException(`Failed to get list item: ${itemResp.status}`);
      }
      const item = await itemResp.json();

      const fields = item.fields || {};
      fileName = (fields.Title || `item-${body.fileId}`).replace(/\.[^.]+$/, '') + '.txt';
      webUrl = item.webUrl || '';
      content = Object.entries(fields)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      mimeType = 'text/plain';
    } else {
      // Sync from Drive (existing logic)
      const metaResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/items/${body.fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!metaResp.ok) {
        throw new BadRequestException(`Failed to get file metadata: ${metaResp.status}`);
      }
      const metadata = await metaResp.json();

      const downloadResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/items/${body.fileId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!downloadResp.ok) {
        throw new BadRequestException(`Failed to download file: ${downloadResp.status}`);
      }
      const buffer = Buffer.from(await downloadResp.arrayBuffer());

      fileName = metadata.name || 'sharepoint-file';
      webUrl = metadata.webUrl || '';
      mimeType = metadata.file?.mimeType || 'application/octet-stream';

      if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        content = buffer.toString('utf-8');
      } else {
        content = buffer.toString('base64');
        mimeType = 'application/octet-stream';
      }
    }

    // Get OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) throw new BadRequestException('OpenAI API key not configured');

    // Upload file to OpenAI
    const blob = new Blob([content], { type: mimeType });
    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', blob, fileName);
    const fileResp = await fetchFn('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new BadRequestException(`OpenAI upload failed: ${fileResp.status} ${text}`);
    }
    const fileData = await fileResp.json();
    const openaiFileId = fileData.id;

    // Get or create vector store
    const vsName = 'company-data';
    let vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
    if (!vectorStoreId) {
      // List existing vector stores
      const vsListResp = await fetchFn('https://api.openai.com/v1/vector_stores?limit=100', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const vsList = await vsListResp.json();
      const existing = (vsList.data || []).find((v: any) => v.name === vsName);
      if (existing) {
        vectorStoreId = existing.id;
      } else {
        // Create new vector store
        const vsCreateResp = await fetchFn('https://api.openai.com/v1/vector_stores', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: vsName }),
        });
        const vsCreate = await vsCreateResp.json();
        vectorStoreId = vsCreate.id;
      }
    }

    // Add file to vector store
    await fetchFn(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: openaiFileId }),
    });

    // Wait for indexing
    const start = Date.now();
    let indexed = false;
    while (Date.now() - start < 60000) {
      const statusResp = await fetchFn(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${openaiFileId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const statusData = await statusResp.json();
      if (statusData.status === 'completed') {
        indexed = true;
        break;
      }
      if (statusData.status === 'failed' || statusData.status === 'cancelled') break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!indexed) {
      console.error(`[sharepoint-sync] indexing not completed`);
    }

    // Save to database
    const entry = await (this.prisma as any).companyData.create({
      data: {
        title: body.title || fileName,
        description: body.description || `SharePoint file from ${webUrl}`,
        fileUrl: webUrl,
        fileName,
        content: null,
        openaiFileId,
        uploadedById: body.userId,
      },
    });

    return { ok: true, entry, indexed };
  }

  /**
   * POST /sharepoint-sync/batch
   * Sync multiple SharePoint files at once with progress updates via SSE.
   */
  @Post('batch')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async syncBatch(
    @Body() body: {
      userId: string;
      siteId?: string;
      listId?: string; // Optional: if syncing from a SharePoint list
      fileIds: string[];
    },
    @Req() req: any,
    @Res() res: any,
  ) {
    if (!body.userId || !body.fileIds?.length) throw new BadRequestException('userId, fileIds required');

    const total = body.fileIds.length;
    let completed = 0;
    let success = 0;
    let failed = 0;
    const results = [];

    // Helper to send SSE event
    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for (const fileId of body.fileIds) {
        try {
          const result = await this.syncFile({
            userId: body.userId,
            siteId: body.siteId,
            listId: body.listId,
            fileId,
          });
          results.push({ fileId, ok: true, entryId: result.entry.id });
          success++;
        } catch (e: any) {
          console.error(`[sharepoint-sync] Failed to sync file ${fileId}:`, e?.message);
          results.push({ fileId, ok: false, error: e?.message || '알 수 없는 오류' });
          failed++;
        }
        completed++;

        // Send progress update
        sendEvent({
          type: 'progress',
          completed,
          total,
          success,
          failed,
          currentFileId: fileId,
        });
      }

      // Send final result
      sendEvent({
        type: 'complete',
        results,
        success,
        failed,
      });

      res.end();
    } catch (e: any) {
      sendEvent({
        type: 'error',
        message: e?.message || '알 수 없는 오류',
      });
      res.end();
    }
  }

  /**
   * POST /sharepoint-sync/import-worklog
   * SharePoint WorkReports 리스트에서 데이터를 가져와 업무일지로 등록
   * - 제목에 특정 문자열 포함
   * - 작성자가 비어있는 항목
   * - 가장 최근 항목
   */
  @Post('import-worklog')
  async importWorklogFromSharePoint(
    @Body() body: {
      userId: string; // Graph API 토큰을 가진 사용자
      siteId?: string; // SharePoint 사이트 ID (없으면 기본값 사용)
      listName?: string; // 리스트 이름 (기본: WorkReports)
      titleFilter?: string; // 제목 필터 (기본: 전날 조립 생산 데이터입니다)
      robotUserId?: string; // 로봇 사용자 ID (업무일지 작성자)
    },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');

    const token = await this.getGraphToken(body.userId);
    const fetchFn: any = (globalThis as any).fetch;

    // 기본값 설정
    const listName = body.listName || 'WorkReports';
    const titleFilter = body.titleFilter || '전날 조립 생산 데이터입니다';

    // 1. 사이트 ID 가져오기 (없으면 기본 사이트 사용)
    let targetSiteId = body.siteId;
    if (!targetSiteId) {
      // cams2002.sharepoint.com/sites/msteams_03d426 사이트 ID 조회
      const siteResp = await fetchFn(
        `https://graph.microsoft.com/v1.0/sites/cams2002.sharepoint.com:/sites/msteams_03d426?$select=id`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!siteResp.ok) {
        const text = await siteResp.text().catch(() => '');
        throw new BadRequestException(`Failed to get site ID: ${siteResp.status} ${text}`);
      }
      const siteData = await siteResp.json();
      targetSiteId = siteData.id;
    }

    // 2. 리스트 ID 조회
    const listsResp = await fetchFn(
      `https://graph.microsoft.com/v1.0/sites/${targetSiteId}/lists?$filter=displayName eq '${listName}'`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listsResp.ok) {
      const text = await listsResp.text().catch(() => '');
      throw new BadRequestException(`Failed to get list: ${listsResp.status} ${text}`);
    }
    const listsData = await listsResp.json();
    const list = listsData.value?.[0];
    if (!list) {
      throw new BadRequestException(`List '${listName}' not found`);
    }

    // 3. 리스트 아이템 조회 (최근 10개)
    const itemsResp = await fetchFn(
      `https://graph.microsoft.com/v1.0/sites/${targetSiteId}/lists/${list.id}/items?$expand=fields&$orderby=createdDateTime desc&$top=10`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!itemsResp.ok) {
      const text = await itemsResp.text().catch(() => '');
      throw new BadRequestException(`Failed to get list items: ${itemsResp.status} ${text}`);
    }
    const itemsData = await itemsResp.json();
    const items = itemsData.value || [];

    // 4. 필터링: 제목 포함 + 작성자 비어있음
    const filtered = items.filter((item: any) => {
      const title = item.fields?.Title || '';
      const author = item.fields?.Author || item.fields?.['작성자'] || '';
      return title.includes(titleFilter) && (!author || author.trim() === '');
    });

    if (filtered.length === 0) {
      return { success: false, message: `조건에 맞는 항목 없음 (제목: "${titleFilter}", 작성자: 비어있음)`, itemsChecked: items.length };
    }

    // 5. 가장 최근 항목 선택
    const latestItem = filtered[0];
    const fields = latestItem.fields || {};

    // 6. 로봇 사용자 찾기/생성
    let robotUser = await this.prisma.user.findFirst({ where: { name: '로봇' } });
    if (!robotUser && body.robotUserId) {
      robotUser = await this.prisma.user.findUnique({ where: { id: body.robotUserId } });
    }
    if (!robotUser) {
      // 로봇 사용자가 없으면 생성
      robotUser = await this.prisma.user.create({
        data: {
          name: '로봇',
          email: 'robot@workwork.local',
          role: 'INDIVIDUAL' as any,
        },
      });
    }

    // 7. 팀/OKR 구조 확인
    let team: any = null;
    if (robotUser.orgUnitId) {
      team = await this.prisma.orgUnit.findUnique({ where: { id: robotUser.orgUnitId } });
    }
    if (!team) {
      team = await this.prisma.orgUnit.findFirst({ where: { name: '자동화', type: 'TEAM' } });
      if (!team) {
        team = await this.prisma.orgUnit.create({ data: { name: '자동화', type: 'TEAM' } });
      }
      await this.prisma.user.update({ where: { id: robotUser.id }, data: { orgUnitId: team.id } });
    }

    // OKR 구조 생성
    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + 365 * 24 * 60 * 60 * 1000);
    let objective = await this.prisma.objective.findFirst({ where: { title: `Auto Objective - ${team.name}`, orgUnitId: team.id } });
    if (!objective) {
      objective = await this.prisma.objective.create({
        data: { title: `Auto Objective - ${team.name}`, orgUnitId: team.id, ownerId: robotUser.id, periodStart, periodEnd, status: 'ACTIVE' as any },
      });
    }
    let kr = await this.prisma.keyResult.findFirst({ where: { title: 'Auto KR', objectiveId: objective.id } });
    if (!kr) {
      kr = await this.prisma.keyResult.create({
        data: { title: 'Auto KR', metric: 'count', target: 1, unit: 'ea', ownerId: robotUser.id, objectiveId: objective.id },
      });
    }
    let initiative = await this.prisma.initiative.findFirst({ where: { title: '[SharePoint] 자동 업무', keyResultId: kr.id, ownerId: robotUser.id } });
    if (!initiative) {
      initiative = await this.prisma.initiative.create({ data: { title: '[SharePoint] 자동 업무', keyResultId: kr.id, ownerId: robotUser.id, state: 'ACTIVE' as any } });
    }

    // 8. 업무일지 생성
    const title = fields.Title || '제목 없음';
    const content = fields['내용'] || fields.OData__x0020__xb0b4__xc6a9_ || fields.Content || '';
    const notes = fields.Notes || fields['메모'] || '';
    const fullNote = `${title}\n\n${content}${notes ? `\n\n---\nNotes:\n${notes}` : ''}`;

    // 날짜 파싱
    let dateVal = new Date();
    const workStartTime = fields['업무시작시간'] || fields.WorkStartTime || latestItem.createdDateTime;
    if (workStartTime) {
      const parsed = new Date(workStartTime);
      if (!isNaN(parsed.getTime())) {
        dateVal = parsed;
      }
    }

    const wl = await this.prisma.worklog.create({
      data: {
        initiativeId: initiative.id,
        createdById: robotUser.id,
        note: fullNote,
        timeSpentMinutes: 0,
        date: dateVal,
        visibility: 'ALL' as any,
        structuredData: {
          source: 'SharePoint',
          listName,
          itemId: latestItem.id,
          importedAt: new Date().toISOString(),
        },
      },
    });

    await this.prisma.event.create({
      data: {
        subjectType: 'Worklog',
        subjectId: wl.id,
        activity: 'WorklogCreated',
        userId: robotUser.id,
        attrs: { source: 'SharePoint', listName, itemId: latestItem.id },
      },
    });

    return {
      success: true,
      worklogId: wl.id,
      title,
      content: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
      notes: notes.slice(0, 100) + (notes.length > 100 ? '...' : ''),
      date: dateVal.toISOString(),
      robotUserId: robotUser.id,
      sharePointItemId: latestItem.id,
    };
  }
}
