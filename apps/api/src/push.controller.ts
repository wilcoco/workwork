import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PushService } from './push.service';

/** 브라우저 푸시 구독 관리 */
@Controller('push')
export class PushController {
  constructor(private prisma: PrismaService, private push: PushService) {}

  private async me(userId?: string) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!u || String(u.status) !== 'ACTIVE') throw new BadRequestException('user not found');
    return u;
  }

  /** 브라우저가 구독할 때 필요한 공개키 + 현재 등록 기기 수 */
  @Get('config')
  async config(@Query('userId') userId?: string) {
    const u = await this.me(userId);
    return { enabled: this.push.enabled, publicKey: this.push.publicKey, devices: await this.push.countFor(u.id) };
  }

  @Post('subscribe')
  async subscribe(@Body() b: any) {
    const u = await this.me(b?.userId);
    try {
      await this.push.subscribe(u.id, b?.subscription, b?.userAgent);
      return { ok: true, devices: await this.push.countFor(u.id) };
    } catch (e: any) { throw new BadRequestException(e?.message || '구독 실패'); }
  }

  @Post('unsubscribe')
  async unsubscribe(@Body() b: any) {
    await this.me(b?.userId);
    return this.push.unsubscribe(String(b?.endpoint || ''));
  }

  /** 내 기기로 시험 알림 보내기 */
  @Post('test')
  async test(@Body() b: any) {
    const u = await this.me(b?.userId);
    const r = await this.push.sendToUser(u.id, { title: '알림 시험', body: '브라우저 푸시가 정상 동작합니다.', url: '/messages', tag: 'push-test' });
    return r;
  }
}
