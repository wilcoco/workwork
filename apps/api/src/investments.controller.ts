import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 설비투자 포트폴리오 — 건별 가부 심사가 아니라 연간 포트폴리오 안에서 우선순위를 비교하는 절차.
 *
 * 절차: 제안 접수(SUBMITTED) → 사전 검토·점수화(REVIEWED) → 위원회 소집·안건 배정(ON_AGENDA)
 *      → 심의·결정(APPROVED|DEFERRED|REJECTED) → 실행(IN_PROGRESS→COMPLETED) → 사후 검증(AUDITED)
 *
 * 범주: 법규·안전·환경(REGULATORY), 원청·신차 대응(CUSTOMER) = 필수(선배정),
 *      유지·노후 교체(MAINTENANCE), 원가절감·생산성(COST_SAVING), 전략·신사업(STRATEGIC) = 재량(우선순위 경쟁)
 */
export const INVEST_CATEGORIES: Record<string, { label: string; mandatory: boolean }> = {
  REGULATORY: { label: '법규·안전·환경', mandatory: true },
  CUSTOMER: { label: '원청 요구·신차 대응', mandatory: true },
  MAINTENANCE: { label: '유지·노후 교체', mandatory: false },
  COST_SAVING: { label: '원가절감·생산성', mandatory: false },
  STRATEGIC: { label: '전략·신사업', mandatory: false },
};
const DEFAULT_WEIGHTS = { financial: 30, risk: 20, strategic: 20, feasibility: 15, urgency: 15 };
const STATUS_KO: Record<string, string> = {
  SUBMITTED: '접수', REVIEWED: '검토완료', ON_AGENDA: '위원회 상정', APPROVED: '승인', DEFERRED: '보류', REJECTED: '반려',
  IN_PROGRESS: '실행중', COMPLETED: '실행완료', AUDITED: '검증완료', WITHDRAWN: '철회',
};

@Controller('investments')
export class InvestmentsController {
  constructor(private prisma: PrismaService) {}

  private async me(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await (this.prisma as any).user.findUnique({ where: { id: uid }, select: { id: true, name: true, role: true, orgUnitId: true, orgUnit: { select: { name: true } } } });
    if (!u) throw new BadRequestException('user not found');
    const role = String(u.role || '').toUpperCase();
    return { ...u, role, canReview: ['CEO', 'EXEC', 'MANAGER'].includes(role), canDecide: ['CEO', 'EXEC'].includes(role) };
  }

  /** 재무 점수: 회수기간이 있으면 자동(≤12개월=5 … >60=1), 없으면 검토자 입력 */
  private financialFromPayback(paybackMonths?: number | null): number | null {
    if (paybackMonths == null || !(paybackMonths > 0)) return null;
    if (paybackMonths <= 12) return 5;
    if (paybackMonths <= 24) return 4;
    if (paybackMonths <= 36) return 3;
    if (paybackMonths <= 60) return 2;
    return 1;
  }

  private computePriority(p: any, weights: any): number | null {
    const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
    const s = {
      financial: p.scoreFinancial ?? this.financialFromPayback(p.paybackMonths),
      risk: p.scoreRisk, strategic: p.scoreStrategic, feasibility: p.scoreFeasibility, urgency: p.scoreUrgency,
    };
    const keys = ['financial', 'risk', 'strategic', 'feasibility', 'urgency'] as const;
    if (keys.some((k) => s[k] == null)) return null;
    const total = keys.reduce((acc, k) => acc + Number(w[k] || 0), 0) || 100;
    const sum = keys.reduce((acc, k) => acc + ((Number(s[k]) - 1) / 4) * Number(w[k] || 0), 0);
    return Math.round((sum / total) * 1000) / 10;
  }

  private async budgetOf(year: number) {
    const b = await (this.prisma as any).investmentBudget.findUnique({ where: { year } });
    return b || { year, limitAmount: 0, mandatoryReserve: 0, weights: DEFAULT_WEIGHTS, note: '' };
  }

  private async notify(userIds: string[], type: string, subjectId: string, payload: any) {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    for (const userId of ids) {
      await (this.prisma as any).notification.create({ data: { userId, type, subjectType: 'INVESTMENT', subjectId, payload } }).catch(() => {});
    }
  }

