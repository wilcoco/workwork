import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * F3: Process Deadline Alert Service
 * Runs every 15 minutes to send pending deadline alerts as notifications.
 */
@Injectable()
export class ProcessDeadlineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessDeadlineService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.processAlerts(), this.INTERVAL_MS);
    this.logger.log(`Deadline alert service started (interval: ${this.INTERVAL_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processAlerts(): Promise<number> {
    try {
      const now = new Date();
      const pendingAlerts = await this.prisma.processDeadlineAlert.findMany({
        where: {
          sentAt: null,
          scheduledAt: { lte: now },
        },
        include: {
          taskInstance: {
            select: {
              id: true,
              name: true,
              status: true,
              instanceId: true,
              assigneeId: true,
              stageLabel: true,
              deadlineAt: true,
            },
          },
        },
        take: 100,
      });

      if (!pendingAlerts.length) return 0;

      let sentCount = 0;
      for (const alert of pendingAlerts) {
        const task = alert.taskInstance;
        // Skip if task is already completed/skipped
        const status = String(task?.status || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'SKIPPED') {
          await this.prisma.processDeadlineAlert.update({
            where: { id: alert.id },
            data: { sentAt: now },
          });
          continue;
        }

        // Send notification
        const recipientId = String(alert.recipientId || task?.assigneeId || '').trim();
        if (recipientId) {
          await this.prisma.notification.create({
            data: {
              userId: recipientId,
              type: 'ProcessDeadlineAlert',
              subjectType: 'PROCESS',
              subjectId: task?.instanceId || '',
              payload: {
                taskId: task?.id,
                taskName: task?.name,
                stageLabel: task?.stageLabel || null,
                alertType: alert.alertType,
                alertLevel: alert.alertLevel,
                deadlineAt: task?.deadlineAt ? (task.deadlineAt as Date).toISOString() : null,
              },
            },
          });
        }

        // Mark as sent
        await this.prisma.processDeadlineAlert.update({
          where: { id: alert.id },
          data: { sentAt: now },
        });
        sentCount++;
      }

      if (sentCount > 0) {
        this.logger.log(`Sent ${sentCount} deadline alert(s)`);
      }
      return sentCount;
    } catch (e: any) {
      this.logger.error(`Deadline alert processing failed: ${e?.message || e}`);
      return 0;
    }
  }
}
