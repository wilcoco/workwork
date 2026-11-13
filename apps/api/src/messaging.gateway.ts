import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from './prisma.service';
import { MessagingService } from './messaging.service';

/**
 * 메시징 실시간 통로 (WebSocket).
 *  · 접속: handshake.auth.token 의 JWT로 사용자 확인 → 자기 전용 방(user:<id>)에 넣는다.
 *  · 보내기: send → 저장 → 참여자 각자의 방으로 전달 → 접속 안 한 사람은 알림 생성
 *  · 배포하면 서버가 재시작돼 연결이 끊긴다. 클라이언트가 다시 붙은 뒤 'sync'로 놓친 메시지를 받아간다.
 *  · 지금은 인스턴스 1개라 메모리 관리로 충분. 복제本을 늘리면 Postgres LISTEN/NOTIFY로 바꿔야 한다.
 */
@WebSocketGateway({ namespace: '/ws/messaging', cors: { origin: true, credentials: true } })
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MessagingGateway.name);
  @WebSocketServer() server!: Server;
  /** userId → 소켓 수 (같은 사람이 여러 탭을 열 수 있다) */
  private online = new Map<string, number>();

  constructor(private prisma: PrismaService, private svc: MessagingService) {}

  private uid(client: Socket): string | null {
    return (client.data as any)?.userId || null;
  }
  onlineUserIds() { return new Set(this.online.keys()); }

  async handleConnection(client: Socket) {
    try {
      const token = String((client.handshake.auth as any)?.token || (client.handshake.query as any)?.token || '');
      if (!token) { client.disconnect(true); return; }
      const payload: any = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
      const userId = String(payload?.sub || '');
      const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, name: true } }) : null;
      if (!user || String(user.status) !== 'ACTIVE') { client.disconnect(true); return; }
      (client.data as any).userId = user.id;
      client.join(`user:${user.id}`);
      this.online.set(user.id, (this.online.get(user.id) || 0) + 1);
      client.emit('ready', { userId: user.id, serverTime: new Date().toISOString() });
      this.broadcastPresence(user.id, true);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const id = this.uid(client);
    if (!id) return;
    const n = (this.online.get(id) || 1) - 1;
    if (n <= 0) { this.online.delete(id); this.broadcastPresence(id, false); } else this.online.set(id, n);
  }

  /** 접속 상태는 전체에 알린다(규모가 작아 부담 없음) */
  private broadcastPresence(userId: string, online: boolean) {
    try { this.server.emit('presence', { userId, online }); } catch {}
  }

  @SubscribeMessage('presence:list')
  presenceList() { return { online: Array.from(this.online.keys()) }; }

  /** 메시지 보내기 */
  @SubscribeMessage('send')
  async onSend(client: Socket, payload: { conversationId: string; body: string; attachments?: any[]; mentions?: string[]; tempId?: string }) {
    const me = this.uid(client);
    if (!me) return { ok: false, error: '인증되지 않음' };
    try {
      const msg = await this.svc.send(String(payload?.conversationId || ''), me, String(payload?.body || ''), payload?.attachments, payload?.mentions);
      const members: any[] = await (this.prisma as any).conversationMember.findMany({ where: { conversationId: msg.conversationId, leftAt: null }, select: { userId: true } });
      for (const m of members) this.server.to(`user:${m.userId}`).emit('message', { ...msg, tempId: m.userId === me ? payload?.tempId : undefined });
      void this.svc.notifyOffline(msg.conversationId, msg, this.onlineUserIds());
      return { ok: true, message: msg };
    } catch (e: any) {
      return { ok: false, error: e?.message || '전송 실패' };
    }
  }

  /** 읽음 */
  @SubscribeMessage('read')
  async onRead(client: Socket, payload: { conversationId: string; messageId?: string }) {
    const me = this.uid(client);
    if (!me) return { ok: false };
    try {
      const r = await this.svc.markRead(String(payload?.conversationId || ''), me, payload?.messageId);
      const members: any[] = await (this.prisma as any).conversationMember.findMany({ where: { conversationId: payload.conversationId, leftAt: null }, select: { userId: true } });
      for (const m of members) this.server.to(`user:${m.userId}`).emit('read', { conversationId: payload.conversationId, userId: me, lastReadMessageId: (r as any).lastReadMessageId });
      return r;
    } catch { return { ok: false }; }
  }

  /** 입력 중 표시 (저장하지 않음) */
  @SubscribeMessage('typing')
  async onTyping(client: Socket, payload: { conversationId: string; typing: boolean }) {
    const me = this.uid(client);
    if (!me || !payload?.conversationId) return;
    try {
      await this.svc.assertMember(payload.conversationId, me);
      const members: any[] = await (this.prisma as any).conversationMember.findMany({ where: { conversationId: payload.conversationId, leftAt: null }, select: { userId: true } });
      for (const m of members) if (m.userId !== me) this.server.to(`user:${m.userId}`).emit('typing', { conversationId: payload.conversationId, userId: me, typing: !!payload.typing });
    } catch {}
  }

  /** 재접속 후 놓친 메시지 복구 */
  @SubscribeMessage('sync')
  async onSync(client: Socket, payload: { conversationId: string; afterMessageId?: string }) {
    const me = this.uid(client);
    if (!me) return { ok: false, items: [] };
    try {
      const items = await this.svc.listMessages(String(payload?.conversationId || ''), me, { after: payload?.afterMessageId });
      return { ok: true, items };
    } catch { return { ok: false, items: [] }; }
  }
}
