import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  @Get()
  get() {
    return { ok: true };
  }

  @Get('db')
  async db() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  @Get('info')
  info() {
    const raw = process.env.DATABASE_URL || this.config.get<string>('DATABASE_URL') || '';
    const m = raw.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+)(?::(\d+))?\/([^?]+)/);
    const db = m
      ? {
          user: m[1] ? `${m[1].slice(0, 2)}***` : undefined,
          host: m[3],
          port: m[4] || '5432',
          database: m[5],
        }
      : null;
    const env = {
      project: process.env.RAILWAY_PROJECT_NAME || this.config.get('RAILWAY_PROJECT_NAME') || undefined,
      service: process.env.RAILWAY_SERVICE_NAME || this.config.get('RAILWAY_SERVICE_NAME') || undefined,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || this.config.get('RAILWAY_ENVIRONMENT_NAME') || undefined,
      apiPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN || this.config.get('RAILWAY_PUBLIC_DOMAIN') || undefined,
      apiPrivateDomain: process.env.RAILWAY_PRIVATE_DOMAIN || this.config.get('RAILWAY_PRIVATE_DOMAIN') || undefined,
      expectedFrontendBase:
        process.env.FRONTEND_BASE_URL ||
        process.env.WEB_PUBLIC_URL ||
        process.env.VITE_WEB_BASE ||
        this.config.get('FRONTEND_BASE_URL') ||
        this.config.get('WEB_PUBLIC_URL') ||
        this.config.get('VITE_WEB_BASE') ||
        undefined,
    };
    return { ok: true, db, env };
  }
}
