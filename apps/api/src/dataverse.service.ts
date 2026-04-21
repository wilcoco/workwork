import { Injectable, BadRequestException } from '@nestjs/common';

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
    const resp = await this.get(
      `/api/data/v9.2/msdyn_projecttasks?$filter=${encodeURIComponent(filter)}&$top=10`,
    );
    return resp?.value || [];
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
  ): Promise<{ opsetId: string; pssUpdate: any; execute: any }> {
    const entity: any = {
      '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
      msdyn_projecttaskid: projectTaskId,
    };
    if (fields.description !== undefined) entity.msdyn_description = fields.description;
    if (fields.progress !== undefined) entity.msdyn_progress = fields.progress;
    if (fields.subject !== undefined) entity.msdyn_subject = fields.subject;

    const opsetId = await this.createOperationSet(projectId, 'WorkWork sync-worklog', callers.creatorCallerId);
    if (!opsetId) throw new BadRequestException('Failed to create operation set');
    const pssResp = await this.pssUpdate(opsetId, [entity], callers.creatorCallerId);
    const execResp = await this.executeOperationSet(opsetId, callers.executorCallerId);
    return { opsetId, pssUpdate: pssResp, execute: execResp };
  }
}
