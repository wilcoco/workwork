import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 온톨로지 흐름 맵 (P0) — 회사 객체를 한 장의 그래프로 그리고, 정의 밖으로 흐르는 업무를 뽑아낸다.
 *
 * 열: 앱·현장(원천) → 활동 → KPI·중점과제 → 목표 → 전략 기둥 → 대표
 *
 * 활동 열을 "활동 하나당 노드"로 그리지 않고 **대분류(domain)** 로 묶는다.
 *   근거(2026-11-21 운영 데이터): 활동 사전 6,492개 중 최근 30일에 쓰인 것만 811개이고
 *   상위 20개가 전체 일지의 10%뿐인 긴 꼬리다. 활동 단위로 그리면 800개 점이 되어 읽을 수 없다.
 *   대분류는 12~15개라 한눈에 들어오고, 클릭하면 그 안의 활동으로 내려간다.
 *
 * 정의 밖 경로는 **같은 대상(금형·부품·설비·협력사)을 공유하는 기록**을 시간순으로 이어 만든다.
 *   WorklogEntity가 90일 7,777건 있어 신호가 충분하다. 프로세스 인스턴스는 20건뿐이라 보조로만 쓴다.
 */
const KST = 9 * 3600000;
export const monthKey = (d = new Date()) => new Date(d.getTime() + KST).toISOString().slice(0, 7);
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - KST), end: new Date(Date.UTC(y, m, 1) - KST) };
}
const PILLAR_LABEL: Record<string, string> = { Q: 'Q · 품질', C: 'C · 원가', D: 'D · 납기', DEV: 'DEV · 개발', P: 'P · 사람' };
const SOURCE_LABEL: Record<string, string> = { ORACLE_AGENT: '오라클(사내 에이전트)', ODOO_RPC: 'Odoo MES/ERP', INTERNAL: '내부 데이터', REST: '외부 REST' };

@Injectable()
export class FlowMapService {
  private readonly logger = new Logger(FlowMapService.name);
  constructor(private prisma: PrismaService) {}

  /** 목표(KPI·중점과제)에 연결된 활동 id 집합 */
  private async goalLinkedActivityIds(): Promise<Set<string>> {
    const p: any = this.prisma;
    const [links, krs, kis] = await Promise.all([
      p.goalActivityLink.findMany({ select: { activityId: true } }),
      p.keyResult.findMany({ where: { activityId: { not: null } }, select: { activityId: true } }),
      p.keyInitiative.findMany({ where: { activityId: { not: null } }, select: { activityId: true } }),
    ]);
    return new Set<string>([...links, ...krs, ...kis].map((x: any) => String(x.activityId)));
  }

