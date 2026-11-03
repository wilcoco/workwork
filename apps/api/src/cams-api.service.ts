import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * CAMS 공식 API 클라이언트 (2026-10-20 사양서 기준, 2026-11-04 전환).
 *
 * 이전에는 레거시 ASP.NET 화면(HTML)을 긁어 파싱했다. 이제는 사내에서 제공하는 JSON API를 쓴다.
 *   GET {base}/api/data.ashx?resource=pulist|pu|files|accolist|acco|accofiles
 *   GET {base}/api/file.ashx?slp_no&sort[&src=pu|ac]            첨부 바이너리(청크 스트리밍, 대용량 가능)
 *   GET {base}/acco/{mpu|macco}_{commit|return}.aspx?...        결재·반려(쓰기)
 * 인증은 헤더 X-API-KEY (환경변수 CAMS_API_KEY — 저장소에 두지 않는다).
 *
 * ⚠ 서버가 Content-Type을 `application/json; charset=utf-8`로 보내지만 실제 바이트는 CP949(EUC-KR)다.
 *   그대로 JSON.parse 하면 한글이 깨진다. 그래서 바이트를 받아 UTF-8로 엄격 디코딩해 보고,
 *   실패하면 EUC-KR로 디코딩한다(사내 서버가 UTF-8로 고쳐도 그대로 동작).
 */
export type CamsResource = 'pulist' | 'pu' | 'files' | 'accolist' | 'acco' | 'accofiles';
export type CamsSrc = 'pu' | 'ac';

@Injectable()
export class CamsApiService {
  private readonly logger = new Logger(CamsApiService.name);

  get base() { return String(process.env.CAMS_API_BASE || 'https://cn.icams.co.kr').replace(/\/+$/, ''); }
  get key() { return String(process.env.CAMS_API_KEY || '').trim(); }
  get configured() { return !!this.key; }

  private assertConfigured() {
    if (!this.key) throw new ServiceUnavailableException('CAMS API 키가 설정되지 않았습니다 (CAMS_API_KEY)');
  }

  /** CP949로 오는 응답을 안전하게 문자열로 — UTF-8 엄격 시도 후 EUC-KR 대체 */
  private decode(buf: Buffer): string {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { try { return new TextDecoder('euc-kr' as any).decode(buf); } catch { return buf.toString('utf8'); } }
  }

