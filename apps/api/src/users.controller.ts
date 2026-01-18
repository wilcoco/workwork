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
    return { id: user.id, email: user.email, teamsUpn: (user as any).teamsUpn || '', name: user.name, role: user.role, teamName: user.orgUnit?.name || '', orgUnitId: user.orgUnitId || '' };
  }

  @Get()
  async list(@Query('orgUnitId') orgUnitId?: string) {
    const where: any = {};
    if (orgUnitId) where.orgUnitId = orgUnitId;
    const users = await this.prisma.user.findMany({ where, include: { orgUnit: true }, orderBy: { name: 'asc' } });
    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        teamsUpn: (u as any).teamsUpn || '',
        name: u.name,
        role: u.role,
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

