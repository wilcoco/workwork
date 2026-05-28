import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
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
    return {
      slpNo: trimmed,
      sourceUrl: url,
      grids,
      count: items.length,
      items,
      ...(diagnostics ? { diagnostics } : {}),
    };
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

