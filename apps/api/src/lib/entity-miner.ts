/**
 * 온톨로지 "대상(masters)" 채굴 — 업무일지에서 활동이 다루는 실물/개념을 추출한다:
 * 설비(EQUIPMENT), 차종(VEHICLE), 고객사(CUSTOMER), 협력사(SUPPLIER), 부품(PART), 시스템(SYSTEM).
 * 활동 채굴과 같은 원칙: AI 추출(일반명) → 결정론 정합(normName·별칭) → 신규.
 * 처리한 일지는 entityMinedAt을 찍어 재과금 없이 이어서 처리한다.
 */
import { callAI } from '../llm/ai-client';
import { normalizeActivityName } from './activity-match';

const strip = (s: string) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const KINDS = ['EQUIPMENT', 'VEHICLE', 'CUSTOMER', 'SUPPLIER', 'PART', 'SYSTEM'];

const EXTRACT_SYS = `너는 자동차 부품 제조사(캠스)의 업무일지에서 "대상(관리 가능한 실물/개념)"을 추출하는 사서다. 반드시 JSON만 출력한다.
각 일지에서 다음 종류의 고유명사만 추출하라 (없으면 빈 배열):
- EQUIPMENT: 설비/장비 (예: 1300톤 사출기, 도장 라인, 3번 프레스)
- VEHICLE: 차종/프로젝트 코드 (예: SP2, 코나, GV70, JA PE)
- CUSTOMER: 고객사 (예: 현대차, 기아, 모비스)
- SUPPLIER: 협력사/외주사
- PART: 부품/제품군 (예: 프론트 범퍼, 라디에이터 그릴, 크래쉬패드)
- SYSTEM: 업무 시스템 (예: ERP, MES, 바이플로우)
규칙:
- 표기를 일반화하라: "1300T 사출기#3" → "1300톤 사출기", 오탈자 보정.
- 사람 이름, 날짜, 수량, 일반명사(회의, 자료)는 절대 추출하지 마라.
- 확실한 것만. 일지당 최대 5개.
출력: { "items": [{ "index": number, "entities": [{ "name": string, "kind": string }] }] }`;

export interface EntityMineResult { scanned: number; linked: number; created: number; error?: string }

export async function mineWorklogEntities(
  prisma: any,
  opts: { limit?: number; days?: number } = {},
): Promise<EntityMineResult> {
  const where: any = { entityMinedAt: null };
  if (opts.days) where.date = { gte: new Date(Date.now() - opts.days * 86400000) };
  const wls = await prisma.worklog.findMany({
    where, orderBy: { date: 'desc' }, take: Math.min(opts.limit || 100, 200),
    select: { id: true, note: true },
  });
  if (!wls.length) return { scanned: 0, linked: 0, created: 0 };

  // 1) AI 추출 — 20건 청크
  const extracted: Record<number, Array<{ name: string; kind: string }>> = {};
  const CHUNK = 20;
  let aiErrors = 0;
  for (let start = 0; start < wls.length; start += CHUNK) {
    const chunk = wls.slice(start, start + CHUNK);
    try {
      const res = await callAI({
        model: 'claude', system: EXTRACT_SYS,
        user: chunk.map((w: any, j: number) => `#${start + j} ${strip(w.note).slice(0, 300)}`).join('\n---\n'),
        temperature: 0.1, maxTokens: 3500,
        jsonSchema: {
          name: 'wl_entities',
          schema: {
            type: 'object' as const,
            properties: { items: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, entities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' } }, required: ['name', 'kind'] } } }, required: ['index'] } } },
            required: ['items'],
          },
        },
      });
      for (const m of res?.parsed?.items || []) {
        extracted[Number(m.index)] = (Array.isArray(m.entities) ? m.entities : [])
          .map((e: any) => ({ name: String(e.name || '').trim(), kind: KINDS.includes(String(e.kind)) ? String(e.kind) : 'OTHER' }))
          .filter((e: any) => e.name.length >= 2)
          .slice(0, 5);
      }
    } catch (e: any) {
      aiErrors++;
      console.error('[entity-miner] chunk failed:', e?.message?.slice(0, 150));
    }
  }
  if (aiErrors > 0 && Object.keys(extracted).length === 0) {
    return { scanned: wls.length, linked: 0, created: 0, error: 'ai-extract-failed' };
  }

  // 2) 결정론 정합 → 링크
  const all: Array<{ id: string; normName: string; aliases: string[] }> = (
    await prisma.ontologyEntity.findMany({ select: { id: true, normName: true, aliases: true } })
  ).map((e: any) => ({ ...e, aliases: Array.isArray(e.aliases) ? e.aliases : [] }));
  const byNorm = new Map<string, string>();
  for (const e of all) { byNorm.set(e.normName, e.id); for (const al of e.aliases) byNorm.set(normalizeActivityName(al), e.id); }

  let linked = 0, created = 0;
  for (let i = 0; i < wls.length; i++) {
    const ents = extracted[i] || [];
    for (const ent of ents) {
      const norm = normalizeActivityName(ent.name);
      if (!norm) continue;
      let eid = byNorm.get(norm);
      if (!eid) {
        try {
          const rec = await prisma.ontologyEntity.create({ data: { name: ent.name, normName: norm, kind: ent.kind } });
          eid = rec.id; byNorm.set(norm, eid as string); created++;
        } catch {
          const ex = await prisma.ontologyEntity.findUnique({ where: { normName: norm } }).catch(() => null);
          if (ex) { eid = ex.id; byNorm.set(norm, eid as string); } else continue;
        }
      }
      try {
        await prisma.worklogEntity.create({ data: { worklogId: wls[i].id, entityId: eid } });
        linked++;
      } catch { /* unique 중복 = 이미 링크됨 */ }
    }
    await prisma.worklog.update({ where: { id: wls[i].id }, data: { entityMinedAt: new Date() } });
  }
  return { scanned: wls.length, linked, created };
}
