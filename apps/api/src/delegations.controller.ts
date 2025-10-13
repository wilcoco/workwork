import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateDelegationDto {
  @IsString()
  @IsNotEmpty()
  parentType!: string; // e.g., Objective/KeyResult/Initiative

  @IsString()
  @IsNotEmpty()
  parentId!: string;

  @IsString()
  @IsNotEmpty()
  childInitiativeId!: string; // pre-created child initiative id

  @IsString()
  @IsNotEmpty()
  delegatorId!: string;

  @IsString()
  @IsNotEmpty()
  delegateeId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ActDelegationDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('delegations')
export class DelegationsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateDelegationDto) {
    const delegation = await this.prisma.delegation.create({
      data: {
        parentType: dto.parentType,
        parentId: dto.parentId,
        childInitiativeId: dto.childInitiativeId,
        delegatorId: dto.delegatorId,
        delegateeId: dto.delegateeId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: dto.parentType,
        subjectId: dto.parentId,
        activity: 'Delegated',
        userId: dto.delegatorId,
        attrs: { delegationId: delegation.id, childInitiativeId: dto.childInitiativeId, delegateeId: dto.delegateeId },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: dto.delegateeId,
        type: 'Delegated',
        subjectType: 'Delegation',
        subjectId: delegation.id,
        payload: { delegationId: delegation.id },
      },
    });
    return delegation;
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Body() dto: ActDelegationDto) {
    const updated = await this.prisma.delegation.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    await this.prisma.event.create({
      data: {
        subjectType: 'Delegation',
        subjectId: id,
        activity: 'DelegationAccepted',
        userId: dto.actorId,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: updated.delegatorId,
        type: 'DelegationAccepted',
        subjectType: 'Delegation',
        subjectId: id,
      },
    });
    return updated;
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: ActDelegationDto) {
    const updated = await this.prisma.delegation.update({ where: { id }, data: { status: 'REJECTED', rejectedAt: new Date() } });
    await this.prisma.event.create({
      data: {
        subjectType: 'Delegation',
        subjectId: id,
        activity: 'DelegationRejected',
        userId: dto.actorId,
        attrs: { reason: dto.reason },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: updated.delegatorId,
        type: 'DelegationRejected',
        subjectType: 'Delegation',
        subjectId: id,
        payload: { reason: dto.reason },
      },
    });
    return updated;
  }
}
