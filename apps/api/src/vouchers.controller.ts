import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './prisma.service';
import { tenantGet } from './lib/tenant';
import { accoDetailGrids, accoListGrids, CamsApiService, defaultRange, flatten, ymd } from './cams-api.service';

/**
 * 전표(회계) 조회 — CAMS 공식 API(JSON) 기반. 품의서와 같은 응답 구조.
 *  GET  /api/vouchers/list[?slpNo=&from=&to=]   목록 또는 상세
 *  GET  /api/vouchers/file?slpNo=&sort=         첨부 다운로드 (src=ac)
 *  POST /api/vouchers/approve | /reject         결재·반려 (기본 잠금)
 */
@Controller('vouchers')
export class VouchersController {
  constructor(private prisma: PrismaService, private cams: CamsApiService) {}

  private async assertAllowed(actorId?: string) {
    const id = String(actorId || '').trim();
    if (!id) throw new ForbiddenException('접근 권한이 없습니다');
    const allowed = await tenantGet<string[]>(this.prisma, 'cams.allowedUserIds');
    if (!Array.isArray(allowed) || !allowed.includes(id)) throw new ForbiddenException('접근 권한이 없습니다');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, name: true, employeeNo: true, role: true } });
    if (!u) throw new ForbiddenException('접근 권한이 없습니다');
    return u;
  }

  @Get('list')
  async list(@Query('slpNo') slpNo?: string, @Query('actorId') actorId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    await this.assertAllowed(actorId);
    const trimmed = String(slpNo || '').trim();
    if (trimmed) {
      const d = await this.cams.data('acco', { slp_no: trimmed });
      const { grids, attachments } = accoDetailGrids(d);
      const items = flatten(grids);
      return { slpNo: trimmed, sourceUrl: `${this.cams.base}/api/data.ashx?resource=acco&slp_no=${trimmed}`, grids, count: items.length, items, attachments };
    }
    const r = defaultRange(30);
    const f = ymd(from) || r.from, t = ymd(to) || r.to;
    const rows = await this.cams.data<any[]>('accolist', { from: f, to: t });
    const grids = accoListGrids(Array.isArray(rows) ? rows : []);
    const items = flatten(grids);
    return { slpNo: '', sourceUrl: `${this.cams.base}/api/data.ashx?resource=accolist&from=${f}&to=${t}`, range: { from: f, to: t }, grids, count: items.length, items, attachments: [] };
  }

  @Get('file')
  async downloadFile(@Query('slpNo') slpNo: string, @Query('sort') sort: string, @Query('filename') filename: string, @Query('actorId') actorId: string, @Res() res: Response) {
    await this.assertAllowed(actorId);
    if (!slpNo || !sort) throw new BadRequestException('slpNo와 sort가 필요합니다');
    const { buffer, contentType, filename: upstreamName } = await this.cams.file(String(slpNo), String(sort), 'ac');
    const name = filename || upstreamName || `file_${slpNo}_${sort}`;
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }

  private async assertApprover(user: any, slpNo: string) {
    if (!(await tenantGet<any>(this.prisma, 'cams.writeEnabled'))) {
      throw new ForbiddenException('CAMS 결재 기능이 꺼져 있습니다 (관리 → 회사 설정에서 cams.writeEnabled)');
    }
    const empNo = String(user.employeeNo || '').trim();
    if (!empNo) throw new BadRequestException('내 사번(employeeNo)이 등록돼 있지 않습니다');
    const d: any = await this.cams.data('acco', { slp_no: slpNo });
    const line: any[] = Array.isArray(d?.line) ? d.line : [];
    const mine = line.find((l) => String(l.SBN).trim() === empNo);
    if (!mine) throw new ForbiddenException('이 전표의 결재선에 없습니다');
    if (String(mine.GSTATUS) !== '01') throw new BadRequestException('이미 처리한 건입니다');
    return empNo;
  }

  @Post('approve')
  async approve(@Body() b: any) {
    const user = await this.assertAllowed(b?.actorId);
    const slpNo = String(b?.slpNo || '').trim();
    if (!slpNo) throw new BadRequestException('slpNo가 필요합니다');
    const empNo = await this.assertApprover(user, slpNo);
    return this.cams.act('ac', 'commit', { slpNo, userId: empNo, comnm: 'WORKWORK', opinion: String(b?.opinion || '').slice(0, 200) });
  }

  @Post('reject')
  async reject(@Body() b: any) {
    const user = await this.assertAllowed(b?.actorId);
    const slpNo = String(b?.slpNo || '').trim();
    const opinion = String(b?.opinion || '').trim();
    if (!slpNo) throw new BadRequestException('slpNo가 필요합니다');
    if (!opinion) throw new BadRequestException('반려 사유를 적어 주세요');
    const empNo = await this.assertApprover(user, slpNo);
    return this.cams.act('ac', 'return', { slpNo, userId: empNo, comnm: 'WORKWORK', opinion: opinion.slice(0, 200) });
  }
}
