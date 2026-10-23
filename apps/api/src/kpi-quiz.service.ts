import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { callAI } from './llm/ai-client';
import { achPct, monthTargetOf } from './lib/kpi-calc';

/**
 * 3단계 관리자 시험지 — 데이터 연결된 KPI의 "실제 수치"로 매월 팀장에게 3문항을 묻는다.
 *  Q1 객관식(10점): 데이터에서 결정론적으로 정답을 만든다(전월 대비 방향).
 *  Q2 주관식(10점): 원인 — 현장 근거(설비·자재·인력·공정)로 설명.
 *  Q3 주관식(10점): 조치 — 다음 달 목표 대비 구체 행동과 기대 효과.
 * 주관식은 AI가 1차 채점(0~10, 근거 피드백)하고 임원이 확정한다. 점수는 30점 만점을 100점으로 환산.
 * 출제 대상: 바인딩 enabled+quizEnabled, 활성 팀 목표의 KR, 기준월 값이 자동 수집돼 있고 비교할 전월 값이 있는 것.
 * 응답자: 그 KPI 팀의 조직 책임자(OrgUnit.managerId), 없으면 KPI 담당(ownerId).
 * 자동 출제: 매일 KST 03:00 이후 점검, 매월 3일부터 직전 마감월 분을 1회 출제(1일 02:00 수집분 반영 후). unique(keyResultId,year,month)로 중복 방지.
 */
const KST = 9 * 3600000;
export type QuizQuestion = { no: number; type: 'CHOICE' | 'TEXT'; text: string; options?: string[]; answerIdx?: number; rubric?: string; points: number };
export type MonthValue = { year: number; month: number; value: number | null };

