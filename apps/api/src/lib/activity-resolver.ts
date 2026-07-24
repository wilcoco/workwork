/**
 * BPMN 태스크 노드 → 활동(Activity) 자동 정합.
 * 템플릿 저장 시 서버가 자동 수행: 결정론 일치 → (유사 후보 있으면) AI 일괄 판정 → 신규 등록.
 * 사람 개입 없이 등록부가 자라며, AI는 보수적으로(확신 없으면 신규) 판정한다.
 */
import { callAI } from '../llm/ai-client';
import { ActivityLite, exactMatch, normalizeActivityName, shortlist } from './activity-match';

const strip = (s: string) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** bpmnJson의 task 노드들에 activityId를 채워 넣는다 (원본 객체 변형). 반환: 정합 요약 로그 */
export async function resolveActivitiesForBpmn(prisma: any, bpmnJson: any, actorId?: string): Promise<Array<{ node: string; action: string; activityId: string }>> {
  const nodes: any[] = Array.isArray(bpmnJson?.nodes) ? bpmnJson.nodes : [];
  const tasks = nodes.filter((n) => String(n?.type) === 'task' && String(n?.name || '').trim());
  if (!tasks.length) return [];

  const all: ActivityLite[] = (await prisma.activity.findMany({
    select: { id: true, name: true, normName: true, aliases: true, taskType: true },
  })).map((a: any) => ({ ...a, aliases: Array.isArray(a.aliases) ? a.aliases : [] }));

  const log: Array<{ node: string; action: string; activityId: string }> = [];
  // AI 판정 대상 수집 (결정론 실패 + 유사 후보 존재)
  const aiItems: Array<{ node: any; cands: Array<ActivityLite & { score: number }> }> = [];

  for (const n of tasks) {
    if (n.activityId) continue; // 이미 연결됨 (재저장 시 유지)
    const name = strip(n.name);
    const tt = String(n.taskType || '').toUpperCase() || undefined;
    const hit = exactMatch(name, all);
    if (hit) {
      n.activityId = hit.id;
      log.push({ node: name, action: 'exact', activityId: hit.id });
      continue;
    }
    const cands = shortlist(name, tt, all);
    if (cands.length) aiItems.push({ node: n, cands });
    else {
      const created = await createActivity(prisma, n, actorId);
      if (created) { all.push(created); log.push({ node: name, action: 'new', activityId: created.id }); }
    }
  }

  // AI 일괄 판정 (한 번의 호출)
  if (aiItems.length) {
    let verdicts: Record<string, string | null> = {};
    try {
      const listText = aiItems
        .map((it, i) => `#${i} 후보작업: "${strip(it.node.name)}"${it.node.description ? ` (설명: ${strip(it.node.description).slice(0, 120)})` : ''}\n   기존활동: ${it.cands.map((c) => `[${c.id}] ${c.name}`).join(' / ')}`)
        .join('\n');
      const res = await callAI({
        model: 'claude',
        system:
          '너는 회사 작업 사전의 정합 심사관이다. 반드시 JSON만 출력한다. ' +
          '각 후보작업이 나열된 기존활동 중 하나와 "같은 작업"인지 판정하라. ' +
          '같은 작업 = 이름이 달라도 실제로 동일한 일(예: "발주 요청"과 "발주 요청서 작성"). ' +
          '확신이 없거나 비슷하지만 다른 일이면 반드시 null. 잘못된 병합이 더 해롭다.',
        user: `${listText}\n\n출력: { "matches": [{ "index": number, "activityId": string|null }] }`,
        temperature: 0.1,
        maxTokens: 1000,
        jsonSchema: {
          name: 'activity_match',
          schema: {
            type: 'object' as const,
            properties: { matches: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, activityId: { type: ['string', 'null'] } }, required: ['index'] } } },
            required: ['matches'],
          },
        },
      });
      for (const m of res?.parsed?.matches || []) verdicts[String(m.index)] = m.activityId || null;
    } catch { /* AI 실패 → 전부 신규 */ }

    for (let i = 0; i < aiItems.length; i++) {
      const { node, cands } = aiItems[i];
      const vid = verdicts[String(i)];
      const valid = vid && cands.some((c) => c.id === vid) ? vid : null; // 후보 밖 ID는 무시(작문 방지)
      if (valid) {
        node.activityId = valid;
        log.push({ node: strip(node.name), action: 'ai-match', activityId: valid });
        // 새 표현을 별칭으로 축적
        try {
          const act = await prisma.activity.findUnique({ where: { id: valid }, select: { aliases: true, name: true } });
          const aliases: string[] = Array.isArray(act?.aliases) ? act.aliases : [];
          const nm = strip(node.name);
          if (nm && nm !== act?.name && !aliases.includes(nm)) {
            await prisma.activity.update({ where: { id: valid }, data: { aliases: [...aliases, nm].slice(0, 20) } });
          }
        } catch {}
      } else {
        const created = await createActivity(prisma, node, actorId);
        if (created) { all.push(created); log.push({ node: strip(node.name), action: 'new', activityId: created.id }); }
      }
    }
  }
  // 템플릿에 연결된 활동은 전부 CONFIRMED 승격 (사람 검토를 거친 정의)
  try {
    const linkedIds = (bpmnJson?.nodes || []).map((n: any) => n.activityId).filter(Boolean);
    if (linkedIds.length) await prisma.activity.updateMany({ where: { id: { in: linkedIds }, status: 'AUTO' }, data: { status: 'CONFIRMED' } });
  } catch {}
  return log;
}

async function createActivity(prisma: any, node: any, actorId?: string): Promise<ActivityLite | null> {
  const name = strip(node.name);
  const normName = normalizeActivityName(name);
  if (!normName) return null;
  try {
    const rec = await prisma.activity.create({
      data: {
        name,
        normName,
        status: 'CONFIRMED', // 사람이 작성한 템플릿 경유 = 확인된 활동
        taskType: String(node.taskType || '').toUpperCase() || null,
        description: node.description ? strip(node.description).slice(0, 500) : null,
        roleHint: node.assigneeHint ? strip(node.assigneeHint).slice(0, 120) : null,
        createdById: actorId || null,
      },
    });
    node.activityId = rec.id;
    return { id: rec.id, name: rec.name, normName: rec.normName, aliases: [], taskType: rec.taskType };
  } catch {
    // normName 유니크 충돌(동시 저장) → 기존 것 재사용
    try {
      const exist = await prisma.activity.findUnique({ where: { normName } });
      if (exist) { node.activityId = exist.id; return { id: exist.id, name: exist.name, normName: exist.normName, aliases: [], taskType: exist.taskType }; }
    } catch {}
    return null;
  }
}
