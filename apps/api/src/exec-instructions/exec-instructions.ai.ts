// 경영지시 → 꼭지 분해 + 전략 통일성 합성 (AI + 휴리스틱 폴백)
// 원칙: AI 실패/타임아웃 시 항상 휴리스틱으로 동작(서비스 무중단). "없는 통일성을 지어내지 마라."
import { callAI } from '../llm/ai-client';

export interface GeneratedMilestone {
  title: string;
  expectedResult?: string;
  /** 지시문에 담당자로 명시 거론된 구성원 이름 (구성원 목록과 정확 일치할 때만) */
  assigneeName?: string;
}

const AI_TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('ai-timeout')), ms)),
  ]);
}

// ── 휴리스틱 폴백: 문장/줄/불릿을 3~6개 꼭지로 ──────────────
export function heuristicMilestones(rawText: string): GeneratedMilestone[] {
  const text = String(rawText || '').trim();
  if (!text) return [{ title: '지시 내용 확인 및 세부 계획 수립' }];
  // 1) 줄바꿈/불릿 우선, 2) 없으면 문장 분리
  let parts = text
    .split(/\r?\n|(?:^|\s)[-•▷▶·]\s+|\d+[.)]\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (parts.length < 2) {
    parts = text.split(/(?<=[.!?。])\s+|[,、]\s+/g).map((s) => s.trim()).filter((s) => s.length >= 2);
  }
  if (parts.length === 0) parts = [text];
  // 3~6개로 정규화
  const trimmed = parts.slice(0, 6);
  const out = trimmed.map((p) => ({ title: p.length > 60 ? p.slice(0, 57) + '…' : p }));
  if (out.length < 3) {
    // 부족하면 표준 실행 매듭으로 채움
    const pads = ['담당자 배정 및 착수', '중간 점검', '결과 정리 및 보고'];
    for (let i = out.length; i < 3; i++) out.push({ title: pads[i] || `단계 ${i + 1}` });
  }
  return out;
}

const MILESTONE_SCHEMA = {
  name: 'milestones',
  schema: {
    type: 'object',
    properties: {
      milestones: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '꼭지 제목(굵직한 실행 매듭, 20자 내외)' },
            expectedResult: { type: 'string', description: '이 꼭지의 기대 결과(무엇이 되어 있어야 완료인가)' },
            assigneeName: { type: 'string', description: '지시문에 이 꼭지의 담당자로 명시적으로 거론된 사람 이름 ([구성원 목록]에 있는 이름 그대로). 거론이 없으면 생략.' },
          },
          required: ['title'],
        },
      },
    },
    required: ['milestones'],
  },
};

export async function generateMilestones(rawText: string, memberNames?: string[]): Promise<GeneratedMilestone[]> {
  const text = String(rawText || '').trim();
  if (!text) return heuristicMilestones(text);
  const names = (memberNames || []).map((n) => String(n || '').trim()).filter(Boolean).slice(0, 300);
  const nameSet = new Set(names);
  try {
    const res = await withTimeout(
      callAI({
        model: 'claude',
        system:
          '너는 경영진의 지시를 실행 가능한 "꼭지(굵직한 매듭)"로 분해하는 비서다. ' +
          'BPM 세부절차가 아니라 순서가 있는 3~6개의 큰 매듭만 만든다. 각 꼭지는 제목과 기대결과(완료 판정 기준)를 가진다. ' +
          '지시에 없는 내용을 지어내지 말고, 실제 실행 순서대로 배열하라. 한국어로 작성.' +
          (names.length
            ? ' 지시문에 특정 구성원이 어떤 일의 담당자로 명시 거론되어 있고 그 이름이 아래 [구성원 목록]에 있으면, 해당 꼭지의 assigneeName에 목록의 이름 그대로 넣어라. 거론되지 않았거나 목록에 없으면 절대 채우지 마라(추측 금지).' +
              `\n[구성원 목록] ${names.join(', ')}`
            : ''),
        user: `다음 지시를 꼭지로 분해하라:\n\n${text}`,
        jsonSchema: MILESTONE_SCHEMA,
        maxTokens: 1500,
      }),
      AI_TIMEOUT_MS,
    );
    const arr = res?.parsed?.milestones;
    if (Array.isArray(arr) && arr.length >= 1) {
      return arr
        .filter((m: any) => m && typeof m.title === 'string' && m.title.trim())
        .slice(0, 6)
        .map((m: any) => {
          const an = String(m.assigneeName || '').trim();
          return {
            title: String(m.title).trim(),
            expectedResult: m.expectedResult ? String(m.expectedResult).trim() : undefined,
            assigneeName: an && nameSet.has(an) ? an : undefined, // 목록에 있는 이름만 인정 (AI 작문 방지)
          };
        });
    }
  } catch {
    // fall through to heuristic
  }
  return heuristicMilestones(text);
}

