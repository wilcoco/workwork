import { BadRequestException } from '@nestjs/common';

/**
 * Shared helpers for the read-only CAMS proxy endpoints (proposals,
 * vouchers, ...). The CAMS pages are legacy ASP.NET WebForms served as
 * EUC-KR over plain HTTP. Each page renders one or more DataGrids whose
 * cells are emitted as `<span id="<gridId>_lbl<FIELD>[_]<INDEX>">value</span>`.
 *
 * - List pages  (`/boss/*.aspx`):           `<gridId>_lbl<FIELD><N>`   (no `_`)
 * - Detail pages (`/acco/*_list.aspx`):     `<gridId>_lbl<FIELD>_<N>`  (with `_`)
 *
 * Both variants are handled by `parseGrids` so callers don't need to
 * special-case them.
 */

/**
 * Fetch a CAMS page and decode it as EUC-KR (with charset sniffing
 * fallback). Throws `BadRequestException` if the upstream returns a
 * non-2xx status or the network request fails.
 */
export async function fetchCamsHtml(url: string): Promise<string> {
  const f: any = (globalThis as any).fetch;
  let res: any;
  try {
    res = await f(url, {
      method: 'GET',
      headers: {
        // Realistic desktop browser UA \u2014 some legacy ASP.NET pages gate
        // non-browser UAs with a 403 or a stripped response.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
  } catch (e: any) {
    throw new BadRequestException(`Upstream fetch failed: ${e?.message || e}`);
  }
  if (!res?.ok) {
    throw new BadRequestException(`Upstream HTTP ${res?.status}`);
  }
  // Read raw bytes and pick a decoder. CAMS pages omit the BOM and
  // usually declare `charset=euc-kr` in either the HTTP header or a
  // `<meta>` tag.
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String(res.headers?.get?.('content-type') || '');
  let charset = /charset=([^;]+)/i.exec(ct)?.[1]?.trim().toLowerCase();
  if (!charset) {
    const head = buf.slice(0, 1024).toString('ascii');
    const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    if (m) charset = m[1].toLowerCase();
  }
  const isKoreanLegacy =
    !charset ||
    /^(euc-?kr|ks_c_5601-1987|ksc5601|cp949|windows-?949|x-?windows-?949)$/i.test(charset);
  const decoderLabel = isKoreanLegacy ? 'euc-kr' : charset!;
  try {
    return new TextDecoder(decoderLabel as any).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

export interface ParsedGrid {
  id: string;
  /** Field codes (lowercase) seen in this grid, in their first-seen order. */
  fields: string[];
  /** Rows ordered by ascending row-index. Each row is `{ _index, [field]: text }`. */
  rows: Array<Record<string, string | number>>;
}

/**
 * Parse all `<span id="<gridId>_lbl<FIELD>[_]<INDEX>">...</span>` cells
 * and group them by grid id, then by row index. Strips inner HTML and
 * decodes common entities so the caller gets plain Korean text.
 */
export function parseGrids(html: string): Record<string, ParsedGrid> {
  // Field name is letters only; the optional underscore between field
  // and index covers both upstream variants (list vs. detail).
  const re = /<span[^>]*\bid=["']?([A-Za-z0-9]+?)_lbl([A-Za-z]+)_?(\d+)["']?[^>]*>([\s\S]*?)<\/span>/gi;
  const byGrid: Record<string, { fieldOrder: string[]; rows: Record<number, Record<string, string>> }> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gridId = m[1];
    const field = m[2].toLowerCase();
    const idx = Number(m[3]);
    const innerHtml = m[4];
    const text = decodeEntities(stripTags(innerHtml)).trim();

    // Extract href from anchor tags inside the span (for file download links)
    const hrefMatch = /<a[^>]+href=["']([^"']+)["']/i.exec(innerHtml);
    const href = hrefMatch ? decodeEntities(hrefMatch[1]) : null;

    if (!byGrid[gridId]) byGrid[gridId] = { fieldOrder: [], rows: {} };
    const g = byGrid[gridId];
    if (!g.fieldOrder.includes(field)) g.fieldOrder.push(field);
    if (!g.rows[idx]) g.rows[idx] = {};
    g.rows[idx][field] = text;

    // Store href as a separate field if found
    if (href) {
      const hrefField = `${field}_href`;
      if (!g.fieldOrder.includes(hrefField)) g.fieldOrder.push(hrefField);
      g.rows[idx][hrefField] = href;
    }
  }
  const out: Record<string, ParsedGrid> = {};
  for (const [gridId, g] of Object.entries(byGrid)) {
    const indices = Object.keys(g.rows).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const rows = indices.map((idx) => ({ _index: idx, ...g.rows[idx] }));
    out[gridId] = { id: gridId, fields: g.fieldOrder, rows };
  }
  return out;
}

/** Flatten all grids into a single list. Each row is tagged with `_grid`. */
export function flattenGrids(grids: Record<string, ParsedGrid>): Array<Record<string, string | number>> {
  const out: Array<Record<string, string | number>> = [];
  for (const g of Object.values(grids)) {
    for (const r of g.rows) out.push({ _grid: g.id, ...r });
  }
  return out;
}

/**
 * Build the diagnostics blob the frontend renders in the empty-state
 * panel. Lets us spot auth walls, structure changes, etc. without a
 * separate /debug round trip.
 */
export function buildDiagnostics(html: string, isDetail: boolean) {
  const lblIds = Array.from(html.matchAll(/\bid=["']?([A-Za-z0-9_]*lbl[A-Za-z]+_?\d+)["']?/gi))
    .map((m: any) => m[1]);
  const lblSample = Array.from(new Set(lblIds)).slice(0, 20);
  const looksLikeLogin = /login|\b(아이디|비밀번호)\b|j_username|loginForm/i.test(html);
  const looksLikeError = /<title>\s*(error|에러|오류)/i.test(html);
  const bodyText = decodeEntities(stripTags(html))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  const idSample = Array.from(html.matchAll(/\bid=["']([^"']{1,80})["']/gi))
    .map((m: any) => m[1])
    .slice(0, 30);
  const classSample = Array.from(html.matchAll(/\bclass=["']([^"']{1,80})["']/gi))
    .map((m: any) => m[1])
    .slice(0, 30);
  return {
    htmlLength: html.length,
    lblIdsFoundSample: lblSample,
    idSample,
    classSample,
    looksLikeLogin,
    looksLikeError,
    bodyTextSnippet: bodyText,
    htmlSnippet: html.slice(0, 4000),
    hint: looksLikeLogin
      ? 'CAMS upstream returned a login page — the proxy may need session cookies.'
      : (lblSample.length === 0
        ? (isDetail
          ? 'No lbl<FIELD>_<n> spans found on the detail page — slp_no may not exist or page structure changed.'
          : 'No lbl<FIELD><n> spans found on the list page — likely an authentication wall (CAMS expects a session).')
        : 'lbl spans exist but parser produced no rows — field id pattern may have changed.'),
  };
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
