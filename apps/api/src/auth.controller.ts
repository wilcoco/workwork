import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { Public } from './jwt-auth.guard';

class SignupDto {
  @IsString() @IsNotEmpty() username!: string; // stored in User.email
  @IsString() @IsNotEmpty() password!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() teamsUpn?: string; // Teams UPN (often the same as email)
  @IsOptional() @IsString() teamName?: string;
  @IsOptional() @IsString() companyId?: string; // optional: allow CEO/EXEC without team
  @IsOptional() @IsString() teamId?: string;    // optional: direct team selection by id
  @IsEnum({ CEO: 'CEO', EXEC: 'EXEC', MANAGER: 'MANAGER', INDIVIDUAL: 'INDIVIDUAL' } as any)
  role?: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL';
}

class LoginDto {
  @IsString() @IsNotEmpty() username!: string; // stored in User.email
  @IsString() @IsNotEmpty() password!: string;
}

@Public()
@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService) {}

  /**
   * Domains permitted for self-service ID/password signup. Comma-separated
   * env var ALLOWED_EXTERNAL_DOMAINS, e.g. "partner-a.com,partner-b.co.kr".
   *
   * The primary company's own users are expected to sign in via Microsoft
   * SSO (Entra). This domain whitelist gates external partner self-signup
   * so only companies we have explicitly approved can create accounts.
   */
  private getAllowedExternalDomains(): string[] {
    const csv = String(process.env.ALLOWED_EXTERNAL_DOMAINS || '').trim();
    if (!csv) return [];
    return csv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  private extractEmailDomain(email: string): string {
    const at = String(email || '').lastIndexOf('@');
    if (at < 0) return '';
    return String(email).slice(at + 1).trim().toLowerCase();
  }

  private assertSignupEmailAllowed(email: string) {
    const allowed = this.getAllowedExternalDomains();
    if (allowed.length === 0) {
      // No allowlist configured -> external self-signup is closed.
      throw new BadRequestException('외부 가입이 허용되지 않았습니다');
    }
    const domain = this.extractEmailDomain(email);
    if (!domain) throw new BadRequestException('이메일 형식이 올바르지 않습니다');
    if (!allowed.includes(domain)) {
      throw new BadRequestException(`허용되지 않은 도메인입니다 (${domain})`);
    }
  }

  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    this.assertSignupEmailAllowed(String(dto.username || ''));
    const teamsUpn = String(dto.teamsUpn || '').trim() || String(dto.username || '').trim() || null;
    let orgUnitId: string | null = null;
    // Prefer explicit teamId
    if (dto.teamId) {
      const t = await this.prisma.orgUnit.findUnique({ where: { id: dto.teamId } });
      if (!t || t.type !== 'TEAM') throw new BadRequestException('invalid teamId');
      orgUnitId = t.id;
    } else if (dto.teamName) {
      // Legacy behavior: find or create team by name
      let team = await this.prisma.orgUnit.findFirst({ where: { name: dto.teamName, type: 'TEAM' } });
      if (!team) {
        team = await this.prisma.orgUnit.create({ data: { name: dto.teamName, type: 'TEAM' } });
      }
      orgUnitId = team.id;
    }

    // For CEO/EXEC: allow binding to company when no team provided
    if (!orgUnitId && (dto.role === ('CEO' as any) || dto.role === ('EXEC' as any)) && dto.companyId) {
      const company = await this.prisma.orgUnit.findUnique({ where: { id: dto.companyId } });
      if (!company || company.type !== 'COMPANY') throw new BadRequestException('invalid companyId');
      orgUnitId = company.id;
    }

    // No org assignment required at signup; org assignment will be handled later in Org Management

    const existing = await this.prisma.user.findUnique({ where: { email: dto.username } });
    if (existing) throw new BadRequestException('username already exists');

    if (teamsUpn) {
      const existingTeams = await (this.prisma as any).user.findFirst({ where: { teamsUpn } });
      if (existingTeams) throw new BadRequestException('teamsUpn already exists');
    }

    // Diagnostic log: signup intent (no sensitive data)
    try {
      console.log('[auth] signup intent', {
        username: dto.username,
        role: dto.role,
        teamId: dto.teamId,
        teamName: dto.teamName,
        companyId: dto.companyId,
        resolvedOrgUnitId: orgUnitId,
      });
    } catch {}

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await (this.prisma as any).user.create({
      data: {
        email: dto.username,
        teamsUpn,
        name: dto.name,
        role: (dto.role as any) || ('INDIVIDUAL' as any),
        status: 'ACTIVE',
        activatedAt: new Date(),
        orgUnitId: orgUnitId,
        passwordHash,
      },
    });

    try {
      console.log('[auth] signup created', { id: user.id, role: user.role, orgUnitId: user.orgUnitId });
    } catch {}

    // Resolve org name for response (teamName key kept for compatibility)
    const org = user.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } }) : null;
    const token = this.signToken(user.id);
    return { token, user: { id: user.id, name: user.name, teamName: org?.name || '' } };
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.username } });
    if (!user || !user.passwordHash) throw new BadRequestException('invalid credentials');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new BadRequestException('invalid credentials');

    // Domain enforcement on login: when ALLOWED_EXTERNAL_DOMAINS is set,
    // only emails on that list may use ID/password login. Internal admin
    // roles (CEO/EXEC) are exempt so primary-company admin accounts keep
    // working regardless of their domain. When the env is empty there is
    // no enforcement (preserves accounts created before this gate).
    const allowedDomains = this.getAllowedExternalDomains();
    if (allowedDomains.length > 0) {
      const role = String((user as any).role || '');
      const isInternalAdmin = role === 'CEO' || role === 'EXEC';
      if (!isInternalAdmin) {
        const domain = this.extractEmailDomain(dto.username);
        if (!domain || !allowedDomains.includes(domain)) {
          throw new BadRequestException(`허용되지 않은 도메인입니다 (${domain || dto.username})`);
        }
      }
    }
    try {
      const status = String((user as any).status || 'ACTIVE');
      if (status !== 'ACTIVE') {
        await (this.prisma as any).user.update({ where: { id: user.id }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      }
    } catch {}
    const team = user.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } }) : null;
    const token = this.signToken(user.id);
    return { token, user: { id: user.id, name: user.name, teamName: team?.name || '' } };
  }

  private signToken(userId: string) {
    const secret = process.env.JWT_SECRET || 'devsecret';
    return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
  }

  // no-op helper removed
}
