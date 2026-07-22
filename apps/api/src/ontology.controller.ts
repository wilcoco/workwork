import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const ENTITY_KIND_KO: Record<string, string> = { EQUIPMENT: '설비', VEHICLE: '차종', CUSTOMER: '고객사', SUPPLIER: '협력사', PART: '부품', SYSTEM: '시스템', OTHER: '대상' };

/**
 * 온톨로지 탐색기 API — 회사의 객체(활동/목표/KR/과제/프로세스/매뉴얼/팀/사람)를
 * 하나의 의미망으로 보고, 아무 객체에서나 출발해 연결(정의/실행/지식/측정/변경/조직)을
 * 따라 탐색한다. (Foundry Object Explorer 대응, 임원 이상)
 */
@Controller('ontology')
export class OntologyController {
  constructor(private prisma: PrismaService) {}

  private async assertExec(uid?: string): Promise<string> {
    const id = String(uid || '').trim();
    if (!id) throw new BadRequestException('actorId required');
    const actor = await (this.prisma as any).user.findUnique({ where: { id }, select: { role: true } });
    const role = String(actor?.role || '').toUpperCase();
    if (!['CEO', 'EXEC'].includes(role)) throw new ForbiddenException('임원 이상만 볼 수 있습니다');
    return role;
  }

