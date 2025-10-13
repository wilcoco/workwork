import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { ApprovalsController } from './approvals.controller';
import { HelpTicketsController } from './help-tickets.controller';
import { DelegationsController } from './delegations.controller';
import { NotificationsController } from './notifications.controller';
import { SharesController } from './shares.controller';
import { FeedbacksController } from './feedbacks.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    HealthController,
    ApprovalsController,
    HelpTicketsController,
    DelegationsController,
    NotificationsController,
    SharesController,
    FeedbacksController,
  ],
  providers: [PrismaService],
})
export class AppModule {}
