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
        if (type !== 'ApprovalRequested' && type !== 'HelpRequested' && type !== 'Delegated') return result;

        const userId = String(data?.userId || data?.user?.connect?.id || (result as any)?.userId || '').trim();
        if (!userId) return result;

        const notification = {
          id: String((result as any)?.id || ''),
          userId,
          type,
          subjectType: String(data?.subjectType || (result as any)?.subjectType || '').trim(),
          subjectId: String(data?.subjectId || (result as any)?.subjectId || '').trim(),
          payload: (data as any)?.payload ?? (result as any)?.payload,
        };

        setImmediate(() => {
          void (async () => {
            try {
              const user = await this.user.findUnique({
                where: { id: userId },
                select: { id: true, email: true, teamsUpn: true, entraOid: true, name: true },
              });
              if (!user) return;
              await this.teamsNotificationService.sendForNotification(user as any, notification as any);
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
