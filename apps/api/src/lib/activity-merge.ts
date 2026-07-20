/**
 * 온톨로지 활동 병합(dedup) — 잘게 쪼개진 유사 활동을 하나의 반복 작업 단위로 통합.
 * 절차: 결정론 클러스터링(normName bigram 유사도로 후보 묶음) → AI 하위그룹 판정
 * (정말 같은 반복작업인지 + 대표명) → 참조 재지정 + 별칭 흡수 + 중복 삭제.
 * 보수적: 애매하면 분리 유지. 병합된 원본명은 모두 별칭으로 보존해 검색 가능.
 */
import { callAI } from '../llm/ai-client';
import { bigramSim, normalizeActivityName } from './activity-match';

export interface MergeResult {
  candidates: number; // 병합 후보(유사) 클러스터 수
  processed: number; // 이번 실행에서 AI 판정한 클러스터 수
  merged: number; // 실제 병합된 그룹 수
  removed: number; // 흡수되어 삭제된 활동 수
  remaining: number; // 아직 처리 안 된 후보 클러스터 수
  samples: Array<{ canonical: string; absorbed: string[] }>;
  dryRun?: boolean;
}

type Act = { id: string; name: string; normName: string; aliases: string[]; taskType: string | null; domain: string | null; wl: number };

/** union-find */
class UF {
  p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a: number, b: number) { this.p[this.find(a)] = this.find(b); }
}

