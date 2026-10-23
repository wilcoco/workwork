import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import { isAncestorOrgManager } from './lib/org-hierarchy';
import { KpiBindingsService, INTERNAL_METRICS, SCHEDULES, SOURCE_TYPES } from './kpi-bindings.service';

/**
 * KPI 데이터 바인딩 API
 *  - 관리자용: 바인딩 조회/저장/삭제, 미리보기, 지금 동기화, 작업 상태
 *  - 사내 에이전트용(@Public + 토큰): heartbeat, 작업 가져가기, 결과 올리기
 * 토큰은 배차 동기화와 같은 ORACLE_SYNC_TOKEN 환경변수를 쓴다.
 */
@Controller('kpi-bindings')
export class KpiBindingsController {
  constructor(private prisma: PrismaService, private svc: KpiBindingsService) {}

  private async actor(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new BadRequestException('user not found');
    return u;
  }

  /** KPI 바인딩 편집 권한: CEO/EXEC, 또는 그 KPI 팀의 팀장·상위 조직 책임자 */
  private async assertCanEdit(user: any, keyResultId: string) {
    const role = String(user.role || '').toUpperCase();
    if (['CEO', 'EXEC'].includes(role)) return;
    const kr: any = await this.prisma.keyResult.findUnique({ where: { id: keyResultId }, include: { objective: true } });
    if (!kr) throw new BadRequestException('KPI를 찾을 수 없습니다');
    const orgId = kr.objective?.orgUnitId || null;
    if (role === 'MANAGER' && orgId && (user.orgUnitId === orgId || (await isAncestorOrgManager(this.prisma, user, orgId)))) return;
    throw new ForbiddenException('임원 또는 해당 팀의 팀장만 데이터 연결을 설정할 수 있습니다');
  }

  private assertToken(token?: string) {
    const expected = String(process.env.ORACLE_SYNC_TOKEN || '').trim();
    if (!expected || String(token || '') !== expected) throw new UnauthorizedException('invalid token');
  }

  // ───────────── 관리자 API ─────────────
  @Get('meta')
  async meta(@Query('userId') userId?: string) {
    await this.actor(userId);
    const agents = await (this.prisma as any).kpiAgent.findMany({ orderBy: { lastSeenAt: 'desc' } });
    return {
      sourceTypes: SOURCE_TYPES, schedules: SCHEDULES, internalMetrics: INTERNAL_METRICS,
      odooConfigured: this.svc.odooConfigured(), agentTokenConfigured: !!process.env.ORACLE_SYNC_TOKEN,
      agents: agents.map((a: any) => ({ name: a.name, version: a.version, host: a.host, lastSeenAt: a.lastSeenAt, online: Date.now() - new Date(a.lastSeenAt).getTime() < 15 * 60 * 1000, queries: Array.isArray(a.queries) ? a.queries : [], catalog: a.catalog || null })),
      bindTemplates: {
        yy: '연도 4자리 (예: 2026)', from_ymd: 'YYYY-MM-DD 연초', to_ymd: 'YYYY-MM-DD 연말', from_yyyymmdd: 'YYYYMMDD 연초', to_yyyymmdd: 'YYYYMMDD 연말',
      },
    };
  }

  @Get()
  async list(@Query('userId') userId?: string, @Query('krIds') krIds?: string) {
    await this.actor(userId);
    const where: any = {};
    if (krIds) where.keyResultId = { in: String(krIds).split(',').map((s) => s.trim()).filter(Boolean) };
    const items = await (this.prisma as any).kpiBinding.findMany({ where, include: { keyResult: { select: { id: true, title: true, unit: true, objective: { select: { title: true, orgUnit: { select: { name: true } } } } } } }, orderBy: { updatedAt: 'desc' } });
    return { items };
  }

  @Get('kr/:keyResultId')
  async one(@Param('keyResultId') keyResultId: string, @Query('userId') userId?: string) {
    await this.actor(userId);
    const b = await (this.prisma as any).kpiBinding.findUnique({ where: { keyResultId }, include: { jobs: { orderBy: { requestedAt: 'desc' }, take: 5 } } });
    return b || null;
  }

