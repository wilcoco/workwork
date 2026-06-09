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
