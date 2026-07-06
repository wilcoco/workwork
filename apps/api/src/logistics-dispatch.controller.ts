import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateLogisticsDispatchDto {
  @IsString()
  requesterId!: string;

  @IsOptional()
  approvalLine?: string[]; // ordered list of approver userIds; 윤대룡(물류배차 담당) auto-prepended if not first

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

      // 1차는 물류배차 담당 any-of 그룹(윤대룡·김부영 둘 다 결재자, 둘 중 하나만 승인하면 진행).
      // 이후 프론트에서 넘긴 추가 결재자는 순차 단계로.
      const PRIMARY_NAMES = ['윤대룡', '김부영'];
      const primaries = await this.prisma.user.findMany({ where: { name: { in: PRIMARY_NAMES }, status: 'ACTIVE' as any }, select: { id: true, name: true } });
      const primaryIds = PRIMARY_NAMES.map((n) => primaries.find((p) => p.name === n)?.id).filter((x): x is string => !!x);
      if (primaryIds.length === 0) throw new BadRequestException('물류배차 담당자(윤대룡/김부영)를 찾을 수 없습니다');
      const carManagerId = primaryIds[0];

      // 추가 결재자: 1차 그룹에 없는 사람만 stepNo 2 이후로
      const rawLine: string[] = (dto.approvalLine || []).filter(Boolean).filter((id) => !primaryIds.includes(id));
      const firstApprover = carManagerId;

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

        // 1차 그룹: 모두 stepNo 1 (any-of). 추가 결재자: stepNo 2 이후 순차.
        for (const pid of primaryIds) {
          await tx.approvalStep.create({ data: { requestId: approval.id, stepNo: 1, approverId: pid, status: 'PENDING' as any } });
        }
        for (let j = 0; j < rawLine.length; j++) {
          await tx.approvalStep.create({ data: { requestId: approval.id, stepNo: 2 + j, approverId: rawLine[j], status: 'PENDING' as any } });
        }

        await tx.event.create({
          data: {
            subjectType: 'LOGISTICS_DISPATCH',
            subjectId: dispatch.id,
            activity: 'ApprovalRequested',
            userId: dto.requesterId,
            attrs: { approverId: firstApprover, requestId: approval.id, anyOfStage1: primaryIds, line: [...primaryIds, ...rawLine] },
          },
        });

        // 1차 그룹 전원에게 결재 요청 알림 (둘 중 하나가 처리하면 됨)
        for (const pid of primaryIds) {
          await tx.notification.create({
            data: { userId: pid, type: 'ApprovalRequested', subjectType: 'LOGISTICS_DISPATCH', subjectId: dispatch.id, payload: { requestId: approval.id, requestedById: dto.requesterId } },
          });
        }

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