  @Put('kr/:keyResultId')
  async upsert(@Param('keyResultId') keyResultId: string, @Body() b: any) {
    const user = await this.actor(b?.userId);
    await this.assertCanEdit(user, keyResultId);
    const sourceType = String(b.sourceType || '').toUpperCase();
    if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) throw new BadRequestException('sourceType invalid');
    const config = b.config && typeof b.config === 'object' ? b.config : {};
    if (sourceType === 'ORACLE_AGENT') { delete config.sql; if (!/^[A-Za-z0-9_\-]{1,80}$/.test(String(config.queryId || ''))) throw new BadRequestException('에이전트에 등록된 질의 ID를 선택하세요 (SQL은 클라우드에 저장하지 않습니다)'); }
    if (sourceType === 'INTERNAL' && !INTERNAL_METRICS[String(config.metric || '')]) throw new BadRequestException('내부 지표를 선택하세요');
    if (sourceType === 'ODOO_RPC' && !String(config.model || '').trim()) throw new BadRequestException('Odoo 모델을 입력하세요');
    if (sourceType === 'REST' && !/^https?:\/\//.test(String(config.url || ''))) throw new BadRequestException('REST URL을 입력하세요');
    const schedule = SCHEDULES[String(b.schedule || '')] ? String(b.schedule) : 'MONTHLY_2';
    const data = { sourceType, config, schedule, enabled: b.enabled !== false, agentName: sourceType === 'ORACLE_AGENT' ? String(b.agentName || 'default') : null };
    const saved = await (this.prisma as any).kpiBinding.upsert({ where: { keyResultId }, create: { keyResultId, createdById: user.id, ...data }, update: data });
    return saved;
  }

  @Delete('kr/:keyResultId')
  async remove(@Param('keyResultId') keyResultId: string, @Query('userId') userId?: string, @Query('deleteValues') deleteValues?: string) {
    const user = await this.actor(userId);
    await this.assertCanEdit(user, keyResultId);
    const b = await (this.prisma as any).kpiBinding.findUnique({ where: { keyResultId } });
    if (!b) return { ok: true };
    if (deleteValues === '1') await this.prisma.progressEntry.deleteMany({ where: { keyResultId, note: { startsWith: 'binding:' } } });
    await (this.prisma as any).kpiBinding.delete({ where: { id: b.id } });
    return { ok: true };
  }

  /** 미리보기: 저장하지 않고 올해 월별 값을 보여준다 (오라클은 작업 생성 → jobId 반환) */
  @Post('preview')
  async preview(@Body() b: any) {
    const user = await this.actor(b?.userId);
    const year = Number(b.year) || this.svc.currentYear();
    const sourceType = String(b.sourceType || '').toUpperCase();
    const config = b.config || {};
    const fake = { id: b.bindingId || 'preview', keyResultId: b.keyResultId || '', sourceType, config, agentName: b.agentName || 'default' };
    if (sourceType === 'ORACLE_AGENT') {
      const binding = b.keyResultId ? await (this.prisma as any).kpiBinding.findUnique({ where: { keyResultId: b.keyResultId } }) : null;
      if (!binding) throw new BadRequestException('오라클 미리보기는 먼저 저장한 뒤 실행할 수 있습니다');
      const job = await this.svc.enqueueAgentJob({ ...binding, config: { ...binding.config, queryId: config.queryId || binding.config?.queryId, extraBinds: config.extraBinds ?? binding.config?.extraBinds }, agentName: b.agentName || binding.agentName }, 'PREVIEW', year, user.id);
      return { queued: true, jobId: job.id, params: job.params };
    }
    const values = await this.svc.fetchValues(fake, year);
    return { queued: false, values };
  }

  /** 지금 동기화 (저장된 바인딩) */
  @Post('kr/:keyResultId/run')
  async run(@Param('keyResultId') keyResultId: string, @Body() b: any) {
    const user = await this.actor(b?.userId);
    await this.assertCanEdit(user, keyResultId);
    const binding = await (this.prisma as any).kpiBinding.findUnique({ where: { keyResultId } });
    if (!binding) throw new BadRequestException('바인딩이 없습니다');
    const year = Number(b.year) || this.svc.currentYear();
    if (binding.sourceType === 'ORACLE_AGENT') { const job = await this.svc.enqueueAgentJob(binding, 'SYNC', year, user.id); return { queued: true, jobId: job.id }; }
    return this.svc.syncNow(binding, year);
  }

