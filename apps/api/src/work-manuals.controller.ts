import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

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
}

class AiBpmnDto {
  @IsString() @IsNotEmpty()
  userId!: string;
}

class AiQuestionsDto {
  @IsString() @IsNotEmpty()
  userId!: string;
}

class ApplyAnswersDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsNotEmpty()
  answers!: Array<{ targetStepId?: string; targetField?: string; question: string; answer: string }>;
}

class AiDraftStepsDto {
  @IsString() @IsNotEmpty()
  userId!: string;
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
        version: it.version ?? 1,
        versionUpAt: it.versionUpAt,
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
    const created = await (this.prisma as any).workManual.create({
      data: { userId: uid, title, content, authorName, authorTeamName },
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
    const changed = titleChanged || contentChanged || authorNameChanged || authorTeamChanged;

    if (!changed) return existing;

    return (this.prisma as any).workManual.update({
      where: { id: String(id) },
      data: {
        title,
        content: wantsContent ? nextContent : undefined,
        authorName: nextAuthorName,
        authorTeamName: nextAuthorTeamName,
        version: { increment: 1 },
        versionUpAt: new Date(),
      },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    await this.requireOwner(uid, id);
    await (this.prisma as any).workManual.delete({ where: { id: String(id) } });
    return { ok: true };
  }

  @Post(':id/ai/bpmn')
  async aiBpmn(@Param('id') id: string, @Body() dto: AiBpmnDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) {
      throw new BadRequestException('Missing OPENAI_API_KEY (or *_CAMS / *_IAT). Set it as a Railway env var.');
    }

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

    const user = `업무명: ${title}\n\n[업무 메뉴얼]\n${clipped}`;

    const f: any = (globalThis as any).fetch;
    if (!f) {
      throw new BadRequestException('Server fetch not available. Please use Node 18+ or provide a fetch polyfill.');
    }

    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
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
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('OpenAI did not return valid JSON');
    }

    const outTitle = String(parsed?.title || `${title} 프로세스`).trim() || `${title} 프로세스`;
    const bpmnJson = parsed?.bpmnJson;
    const nodes = Array.isArray(bpmnJson?.nodes) ? bpmnJson.nodes : null;
    const edges = Array.isArray(bpmnJson?.edges) ? bpmnJson.edges : null;
    if (!nodes || !edges) throw new BadRequestException('OpenAI JSON missing bpmnJson.nodes/edges');

    const normalizedNodes = (nodes as any[]).map((n: any) => {
      const type = String(n?.type || '').trim();
      if (type !== 'task') return n;
      const rawTt = String(n?.taskType || '').trim().toUpperCase();
      let nextTt = rawTt || 'WORKLOG';
      if (nextTt === 'TASK') nextTt = 'WORKLOG';
      if (!['WORKLOG', 'APPROVAL', 'COOPERATION'].includes(nextTt)) nextTt = 'WORKLOG';
      return { ...n, taskType: nextTt };
    });

    return { title: outTitle, bpmnJson: { ...bpmnJson, nodes: normalizedNodes, edges } };
  }

  @Post(':id/ai/questions')
  async aiQuestions(@Param('id') id: string, @Body() dto: AiQuestionsDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) {
      throw new BadRequestException('Missing OPENAI_API_KEY (or *_CAMS / *_IAT). Set it as a Railway env var.');
    }

    const title = String(manual?.title || '').trim();
    const content = String(manual?.content || '').trim();
    if (!title) throw new BadRequestException('manual title missing');
    if (!content) throw new BadRequestException('manual content required');

    const clipped = content.length > 12000 ? content.slice(0, 12000) : content;

    const sys = `당신은 제조업 업무 메뉴얼을 검토하여 누락/모호한 부분을 구체적인 질문으로 정리해주는 도우미입니다.
반드시 JSON만 출력하세요. 마크다운 코드펜스(\`\`\`)를 사용하지 마세요.

출력 JSON 스키마:
{
  "summary": string,
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

targetField 가능한 값: taskType, purpose, assigneeHint, method, inputs, outputs, tools, relatedDocs, checkItems, worklogHint, completionCondition, contacts, risks, supplierName, supplierContact, cooperationTarget, approvalRouteType, approvalRoleCodes, emailTo, emailSubject, deadlineOffsetDays, slaHours, branches

검토 기준(제조업 특화):
- taskType: WORKLOG(업무일지 필수), APPROVAL(결재), COOPERATION(협조/외주) 중 하나여야 함. TASK는 WORKLOG로 변환 필요.
- 각 STEP에서 확인할 항목:
  1. 담당자/역할(assigneeHint): 누가 담당하는지?
  2. 입력자료(inputs): 어떤 도면/시방서/양식/파일이 필요한가?
  3. 관련문서(relatedDocs): 도면번호, 작업표준서, QC공정도 등
  4. 산출물(outputs): 이 단계가 끝나면 무엇이 만들어지는가?
  5. 업무일지(worklogHint): 기록할 수량/시간/품질수치/불량내용은?
  6. 완료조건(completionCondition): 언제 완료로 볼 수 있는가?
  7. 확인사항(checkItems): 품질, 안전, 규정 준수 등 확인/검증 항목, 합격기준, 불합격 시 처리?
  8. 작업방법(method): 구체적 수행 절차, 방법, 주의사항?
  8-1. 도구(tools): 필요한 도구, 장비, IT 시스템?
  8-2. 연락처(contacts): 관련 내부/외부 연락처?
  8-3. 위험대응(risks): 이상 발생 시 조치, 에스컬레이션 경로?
  9. 협력사(supplierName/supplierContact): COOPERATION 단계 시 협력사명·담당자?
  10. 결재선(approvalRouteType/approvalRoleCodes): APPROVAL 단계 시 누가 결재하는가?
  11. 기한/SLA(deadlineOffsetDays/slaHours): 처리 기한이 있는가?
  12. 분기(branches): 조건에 따라 다른 단계로 이동하는가?
- 메뉴얼에 "### STEP S1 | 단계명" 블록이 있으면 그 구조를 우선 파싱하세요.
- 각 질문에는 반드시 targetStepId(해당 STEP ID)와 targetField(위의 필드명 중 하나)를 포함하세요.
`;

    const user = `업무명: ${title}\n\n[업무 메뉴얼]\n${clipped}`;

    const f: any = (globalThis as any).fetch;
    if (!f) {
      throw new BadRequestException('Server fetch not available. Please use Node 18+ or provide a fetch polyfill.');
    }

    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
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
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('OpenAI did not return valid JSON');
    }

    const summary = String(parsed?.summary || '').trim();
    const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

    return { summary, issues, questions };
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

    return {
      summary: String(parsed?.summary || ''),
      appliedCount: Number(parsed?.appliedCount || 0),
      updatedContent,
      version: updated.version,
    };
  }

  @Post(':id/ai/draft-steps')
  async aiDraftSteps(@Param('id') id: string, @Body() dto: AiDraftStepsDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) throw new BadRequestException('Missing OPENAI_API_KEY');

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

    const user = `업무명: ${title}\n\n[원본 메뉴얼]\n${clipped}`;

    const f: any = (globalThis as any).fetch;
    if (!f) throw new BadRequestException('Server fetch not available.');

    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.2,
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

    const draftContent = String(parsed?.draftContent || '').trim();
    if (!draftContent) throw new BadRequestException('AI returned empty draftContent');

    return {
      draftContent,
      stepCount: Number(parsed?.stepCount || 0),
      summary: String(parsed?.summary || ''),
    };
  }
}
