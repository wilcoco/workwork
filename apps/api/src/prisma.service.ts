import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
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
