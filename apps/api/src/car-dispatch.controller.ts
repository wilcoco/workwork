import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateCarDispatchDto {
  @IsString()
  carId!: string;

  @IsString()
  requesterId!: string;

  @IsOptional()
  @IsString()
  approverId!: string;

  @IsOptional()
  @IsString()
  coRiders?: string;

  @IsString()
  startAt!: string; // ISO

  @IsString()
  endAt!: string;   // ISO

  @IsString()
  destination!: string;

  @IsString()
  purpose!: string;
}

@Controller('car-dispatch')
export class CarDispatchController {
  constructor(private prisma: PrismaService) {}

  // 신규 배차 신청 (선점 체크 포함)
  @Post()
  async create(@Body() dto: CreateCarDispatchDto) {
    try {
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

      // 배차 담당(홍규현)을 1차 결재자로 고정
      const CAR_MANAGER_NAME = '홍규현';
      const carManager = await this.prisma.user.findFirst({ where: { name: CAR_MANAGER_NAME }, select: { id: true } });
      const carManagerId = carManager?.id;
      if (!carManagerId) throw new BadRequestException(`배차 담당자(${CAR_MANAGER_NAME})를 찾을 수 없습니다`);

      // 결재 라인: 1차=홍규현, 2차=프론트에서 넘긴 approverId (다를 경우)
      const extraApprover = dto.approverId && dto.approverId !== carManagerId ? dto.approverId : null;
      const approvalLine = extraApprover ? [carManagerId, extraApprover] : [carManagerId];
      const firstApprover = carManagerId;

      const rec = await this.prisma.$transaction(async (tx) => {
        // 1) 배차 요청 생성
        const dispatch = await tx.carDispatchRequest.create({
          data: {
            carId: dto.carId,
            requesterId: dto.requesterId,
            approverId: firstApprover,
            coRiders: dto.coRiders,
            startAt,
            endAt,
            destination: dto.destination,
            purpose: dto.purpose,
          },
          include: { car: true },
        });

        // 2) 결재 요청 생성
        const approval = await tx.approvalRequest.create({
          data: {
            subjectType: 'CAR_DISPATCH',
            subjectId: dispatch.id,
            approverId: firstApprover,
            requestedById: dto.requesterId,
          },
        });

        for (let i = 0; i < approvalLine.length; i++) {
          await tx.approvalStep.create({
            data: { requestId: approval.id, stepNo: i + 1, approverId: approvalLine[i], status: 'PENDING' as any },
          });
        }

        // 3) 이벤트 & 알림
        await tx.event.create({
          data: {
            subjectType: 'CAR_DISPATCH',
            subjectId: dispatch.id,
            activity: 'ApprovalRequested',
            userId: dto.requesterId,
            attrs: { approverId: firstApprover, requestId: approval.id, steps: approvalLine.length, line: approvalLine },
          },
        });
        await tx.notification.create({
          data: {
            userId: firstApprover,
            type: 'ApprovalRequested',
            subjectType: 'CAR_DISPATCH',
            subjectId: dispatch.id,
            payload: { requestId: approval.id, requestedById: dto.requesterId },
          },
        });

        return dispatch;
      });

      return rec;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to create car dispatch', e);
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(e?.message || '배차 신청에 실패했습니다');
    }
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

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const rec = await this.prisma.carDispatchRequest.findUnique({
      where: { id },
      include: { car: true, requester: true, approver: true },
    });
    if (!rec) throw new BadRequestException('not found');
    return {
      id: rec.id,
      carId: rec.carId,
      carName: rec.car?.name ?? '',
      requesterId: rec.requesterId,
      requesterName: rec.requester?.name ?? '',
      approverId: rec.approverId,
      approverName: rec.approver?.name ?? '',
      coRiders: rec.coRiders || '',
      startAt: rec.startAt,
      endAt: rec.endAt,
      destination: rec.destination,
      purpose: rec.purpose,
      status: rec.status,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
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
