import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { TeamsNotificationService } from './teams-notification.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly teamsNotificationService: TeamsNotificationService) {
    super();

    this.$use(async (params: Prisma.MiddlewareParams, next) => {
      const result = await next(params);

      try {
        if (params.model !== 'Notification' || params.action !== 'create') return result;

        const data: any = (params as any)?.args?.data || {};
        const type = String(data?.type || (result as any)?.type || '').trim();
        if (
          type !== 'ApprovalRequested' &&
          type !== 'HelpRequested' &&
          type !== 'Delegated' &&
          type !== 'ProcessStarted' &&
          type !== 'ProcessTaskReady'
        ) return result;

        const userId = String(data?.userId || data?.user?.connect?.id || (result as any)?.userId || '').trim();
        if (!userId) return result;

        const subjectType = String(data?.subjectType || (result as any)?.subjectType || '').trim();
        const subjectId = String(data?.subjectId || (result as any)?.subjectId || '').trim();
        const payload = (data as any)?.payload ?? (result as any)?.payload;

        const notification: any = {
          id: String((result as any)?.id || ''),
          userId,
          type,
          subjectType,
          subjectId,
          payload,
        };

        setImmediate(() => {
          void (async () => {
            try {
              // Resolve the recipient
              const user = await this.user.findUnique({
                where: { id: userId },
                select: { id: true, email: true, teamsUpn: true, entraOid: true, name: true },
              });
              if (!user) return;

              // Enrich: who triggered this notification (sender name).
              // Try payload.requestedById first; fall back to the
              // linked ApprovalRequest's requestedById when present.
              let senderId = String(payload?.requestedById || '').trim();
              if (!senderId && payload?.requestId) {
                try {
                  const ar = await (this as any).approvalRequest.findUnique({
                    where: { id: String(payload.requestId) },
                    select: { requestedById: true },
                  });
                  if (ar?.requestedById) senderId = String(ar.requestedById);
                } catch {}
              }
              if (senderId) {
                try {
                  const sender = await this.user.findUnique({ where: { id: senderId }, select: { name: true } });
                  if (sender?.name) notification._senderName = sender.name;
                } catch {}
              }

              // Enrich: subject title (e.g. worklog note first line)
              if (subjectType === 'Worklog' && subjectId) {
                try {
                  const wl = await (this as any).worklog.findUnique({ where: { id: subjectId }, select: { note: true } });
                  if (wl?.note) notification._subjectTitle = String(wl.note).split('\n')[0].slice(0, 80);
                } catch {}
              }

              await this.teamsNotificationService.sendForNotification(user as any, notification);
            } catch (e) {
              this.logger.error(
                `teams notification middleware failed: ${String((e as any)?.message || e || 'error')}`,
                (e as any)?.stack,
              );
            }
          })();
        });
      } catch (e) {
        this.logger.error(
          `teams notification middleware error: ${String((e as any)?.message || e || 'error')}`,
          (e as any)?.stack,
        );
      }

      return result;
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.ensureDefaultData();
  }

  private async ensureDefaultData() {
    await this.$transaction(async (tx) => {
      let team = await tx.orgUnit.findFirst({ where: { name: '관리자' } });
      if (!team) {
        team = await tx.orgUnit.create({ data: { name: '관리자', type: 'TEAM' } });
      }

      const existingAdmin = await tx.user.findUnique({ where: { email: 'admin' } });
      if (!existingAdmin) {
        const passwordHash = await bcrypt.hash('adminpw', 10);
        await tx.user.create({
          data: {
            email: 'admin',
            name: '관리자',
            role: 'CEO' as any,
            orgUnitId: team.id,
            passwordHash,
          },
        });
      }
    });
  }
}
