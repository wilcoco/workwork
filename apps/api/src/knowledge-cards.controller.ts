import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { isAncestorOrgManager } from './lib/org-hierarchy';
import { KnowledgeCardsService, normTitle } from './knowledge-cards.service';

/**
 * 암묵지 카드 API — 검색/열람(전원), 확인·수정(카드 담당자·팀장·임원), 직접 작성(전원), 추출 실행(임원), 프로세스 관련 카드
 */
@Controller('knowledge-cards')
export class KnowledgeCardsController {
  constructor(private prisma: PrismaService, private svc: KnowledgeCardsService) {}

  private async actor(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new BadRequestException('user not found');
    return u;
  }
  private isExec(u: any) { return ['CEO', 'EXEC'].includes(String(u.role).toUpperCase()); }
  private async canEdit(u: any, card: any) {
    if (this.isExec(u) || card.ownerId === u.id) return true;
    if (String(u.role).toUpperCase() === 'MANAGER' && card.orgUnitId && (u.orgUnitId === card.orgUnitId || (await isAncestorOrgManager(this.prisma, u, card.orgUnitId)))) return true;
    return false;
  }

  private async decorate(rows: any[]) {
    const uids = Array.from(new Set(rows.flatMap((r) => [r.ownerId, r.confirmedById]).filter(Boolean)));
    const oids = Array.from(new Set(rows.map((r) => r.orgUnitId).filter(Boolean)));
    const aids = Array.from(new Set(rows.map((r) => r.activityId).filter(Boolean)));
    const [users, orgs, acts]: any[] = await Promise.all([
      uids.length ? this.prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }) : [],
      oids.length ? this.prisma.orgUnit.findMany({ where: { id: { in: oids } }, select: { id: true, name: true } }) : [],
      aids.length ? (this.prisma as any).activity.findMany({ where: { id: { in: aids } }, select: { id: true, name: true } }) : [],
    ]);
    const um = new Map(users.map((x: any) => [x.id, x.name])), om = new Map(orgs.map((x: any) => [x.id, x.name])), am = new Map(acts.map((x: any) => [x.id, x.name]));
    return rows.map((r) => ({ ...r, ownerName: um.get(r.ownerId) || '', confirmedByName: r.confirmedById ? um.get(r.confirmedById) || '' : '', teamName: r.orgUnitId ? om.get(r.orgUnitId) || '' : '', activityName: r.activityId ? am.get(r.activityId) || '' : '' }));
  }

  @Get()
  async list(@Query('userId') userId?: string, @Query('q') q?: string, @Query('status') status?: string, @Query('orgUnitId') orgUnitId?: string, @Query('mine') mine?: string, @Query('limit') limit?: string) {
    const u = await this.actor(userId);
    const where: any = {};
    where.status = status ? status : { in: ['CONFIRMED', 'DRAFT'] };
    if (orgUnitId) where.orgUnitId = orgUnitId;
    if (mine === '1') where.ownerId = u.id;
    const tokens = String(q || '').split(/[\s,·/()]+/).map((t) => t.trim()).filter((t) => t.length >= 1).slice(0, 6);
    if (tokens.length) where.AND = tokens.map((t) => ({ OR: [{ title: { contains: t } }, { symptom: { contains: t } }, { action: { contains: t } }] }));
    const rows: any[] = await (this.prisma as any).knowledgeCard.findMany({ where, orderBy: [{ status: 'asc' }, { useCount: 'desc' }, { createdAt: 'desc' }], take: Math.min(200, Number(limit) || 100) });
    const items = await this.decorate(rows);
    const myDrafts = await (this.prisma as any).knowledgeCard.count({ where: { status: 'DRAFT', ownerId: u.id } });
    const teams: any[] = await this.prisma.orgUnit.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.orgUnitId).filter(Boolean))) } }, select: { id: true, name: true } });
    return { items: items.map((c) => ({ ...c, canEdit: c.ownerId === u.id || this.isExec(u) })), myDrafts, isExec: this.isExec(u), teams };
  }

  @Get('stats')
  async stats(@Query('userId') userId?: string) {
    await this.actor(userId);
    const [total, confirmed, draft, pendingWorklogs] = await Promise.all([
      (this.prisma as any).knowledgeCard.count({ where: { status: { not: 'ARCHIVED' } } }),
      (this.prisma as any).knowledgeCard.count({ where: { status: 'CONFIRMED' } }),
      (this.prisma as any).knowledgeCard.count({ where: { status: 'DRAFT' } }),
      this.prisma.worklog.count({ where: { kcScannedAt: null, date: { gte: new Date(Date.now() - 180 * 86400000) }, note: { not: null } } as any }),
    ]);
    return { total, confirmed, draft, pendingWorklogs };
  }

  /** 프로세스 인스턴스·활동·검색어로 관련 카드(확인된 것만) */
  @Get('related')
  async related(@Query('userId') userId?: string, @Query('instanceId') instanceId?: string, @Query('activityId') activityId?: string, @Query('q') q?: string) {
    await this.actor(userId);
    let activityIds: string[] = activityId ? [activityId] : [];
    let text = String(q || '');
    if (instanceId) {
      const inst: any = await (this.prisma as any).processInstance.findUnique({ where: { id: instanceId }, select: { title: true, template: { select: { title: true, tasks: { select: { activityId: true, name: true } } } } } });
      if (inst) { activityIds.push(...(inst.template?.tasks || []).map((t: any) => t.activityId).filter(Boolean)); text = [text, inst.title, inst.template?.title].filter(Boolean).join(' '); }
    }
    activityIds = Array.from(new Set(activityIds));
    const rows = await this.svc.related({ activityIds, q: text, limit: 6 });
    return { items: await this.decorate(rows) };
  }

  @Post('extract')
  async extract(@Body() b: any) {
    const u = await this.actor(b?.userId);
    if (!this.isExec(u)) throw new ForbiddenException('임원만 실행할 수 있습니다');
    return this.svc.extractBatch(Math.min(50, Number(b?.worklogLimit) || 25), Math.min(10, Number(b?.manualLimit) || 5), u.id);
  }

  /** 직접 작성 — 작성자가 곧 담당자, 바로 CONFIRMED */
  @Post()
  async create(@Body() b: any) {
    const u = await this.actor(b?.userId);
    const title = String(b?.title || '').trim();
    if (!title || !String(b?.action || '').trim()) throw new BadRequestException('제목과 조치는 필수입니다');
    const card = await (this.prisma as any).knowledgeCard.create({ data: { title: title.slice(0, 200), normTitle: normTitle(title), symptom: String(b?.symptom || '').slice(0, 3000), checks: Array.isArray(b?.checks) ? b.checks.map(String).filter(Boolean).slice(0, 8) : [], action: String(b.action).slice(0, 3000), tags: Array.isArray(b?.tags) ? b.tags.map(String).slice(0, 8) : [], sourceType: 'MANUAL_INPUT', activityId: b?.activityId || null, orgUnitId: u.orgUnitId || null, ownerId: u.id, status: 'CONFIRMED', confidence: 100, confirmedById: u.id, confirmedAt: new Date(), createdById: u.id } });
    return (await this.decorate([card]))[0];
  }

  @Get(':id')
  async one(@Param('id') id: string, @Query('userId') userId?: string) {
    const u = await this.actor(userId);
    const c = await (this.prisma as any).knowledgeCard.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return { ...(await this.decorate([c]))[0], canEdit: await this.canEdit(u, c) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId);
    const c = await (this.prisma as any).knowledgeCard.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    if (!(await this.canEdit(u, c))) throw new ForbiddenException('카드 담당자·팀장·임원만 수정할 수 있습니다');
    const data: any = {};
    if (b?.title != null) { data.title = String(b.title).slice(0, 200); data.normTitle = normTitle(data.title); }
    for (const k of ['symptom', 'action']) if (b?.[k] != null) data[k] = String(b[k]).slice(0, 3000);
    if (Array.isArray(b?.checks)) data.checks = b.checks.map(String).filter(Boolean).slice(0, 8);
    if (Array.isArray(b?.tags)) data.tags = b.tags.map(String).filter(Boolean).slice(0, 8);
    if (b?.activityId !== undefined) data.activityId = b.activityId || null;
    if (b?.confirm === true) { data.status = 'CONFIRMED'; data.confirmedById = u.id; data.confirmedAt = new Date(); }
    if (b?.archive === true) data.status = 'ARCHIVED';
    const saved = await (this.prisma as any).knowledgeCard.update({ where: { id }, data });
    return { ...(await this.decorate([saved]))[0], canEdit: true };
  }

  /** "도움이 됐어요" — 사용 횟수(노출 우선순위) */
  @Post(':id/use')
  async use(@Param('id') id: string, @Body() b: any) {
    await this.actor(b?.userId);
    await (this.prisma as any).knowledgeCard.update({ where: { id }, data: { useCount: { increment: 1 } } });
    return { ok: true };
  }
}
