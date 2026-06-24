import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from './prisma.service';
import { extractOdometerFromImage } from './llm/ai-client';

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

  @IsOptional()
  @IsString()
  dispatchType?: string; // CORPORATE | LOGISTICS

  @IsOptional()
  @IsString()
  cargoDetails?: string;
}

class CheckDto {
  @IsOptional()
  @IsString()
  actorId?: string; // 경비원 user id

  @IsOptional()
  @IsString()
  at?: string; // 경비원이 입력한 출/입차 시각 (ISO). 미지정 시 현재시각

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number; // 적산거리(km)
}

class RegisterUsageDto {
  @IsString()
  actorId!: string; // 운전자 user id

  @IsOptional()
  @IsInt()
  @Min(0)
  odometerBeforeOcr?: number; // 사용 전 인식 적산거리

  @IsOptional()
  @IsInt()
  @Min(0)
  odometerAfterOcr?: number; // 사용 후 인식 적산거리

  @IsOptional()
  @IsArray()
  statusPhotosBefore?: any[]; // [{ url, name }]

  @IsOptional()
  @IsArray()
  statusPhotosAfter?: any[];

  @IsOptional()
  @IsArray()
  odometerPhotosBefore?: any[];

  @IsOptional()
  @IsArray()
  odometerPhotosAfter?: any[];

  @IsOptional()
  @IsString()
  usageNote?: string;
}

class OcrOdometerDto {
  @IsOptional()
  @IsString()
  uploadId?: string;

  @IsOptional()
  @IsString()
  url?: string;
}

class GuardCreateDto {
  @IsString()
  carId!: string;

  @IsString()
  actorId!: string; // 등록하는 경비원 user id

  @IsOptional()
  @IsString()
  driverName?: string; // 운전자명(자유 입력)

  @IsString()
  destination!: string;

  @IsString()
  purpose!: string;

  @IsOptional()
  @IsString()
  coRiders?: string;

  @IsOptional()
  @IsString()
  startAt?: string; // ISO, 미지정 시 현재시각

  @IsOptional()
  @IsString()
  endAt?: string; // ISO, 미지정 시 startAt + 1h
}

class CoUseDto {
  @IsString() carId!: string;
  @IsString() requesterId!: string;
  @IsOptional() @IsString() approverId?: string;
  @IsOptional() @IsString() coRiders?: string;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
  @IsString() destination!: string;
  @IsString() purpose!: string;
  @IsString() conflictDispatchId!: string; // 선점 배차 id
  @IsOptional() @IsString() note?: string;  // 협의 메모 (남는 시간/교환 등)
}

class NegotiateDto {
  @IsString() actorId!: string; // 선점자(협의 상대)
}

@Controller('car-dispatch')
export class CarDispatchController {
  constructor(private prisma: PrismaService) {}

  // 배차 결재 라인 생성 (홍정수 1차 + 추가 결재자) — create/agree 공용
  private async createCarApproval(tx: any, dispatchId: string, requesterId: string, approverId?: string) {
    const CAR_MANAGER_EMAIL = 'json@cams2002.onmicrosoft.com';
    const carManager = await tx.user.findFirst({ where: { email: CAR_MANAGER_EMAIL }, select: { id: true } });
    const carManagerId = carManager?.id;
    if (!carManagerId) throw new BadRequestException('배차 담당자(홍정수)를 찾을 수 없습니다');
    const extra = approverId && approverId !== carManagerId ? approverId : null;
    const line = extra ? [carManagerId, extra] : [carManagerId];
    const approval = await tx.approvalRequest.create({
      data: { subjectType: 'CAR_DISPATCH', subjectId: dispatchId, approverId: carManagerId, requestedById: requesterId },
    });
    for (let i = 0; i < line.length; i++) {
      await tx.approvalStep.create({ data: { requestId: approval.id, stepNo: i + 1, approverId: line[i], status: 'PENDING' as any } });
    }
    await tx.event.create({
      data: { subjectType: 'CAR_DISPATCH', subjectId: dispatchId, activity: 'ApprovalRequested', userId: requesterId, attrs: { approverId: carManagerId, requestId: approval.id, steps: line.length, line } },
    });
    await tx.notification.create({
      data: { userId: carManagerId, type: 'ApprovalRequested', subjectType: 'CAR_DISPATCH', subjectId: dispatchId, payload: { requestId: approval.id, requestedById: requesterId } },
    });
  }

