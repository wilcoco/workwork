import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateObjectiveDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsString() alignsToKrId?: string;
}

class CreateKeyResultDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() metric!: string;
  @IsNumber() target!: number;
  @IsString() @IsNotEmpty() unit!: string;
  @IsEnum({ PROJECT: 'PROJECT', OPERATIONAL: 'OPERATIONAL' } as any) type!: 'PROJECT' | 'OPERATIONAL';
  @IsOptional() @IsNumber() weight?: number;
}

@Controller('okrs')
export class OkrsController {
  constructor(private prisma: PrismaService) {}

  @Get('parent-krs')
  async parentKrs(@Query('userId') userId: string) {
    if (!userId) throw new Error('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { orgUnit: true } });
    if (!user) throw new Error('user not found');

    let where: any = {};
    if (user.role === 'CEO') {
      return { items: [] };
    } else if (user.role === 'EXEC') {
      where = { objective: { parentId: null } };
    } else if (user.role === 'MANAGER') {
      const myUnit = user.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } }) : null;
      const parentId = myUnit?.parentId || undefined;
      if (!parentId) return { items: [] };
      where = { objective: { orgUnitId: parentId } };
    } else {
      const myUnitId = user.orgUnitId || undefined;
      if (!myUnitId) return { items: [] };
      where = { objective: { orgUnitId: myUnitId, owner: { role: 'MANAGER' as any } } };
    }

    const items = await this.prisma.keyResult.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { objective: { include: { owner: true, orgUnit: true } } },
    });
    return { items };
  }

  @Get('my')
  async myOkrs(@Query('userId') userId: string) {
    if (!userId) throw new Error('userId required');
    const items = await this.prisma.objective.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      include: ({ keyResults: true, alignsToKr: { include: { objective: true } }, orgUnit: true } as any),
    });
    return { items };
  }

  @Post('objectives')
  async createObjective(@Body() dto: CreateObjectiveDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new Error('user not found');
    // Role-based validation for alignment
    if (user.role === 'CEO') {
      if (dto.alignsToKrId) throw new Error('CEO cannot align to a parent KR for top-level Objective');
    } else {
      if (!dto.alignsToKrId) throw new Error('non-CEO must align Objective to a parent KR');
      const parentKr = await this.prisma.keyResult.findUnique({
        where: { id: dto.alignsToKrId },
        include: { objective: { include: { owner: true, orgUnit: true } } },
      });
      if (!parentKr) throw new Error('parent KR not found');
      if (user.role === 'EXEC') {
        if (parentKr.objective?.parentId) throw new Error('EXEC must align to a top-level company Objective KR');
      } else if (user.role === 'MANAGER') {
        if (!user.orgUnitId) throw new Error('MANAGER must belong to an org unit');
        const myUnit = await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } });
        const parentUnitId = myUnit?.parentId || null;
        if (!parentUnitId) throw new Error('MANAGER requires a parent org unit');
        if (parentKr.objective?.orgUnitId !== parentUnitId) throw new Error('MANAGER must align to parent org unit KR');
      } else {
        // INDIVIDUAL
        const myUnitId = user.orgUnitId || null;
        if (!myUnitId) throw new Error('INDIVIDUAL must belong to an org unit');
        const ok = parentKr.objective?.orgUnitId === myUnitId && parentKr.objective?.owner?.role === 'MANAGER';
        if (!ok) throw new Error('INDIVIDUAL must align to Manager KR in the same org unit');
      }
    }

    let orgUnitId = user.orgUnitId;
    if (!orgUnitId) {
      const team = await this.prisma.orgUnit.create({ data: { name: `Personal-${user.name}`, type: 'TEAM' } });
      await this.prisma.user.update({ where: { id: user.id }, data: { orgUnitId: team.id } });
      orgUnitId = team.id;
    }
    const rec = await this.prisma.objective.create({
      data: ({
        title: dto.title,
        description: dto.description,
        orgUnitId,
        ownerId: user.id,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        alignsToKrId: dto.alignsToKrId,
        status: 'ACTIVE' as any,
      } as any),
    });
    return rec;
  }

  @Post('objectives/:id/krs')
  async createKr(@Param('id') objectiveId: string, @Body() dto: CreateKeyResultDto) {
    const obj = await this.prisma.objective.findUnique({ where: { id: objectiveId } });
    if (!obj) throw new Error('objective not found');
    const rec = await this.prisma.keyResult.create({
      data: ({
        objectiveId,
        title: dto.title,
        metric: dto.metric,
        target: dto.target,
        unit: dto.unit,
        ownerId: dto.userId,
        weight: dto.weight ?? 1,
        type: dto.type as any,
      } as any),
    });
    return rec;
  }
}
