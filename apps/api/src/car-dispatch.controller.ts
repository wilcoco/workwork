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
        requesterName: r.requester?.name ?? '',
        destination: r.destination,
        purpose: r.purpose,
      })),
    };
  }

  // 경비실 입·출차 현황판: 특정 일자(KST)에 배차된 차량 + 아직 미입차(운행중) 차량
  @Get('guard-board')
  async guardBoard(@Query('date') date?: string) {
    const ymd = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : kstToday();
    const dayStart = new Date(`${ymd}T00:00:00+09:00`);
    const dayEnd = new Date(`${ymd}T23:59:59.999+09:00`);

    const items = await this.prisma.carDispatchRequest.findMany({
      where: {
        status: 'APPROVED' as any,
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

    return {
      date: ymd,
      items: items.map((r) => this.toBoardItem(r)),
    };
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
      where: { requesterId, status: 'APPROVED' as any },
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
      requesterName: r.requester?.name ?? '',
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
