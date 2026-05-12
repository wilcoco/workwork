import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateLogisticsDispatchDto {
  @IsString()
  requesterId!: string;

  @IsOptional()
  approvalLine?: string[]; // ordered list of approver userIds; 홍규현 auto-prepended if not first

  @IsString()
  vehicleType!: string;

  @IsString()
  loadingPlace!: string;

  @IsString()
  loadingAt!: string; // ISO

  @IsString()
  loadingContact!: string;

  @IsString()
  loadingPhone!: string;

  @IsString()
  unloadingPlace!: string;

  @IsString()
  unloadingAt!: string; // ISO

  @IsString()
  unloadingContact!: string;

  @IsString()
  unloadingPhone!: string;

  @IsOptional()
  @IsString()
  cargoDetails?: string;
}

@Controller('logistics-dispatch')
export class LogisticsDispatchController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateLogisticsDispatchDto) {
    try {
      const loadingAt = new Date(dto.loadingAt);
      const unloadingAt = new Date(dto.unloadingAt);
      if (isNaN(loadingAt.getTime()) || isNaN(unloadingAt.getTime())) {
        throw new BadRequestException('유효하지 않은 일시입니다');
      }

      // 1차는 항상 홍규현, 이후 프론트에서 넘긴 순서대로
      const CAR_MANAGER_NAME = '홍규현';
      const carManager = await this.prisma.user.findFirst({ where: { name: CAR_MANAGER_NAME }, select: { id: true } });
      const carManagerId = carManager?.id;
      if (!carManagerId) throw new BadRequestException(`배차 담당자(${CAR_MANAGER_NAME})를 찾을 수 없습니다`);

      // 결재라인 구성: 홍규현이 1번째 없으면 앞에 추가
      const rawLine: string[] = (dto.approvalLine || []).filter(Boolean);
      const approvalLine = rawLine[0] === carManagerId ? rawLine : [carManagerId, ...rawLine];
      const firstApprover = approvalLine[0];

      const rec = await this.prisma.$transaction(async (tx) => {
        const dispatch = await (tx as any).logisticsDispatchRequest.create({
          data: {
            requesterId: dto.requesterId,
            approverId: firstApprover,
            vehicleType: dto.vehicleType,
            loadingPlace: dto.loadingPlace,
            loadingAt,
            loadingContact: dto.loadingContact,
            loadingPhone: dto.loadingPhone,
            unloadingPlace: dto.unloadingPlace,
            unloadingAt,
            unloadingContact: dto.unloadingContact,
            unloadingPhone: dto.unloadingPhone,
            cargoDetails: dto.cargoDetails,
          },
        });

        const approval = await tx.approvalRequest.create({
          data: {
            subjectType: 'LOGISTICS_DISPATCH',
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

        await tx.event.create({
          data: {
            subjectType: 'LOGISTICS_DISPATCH',
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
            subjectType: 'LOGISTICS_DISPATCH',
            subjectId: dispatch.id,
            payload: { requestId: approval.id, requestedById: dto.requesterId },
          },
        });

        return dispatch;
      });

      return rec;
    } catch (e: any) {
      console.error('Failed to create logistics dispatch', e);
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(e?.message || '물류 배차 신청에 실패했습니다');
    }
  }

  // 월별 캘린더 데이터 (loadingAt 기준)
  @Get('calendar')
  async calendar(@Query('month') month?: string) {
    const base = month ? new Date(month + '-01T00:00:00.000Z') : new Date();
    if (isNaN(base.getTime())) throw new BadRequestException('유효하지 않은 month');
    const year = base.getUTCFullYear();
    const mon = base.getUTCMonth();
    const start = new Date(Date.UTC(year, mon, 1));
    const end = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    const items = await (this.prisma as any).logisticsDispatchRequest.findMany({
      where: { loadingAt: { gte: start, lte: end } },
      orderBy: { loadingAt: 'asc' },
      include: { requester: true },
    });

    return {
      items: items.map((r: any) => ({
        id: r.id,
        loadingAt: r.loadingAt,
        unloadingAt: r.unloadingAt,
        loadingPlace: r.loadingPlace,
        unloadingPlace: r.unloadingPlace,
        vehicleType: r.vehicleType,
        requesterName: r.requester?.name ?? '',
        status: r.status,
      })),
    };
  }

  // 목록 조회
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (from || to) {
      where.loadingAt = {};
      if (from) where.loadingAt.gte = new Date(from);
      if (to) where.loadingAt.lte = new Date(to);
    }
    const items = await (this.prisma as any).logisticsDispatchRequest.findMany({
      where,
      orderBy: { loadingAt: 'desc' },
      take: 200,
      include: { requester: true, approver: true },
    });
    return {
      items: items.map((r: any) => ({
        id: r.id,
        requesterId: r.requesterId,
        requesterName: r.requester?.name ?? '',
        approverName: r.approver?.name ?? '',
        vehicleType: r.vehicleType,
        loadingPlace: r.loadingPlace,
        loadingAt: r.loadingAt,
        loadingContact: r.loadingContact,
        loadingPhone: r.loadingPhone,
        unloadingPlace: r.unloadingPlace,
        unloadingAt: r.unloadingAt,
        unloadingContact: r.unloadingContact,
        unloadingPhone: r.unloadingPhone,
        cargoDetails: r.cargoDetails,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const r = await (this.prisma as any).logisticsDispatchRequest.findUnique({
      where: { id },
      include: { requester: true, approver: true },
    });
    if (!r) throw new BadRequestException('not found');
    return {
      id: r.id,
      requesterId: r.requesterId,
      requesterName: r.requester?.name ?? '',
      approverId: r.approverId,
      approverName: r.approver?.name ?? '',
      vehicleType: r.vehicleType,
      loadingPlace: r.loadingPlace,
      loadingAt: r.loadingAt,
      loadingContact: r.loadingContact,
      loadingPhone: r.loadingPhone,
      unloadingPlace: r.unloadingPlace,
      unloadingAt: r.unloadingAt,
      unloadingContact: r.unloadingContact,
      unloadingPhone: r.unloadingPhone,
      cargoDetails: r.cargoDetails,
      status: r.status,
      createdAt: r.createdAt,
    };
  }
}