  @Get('jobs/:id')
  async job(@Param('id') id: string, @Query('userId') userId?: string) {
    await this.actor(userId);
    const j = await (this.prisma as any).kpiBindingJob.findUnique({ where: { id } });
    if (!j) throw new BadRequestException('job not found');
    return j;
  }

  // ───────────── 관련 자료 찾기(카탈로그 검색·AI 제안) ─────────────
  /** KPI 관련 자료 찾기: 사내 에이전트에 DISCOVER 작업을 보냄 (카탈로그는 사내 PC에만 있음) → 발췌가 오면 AI 제안이 PROPOSED로 저장됨 */
  @Post('kr/:keyResultId/discover')
  async discover(@Param('keyResultId') keyResultId: string, @Body() b: any) {
    const user = await this.actor(b?.userId);
    await this.assertCanEdit(user, keyResultId);
    const kr: any = await this.prisma.keyResult.findUnique({ where: { id: keyResultId }, include: { objective: { include: { orgUnit: true } } } });
    if (!kr) throw new BadRequestException('KPI를 찾을 수 없습니다');
    const agentName = String(b?.agentName || 'default');
    const agent = await (this.prisma as any).kpiAgent.findUnique({ where: { name: agentName } });
    const online = !!agent && Date.now() - new Date(agent.lastSeenAt).getTime() < 15 * 60 * 1000;
    const job = await this.svc.enqueueDiscoverJob(kr, user.id, agentName, b?.hint ? String(b.hint) : undefined);
    return { queued: true, jobId: job.id, agentOnline: online, catalog: agent?.catalog || null, tokens: job.params?.tokens || [] };
  }

