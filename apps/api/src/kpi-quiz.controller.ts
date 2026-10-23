import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { isAncestorOrgManager } from './lib/org-hierarchy';
import { KpiQuizService } from './kpi-quiz.service';

/**
 * 관리자 시험지 API
 *  - 응답자(팀장): 내 시험지 목록·상세·응답
 *  - 임원(CEO/EXEC): 전체 목록, 수동 출제, 채점 확정, 순위판, KPI별 출제 on/off
 *  - 팀장: 산하 팀 시험지 열람(조직도 기준)
 */
@Controller('kpi-quiz')
export class KpiQuizController {
  constructor(private prisma: PrismaService, private svc: KpiQuizService) {}

  private async actor(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new BadRequestException('user not found');
    return u;
  }
  private isExec(u: any) { return ['CEO', 'EXEC'].includes(String(u.role || '').toUpperCase()); }
  private assertExec(u: any) { if (!this.isExec(u)) throw new ForbiddenException('임원만 할 수 있습니다'); }

  /** 응답 전에는 객관식 정답·채점기준을 숨긴다 */
  private present(q: any, revealAnswers: boolean) {
    const questions = (q.questions || []).map((x: any) => revealAnswers ? x : { ...x, answerIdx: undefined, rubric: undefined });
    return { ...q, questions };
  }

  private async canView(u: any, quiz: any) {
    if (this.isExec(u) || quiz.respondentId === u.id) return true;
    const kr: any = await this.prisma.keyResult.findUnique({ where: { id: quiz.keyResultId }, select: { objective: { select: { orgUnitId: true } } } });
    return isAncestorOrgManager(this.prisma, u, kr?.objective?.orgUnitId);
  }

