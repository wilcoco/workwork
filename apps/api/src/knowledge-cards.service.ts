import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { callAI } from './llm/ai-client';

/**
 * 5단계 암묵지 카드 — 업무일지의 문제·예외 문장과 매뉴얼에서 "증상 → 확인 순서 → 조치"를 AI가 뽑아 DRAFT로 만들고,
 * 원 작성자(담당자)가 확인(CONFIRMED)하면 프로세스 화면·검색에 노출된다.
 *  - 추출 대상: 최근 180일 업무일지 중 문제 키워드가 있고 아직 스캔 안 된 것(한 번에 25건), 매뉴얼(한 번에 5건)
 *  - 중복: 정규화 제목이 같으면 만들지 않음. 확신도 60 미만은 버림.
 *  - 야간 04:00 KST 자동 1회 + 임원 수동 실행.
 */
const KST = 9 * 3600000;
const PROBLEM_RE = /(불량|문제|고장|이상|원인|조치|대응|예외|긴급|중단|트러블|클레임|재발|누락|지연|파손|오염|누수|누유|정지|알람|에러|오류)/;
export const normTitle = (t: string) => String(t || '').toLowerCase().replace(/[\s\-_·.,/()[\]{}:;'"!?~]/g, '');

@Injectable()
export class KnowledgeCardsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeCardsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private prisma: PrismaService) {}

  onModuleInit() { this.timer = setInterval(() => void this.nightly(), 60 * 60 * 1000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async nightly() {
    const k = new Date(Date.now() + KST);
    if (k.getUTCHours() !== 4) return; // 04시대에 1회(매시 점검이므로 running 플래그로 중복 방지)
    try { await this.extractBatch(25, 5, null); } catch (e) { this.logger.warn(`nightly extract failed: ${(e as any)?.message}`); }
  }

  /** 추출 실행 — 결과 요약 반환 */
  async extractBatch(worklogLimit = 25, manualLimit = 5, actorId: string | null = null) {
    if (this.running) return { skipped: true, reason: 'already running' };
    this.running = true;
    const out = { worklogsScanned: 0, manualsScanned: 0, created: 0, duplicates: 0, lowConfidence: 0 };
    try {
      const since = new Date(Date.now() - 180 * 86400000);
      const logs: any[] = await this.prisma.worklog.findMany({ where: { kcScannedAt: null, date: { gte: since }, note: { not: null } }, orderBy: { date: 'desc' }, take: worklogLimit * 3, select: { id: true, note: true, date: true, createdById: true, activityId: true, createdBy: { select: { orgUnitId: true, name: true } }, initiative: { select: { title: true } } } });
      const cand = logs.filter((l) => PROBLEM_RE.test(String(l.note || '')) && String(l.note || '').length >= 40).slice(0, worklogLimit);
      // 키워드 없는 것은 스캔 완료 처리만
      const noKw = logs.filter((l) => !cand.includes(l)).map((l) => l.id);
      if (noKw.length) await this.prisma.worklog.updateMany({ where: { id: { in: noKw } }, data: { kcScannedAt: new Date() } as any });
      for (let i = 0; i < cand.length; i += 5) {
        const chunk = cand.slice(i, i + 5);
        const r = await this.extractFrom(chunk.map((l) => ({ id: l.id, kind: 'WORKLOG', title: l.initiative?.title || '', text: String(l.note || '').slice(0, 2500), author: l.createdBy?.name || '', date: new Date(l.date).toISOString().slice(0, 10) })));
        for (const c of r) {
          const src = chunk.find((l) => l.id === c.sourceId);
          if (!src) continue;
          const res = await this.saveCard(c, { sourceType: 'WORKLOG', sourceId: src.id, ownerId: src.createdById, orgUnitId: src.createdBy?.orgUnitId || null, activityId: src.activityId || null, createdById: actorId });
          out[res]++;
        }
        await this.prisma.worklog.updateMany({ where: { id: { in: chunk.map((l) => l.id) } }, data: { kcScannedAt: new Date() } as any });
        out.worklogsScanned += chunk.length;
      }
      const manuals: any[] = await (this.prisma as any).workManual.findMany({ where: { kcScannedAt: null, status: { in: ['REVIEW', 'APPROVED', 'PUBLISHED'] } }, orderBy: { updatedAt: 'desc' }, take: manualLimit, select: { id: true, title: true, content: true, userId: true, user: { select: { orgUnitId: true, name: true } } } });
      for (const m of manuals) {
        const text = String(m.content || '');
        if (PROBLEM_RE.test(text) && text.length >= 100) {
          const r = await this.extractFrom([{ id: m.id, kind: 'MANUAL', title: m.title, text: text.slice(0, 6000), author: m.user?.name || '', date: '' }]);
          for (const c of r) { const res = await this.saveCard(c, { sourceType: 'MANUAL', sourceId: m.id, ownerId: m.userId, orgUnitId: m.user?.orgUnitId || null, activityId: null, createdById: actorId }); out[res]++; }
        }
        await (this.prisma as any).workManual.update({ where: { id: m.id }, data: { kcScannedAt: new Date() } });
        out.manualsScanned++;
      }
      this.logger.log(`knowledge cards: ${JSON.stringify(out)}`);
      return out;
    } finally { this.running = false; }
  }

  /** AI 추출 — 입력 묶음에서 카드 후보 */
  private async extractFrom(docs: Array<{ id: string; kind: string; title: string; text: string; author: string; date: string }>): Promise<any[]> {
    try {
      const r = await callAI({
        system: `당신은 제조회사의 현장 지식 편집자입니다. 업무일지/매뉴얼 본문에서 "다음에 같은 일이 생기면 쓸 수 있는" 암묵지를 카드로 뽑습니다.
카드 = 제목(증상을 한 줄로) · 증상/상황(언제·어디서·무엇이) · 확인 순서(무엇부터 확인하는지 2~5단계, 각 한 줄) · 조치(어떻게 해결/대응했는지) · 태그(설비·차종·공정·고객사 등 2~5개).
규칙: 본문에 실제로 적힌 사실만 쓴다(지어내지 않음). 단순 보고("이상 없음", 회의 참석, 일정)는 카드로 만들지 않는다. 원인·조치가 없고 증상만 있으면 confidence를 낮춘다(60 미만이면 버려짐). 문서 하나에서 0~2장. 한국어.
출력(JSON만): {"cards":[{"sourceId":"","title":"","symptom":"","checks":["",""],"action":"","tags":[""],"confidence":0~100,"excerpt":"근거 문장 1~2개"}]}`,
        user: JSON.stringify({ docs }), model: 'claude', temperature: 0.1, maxTokens: 3000,
      });
      return Array.isArray(r.parsed?.cards) ? r.parsed.cards : [];
    } catch (e) { this.logger.warn(`extract AI failed: ${(e as any)?.message}`); return []; }
  }

  private async saveCard(c: any, meta: { sourceType: string; sourceId: string; ownerId: string; orgUnitId: string | null; activityId: string | null; createdById: string | null }): Promise<'created' | 'duplicates' | 'lowConfidence'> {
    const conf = Math.max(0, Math.min(100, Math.round(Number(c.confidence) || 0)));
    const title = String(c.title || '').trim().slice(0, 200);
    if (!title || conf < 60 || !String(c.action || '').trim()) return 'lowConfidence';
    const nt = normTitle(title);
    const dup = await (this.prisma as any).knowledgeCard.findFirst({ where: { normTitle: nt, status: { not: 'ARCHIVED' } }, select: { id: true } });
    if (dup) return 'duplicates';
    await (this.prisma as any).knowledgeCard.create({ data: { title, normTitle: nt, symptom: String(c.symptom || '').slice(0, 3000), checks: Array.isArray(c.checks) ? c.checks.map(String).slice(0, 8) : [], action: String(c.action || '').slice(0, 3000), tags: Array.isArray(c.tags) ? c.tags.map(String).slice(0, 8) : [], sourceType: meta.sourceType, sourceId: meta.sourceId, sourceExcerpt: String(c.excerpt || '').slice(0, 1500), activityId: meta.activityId, orgUnitId: meta.orgUnitId, ownerId: meta.ownerId, confidence: conf, createdById: meta.createdById } });
    await this.prisma.notification.create({ data: { userId: meta.ownerId, type: 'KnowledgeCardDraft', subjectType: 'KNOWLEDGE_CARD', subjectId: meta.sourceId, payload: { title } } }).catch(() => {});
    return 'created';
  }

  /** 관련 카드 — 활동 ID 목록·검색어로 CONFIRMED 카드 찾기 */
  async related(opts: { activityIds?: string[]; q?: string; orgUnitId?: string | null; limit?: number }) {
    const limit = opts.limit || 6;
    const seen = new Set<string>();
    const out: any[] = [];
    const push = (rows: any[]) => { for (const r of rows) if (!seen.has(r.id) && out.length < limit) { seen.add(r.id); out.push(r); } };
    if (opts.activityIds?.length) push(await (this.prisma as any).knowledgeCard.findMany({ where: { status: 'CONFIRMED', activityId: { in: opts.activityIds } }, orderBy: { useCount: 'desc' }, take: limit }));
    const tokens = String(opts.q || '').split(/[\s,·/()]+/).map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 6);
    if (out.length < limit && tokens.length) {
      push(await (this.prisma as any).knowledgeCard.findMany({ where: { status: 'CONFIRMED', OR: tokens.flatMap((t) => [{ title: { contains: t } }, { symptom: { contains: t } }]) }, orderBy: { useCount: 'desc' }, take: limit }));
    }
    return out;
  }
}
