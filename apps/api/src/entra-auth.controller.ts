import { BadRequestException, Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import * as jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Public } from './jwt-auth.guard';

@Public()
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

  /**
   * Tenants whose users may sign in through our Entra SSO.
   *
   * - The primary ENTRA_TENANT_ID is always included (existing behaviour).
   * - Additional tenant IDs may be listed in ALLOWED_ENTRA_TENANTS as a
   *   comma-separated value, e.g. "tid-of-partner-a,tid-of-partner-b".
   * - When the list is effectively just the primary tenant, authentication
   *   stays single-tenant (no behaviour change). When additional tenants are
   *   present, the app becomes multi-tenant for those specific tenants.
   */
  private getAllowedTenants(): string[] {
    const primary = String(process.env.ENTRA_TENANT_ID || '').trim();
    const csv = String(process.env.ALLOWED_ENTRA_TENANTS || '').trim();
    const extras = csv
      ? csv.split(',').map((x) => x.trim()).filter(Boolean)
      : [];
    const set = new Set<string>();
    if (primary) set.add(primary);
    for (const x of extras) set.add(x);
    return Array.from(set);
  }

  private isMultiTenantMode(): boolean {
    // If the admin listed any tenant other than the primary one, use the
    // /organizations authority so external tenant users can sign in.
    const primary = String(process.env.ENTRA_TENANT_ID || '').trim();
    return this.getAllowedTenants().some((t) => t && t !== primary);
  }

  // Authority segment for Microsoft login endpoints. Either the primary
  // tenant id (single-tenant) or "organizations" (any work/school tenant).
  private getAuthorityTenantSegment(): string {
    if (this.isMultiTenantMode()) return 'organizations';
    return String(process.env.ENTRA_TENANT_ID || '').trim();
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

  /**
   * Place a primary-tenant user into the OrgUnit (type='TEAM') whose name
   * matches one of the Microsoft Teams the user belongs to.
   *
   * Strategy:
   *  - Call Graph /me/joinedTeams with the user's delegated access token.
   *  - For each team displayName, look for an existing OrgUnit with the
   *    same name (case-insensitive trim) AND type='TEAM'. We do NOT auto-
   *    create OrgUnits to avoid polluting the org structure with channels
   *    like "General". The admin must pre-create the matching team in
   *    Org Management for the placement to take effect.
   *  - Pick the first match and update user.orgUnitId.
   *
   * Caller must ensure the user has no orgUnitId yet so we never overwrite
   * a manual assignment.
   */
  private async autoPlaceUserByTeamsMembership(userId: string, accessToken: string): Promise<void> {
    if (!userId || !accessToken) return;
    const res = await fetch('https://graph.microsoft.com/v1.0/me/joinedTeams?$select=id,displayName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`joinedTeams fetch failed (${res.status})`);
    }
    const json: any = await res.json().catch(() => ({}));
    const teams: Array<{ id?: string; displayName?: string }> = Array.isArray(json?.value) ? json.value : [];
    if (teams.length === 0) return;

    const orgUnitModel: any = (this.prisma as any).orgUnit;
    for (const t of teams) {
      const name = String(t?.displayName || '').trim();
      if (!name) continue;
      const match = await orgUnitModel
        .findFirst({
          where: {
            type: 'TEAM',
            name: { equals: name, mode: 'insensitive' as any },
          },
        })
        .catch(() => null);
      if (match?.id) {
        await (this.prisma as any).user
          .update({ where: { id: userId }, data: { orgUnitId: match.id } })
          .catch(() => null);
        try { console.log('[entra] auto-placed user', userId, 'into orgUnit', match.id, `(${match.name})`); } catch {}
        return;
      }
    }
    // No team name matched any OrgUnit; leave user unassigned.
  }

  private async verifyEntraIdToken(idToken: string, clientId: string, expectedNonce?: string) {
    const decoded: any = jwt.decode(idToken, { complete: true });
    const kid = String(decoded?.header?.kid || '');
    // The token tells us which tenant issued it via the "tid" claim. We
    // reject tokens from tenants outside our allowlist before even fetching
    // keys, so an attacker cannot push us to a foreign tenant's JWKS.
    const tokenTid = String(decoded?.payload?.tid || '').trim();
    if (!tokenTid) throw new Error('id_token missing tid');
    const allowed = this.getAllowedTenants();
    if (!allowed.includes(tokenTid)) {
      throw new Error(`tenant ${tokenTid} is not allowed`);
    }

    // Fetch JWKS from the issuing tenant so the signing key actually matches
    // the token. This is necessary once multi-tenant mode is enabled.
    const jwks = await this.fetchEntraJwks(tokenTid);
    const key = (jwks?.keys || []).find((k: any) => String(k?.kid || '') === kid) || (jwks?.keys || [])[0];
    const x5c = (key as any)?.x5c?.[0];
    if (!x5c) throw new Error('jwks key missing x5c');
    const pem = this.certToPem(String(x5c));

    const issuer = `https://login.microsoftonline.com/${tokenTid}/v2.0`;
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

  @Post('teams-sso')
  async teamsSso(@Body() body: { ssoToken: string }) {
    const ssoToken = String(body?.ssoToken || '').trim();
    if (!ssoToken) throw new BadRequestException('ssoToken required');

    // Decode and verify the Teams SSO token (issued by Azure AD)
    // The token is a JWT signed by Microsoft; we verify the audience matches our client ID.
    const { clientId } = this.getEntraConfig();
    const decoded: any = jwt.decode(ssoToken, { complete: true });
    if (!decoded?.payload) throw new BadRequestException('invalid ssoToken');

    const payload = decoded.payload;
    // Verify audience matches our app
    const aud = String(payload.aud || '').trim();
    if (aud !== clientId && aud !== `api://${clientId}`) {
      throw new BadRequestException('token audience mismatch');
    }

    // Verify tenant
    const tid = String(payload.tid || '').trim();
    const allowed = this.getAllowedTenants();
    if (allowed.length > 0 && !allowed.includes(tid)) {
      throw new BadRequestException('tenant not allowed');
    }

    // Find or create user by oid/email
    const oid = String(payload.oid || '').trim();
    const preferred = String(payload.preferred_username || payload.upn || '').trim();
    const displayName = String(payload.name || '').trim();

    const userModel = this.prisma.user as any;
    let user = oid
      ? await userModel.findFirst({ where: { entraOid: oid } })
      : null;
    if (!user && preferred) {
      user = await userModel.findFirst({ where: { email: preferred } });
    }
    if (!user) {
      user = await userModel.create({
        data: {
          email: preferred || `teams-${oid}`,
          name: displayName || preferred || 'Teams User',
          entraOid: oid || undefined,
          teamsUpn: preferred || undefined,
          status: 'PENDING',
        },
      });
    }
    // Update entraOid if missing
    if (oid && !user.entraOid) {
      await userModel.update({ where: { id: user.id }, data: { entraOid: oid } }).catch(() => {});
    }

    if (String(user?.status || '') === 'PENDING') {
      throw new BadRequestException('계정 승인 대기 중입니다');
    }

    const team = user.orgUnitId
      ? await (this.prisma as any).orgUnit.findUnique({ where: { id: user.orgUnitId } }).catch(() => null)
      : null;

    const token = this.signToken(String(user.id));
    return {
      token,
      user: {
        id: user.id,
        name: user.name || displayName,
        teamName: team?.name || '',
      },
    };
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
      scope: 'openid profile email offline_access Tasks.ReadWrite Group.Read.All Files.ReadWrite.All',
      state,
      nonce,
      prompt: 'select_account',
    });
    const authority = this.getAuthorityTenantSegment() || tenantId;
    const url = `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/authorize?${params.toString()}`;
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

    const tokenAuthority = this.getAuthorityTenantSegment() || tenantId;
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tokenAuthority)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access Tasks.ReadWrite Group.Read.All Files.ReadWrite.All',
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
      claims = await this.verifyEntraIdToken(idToken, clientId, expectedNonce);
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
            ...(String(user?.status || 'ACTIVE') === 'ACTIVE' ? {} : { status: 'ACTIVE', activatedAt: new Date() }),
          },
        });
      } catch {}
    }

    // Store Graph API tokens for Planner/Tasks integration
    const graphAccessToken = String(tokenJson?.access_token || '').trim();
    const graphRefreshToken = String(tokenJson?.refresh_token || '').trim();
    const expiresIn = Number(tokenJson?.expires_in) || 3600;
    if (graphAccessToken && user?.id) {
      try {
        await userModel.update({
          where: { id: user.id },
          data: {
            graphAccessToken,
            graphRefreshToken: graphRefreshToken || undefined,
            graphTokenExpiry: new Date(Date.now() + expiresIn * 1000),
          },
        });
      } catch {}
    }

    // Auto-place primary-tenant employees into the OrgUnit whose name
    // matches one of the Microsoft Teams they belong to. Only runs for
    // users from the primary tenant (i.e. our own employees), only when
    // they don't yet have an org assignment, and never overwrites an
    // existing one. Matching is by team displayName -> OrgUnit.name.
    try {
      const isPrimaryTenant = entraTid && entraTid === tenantId;
      const fresh = await userModel.findUnique({ where: { id: user.id } }).catch(() => null);
      if (isPrimaryTenant && graphAccessToken && fresh && !fresh.orgUnitId) {
        await this.autoPlaceUserByTeamsMembership(String(user.id), graphAccessToken);
      }
    } catch (e) {
      // Non-fatal: fall through to login completion even if Graph call fails.
      try { console.warn('[entra] auto org placement failed:', (e as any)?.message || e); } catch {}
    }

    // Gate: PENDING users must wait for CEO/admin approval
    if (String(user?.status || '') === 'PENDING') {
      return res.redirect(`${webBase}/auth/pending`);
    }

    // Reload user to pick up any orgUnitId set by the auto-placement above.
    const reloaded = await userModel.findUnique({ where: { id: user.id } }).catch(() => null);
    const effectiveOrgUnitId = reloaded?.orgUnitId || user?.orgUnitId || null;
    const team = effectiveOrgUnitId
      ? await (this.prisma as any).orgUnit.findUnique({ where: { id: effectiveOrgUnitId } }).catch(() => null)
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
