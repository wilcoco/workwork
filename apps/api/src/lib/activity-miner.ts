/**
 * 온톨로지 상향식 채굴: 업무일지 → 활동(Activity) 추출·정합.
 * 템플릿(하향식)이 공식 프로세스를 등록한다면, 마이너는 실제 일어난 일(일지)에서
 * 활동을 발견한다. 추출은 AI(인스턴스 정보 제거한 일반화 작업명), 정합은
 * 템플릿과 동일 원칙: 결정론(정규화·별칭) → AI 판정(유사 후보만) → 신규.
 */
import { callAI } from '../llm/ai-client';
import { ActivityLite, exactMatch, normalizeActivityName, shortlist } from './activity-match';

const strip = (s: string) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const EXTRACT_SYS = `너는 업무일지에서 "활동(반복 가능한 작업 단위)"의 이름을 추출하는 사서다. 반드시 JSON만 출력한다.
각 일지에서 핵심 작업 하나를 골라 일반화된 명사형 작업명으로 추출하라.
- 인스턴스 정보 제거: 날짜, 차종/품번, 고객사명, 수량 등은 빼고 작업 자체만 (예: "'27년 SP2 생산차질보상비 자료 작성 완료" → "생산차질보상비 산출 자료 작성")
- 8~25자 명사형. "~완료/~했음" 금지.
- taskType: 결재/승인 작업이면 APPROVAL, 타팀 요청이면 COOPERATION, 그 외 WORKLOG.
- 일지가 잡다한 나열이거나 작업을 특정할 수 없으면 activityName은 null.
출력: { "items": [{ "index": number, "activityName": string|null, "taskType": string }] }`;

export interface MineResult { scanned: number; linked: number; created: number; skipped: number; error?: string }

