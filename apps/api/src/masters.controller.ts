import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('masters')
export class MastersController {
  constructor(private prisma: PrismaService) {}

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
}
