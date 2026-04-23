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

  /**
   * GET /sharepoint-sync/files
   * List SharePoint files from a given site.
   * Requires user's Graph access token.
   */
  @Get('files')
  async listSharePointFiles(@Query('userId') userId: string, @Query('siteId') siteId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { graphAccessToken: true, graphRefreshToken: true, graphTokenExpiry: true },
    });
    if (!user?.graphAccessToken) throw new BadRequestException('Graph access token not found');

    // If siteId not provided, use default SharePoint site
    const targetSiteId = siteId || 'root';

    const fetchFn: any = (globalThis as any).fetch;
    const resp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/root/children`, {
      headers: { Authorization: `Bearer ${user.graphAccessToken}` },
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
    
    const user = await this.prisma.user.findUnique({
      where: { id: body.userId },
      select: { graphAccessToken: true, graphRefreshToken: true, graphTokenExpiry: true },
    });
    if (!user?.graphAccessToken) throw new BadRequestException('Graph access token not found');

    const targetSiteId = body.siteId || 'root';

    const fetchFn: any = (globalThis as any).fetch;

    // Get file metadata
    const metaResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/items/${body.fileId}`, {
      headers: { Authorization: `Bearer ${user.graphAccessToken}` },
    });
    if (!metaResp.ok) {
      throw new BadRequestException(`Failed to get file metadata: ${metaResp.status}`);
    }
    const metadata = await metaResp.json();

    // Download file content
    const downloadResp = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${targetSiteId}/drive/items/${body.fileId}/content`, {
      headers: { Authorization: `Bearer ${user.graphAccessToken}` },
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
        results.push({ fileId, ok: false, error: e?.message });
      }
    }
    
    return { results, success: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }
}