  /** 임원=제한 일지까지, CEO=전체 (활동 지도 지식 모달과 동일 정책) */
  private visFilter(role: string) {
    return role === 'CEO' ? undefined : { in: ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'] };
  }

  private wlChip(w: any) {
    const first = String(w.note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '(내용 없음)';
    return { type: 'worklog', id: w.id, label: first, sub: `${w.createdBy?.name || ''} · ${w.date ? new Date(w.date).toISOString().slice(5, 10) : ''}`, knowledge: w.kbBadge ? 1 : 0 };
  }

  /** 전 객체 통합 검색 — 유형별 상위 몇 건씩 */
  @Get('search')
  async search(@Query('q') qRaw?: string, @Query('actorId') actorId?: string) {
    const role = await this.assertExec(actorId);
    const q = String(qRaw || '').trim();
    if (q.length < 1) return { items: [] };
    const c = { contains: q, mode: 'insensitive' as any };
    const take = 6;
    const p = this.prisma as any;
    const [acts, ents, objs, krs, kis, tpls, mans, orgs, users, wls] = await Promise.all([
      p.activity.findMany({ where: { name: c }, select: { id: true, name: true, domain: true }, take }),
      p.ontologyEntity.findMany({ where: { name: c }, select: { id: true, name: true, kind: true }, take }),
      p.objective.findMany({ where: { title: c }, select: { id: true, title: true, pillar: true, orgUnit: { select: { name: true } } }, take }),
      p.keyResult.findMany({ where: { title: c }, select: { id: true, title: true, objective: { select: { title: true } } }, take }),
      p.keyInitiative.findMany({ where: { title: c }, select: { id: true, title: true, status: true }, take }),
      p.processTemplate.findMany({ where: { title: c }, select: { id: true, title: true, status: true }, take }),
      p.workManual.findMany({ where: { title: c }, select: { id: true, title: true, authorName: true }, take }),
      p.orgUnit.findMany({ where: { name: c }, select: { id: true, name: true, type: true }, take }),
      p.user.findMany({ where: { name: c, status: 'ACTIVE' }, select: { id: true, name: true, orgUnit: { select: { name: true } } }, take }),
      p.worklog.findMany({ where: { note: c, ...(this.visFilter(role) ? { visibility: this.visFilter(role) } : {}) }, orderBy: { date: 'desc' }, select: { id: true, note: true, date: true, kbBadge: true, createdBy: { select: { name: true } } }, take }),
    ]);
    const items = [
      ...acts.map((x: any) => ({ type: 'activity', id: x.id, label: x.name, sub: x.domain || '활동' })),
      ...ents.map((x: any) => ({ type: 'entity', id: x.id, label: x.name, sub: ENTITY_KIND_KO[x.kind] || '대상' })),
      ...objs.map((x: any) => ({ type: 'objective', id: x.id, label: x.title, sub: `목표 · ${x.orgUnit?.name || ''}` })),
      ...krs.map((x: any) => ({ type: 'keyResult', id: x.id, label: x.title, sub: `KPI · ${x.objective?.title || ''}` })),
      ...kis.map((x: any) => ({ type: 'keyInitiative', id: x.id, label: x.title, sub: '중점과제' })),
      ...tpls.map((x: any) => ({ type: 'processTemplate', id: x.id, label: x.title, sub: '프로세스 템플릿' })),
      ...mans.map((x: any) => ({ type: 'workManual', id: x.id, label: x.title, sub: `매뉴얼 · ${x.authorName || ''}` })),
      ...orgs.map((x: any) => ({ type: 'orgUnit', id: x.id, label: x.name, sub: '조직' })),
      ...users.map((x: any) => ({ type: 'user', id: x.id, label: x.name, sub: `구성원 · ${x.orgUnit?.name || ''}` })),
      ...wls.map((w: any) => this.wlChip(w)),
    ];
    return { items: items.slice(0, 30) };
  }

  /** 객체 중심 연결 조회 — 중심 노드 + 축별(정의/실행/지식/측정/변경/조직) 연결 */
  @Get('explore')
  async explore(@Query('type') type?: string, @Query('id') id?: string, @Query('actorId') actorId?: string) {
    const role = await this.assertExec(actorId);
    const vis = this.visFilter(role);
    const t = String(type || '').trim();
    const oid = String(id || '').trim();
    if (!t || !oid) throw new BadRequestException('type/id required');
    const p = this.prisma as any;

    // 활동 집합의 축약 통계(실행·지식) — 여러 유형에서 재사용
    const actStats = async (actIds: string[]) => {
      if (!actIds.length) return new Map();
      const [wl, kb] = await Promise.all([
        p.worklog.groupBy({ by: ['activityId'], where: { activityId: { in: actIds } }, _count: { _all: true }, _max: { date: true } }),
        p.worklog.groupBy({ by: ['activityId'], where: { activityId: { in: actIds }, kbBadge: true }, _count: { _all: true } }),
      ]);
      const m = new Map(actIds.map((a) => [a, { worklogs: 0, lastAt: null as any, knowledge: 0 }]));
      for (const r of wl) { const e = m.get(String(r.activityId)); if (e) { e.worklogs = r._count._all; e.lastAt = r._max.date; } }
      for (const r of kb) { const e = m.get(String(r.activityId)); if (e) e.knowledge = r._count._all; }
      return m;
    };
    const actChip = (a: any, st?: any) => ({ type: 'activity', id: a.id, label: a.name, sub: a.domain || null, worklogs: st?.worklogs || 0, knowledge: st?.knowledge || 0 });

    if (t === 'activity') {
      const a = await p.activity.findUnique({ where: { id: oid } });
      if (!a) throw new BadRequestException('not found');
      const [manuals, ptts, krs, kis, wlAgg, kbCnt, recentAuthors, entLinks, recentWls, kbWls] = await Promise.all([
        p.workManual.findMany({ where: { activityId: oid }, select: { id: true, title: true, authorName: true }, take: 10 }),
        p.processTaskTemplate.findMany({ where: { activityId: oid }, select: { processTemplate: { select: { id: true, title: true, status: true } } }, take: 30 }),
        p.keyResult.findMany({ where: { activityId: oid }, select: { id: true, title: true, objective: { select: { id: true, title: true, pillar: true } } }, take: 10 }),
        p.keyInitiative.findMany({ where: { activityId: oid }, select: { id: true, title: true, status: true }, take: 10 }),
        p.worklog.aggregate({ where: { activityId: oid }, _count: { _all: true }, _max: { date: true } }),
        p.worklog.count({ where: { activityId: oid, kbBadge: true } }),
        p.worklog.findMany({ where: { activityId: oid }, orderBy: { date: 'desc' }, take: 30, select: { createdBy: { select: { name: true, orgUnit: { select: { id: true, name: true } } } } } }),
        p.worklog.findMany({ where: { activityId: oid }, select: { id: true }, take: 500 }).then((ws: any[]) =>
          ws.length ? p.worklogEntity.groupBy({ by: ['entityId'], where: { worklogId: { in: ws.map((w) => w.id) } }, _count: { _all: true }, orderBy: { _count: { entityId: 'desc' } }, take: 8 }) : []),
        p.worklog.findMany({ where: { activityId: oid, ...(vis ? { visibility: vis } : {}) }, orderBy: { date: 'desc' }, take: 6, select: { id: true, note: true, date: true, kbBadge: true, createdBy: { select: { name: true } } } }),
        p.worklog.findMany({ where: { activityId: oid, kbBadge: true, ...(vis ? { visibility: vis } : {}) }, orderBy: { date: 'desc' }, take: 6, select: { id: true, note: true, date: true, kbBadge: true, createdBy: { select: { name: true } } } }),
      ]);
      const tplMap = new Map<string, any>();
      for (const x of ptts) if (x.processTemplate) tplMap.set(x.processTemplate.id, x.processTemplate);
      const orgCount = new Map<string, { id: string; name: string; n: number }>();
      for (const w of recentAuthors) {
        const o = w.createdBy?.orgUnit; if (!o) continue;
        const e = orgCount.get(o.id) || { id: o.id, name: o.name, n: 0 }; e.n++; orgCount.set(o.id, e);
      }
      return {
        node: { type: 'activity', id: a.id, label: a.name, sub: [a.domain, a.category].filter(Boolean).join(' ▸ ') || null, meta: { taskType: a.taskType, aliases: (a.aliases || []).slice(0, 8) } },
        sections: [
          { key: 'definition', label: '정의', items: [
            ...manuals.map((m: any) => ({ type: 'workManual', id: m.id, label: m.title, sub: `매뉴얼 · ${m.authorName || ''}` })),
            ...[...tplMap.values()].map((tp: any) => ({ type: 'processTemplate', id: tp.id, label: tp.title, sub: `프로세스 · ${tp.status}` })),
          ] },
          { key: 'execution', label: '실행 (최근 일지)', items: recentWls.map((w: any) => this.wlChip(w)), summary: `일지 총 ${wlAgg._count._all}건${wlAgg._max.date ? ` · 최근 ${new Date(wlAgg._max.date).toISOString().slice(0, 10)}` : ''}` },
          { key: 'knowledge', label: '지식 (🏅 인증 일지)', items: kbWls.map((w: any) => this.wlChip(w)), summary: `🏅 인증 총 ${kbCnt}건` },
          { key: 'measure', label: '측정', items: krs.map((k: any) => ({ type: 'keyResult', id: k.id, label: k.title, sub: `${k.objective?.pillar || ''} ${k.objective?.title || ''}`.trim() })) },
          { key: 'change', label: '변경', items: kis.map((k: any) => ({ type: 'keyInitiative', id: k.id, label: k.title, sub: k.status })), action: kis.length ? null : 'createInitiative' },
          { key: 'org', label: '조직', items: [...orgCount.values()].sort((x, y) => y.n - x.n).slice(0, 5).map((o) => ({ type: 'orgUnit', id: o.id, label: o.name, sub: `최근 일지 ${o.n}건` })) },
          { key: 'entities', label: '다루는 대상', items: await (async () => {
            const ids = (entLinks as any[]).map((r) => String(r.entityId));
            if (!ids.length) return [];
            const es = await p.ontologyEntity.findMany({ where: { id: { in: ids } } });
            const cnt = new Map<string, number>((entLinks as any[]).map((r) => [String(r.entityId), r._count._all] as [string, number]));
            return es.map((e: any) => ({ type: 'entity', id: e.id, label: e.name, sub: `${ENTITY_KIND_KO[e.kind] || ''} · 일지 ${cnt.get(String(e.id)) || 0}건` }));
          })() },
        ],
      };
    }

    if (t === 'entity') {
      const e = await p.ontologyEntity.findUnique({ where: { id: oid } });
      if (!e) throw new BadRequestException('not found');
      const links = await p.worklogEntity.findMany({ where: { entityId: oid }, select: { worklogId: true }, take: 1000 });
      const wlIds = links.map((l: any) => l.worklogId);
      const [wlAgg2, actTop, orgTop] = await Promise.all([
        wlIds.length ? p.worklog.aggregate({ where: { id: { in: wlIds } }, _count: { _all: true }, _max: { date: true } }) : { _count: { _all: 0 }, _max: { date: null } },
        wlIds.length ? p.worklog.groupBy({ by: ['activityId'], where: { id: { in: wlIds }, activityId: { not: null } }, _count: { _all: true }, orderBy: { _count: { activityId: 'desc' } }, take: 10 }) : [],
        wlIds.length ? p.worklog.findMany({ where: { id: { in: wlIds } }, select: { createdBy: { select: { orgUnit: { select: { id: true, name: true } } } } }, take: 200 }) : [],
      ]);
      const actIds = (actTop as any[]).map((r) => String(r.activityId));
      const acts2 = actIds.length ? await p.activity.findMany({ where: { id: { in: actIds } } }) : [];
      const actById2 = new Map<string, any>(acts2.map((a: any) => [String(a.id), a] as [string, any]));
      const orgCnt = new Map<string, { id: string; name: string; n: number }>();
      for (const w of orgTop as any[]) { const o = w.createdBy?.orgUnit; if (!o) continue; const x = orgCnt.get(o.id) || { id: o.id, name: o.name, n: 0 }; x.n++; orgCnt.set(o.id, x); }
      const entWls = wlIds.length ? await p.worklog.findMany({ where: { id: { in: wlIds }, ...(vis ? { visibility: vis } : {}) }, orderBy: { date: 'desc' }, take: 6, select: { id: true, note: true, date: true, kbBadge: true, createdBy: { select: { name: true } } } }) : [];
      return {
        node: { type: 'entity', id: e.id, label: e.name, sub: `${ENTITY_KIND_KO[e.kind] || '대상'} · 일지 ${wlAgg2._count._all}건${wlAgg2._max.date ? ` · 최근 ${new Date(wlAgg2._max.date).toISOString().slice(0, 10)}` : ''}`, meta: { aliases: (e.aliases || []).slice(0, 8) } },
        sections: [
          { key: 'activities', label: '관련 활동', items: (actTop as any[]).map((r) => { const a = actById2.get(String(r.activityId)); return a ? { type: 'activity', id: a.id, label: a.name, sub: a.domain, worklogs: r._count._all, knowledge: 0 } : null; }).filter(Boolean) },
          { key: 'org', label: '다루는 조직', items: [...orgCnt.values()].sort((x, y) => y.n - x.n).slice(0, 6).map((o) => ({ type: 'orgUnit', id: o.id, label: o.name, sub: `일지 ${o.n}건` })) },
          { key: 'execution', label: '최근 일지', items: entWls.map((w: any) => this.wlChip(w)) },
        ],
      };
    }

    if (t === 'worklog') {
      const w = await p.worklog.findUnique({
        where: { id: oid },
        select: { id: true, note: true, date: true, kbBadge: true, kbBadgeNote: true, visibility: true, activityId: true, createdBy: { select: { id: true, name: true, orgUnit: { select: { id: true, name: true } } } } },
      });
      if (!w) throw new BadRequestException('not found');
      if (vis && !['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'].includes(String(w.visibility || 'ALL'))) throw new ForbiddenException('열람 권한이 없는 일지입니다');
      const [act2, entLinks2] = await Promise.all([
        w.activityId ? p.activity.findUnique({ where: { id: w.activityId } }) : null,
        p.worklogEntity.findMany({ where: { worklogId: oid }, select: { entityId: true } }),
      ]);
      const ents2 = entLinks2.length ? await p.ontologyEntity.findMany({ where: { id: { in: entLinks2.map((l: any) => l.entityId) } } }) : [];
      const first = String(w.note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        node: { type: 'worklog', id: w.id, label: first.slice(0, 80) || '(내용 없음)', sub: `업무일지 · ${w.createdBy?.name || ''} · ${w.date ? new Date(w.date).toISOString().slice(0, 10) : ''}${w.kbBadge ? ' · 🏅 지식인증' : ''}`, meta: {} },
        sections: [
          { key: 'activity', label: '수행한 활동', items: act2 ? [{ type: 'activity', id: act2.id, label: act2.name, sub: act2.domain }] : [], summary: act2 ? undefined : '활동 미연결 (⛏ 채굴 대상)' },
          { key: 'entities', label: '다룬 대상', items: ents2.map((e2: any) => ({ type: 'entity', id: e2.id, label: e2.name, sub: ENTITY_KIND_KO[e2.kind] || '대상' })) },
          { key: 'people', label: '작성자', items: [
            ...(w.createdBy ? [{ type: 'user', id: w.createdBy.id, label: w.createdBy.name, sub: w.createdBy.orgUnit?.name || null }] : []),
            ...(w.createdBy?.orgUnit ? [{ type: 'orgUnit', id: w.createdBy.orgUnit.id, label: w.createdBy.orgUnit.name, sub: '소속 팀' }] : []),
          ] },
          ...(w.kbBadge && w.kbBadgeNote ? [{ key: 'badge', label: 'AI 심사평', items: [], summary: `“${String(w.kbBadgeNote).slice(0, 150)}”` }] : []),
        ],
      };
    }

    if (t === 'objective') {
      const o = await p.objective.findUnique({ where: { id: oid }, include: { orgUnit: { select: { id: true, name: true } }, keyResults: { select: { id: true, title: true, activityId: true } } } });
      if (!o) throw new BadRequestException('not found');
      const kis = await p.keyInitiative.findMany({ where: { alignsToObjectiveId: oid }, select: { id: true, title: true, status: true }, take: 20 });
      return {
        node: { type: 'objective', id: o.id, label: o.title, sub: `${o.pillar || '전략 미지정'} · ${o.orgUnit?.name || ''}` },
        sections: [
          { key: 'measure', label: 'KR (지표)', items: o.keyResults.map((k: any) => ({ type: 'keyResult', id: k.id, label: k.title, sub: k.activityId ? '활동 연결됨' : '활동 미연결' })) },
          { key: 'change', label: '중점과제', items: kis.map((k: any) => ({ type: 'keyInitiative', id: k.id, label: k.title, sub: k.status })) },
          { key: 'org', label: '조직', items: o.orgUnit ? [{ type: 'orgUnit', id: o.orgUnit.id, label: o.orgUnit.name, sub: '소유 팀' }] : [] },
        ],
      };
    }

    if (t === 'keyResult' || t === 'keyInitiative') {
      const isKr = t === 'keyResult';
      const g = isKr
        ? await p.keyResult.findUnique({ where: { id: oid }, include: { objective: { select: { id: true, title: true, pillar: true } } } })
        : await p.keyInitiative.findUnique({ where: { id: oid }, include: { alignsToObjective: { select: { id: true, title: true, pillar: true } }, assignee: { select: { name: true } } } });
      if (!g) throw new BadRequestException('not found');
      const act = g.activityId ? await p.activity.findUnique({ where: { id: g.activityId } }) : null;
      const st = act ? await actStats([act.id]) : new Map();
      const obj = isKr ? g.objective : g.alignsToObjective;
      return {
        node: { type: t, id: g.id, label: g.title, sub: isKr ? `KPI${g.metric ? ` · 산식: ${g.metric}` : ''}` : `중점과제 · ${g.status}${g.assignee?.name ? ` · ${g.assignee.name}` : ''}` },
        sections: [
          { key: 'strategy', label: '전략 계보', items: obj ? [{ type: 'objective', id: obj.id, label: obj.title, sub: obj.pillar || '전략 미지정' }] : [] },
          { key: 'activity', label: isKr ? '측정하는 활동' : '개선하는 활동', items: act ? [actChip(act, st.get(act.id))] : [], summary: act ? undefined : '활동 미연결 — 활동 지도에서 🎯 매칭 실행' },
        ],
      };
    }

    if (t === 'processTemplate') {
      const tp = await p.processTemplate.findUnique({ where: { id: oid }, select: { id: true, title: true, status: true, sourceManualId: true, orgUnit: { select: { id: true, name: true } } } });
      if (!tp) throw new BadRequestException('not found');
      const [tasks, manual, instCount] = await Promise.all([
        p.processTaskTemplate.findMany({ where: { processTemplateId: oid, activityId: { not: null } }, select: { activityId: true } }),
        tp.sourceManualId ? p.workManual.findUnique({ where: { id: tp.sourceManualId }, select: { id: true, title: true, authorName: true } }) : null,
        p.processInstance.count({ where: { templateId: oid } }).catch(() => 0),
      ]);
      const actIds: string[] = [...new Set(tasks.map((x: any) => String(x.activityId)))] as string[];
      const acts = actIds.length ? await p.activity.findMany({ where: { id: { in: actIds } } }) : [];
      const st = await actStats(actIds);
      return {
        node: { type: 'processTemplate', id: tp.id, label: tp.title, sub: `프로세스 템플릿 · ${tp.status} · 실행 ${instCount}회` },
        sections: [
          { key: 'definition', label: '원본 매뉴얼', items: manual ? [{ type: 'workManual', id: manual.id, label: manual.title, sub: manual.authorName || '' }] : [] },
          { key: 'activities', label: '수행 활동', items: acts.map((a: any) => actChip(a, st.get(a.id))) },
          { key: 'org', label: '조직', items: tp.orgUnit ? [{ type: 'orgUnit', id: tp.orgUnit.id, label: tp.orgUnit.name, sub: '소유 팀' }] : [] },
        ],
      };
    }

    if (t === 'workManual') {
      const m = await p.workManual.findUnique({ where: { id: oid }, select: { id: true, title: true, authorName: true, status: true, activityId: true, userId: true } });
      if (!m) throw new BadRequestException('not found');
      const [tpls, act] = await Promise.all([
        p.processTemplate.findMany({ where: { sourceManualId: oid }, select: { id: true, title: true, status: true }, take: 5 }),
        m.activityId ? p.activity.findUnique({ where: { id: m.activityId } }) : null,
      ]);
      // 템플릿 경유 활동
      let viaActs: any[] = [];
      if (tpls.length) {
        const ptts = await p.processTaskTemplate.findMany({ where: { processTemplateId: { in: tpls.map((x: any) => x.id) }, activityId: { not: null } }, select: { activityId: true } });
        const ids = [...new Set(ptts.map((x: any) => String(x.activityId)))].filter((x) => x !== m.activityId);
        if (ids.length) viaActs = await p.activity.findMany({ where: { id: { in: ids } }, take: 15 });
      }
      const allActIds = [...(act ? [act.id] : []), ...viaActs.map((a: any) => a.id)];
      const st = await actStats(allActIds);
      return {
        node: { type: 'workManual', id: m.id, label: m.title, sub: `매뉴얼 · ${m.authorName || ''} · ${m.status}` },
        sections: [
          { key: 'process', label: '프로세스화', items: tpls.map((tp: any) => ({ type: 'processTemplate', id: tp.id, label: tp.title, sub: tp.status })), summary: tpls.length ? undefined : '아직 프로세스로 만들어지지 않음' },
          { key: 'activities', label: '연결 활동', items: [...(act ? [actChip(act, st.get(act.id))] : []), ...viaActs.map((a: any) => actChip(a, st.get(a.id)))] },
        ],
      };
    }

    if (t === 'orgUnit') {
      const o = await p.orgUnit.findUnique({ where: { id: oid }, select: { id: true, name: true, type: true, users: { select: { id: true, name: true }, take: 50 } } });
      if (!o) throw new BadRequestException('not found');
      const memberIds = o.users.map((u: any) => u.id);
      const [objs, manCnt, wlTop] = await Promise.all([
        p.objective.findMany({ where: { orgUnitId: oid }, select: { id: true, title: true, pillar: true }, take: 12 }),
        p.workManual.count({ where: { userId: { in: memberIds } } }),
        memberIds.length ? p.worklog.groupBy({ by: ['activityId'], where: { createdById: { in: memberIds }, activityId: { not: null } }, _count: { _all: true }, orderBy: { _count: { activityId: 'desc' } }, take: 10 }).catch(() => []) : [],
      ]);
      const actIds = wlTop.map((r: any) => String(r.activityId));
      const acts = actIds.length ? await p.activity.findMany({ where: { id: { in: actIds } } }) : [];
      const actById = new Map<string, any>(acts.map((a: any) => [String(a.id), a] as [string, any]));
      return {
        node: { type: 'orgUnit', id: o.id, label: o.name, sub: `조직 · 구성원 ${o.users.length}명 · 매뉴얼 ${manCnt}개` },
        sections: [
          { key: 'strategy', label: '목표', items: objs.filter((x: any) => !/^Auto Objective/i.test(x.title)).map((x: any) => ({ type: 'objective', id: x.id, label: x.title, sub: x.pillar || '전략 미지정' })) },
          { key: 'activities', label: '주요 활동 (일지 기준)', items: wlTop.map((r: any) => { const a = actById.get(String(r.activityId)); return a ? { type: 'activity', id: a.id, label: a.name, sub: a.domain, worklogs: r._count._all, knowledge: 0 } : null; }).filter(Boolean) },
          { key: 'people', label: '구성원', items: o.users.slice(0, 12).map((u: any) => ({ type: 'user', id: u.id, label: u.name, sub: null })) },
        ],
      };
    }

    if (t === 'user') {
      const u = await p.user.findUnique({ where: { id: oid }, select: { id: true, name: true, role: true, orgUnit: { select: { id: true, name: true } } } });
      if (!u) throw new BadRequestException('not found');
      const [wlCnt, kbCnt, mans, wlTop] = await Promise.all([
        p.worklog.count({ where: { createdById: oid } }),
        p.worklog.count({ where: { createdById: oid, kbBadge: true } }),
        p.workManual.findMany({ where: { userId: oid }, select: { id: true, title: true, status: true }, take: 8 }),
        p.worklog.groupBy({ by: ['activityId'], where: { createdById: oid, activityId: { not: null } }, _count: { _all: true }, orderBy: { _count: { activityId: 'desc' } }, take: 8 }).catch(() => []),
      ]);
      const actIds = wlTop.map((r: any) => String(r.activityId));
      const acts = actIds.length ? await p.activity.findMany({ where: { id: { in: actIds } } }) : [];
      const actById = new Map<string, any>(acts.map((a: any) => [String(a.id), a] as [string, any]));
      return {
        node: { type: 'user', id: u.id, label: u.name, sub: `구성원 · ${u.orgUnit?.name || ''} · 일지 ${wlCnt}건 · 🏅${kbCnt}` },
        sections: [
          { key: 'activities', label: '주요 활동', items: wlTop.map((r: any) => { const a = actById.get(String(r.activityId)); return a ? { type: 'activity', id: a.id, label: a.name, sub: a.domain, worklogs: r._count._all, knowledge: 0 } : null; }).filter(Boolean) },
          { key: 'definition', label: '작성 매뉴얼', items: mans.map((m: any) => ({ type: 'workManual', id: m.id, label: m.title, sub: m.status })) },
          { key: 'org', label: '조직', items: u.orgUnit ? [{ type: 'orgUnit', id: u.orgUnit.id, label: u.orgUnit.name, sub: '소속 팀' }] : [] },
        ],
      };
    }

    throw new BadRequestException(`unknown type: ${t}`);
  }
}
