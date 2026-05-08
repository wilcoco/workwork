import { Injectable, Logger } from '@nestjs/common';
import type { GraphSendActivityNotificationRequestBody } from './teams-notification.types';

type AppNotificationLike = {
  id: string;
  userId: string;
  type: string;
  subjectType: string;
  subjectId: string;
  payload?: any;
};

type AppUserLike = {
  id: string;
  email: string;
  teamsUpn?: string | null;
  entraOid?: string | null;
  name?: string | null;
};

@Injectable()
export class TeamsNotificationService {
  private readonly logger = new Logger(TeamsNotificationService.name);

  private getJwtHint(token: string): string {
    try {
      const parts = String(token || '').split('.');
      if (parts.length < 2) return '';
      let b64 = String(parts[1] || '').replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4;
      if (pad) b64 = b64 + '='.repeat(4 - pad);
      const raw = Buffer.from(b64, 'base64').toString('utf8');
      const j: any = raw ? JSON.parse(raw) : null;
      if (!j) return '';

      const out: string[] = [];
      const aud = String(j?.aud || '').trim();
      const tid = String(j?.tid || '').trim();
      const scp = String(j?.scp || '').trim();
      const rolesArr = Array.isArray(j?.roles) ? j.roles : [];
      const roles = (rolesArr || []).map((r: any) => String(r || '').trim()).filter(Boolean).join(',');

      if (aud) out.push(`aud=${aud}`);
      if (tid) out.push(`tid=${tid}`);
      if (roles) out.push(`roles=${roles}`);
      if (scp) out.push(`scp=${scp}`);
      if (!roles && !scp) out.push('roles/scp=empty');

      return out.length ? out.join(' ') : '';
    } catch {
      return '';
    }
  }

  private getGraphConfigOrNull(): { tenantId: string; clientId: string; clientSecret: string } | null {
    const tenantId = String(process.env.MS_GRAPH_TENANT_ID || process.env.ENTRA_TENANT_ID || '').trim();
    const clientId = String(process.env.MS_GRAPH_CLIENT_ID || process.env.ENTRA_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.MS_GRAPH_CLIENT_SECRET || process.env.ENTRA_CLIENT_SECRET || '').trim();
    if (!tenantId || !clientId || !clientSecret) return null;
    return { tenantId, clientId, clientSecret };
  }

  private getWebBase(): string {
    const configured = String(process.env.WEB_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    return 'http://localhost:5173';
  }

  private formatError(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e || 'unknown error');
  }

