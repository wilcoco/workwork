// 온톨로지: 업무일지 → 작성자 팀 KPI 배치 매핑.
// 후보가 "그 팀의 KPI 6~14개"로 좁아 정확도가 높다. AI는 후보 안에서만 고르고(번호 지정),
// 애매하면 빈 배열 — 결과는 WorklogGoalTag(source=AI)로 저장. 본인 분류(USER)가 오면 그게 정본.
import { callAI } from '../llm/ai-client';

export interface KpiMapResult {
  scanned: number;      // 이번 실행에서 검토한 일지 수
  tagged: number;       // KPI 태그가 붙은 일지 수
  tags: number;         // 생성된 태그 수 (일지당 복수 가능)
  none: number;         // '해당 KPI 없음' 처리 수
  remaining: number;    // 남은 미분류 일지 수
  aiErrors: string[];
}

const CHUNK = 15;        // AI 1콜당 일지 수
const NOTE_CUT = 400;    // 일지 본문 컷

export async function mapWorklogsToTeamKpis(
  prisma: any,
  opts: {
    limit?: number;
    actorId?: string;
    /** 재분류 모드: AI 태그만 현재 KPI 기준으로 다시 판정. 본인 확정(USER)은 절대 건드리지 않음.
     *  (기존 팀에 KPI가 추가된 경우 과거 일지 소급용) */
    reclassify?: boolean;
    /** 특정 팀만 처리 (orgUnitId) — 재분류 비용 절약용 */
    orgUnitId?: string;
    /** 재분류 반복 실행 수렴용 컷오프(ISO): 이 시각 이후 태그가 갱신된 일지는 건너뜀 */
    cutoff?: string;
  } = {},
): Promise<KpiMapResult> {
  const limit = Math.min(opts.limit || 300, 600);
  const reclassify = opts.reclassify === true;
  const cutoffMs = opts.cutoff ? new Date(opts.cutoff).getTime() : Date.now();

  // 1) 팀별 진성 KPI 사전 (pillar Objective 하위, Auto/정크 제외)
  const objs = await prisma.objective.findMany({
    select: { title: true, pillar: true, orgUnitId: true, keyResults: { select: { id: true, title: true, metric: true, unit: true } } },
  });
  const kpiByTeam = new Map<string, Array<{ id: string; title: string; metric?: string; unit?: string }>>();
  for (const o of objs) {
    if (!o.pillar || String(o.title || '').startsWith('Auto Objective')) continue;
    const arr = kpiByTeam.get(o.orgUnitId) || [];
    for (const kr of o.keyResults || []) {
      const t = String(kr.title || '').trim();
      if (t.length < 2 || /^auto/i.test(t)) continue;
      arr.push({ id: kr.id, title: t, metric: kr.metric || undefined, unit: kr.unit || undefined });
    }
    if (arr.length) kpiByTeam.set(o.orgUnitId, arr);
  }
  if (!kpiByTeam.size) return { scanned: 0, tagged: 0, tags: 0, none: 0, remaining: 0, aiErrors: ['팀 KPI가 없습니다'] };

  // 2) 대상 일지 선별
  //  - 일반 모드: 태그가 하나도 없는 것 (NONE 포함 어떤 태그든 있으면 처리됨)
  //  - 재분류 모드: USER 태그 있는 일지는 제외(정본 보호), AI-only 일지는 컷오프 이전 것만 재판정
  const tagRows = await prisma.worklogGoalTag.findMany({ select: { worklogId: true, source: true, createdAt: true } });
  const hasAnyTag = new Set<string>();
  const userTagged = new Set<string>();
  const lastTagAt = new Map<string, number>();
  for (const r of tagRows) {
    const id = String(r.worklogId);
    hasAnyTag.add(id);
    if (r.source === 'USER') userTagged.add(id);
    const t = new Date(r.createdAt).getTime();
    if (!lastTagAt.has(id) || t > lastTagAt.get(id)!) lastTagAt.set(id, t);
  }
  const all = await prisma.worklog.findMany({
    orderBy: { date: 'desc' },
    select: { id: true, note: true, createdBy: { select: { orgUnitId: true } } },
  });
  const candidates: Array<{ id: string; text: string; team: string }> = [];
  let remainingTotal = 0;
  for (const w of all) {
    const id = String(w.id);
    if (reclassify) {
      if (userTagged.has(id)) continue; // 본인 확정 보호
      if (hasAnyTag.has(id) && (lastTagAt.get(id) || 0) >= cutoffMs) continue; // 이번 재분류 세션에서 이미 처리됨
    } else {
      if (hasAnyTag.has(id)) continue;
    }
    const team = w.createdBy?.orgUnitId;
    if (!team || !kpiByTeam.has(team)) continue;
    if (opts.orgUnitId && team !== opts.orgUnitId) continue;
    const text = String(w.note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 10) continue;
    remainingTotal++;
    if (candidates.length < limit) candidates.push({ id, text: text.slice(0, NOTE_CUT), team });
  }
  if (!candidates.length) return { scanned: 0, tagged: 0, tags: 0, none: 0, remaining: 0, aiErrors: [] };

  // 3) 팀별로 묶어 청크 호출
  const byTeam = new Map<string, Array<{ id: string; text: string }>>();
  for (const c of candidates) {
    const arr = byTeam.get(c.team) || [];
    arr.push({ id: c.id, text: c.text });
    byTeam.set(c.team, arr);
  }

  const res: KpiMapResult = { scanned: 0, tagged: 0, tags: 0, none: 0, remaining: 0, aiErrors: [] };
  for (const [team, logs] of byTeam) {
    const kpis = kpiByTeam.get(team)!;
    const kpiList = kpis.map((k, i) => `K${i + 1}. ${k.title}${k.metric ? ` (산식: ${k.metric})` : ''}${k.unit ? ` [${k.unit}]` : ''}`).join('\n');
    for (let st = 0; st < logs.length; st += CHUNK) {
      const chunk = logs.slice(st, st + CHUNK);
      try {
        const out = await callAI({
          model: 'claude',
          system: `너는 자동차 부품 제조사(캠스)에서 업무일지를 팀 KPI에 분류하는 담당자다. 반드시 JSON만 출력한다.
아래는 이 팀의 KPI 목록이다:
${kpiList}

각 업무일지를 읽고, 그 업무가 어떤 KPI의 달성·개선에 직접 기여하는 일인지 판정해 kpi 번호(K1 형식)를 0~3개 나열하라.
- 직접 기여가 분명할 때만 지정하라. 일반 행정·회의·잡무처럼 특정 KPI와 무관하면 빈 배열.
- 잘못된 분류가 빈 배열보다 해롭다.
출력: { "items": [{ "index": number, "kpis": string[] }] }`,
          user: chunk.map((l, j) => `#${st + j} ${l.text}`).join('\n\n'),
          maxTokens: 2000,
          jsonSchema: {
            name: 'wl_kpi_map',
            schema: { type: 'object' as const, properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, kpis: { type: 'array', items: { type: 'string' } } }, required: ['index', 'kpis'] } } }, required: ['items'] },
          },
        });
        const items: any[] = out?.parsed?.items || [];
        const seen = new Set<number>();
        for (const m of items) {
          const idx = Number(m.index) - st;
          const row = chunk[idx];
          if (!row || seen.has(idx)) continue;
          seen.add(idx);
          res.scanned++;
          const krIds = (Array.isArray(m.kpis) ? m.kpis : [])
            .map((s: any) => { const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10); return kpis[n - 1]?.id || null; })
            .filter((x: any, i: number, a: any[]) => x && a.indexOf(x) === i)
            .slice(0, 3);
          // 재분류: 기존 AI 태그를 새 판정으로 교체 (USER 태그 없는 일지만 여기 옴)
          if (reclassify) await prisma.worklogGoalTag.deleteMany({ where: { worklogId: row.id, source: 'AI' } });
          if (krIds.length) {
            for (const krId of krIds) {
              await prisma.worklogGoalTag.upsert({
                where: { worklogId_goalType_goalId: { worklogId: row.id, goalType: 'KR', goalId: krId } },
                create: { worklogId: row.id, goalType: 'KR', goalId: krId, source: 'AI' },
                update: {},
              });
              res.tags++;
            }
            res.tagged++;
          } else {
            await prisma.worklogGoalTag.upsert({
              where: { worklogId_goalType_goalId: { worklogId: row.id, goalType: 'NONE', goalId: '' } },
              create: { worklogId: row.id, goalType: 'NONE', goalId: '', source: 'AI' },
              update: {},
            });
            res.none++;
          }
        }
        // AI가 누락한 행은 미처리로 남김(다음 실행에서 재시도)
      } catch (e: any) {
        res.aiErrors.push(String(e?.message || e).slice(0, 160));
        if (res.aiErrors.length >= 3) {
          res.remaining = remainingTotal - res.scanned;
          return res; // 연속 실패(크레딧 등) 시 조기 중단
        }
      }
    }
  }
  res.remaining = remainingTotal - res.scanned;
  return res;
}
