import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateHelpTicketDto {
  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsOptional()
  @IsString()
  queue?: string;

  @IsString()
  @IsNotEmpty()
  requesterId!: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaMinutes?: number;
}

class ActDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('help-tickets')
export class HelpTicketsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateHelpTicketDto) {
    const ticket = await this.prisma.helpTicket.create({
      data: {
        category: dto.category,
        queue: dto.queue,
        requesterId: dto.requesterId,
        assigneeId: dto.assigneeId,
        slaMinutes: dto.slaMinutes,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpRequested',
        userId: dto.requesterId,
        attrs: { assigneeId: dto.assigneeId, category: dto.category },
      },
    });
    if (dto.assigneeId) {
      await this.prisma.notification.create({
        data: {
          userId: dto.assigneeId,
          type: 'HelpRequested',
          subjectType: 'HelpTicket',
          subjectId: ticket.id,
          payload: { ticketId: ticket.id },
        },
      });
    }
    return ticket;
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        assigneeId: dto.actorId,
      },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpAccepted',
        userId: dto.actorId,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: ticket.requesterId,
        type: 'HelpAccepted',
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        payload: { ticketId: ticket.id },
      },
    });
    return ticket;
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpStarted',
        userId: dto.actorId,
      },
    });
    return ticket;
  }

  @Post(':id/decline')
  async decline(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpDeclined',
        userId: dto.actorId,
        attrs: { reason: dto.reason },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: ticket.requesterId,
        type: 'HelpDeclined',
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        payload: { reason: dto.reason },
      },
    });
    return ticket;
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ActDto) {
    const ticket = await this.prisma.helpTicket.update({
      where: { id },
      data: { status: 'DONE', resolvedAt: new Date() },
    });
    await this.prisma.event.create({
      data: {
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        activity: 'HelpResolved',
        userId: dto.actorId,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: ticket.requesterId,
        type: 'HelpResolved',
        subjectType: 'HelpTicket',
        subjectId: ticket.id,
        payload: { ticketId: ticket.id },
      },
    });
    return ticket;
  }
}
