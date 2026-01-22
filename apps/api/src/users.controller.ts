import { Body, Controller, Get, Param, Put, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { Delete } from '@nestjs/common';

class UpdateRoleDto {
  @IsString() @IsNotEmpty()
  @IsEnum({ CEO: 'CEO', EXEC: 'EXEC', MANAGER: 'MANAGER', INDIVIDUAL: 'INDIVIDUAL' } as any)
  role!: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL';
}

class UpdateOrgUnitDto {
  @IsString()
  orgUnitId!: string; // empty string => clear
}

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  private async requireCeo(actorId?: string) {
    if (!actorId) throw new BadRequestException('actorId required');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new BadRequestException('only CEO can perform this action');
    return actor;
  }

  @Get('me')
  async me(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { orgUnit: true } });
    if (!user) throw new NotFoundException('user not found');
    return { id: user.id, email: user.email, teamsUpn: (user as any).teamsUpn || '', name: user.name, role: user.role, status: (user as any).status || 'ACTIVE', activatedAt: (user as any).activatedAt || null, teamName: user.orgUnit?.name || '', orgUnitId: user.orgUnitId || '' };
  }

  @Get()
  async list(
    @Query('orgUnitId') orgUnitId?: string,
    @Query('orgUnitIds') orgUnitIdsCsv?: string,
    @Query('includePending') includePending?: string,
    @Query('userId') userId?: string,
  ) {
    const where: any = {};
    if (orgUnitId) {
      where.orgUnitId = orgUnitId;
    } else if (orgUnitIdsCsv) {
      const ids = String(orgUnitIdsCsv)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) where.orgUnitId = { in: ids };
    }
    const wantsPending = includePending === '1' || includePending === 'true';
    if (wantsPending) {
      if (!userId) throw new BadRequestException('userId required');
      const actor = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!actor || (actor.role as any) !== 'CEO') throw new BadRequestException('only CEO can include pending users');
    } else {
      where.status = 'ACTIVE';
    }
    const users = await (this.prisma as any).user.findMany({ where, include: { orgUnit: true }, orderBy: { name: 'asc' } });
    return {
      items: users.map((u: any) => ({
        id: u.id,
        email: u.email,
        teamsUpn: (u as any).teamsUpn || '',
        name: u.name,
        role: u.role,
        status: (u as any).status || 'ACTIVE',
        activatedAt: (u as any).activatedAt || null,
        orgUnitId: u.orgUnitId || '',
        orgName: u.orgUnit?.name || '',
      })),
    };
  }

  @Put(':id/role')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    const user = await this.prisma.user.update({ where: { id }, data: { role: dto.role as any } });
    return { id: user.id, role: user.role };
  }

  @Put(':id/orgUnit')
  async updateOrgUnit(@Param('id') id: string, @Body() dto: UpdateOrgUnitDto, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    const nextOrgUnitId = String(dto?.orgUnitId || '').trim();
    const user = await this.prisma.user.update({ where: { id }, data: { orgUnitId: nextOrgUnitId ? nextOrgUnitId : null } });
    const org = user.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } }) : null;
    return { id: user.id, orgUnitId: user.orgUnitId || '', orgName: org?.name || '' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('actorId') actorId?: string) {
    await this.requireCeo(actorId);
    try {
      await this.prisma.user.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      throw new BadRequestException('삭제할 수 없습니다. 관련 데이터가 존재합니다.');
    }
  }
}