  private async getGraphToken(): Promise<string | null> {
    try {
      const cfg = this.getGraphConfigOrNull();
      if (!cfg) {
        this.logger.error('graph config missing (MS_GRAPH_* or ENTRA_*)');
        return null;
      }
      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
      const form = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      });

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });

      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String(json?.error_description || json?.error || `graph token failed (${res.status})`);
        this.logger.error(msg);
        return null;
      }

      const token = String(json?.access_token || '').trim();
      if (!token) {
        this.logger.error('graph token missing access_token');
        return null;
      }
      return token;
    } catch (e) {
      this.logger.error(`graph token error: ${this.formatError(e)}`, (e as any)?.stack);
      return null;
    }
  }

  private buildWebUrlForNotification(n: AppNotificationLike): string {
    const base = this.getWebBase();
    const t = String(n?.type || '').trim();
    const subjectType = String(n?.subjectType || '').trim();
    const subjectId = String(n?.subjectId || '').trim();

    // Route by notification TYPE first (the action the user should take).
    if (t === 'ApprovalRequested') return `${base}/approvals/inbox`;
    if (t === 'HelpRequested') return `${base}/coops/inbox`;
    if (t === 'Delegated') return `${base}/me/goals`;
    if (t === 'ProcessStarted' || t === 'ProcessTaskReady') {
      if (subjectId) return `${base}/process/instances/${encodeURIComponent(subjectId)}?return=${encodeURIComponent('/process/my')}`;
      return `${base}/process/my`;
    }

    // For other types, route by subject.
    if (subjectType === 'Worklog' && subjectId) {
      return `${base}/worklogs/${encodeURIComponent(subjectId)}`;
    }
    if (subjectType === 'ATTENDANCE') {
      return `${base}/attendance/request`;
    }
    if (subjectType === 'CAR_DISPATCH') {
      return `${base}/dispatch/corporate`;
    }
    if (subjectType === 'PROCESS' && subjectId) {
      return `${base}/process/instances/${encodeURIComponent(subjectId)}?return=${encodeURIComponent('/process/my')}`;
    }
    if (subjectType === 'HelpTicket') {
      return `${base}/coops/inbox`;
    }
    if (subjectType === 'Delegation') {
      return `${base}/me/goals`;
    }

    return base;
  }

  private isTeamsDeepLink(url: string): boolean {
    const u = String(url || '').trim();
    if (!u) return false;
    return /^https:\/\/([a-z0-9-]+\.)?teams\.microsoft\.com\/l\//i.test(u);
  }

  private buildTeamsTabDeepLink(n: AppNotificationLike): string {
    const appId = String(process.env.TEAMS_APP_ID || '9408e1af-1dae-4fba-8626-1938b9531207').trim();
    const appUrl = this.buildWebUrlForNotification(n);
    return `https://teams.microsoft.com/l/entity/${appId}/index?webUrl=${encodeURIComponent(appUrl)}`;
  }

  private buildTeamsTopicWebUrl(recipient: AppUserLike): string {
    const configured = String(process.env.TEAMS_ACTIVITY_WEB_URL || process.env.TEAMS_NOTIFICATION_WEB_URL || '').trim();
    if (this.isTeamsDeepLink(configured)) return configured;

    const upnOrEmail = String(recipient?.teamsUpn || recipient?.email || '').trim();
    if (upnOrEmail) {
      return `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(upnOrEmail)}`;
    }

    return 'https://teams.microsoft.com/l/chat/0/0';
  }

  private buildTopicValue(n: AppNotificationLike): string {
    const t = String(n?.type || '').trim();
    const sender = String((n as any)?._senderName || '').trim();
    let msg: string;
    if (t === 'ApprovalRequested') {
      msg = sender ? `[${sender}] 결재 요청` : '결재 요청이 도착했습니다.';
    } else if (t === 'HelpRequested') {
      msg = sender ? `[${sender}] 업무협조 요청` : '업무협조 요청이 도착했습니다.';
    } else if (t === 'Delegated') {
      msg = sender ? `[${sender}] 업무 위임` : '업무가 위임되었습니다.';
    } else if (t === 'ProcessStarted') {
      msg = sender ? `[${sender}] 프로세스 시작` : '프로세스가 시작되었습니다.';
    } else if (t === 'ProcessTaskReady') {
      msg = '내 단계가 시작되었습니다.';
    } else {
      msg = '새 알림';
    }
    // Graph API topic.value max 128 chars
    return msg.slice(0, 128);
  }

  private buildPreviewText(n: AppNotificationLike): string {
    const t = String(n?.type || '').trim();
    const sender = String((n as any)?._senderName || '').trim();
    const title = String((n as any)?._subjectTitle || '').trim();
    const deepUrl = this.buildWebUrlForNotification(n);

    const parts: string[] = [];

    // Line 1: main message with sender
    if (t === 'ApprovalRequested') {
      parts.push(sender ? `[${sender}] 결재 요청이 도착했습니다.` : '결재 요청이 도착했습니다.');
    } else if (t === 'HelpRequested') {
      parts.push(sender ? `[${sender}] 업무협조 요청이 도착했습니다.` : '업무협조 요청이 도착했습니다.');
    } else if (t === 'Delegated') {
      parts.push(sender ? `[${sender}] 업무가 위임되었습니다.` : '업무가 위임되었습니다.');
    } else if (t === 'ProcessStarted') {
      parts.push(sender ? `[${sender}] 프로세스가 시작되었습니다.` : '프로세스가 시작되었습니다.');
    } else if (t === 'ProcessTaskReady') {
      const name = String(n?.payload?.taskName || '').trim();
      const stage = String(n?.payload?.stageLabel || '').trim();
      const label = [name, stage].filter(Boolean).join(' · ');
      parts.push(label ? `내 단계 시작: ${label}` : '내 단계가 시작되었습니다.');
    } else {
      parts.push('새 알림이 도착했습니다.');
    }

    // Line 2: subject title if available
    if (title) parts.push(`제목: ${title}`);

    // Line 3: explicit clickable link
    if (deepUrl) parts.push(deepUrl);

    return parts.join('\n');
  }

  private async formatGraphFailure(res: Response, token: string): Promise<string> {
    const parts: string[] = [];
    const reqId = String(res.headers.get('request-id') || res.headers.get('x-ms-request-id') || '').trim();
    const diag = String(res.headers.get('x-ms-ags-diagnostic') || '').trim();
    const www = String(res.headers.get('www-authenticate') || '').trim();
    if (reqId) parts.push(`request-id=${reqId}`);
    if (diag) parts.push(`diag=${diag.replace(/\s+/g, ' ').slice(0, 200)}`);
    if (www) parts.push(www.replace(/\s+/g, ' ').slice(0, 200));

    const jwtHint = this.getJwtHint(token);
    if (jwtHint) parts.push(jwtHint);

    const ct = String(res.headers.get('content-type') || '');
    const text = await res.text().catch(() => '');
    if (text) {
      if (ct.includes('application/json')) {
        try {
          const j: any = JSON.parse(text);
          const code = String(j?.error?.code || '').trim();
          const msg = String(j?.error?.message || '').trim();
          const combined = [code, msg].filter(Boolean).join(' - ');
          if (combined) parts.push(combined);
        } catch {
          const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 500);
          if (snippet) parts.push(snippet);
        }
      } else {
        const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 500);
        if (snippet) parts.push(snippet);
      }
    }

    return parts.length ? `: ${parts.join(' | ')}` : '';
  }

  private async lookupAadUserId(token: string, upnOrEmail: string): Promise<string | null> {
    try {
      const key = String(upnOrEmail || '').trim();
      if (!key) return null;

      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(key)}?$select=id`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const detail = await this.formatGraphFailure(res, token);
        this.logger.error(`graph user lookup failed (${res.status})${detail}`);
        return null;
      }

      const json: any = await res.json().catch(() => ({}));
      const id = String(json?.id || '').trim();
      if (!id) {
        this.logger.error('graph user lookup missing id');
        return null;
      }
      return id;
    } catch (e) {
      this.logger.error(`graph user lookup error: ${this.formatError(e)}`, (e as any)?.stack);
      return null;
    }
  }

  private async sendActivityNotificationWithToken(
    userIdOrUpn: string,
    token: string,
    body: GraphSendActivityNotificationRequestBody,
  ): Promise<void> {
    try {
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userIdOrUpn)}/teamwork/sendActivityNotification`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await this.formatGraphFailure(res, token);
        this.logger.error(`sendActivityNotification failed (${res.status})${detail}`);
      }
    } catch (e) {
      this.logger.error(`sendActivityNotification error: ${this.formatError(e)}`, (e as any)?.stack);
    }
  }

  async sendActivityNotification(userIdOrUpn: string, body: GraphSendActivityNotificationRequestBody): Promise<void> {
    try {
      const token = await this.getGraphToken();
      if (!token) return;

      await this.sendActivityNotificationWithToken(userIdOrUpn, token, body);
    } catch (e) {
      this.logger.error(`sendActivityNotification error: ${this.formatError(e)}`, (e as any)?.stack);
    }
  }

  async sendForNotification(recipient: AppUserLike, notification: AppNotificationLike): Promise<void> {
    try {
      const token = await this.getGraphToken();
      if (!token) return;

      const upnOrEmail = String(recipient?.teamsUpn || recipient?.email || '').trim();
      const directAadId = String(recipient?.entraOid || '').trim();
      const resolvedAadId = directAadId || (upnOrEmail ? await this.lookupAadUserId(token, upnOrEmail) : null);
      if (!resolvedAadId) {
        const uid = String(recipient?.id || '').trim();
        const nType = String(notification?.type || '').trim();
        this.logger.error(`teams notification recipient missing entraOid (user=${uid || 'unknown'} type=${nType || 'unknown'})`);
        return;
      }

      // Use Teams tab deep link so clicking the notification opens the app page inside Teams.
      const topicValue = this.buildTopicValue(notification);
      const webUrl = this.buildTeamsTabDeepLink(notification);

      const body: GraphSendActivityNotificationRequestBody = {
        topic: { source: 'text', value: topicValue, webUrl },
        activityType: String(notification?.type || 'Notification'),
        previewText: { content: topicValue },
        recipient: {
          '@odata.type': '#microsoft.graph.aadUserNotificationRecipient',
          userId: resolvedAadId,
        },
      };

      await this.sendActivityNotificationWithToken(resolvedAadId, token, body);
    } catch (e) {
      this.logger.error(`teams notification failed: ${this.formatError(e)}`, (e as any)?.stack);
    }
  }
}
