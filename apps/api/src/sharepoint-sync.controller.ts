import { Controller, Get, Post, Query, Body, Param, BadRequestException, UseGuards } from '@nestjs/common';
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
  ) {
    if (!userId) throw new BadRequestException('userId required');

    const token = await this.getGraphToken(userId);

    // If siteId not provided, use default SharePoint site
    const targetSiteId = siteId || 'root';

    const fetchFn: any = (globalThis as any).fetch;

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

      // Get list items with optional date filter
      let itemsUrl = `https://graph.microsoft.com/v1.0/sites/${targetSiteId}/lists/${list.id}/items?$expand=fields`;
      if (startDate) {
        // Filter by created date (adjust field name based on your SharePoint list)
        itemsUrl += `&$filter=fields/Created ge '${startDate}'`;
      }

      const itemsResp = await fetchFn(itemsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!itemsResp.ok) {
        const text = await itemsResp.text().catch(() => '');
        throw new BadRequestException(`Failed to get list items: ${itemsResp.status} ${text}`);
      }
      const itemsData = await itemsResp.json();
      const items = (itemsData.value || []).map((item: any) => ({
        id: item.id,
        name: item.fields?.Title || item.id,
        webUrl: item.webUrl,
        fields: item.fields,
        lastModified: item.lastModifiedDateTime,
        created: item.createdDateTime,
      }));

      return { items, total: items.length, listId: list.id, listName: list.displayName };
    } else {
      // Read drive files with optional date filter
      let filesUrl = `https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/root/children`;
      if (startDate) {
        filesUrl += `?$filter=createdDateTime ge '${startDate}'`;
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
   * Sync a specific SharePoint file to OpenAI vector store.
   */
  @Post('sync')
  async syncFile(
    @Body() body: {
      userId: string;
      siteId?: string;
      fileId: string;
      title?: string;
      description?: string;
    },
  ) {
    if (!body.userId || !body.fileId) throw new BadRequestException('userId, fileId required');

    const token = await this.getGraphToken(body.userId);

    const targetSiteId = body.siteId || 'root';

    const fetchFn: any = (globalThis as any).fetch;

    // Get file metadata
    const metaResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/items/${body.fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaResp.ok) {
      throw new BadRequestException(`Failed to get file metadata: ${metaResp.status}`);
    }
    const metadata = await metaResp.json();

    // Download file content
    const downloadResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/items/${body.fileId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!downloadResp.ok) {
      throw new BadRequestException(`Failed to download file: ${downloadResp.status}`);
    }
    const buffer = Buffer.from(await downloadResp.arrayBuffer());

    // Upload to OpenAI vector store
    const fileName = metadata.name || 'sharepoint-file';
    const mimeType = metadata.file?.mimeType || 'application/octet-stream';

    // Get OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) throw new BadRequestException('OpenAI API key not configured');

    // Upload file to OpenAI
    const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
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
        title: body.title || metadata.name,
        description: body.description || `SharePoint file from ${metadata.webUrl}`,
        fileUrl: metadata.webUrl,
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
   * Sync multiple SharePoint files at once.
   */
  @Post('batch')
  async syncBatch(
    @Body() body: {
      userId: string;
      siteId?: string;
      fileIds: string[];
    },
  ) {
    if (!body.userId || !body.fileIds?.length) throw new BadRequestException('userId, fileIds required');

    const results = [];
    for (const fileId of body.fileIds) {
      try {
        const result = await this.syncFile({
          userId: body.userId,
          siteId: body.siteId,
          fileId,
        });
        results.push({ fileId, ok: true, entryId: result.entry.id });
      } catch (e: any) {
        console.error(`[sharepoint-sync] Failed to sync file ${fileId}:`, e?.message);
        results.push({ fileId, ok: false, error: e?.message || '알 수 없는 오류' });
      }
    }

    return { results, success: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }
}
