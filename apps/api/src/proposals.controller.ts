import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from './jwt-auth.guard';

/**
 * Read-only proxy + parser for the legacy CAMS approval list page
 * (http://cn.icams.co.kr/acco/masp_list.aspx).
 *
 * The upstream is plain HTTP and CORS-less, so the browser cannot fetch it
 * directly from the HTTPS web app. This controller fetches server-side and
 * extracts the DataGrid rows (myDataGrid2_lblXXX_N spans) into a clean JSON
 * list. Mirrors the PowerApps screen logic the user shared.
 */
@Controller('proposals')
export class ProposalsController {
  /**
   * GET /api/proposals/list?slpNo=...
   * Returns the parsed proposal list rows for the given slp_no.
   */
  @Public()
  @Get('list')
  async list(@Query('slpNo') slpNo?: string) {
    const base = process.env.CAMS_PROPOSAL_LIST_URL ||
      'http://cn.icams.co.kr/acco/masp_list.aspx';
    // Empty slp_no asks the upstream for the unfiltered (all-documents)
    // list. The legacy ASP.NET page treats missing/empty slp_no as
    // "show everything", which matches the user's expectation here.
    const trimmed = String(slpNo || '').trim();
    const url = trimmed ? `${base}?slp_no=${encodeURIComponent(trimmed)}` : base;

    let html = '';
    try {
      const f: any = (globalThis as any).fetch;
      const res = await f(url, {
        method: 'GET',
        headers: {
          // Some legacy ASP.NET pages return 403 without a UA.
          'User-Agent': 'Mozilla/5.0 (compatible; workwork-proxy/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!res?.ok) {
        throw new BadRequestException(`Upstream HTTP ${res?.status}`);
      }
      html = await res.text();
    } catch (e: any) {
      throw new BadRequestException(`Upstream fetch failed: ${e?.message || e}`);
    }

    const items = parseRows(html);
    return { slpNo: trimmed, count: items.length, items, sourceUrl: url };
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
 * Parse all `<span id="myDataGrid2_lbl<FIELD>_<INDEX>">...</span>` cells in
 * the HTML, group them by row index, and return the rows that have a
 * non-empty title. Strips inner HTML tags and decodes the most common HTML
 * entities so the caller gets plain Korean text.
 */
function parseRows(html: string): Array<Record<string, string | number>> {
  const re = /<span[^>]*id=["']?myDataGrid2_lbl([A-Za-z0-9]+)_(\d+)["']?[^>]*>([\s\S]*?)<\/span>/gi;
  const byRow: Record<number, Record<string, string>> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const field = m[1].toLowerCase();
    const idx = Number(m[2]);
    const text = decodeEntities(stripTags(m[3])).trim();
    if (!byRow[idx]) byRow[idx] = {};
    byRow[idx][field] = text;
  }
  const indices = Object.keys(byRow)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const rows: Array<Record<string, string | number>> = [];
  for (const idx of indices) {
    const row = byRow[idx];
    // Mirror the PowerApps "downcount" rule: a row is real only if its title
    // is non-blank.
    if (!row.title || !row.title.trim()) continue;
    rows.push({ index: idx, ...row });
  }
  return rows;
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
