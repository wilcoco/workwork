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
    if (t === 'ApprovalRequested') return `${base}/approvals/inbox`;
    if (t === 'HelpRequested') return `${base}/coops/inbox`;
    if (t === 'Delegated') return `${base}/me/goals`;
    return base;
  }

  private buildPreviewText(n: AppNotificationLike): string {
    const t = String(n?.type || '').trim();
    if (t === 'ApprovalRequested') return '결재 요청이 도착했습니다.';
    if (t === 'HelpRequested') return '업무협조 요청이 도착했습니다.';
    if (t === 'Delegated') return '업무가 위임되었습니다.';
    return '새 알림이 도착했습니다.';
  }

  async sendActivityNotification(userIdOrUpn: string, body: GraphSendActivityNotificationRequestBody): Promise<void> {
    try {
      const token = await this.getGraphToken();
      if (!token) return;

      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userIdOrUpn)}/teamwork/sendActivityNotification`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 500);
        this.logger.error(`sendActivityNotification failed (${res.status})${snippet ? `: ${snippet}` : ''}`);
      }
    } catch (e) {
      this.logger.error(`sendActivityNotification error: ${this.formatError(e)}`, (e as any)?.stack);
    }
  }

  async sendForNotification(recipient: AppUserLike, notification: AppNotificationLike): Promise<void> {
    try {
      const recipientKey = String(recipient?.entraOid || recipient?.teamsUpn || recipient?.email || '').trim();
      if (!recipientKey) return;

      const preview = this.buildPreviewText(notification);
      const webUrl = this.buildWebUrlForNotification(notification);

      const body: GraphSendActivityNotificationRequestBody = {
        topic: { source: 'text', value: preview, webUrl },
        activityType: String(notification?.type || 'Notification'),
        previewText: { content: preview },
        recipient: {
          '@odata.type': 'microsoft.graph.aadUserNotificationRecipient',
          userId: recipientKey,
        },
      };

      await this.sendActivityNotification(recipientKey, body);
    } catch (e) {
      this.logger.error(`teams notification failed: ${this.formatError(e)}`, (e as any)?.stack);
    }
  }
}
