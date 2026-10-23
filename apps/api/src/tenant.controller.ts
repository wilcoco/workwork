import { BadRequestException, Body, Controller, ForbiddenException, Get, OnModuleInit, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';
import { TENANT_DEFAULTS, TENANT_KEYS, TENANT_KEY_LABELS, tenantGet, tenantGetAll, tenantSet } from './lib/tenant';
import { setDefaultProvider } from './llm/ai-client';

/**
 * 6단계 테넌트 API — 설정 조회/수정(대표), 공개 설정(회사명·숨김 이름), 데이터 반출(대표), 온보딩 진행 상태(대표)
 */
@Controller('tenant')
export class TenantController implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try { setDefaultProvider(await tenantGet(this.prisma, 'ai.defaultProvider')); } catch { /* 기본값 유지 */ }
  }

  private async ceo(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u || String(u.role).toUpperCase() !== 'CEO') throw new ForbiddenException('대표만 할 수 있습니다');
    return u;
  }

  /** 로그인 전에도 필요한 공개 설정 */
  @Public()
  @Get('public')
  async pub() {
    const [name, hiddenNames, features] = await Promise.all([tenantGet(this.prisma, 'company.name'), tenantGet(this.prisma, 'accounts.hiddenNames'), tenantGet(this.prisma, 'features')]);
    return { companyName: name, hiddenNames, features };
  }

  @Get('settings')
  async settings(@Query('userId') userId?: string) {
    await this.ceo(userId);
    const values = await tenantGetAll(this.prisma);
    const rows: any[] = await (this.prisma as any).tenantSetting.findMany();
    const meta = Object.fromEntries(rows.map((r) => [r.key, { updatedAt: r.updatedAt, updatedById: r.updatedById }]));
    return { keys: TENANT_KEYS.map((k) => ({ key: k, label: TENANT_KEY_LABELS[k] || k, value: values[k], defaultValue: TENANT_DEFAULTS[k], custom: !!meta[k], updatedAt: meta[k]?.updatedAt || null })), env: { anthropicKey: !!process.env.ANTHROPIC_API_KEY, openaiKey: !!process.env.OPENAI_API_KEY, oracleSyncToken: !!process.env.ORACLE_SYNC_TOKEN, sharepoint: !!process.env.SHAREPOINT_SITE_ID || !!process.env.GRAPH_CLIENT_ID, odoo: !!process.env.ODOO_URL } };
  }

  @Put('settings')
  async update(@Body() b: any) {
    const u = await this.ceo(b?.userId);
    const key = String(b?.key || '');
    if (!TENANT_KEYS.includes(key)) throw new BadRequestException('알 수 없는 설정 키');
    let value = b?.value;
    const def = TENANT_DEFAULTS[key];
    if (Array.isArray(def) && !Array.isArray(value)) throw new BadRequestException('배열이어야 합니다');
    if (typeof def === 'string' && typeof value !== 'string') throw new BadRequestException('문자열이어야 합니다');
    if (typeof def === 'object' && !Array.isArray(def) && (typeof value !== 'object' || Array.isArray(value))) throw new BadRequestException('객체여야 합니다');
    if (key === 'ai.defaultProvider') { value = value === 'openai' ? 'openai' : 'claude'; setDefaultProvider(value); }
    if (b?.reset) { await (this.prisma as any).tenantSetting.deleteMany({ where: { key } }); const { tenantInvalidate } = await import('./lib/tenant'); tenantInvalidate(); return { key, value: def, custom: false }; }
    await tenantSet(this.prisma, key, value, u.id);
    return { key, value, custom: true };
  }

  /** 온보딩 체크리스트 — 새 회사가 첫 성과까지 가는 순서 */
  @Get('onboarding')
  async onboarding(@Query('userId') userId?: string) {
    await this.ceo(userId);
    const p: any = this.prisma;
    const [orgs, users, agendas, objectives, krs, bindings, manuals, templates, worklogs, approvals, cards] = await Promise.all([
      p.orgUnit.count({ where: { type: 'TEAM' } }), p.user.count({ where: { status: 'ACTIVE' } }), p.agenda.count({ where: { status: { in: ['OPEN', 'CLOSED'] } } }),
      p.objective.count({ where: { status: { in: ['ACTIVE', 'LOCKED'] } } }), p.keyResult.count({ where: { objective: { status: { in: ['ACTIVE', 'LOCKED'] } } } }), p.kpiBinding.count({ where: { enabled: true } }),
      p.workManual.count(), p.processTemplate.count(), p.worklog.count({ where: { date: { gte: new Date(Date.now() - 30 * 86400000) } } }), p.approvalRequest.count(), p.knowledgeCard.count({ where: { status: 'CONFIRMED' } }),
    ]);
    const steps = [
      { key: 'org', title: '1. 조직도와 구성원', done: orgs >= 1 && users >= 2, detail: `팀 ${orgs}개 · 활성 구성원 ${users}명`, link: '/admin/orgs', hint: '팀을 만들고 팀장을 조직 책임자로 지정하세요 — 결재·시험지·클레임이 모두 조직도를 따릅니다' },
      { key: 'agenda', title: '2. 대표의 목표 한 문장 → 어젠다', done: agendas >= 1, detail: `공개된 어젠다 ${agendas}건`, link: '/okr/agenda', hint: '한 문장을 쓰면 AI가 항목으로 쪼개고 팀이 클레임합니다' },
      { key: 'kpi', title: '3. 팀 KPI(KR) 정의', done: krs >= 3, detail: `활성 목표 ${objectives}개 · KR ${krs}개`, link: '/okr/team', hint: '클레임 승인으로 자동 생성되거나 직접 등록' },
      { key: 'binding', title: '4. KPI 데이터 연결', done: bindings >= 1, detail: `연결된 KPI ${bindings}개`, link: '/okr/kpi-result', hint: '자기신고 대신 ERP·내부 데이터에서 실적이 오게 — 시험지·계기판의 전제' },
      { key: 'worklog', title: '5. 업무일지 습관', done: worklogs >= 20, detail: `최근 30일 일지 ${worklogs}건`, link: '/worklogs', hint: '일지가 쌓여야 암묵지 카드·온톨로지가 자랍니다' },
      { key: 'approval', title: '6. 결재 온라인화', done: approvals >= 5, detail: `결재 ${approvals}건`, link: '/approvals/inbox', hint: '결재 리드타임이 계기판 구성 요소입니다' },
      { key: 'manual', title: '7. 업무 매뉴얼 → 프로세스', done: manuals >= 3 && templates >= 1, detail: `매뉴얼 ${manuals}개 · 프로세스 템플릿 ${templates}개`, link: '/manuals/new', hint: 'AI 검토 80점 이상 → 팀장 승인 → 프로세스화' },
      { key: 'cards', title: '8. 암묵지 카드', done: cards >= 5, detail: `확인된 카드 ${cards}장`, link: '/knowledge/cards', hint: '일지·매뉴얼에서 자동 추출, 작성자 확인' },
    ];
    return { steps, doneCount: steps.filter((s) => s.done).length };
  }

  /** 데이터 반출 — 핵심 테이블을 JSON 한 묶음으로(대표). 비밀번호·토큰은 제외 */
  @Get('export')
  async exportAll(@Query('userId') userId: string, @Res() res: Response) {
    await this.ceo(userId);
    const p: any = this.prisma;
    const take = 50000;
    const bundle: Record<string, any> = {
      exportedAt: new Date().toISOString(), companyName: await tenantGet(this.prisma, 'company.name'), settings: await tenantGetAll(this.prisma),
      orgUnits: await p.orgUnit.findMany(),
      users: await p.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, orgUnitId: true, employeeNo: true, createdAt: true } }),
      objectives: await p.objective.findMany({ take }), keyResults: await p.keyResult.findMany({ take }), keyResultAssignments: await p.keyResultAssignment.findMany({ take }),
      progressEntries: await p.progressEntry.findMany({ take }), kpiBindings: await p.kpiBinding.findMany({ take }), kpiQuizzes: await p.kpiQuiz.findMany({ take }),
      agendas: await p.agenda.findMany({ include: { items: { include: { claims: true } } } }),
      keyInitiatives: await p.keyInitiative.findMany({ take }), initiatives: await p.initiative.findMany({ take }),
      worklogs: await p.worklog.findMany({ take }), worklogGoalTags: await p.worklogGoalTag.findMany({ take }),
      workManuals: await p.workManual.findMany({ take }), processTemplates: await p.processTemplate.findMany({ take }), processTaskTemplates: await p.processTaskTemplate.findMany({ take }),
      processInstances: await p.processInstance.findMany({ take }), processTaskInstances: await p.processTaskInstance.findMany({ take }),
      approvalRequests: await p.approvalRequest.findMany({ take }), approvalSteps: await p.approvalStep.findMany({ take }),
      activities: await p.activity.findMany({ take }), knowledgeCards: await p.knowledgeCard.findMany({ take }), opsMetricDaily: await p.opsMetricDaily.findMany({ take }),
    };
    const fname = `workwork_export_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(JSON.stringify(bundle));
  }
}
