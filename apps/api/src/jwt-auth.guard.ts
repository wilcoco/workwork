import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

export const IS_PUBLIC_KEY = 'isPublic';
import { SetMetadata } from '@nestjs/common';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const auth = String(request.headers?.authorization || '').trim();
    if (!auth) throw new UnauthorizedException('Missing authorization header');

    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid authorization format');
    }

    const token = parts[1];
    const secret = process.env.JWT_SECRET || 'devsecret';

    try {
      const payload = jwt.verify(token, secret) as any;
      request.jwtUser = { userId: payload.sub };
      return true;
    } catch (e: any) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
