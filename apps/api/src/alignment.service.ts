import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 목표 정렬 작업대 — 탑다운(전사 KR → 팀 목표 → 팀 KR → 사람)과 보텀업(업무일지·활동)이 맞닿게 잇는 서비스.
 *
 * 끊긴 이음새 3개를 "연결 대기"로 뽑고, 이미 쌓인 데이터로 후보를 제안한다(사람은 만들지 않고 고르기만 한다).
 *  OBJECTIVE_PARENT  팀 목표 → 전사 KR   : 제목·지표 토큰 유사도 + 같은 pillar
 *  KR_ASSIGNEE       팀 KR → 담당자       : 그 KR에 일지를 가장 많이 쓴 사람 (WorklogGoalTag 역이용 — 가장 확실한 근거)
 *  KR_ACTIVITY       팀 KR → 활동         : 그 KR에 붙은 일지들이 가장 많이 분류된 활동
 *
 * 연결은 전부 기존 필드에 저장된다: Objective.alignsToKrId / KeyResultAssignment / KeyResult.activityId.
 * "연결 안 해도 됨"은 AlignmentReview에 남겨 같은 제안이 다시 뜨지 않게 한다.
 */
export type LinkType = 'OBJECTIVE_PARENT' | 'KR_ASSIGNEE' | 'KR_ACTIVITY' | 'OBJECTIVE_TREE';
const STOP = new Set(['관리', '업무', '개선', '향상', '달성', '목표', '지표', '관련', '전사', '우리', '통한', '위한', '이상', '이하', '년도', '월별', '연간']);

@Injectable()
export class AlignmentService {
  private readonly logger = new Logger(AlignmentService.name);
  constructor(private prisma: PrismaService) {}

  /** 조직 하위 전체 id (자신 포함) */
  async descendantOrgIds(rootIds: string[]): Promise<string[]> {
    const all: any[] = await this.prisma.orgUnit.findMany({ select: { id: true, parentId: true } });
    const byParent = new Map<string, string[]>();
    for (const o of all) { const k = o.parentId || '-'; byParent.set(k, [...(byParent.get(k) || []), o.id]); }
    const out = new Set<string>();
    const walk = (id: string, depth = 0) => { if (out.has(id) || depth > 10) return; out.add(id); for (const c of byParent.get(id) || []) walk(c, depth + 1); };
    for (const r of rootIds) walk(r);
    return Array.from(out);
  }

  /** 사용자가 정렬할 수 있는 조직 범위. CEO/EXEC=전체, 그 외=소속 조직 + 책임 조직의 하위 */
  async scopeOrgIds(user: any): Promise<{ orgIds: string[]; all: boolean }> {
    const role = String(user.role || '').toUpperCase();
    if (['CEO', 'EXEC'].includes(role)) return { orgIds: [], all: true };
    const roots: string[] = [];
    if (user.orgUnitId) roots.push(user.orgUnitId);
    const managed: any[] = await this.prisma.orgUnit.findMany({ where: { managerId: user.id }, select: { id: true } });
    roots.push(...managed.map((m) => m.id));
    if (!roots.length) return { orgIds: [], all: false };
    return { orgIds: await this.descendantOrgIds(roots), all: false };
  }