  /** 전 층 그래프 */
  async graph(month: string) {
    const p: any = this.prisma;
    const { start, end } = monthRange(month);

    // ── 활동 열: 이번 달 기록이 있는 활동을 대분류로 묶는다
    const wlAgg: any[] = await p.worklog.groupBy({
      by: ['activityId'],
      where: { date: { gte: start, lt: end }, activityId: { not: null } },
      _count: { _all: true }, _sum: { timeSpentMinutes: true },
    });
    const actIds = wlAgg.map((r) => String(r.activityId));
    const acts: any[] = actIds.length
      ? await p.activity.findMany({ where: { id: { in: actIds } }, select: { id: true, name: true, domain: true, status: true } })
      : [];
    const actById = new Map(acts.map((a) => [a.id, a]));
    const goalLinked = await this.goalLinkedActivityIds();

    type Dom = { key: string; label: string; activities: number; worklogs: number; minutes: number; confirmed: number; linked: number; linkedMinutes: number; top: Array<{ id: string; name: string; n: number; linked: boolean }> };
    const doms = new Map<string, Dom>();
    for (const r of wlAgg) {
      const a = actById.get(String(r.activityId));
      const key = String(a?.domain || '(미분류 대분류)');
      const d = doms.get(key) || { key, label: key, activities: 0, worklogs: 0, minutes: 0, confirmed: 0, linked: 0, linkedMinutes: 0, top: [] };
      const n = r._count._all, mins = r._sum.timeSpentMinutes || 0;
      const isLinked = a ? goalLinked.has(a.id) : false;
      d.activities++; d.worklogs += n; d.minutes += mins;
      if (String(a?.status) === 'CONFIRMED') d.confirmed++;
      if (isLinked) { d.linked++; d.linkedMinutes += mins; }
      d.top.push({ id: String(r.activityId), name: a?.name || '(이름 없음)', n, linked: isLinked });
      doms.set(key, d);
    }
    for (const d of doms.values()) { d.top.sort((x, y) => y.n - x.n); d.top = d.top.slice(0, 8); }

    // ── 미분류 일지(활동에 귀속되지 않은 기록)
    const [unclassified, totalWl] = await Promise.all([
      p.worklog.count({ where: { date: { gte: start, lt: end }, activityId: null } }),
      p.worklog.count({ where: { date: { gte: start, lt: end } } }),
    ]);

    // ── 목표 층
    // 'test' 같은 시험용 목표는 맵에서만 가린다(계정·데이터는 그대로 둔다).
    const NOISE_TITLES = ['test', 'TEST', 'Test', '테스트'];
    const objs: any[] = await p.objective.findMany({
      where: { status: { in: ['ACTIVE', 'LOCKED'] }, title: { notIn: NOISE_TITLES } },
      select: { id: true, title: true, pillar: true, orgUnit: { select: { name: true } }, alignsToKrId: true },
    });
    const krs: any[] = await p.keyResult.findMany({
      where: { objective: { status: { in: ['ACTIVE', 'LOCKED'] }, title: { notIn: NOISE_TITLES } } },
      select: { id: true, title: true, objectiveId: true, activityId: true, unit: true, binding: { select: { sourceType: true, lastError: true } } },
    });
    const kis: any[] = await p.keyInitiative.findMany({ select: { id: true, title: true, activityId: true, alignsToObjectiveId: true, status: true } });
    const gLinks: any[] = await p.goalActivityLink.findMany({ select: { goalType: true, goalId: true, activityId: true } });

    // ── 빈 자동 그릇 걷어내기
    // 'Auto Objective - 팀명' + 'Auto KR' 짝은 어떤 자동 처리가 만들어 둔 빈 껍데기다.
    // 활동도 바인딩도 담당자도 붙어 있지 않아 아무것도 알려 주지 않으면서 열의 1/4를 차지한다.
    // 지우지는 않고(데이터는 그대로 둔다) 맵에서만 걷어내고, 몇 개인지만 요약에 남긴다.
    const assigned = new Set(
      (await p.keyResultAssignment.findMany({ select: { keyResultId: true } })).map((a: any) => String(a.keyResultId)),
    );
    const linkedGoalIds = new Set(gLinks.map((g: any) => `${g.goalType}:${g.goalId}`));
    const isEmptyKr = (k: any) =>
      /^Auto KR$/i.test(String(k.title || '').trim()) &&
      !k.activityId && !k.binding && !assigned.has(String(k.id)) && !linkedGoalIds.has(`KR:${k.id}`);
    const emptyKrIds = new Set(krs.filter(isEmptyKr).map((k) => String(k.id)));
    const liveKrs = krs.filter((k) => !emptyKrIds.has(String(k.id)));
    const keptObjs = objs.filter((o) => {
      if (!/^Auto Objective/i.test(String(o.title || ''))) return true;
      if (liveKrs.some((k) => k.objectiveId === o.id)) return true;         // 살아 있는 KR을 품고 있으면 남긴다
      if (kis.some((t) => t.alignsToObjectiveId === o.id)) return true;     // 중점과제가 걸려 있어도 남긴다
      return linkedGoalIds.has(`OBJECTIVE:${o.id}`);
    });
    const hiddenEmptyGoals = objs.length - keptObjs.length;
    objs.length = 0; objs.push(...keptObjs);
    krs.length = 0; krs.push(...liveKrs);

    // ── 노드
    const nodes: any[] = [];
    const push = (n: any) => { nodes.push(n); return n.id; };
    // 0열 원천
    const bindings: any[] = await p.kpiBinding.findMany({ where: { enabled: true }, select: { keyResultId: true, sourceType: true, lastError: true } });
    const srcTypes = Array.from(new Set(bindings.map((b) => String(b.sourceType))));
    for (const st of srcTypes) push({ id: `src:${st}`, type: 'app', col: 0, label: SOURCE_LABEL[st] || st, status: 'ok', metrics: { kpis: bindings.filter((b) => b.sourceType === st).length } });
    push({ id: 'src:WORKLOG', type: 'app', col: 0, label: '업무일지', status: 'ok', metrics: { worklogs: totalWl } });
    const apprCount = await p.approvalRequest.count({ where: { createdAt: { gte: start, lt: end } } });
    push({ id: 'src:APPROVAL', type: 'app', col: 0, label: '결재 · 협조', status: 'ok', metrics: { approvals: apprCount } });

    // 1열 활동(대분류)
    const domList = Array.from(doms.values()).sort((a, b) => b.worklogs - a.worklogs);
    for (const d of domList) {
      push({
        id: `dom:${d.key}`, type: 'activity', col: 1, label: d.label,
        status: d.confirmed > d.activities / 2 ? 'ok' : 'cand',
        outsideGoal: d.linked === 0,
        metrics: { activities: d.activities, worklogs: d.worklogs, minutes: d.minutes, goalLinked: d.linked, confirmed: d.confirmed },
        top: d.top,
      });
    }
    if (unclassified > 0) push({ id: 'dom:__unclassified', type: 'cloud', col: 1, label: '미분류 일지', status: 'ghost', metrics: { worklogs: unclassified, ratio: totalWl ? Math.round((unclassified / totalWl) * 100) : 0 } });

    // 2열 KPI·중점과제
    for (const k of krs) push({ id: `kr:${k.id}`, type: 'kpi', col: 2, label: k.title, status: k.binding && !k.binding.lastError ? 'ok' : 'cand', metrics: { bound: !!k.binding, unit: k.unit } });
    for (const t of kis) push({ id: `ki:${t.id}`, type: 'task', col: 2, label: t.title, status: 'ok', metrics: { state: t.status } });
    // 3열 목표
    for (const o of objs) {
      // 'Auto Objective - 팀명'은 팀 KPI를 담으려고 기계가 만든 그릇이다. 대표가 세운 목표와 섞이면 안 되므로 후보층으로 표시.
      const auto = /^Auto Objective/i.test(String(o.title || ''));
      push({
        id: `obj:${o.id}`, type: 'obj', col: 3,
        label: auto ? `${o.orgUnit?.name || '팀'} · 자동 생성 그릇` : o.title,
        status: auto ? 'cand' : 'ok',
        metrics: { team: o.orgUnit?.name || '', auto },
      });
    }
    // 4열 기둥
    const pillars = Array.from(new Set(objs.map((o) => o.pillar).filter(Boolean)));
    for (const pl of pillars) push({ id: `pillar:${pl}`, type: 'pillar', col: 4, label: PILLAR_LABEL[String(pl)] || String(pl), status: 'ok', metrics: {} });
    push({ id: 'ceo', type: 'ceo', col: 5, label: '대표이사', status: 'ok', metrics: {} });

    // ── 엣지
    const ids = new Set(nodes.map((n) => n.id));
    const edges: any[] = [];
    const link = (from: string, to: string, kind: string, status: 'ok' | 'cand', count?: number) => {
      if (!ids.has(from) || !ids.has(to)) return;
      edges.push({ from, to, kind, status, count: count || 0 });
    };
    // 원천 → 활동 대분류 (일지)
    for (const d of domList) link('src:WORKLOG', `dom:${d.key}`, 'record', d.confirmed > 0 ? 'ok' : 'cand', d.worklogs);
    if (unclassified > 0) link('src:WORKLOG', 'dom:__unclassified', 'record', 'cand', unclassified);
    // 원천 → KPI (바인딩)
    for (const b of bindings) link(`src:${b.sourceType}`, `kr:${b.keyResultId}`, 'binding', b.lastError ? 'cand' : 'ok');
    // 활동 대분류 → KPI/과제 (그 대분류에 속한 활동이 목표에 연결된 경우)
    const domOfActivity = (aid: string) => { const a = actById.get(aid); return a ? `dom:${String(a.domain || '(미분류 대분류)')}` : null; };
    const seen = new Set<string>();
    for (const g of [...gLinks.map((g) => ({ goalType: g.goalType, goalId: g.goalId, activityId: g.activityId })),
      ...krs.filter((k) => k.activityId).map((k) => ({ goalType: 'KR', goalId: k.id, activityId: k.activityId })),
      ...kis.filter((t) => t.activityId).map((t) => ({ goalType: 'KI', goalId: t.id, activityId: t.activityId }))]) {
      const from = domOfActivity(String(g.activityId));
      if (!from) continue;
      const to = g.goalType === 'KR' ? `kr:${g.goalId}` : `ki:${g.goalId}`;
      const key = `${from}>${to}`;
      if (seen.has(key)) continue; seen.add(key);
      link(from, to, 'contribution', 'ok');
    }
    // KPI/과제 → 목표
    for (const k of krs) link(`kr:${k.id}`, `obj:${k.objectiveId}`, 'belongs', 'ok');
    for (const t of kis) if (t.alignsToObjectiveId) link(`ki:${t.id}`, `obj:${t.alignsToObjectiveId}`, 'aligns', 'ok');
    // 목표 → 기둥 → 대표
    for (const o of objs) if (o.pillar) link(`obj:${o.id}`, `pillar:${o.pillar}`, 'pillar', 'ok');
    for (const pl of pillars) link(`pillar:${pl}`, 'ceo', 'owns', 'ok');

    // ── 정의 밖 경로(저장된 관찰 전이)
    const trans: any[] = await p.observedTransition.findMany({
      where: { month, level: 'DOMAIN', defined: false }, include: { decision: true }, orderBy: { count: 'desc' }, take: 25,
    });
    const scanned = await p.observedTransition.findFirst({ where: { month, level: 'DOMAIN' }, orderBy: { computedAt: 'desc' }, select: { computedAt: true } });
    const ghosts = trans.map((t) => ({
      id: t.id, from: `dom:${t.fromKey}`, to: `dom:${t.toKey}`, fromLabel: t.fromLabel, toLabel: t.toLabel,
      count: t.count, ofCount: t.ofCount, confidence: t.confidence, medianGapMinutes: t.medianGapMinutes,
      offHoursRatio: t.offHoursRatio, sampleCases: t.sampleCases || [],
      decision: t.decision ? { choice: t.decision.choice, rationale: t.decision.rationale, decidedAt: t.decision.decidedAt } : null,
    }));

    const outsideGoalMinutes = domList.filter((d) => d.linked === 0).reduce((s, d) => s + d.minutes, 0);
    return {
      month,
      nodes, edges, ghosts,
      summary: {
        activities: actIds.length, domains: domList.length,
        worklogs: totalWl, unclassified, unclassifiedRatio: totalWl ? Math.round((unclassified / totalWl) * 100) : 0,
        goalLinkedActivities: actIds.filter((a) => goalLinked.has(a)).length,
        outsideGoalMinutes, outsideGoalHours: Math.round(outsideGoalMinutes / 60),
        boundKpis: bindings.length, kpis: krs.length, objectives: objs.length,
        ghostCount: ghosts.length, ghostDecided: ghosts.filter((g) => g.decision).length,
        hiddenEmptyGoals,
        scannedAt: scanned?.computedAt || null,
      },
    };
  }

