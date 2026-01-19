import { Body, Controller, Get, Param, Put, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { Delete } from '@nestjs/common';

class UpdateRoleDto {
  @IsString() @IsNotEmpty()
  @IsEnum({ CEO: 'CEO', EXEC: 'EXEC', MANAGER: 'MANAGER', INDIVIDUAL: 'INDIVIDUAL' } as any)
  role!: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL';
}

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

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
    @Query('includePending') includePending?: string,
    @Query('userId') userId?: string,
  ) {
    const where: any = {};
    if (orgUnitId) where.orgUnitId = orgUnitId;
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
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const user = await this.prisma.user.update({ where: { id }, data: { role: dto.role as any } });
    return { id: user.id, role: user.role };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.prisma.user.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      throw new BadRequestException('삭제할 수 없습니다. 관련 데이터가 존재합니다.');
    }
  }
}