// ── 전략 통일성 합성 ─────────────────────────────────────────
export interface StrategyResult {
  groups: Array<{ theme: string; instructionIds: string[]; note?: string }>;
  contradictions: Array<{ aId: string; bId: string; note: string }>;
  orphans: string[];
  goalMap?: Array<{ instructionId: string; objective?: string }>;
  generatedBy: 'ai' | 'heuristic';
}

const STRATEGY_SCHEMA = {
  name: 'strategy',
  schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string' },
            instructionIds: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
          required: ['theme', 'instructionIds'],
        },
      },
      contradictions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { aId: { type: 'string' }, bId: { type: 'string' }, note: { type: 'string' } },
          required: ['aId', 'bId', 'note'],
        },
      },
      orphans: { type: 'array', items: { type: 'string' } },
    },
    required: ['groups', 'contradictions', 'orphans'],
  },
};

export async function synthesizeStrategy(
  instructions: Array<{ id: string; text: string }>,
): Promise<StrategyResult> {
  const list = instructions.filter((i) => i && i.id && String(i.text || '').trim());
  if (list.length === 0) {
    return { groups: [], contradictions: [], orphans: [], generatedBy: 'heuristic' };
  }
  try {
    const res = await withTimeout(
      callAI({
        model: 'claude',
        system:
          '너는 누적된 경영 지시들을 교차 해석하는 전략 분석가다. ' +
          '주제가 같은 지시를 그룹으로 묶고, 서로 모순되는 지시 쌍을 찾고, 어디에도 안 묶이는 고아 지시를 표시한다. ' +
          '중요: 없는 통일성을 지어내지 마라. 억지로 묶지 말고, 안 붙으면 솔직하게 orphan으로 둬라. ' +
          'instructionIds/aId/bId 에는 반드시 아래 제공된 id 문자열만 사용하라.',
        user:
          '지시 목록:\n' +
          list.map((i) => `- id=${i.id}: ${i.text.slice(0, 300)}`).join('\n'),
        jsonSchema: STRATEGY_SCHEMA,
        maxTokens: 2500,
      }),
      AI_TIMEOUT_MS,
    );
    const p = res?.parsed;
    if (p && Array.isArray(p.groups)) {
      const validIds = new Set(list.map((i) => i.id));
      return {
        groups: (p.groups || [])
          .map((g: any) => ({ theme: String(g.theme || ''), instructionIds: (g.instructionIds || []).filter((x: string) => validIds.has(x)), note: g.note }))
          .filter((g: any) => g.theme && g.instructionIds.length),
        contradictions: (p.contradictions || []).filter((c: any) => validIds.has(c.aId) && validIds.has(c.bId)),
        orphans: (p.orphans || []).filter((x: string) => validIds.has(x)),
        generatedBy: 'ai',
      };
    }
  } catch {
    // fall through
  }
  // 휴리스틱: 그룹핑 없이 전부 orphan (없는 통일성 지어내지 않음)
  return { groups: [], contradictions: [], orphans: list.map((i) => i.id), generatedBy: 'heuristic' };
}