  private async committeeIds(): Promise<string[]> {
    const rows = await (this.prisma as any).user.findMany({ where: { role: { in: ['CEO', 'EXEC'] }, status: 'ACTIVE' }, select: { id: true } });
    return rows.map((r: any) => r.id);
  }

  // ───────────────────────── 메타 ─────────────────────────
  @Get('meta')
  async meta(@Query('userId') userId?: string) {
    const me = await this.me(userId);
    const users = await (this.prisma as any).user.findMany({
      where: { status: 'ACTIVE', role: { in: ['CEO', 'EXEC', 'MANAGER', 'INDIVIDUAL'] } },
      select: { id: true, name: true, role: true, orgUnit: { select: { name: true } } }, orderBy: { name: 'asc' },
    });
    const years = await (this.prisma as any).investmentProposal.findMany({ distinct: ['targetYear'], select: { targetYear: true }, orderBy: { targetYear: 'desc' } });
    const thisYear = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
    const ys = Array.from(new Set<number>([thisYear, thisYear + 1, thisYear + 2, ...years.map((y: any) => Number(y.targetYear))])).sort((a, b) => b - a);
    return {
      me: { id: me.id, name: me.name, role: me.role, orgUnitId: me.orgUnitId, orgUnitName: me.orgUnit?.name || '', canReview: me.canReview, canDecide: me.canDecide },
      users: users.map((u: any) => ({ id: u.id, name: u.name, role: u.role, orgName: u.orgUnit?.name || '' })),
      years: ys, categories: INVEST_CATEGORIES, statusKo: STATUS_KO, defaultWeights: DEFAULT_WEIGHTS,
    };
  }

  // ───────────────────────── 제안 ─────────────────────────
  @Get('proposals')
  async list(@Query('userId') userId?: string, @Query('year') year?: string, @Query('status') status?: string, @Query('mine') mine?: string) {
    const me = await this.me(userId);
    const where: any = {};
    if (year) where.targetYear = Number(year);
    if (status) where.status = { in: String(status).split(',').map((s) => s.trim()).filter(Boolean) };
    if (mine === '1') where.proposerId = me.id;
    const items = await (this.prisma as any).investmentProposal.findMany({ where, orderBy: [{ targetYear: 'desc' }, { createdAt: 'desc' }], include: { meeting: { select: { id: true, title: true, scheduledAt: true, status: true } } } });
    return { items };
  }

  @Get('proposals/:id')
  async one(@Param('id') id: string) {
    const p = await (this.prisma as any).investmentProposal.findUnique({ where: { id }, include: { meeting: true } });
    if (!p) throw new BadRequestException('not found');
    return p;
  }

  private pickProposalFields(b: any) {
    const cat = String(b.category || '').toUpperCase();
    if (!INVEST_CATEGORIES[cat]) throw new BadRequestException('category invalid');
    const title = String(b.title || '').trim();
    if (!title) throw new BadRequestException('title required');
    const year = Number(b.targetYear);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new BadRequestException('targetYear invalid');
    const amount = Number(b.amount);
    if (!(amount >= 0)) throw new BadRequestException('amount invalid');
    const q = b.targetQuarter != null && b.targetQuarter !== '' ? Number(b.targetQuarter) : null;
    return {
      title, category: cat, description: String(b.description || ''), rationale: String(b.rationale || ''),
      amount, targetYear: year, targetQuarter: q && q >= 1 && q <= 4 ? q : null,
      carProgram: String(b.carProgram || ''), deadlineAt: b.deadlineAt ? new Date(b.deadlineAt) : null,
      annualBenefit: b.annualBenefit != null && b.annualBenefit !== '' ? Number(b.annualBenefit) : null,
      paybackMonths: b.paybackMonths != null && b.paybackMonths !== '' ? Number(b.paybackMonths) : null,
      fastTrack: !!b.fastTrack,
      dependencies: Array.isArray(b.dependencies) ? b.dependencies.filter((x: any) => typeof x === 'string') : [],
      attachments: Array.isArray(b.attachments) ? b.attachments : [],
    };
  }

  @Post('proposals')
  async create(@Body() b: any) {
    const me = await this.me(b?.userId);
    const data = this.pickProposalFields(b || {});
    const created = await (this.prisma as any).investmentProposal.create({
      data: { ...data, proposerId: me.id, proposerName: me.name || '', orgUnitId: me.orgUnitId || null, orgUnitName: me.orgUnit?.name || '', status: 'SUBMITTED' },
    });
    await this.notify(await this.committeeIds(), 'InvestmentSubmitted', created.id, { title: created.title, by: me.name, amount: created.amount, category: created.category, fastTrack: created.fastTrack });
    return created;
  }

