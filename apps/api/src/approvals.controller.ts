import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateApprovalDto {
  @IsString()
  @IsNotEmpty()
  subjectType!: string;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsString()
  @IsNotEmpty()
  approverId!: string;

  @IsString()
  @IsNotEmpty()
  requestedById!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ActApprovalDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

@Controller('approvals')
export class ApprovalsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateApprovalDto) {
    const req = await this.prisma.approvalRequest.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        approverId: dto.approverId,
        requestedById: dto.requestedById,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        activity: 'ApprovalRequested',
        userId: dto.requestedById,
        attrs: { approverId: dto.approverId },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: dto.approverId,
        type: 'ApprovalRequested',
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        payload: { requestId: req.id },
      },
    });
    return req;
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ActApprovalDto) {
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
    await this.prisma.event.create({
      data: {
        subjectType: updated.subjectType,
        subjectId: updated.subjectId,
        activity: 'ApprovalGranted',
        userId: dto.actorId,
        attrs: { requestId: id, comment: dto.comment },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: updated.requestedById,
        type: 'ApprovalGranted',
        subjectType: updated.subjectType,
        subjectId: updated.subjectId,
        payload: { requestId: id },
      },
    });
    return updated;
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: ActApprovalDto) {
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    await this.prisma.event.create({
      data: {
        subjectType: updated.subjectType,
        subjectId: updated.subjectId,
        activity: 'ApprovalRejected',
        userId: dto.actorId,
        attrs: { requestId: id, reason: dto.comment },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: updated.requestedById,
        type: 'ApprovalRejected',
        subjectType: updated.subjectType,
        subjectId: updated.subjectId,
        payload: { requestId: id, reason: dto.comment },
      },
    });
    return updated;
  }
}