  @Get('mine')
  async mine(@Query('userId') userId?: string) {
    const u = await this.actor(userId);
    const rows: any[] = await (this.prisma as any).kpiQuiz.findMany({ where: { respondentId: u.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }], take: 60 });
    const krIds = Array.from(new Set(rows.map((r) => r.keyResultId)));
    const krs: any[] = krIds.length ? await this.prisma.keyResult.findMany({ where: { id: { in: krIds } }, select: { id: true, title: true, unit: true, objective: { select: { orgUnit: { select: { name: true } } } } } }) : [];
    const km = new Map(krs.map((k) => [k.id, k]));
    const items = rows.map((r) => ({ ...this.present(r, r.status !== 'OPEN'), kr: km.get(r.keyResultId) || null }));
    const scored = items.filter((i) => i.status !== 'OPEN' && (i.finalScore ?? i.aiScore) != null);
    const avg = scored.length ? Math.round((scored.reduce((s, i) => s + (i.finalScore ?? i.aiScore), 0) / scored.length) * 10) / 10 : null;
    return { items, open: items.filter((i) => i.status === 'OPEN').length, avg };
  }

  @Get('all')
  async all(@Query('userId') userId?: string, @Query('year') year?: string, @Query('status') status?: string) {
    const u = await this.actor(userId);
    const where: any = {};
    if (year) where.year = Number(year);
    if (status) where.status = status;
    let rows: any[] = await (this.prisma as any).kpiQuiz.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }], take: 300 });
    if (!this.isExec(u)) {
      const keep: any[] = [];
      for (const r of rows) if (await this.canView(u, r)) keep.push(r);
      rows = keep;
    }
    const krIds = Array.from(new Set(rows.map((r) => r.keyResultId)));
    const uids = Array.from(new Set(rows.map((r) => r.respondentId)));
    const [krs, users]: any[] = await Promise.all([
      krIds.length ? this.prisma.keyResult.findMany({ where: { id: { in: krIds } }, select: { id: true, title: true, unit: true, objective: { select: { orgUnit: { select: { name: true } } } } } }) : [],
      uids.length ? this.prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }) : [],
    ]);
    const km = new Map(krs.map((k: any) => [k.id, k])), um = new Map(users.map((x: any) => [x.id, x]));
    return { items: rows.map((r) => ({ ...this.present(r, true), kr: km.get(r.keyResultId) || null, respondent: um.get(r.respondentId) || null })) };
  }

  @Get('board')
  async board(@Query('userId') userId?: string, @Query('year') year?: string) {
    const u = await this.actor(userId);
    if (!['CEO', 'EXEC', 'MANAGER'].includes(String(u.role).toUpperCase())) throw new ForbiddenException('팀장 이상만 볼 수 있습니다');
    return this.svc.board(year ? Number(year) : undefined);
  }

  /** 출제 대상 KPI(바인딩) 목록 + 출제 on/off — 임원 */
  @Get('targets')
  async targets(@Query('userId') userId?: string) {
    const u = await this.actor(userId); this.assertExec(u);
    const bindings: any[] = await (this.prisma as any).kpiBinding.findMany({ where: { enabled: true }, include: { keyResult: { select: { id: true, title: true, unit: true, objective: { select: { status: true, orgUnit: { select: { name: true, managerId: true, manager: { select: { name: true } } } } } } } } } });
    const ym = this.svc.prevMonth();
    const out: any[] = [];
    for (const b of bindings) {
      const series = await this.svc.seriesFor(b.keyResultId, ym, 3);
      const latest = await (this.prisma as any).kpiQuiz.findFirst({ where: { keyResultId: b.keyResultId }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { year: true, month: true, status: true } });
      out.push({ keyResultId: b.keyResultId, title: b.keyResult?.title, unit: b.keyResult?.unit, team: b.keyResult?.objective?.orgUnit?.name || '', manager: b.keyResult?.objective?.orgUnit?.manager?.name || '(책임자 없음 → KPI 담당)', quizEnabled: b.quizEnabled, lastError: b.lastError, months: series.length, ready: series.length >= 2 && series.some((s) => s.year === ym.year && s.month === ym.month), latestQuiz: latest });
    }
    return { items: out, baseMonth: ym };
  }

  @Post('targets/:keyResultId/toggle')
  async toggle(@Param('keyResultId') keyResultId: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertExec(u);
    await (this.prisma as any).kpiBinding.update({ where: { keyResultId }, data: { quizEnabled: !!b?.enabled } });
    return { ok: true };
  }

  /** 수동 출제 — 임원. year/month 없으면 직전 마감월, keyResultId 없으면 전체 */
  @Post('generate')
  async generate(@Body() b: any) {
    const u = await this.actor(b?.userId); this.assertExec(u);
    const ym = b?.year && b?.month ? { year: Number(b.year), month: Number(b.month) } : this.svc.prevMonth();
    const results = await this.svc.generateMonth(ym, u.id, b?.keyResultId ? String(b.keyResultId) : undefined);
    return { ym, results };
  }

  @Get(':id')
  async one(@Param('id') id: string, @Query('userId') userId?: string) {
    const u = await this.actor(userId);
    const q = await (this.prisma as any).kpiQuiz.findUnique({ where: { id } });
    if (!q) throw new NotFoundException();
    if (!(await this.canView(u, q))) throw new ForbiddenException('볼 수 없습니다');
    const kr: any = await this.prisma.keyResult.findUnique({ where: { id: q.keyResultId }, select: { id: true, title: true, unit: true, target: true, objective: { select: { orgUnit: { select: { name: true } } } } } });
    const respondent = await this.prisma.user.findUnique({ where: { id: q.respondentId }, select: { id: true, name: true } });
    return { ...this.present(q, q.status !== 'OPEN' || this.isExec(u)), kr, respondent };
  }

  @Post(':id/answer')
  async answer(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId);
    const q = await (this.prisma as any).kpiQuiz.findUnique({ where: { id } });
    if (!q) throw new NotFoundException();
    if (q.respondentId !== u.id && !this.isExec(u)) throw new ForbiddenException('응답자만 답할 수 있습니다');
    if (q.status !== 'OPEN') throw new BadRequestException('이미 응답한 시험지입니다');
    const answers: any[] = Array.isArray(b?.answers) ? b.answers : [];
    for (const qq of q.questions || []) {
      const a = answers.find((x) => Number(x.no) === qq.no);
      if (qq.type === 'CHOICE' && (a?.choiceIdx == null || Number.isNaN(Number(a.choiceIdx)))) throw new BadRequestException(`${qq.no}번 객관식에 답하세요`);
      if (qq.type === 'TEXT' && String(a?.text || '').trim().length < 20) throw new BadRequestException(`${qq.no}번 주관식은 20자 이상 적어 주세요`);
    }
    const saved = await this.svc.answer(q, answers.map((a) => ({ no: Number(a.no), choiceIdx: a.choiceIdx != null ? Number(a.choiceIdx) : undefined, text: a.text != null ? String(a.text).slice(0, 3000) : undefined })));
    return this.present(saved, true);
  }

  /** 임원 확정 채점 */
  @Post(':id/grade')
  async grade(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertExec(u);
    const q = await (this.prisma as any).kpiQuiz.findUnique({ where: { id } });
    if (!q) throw new NotFoundException();
    if (q.status === 'OPEN') throw new BadRequestException('아직 응답 전입니다');
    const finalScore = b?.finalScore != null && b.finalScore !== '' ? Math.max(0, Math.min(100, Number(b.finalScore))) : (q.finalScore ?? q.aiScore);
    const saved = await (this.prisma as any).kpiQuiz.update({ where: { id }, data: { finalScore, gradeNote: String(b?.note || '').slice(0, 1000) || null, gradedById: u.id, gradedAt: new Date(), status: 'GRADED' } });
    await this.prisma.notification.create({ data: { userId: q.respondentId, type: 'KpiQuizGraded', subjectType: 'KPI_QUIZ', subjectId: id, payload: { finalScore, by: u.name } } }).catch(() => {});
    return saved;
  }

  @Post(':id/skip')
  async skip(@Param('id') id: string, @Body() b: any) {
    const u = await this.actor(b?.userId); this.assertExec(u);
    await (this.prisma as any).kpiQuiz.update({ where: { id }, data: { status: 'SKIPPED', gradeNote: String(b?.note || '').slice(0, 1000) || null, gradedById: u.id, gradedAt: new Date() } });
    return { ok: true };
  }
}
