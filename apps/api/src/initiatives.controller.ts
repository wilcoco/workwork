import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsBoolean, IsInt, Min } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateInitiativeDto {
  @IsString() @IsNotEmpty() keyResultId!: string;
  @IsString() @IsNotEmpty() ownerId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum({ PROJECT: 'PROJECT', OPERATIONAL: 'OPERATIONAL' } as any) type?: 'PROJECT' | 'OPERATIONAL';
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsEnum({ DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' } as any) cadence?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  @IsOptional() @IsString() cadenceAnchor?: string;
  @IsOptional() @IsString() userGoalId?: string;
  @IsOptional() @IsString() parentId?: string;
}

class UpdateInitiativeDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum({ PROJECT: 'PROJECT', OPERATIONAL: 'OPERATIONAL' } as any) type?: 'PROJECT' | 'OPERATIONAL';
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsEnum({ DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' } as any) cadence?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  @IsOptional() @IsString() cadenceAnchor?: string;
  @IsOptional() @IsString() userGoalId?: string;
}

class CreateChecklistItemDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateChecklistItemDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class TickChecklistDto {
  @IsString() @IsNotEmpty() actorId!: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
}

@Controller('initiatives')
export class InitiativesController {
  constructor(private prisma: PrismaService) {}

  private async deleteInitiativeCascade(id: string, tx: any): Promise<void> {
    // Delete child initiatives first
    const children = await tx.initiative.findMany({ where: { parentId: id }, select: { id: true } });
    for (const ch of children) {
      await this.deleteInitiativeCascade(ch.id, tx);
    }
    // Checklist ticks and items
    const items = await tx.checklistItem.findMany({ where: { initiativeId: id }, select: { id: true } });
    if (items.length) {
      await tx.checklistTick.deleteMany({ where: { checklistItemId: { in: items.map((i: any) => i.id) } } });
    }
    await tx.checklistItem.deleteMany({ where: { initiativeId: id } });
    // Worklogs
    await tx.worklog.deleteMany({ where: { initiativeId: id } });
    // Delegations referencing this initiative as child
    await tx.delegation.deleteMany({ where: { childInitiativeId: id } });
    // Finally, the initiative
    await tx.initiative.delete({ where: { id } });
  }

  @Get('my')
  async my(@Query('userId') userId: string) {
    if (!userId) throw new Error('userId required');
    const items = await this.prisma.initiative.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  @Post()
  async create(@Body() dto: CreateInitiativeDto) {
    const data: any = {
      keyResultId: dto.keyResultId,
      ownerId: dto.ownerId,
      title: dto.title,
      description: dto.description,
      type: (dto.type as any) ?? 'PROJECT',
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      cadence: dto.cadence as any,
      cadenceAnchor: dto.cadenceAnchor,
      userGoalId: dto.userGoalId,
      parentId: dto.parentId,
    };
    const rec = await this.prisma.initiative.create({ data });
    return rec;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateInitiativeDto) {
    const data: any = {
      title: dto.title,
      description: dto.description,
      type: dto.type as any,
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      cadence: dto.cadence as any,
      cadenceAnchor: dto.cadenceAnchor,
      userGoalId: dto.userGoalId,
    };
    const rec = await this.prisma.initiative.update({ where: { id }, data });
    return rec;
    }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    console.log('[initiatives] delete', { id, DATABASE_URL: process.env.DATABASE_URL });
    await this.prisma.$transaction(async (tx) => {
      await this.deleteInitiativeCascade(id, tx);
    });
    return { ok: true };
  }

  @Get(':id/checklist')
  async getChecklist(@Param('id') id: string) {
    const items = await this.prisma.checklistItem.findMany({ where: { initiativeId: id }, orderBy: { order: 'asc' } });
    return { items };
  }

  @Post(':id/checklist')
  async addChecklistItem(@Param('id') id: string, @Body() dto: CreateChecklistItemDto) {
    const rec = await this.prisma.checklistItem.create({ data: { initiativeId: id, title: dto.title, order: dto.order ?? 0, active: dto.active ?? true } });
    return rec;
  }

  @Put('checklist-items/:itemId')
  async updateChecklistItem(@Param('itemId') itemId: string, @Body() dto: UpdateChecklistItemDto) {
    const rec = await this.prisma.checklistItem.update({ where: { id: itemId }, data: { title: dto.title, order: dto.order, active: dto.active } });
    return rec;
  }

  @Delete('checklist-items/:itemId')
  async deleteChecklistItem(@Param('itemId') itemId: string) {
    await this.prisma.checklistItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  @Post('checklist-items/:itemId/ticks')
  async tick(@Param('itemId') itemId: string, @Body() dto: TickChecklistDto) {
    const rec = await this.prisma.checklistTick.create({
      data: {
        checklistItemId: itemId,
        actorId: dto.actorId,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
      },
    });
    return rec;
  }
}