@Injectable()
export class KpiQuizService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KpiQuizService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.autoGenerate(), 60 * 60 * 1000);
    setTimeout(() => void this.autoGenerate(), 3 * 60 * 1000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  kstNow() { return new Date(Date.now() + KST); }
  /** 직전 마감월 */
  prevMonth(d = this.kstNow()) { const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }; }

  /** 바인딩이 기록한(자동 수집) 월별 값만 — 사람 자기신고는 시험 근거로 쓰지 않는다 */
  async seriesFor(keyResultId: string, upto: { year: number; month: number }, months = 12): Promise<MonthValue[]> {
    const fromFixed = new Date(Date.UTC(upto.year, upto.month - months, 1) - KST); // Date.UTC는 월 음수도 정상 처리
    const to = new Date(Date.UTC(upto.year, upto.month, 0, 23, 59, 59, 999) - KST);
    const rows: any[] = await this.prisma.progressEntry.findMany({ where: { keyResultId, note: { startsWith: 'binding:' }, periodStart: { gte: fromFixed, lte: to }, krValue: { not: null } }, orderBy: { periodStart: 'asc' }, select: { periodStart: true, krValue: true, note: true } });
    const out: MonthValue[] = [];
    for (const r of rows) {
      const k = new Date(new Date(r.periodStart).getTime() + KST);
      const y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
      if (String(r.note || '').includes(':provisional')) continue; // 잠정값(진행 중인 달)은 제외
      const i = out.findIndex((o) => o.year === y && o.month === m);
      if (i >= 0) out[i].value = r.krValue; else out.push({ year: y, month: m, value: r.krValue });
    }
    return out;
  }

  async respondentFor(kr: any): Promise<string> {
    const org = kr.objective?.orgUnitId ? await this.prisma.orgUnit.findUnique({ where: { id: kr.objective.orgUnitId }, select: { managerId: true } }) : null;
    return org?.managerId || kr.ownerId;
  }

  private fmt(v: number | null | undefined, unit: string) { return v == null ? '-' : `${Math.round(v * 100) / 100}${unit || ''}`; }

  /** 문항 생성 — Q1은 데이터로, Q2·Q3는 AI가 KPI 맥락에 맞게 문구·채점기준을 다듬는다(실패 시 기본 문구) */
  async buildQuestions(kr: any, series: MonthValue[], ym: { year: number; month: number }): Promise<QuizQuestion[]> {
    const cur = series.find((s) => s.year === ym.year && s.month === ym.month);
    const pm = ym.month === 1 ? { year: ym.year - 1, month: 12 } : { year: ym.year, month: ym.month - 1 };
    const prev = series.find((s) => s.year === pm.year && s.month === pm.month);
    if (!cur || cur.value == null || !prev || prev.value == null) throw new BadRequestException('기준월 또는 전월의 자동 수집 값이 없어 출제할 수 없습니다');
    const unit = String(kr.unit || '');
    const diff = cur.value - prev.value;
    const rel = prev.value !== 0 ? Math.abs(diff / prev.value) : (diff === 0 ? 0 : 1);
    const answerIdx = rel < 0.02 ? 2 : diff > 0 ? 0 : 1;
    const q1: QuizQuestion = {
      no: 1, type: 'CHOICE', points: 10,
      text: `${ym.month}월 「${kr.title}」 실제 수치는 ${pm.month}월과 비교해 어떻게 변했습니까? (데이터 연결 값 기준)`,
      options: [`${pm.month}월보다 올랐다 (2% 이상)`, `${pm.month}월보다 내렸다 (2% 이상)`, '거의 같다 (±2% 이내)'], answerIdx,
    };
    const target = monthTargetOf(kr, ym.month - 1);
    const pct = achPct(kr, cur.value, target);
    const dirText = kr.direction === 'AT_MOST' ? '낮을수록 좋음' : '높을수록 좋음';
    let q2 = `${ym.month}월 「${kr.title}」이(가) ${this.fmt(cur.value, unit)}로 나온 주된 원인을 현장 근거(설비·자재·인력·공정·외부 요인)로 설명하세요. 어떤 데이터·사건이 근거인지 함께 적으세요.`;
    let q3 = `다음 달 목표(${this.fmt(target ?? kr.target, unit)}, ${dirText}) 대비 어떤 조치를 하겠습니까? 누가·무엇을·언제까지 할지와 기대 효과(수치)를 적으세요.`;
    let r2 = '원인이 구체적 현장 요인으로 특정되는가(3) · 근거 데이터/사건을 제시하는가(3) · 수치 변화의 크기와 방향을 올바르게 이해하는가(2) · 추측과 사실을 구분하는가(2)';
    let r3 = '행동이 구체적인가(담당·기한·방법)(4) · 원인과 조치가 논리적으로 연결되는가(3) · 기대 효과를 수치로 제시하는가(2) · 실행 가능성(1)';
    try {
      const ctx = { kpi: { title: kr.title, metric: kr.metric, unit, direction: kr.direction, aggregation: kr.aggregation, target: kr.target, team: kr.objective?.orgUnit?.name || '' }, series: series.map((s) => `${s.year}-${String(s.month).padStart(2, '0')}: ${s.value}`), month: `${ym.year}-${String(ym.month).padStart(2, '0')}`, achievementPct: pct };
      const r = await callAI({
        system: '당신은 제조회사 임원 코치입니다. 팀장이 KPI 실제 데이터를 얼마나 이해하고 행동으로 잇는지 묻는 주관식 2문항(원인·조치)을 KPI 맥락에 맞게 한국어로 만듭니다. 질문은 데이터에 드러난 특징(급등·급락·목표 미달·추세)을 콕 집어 묻고, 각 문항에 10점 만점 채점기준(항목별 배점 합 10)을 붙입니다. 출력(JSON만): {"q2":{"text":"...","rubric":"..."},"q3":{"text":"...","rubric":"..."}}',
        user: JSON.stringify(ctx), model: 'claude', temperature: 0.3, maxTokens: 1200,
      });
      const p = r.parsed || {};
      if (p.q2?.text && p.q2?.rubric) { q2 = String(p.q2.text).slice(0, 600); r2 = String(p.q2.rubric).slice(0, 600); }
      if (p.q3?.text && p.q3?.rubric) { q3 = String(p.q3.text).slice(0, 600); r3 = String(p.q3.rubric).slice(0, 600); }
    } catch (e) { this.logger.warn(`question AI failed, using defaults: ${(e as any)?.message}`); }
    return [q1, { no: 2, type: 'TEXT', points: 10, text: q2, rubric: r2 }, { no: 3, type: 'TEXT', points: 10, text: q3, rubric: r3 }];
  }

  /** 출제 후보: 바인딩 켜짐+시험 켜짐, 활성 팀 목표 KR, 바인딩 오류 없음 */
  async candidates(keyResultId?: string) {
    const bindings: any[] = await (this.prisma as any).kpiBinding.findMany({
      where: { enabled: true, quizEnabled: true, lastError: null, ...(keyResultId ? { keyResultId } : {}) },
      include: { keyResult: { include: { objective: { include: { orgUnit: { select: { name: true, managerId: true } } } } } } },
    });
    return bindings.filter((b) => ['ACTIVE', 'LOCKED'].includes(String(b.keyResult?.objective?.status)));
  }

  /** 특정 KPI·월 출제 (이미 있으면 그대로 반환) */
  async generateOne(binding: any, ym: { year: number; month: number }, createdById: string | null) {
    const kr = binding.keyResult;
    const exists = await (this.prisma as any).kpiQuiz.findUnique({ where: { keyResultId_year_month: { keyResultId: kr.id, year: ym.year, month: ym.month } } });
    if (exists) return { quiz: exists, created: false };
    const series = await this.seriesFor(kr.id, ym);
    const questions = await this.buildQuestions(kr, series, ym);
    const respondentId = await this.respondentFor(kr);
    const dueAt = new Date(Date.now() + 7 * 86400000);
    const quiz = await (this.prisma as any).kpiQuiz.create({
      data: {
        keyResultId: kr.id, year: ym.year, month: ym.month, respondentId, questions, dueAt, createdById,
        dataSnapshot: { series, target: kr.target, unit: kr.unit, direction: kr.direction, aggregation: kr.aggregation, title: kr.title, team: kr.objective?.orgUnit?.name || '' },
      },
    });
    await this.prisma.notification.create({ data: { userId: respondentId, type: 'KpiQuizAssigned', subjectType: 'KPI_QUIZ', subjectId: quiz.id, payload: { title: kr.title, year: ym.year, month: ym.month, dueAt } } }).catch(() => {});
    return { quiz, created: true };
  }

  /** 월 단위 일괄 출제 */
  async generateMonth(ym: { year: number; month: number }, createdById: string | null, keyResultId?: string) {
    const list = await this.candidates(keyResultId);
    const out: any[] = [];
    for (const b of list) {
      try { const r = await this.generateOne(b, ym, createdById); out.push({ keyResultId: b.keyResultId, title: b.keyResult.title, created: r.created, quizId: r.quiz.id }); }
      catch (e: any) { out.push({ keyResultId: b.keyResultId, title: b.keyResult.title, created: false, error: String(e?.message || e) }); }
    }
    return out;
  }

  async autoGenerate() {
    try {
      const k = this.kstNow();
      if (k.getUTCHours() < 3 || k.getUTCDate() < 3) return; // 매월 3일 03:00 이후 (1일 02:00 수집분 확정 후)
      const ym = this.prevMonth(k);
      const list = await this.candidates();
      for (const b of list) {
        const exists = await (this.prisma as any).kpiQuiz.findUnique({ where: { keyResultId_year_month: { keyResultId: b.keyResultId, year: ym.year, month: ym.month } } });
        if (exists) continue;
        try { await this.generateOne(b, ym, null); this.logger.log(`quiz generated: ${b.keyResult.title} ${ym.year}-${ym.month}`); }
        catch (e: any) { this.logger.warn(`quiz skip ${b.keyResult.title}: ${e?.message}`); }
      }
    } catch (e) { this.logger.warn(`autoGenerate failed: ${(e as any)?.message}`); }
  }

  /** 응답 저장 + 자동/AI 채점 */
  async answer(quiz: any, answers: Array<{ no: number; choiceIdx?: number; text?: string }>) {
    const qs: QuizQuestion[] = quiz.questions || [];
    const grading: Array<{ no: number; score: number; max: number; feedback: string }> = [];
    const byNo = new Map(answers.map((a) => [Number(a.no), a]));
    for (const q of qs) {
      const a = byNo.get(q.no);
      if (q.type === 'CHOICE') {
        const ok = a?.choiceIdx != null && Number(a.choiceIdx) === q.answerIdx;
        grading.push({ no: q.no, score: ok ? q.points : 0, max: q.points, feedback: ok ? '정답 — 데이터와 일치합니다.' : `오답 — 데이터 기준 정답은 "${q.options?.[q.answerIdx ?? 0]}"입니다.` });
      }
    }
    const texts = qs.filter((q) => q.type === 'TEXT');
    if (texts.length) {
      const snap = quiz.dataSnapshot || {};
      try {
        const r = await callAI({
          system: '당신은 제조회사 임원입니다. 팀장이 KPI 실제 데이터에 대해 쓴 답을 채점기준(rubric)에 따라 엄격하지만 공정하게 채점합니다. 근거 없는 일반론·추측에는 점수를 주지 않고, 구체적 현장 근거·담당·기한·수치가 있으면 높게 줍니다. 각 문항 0~10 정수, 피드백은 2~3문장 한국어로 "잘한 점 / 보완할 점". 출력(JSON만): {"items":[{"no":2,"score":0~10,"feedback":"..."},{"no":3,"score":0~10,"feedback":"..."}]}',
          user: JSON.stringify({ kpi: { title: snap.title, unit: snap.unit, direction: snap.direction, target: snap.target }, series: snap.series, questions: texts.map((q) => ({ no: q.no, text: q.text, rubric: q.rubric })), answers: texts.map((q) => ({ no: q.no, text: String(byNo.get(q.no)?.text || '') })) }),
          model: 'claude', temperature: 0.1, maxTokens: 1500,
        });
        const items: any[] = Array.isArray(r.parsed?.items) ? r.parsed.items : [];
        for (const q of texts) {
          const it = items.find((x) => Number(x.no) === q.no);
          const sc = Math.max(0, Math.min(q.points, Math.round(Number(it?.score) || 0)));
          grading.push({ no: q.no, score: sc, max: q.points, feedback: String(it?.feedback || '').slice(0, 800) || '채점 피드백 없음' });
        }
      } catch (e) {
        this.logger.warn(`grading AI failed: ${(e as any)?.message}`);
        for (const q of texts) grading.push({ no: q.no, score: 0, max: q.points, feedback: 'AI 채점 실패 — 임원이 직접 채점해 주세요.' });
      }
    }
    const max = grading.reduce((s, g) => s + g.max, 0) || 1;
    const aiScore = Math.round((grading.reduce((s, g) => s + g.score, 0) / max) * 1000) / 10;
    return (this.prisma as any).kpiQuiz.update({ where: { id: quiz.id }, data: { answers, answeredAt: new Date(), aiGrading: grading.sort((a, b) => a.no - b.no), aiScore, status: 'ANSWERED' } });
  }

  /** 개인·팀 "데이터 감각 점수" — 확정점수(없으면 AI점수) 평균, 응답률 */
  async board(year?: number) {
    const where: any = year ? { year } : {};
    const rows: any[] = await (this.prisma as any).kpiQuiz.findMany({ where, select: { id: true, respondentId: true, status: true, aiScore: true, finalScore: true, year: true, month: true, dataSnapshot: true, dueAt: true } });
    const ids = Array.from(new Set(rows.map((r) => r.respondentId)));
    const users: any[] = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } }) : [];
    const umap = new Map(users.map((u) => [u.id, u]));
    const per = new Map<string, { userId: string; name: string; team: string; teamId: string; total: number; answered: number; graded: number; overdue: number; sum: number; n: number }>();
    const now = Date.now();
    for (const r of rows) {
      const u = umap.get(r.respondentId);
      const p = per.get(r.respondentId) || { userId: r.respondentId, name: u?.name || '(알 수 없음)', team: u?.orgUnit?.name || '', teamId: u?.orgUnit?.id || '', total: 0, answered: 0, graded: 0, overdue: 0, sum: 0, n: 0 };
      p.total++;
      if (r.status === 'ANSWERED' || r.status === 'GRADED') p.answered++;
      if (r.status === 'GRADED') p.graded++;
      if (r.status === 'OPEN' && new Date(r.dueAt).getTime() < now) p.overdue++;
      const sc = r.finalScore ?? r.aiScore;
      if (sc != null && r.status !== 'OPEN') { p.sum += sc; p.n++; }
      per.set(r.respondentId, p);
    }
    const people = Array.from(per.values()).map((p) => ({ ...p, avg: p.n ? Math.round((p.sum / p.n) * 10) / 10 : null, responseRate: p.total ? Math.round((p.answered / p.total) * 100) : 0 })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
    const teams = new Map<string, { teamId: string; team: string; total: number; answered: number; sum: number; n: number }>();
    for (const p of people) { const t = teams.get(p.teamId) || { teamId: p.teamId, team: p.team || '(미지정)', total: 0, answered: 0, sum: 0, n: 0 }; t.total += p.total; t.answered += p.answered; t.sum += p.sum; t.n += p.n; teams.set(p.teamId, t); }
    const summary = { total: rows.length, answered: rows.filter((r) => r.status !== 'OPEN' && r.status !== 'SKIPPED').length, graded: rows.filter((r) => r.status === 'GRADED').length, open: rows.filter((r) => r.status === 'OPEN').length, avg: people.length && people.some((p) => p.n) ? Math.round((people.reduce((s, p) => s + p.sum, 0) / people.reduce((s, p) => s + p.n, 0)) * 10) / 10 : null };
    return { people, teams: Array.from(teams.values()).map((t) => ({ ...t, avg: t.n ? Math.round((t.sum / t.n) * 10) / 10 : null, responseRate: t.total ? Math.round((t.answered / t.total) * 100) : 0 })), summary };
  }
}
