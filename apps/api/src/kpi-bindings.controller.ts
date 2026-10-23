import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import { isAncestorOrgManager } from './lib/org-hierarchy';
import { KpiBindingsService, INTERNAL_METRICS, SCHEDULES, SOURCE_TYPES, assertReadOnlySql, buildBindParams } from './kpi-bindings.service';

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
      agents: agents.map((a: any) => ({ name: a.name, version: a.version, host: a.host, lastSeenAt: a.lastSeenAt, online: Date.now() - new Date(a.lastSeenAt).getTime() < 15 * 60 * 1000 })),
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
    if (sourceType === 'ORACLE_AGENT') config.sql = assertReadOnlySql(String(config.sql || ''));
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
      const sql = assertReadOnlySql(String(config.sql || ''));
      // 미리보기 작업은 저장된 바인딩이 있어야 큐에 넣을 수 있다 → 임시 바인딩 없이도 되게 keyResultId 기준으로 저장본 사용
      let binding = b.keyResultId ? await (this.prisma as any).kpiBinding.findUnique({ where: { keyResultId: b.keyResultId } }) : null;
      if (!binding) throw new BadRequestException('오라클 미리보기는 먼저 저장한 뒤 실행할 수 있습니다 (SQL 검사는 통과했습니다)');
      const job = await this.svc.enqueueAgentJob({ ...binding, config: { ...binding.config, sql, extraBinds: config.extraBinds ?? binding.config?.extraBinds }, agentName: b.agentName || binding.agentName }, 'PREVIEW', year, user.id);
      return { queued: true, jobId: job.id, params: buildBindParams(sql, year, config.extraBinds) };
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

  // ───────────── 에이전트 API (토큰) ─────────────
  @Public()
  @Post('agent/heartbeat')
  async heartbeat(@Body() b: any) {
    this.assertToken(b?.token);
    const name = String(b?.agent || 'default');
    await (this.prisma as any).kpiAgent.upsert({ where: { name }, create: { name, version: String(b?.version || ''), host: String(b?.host || '') }, update: { version: String(b?.version || ''), host: String(b?.host || ''), lastSeenAt: new Date() } });
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
    return { items: jobs.map((j: any) => ({ id: j.id, kind: j.kind, sql: j.sql, params: j.params || {} })) };
  }

  /** 결과 올리기 */
  @Public()
  @Post('agent/result')
  async agentResult(@Body() b: any) {
    this.assertToken(b?.token);
    const jobId = String(b?.jobId || ''); if (!jobId) throw new BadRequestException('jobId required');
    return this.svc.completeAgentJob(jobId, Array.isArray(b?.rows) ? b.rows : null, b?.error ? String(b.error) : null);
  }
}
