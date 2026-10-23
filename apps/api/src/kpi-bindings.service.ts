import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * KPI 데이터 바인딩 — 소스 어댑터와 공통 기록부.
 *
 * 소스 어댑터(어디서 가져오나)만 다르고, 그 뒤(월별 값 → ProgressEntry 기록 → KPI 리포트)는 전부 공통이다.
 *  - INTERNAL     : WorkWork 자체 데이터로 계산 (결재 소요시간, 업무일지 건수 …)
 *  - ODOO_RPC     : Odoo JSON-RPC read_group (환경변수 ODOO_URL/ODOO_DB/ODOO_USER/ODOO_API_KEY)
 *  - REST         : 외부 HTTP 엔드포인트가 [{year,month,value}] 또는 지정한 키로 돌려줌
 *  - ORACLE_AGENT : 사내 에이전트가 작업 큐에서 SQL을 받아 실행 후 결과를 올림 (클라우드는 오라클에 직접 접속하지 않음)
 *
 * 안전: ORACLE_AGENT SQL은 저장·실행 전 서버에서 SELECT 전용 검사(DML·DDL·세미콜론·주석 차단)를 통과해야 한다.
 */
export type MonthValue = { year: number; month: number; value: number | null };
export const KST_MS = 9 * 3600000;

export const SOURCE_TYPES = ['INTERNAL', 'ODOO_RPC', 'REST', 'ORACLE_AGENT'] as const;
export const SCHEDULES: Record<string, string> = { DAILY: '매일 02:00', WEEKLY: '매주 월요일 02:00', MONTHLY_2: '매월 1일·16일 02:00' };

/** 내부 지표 카탈로그 — 서버 데이터로 계산 가능한 월 지표 */
export const INTERNAL_METRICS: Record<string, { label: string; unit: string; desc: string }> = {
  APPROVAL_LEAD_HOURS: { label: '결재 평균 소요시간', unit: '시간', desc: '상신부터 최종 승인/반려까지 평균 시간(월별, 완료 건 기준, 자동 승인 제외)' },
  APPROVAL_COUNT: { label: '결재 처리 건수', unit: '건', desc: '월별 최종 처리(승인+반려)된 결재 건수' },
  APPROVAL_WITHIN_24H_PCT: { label: '결재 24시간 내 처리율', unit: '%', desc: '완료 건 중 24시간 안에 처리된 비율' },
  WORKLOG_COUNT: { label: '업무일지 작성 건수', unit: '건', desc: '월별 작성된 업무일지 수' },
  WORKLOG_WRITER_RATIO_PCT: { label: '업무일지 작성자 비율', unit: '%', desc: '활성 구성원 중 그 달 일지를 1건 이상 쓴 비율' },
  MANUAL_READY_PCT: { label: '매뉴얼 프로세스화 준비도 80+ 비율', unit: '%', desc: '전체 매뉴얼 중 준비도 80점 이상 비율(월말 스냅샷 대신 현재값)' },
  PROCESS_COMPLETED_COUNT: { label: '프로세스 완료 건수', unit: '건', desc: '월별 완료된 프로세스 인스턴스 수' },
};

const DML_RX = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|commit|rollback|execute|exec|call|begin|declare|lock|rename|comment|analyze|audit|flashback|purge)\b/i;

/** 읽기 전용 SQL 검사 — 통과 못 하면 이유를 던진다 */
export function assertReadOnlySql(sqlRaw: string): string {
  const sql = String(sqlRaw || '').trim();
  if (!sql) throw new BadRequestException('SQL이 비어 있습니다');
  if (!/^(select|with)\b/i.test(sql)) throw new BadRequestException('SELECT(또는 WITH)로 시작하는 조회문만 허용합니다');
  if (sql.includes(';')) throw new BadRequestException('세미콜론(;)은 허용하지 않습니다 (문장 1개만)');
  if (/--|\/\*/.test(sql)) throw new BadRequestException('주석(--, /*)은 허용하지 않습니다');
  if (DML_RX.test(sql)) throw new BadRequestException('쓰기·구조 변경 키워드가 포함되어 거부했습니다 (INSERT/UPDATE/DELETE/DDL 등)');
  if (/\bfor\s+update\b/i.test(sql)) throw new BadRequestException('FOR UPDATE는 허용하지 않습니다');
  if (!/:(yy|from_ymd|to_ymd|from_yyyymmdd|to_yyyymmdd)\b/i.test(sql) && !/\b20\d\d\b/.test(sql)) {
    throw new BadRequestException('기간 조건이 필요합니다 — :yy, :from_ymd/:to_ymd, :from_yyyymmdd/:to_yyyymmdd 중 하나를 바인드로 쓰세요');
  }
  if (/\bbin\$/i.test(sql)) throw new BadRequestException('휴지통(BIN$) 객체는 조회 대상이 아닙니다');
  return sql;
}

