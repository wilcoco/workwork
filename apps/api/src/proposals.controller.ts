import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from './jwt-auth.guard';

/**
 * Read-only proxy + parser for the legacy CAMS approval detail page
 * (http://cn.icams.co.kr/acco/masp_list.aspx?slp_no=<N>).
 *
 * Note: despite the URL name `masp_list.aspx`, this page is actually a
 * **single-document detail view** that requires `slp_no`. With no
 * `slp_no` the page returns an empty ASP.NET WebForms shell (~841 bytes,
 * just `__VIEWSTATE`). Calling it with a valid `slp_no` renders four
 * separate DataGrids on the same page:
 *
 *   1. main info (single row, 14 fields)
 *   2. attached files
 *   3. bidder companies
 *   4. approval line
 *
 * Each grid renders cells as `<span id="<gridId>_lbl<FIELD>_<row>">`. The
 * upstream is plain HTTP and CORS-less, so the browser cannot fetch it
 * directly from the HTTPS web app — this controller fetches server-side
 * and groups the rows by grid id.
 */
@Controller('proposals')
export class ProposalsController {
  /**
   * GET /api/proposals/list?slpNo=<N>
   *
   * `slpNo` is required. Returns the four DataGrids on the detail page,
   * keyed by their grid id, with rows of `{ <fieldCode>: <text> }` plus a
   * stable `_index` for ordering.
   */
  @Public()
  @Get('list')
  async list(@Query('slpNo') slpNo?: string) {
    const base = process.env.CAMS_PROPOSAL_LIST_URL ||
      'http://cn.icams.co.kr/acco/masp_list.aspx';
    const trimmed = String(slpNo || '').trim();
    if (!trimmed) {
      throw new BadRequestException('slpNo is required (e.g. ?slpNo=103485). The upstream page returns an empty form when called without one.');
    }
    const url = `${base}?slp_no=${encodeURIComponent(trimmed)}`;

    let html = '';
    try {
      const f: any = (globalThis as any).fetch;
      const res = await f(url, {
        method: 'GET',
        headers: {
          // Use a realistic desktop browser UA — some legacy ASP.NET pages
          // gate non-browser UAs with a 403 or a stripped response.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
      });
      if (!res?.ok) {
        throw new BadRequestException(`Upstream HTTP ${res?.status}`);
      }
      html = await res.text();
    } catch (e: any) {
      throw new BadRequestException(`Upstream fetch failed: ${e?.message || e}`);
    }

    const grids = parseGrids(html);
    const items = flattenGrids(grids);
    // When nothing is parsed, attach lightweight diagnostics so the frontend
    // can show *why* the list is empty (auth wall, structure change, etc.)
    // rather than a silent zero state.
    let diagnostics: any = undefined;
    if (items.length === 0) {
      const lblIds = Array.from(html.matchAll(/\bid=["']?([A-Za-z0-9_]*lbl[A-Za-z0-9]+_\d+)["']?/gi))
        .map((m: any) => m[1]);
      const lblSample = Array.from(new Set(lblIds)).slice(0, 20);
      const looksLikeLogin = /login|\b(아이디|비밀번호)\b|j_username|loginForm/i.test(html);
      const looksLikeError = /<title>\s*(error|에러|오류)/i.test(html);
      // First piece of visible text in the body — often the upstream's own
      // empty/error message which is the most actionable hint.
      const bodyText = decodeEntities(stripTags(html))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
      // Sample some of the structural id/class attributes so we can spot a
      // new grid pattern at a glance without dumping the full HTML.
      const idSample = Array.from(html.matchAll(/\bid=["']([^"']{1,80})["']/gi))
        .map((m: any) => m[1])
        .slice(0, 30);
      const classSample = Array.from(html.matchAll(/\bclass=["']([^"']{1,80})["']/gi))
        .map((m: any) => m[1])
        .slice(0, 30);
      diagnostics = {
        htmlLength: html.length,
        lblIdsFoundSample: lblSample,
        idSample,
        classSample,
        looksLikeLogin,
        looksLikeError,
        bodyTextSnippet: bodyText,
        // Raw HTML head so we can see the actual new grid markup directly
        // from the empty state on the page (avoids Service Worker eating
        // the /debug navigation).
        htmlSnippet: html.slice(0, 4000),
        hint: looksLikeLogin
          ? 'CAMS upstream returned a login page — the proxy may need session cookies.'
          : (lblSample.length === 0
            ? 'No lbl<FIELD>_<n> spans were found in the HTML — page structure likely changed.'
            : 'lbl spans exist but no row had a non-empty title — title field id may have changed.'),
      };
    }
    return {
      slpNo: trimmed,
      sourceUrl: url,
      // Each grid keyed by its DataGrid id, in document order, with rows
      // ordered by their original row index.
      grids,
      // Backward-compatible flat list across all grids.
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
  @Public()
  @Get('debug')
  async debug(@Query('slpNo') slpNo?: string) {
    const base = process.env.CAMS_PROPOSAL_LIST_URL ||
      'http://cn.icams.co.kr/acco/masp_list.aspx';
    const trimmed = String(slpNo || '').trim();
    const url = trimmed ? `${base}?slp_no=${encodeURIComponent(trimmed)}` : base;

    const f: any = (globalThis as any).fetch;
    const out: any = { url };
    try {
      const res = await f(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; workwork-proxy/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      out.status = res?.status;
      out.contentType = res?.headers?.get?.('content-type');
      const html = await res.text();
      out.htmlLength = html.length;
      // Detect any DataGrid id pattern (might differ from myDataGrid2).
      const ids = Array.from(html.matchAll(/id=["']?([A-Za-z0-9_]*lblTITLE_\d+)["']?/gi))
        .map((m: any) => m[1])
        .slice(0, 10);
      out.titleSpanIdsFound = ids;
      const allLblIds = Array.from(html.matchAll(/id=["']?([A-Za-z0-9_]*lbl[A-Za-z0-9]+_\d+)["']?/gi))
        .map((m: any) => m[1]);
      out.lblIdsSampled = Array.from(new Set(allLblIds)).slice(0, 30);
      out.htmlSnippet = html.slice(0, 4000);
    } catch (e: any) {
      out.error = e?.message || String(e);
    }
    return out;
  }
}

/**
 * Parse all `<span id="<gridId>_lbl<FIELD>_<INDEX>">...</span>` cells in the HTML and
 * group them first by `<gridId>` (each ASP.NET DataGrid on the page) and
 * then by `<INDEX>` (row within that grid). Strips inner HTML tags and
 * decodes the common HTML entities so the caller gets plain Korean text.
 *
 * The detail page has up to four DataGrids on it (main info, files,
 * bidders, approvers), each with its own grid id. We expose all of them
 * keyed by id and let the frontend label them.
 */
export interface ParsedGrid {
  id: string;
  /** Field codes (lowercase) seen in this grid, in their first-seen order. */
  fields: string[];
  /** Rows ordered by ascending row-index, each row is { _index, [field]: text }. */
  rows: Array<Record<string, string | number>>;
}

function parseGrids(html: string): Record<string, ParsedGrid> {
  // Match `<span id="<gridId>_lbl<FIELD>_<INDEX>">...</span>` where gridId
  // is anything up to the trailing `_lbl<FIELD>_<INDEX>` suffix.
  const re = /<span[^>]*\bid=["']?([A-Za-z0-9_]+?)_lbl([A-Za-z0-9]+)_(\d+)["']?[^>]*>([\s\S]*?)<\/span>/gi;
  const byGrid: Record<string, { fieldOrder: string[]; rows: Record<number, Record<string, string>> }> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gridId = m[1];
    const field = m[2].toLowerCase();
    const idx = Number(m[3]);
    const text = decodeEntities(stripTags(m[4])).trim();
    if (!byGrid[gridId]) byGrid[gridId] = { fieldOrder: [], rows: {} };
    const g = byGrid[gridId];
    if (!g.fieldOrder.includes(field)) g.fieldOrder.push(field);
    if (!g.rows[idx]) g.rows[idx] = {};
    g.rows[idx][field] = text;
  }
  const out: Record<string, ParsedGrid> = {};
  for (const [gridId, g] of Object.entries(byGrid)) {
    const indices = Object.keys(g.rows).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const rows = indices.map((idx) => ({ _index: idx, ...g.rows[idx] }));
    out[gridId] = { id: gridId, fields: g.fieldOrder, rows };
  }
  return out;
}

/**
 * Flatten all grids into a single list (for the legacy `items` field on
 * the response). Each row is tagged with `_grid` so consumers can tell
 * which DataGrid it came from.
 */
function flattenGrids(grids: Record<string, ParsedGrid>): Array<Record<string, string | number>> {
  const out: Array<Record<string, string | number>> = [];
  for (const g of Object.values(grids)) {
    for (const r of g.rows) out.push({ _grid: g.id, ...r });
  }
  return out;
}

function stripTags(s: string): string {
  return String(s || '').replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => {
      try { return String.fromCharCode(Number(n)); } catch { return ''; }
    });
}
