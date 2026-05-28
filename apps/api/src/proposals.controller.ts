import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { fetchCamsHtml, parseGrids, flattenGrids, buildDiagnostics } from './cams.util';

const ALLOWED_USER_IDS = [
  'cmkkvpopa0001sbpqnk5cbpiu', // 홍정수
  'cmouna6bf01w0xjhgf6imupg5', // 김정중
  'cmoknhiqj0av02rtgo5eou86t', // 김선구
];
export type { ParsedGrid } from './cams.util';

/**
 * Read-only proxy + parser for the legacy CAMS approval pages.
 *
 * There are two distinct pages with different DataGrid layouts:
 *
 * 1. **List page** — `http://cn.icams.co.kr/boss/mpu.aspx` (no params).
 *    Renders all of the current user's proposals as one DataGrid named
 *    `myDataGrid`, with span ids of the form `myDataGrid_lbl<FIELD><N>`
 *    (note: NO underscore between field and index). Fields observed:
 *    `SLPNO`, `SNAME`, `STATUS`, `TITLE`, `DNAME`, `AMT`.
 *
 * 2. **Detail page** — `http://cn.icams.co.kr/acco/masp_list.aspx?slp_no=<N>`.
 *    Despite the URL name it is a single-document detail view that
 *    requires `slp_no`. With no `slp_no` the page returns an empty
 *    ASP.NET WebForms shell (~841 bytes, just `__VIEWSTATE`). With a
 *    valid `slp_no` it renders up to four DataGrids on the same page
 *    (main info, attached files, bidder companies, approval line). Span
 *    ids follow `myDataGrid2_lbl<FIELD>_<N>` (note: WITH underscore).
 *
 * The upstream is plain HTTP and CORS-less, so the browser cannot fetch
 * either page directly from the HTTPS web app — this controller fetches
 * server-side and groups the rows by grid id. The PowerApps source the
 * legacy app uses confirms both URL/regex variants.
 */