  // 협의(추가/교환) 배차 요청 — 선점 시간이 겹쳐도 선점자 동의를 전제로 등록
  @Post('co-use')
  async coUseRequest(@Body() dto: CoUseDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('유효하지 않은 일시입니다');
    }
    const conflict = await this.prisma.carDispatchRequest.findUnique({ where: { id: dto.conflictDispatchId } });
    if (!conflict) throw new BadRequestException('협의 대상 배차를 찾을 수 없습니다');
    const negotiatedWithId = (conflict as any).requesterId;
    if (negotiatedWithId === dto.requesterId) throw new BadRequestException('본인 선점 배차에는 협의 요청할 수 없습니다');

    const rec = await this.prisma.$transaction(async (tx) => {
      const dispatch = await tx.carDispatchRequest.create({
        data: {
          carId: dto.carId,
          requesterId: dto.requesterId,
          approverId: dto.requesterId, // 임시(동의 후 결재라인에서 갱신)
          coRiders: dto.coRiders,
          startAt, endAt,
          destination: dto.destination,
          purpose: dto.purpose,
          dispatchType: 'CORPORATE',
          status: 'PENDING' as any,
          coUse: true,
          negotiatedWithId,
          negotiationStatus: 'REQUESTED',
          negotiationNote: dto.note,
          conflictDispatchId: dto.conflictDispatchId,
        } as any,
      });
      // 선점자에게 협의 요청 알림
      await tx.notification.create({
        data: { userId: negotiatedWithId, type: 'CarCoUseRequested', subjectType: 'CAR_DISPATCH', subjectId: dispatch.id, payload: { requestedById: dto.requesterId, note: dto.note || '' } },
      });
      return dispatch;
    });
    return rec;
  }

  // 선점자가 협의 동의 → 정식 결재 라인 생성
  @Post(':id/agree')
  async agreeCoUse(@Param('id') id: string, @Body() dto: NegotiateDto) {
    const rec = await this.prisma.carDispatchRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('not found');
    if (!(rec as any).coUse || (rec as any).negotiationStatus !== 'REQUESTED') throw new BadRequestException('협의 대기중인 요청이 아닙니다');
    if ((rec as any).negotiatedWithId !== dto.actorId) throw new BadRequestException('선점자만 협의에 응답할 수 있습니다');

    // 선점자 동의 = 즉시 확정 (별도 결재 없이 진행)
    await this.prisma.$transaction(async (tx) => {
      await tx.carDispatchRequest.update({ where: { id }, data: { negotiationStatus: 'AGREED', status: 'APPROVED' as any } as any });
      await tx.event.create({
        data: { subjectType: 'CAR_DISPATCH', subjectId: id, activity: 'Approved', userId: dto.actorId, attrs: { coUseAgreed: true } },
      });
      await tx.notification.create({
        data: { userId: (rec as any).requesterId, type: 'CarCoUseAgreed', subjectType: 'CAR_DISPATCH', subjectId: id, payload: { agreedById: dto.actorId } },
      });
    });
    return this.toBoardItem(await this.withRel(id));
  }

  // 선점자가 협의 거절 → 요청 취소
  @Post(':id/decline')
  async declineCoUse(@Param('id') id: string, @Body() dto: NegotiateDto) {
    const rec = await this.prisma.carDispatchRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('not found');
    if ((rec as any).negotiatedWithId !== dto.actorId) throw new BadRequestException('선점자만 협의에 응답할 수 있습니다');
    await this.prisma.$transaction(async (tx) => {
      await tx.carDispatchRequest.update({ where: { id }, data: { negotiationStatus: 'DECLINED', status: 'CANCELLED' as any } as any });
      await tx.notification.create({
        data: { userId: (rec as any).requesterId, type: 'CarCoUseDeclined', subjectType: 'CAR_DISPATCH', subjectId: id, payload: { declinedById: dto.actorId } },
      });
    });
    return { ok: true };
  }

  // 내게 온 협의 요청(내가 선점자)
  @Get('co-use-inbox')
  async coUseInbox(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const items = await this.prisma.carDispatchRequest.findMany({
      where: { negotiatedWithId: userId, negotiationStatus: 'REQUESTED' } as any,
      orderBy: { createdAt: 'desc' },
      include: { car: true, requester: true },
      take: 50,
    });
    return { items: items.map((r) => this.coUseItem(r)) };
  }

  // 내가 보낸 협의 요청
  @Get('co-use-mine')
  async coUseMine(@Query('requesterId') requesterId?: string) {
    if (!requesterId) throw new BadRequestException('requesterId required');
    const items = await this.prisma.carDispatchRequest.findMany({
      where: { requesterId, coUse: true } as any,
      orderBy: { createdAt: 'desc' },
      include: { car: true },
      take: 50,
    });
    return { items: items.map((r) => this.coUseItem(r)) };
  }

  private coUseItem(r: any) {
    return {
      id: r.id,
      carName: r.car?.name ?? '',
      carPlateNo: r.car?.plateNo ?? '',
      requesterName: r.requester?.name ?? '',
      startAt: r.startAt, endAt: r.endAt,
      destination: r.destination, purpose: r.purpose,
      negotiationStatus: r.negotiationStatus,
      negotiationNote: r.negotiationNote || '',
      status: r.status,
    };
  }

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
        const owner = await this.prisma.user.findUnique({ where: { id: (conflict as any).requesterId }, select: { name: true } });
        // 선점자 정보를 함께 내려, 프론트에서 협의(추가/교환) 배차를 제안할 수 있게 함
        throw new BadRequestException({
          message: '이미 배차된 시간입니다',
          code: 'DISPATCH_CONFLICT',
          conflict: {
            id: (conflict as any).id,
            requesterId: (conflict as any).requesterId,
            requesterName: owner?.name || '',
            startAt: (conflict as any).startAt,
            endAt: (conflict as any).endAt,
          },
        });
      }

      // 배차 담당(홍정수)을 1차 결재자로 고정
      const CAR_MANAGER_EMAIL = 'json@cams2002.onmicrosoft.com';
      const carManager = await this.prisma.user.findFirst({ where: { email: CAR_MANAGER_EMAIL }, select: { id: true } });
      const carManagerId = carManager?.id;
      if (!carManagerId) throw new BadRequestException(`배차 담당자(홍정수)를 찾을 수 없습니다`);

      // 결재 라인: 1차=홍정수, 2차=프론트에서 넘긴 approverId (다를 경우)
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
            dispatchType: dto.dispatchType || 'CORPORATE',
            cargoDetails: dto.cargoDetails,
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

        // 신청자 = 결재자인 단계는 자동 승인 처리
        let allApproved = true;
        let firstPending: string | null = null;
        for (let i = 0; i < approvalLine.length; i++) {
          const isAuto = approvalLine[i] === dto.requesterId;
          await tx.approvalStep.create({
            data: { requestId: approval.id, stepNo: i + 1, approverId: approvalLine[i], status: (isAuto ? 'APPROVED' : 'PENDING') as any, actedAt: isAuto ? new Date() : null },
          });
          if (!isAuto) { allApproved = false; if (!firstPending) firstPending = approvalLine[i]; }
        }

        if (allApproved) {
          // 모든 결재자가 본인(신청자) → 즉시 승인 확정
          await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: 'APPROVED' as any } });
          await tx.carDispatchRequest.update({ where: { id: dispatch.id }, data: { status: 'APPROVED' as any } });
          await tx.event.create({
            data: { subjectType: 'CAR_DISPATCH', subjectId: dispatch.id, activity: 'Approved', userId: dto.requesterId, attrs: { auto: true, requestId: approval.id } },
          });
          (dispatch as any).status = 'APPROVED';
        } else {
          await tx.event.create({
            data: { subjectType: 'CAR_DISPATCH', subjectId: dispatch.id, activity: 'ApprovalRequested', userId: dto.requesterId, attrs: { approverId: firstPending, requestId: approval.id, steps: approvalLine.length, line: approvalLine } },
          });
          if (firstPending) {
            await tx.notification.create({
              data: { userId: firstPending, type: 'ApprovalRequested', subjectType: 'CAR_DISPATCH', subjectId: dispatch.id, payload: { requestId: approval.id, requestedById: dto.requesterId } },
            });
          }
        }

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

  // 물류 배차 리스트
  @Get('logistics')
  async logisticsList(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where: any = { dispatchType: 'LOGISTICS' };
    if (status) where.status = status;
    if (from || to) {
      where.startAt = {};
      if (from) where.startAt.gte = new Date(from);
      if (to) where.startAt.lte = new Date(to);
    }
    const items = await this.prisma.carDispatchRequest.findMany({
      where,
      orderBy: { startAt: 'desc' },
      take: 200,
      include: { car: true, requester: true, approver: true },
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        carId: r.carId,
        carName: (r as any).car?.name ?? '',
        requesterId: r.requesterId,
        requesterName: (r as any).requester?.name ?? '',
        approverId: r.approverId,
        approverName: (r as any).approver?.name ?? '',
        coRiders: r.coRiders,
        startAt: r.startAt,
        endAt: r.endAt,
        destination: r.destination,
        purpose: r.purpose,
        cargoDetails: (r as any).cargoDetails,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
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
        requesterId: r.requesterId,
        requesterName: r.requester?.name ?? '',
        destination: r.destination,
        purpose: r.purpose,
      })),
    };
  }

  // ── 차량 교환 요청 ──────────────────────────────
  @Post('swap')
  async swapRequest(@Body() dto: { fromDispatchId?: string; toDispatchId?: string; actorId?: string; note?: string }) {
    if (!dto.fromDispatchId || !dto.toDispatchId || !dto.actorId) throw new BadRequestException('필수 항목 누락');
    const from = await this.prisma.carDispatchRequest.findUnique({ where: { id: dto.fromDispatchId } });
    const to = await this.prisma.carDispatchRequest.findUnique({ where: { id: dto.toDispatchId } });
    if (!from || !to) throw new BadRequestException('배차를 찾을 수 없습니다');
    if ((from as any).requesterId !== dto.actorId) throw new BadRequestException('본인 배차에서만 교환을 요청할 수 있습니다');
    if ((to as any).requesterId === dto.actorId) throw new BadRequestException('상대 배차를 선택하세요');
    if ((from as any).carId === (to as any).carId) throw new BadRequestException('같은 차량은 교환할 수 없습니다');
    const req = await (this.prisma as any).carSwapRequest.create({
      data: { fromDispatchId: dto.fromDispatchId, toDispatchId: dto.toDispatchId, requestedById: dto.actorId, targetUserId: (to as any).requesterId, note: dto.note || null },
    });
    await this.prisma.notification.create({
      data: { userId: (to as any).requesterId, type: 'CarSwapRequested', subjectType: 'CAR_SWAP', subjectId: req.id, payload: { requestedById: dto.actorId, note: dto.note || '' } },
    });
    return req;
  }

  @Post('swap/:id/agree')
  async swapAgree(@Param('id') id: string, @Body() dto: { actorId?: string }) {
    const req = await (this.prisma as any).carSwapRequest.findUnique({ where: { id } });
    if (!req) throw new BadRequestException('not found');
    if (req.status !== 'REQUESTED') throw new BadRequestException('이미 처리된 요청입니다');
    if (req.targetUserId !== dto.actorId) throw new BadRequestException('상대방만 응답할 수 있습니다');
    const from = await this.prisma.carDispatchRequest.findUnique({ where: { id: req.fromDispatchId } });
    const to = await this.prisma.carDispatchRequest.findUnique({ where: { id: req.toDispatchId } });
    if (!from || !to) throw new BadRequestException('배차를 찾을 수 없습니다');
    await this.prisma.$transaction(async (tx) => {
      // 두 배차의 차량을 맞바꿈
      await tx.carDispatchRequest.update({ where: { id: from.id }, data: { carId: (to as any).carId } });
      await tx.carDispatchRequest.update({ where: { id: to.id }, data: { carId: (from as any).carId } });
      await (tx as any).carSwapRequest.update({ where: { id }, data: { status: 'AGREED' } });
      await tx.notification.create({
        data: { userId: req.requestedById, type: 'CarSwapAgreed', subjectType: 'CAR_SWAP', subjectId: id, payload: { agreedById: dto.actorId } },
      });
    });
    return { ok: true };
  }

  @Post('swap/:id/decline')
  async swapDecline(@Param('id') id: string, @Body() dto: { actorId?: string }) {
    const req = await (this.prisma as any).carSwapRequest.findUnique({ where: { id } });
    if (!req) throw new BadRequestException('not found');
    if (req.targetUserId !== dto.actorId) throw new BadRequestException('상대방만 응답할 수 있습니다');
    await (this.prisma as any).carSwapRequest.update({ where: { id }, data: { status: 'DECLINED' } });
    await this.prisma.notification.create({
      data: { userId: req.requestedById, type: 'CarSwapDeclined', subjectType: 'CAR_SWAP', subjectId: id, payload: { declinedById: dto.actorId } },
    });
    return { ok: true };
  }

  @Get('swap-inbox')
  async swapInbox(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const reqs = await (this.prisma as any).carSwapRequest.findMany({ where: { targetUserId: userId, status: 'REQUESTED' }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: await this.enrichSwaps(reqs) };
  }

  @Get('swap-mine')
  async swapMine(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const reqs = await (this.prisma as any).carSwapRequest.findMany({ where: { requestedById: userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: await this.enrichSwaps(reqs) };
  }

  private async enrichSwaps(reqs: any[]) {
    const ids = Array.from(new Set(reqs.flatMap((r) => [r.fromDispatchId, r.toDispatchId])));
    const ds = await this.prisma.carDispatchRequest.findMany({ where: { id: { in: ids } }, include: { car: true, requester: true } });
    const map: Record<string, any> = {};
    for (const d of ds) map[d.id] = d;
    const fmt = (d: any) => d ? { carName: d.car?.name ?? '', requesterName: d.requester?.name ?? '', startAt: d.startAt, endAt: d.endAt, destination: d.destination } : null;
    return reqs.map((r) => ({ id: r.id, status: r.status, note: r.note || '', from: fmt(map[r.fromDispatchId]), to: fmt(map[r.toDispatchId]) }));
  }

  // 경비실 입·출차 현황판: 특정 일자(KST)에 배차된 차량 + 아직 미입차(운행중) 차량
  @Get('guard-board')
  async guardBoard(@Query('date') date?: string) {
    const ymd = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : kstToday();
    const dayStart = new Date(`${ymd}T00:00:00+09:00`);
    const dayEnd = new Date(`${ymd}T23:59:59.999+09:00`);

    const items = await this.prisma.carDispatchRequest.findMany({
      where: {
        // 결재 전(PENDING)에도 경비실에서 입·출차 확인이 필요하므로 함께 노출
        status: { in: ['PENDING', 'APPROVED'] as any },
        OR: [
          // 해당 일자에 운행 일정이 걸쳐 있는 건
          { AND: [{ startAt: { lte: dayEnd } }, { endAt: { gte: dayStart } }] },
          // 출차했지만 아직 입차하지 않은 건 (날짜 무관, 운행중)
          { AND: [{ checkoutAt: { not: null } }, { checkinAt: null }] },
        ],
      },
      orderBy: { startAt: 'asc' },
      include: { car: true, requester: true },
      take: 300,
    });

    // 차량별 인증 기준 현재 누적거리(참고용) — 현재 카드에 표시
    const carIds = Array.from(new Set(items.map((r) => r.carId)));
    const lastMap: Record<string, { km: number; at: Date | null; source: string }> = {};
    await Promise.all(
      carIds.map(async (carId) => {
        const last = await this.lastOdometerForCar(carId);
        if (last) lastMap[carId] = last;
      }),
    );

    return {
      date: ymd,
      items: items.map((r) => ({
        ...this.toBoardItem(r),
        carLastOdometer: lastMap[r.carId]?.km ?? null,
        carLastOdometerAt: lastMap[r.carId]?.at ?? null,
        carLastOdometerSource: lastMap[r.carId]?.source ?? null,
      })),
    };
  }

  // 차량의 인증 기준 현재 누적거리(주행거리 참고용)
  @Get('last-odometer')
  async lastOdometer(@Query('carId') carId?: string, @Query('excludeId') excludeId?: string) {
    if (!carId) throw new BadRequestException('carId required');
    const last = await this.lastOdometerForCar(carId, excludeId);
    return { carId, odometer: last?.km ?? null, at: last?.at ?? null, source: last?.source ?? null };
  }

  // 차량별 인증 기준 현재 누적거리 현황(전체 활성 차량)
  @Get('car-odometers')
  async carOdometers() {
    const cars = await this.prisma.car.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const items = await Promise.all(
      cars.map(async (c) => {
        const v = await this.lastOdometerForCar(c.id);
        return {
          carId: c.id,
          carName: c.name,
          carType: c.type ?? '',
          carPlateNo: c.plateNo ?? '',
          odometer: v?.km ?? null,
          at: v?.at ?? null,
          source: v?.source ?? null,
        };
      }),
    );
    return { items };
  }

  // 경비실 긴급(직접) 배차 등록 — 결재 절차 없이 즉시 등록
  @Post('guard-create')
  async guardCreate(@Body() dto: GuardCreateDto) {
    const car = await this.prisma.car.findUnique({ where: { id: dto.carId } });
    if (!car) throw new BadRequestException('차량을 찾을 수 없습니다');
    const actor = await this.prisma.user.findUnique({ where: { id: dto.actorId } });
    if (!actor) throw new BadRequestException('등록자(경비) 계정을 찾을 수 없습니다');

    const startAt = parseAt(dto.startAt);
    let endAt = dto.endAt ? new Date(dto.endAt) : new Date(startAt.getTime() + 60 * 60 * 1000);
    if (isNaN(endAt.getTime()) || endAt <= startAt) endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

    const rec = await this.prisma.carDispatchRequest.create({
      data: {
        carId: dto.carId,
        requesterId: dto.actorId, // 등록 주체(경비)
        approverId: dto.actorId,
        driverName: dto.driverName?.trim() || null,
        guardCreated: true,
        coRiders: dto.coRiders,
        startAt,
        endAt,
        destination: dto.destination,
        purpose: dto.purpose,
        dispatchType: 'CORPORATE',
        status: 'APPROVED' as any, // 긴급 등록은 즉시 승인 상태
      },
      include: { car: true, requester: true },
    });
    return this.toBoardItem(rec);
  }

  // 차량별 "인증된" 현재 누적거리 헬퍼.
  // 인증 기준 = 경비 출/입차 확인(checkin/checkout + 적산거리) 또는 계기판 사진이 첨부된 운전자 등록(OCR).
  // 적산거리는 단조 증가하므로 인증된 값 중 가장 큰 값을 현재 누적거리로 본다.
  private async lastOdometerForCar(carId: string, excludeId?: string): Promise<{ km: number; at: Date | null; source: string } | null> {
    const recs = await this.prisma.carDispatchRequest.findMany({
      where: { carId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: {
        odometerEnd: true, odometerStart: true, odometerBeforeOcr: true, odometerAfterOcr: true,
        checkinAt: true, checkoutAt: true, usageRegisteredAt: true,
        odometerPhotosBefore: true, odometerPhotosAfter: true,
      } as any,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    type Cand = { km: number; at: Date | null; source: string };
    const cands: Cand[] = [];
    const arrLen = (v: any) => (Array.isArray(v) ? v.length : 0);
    for (const r of recs as any[]) {
      if (r.checkinAt && typeof r.odometerEnd === 'number') cands.push({ km: r.odometerEnd, at: r.checkinAt, source: '경비 입차확인' });
      if (r.checkoutAt && typeof r.odometerStart === 'number') cands.push({ km: r.odometerStart, at: r.checkoutAt, source: '경비 출차확인' });
      if (r.usageRegisteredAt && typeof r.odometerAfterOcr === 'number' && arrLen(r.odometerPhotosAfter) > 0)
        cands.push({ km: r.odometerAfterOcr, at: r.usageRegisteredAt, source: '사진 인증(사용후)' });
      if (r.usageRegisteredAt && typeof r.odometerBeforeOcr === 'number' && arrLen(r.odometerPhotosBefore) > 0)
        cands.push({ km: r.odometerBeforeOcr, at: r.usageRegisteredAt, source: '사진 인증(사용전)' });
    }
    if (cands.length === 0) return null;
    // 가장 큰 누적거리(=현재값), 동률이면 최신 시각
    cands.sort((a, b) => (b.km - a.km) || ((b.at?.getTime() || 0) - (a.at?.getTime() || 0)));
    return cands[0];
  }

  // 계기판 사진(업로드)에서 적산거리(km) OCR 추출
  @Post('ocr-odometer')
  async ocrOdometer(@Body() dto: OcrOdometerDto) {
    let uploadId = String(dto.uploadId || '').trim();
    if (!uploadId && dto.url) {
      // '/api/files/<id>' 형태의 URL에서 id 추출
      const m = String(dto.url).match(/files\/([^/?#]+)/);
      if (m) uploadId = decodeURIComponent(m[1]);
    }
    if (!uploadId) throw new BadRequestException('uploadId 또는 url이 필요합니다');

    const up = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!up) throw new BadRequestException('업로드 파일을 찾을 수 없습니다');
    const ct = String(up.contentType || '').toLowerCase();
    if (!ct.startsWith('image/')) throw new BadRequestException('이미지 파일만 분석할 수 있습니다');

    const base64 = Buffer.from(up.data as any).toString('base64');
    try {
      const result = await extractOdometerFromImage(base64, ct);
      return result;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('odometer OCR failed', e);
      throw new BadRequestException(e?.message || '적산거리 추출에 실패했습니다');
    }
  }

  // 출차 확인 (경비) — 출차 시각/적산거리 직접 입력
  @Post(':id/checkout')
  async checkout(@Param('id') id: string, @Body() dto: CheckDto) {
    const rec = await this.prisma.carDispatchRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('not found');
    const data: any = { checkoutAt: parseAt(dto.at), checkedOutById: dto.actorId || null };
    if (typeof dto.odometer === 'number') data.odometerStart = dto.odometer;
    // 복귀 적산거리가 이미 있으면 주행거리 재계산
    const odoStart = typeof dto.odometer === 'number' ? dto.odometer : (rec as any).odometerStart;
    const odoEnd = (rec as any).odometerEnd;
    if (typeof odoStart === 'number' && typeof odoEnd === 'number' && odoEnd >= odoStart) {
      data.distanceKm = odoEnd - odoStart;
    }
    const updated = await this.prisma.carDispatchRequest.update({ where: { id }, data });
    return this.toBoardItem(await this.withRel(updated.id));
  }

  // 입차 확인 (경비) — 입차 시각/적산거리 직접 입력, 주행거리 자동 계산
  @Post(':id/checkin')
  async checkin(@Param('id') id: string, @Body() dto: CheckDto) {
    const rec = await this.prisma.carDispatchRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('not found');
    const data: any = { checkinAt: parseAt(dto.at), checkedInById: dto.actorId || null };
    if (typeof dto.odometer === 'number') data.odometerEnd = dto.odometer;
    const odoStart = (rec as any).odometerStart;
    const odoEnd = typeof dto.odometer === 'number' ? dto.odometer : (rec as any).odometerEnd;
    if (typeof odoStart === 'number' && typeof odoEnd === 'number' && odoEnd >= odoStart) {
      data.distanceKm = odoEnd - odoStart;
    }
    const updated = await this.prisma.carDispatchRequest.update({ where: { id }, data });
    return this.toBoardItem(await this.withRel(updated.id));
  }

  // 차량 사용 전후 등록 (운전자) — 사용전/후 차량상태·계기판 사진 + 인식 적산거리
  @Post(':id/register-usage')
  async registerUsage(@Param('id') id: string, @Body() dto: RegisterUsageDto) {
    const rec = await this.prisma.carDispatchRequest.findUnique({ where: { id } });
    if (!rec) throw new BadRequestException('not found');

    const data: any = {
      usageRegisteredAt: new Date(),
      usageRegisteredById: dto.actorId,
    };
    if (Array.isArray(dto.statusPhotosBefore)) data.statusPhotosBefore = dto.statusPhotosBefore;
    if (Array.isArray(dto.statusPhotosAfter)) data.statusPhotosAfter = dto.statusPhotosAfter;
    if (Array.isArray(dto.odometerPhotosBefore)) data.odometerPhotosBefore = dto.odometerPhotosBefore;
    if (Array.isArray(dto.odometerPhotosAfter)) data.odometerPhotosAfter = dto.odometerPhotosAfter;
    if (typeof dto.odometerBeforeOcr === 'number') data.odometerBeforeOcr = dto.odometerBeforeOcr;
    if (typeof dto.odometerAfterOcr === 'number') data.odometerAfterOcr = dto.odometerAfterOcr;
    if (typeof dto.usageNote === 'string') data.usageNote = dto.usageNote;

    const updated = await this.prisma.carDispatchRequest.update({ where: { id }, data });
    return this.toBoardItem(await this.withRel(updated.id));
  }

  // 내가 신청한 배차 중 사용 후 등록 가능한 건(승인됨, 최근순)
  @Get('my-usage')
  async myUsage(@Query('requesterId') requesterId?: string) {
    if (!requesterId) throw new BadRequestException('requesterId required');
    const items = await this.prisma.carDispatchRequest.findMany({
      // 결재 전(PENDING)에도 사용 전후 등록이 가능하도록 함께 노출
      where: { requesterId, status: { in: ['PENDING', 'APPROVED'] as any } },
      orderBy: { startAt: 'desc' },
      include: { car: true, requester: true },
      take: 60,
    });
    return { items: items.map((r) => this.toBoardItem(r)) };
  }

  private async withRel(id: string) {
    return this.prisma.carDispatchRequest.findUnique({
      where: { id },
      include: { car: true, requester: true },
    }) as any;
  }

  private toBoardItem(r: any) {
    return {
      id: r.id,
      carId: r.carId,
      carName: r.car?.name ?? '',
      carPlateNo: r.car?.plateNo ?? '',
      requesterId: r.requesterId,
      requesterName: r.driverName || r.requester?.name || '', // 긴급 등록은 운전자명 우선
      guardCreated: !!r.guardCreated,
      coRiders: r.coRiders || '',
      startAt: r.startAt,
      endAt: r.endAt,
      destination: r.destination,
      purpose: r.purpose,
      status: r.status,
      checkoutAt: r.checkoutAt ?? null,
      checkinAt: r.checkinAt ?? null,
      odometerStart: r.odometerStart ?? null,
      odometerEnd: r.odometerEnd ?? null,
      distanceKm: r.distanceKm ?? null,
      // 운전자 사용 전후 등록 자료
      statusPhotosBefore: r.statusPhotosBefore ?? [],
      statusPhotosAfter: r.statusPhotosAfter ?? (r.statusPhotos ?? []), // 구 데이터 하위호환
      odometerPhotosBefore: r.odometerPhotosBefore ?? [],
      odometerPhotosAfter: r.odometerPhotosAfter ?? (r.odometerPhotos ?? []),
      odometerBeforeOcr: r.odometerBeforeOcr ?? null,
      odometerAfterOcr: r.odometerAfterOcr ?? null,
      usageNote: r.usageNote ?? '',
      usageRegisteredAt: r.usageRegisteredAt ?? null,
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
      checkoutAt: (rec as any).checkoutAt ?? null,
      checkinAt: (rec as any).checkinAt ?? null,
      odometerStart: (rec as any).odometerStart ?? null,
      odometerEnd: (rec as any).odometerEnd ?? null,
      distanceKm: (rec as any).distanceKm ?? null,
      statusPhotos: (rec as any).statusPhotos ?? [],
      odometerPhotos: (rec as any).odometerPhotos ?? [],
      usageNote: (rec as any).usageNote ?? '',
      usageRegisteredAt: (rec as any).usageRegisteredAt ?? null,
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

// 경비원이 입력한 시각(ISO) 파싱. 미지정/오류 시 현재시각
function parseAt(at?: string): Date {
  if (at) {
    const d = new Date(at);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

// 오늘 날짜(KST, YYYY-MM-DD)
function kstToday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
