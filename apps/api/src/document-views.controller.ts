import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 품의서/전표 조회 기록 API
 * - 사용자별로 어떤 문서를 조회했는지 기록
 * - 목록에서 조회 여부 표시에 사용
 */
@Controller('document-views')
export class DocumentViewsController {
  /**
   * POST /api/document-views
   * 문서 조회 기록 저장 (upsert)
   */
  @Post()
  async recordView(
    @Body() body: { userId: string; docType: 'proposal' | 'voucher'; docId: string },
  ) {
    const { userId, docType, docId } = body;
    if (!userId || !docType || !docId) {
      return { success: false, error: 'Missing required fields' };
    }

    await prisma.documentViewLog.upsert({
      where: {
        userId_docType_docId: { userId, docType, docId },
      },
      create: { userId, docType, docId },
      update: { viewedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * POST /api/document-views/worklog — 업무일지 열람 기록 (메인 피드에서 1초+ 노출 시)
   * 본인 일지는 기록 제외. 사람당 1행(upsert, 마지막 열람시각 갱신).
   */
  @Post('worklog')
  async recordWorklogView(@Body() body: { userId?: string; worklogId?: string }) {
    const userId = String(body?.userId || '');
    const worklogId = String(body?.worklogId || '');
    if (!userId || !worklogId) return { success: false };
    const wl = await prisma.worklog.findUnique({ where: { id: worklogId }, select: { createdById: true } });
    if (!wl) return { success: false };
    if (wl.createdById === userId) return { success: true, self: true }; // 본인 열람은 기록 안 함
    await prisma.documentViewLog.upsert({
      where: { userId_docType_docId: { userId, docType: 'worklog', docId: worklogId } },
      create: { userId, docType: 'worklog', docId: worklogId },
      update: { viewedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * POST /api/document-views/worklog-viewers — 업무일지별 열람자 명단 (임원 이상만)
   * body: { viewerId, ids: worklogId[] } → { [worklogId]: [{name, at}] }
   */
  @Post('worklog-viewers')
  async worklogViewers(@Body() body: { viewerId?: string; ids?: string[] }) {
    const viewerId = String(body?.viewerId || '');
    const ids = Array.isArray(body?.ids) ? body!.ids!.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (!viewerId || !ids.length) return { items: {} };
    const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } });
    if (!['CEO', 'EXEC', 'EXTERNAL'].includes(String(viewer?.role || '').toUpperCase())) return { items: {} }; // 임원 이상만
    const HIDDEN = ['cmouna6bf01w0xjhgf6imupg5', 'cmoknhiqj0av02rtgo5eou86t']; // 김정중·김선구 (명단 노출 제외)
    const rows = await prisma.documentViewLog.findMany({
      where: { docType: 'worklog', docId: { in: ids }, userId: { notIn: HIDDEN } },
      orderBy: { viewedAt: 'desc' },
      include: { user: { select: { name: true } } },
    });
    const items: Record<string, Array<{ name: string; at: string }>> = {};
    for (const id of ids) items[id] = [];
    for (const r of rows) (items[r.docId] ||= []).push({ name: r.user?.name || '', at: r.viewedAt.toISOString() });
    return { items };
  }

  /**
   * GET /api/document-views?userId=xxx&docType=proposal
   * 사용자가 조회한 문서 ID 목록 반환
   */
  @Get()
  async getViewedDocs(
    @Query('userId') userId: string,
    @Query('docType') docType: 'proposal' | 'voucher',
  ) {
    if (!userId || !docType) {
      return { viewedDocIds: [] };
    }

    const logs = await prisma.documentViewLog.findMany({
      where: { userId, docType },
      select: { docId: true },
    });

    return { viewedDocIds: logs.map((l) => l.docId) };
  }

  /**
   * GET /api/document-views/check?userId=xxx&docType=proposal&docId=123
   * 특정 문서 조회 여부 확인
   */
  @Get('check')
  async checkViewed(
    @Query('userId') userId: string,
    @Query('docType') docType: 'proposal' | 'voucher',
    @Query('docId') docId: string,
  ) {
    if (!userId || !docType || !docId) {
      return { viewed: false };
    }

    const log = await prisma.documentViewLog.findUnique({
      where: {
        userId_docType_docId: { userId, docType, docId },
      },
    });

    return { viewed: !!log, viewedAt: log?.viewedAt ?? null };
  }
}