  private async request(path: string, params: Record<string, string | undefined>, timeoutMs = 30000) {
    this.assertConfigured();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
    const url = `${this.base}${path}?${qs.toString()}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res: any = await (globalThis as any).fetch(url, { headers: { 'X-API-KEY': this.key, Accept: '*/*' }, signal: ac.signal });
      if (!res?.ok) {
        const msg = res?.status === 401 ? 'CAMS API 인증 실패 (키 확인 필요)' : res?.status === 404 ? '대상을 찾을 수 없습니다' : `CAMS API 오류 HTTP ${res?.status}`;
        throw new BadRequestException(msg);
      }
      return res;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new BadRequestException('CAMS API 응답 시간 초과');
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`CAMS API 연결 실패: ${e?.message || e}`);
    } finally { clearTimeout(timer); }
  }

  /** 데이터 조회 */
  async data<T = any>(resource: CamsResource, params: Record<string, string | undefined> = {}): Promise<T> {
    const res = await this.request('/api/data.ashx', { resource, ...params });
    const text = this.decode(Buffer.from(await res.arrayBuffer()));
    try { return JSON.parse(text) as T; }
    catch { throw new BadRequestException(`CAMS API 응답을 해석할 수 없습니다: ${text.slice(0, 160)}`); }
  }

  /** 첨부 다운로드 — 바이너리 + 상류가 준 파일명/타입 */
  async file(slpNo: string, sort: string, src: CamsSrc = 'pu'): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
    const res = await this.request('/api/file.ashx', { slp_no: slpNo, sort, src }, 120000);
    const buffer = Buffer.from(await res.arrayBuffer());
    const cd = String(res.headers?.get?.('content-disposition') || '');
    let filename: string | undefined;
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    if (star) filename = decodeURIComponent(star[1]);
    else if (plain) { try { filename = this.decode(Buffer.from(plain[1], 'binary')); } catch { filename = plain[1]; } }
    return { buffer, contentType: String(res.headers?.get?.('content-type') || 'application/octet-stream'), filename };
  }

  /** 결재·반려 (쓰기) — 운영 회계 시스템에 INSERT/UPDATE가 일어난다 */
  async act(kind: CamsSrc, action: 'commit' | 'return', p: { slpNo: string; userId: string; comnm?: string; comip?: string; opinion?: string }) {
    const page = kind === 'pu' ? `mpu_${action}.aspx` : `macco_${action}.aspx`;
    const res = await this.request(`/acco/${page}`, { slp_no: p.slpNo, user_id: p.userId, comnm: p.comnm || 'WORKWORK', comip: p.comip || '', opinion: p.opinion || '' }, 30000);
    const body = this.decode(Buffer.from(await res.arrayBuffer())).slice(0, 500);
    this.logger.log(`CAMS ${kind} ${action} slp=${p.slpNo} by=${p.userId} → ${body.replace(/\s+/g, ' ').slice(0, 120)}`);
    return { ok: true, response: body };
  }
}

// ── 응답 → 화면(grids) 매핑 ────────────────────────────────────────────────
// 기존 화면(CamsBrowser)은 HTML에서 파싱하던 `grids` 구조를 그대로 받는다.
// 필드 코드는 화면의 한글 라벨 사전·구역 판정 규칙에 맞춰 고른다.
export type Grid = { id: string; label?: string; fields: string[]; rows: Array<Record<string, any>> };

const str = (v: any) => (v == null ? '' : String(v));
const num = (v: any) => (v == null || v === '' ? '' : String(v));
/** 결재 상태 코드 → 한글 (관찰값, 사양서 §2.6) */
export const G_STATUS: Record<string, string> = { '01': '미결', '02': '결재', '03': '반려' };
export const DOC_STATUS: Record<string, string> = { '01': '상신', '02': '결재중', '09': '완료', '20': '반려중', '21': '반려완료' };

function grid(id: string, label: string, rows: Array<Record<string, any>>): Grid {
  const fields: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (k !== '_index' && !fields.includes(k)) fields.push(k);
  return { id, label, fields, rows: rows.map((r, i) => ({ ...r, _index: i })) };
}

/** 품의 목록 → 목록 그리드 (화면이 목록으로 인식하려면 id가 정확히 myDataGrid) */
export function puListGrids(rows: any[]): Record<string, Grid> {
  const g = grid('myDataGrid', '내 품의서', rows.map((r) => ({
    slpno: str(r.SLPNO), title: str(r.TITLE), purpose: str(r.AIM), sname: str(r.SBNNAME),
    date: str(r.PYMD), duedate: str(r.WYMD), amount: num(r.SAMT),
  })));
  return { myDataGrid: g };
}

/** 품의 상세 → 품의 정보 / 첨부파일 / 결재선 / 결재이력 */
export function puDetailGrids(d: any): { grids: Record<string, Grid>; attachments: Array<{ seq: number; filename: string; sortValue: string; slpNo: string; size?: number }> } {
  const asp = d?.asp || {};
  const st = d?.status || {};
  const out: Record<string, Grid> = {};
  out.pu_main = grid('pu_main', '품의 정보', [{
    slpno: str(asp.SLPNO), title: str(asp.TITLE), purpose: str(asp.AIM), sname: str(asp.SBNNAME), sabun: str(asp.SBN),
    date: str(asp.PYMD), duedate: str(asp.WYMD), amount: num(asp.SAMT), payterm: str(asp.GJO), company: str(asp.GCOMP),
    status: DOC_STATUS[str(st.STATUS)] || str(st.STATUS), content: str(asp.CONT),
  }]);
  const files: any[] = Array.isArray(d?.files) ? d.files : [];
  if (files.length) out.pu_files = grid('pu_files', '첨부파일', files.map((f) => ({ sort: str(f.SORT), filename: str(f.FNM), filesize: num(f.FSIZE) })));
  const line: any[] = Array.isArray(d?.line) ? d.line : [];
  if (line.length) out.pu_line = grid('pu_line', '결재선', line.map((l) => ({
    signorder: num(l.SEQ), empname: str(l.SNAME), position: str(l.JNAME), sabun: str(l.SBN),
    approvalstatus: G_STATUS[str(l.GSTATUS)] || str(l.GSTATUS), opinion: str(l.OPINION), signdt: str(l.STIME),
  })));
  const log: any[] = Array.isArray(d?.log) ? d.log : [];
  if (log.length) out.pu_log = grid('pu_log', '결재 이력', log.map((l) => ({
    seq: num(l.SEQ), content: str(l.CONTENT), dname: str(l.DNAME), position: str(l.JNAME), empname: str(l.SNAME),
    signdt: str(l.STIME), opinion: str(l.OPINION),
  })));
  const attachments = files.map((f, i) => ({ seq: i + 1, filename: str(f.FNM), sortValue: str(f.SORT), slpNo: str(asp.SLPNO || d?.slpNo || ''), size: Number(f.FSIZE) || undefined }));
  return { grids: out, attachments };
}

/** 전표 목록 */
export function accoListGrids(rows: any[]): Record<string, Grid> {
  const g = grid('myDataGrid', '전표 목록', rows.map((r) => ({
    slpno: str(r.PSPSLPNO), accdate: str(r.PSPPYMD), sname: str(r.SBNNAME), sabun: str(r.PSPSBN),
    dramt: num(r.PSPDRAMT), cramt: num(r.PSPCRAMT), apryn: str(r.PSPDSG), cancelyn: str(r.PSPCNLSG),
  })));
  return { myDataGrid: g };
}

/** 전표 상세 → 전표 정보 / 전표 명세 / 첨부파일 / 결재선 / 결재이력 */
export function accoDetailGrids(d: any): { grids: Record<string, Grid>; attachments: Array<{ seq: number; filename: string; sortValue: string; slpNo: string; size?: number }> } {
  const psp = d?.psp || {};
  const st = d?.status || {};
  const out: Record<string, Grid> = {};
  out.ac_main = grid('ac_main', '전표 정보', [{
    slpno: str(psp.PSPSLPNO), accdate: str(psp.PSPPYMD), sname: str(psp.SBNNAME), sabun: str(psp.PSPSBN),
    dramt: num(psp.PSPDRAMT), cramt: num(psp.PSPCRAMT), apryn: str(psp.PSPDSG), cancelyn: str(psp.PSPCNLSG),
    signdate: str(psp.PSPDYMD), inpdt: str(psp.PSPSDT), status: DOC_STATUS[str(st.STATUS)] || str(st.STATUS),
  }]);
  const items: any[] = Array.isArray(d?.items) ? d.items : [];
  if (items.length) out.ac_items = grid('ac_items', '전표 명세', items.map((r) => ({
    seq: num(r.ASPSEQ), aspdcsg: str(r.ASPDCSG), aspacd: str(r.ASPACD), acctnm: str(r.ACDNAME), aspamt: num(r.ASPAMT),
    aspnote: str(r.ASPNOTE).trim(), dname: str(r.ASPDEPT), sabun: str(r.ASPSBN), vendornm: str(r.ASPVNDNM),
  })));
  const files: any[] = Array.isArray(d?.files) ? d.files : [];
  if (files.length) out.ac_files = grid('ac_files', '첨부파일', files.map((f) => ({ sort: str(f.SORT), filename: str(f.FNM), filesize: num(f.FSIZE) })));
  const line: any[] = Array.isArray(d?.line) ? d.line : [];
  if (line.length) out.ac_line = grid('ac_line', '결재선', line.map((l) => ({
    signorder: num(l.SEQ), empname: str(l.SNAME), position: str(l.JNAME), sabun: str(l.SBN),
    approvalstatus: G_STATUS[str(l.GSTATUS)] || str(l.GSTATUS), opinion: str(l.OPINION), signdt: str(l.STIME),
  })));
  const log: any[] = Array.isArray(d?.log) ? d.log : [];
  if (log.length) out.ac_log = grid('ac_log', '결재 이력', log.map((l) => ({
    seq: num(l.SEQ), content: str(l.CONTENT), dname: str(l.DNAME), position: str(l.JNAME), empname: str(l.SNAME),
    signdt: str(l.STIME), opinion: str(l.OPINION),
  })));
  const attachments = files.map((f, i) => ({ seq: i + 1, filename: str(f.FNM), sortValue: str(f.SORT), slpNo: str(psp.PSPSLPNO || ''), size: Number(f.FSIZE) || undefined }));
  return { grids: out, attachments };
}

/** 화면이 쓰는 평면 목록 */
export function flatten(grids: Record<string, Grid>) {
  const items: any[] = [];
  for (const [id, g] of Object.entries(grids)) g.rows.forEach((r, i) => items.push({ _grid: id, _index: i, ...r }));
  return items;
}

/** 기본 조회 기간 — 최근 n일 (KST) */
export function defaultRange(days = 90) {
  const now = new Date(Date.now() + 9 * 3600000);
  const to = now.toISOString().slice(0, 10).replace(/-/g, '');
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  return { from, to };
}
export const ymd = (v?: string) => { const s = String(v || '').replace(/[^0-9]/g, ''); return /^\d{8}$/.test(s) ? s : undefined; };
