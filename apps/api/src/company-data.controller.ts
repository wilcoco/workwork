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

const ASSISTANT_INSTRUCTIONS = `당신은 회사의 통계 및 경영 데이터를 분석하는 전문가입니다.
업로드된 회사 자료를 바탕으로 사용자의 질문에 정확하고 구체적으로 답변하세요.
- file_search를 활용하여 업로드된 파일에서 정보를 찾으세요.
- 자료에 없는 내용은 추측하지 마세요. "제공된 자료에는 해당 정보가 없습니다"라고 답하세요.
- 숫자나 통계를 인용할 때는 정확한 값을 사용하세요.
- 가능하면 표 형태로 비교/정리해주세요.
- 한국어로 답변하세요.`;

@Controller('company-data')
export class CompanyDataController {
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
    const vsId = process.env.OPENAI_VECTOR_STORE_ID;
    if (vsId) return vsId;
    // Create one
    const vs = await this.oai('/vector_stores', {
      method: 'POST',
      body: { name: 'company-data' },
    });
    console.log(`[company-data] Created vector store: ${vs.id} — set OPENAI_VECTOR_STORE_ID env var`);
    return vs.id;
  }

  private async ensureAssistant(vectorStoreId: string): Promise<string> {
    const aId = process.env.OPENAI_ASSISTANT_ID;
    if (aId) return aId;
    const assistant = await this.oai('/assistants', {
      method: 'POST',
      body: {
        model: 'gpt-4o-mini',
        name: '회사 데이터 분석',
        instructions: ASSISTANT_INSTRUCTIONS,
        tools: [{ type: 'file_search' }],
        tool_resources: {
          file_search: { vector_store_ids: [vectorStoreId] },
        },
      },
    });
    console.log(`[company-data] Created assistant: ${assistant.id} — set OPENAI_ASSISTANT_ID env var`);
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

  /** Normalize xlsx → csv is not done here; OpenAI assistants file_search accepts many formats
   * (pdf, docx, pptx, txt, md, csv, json, html, xml, + code files).
   * xlsx is NOT supported directly — we reject and tell user to save as CSV.
   */
  private assertSupportedForFileSearch(fileName: string): void {
    const ext = (fileName.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1] || '').toLowerCase();
    const supported = new Set([
      'pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md', 'html', 'htm',
      'csv', 'json', 'xml', 'tex', 'rtf',
      'c', 'cpp', 'cs', 'java', 'js', 'ts', 'py', 'rb', 'go', 'php', 'sh',
    ]);
    if (!supported.has(ext)) {
      throw new BadRequestException(
        `지원하지 않는 파일 형식입니다 (.${ext}). OpenAI file_search는 PDF, Word(docx), PowerPoint(pptx), CSV, TXT, MD, JSON 등을 지원합니다. Excel(xlsx)은 CSV로 저장 후 업로드하세요.`,
      );
    }
  }

  private async addFileToVectorStore(vectorStoreId: string, fileId: string): Promise<void> {
    await this.oai(`/vector_stores/${vectorStoreId}/files`, {
      method: 'POST',
      body: { file_id: fileId },
    });
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
   * Supported: PDF, DOCX, PPTX, CSV, TXT, MD, JSON, HTML, XML, + common source files.
   * NOT supported: XLSX (convert to CSV), images (use text extraction first).
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
    const openaiFileId = await this.uploadBinaryToOpenAI(fileName, file.mimetype, file.buffer);
    await this.addFileToVectorStore(vsId, openaiFileId);

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

    // Create thread and run
    const thread = await this.oai('/threads', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: body.question }],
      },
    });

    const run = await this.oai(`/threads/${thread.id}/runs`, {
      method: 'POST',
      body: { assistant_id: assistantId },
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
        model: 'gpt-4o-mini',
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