/** SQL에 실제로 쓰인 바인드만 골라 값 채우기 */
export function buildBindParams(sql: string, year: number, extra?: Record<string, any>): Record<string, any> {
  const used = new Set(Array.from(sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)).map((m) => m[1].toLowerCase()));
  const all: Record<string, any> = {
    yy: String(year), from_ymd: `${year}-01-01`, to_ymd: `${year}-12-31`, from_yyyymmdd: `${year}0101`, to_yyyymmdd: `${year}1231`,
    ...(extra || {}),
  };
  const out: Record<string, any> = {};
  for (const k of Object.keys(all)) if (used.has(k.toLowerCase())) out[k] = all[k];
  return out;
}

/** 결과 행을 {year,month,value}로 정규화 — 컬럼명 연/월/값, YEAR/MONTH/VALUE, YY/MM/VAL, 또는 위치(0,1,2) */
export function normalizeRows(rows: any[]): MonthValue[] {
  const out: MonthValue[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    let y: any, m: any, v: any;
    if (Array.isArray(r)) { [y, m, v] = r; }
    else if (r && typeof r === 'object') {
      const keys = Object.keys(r); const low = (k: string) => k.toLowerCase();
      const pick = (cands: string[]) => { const k = keys.find((kk) => cands.includes(low(kk)) || cands.includes(kk)); return k != null ? r[k] : undefined; };
      y = pick(['연', 'year', 'yy', 'yyyy']); m = pick(['월', 'month', 'mm']); v = pick(['값', 'value', 'val', 'v']);
      if (y === undefined && keys.length >= 3) { y = r[keys[0]]; m = r[keys[1]]; v = r[keys[2]]; }
    } else continue;
    const yi = parseInt(String(y), 10), mi = parseInt(String(m), 10);
    if (!(yi >= 2000 && yi <= 2100) || !(mi >= 1 && mi <= 12)) continue;
    const vn = v == null || v === '' ? null : Number(v);
    out.push({ year: yi, month: mi, value: vn == null || Number.isNaN(vn) ? null : vn });
  }
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}

@Injectable()
export class KpiBindingsService {
  private readonly logger = new Logger(KpiBindingsService.name);
  constructor(private prisma: PrismaService) {}

  kstNow() { return new Date(Date.now() + KST_MS); }
  currentYear() { return this.kstNow().getUTCFullYear(); }
  currentMonth() { return this.kstNow().getUTCMonth() + 1; }

