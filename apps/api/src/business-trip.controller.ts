import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsDateString, IsArray } from 'class-validator';
import { PrismaService } from './prisma.service';

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

    return (this.prisma as any).$transaction(async (tx: any) => {
      const trip = await tx.businessTripRequest.create({
        data: {
          requesterId: dto.requesterId,
          approverId: firstApprover,
          approvalLine: approverLine,
          destination: dto.destination,
          purpose: dto.purpose,
          departureAt: new Date(dto.departureAt),
          returnAt: new Date(dto.returnAt),
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
