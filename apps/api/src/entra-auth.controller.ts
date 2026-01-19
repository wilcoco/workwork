import { BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import * as jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Controller('auth')
export class EntraAuthController {
  constructor(private prisma: PrismaService) {}

  private isCamsOrg() {
    const raw = String(
      process.env.VITE_COMPANY_NAME ||
        process.env.COMPANY_NAME ||
        process.env.BRAND_COMPANY_NAME ||
        ''
    )
      .trim()
      .replace(/^['"]+|['"]+$/g, '');
    const norm = raw.toLowerCase();
    return norm.includes('캠스') || norm.includes('cams');
  }

  private assertCamsOrgEnabled() {
    if (!this.isCamsOrg()) throw new BadRequestException('Entra SSO not enabled');
  }

  private getJwtSecret() {
    return process.env.JWT_SECRET || 'devsecret';
  }

  private signToken(userId: string) {
    const secret = this.getJwtSecret();
    return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
  }

  private getWebBase(req: Request) {
    const configured = String(process.env.WEB_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    const origin = String(req?.headers?.origin || '').trim().replace(/\/+$/, '');
    if (origin) return origin;
    return 'http://localhost:5173';
  }

  private safeReturnPath(raw?: string) {
    const s = String(raw || '').trim();
    if (!s) return '/';
    if (!s.startsWith('/')) return '/';
    if (s.startsWith('//')) return '/';
    return s;
  }

  private getEntraConfig() {
    this.assertCamsOrgEnabled();
    const tenantId = String(process.env.ENTRA_TENANT_ID || '').trim();
    const clientId = String(process.env.ENTRA_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.ENTRA_CLIENT_SECRET || '').trim();
    const redirectUri = String(process.env.ENTRA_REDIRECT_URI || '').trim();
    if (!tenantId) throw new BadRequestException('ENTRA_TENANT_ID required');
    if (!clientId) throw new BadRequestException('ENTRA_CLIENT_ID required');
    if (!clientSecret) throw new BadRequestException('ENTRA_CLIENT_SECRET required');
    if (!redirectUri) throw new BadRequestException('ENTRA_REDIRECT_URI required');
    return { tenantId, clientId, clientSecret, redirectUri };
  }

  private async fetchEntraJwks(tenantId: string) {
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`jwks fetch failed (${res.status})`);
    return (await res.json()) as { keys: any[] };
  }

  private certToPem(cert: string) {
    const clean = String(cert || '').replace(/\s+/g, '');
    const lines = clean.match(/.{1,64}/g) || [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
  }

  private async verifyEntraIdToken(idToken: string, tenantId: string, clientId: string, expectedNonce?: string) {
    const decoded: any = jwt.decode(idToken, { complete: true });
    const kid = String(decoded?.header?.kid || '');
    const jwks = await this.fetchEntraJwks(tenantId);
    const key = (jwks?.keys || []).find((k: any) => String(k?.kid || '') === kid) || (jwks?.keys || [])[0];
    const x5c = (key as any)?.x5c?.[0];
    if (!x5c) throw new Error('jwks key missing x5c');
    const pem = this.certToPem(String(x5c));

    const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    const verified: any = jwt.verify(idToken, pem, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer,
    });

    if (expectedNonce && String(verified?.nonce || '') !== String(expectedNonce)) {
      throw new Error('invalid nonce');
    }
    return verified as any;
  }

  @Get('entra/start')
  async entraStart(@Req() req: Request, @Res() res: Response, @Query('return') returnTo?: string) {
    const { tenantId, clientId, redirectUri } = this.getEntraConfig();
    const nonce = randomUUID();
    const state = jwt.sign({ r: this.safeReturnPath(returnTo), nonce }, this.getJwtSecret(), { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state,
      nonce,
      prompt: 'select_account',
    });
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
    return res.redirect(url);
  }

  @Get('entra/callback')
  async entraCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const webBase = this.getWebBase(req);
    let tenantId = '';
    let clientId = '';
    let clientSecret = '';
    let redirectUri = '';
    try {
      const cfg = this.getEntraConfig();
      tenantId = cfg.tenantId;
      clientId = cfg.clientId;
      clientSecret = cfg.clientSecret;
      redirectUri = cfg.redirectUri;
    } catch (e: any) {
      const msg = encodeURIComponent(String(e?.message || 'Entra SSO not enabled').slice(0, 200));
      return res.redirect(`${webBase}/login?error=${msg}`);
    }

    if (error) {
      const msg = encodeURIComponent(String(errorDescription || error || 'entra login failed').slice(0, 200));
      return res.redirect(`${webBase}/login?error=${msg}`);
    }
    if (!code) {
      return res.redirect(`${webBase}/login?error=${encodeURIComponent('missing code')}`);
    }
    if (!state) {
      return res.redirect(`${webBase}/login?error=${encodeURIComponent('missing state')}`);
    }

    let returnPath = '/';
    let expectedNonce: string | undefined;
    try {
      const decoded: any = jwt.verify(String(state), this.getJwtSecret());
      returnPath = this.safeReturnPath(decoded?.r);
      expectedNonce = String(decoded?.nonce || '') || undefined;
    } catch {
      return res.redirect(`${webBase}/login?error=${encodeURIComponent('invalid state')}`);
    }

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
      scope: 'openid profile email',
    });
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      const msg = encodeURIComponent(String(tokenJson?.error_description || tokenJson?.error || 'token exchange failed').slice(0, 200));
      return res.redirect(`${webBase}/login?error=${msg}`);
    }

    const idToken = String(tokenJson?.id_token || '');
    if (!idToken) {
      return res.redirect(`${webBase}/login?error=${encodeURIComponent('missing id_token')}`);
    }

    let claims: any;
    try {
      claims = await this.verifyEntraIdToken(idToken, tenantId, clientId, expectedNonce);
    } catch (e: any) {
      const msg = encodeURIComponent(String(e?.message || 'id_token verify failed').slice(0, 200));
      return res.redirect(`${webBase}/login?error=${msg}`);
    }

    const entraOid = String(claims?.oid || '').trim();
    const entraTid = String(claims?.tid || '').trim();
    const preferred = String(claims?.preferred_username || claims?.upn || claims?.email || '').trim();
    const displayName = String(claims?.name || '').trim();

    if (!entraOid || !preferred) {
      return res.redirect(`${webBase}/login?error=${encodeURIComponent('missing user identity')}`);
    }

    const userModel: any = (this.prisma as any).user;
    let user: any = await userModel.findUnique({ where: { entraOid } }).catch(() => null);
    if (!user) {
      user = await userModel.findFirst({ where: { email: preferred } }).catch(() => null);
    }

    if (!user) {
      user = await userModel.create({
        data: {
          email: preferred,
          teamsUpn: preferred,
          name: displayName || preferred,
          role: 'INDIVIDUAL',
          entraTenantId: entraTid || tenantId,
          entraOid,
          status: 'PENDING',
        },
      });
    } else {
      try {
        await userModel.update({
          where: { id: user.id },
          data: {
            teamsUpn: user.teamsUpn || preferred,
            entraTenantId: user.entraTenantId || (entraTid || tenantId),
            entraOid: user.entraOid || entraOid,
          },
        });
      } catch {}
    }

    const status = String(user?.status || 'ACTIVE');
    if (status !== 'ACTIVE') {
      return res.redirect(`${webBase}/auth/pending`);
    }

    const team = user?.orgUnitId
      ? await (this.prisma as any).orgUnit.findUnique({ where: { id: user.orgUnitId } }).catch(() => null)
      : null;

    const token = this.signToken(String(user.id));
    const hash = [
      `token=${encodeURIComponent(token)}`,
      `return=${encodeURIComponent(returnPath)}`,
      `userId=${encodeURIComponent(String(user.id))}`,
      `userName=${encodeURIComponent(String(user.name || displayName || preferred))}`,
      `teamName=${encodeURIComponent(String(team?.name || ''))}`,
      `userLogin=${encodeURIComponent(String(preferred))}`,
    ].join('&');
    return res.redirect(`${webBase}/auth/entra/complete#${hash}`);
  }
}
