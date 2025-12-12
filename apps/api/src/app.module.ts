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
import { WorklogsController } from './worklogs.controller';
import { AuthController } from './auth.controller';
import { UploadsController } from './uploads.controller';
import { InitiativesController } from './initiatives.controller';
import { MyGoalsController } from './my-goals.controller';
import { OkrsController } from './okrs.controller';
import { UsersController } from './users.controller';
import { OrgsController } from './orgs.controller';
import { BrandController } from './brand.controller';
import { AdminController } from './admin.controller';
import { ProgressController } from './progress.controller';
import { CarsController } from './cars.controller';
import { CarDispatchController } from './car-dispatch.controller';

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
    WorklogsController,
    AuthController,
    UploadsController,
    InitiativesController,
    MyGoalsController,
    OkrsController,
    UsersController,
    OrgsController,
    BrandController,
    AdminController,
    ProgressController,
    CarsController,
    CarDispatchController,
  ],
  providers: [PrismaService],
})
export class AppModule {}
