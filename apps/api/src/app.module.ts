import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
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
import { EntraAuthController } from './entra-auth.controller';
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
import { AttendanceController } from './attendance.controller';
import { HolidaysController } from './holidays.controller';
import { ProcessTemplatesController } from './process-templates.controller';
import { ProcessesController } from './processes.controller';
import { MastersController } from './masters.controller';
import { WorklogEvalsController } from './worklog-evals.controller';
import { TeamsNotificationService } from './teams-notification.service';
import { WorkManualsController } from './work-manuals.controller';
import { WeeklyReportsController } from './weekly-reports.controller';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { SchedulesController } from './schedules.controller';
import { PeriodicAlarmsController } from './periodic-alarms.controller';
import { MeetingMinutesController } from './meeting-minutes.controller';
import { GraphTasksController } from './graph-tasks.controller';
import { CompanyDataController } from './company-data.controller';
import { ProcessDeadlineService } from './process-deadline.service';
import { DataverseService } from './dataverse.service';

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
    WorkManualsController,
    WeeklyReportsController,
    AuthController,
    EntraAuthController,
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
    AttendanceController,
    HolidaysController,
    ProcessTemplatesController,
    ProcessesController,
    MastersController,
    WorklogEvalsController,
    KnowledgeBaseController,
    SchedulesController,
    PeriodicAlarmsController,
    MeetingMinutesController,
    GraphTasksController,
    CompanyDataController,
  ],
  providers: [
    PrismaService,
    TeamsNotificationService,
    ProcessDeadlineService,
    DataverseService,
    Reflector,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
