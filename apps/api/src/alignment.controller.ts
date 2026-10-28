import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { isAncestorOrgManager } from './lib/org-hierarchy';
import { AlignmentService, type LinkType } from './alignment.service';

/**
 * 목표 정렬 작업대 API (팀장 이상)
 *  GET  graph      — 노드·확정 선·제안 선 + 정렬률
 *  POST link       — 드래그/제안 확정으로 연결
 *  POST unlink     — 연결 해제
 *  POST dismiss    — "연결 안 해도 됨" (같은 제안이 다시 뜨지 않음)
 *  GET  activities — 활동 검색(수동 연결용)
 */
@Controller('alignment')
export class AlignmentController {
  constructor(private prisma: PrismaService, private svc: AlignmentService) {}

  private async actor(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new BadRequestException('user not found');
    if (!['CEO', 'EXEC', 'MANAGER'].includes(String(u.role).toUpperCase())) throw new ForbiddenException('팀장 이상만 사용할 수 있습니다');
    return u;
  }

  /** 이 사용자가 그 목표/지표를 건드릴 수 있는가 — 임원은 전체, 팀장은 자기 팀·산하 */
  private async assertScope(user: any, orgUnitId?: string | null) {
    const role = String(user.role).toUpperCase();
    if (['CEO', 'EXEC'].includes(role)) return;
    if (!orgUnitId) throw new ForbiddenException('대상 조직을 알 수 없습니다');
    if (user.orgUnitId === orgUnitId) return;
    if (await isAncestorOrgManager(this.prisma, user, orgUnitId)) return;
    throw new ForbiddenException('자기 팀(또는 산하 팀)만 정렬할 수 있습니다');
  }

  private async orgOfObjective(id: string) {
    const o = await this.prisma.objective.findUnique({ where: { id }, select: { orgUnitId: true } });
    if (!o) throw new BadRequestException('목표를 찾을 수 없습니다');
    return o.orgUnitId;
  }
  private async orgOfKr(id: string) {
    const k: any = await this.prisma.keyResult.findUnique({ where: { id }, select: { objective: { select: { orgUnitId: true } } } });
    if (!k) throw new BadRequestException('지표를 찾을 수 없습니다');
    return k.objective?.orgUnitId || null;
  }

  @Get('graph')
  async graph(@Query('userId') userId?: string, @Query('year') year?: string, @Query('onlyBroken') onlyBroken?: string) {
    const u = await this.actor(userId);
    return this.svc.graph(u, { year: year ? Number(year) : undefined, onlyBroken: onlyBroken === '1' });
  }

  @Get('activities')
  async activities(@Query('userId') userId?: string, @Query('q') q?: string) {
    await this.actor(userId);
    const t = String(q || '').trim();
    const rows: any[] = await (this.prisma as any).activity.findMany({
      where: { status: { not: 'DEPRECATED' }, ...(t ? { name: { contains: t } } : {}) },
      select: { id: true, name: true, domain: true, category: true }, orderBy: { name: 'asc' }, take: 30,
    });
    return { items: rows };
  }

  @Post('link')
  async link(@Body() b: any) {
    const u = await this.actor(b?.userId);
    const type = String(b?.type || '') as LinkType;
    const sourceId = String(b?.sourceId || ''), targetId = String(b?.targetId || '');
    if (!type || !sourceId || !targetId) throw new BadRequestException('type·sourceId·targetId가 필요합니다');
    if (type === 'OBJECTIVE_PARENT' || type === 'OBJECTIVE_TREE') await this.assertScope(u, await this.orgOfObjective(sourceId));
    else if (type === 'KR_ASSIGNEE') await this.assertScope(u, await this.orgOfKr(targetId));
    else if (type === 'KR_ACTIVITY') await this.assertScope(u, await this.orgOfKr(sourceId));
    else throw new BadRequestException('알 수 없는 연결 종류');
    try { await this.svc.link(type, sourceId, targetId); }
    catch (e: any) { throw new BadRequestException(e?.message || '연결 실패'); }
    return { ok: true };
  }

  @Post('unlink')
  async unlink(@Body() b: any) {
    const u = await this.actor(b?.userId);
    const type = String(b?.type || '') as LinkType;
    const sourceId = String(b?.sourceId || ''), targetId = b?.targetId ? String(b.targetId) : undefined;
    if (type === 'OBJECTIVE_PARENT' || type === 'OBJECTIVE_TREE') await this.assertScope(u, await this.orgOfObjective(sourceId));
    else if (type === 'KR_ASSIGNEE') await this.assertScope(u, await this.orgOfKr(String(targetId)));
    else if (type === 'KR_ACTIVITY') await this.assertScope(u, await this.orgOfKr(sourceId));
    else throw new BadRequestException('알 수 없는 연결 종류');
    await this.svc.unlink(type, sourceId, targetId);
    return { ok: true };
  }

  /** "연결 안 해도 됨" — 제안이 다시 뜨지 않게 기록 */
  @Post('dismiss')
  async dismiss(@Body() b: any) {
    const u = await this.actor(b?.userId);
    const itemType = String(b?.itemType || ''), itemId = String(b?.itemId || '');
    if (!['OBJECTIVE_PARENT', 'KR_ASSIGNEE', 'KR_ACTIVITY'].includes(itemType) || !itemId) throw new BadRequestException('itemType·itemId가 필요합니다');
    if (itemType === 'OBJECTIVE_PARENT') await this.assertScope(u, await this.orgOfObjective(itemId));
    else await this.assertScope(u, await this.orgOfKr(itemId));
    await (this.prisma as any).alignmentReview.upsert({
      where: { itemType_itemId: { itemType, itemId } },
      create: { itemType, itemId, decision: 'DISMISSED', note: String(b?.note || '').slice(0, 500) || null, decidedById: u.id },
      update: { decision: 'DISMISSED', note: String(b?.note || '').slice(0, 500) || null, decidedById: u.id, decidedAt: new Date() },
    });
    return { ok: true };
  }

  @Delete('dismiss')
  async undismiss(@Query('userId') userId?: string, @Query('itemType') itemType?: string, @Query('itemId') itemId?: string) {
    await this.actor(userId);
    await (this.prisma as any).alignmentReview.deleteMany({ where: { itemType: String(itemType || ''), itemId: String(itemId || '') } });
    return { ok: true };
  }
}
