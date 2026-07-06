import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { generateMilestones, synthesizeStrategy } from './exec-instructions.ai';
import { canReview, isOverdue, isReviewNeglected, isStalled, nextToActivate, nudgeAllowed, nudgeKind, nudgeRecipients, submitTargetStatus } from './milestone-rules';

class CreateInstructionDto {
  @IsString() authorId!: string;
  @IsString() rawText!: string;
  @IsOptional() @IsString() source?: 'TEXT' | 'VOICE';
  @IsOptional() @IsString() objectiveId?: string;
}
class AssignDto { @IsString() actorId!: string; @IsOptional() @IsString() ownerId?: string; @IsOptional() @IsString() dueAt?: string; }
class SubmitDto { @IsString() actorId!: string; @IsOptional() @IsArray() proof?: Array<{ type: string; value: string }>; }
class ProofDto { @IsString() actorId!: string; @IsString() type!: 'link' | 'note'; @IsString() value!: string; }
class EditMilestoneDto { @IsString() actorId!: string; @IsOptional() @IsString() title?: string; @IsOptional() @IsString() expectedResult?: string; @IsOptional() @IsString() dueAt?: string; }
class ActorDto { @IsString() actorId!: string; @IsOptional() @IsString() comment?: string; }

const SUBJECT = 'INSTRUCTION_MILESTONE';

@Controller('exec-instructions')
export class ExecInstructionsController {
  constructor(private prisma: PrismaService) {}

  private async isAdmin(userId?: string): Promise<boolean> {
    if (!userId) return false;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const r = String((u as any)?.role || '');
    return r === 'CEO' || r === 'EXEC';
  }

  // 꼭지 담당자 배정 시 업무일지 테스크(중점 추진 과제)를 자동 생성/연결
  private async ensureKeyInitiative(tx: any, milestone: any, instruction: any, actorId: string): Promise<string | null> {
    if (milestone.keyInitiativeId) return milestone.keyInitiativeId;
    if (!milestone.ownerId) return null;
    const ki = await tx.keyInitiative.create({
      data: {
        title: milestone.title,
        goal: milestone.expectedResult || null,
        description: `경영지시 팔로우업 꼭지에서 생성 (지시 #${instruction.id})`,
        status: 'IN_PROGRESS',
        assigneeId: milestone.ownerId,
        createdById: actorId || instruction.authorId,
        alignsToObjectiveId: instruction.objectiveId || null,
        dueDate: milestone.dueAt || null,
      },
    });
    await tx.milestone.update({ where: { id: milestone.id }, data: { keyInitiativeId: ki.id } });
    return ki.id;
  }

  private async notify(tx: any, userId: string, type: string, subjectId: string, payload: any) {
    if (!userId) return;
    await tx.notification.create({ data: { userId, type, subjectType: SUBJECT, subjectId, payload } });
  }

  // 완료 확정 후 다음 PENDING 꼭지 자동 ACTIVE (+ 담당자 있으면 과제 생성/알림)
  private async activateNext(tx: any, instruction: any, doneMilestoneId: string, actorId: string) {
    const siblings = await tx.milestone.findMany({ where: { instructionId: instruction.id } });
    const next = nextToActivate(siblings as any, doneMilestoneId);
    if (!next) return;
    await tx.milestone.update({ where: { id: next.id }, data: { status: 'ACTIVE', activatedAt: new Date() } });
    const fresh = await tx.milestone.findUnique({ where: { id: next.id } });
    if (fresh?.ownerId) {
      await this.ensureKeyInitiative(tx, fresh, instruction, actorId);
      await this.notify(tx, fresh.ownerId, 'MilestoneActivated', next.id, { instructionId: instruction.id, title: fresh.title });
    }
  }

