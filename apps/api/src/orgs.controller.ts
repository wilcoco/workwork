import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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

class NukeDto {
  @IsString() @IsNotEmpty() confirm!: string;
}

@Controller('orgs')
export class OrgsController {
  constructor(private prisma: PrismaService) {}

  @Get('tree')
  async tree() {
    const units = await this.prisma.orgUnit.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { children: true, users: true, objectives: true } } },
    });
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
    const items = await this.prisma.orgUnit.findMany({ orderBy: { name: 'asc' } });
    return { items };
  }

  @Post()
  async create(@Body() dto: CreateOrgDto) {
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
  async remove(@Param('id') id: string) {
    const unit = await this.prisma.orgUnit.findUnique({ where: { id }, include: { _count: { select: { children: true, users: true, objectives: true } } } });
    if (!unit) throw new BadRequestException('org not found');
    if (unit._count.children > 0 || unit._count.users > 0 || (unit as any)._count.objectives > 0) {
      throw new BadRequestException('detach children/users/objectives first');
    }
    await this.prisma.orgUnit.delete({ where: { id } });
    return { ok: true };
  }

  @Get(':id/members')
  async members(@Param('id') id: string) {
    const users = await this.prisma.user.findMany({ where: { orgUnitId: id }, orderBy: { name: 'asc' } });
    return { items: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })) };
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('user not found');
    if (user.orgUnitId !== id) throw new BadRequestException('user not in this org');
    await this.prisma.user.update({ where: { id: userId }, data: { orgUnitId: null } });
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
  async nuke(@Body() dto: NukeDto) {
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
