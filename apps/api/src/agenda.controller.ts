import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { isAncestorOrgManager } from './lib/org-hierarchy';
import { AgendaService } from './agenda.service';

/**
 * 어젠다 클레임 API
 *  - 대표(CEO): 초안 생성(AI)·질문 답·재정리·항목 편집·공개·마감·클레임 승인/반려
 *  - 팀장(MANAGER, 또는 임원): 자기 팀으로 클레임(AI 제안 포함)·철회
 *  - 전원: 열람·클레임 지도
 */
@Controller('agenda')
export class AgendaController {
  constructor(private prisma: PrismaService, private svc: AgendaService) {}

  private async actor(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new BadRequestException('user not found');
    return u;
  }
  private isCEO(u: any) { return String(u.role).toUpperCase() === 'CEO'; }
  private isExec(u: any) { return ['CEO', 'EXEC'].includes(String(u.role).toUpperCase()); }
  private assertCEO(u: any) { if (!this.isCEO(u)) throw new ForbiddenException('대표만 할 수 있습니다'); }

  private async load(id: string) {
    const a = await (this.prisma as any).agenda.findUnique({ where: { id }, include: { items: { orderBy: { order: 'asc' }, include: { claims: true } } } });
    if (!a) throw new NotFoundException('어젠다를 찾을 수 없습니다');
    return a;
  }

  /** 클레임 가능한 팀: 팀장은 자기 팀, 상위 조직 책임자는 산하 팀, 임원은 전체 */
  private async claimableTeams(u: any) {
    const teams = await this.svc.teams();
    if (this.isExec(u)) return teams;
    const out: any[] = [];
    for (const t of teams) if (t.id === u.orgUnitId || t.managerId === u.id || (await isAncestorOrgManager(this.prisma, u, t.id))) out.push(t);
    return out;
  }

  @Get()
  async list(@Query('userId') userId?: string) {
    const u = await this.actor(userId);
    const where: any = this.isCEO(u) ? {} : { status: { in: ['OPEN', 'CLOSED'] } };
    const rows: any[] = await (this.prisma as any).agenda.findMany({ where, orderBy: [{ year: 'desc' }, { createdAt: 'desc' }], include: { items: { select: { id: true, status: true, weight: true } } } });
    return { items: rows.map((a) => ({ id: a.id, year: a.year, statement: a.statement, status: a.status, publishedAt: a.publishedAt, itemCount: a.items.length, approved: a.items.filter((i: any) => i.status === 'APPROVED').length, claimed: a.items.filter((i: any) => i.status === 'CLAIMED').length, open: a.items.filter((i: any) => i.status === 'OPEN').length })), isCEO: this.isCEO(u) };
  }

  @Post('draft')
  async draft(@Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const statement = String(b?.statement || '').trim();
    if (statement.length < 10) throw new BadRequestException('목표 문장을 10자 이상 적어 주세요');
    const year = Number(b?.year) || new Date().getFullYear();
    const d = await this.svc.draft(statement, year);
    const a = await (this.prisma as any).agenda.create({ data: { year, statement, summary: d.summary, aiQuestions: d.questions, createdById: u.id, items: { create: d.items } } });
    return this.load(a.id);
  }