@Controller('proposals')
export class ProposalsController {
  /**
   * GET /api/proposals/list[?slpNo=<N>]
   *
   * - With no `slpNo`: fetch the list page (`/boss/mpu.aspx`) and parse
   *   the single `myDataGrid` into one flat list of proposals.
   * - With `slpNo`: fetch the detail page and return the four DataGrids
   *   keyed by their grid id, with rows of `{ <fieldCode>: <text> }`.
   *
   * Both cases share the same response shape (`grids` + flat `items`)
   * so the frontend can render either uniformly.
   */
  @Get('list')
  async list(@Query('slpNo') slpNo?: string, @Query('actorId') actorId?: string) {
    if (!actorId || !ALLOWED_USER_IDS.includes(actorId)) {
      throw new BadRequestException('접근 권한이 없습니다');
    }
    const trimmed = String(slpNo || '').trim();
    const url = trimmed
      ? `${process.env.CAMS_PROPOSAL_DETAIL_URL || process.env.CAMS_PROPOSAL_LIST_URL || 'http://cn.icams.co.kr/acco/masp_list.aspx'}?slp_no=${encodeURIComponent(trimmed)}`
      : (process.env.CAMS_PROPOSAL_BOSS_URL || 'http://cn.icams.co.kr/boss/mpu.aspx');

    const html = await fetchCamsHtml(url);
    const grids = parseGrids(html);
    const items = flattenGrids(grids);
    const diagnostics = items.length === 0 ? buildDiagnostics(html, Boolean(trimmed)) : undefined;

    // 상세 조회 시 첨부파일 페이지도 가져오기
    let attachments: Array<{ seq: number; filename: string; downloadUrl: string }> = [];
    if (trimmed) {
      try {
        const filesUrl = `http://cn.icams.co.kr/acco/mpu_list2.aspx?slp_no=${encodeURIComponent(trimmed)}`;
        const filesHtml = await fetchCamsHtml(filesUrl);
        const filesGrids = parseGrids(filesHtml);
        // 파일 그리드 찾기
        const fileGrid = Object.values(filesGrids).find(g => g.rows.length > 0);
        if (fileGrid && fileGrid.rows.length > 0) {
          // 디버깅: 필드와 첫 번째 행 출력
          console.log('[첨부파일] fields:', fileGrid.fields);
          console.log('[첨부파일] row[0]:', fileGrid.rows[0]);

          // 필드 순서: 순번, 품의서번호, 파일명, ...
          // 파일명은 slpno/seq가 아닌 필드 중 첫 번째
          const skipFields = ['seq', 'sno', 'no', 'slpno', 'slp_no', 'num', 'idx'];
          const filenameField = fileGrid.fields.find(f =>
            !skipFields.includes(f.toLowerCase())
          ) || fileGrid.fields[2] || fileGrid.fields[0];
          console.log('[첨부파일] filenameField:', filenameField);

          // sort 필드가 있으면 그 값 사용, 없으면 행 인덱스 사용
          const sortField = fileGrid.fields.find(f => /^(sort|imgsort|seq|sno)$/i.test(f));

          attachments = fileGrid.rows.map((row, idx) => {
            const filename = String(row[filenameField] ?? `파일${idx + 1}`).trim();
            // sort 값: 필드에서 가져오거나, 1부터 시작하는 순번
            const sortValue = sortField ? String(row[sortField] ?? idx + 1) : String(idx + 1);
            return {
              seq: idx + 1,
              filename,
              sortValue,
              slpNo: trimmed,
            };
          });
          console.log('[첨부파일] sortField:', sortField, 'attachments:', attachments);
        }
      } catch (e) {
        // 첨부파일 조회 실패해도 메인 데이터는 반환
        console.error('첨부파일 조회 실패:', e);
      }
    }

    return {
      slpNo: trimmed,
      sourceUrl: url,
      grids,
      count: items.length,
      items,
      attachments,
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  /**
   * GET /api/proposals/file?slpNo=<N>&sort=<N>&filename=<name>
   * CAMS 첨부파일을 프록시하여 다운로드
   */
  @Get('file')
  async downloadFile(
    @Query('slpNo') slpNo: string,
    @Query('sort') sort: string,
    @Query('filename') filename: string,
    @Query('actorId') actorId: string,
    @Res() res: Response,
  ) {
    if (!actorId || !ALLOWED_USER_IDS.includes(actorId)) {
      throw new BadRequestException('접근 권한이 없습니다');
    }
    if (!slpNo || !sort) {
      throw new BadRequestException('slpNo와 sort가 필요합니다');
    }

    const url = `http://cn.icams.co.kr/acco/mpu_list2.aspx?slp_no=${encodeURIComponent(slpNo)}&sort=${encodeURIComponent(sort)}`;

    try {
      const f: any = (globalThis as any).fetch;
      const upstream = await f(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!upstream.ok) {
        throw new BadRequestException(`CAMS 파일 조회 실패: ${upstream.status}`);
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const buffer = Buffer.from(await upstream.arrayBuffer());

      // 파일명 인코딩 (한글 지원)
      const safeName = filename || `file_${slpNo}_${sort}`;
      const encodedFilename = encodeURIComponent(safeName);

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'Content-Length': buffer.length,
      });
      res.send(buffer);
    } catch (e: any) {
      throw new BadRequestException(`파일 다운로드 실패: ${e?.message || e}`);
    }
  }

  /**
   * GET /api/proposals/debug?slpNo=...
   * Returns the raw HTML (truncated) and a few quick diagnostics so we can
   * see what the upstream page is actually returning when the parsed list
   * comes back empty.
   */
  @Get('debug')
  async debug(@Query('slpNo') slpNo?: string, @Query('actorId') actorId?: string) {
    if (!actorId || !ALLOWED_USER_IDS.includes(actorId)) {
      throw new BadRequestException('접근 권한이 없습니다');
    }
    const base = process.env.CAMS_PROPOSAL_LIST_URL ||
      'http://cn.icams.co.kr/acco/masp_list.aspx';
    const trimmed = String(slpNo || '').trim();
    const url = trimmed ? `${base}?slp_no=${encodeURIComponent(trimmed)}` : base;

    try {
      const html = await fetchCamsHtml(url);
      return { url, ...buildDiagnostics(html, Boolean(trimmed)) };
    } catch (e: any) {
      return { url, error: e?.message || String(e) };
    }
  }
}

