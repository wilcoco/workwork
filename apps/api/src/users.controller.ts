import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

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
    if (!userId) throw new Error('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { orgUnit: true } });
    if (!user) throw new Error('user not found');
    return { id: user.id, name: user.name, role: user.role, teamName: user.orgUnit?.name || '', orgUnitId: user.orgUnitId || '' };
  }

  @Put(':id/role')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const user = await this.prisma.user.update({ where: { id }, data: { role: dto.role as any } });
    return { id: user.id, role: user.role };
  }
}