  @Post(':id/refine')
  async refine(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const a = await this.load(id);
    if (a.status !== 'DRAFT') throw new BadRequestException('공개된 어젠다는 재정리할 수 없습니다');
    const answers: any[] = Array.isArray(b?.answers) ? b.answers.map((x: any) => ({ no: Number(x.no), text: String(x.text || '') })) : [];
    const d = await this.svc.refine(a, answers);
    await this.prisma.$transaction(async (tx) => {
      await (tx as any).agendaItem.deleteMany({ where: { agendaId: id } });
      await (tx as any).agenda.update({ where: { id }, data: { aiAnswers: answers, summary: d.summary, items: { create: d.items } } });
    });
    return this.load(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const a = await this.load(id);
    const data: any = {};
    if (b?.statement != null && a.status === 'DRAFT') data.statement = String(b.statement).slice(0, 2000);
    if (b?.summary != null) data.summary = String(b.summary).slice(0, 3000);
    if (b?.aiAnswers) data.aiAnswers = b.aiAnswers;
    await (this.prisma as any).agenda.update({ where: { id }, data });
    return this.load(id);
  }

  @Post(':id/items')
  async addItem(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const a = await this.load(id);
    await (this.prisma as any).agendaItem.create({ data: { agendaId: id, order: a.items.length, title: String(b?.title || '새 항목').slice(0, 200), description: String(b?.description || '').slice(0, 2000), weight: Math.max(0, Math.min(100, Number(b?.weight) || 10)), krDraft: b?.krDraft || null } });
    return this.load(id);
  }

  @Put('items/:itemId')
  async updateItem(@Param('itemId') itemId: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const it = await (this.prisma as any).agendaItem.findUnique({ where: { id: itemId } });
    if (!it) throw new NotFoundException();
    const data: any = {};
    for (const k of ['title', 'description']) if (b?.[k] != null) data[k] = String(b[k]).slice(0, k === 'title' ? 200 : 2000);
    if (b?.weight != null) data.weight = Math.max(0, Math.min(100, Number(b.weight) || 0));
    if (b?.order != null) data.order = Number(b.order) || 0;
    if (b?.krDraft) data.krDraft = b.krDraft;
    await (this.prisma as any).agendaItem.update({ where: { id: itemId }, data });
    return this.load(it.agendaId);
  }

  @Delete('items/:itemId')
  async deleteItem(@Param('itemId') itemId: string, @Query('userId') userId?: string) {
    const u = await this.actor(userId); this.assertCEO(u);
    const it = await (this.prisma as any).agendaItem.findUnique({ where: { id: itemId }, include: { claims: true } });
    if (!it) throw new NotFoundException();
    if (it.claims.some((c: any) => c.status === 'APPROVED')) throw new BadRequestException('승인된 클레임이 있는 항목은 삭제할 수 없습니다');
    await (this.prisma as any).agendaItem.delete({ where: { id: itemId } });
    return this.load(it.agendaId);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const a = await this.load(id);
    if (!a.items.length) throw new BadRequestException('항목이 없습니다');
    await (this.prisma as any).agenda.update({ where: { id }, data: { status: 'OPEN', publishedAt: new Date() } });
    // 팀장 전원에게 알림
    const mgrs: any[] = await this.prisma.user.findMany({ where: { status: 'ACTIVE' as any, role: { in: ['MANAGER', 'EXEC'] as any } }, select: { id: true } });
    await this.prisma.notification.createMany({ data: mgrs.map((m) => ({ userId: m.id, type: 'AgendaPublished', subjectType: 'AGENDA', subjectId: id, payload: { year: a.year, statement: a.statement, items: a.items.length } })) }).catch(() => {});
    return this.load(id);
  }

  @Post(':id/close')
  async close(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    await (this.prisma as any).agenda.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    return this.load(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const u = await this.actor(userId); this.assertCEO(u);
    const a = await this.load(id);
    if (a.status !== 'DRAFT') throw new BadRequestException('초안만 삭제할 수 있습니다');
    await (this.prisma as any).agenda.delete({ where: { id } });
    return { ok: true };
  }

  /** 상세 + 클레임 지도(항목 × 팀) */
  @Get(':id')
  async one(@Param('id') id: string, @Query('userId') userId?: string) {
    const u = await this.actor(userId);
    const a = await this.load(id);
    if (a.status === 'DRAFT' && !this.isCEO(u)) throw new ForbiddenException('아직 공개되지 않았습니다');
    const teams = await this.svc.teams();
    const myTeams = await this.claimableTeams(u);
    const uids = Array.from(new Set(a.items.flatMap((i: any) => i.claims.flatMap((c: any) => [c.claimedById, c.decidedById].filter(Boolean)))));
    const users: any[] = uids.length ? await this.prisma.user.findMany({ where: { id: { in: uids as string[] } }, select: { id: true, name: true } }) : [];
    const um = new Map(users.map((x) => [x.id, x.name]));
    const tm = new Map(teams.map((t) => [t.id, t.name]));
    const items = a.items.map((it: any) => ({ ...it, claims: it.claims.map((c: any) => ({ ...c, teamName: tm.get(c.orgUnitId) || '', claimedByName: um.get(c.claimedById) || '', decidedByName: c.decidedById ? um.get(c.decidedById) || '' : '' })) }));
    const totalWeight = items.reduce((s: number, i: any) => s + (i.weight || 0), 0);
    const coveredWeight = items.filter((i: any) => i.status === 'APPROVED').reduce((s: number, i: any) => s + (i.weight || 0), 0);
    return { ...a, items, teams, myTeams: myTeams.map((t) => t.id), isCEO: this.isCEO(u), canClaim: myTeams.length > 0 && a.status === 'OPEN', coverage: { totalWeight, coveredWeight, pct: totalWeight ? Math.round((coveredWeight / totalWeight) * 100) : 0 } };
  }

  @Post('items/:itemId/suggest')
  async suggest(@Param('itemId') itemId: string, @Body() b: any) {
    const u = await this.actor(b?.userId);
    const it = await (this.prisma as any).agendaItem.findUnique({ where: { id: itemId }, include: { agenda: true } });
    if (!it) throw new NotFoundException();
    const teams = await this.claimableTeams(u);
    const team = teams.find((t) => t.id === String(b?.orgUnitId || u.orgUnitId));
    if (!team) throw new ForbiddenException('클레임할 수 있는 팀이 아닙니다');
    return this.svc.suggestClaim(it, it.agenda, team);
  }

  @Post('items/:itemId/claim')
  async claim(@Param('itemId') itemId: string, @Body() b: any) {
    const u = await this.actor(b?.userId);
    const it = await (this.prisma as any).agendaItem.findUnique({ where: { id: itemId }, include: { agenda: true } });
    if (!it) throw new NotFoundException();
    if (it.agenda.status !== 'OPEN') throw new BadRequestException('클레임을 받는 중이 아닙니다');
    const teams = await this.claimableTeams(u);
    const orgUnitId = String(b?.orgUnitId || u.orgUnitId || '');
    if (!teams.some((t) => t.id === orgUnitId)) throw new ForbiddenException('자기 팀(또는 산하 팀)만 클레임할 수 있습니다');
    const title = String(b?.title || '').trim(), metric = String(b?.metric || '').trim(), unit = String(b?.unit || '').trim(), target = Number(b?.target);
    if (!title || !unit || Number.isNaN(target)) throw new BadRequestException('KR 제목·단위·목표치는 필수입니다');
    const existing = await (this.prisma as any).agendaClaim.findUnique({ where: { itemId_orgUnitId: { itemId, orgUnitId } } });
    if (existing && existing.status === 'APPROVED') throw new BadRequestException('이미 승인된 클레임입니다');
    const data = { title: title.slice(0, 200), metric: metric.slice(0, 500), unit: unit.slice(0, 30), target, direction: b?.direction === 'AT_MOST' ? 'AT_MOST' : 'AT_LEAST', rationale: String(b?.rationale || '').slice(0, 2000), status: 'PROPOSED', claimedById: u.id, decidedById: null, decidedAt: null, decisionNote: null };
    if (existing) await (this.prisma as any).agendaClaim.update({ where: { id: existing.id }, data });
    else await (this.prisma as any).agendaClaim.create({ data: { itemId, orgUnitId, ...data } });
    await this.svc.refreshItemStatus(itemId);
    const ceo = await this.prisma.user.findFirst({ where: { role: 'CEO' as any, status: 'ACTIVE' as any }, select: { id: true } });
    if (ceo) await this.prisma.notification.create({ data: { userId: ceo.id, type: 'AgendaClaimed', subjectType: 'AGENDA', subjectId: it.agendaId, payload: { item: it.title, by: u.name, title } } }).catch(() => {});
    return this.one(it.agendaId, u.id);
  }

  @Delete('claims/:claimId')
  async withdraw(@Param('claimId') claimId: string, @Query('userId') userId?: string) {
    const u = await this.actor(userId);
    const c = await (this.prisma as any).agendaClaim.findUnique({ where: { id: claimId }, include: { item: true } });
    if (!c) throw new NotFoundException();
    if (c.status === 'APPROVED') throw new BadRequestException('승인된 클레임은 철회할 수 없습니다 (대표에게 KR 삭제를 요청)');
    if (c.claimedById !== u.id && !this.isCEO(u)) throw new ForbiddenException('본인 클레임만 철회할 수 있습니다');
    await (this.prisma as any).agendaClaim.delete({ where: { id: claimId } });
    await this.svc.refreshItemStatus(c.itemId);
    return this.one(c.item.agendaId, u.id);
  }

  @Post('claims/:claimId/approve')
  async approve(@Param('claimId') claimId: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const c = await (this.prisma as any).agendaClaim.findUnique({ where: { id: claimId }, include: { item: { include: { agenda: true } } } });
    if (!c) throw new NotFoundException();
    if (c.status === 'APPROVED') throw new BadRequestException('이미 승인됨');
    await this.svc.approveClaim(c, c.item, c.item.agenda, u.id, b?.note);
    await this.prisma.notification.create({ data: { userId: c.claimedById, type: 'AgendaClaimApproved', subjectType: 'AGENDA', subjectId: c.item.agendaId, payload: { item: c.item.title, title: c.title } } }).catch(() => {});
    return this.one(c.item.agendaId, u.id);
  }

  @Post('claims/:claimId/reject')
  async reject(@Param('claimId') claimId: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertCEO(u);
    const c = await (this.prisma as any).agendaClaim.findUnique({ where: { id: claimId }, include: { item: true } });
    if (!c) throw new NotFoundException();
    if (c.status === 'APPROVED') throw new BadRequestException('승인된 클레임은 반려할 수 없습니다');
    await (this.prisma as any).agendaClaim.update({ where: { id: claimId }, data: { status: 'REJECTED', decidedById: u.id, decidedAt: new Date(), decisionNote: String(b?.note || '').slice(0, 1000) || null } });
    await this.svc.refreshItemStatus(c.itemId);
    await this.prisma.notification.create({ data: { userId: c.claimedById, type: 'AgendaClaimRejected', subjectType: 'AGENDA', subjectId: c.item.agendaId, payload: { item: c.item.title, note: b?.note || '' } } }).catch(() => {});
    return this.one(c.item.agendaId, u.id);
  }
}
