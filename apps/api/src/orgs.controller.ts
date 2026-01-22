import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, ForbiddenException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateOrgDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() type!: string;
  @IsOptional() @IsString() parentId?: string;
}

class UpdateOrgDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() parentId?: string | null;
}

class AddMemberDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() username?: string; // email/login id
}

class NukeDto {
  @IsString() @IsNotEmpty() confirm!: string;
}

class ForceDeleteDto {
  @IsString() @IsNotEmpty() confirm!: string; // must be 'FORCE DELETE'
}

@Controller('orgs')
export class OrgsController {
  constructor(private prisma: PrismaService) {}

  // --- Cascade helpers (duplicated from OkrsController to avoid cross-controller coupling) ---
  private async deleteInitiativeCascade(id: string, tx: any): Promise<void> {
    const children = await tx.initiative.findMany({ where: { parentId: id }, select: { id: true } });
    for (const ch of children) {
      await this.deleteInitiativeCascade(ch.id, tx);
    }
    const items = await tx.checklistItem.findMany({ where: { initiativeId: id }, select: { id: true } });
    if (items.length > 0) {
      await tx.checklistTick.deleteMany({ where: { checklistItemId: { in: items.map((i: any) => i.id) } } });
    }
    await tx.checklistItem.deleteMany({ where: { initiativeId: id } });
    await tx.worklog.deleteMany({ where: { initiativeId: id } });
    await tx.delegation.deleteMany({ where: { childInitiativeId: id } });
    await tx.initiative.deleteMany({ where: { id } });
  }

  private async deleteObjectiveCascade(id: string, tx: any, allowedOrgIds?: Set<string>): Promise<void> {
    // Delete KRs under objective
    const krs = await tx.keyResult.findMany({ where: { objectiveId: id }, select: { id: true } });
    for (const kr of krs) {
      await this.deleteKrCascade(kr.id, tx, allowedOrgIds);
    }
    // Delete child objectives
    const childWhere: any = { parentId: id } as any;
    if (allowedOrgIds && allowedOrgIds.size > 0) childWhere.orgUnitId = { in: Array.from(allowedOrgIds) };
    const children = await tx.objective.findMany({ where: childWhere, select: { id: true } });
    for (const ch of children) {
      await this.deleteObjectiveCascade(ch.id, tx, allowedOrgIds);
    }
    // Delete objective itself
    await tx.objective.deleteMany({ where: { id } });
  }

  private async deleteKrCascade(id: string, tx: any, allowedOrgIds?: Set<string>): Promise<void> {
    // Delete objectives aligned to this KR
    const whereAligned: any = { alignsToKrId: id } as any;
    if (allowedOrgIds && allowedOrgIds.size > 0) whereAligned.orgUnitId = { in: Array.from(allowedOrgIds) };
    const alignedObjs = await tx.objective.findMany({ where: whereAligned, select: { id: true } });
    for (const o of alignedObjs) {
      await this.deleteObjectiveCascade(o.id, tx, allowedOrgIds);
    }
    const inits = await tx.initiative.findMany({ where: { keyResultId: id }, select: { id: true } });
    for (const ii of inits) {
      await this.deleteInitiativeCascade(ii.id, tx);
    }
    await tx.keyResult.deleteMany({ where: { id } });
  }

