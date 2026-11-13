import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 사내 메시징 — 1:1(DM)·그룹 대화.
 * Teams 라이선스를 끊어도 알림이 끊기지 않게 하려고 만든 자체 메시징의 서버 쪽.
 *  · 대화 목록/생성, 메시지 읽기·보내기, 읽음 처리, 안 읽은 수
 *  · 실시간 전달은 MessagingGateway(WebSocket)가 맡고, 여기서는 저장과 규칙만 본다.
 *  · 상대가 접속해 있지 않으면 Notification을 만든다 → 기존 알림함·홈 배너·(당분간) Teams 중계가 그대로 받는다.
 */
export const dmKeyOf = (a: string, b: string) => [a, b].sort().join('__');
const preview = (body: string, atts?: any[]) => {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 120);
  if (atts?.length) return `📎 ${String(atts[0]?.name || '첨부')}${atts.length > 1 ? ` 외 ${atts.length - 1}건` : ''}`;
  return '';
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  constructor(private prisma: PrismaService) {}

  async assertMember(conversationId: string, userId: string) {
    const m = await (this.prisma as any).conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!m || m.leftAt) throw new ForbiddenException('이 대화의 참여자가 아닙니다');
    return m;
  }

  /** 대화 상대로 고를 수 있는 사람: 활성 + 조직 배정 + 숨김 계정 제외(본인 제외) */
  async directory(meId: string, q?: string) {
    const { hiddenUserIds } = await import('./lib/tenant');
    const hidden = await hiddenUserIds(this.prisma);
    const t = String(q || '').trim();
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE' as any, id: { notIn: [...hidden, meId] }, orgUnitId: { not: null },
        role: { notIn: ['EXTERNAL', 'GUARD'] as any },
        ...(t ? { OR: [{ name: { contains: t } }, { email: { contains: t } }] } : {}),
      },
      select: { id: true, name: true, email: true, orgUnit: { select: { name: true } } },
      orderBy: { name: 'asc' }, take: 200,
    });
    return users.map((u) => ({ id: u.id, name: u.name, team: u.orgUnit?.name || '', email: u.email }));
  }

  /** 1:1 대화 열기 (없으면 생성) */
  async openDm(meId: string, otherId: string) {
    if (meId === otherId) throw new BadRequestException('자기 자신과는 대화할 수 없습니다');
    const other = await this.prisma.user.findUnique({ where: { id: otherId }, select: { id: true, status: true } });
    if (!other || String(other.status) !== 'ACTIVE') throw new BadRequestException('상대를 찾을 수 없습니다');
    const key = dmKeyOf(meId, otherId);
    const found = await (this.prisma as any).conversation.findUnique({ where: { dmKey: key } });
    if (found) {
      // 나갔다가 다시 여는 경우 복귀
      await (this.prisma as any).conversationMember.updateMany({ where: { conversationId: found.id, userId: meId }, data: { leftAt: null } });
      return found;
    }
    return (this.prisma as any).conversation.create({
      data: { type: 'DM', dmKey: key, createdById: meId, members: { create: [{ userId: meId }, { userId: otherId }] } },
    });
  }

  /** 그룹 대화 만들기 */
  async createGroup(meId: string, title: string, memberIds: string[]) {
    const ids = Array.from(new Set([meId, ...memberIds.filter(Boolean)]));
    if (ids.length < 2) throw new BadRequestException('참여자를 1명 이상 선택하세요');
    const t = String(title || '').trim().slice(0, 100);
    return (this.prisma as any).conversation.create({
      data: { type: 'GROUP', title: t || '새 대화', createdById: meId, members: { create: ids.map((userId) => ({ userId })) } },
    });
  }

  /** 내 대화 목록 — 마지막 메시지·안 읽은 수·상대 이름까지 한 번에 */
  async listConversations(meId: string) {
    const mine: any[] = await (this.prisma as any).conversationMember.findMany({
      where: { userId: meId, leftAt: null },
      include: { conversation: { include: { members: true } } },
    });
    const convIds = mine.map((m) => m.conversationId);
    if (!convIds.length) return [];
    const otherIds = Array.from(new Set(mine.flatMap((m) => m.conversation.members.map((x: any) => x.userId)).filter((id: string) => id !== meId)));
    const users = otherIds.length ? await this.prisma.user.findMany({ where: { id: { in: otherIds as string[] } }, select: { id: true, name: true, orgUnit: { select: { name: true } } } }) : [];
    const umap = new Map(users.map((u) => [u.id, u]));

    // 안 읽은 수: 내 lastReadAt 이후에 남이 쓴 메시지
    const unreadRows: any[] = await (this.prisma as any).message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: convIds }, deletedAt: null, senderId: { not: meId } },
      _count: { _all: true },
    }).catch(() => []);
    void unreadRows; // groupBy로는 멤버별 기준시각을 못 쓰므로 아래에서 개별 집계

    const out: any[] = [];
    for (const m of mine) {
      const c = m.conversation;
      const others = c.members.filter((x: any) => x.userId !== meId).map((x: any) => umap.get(x.userId)).filter(Boolean);
      const unread = await (this.prisma as any).message.count({
        where: { conversationId: c.id, deletedAt: null, senderId: { not: meId }, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) },
      });
      out.push({
        id: c.id, type: c.type,
        title: c.type === 'DM' ? (others[0]?.name || '(알 수 없음)') : (c.title || '그룹 대화'),
        subtitle: c.type === 'DM' ? (others[0]?.orgUnit?.name || '') : `${c.members.length}명`,
        memberIds: c.members.map((x: any) => x.userId),
        members: others.map((u: any) => ({ id: u.id, name: u.name, team: u.orgUnit?.name || '' })),
        lastMessageAt: c.lastMessageAt, lastPreview: c.lastPreview || '', unread, muted: !!(m.mutedUntil && m.mutedUntil > new Date()),
      });
    }
    out.sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
    return out;
  }

  /** 메시지 읽기 — before(커서)보다 이전 것부터 최신순으로 limit건, 화면에서는 뒤집어 쓴다 */
  async listMessages(conversationId: string, meId: string, opts: { before?: string; after?: string; limit?: number } = {}) {
    await this.assertMember(conversationId, meId);
    const limit = Math.min(100, Math.max(1, opts.limit || 40));
    if (opts.after) {
      // 끊긴 사이에 놓친 것 복구 — after 이후의 모든 메시지(최대 200)
      const anchor = await (this.prisma as any).message.findUnique({ where: { id: opts.after }, select: { createdAt: true } });
      const rows = await (this.prisma as any).message.findMany({
        where: { conversationId, deletedAt: null, ...(anchor ? { createdAt: { gt: anchor.createdAt } } : {}) },
        orderBy: { createdAt: 'asc' }, take: 200,
      });
      return this.decorate(rows);
    }
    const anchor = opts.before ? await (this.prisma as any).message.findUnique({ where: { id: opts.before }, select: { createdAt: true } }) : null;
    const rows = await (this.prisma as any).message.findMany({
      where: { conversationId, deletedAt: null, ...(anchor ? { createdAt: { lt: anchor.createdAt } } : {}) },
      orderBy: { createdAt: 'desc' }, take: limit,
    });
    return this.decorate(rows.reverse());
  }

  private async decorate(rows: any[]) {
    const ids = Array.from(new Set(rows.map((r) => r.senderId)));
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const um = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, senderName: um.get(r.senderId) || '(알 수 없음)' }));
  }

  /** 메시지 보내기 — 저장 + 대화 요약 갱신. 실시간 전달/알림은 호출자(게이트웨이·컨트롤러)가 맡는다 */
  async send(conversationId: string, senderId: string, body: string, attachments?: any[], mentions?: string[]) {
    await this.assertMember(conversationId, senderId);
    const text = String(body || '').slice(0, 8000);
    const atts = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
    if (!text.trim() && !atts.length) throw new BadRequestException('내용이 비어 있습니다');
    const msg = await (this.prisma as any).message.create({
      data: { conversationId, senderId, body: text, attachments: atts.length ? atts : undefined, mentions: mentions?.length ? mentions : undefined },
    });
    await (this.prisma as any).conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: msg.createdAt, lastPreview: preview(text, atts) },
    });
    // 보낸 사람은 자기 메시지까지 읽은 것으로
    await (this.prisma as any).conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: senderId } },
      data: { lastReadMessageId: msg.id, lastReadAt: msg.createdAt },
    }).catch(() => {});
    return (await this.decorate([msg]))[0];
  }

  async markRead(conversationId: string, userId: string, messageId?: string) {
    await this.assertMember(conversationId, userId);
    const last = messageId
      ? await (this.prisma as any).message.findUnique({ where: { id: messageId }, select: { id: true, createdAt: true } })
      : await (this.prisma as any).message.findFirst({ where: { conversationId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } });
    if (!last) return { ok: true };
    await (this.prisma as any).conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadMessageId: last.id, lastReadAt: last.createdAt },
    });
    return { ok: true, lastReadMessageId: last.id };
  }

  /** 대화 상대들이 어디까지 읽었는지 (읽음 표시용) */
  async readStates(conversationId: string, meId: string) {
    await this.assertMember(conversationId, meId);
    const rows: any[] = await (this.prisma as any).conversationMember.findMany({ where: { conversationId, leftAt: null }, select: { userId: true, lastReadAt: true, lastReadMessageId: true } });
    return rows.filter((r) => r.userId !== meId);
  }

  async totalUnread(userId: string) {
    const mine: any[] = await (this.prisma as any).conversationMember.findMany({ where: { userId, leftAt: null }, select: { conversationId: true, lastReadAt: true, mutedUntil: true } });
    let n = 0;
    for (const m of mine) {
      if (m.mutedUntil && m.mutedUntil > new Date()) continue;
      n += await (this.prisma as any).message.count({
        where: { conversationId: m.conversationId, deletedAt: null, senderId: { not: userId }, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) },
      });
    }
    return n;
  }

  /** 접속해 있지 않은 참여자에게 알림 생성 → 알림함·홈 배너·(당분간) Teams 중계가 받는다 */
  async notifyOffline(conversationId: string, msg: any, onlineUserIds: Set<string>) {
    try {
      const members: any[] = await (this.prisma as any).conversationMember.findMany({ where: { conversationId, leftAt: null } });
      const conv = await (this.prisma as any).conversation.findUnique({ where: { id: conversationId }, select: { type: true, title: true } });
      const sender = await this.prisma.user.findUnique({ where: { id: msg.senderId }, select: { name: true } });
      const now = new Date();
      for (const m of members) {
        if (m.userId === msg.senderId) continue;
        if (onlineUserIds.has(m.userId)) continue;
        if (m.mutedUntil && m.mutedUntil > now) continue;
        await this.prisma.notification.create({
          data: {
            userId: m.userId, type: 'MessageReceived', subjectType: 'CONVERSATION', subjectId: conversationId,
            payload: { from: sender?.name || '', preview: preview(msg.body, msg.attachments as any), conversationType: conv?.type, title: conv?.title || '' },
          },
        }).catch(() => {});
      }
    } catch (e) { this.logger.warn(`notifyOffline 실패: ${(e as any)?.message}`); }
  }
}
