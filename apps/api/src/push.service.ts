import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from './prisma.service';
import { onNotification } from './lib/notification-relay';

/**
 * 브라우저 푸시(Web Push, VAPID) — 앱을 꺼 둬도 알림이 뜨게 한다.
 * Teams 라이선스를 끊었을 때 "앱을 안 켜고 있어도 알림이 온다"를 대신할 조각.
 *
 *  · 크롬·엣지·파이어폭스(윈도우·맥·안드로이드): 그대로 동작
 *  · 아이폰/아이패드: 사파리에서 "홈 화면에 추가"로 설치한 경우에만 동작(iOS 16.4+)
 *  · 키는 환경변수 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
 *  · 404·410(구독 만료)이면 그 구독을 지운다. 그 외 실패는 횟수만 세고 5회 넘으면 정리.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private ready = false;

  constructor(private prisma: PrismaService) {
    const pub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    const priv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
    if (pub && priv) {
      try { webpush.setVapidDetails(subject, pub, priv); this.ready = true; }
      catch (e) { this.logger.warn(`VAPID 설정 실패: ${(e as any)?.message}`); }
    } else {
      this.logger.warn('VAPID 키가 없어 브라우저 푸시를 보내지 않습니다');
    }
    // 알림이 만들어지면 브라우저 푸시로도 내보낸다
    onNotification((userId, n) => { void this.sendForNotification(userId, n); });
  }

  get enabled() { return this.ready; }
  get publicKey() { return String(process.env.VAPID_PUBLIC_KEY || ''); }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
    const endpoint = String(sub?.endpoint || '').trim();
    if (!endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('구독 정보가 올바르지 않습니다');
    return (this.prisma as any).pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: String(userAgent || '').slice(0, 300) },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, failCount: 0, userAgent: String(userAgent || '').slice(0, 300) },
    });
  }

  async unsubscribe(endpoint: string) {
    await (this.prisma as any).pushSubscription.deleteMany({ where: { endpoint: String(endpoint || '') } });
    return { ok: true };
  }

  async countFor(userId: string) {
    return (this.prisma as any).pushSubscription.count({ where: { userId } });
  }

  /** 한 사람의 모든 기기로 보낸다 (실패해도 흐름을 막지 않는다) */
  async sendToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
    if (!this.ready) return { sent: 0, removed: 0 };
    const subs: any[] = await (this.prisma as any).pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return { sent: 0, removed: 0 };
    const data = JSON.stringify({
      title: String(payload.title || '알림').slice(0, 100),
      body: String(payload.body || '').slice(0, 300),
      url: payload.url || '/',
      tag: payload.tag || undefined,
    });
    let sent = 0, removed = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any, data, { TTL: 60 * 60 });
        sent++;
        await (this.prisma as any).pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), failCount: 0 } }).catch(() => {});
      } catch (e: any) {
        const code = Number(e?.statusCode || 0);
        if (code === 404 || code === 410) {
          await (this.prisma as any).pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          removed++;
        } else {
          const n = (s.failCount || 0) + 1;
          if (n >= 5) { await (this.prisma as any).pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); removed++; }
          else await (this.prisma as any).pushSubscription.update({ where: { id: s.id }, data: { failCount: n } }).catch(() => {});
          this.logger.warn(`push 실패(${code || '?'}) user=${userId}: ${String(e?.body || e?.message || e).slice(0, 120)}`);
        }
      }
    }
    return { sent, removed };
  }

  /** 알림(Notification) 한 건을 사람이 읽을 문구로 바꿔 푸시 */
  async sendForNotification(userId: string, n: { type: string; subjectType?: string; subjectId?: string; payload?: any }) {
    const p = n.payload || {};
    const map: Record<string, { title: string; body: string; url: string }> = {
      MessageReceived: { title: `${p.from || '새 메시지'}`, body: String(p.preview || '메시지가 도착했습니다'), url: '/messages' },
      ApprovalRequested: { title: '결재 요청', body: '결재할 문서가 도착했습니다', url: '/approvals/inbox' },
      KpiQuizAssigned: { title: '관리자 시험지', body: `${p.year || ''}년 ${p.month || ''}월 문항이 도착했습니다`, url: '/okr/kpi-quiz' },
      KnowledgeCardDraft: { title: '암묵지 카드 확인', body: String(p.title || '내 기록에서 뽑은 카드가 있습니다'), url: '/knowledge/cards' },
      AgendaPublished: { title: '경영 어젠다 공개', body: String(p.statement || '').slice(0, 120), url: '/okr/agenda' },
      AgendaClaimed: { title: '어젠다 클레임', body: `${p.by || ''} · ${p.item || ''}`, url: '/okr/agenda' },
    };
    const m = map[n.type] || { title: '알림', body: '새 알림이 있습니다', url: '/' };
    return this.sendToUser(userId, { ...m, tag: `${n.type}:${n.subjectId || ''}` });
  }
}
