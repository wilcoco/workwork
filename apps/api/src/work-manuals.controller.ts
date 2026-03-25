import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';
import { BASE_TYPES, BASE_TYPE_MAP, QUESTION_SETS, TACIT_KNOWLEDGE_QUESTIONS, OPTION_GROUPS, AI_SYSTEM_PROMPT, recommendOptions, detectSecurityInfo, type PhaseData } from './manual-externalization.constants';
import { callAI, type AIModel } from './llm/ai-client';

class CreateWorkManualDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  title!: string;

  @IsOptional() @IsString()
  content?: string;

  @IsOptional() @IsString()
  authorName?: string;

  @IsOptional() @IsString()
  authorTeamName?: string;

  @IsOptional() @IsString()
  department?: string;

  @IsOptional() @IsString()
  baseType?: string;

  @IsOptional()
  options?: any;

  @IsOptional()
  phaseData?: any;

  currentPhase?: number;
}

class UpdateWorkManualDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  title!: string;

  @IsOptional() @IsString()
  content?: string;

  @IsOptional() @IsString()
  authorName?: string;

  @IsOptional() @IsString()
  authorTeamName?: string;

  @IsOptional() @IsString()
  department?: string;

  @IsOptional() @IsString()
  baseType?: string;

  @IsOptional()
  options?: any;

  @IsOptional()
  phaseData?: any;

  currentPhase?: number;
}

class AiBpmnDto {
  @IsString() @IsNotEmpty()
  userId!: string;
  aiModel?: string; // 'claude' | 'openai'
}

class AiQuestionsDto {
  @IsString() @IsNotEmpty()
  userId!: string;
  layer?: string; // skeleton | roles | io | decisions | exceptions | timing
  aiModel?: string; // 'claude' | 'openai'
}

const LAYER_FIELDS: Record<string, string[]> = {
  skeleton: ['taskType', 'purpose', 'method'],
  roles: ['assigneeHint', 'approvalRouteType', 'approvalRoleCodes', 'cooperationTarget'],
  io: ['inputs', 'outputs', 'relatedDocs', 'tools', 'worklogHint'],
  decisions: ['branches', 'completionCondition'],
  exceptions: ['risks', 'checkItems', 'supplierName', 'supplierContact'],
  timing: ['deadlineOffsetDays', 'slaHours', 'emailTo', 'emailCc', 'emailSubject'],
};

const LAYER_LABELS: Record<string, string> = {
  skeleton: '프로세스 골격',
  roles: '역할과 담당자',
  io: '입력물/산출물',
  decisions: '판단과 분기',
  exceptions: '예외와 에스컬레이션',
  timing: '시간과 SLA',
};

const LAYER_AI_FOCUS: Record<string, string> = {
  skeleton: '프로세스의 전체 단계 구조, 순서, 시작/종료 조건에 집중하세요. 빠진 단계나 순서 오류를 찾으세요.',
  roles: '각 단계의 담당자, 결재자, 협조 대상에 집중하세요. 누가 수행하고 누가 검토/승인하는지 확인하세요.',
  io: '각 단계에 필요한 입력 자료(도면/양식/파일)와 산출물에 집중하세요. 도구나 시스템도 확인하세요.',
  decisions: '조건 분기와 판단 기준에 집중하세요. 승인/반려 흐름, 조건식, 완료 판단 기준을 확인하세요.',
  exceptions: '예외 상황, 위험 요소, 에스컬레이션 경로에 집중하세요. 이상 발생 시 대응 절차를 확인하세요.',
  timing: '처리 기한, SLA, 알림 설정에 집중하세요. 각 단계의 소요 시간과 지연 시 조치를 확인하세요.',
};

class ApplyAnswersDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsNotEmpty()
  answers!: Array<{ targetStepId?: string; targetField?: string; question: string; answer: string }>;
}

class AiDraftStepsDto {
  @IsString() @IsNotEmpty()
  userId!: string;
  aiModel?: string; // 'claude' | 'openai'
}

class ChangeStatusDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  status!: string;

  @IsOptional() @IsString()
  reviewerId?: string;
}

class ReviewManualDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  decision!: string;

  @IsOptional() @IsString()
  comment?: string;
}

@Controller('work-manuals')
export class WorkManualsController {
  constructor(private prisma: PrismaService) {}

