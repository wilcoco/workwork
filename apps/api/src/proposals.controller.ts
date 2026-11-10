import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './prisma.service';
import { tenantGet } from './lib/tenant';
import { CamsApiService, defaultRange, DOC_STATUS, flatten, puDetailGrids, puListGrids, ymd } from './cams-api.service';

/**
 * 품의서 조회 — CAMS 공식 API(JSON) 기반. 2026-11-04 HTML 스크래핑에서 전환.
 *  GET  /api/proposals/list[?slpNo=&from=&to=&sbn=]   목록 또는 상세(화면용 grids 구조 유지)
 *  GET  /api/proposals/file?slpNo=&sort=&filename=    첨부 다운로드(프록시)
 *  POST /api/proposals/approve | /reject              결재·반려 (기본 잠금, 테넌트 설정으로 해제)
 * 접근 권한은 테넌트 설정 cams.allowedUserIds.
 */
@Controller('proposals')
export class ProposalsController {
  /** 품의 상태 캐시 (번호 → 값, 60초) — 목록 20건씩 반복 조회를 줄인다 */
  private static statusCache = new Map<string, { v: any; at: number }>();

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
  async list(@Query('slpNo') slpNo?: string, @Query('actorId') actorId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('sbn') sbn?: string) {
    await this.assertAllowed(actorId);
    const trimmed = String(slpNo || '').trim();
    if (trimmed) {
      const d = await this.cams.data('pu', { slp_no: trimmed });
      const { grids, attachments } = puDetailGrids({ ...d, slpNo: trimmed });
      const items = flatten(grids);
      return { slpNo: trimmed, sourceUrl: `${this.cams.base}/api/data.ashx?resource=pu&slp_no=${trimmed}`, grids, count: items.length, items, attachments };
    }
    const r = defaultRange(90);
    const f = ymd(from) || r.from, t = ymd(to) || r.to;
    const rows = await this.cams.data<any[]>('pulist', { from: f, to: t, sbn: String(sbn || '').trim() || undefined });
    const grids = puListGrids(Array.isArray(rows) ? rows : []);
    const items = flatten(grids);
    return { slpNo: '', sourceUrl: `${this.cams.base}/api/data.ashx?resource=pulist&from=${f}&to=${t}`, range: { from: f, to: t }, grids, count: items.length, items, attachments: [] };
  }

  @Get('file')
  async downloadFile(@Query('slpNo') slpNo: string, @Query('sort') sort: string, @Query('filename') filename: string, @Query('actorId') actorId: string, @Res() res: Response) {
    await this.assertAllowed(actorId);
    if (!slpNo || !sort) throw new BadRequestException('slpNo와 sort가 필요합니다');
    const { buffer, contentType, filename: upstreamName } = await this.cams.file(String(slpNo), String(sort), 'pu');
    const name = filename || upstreamName || `file_${slpNo}_${sort}`;
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }

  /** 결재선에 실제로 들어 있고 아직 미결인 사람만 — 사번은 User.employeeNo 로 맞춘다 */
  private async assertApprover(user: any, slpNo: string) {
    if (!(await tenantGet<any>(this.prisma, 'cams.writeEnabled'))) {
      throw new ForbiddenException('CAMS 결재 기능이 꺼져 있습니다 (관리 → 회사 설정에서 cams.writeEnabled)');
    }
    const empNo = String(user.employeeNo || '').trim();
    if (!empNo) throw new BadRequestException('내 사번(employeeNo)이 등록돼 있지 않습니다');
    const d: any = await this.cams.data('pu', { slp_no: slpNo });
    const line: any[] = Array.isArray(d?.line) ? d.line : [];
    const mine = line.find((l) => String(l.SBN).trim() === empNo);
    if (!mine) throw new ForbiddenException('이 품의의 결재선에 없습니다');
    if (String(mine.GSTATUS) !== '01') throw new BadRequestException('이미 처리한 건입니다');
    return empNo;
  }

