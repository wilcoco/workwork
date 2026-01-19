import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

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

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto) {
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
        status: 'PENDING',
        orgUnitId: orgUnitId,
        passwordHash,
      },
    });

    try {
      console.log('[auth] signup created', { id: user.id, role: user.role, orgUnitId: user.orgUnitId });
    } catch {}

    // Resolve org name for response (teamName key kept for compatibility)
    const org = user.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: user.orgUnitId } }) : null;
    const status = String((user as any).status || 'ACTIVE');
    if (status !== 'ACTIVE') {
      return { pending: true, user: { id: user.id, name: user.name, teamName: org?.name || '' } };
    }
    const token = this.signToken(user.id);
    return { token, user: { id: user.id, name: user.name, teamName: org?.name || '' } };
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.username } });
    if (!user || !user.passwordHash) throw new BadRequestException('invalid credentials');
    if (String((user as any).status || 'ACTIVE') !== 'ACTIVE') throw new BadRequestException('승인 대기 상태입니다');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new BadRequestException('invalid credentials');
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
