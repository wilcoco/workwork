import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { PrismaService } from './prisma.service';

class UpsertCarDto {
  name!: string;
  type?: string;
  plateNo?: string;
  active?: boolean;
}

@Controller('cars')
export class CarsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list() {
    const items = await this.prisma.car.findMany({ orderBy: { name: 'asc' } });
    return { items };
  }

  @Post()
  async create(@Body() dto: UpsertCarDto) {
    const car = await this.prisma.car.create({
      data: {
        name: dto.name,
        type: dto.type,
        plateNo: dto.plateNo,
        active: dto.active ?? true,
      },
    });
    return car;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpsertCarDto) {
    const car = await this.prisma.car.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        plateNo: dto.plateNo,
        active: dto.active ?? true,
      },
    });
    return car;
  }
}
