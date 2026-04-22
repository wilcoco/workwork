import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Dataverse (Project for the Web / Planner Premium) client.
 *
 * Uses client_credentials OAuth flow with an Application User registered
 * in the Dataverse environment.
 *
 * Required env vars:
 *  - DATAVERSE_ENV_URL        e.g. https://org82a309df.crm21.dynamics.com
 *  - DATAVERSE_TENANT_ID
 *  - DATAVERSE_CLIENT_ID
 *  - DATAVERSE_CLIENT_SECRET
 */
@Injectable()
export class DataverseService {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  isConfigured(): boolean {
    return !!(
      process.env.DATAVERSE_ENV_URL &&
      process.env.DATAVERSE_TENANT_ID &&
      process.env.DATAVERSE_CLIENT_ID &&
      process.env.DATAVERSE_CLIENT_SECRET
    );
  }

  getEnvUrl(): string {
    const url = process.env.DATAVERSE_ENV_URL || '';
    return url.replace(/\/+$/, '');
  }

  /** Fetch a Dataverse access token via client_credentials flow (cached). */
  async getToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Dataverse not configured. Set DATAVERSE_* env vars.');
    }
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 60_000 > now) {
      return this.cachedToken.token;
    }

    const tenantId = process.env.DATAVERSE_TENANT_ID!;
    const clientId = process.env.DATAVERSE_CLIENT_ID!;
    const clientSecret = process.env.DATAVERSE_CLIENT_SECRET!;
    const envUrl = this.getEnvUrl();

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: `${envUrl}/.default`,
        }).toString(),
      },
    );

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => '');
      throw new BadRequestException(
        `Dataverse token fetch failed (${tokenRes.status}): ${text.slice(0, 300)}`,
      );
    }

    const data: any = await tokenRes.json();
    const token = String(data.access_token || '');
    const expiresIn = Number(data.expires_in || 3600);
    this.cachedToken = { token, expiresAt: now + expiresIn * 1000 };
    return token;
  }

  /** Build common headers, optionally with impersonation. */
  private buildHeaders(token: string, callerSystemUserId?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    };
    if (callerSystemUserId) {
      h['MSCRMCallerID'] = callerSystemUserId;
    }
    return h;
  }

  /** GET from Dataverse Web API. path starts with '/api/data/v9.2/...' */
  async get(path: string, callerSystemUserId?: string): Promise<any> {
    const token = await this.getToken();
    const url = `${this.getEnvUrl()}${path}`;
    const res = await fetch(url, {
      headers: this.buildHeaders(token, callerSystemUserId),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        `Dataverse GET ${path} failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** PATCH to Dataverse Web API. */
  async patch(path: string, body: any, callerSystemUserId?: string): Promise<any> {
    const token = await this.getToken();
    const url = `${this.getEnvUrl()}${path}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.buildHeaders(token, callerSystemUserId),
        'Content-Type': 'application/json',
        'If-Match': '*',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        `Dataverse PATCH ${path} failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Find a msdyn_projecttask by its Planner task ID.
   * Returns the Dataverse record or null if not found.
   *
   * NOTE: The exact mapping field is not officially documented.
   * We try common candidates and inspect the schema on first use.
   */
  async findProjectTaskByPlannerId(plannerTaskId: string): Promise<any | null> {
    const candidates = [
      'msdyn_plannertaskid',
      'msdyn_sourceid',
      'msdyn_externaltaskid',
      'msdyn_externalid',
      'msdyn_identifier',
    ];
    for (const field of candidates) {
      try {
        const escaped = plannerTaskId.replace(/'/g, "''");
        const resp = await this.get(
          `/api/data/v9.2/msdyn_projecttasks?$filter=${field} eq '${escaped}'&$top=1`,
        );
        const records = resp?.value || [];
        if (records.length > 0) return { ...records[0], _matchedField: field };
      } catch {
        // Field might not exist on this tenant's schema — try next
      }
    }
    return null;
  }

  /**
   * Find msdyn_projecttask records by subject (title).
   * Optionally filter by parent project GUID.
   */
  async findProjectTasksBySubject(
    subject: string,
    projectId?: string,
  ): Promise<any[]> {
    const escaped = subject.replace(/'/g, "''");
    let filter = `msdyn_subject eq '${escaped}'`;
    if (projectId) {
      filter += ` and _msdyn_project_value eq ${projectId}`;
    }
    const select = [
      'msdyn_projecttaskid',
      'msdyn_subject',
      'msdyn_progress',
      'msdyn_description',
      'msdyn_outlinelevel',
      'msdyn_displaysequence',
      '_msdyn_project_value',
      '_msdyn_parenttask_value',
      '_msdyn_projectbucket_value',
    ].join(',');
    const resp = await this.get(
      `/api/data/v9.2/msdyn_projecttasks?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=10`,
    );
    return resp?.value || [];
  }

  /**
   * Walk up the _msdyn_parenttask_value chain to build the full parent hierarchy (breadcrumb).
   * Returns an array ordered from root → direct parent (not including the task itself).
   */
  async buildTaskParentChain(taskId: string): Promise<Array<{ id: string; subject: string; outlineLevel?: number }>> {
    const chain: Array<{ id: string; subject: string; outlineLevel?: number }> = [];
    let cursor: string | null = taskId;
    const visited = new Set<string>();
    // Safety cap: Project for the Web typically allows ~10 levels; 20 is a hard stop
    for (let i = 0; i < 20 && cursor; i++) {
      if (visited.has(cursor)) break; // cycle guard
      visited.add(cursor);
      const t: any = await this.get(
        `/api/data/v9.2/msdyn_projecttasks(${cursor})?$select=msdyn_projecttaskid,msdyn_subject,msdyn_outlinelevel,_msdyn_parenttask_value`,
      ).catch(() => null);
      if (!t) break;
      const parentId: string | null = t?._msdyn_parenttask_value || null;
      if (!parentId) break;
      const parent: any = await this.get(
        `/api/data/v9.2/msdyn_projecttasks(${parentId})?$select=msdyn_projecttaskid,msdyn_subject,msdyn_outlinelevel,_msdyn_parenttask_value`,
      ).catch(() => null);
      if (!parent) break;
      chain.unshift({
        id: parent.msdyn_projecttaskid,
        subject: parent.msdyn_subject,
        outlineLevel: parent.msdyn_outlinelevel,
      });
      cursor = parent._msdyn_parenttask_value || null;
    }
    return chain;
  }

  /** Fetch a sample msdyn_project record to inspect its schema. */
  async getSampleProject(): Promise<any | null> {
    try {
      const resp = await this.get('/api/data/v9.2/msdyn_projects?$top=1');
      return resp?.value?.[0] || null;
    } catch {
      return null;
    }
  }

  /** Find msdyn_project records by subject (project name). */
  async findProjectsBySubject(subject: string): Promise<any[]> {
    const escaped = subject.replace(/'/g, "''");
    const filter = `msdyn_subject eq '${escaped}'`;
    const resp = await this.get(
      `/api/data/v9.2/msdyn_projects?$filter=${encodeURIComponent(filter)}&$top=10&$select=msdyn_projectid,msdyn_subject,msdyn_plannerlastsavedrevisiontoken,msdyn_plannerreplicationstate`,
    );
    return resp?.value || [];
  }

  /**
   * Get a msdyn_project by ID, returning only selected Planner-integration fields.
   */
  async getProjectPlannerInfo(projectId: string): Promise<any | null> {
    try {
      const resp = await this.get(
        `/api/data/v9.2/msdyn_projects(${projectId})?$select=msdyn_projectid,msdyn_subject,msdyn_plannerlastsavedrevisiontoken,msdyn_plannerreplicationstate`,
      );
      return resp;
    } catch {
      return null;
    }
  }

  /** PATCH msdyn_projecttask by its Dataverse GUID (direct — blocked by PSS plugin). */
  async patchProjectTask(
    projectTaskId: string,
    fields: { description?: string; progress?: number; subject?: string },
  ): Promise<any> {
    const body: any = {};
    if (fields.description !== undefined) body.msdyn_description = fields.description;
    if (fields.progress !== undefined) body.msdyn_progress = fields.progress;
    if (fields.subject !== undefined) body.msdyn_subject = fields.subject;
    return this.patch(
      `/api/data/v9.2/msdyn_projecttasks(${projectTaskId})`,
      body,
    );
  }

  /**
   * Create a Planner reference (attachment) record on a Project for the Web task.
   * Writes directly to msdyn_projecttaskattachment — same table the Planner UI reads from,
   * so the attachment becomes visible in Planner/Teams UI's 첨부 파일 area even for Premium.
   */
  async createTaskAttachment(
    projectTaskId: string,
    payload: { name: string; url: string; linkType?: string },
    callerSystemUserId?: string,
  ): Promise<any> {
    const token = await this.getToken();
    const body: any = {
      msdyn_name: payload.name,
      msdyn_linkuri: payload.url,
      msdyn_linktype: payload.linkType || 'Other',
      // Navigation property name (PascalCase) — NOT the logical attribute name.
      // Relationship schema: msdyn_msdyn_projecttask_msdyn_projecttaskattachment_Task
      'msdyn_Task@odata.bind': `/msdyn_projecttasks(${projectTaskId})`,
    };
    const url = `${this.getEnvUrl()}/api/data/v9.2/msdyn_projecttaskattachments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(token, callerSystemUserId),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        `Dataverse createTaskAttachment failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }
    try { return JSON.parse(text); } catch { return text; }
  }

  /** POST to Dataverse Web API (for custom actions). */
  async post(path: string, body: any, callerSystemUserId?: string): Promise<any> {
    const token = await this.getToken();
    const url = `${this.getEnvUrl()}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(token, callerSystemUserId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        `Dataverse POST ${path} failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Find a Dataverse systemuser by email/UPN. Used to populate MSCRMCallerID
   * so we can impersonate a licensed user (Project Plan) when calling PSS APIs.
   */
  async findSystemUserByEmail(email: string): Promise<any | null> {
    const escaped = email.replace(/'/g, "''");
    const filter = `internalemailaddress eq '${escaped}' or domainname eq '${escaped}'`;
    const resp = await this.get(
      `/api/data/v9.2/systemusers?$filter=${encodeURIComponent(filter)}&$select=systemuserid,fullname,internalemailaddress,domainname,azureactivedirectoryobjectid,isdisabled&$top=1`,
    );
    return resp?.value?.[0] || null;
  }

  async createOperationSet(projectId: string, description: string, callerSystemUserId?: string): Promise<string> {
    const resp = await this.post('/api/data/v9.2/msdyn_CreateOperationSetV1', {
      ProjectId: projectId,
      Description: description,
    }, callerSystemUserId);
    return String(
      resp?.OperationSetId ||
        resp?.operationSetId ||
        resp?.Id ||
        resp?.id ||
        resp?.msdyn_operationsetid ||
        (typeof resp === 'string' ? resp : ''),
    );
  }

  async pssUpdate(operationSetId: string, entities: any[], callerSystemUserId?: string): Promise<any> {
    return this.post('/api/data/v9.2/msdyn_PssUpdateV2', {
      OperationSetId: operationSetId,
      EntityCollection: entities,
    }, callerSystemUserId);
  }

  async executeOperationSet(operationSetId: string, callerSystemUserId?: string): Promise<any> {
    return this.post('/api/data/v9.2/msdyn_ExecuteOperationSetV1', {
      OperationSetId: operationSetId,
    }, callerSystemUserId);
  }

  /**
   * Update a Project for the Web task via PSS operation set (full 3-step flow).
   *
   * callers:
   *   - creatorCallerId: impersonation user for Create + PssUpdate (needs prvCreatemsdyn_operationset)
   *   - executorCallerId: impersonation user for Execute (needs Project Plan license)
   *   Either can be undefined → runs as the Application User directly.
   */
  async updateProjectTaskViaOperationSet(
    projectTaskId: string,
    projectId: string,
    fields: { description?: string; progress?: number; subject?: string },
    callers: { creatorCallerId?: string; executorCallerId?: string } = {},
    attachments: Array<{ name: string; url: string; linkType?: string }> = [],
  ): Promise<{ opsetId: string; pssUpdate: any; execute: any; attachmentIds: string[] }> {
    const entities: any[] = [];

    // Task update entity
    const taskEntity: any = {
      '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
      msdyn_projecttaskid: projectTaskId,
    };
    if (fields.description !== undefined) taskEntity.msdyn_description = fields.description;
    if (fields.progress !== undefined) taskEntity.msdyn_progress = fields.progress;
    if (fields.subject !== undefined) taskEntity.msdyn_subject = fields.subject;
    if (Object.keys(taskEntity).length > 2) entities.push(taskEntity);

    // Attachment create entities (one per file) — new GUID triggers Create
    const attachmentIds: string[] = [];
    for (const att of attachments) {
      if (!att?.url) continue;
      const newId = randomUUID();
      attachmentIds.push(newId);
      entities.push({
        '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttaskattachment',
        msdyn_projecttaskattachmentid: newId,
        msdyn_name: att.name || '첨부파일',
        msdyn_linkuri: att.url,
        msdyn_linktype: att.linkType || 'Other',
        'msdyn_Task@odata.bind': `/msdyn_projecttasks(${projectTaskId})`,
      });
    }

    const opsetId = await this.createOperationSet(projectId, 'WorkWork sync-worklog', callers.creatorCallerId);
    if (!opsetId) throw new BadRequestException('Failed to create operation set');
    const pssResp = await this.pssUpdate(opsetId, entities, callers.creatorCallerId);
    const execResp = await this.executeOperationSet(opsetId, callers.executorCallerId);
    return { opsetId, pssUpdate: pssResp, execute: execResp, attachmentIds };
  }
}
