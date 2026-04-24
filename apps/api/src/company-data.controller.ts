import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Body,
  Param,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import * as XLSX from 'xlsx';

const ASSISTANT_INSTRUCTIONS = `당신은 회사의 통계 및 경영 데이터를 분석하는 전문가입니다.
업로드된 회사 자료를 바탕으로 사용자의 질문에 정확하고 구체적으로 답변하세요.
- file_search를 활용하여 업로드된 파일에서 정보를 찾으세요.
- 자료에 없는 내용은 추측하지 마세요. "제공된 자료에는 해당 정보가 없습니다"라고 답하세요.
- 숫자나 통계를 인용할 때는 정확한 값을 사용하세요.
- 가능하면 표 형태로 비교/정리해주세요.
- 한국어로 답변하세요.`;

const VECTOR_STORE_NAME = 'company-data';
const ASSISTANT_NAME = '회사 데이터 분석';

@Controller('company-data')
export class CompanyDataController {
  // In-process caches so we don't re-query OpenAI every call.
  // Also survives lack of env vars across a single Railway container lifetime.
  private static cachedVectorStoreId: string | null = null;
  private static cachedAssistantId: string | null = null;

  constructor(private prisma: PrismaService) {}

  private getApiKey(): string {
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!key) throw new BadRequestException('Missing OPENAI_API_KEY');
    return key;
  }

  private async oai(path: string, opts: { method?: string; body?: any; formData?: any } = {}): Promise<any> {
    const f: any = (globalThis as any).fetch;
    const headers: any = { Authorization: `Bearer ${this.getApiKey()}`, 'OpenAI-Beta': 'assistants=v2' };
    let reqBody: any;
    if (opts.formData) {
      reqBody = opts.formData; // FormData — fetch sets Content-Type automatically
    } else if (opts.body) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(opts.body);
    }
    const resp = await f(`https://api.openai.com/v1${path}`, {
      method: opts.method || 'GET',
      headers,
      ...(reqBody ? { body: reqBody } : {}),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`OpenAI ${path}: ${resp.status} ${text.slice(0, 300)}`);
    }
    return resp.json();
  }

  // ─── Assistants / Vector Store helpers ─────────────────

  private async ensureVectorStore(): Promise<string> {
    // 1. Env var takes priority
    const envId = process.env.OPENAI_VECTOR_STORE_ID;
    if (envId) return envId;
    // 2. In-process cache
    if (CompanyDataController.cachedVectorStoreId) return CompanyDataController.cachedVectorStoreId;
    // 3. Find existing by name (so we don't create duplicates across restarts)
    try {
      const list = await this.oai('/vector_stores?limit=100');
      const found = (list?.data || []).find((v: any) => v?.name === VECTOR_STORE_NAME);
      if (found?.id) {
        console.log(`[company-data] Reusing existing vector store: ${found.id}`);
        CompanyDataController.cachedVectorStoreId = found.id;
        return found.id;
      }
    } catch (e: any) {
      console.error(`[company-data] Failed to list vector stores: ${e?.message}`);
    }
    // 4. Create a new one
    const vs = await this.oai('/vector_stores', {
      method: 'POST',
      body: { name: VECTOR_STORE_NAME },
    });
    console.log(`[company-data] Created vector store: ${vs.id} — consider setting OPENAI_VECTOR_STORE_ID env var`);
    CompanyDataController.cachedVectorStoreId = vs.id;
    return vs.id;
  }

  private async ensureAssistant(vectorStoreId: string): Promise<string> {
    const envId = process.env.OPENAI_ASSISTANT_ID;
    if (envId) return envId;
    if (CompanyDataController.cachedAssistantId) return CompanyDataController.cachedAssistantId;
    // Find existing by name
    try {
      const list = await this.oai('/assistants?limit=100&order=desc');
      const found = (list?.data || []).find((a: any) => a?.name === ASSISTANT_NAME);
      if (found?.id) {
        console.log(`[company-data] Reusing existing assistant: ${found.id}`);
        // Always update model to gpt-4-turbo for better quality
        if (found.model !== 'gpt-4-turbo') {
          console.log(`[company-data] Updating assistant model from ${found.model} to gpt-4-turbo`);
          try {
            await this.oai(`/assistants/${found.id}`, {
              method: 'PATCH',
              body: { model: 'gpt-4-turbo' },
            });
          } catch (e: any) {
            console.error(`[company-data] Failed to update assistant model: ${e?.message}`);
          }
        }
        CompanyDataController.cachedAssistantId = found.id;
        return found.id;
      }
    } catch (e: any) {
      console.error(`[company-data] Failed to list assistants: ${e?.message}`);
    }
    const assistant = await this.oai('/assistants', {
      method: 'POST',
      body: {
        model: 'gpt-4-turbo',
        name: ASSISTANT_NAME,
        instructions: ASSISTANT_INSTRUCTIONS,
        tools: [{ type: 'file_search' }],
        tool_resources: {
          file_search: { vector_store_ids: [vectorStoreId] },
        },
      },
    });
    console.log(`[company-data] Created assistant: ${assistant.id} — consider setting OPENAI_ASSISTANT_ID env var`);
    CompanyDataController.cachedAssistantId = assistant.id;
    return assistant.id;
  }

  // ─── Upload file to OpenAI via OneDrive download ───────

  private async downloadOneDriveFile(userId: string, fileUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { graphAccessToken: true },
      });
      if (!user?.graphAccessToken) return null;
      // Try to get download URL from the share link
      const f: any = (globalThis as any).fetch;
      // Direct download from webUrl won't work; try using the file's driveItem
      // We'll just return null for now — the content field fallback handles it
      return null;
    } catch {
      return null;
    }
  }

  private async uploadFileToOpenAI(fileName: string, content: string): Promise<string> {
    const blob = new Blob([content], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', blob, fileName.endsWith('.txt') ? fileName : `${fileName}.txt`);
    const result = await this.oai('/files', { method: 'POST', formData });
    return result.id;
  }

  /** Upload binary file buffer (PDF/DOCX/PPTX/CSV/etc.) directly to OpenAI for file_search RAG. */
  private async uploadBinaryToOpenAI(fileName: string, mimeType: string, buffer: Buffer): Promise<string> {
    // @ts-ignore – Node 18+ has Blob global
    const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', blob, fileName);
    const result = await this.oai('/files', { method: 'POST', formData });
    return result.id;
  }

  /** Convert Excel buffer to CSV string using xlsx library, with merged cell values replicated. */
  private excelBufferToCsv(buffer: Buffer, fileName: string): { csv: string; csvFileName: string } {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new BadRequestException('Excel 파일에 시트가 없습니다.');
      }
      const worksheet = workbook.Sheets[sheetName];

      // Handle merged cells: replicate the merged value to all cells in the range
      const merges = worksheet['!merges'] || [];
      if (merges.length > 0) {
        console.log(`[company-data] Processing ${merges.length} merged cell ranges`);
        for (const merge of merges) {
          const { s: start, e: end } = merge; // start and end {r: row, c: col}
          const topLeftCell = worksheet[XLSX.utils.encode_cell(start)];
          if (!topLeftCell) continue;
          const mergedValue = topLeftCell.v;

          // Fill all cells in the merge range with the merged value
          for (let r = start.r; r <= end.r; r++) {
            for (let c = start.c; c <= end.c; c++) {
              const cellRef = XLSX.utils.encode_cell({ r, c });
              if (!worksheet[cellRef]) {
                worksheet[cellRef] = { t: 's', v: mergedValue };
              } else {
                worksheet[cellRef].v = mergedValue;
              }
            }
          }
        }
      }

      const csv = XLSX.utils.sheet_to_csv(worksheet);
      const csvFileName = fileName.replace(/\.[^.]+$/, '.csv');
      console.log(`[company-data] Excel to CSV conversion complete: ${csvFileName} (${csv.length} bytes)`);
      return { csv, csvFileName };
    } catch (e: any) {
      console.error('[company-data] Excel to CSV conversion failed:', e?.message);
      throw new BadRequestException(`Excel 파일 변환 실패: ${e?.message || '알 수 없는 오류'}`);
    }
  }

  /** Normalize xlsx → csv is done here; OpenAI assistants file_search accepts many formats
   * (pdf, docx, pptx, txt, md, csv, json, html, xml, + code files).
   * xlsx is now supported by auto-converting to CSV.
   */
  private assertSupportedForFileSearch(fileName: string): void {
    const ext = (fileName.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1] || '').toLowerCase();
    const supported = new Set([
      'pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md', 'html', 'htm',
      'csv', 'json', 'xml', 'tex', 'rtf',
      'c', 'cpp', 'cs', 'java', 'js', 'ts', 'py', 'rb', 'go', 'php', 'sh',
      'xlsx', 'xls', 'xlsm', // Excel files (auto-converted to CSV)
    ]);
    if (!supported.has(ext)) {
      throw new BadRequestException(
        `지원하지 않는 파일 형식입니다 (.${ext}). OpenAI file_search는 PDF, Word(docx), PowerPoint(pptx), CSV, TXT, MD, JSON, Excel(xlsx) 등을 지원합니다.`,
      );
    }
  }

  private async addFileToVectorStore(vectorStoreId: string, fileId: string): Promise<void> {
    await this.oai(`/vector_stores/${vectorStoreId}/files`, {
      method: 'POST',
      body: { file_id: fileId },
    });
  }

  /** Poll vector store file status until 'completed' or timeout. Required before the assistant can find the content. */
  private async waitForVectorStoreFile(vectorStoreId: string, fileId: string, timeoutMs = 90_000): Promise<{ status: string; lastError?: any }> {
    const start = Date.now();
    let last: any = null;
    while (Date.now() - start < timeoutMs) {
      try {
        last = await this.oai(`/vector_stores/${vectorStoreId}/files/${fileId}`);
        const status = String(last?.status || '');
        if (status === 'completed') return { status };
        if (status === 'failed' || status === 'cancelled') return { status, lastError: last?.last_error };
      } catch (e: any) {
        last = { error: e?.message };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { status: String(last?.status || 'timeout'), lastError: last?.last_error };
  }

  /** Ensure the assistant has the given vector store linked under its file_search tool_resources.
   *  If OPENAI_ASSISTANT_ID points to an older assistant that was created without the current vector store,
   *  this fixes it on the fly. Without this, file_search returns nothing. */
  private async ensureAssistantHasVectorStore(assistantId: string, vectorStoreId: string): Promise<void> {
    try {
      const a = await this.oai(`/assistants/${assistantId}`);
      const linked: string[] = a?.tool_resources?.file_search?.vector_store_ids || [];
      if (linked.includes(vectorStoreId)) return;
      const hasFileSearchTool = Array.isArray(a?.tools) && a.tools.some((t: any) => t?.type === 'file_search');
      const nextTools = hasFileSearchTool ? a.tools : [...(a?.tools || []), { type: 'file_search' }];
      await this.oai(`/assistants/${assistantId}`, {
        method: 'POST',
        body: {
          tools: nextTools,
          tool_resources: {
            file_search: { vector_store_ids: [...new Set([...linked, vectorStoreId])] },
          },
        },
      });
      console.log(`[company-data] linked vector store ${vectorStoreId} → assistant ${assistantId}`);
    } catch (e: any) {
      console.error(`[company-data] ensureAssistantHasVectorStore failed: ${e?.message}`);
    }
  }

  private async removeFileFromOpenAI(fileId: string): Promise<void> {
    try {
      await this.oai(`/files/${fileId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  // ─── CRUD ──────────────────────────────────────────────

  @Get()
  async list() {
    return this.prisma.companyData.findMany({
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  @Post()
  async create(@Body() body: {
    title: string;
    description?: string;
    fileUrl: string;
    fileName: string;
    content?: string;
    uploadedById: string;
  }) {
    if (!body.title || !body.uploadedById) {
      throw new BadRequestException('title, uploadedById required');
    }

    let openaiFileId: string | null = null;
    const textContent = (body.content || '').trim();

    // If we have text content, upload it to OpenAI
    if (textContent) {
      try {
        const vsId = await this.ensureVectorStore();
        openaiFileId = await this.uploadFileToOpenAI(body.fileName || body.title, textContent);
        await this.addFileToVectorStore(vsId, openaiFileId);
      } catch (e: any) {
        console.error('[company-data] OpenAI upload failed:', e?.message);
        // Continue without OpenAI — content is still saved in DB
      }
    }

    return this.prisma.companyData.create({
      data: {
        title: body.title,
        description: body.description || null,
        fileUrl: body.fileUrl || '',
        fileName: body.fileName || body.title,
        content: textContent || null,
        openaiFileId,
        uploadedById: body.uploadedById,
      },
    });
  }

  /**
   * POST /company-data/upload — multipart upload (file binary + metadata fields)
   * Fields: title, description?, uploadedById, and 'file' (binary)
   * The file binary is streamed directly to OpenAI for file_search RAG.
   * Supported: PDF, DOCX, PPTX, CSV, TXT, MD, JSON, HTML, XML, Excel(xlsx/xls/xlsm), + common source files.
   * Excel files are auto-converted to CSV before upload.
   * NOT supported: images (use text extraction first).
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string; description?: string; uploadedById?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!body.uploadedById) throw new BadRequestException('uploadedById required');
    const title = (body.title || file.originalname || '').trim();
    if (!title) throw new BadRequestException('title required');

    // Decode latin1 → utf-8 (multer quirk for Korean filenames)
    let fileName = file.originalname || '';
    try {
      fileName = Buffer.from(fileName, 'latin1').toString('utf-8');
    } catch {}
    this.assertSupportedForFileSearch(fileName);

    const vsId = await this.ensureVectorStore();

    // Handle Excel files by converting to CSV
    const ext = (fileName.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1] || '').toLowerCase();
    let uploadFileName = fileName;
    let uploadBuffer = file.buffer;
    let uploadMimeType = file.mimetype;

    if (['xlsx', 'xls', 'xlsm'].includes(ext)) {
      console.log(`[company-data] Converting Excel file ${fileName} to CSV`);
      const { csv, csvFileName } = this.excelBufferToCsv(file.buffer, fileName);
      uploadFileName = csvFileName;
      uploadBuffer = Buffer.from(csv, 'utf-8');
      uploadMimeType = 'text/csv';
      console.log(`[company-data] Converted to CSV: ${csvFileName} (${csv.length} bytes)`);
    }

    const openaiFileId = await this.uploadBinaryToOpenAI(uploadFileName, uploadMimeType, uploadBuffer);
    await this.addFileToVectorStore(vsId, openaiFileId);

    // Wait for OpenAI to finish chunking + embedding the file, otherwise the assistant won't find it.
    const indexed = await this.waitForVectorStoreFile(vsId, openaiFileId);
    if (indexed.status !== 'completed') {
      console.error(`[company-data] upload ${fileName} indexing not completed: status=${indexed.status} error=${JSON.stringify(indexed.lastError || {})}`);
    }

    // Make sure the existing assistant (if env-configured) is actually linked to this vector store.
    const assistantIdEnv = process.env.OPENAI_ASSISTANT_ID;
    if (assistantIdEnv) {
      await this.ensureAssistantHasVectorStore(assistantIdEnv, vsId);
    }

    return this.prisma.companyData.create({
      data: {
        title,
        description: body.description || null,
        fileUrl: '',
        fileName,
        content: null, // binary — content kept in OpenAI vector store
        openaiFileId,
        uploadedById: body.uploadedById,
      },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.prisma.companyData.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('not found');

    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.fileUrl !== undefined) data.fileUrl = body.fileUrl;
    if (body.fileName !== undefined) data.fileName = body.fileName;

    // If content changed, re-upload to OpenAI
    if (body.content !== undefined && body.content !== existing.content) {
      data.content = body.content;
      try {
        // Remove old file
        if (existing.openaiFileId) {
          await this.removeFileFromOpenAI(existing.openaiFileId);
        }
        // Upload new
        if (body.content?.trim()) {
          const vsId = await this.ensureVectorStore();
          const newFileId = await this.uploadFileToOpenAI(
            existing.fileName || existing.title,
            body.content,
          );
          await this.addFileToVectorStore(vsId, newFileId);
          data.openaiFileId = newFileId;
        } else {
          data.openaiFileId = null;
        }
      } catch (e: any) {
        console.error('[company-data] OpenAI re-upload failed:', e?.message);
      }
    }

    return this.prisma.companyData.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.companyData.findUnique({ where: { id } });
    if (existing?.openaiFileId) {
      await this.removeFileFromOpenAI(existing.openaiFileId);
    }
    await this.prisma.companyData.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Diagnostics ───────────────────────────────────────

  /**
   * GET /company-data/openai-account
   * Identifies which OpenAI account/organization/project the configured API key belongs to.
   * Also calls a cheap endpoint (/models) to confirm the key actually works and surface org/project headers.
   */
  @Public()
  @Get('openai-account')
  async openaiAccount() {
    const f: any = (globalThis as any).fetch;
    const picks = [
      { name: 'OPENAI_API_KEY', key: process.env.OPENAI_API_KEY },
      { name: 'OPENAI_API_KEY_CAMS', key: process.env.OPENAI_API_KEY_CAMS },
      { name: 'OPENAI_API_KEY_IAT', key: process.env.OPENAI_API_KEY_IAT },
    ].filter((p) => !!p.key);

    const results: any[] = [];
    for (const p of picks) {
      const prefix = (p.key || '').slice(0, 10);
      const suffix = (p.key || '').slice(-4);
      const entry: any = { envVar: p.name, keyPrefix: `${prefix}...${suffix}` };
      try {
        // /v1/me is undocumented but returns user info when the key is a user key.
        const meResp = await f('https://api.openai.com/v1/me', {
          headers: { Authorization: `Bearer ${p.key}` },
        });
        if (meResp.ok) entry.me = await meResp.json();
        else entry.meError = `${meResp.status} ${(await meResp.text().catch(() => '')).slice(0, 200)}`;
      } catch (e: any) {
        entry.meError = e?.message;
      }
      try {
        // /v1/organization/me — newer endpoint for org info
        const orgResp = await f('https://api.openai.com/v1/organization', {
          headers: { Authorization: `Bearer ${p.key}` },
        });
        if (orgResp.ok) entry.organization = await orgResp.json();
        else entry.organizationError = `${orgResp.status}`;
      } catch {}
      try {
        // /v1/models — always works with any valid key; response headers expose org id
        const modelsResp = await f('https://api.openai.com/v1/models?limit=1', {
          headers: { Authorization: `Bearer ${p.key}` },
        });
        entry.modelsStatus = modelsResp.status;
        entry.headers = {
          'openai-organization': modelsResp.headers.get('openai-organization'),
          'openai-project': modelsResp.headers.get('openai-project'),
          'openai-processing-ms': modelsResp.headers.get('openai-processing-ms'),
        };
      } catch (e: any) {
        entry.modelsError = e?.message;
      }
      results.push(entry);
    }

    return { count: results.length, keys: results };
  }

  /**
   * GET /company-data/debug
   * Returns the current vector store + assistant + file list so we can see why AI says "모른다".
   * Use this when user uploads a file but AI can't find it.
   */
  @Public()
  @Get('debug')
  async debug() {
    const out: any = {
      env: {
        OPENAI_VECTOR_STORE_ID: process.env.OPENAI_VECTOR_STORE_ID || null,
        OPENAI_ASSISTANT_ID: process.env.OPENAI_ASSISTANT_ID || null,
        hasApiKey: !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT),
      },
      db: {
        total: await this.prisma.companyData.count(),
        withOpenaiFileId: await this.prisma.companyData.count({ where: { openaiFileId: { not: null } } }),
        recent: await this.prisma.companyData.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, title: true, fileName: true, openaiFileId: true, content: true, createdAt: true },
        }).then((rows) => rows.map((r) => ({ ...r, hasContent: !!r.content, content: undefined }))),
      },
    };
    try {
      const vsId = await this.ensureVectorStore();
      out.vectorStore = { id: vsId };
      try {
        const vs = await this.oai(`/vector_stores/${vsId}`);
        out.vectorStore.info = { name: vs?.name, file_counts: vs?.file_counts, status: vs?.status };
      } catch (e: any) {
        out.vectorStore.infoError = e?.message;
      }
      try {
        const files = await this.oai(`/vector_stores/${vsId}/files?limit=20`);
        out.vectorStore.files = (files?.data || []).map((f: any) => ({ id: f.id, status: f.status, last_error: f.last_error, created_at: f.created_at }));
      } catch (e: any) {
        out.vectorStore.filesError = e?.message;
      }
      try {
        const assistantId = await this.ensureAssistant(vsId);
        out.assistant = { id: assistantId };
        const a = await this.oai(`/assistants/${assistantId}`);
        out.assistant.info = {
          model: a?.model,
          tools: (a?.tools || []).map((t: any) => t?.type),
          linkedVectorStores: a?.tool_resources?.file_search?.vector_store_ids || [],
        };
        out.assistant.vectorStoreLinked = (a?.tool_resources?.file_search?.vector_store_ids || []).includes(vsId);
      } catch (e: any) {
        out.assistant = { error: e?.message };
      }
    } catch (e: any) {
      out.error = e?.message;
    }
    return out;
  }

  /**
   * POST /company-data/repair
   * Re-links the current vector store to the configured assistant and re-attaches all DB files to the vector store.
   * Use after env changes or if debug shows assistant not linked.
   */
  @Public()
  @Post('repair')
  async repair() {
    const vsId = await this.ensureVectorStore();
    const assistantId = await this.ensureAssistant(vsId);
    await this.ensureAssistantHasVectorStore(assistantId, vsId);

    // Re-attach any DB files that are not in the vector store
    const rows = await this.prisma.companyData.findMany({ where: { openaiFileId: { not: null } }, select: { id: true, openaiFileId: true, fileName: true } });
    const attached: string[] = [];
    const skipped: Array<{ fileName: string; reason: string }> = [];
    for (const r of rows) {
      try {
        await this.oai(`/vector_stores/${vsId}/files`, { method: 'POST', body: { file_id: r.openaiFileId! } });
        attached.push(r.fileName);
      } catch (e: any) {
        skipped.push({ fileName: r.fileName, reason: e?.message || 'unknown' });
      }
    }
    return { vectorStoreId: vsId, assistantId, attached, skipped };
  }

  /**
   * POST /company-data/upgrade-model
   * Force upgrade the assistant model to gpt-4-turbo for better answer quality.
   * Clears the in-process cache to ensure the upgrade takes effect.
   */
  @Public()
  @Post('upgrade-model')
  async upgradeModel() {
    const vsId = await this.ensureVectorStore();
    // Clear cache to force re-fetch and upgrade
    CompanyDataController.cachedAssistantId = null;
    const assistantId = await this.ensureAssistant(vsId);
    // Force model update
    try {
      const a = await this.oai(`/assistants/${assistantId}`);
      if (a.model !== 'gpt-4-turbo') {
        await this.oai(`/assistants/${assistantId}`, {
          method: 'PATCH',
          body: { model: 'gpt-4-turbo' },
        });
      }
    } catch (e: any) {
      console.error(`[company-data] upgrade-model failed: ${e?.message}`);
    }
    const a = await this.oai(`/assistants/${assistantId}`);
    return { assistantId, model: a.model, upgraded: a.model === 'gpt-4-turbo' };
  }

  // ─── AI Q&A via Assistants API ─────────────────────────

  @Post('ask')
  async ask(@Body() body: { question: string; userId: string }) {
    if (!body.question?.trim()) throw new BadRequestException('question required');
    if (!body.userId) throw new BadRequestException('userId required');

    // Check we have files in OpenAI
    const filesWithOai = await this.prisma.companyData.count({
      where: { openaiFileId: { not: null } },
    });

    if (filesWithOai === 0) {
      // Fallback: use content from DB directly (original approach)
      return this.askFallback(body.question, body.userId);
    }

    const vsId = await this.ensureVectorStore();
    const assistantId = await this.ensureAssistant(vsId);
    // Repair assistant→vectorStore linkage in case OPENAI_ASSISTANT_ID was created earlier without it.
    await this.ensureAssistantHasVectorStore(assistantId, vsId);

    // Create thread and run — also attach vector_store at thread level as a belt-and-suspenders guarantee
    const thread = await this.oai('/threads', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: body.question }],
        tool_resources: { file_search: { vector_store_ids: [vsId] } },
      },
    });

    const run = await this.oai(`/threads/${thread.id}/runs`, {
      method: 'POST',
      body: {
        assistant_id: assistantId,
        tool_resources: { file_search: { vector_store_ids: [vsId] } },
      },
    });

    // Poll for completion (max 60s)
    let status = run.status;
    let runData = run;
    const start = Date.now();
    while (status === 'queued' || status === 'in_progress') {
      if (Date.now() - start > 60000) break;
      await new Promise((r) => setTimeout(r, 1500));
      runData = await this.oai(`/threads/${thread.id}/runs/${run.id}`);
      status = runData.status;
    }

    if (status !== 'completed') {
      throw new BadRequestException(`AI 분석 실패 (status: ${status}). 다시 시도해주세요.`);
    }

    // Get messages
    const msgs = await this.oai(`/threads/${thread.id}/messages?order=desc&limit=1`);
    const assistantMsg = msgs?.data?.[0];
    const answer = (assistantMsg?.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text?.value || '')
      .join('\n')
      .trim();

    if (!answer) throw new BadRequestException('AI가 빈 응답을 반환했습니다.');

    // Save chat
    const chat = await this.prisma.companyDataChat.create({
      data: {
        question: body.question,
        answer,
        dataIds: [],
        userId: body.userId,
      },
    });

    // Cleanup thread
    try { await this.oai(`/threads/${thread.id}`, { method: 'DELETE' }); } catch {}

    return { answer, chatId: chat.id };
  }

  // Fallback: use DB content directly when no OpenAI files
  private async askFallback(question: string, userId: string) {
    const apiKey = this.getApiKey();
    const dataSources = await this.prisma.companyData.findMany({
      where: { content: { not: null } },
      select: { id: true, title: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const context = dataSources
      .filter((d) => d.content?.trim())
      .map((d, i) => `[자료 ${i + 1}: ${d.title}]\n${d.content}`)
      .join('\n\n---\n\n');

    if (!context.trim()) {
      throw new BadRequestException('참조할 자료가 없습니다. 자료를 등록하고 내용을 입력하세요.');
    }

    const f: any = (globalThis as any).fetch;
    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: ASSISTANT_INSTRUCTIONS },
          { role: 'user', content: `## 회사 자료\n\n${context}\n\n## 질문\n${question}` },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`AI 호출 실패: ${resp.status} ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const answer = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!answer) throw new BadRequestException('AI가 빈 응답을 반환했습니다.');

    const chat = await this.prisma.companyDataChat.create({
      data: { question, answer, dataIds: dataSources.map((d) => d.id), userId },
    });

    return { answer, chatId: chat.id };
  }

  // ─── Chat History ──────────────────────────────────────

  @Get('chats')
  async chatHistory(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    return this.prisma.companyDataChat.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