  @Get('kr/:keyResultId/proposals')
  async proposals(@Param('keyResultId') keyResultId: string, @Query('userId') userId?: string) {
    await this.actor(userId);
    const items = await (this.prisma as any).kpiQueryProposal.findMany({ where: { keyResultId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { items };
  }

  @Post('proposals/:id/reject')
  async rejectProposal(@Param('id') id: string, @Body() b: any) {
    const user = await this.actor(b?.userId);
    const p = await (this.prisma as any).kpiQueryProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    await this.assertCanEdit(user, p.keyResultId);
    return (this.prisma as any).kpiQueryProposal.update({ where: { id }, data: { status: 'REJECTED' } });
  }

  // ───────────── 에이전트 API (토큰) ─────────────
  @Public()
  @Post('agent/heartbeat')
  async heartbeat(@Body() b: any) {
    this.assertToken(b?.token);
    const name = String(b?.agent || 'default');
    const queries = Array.isArray(b?.queries) ? b.queries.filter((q: any) => q && typeof q.id === 'string').slice(0, 200).map((q: any) => ({ id: String(q.id), name: String(q.name || q.id), binds: Array.isArray(q.binds) ? q.binds.map(String) : [], tables: Array.isArray(q.tables) ? q.tables.map(String) : [] })) : undefined;
    const catalog = b?.catalog && typeof b.catalog === 'object' ? { screens: Number(b.catalog.screens) || 0, tables: Number(b.catalog.tables) || 0, codes: Number(b.catalog.codes) || 0, generatedAt: String(b.catalog.generatedAt || '') } : undefined;
    await (this.prisma as any).kpiAgent.upsert({ where: { name }, create: { name, version: String(b?.version || ''), host: String(b?.host || ''), queries, catalog }, update: { version: String(b?.version || ''), host: String(b?.host || ''), lastSeenAt: new Date(), ...(queries ? { queries } : {}), ...(catalog ? { catalog } : {}) } });
    // 오래된 미처리 작업 만료 (2일)
    await (this.prisma as any).kpiBindingJob.updateMany({ where: { status: { in: ['PENDING', 'RUNNING'] }, requestedAt: { lt: new Date(Date.now() - 2 * 86400000) } }, data: { status: 'EXPIRED', error: '2일 내 처리되지 않아 만료' } }).catch(() => {});
    return { ok: true, serverTime: new Date().toISOString() };
  }

  /** 작업 가져가기: PENDING → RUNNING (에이전트 이름 일치분만) */
  @Public()
  @Get('agent/jobs')
  async agentJobs(@Query('token') token?: string, @Query('agent') agent?: string, @Query('limit') limit?: string) {
    this.assertToken(token);
    const name = String(agent || 'default');
    const take = Math.min(20, Math.max(1, Number(limit) || 5));
    const jobs = await (this.prisma as any).kpiBindingJob.findMany({ where: { status: 'PENDING', agentName: name }, orderBy: { requestedAt: 'asc' }, take });
    if (jobs.length) await (this.prisma as any).kpiBindingJob.updateMany({ where: { id: { in: jobs.map((j: any) => j.id) } }, data: { status: 'RUNNING', startedAt: new Date() } });
    return { items: jobs.map((j: any) => ({ id: j.id, kind: j.kind, queryId: j.queryId, params: j.params || {} })) };  // DISCOVER: params={kpi,tokens,hint,max*}
  }

  /** 결과 올리기 */
  @Public()
  @Post('agent/result')
  async agentResult(@Body() b: any) {
    this.assertToken(b?.token);
    const jobId = String(b?.jobId || ''); if (!jobId) throw new BadRequestException('jobId required');
    return this.svc.completeAgentJob(jobId, Array.isArray(b?.rows) ? b.rows : null, b?.error ? String(b.error) : null, b?.result);
  }

  /** 에이전트: 승인 대기 제안 목록 (사내 PC에서 사람이 검토·승인). SQL은 여기서만 내려간다 — 자동 실행 경로는 없다 */
  @Public()
  @Get('agent/proposals')
  async agentProposals(@Query('token') token?: string, @Query('agent') agent?: string, @Query('id') id?: string) {
    this.assertToken(token);
    const where: any = { status: 'PROPOSED', agentName: String(agent || 'default') };
    if (id) where.id = String(id);
    const items = await (this.prisma as any).kpiQueryProposal.findMany({ where, orderBy: { createdAt: 'asc' }, take: 50 });
    const krs = await this.prisma.keyResult.findMany({ where: { id: { in: items.map((p: any) => p.keyResultId) } }, select: { id: true, title: true, unit: true } });
    const km = new Map(krs.map((k) => [k.id, k]));
    return { items: items.map((p: any) => ({ id: p.id, queryId: p.queryId, name: p.name, sql: p.sql, binds: p.binds || [], tables: p.tables || [], extraBinds: p.extraBinds || {}, screenRef: p.screenRef, rationale: p.rationale, caveats: p.caveats, confidence: p.confidence, kpi: km.get(p.keyResultId) || null })) };
  }

  /** 에이전트: 사람이 승인해 agent_queries 에 등록했음을 보고 → 제안 REGISTERED + KPI 바인딩 자동 생성/갱신(ORACLE_AGENT, queryId) */
  @Public()
  @Post('agent/proposals/:id/registered')
  async agentProposalRegistered(@Param('id') id: string, @Body() b: any) {
    this.assertToken(b?.token);
    const p = await (this.prisma as any).kpiQueryProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    const queryId = String(b?.queryId || p.queryId);
    await (this.prisma as any).kpiQueryProposal.update({ where: { id }, data: { status: 'REGISTERED', queryId, registeredAt: new Date(), registeredHost: String(b?.host || '') } });
    const existing = await (this.prisma as any).kpiBinding.findUnique({ where: { keyResultId: p.keyResultId } });
    const config = { queryId, ...(p.extraBinds && Object.keys(p.extraBinds).length ? { extraBinds: p.extraBinds } : {}), proposalId: p.id };
    if (!existing) await (this.prisma as any).kpiBinding.create({ data: { keyResultId: p.keyResultId, createdById: p.createdById, sourceType: 'ORACLE_AGENT', config, schedule: 'MONTHLY_2', enabled: true, agentName: String(b?.agent || p.agentName || 'default') } });
    else if (existing.sourceType === 'ORACLE_AGENT') await (this.prisma as any).kpiBinding.update({ where: { id: existing.id }, data: { config: { ...(existing.config || {}), ...config }, agentName: String(b?.agent || existing.agentName || 'default') } });
    return { ok: true, bindingCreated: !existing };
  }

  @Public()
  @Post('agent/proposals/:id/declined')
  async agentProposalDeclined(@Param('id') id: string, @Body() b: any) {
    this.assertToken(b?.token);
    await (this.prisma as any).kpiQueryProposal.update({ where: { id }, data: { status: 'REJECTED' } });
    return { ok: true };
  }
}