  private async requireUser(userId: string) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id }, include: { orgUnit: true } });
    if (!u) throw new BadRequestException('invalid userId');
    return u;
  }

  private async requireOwner(userId: string, manualId: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const mid = String(manualId || '').trim();
    if (!mid) throw new BadRequestException('id required');
    const m = await (this.prisma as any).workManual.findUnique({ where: { id: mid } });
    if (!m) throw new BadRequestException('manual not found');
    if (String(m.userId) !== uid) throw new ForbiddenException('not allowed');
    return m as any;
  }

  private parseStepsServer(content: string): Array<{ stepId: string; title: string; raw: string; fields: Record<string, boolean> }> {
    const lines = String(content || '').split(/\r?\n/);
    const blocks: Array<{ stepId: string; title: string; lines: string[] }> = [];
    let cur: { stepId: string; title: string; lines: string[] } | null = null;
    for (const line of lines) {
      const m = line.match(/^###\s*STEP\s+(S\d+)\s*\|\s*(.+)\s*$/i);
      if (m) {
        if (cur) blocks.push(cur);
        cur = { stepId: String(m[1]).toUpperCase(), title: String(m[2]).trim(), lines: [] };
        continue;
      }
      if (cur) cur.lines.push(line);
    }
    if (cur) blocks.push(cur);

    return blocks.map(s => {
      const raw = `### STEP ${s.stepId} | ${s.title}\n${s.lines.join('\n')}`.trim();
      const t = `\n${raw}`;
      const fields: Record<string, boolean> = {
        taskType: /\n\s*-\s*taskType\s*:/i.test(t),
        purpose: /\n\s*-\s*목적\s*:/i.test(t),
        assigneeHint: /\n\s*-\s*담당자\s*:/i.test(t),
        method: /\n\s*-\s*작업방법\s*:/i.test(t),
        inputs: /\n\s*-\s*(입력\s*[\/·]|필요자료|입력\s*:)/i.test(t),
        tools: /\n\s*-\s*도구\s*:/i.test(t),
        relatedDocs: /\n\s*-\s*관련문서\s*:/i.test(t),
        outputs: /\n\s*-\s*산출물\s*:/i.test(t),
        checkItems: /\n\s*-\s*확인사항\s*:/i.test(t),
        worklogHint: /\n\s*-\s*업무일지/i.test(t),
        completionCondition: /\n\s*-\s*완료조건\s*:/i.test(t),
        contacts: /\n\s*-\s*연락처\s*:/i.test(t),
        risks: /\n\s*-\s*위험대응\s*:/i.test(t),
        supplierName: /\n\s*-\s*협력사\s*:/i.test(t),
        cooperationTarget: /\n\s*-\s*내부협조\s*:/i.test(t),
        approvalRouteType: /\n\s*-\s*결재선\s*:/i.test(t),
        approvalRoleCodes: /\n\s*-\s*결재역할\s*:/i.test(t),
        deadlineOffsetDays: /\n\s*-\s*기한\s*:/i.test(t),
        slaHours: /\n\s*-\s*SLA\s*:/i.test(t),
        branches: /\n\s*-\s*분기\s*:/i.test(t),
      };
      const ttMatch = raw.match(/-\s*taskType\s*:\s*([A-Za-z_]+)/i);
      (fields as any)._taskType = ttMatch ? String(ttMatch[1]).toUpperCase() : '';
      return { stepId: s.stepId, title: s.title, raw, fields };
    });
  }

  ruleBasedValidation(content: string): {
    questions: Array<{ stepId?: string; targetField?: string; question: string; severity: 'MUST' | 'SHOULD'; source: string }>;
    score: number;
    stepScores: Array<{ stepId: string; title: string; score: number; missingFields: string[] }>;
  } {
    const steps = this.parseStepsServer(content);
    const questions: Array<{ stepId?: string; targetField?: string; question: string; severity: 'MUST' | 'SHOULD'; source: string }> = [];
    const stepScores: Array<{ stepId: string; title: string; score: number; missingFields: string[] }> = [];

    if (!steps.length) {
      return { questions: [{ question: 'STEP 블록이 없습니다. "### STEP S1 | 단계명" 형식으로 작성해 주세요.', severity: 'MUST', source: 'rule' }], score: 0, stepScores: [] };
    }

    for (const step of steps) {
      const { stepId, title, fields } = step;
      const tt = (fields as any)._taskType || '';
      const missing: string[] = [];
      let pts = 0, maxPts = 0;

      const checks: Array<{ field: string; weight: number; sev: 'MUST' | 'SHOULD'; q: string; cond?: boolean }> = [
        { field: 'taskType', weight: 10, sev: 'MUST', q: 'taskType(WORKLOG/APPROVAL/COOPERATION)을 지정해 주세요.' },
        { field: 'purpose', weight: 8, sev: 'SHOULD', q: '이 단계의 목적은 무엇입니까?' },
        { field: 'assigneeHint', weight: 10, sev: 'SHOULD', q: '이 단계의 담당자(역할/팀)는 누구입니까?' },
        { field: 'outputs', weight: 10, sev: 'SHOULD', q: '이 단계 완료 시 어떤 산출물이 만들어집니까?' },
        { field: 'completionCondition', weight: 10, sev: 'SHOULD', q: '완료 판단 기준은 무엇입니까?' },
        { field: 'method', weight: 8, sev: 'SHOULD', q: '구체적 수행 절차와 방법은?' },
        { field: 'inputs', weight: 8, sev: 'SHOULD', q: '필요한 입력 자료(도면/시방서/양식/파일)는?' },
        { field: 'checkItems', weight: 8, sev: 'SHOULD', q: '품질/안전/규정 확인 항목이 있습니까?' },
        { field: 'risks', weight: 5, sev: 'SHOULD', q: '이상 발생 시 대응 절차와 에스컬레이션 경로는?' },
        { field: 'deadlineOffsetDays', weight: 5, sev: 'SHOULD', q: '이 단계의 처리 기한은 며칠입니까?' },
        { field: 'worklogHint', weight: 8, sev: 'SHOULD', q: '업무일지에 기록할 항목(수량/시간/품질수치 등)은?', cond: tt === 'WORKLOG' },
        { field: 'approvalRouteType', weight: 10, sev: 'SHOULD', q: '결재선(SEQUENTIAL/PARALLEL/ANY_ONE)과 결재 역할을 지정해 주세요.', cond: tt === 'APPROVAL' },
        { field: 'branches', weight: 8, sev: 'SHOULD', q: '승인/반려 시 다음 단계 분기를 지정해 주세요.', cond: tt === 'APPROVAL' },
        { field: 'supplierName', weight: 10, sev: 'SHOULD', q: '협력사명과 담당자를 지정해 주세요.', cond: tt === 'COOPERATION' },
      ];

      for (const c of checks) {
        if (c.cond === false) continue;
        maxPts += c.weight;
        if (fields[c.field]) {
          pts += c.weight;
        } else {
          missing.push(c.field);
          questions.push({ stepId, targetField: c.field, question: c.q, severity: c.sev, source: 'rule' });
        }
      }

      stepScores.push({ stepId, title, score: maxPts > 0 ? Math.round((pts / maxPts) * 100) : 0, missingFields: missing });
    }

    const score = stepScores.length > 0 ? Math.round(stepScores.reduce((s, x) => s + x.score, 0) / stepScores.length) : 0;
    return { questions, score, stepScores };
  }

  @Get()
  async list(@Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    await this.requireUser(uid);
    const items = await (this.prisma as any).workManual.findMany({
      where: { userId: uid },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return {
      items: (items || []).map((it: any) => ({
        id: it.id,
        userId: it.userId,
        title: it.title,
        content: it.content,
        authorName: it.authorName || '',
        authorTeamName: it.authorTeamName || '',
        department: it.department || '',
        baseType: it.baseType || '',
        options: it.options || null,
        phaseData: it.phaseData || null,
        currentPhase: it.currentPhase ?? 1,
        version: it.version ?? 1,
        versionUpAt: it.versionUpAt,
        status: it.status || 'DRAFT',
        reviewerId: it.reviewerId || null,
        reviewedAt: it.reviewedAt || null,
        reviewComment: it.reviewComment || null,
        qualityScore: it.qualityScore ?? 0,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      })),
    };
  }

  @Get('review-queue')
  async reviewQueue(@Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const items = await (this.prisma as any).workManual.findMany({
      where: { reviewerId: uid, status: 'REVIEW' },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return {
      items: (items || []).map((it: any) => ({
        id: it.id,
        userId: it.userId,
        title: it.title,
        content: it.content,
        authorName: it.authorName || '',
        authorTeamName: it.authorTeamName || '',
        version: it.version ?? 1,
        status: it.status,
        qualityScore: it.qualityScore ?? 0,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      })),
    };
  }

  @Post()
  async create(@Body() dto: CreateWorkManualDto) {
    const uid = String(dto.userId || '').trim();
    const u = await this.requireUser(uid);
    const title = String(dto.title || '').trim();
    if (!title) throw new BadRequestException('title required');
    const content = dto.content != null ? String(dto.content) : undefined;

    const authorName = String(dto.authorName || '').trim() || String((u as any)?.name || '').trim() || '';
    const authorTeamName = String(dto.authorTeamName || '').trim() || String((u as any)?.orgUnit?.name || '').trim() || '';
    const department = String(dto.department || '').trim() || authorTeamName;
    const baseType = String(dto.baseType || '').trim();
    const options = dto.options != null ? dto.options : undefined;
    const phaseData = dto.phaseData != null ? dto.phaseData : undefined;
    const currentPhase = typeof dto.currentPhase === 'number' ? dto.currentPhase : 1;
    const created = await (this.prisma as any).workManual.create({
      data: { userId: uid, title, content, authorName, authorTeamName, department, baseType, options, phaseData, currentPhase },
    });
    return created;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateWorkManualDto) {
    const uid = String(dto.userId || '').trim();
    const existing = await this.requireOwner(uid, id);
    const title = String(dto.title || '').trim();
    if (!title) throw new BadRequestException('title required');
    const wantsContent = dto.content != null;
    const wantsAuthorName = dto.authorName != null;
    const wantsAuthorTeamName = dto.authorTeamName != null;

    const nextContent = wantsContent ? String(dto.content) : undefined;
    const prevContent = existing?.content != null ? String(existing.content) : '';
    const contentChanged = wantsContent ? String(prevContent || '') !== String(nextContent || '') : false;

    const nextAuthorName = wantsAuthorName ? String(dto.authorName).trim() : String(existing?.authorName || '').trim();
    const nextAuthorTeamName = wantsAuthorTeamName ? String(dto.authorTeamName).trim() : String(existing?.authorTeamName || '').trim();
    const authorNameChanged = wantsAuthorName ? String(existing?.authorName || '').trim() !== nextAuthorName : false;
    const authorTeamChanged = wantsAuthorTeamName ? String(existing?.authorTeamName || '').trim() !== nextAuthorTeamName : false;

    const titleChanged = String(existing?.title || '').trim() !== title;

    const wantsDept = dto.department != null;
    const wantsBaseType = dto.baseType != null;
    const wantsOptions = dto.options != null;
    const wantsPhaseData = dto.phaseData != null;
    const wantsCurrentPhase = dto.currentPhase != null;

    const changed = titleChanged || contentChanged || authorNameChanged || authorTeamChanged
      || wantsDept || wantsBaseType || wantsOptions || wantsPhaseData || wantsCurrentPhase;

    if (!changed) return existing;

    const data: any = {
      title,
      authorName: nextAuthorName,
      authorTeamName: nextAuthorTeamName,
      version: { increment: 1 },
      versionUpAt: new Date(),
    };
    if (wantsContent) data.content = nextContent;
    if (wantsDept) data.department = String(dto.department).trim();
    if (wantsBaseType) data.baseType = String(dto.baseType).trim();
    if (wantsOptions) data.options = dto.options;
    if (wantsPhaseData) data.phaseData = dto.phaseData;
    if (wantsCurrentPhase) data.currentPhase = Number(dto.currentPhase);

    return (this.prisma as any).workManual.update({
      where: { id: String(id) },
      data,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    await this.requireOwner(uid, id);
    await (this.prisma as any).workManual.delete({ where: { id: String(id) } });
    return { ok: true };
  }

  @Post(':id/validate')
  async validate(@Param('id') id: string, @Body() dto: { userId: string }) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const content = String(manual?.content || '').trim();
    return this.ruleBasedValidation(content);
  }

  @Post(':id/status')
  async changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const nextStatus = String(dto.status || '').trim().toUpperCase();
    const current = String(manual.status || 'DRAFT');

    const allowed: Record<string, string[]> = {
      DRAFT: ['REVIEW'],
      REVIEW: ['DRAFT'],
      REJECTED: ['REVIEW', 'DRAFT'],
      APPROVED: ['DRAFT'],
    };
    if (!(allowed[current] || []).includes(nextStatus)) {
      throw new BadRequestException(`Cannot change status from ${current} to ${nextStatus}`);
    }

    const data: any = { status: nextStatus };
    if (nextStatus === 'REVIEW') {
      const reviewerId = String(dto.reviewerId || '').trim();
      if (!reviewerId) throw new BadRequestException('reviewerId required for REVIEW');
      const reviewer = await this.prisma.user.findUnique({ where: { id: reviewerId } });
      if (!reviewer) throw new BadRequestException('reviewer not found');
      data.reviewerId = reviewerId;
      data.reviewComment = null;
      data.reviewedAt = null;
    }

    const content = String(manual.content || '').trim();
    if (nextStatus === 'REVIEW' && content) {
      const v = this.ruleBasedValidation(content);
      data.qualityScore = v.score;
    }

    const updated = await (this.prisma as any).workManual.update({ where: { id }, data });
    return updated;
  }

  @Post(':id/review')
  async reviewManual(@Param('id') id: string, @Body() dto: ReviewManualDto) {
    const uid = String(dto.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const mid = String(id || '').trim();
    const manual = await (this.prisma as any).workManual.findUnique({ where: { id: mid } });
    if (!manual) throw new BadRequestException('manual not found');
    if (String(manual.status) !== 'REVIEW') throw new BadRequestException('manual is not in REVIEW status');
    if (String(manual.reviewerId) !== uid) throw new ForbiddenException('only assigned reviewer can review');

    const decision = String(dto.decision || '').trim().toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw new BadRequestException('decision must be APPROVED or REJECTED');
    }

    const updated = await (this.prisma as any).workManual.update({
      where: { id: mid },
      data: {
        status: decision,
        reviewedAt: new Date(),
        reviewComment: String(dto.comment || '').trim() || null,
      },
    });
    return updated;
  }

  @Post(':id/ai/bpmn')
  async aiBpmn(@Param('id') id: string, @Body() dto: AiBpmnDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const aiModel = (dto.aiModel === 'claude' ? 'claude' : 'openai') as AIModel;

    const title = String(manual?.title || '').trim();
    const content = String(manual?.content || '').trim();
    if (!title) throw new BadRequestException('manual title missing');
    if (!content) throw new BadRequestException('manual content required');

    const clipped = content.length > 12000 ? content.slice(0, 12000) : content;

    const sys = `당신은 업무 메뉴얼을 읽고 BPMN 초안(JSON)만 출력하는 도우미입니다.
반드시 JSON만 출력하세요. 마크다운 코드펜스(\`\`\`)를 사용하지 마세요.

출력 JSON 스키마:
{
  "title": string,
  "bpmnJson": {
    "nodes": Array<{
      id: string,
      type: "start"|"end"|"task"|"gateway_xor"|"gateway_parallel",
      name: string,
      taskType?: "TASK"|"WORKLOG"|"COOPERATION"|"APPROVAL",
      description?: string,
      assigneeHint?: string,
      emailToTemplate?: string,
      emailCcTemplate?: string,
      emailSubjectTemplate?: string,
      emailBodyTemplate?: string
    }>,
    "edges": Array<{ id: string, source: string, target: string, condition?: string }>
  }
}

핵심 규칙:
- nodes에는 start와 end를 반드시 포함
- type=task 노드만 실제 업무 단계(메뉴얼의 STEP에 해당)
- 입력에 없는 STEP(업무 단계)는 새로 만들어내지 마세요. 단, start/end/gateway는 필요하면 생성해도 됩니다.
- 기본은 순차 흐름으로 만들고, 조건 분기가 명확하면 gateway_xor와 edge.condition을 사용
- 최대 20개의 task 노드까지만 생성
- description은 사람이 읽기 좋은 HTML로 정리하세요(<ul><li>...</li></ul> 등)
- 각 task 노드는 taskType을 반드시 포함하세요.
- 원칙: 업무 단계(task)는 반드시 "업무일지(WORKLOG)" 또는 "결재(APPROVAL)" 같은 완료 근거가 있어야 합니다.
  - 기본 taskType은 WORKLOG
  - 결재/결정 단계는 APPROVAL
  - 타팀/타인 요청 단계는 COOPERATION
  - TASK는 예외적으로만 사용(가능하면 사용하지 마세요)

메뉴얼에 다음과 같은 표준 포맷이 있으면 그 구조를 우선 파싱하세요:
- "### STEP S1 | 단계명" 형태의 블록을 하나의 task 노드로 생성
- 각 STEP의 "- taskType: WORKLOG|APPROVAL|COOPERATION|TASK" 값을 taskType에 매핑
- STEP 블록의 목적/입력/산출물/업무일지/완료조건은 description에 요약(HTML)

분기(조건):
- STEP 블록에 "분기"가 있으면 gateway_xor 노드를 생성하고, gateway -> 대상 STEP으로 edge를 만들며 edge.condition에 조건식을 넣으세요.
- 조건식은 런타임에서 아래 형식만 지원합니다:
  - 연산자: ==, !=, &&, ||
  - 좌변: 경로형 변수(예: last.approval.status, startedBy.role, itemCode)
  - 우변: 문자열(따옴표로 감싼 값), 숫자, true/false, null
- 사용 가능 변수 예시: last.approval.status, startedBy.role, itemCode, moldCode, carModelCode, initiativeId`;

    const userMsg = `업무명: ${title}\n\n[업무 메뉴얼]\n${clipped}`;

    // Claude: Tool Use schema for guaranteed JSON structure + Extended Thinking
    const bpmnToolSchema = {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        bpmnJson: {
          type: 'object',
          properties: {
            nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['start', 'end', 'task', 'gateway_xor', 'gateway_parallel'] }, name: { type: 'string' }, taskType: { type: 'string', enum: ['TASK', 'WORKLOG', 'COOPERATION', 'APPROVAL'] }, description: { type: 'string' }, assigneeHint: { type: 'string' } }, required: ['id', 'type', 'name'] } },
            edges: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' }, condition: { type: 'string' } }, required: ['id', 'source', 'target'] } },
          },
          required: ['nodes', 'edges'],
        },
      },
      required: ['title', 'bpmnJson'],
    };

    let parsed: any;
    try {
      const result = await callAI({
        system: sys,
        user: userMsg,
        model: aiModel,
        temperature: 0.2,
        maxTokens: 4096,
        thinking: aiModel === 'claude',
        jsonSchema: aiModel === 'claude' ? { name: 'generate_bpmn', schema: bpmnToolSchema } : undefined,
      });
      parsed = result.parsed;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'AI call failed');
    }

    const outTitle = String(parsed?.title || `${title} 프로세스`).trim() || `${title} 프로세스`;
    const bpmnJson = parsed?.bpmnJson;
    const nodes = Array.isArray(bpmnJson?.nodes) ? bpmnJson.nodes : null;
    const edges = Array.isArray(bpmnJson?.edges) ? bpmnJson.edges : null;
    if (!nodes || !edges) throw new BadRequestException('AI JSON missing bpmnJson.nodes/edges');

    const normalizedNodes = (nodes as any[]).map((n: any) => {
      const type = String(n?.type || '').trim();
      if (type !== 'task') return n;
      const rawTt = String(n?.taskType || '').trim().toUpperCase();
      let nextTt = rawTt || 'WORKLOG';
      if (nextTt === 'TASK') nextTt = 'WORKLOG';
      if (!['WORKLOG', 'APPROVAL', 'COOPERATION'].includes(nextTt)) nextTt = 'WORKLOG';
      return { ...n, taskType: nextTt };
    });

    return { title: outTitle, bpmnJson: { ...bpmnJson, nodes: normalizedNodes, edges }, aiModel };
  }

  @Post(':id/ai/questions')
  async aiQuestions(@Param('id') id: string, @Body() dto: AiQuestionsDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const aiModel = (dto.aiModel === 'claude' ? 'claude' : 'openai') as AIModel;

    const title = String(manual?.title || '').trim();
    const content = String(manual?.content || '').trim();
    if (!title) throw new BadRequestException('manual title missing');
    if (!content) throw new BadRequestException('manual content required');

    const layer = String(dto.layer || '').trim();
    const layerFields = layer && LAYER_FIELDS[layer] ? new Set(LAYER_FIELDS[layer]) : null;
    const layerLabel = layer && LAYER_LABELS[layer] ? LAYER_LABELS[layer] : '';
    const layerFocus = layer && LAYER_AI_FOCUS[layer] ? LAYER_AI_FOCUS[layer] : '';

    // 1) Rule-based validation (full), then filter by layer
    const ruleResult = this.ruleBasedValidation(content);
    const allRuleQuestions = ruleResult.questions;
    const ruleQuestions = layerFields
      ? allRuleQuestions.filter(q => q.targetField && layerFields.has(q.targetField))
      : allRuleQuestions;
    const ruleCaughtSummary = ruleQuestions.map(q => `[${q.stepId || '전체'}] ${q.targetField}: ${q.question}`).join('\n');

    const clipped = content.length > 12000 ? content.slice(0, 12000) : content;

    // 2) Layer-specific AI prompt
    const allowedFields = layerFields ? Array.from(layerFields).join(', ') : 'taskType, purpose, assigneeHint, method, inputs, outputs, tools, relatedDocs, checkItems, worklogHint, completionCondition, contacts, risks, supplierName, supplierContact, cooperationTarget, approvalRouteType, approvalRoleCodes, emailTo, emailSubject, deadlineOffsetDays, slaHours, branches';

    const layerInstruction = layerFocus
      ? `\n\n**현재 분석 레이어: [${layerLabel}]**\n${layerFocus}\n이 레이어에 해당하는 필드(${allowedFields})에 대해서만 질문하세요. 다른 레이어의 질문은 하지 마세요.`
      : '';

    const sys = `당신은 제조업 업무 메뉴얼을 BPMN 프로세스로 전환하기 위해 검토하는 전문 컨설턴트입니다.
반드시 JSON만 출력하세요. 마크다운 코드펜스(\`\`\`)를 사용하지 마세요.
${layerInstruction}

중요: 아래 항목은 이미 규칙 엔진이 검출했으므로 **중복 질문하지 마세요**:
${ruleCaughtSummary || '(없음)'}

당신은 위 항목 외에, 내용이 있지만 모호하거나 불충분한 부분만 질문하세요.

출력 JSON 스키마:
{
  "summary": string (이 레이어에 대한 전체적 평가를 2~3문장으로 서술),
  "issues": Array<{ stepId?: string, issue: string, severity: "MUST"|"SHOULD", suggestion?: string }>,
  "questions": Array<{
    stepId?: string,
    targetStepId?: string,
    targetField?: string,
    question: string,
    severity: "MUST"|"SHOULD",
    reason?: string
  }>
}

targetField 가능한 값: ${allowedFields}

- 메뉴얼에 "### STEP S1 | 단계명" 블록이 있으면 그 구조를 우선 파싱하세요.
- 각 질문에는 반드시 targetStepId(해당 STEP ID)와 targetField(위의 필드명 중 하나)를 포함하세요.
`;

    const userMsg = `업무명: ${title}\n\n[업무 메뉴얼]\n${clipped}`;

    let parsed: any;
    try {
      const result = await callAI({
        system: sys,
        user: userMsg,
        model: aiModel,
        temperature: 0.2,
      });
      parsed = result.parsed;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'AI call failed');
    }

    const summary = String(parsed?.summary || '').trim();
    const aiIssues = Array.isArray(parsed?.issues) ? parsed.issues : [];
    let aiQuestions = (Array.isArray(parsed?.questions) ? parsed.questions : []).map((q: any) => ({ ...q, source: 'ai' }));

    // Filter AI questions to layer fields too
    if (layerFields) {
      aiQuestions = aiQuestions.filter((q: any) => !q.targetField || layerFields.has(q.targetField));
    }

    // 3) Merge: rule questions first (marked as rule), then AI questions
    const mergedQuestions = [
      ...ruleQuestions.map(q => ({ ...q, targetStepId: q.stepId, source: 'rule' })),
      ...aiQuestions,
    ];

    // 4) Per-layer score: count how many layer fields are filled vs missing
    let layerScore: number | undefined;
    if (layerFields) {
      let filled = 0, total = 0;
      for (const ss of ruleResult.stepScores) {
        for (const f of Array.from(layerFields)) {
          total++;
          if (!ss.missingFields.includes(f)) filled++;
        }
      }
      layerScore = total > 0 ? Math.round((filled / total) * 100) : 100;
    }

    return {
      layer: layer || null,
      layerLabel: layerLabel || null,
      summary,
      issues: aiIssues,
      questions: mergedQuestions,
      score: ruleResult.score,
      layerScore: layerScore ?? null,
      stepScores: ruleResult.stepScores,
    };
  }

  @Post(':id/ai/apply-answers')
  async applyAnswers(@Param('id') id: string, @Body() dto: ApplyAnswersDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) throw new BadRequestException('Missing OPENAI_API_KEY');

    const content = String(manual?.content || '').trim();
    if (!content) throw new BadRequestException('manual content required');

    const answers = (dto.answers || []).filter(a => a.answer && a.answer.trim());
    if (!answers.length) throw new BadRequestException('answers array is empty');

    const answerText = answers.map((a, i) =>
      `[${i + 1}] 질문: ${a.question}\n    대상 STEP: ${a.targetStepId || '전체'} / 필드: ${a.targetField || '미지정'}\n    답변: ${a.answer}`
    ).join('\n\n');

    const sys = `당신은 업무 메뉴얼 DSL 편집 도우미입니다.
반드시 JSON만 출력하세요. 마크다운 코드펜스를 사용하지 마세요.

메뉴얼 DSL 포맷 규칙:
- 각 STEP은 "### STEP S1 | 단계명" 으로 시작
- 필드는 "- 필드명: 값" 형태
- 가능한 필드: taskType, 목적, 담당자, 작업방법, 입력/필요자료(파일·양식·링크), 도구, 관련문서, 산출물, 확인사항, 업무일지(필수), 완료조건, 연락처, 위험대응, 협력사, 협력사담당자, 내부협조, 결재선, 결재역할, 이메일수신, 이메일CC, 이메일제목, 이메일내용, 기한, SLA, 분기
- taskType은 WORKLOG/APPROVAL/COOPERATION 중 하나

출력 JSON 스키마:
{
  "updatedContent": string,
  "appliedCount": number,
  "summary": string
}

updatedContent는 원본 메뉴얼에 사용자 답변을 반영한 전체 메뉴얼 텍스트입니다.
답변을 반영할 때 해당 STEP 블록에 적절한 필드 줄을 추가하거나 기존 값을 수정하세요.
답변이 "모름", "없음", "해당없음" 이면 해당 필드를 추가하지 마세요.`;

    const user = `[원본 메뉴얼]\n${content}\n\n[사용자 답변]\n${answerText}`;

    const f: any = (globalThis as any).fetch;
    if (!f) throw new BadRequestException('Server fetch not available.');

    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`OpenAI error: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!raw) throw new BadRequestException('OpenAI returned empty response');

    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { throw new BadRequestException('OpenAI did not return valid JSON'); }

    const updatedContent = String(parsed?.updatedContent || '').trim();
    if (!updatedContent) throw new BadRequestException('AI returned empty updatedContent');

    // Save the updated content to the manual
    const updated = await this.prisma.workManual.update({
      where: { id },
      data: {
        content: updatedContent,
        version: { increment: 1 },
        versionUpAt: new Date(),
      },
    });

    // Re-validate after applying answers
    const afterValidation = this.ruleBasedValidation(updatedContent);

    return {
      summary: String(parsed?.summary || ''),
      appliedCount: Number(parsed?.appliedCount || 0),
      updatedContent,
      version: updated.version,
      remainingIssues: afterValidation.questions,
      score: afterValidation.score,
      stepScores: afterValidation.stepScores,
    };
  }

  @Post(':id/ai/draft-steps')
  async aiDraftSteps(@Param('id') id: string, @Body() dto: AiDraftStepsDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const aiModel = (dto.aiModel === 'claude' ? 'claude' : 'openai') as AIModel;

    const title = String(manual?.title || '').trim();
    const content = String(manual?.content || '').trim();
    if (!content) throw new BadRequestException('manual content required');

    const clipped = content.length > 12000 ? content.slice(0, 12000) : content;

    const sys = `당신은 업무 메뉴얼을 분석하여 구조화된 STEP DSL로 변환해주는 도우미입니다.
