import { BadRequestException, Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
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
    if (!dto?.name || !dto.name.trim()) {
      throw new BadRequestException('차량 이름은 필수입니다');
    }
    try {
      const car = await this.prisma.car.create({
        data: {
          name: dto.name.trim(),
          type: dto.type,
          plateNo: dto.plateNo,
          active: dto.active ?? true,
        },
      });
      return car;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to create car', e);
      throw new BadRequestException(e?.message || '차량 등록에 실패했습니다');
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpsertCarDto) {
    if (!dto?.name || !dto.name.trim()) {
      throw new BadRequestException('차량 이름은 필수입니다');
    }
    try {
      const car = await this.prisma.car.update({
        where: { id },
        data: {
          name: dto.name.trim(),
          type: dto.type,
          plateNo: dto.plateNo,
          active: dto.active ?? true,
        },
      });
      return car;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to update car', e);
      throw new BadRequestException(e?.message || '차량 수정에 실패했습니다');
    }
  }
}
