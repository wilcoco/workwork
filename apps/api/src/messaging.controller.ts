import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';

/**
 * 메시징 HTTP API — 목록·이력·대화 생성처럼 한 번에 받아오는 것들.
 * 실시간 송수신은 WebSocket(MessagingGateway)이 맡지만, 연결이 안 될 때를 대비해 보내기도 여기 둔다.
 */
@Controller('messaging')
export class MessagingController {
  constructor(private prisma: PrismaService, private svc: MessagingService, private gw: MessagingGateway) {}

  private async me(userId?: string) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
    if (!u || String(u.status) !== 'ACTIVE') throw new BadRequestException('user not found');
    return u;
  }

  @Get('conversations')
  async conversations(@Query('userId') userId?: string) {
    const u = await this.me(userId);
    const items = await this.svc.listConversations(u.id);
    return { items, online: Array.from(this.gw.onlineUserIds()) };
  }

  @Get('unread')
  async unread(@Query('userId') userId?: string) {
    const u = await this.me(userId);
    return { count: await this.svc.totalUnread(u.id) };
  }

  @Get('directory')
  async directory(@Query('userId') userId?: string, @Query('q') q?: string) {
    const u = await this.me(userId);
    return { items: await this.svc.directory(u.id, q) };
  }

  @Post('dm')
  async dm(@Body() b: any) {
    const u = await this.me(b?.userId);
    const c = await this.svc.openDm(u.id, String(b?.otherId || ''));
    return { id: c.id };
  }

  @Post('group')
  async group(@Body() b: any) {
    const u = await this.me(b?.userId);
    const c = await this.svc.createGroup(u.id, String(b?.title || ''), Array.isArray(b?.memberIds) ? b.memberIds.map(String) : []);
    return { id: c.id };
  }

  @Get('conversations/:id/messages')
  async messages(@Param('id') id: string, @Query('userId') userId?: string, @Query('before') before?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    const u = await this.me(userId);
    const items = await this.svc.listMessages(id, u.id, { before, after, limit: limit ? Number(limit) : undefined });
    const reads = await this.svc.readStates(id, u.id);
    return { items, reads };
  }

  /** WebSocket이 막힌 환경을 위한 보내기 (평소에는 소켓으로 보낸다) */
  @Post('conversations/:id/messages')
  async send(@Param('id') id: string, @Body() b: any) {
    const u = await this.me(b?.userId);
    const msg = await this.svc.send(id, u.id, String(b?.body || ''), b?.attachments, b?.mentions);
    const members: any[] = await (this.prisma as any).conversationMember.findMany({ where: { conversationId: id, leftAt: null }, select: { userId: true } });
    for (const m of members) this.gw.server?.to(`user:${m.userId}`).emit('message', msg);
    void this.svc.notifyOffline(id, msg, this.gw.onlineUserIds());
    return msg;
  }

  @Post('conversations/:id/read')
  async read(@Param('id') id: string, @Body() b: any) {
    const u = await this.me(b?.userId);
    return this.svc.markRead(id, u.id, b?.messageId);
  }

  /** 알림 끄기 — hours 만큼 음소거(0이면 해제) */
  @Post('conversations/:id/mute')
  async mute(@Param('id') id: string, @Body() b: any) {
    const u = await this.me(b?.userId);
    await this.svc.assertMember(id, u.id);
    const hours = Number(b?.hours);
    const until = !hours || hours <= 0 ? null : new Date(Date.now() + hours * 3600000);
    await (this.prisma as any).conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: u.id } }, data: { mutedUntil: until } });
    return { ok: true, mutedUntil: until };
  }
}
