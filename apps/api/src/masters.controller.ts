import { Controller, Get, Post, Delete, Query, Param, Body } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('masters')
export class MastersController {
  constructor(private prisma: PrismaService) {}

  // Generic CRUD helpers
  private getModel(type: string) {
    const models: Record<string, any> = {
      items: this.prisma.item,
      molds: this.prisma.mold,
      'car-models': this.prisma.carModel,
      suppliers: (this.prisma as any).supplier,
      equipments: (this.prisma as any).equipment,
    };
    return models[type];
  }

  @Post(':type')
  async create(@Param('type') type: string, @Body() body: { code: string; name: string }) {
    const model = this.getModel(type);
    if (!model) throw new Error('Invalid type');
    const item = await model.create({ data: { code: body.code, name: body.name } });
    return item;
  }

  @Delete(':type/:id')
  async remove(@Param('type') type: string, @Param('id') id: string) {
    const model = this.getModel(type);
    if (!model) throw new Error('Invalid type');
    await model.delete({ where: { id } });
    return { ok: true };
  }

  @Get('items')
  async items(@Query('q') q?: string) {
    const where: any = {};
    if (q) where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const items = await this.prisma.item.findMany({ where, orderBy: { code: 'asc' }, take: 200 });
    return { items };
  }

  @Get('molds')
  async molds(@Query('q') q?: string) {
    const where: any = {};
    if (q) where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const items = await this.prisma.mold.findMany({ where, orderBy: { code: 'asc' }, take: 200 });
    return { items };
  }

  @Get('car-models')
  async carModels(@Query('q') q?: string) {
    const where: any = {};
    if (q) where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const items = await this.prisma.carModel.findMany({ where, orderBy: { code: 'asc' }, take: 200 });
    return { items };
  }

  @Get('suppliers')
  async suppliers(@Query('q') q?: string) {
    const where: any = {};
    if (q) where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const items = await this.prisma.supplier.findMany({ where, orderBy: { code: 'asc' }, take: 200 });
    return { items };
  }

  @Get('equipments')
  async equipments(@Query('q') q?: string) {
    const where: any = {};
    if (q) where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const items = await this.prisma.equipment.findMany({ where, orderBy: { code: 'asc' }, take: 200 });
    return { items };
  }
}
