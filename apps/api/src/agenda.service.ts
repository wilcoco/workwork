import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { callAI } from './llm/ai-client';

/**
 * 4단계 어젠다 클레임 — 대표의 한 문장 → AI 항목 초안+되묻는 질문 → 공개 → 팀이 지표·목표치로 클레임 → 대표 승인 → KR 생성·정렬.
 * 미클레임 항목이 붉게 보이는 "클레임 지도"가 실행 조직도가 된다.
 */
@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);
  constructor(private prisma: PrismaService) {}

  /** 클레임 지도에 올릴 팀: TEAM 유형 + 활성 구성원 1명 이상 */
  async teams() {
    const units: any[] = await this.prisma.orgUnit.findMany({ where: { type: 'TEAM' }, select: { id: true, name: true, managerId: true, manager: { select: { name: true } }, _count: { select: { users: { where: { status: 'ACTIVE' as any } } } } }, orderBy: { name: 'asc' } });
    return units.filter((u) => u._count.users > 0).map((u) => ({ id: u.id, name: u.name, managerId: u.managerId, managerName: u.manager?.name || '' }));
  }

  private async companyContext() {
    const teams = await this.teams();
    const krs: any[] = await this.prisma.keyResult.findMany({ where: { objective: { status: { in: ['ACTIVE', 'LOCKED'] as any } } }, select: { title: true, unit: true, target: true, objective: { select: { orgUnit: { select: { name: true } } } } }, take: 80 });
    return { teams: teams.map((t) => t.name), existingKpis: krs.map((k) => `${k.objective?.orgUnit?.name || ''}: ${k.title} (${k.target}${k.unit})`) };
  }

  /** 한 문장 → 항목 초안 + 되묻는 질문 */
  async draft(statement: string, year: number) {
    const ctx = await this.companyContext();
    const r = await callAI({
      system: `당신은 중소 제조기업 대표의 전략 코치입니다. 대표가 쓴 "올해 목표 한 문장"을 실행 가능한 어젠다 항목으로 쪼갭니다.
규칙: 항목 4~7개, 각 항목은 한 팀이 책임질 수 있는 크기. 가중치 합 100. 각 항목에 KR 초안(산식·단위·목표치·방향 AT_LEAST/AT_MOST·권장 팀 1~2개)과 왜 이 항목인지 한 줄. 회사의 기존 KPI·팀 목록을 참고해 겹치면 그 지표를 쓰고, 목표치는 문장에 숫자가 없으면 "확인 필요"로 두고 합리적 가정을 적습니다.
그리고 대표에게 되묻는 질문 3개: 문장이 모호한 부분(기준 연도·범위·우선순위·제외 대상·측정 기준)을 콕 집어 묻습니다.
출력(JSON만): {"summary":"목표 해석 2~3문장","items":[{"title":"","description":"","weight":0,"krDraft":{"metric":"","unit":"","target":0,"direction":"AT_LEAST","rationale":"","teams":[""]}}],"questions":[{"no":1,"text":""}]}`,
      user: JSON.stringify({ year, statement, ...ctx }), model: 'claude', temperature: 0.3, maxTokens: 3000,
    });
    const p = r.parsed || {};
    const items: any[] = Array.isArray(p.items) ? p.items : [];
    if (!items.length) throw new BadRequestException('AI가 항목을 만들지 못했습니다. 문장을 조금 더 구체적으로 써 주세요.');
    return { summary: String(p.summary || ''), items: items.slice(0, 8).map((it, i) => this.normItem(it, i)), questions: (Array.isArray(p.questions) ? p.questions : []).slice(0, 4).map((q: any, i: number) => ({ no: i + 1, text: String(q.text || q) })) };
  }

  /** 대표 답을 반영해 항목 재정리 */
  async refine(agenda: any, answers: Array<{ no: number; text: string }>) {
    const ctx = await this.companyContext();
    const r = await callAI({
      system: `당신은 중소 제조기업 대표의 전략 코치입니다. 대표의 목표 문장, 1차 항목 초안, 되물은 질문과 대표의 답을 보고 항목을 다시 정리합니다. 답에서 드러난 범위·우선순위·수치를 반영하고 가중치를 재배분(합 100)합니다. 항목 4~7개. 출력(JSON만): {"summary":"","items":[{"title":"","description":"","weight":0,"krDraft":{"metric":"","unit":"","target":0,"direction":"AT_LEAST","rationale":"","teams":[""]}}]}`,
      user: JSON.stringify({ year: agenda.year, statement: agenda.statement, draftItems: agenda.items, questions: agenda.aiQuestions, answers, ...ctx }), model: 'claude', temperature: 0.3, maxTokens: 3000,
    });
    const p = r.parsed || {};
    const items: any[] = Array.isArray(p.items) ? p.items : [];
    if (!items.length) throw new BadRequestException('AI 재정리 실패 — 항목을 직접 수정해 주세요.');
    return { summary: String(p.summary || agenda.summary || ''), items: items.slice(0, 8).map((it, i) => this.normItem(it, i)) };
  }

  normItem(it: any, i: number) {
    const d = it.krDraft || {};
    return {
      order: i, title: String(it.title || '').slice(0, 200), description: String(it.description || '').slice(0, 2000), weight: Math.max(0, Math.min(100, Math.round(Number(it.weight) || 0))),
      krDraft: { metric: String(d.metric || ''), unit: String(d.unit || ''), target: Number(d.target) || 0, direction: d.direction === 'AT_MOST' ? 'AT_MOST' : 'AT_LEAST', rationale: String(d.rationale || ''), teams: Array.isArray(d.teams) ? d.teams.map(String).slice(0, 3) : [] },
    };
  }

  /** 팀이 클레임할 때 AI가 그 팀 관점의 KR 제안 */
  async suggestClaim(item: any, agenda: any, team: { name: string }) {
    const krs: any[] = await this.prisma.keyResult.findMany({ where: { objective: { orgUnit: { name: team.name }, status: { in: ['ACTIVE', 'LOCKED'] as any } } }, select: { title: true, metric: true, unit: true, target: true }, take: 20 });
    const r = await callAI({
      system: `당신은 제조회사 팀장의 코치입니다. 대표 어젠다 항목에 대해 이 팀이 걸 수 있는 KR(제목·산식·단위·목표치·방향)과 "왜 우리 팀이 맡아야 하는지·왜 이 목표치인지" 근거를 한국어로 제안합니다. 팀의 기존 KPI와 겹치면 그 지표를 발전시키고, 측정 불가능한 표현은 피합니다. 출력(JSON만): {"title":"","metric":"","unit":"","target":0,"direction":"AT_LEAST","rationale":""}`,
      user: JSON.stringify({ statement: agenda.statement, item: { title: item.title, description: item.description, krDraft: item.krDraft }, team: team.name, teamKpis: krs }), model: 'claude', temperature: 0.3, maxTokens: 1000,
    });
    const p = r.parsed || {};
    return { title: String(p.title || item.title).slice(0, 200), metric: String(p.metric || '').slice(0, 500), unit: String(p.unit || '').slice(0, 30), target: Number(p.target) || 0, direction: p.direction === 'AT_MOST' ? 'AT_MOST' : 'AT_LEAST', rationale: String(p.rationale || '').slice(0, 2000) };
  }

  /** 승인 → 팀의 어젠다 목표(Objective) 아래 KR 생성 + 담당 배정 */
  async approveClaim(claim: any, item: any, agenda: any, decidedById: string, note?: string) {
    const year = agenda.year;
    const periodStart = new Date(Date.UTC(year, 0, 1) - 9 * 3600000), periodEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59) - 9 * 3600000);
    const objTitle = `${year} 경영 어젠다`;
    return this.prisma.$transaction(async (tx) => {
      let obj: any = await tx.objective.findFirst({ where: { orgUnitId: claim.orgUnitId, title: objTitle, periodStart } });
      if (!obj) obj = await tx.objective.create({ data: { title: objTitle, description: `대표 어젠다: ${agenda.statement}`.slice(0, 1000), orgUnitId: claim.orgUnitId, ownerId: claim.claimedById, periodStart, periodEnd, status: 'ACTIVE' as any } as any });
      const kr = await tx.keyResult.create({ data: { objectiveId: obj.id, title: claim.title, metric: claim.metric || '', target: claim.target, unit: claim.unit, ownerId: claim.claimedById, weight: Math.max(1, item.weight || 1), type: 'OPERATIONAL' as any, direction: (claim.direction as any) || undefined, cadence: 'MONTHLY' as any } as any });
      await (tx as any).keyResultAssignment.createMany({ data: [{ keyResultId: kr.id, userId: claim.claimedById }], skipDuplicates: true });
      const saved = await (tx as any).agendaClaim.update({ where: { id: claim.id }, data: { status: 'APPROVED', keyResultId: kr.id, objectiveId: obj.id, decidedById, decidedAt: new Date(), decisionNote: note || null } });
      await (tx as any).agendaItem.update({ where: { id: item.id }, data: { status: 'APPROVED' } });
      return saved;
    });
  }

  async refreshItemStatus(itemId: string) {
    const claims: any[] = await (this.prisma as any).agendaClaim.findMany({ where: { itemId } });
    const status = claims.some((c) => c.status === 'APPROVED') ? 'APPROVED' : claims.some((c) => c.status === 'PROPOSED') ? 'CLAIMED' : 'OPEN';
    await (this.prisma as any).agendaItem.update({ where: { id: itemId }, data: { status } });
  }
}