  // ── 지시 캡처 ───────────────────────────────────────────────
  @Post()
  async create(@Body() dto: CreateInstructionDto) {
    if (!dto.authorId || !String(dto.rawText || '').trim()) throw new BadRequestException('authorId, rawText 필요');
    const gen = await generateMilestones(dto.rawText);
    const summary = String(dto.rawText).trim().replace(/\s+/g, ' ').slice(0, 120);
    const created = await this.prisma.$transaction(async (tx) => {
      const inst = await (tx as any).instruction.create({
        data: {
          authorId: dto.authorId,
          rawText: dto.rawText,
          summary,
          source: dto.source === 'VOICE' ? 'VOICE' : 'TEXT',
          objectiveId: dto.objectiveId || null,
        },
      });
      for (let i = 0; i < gen.length; i++) {
        await (tx as any).milestone.create({
          data: {
            instructionId: inst.id,
            order: i,
            title: gen[i].title,
            expectedResult: gen[i].expectedResult || null,
            status: i === 0 ? 'ACTIVE' : 'PENDING',
            activatedAt: i === 0 ? new Date() : null,
          },
        });
      }
      return inst;
    });
    // 전략 자동 재분석(3건 규칙) — fire-and-forget
    void this.maybeAutoSynthesize(dto.authorId).catch(() => {});
    return this.detail(created.id);
  }