export async function mineWorklogActivities(
  prisma: any,
  opts: { limit?: number; days?: number; onlyBadged?: boolean; worklogIds?: string[]; actorId?: string } = {},
): Promise<MineResult> {
  const where: any = { activityId: null };
  if (opts.worklogIds?.length) where.id = { in: opts.worklogIds };
  else {
    where.visibility = 'ALL'; // 배치 채굴은 공개 일지만 (제한 일지는 인증 시 개별 연결됨)
    if (opts.onlyBadged) where.kbBadge = true;
    if (opts.days) where.date = { gte: new Date(Date.now() - opts.days * 86400000) };
  }
  const wls = await prisma.worklog.findMany({
    where,
    orderBy: { date: 'desc' },
    take: Math.min(opts.limit || 100, 200),
    select: { id: true, note: true },
  });
  if (!wls.length) return { scanned: 0, linked: 0, created: 0, skipped: 0 };

  // 1) AI 추출 — 20건씩 청크 (응답 JSON이 maxTokens를 넘지 않도록). 청크 실패는 해당 청크만 건너뜀.
  const extracted: Record<number, { name: string | null; taskType?: string }> = {};
  const CHUNK = 20;
  let aiErrors = 0;
  for (let start = 0; start < wls.length; start += CHUNK) {
    const chunk = wls.slice(start, start + CHUNK);
    try {
      const userMsg = chunk.map((w: any, j: number) => `#${start + j} ${strip(w.note).slice(0, 300)}`).join('\n---\n');
      const res = await callAI({
        model: 'claude', system: EXTRACT_SYS, user: userMsg, temperature: 0.1, maxTokens: 3500,
        jsonSchema: {
          name: 'wl_activities',
          schema: {
            type: 'object' as const,
            properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, activityName: { type: ['string', 'null'] }, taskType: { type: 'string' } }, required: ['index'] } } },
            required: ['items'],
          },
        },
      });
      for (const m of res?.parsed?.items || []) extracted[Number(m.index)] = { name: m.activityName ? String(m.activityName).trim() : null, taskType: String(m.taskType || 'WORKLOG').toUpperCase() };
    } catch (e: any) {
      aiErrors++;
      console.error('[ontology-miner] extract chunk failed:', e?.message?.slice(0, 200));
    }
  }
  if (aiErrors > 0 && Object.keys(extracted).length === 0) {
    return { scanned: wls.length, linked: 0, created: 0, skipped: wls.length, error: 'ai-extract-failed' };
  }

  // 2) 정합 (결정론 → 유사 후보 수집)
  const all: ActivityLite[] = (await prisma.activity.findMany({ select: { id: true, name: true, normName: true, aliases: true, taskType: true } }))
    .map((a: any) => ({ ...a, aliases: Array.isArray(a.aliases) ? a.aliases : [] }));
  let linked = 0, created = 0, skipped = 0;
  const ambiguous: Array<{ wlId: string; name: string; taskType?: string; cands: Array<ActivityLite & { score: number }> }> = [];

  const link = async (wlId: string, activityId: string) => { await prisma.worklog.update({ where: { id: wlId }, data: { activityId } }); linked++; };
  const createAct = async (wlId: string, name: string, taskType?: string): Promise<void> => {
    const normName = normalizeActivityName(name);
    if (!normName) { skipped++; return; }
    try {
      const rec = await prisma.activity.create({ data: { name, normName, taskType: taskType || 'WORKLOG', description: '업무일지에서 추출됨', createdById: opts.actorId || null } });
      all.push({ id: rec.id, name: rec.name, normName: rec.normName, aliases: [], taskType: rec.taskType });
      created++; await link(wlId, rec.id);
    } catch {
      const ex = await prisma.activity.findUnique({ where: { normName } }).catch(() => null);
      if (ex) await link(wlId, ex.id); else skipped++;
    }
  };

  for (let i = 0; i < wls.length; i++) {
    const ext = extracted[i];
    const name = ext?.name && ext.name.length >= 3 ? ext.name : null;
    if (!name) { skipped++; continue; }
    const hit = exactMatch(name, all);
    if (hit) { await link(wls[i].id, hit.id); continue; }
    const cands = shortlist(name, ext?.taskType, all);
    if (cands.length) ambiguous.push({ wlId: wls[i].id, name, taskType: ext?.taskType, cands });
    else await createAct(wls[i].id, name, ext?.taskType);
  }

  // 3) 유사 후보 AI 일괄 판정 (보수적 — 확신 없으면 신규)
  if (ambiguous.length) {
    const verdicts: Record<string, string | null> = {};
    try {
      const listText = ambiguous.map((it, i) => `#${i} 후보작업: "${it.name}"\n   기존활동: ${it.cands.map((c) => `[${c.id}] ${c.name}`).join(' / ')}`).join('\n');
      const res = await callAI({
        model: 'claude',
        system: '너는 회사 작업 사전의 정합 심사관이다. 반드시 JSON만 출력한다. 각 후보작업이 나열된 기존활동 중 하나와 "같은 작업"인지 판정하라. 확신이 없으면 반드시 null. 잘못된 병합이 더 해롭다.',
        user: `${listText}\n\n출력: { "matches": [{ "index": number, "activityId": string|null }] }`,
        temperature: 0.1, maxTokens: 1200,
        jsonSchema: { name: 'wl_match', schema: { type: 'object' as const, properties: { matches: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, activityId: { type: ['string', 'null'] } }, required: ['index'] } } }, required: ['matches'] } },
      });
      for (const m of res?.parsed?.matches || []) verdicts[String(m.index)] = m.activityId || null;
    } catch { /* 전부 신규 */ }
    for (let i = 0; i < ambiguous.length; i++) {
      const { wlId, name, taskType, cands } = ambiguous[i];
      const vid = verdicts[String(i)];
      const valid = vid && cands.some((c) => c.id === vid) ? vid : null;
      if (valid) {
        await link(wlId, valid);
        try { // 새 표현 별칭 축적
          const act = await prisma.activity.findUnique({ where: { id: valid }, select: { aliases: true, name: true } });
          const aliases: string[] = Array.isArray(act?.aliases) ? act.aliases : [];
          if (name !== act?.name && !aliases.includes(name)) await prisma.activity.update({ where: { id: valid }, data: { aliases: [...aliases, name].slice(0, 20) } });
        } catch {}
      } else await createAct(wlId, name, taskType);
    }
  }
  return { scanned: wls.length, linked, created, skipped };
}