  /**
   * 관찰 전이 추출 — 같은 대상을 공유하는 기록을 시간순으로 이어 활동 대분류 전이를 센다.
   * 14일 안에 이어진 것만 한 건의 흐름으로 본다(그보다 멀면 다른 일로 간주).
   */
  /**
   * 흐름 재생(P1) — 최근 24시간/7일에 실제로 일어난 사건을 시간순으로 돌려준다.
   *
   * 집계가 아니라 사건 하나하나지만 **경로(노드 id)만** 담는다. 누가 썼는지는 담지 않는다.
   * 화면은 이 경로 위로 점을 흘린다. 색은 네 가지다.
   *   record  녹색 — 아래에서 올라온 기록(일지)
   *   intent  남색 — 위에서 내려간 의도(KPI 담당 배정·중점과제 등록)
   *   verify  주황 — 확인(지표 수집, 일지 결재)
   *   ghost   회색 — 정의 밖 경로로 샌 업무
   */
  async events(hours: number) {
    const p: any = this.prisma;
    const to = new Date();
    const from = new Date(to.getTime() - Math.max(1, Math.min(24 * 30, hours)) * 3600000);
    const CAP = 1200;

    // 활동 → 대분류 / 활동 → 목표(KPI·과제 → 목표)
    const acts: any[] = await p.activity.findMany({ select: { id: true, domain: true } });
    const domOf = new Map<string, string>(acts.map((a) => [String(a.id), `dom:${String(a.domain || '(미분류 대분류)')}`]));
    const krs: any[] = await p.keyResult.findMany({ select: { id: true, objectiveId: true, activityId: true } });
    const kis: any[] = await p.keyInitiative.findMany({ select: { id: true, alignsToObjectiveId: true, activityId: true } });
    const gLinks: any[] = await p.goalActivityLink.findMany({ select: { goalType: true, goalId: true, activityId: true } });
    const objOfKr = new Map<string, string>(krs.map((k) => [String(k.id), String(k.objectiveId)]));
    const objOfKi = new Map<string, string>(kis.filter((t) => t.alignsToObjectiveId).map((t) => [String(t.id), String(t.alignsToObjectiveId)]));

    // 활동 하나가 닿는 목표 꼬리(가장 짧은 하나만 — 점이 여러 갈래로 갈라지면 읽히지 않는다)
    const tailOf = new Map<string, string[]>();
    const setTail = (actId: string, goal: string, obj?: string) => {
      if (!actId || tailOf.has(actId)) return;
      tailOf.set(actId, obj ? [goal, `obj:${obj}`] : [goal]);
    };
    for (const k of krs) if (k.activityId) setTail(String(k.activityId), `kr:${k.id}`, String(k.objectiveId));
    for (const t of kis) if (t.activityId) setTail(String(t.activityId), `ki:${t.id}`, objOfKi.get(String(t.id)));
    for (const g of gLinks) {
      const gid = String(g.goalId);
      if (g.goalType === 'KR') setTail(String(g.activityId), `kr:${gid}`, objOfKr.get(gid));
      else if (g.goalType === 'KI') setTail(String(g.activityId), `ki:${gid}`, objOfKi.get(gid));
    }

    const events: Array<{ at: Date; kind: string; path: string[] }> = [];

    // ① 올라온 기록 — 일지
    const wls: any[] = await p.worklog.findMany({
      where: { createdAt: { gte: from, lt: to }, activityId: { not: null } },
      select: { id: true, createdAt: true, activityId: true }, orderBy: { createdAt: 'asc' }, take: CAP,
    });
    const domOfWorklog = new Map<string, string>();
    for (const w of wls) {
      const dom = domOf.get(String(w.activityId));
      if (!dom) continue;
      domOfWorklog.set(String(w.id), dom);
      events.push({ at: w.createdAt, kind: 'record', path: ['src:WORKLOG', dom, ...(tailOf.get(String(w.activityId)) || [])] });
    }

    // ② 내려간 의도 — KPI 담당 배정, 중점과제 등록
    const asg: any[] = await p.keyResultAssignment.findMany({
      where: { createdAt: { gte: from, lt: to } }, select: { keyResultId: true, createdAt: true }, take: 300,
    });
    for (const a of asg) {
      const obj = objOfKr.get(String(a.keyResultId));
      if (obj) events.push({ at: a.createdAt, kind: 'intent', path: [`obj:${obj}`, `kr:${a.keyResultId}`] });
    }
    const newKis: any[] = await p.keyInitiative.findMany({
      where: { createdAt: { gte: from, lt: to }, alignsToObjectiveId: { not: null } },
      select: { id: true, createdAt: true, alignsToObjectiveId: true }, take: 300,
    });
    for (const t of newKis) events.push({ at: t.createdAt, kind: 'intent', path: [`obj:${t.alignsToObjectiveId}`, `ki:${t.id}`] });

    // ③ 확인 — 지표 수집(바인딩 작업), 일지 결재
    const jobs: any[] = await p.kpiBindingJob.findMany({
      where: { finishedAt: { gte: from, lt: to }, keyResultId: { not: null } },
      select: { keyResultId: true, finishedAt: true, status: true, binding: { select: { sourceType: true } } }, take: 300,
    });
    for (const j of jobs) {
      const src = j.binding?.sourceType ? `src:${j.binding.sourceType}` : null;
      if (src) events.push({ at: j.finishedAt, kind: 'verify', path: [src, `kr:${j.keyResultId}`] });
    }
    const apprs: any[] = await p.approvalRequest.findMany({
      where: { updatedAt: { gte: from, lt: to }, status: 'APPROVED' },
      select: { subjectType: true, subjectId: true, updatedAt: true }, take: 400,
    });
    const wlSubjects = apprs.filter((a) => String(a.subjectType).toUpperCase() === 'WORKLOG').map((a) => String(a.subjectId));
    if (wlSubjects.length) {
      const sub: any[] = await p.worklog.findMany({ where: { id: { in: wlSubjects } }, select: { id: true, activityId: true } });
      for (const w of sub) { const d = domOf.get(String(w.activityId || '')); if (d) domOfWorklog.set(String(w.id), d); }
    }
    for (const a of apprs) {
      const dom = domOfWorklog.get(String(a.subjectId));
      // 일지 결재는 그 일지의 대분류까지 간다. 근태·배차처럼 활동에 걸리지 않는 결재는 원천에서 깜빡이기만 한다.
      events.push({ at: a.updatedAt, kind: 'verify', path: dom ? ['src:APPROVAL', dom] : ['src:APPROVAL'] });
    }

    // ④ 정의 밖으로 샌 업무 — 창 안에서 실제로 일어난 전이만
    const month = new Date(to.getTime() + 9 * 3600000).toISOString().slice(0, 7);
    const undef: any[] = await p.observedTransition.findMany({
      where: { month, level: 'DOMAIN', defined: false }, select: { fromKey: true, toKey: true },
    });
    const undefSet = new Set(undef.map((t) => `${t.fromKey}>${t.toKey}`));
    if (undefSet.size) {
      const lookback = new Date(from.getTime() - 14 * 86400000);
      const rows: any[] = await p.$queryRawUnsafe(`
        WITH w AS (
          SELECT we."entityId" AS eid, wl.date AS at, wl."createdAt" AS wrote_at,
                 COALESCE(a.domain, '(미분류 대분류)') AS dom
          FROM "WorklogEntity" we
          JOIN "Worklog" wl ON wl.id = we."worklogId"
          JOIN "Activity" a ON a.id = wl."activityId"
          WHERE wl.date >= $1 AND wl.date < $2 AND wl."activityId" IS NOT NULL
        ), seq AS (
          SELECT eid, at, dom,
                 LEAD(dom)      OVER (PARTITION BY eid ORDER BY at) AS nxt,
                 LEAD(at)       OVER (PARTITION BY eid ORDER BY at) AS nxt_at,
                 LEAD(wrote_at) OVER (PARTITION BY eid ORDER BY at) AS nxt_wrote
          FROM w
        )
        SELECT dom AS "fromKey", nxt AS "toKey", COALESCE(nxt_wrote, nxt_at) AS "at"
        FROM seq
        WHERE nxt IS NOT NULL AND nxt <> dom AND nxt_at - at < interval '14 days'
          AND COALESCE(nxt_wrote, nxt_at) >= $3 AND COALESCE(nxt_wrote, nxt_at) < $2
        ORDER BY 3 ASC
        LIMIT 400
      `, lookback, to, from);
      for (const r of rows) {
        const key = `${r.fromKey}>${r.toKey}`;
        if (!undefSet.has(key)) continue;
        events.push({ at: r.at, kind: 'ghost', path: [`dom:${r.fromKey}`, `dom:${r.toKey}`] });
      }
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const trimmed = events.length > CAP
      ? events.filter((_, i) => i % Math.ceil(events.length / CAP) === 0)
      : events;

    const n = (k: string) => events.filter((e) => e.kind === k).length;
    const up = n('record'), ghost = n('ghost');
    return {
      from, to, hours,
      events: trimmed.map((e) => ({ at: e.at, kind: e.kind, path: e.path })),
      sampled: trimmed.length < events.length,
      counters: {
        up, down: n('intent'), verify: n('verify'), ghost,
        ghostRatio: up + ghost ? Math.round((ghost / (up + ghost)) * 100) : 0,
        total: events.length,
      },
    };
  }

  async scan(month: string) {
    const p: any = this.prisma;
    const { start, end } = monthRange(month);
    // 이번 달 기록 ± 앞뒤 여유(전이는 달을 걸칠 수 있다)
    const from = new Date(start.getTime() - 14 * 86400000);
    const rows: any[] = await p.$queryRawUnsafe(`
      WITH w AS (
        SELECT we."entityId" AS eid, wl.id AS wid, wl.date AS at,
               COALESCE(a.domain, '(미분류 대분류)') AS dom
        FROM "WorklogEntity" we
        JOIN "Worklog" wl ON wl.id = we."worklogId"
        JOIN "Activity" a ON a.id = wl."activityId"
        WHERE wl.date >= $1 AND wl.date < $2 AND wl."activityId" IS NOT NULL
      ), seq AS (
        SELECT eid, wid, at, dom,
               LEAD(dom) OVER (PARTITION BY eid ORDER BY at) AS nxt,
               LEAD(at)  OVER (PARTITION BY eid ORDER BY at) AS nxt_at,
               LEAD(wid) OVER (PARTITION BY eid ORDER BY at) AS nxt_wid
        FROM w
      )
      SELECT dom AS "fromKey", nxt AS "toKey", COUNT(*)::int AS cnt,
             (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (nxt_at - at))/60))::int AS "medianGapMinutes",
             (100.0 * SUM(CASE WHEN nxt_at - at > interval '3 days' THEN 1 ELSE 0 END) / COUNT(*))::int AS "offHoursRatio",
             (ARRAY_AGG(eid ORDER BY at DESC))[1:5] AS "sampleEntityIds",
             (ARRAY_AGG(wid ORDER BY at DESC))[1:5] AS "sampleWorklogIds"
      FROM seq
      WHERE nxt IS NOT NULL AND nxt <> dom AND nxt_at - at < interval '14 days' AND nxt_at >= $3
      GROUP BY dom, nxt
      HAVING COUNT(*) >= 3
      ORDER BY cnt DESC
      LIMIT 80
    `, from, end, start);

    // 분모: 출발 대분류에서 나간 전체 전이 수
    const outTotal = new Map<string, number>();
    for (const r of rows) outTotal.set(r.fromKey, (outTotal.get(r.fromKey) || 0) + Number(r.cnt));

    // 정의된 길: 같은 프로세스 템플릿에서 이웃한 태스크의 활동 대분류 쌍
    const defined = await this.definedDomainPairs();

    // 대상 이름
    const entIds = Array.from(new Set(rows.flatMap((r) => (r.sampleEntityIds || []).map(String))));
    const ents: any[] = entIds.length ? await p.ontologyEntity.findMany({ where: { id: { in: entIds } }, select: { id: true, name: true, kind: true } }) : [];
    const entName = new Map(ents.map((e) => [e.id, `${e.name}${e.kind && e.kind !== 'OTHER' ? ` (${e.kind})` : ''}`]));

    let saved = 0;
    for (const r of rows) {
      const fromKey = String(r.fromKey), toKey = String(r.toKey);
      const sample = (r.sampleEntityIds || []).map((id: any, i: number) => ({
        entityId: String(id), entityName: entName.get(String(id)) || '(대상)', worklogId: String((r.sampleWorklogIds || [])[i] || ''),
      })).filter((x: any) => x.worklogId);
      await p.observedTransition.upsert({
        where: { month_level_fromKey_toKey: { month, level: 'DOMAIN', fromKey, toKey } },
        create: {
          month, level: 'DOMAIN', fromKey, toKey, fromLabel: fromKey, toLabel: toKey,
          count: Number(r.cnt), ofCount: outTotal.get(fromKey) || Number(r.cnt),
          confidence: 'LINKED', defined: defined.has(`${fromKey}>${toKey}`),
          medianGapMinutes: r.medianGapMinutes ?? null, offHoursRatio: r.offHoursRatio ?? null, sampleCases: sample,
        },
        update: {
          count: Number(r.cnt), ofCount: outTotal.get(fromKey) || Number(r.cnt),
          defined: defined.has(`${fromKey}>${toKey}`),
          medianGapMinutes: r.medianGapMinutes ?? null, offHoursRatio: r.offHoursRatio ?? null, sampleCases: sample,
          computedAt: new Date(),
        },
      });
      saved++;
    }
    this.logger.log(`flow scan ${month}: 전이 ${saved}건 저장 (정의 밖 ${rows.filter((r) => !defined.has(`${r.fromKey}>${r.toKey}`)).length}건)`);
    return { month, scanned: rows.length, saved, definedPairs: defined.size };
  }

  /** 프로세스 템플릿에 정의된 이웃 태스크의 활동 대분류 쌍 */
  /**
   * 업무 한 건 따라가기(P1) — 대상(금형·부품·설비·협력사) 하나가 지나온 길을 시간순으로 돌려준다.
   *
   * 핸드오프는 "프로세스 인스턴스 하나"를 전제했지만 인스턴스는 20건뿐이라 따라갈 것이 없다.
   * 실제로 건을 잇고 있는 식별자는 **대상 공유**다(4-1 참조). 그래서 대상 하나를 건으로 본다.
   * 걸음마다 앞 걸음에서 넘어온 길이 템플릿에 정의된 길인지 표시한다.
   */
  async traceSearch(q: string, limit = 12) {
    const p: any = this.prisma;
    const term = String(q || '').trim();
    if (term.length < 1) return { items: [] };
    const ents: any[] = await p.ontologyEntity.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      select: { id: true, name: true, kind: true, _count: { select: { worklogLinks: true } } },
      orderBy: { worklogLinks: { _count: 'desc' } },
      take: limit,
    });
    return { items: ents.map((e) => ({ id: e.id, name: e.name, kind: e.kind, records: e._count?.worklogLinks || 0 })) };
  }

  async trace(entityId: string, days = 120) {
    const p: any = this.prisma;
    const id = String(entityId || '').trim();
    if (!id) throw new Error('대상을 고르세요');
    const ent = await p.ontologyEntity.findUnique({ where: { id }, select: { id: true, name: true, kind: true } });
    if (!ent) throw new Error('대상을 찾지 못했습니다');

    const since = new Date(Date.now() - Math.max(7, Math.min(400, days)) * 86400000);
    const links: any[] = await p.worklogEntity.findMany({ where: { entityId: id }, select: { worklogId: true } });
    const wlIds = links.map((l) => String(l.worklogId));
    if (!wlIds.length) return { entity: ent, steps: [], defined: 0, ghost: 0 };

    const wls: any[] = await p.worklog.findMany({
      where: { id: { in: wlIds }, date: { gte: since }, activityId: { not: null } },
      select: { id: true, date: true, createdAt: true, activityId: true, note: true },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 300,
    });
    const actIds = Array.from(new Set(wls.map((w) => String(w.activityId))));
    const acts: any[] = actIds.length ? await p.activity.findMany({ where: { id: { in: actIds } }, select: { id: true, name: true, domain: true } }) : [];
    const actById = new Map(acts.map((a) => [String(a.id), a]));
    const definedPairs = await this.definedDomainPairs();

    let defined = 0, ghost = 0;
    const steps = wls.map((w, i) => {
      const a = actById.get(String(w.activityId));
      const dom = String(a?.domain || '(미분류 대분류)');
      const prev = i > 0 ? actById.get(String(wls[i - 1].activityId)) : null;
      const prevDom = prev ? String(prev.domain || '(미분류 대분류)') : null;
      let edge: 'start' | 'same' | 'defined' | 'ghost' = 'start';
      if (prevDom) {
        if (prevDom === dom) edge = 'same';
        else if (definedPairs.has(`${prevDom}>${dom}`)) { edge = 'defined'; defined++; }
        else { edge = 'ghost'; ghost++; }
      }
      const gapMin = i > 0 ? Math.round((new Date(w.date).getTime() - new Date(wls[i - 1].date).getTime()) / 60000) : null;
      return {
        worklogId: String(w.id), at: w.date, title: String(w.note || '').replace(/\s+/g, ' ').trim().slice(0, 90),
        activity: a?.name || '(활동 없음)', domain: dom, node: `dom:${dom}`, edge, gapMinutes: gapMin,
      };
    });
    return { entity: ent, steps, defined, ghost, days };
  }

  private async definedDomainPairs(): Promise<Set<string>> {
    const p: any = this.prisma;
    const tasks: any[] = await p.processTaskTemplate.findMany({
      where: { activityId: { not: null } },
      select: { processTemplateId: true, activityId: true, orderHint: true },
      orderBy: [{ processTemplateId: 'asc' }, { orderHint: 'asc' }],
    }).catch(() => []);
    if (!tasks.length) return new Set();
    const aIds = Array.from(new Set(tasks.map((t) => String(t.activityId))));
    const acts: any[] = await p.activity.findMany({ where: { id: { in: aIds } }, select: { id: true, domain: true } });
    const dom = new Map(acts.map((a) => [a.id, String(a.domain || '(미분류 대분류)')]));
    const out = new Set<string>();
    let prev: any = null;
    for (const t of tasks) {
      if (prev && prev.processTemplateId === t.processTemplateId) {
        const a = dom.get(String(prev.activityId)), b = dom.get(String(t.activityId));
        if (a && b && a !== b) out.add(`${a}>${b}`);
      }
      prev = t;
    }
    return out;
  }

  async decide(transitionId: string, choice: 'NORM' | 'FIX' | 'KEEP', rationale: string, decidedById: string) {
    const p: any = this.prisma;
    return p.deviationDecision.upsert({
      where: { transitionId },
      create: { transitionId, choice, rationale: rationale || null, decidedById },
      update: { choice, rationale: rationale || null, decidedById, decidedAt: new Date() },
    });
  }
}