  @Post('approve')
  async approve(@Body() b: any) {
    const user = await this.assertAllowed(b?.actorId);
    const slpNo = String(b?.slpNo || '').trim();
    if (!slpNo) throw new BadRequestException('slpNo가 필요합니다');
    const empNo = await this.assertApprover(user, slpNo);
    return this.cams.act('pu', 'commit', { slpNo, userId: empNo, comnm: 'WORKWORK', opinion: String(b?.opinion || '').slice(0, 200) });
  }

  @Post('reject')
  async reject(@Body() b: any) {
    const user = await this.assertAllowed(b?.actorId);
    const slpNo = String(b?.slpNo || '').trim();
    const opinion = String(b?.opinion || '').trim();
    if (!slpNo) throw new BadRequestException('slpNo가 필요합니다');
    if (!opinion) throw new BadRequestException('반려 사유를 적어 주세요');
    const empNo = await this.assertApprover(user, slpNo);
    return this.cams.act('pu', 'return', { slpNo, userId: empNo, comnm: 'WORKWORK', opinion: opinion.slice(0, 200) });
  }

  /**
   * GET /api/proposals/status?slpNos=a,b,c
   * 목록 API에는 결재 상태가 없다(전표와 달리). 화면에 보이는 쪽(20건)만 상세를 병렬로 읽어 상태를 돌려준다.
   * 같은 번호를 다시 물으면 60초 동안은 캐시로 답한다(페이지를 오가도 다시 호출하지 않게).
   */
  @Get('status')
  async status(@Query('slpNos') slpNos?: string, @Query('actorId') actorId?: string) {
    await this.assertAllowed(actorId);
    const ids = String(slpNos || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30);
    if (!ids.length) return { items: {} };
    const now = Date.now();
    const items: Record<string, any> = {};
    const todo: string[] = [];
    for (const id of ids) {
      const c = ProposalsController.statusCache.get(id);
      if (c && now - c.at < 60000) items[id] = c.v; else todo.push(id);
    }
    // 상류 부담을 줄이려고 6건씩 끊어서 병렬 호출
    for (let i = 0; i < todo.length; i += 6) {
      const chunk = todo.slice(i, i + 6);
      await Promise.all(chunk.map(async (id) => {
        try {
          const d: any = await this.cams.data('pu', { slp_no: id });
          const line: any[] = Array.isArray(d?.line) ? d.line : [];
          const code = String(d?.status?.STATUS || '');
          const done = line.filter((l) => String(l.GSTATUS) === '02').length;
          const next = line.find((l) => String(l.GSTATUS) === '01');
          const v = {
            code, label: DOC_STATUS[code] || code || '-', done, total: line.length,
            current: next ? `${String(next.SNAME || '').trim()}${next.JNAME ? ` ${next.JNAME}` : ''}` : '',
            files: Array.isArray(d?.files) ? d.files.length : 0,
          };
          items[id] = v;
          ProposalsController.statusCache.set(id, { v, at: Date.now() });
        } catch { items[id] = { code: '', label: '?', done: 0, total: 0, current: '', files: 0 }; }
      }));
    }
    return { items };
  }

  /** 연결 상태 점검 (키 설정 여부·응답 확인) */
  @Get('health')
  async health(@Query('actorId') actorId?: string) {
    await this.assertAllowed(actorId);
    if (!this.cams.configured) return { ok: false, reason: 'CAMS_API_KEY 미설정', base: this.cams.base };
    const r = defaultRange(7);
    try {
      const rows = await this.cams.data<any[]>('pulist', { from: r.from, to: r.to });
      return { ok: true, base: this.cams.base, range: r, count: Array.isArray(rows) ? rows.length : 0, writeEnabled: !!(await tenantGet<any>(this.prisma, 'cams.writeEnabled')) };
    } catch (e: any) { return { ok: false, base: this.cams.base, reason: e?.message || String(e) }; }
  }
}
