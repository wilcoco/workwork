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

@Controller('orgs')
export class OrgsController {
  constructor(private prisma: PrismaService) {}

  @Get('tree')
  async tree() {
    const units = await this.prisma.orgUnit.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { children: true, users: true } } },
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
    const unit = await this.prisma.orgUnit.findUnique({ where: { id }, include: { _count: { select: { children: true, users: true } } } });
    if (!unit) throw new BadRequestException('org not found');
    if (unit._count.children > 0 || unit._count.users > 0) throw new BadRequestException('detach children/users first');
    await this.prisma.orgUnit.delete({ where: { id } });
    return { ok: true };
  }
}
