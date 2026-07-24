import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { canViewWorklog } from './lib/worklog-visibility';

class InboxQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @IsString()
  onlyUnread?: string; // 'true' | 'false'

  @IsOptional()
  @IsString()
  type?: string; // filter by notification type (e.g., 'FeedbackAdded')

  @IsOptional()
  @IsString()
  limit?: string;
}

class MarkReadDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;
}

@Controller()
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get('inbox')
  async inbox(@Query() q: InboxQueryDto) {
    const limit = Math.min(parseInt(q.limit || '100', 10) || 100, 200);
    const where: any = { userId: q.userId };
    if (q.onlyUnread === 'true') where.readAt = null;
    if (q.type) where.type = q.type;
    const items = await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });

    // Enrich FeedbackAdded notifications with feedback details
    const feedbackNotifs = items.filter((n: any) => n.type === 'FeedbackAdded' && n.payload?.feedbackId);
    if (feedbackNotifs.length > 0) {
      const feedbackIds = feedbackNotifs.map((n: any) => n.payload.feedbackId);
      const feedbacks = await this.prisma.feedback.findMany({
        where: { id: { in: feedbackIds } },
        include: { author: { select: { id: true, name: true } } },
      });
      const fbMap: Record<string, any> = {};
      for (const fb of feedbacks) fbMap[fb.id] = fb;
      // 수신자가 볼 수 없는 공개범위의 업무일지 댓글은 알림에서도 내용을 노출하지 않는다.
      const recipient = await this.prisma.user.findUnique({ where: { id: String(q.userId) }, select: { id: true, role: true } });
      const wlFbIds = feedbacks.filter((f: any) => f.subjectType === 'Worklog').map((f: any) => String(f.subjectId));
      const wls = wlFbIds.length
        ? await this.prisma.worklog.findMany({ where: { id: { in: Array.from(new Set(wlFbIds)) } }, select: { id: true, visibility: true, createdById: true } })
        : [];
      const wlById = new Map(wls.map((w: any) => [String(w.id), w]));
      for (const n of feedbackNotifs) {
        const fb = fbMap[(n as any).payload?.feedbackId];
        if (fb && fb.subjectType === 'Worklog') {
          const wl = wlById.get(String(fb.subjectId));
          if (!wl || !canViewWorklog(recipient, wl)) continue; // 열람 불가 → enrich 생략
        }
        if (fb) {
          (n as any)._feedback = {
            id: fb.id,
            content: fb.content,
            authorId: fb.authorId,
            authorName: fb.author?.name,
            type: fb.type,
            createdAt: fb.createdAt,
          };
        }
      }
    }

    // 결재류 알림 요약 주입 — 알림함이 원시 코드(subjectType·id) 대신
    // "신청자 · 문서 내용"을 보여주도록 서버에서 채운다.
    const apprNotifs = items.filter((n: any) => ['ApprovalRequested', 'ApprovalGranted', 'ApprovalRejected', 'ApprovalCommented'].includes(String(n.type)));
    if (apprNotifs.length) {
      try {
        const bySubject = new Map<string, string[]>();
        for (const n of apprNotifs) {
          const st = String((n as any).subjectType || '').toUpperCase();
          const arr = bySubject.get(st) || [];
          arr.push(String((n as any).subjectId || ''));
          bySubject.set(st, arr);
        }
        const ids = (k: string) => Array.from(new Set(bySubject.get(k) || [])).filter(Boolean);
        const fmtD = (d: any) => (d ? new Date(new Date(d).getTime() + 9 * 3600000).toISOString().slice(5, 10).replace('-', '/') : '');
        const [atts, cars, logis, trips, wls, procs] = await Promise.all([
          ids('ATTENDANCE').length ? (this.prisma as any).attendanceRequest.findMany({ where: { id: { in: ids('ATTENDANCE') } }, select: { id: true, type: true, date: true, user: { select: { name: true } } } }) : [],
          ids('CAR_DISPATCH').length ? (this.prisma as any).carDispatchRequest.findMany({ where: { id: { in: ids('CAR_DISPATCH') } }, select: { id: true, destination: true, startAt: true, requester: { select: { name: true } } } }) : [],
          ids('LOGISTICS_DISPATCH').length ? (this.prisma as any).logisticsDispatchRequest.findMany({ where: { id: { in: ids('LOGISTICS_DISPATCH') } }, select: { id: true, loadingPlace: true, unloadingPlace: true, requester: { select: { name: true } } } }) : [],
          ids('BUSINESS_TRIP').length ? (this.prisma as any).businessTripRequest.findMany({ where: { id: { in: ids('BUSINESS_TRIP') } }, select: { id: true, destination: true, departureAt: true, requester: { select: { name: true } } } }) : [],
          ids('WORKLOG').length ? (this.prisma as any).worklog.findMany({ where: { id: { in: ids('WORKLOG') } }, select: { id: true, note: true, createdBy: { select: { name: true } } } }) : [],
          ids('PROCESS').length ? (this.prisma as any).processInstance.findMany({ where: { id: { in: ids('PROCESS') } }, select: { id: true, title: true, startedBy: { select: { name: true } } } }) : [],
        ]);
        const ATT_KO: Record<string, string> = { OT: 'OT', VACATION: '휴가', PARENTAL_LEAVE: '육아휴직', PUBLIC_DUTY: '공가', EARLY_LEAVE: '조퇴', FLEXIBLE: '유연근무', HOLIDAY_WORK: '휴일근무', HOLIDAY_REST: '대체휴무' };
        const sm = new Map<string, string>();
        for (const a of atts) sm.set(`ATTENDANCE:${a.id}`, `${a.user?.name || ''} · [${ATT_KO[String(a.type)] || a.type}] ${fmtD(a.date)}`);
        for (const c of cars) sm.set(`CAR_DISPATCH:${c.id}`, `${c.requester?.name || ''} · [배차] ${fmtD(c.startAt)} ${c.destination || ''}`);
        for (const l of logis) sm.set(`LOGISTICS_DISPATCH:${l.id}`, `${l.requester?.name || ''} · [물류] ${l.loadingPlace || ''}→${l.unloadingPlace || ''}`);
        for (const t of trips) sm.set(`BUSINESS_TRIP:${t.id}`, `${t.requester?.name || ''} · [출장] ${fmtD(t.departureAt)} ${t.destination || ''}`);
        for (const w of wls) sm.set(`WORKLOG:${w.id}`, `${w.createdBy?.name || ''} · ${String(w.note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '(업무일지)'}`);
        for (const pr of procs) sm.set(`PROCESS:${pr.id}`, `${pr.startedBy?.name || ''} · [프로세스] ${String(pr.title || '').slice(0, 40)}`);
        for (const n of apprNotifs) {
          const key = `${String((n as any).subjectType || '').toUpperCase()}:${(n as any).subjectId}`;
          const summary = sm.get(key);
          if (summary) (n as any)._summary = summary;
        }
      } catch { /* 요약 실패는 목록 표시에 영향 없음 */ }
    }

    return { items };
  }

  @Post('notifications/:id/read')
  async markRead(@Param('id') id: string, @Body() _dto: MarkReadDto) {
    const n = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return n;
  }
}
