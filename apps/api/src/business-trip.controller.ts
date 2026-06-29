import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsDateString, IsArray } from 'class-validator';
import { PrismaService } from './prisma.service';

function parseKST(datetimeLocal: string): Date {
  // datetime-local 값("2026-05-20T09:00")을 KST로 파싱
  return new Date(datetimeLocal + ':00+09:00');
}

class CreateBusinessTripDto {
  @IsString() @IsNotEmpty() requesterId!: string;
  /** Legacy single approverId — kept for compat. Ignored when approverIds[] is set. */
  @IsOptional() @IsString() approverId?: string;
  /** Ordered multi-step approval line */
  @IsOptional() @IsArray() @IsString({ each: true }) approverIds?: string[];
  @IsString() @IsNotEmpty() destination!: string;
  @IsString() @IsNotEmpty() purpose!: string;
  @IsDateString() departureAt!: string;
  @IsDateString() returnAt!: string;
  @IsOptional() @IsString() transportation?: string;
  @IsOptional() @IsString() carId?: string; // required when transportation === '회사 차량'
  @IsOptional() @IsBoolean() accommodation?: boolean;
  @IsOptional() @IsString() notes?: string;
}

class UpdateBusinessTripDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() notes?: string;
}

@Controller('business-trips')
export class BusinessTripController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query() q: { requesterId?: string; approverId?: string; status?: string }) {
    const where: any = {};
    if (q.requesterId) where.requesterId = q.requesterId;
    if (q.approverId) where.approverId = q.approverId;
    if (q.status) where.status = q.status;
    const items = await this.prisma.businessTripRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    return { items };
  }

  // 출장 현황 캘린더: 해당 월에 걸치는 출장 신청 + (출장 목적의) 배차를 통합해 반환
  @Get('calendar')
  async calendar(@Query('month') month?: string) {
    const base = month ? new Date(month + '-01T00:00:00.000Z') : new Date();
    if (isNaN(base.getTime())) throw new BadRequestException('유효하지 않은 month');
    const year = base.getUTCFullYear();
    const mon = base.getUTCMonth();
    const start = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    // 1) 출장 신청 (해당 월에 일정이 걸쳐 있는 건)
    const trips = await this.prisma.businessTripRequest.findMany({
      where: { departureAt: { lte: end }, returnAt: { gte: start } },
      orderBy: { departureAt: 'asc' },
      include: { requester: { select: { id: true, name: true } } },
    });

    // 2) 출장 목적의 배차 (purpose에 '출장' 포함 — 출장 신청 시 자동 생성된 [출장] 건 포함)
    const dispatches = await this.prisma.carDispatchRequest.findMany({
      where: {
        startAt: { lte: end },
        endAt: { gte: start },
        purpose: { contains: '출장' },
      },
      orderBy: { startAt: 'asc' },
      include: {
        car: { select: { name: true, type: true } },
        requester: { select: { id: true, name: true } },
      },
    });

    // 출장 신청 ↔ 자동 생성 배차를 (신청자 + 출발시각 + 목적지)로 매칭해 중복 제거
    const dispatchByKey: Record<string, any> = {};
    for (const d of dispatches) {
      const key = `${(d as any).requesterId}|${new Date(d.startAt).toISOString()}|${d.destination ?? ''}`;
      if (!dispatchByKey[key]) dispatchByKey[key] = d;
    }
    const consumed = new Set<string>();
    const items: any[] = [];

    for (const t of trips) {
      const key = `${t.requesterId}|${new Date(t.departureAt).toISOString()}|${t.destination ?? ''}`;
      const d = dispatchByKey[key];
      if (d) consumed.add(d.id);
      items.push({
        id: t.id,
        source: 'TRIP',
        requesterId: t.requesterId,
        requesterName: (t as any).requester?.name ?? '',
        destination: t.destination,
        purpose: t.purpose,
        startAt: t.departureAt,
        endAt: t.returnAt,
        status: t.status,
        transportation: (t as any).transportation ?? '',
        carName: d?.car?.name ?? '',
        carType: d?.car?.type ?? '',
      });
    }

    // 출장 신청과 매칭되지 않은 '출장' 배차 (예: 법인차량 신청에서 목적에 출장이라 적은 건)
    for (const d of dispatches) {
      if (consumed.has(d.id)) continue;
      items.push({
        id: d.id,
        source: 'DISPATCH',
        requesterId: (d as any).requesterId,
        requesterName: (d as any).requester?.name ?? '',
        destination: d.destination,
        purpose: d.purpose,
        startAt: d.startAt,
        endAt: d.endAt,
        status: d.status,
        transportation: '회사 차량',
        carName: (d as any).car?.name ?? '',
        carType: (d as any).car?.type ?? '',
      });
    }

    items.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const item = await this.prisma.businessTripRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    if (!item) throw new BadRequestException('Not found');
    return item;
  }

  @Post()
  async create(@Body() dto: CreateBusinessTripDto) {
    // Resolve ordered approval line (same pattern as attendance)
    const lineRaw = Array.isArray(dto.approverIds)
      ? dto.approverIds.map((s) => String(s || '').trim()).filter(Boolean)
      : dto.approverId ? [dto.approverId] : [];
    const approverLine: string[] = [];
    for (const id of lineRaw) {
      if (approverLine[approverLine.length - 1] !== id) approverLine.push(id);
    }
    const firstApprover = approverLine[0];
    if (!firstApprover) throw new BadRequestException('결재선에 최소 한 명의 결재자가 필요합니다');

    // 회사 차량 선택 시 사전 중복 체크 (트랜잭션 밖에서 빠르게 확인)
    const isCompanyCar = dto.transportation === '회사 차량';
    if (isCompanyCar) {
      if (!dto.carId) throw new BadRequestException('회사 차량 선택 시 차량을 지정해야 합니다');
      const depAt = parseKST(dto.departureAt);
      const retAt = parseKST(dto.returnAt);
      const conflict = await this.prisma.carDispatchRequest.findFirst({
        where: {
          carId: dto.carId,
          status: { in: ['PENDING', 'APPROVED'] as any },
          NOT: { OR: [{ endAt: { lte: depAt } }, { startAt: { gte: retAt } }] },
        },
        include: { car: { select: { name: true } } },
      });
      if (conflict) {
        const car = (conflict as any).car?.name || '해당 차량';
        throw new BadRequestException(`${car}은(는) 해당 시간에 이미 배차된 차량입니다`);
      }
    }

    return (this.prisma as any).$transaction(async (tx: any) => {
      const trip = await tx.businessTripRequest.create({
        data: {
          requesterId: dto.requesterId,
          approverId: firstApprover,
          approvalLine: approverLine,
          destination: dto.destination,
          purpose: dto.purpose,
          departureAt: parseKST(dto.departureAt),
          returnAt: parseKST(dto.returnAt),
          transportation: dto.transportation,
          accommodation: dto.accommodation ?? false,
          notes: dto.notes,
          status: 'PENDING',
        },
        include: {
          requester: { select: { id: true, name: true } },
          approver: { select: { id: true, name: true } },
        },
      });

      const approval = await tx.approvalRequest.create({
        data: {
          subjectType: 'BUSINESS_TRIP',
          subjectId: trip.id,
          approverId: firstApprover,
          requestedById: dto.requesterId,
        },
      });

      for (let i = 0; i < approverLine.length; i++) {
        await tx.approvalStep.create({
          data: { requestId: approval.id, stepNo: i + 1, approverId: approverLine[i], status: 'PENDING' as any },
        });
      }

      await tx.event.create({
        data: {
          subjectType: 'BUSINESS_TRIP',
          subjectId: trip.id,
          activity: 'ApprovalRequested',
          userId: dto.requesterId,
          attrs: { approverId: firstApprover, requestId: approval.id, steps: approverLine.length, line: approverLine },
        },
      });

      await tx.notification.create({
        data: {
          userId: firstApprover,
          type: 'ApprovalRequested',
          subjectType: 'BUSINESS_TRIP',
          subjectId: trip.id,
          payload: { requestId: approval.id, subjectType: 'BUSINESS_TRIP', requestedById: dto.requesterId },
        },
      });

      // 회사 차량이면 CarDispatchRequest 자동 생성 (선점)
      if (isCompanyCar && dto.carId) {
        await tx.carDispatchRequest.create({
          data: {
            carId: dto.carId,
            requesterId: dto.requesterId,
            approverId: firstApprover,
            startAt: parseKST(dto.departureAt),
            endAt: parseKST(dto.returnAt),
            destination: dto.destination,
            purpose: `[출장] ${dto.purpose}`,
          },
        });
      }

      return trip;
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateBusinessTripDto) {
    return this.prisma.businessTripRequest.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }
}