  @Put('proposals/:id')
  async update(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    const p = await (this.prisma as any).investmentProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    if (p.proposerId !== me.id && !me.canDecide) throw new ForbiddenException('작성자 또는 임원만 수정할 수 있습니다');
    if (!['SUBMITTED', 'REVIEWED', 'REJECTED', 'DEFERRED'].includes(p.status)) throw new BadRequestException(`${STATUS_KO[p.status] || p.status} 상태에서는 수정할 수 없습니다`);
    const data: any = this.pickProposalFields({ ...p, ...b });
    // 금액·범주가 바뀌면 사전 검토 점수는 다시 받아야 함
    if (p.status === 'REVIEWED' && (data.amount !== p.amount || data.category !== p.category)) {
      Object.assign(data, { status: 'SUBMITTED', priorityScore: null, reviewNote: null, reviewedAt: null });
    }
    if (['REJECTED', 'DEFERRED'].includes(p.status)) Object.assign(data, { status: 'SUBMITTED', meetingId: null, decision: null, decisionNote: null, decidedAt: null });
    return (this.prisma as any).investmentProposal.update({ where: { id }, data });
  }

  @Post('proposals/:id/withdraw')
  async withdraw(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    const p = await (this.prisma as any).investmentProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    if (p.proposerId !== me.id && !me.canDecide) throw new ForbiddenException('작성자만 철회할 수 있습니다');
    if (!['SUBMITTED', 'REVIEWED', 'ON_AGENDA', 'DEFERRED'].includes(p.status)) throw new BadRequestException('결정된 안건은 철회할 수 없습니다');
    return (this.prisma as any).investmentProposal.update({ where: { id }, data: { status: 'WITHDRAWN', meetingId: null } });
  }