  tokens(text: string): Set<string> {
    const out = new Set<string>();
    for (const raw of String(text || '').toLowerCase().replace(/[()[\]{}·,./%:;'"!?~\-_]/g, ' ').split(/\s+/)) {
      const t = raw.trim();
      if (t.length < 2 || STOP.has(t)) continue;
      out.add(t);
      // 한글은 2글자 조각으로도 비교 (불량률 ↔ 불량)
      if (/^[가-힣]+$/.test(t)) for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
    }
    return out;
  }
  similarity(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let hit = 0;
    for (const t of a) if (b.has(t)) hit++;
    return Math.round((hit / Math.min(a.size, b.size)) * 100);
  }

  /** 작업대 데이터 — 노드(온톨로지 객체) + 확정 선 + 제안 선 */
  async graph(user: any, opts: { year?: number; onlyBroken?: boolean } = {}) {
    const { orgIds, all } = await this.scopeOrgIds(user);
    const year = opts.year || new Date(Date.now() + 9 * 3600000).getUTCFullYear();
    const orgWhere = all ? {} : { orgUnitId: { in: orgIds } };

    const objectives: any[] = await this.prisma.objective.findMany({
      where: { status: { in: ['ACTIVE', 'LOCKED'] as any }, ...orgWhere },
      select: { id: true, title: true, orgUnitId: true, alignsToKrId: true, parentId: true, pillar: true, periodStart: true, orgUnit: { select: { name: true, type: true } }, owner: { select: { id: true, name: true } } },
    });
    const objIds = objectives.map((o) => o.id);
    const krs: any[] = objIds.length ? await this.prisma.keyResult.findMany({
      where: { objectiveId: { in: objIds } },
      select: { id: true, objectiveId: true, title: true, metric: true, unit: true, target: true, activityId: true, ownerId: true, pillar: true, owner: { select: { id: true, name: true } }, assignments: { select: { userId: true, user: { select: { id: true, name: true } } } }, binding: { select: { id: true, sourceType: true, lastError: true } } },
    }) : [];

    // 전사 KR = 어젠다 항목으로 만들어진 것 (범위와 무관하게 항상 보여야 붙일 수 있다)
    const agendaItems: any[] = await (this.prisma as any).agendaItem.findMany({ where: { companyKrId: { not: null }, agenda: { year, status: { in: ['OPEN', 'CLOSED'] } } }, select: { id: true, title: true, weight: true, companyKrId: true, agenda: { select: { id: true, year: true, statement: true } } } });
    const companyKrIds = agendaItems.map((a) => a.companyKrId);
    const companyKrs: any[] = companyKrIds.length ? await this.prisma.keyResult.findMany({ where: { id: { in: companyKrIds } }, select: { id: true, title: true, metric: true, unit: true, target: true, pillar: true, objectiveId: true } }) : [];

    // 일지 태그 집계 (최근 180일) — 담당자·활동 제안의 근거
    const since = new Date(Date.now() - 180 * 86400000);
    const krIds = krs.map((k) => k.id);
    // WorklogGoalTag에는 Worklog 관계가 없어 두 번에 나눠 읽는다 (태그 → 일지 id → 일지)
    const rawTags: any[] = krIds.length ? await (this.prisma as any).worklogGoalTag.findMany({ where: { goalType: 'KR', goalId: { in: krIds } }, select: { goalId: true, worklogId: true } }) : [];
    const logIds = Array.from(new Set(rawTags.map((t) => t.worklogId)));
    const logs: any[] = logIds.length ? await this.prisma.worklog.findMany({
      where: { id: { in: logIds }, date: { gte: since } },
      select: { id: true, createdById: true, activityId: true, date: true, createdBy: { select: { id: true, name: true, orgUnitId: true, status: true } } },
    }) : [];
    const logById = new Map(logs.map((w) => [w.id, w]));
    const tags = rawTags.filter((t) => logById.has(t.worklogId)).map((t) => ({ goalId: t.goalId, worklog: logById.get(t.worklogId) }));
    const byKr = new Map<string, any[]>();
    for (const t of tags) { const arr = byKr.get(t.goalId) || []; arr.push(t.worklog); byKr.set(t.goalId, arr); }

    const dismissed = new Set((await (this.prisma as any).alignmentReview.findMany({ select: { itemType: true, itemId: true } })).map((r: any) => `${r.itemType}:${r.itemId}`));
    const activityIds = Array.from(new Set([...krs.map((k) => k.activityId), ...tags.map((t) => t.worklog?.activityId)].filter(Boolean)));
    const activities: any[] = activityIds.length ? await (this.prisma as any).activity.findMany({ where: { id: { in: activityIds } }, select: { id: true, name: true, domain: true } }) : [];
    const actName = new Map(activities.map((a) => [a.id, a.name]));

    // ── 노드
    const nodes: any[] = [];
    for (const ck of companyKrs) {
      const item = agendaItems.find((a) => a.companyKrId === ck.id);
      nodes.push({ id: `ckr:${ck.id}`, type: 'COMPANY_KR', refId: ck.id, label: ck.title, sub: `전사 · 가중치 ${item?.weight ?? '-'}${ck.unit ? ` · 목표 ${ck.target}${ck.unit}` : ''}`, layer: 0, broken: false });
    }
    for (const o of objectives) {
      const broken = !o.alignsToKrId && !o.parentId && companyKrs.length > 0;
      nodes.push({ id: `obj:${o.id}`, type: 'OBJECTIVE', refId: o.id, label: o.title, sub: `${o.orgUnit?.name || ''} · ${o.owner?.name || ''}`, layer: 1, orgUnitId: o.orgUnitId, broken, dismissed: dismissed.has(`OBJECTIVE_PARENT:${o.id}`) });
    }
    const people = new Map<string, any>();
    for (const k of krs) {
      const logs = byKr.get(k.id) || [];
      const broken = k.assignments.length === 0;
      const ownerObj = objectives.find((o) => o.id === k.objectiveId);
      nodes.push({
        id: `kr:${k.id}`, type: 'KR', refId: k.id, label: k.title, sub: `${ownerObj?.orgUnit?.name || ''}${k.metric ? ` · ${k.metric}` : ''}${k.unit ? ` · ${k.target}${k.unit}` : ''}`, layer: 2, objectiveId: k.objectiveId, orgUnitId: ownerObj?.orgUnitId || null,
        broken, dismissed: dismissed.has(`KR_ASSIGNEE:${k.id}`), logCount: logs.length, bound: !!k.binding && !k.binding.lastError, activityName: k.activityId ? actName.get(k.activityId) || '' : '',
      });
      for (const a of k.assignments) if (a.user) people.set(a.user.id, a.user);
    }
    for (const p of people.values()) nodes.push({ id: `usr:${p.id}`, type: 'PERSON', refId: p.id, label: p.name, sub: '담당', layer: 3, broken: false });
    const teamList = Array.from(new Map(objectives.filter((o) => o.orgUnitId).map((o) => [o.orgUnitId, { id: o.orgUnitId, name: o.orgUnit?.name || '' }])).values()).sort((a, b) => a.name.localeCompare(b.name));

    // ── 확정 선
    const edges: any[] = [];
    for (const o of objectives) {
      if (o.alignsToKrId && companyKrs.some((c) => c.id === o.alignsToKrId)) edges.push({ id: `e-op-${o.id}`, source: `obj:${o.id}`, target: `ckr:${o.alignsToKrId}`, type: 'OBJECTIVE_PARENT', confirmed: true });
      if (o.parentId && objectives.some((x) => x.id === o.parentId)) edges.push({ id: `e-ot-${o.id}`, source: `obj:${o.id}`, target: `obj:${o.parentId}`, type: 'OBJECTIVE_TREE', confirmed: true });
    }
    for (const k of krs) {
      edges.push({ id: `e-ko-${k.id}`, source: `kr:${k.id}`, target: `obj:${k.objectiveId}`, type: 'KR_OF', confirmed: true, fixed: true });
      for (const a of k.assignments) if (a.user) edges.push({ id: `e-ka-${k.id}-${a.userId}`, source: `usr:${a.userId}`, target: `kr:${k.id}`, type: 'KR_ASSIGNEE', confirmed: true });
    }

    // ── 제안 선
    const suggestions: any[] = [];
    const ckTokens = companyKrs.map((c) => ({ id: c.id, title: c.title, pillar: c.pillar, tok: this.tokens(`${c.title} ${c.metric || ''}`) }));
    for (const o of objectives) {
      if (o.alignsToKrId || o.parentId || !ckTokens.length || dismissed.has(`OBJECTIVE_PARENT:${o.id}`)) continue;
      const myKrTitles = krs.filter((k) => k.objectiveId === o.id).map((k) => `${k.title} ${k.metric || ''}`).join(' ');
      const tok = this.tokens(`${o.title} ${myKrTitles}`);
      const scored = ckTokens.map((c) => ({ id: c.id, title: c.title, score: this.similarity(tok, c.tok) + (c.pillar && c.pillar === o.pillar ? 10 : 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
      for (const c of scored) suggestions.push({ id: `s-op-${o.id}-${c.id}`, type: 'OBJECTIVE_PARENT', source: `obj:${o.id}`, target: `ckr:${c.id}`, score: Math.min(99, c.score), reason: `제목·지표가 겹침 (${Math.min(99, c.score)}%)`, sourceLabel: o.title, targetLabel: c.title });
    }
    for (const k of krs) {
      const logs = (byKr.get(k.id) || []).filter((w) => w?.createdBy && w.createdBy.status === 'ACTIVE');
      if (!k.assignments.length && !dismissed.has(`KR_ASSIGNEE:${k.id}`)) {
        const cnt = new Map<string, { user: any; n: number; last: Date }>();
        for (const w of logs) { const c = cnt.get(w.createdById) || { user: w.createdBy, n: 0, last: w.date }; c.n++; if (w.date > c.last) c.last = w.date; cnt.set(w.createdById, c); }
        const top = Array.from(cnt.values()).sort((a, b) => b.n - a.n).slice(0, 3);
        for (const t of top) {
          if (!people.has(t.user.id)) { people.set(t.user.id, t.user); nodes.push({ id: `usr:${t.user.id}`, type: 'PERSON', refId: t.user.id, label: t.user.name, sub: '후보', layer: 3, broken: false, candidate: true }); }
          suggestions.push({ id: `s-ka-${k.id}-${t.user.id}`, type: 'KR_ASSIGNEE', source: `usr:${t.user.id}`, target: `kr:${k.id}`, score: Math.min(99, 40 + t.n * 6), reason: `이 지표에 일지 ${t.n}건 (최근 ${new Date(t.last).toISOString().slice(0, 10)})`, sourceLabel: t.user.name, targetLabel: k.title });
        }
        // 일지 근거가 없으면 KPI 소유자라도 제안
        if (!top.length && k.owner) suggestions.push({ id: `s-ka-${k.id}-own`, type: 'KR_ASSIGNEE', source: `usr:${k.owner.id}`, target: `kr:${k.id}`, score: 30, reason: '일지 근거 없음 — 현재 KPI 등록자', sourceLabel: k.owner.name, targetLabel: k.title, weak: true });
        if (!top.length && k.owner && !people.has(k.owner.id)) { people.set(k.owner.id, k.owner); nodes.push({ id: `usr:${k.owner.id}`, type: 'PERSON', refId: k.owner.id, label: k.owner.name, sub: '후보', layer: 3, broken: false, candidate: true }); }
      }
      if (!k.activityId && !dismissed.has(`KR_ACTIVITY:${k.id}`)) {
        const cnt = new Map<string, number>();
        for (const w of logs) if (w.activityId) cnt.set(w.activityId, (cnt.get(w.activityId) || 0) + 1);
        const top = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2);
        for (const [aid, n] of top) suggestions.push({ id: `s-kact-${k.id}-${aid}`, type: 'KR_ACTIVITY', source: `kr:${k.id}`, target: `act:${aid}`, score: Math.min(99, 40 + n * 5), reason: `이 지표 일지 ${n}건이 이 활동으로 분류됨`, sourceLabel: k.title, targetLabel: actName.get(aid) || aid, activityName: actName.get(aid) || '' });
      }
    }

    const brokenCount = { objective: nodes.filter((n) => n.type === 'OBJECTIVE' && n.broken && !n.dismissed).length, kr: nodes.filter((n) => n.type === 'KR' && n.broken && !n.dismissed).length, activity: suggestions.filter((s) => s.type === 'KR_ACTIVITY').length };
    const total = { objective: objectives.length, kr: krs.length, companyKr: companyKrs.length };
    const rate = {
      objective: total.objective ? Math.round(((total.objective - brokenCount.objective) / total.objective) * 100) : 0,
      kr: total.kr ? Math.round(((total.kr - brokenCount.kr) / total.kr) * 100) : 0,
      activity: total.kr ? Math.round((krs.filter((k) => k.activityId).length / total.kr) * 100) : 0,
    };
    return { nodes, edges, suggestions, brokenCount, total, rate, year, teams: teamList, scope: all ? '전사' : `${orgIds.length}개 조직`, canEdit: true };
  }

  /** 연결 저장 */
  async link(type: LinkType, sourceId: string, targetId: string) {
    if (type === 'OBJECTIVE_PARENT') return this.prisma.objective.update({ where: { id: sourceId }, data: { alignsToKrId: targetId } });
    if (type === 'OBJECTIVE_TREE') {
      if (sourceId === targetId) throw new Error('자기 자신에게 연결할 수 없습니다');
      return this.prisma.objective.update({ where: { id: sourceId }, data: { parentId: targetId } });
    }
    if (type === 'KR_ASSIGNEE') return (this.prisma as any).keyResultAssignment.createMany({ data: [{ keyResultId: targetId, userId: sourceId }], skipDuplicates: true });
    if (type === 'KR_ACTIVITY') return this.prisma.keyResult.update({ where: { id: sourceId }, data: { activityId: targetId } });
    throw new Error('알 수 없는 연결 종류');
  }

  async unlink(type: LinkType, sourceId: string, targetId?: string) {
    if (type === 'OBJECTIVE_PARENT') return this.prisma.objective.update({ where: { id: sourceId }, data: { alignsToKrId: null } });
    if (type === 'OBJECTIVE_TREE') return this.prisma.objective.update({ where: { id: sourceId }, data: { parentId: null } });
    if (type === 'KR_ASSIGNEE') return (this.prisma as any).keyResultAssignment.deleteMany({ where: { keyResultId: targetId, userId: sourceId } });
    if (type === 'KR_ACTIVITY') return this.prisma.keyResult.update({ where: { id: sourceId }, data: { activityId: null } });
    throw new Error('알 수 없는 연결 종류');
  }
}
