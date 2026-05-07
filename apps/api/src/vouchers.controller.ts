import { Controller, Get, Query } from '@nestjs/common';
import { Public } from './jwt-auth.guard';
import { fetchCamsHtml, parseGrids, flattenGrids, buildDiagnostics } from './cams.util';

/**
 * Read-only proxy + parser for the legacy CAMS voucher (전표) pages.
 *
 * Mirrors the proposals controller but against the macco family of
 * pages that the PowerApps source uses:
 *
 *   - List   `http://cn.icams.co.kr/boss/macco.aspx`
 *     One DataGrid `myDataGrid` with span ids `myDataGrid_lbl<F><N>`.
 *     Fields observed: `SLPNO`, `SNAME`, `STATUS`, `ASPNOTE`, `DNAME`,
 *     `AMT`. Note `ASPNOTE` (not `TITLE`) holds the voucher subject.
 *
 *   - Detail `http://cn.icams.co.kr/acco/macco_list.aspx?slp_no=<N>`
 *     Multi-grid layout with the line-item grid named `myDataGrid5`,
 *     span ids `myDataGrid5_lbl<F>_<N>`.
 */
@Controller('vouchers')
export class VouchersController {
  /**
   * GET /api/vouchers/list[?slpNo=<N>]
   *
   * Same response shape as `/api/proposals/list`. With no `slpNo` the
   * upstream list page is hit; with `slpNo` the detail page is fetched
   * and all DataGrids on it are returned, keyed by grid id.
   */
  @Public()
  @Get('list')
  async list(@Query('slpNo') slpNo?: string) {
    const trimmed = String(slpNo || '').trim();
    const url = trimmed
      ? `${process.env.CAMS_VOUCHER_DETAIL_URL || 'http://cn.icams.co.kr/acco/macco_list.aspx'}?slp_no=${encodeURIComponent(trimmed)}`
      : (process.env.CAMS_VOUCHER_BOSS_URL || 'http://cn.icams.co.kr/boss/macco.aspx');

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
}
