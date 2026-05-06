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
  ForbiddenException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');

const ASSISTANT_INSTRUCTIONS_SUMMARY = `당신은 회사의 통계 및 경영 데이터를 분석하는 전문가입니다.
업로드된 회사 자료를 바탕으로 사용자의 질문에 정확하고 구체적으로 답변하세요.
- 자료에 없는 내용은 추측하지 마세요. "제공된 자료에는 해당 정보가 없습니다"라고 답하세요.
- 숫자나 통계를 인용할 때는 정확한 값을 사용하세요.
- 가능하면 표 형태로 비교/정리해주세요.
- 한국어로 답변하세요.`;

const ASSISTANT_INSTRUCTIONS_DEEP = `당신은 **㈜캠스(CAMS)** 의 품질·개발 부문을 지원하는 사내 전문 컨설턴트입니다.
- 분석 대상 회사는 항상 캠스(CAMS)이며, 자료는 캠스 내부 SharePoint·업무일지에서 수집된 것입니다.
- 따라서 보고서 제목·본문은 모두 **캠스(CAMS) 관점**에서 작성하십시오.
  예) "캠스 NQ6 프로젝트 품질 관리 시스템 분석", "캠스 RFQ 프로세스 개선 검토", "캠스 SP3 차종 FR UPR 부품 품질 이슈 분석"
- "자동차 제조사", "일반 자동차 부품사" 같은 일반화된 표현 대신, **"캠스"** 또는 "당사"로 지칭합니다.

사용자의 질문과 첨부된 회사 자료를 토대로 **공식적인 서술형 분석 보고서**를 작성하십시오.

## 활용 가능한 표준·지식 기반
- **IATF 16949** (자동차 QMS 핵심 요구사항): APQP, PPAP, FMEA, MSA, SPC, Control Plan, 8D, Layered Process Audit
- **ISO 9001 / ISO 14001 / ISO 45001**
- **AIAG-VDA FMEA 7-step**, **AIAG APQP/PPAP 4판**
- **VDA 6.3** (프로세스 감사), **VDA 2** (PPF)
- **고객 특화 요구사항**: 현대차·기아 SQ Mark, 5-Star 평가, 단계별 게이트(SDS, DV, PV, Mass Production)
- **제조 우수성**: Lean, 6-Sigma, Poka-Yoke, MTTR/MTBF, OEE

## 보고서 작성 형식 (반드시 아래 구조와 어조로)

# [보고서 제목 — 반드시 "캠스" 또는 "CAMS"로 시작 또는 명시. 예: "캠스 NQ6 프로젝트 품질 관리 시스템 분석"]

**작성 목적**: (한 문장으로 분석 목적 기술)
**검토 대상 자료**: (인용한 문서명 나열)
**관련 표준**: (해당 분석에 적용되는 표준·조항)

---

## I. 개요 (Executive Summary)

3~5문장의 서술형 단락으로 작성. 검토한 자료의 핵심, 식별된 주요 이슈, 권고사항의 방향성을 압축적으로 기술.

## II. 자료 분석

수집된 자료에서 확인된 사실을 **서술형 단락**으로 풀어 기술. 단순 나열이 아니라 "~로 확인되었으며", "~에 따르면", "또한 ~점이 주목된다" 등의 문장으로 흐름을 갖추어 서술. 필요한 경우에만 표를 보조적으로 활용. 인용 시 [문서: 파일명] 표기.

## III. 표준 준수성 평가 (Gap Analysis)

각 표준 요구사항별로 자료 내용이 충족하는지 **분석적 서술**로 기술. 예:
> "IATF 16949 조항 8.3.4 (설계·개발 통제)에 비추어 볼 때, 자료에서 확인된 게이트 점검 절차는 DV/PV 단계의 통제 요구를 일정 수준 반영하고 있으나, 변경 관리(Change Control)에 대한 명문화된 절차가 누락되어 있어 보완이 요구된다."

각 평가 끝에 ✅(충족) / ⚠️(부분 충족, 보완 필요) / ❌(미흡) 표기.

## IV. 개선 권고사항

권고를 우선순위(High/Medium/Low)로 분류하되, 각 권고는 **하나의 단락**으로 다음을 모두 포함하여 서술:
1. 권고 내용 (무엇을 해야 하는지)
2. 근거 표준 조항 또는 베스트 프랙티스
3. 정량적 목표 또는 측정 지표 (예: Cpk ≥ 1.67, PPAP 승인 리드타임 8주 → 6주)
4. 예상 효과

## V. 잠재 리스크 및 모니터링 방안

식별된 품질·납기·비용 리스크를 **서술형 단락**으로 기술하고, 각 리스크에 대해 추적해야 할 KPI 또는 검증 방법을 제시.

## VI. 결론

분석 결과를 종합하여 2~4문장으로 마무리. 핵심 메시지와 즉시 착수해야 할 우선 조치를 강조.

---

**보고자**: AI 분석 시스템 (모델: gpt-4.1 / Claude Opus 4)
**작성일**: (오늘 날짜를 자동으로 채워 넣을 것)

## 작성 규칙
- **서술형 어조**: "~이다", "~로 판단된다", "~가 요구된다" 등 공식 보고서 문체 사용. 단답·메모형·키워드 나열 금지.
- 자료에 명시되지 않은 사실은 단정하지 말고, 분석·추론은 "[분석]" 또는 "[추정]" 표기 후 근거 제시.
- 인용 시 [문서: 파일명] 형식.
- 표준 용어는 한국어와 영문 병기 (예: 통계적 공정관리(SPC)).
- 표는 보조 수단으로만 사용하고, 본문은 반드시 서술형으로 작성.
- 전체 분량은 충분히 상세하게 (최소 800자 이상 권장).`;

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
        instructions: ASSISTANT_INSTRUCTIONS_SUMMARY,
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
   * Deletes the old assistant and creates a new one with the correct model.
   */
  @Public()
  @Post('upgrade-model')
  async upgradeModel() {
    const vsId = await this.ensureVectorStore();
    // Clear cache
    CompanyDataController.cachedAssistantId = null;
    
    // Find existing assistant
    try {
      const list = await this.oai('/assistants?limit=100&order=desc');
      const found = (list?.data || []).find((a: any) => a?.name === ASSISTANT_NAME);
      if (found?.id) {
        console.log(`[company-data] Deleting old assistant: ${found.id}`);
        await this.oai(`/assistants/${found.id}`, { method: 'DELETE' });
      }
    } catch (e: any) {
      console.error(`[company-data] Failed to delete old assistant: ${e?.message}`);
    }
    
    // Create new assistant with gpt-4-turbo
    const assistant = await this.oai('/assistants', {
      method: 'POST',
      body: {
        model: 'gpt-4-turbo',
        name: ASSISTANT_NAME,
        instructions: ASSISTANT_INSTRUCTIONS_SUMMARY,
        tools: [{ type: 'file_search' }],
        tool_resources: {
          file_search: { vector_store_ids: [vsId] },
        },
      },
    });
    CompanyDataController.cachedAssistantId = assistant.id;
    return { assistantId: assistant.id, model: assistant.model, upgraded: assistant.model === 'gpt-4-turbo' };
  }

  // ─── Keyword extraction for SharePoint search ─────────────────────────

  private async extractKeywords(question: string): Promise<string[]> {
    const apiKey = this.getApiKey();
    const f: any = (globalThis as any).fetch;
    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: '질문에서 SharePoint 문서 검색에 필요한 핵심 키워드를 추출하세요. 명사 위주, 조사/접속사 제외. 최대 5개. 반드시 다음 JSON 형식으로 반환: {"keywords": ["키워드1", "키워드2", ...]}' 
          },
          { role: 'user', content: question },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`키워드 추출 실패: ${resp.status} ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    try {
      const parsed = JSON.parse(content);
      const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
      return keywords.slice(0, 5); // Max 5 keywords
    } catch {
      // Fallback: extract words from question
      return question.split(/\s+/).filter(w => w.length > 1).slice(0, 5);
    }
  }

  // ─── SharePoint Search API ─────────────────────────

  private async searchSharePointDocuments(keywords: string[], token: string): Promise<any[]> {
    const f: any = (globalThis as any).fetch;
    const query = keywords.join(' OR ');
    const searchUrl = 'https://graph.microsoft.com/v1.0/search/query';
    const searchBody = {
      requests: [{
        entityTypes: ['driveItem'],
        query: {
          queryString: query,
        },
        from: 0,
        size: 10,
      }],
    };

    const resp = await f(searchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[company-data] SharePoint search failed: ${resp.status} ${text.slice(0, 300)}`);
      return [];
    }

    const data = await resp.json();
    const hits = data?.value?.[0]?.hitsContainers?.[0]?.hits || [];
    return hits.map((hit: any) => ({
      id: hit.resource.id,
      name: hit.resource.name,
      webUrl: hit.resource.webUrl,
      driveId: hit.resource.parentReference?.driveId,
      siteId: hit.resource.parentReference?.siteId,
    }));
  }

  private async searchSharePointWorkReports(keywords: string[], token: string, siteId: string): Promise<any[]> {
    const f: any = (globalThis as any).fetch;
    const query = keywords.join(' OR ');
    const searchUrl = 'https://graph.microsoft.com/v1.0/search/query';
    const searchBody = {
      requests: [{
        entityTypes: ['listItem'],
        query: {
          queryString: `${query} path:"https://cams2002.sharepoint.com/sites/msteams_03d426/Lists/WorkReports"`,
        },
        from: 0,
        size: 10,
      }],
    };

    const resp = await f(searchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });

    if (!resp.ok) {
      console.error(`[company-data] WorkReports search failed: ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const hits = data?.value?.[0]?.hitsContainers?.[0]?.hits || [];
    return hits.map((hit: any) => ({
      id: hit.resource.id,
      title: hit.resource.fields?.Title || hit.resource.fields?.Title,
      content: hit.resource.fields?.Content || '',
    }));
  }

  // ─── Graph Token Helper ─────────────────────────

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
    const tokenUrl = `https://login.microsoftonline.com/${tenantId || 'common'}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: user.graphRefreshToken,
      scope: 'openid profile email offline_access Tasks.ReadWrite Group.Read.All Files.ReadWrite.All Sites.Read.All',
    });

    const f: any = (globalThis as any).fetch;
    const resp = await f(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.access_token) {
      try {
        await (this.prisma as any).user.update({
          where: { id: userId },
          data: { graphAccessToken: null, graphRefreshToken: null, graphTokenExpiry: null },
        });
      } catch {}
      throw new BadRequestException('Graph API 토큰 갱신 실패. 다시 로그인해주세요.');
    }

    const newExpiry = new Date(Date.now() + (json.expires_in || 3600) * 1000);
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

  // ─── File content extraction ─────────────────────────

  private static readonly SUPPORTED_EXTS = ['txt', 'md', 'csv', 'docx', 'xlsx', 'xls', 'pdf', 'pptx'];

  private async extractPptxText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    // Slide XML files in order: ppt/slides/slide1.xml, slide2.xml, ...
    const slideEntries = Object.keys(zip.files)
      .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0', 10);
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0', 10);
        return na - nb;
      });
    const parts: string[] = [];
    for (let i = 0; i < slideEntries.length; i++) {
      const xml = await zip.files[slideEntries[i]].async('string');
      // Extract <a:t>...</a:t> text runs
      const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
      const texts = matches.map((m: string) => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''));
      const slideText = texts.join(' ').replace(/\s+/g, ' ').trim();
      if (slideText) parts.push(`[Slide ${i + 1}]\n${slideText}`);
    }
    return parts.join('\n\n');
  }

  private async extractFileContent(
    doc: { driveId?: string; id: string; name: string },
    token: string,
  ): Promise<{ content: string; error?: string }> {
    const name = doc.name || '';
    const dotIdx = name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
    if (!CompanyDataController.SUPPORTED_EXTS.includes(ext)) {
      return { content: '', error: `unsupported-ext:${ext || 'none'}` };
    }
    if (!doc.driveId || !doc.id) {
      return { content: '', error: 'missing-driveId-or-id' };
    }

    const f: any = (globalThis as any).fetch;
    // Get file download URL from Graph API. Note: $select with @microsoft.graph.downloadUrl
    // is unreliable; just fetch the full item.
    const itemUrl = `https://graph.microsoft.com/v1.0/drives/${doc.driveId}/items/${doc.id}`;
    const metaResp = await f(itemUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!metaResp.ok) {
      const text = await metaResp.text().catch(() => '');
      return { content: '', error: `meta-${metaResp.status}:${text.slice(0, 100)}` };
    }
    const meta = await metaResp.json();
    const downloadUrl = meta['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) {
      return { content: '', error: 'no-download-url' };
    }

    // Size limits by type (pptx/pdf can legitimately be larger due to embedded images)
    const sizeLimit = ['pptx', 'pdf'].includes(ext) ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (meta.size && meta.size > sizeLimit) {
      return { content: '', error: `too-large:${meta.size}` };
    }

    const resp = await f(downloadUrl);
    if (!resp.ok) {
      return { content: '', error: `download-${resp.status}` };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());

    try {
      if (['txt', 'md', 'csv'].includes(ext)) {
        return { content: buffer.toString('utf-8').slice(0, 6000) };
      }
      if (ext === 'docx') {
        const result = await mammoth.extractRawText({ buffer });
        return { content: (result.value || '').slice(0, 6000) };
      }
      if (['xlsx', 'xls'].includes(ext)) {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          parts.push(`[Sheet: ${sheetName}]\n${csv}`);
        }
        return { content: parts.join('\n\n').slice(0, 6000) };
      }
      if (ext === 'pptx') {
        const text = await this.extractPptxText(buffer);
        return { content: text.slice(0, 6000) };
      }
      if (ext === 'pdf') {
        // Dynamic require to avoid pdf-parse's debug mode at module load time
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const result = await pdfParse(buffer);
        return { content: (result.text || '').slice(0, 6000) };
      }
    } catch (e: any) {
      return { content: '', error: `parse-error:${e?.message || String(e)}`.slice(0, 200) };
    }

    return { content: '', error: 'unhandled' };
  }

  // ─── LLM answer generation (provider-switchable) ─────────────────────────

  private async generateAnswer(
    provider: 'openai' | 'claude' | 'claude-opus',
    system: string,
    user: string,
    maxTokens: number = 6000,
  ): Promise<string> {
    const f: any = (globalThis as any).fetch;
    // Hard timeout to prevent Railway/Cloudflare from killing the request
    // without CORS headers (which surfaces as a CORS error in browsers).
    // Extended thinking mode needs a longer budget.
    const TIMEOUT_MS = provider === 'claude-opus' ? 180_000 : 90_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
    if (provider === 'claude' || provider === 'claude-opus') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new BadRequestException('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
      const isOpusPremium = provider === 'claude-opus';
      const model = isOpusPremium
        ? (process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-20250514')
        : (process.env.CLAUDE_MODEL || 'claude-opus-4-20250514');
      // Extended thinking for the premium Opus button — deeper reasoning.
      // Extended thinking requires temperature=1 and max_tokens >= budget + output.
      const body: any = isOpusPremium
        ? {
            model,
            max_tokens: Math.max(maxTokens, 16000),
            system,
            messages: [{ role: 'user', content: user }],
            temperature: 1,
            thinking: { type: 'enabled', budget_tokens: 8000 },
          }
        : {
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
            temperature: 0.3,
          };
      const resp = await f('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new BadRequestException(`Claude 호출 실패: ${resp.status} ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      const blocks: any[] = data?.content || [];
      const textBlock = blocks.find((b: any) => b.type === 'text');
      return String(textBlock?.text || '').trim();
    }
    // OpenAI (default) — latest top-tier model
    const apiKey = this.getApiKey();
    const model = process.env.OPENAI_MODEL || 'gpt-4.1';
    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`OpenAI 호출 실패: ${resp.status} ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
    } catch (e: any) {
      if (e?.name === 'AbortError' || /aborted|timeout/i.test(e?.message || '')) {
        throw new BadRequestException(`AI 응답이 ${TIMEOUT_MS / 1000}초 내에 완료되지 않았습니다. 질문을 더 구체적으로 좁히거나 잠시 후 다시 시도해 주세요.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── AI Q&A via Assistants API ─────────────────────────

  @Post('ask')
  async ask(@Body() body: { question: string; userId: string; provider?: 'openai' | 'claude' | 'claude-opus'; mode?: 'summary' | 'deep'; source?: string }) {
    if (!body.question?.trim()) throw new BadRequestException('question required');
    if (!body.userId) throw new BadRequestException('userId required');

    let provider: 'openai' | 'claude' | 'claude-opus' =
      body.provider === 'claude-opus' ? 'claude-opus' : body.provider === 'claude' ? 'claude' : 'openai';
    // Premium Claude Opus (Extended Thinking) is available to all users —
    // we give everyone the highest-quality analysis. If an admin wants to
    // gate it again for cost reasons, set COMPANY_DATA_OPUS_EXEC_ONLY=1.
    if (provider === 'claude-opus' && process.env.COMPANY_DATA_OPUS_EXEC_ONLY === '1') {
      const actor = await this.prisma.user.findUnique({ where: { id: body.userId } });
      const role = String((actor as any)?.role || '');
      const defaultAdmins = ['json@cams2002.onmicrosoft.com'];
      const envAdmins = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const admins = new Set([...defaultAdmins.map((s) => s.toLowerCase()), ...envAdmins]);
      const email = String((actor as any)?.email || '').toLowerCase();
      const upn = String((actor as any)?.teamsUpn || '').toLowerCase();
      const allowed = ['CEO', 'EXEC'].includes(role) || admins.has(email) || admins.has(upn);
      if (!allowed) {
        throw new ForbiddenException('Claude Opus 프리미엄 분석은 임원 이상만 이용할 수 있습니다.');
      }
    }
    const mode: 'summary' | 'deep' = body.mode === 'summary' ? 'summary' : 'deep';
    const systemPrompt = mode === 'deep' ? ASSISTANT_INSTRUCTIONS_DEEP : ASSISTANT_INSTRUCTIONS_SUMMARY;
    const debug: any = { path: 'unknown', provider, mode, keywords: [], docCount: 0, workReportCount: 0, extractedCount: 0 };

    // New approach: Extract keywords and search SharePoint on-demand
    try {
      // 1. Extract keywords from question
      const keywords = await this.extractKeywords(body.question);
      debug.keywords = keywords;
      console.log(`[company-data] Extracted keywords:`, keywords);

      // 2. Get Graph token (may fail if Teams not connected)
      let token: string | null = null;
      try {
        token = await this.getGraphToken(body.userId);
        debug.tokenAcquired = true;
      } catch (e: any) {
        debug.tokenError = e?.message;
        console.log(`[company-data] Graph token not available: ${e?.message}`);
      }

      // If no Graph token, fallback to DB
      if (!token) {
        debug.path = 'no-graph-token';
        console.log(`[company-data] No Graph token, falling back to DB`);
        const r = await this.askFallback(body.question, body.userId, provider, systemPrompt, body.source);
        return { ...r, debug };
      }

      // 3. Search SharePoint documents
      const docs = await this.searchSharePointDocuments(keywords, token);
      debug.docCount = docs.length;
      debug.docNames = docs.slice(0, 5).map(d => d.name);
      console.log(`[company-data] Found ${docs.length} documents`);

      // 4. Search SharePoint WorkReports
      const siteId = 'cams2002.sharepoint.com,::/sites/msteams_03d426'; // Default site
      const workReports = await this.searchSharePointWorkReports(keywords, token, siteId);
      debug.workReportCount = workReports.length;
      console.log(`[company-data] Found ${workReports.length} work reports`);

      // 5. Extract content from documents (prefer files with supported extensions first)
      const supported = docs.filter(d => {
        const idx = (d.name || '').lastIndexOf('.');
        const ext = idx >= 0 ? d.name.slice(idx + 1).toLowerCase() : '';
        return CompanyDataController.SUPPORTED_EXTS.includes(ext);
      });
      const candidates = [...supported, ...docs.filter(d => !supported.includes(d))].slice(0, 8);
      debug.supportedCount = supported.length;

      const docContents: string[] = [];
      const extractStatus: any[] = [];
      for (const doc of candidates) {
        const dotIdx = (doc.name || '').lastIndexOf('.');
        const ext = dotIdx >= 0 ? doc.name.slice(dotIdx + 1).toLowerCase() : '';
        const result = await this.extractFileContent(doc, token);
        extractStatus.push({ name: doc.name, ext, len: result.content.length, error: result.error });
        if (result.content) {
          docContents.push(`[문서: ${doc.name}]\n${result.content}`);
        }
      }
      debug.extractStatus = extractStatus;

      // 6. Add WorkReports content
      for (const wr of workReports.slice(0, 5)) { // Limit to 5 reports
        if (wr.content) {
          docContents.push(`[업무일지: ${wr.title}]\n${wr.content}`);
        }
      }
      debug.extractedCount = docContents.length;

      // 7. If no content found, fallback to DB
      if (docContents.length === 0) {
        debug.path = 'no-sharepoint-content';
        console.log(`[company-data] No SharePoint content found, falling back to DB`);
        const r = await this.askFallback(body.question, body.userId, provider, systemPrompt, body.source);
        return { ...r, debug };
      }
      debug.path = 'sharepoint-success';

      // 8. Generate answer using extracted content
      const context = docContents.join('\n\n---\n\n');
      const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      const userPrompt = `오늘 날짜: ${today}\n\n## 회사 자료\n\n${context}\n\n## 질문\n${body.question}`;
      const answer = await this.generateAnswer(provider, systemPrompt, userPrompt);
      if (!answer) throw new BadRequestException('AI가 빈 응답을 반환했습니다.');
      debug.model =
        provider === 'claude-opus'
          ? `${process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-20250514'} (extended thinking)`
          : provider === 'claude'
          ? (process.env.CLAUDE_MODEL || 'claude-opus-4-20250514')
          : (process.env.OPENAI_MODEL || 'gpt-4.1');

      const chat = await this.prisma.companyDataChat.create({
        data: {
          question: body.question,
          answer,
          dataIds: [],
          userId: body.userId,
          source: body.source || null,
        } as any,
      });

      return {
        answer,
        chatId: chat.id,
        sources: docs.length + workReports.length,
        keywords,
        sourceFiles: docs.map(d => ({ name: d.name, url: d.webUrl })),
        debug,
      };
    } catch (e: any) {
      debug.path = 'exception';
      debug.error = e?.message;
      console.error(`[company-data] On-demand search failed: ${e?.message}\n${e?.stack}`);
      // Fallback to DB if on-demand search fails
      const r = await this.askFallback(body.question, body.userId, provider, systemPrompt, body.source);
      return { ...r, debug };
    }
  }

  // Fallback: use DB content directly when no SharePoint content
  private async askFallback(question: string, userId: string, provider: 'openai' | 'claude' | 'claude-opus' = 'openai', systemPrompt: string = ASSISTANT_INSTRUCTIONS_DEEP, source?: string) {
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

    let userPrompt: string;
    let dataIds: string[];
    if (!context.trim()) {
      userPrompt = `## 질문\n\n${question}\n\n참고: 현재 등록된 회사 자료가 없습니다. 일반적인 지식으로 답변해 주세요.`;
      dataIds = [];
    } else {
      userPrompt = `## 회사 자료\n\n${context}\n\n## 질문\n${question}`;
      dataIds = dataSources.map((d) => d.id);
    }

    const answer = await this.generateAnswer(provider, systemPrompt, userPrompt);
    if (!answer) throw new BadRequestException('AI가 빈 응답을 반환했습니다.');

    const chat = await this.prisma.companyDataChat.create({
      data: { question, answer, dataIds, userId, source: source || null } as any,
    });

    return { answer, chatId: chat.id, sources: dataIds.length };
  }

  // ─── Chat History ──────────────────────────────────────

  @Get('chats')
  async chatHistory(
    @Query('userId') userId: string,
    @Query('source') source?: string,
    @Query('shared') shared?: string,
  ) {
    const isShared = String(shared || '') === '1' || String(shared || '').toLowerCase() === 'true';
    if (!isShared && !userId) throw new BadRequestException('userId required');
    const where: any = {};
    if (!isShared) where.userId = userId;
    if (source) {
      // Include legacy rows (source IS NULL) for the original 'company-data'
      // page so users don't lose their pre-existing history. Other sources
      // get exact-match filtering only.
      if (source === 'company-data') {
        where.OR = [{ source: 'company-data' }, { source: null }];
      } else {
        where.source = source;
      }
    }
    return this.prisma.companyDataChat.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
