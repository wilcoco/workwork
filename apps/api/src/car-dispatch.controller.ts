import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

class CreateCarDispatchDto {
  carId!: string;
  requesterId!: string;
  approverId!: string;
  coRiders?: string;
  startAt!: string; // ISO
  endAt!: string;   // ISO
  destination!: string;
  purpose!: string;
}

@Controller('car-dispatch')
export class CarDispatchController {
  constructor(private prisma: PrismaService) {}

  // 신규 배차 신청 (선점 체크 포함)
  @Post()
  async create(@Body() dto: CreateCarDispatchDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (!(startAt instanceof Date) || isNaN(startAt.getTime()) || !(endAt instanceof Date) || isNaN(endAt.getTime())) {
      throw new BadRequestException('유효하지 않은 일시입니다');
    }
    if (endAt <= startAt) {
      throw new BadRequestException('종료 시간이 시작 시간보다 같거나 이를 수 없습니다');
    }

    // 동일 차량, 겹치는 시간대 PENDING/APPROVED 있으면 차단
    const conflict = await this.prisma.carDispatchRequest.findFirst({
      where: {
        carId: dto.carId,
        status: { in: ['PENDING', 'APPROVED'] as any },
        NOT: {
          OR: [
            { endAt: { lte: startAt } },
            { startAt: { gte: endAt } },
          ],
        },
      },
    });
    if (conflict) {
      throw new BadRequestException('이미 배차된 시간입니다');
    }

    const rec = await this.prisma.carDispatchRequest.create({
      data: {
        carId: dto.carId,
        requesterId: dto.requesterId,
        approverId: dto.approverId,
        coRiders: dto.coRiders,
        startAt,
        endAt,
        destination: dto.destination,
        purpose: dto.purpose,
      },
      include: { car: true },
    });
    return rec;
  }

  // 월별 전체 배차 캘린더 (모든 차량)
  @Get('calendar')
  async calendar(@Query('month') month?: string) {
    const base = month ? new Date(month + '-01T00:00:00.000Z') : new Date();
    if (isNaN(base.getTime())) throw new BadRequestException('유효하지 않은 month');
    const year = base.getUTCFullYear();
    const mon = base.getUTCMonth();
    const start = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    const items = await this.prisma.carDispatchRequest.findMany({
      where: {
        startAt: { lte: end },
        endAt: { gte: start },
      },
      orderBy: { startAt: 'asc' },
      include: { car: true, requester: true },
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        carId: r.carId,
        carName: r.car?.name ?? '',
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.status,
        requesterName: r.requester?.name ?? '',
        destination: r.destination,
        purpose: r.purpose,
      })),
    };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    const rec = await this.prisma.carDispatchRequest.update({
      where: { id },
      data: { status: 'APPROVED' as any },
    });
    return rec;
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string) {
    const rec = await this.prisma.carDispatchRequest.update({
      where: { id },
      data: { status: 'REJECTED' as any },
    });
    return rec;
  }
}
