import { Body, Controller, Post, Headers, UnauthorizedException, Get, Query, Param } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';

interface ProposalPushData {
  slpNo: string;
  title?: string;
  purpose?: string;
  drafter?: string;
  draftDate?: string;
  dueDate?: string;
  amount?: string;
  paymentTerm?: string;
  vendor?: string;
  content?: string;
  attachments?: Array<{
    seq: number;
    filename: string;
    downloadUrl: string;
  }>;
}

interface VoucherPushData {
  slpNo: string;
  title?: string;
  drafter?: string;
  draftDate?: string;
  amount?: string;
  status?: string;
  txType?: string;
  content?: string;
  attachments?: Array<{
    seq: number;
    filename: string;
    downloadUrl: string;
  }>;
}

interface SyncPayload {
  type: 'proposals' | 'vouchers';
  items: ProposalPushData[] | VoucherPushData[];
}

const ALLOWED_USER_IDS = [
  'cmkkvpopa0001sbpqnk5cbpiu', // 홍정수
  'cmouna6bf01w0xjhgf6imupg5', // 김정중
  'cmoknhiqj0av02rtgo5eou86t', // 김선구
];

/**
 * CAMS 데이터 동기화 컨트롤러
 * - 사내 서버에서 푸시 받아 DB에 저장
 * - 프론트엔드에서 조회
 */
@Controller('cams')
export class CamsSyncController {
  constructor(private prisma: PrismaService) {}

  /**
   * POST /api/cams/sync
   * 사내 서버에서 품의서/전표 데이터를 푸시
   * Header: X-CAMS-API-KEY 필수
   */
  @Public()
  @Post('sync')
  async sync(
    @Headers('x-cams-api-key') apiKey: string,
    @Body() payload: SyncPayload,
  ) {
    const expectedKey = process.env.CAMS_SYNC_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    const { type, items } = payload;
    let created = 0;
    let updated = 0;

    if (type === 'proposals') {
      for (const item of items as ProposalPushData[]) {
        const existing = await this.prisma.camsProposal.findUnique({
          where: { slpNo: item.slpNo },
        });

        if (existing) {
          // 업데이트
          await this.prisma.camsProposal.update({
            where: { slpNo: item.slpNo },
            data: {
              title: item.title,
              purpose: item.purpose,
              drafter: item.drafter,
              draftDate: item.draftDate,
              dueDate: item.dueDate,
              amount: item.amount,
              paymentTerm: item.paymentTerm,
              vendor: item.vendor,
              content: item.content,
              rawData: item as any,
              syncedAt: new Date(),
            },
          });
          // 첨부파일 갱신 (삭제 후 재생성)
          await this.prisma.camsProposalAttachment.deleteMany({
            where: { proposalId: existing.id },
          });
          if (item.attachments?.length) {
            await this.prisma.camsProposalAttachment.createMany({
              data: item.attachments.map((att) => ({
                proposalId: existing.id,
                seq: att.seq,
                filename: att.filename,
                downloadUrl: att.downloadUrl,
              })),
            });
          }
          updated++;
        } else {
          // 신규 생성
          const created_proposal = await this.prisma.camsProposal.create({
            data: {
              slpNo: item.slpNo,
              title: item.title,
              purpose: item.purpose,
              drafter: item.drafter,
              draftDate: item.draftDate,
              dueDate: item.dueDate,
              amount: item.amount,
              paymentTerm: item.paymentTerm,
              vendor: item.vendor,
              content: item.content,
              rawData: item as any,
            },
          });
          if (item.attachments?.length) {
            await this.prisma.camsProposalAttachment.createMany({
              data: item.attachments.map((att) => ({
                proposalId: created_proposal.id,
                seq: att.seq,
                filename: att.filename,
                downloadUrl: att.downloadUrl,
              })),
            });
          }
          created++;
        }
      }
    } else if (type === 'vouchers') {
      for (const item of items as VoucherPushData[]) {
        const existing = await this.prisma.camsVoucher.findUnique({
          where: { slpNo: item.slpNo },
        });

        if (existing) {
          await this.prisma.camsVoucher.update({
            where: { slpNo: item.slpNo },
            data: {
              title: item.title,
              drafter: item.drafter,
              draftDate: item.draftDate,
              amount: item.amount,
              status: item.status,
              txType: item.txType,
              content: item.content,
              rawData: item as any,
              syncedAt: new Date(),
            },
          });
          await this.prisma.camsVoucherAttachment.deleteMany({
            where: { voucherId: existing.id },
          });
          if (item.attachments?.length) {
            await this.prisma.camsVoucherAttachment.createMany({
              data: item.attachments.map((att) => ({
                voucherId: existing.id,
                seq: att.seq,
                filename: att.filename,
                downloadUrl: att.downloadUrl,
              })),
            });
          }
          updated++;
        } else {
          const created_voucher = await this.prisma.camsVoucher.create({
            data: {
              slpNo: item.slpNo,
              title: item.title,
              drafter: item.drafter,
              draftDate: item.draftDate,
              amount: item.amount,
              status: item.status,
              txType: item.txType,
              content: item.content,
              rawData: item as any,
            },
          });
          if (item.attachments?.length) {
            await this.prisma.camsVoucherAttachment.createMany({
              data: item.attachments.map((att) => ({
                voucherId: created_voucher.id,
                seq: att.seq,
                filename: att.filename,
                downloadUrl: att.downloadUrl,
              })),
            });
          }
          created++;
        }
      }
    }

    return {
      success: true,
      type,
      created,
      updated,
      total: items.length,
    };
  }

  /**
   * GET /api/cams/proposals
   * 저장된 품의서 목록 조회
   */
  @Get('proposals')
  async getProposals(
    @Query('actorId') actorId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!actorId || !ALLOWED_USER_IDS.includes(actorId)) {
      throw new UnauthorizedException('접근 권한이 없습니다');
    }

    const take = Math.min(parseInt(limit || '50', 10), 100);
    const skip = parseInt(offset || '0', 10);

    const [items, total] = await Promise.all([
      this.prisma.camsProposal.findMany({
        take,
        skip,
        orderBy: { draftDate: 'desc' },
        include: { attachments: true },
      }),
      this.prisma.camsProposal.count(),
    ]);

    return { items, total, limit: take, offset: skip };
  }

  /**
   * GET /api/cams/proposals/:slpNo
   * 품의서 상세 조회
   */
  @Get('proposals/:slpNo')
  async getProposal(
    @Param('slpNo') slpNo: string,
    @Query('actorId') actorId?: string,
  ) {
    if (!actorId || !ALLOWED_USER_IDS.includes(actorId)) {
      throw new UnauthorizedException('접근 권한이 없습니다');
    }

    const proposal = await this.prisma.camsProposal.findUnique({
      where: { slpNo },
      include: { attachments: true },
    });

    return proposal;
  }

  /**
   * GET /api/cams/vouchers
   * 저장된 전표 목록 조회
   */
  @Get('vouchers')
  async getVouchers(
    @Query('actorId') actorId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!actorId || !ALLOWED_USER_IDS.includes(actorId)) {
      throw new UnauthorizedException('접근 권한이 없습니다');
    }

    const take = Math.min(parseInt(limit || '50', 10), 100);
    const skip = parseInt(offset || '0', 10);

    const [items, total] = await Promise.all([
      this.prisma.camsVoucher.findMany({
        take,
        skip,
        orderBy: { draftDate: 'desc' },
        include: { attachments: true },
      }),
      this.prisma.camsVoucher.count(),
    ]);

    return { items, total, limit: take, offset: skip };
  }
}
