import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

class SignupDto {
  @IsString() @IsNotEmpty() username!: string; // stored in User.email
  @IsString() @IsNotEmpty() password!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() teamName!: string;
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
    let team = await this.prisma.orgUnit.findFirst({ where: { name: dto.teamName, type: 'TEAM' } });
    if (!team) {
      team = await this.prisma.orgUnit.create({ data: { name: dto.teamName, type: 'TEAM' } });
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.username } });
    if (existing) throw new BadRequestException('username already exists');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.username,
        name: dto.name,
        role: 'INDIVIDUAL' as any,
        orgUnitId: team.id,
        passwordHash,
      },
    });

    const token = this.signToken(user.id);
    return { token, user: { id: user.id, name: user.name, teamName: team.name } };
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.username } });
    if (!user || !user.passwordHash) throw new BadRequestException('invalid credentials');
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