  @Get()
  async list(@Query('authorId') authorId?: string, @Query('status') status?: string, @Query('q') q?: string) {
    const where: any = {};
    if (authorId) where.authorId = authorId;
    if (status && status !== 'ALL') where.status = status;
    if (q && q.trim()) where.rawText = { contains: q.trim(), mode: 'insensitive' };
    const items = await (this.prisma as any).instruction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } }, milestones: { orderBy: { order: 'asc' } } },
    });
    return {
      items: items.map((i: any) => ({
        id: i.id,
        summary: i.summary,
        rawText: i.rawText,
        status: i.status,
        source: i.source,
        author: i.author,
        createdAt: i.createdAt,
        milestoneCount: i.milestones.length,
        doneCount: i.milestones.filter((m: any) => m.status === 'DONE').length,
        reviewCount: i.milestones.filter((m: any) => m.status === 'REVIEW').length,
      })),
    };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const inst = await (this.prisma as any).instruction.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        milestones: { orderBy: { order: 'asc' }, include: { owner: { select: { id: true, name: true } } } },
      },
    });
    if (!inst) throw new NotFoundException('지시를 찾을 수 없습니다');
    return inst;
  }

  @Post(':id/regenerate')
  async regenerate(@Param('id') id: string, @Body() dto: ActorDto) {
    const inst = await (this.prisma as any).instruction.findUnique({ where: { id }, include: { milestones: true } });
    if (!inst) throw new NotFoundException('지시를 찾을 수 없습니다');
    if (!(dto.actorId === inst.authorId || (await this.isAdmin(dto.actorId)))) throw new ForbiddenException('지시자 또는 관리자만 재분해할 수 있습니다');
    const progressed = inst.milestones.some((m: any) => m.status === 'DONE' || m.status === 'REVIEW');
    if (progressed) throw new BadRequestException('이미 진행/검수된 꼭지가 있어 재분해할 수 없습니다');
    const gen = await generateMilestones(inst.rawText);
    await this.prisma.$transaction(async (tx) => {
      await (tx as any).milestone.deleteMany({ where: { instructionId: id } });
      for (let i = 0; i < gen.length; i++) {
        await (tx as any).milestone.create({
          data: { instructionId: id, order: i, title: gen[i].title, expectedResult: gen[i].expectedResult || null, status: i === 0 ? 'ACTIVE' : 'PENDING', activatedAt: i === 0 ? new Date() : null },
        });
      }
    });
    return this.detail(id);
  }

  @Patch('milestones/:mid')
  async editMilestone(@Param('mid') mid: string, @Body() dto: EditMilestoneDto) {
    const m = await (this.prisma as any).milestone.findUnique({ where: { id: mid }, include: { instruction: true } });
    if (!m) throw new NotFoundException('꼭지를 찾을 수 없습니다');
    if (!(dto.actorId === m.instruction.authorId || (await this.isAdmin(dto.actorId)))) throw new ForbiddenException('지시자 또는 관리자만 수정할 수 있습니다');
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.expectedResult !== undefined) data.expectedResult = dto.expectedResult || null;
    if (dto.dueAt !== undefined) data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    await (this.prisma as any).milestone.update({ where: { id: mid }, data });
    return this.detail(m.instructionId);
  }

  @Post('milestones/:mid/assign')
  async assign(@Param('mid') mid: string, @Body() dto: AssignDto) {
    const m = await (this.prisma as any).milestone.findUnique({ where: { id: mid }, include: { instruction: true } });
    if (!m) throw new NotFoundException('꼭지를 찾을 수 없습니다');
    if (!(dto.actorId === m.instruction.authorId || (await this.isAdmin(dto.actorId)))) throw new ForbiddenException('지시자 또는 관리자만 배정할 수 있습니다');
    await this.prisma.$transaction(async (tx) => {
      await (tx as any).milestone.update({ where: { id: mid }, data: { ownerId: dto.ownerId || null, dueAt: dto.dueAt ? new Date(dto.dueAt) : m.dueAt } });
      const fresh = await (tx as any).milestone.findUnique({ where: { id: mid } });
      // ACTIVE 이고 담당자가 있으면 즉시 과제 생성/알림
      if (fresh.ownerId && (fresh.status === 'ACTIVE' || fresh.status === 'BLOCKED')) {
        await this.ensureKeyInitiative(tx, fresh, m.instruction, dto.actorId);
        await this.notify(tx, fresh.ownerId, 'MilestoneAssigned', mid, { instructionId: m.instructionId, title: fresh.title });
      }
    });
    return this.detail(m.instructionId);
  }

  // 담당자 완료 제출: 지시자/관리자면 즉시 확정, 아니면 검수(REVIEW)+결재 생성
  @Post('milestones/:mid/submit')
  async submit(@Param('mid') mid: string, @Body() dto: SubmitDto) {
    const m = await (this.prisma as any).milestone.findUnique({ where: { id: mid }, include: { instruction: true } });
    if (!m) throw new NotFoundException('꼭지를 찾을 수 없습니다');
    const admin = await this.isAdmin(dto.actorId);
    const isOwner = m.ownerId && m.ownerId === dto.actorId;
    if (!isOwner && !admin && dto.actorId !== m.instruction.authorId) throw new ForbiddenException('담당자만 완료 제출할 수 있습니다');
    if (m.status !== 'ACTIVE' && m.status !== 'BLOCKED') throw new BadRequestException('진행 중인 꼭지만 완료 제출할 수 있습니다');
    const privileged = dto.actorId === m.instruction.authorId || admin; // 지시자 본인/관리자 = 즉시 확정
    const target = submitTargetStatus(privileged);
    const proofAppend = Array.isArray(dto.proof) ? dto.proof.map((p) => ({ ...p, by: dto.actorId, at: new Date().toISOString() })) : [];

    await this.prisma.$transaction(async (tx) => {
      const proof = [...(Array.isArray(m.proof) ? m.proof : []), ...proofAppend];
      if (target === 'DONE') {
        await (tx as any).milestone.update({ where: { id: mid }, data: { status: 'DONE', doneAt: new Date(), returnNote: null, submittedAt: new Date(), proof } });
        if (m.keyInitiativeId) await (tx as any).keyInitiative.update({ where: { id: m.keyInitiativeId }, data: { status: 'COMPLETED', completedAt: new Date() } }).catch(() => {});
        await this.activateNext(tx, m.instruction, mid, dto.actorId);
      } else {
        // 이미 REVIEW면 재알림 없음(스팸 방지) — 결재가 이미 있으면 재생성 안 함
        if (m.status === 'REVIEW' && m.approvalRequestId) {
          await (tx as any).milestone.update({ where: { id: mid }, data: { proof } });
          return;
        }
        const appr = await (tx as any).approvalRequest.create({ data: { subjectType: SUBJECT, subjectId: mid, approverId: m.instruction.authorId, requestedById: dto.actorId } });
        await (tx as any).milestone.update({ where: { id: mid }, data: { status: 'REVIEW', submittedAt: new Date(), approvalRequestId: appr.id, proof } });
        await this.notify(tx, m.instruction.authorId, 'ApprovalRequested', mid, { requestId: appr.id, requestedById: dto.actorId, title: m.title });
      }
    });
    return this.detail(m.instructionId);
  }

  @Post('milestones/:mid/proof')
  async addProof(@Param('mid') mid: string, @Body() dto: ProofDto) {
    const m = await (this.prisma as any).milestone.findUnique({ where: { id: mid } });
    if (!m) throw new NotFoundException('꼭지를 찾을 수 없습니다');
    const proof = [...(Array.isArray(m.proof) ? m.proof : []), { type: dto.type, value: dto.value, by: dto.actorId, at: new Date().toISOString() }];
    await (this.prisma as any).milestone.update({ where: { id: mid }, data: { proof } });
    return this.detail(m.instructionId);
  }

  @Post('milestones/:mid/block')
  async block(@Param('mid') mid: string, @Body() dto: ActorDto) {
    const m = await (this.prisma as any).milestone.findUnique({ where: { id: mid } });
    if (!m) throw new NotFoundException('꼭지를 찾을 수 없습니다');
    const next = m.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    if (m.status !== 'ACTIVE' && m.status !== 'BLOCKED') throw new BadRequestException('진행 중인 꼭지만 막힘 처리할 수 있습니다');
    await (this.prisma as any).milestone.update({ where: { id: mid }, data: { status: next } });
    return this.detail(m.instructionId);
  }

  // 결재(검수) 확정/반려 훅 — approvals.controller 에서 호출 (동일 트랜잭션)
  async finalizeMilestoneApproval(tx: any, requestId: string, decision: 'APPROVED' | 'REJECTED', actorId: string, comment?: string) {
    const m = await tx.milestone.findFirst({ where: { approvalRequestId: requestId }, include: { instruction: true } });
    if (!m) return;
    if (decision === 'APPROVED') {
      await tx.milestone.update({ where: { id: m.id }, data: { status: 'DONE', doneAt: new Date(), returnNote: null } });
      if (m.keyInitiativeId) await tx.keyInitiative.update({ where: { id: m.keyInitiativeId }, data: { status: 'COMPLETED', completedAt: new Date() } }).catch(() => {});
      await this.activateNext(tx, m.instruction, m.id, actorId);
      await this.notify(tx, m.ownerId, 'MilestoneApproved', m.id, { instructionId: m.instructionId, title: m.title });
    } else {
      // 반려: ACTIVE 복귀 + 사유, 결재 연결 해제(재제출 시 새 결재)
      await tx.milestone.update({ where: { id: m.id }, data: { status: 'ACTIVE', submittedAt: null, approvalRequestId: null, returnNote: comment || '반려되었습니다. 보완 후 다시 제출하세요.' } });
      await this.notify(tx, m.ownerId, 'MilestoneReturned', m.id, { instructionId: m.instructionId, title: m.title, reason: comment });
    }
  }

  // ── 전략 통일성 ─────────────────────────────────────────────
  @Get('strategy/latest')
  async strategyLatest() {
    const s = await (this.prisma as any).strategySynthesis.findFirst({ orderBy: { createdAt: 'desc' } });
    return s || null;
  }

  @Post('strategy/run')
  async strategyRun(@Body() dto: ActorDto) {
    return this.runSynthesis(dto.actorId);
  }

  private async runSynthesis(actorId: string) {
    const active = await (this.prisma as any).instruction.findMany({ where: { status: 'ACTIVE' }, select: { id: true, rawText: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const result = await synthesizeStrategy(active.map((i: any) => ({ id: i.id, text: i.rawText })));
    const saved = await (this.prisma as any).strategySynthesis.create({ data: { createdById: actorId, result } });
    return saved;
  }

  // 마지막 합성 이후 새 ACTIVE 지시 ≥3건이면 자동 합성 (fire-and-forget)
  private async maybeAutoSynthesize(actorId: string) {
    const last = await (this.prisma as any).strategySynthesis.findFirst({ orderBy: { createdAt: 'desc' } });
    const since = last ? { createdAt: { gt: last.createdAt } } : {};
    const newCount = await (this.prisma as any).instruction.count({ where: { status: 'ACTIVE', ...since } });
    if (newCount >= 3) await this.runSynthesis(actorId);
  }

  // ── 정체 감시(watchdog) ─────────────────────────────────────
  // 페이지 접속 시 호출: 주의 필요 요약 반환 + 넛지 스윕(간단 스로틀 없이 넛지 24h 중복만 방지)
  @Get('attention')
  async attention(@Query('userId') userId?: string) {
    const now = Date.now();
    const open = await (this.prisma as any).milestone.findMany({
      where: { status: { in: ['PENDING', 'ACTIVE', 'BLOCKED', 'REVIEW'] } },
      include: { instruction: { select: { id: true, authorId: true, summary: true } }, owner: { select: { id: true, name: true } } },
    });
    const flagged = open
      .map((m: any) => ({ m, kind: nudgeKind(m, now) }))
      .filter((x: any) => x.kind);
    // 넛지 발송(24h 중복 방지)
    await this.prisma.$transaction(async (tx) => {
      for (const { m, kind } of flagged) {
        if (!nudgeAllowed(m, now)) continue;
        const recips = nudgeRecipients(kind, m.ownerId, m.instruction.authorId);
        for (const uid of recips) await this.notify(tx, uid, `Milestone_${kind}`, m.id, { instructionId: m.instructionId, title: m.title, kind });
        await tx.milestone.update({ where: { id: m.id }, data: { lastNudgeAt: new Date() } });
      }
    });
    // 사용자 관점 요약
    const mine = flagged.filter((x: any) => !userId || x.m.ownerId === userId || x.m.instruction.authorId === userId);
    return {
      overdue: mine.filter((x: any) => x.kind === 'overdue').map((x: any) => summarize(x.m)),
      stalled: mine.filter((x: any) => x.kind === 'stalled').map((x: any) => summarize(x.m)),
      reviewNeglected: mine.filter((x: any) => x.kind === 'reviewNeglected').map((x: any) => summarize(x.m)),
    };
  }

  // cron 용 전체 스윕
  @Post('sweep')
  async sweep() {
    await this.attention(undefined);
    return { ok: true };
  }

  // ── 템플릿 승격 ─────────────────────────────────────────────
  @Post(':id/promote-template')
  async promoteTemplate(@Param('id') id: string, @Body() dto: ActorDto) {
    const inst = await (this.prisma as any).instruction.findUnique({ where: { id }, include: { milestones: { orderBy: { order: 'asc' } }, author: true } });
    if (!inst) throw new NotFoundException('지시를 찾을 수 없습니다');
    const actorId = dto.actorId || inst.authorId;
    const template = await this.prisma.$transaction(async (tx) => {
      const tpl = await (tx as any).processTemplate.create({
        data: {
          title: inst.summary || '경영지시 프로세스',
          description: `경영지시 #${inst.id} 에서 승격된 템플릿`,
          type: 'PROJECT',
          ownerId: actorId,
          createdById: actorId,
          updatedById: actorId,
          status: 'ACTIVE',
        },
      });
      for (const m of inst.milestones) {
        await (tx as any).processTaskTemplate.create({
          data: {
            processTemplateId: tpl.id,
            name: m.title,
            description: m.expectedResult || null,
            orderHint: m.order,
            expectedOutput: m.expectedResult || null,
            assigneeUserId: m.ownerId || null,
          },
        });
      }
      await (tx as any).instruction.update({ where: { id }, data: { promotedTemplateId: tpl.id } });
      return tpl;
    });
    return { templateId: template.id };
  }
}

function summarize(m: any) {
  return { id: m.id, title: m.title, status: m.status, dueAt: m.dueAt, owner: m.owner, instructionId: m.instructionId, summary: m.instruction?.summary };
}
