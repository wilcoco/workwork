import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsDateString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateBusinessTripDto {
  @IsString() @IsNotEmpty() requesterId!: string;
  @IsString() @IsNotEmpty() approverId!: string;
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
    return this.prisma.businessTripRequest.create({
      data: {
        requesterId: dto.requesterId,
        approverId: dto.approverId,
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