  @Get('tree')
  async tree() {
    const unitsAll = await this.prisma.orgUnit.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { children: true, users: true, objectives: true } } },
    });
    const isPersonal = (name: string) => /^personal\s*-/i.test(name || '');
    const units = unitsAll.filter((u) => !isPersonal(u.name));
    const map: Record<string, any> = {};
    for (const u of units) {
      map[u.id] = { id: u.id, name: u.name, type: u.type, parentId: u.parentId || null, managerId: u.managerId || null, counts: u._count, children: [] as any[] };
    }
    const roots: any[] = [];
    for (const u of units) {
      const n = map[u.id];
      if (u.parentId && map[u.parentId]) map[u.parentId].children.push(n); else roots.push(n);
    }
    return { items: roots };
  }

  @Get()
  async list() {
    const all = await this.prisma.orgUnit.findMany({ orderBy: { name: 'asc' } });
    const items = all.filter((u) => !/^personal\s*-/i.test(u.name || ''));
    return { items };
  }

  @Get('managed')
  async managed(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const all = await this.prisma.orgUnit.findMany({
      select: { id: true, name: true, parentId: true, managerId: true },
      orderBy: { name: 'asc' },
    });
    const units = all.filter((u) => !/^personal\s*-/i.test(u.name || '')) as Array<{ id: string; name: string; parentId: string | null; managerId: string | null }>;

    const children = new Map<string | null, Array<{ id: string; name: string }>>();
    for (const u of units) {
      const k = u.parentId || null;
      if (!children.has(k)) children.set(k, []);
      children.get(k)!.push({ id: u.id, name: u.name });
    }

    const roots = units.filter((u) => String(u.managerId || '') === String(userId)).map((u) => ({ id: u.id, name: u.name }));
    const seen = new Map<string, string>();
    const stack = [...roots];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id)) continue;
      seen.set(cur.id, cur.name);
      const kids = children.get(cur.id) || [];
      for (const k of kids) stack.push(k);
    }

    const out = Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { items: out };
  }

  @Post()
  async create(@Body() dto: CreateOrgDto, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can create orgs');
    const rec = await this.prisma.orgUnit.create({ data: { name: dto.name, type: dto.type, parentId: dto.parentId || null } });
    return rec;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOrgDto) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.parentId !== undefined) data.parentId = dto.parentId || null;
    const rec = await this.prisma.orgUnit.update({ where: { id }, data });
    return rec;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can delete orgs');
    console.log('[OrgsController] delete-init', { id });
    const unit = await this.prisma.orgUnit.findUnique({ where: { id }, include: { _count: { select: { children: true, users: true, objectives: true } } } });
    if (!unit) throw new BadRequestException('org not found');
    console.log('[OrgsController] delete-check', { id, counts: unit._count });
    if (unit._count.children > 0 || unit._count.users > 0 || (unit as any)._count.objectives > 0) {
      console.warn('[OrgsController] delete-blocked', { id, children: unit._count.children, users: unit._count.users, objectives: (unit as any)._count.objectives });
      throw new BadRequestException('detach children/users/objectives first');
    }
    await this.prisma.orgUnit.delete({ where: { id } });
    console.log('[OrgsController] delete-success', { id });
    return { ok: true };
  }

  @Post('cleanup/personal')
  async cleanupPersonal(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can cleanup');
    // Find all Personal-* org units
    const all = await this.prisma.orgUnit.findMany({ orderBy: { name: 'asc' } });
    const personal = all.filter((u) => /^personal\s*-/i.test(u.name || ''));
    if (personal.length === 0) return { ok: true, deletedOrgCount: 0 };

    const visited = new Set<string>();
    let deleted = 0;
    for (const p of personal) {
      if (visited.has(p.id)) continue;
      await this.prisma.$transaction(async (tx) => {
        // collect subtree ids (children first)
        const order: string[] = [];
        const collect = async (oid: string) => {
          if (visited.has(oid)) return;
          visited.add(oid);
          const children = await tx.orgUnit.findMany({ where: { parentId: oid }, select: { id: true, name: true } });
          for (const c of children) await collect(c.id);
          order.push(oid);
        };
        await collect(p.id);

        const orgIds = order.slice();
        // delete objectives under these orgs (children first)
        const objs = await tx.objective.findMany({ where: { orgUnitId: { in: orgIds } }, select: { id: true, parentId: true } });
        const allIds = new Set(objs.map((o: any) => o.id));
        const roots = objs.filter((o: any) => !o.parentId || !allIds.has(o.parentId));
        const allowed = new Set<string>(orgIds);
        for (const r of roots) {
          await this.deleteObjectiveCascade(r.id, tx, allowed);
        }
        // unlink users
        await tx.user.updateMany({ where: { orgUnitId: { in: orgIds } }, data: { orgUnitId: null } });
        // flatten and delete org units
        await tx.orgUnit.updateMany({ where: { id: { in: orgIds } }, data: { managerId: null } });
        await tx.orgUnit.updateMany({ where: { parentId: { in: orgIds } }, data: { parentId: null } });
        for (const oid of order) {
          await tx.orgUnit.delete({ where: { id: oid } });
          deleted++;
        }
      });
    }
    return { ok: true, deletedOrgCount: deleted };
  }

  @Post(':id/force-delete')
  async forceDelete(@Param('id') id: string, @Body() dto: ForceDeleteDto, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can force delete');
    if ((dto.confirm || '').toUpperCase() !== 'FORCE DELETE') {
      throw new BadRequestException("type 'FORCE DELETE' to confirm");
    }
    const root = await this.prisma.orgUnit.findUnique({ where: { id } });
    if (!root) throw new BadRequestException('org not found');
    console.warn('[OrgsController] force-delete-init', { id, name: root.name });

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // collect subtree ids in post-order (children first)
        const order: string[] = [];
        const collect = async (oid: string) => {
          const children = await tx.orgUnit.findMany({ where: { parentId: oid }, select: { id: true } });
          for (const c of children) await collect(c.id);
          order.push(oid);
        };
        await collect(id);

        // delete objectives in subtree without double-deleting children
        const orgIds = order.slice();
        const objs = await tx.objective.findMany({ where: { orgUnitId: { in: orgIds } }, select: { id: true, parentId: true, orgUnitId: true } });
        const allIds = new Set(objs.map((o: any) => o.id));
        const roots = objs.filter((o: any) => !o.parentId || !allIds.has(o.parentId));
        const allowed = new Set<string>(orgIds);
        for (const r of roots) {
          await this.deleteObjectiveCascade(r.id, tx, allowed);
        }

        // unlink users from these orgs
        await tx.user.updateMany({ where: { orgUnitId: { in: orgIds } }, data: { orgUnitId: null } });

        // flatten managers and parents for safety, then delete org units bottom-up
        await tx.orgUnit.updateMany({ where: { id: { in: orgIds } }, data: { managerId: null } });
        await tx.orgUnit.updateMany({ where: { parentId: { in: orgIds } }, data: { parentId: null } });
        for (const oid of order) {
          await tx.orgUnit.delete({ where: { id: oid } });
        }
        return { deletedOrgCount: order.length, deletedObjectiveCount: objs.length, deletedObjectiveRoots: roots.length };
      });

      console.warn('[OrgsController] force-delete-success', { id, ...result });
      return { ok: true, ...result };
    } catch (err: any) {
      console.error('[OrgsController] force-delete-failed', { id, error: err?.message, stack: err?.stack });
      throw new BadRequestException(err?.message || 'force delete failed');
    }
  }

  @Get(':id/members')
  async members(@Param('id') id: string) {
    const users = await this.prisma.user.findMany({ where: { orgUnitId: id, role: { not: 'EXTERNAL' } as any }, orderBy: { name: 'asc' } });
    return { items: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })) };
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @Query('actorId') actorId?: string, @Query('userId') qUserId?: string) {
    const acting = actorId || qUserId; // support either actorId or userId as acting user
    if (!acting) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: acting } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can remove members');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('user not found');
    if (user.orgUnitId !== id) throw new BadRequestException('user not in this org');
    await this.prisma.user.update({ where: { id: userId }, data: { orgUnitId: null } });
    return { ok: true };
  }

  @Post(':id/members')
  async addMember(@Param('id') id: string, @Body() dto: AddMemberDto, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can add members');
    if (!dto.userId && !dto.username) throw new BadRequestException('userId or username required');
    let user = null as any;
    if (dto.userId) user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user && dto.username) user = await this.prisma.user.findUnique({ where: { email: dto.username } });
    if (!user) throw new BadRequestException('user not found');
    if ((user.role as any) === 'EXTERNAL') throw new BadRequestException('external user cannot belong to an org');
    await this.prisma.user.update({ where: { id: user.id }, data: { orgUnitId: id } });
    return { ok: true };
  }

  @Get(':id/objectives')
  async objectives(@Param('id') id: string) {
    const items = await this.prisma.objective.findMany({
      where: { orgUnitId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, ownerId: true, periodStart: true, periodEnd: true, status: true },
    });
    return { items };
  }

  @Post('nuke')
  async nuke(@Body() dto: NukeDto, @Query('userId') userId?: string) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_NUKE !== 'true') {
      throw new BadRequestException('nuke disabled in production');
    }
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can nuke');
    if ((dto.confirm || '').toLowerCase() !== 'delete everything') {
      throw new BadRequestException("type 'DELETE EVERYTHING' to confirm");
    }

    // 1) Delete child records in dependency order
    await this.prisma.checklistTick.deleteMany({});
    await this.prisma.worklog.deleteMany({});
    await this.prisma.checklistItem.deleteMany({});
    await this.prisma.delegation.deleteMany({});
    // 2) Initiatives
    await this.prisma.initiative.deleteMany({});
    // 3) Break Objective -> KR alignment
    await this.prisma.objective.updateMany({ data: ({ alignsToKrId: null } as any) });
    // 4) KeyResults
    await this.prisma.keyResult.deleteMany({});
    // 5) Objectives (children first)
    await this.prisma.objective.deleteMany({ where: { parentId: { not: null } } });
    await this.prisma.objective.deleteMany({});
    // 6) Optional: UserGoals
    await (this.prisma as any).userGoal.deleteMany({});
    // 7) Unlink users from orgs and flatten org tree, then delete orgs
    await this.prisma.user.updateMany({ data: { orgUnitId: null } });
    await this.prisma.orgUnit.updateMany({ data: { parentId: null, managerId: null } });
    await this.prisma.orgUnit.deleteMany({});

    return { ok: true };
  }
}
