import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Public } from './jwt-auth.guard';

@Public()
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  @Get()
  get() {
    return { ok: true, v: '2026_0422_0750' };
  }

  /** AI 헬스체크 — 서버의 Claude 호출이 살아있는지, 실패면 어떤 오류인지 (키는 노출 안 함) */
  @Get('ai')
  async ai() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY not set' };
    const model = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
    const t0 = Date.now();
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      });
      const ms = Date.now() - t0;
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        return { ok: false, model, status: resp.status, ms, error: text.slice(0, 500) };
      }
      return { ok: true, model, ms };
    } catch (e: any) {
      return { ok: false, model, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 300) };
    }
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
  async info() {
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
    const fingerprint = raw ? createHash('sha256').update(raw).digest('hex').slice(0, 12) : null;
    let diagnostics: any = null;
    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT current_database() AS db, current_user AS "user", inet_server_addr()::text AS server_addr, inet_server_port()::int AS server_port, (SELECT oid FROM pg_database WHERE datname = current_database())::int AS db_oid`
      );
      const r = rows && rows[0] ? rows[0] : null;
      const cu: string | undefined = r?.user;
      const maskedUser = cu ? `${cu.slice(0, 2)}***${cu.slice(-2)}` : undefined;
      diagnostics = r
        ? { serverAddr: r.server_addr, serverPort: r.server_port, dbOid: r.db_oid, currentUser: maskedUser }
        : null;
    } catch {}
    return { ok: true, db, env, fingerprint, diagnostics };
  }
}