export async function mergeSimilarActivities(
  prisma: any,
  opts: { actorId?: string; limit?: number; threshold?: number; dryRun?: boolean } = {},
): Promise<MergeResult> {
  const threshold = opts.threshold ?? 0.5;
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 60));

  const rows = await prisma.activity.findMany({ select: { id: true, name: true, normName: true, aliases: true, taskType: true, domain: true } });
  const wlCounts = await prisma.worklog.groupBy({ by: ['activityId'], where: { activityId: { not: null } }, _count: { _all: true } });
  const wlMap = new Map(wlCounts.map((r: any) => [String(r.activityId), r._count._all]));
  const acts: Act[] = rows.map((a: any) => ({ id: a.id, name: a.name, normName: a.normName || normalizeActivityName(a.name), aliases: Array.isArray(a.aliases) ? a.aliases : [], taskType: a.taskType || null, domain: a.domain || null, wl: Number(wlMap.get(String(a.id)) || 0) }));
  if (acts.length < 2) return { candidates: 0, processed: 0, merged: 0, removed: 0, remaining: 0, samples: [] };

  // 1) 결정론 클러스터링 — bigram 유사도 ≥ threshold 끼리 union.
  // 비교량 축소: bigram 역색인으로 공통 bigram이 있는 쌍만 후보로.
  const uf = new UF(acts.length);
  const index = new Map<string, number[]>();
  const gramsOf = (t: string) => { const g = new Set<string>(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); if (t.length === 1) g.add(t); return g; };
  const actGrams = acts.map((a) => gramsOf(a.normName));
  acts.forEach((_, i) => { for (const g of actGrams[i]) { const arr = index.get(g) || []; arr.push(i); index.set(g, arr); } });
  const seen = new Set<string>();
  for (let i = 0; i < acts.length; i++) {
    const near = new Set<number>();
    for (const g of actGrams[i]) for (const j of index.get(g) || []) if (j > i) near.add(j);
    for (const j of near) {
      const key = `${i}:${j}`; if (seen.has(key)) continue; seen.add(key);
      if (acts[i].taskType && acts[j].taskType && acts[i].taskType !== acts[j].taskType) continue; // 유형 다르면 병합 안 함
      if (bigramSim(acts[i].normName, acts[j].normName) >= threshold) uf.union(i, j);
    }
  }

  // 클러스터 수집 (크기 ≥ 2)
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < acts.length; i++) { const r = uf.find(i); (clusters.get(r) || clusters.set(r, []).get(r)!).push(i); }
  const candidateClusters = [...clusters.values()].filter((c) => c.length >= 2).sort((a, b) => b.length - a.length);

  const batch = candidateClusters.slice(0, limit);
  let merged = 0, removed = 0;
  const samples: MergeResult['samples'] = [];

  for (const cluster of batch) {
    // 클러스터가 너무 크면(>14) 상위 wl 기준으로 잘라 안전 처리
    const members = cluster.map((i) => acts[i]).sort((a, b) => b.wl - a.wl).slice(0, 14);
    let groups: Array<{ canonicalName: string; memberIds: string[] }> = [];
    try {
      const listText = members.map((m) => `[${m.id}] "${m.name}" (일지 ${m.wl})`).join('\n');
      const res = await callAI({
        model: 'claude',
        system: `너는 회사 업무 활동 사전의 정리 담당이다. 반드시 JSON만 출력한다.
아래 활동들은 이름이 비슷해 같은 "반복 작업"일 가능성이 있다. 정말 같은 반복 작업끼리만 묶어라.
- 인스턴스 차이(차종/고객/차수/1차·2차/송부처)는 무시하고 작업의 본질이 같으면 같은 그룹.
  예: "구매원가 계산서 작성 및 송부", "구매원가 2차 계산서 작성" → 한 그룹, 대표명 "구매원가 계산서 작성".
- 본질이 다르면(예: "원가 계산서 작성" vs "원가 절감안 협의") 묶지 마라. 애매하면 각자 단독.
- canonicalName: 인스턴스 정보를 뺀 8~20자 일반 명사형 대표명.
- 단독(혼자)인 활동은 출력에서 제외해도 된다(2개 이상 묶인 그룹만 반환).
출력: { "groups": [{ "canonicalName": string, "memberIds": [string, ...] }] }`,
        user: listText,
        temperature: 0.1, maxTokens: 1500,
        jsonSchema: { name: 'merge_groups', schema: { type: 'object' as const, properties: { groups: { type: 'array', items: { type: 'object', properties: { canonicalName: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } } }, required: ['canonicalName', 'memberIds'] } } }, required: ['groups'] } },
      });
      groups = (res?.parsed?.groups || []).filter((g: any) => Array.isArray(g.memberIds) && g.memberIds.length >= 2);
    } catch { continue; }

    const validIds = new Set(members.map((m) => m.id));
    for (const g of groups) {
      const memberIds = [...new Set(g.memberIds.map(String))].filter((id) => validIds.has(id));
      if (memberIds.length < 2) continue;
      const groupActs = memberIds.map((id) => members.find((m) => m.id === id)!).filter(Boolean);
      // 대표 = 일지 가장 많은 활동 (동률이면 이름 짧은 쪽)
      const canonical = [...groupActs].sort((a, b) => b.wl - a.wl || a.name.length - b.name.length)[0];
      const others = groupActs.filter((a) => a.id !== canonical.id);
      const canonName = String(g.canonicalName || canonical.name).trim().slice(0, 40) || canonical.name;
      // 흡수 별칭: 원본명 + 기존 별칭 전부 보존
      const absorbedNames = others.map((o) => o.name);
      const aliasPool = [...new Set([...canonical.aliases, canonical.name, ...others.flatMap((o) => [o.name, ...o.aliases])].filter((n) => n && n !== canonName))].slice(0, 40);

      if (opts.dryRun) { merged++; removed += others.length; if (samples.length < 20) samples.push({ canonical: canonName, absorbed: absorbedNames }); continue; }

      try {
        await prisma.$transaction(async (tx: any) => {
          const otherIds = others.map((o) => o.id);
          // 참조 재지정 (activityId 를 쓰는 모든 테이블)
          await tx.worklog.updateMany({ where: { activityId: { in: otherIds } }, data: { activityId: canonical.id } });
          await tx.keyResult.updateMany({ where: { activityId: { in: otherIds } }, data: { activityId: canonical.id } });
          await tx.keyInitiative.updateMany({ where: { activityId: { in: otherIds } }, data: { activityId: canonical.id } });
          await tx.processTaskTemplate.updateMany({ where: { activityId: { in: otherIds } }, data: { activityId: canonical.id } });
          // 대표 활동명/별칭 갱신 (normName 은 대표명 기준으로 재계산, 충돌 시 기존 유지)
          const newNorm = normalizeActivityName(canonName);
          const clash = newNorm && newNorm !== canonical.normName ? await tx.activity.findFirst({ where: { normName: newNorm, id: { not: canonical.id } }, select: { id: true } }) : null;
          await tx.activity.update({ where: { id: canonical.id }, data: { name: canonName, aliases: aliasPool, ...(newNorm && !clash ? { normName: newNorm } : {}) } });
          await tx.activity.deleteMany({ where: { id: { in: otherIds } } });
        });
        merged++; removed += others.length;
        if (samples.length < 20) samples.push({ canonical: canonName, absorbed: absorbedNames });
      } catch (e: any) {
        console.error('[activity-merge] merge failed:', e?.message?.slice(0, 200));
      }
    }
  }

  return {
    candidates: candidateClusters.length,
    processed: batch.length,
    merged, removed,
    remaining: Math.max(0, candidateClusters.length - batch.length),
    samples,
    dryRun: opts.dryRun,
  };
}