  monthRange(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - KST_MS);
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999) - KST_MS);
    return { start, end };
  }

  /** 소스별 실행 — ORACLE_AGENT는 여기서 실행하지 않고 작업 큐로 보낸다 */
  async fetchValues(binding: any, year: number): Promise<MonthValue[]> {
    const cfg = (binding.config || {}) as any;
    switch (String(binding.sourceType)) {
      case 'INTERNAL': return this.fetchInternal(String(cfg.metric || ''), year);
      case 'ODOO_RPC': return this.fetchOdoo(cfg, year);
      case 'REST': return this.fetchRest(cfg, year);
      case 'ORACLE_AGENT': throw new BadRequestException('오라클 소스는 사내 에이전트가 실행합니다 (작업 큐 사용)');
      default: throw new BadRequestException(`알 수 없는 소스: ${binding.sourceType}`);
    }
  }

  // ───────────── INTERNAL ─────────────
  async fetchInternal(metric: string, year: number): Promise<MonthValue[]> {
    if (!INTERNAL_METRICS[metric]) throw new BadRequestException('내부 지표 코드가 올바르지 않습니다');
    const out: MonthValue[] = [];
    const curY = this.currentYear(), curM = this.currentMonth();
    const lastMonth = year < curY ? 12 : year > curY ? 0 : curM;
    for (let m = 1; m <= lastMonth; m++) {
      const { start, end } = this.monthRange(year, m);
      let value: number | null = null;
      if (metric.startsWith('APPROVAL_')) {
        const reqs: any[] = await (this.prisma as any).approvalRequest.findMany({
          where: { status: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: start, lte: end } },
          select: { createdAt: true, updatedAt: true },
        });
        if (metric === 'APPROVAL_COUNT') value = reqs.length;
        else if (reqs.length) {
          // 자동 승인(배차 등, 상신 즉시 확정)은 소요시간 지표에서 제외 — 1분 미만은 사람이 처리한 것이 아님
          const hours = reqs.map((r) => (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 3600000).filter((h) => h >= 1 / 60);
          if (metric === 'APPROVAL_LEAD_HOURS') value = hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null;
          if (metric === 'APPROVAL_WITHIN_24H_PCT') value = hours.length ? Math.round((hours.filter((h) => h <= 24).length / hours.length) * 1000) / 10 : null;
        }
      } else if (metric === 'WORKLOG_COUNT') {
        value = await this.prisma.worklog.count({ where: { date: { gte: start, lte: end } } });
      } else if (metric === 'WORKLOG_WRITER_RATIO_PCT') {
        const active = await this.prisma.user.count({ where: { status: 'ACTIVE' as any, role: { in: ['INDIVIDUAL', 'MANAGER', 'EXEC'] as any }, orgUnitId: { not: null } } });
        const writers: any[] = await this.prisma.worklog.findMany({ where: { date: { gte: start, lte: end } }, distinct: ['createdById'], select: { createdById: true } });
        value = active ? Math.round((writers.length / active) * 1000) / 10 : null;
      } else if (metric === 'MANUAL_READY_PCT') {
        if (m === lastMonth) {
          const [total, ready] = await Promise.all([
            (this.prisma as any).workManual.count(),
            (this.prisma as any).workManual.count({ where: { readinessScore: { gte: 80 } } }),
          ]);
          value = total ? Math.round((ready / total) * 1000) / 10 : null;
        }
      } else if (metric === 'PROCESS_COMPLETED_COUNT') {
        value = await (this.prisma as any).processInstance.count({ where: { status: 'COMPLETED', endAt: { gte: start, lte: end } } });
      }
      out.push({ year, month: m, value });
    }
    return out;
  }

  // ───────────── ODOO JSON-RPC ─────────────
  odooConfigured() { return !!(process.env.ODOO_URL && process.env.ODOO_DB && process.env.ODOO_USER && (process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD)); }

  private async odooCall(service: string, method: string, args: any[]): Promise<any> {
    const url = String(process.env.ODOO_URL || '').replace(/\/$/, '') + '/jsonrpc';
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } }) });
    const j: any = await resp.json().catch(() => ({}));
    if (j.error) throw new BadRequestException(`Odoo 오류: ${j.error?.data?.message || j.error?.message || 'unknown'}`);
    return j.result;
  }

  async fetchOdoo(cfg: any, year: number): Promise<MonthValue[]> {
    if (!this.odooConfigured()) throw new BadRequestException('Odoo 연결 설정(ODOO_URL/ODOO_DB/ODOO_USER/ODOO_API_KEY)이 서버에 없습니다');
    const db = process.env.ODOO_DB!, user = process.env.ODOO_USER!, pwd = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD!;
    const uid = await this.odooCall('common', 'login', [db, user, pwd]);
    if (!uid) throw new BadRequestException('Odoo 로그인 실패');
    const model = String(cfg.model || '').trim(); if (!model) throw new BadRequestException('Odoo 모델이 필요합니다 (예: mrp.production)');
    const dateField = String(cfg.dateField || 'date_order').trim();
    const measure = String(cfg.measure || '__count').trim(); // 필드명 또는 __count
    const agg = String(cfg.aggregate || (measure === '__count' ? 'count' : 'sum')).toLowerCase(); // sum|avg|count|max|min
    let domain: any[] = [];
    try { domain = cfg.domain ? (typeof cfg.domain === 'string' ? JSON.parse(cfg.domain) : cfg.domain) : []; } catch { throw new BadRequestException('Odoo domain은 JSON 배열이어야 합니다'); }
    const from = `${year}-01-01 00:00:00`, to = `${year}-12-31 23:59:59`;
    const fullDomain = [...domain, [dateField, '>=', from], [dateField, '<=', to]];
    const fields = measure === '__count' ? [] : [`${measure}:${agg}`];
    const groups: any[] = await this.odooCall('object', 'execute_kw', [db, uid, pwd, model, 'read_group', [fullDomain, fields, [`${dateField}:month`]], { lazy: false }]);
    const out: MonthValue[] = [];
    for (const g of groups || []) {
      const key = String(g[`${dateField}:month`] || ''); // 예: "October 2026" / "2026년 10월"
      const range = g.__range?.[`${dateField}:month`]?.from || g.__range?.[dateField]?.from;
      let y = 0, m = 0;
      if (range) { const d = new Date(String(range).replace(' ', 'T')); y = d.getUTCFullYear(); m = d.getUTCMonth() + 1; }
      else { const mm = key.match(/(\d{4})\D+(\d{1,2})/) || key.match(/(\d{1,2})\D+(\d{4})/); if (mm) { const a = Number(mm[1]), b = Number(mm[2]); if (a > 12) { y = a; m = b; } else { m = a; y = b; } } }
      if (!y || !m) continue;
      const value = measure === '__count' ? Number(g.__count ?? g[`${model.replace('.', '_')}_count`] ?? 0) : Number(g[measure] ?? 0);
      out.push({ year: y, month: m, value: Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null });
    }
    return out.sort((a, b) => a.month - b.month);
  }

  // ───────────── REST ─────────────
  async fetchRest(cfg: any, year: number): Promise<MonthValue[]> {
    const url = String(cfg.url || '').replace('{year}', String(year)); if (!/^https?:\/\//.test(url)) throw new BadRequestException('REST URL이 필요합니다 (http/https)');
    const headers: Record<string, string> = {};
    if (cfg.headers && typeof cfg.headers === 'object') for (const [k, v] of Object.entries(cfg.headers)) headers[k] = String(v);
    if (cfg.bearerEnv && process.env[String(cfg.bearerEnv)]) headers['Authorization'] = `Bearer ${process.env[String(cfg.bearerEnv)]}`;
    const resp = await fetch(url, { method: String(cfg.method || 'GET'), headers, ...(cfg.body ? { body: typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body) } : {}) });
    if (!resp.ok) throw new BadRequestException(`REST 응답 오류 ${resp.status}`);
    let j: any = await resp.json();
    if (cfg.path) for (const seg of String(cfg.path).split('.').filter(Boolean)) j = j?.[seg];
    const rows = Array.isArray(j) ? j : [];
    const yk = cfg.yearKey || 'year', mk = cfg.monthKey || 'month', vk = cfg.valueKey || 'value';
    return normalizeRows(rows.map((r: any) => ({ year: r?.[yk], month: r?.[mk], value: r?.[vk] }))).filter((r) => r.year === year);
  }

  // ───────────── 기록 ─────────────
  private async robotUser() {
    let u = await this.prisma.user.findFirst({ where: { name: '로봇' } });
    if (!u) u = await this.prisma.user.create({ data: { name: '로봇', email: 'robot@workwork.local', role: 'INDIVIDUAL' as any } as any });
    return u;
  }

  /** 월별 값을 ProgressEntry에 기록 — 바인딩이 쓴 행(note 'binding:')만 갱신하고 사람이 쓴 행은 건드리지 않는다. 미래 달·null은 건너뜀 */
  async writeValues(binding: any, values: MonthValue[]): Promise<{ written: number; skipped: number }> {
    const robot = await this.robotUser();
    const curY = this.currentYear(), curM = this.currentMonth();
    let written = 0, skipped = 0;
    for (const v of values) {
      if (v.value == null || v.year > curY || (v.year === curY && v.month > curM)) { skipped++; continue; }
      const { start, end } = this.monthRange(v.year, v.month);
      const existing = await this.prisma.progressEntry.findFirst({ where: { keyResultId: binding.keyResultId, periodStart: start, note: { startsWith: 'binding:' } } });
      const note = `binding:${binding.sourceType}:${binding.id}`;
      if (existing) {
        if (existing.krValue !== v.value) await this.prisma.progressEntry.update({ where: { id: existing.id }, data: { krValue: v.value, note } });
      } else {
        await this.prisma.progressEntry.create({ data: { actorId: robot.id, keyResultId: binding.keyResultId, periodStart: start, periodEnd: end, krValue: v.value, note } });
      }
      written++;
    }
    await (this.prisma as any).kpiBinding.update({ where: { id: binding.id }, data: { lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null, lastValues: values } });
    return { written, skipped };
  }

  async markError(bindingId: string, err: any) {
    await (this.prisma as any).kpiBinding.update({ where: { id: bindingId }, data: { lastRunAt: new Date(), lastError: String(err?.message || err).slice(0, 500) } }).catch(() => {});
  }

  /** 서버에서 직접 실행 가능한 소스(INTERNAL/ODOO/REST)를 지금 동기화 */
  async syncNow(binding: any, year = this.currentYear()) {
    try {
      const values = await this.fetchValues(binding, year);
      const r = await this.writeValues(binding, values);
      return { ok: true, values, ...r };
    } catch (e: any) {
      await this.markError(binding.id, e);
      throw e;
    }
  }

  /** ORACLE_AGENT: 작업 큐에 넣기 */
  async enqueueAgentJob(binding: any, kind: 'SYNC' | 'PREVIEW', year: number, requestedBy?: string) {
    const cfg = (binding.config || {}) as any;
    const sql = assertReadOnlySql(String(cfg.sql || ''));
    const params = buildBindParams(sql, year, cfg.extraBinds && typeof cfg.extraBinds === 'object' ? cfg.extraBinds : undefined);
    // 같은 바인딩의 미처리 작업이 있으면 재사용(중복 방지)
    const dup = await (this.prisma as any).kpiBindingJob.findFirst({ where: { bindingId: binding.id, kind, status: { in: ['PENDING', 'RUNNING'] } } });
    if (dup) return dup;
    return (this.prisma as any).kpiBindingJob.create({ data: { bindingId: binding.id, kind, agentName: String(binding.agentName || 'default'), sql, params, requestedBy: requestedBy || null } });
  }

  /** 에이전트 결과 반영 */
  async completeAgentJob(jobId: string, rows: any[] | null, error?: string | null) {
    const job = await (this.prisma as any).kpiBindingJob.findUnique({ where: { id: jobId }, include: { binding: true } });
    if (!job) throw new BadRequestException('job not found');
    if (error) {
      await (this.prisma as any).kpiBindingJob.update({ where: { id: jobId }, data: { status: 'ERROR', error: String(error).slice(0, 1000), finishedAt: new Date() } });
      await this.markError(job.bindingId, error);
      return { ok: false };
    }
    const values = normalizeRows(rows || []);
    await (this.prisma as any).kpiBindingJob.update({ where: { id: jobId }, data: { status: 'DONE', result: values, finishedAt: new Date() } });
    if (job.kind === 'SYNC') await this.writeValues(job.binding, values);
    else await (this.prisma as any).kpiBinding.update({ where: { id: job.bindingId }, data: { lastValues: values } });
    return { ok: true, count: values.length };
  }

  /** 스케줄 판정: 이 바인딩이 지금(KST) 돌 차례인가 */
  isDue(binding: any, now = new Date()): boolean {
    if (!binding.enabled) return false;
    const k = new Date(now.getTime() + KST_MS);
    const hour = k.getUTCHours(), day = k.getUTCDate(), dow = k.getUTCDay();
    if (hour < 2) return false; // 야간 02:00 이후
    const last = binding.lastSuccessAt ? new Date(new Date(binding.lastSuccessAt).getTime() + KST_MS) : null;
    const sameKstDay = (a: Date, b: Date) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
    const ranToday = last ? sameKstDay(last, k) : false;
    const lastRun = binding.lastRunAt ? new Date(new Date(binding.lastRunAt).getTime() + KST_MS) : null;
    const triedToday = lastRun ? sameKstDay(lastRun, k) : false;
    if (ranToday || triedToday) return false;
    switch (String(binding.schedule || 'MONTHLY_2')) {
      case 'DAILY': return true;
      case 'WEEKLY': return dow === 1;
      case 'MONTHLY_2': default: return day === 1 || day === 16 || !binding.lastSuccessAt; // 한 번도 성공 안 했으면 바로
    }
  }
}