반드시 JSON만 출력하세요. 마크다운 코드펜스(\`\`\`)를 사용하지 마세요.

출력 JSON 스키마:
{
  "draftContent": string,
  "stepCount": number,
  "summary": string
}

draftContent는 아래 DSL 포맷에 따른 전체 메뉴얼 텍스트입니다:

DSL 포맷 규칙:
- 각 STEP은 반드시 "### STEP S1 | 단계명" 으로 시작 (S1, S2, S3... 순서)
- 필수 필드:
  - taskType: WORKLOG(업무일지 필수), APPROVAL(결재), COOPERATION(외주/협조) 중 하나
  - 목적: 이 단계의 목표
  - 산출물: 이 단계 완료 시 생성되는 것
  - 완료조건: 언제 완료로 보는지
- 선택 필드 (파악 가능한 경우만):
  - 담당자: 역할/팀명
  - 작업방법: 구체적 수행 절차, 방법, 주의사항
  - 입력/필요자료(파일·양식·링크): 필요한 자료
  - 도구: 필요한 도구, 장비, IT 시스템
  - 관련문서: 도면, 시방서, 양식, 규정 등
  - 확인사항: 품질, 안전, 규정 준수 등 확인/검증 항목
  - 업무일지(필수): WORKLOG일 때 기록할 내용
  - 연락처: 관련 내부/외부 연락처
  - 위험대응: 이상 발생 시 조치, 에스컬레이션 경로
  - 분기: 조건에 따른 흐름 (예: 승인: last.approval.status == 'APPROVED' -> S3)

변환 원칙:
1. 원본 메뉴얼의 흐름을 최대한 보존하여 STEP으로 분해
2. 결재/승인이 언급되면 APPROVAL taskType으로
3. 외주/협력업체/협조가 언급되면 COOPERATION taskType으로
4. 나머지는 WORKLOG
5. 분기/조건이 있으면 branches 형식으로 표현
6. 원본에서 파악하기 어려운 필드는 비워두되, 업무 수행에 반드시 필요한 정보(담당자, 도구, 관련문서, 확인사항)는 가능한 추론하여 채울 것
7. 제조업 업무 프로세스 전문가 관점에서 현실적인 단계로 구성 (WHO/WHAT/HOW/WITH WHAT/WHEN/CHECK)
8. 각 단계에 작업방법, 확인사항, 연락처, 위험대응을 적극적으로 포함할 것`;

    const userMsg = `업무명: ${title}\n\n[원본 메뉴얼]\n${clipped}`;

    // Claude: Tool Use schema for draftContent output
    const draftToolSchema = {
      type: 'object' as const,
      properties: {
        draftContent: { type: 'string', description: 'STEP DSL 포맷의 전체 메뉴얼 텍스트' },
        stepCount: { type: 'number', description: '생성된 STEP 수' },
        summary: { type: 'string', description: '변환 요약' },
      },
      required: ['draftContent', 'stepCount', 'summary'],
    };

    let parsed: any;
    try {
      const result = await callAI({
        system: sys,
        user: userMsg,
        model: aiModel,
        temperature: 0.2,
        maxTokens: 4096,
        jsonSchema: aiModel === 'claude' ? { name: 'draft_steps', schema: draftToolSchema } : undefined,
      });
      parsed = result.parsed;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'AI call failed');
    }

    const draftContent = String(parsed?.draftContent || '').trim();
    if (!draftContent) throw new BadRequestException('AI returned empty draftContent');

    return {
      draftContent,
      stepCount: Number(parsed?.stepCount || 0),
      summary: String(parsed?.summary || ''),
      aiModel,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 업무 매뉴얼 외재화 시스템 — 새 AI 파이프라인 엔드포인트
  // ═══════════════════════════════════════════════════════════

  @Get('ext/base-types')
  getBaseTypes() {
    return { baseTypes: BASE_TYPES, optionGroups: OPTION_GROUPS };
  }

  @Post(':id/ext/phase2')
  async extPhase2(@Param('id') id: string, @Body() body: { userId: string; roundNum?: number }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const baseType = String(manual.baseType || '').trim();
    const btDef = BASE_TYPE_MAP[baseType];
    if (!btDef) throw new BadRequestException(`invalid baseType: ${baseType}`);

    const phaseData: PhaseData = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};
    const p1 = phaseData.phase1;
    const freeText = p1?.freeText || String(manual.content || '');
    const rounds = phaseData.phase2?.rounds || [];
    const roundNum = body.roundNum ?? (rounds.length + 1);

    const qs = QUESTION_SETS[baseType];
    if (!qs) throw new BadRequestException(`no question set for baseType: ${baseType}`);

    const previousRoundsSummary = rounds.map((r: any) =>
      `[Round ${r.roundNum}]\n질문: ${(r.aiQuestions || []).join('\n')}\n답변: ${(r.userAnswers || []).join('\n')}`
    ).join('\n\n');

    const sys = `${AI_SYSTEM_PROMPT}

### 현재 기본형: ${btDef.name} (${btDef.id})
${btDef.userDescription}

### 이 기본형의 핵심 질문 가이드:
${qs.coreQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

### 지시사항
- 현재 Round ${roundNum}/${3} 입니다.
- 사용자가 자유 입력한 내용과 이전 대화를 분석하세요.
- 2~3개의 구체적인 후속 질문을 생성하세요.
- 각 질문은 기본형(${btDef.name})의 핵심 질문 가이드를 기반으로 하되, 사용자가 이미 답변한 내용은 반복하지 마세요.
- 매 라운드마다 "지금까지 정리된 내용"을 structuredSoFar에 포함하세요.

반드시 JSON만 출력하세요. 마크다운 코드펜스를 사용하지 마세요.
출력 JSON:
{
  "questions": string[],
  "structuredSoFar": string,
  "summary": string,
  "completionRate": number
}`;

    const userMsg = `[사용자 자유 입력]\n${freeText}\n\n[이전 대화]\n${previousRoundsSummary || '(첫 라운드)'}`;

    console.log('[extPhase2] calling AI', { baseType, roundNum, freeTextLen: freeText.length });
    const result = await callAI({ system: sys, user: userMsg, temperature: 0.3, maxTokens: 600, model: 'openai' });
    const parsed = result.parsed || {};
    console.log('[extPhase2] AI response keys', Object.keys(parsed), 'questions:', (parsed.questions || []).length);

    return {
      roundNum,
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      structuredSoFar: String(parsed.structuredSoFar || ''),
      summary: String(parsed.summary || ''),
      completionRate: Number(parsed.completionRate || 0),
    };
  }

  @Post(':id/ext/phase2/answer')
  async extPhase2Answer(@Param('id') id: string, @Body() body: { userId: string; roundNum: number; answers: string[] }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const baseType = String(manual.baseType || '').trim();
    const btDef = BASE_TYPE_MAP[baseType];
    const phaseData: PhaseData = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};

    if (!phaseData.phase2) phaseData.phase2 = { rounds: [], completedRounds: 0 };
    const existing = phaseData.phase2.rounds.findIndex((r: any) => r.roundNum === body.roundNum);
    if (existing >= 0) {
      phaseData.phase2.rounds[existing].userAnswers = body.answers || [];
    } else {
      phaseData.phase2.rounds.push({ roundNum: body.roundNum, aiQuestions: [], userAnswers: body.answers || [] });
    }
    phaseData.phase2.completedRounds = phaseData.phase2.rounds.filter((r: any) => r.userAnswers?.length > 0).length;

    await (this.prisma as any).workManual.update({
      where: { id },
      data: { phaseData, currentPhase: 2 },
    });

    // 마지막 라운드가 아니면 다음 라운드 질문도 한 번에 생성하여 반환
    const nextRound = body.roundNum + 1;
    if (nextRound <= 3 && btDef) {
      const qs = QUESTION_SETS[baseType];
      if (qs) {
        const freeText = phaseData.phase1?.freeText || String(manual.content || '');
        const allRounds = phaseData.phase2.rounds || [];
        const prevSummary = allRounds.map((r: any) =>
          `[Round ${r.roundNum}]\n질문: ${(r.aiQuestions || []).join('\n')}\n답변: ${(r.userAnswers || []).join('\n')}`
        ).join('\n\n');

        const sys = `${AI_SYSTEM_PROMPT}\n\n### 현재 기본형: ${btDef.name} (${btDef.id})\n${btDef.userDescription}\n\n### 이 기본형의 핵심 질문 가이드:\n${qs.coreQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}\n\n### 지시사항\n- 현재 Round ${nextRound}/3 입니다.\n- 사용자가 자유 입력한 내용과 이전 대화를 분석하세요.\n- 2~3개의 구체적인 후속 질문을 생성하세요.\n- 각 질문은 기본형(${btDef.name})의 핵심 질문 가이드를 기반으로 하되, 사용자가 이미 답변한 내용은 반복하지 마세요.\n- 매 라운드마다 "지금까지 정리된 내용"을 structuredSoFar에 포함하세요.\n\n반드시 JSON만 출력하세요. 마크다운 코드펜스를 사용하지 마세요.\n출력 JSON:\n{\n  "questions": string[],\n  "structuredSoFar": string,\n  "summary": string,\n  "completionRate": number\n}`;
        const userMsg = `[사용자 자유 입력]\n${freeText}\n\n[이전 대화]\n${prevSummary}`;
        try {
          console.log('[extPhase2Answer] generating next round', nextRound);
          const result = await callAI({ system: sys, user: userMsg, temperature: 0.3, maxTokens: 600, model: 'openai' });
          const parsed = result.parsed || {};
          return {
            ok: true,
            completedRounds: phaseData.phase2.completedRounds,
            nextRound: {
              roundNum: nextRound,
              questions: Array.isArray(parsed.questions) ? parsed.questions : [],
              structuredSoFar: String(parsed.structuredSoFar || ''),
              summary: String(parsed.summary || ''),
              completionRate: Number(parsed.completionRate || 0),
            },
          };
        } catch (e) { console.error('[extPhase2Answer] AI error', e); /* fallback: 프론트엔드가 별도 호출 */ }
      }
    }

    return { ok: true, completedRounds: phaseData.phase2.completedRounds };
  }

  @Post(':id/ext/phase3')
  async extPhase3(@Param('id') id: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const baseType = String(manual.baseType || '').trim();
    const phaseData: PhaseData = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};

    const freeText = phaseData.phase1?.freeText || String(manual.content || '');
    const roundTexts = (phaseData.phase2?.rounds || []).map((r: any) => (r.userAnswers || []).join(' ')).join(' ');
    const fullText = `${freeText} ${roundTexts}`;

    const recommended = recommendOptions(baseType, fullText);

    return {
      baseType,
      optionGroups: OPTION_GROUPS,
      recommendedOptionIds: recommended,
    };
  }

  @Post(':id/ext/phase3/save')
  async extPhase3Save(@Param('id') id: string, @Body() body: { userId: string; selectedOptions: Record<string, string[]> }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const phaseData: PhaseData = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};

    phaseData.phase3 = {
      selectedOptions: body.selectedOptions || {},
      recommendedOptions: phaseData.phase3?.recommendedOptions || [],
    };

    await (this.prisma as any).workManual.update({
      where: { id },
      data: { phaseData, options: body.selectedOptions, currentPhase: 3 },
    });

    return { ok: true };
  }

  @Post(':id/ext/phase4')
  async extPhase4(@Param('id') id: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const baseType = String(manual.baseType || '').trim();
    const btDef = BASE_TYPE_MAP[baseType];
    if (!btDef) throw new BadRequestException(`invalid baseType: ${baseType}`);

    const phaseData: PhaseData = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};
    const p1 = phaseData.phase1;
    const freeText = p1?.freeText || String(manual.content || '');
    const roundsSummary = (phaseData.phase2?.rounds || []).map((r: any) =>
      `[Round ${r.roundNum}]\n질문: ${(r.aiQuestions || []).join('\n')}\n답변: ${(r.userAnswers || []).join('\n')}`
    ).join('\n\n');
    const selectedOpts = phaseData.phase3?.selectedOptions || {};
    const optionLabels: string[] = [];
    for (const grp of OPTION_GROUPS) {
      const sel = selectedOpts[grp.id] || [];
      for (const it of grp.items) {
        if (sel.includes(it.id)) optionLabels.push(it.label);
      }
    }

    const templateInstructions: Record<string, string> = {
      procedure: `BPMN 프로세스 형태로 작성하세요:
- 각 단계는 "### STEP S1 | 단계명" 형식
- 필수 필드: taskType(WORKLOG/APPROVAL/COOPERATION), 목적, 담당자, 산출물, 완료조건
- 결재 단계는 분기(승인/반려) 포함
- 인수인계 가이드 섹션 포함`,
      dev_project: `개발 프로젝트 마일스톤 형태로 작성하세요:
- 각 마일스톤은 "### MILESTONE M1 | 마일스톤명" 형식
- 필수 필드: 기간(M-n/M+n), Gate 통과 기준, Input/Output, 담당자
- 고객사 제출물 목록 포함
- 위험요소/대응 포함`,
      system_operation: `시스템 조작 가이드 형태로 작성하세요:
- 각 조작은 "### SCREEN SC1 | 화면명" 형식
- 필수 필드: 메뉴경로, 필수입력항목, 주의사항, 연관화면
- FAQ 섹션 포함
- 스크린샷 위치 표시`,
      calculation: `계산/산출 가이드 형태로 작성하세요:
- 각 산출은 "### CALC C1 | 산출항목명" 형식
- 필수 필드: 계산공식, 입력데이터, 출처, 검증방법
- Worked Example 포함
- 주의사항/예외 포함`,
      inspection_mgmt: `점검/관리 체크리스트 형태로 작성하세요:
- 각 점검은 "### CHECK CK1 | 점검항목명" 형식
- 필수 필드: 점검주기, 판단기준(정상/이상), 이상시 조치, 담당자
- 안전 주의사항 섹션 포함
- 설비 정보 섹션 포함`,
    };

    const sys = `${AI_SYSTEM_PROMPT}

### 산출물 생성 Phase
기본형: ${btDef.name} (${btDef.id})
선택된 옵션: ${optionLabels.join(', ') || '없음'}

### 출력 형식
${templateInstructions[baseType] || '구조화된 업무 매뉴얼을 작성하세요.'}

반드시 JSON만 출력하세요. 마크다운 코드펜스를 사용하지 마세요.
출력 JSON:
{
  "manualContent": string,
  "title": string,
  "summary": string,
  "securityItems": Array<{ systemName: string, original: string, replacement: string }>
}

보안 정보(ID, PW, 비밀번호 등)가 입력에 포함되어 있으면:
- manualContent에서는 "[보안정보 #n]"으로 대체
- securityItems 배열에 원본과 대체 텍스트를 기록`;

    const userMsg = `업무명: ${manual.title}\n부서: ${manual.department || manual.authorTeamName || ''}\n작성자: ${manual.authorName || ''}\n\n[사용자 입력]\n${freeText}\n\n[AI 대화 내역]\n${roundsSummary || '(없음)'}`;

    console.log('[extPhase4] calling AI', { baseType, optionLabels });
    const result = await callAI({ system: sys, user: userMsg, temperature: 0.2, model: 'openai' });
    const parsed = result.parsed || {};
    console.log('[extPhase4] AI response keys', Object.keys(parsed));

    const manualContent = String(parsed.manualContent || '').trim();
    if (!manualContent) throw new BadRequestException('AI returned empty manualContent');

    phaseData.phase4 = {
      manualContent,
      securityItems: Array.isArray(parsed.securityItems) ? parsed.securityItems : [],
    };

    await (this.prisma as any).workManual.update({
      where: { id },
      data: { content: manualContent, phaseData, currentPhase: 4, title: String(parsed.title || manual.title).trim() },
    });

    return {
      manualContent,
      title: String(parsed.title || manual.title).trim(),
      summary: String(parsed.summary || ''),
      securityItems: phaseData.phase4.securityItems,
    };
  }

  @Post(':id/ext/phase5')
  async extPhase5(@Param('id') id: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    return {
      questions: TACIT_KNOWLEDGE_QUESTIONS.map((q, i) => ({ id: i, question: q })),
      currentContent: String(manual.content || ''),
    };
  }

  @Post(':id/ext/phase5/complete')
  async extPhase5Complete(@Param('id') id: string, @Body() body: { userId: string; answers: Array<{ question: string; answer: string }> }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    const phaseData: PhaseData = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};
    const currentContent = String(manual.content || '');
    const answeredQAs = (body.answers || []).filter(a => a.answer && a.answer.trim());

    if (!answeredQAs.length) {
      phaseData.phase5 = { questions: [], finalContent: currentContent };
      await (this.prisma as any).workManual.update({
        where: { id },
        data: { phaseData, currentPhase: 5, status: 'DRAFT' },
      });
      return { finalContent: currentContent, summary: '암묵지 답변 없이 완료됨' };
    }

    const qaText = answeredQAs.map((a, i) => `[${i + 1}] 질문: ${a.question}\n    답변: ${a.answer}`).join('\n\n');

    const sys = `${AI_SYSTEM_PROMPT}

### 암묵지 보완 Phase
사용자가 추가로 답변한 암묵지(경험·노하우·주의사항)를 기존 매뉴얼에 자연스럽게 통합하세요.

규칙:
- 기존 매뉴얼 구조를 유지하면서, 적절한 위치에 암묵지 내용을 추가
- 별도 "암묵지/노하우" 섹션을 추가하여 정리
- 인수인계 가이드에도 반영

반드시 JSON만 출력하세요.
출력 JSON:
{
  "finalContent": string,
  "addedItems": number,
  "summary": string
}`;

    const userMsg = `[현재 매뉴얼]\n${currentContent}\n\n[암묵지 답변]\n${qaText}`;

    console.log('[extPhase5Complete] calling AI', { answeredQAs: answeredQAs.length });
    const result = await callAI({ system: sys, user: userMsg, temperature: 0.15, model: 'openai' });
    const parsed = result.parsed || {};
    console.log('[extPhase5Complete] AI response keys', Object.keys(parsed));

    const finalContent = String(parsed.finalContent || currentContent).trim();

    phaseData.phase5 = {
      questions: answeredQAs,
      finalContent,
    };

    await (this.prisma as any).workManual.update({
      where: { id },
      data: { content: finalContent, phaseData, currentPhase: 5, status: 'DRAFT' },
    });

    return {
      finalContent,
      addedItems: Number(parsed.addedItems || 0),
      summary: String(parsed.summary || ''),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Claude Skills — 업무 스킬 파일 생성/조회/활용
  // ═══════════════════════════════════════════════════════════

  @Post(':id/skill-file')
  async generateSkillFile(@Param('id') id: string, @Body() body: { userId: string; aiModel?: string }) {
    const uid = String(body.userId || '').trim();
    const manual = await this.requireOwner(uid, id);
    const aiModel = (body.aiModel === 'claude' ? 'claude' : 'openai') as AIModel;

    const title = String(manual?.title || '').trim();
    const content = String(manual?.content || '').trim();
    if (!content) throw new BadRequestException('manual content required');

    const phaseData: any = manual.phaseData ? (typeof manual.phaseData === 'string' ? JSON.parse(manual.phaseData) : manual.phaseData) : {};
    const tacitKnowledge = phaseData.phase5?.questions || [];

    const clipped = content.length > 30000 ? content.slice(0, 30000) : content;

    const sys = `당신은 업무 매뉴얼을 분석하여 구조화된 "업무 스킬 파일"을 생성하는 전문가입니다.
업무 스킬 파일은 해당 업무의 모든 지식(절차, 역할, 노하우, 예외, FAQ)을 JSON으로 체계화한 것입니다.

반드시 JSON만 출력하세요.

출력 JSON 스키마:
{
  "meta": {
    "title": string,
    "department": string,
    "baseType": string,
    "domain": string,
    "frequency": string,
    "difficulty": "low"|"medium"|"high",
    "estimatedDuration": string
  },
  "overview": {
    "purpose": string,
    "scope": string,
    "triggerConditions": string[],
    "completionCriteria": string[]
  },
  "actors": Array<{ "role": string, "department": string, "responsibilities": string[] }>,
  "steps": Array<{
    "id": string,
    "name": string,
    "taskType": "WORKLOG"|"APPROVAL"|"COOPERATION",
    "actor": string,
    "purpose": string,
    "method": string,
    "inputs": string[],
    "outputs": string[],
    "tools": string[],
    "checkpoints": string[],
    "tips": string[],
    "commonMistakes": string[],
    "duration": string
  }>,
  "decisions": Array<{
    "afterStep": string,
    "question": string,
    "conditions": Array<{ "condition": string, "nextStep": string }>
  }>,
  "exceptions": Array<{
    "situation": string,
    "response": string,
    "escalation": string
  }>,
  "relatedKnowledge": {
    "systems": Array<{ "name": string, "usage": string }>,
    "documents": Array<{ "name": string, "type": string }>,
    "terminology": Array<{ "term": string, "definition": string }>
  },
  "tacitKnowledge": Array<{
    "category": "tip"|"warning"|"seasonal"|"efficiency",
    "content": string,
    "context": string
  }>,
  "faq": Array<{ "question": string, "answer": string }>,
  "handover": {
    "criticalPoints": string[],
    "firstWeekGuide": string[],
    "contacts": Array<{ "role": string, "when": string }>
  }
}

분석 원칙:
1. 메뉴얼의 STEP 구조가 있으면 우선 활용
2. steps의 tips와 commonMistakes는 적극적으로 추론 — 제조업 현장 관점에서 흔한 실수와 노하우를 포함
3. faq는 이 업무를 처음 하는 사람이 궁금해할 5~10개 질문을 생성
4. handover는 인수인계 시 꼭 전달해야 할 핵심 사항
5. 암묵지 답변이 있으면 tacitKnowledge에 반드시 포함`;

    const tacitText = tacitKnowledge.length > 0
      ? `\n\n[암묵지 답변]\n${tacitKnowledge.map((q: any) => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n')}`
      : '';

    const userMsg = `업무명: ${title}\n부서: ${String(manual.department || '')}\n기본형: ${String(manual.baseType || '')}\n\n[업무 메뉴얼]\n${clipped}${tacitText}`;

    const skillFileSchema = {
      type: 'object' as const,
      properties: {
        meta: { type: 'object', properties: { title: { type: 'string' }, department: { type: 'string' }, baseType: { type: 'string' }, domain: { type: 'string' }, frequency: { type: 'string' }, difficulty: { type: 'string' }, estimatedDuration: { type: 'string' } }, required: ['title', 'domain'] },
        overview: { type: 'object', properties: { purpose: { type: 'string' }, scope: { type: 'string' }, triggerConditions: { type: 'array', items: { type: 'string' } }, completionCriteria: { type: 'array', items: { type: 'string' } } }, required: ['purpose'] },
        actors: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, department: { type: 'string' }, responsibilities: { type: 'array', items: { type: 'string' } } }, required: ['role'] } },
        steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, taskType: { type: 'string' }, actor: { type: 'string' }, purpose: { type: 'string' }, method: { type: 'string' }, inputs: { type: 'array', items: { type: 'string' } }, outputs: { type: 'array', items: { type: 'string' } }, tools: { type: 'array', items: { type: 'string' } }, checkpoints: { type: 'array', items: { type: 'string' } }, tips: { type: 'array', items: { type: 'string' } }, commonMistakes: { type: 'array', items: { type: 'string' } }, duration: { type: 'string' } }, required: ['id', 'name'] } },
        decisions: { type: 'array', items: { type: 'object', properties: { afterStep: { type: 'string' }, question: { type: 'string' }, conditions: { type: 'array', items: { type: 'object', properties: { condition: { type: 'string' }, nextStep: { type: 'string' } } } } } } },
        exceptions: { type: 'array', items: { type: 'object', properties: { situation: { type: 'string' }, response: { type: 'string' }, escalation: { type: 'string' } } } },
        relatedKnowledge: { type: 'object', properties: { systems: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, usage: { type: 'string' } } } }, documents: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } } } }, terminology: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, definition: { type: 'string' } } } } } },
        tacitKnowledge: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, content: { type: 'string' }, context: { type: 'string' } } } },
        faq: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } } } },
        handover: { type: 'object', properties: { criticalPoints: { type: 'array', items: { type: 'string' } }, firstWeekGuide: { type: 'array', items: { type: 'string' } }, contacts: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, when: { type: 'string' } } } } } },
      },
      required: ['meta', 'overview', 'steps', 'faq', 'handover'],
    };

    let skillData: any;
    try {
      const result = await callAI({
        system: sys,
        user: userMsg,
        model: aiModel,
        temperature: 0.2,
        maxTokens: 8192,
        thinking: aiModel === 'claude',
        thinkingBudget: 10000,
        jsonSchema: aiModel === 'claude' ? { name: 'generate_skill_file', schema: skillFileSchema } : undefined,
      });
      skillData = result.parsed;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'AI Skill File 생성 실패');
    }

    // Check if existing skill file for this manual
    const existing = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id, userId: uid },
      orderBy: { version: 'desc' },
    });

    const newVersion = existing ? existing.version + 1 : 1;

    const skillFile = await (this.prisma as any).workSkillFile.create({
      data: {
        userId: uid,
        manualId: id,
        title: skillData?.meta?.title || title,
        version: newVersion,
        skillData,
        status: 'active',
      },
    });

    return { skillFile, aiModel };
  }

  @Get(':id/skill-file')
  async getSkillFile(@Param('id') id: string, @Query('userId') userId: string) {
    const uid = String(userId || '').trim();
    await this.requireOwner(uid, id);

    const skillFile = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id },
      orderBy: { version: 'desc' },
    });

    if (!skillFile) throw new BadRequestException('Skill File이 아직 생성되지 않았습니다.');
    return { skillFile };
  }

  @Post(':id/skill-file/to-bpmn')
  async skillFileToBpmn(@Param('id') id: string, @Body() body: { userId: string; aiModel?: string }) {
    const uid = String(body.userId || '').trim();
    await this.requireOwner(uid, id);
    const aiModel = (body.aiModel === 'claude' ? 'claude' : 'openai') as AIModel;

    const skillFile = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id },
      orderBy: { version: 'desc' },
    });
    if (!skillFile) throw new BadRequestException('Skill File을 먼저 생성해주세요.');

    const sd = skillFile.skillData as any;
    const stepsJson = JSON.stringify(sd.steps || [], null, 2);
    const decisionsJson = JSON.stringify(sd.decisions || [], null, 2);

    const sys = `당신은 업무 스킬 파일의 steps와 decisions를 BPMN JSON으로 변환하는 전문가입니다.
반드시 JSON만 출력하세요.

변환 규칙:
- 각 step을 task 노드로 변환 (id 유지)
- start/end 노드 자동 추가
- decisions를 gateway_xor 노드로 변환
- task 노드의 description에 tips와 commonMistakes를 HTML로 포함
- taskType: WORKLOG(기본), APPROVAL(결재), COOPERATION(협조)
- edge.condition은 런타임 형식: last.approval.status == 'APPROVED' 등

출력 JSON:
{
  "title": string,
  "bpmnJson": {
    "nodes": Array<{ id, type, name, taskType?, description?, assigneeHint? }>,
    "edges": Array<{ id, source, target, condition? }>
  }
}`;

    const userMsg = `[Steps]\n${stepsJson}\n\n[Decisions]\n${decisionsJson}\n\n업무명: ${sd.meta?.title || skillFile.title}`;

    const bpmnSchema = {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        bpmnJson: {
          type: 'object',
          properties: {
            nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, name: { type: 'string' }, taskType: { type: 'string' }, description: { type: 'string' }, assigneeHint: { type: 'string' } }, required: ['id', 'type', 'name'] } },
            edges: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' }, condition: { type: 'string' } }, required: ['id', 'source', 'target'] } },
          },
          required: ['nodes', 'edges'],
        },
      },
      required: ['title', 'bpmnJson'],
    };

    let parsed: any;
    try {
      const result = await callAI({
        system: sys,
        user: userMsg,
        model: aiModel,
        temperature: 0.15,
        maxTokens: 4096,
        jsonSchema: aiModel === 'claude' ? { name: 'skill_to_bpmn', schema: bpmnSchema } : undefined,
      });
      parsed = result.parsed;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Skill File → BPMN 변환 실패');
    }

    const outTitle = String(parsed?.title || skillFile.title).trim();
    const bpmnJson = parsed?.bpmnJson;
    if (!bpmnJson?.nodes || !bpmnJson?.edges) throw new BadRequestException('BPMN 변환 결과가 올바르지 않습니다.');

    // Normalize taskTypes
    const normalizedNodes = (bpmnJson.nodes as any[]).map((n: any) => {
      if (String(n?.type || '') !== 'task') return n;
      let tt = String(n?.taskType || 'WORKLOG').toUpperCase();
      if (tt === 'TASK') tt = 'WORKLOG';
      if (!['WORKLOG', 'APPROVAL', 'COOPERATION'].includes(tt)) tt = 'WORKLOG';
      return { ...n, taskType: tt };
    });

    return { title: outTitle, bpmnJson: { ...bpmnJson, nodes: normalizedNodes }, aiModel };
  }

  @Post(':id/skill-qa')
  async skillQA(@Param('id') id: string, @Body() body: { userId: string; question: string; aiModel?: string }) {
    const uid = String(body.userId || '').trim();
    await this.requireOwner(uid, id);
    const aiModel = (body.aiModel === 'claude' ? 'claude' : 'openai') as AIModel;
    const question = String(body.question || '').trim();
    if (!question) throw new BadRequestException('질문을 입력해주세요.');

    const skillFile = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id },
      orderBy: { version: 'desc' },
    });
    if (!skillFile) throw new BadRequestException('Skill File을 먼저 생성해주세요.');

    const sd = skillFile.skillData as any;
    const skillContext = JSON.stringify(sd, null, 2);
    const clippedContext = skillContext.length > 50000 ? skillContext.slice(0, 50000) : skillContext;

    // Load previous QA history
    const qaHistory: any[] = Array.isArray(skillFile.qaHistory) ? skillFile.qaHistory : [];
    const recentHistory = qaHistory.slice(-10); // last 10 exchanges
    const historyText = recentHistory.map((h: any) => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n');

    const sys = `당신은 업무 전문가이며, 아래 "업무 스킬 파일"에 기반하여 업무 관련 질문에 정확하게 답변합니다.

답변 원칙:
1. 스킬 파일에 있는 정보를 근거로 답변하세요. 없는 정보는 "스킬 파일에 해당 정보가 없습니다"라고 솔직히 말하세요.
2. 관련 단계(step)가 있으면 단계 ID와 이름을 인용하세요.
3. 암묵지(tips, commonMistakes, tacitKnowledge)가 관련되면 반드시 언급하세요.
4. 답변은 실용적이고 구체적으로 하세요. 긴 설명보다 핵심 포인트를 명확히.
5. FAQ에 유사한 질문이 있으면 해당 답변을 기반으로 보강하세요.

반드시 JSON으로 출력:
{
  "answer": string (마크다운 형식 답변),
  "relatedSteps": string[] (관련 단계 ID 목록, 예: ["S1", "S3"]),
  "confidence": "high"|"medium"|"low",
  "suggestedFollowUp": string[] (후속 질문 제안 1~3개)
}

[업무 스킬 파일]
${clippedContext}`;

    const userMsg = historyText
      ? `[이전 대화]\n${historyText}\n\n[새 질문]\n${question}`
      : question;

    let parsed: any;
    try {
      const result = await callAI({
        system: sys,
        user: userMsg,
        model: aiModel,
        temperature: 0.3,
        maxTokens: 2048,
      });
      parsed = result.parsed;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Q&A 실패');
    }

    const answer = String(parsed?.answer || '답변을 생성하지 못했습니다.');
    const qaEntry = {
      question,
      answer,
      relatedSteps: parsed?.relatedSteps || [],
      confidence: parsed?.confidence || 'medium',
      timestamp: new Date().toISOString(),
    };

    // Append to QA history
    qaHistory.push(qaEntry);
    await (this.prisma as any).workSkillFile.update({
      where: { id: skillFile.id },
      data: { qaHistory },
    });

    return {
      answer,
      relatedSteps: parsed?.relatedSteps || [],
      confidence: parsed?.confidence || 'medium',
      suggestedFollowUp: parsed?.suggestedFollowUp || [],
      aiModel,
    };
  }

  // ─── Skill File → Schedule (dev_project) ─────────────────
  @Post(':id/skill-file/to-schedule')
  async skillFileToSchedule(@Param('id') id: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    await this.requireOwner(uid, id);

    const skillFile = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id }, orderBy: { version: 'desc' },
    });
    if (!skillFile) throw new BadRequestException('Skill File을 먼저 생성해주세요.');

    const sd = skillFile.skillData as any;
    const steps = sd.steps || [];
    const now = new Date();

    // Skill File의 steps에서 마일스톤 추출
    const milestones = steps.map((s: any, i: number) => {
      const daysOffset = Math.round((i / Math.max(steps.length - 1, 1)) * 90);
      const date = new Date(now.getTime() + daysOffset * 86400000);
      return {
        name: `${s.id || `S${i + 1}`}. ${s.name}`,
        date: date.toISOString().slice(0, 10),
        done: false,
        actor: s.actor || '',
        duration: s.duration || '',
      };
    });

    const endDate = new Date(now);
    const estDuration = sd.meta?.estimatedDuration || '';
    const monthMatch = estDuration.match(/(\d+)\s*[개]?월/);
    endDate.setMonth(endDate.getMonth() + (monthMatch ? parseInt(monthMatch[1]) : 3));

    const s = await (this.prisma as any).schedule.create({
      data: {
        userId: uid,
        manualId: id,
        title: (sd.meta?.title || skillFile.title) + ' — 일정',
        description: `Skill File v${skillFile.version} 기반 자동 생성. ${sd.overview?.purpose || ''}`,
        startDate: now,
        endDate,
        milestones,
      },
    });
    return { schedule: s, source: 'skill-file' };
  }

  // ─── Skill File → KnowledgeBase (system_operation / calculation) ───
  @Post(':id/skill-file/to-knowledge-base')
  async skillFileToKnowledgeBase(@Param('id') id: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    await this.requireOwner(uid, id);

    const skillFile = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id }, orderBy: { version: 'desc' },
    });
    if (!skillFile) throw new BadRequestException('Skill File을 먼저 생성해주세요.');

    const sd = skillFile.skillData as any;

    // Skill File에서 풍부한 콘텐츠 생성 (steps + tips + faq + tacit 통합)
    const sections: string[] = [];
    sections.push(`# ${sd.meta?.title || skillFile.title}`);
    if (sd.overview?.purpose) sections.push(`\n## 목적\n${sd.overview.purpose}`);
    if (sd.overview?.scope) sections.push(`\n## 범위\n${sd.overview.scope}`);

    if (sd.steps?.length) {
      sections.push('\n## 절차');
      for (const s of sd.steps) {
        sections.push(`\n### ${s.id}. ${s.name}`);
        if (s.method) sections.push(`- 방법: ${s.method}`);
        if (s.tools?.length) sections.push(`- 도구: ${s.tools.join(', ')}`);
        if (s.tips?.length) sections.push(`- 💡 팁: ${s.tips.join(' / ')}`);
        if (s.commonMistakes?.length) sections.push(`- ⚠ 주의: ${s.commonMistakes.join(' / ')}`);
      }
    }

    if (sd.faq?.length) {
      sections.push('\n## FAQ');
      for (const f of sd.faq) sections.push(`\n**Q.** ${f.question}\n**A.** ${f.answer}`);
    }

    if (sd.tacitKnowledge?.length) {
      sections.push('\n## 암묵지/노하우');
      for (const tk of sd.tacitKnowledge) sections.push(`- [${tk.category}] ${tk.content}`);
    }

    const content = sections.join('\n');
    const baseType = sd.meta?.baseType || '';
    const category = baseType === 'system_operation' ? 'system_operation' : baseType === 'calculation' ? 'calculation' : 'general';

    const systemNames = (sd.relatedKnowledge?.systems || []).map((s: any) => s.name).filter(Boolean);
    const terms = (sd.relatedKnowledge?.terminology || []).map((t: any) => t.term).filter(Boolean);
    const tags = [baseType, sd.meta?.department || '', ...terms].filter(Boolean).join(',');

    const kb = await (this.prisma as any).knowledgeBase.create({
      data: {
        userId: uid,
        manualId: id,
        title: (sd.meta?.title || skillFile.title) + ' — 지식베이스',
        content,
        category,
        systemName: systemNames[0] || null,
        tags,
      },
    });
    return { knowledgeBase: kb, source: 'skill-file' };
  }

  // ─── Skill File → PeriodicAlarm (inspection_mgmt) ─────────
  @Post(':id/skill-file/to-periodic-alarm')
  async skillFileToPeriodicAlarm(@Param('id') id: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    await this.requireOwner(uid, id);

    const skillFile = await (this.prisma as any).workSkillFile.findFirst({
      where: { manualId: id }, orderBy: { version: 'desc' },
    });
    if (!skillFile) throw new BadRequestException('Skill File을 먼저 생성해주세요.');

    const sd = skillFile.skillData as any;

    // 주기 추론: meta.frequency 또는 overview.triggerConditions에서
    const freq = String(sd.meta?.frequency || '').toLowerCase();
    const intervalMap: Record<string, number> = { '매일': 1, '일일': 1, '매주': 7, '주간': 7, '매월': 30, '월간': 30, '분기': 90, '반기': 180, '연간': 365 };
    let intervalDays = 30;
    for (const [kw, days] of Object.entries(intervalMap)) {
      if (freq.includes(kw)) { intervalDays = days; break; }
    }

    // steps에서 체크리스트 생성
    const checkItems = (sd.steps || []).map((s: any) => ({
      label: `${s.id || ''}. ${s.name}`,
      detail: s.checkpoints?.join(', ') || s.method || '',
      done: false,
    }));

    if (checkItems.length === 0) {
      checkItems.push({ label: '점검 항목 1', detail: '', done: false });
      checkItems.push({ label: '점검 항목 2', detail: '', done: false });
    }

    const nextRunAt = new Date();
    nextRunAt.setDate(nextRunAt.getDate() + intervalDays);

    const a = await (this.prisma as any).periodicAlarm.create({
      data: {
        userId: uid,
        manualId: id,
        title: (sd.meta?.title || skillFile.title) + ' — 주기알람',
        description: `Skill File v${skillFile.version} 기반. ${sd.overview?.purpose || ''}`,
        intervalDays,
        nextRunAt,
        checkItems,
      },
    });
    return { periodicAlarm: a, source: 'skill-file' };
  }
}