  /** 사전 검토: 점수(1~5)·의견 입력 → 우선순위 점수 산출 */
  @Post('proposals/:id/review')
  async review(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canReview) throw new ForbiddenException('팀장 이상만 검토할 수 있습니다');
    const p = await (this.prisma as any).investmentProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    if (!['SUBMITTED', 'REVIEWED', 'ON_AGENDA'].includes(p.status)) throw new BadRequestException('결정된 안건은 다시 검토할 수 없습니다');
    const sc = (v: any) => { if (v == null || v === '') return null; const n = Number(v); if (!(n >= 1 && n <= 5)) throw new BadRequestException('점수는 1~5'); return Math.round(n); };
    const data: any = {
      scoreFinancial: sc(b.scoreFinancial), scoreRisk: sc(b.scoreRisk), scoreStrategic: sc(b.scoreStrategic), scoreFeasibility: sc(b.scoreFeasibility), scoreUrgency: sc(b.scoreUrgency),
      reviewNote: String(b.reviewNote || '').trim() || null, reviewerId: me.id, reviewerName: me.name || '', reviewedAt: new Date(),
    };
    const budget = await this.budgetOf(p.targetYear);
    data.priorityScore = this.computePriority({ ...p, ...data }, budget.weights);
    if (p.status === 'SUBMITTED') data.status = 'REVIEWED';
    const updated = await (this.prisma as any).investmentProposal.update({ where: { id }, data });
    await this.notify([p.proposerId], 'InvestmentReviewed', id, { title: p.title, by: me.name, priorityScore: updated.priorityScore, forRequester: true });
    return updated;
  }

  // ───────────────────────── 포트폴리오 ─────────────────────────
  @Get('portfolio')
  async portfolio(@Query('userId') userId?: string, @Query('year') yearRaw?: string) {
    await this.me(userId);
    const year = Number(yearRaw) || new Date(Date.now() + 9 * 3600000).getUTCFullYear();
    const budget = await this.budgetOf(year);
    const all = await (this.prisma as any).investmentProposal.findMany({ where: { targetYear: year, status: { not: 'WITHDRAWN' } }, orderBy: { createdAt: 'asc' }, include: { meeting: { select: { id: true, title: true, scheduledAt: true } } } });
    const live = all.filter((p: any) => p.status !== 'REJECTED');
    const isMand = (p: any) => !!INVEST_CATEGORIES[p.category]?.mandatory;
    const mandatory = live.filter(isMand);
    const discretionary = live.filter((p: any) => !isMand(p)).sort((a: any, b: any) => {
      // 결정된 순서: 승인 > 상정 > 검토완료 > 접수, 그 안에서 우선순위 점수 desc
      const rank: Record<string, number> = { APPROVED: 0, IN_PROGRESS: 0, COMPLETED: 0, AUDITED: 0, ON_AGENDA: 1, REVIEWED: 2, SUBMITTED: 3, DEFERRED: 4 };
      const ra = rank[a.status] ?? 5, rb = rank[b.status] ?? 5;
      if (ra !== rb) return ra - rb;
      return (b.priorityScore ?? -1) - (a.priorityScore ?? -1);
    });
    const mandatorySum = mandatory.reduce((s: number, p: any) => s + Number(p.approvedAmount ?? p.amount ?? 0), 0);
    const discretionaryLimit = Math.max(0, Number(budget.limitAmount || 0) - Math.max(mandatorySum, Number(budget.mandatoryReserve || 0)));
    let cum = 0;
    const ranked = discretionary.map((p: any, i: number) => {
      const amt = Number(p.approvedAmount ?? p.amount ?? 0);
      cum += amt;
      return { ...p, rank: i + 1, cumulative: cum, withinLimit: budget.limitAmount > 0 ? cum <= discretionaryLimit : null, mandatory: false };
    });
    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, { count: number; amount: number }> = {};
    for (const p of all) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      const c = byCategory[p.category] || (byCategory[p.category] = { count: 0, amount: 0 });
      c.count += 1; c.amount += Number(p.amount || 0);
    }
    const approvedSum = live.filter((p: any) => ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'AUDITED'].includes(p.status)).reduce((s: number, p: any) => s + Number(p.approvedAmount ?? p.amount ?? 0), 0);
    return {
      year, budget: { ...budget, weights: { ...DEFAULT_WEIGHTS, ...(budget.weights || {}) } },
      mandatory: mandatory.map((p: any) => ({ ...p, mandatory: true })), discretionary: ranked,
      totals: { requested: live.reduce((s: number, p: any) => s + Number(p.amount || 0), 0), mandatorySum, discretionaryLimit, approvedSum, count: all.length, byStatus, byCategory },
    };
  }

  @Put('budget/:year')
  async setBudget(@Param('year') yearRaw: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canDecide) throw new ForbiddenException('임원 이상만 한도를 설정할 수 있습니다');
    const year = Number(yearRaw);
    const weights = { ...DEFAULT_WEIGHTS, ...(b.weights || {}) };
    const data = { limitAmount: Number(b.limitAmount || 0), mandatoryReserve: Number(b.mandatoryReserve || 0), weights, note: String(b.note || ''), updatedById: me.id };
    const saved = await (this.prisma as any).investmentBudget.upsert({ where: { year }, create: { year, ...data }, update: data });
    // 가중치가 바뀌면 검토 점수 재계산
    const ps = await (this.prisma as any).investmentProposal.findMany({ where: { targetYear: year, reviewedAt: { not: null } } });
    for (const p of ps) {
      const score = this.computePriority(p, weights);
      if (score !== p.priorityScore) await (this.prisma as any).investmentProposal.update({ where: { id: p.id }, data: { priorityScore: score } });
    }
    return saved;
  }

  // ───────────────────────── 투자위원회 ─────────────────────────
  @Get('meetings')
  async meetings(@Query('userId') userId?: string) {
    await this.me(userId);
    const items = await (this.prisma as any).investmentMeeting.findMany({ orderBy: { scheduledAt: 'desc' }, include: { proposals: { select: { id: true, title: true, status: true, amount: true, category: true, priorityScore: true, proposerName: true, decision: true, decisionNote: true, approvedAmount: true, fastTrack: true } } } });
    return { items };
  }

  /** 회의 소집: 일시·참석자·안건 지정 → 안건 ON_AGENDA, 참석자·제안자에게 알림 */
  @Post('meetings')
  async createMeeting(@Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canDecide) throw new ForbiddenException('임원 이상만 회의를 소집할 수 있습니다');
    const title = String(b.title || '').trim(); if (!title) throw new BadRequestException('title required');
    const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null; if (!scheduledAt || isNaN(scheduledAt.getTime())) throw new BadRequestException('scheduledAt required');
    const kind = ['ANNUAL', 'QUARTERLY', 'FAST_TRACK'].includes(String(b.kind)) ? String(b.kind) : 'QUARTERLY';
    const attendeeIds: string[] = Array.isArray(b.attendeeIds) ? b.attendeeIds.filter((x: any) => typeof x === 'string') : [];
    const proposalIds: string[] = Array.isArray(b.proposalIds) ? b.proposalIds.filter((x: any) => typeof x === 'string') : [];
    const m = await (this.prisma as any).investmentMeeting.create({ data: { title, kind, scheduledAt, location: String(b.location || ''), attendeeIds, createdById: me.id, status: 'PLANNED' } });
    await this.assignAgenda(m.id, proposalIds);
    await this.sendMeetingNotice(m.id, me.name);
    return this.meetingOne(m.id);
  }

  private async meetingOne(id: string) {
    return (this.prisma as any).investmentMeeting.findUnique({ where: { id }, include: { proposals: true } });
  }

  private async assignAgenda(meetingId: string, proposalIds: string[]) {
    // 이 회의에 있던 미결 안건 중 빠진 것은 되돌리고, 새로 지정된 것은 ON_AGENDA
    const cur = await (this.prisma as any).investmentProposal.findMany({ where: { meetingId, status: 'ON_AGENDA' }, select: { id: true, reviewedAt: true } });
    for (const c of cur) if (!proposalIds.includes(c.id)) await (this.prisma as any).investmentProposal.update({ where: { id: c.id }, data: { meetingId: null, status: c.reviewedAt ? 'REVIEWED' : 'SUBMITTED' } });
    if (proposalIds.length) {
      await (this.prisma as any).investmentProposal.updateMany({ where: { id: { in: proposalIds }, status: { in: ['SUBMITTED', 'REVIEWED', 'ON_AGENDA', 'DEFERRED'] } }, data: { meetingId, status: 'ON_AGENDA' } });
    }
  }

  private async sendMeetingNotice(meetingId: string, byName: string) {
    const m = await this.meetingOne(meetingId);
    const attendees: string[] = Array.isArray(m.attendeeIds) ? m.attendeeIds : [];
    const proposers = (m.proposals || []).map((p: any) => p.proposerId);
    await this.notify([...attendees, ...proposers], 'InvestmentMeeting', meetingId, { title: m.title, scheduledAt: m.scheduledAt, location: m.location, by: byName, agendaCount: (m.proposals || []).length });
    await (this.prisma as any).investmentMeeting.update({ where: { id: meetingId }, data: { notifiedAt: new Date() } });
  }

  @Put('meetings/:id')
  async updateMeeting(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canDecide) throw new ForbiddenException('임원 이상만 수정할 수 있습니다');
    const m = await (this.prisma as any).investmentMeeting.findUnique({ where: { id } });
    if (!m) throw new BadRequestException('not found');
    if (m.status !== 'PLANNED') throw new BadRequestException('이미 종료된 회의입니다');
    const data: any = {};
    if (b.title != null) data.title = String(b.title).trim();
    if (b.scheduledAt) data.scheduledAt = new Date(b.scheduledAt);
    if (b.location != null) data.location = String(b.location);
    if (b.kind) data.kind = String(b.kind);
    if (Array.isArray(b.attendeeIds)) data.attendeeIds = b.attendeeIds;
    await (this.prisma as any).investmentMeeting.update({ where: { id }, data });
    if (Array.isArray(b.proposalIds)) await this.assignAgenda(id, b.proposalIds);
    if (b.renotify) await this.sendMeetingNotice(id, me.name);
    return this.meetingOne(id);
  }

  @Post('meetings/:id/notify')
  async notifyMeeting(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canDecide) throw new ForbiddenException('임원 이상만 소집 알림을 보낼 수 있습니다');
    await this.sendMeetingNotice(id, me.name);
    return { ok: true };
  }

  @Post('meetings/:id/cancel')
  async cancelMeeting(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canDecide) throw new ForbiddenException('임원 이상만 취소할 수 있습니다');
    await this.assignAgenda(id, []);
    return (this.prisma as any).investmentMeeting.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /** 심의 결과 입력: 안건별 승인/보류/반려 + 승인 금액 → 회의 HELD, 제안자 알림 */
  @Post('meetings/:id/decide')
  async decide(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canDecide) throw new ForbiddenException('임원 이상만 결정을 기록할 수 있습니다');
    const m = await this.meetingOne(id);
    if (!m) throw new BadRequestException('not found');
    const decisions: Array<{ proposalId: string; decision: string; note?: string; approvedAmount?: number }> = Array.isArray(b.decisions) ? b.decisions : [];
    const now = new Date();
    for (const d of decisions) {
      const dec = String(d.decision || '').toUpperCase();
      if (!['APPROVED', 'DEFERRED', 'REJECTED'].includes(dec)) continue;
      const p = (m.proposals || []).find((x: any) => x.id === d.proposalId);
      if (!p) continue;
      await (this.prisma as any).investmentProposal.update({
        where: { id: p.id },
        data: { status: dec, decision: dec, decisionNote: String(d.note || '').trim() || null, decidedAt: now, approvedAmount: dec === 'APPROVED' ? (d.approvedAmount != null && d.approvedAmount !== ('' as any) ? Number(d.approvedAmount) : p.amount) : null, ...(dec === 'DEFERRED' ? { meetingId: null } : {}) },
      });
      await this.notify([p.proposerId], 'InvestmentDecided', p.id, { title: p.title, decision: dec, note: d.note || '', by: me.name, forRequester: true });
    }
    const finalize = b.finalize !== false;
    return (this.prisma as any).investmentMeeting.update({ where: { id }, data: { minutes: String(b.minutes || '') || m.minutes, ...(finalize ? { status: 'HELD', heldAt: now } : {}) }, include: { proposals: true } });
  }

  // ───────────────────────── 실행·사후검증 ─────────────────────────
  @Post('proposals/:id/execution')
  async execution(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    const p = await (this.prisma as any).investmentProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    if (p.proposerId !== me.id && !me.canReview) throw new ForbiddenException('제안자 또는 팀장 이상만 실행 현황을 입력할 수 있습니다');
    if (!['APPROVED', 'IN_PROGRESS', 'COMPLETED'].includes(p.status)) throw new BadRequestException('승인된 안건만 실행 현황을 입력할 수 있습니다');
    const st = String(b.status || '').toUpperCase();
    if (!['IN_PROGRESS', 'COMPLETED'].includes(st)) throw new BadRequestException('status must be IN_PROGRESS or COMPLETED');
    const data: any = { status: st, executionNote: String(b.executionNote || '').trim() || null };
    if (b.executionStartAt) data.executionStartAt = new Date(b.executionStartAt);
    if (b.executionEndAt) data.executionEndAt = new Date(b.executionEndAt);
    if (b.actualAmount != null && b.actualAmount !== '') data.actualAmount = Number(b.actualAmount);
    if (st === 'COMPLETED') {
      const end = data.executionEndAt || p.executionEndAt || new Date();
      data.executionEndAt = end;
      data.auditDueAt = new Date(new Date(end).getTime() + 365 * 86400000); // 완료 12개월 후 사후 검증
    }
    return (this.prisma as any).investmentProposal.update({ where: { id }, data });
  }

  @Post('proposals/:id/audit')
  async audit(@Param('id') id: string, @Body() b: any) {
    const me = await this.me(b?.userId);
    if (!me.canReview) throw new ForbiddenException('팀장 이상만 사후 검증을 기록할 수 있습니다');
    const p = await (this.prisma as any).investmentProposal.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('not found');
    if (!['COMPLETED', 'AUDITED'].includes(p.status)) throw new BadRequestException('실행 완료된 안건만 검증할 수 있습니다');
    const data: any = { status: 'AUDITED', auditNote: String(b.auditNote || '').trim() || null, auditedAt: new Date(), auditorName: me.name || '' };
    if (b.actualBenefit != null && b.actualBenefit !== '') data.actualBenefit = Number(b.actualBenefit);
    const updated = await (this.prisma as any).investmentProposal.update({ where: { id }, data });
    await this.notify([p.proposerId, ...(await this.committeeIds())], 'InvestmentAudited', id, { title: p.title, by: me.name, expected: p.annualBenefit, actual: updated.actualBenefit });
    return updated;
  }
}
