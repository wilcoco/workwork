/**
 * 온톨로지 활동 정합(entity resolution) — 순수 로직.
 * 원칙: 결정론(정규화 일치·별칭 일치) 우선 → 유사 후보만 AI에 좁혀서 판정 → 그래도 애매하면 신규 등록.
 * (잘못된 병합 1건이 잘못된 분리 10건보다 해롭다 — 보수적으로)
 */

/** 정합 키: 공백/기호 제거 + 소문자 + 흔한 접미어(하기/작업/업무/처리) 제거 */
export function normalizeActivityName(name: string): string {
  let s = String(name || '')
    .toLowerCase()
    .replace(/[\s ]+/g, '')
    .replace(/[()\[\]{}<>·.,/\\\-_~!?:;'"“”‘’]+/g, '');
  // 의미 없는 꼬리말 제거 (한 번만, 과제거 방지)
  s = s.replace(/(하기|작업|업무|처리|진행)$/u, '');
  return s;
}

export type ActivityLite = { id: string; name: string; normName: string; aliases?: string[] | null; taskType?: string | null };

/** bigram 자카드 유사도 (짧은 한국어 명칭에 적당) */
export function bigramSim(a: string, b: string): number {
  const grams = (t: string) => {
    const g = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    if (t.length === 1) g.add(t);
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 결정론 매칭: normName 또는 별칭 정규화 일치 */
export function exactMatch(candidateName: string, activities: ActivityLite[]): ActivityLite | null {
  const norm = normalizeActivityName(candidateName);
  if (!norm) return null;
  for (const a of activities) {
    if (a.normName === norm) return a;
    for (const al of a.aliases || []) {
      if (normalizeActivityName(al) === norm) return a;
    }
  }
  return null;
}

/** AI 판정에 넘길 유사 후보 상위 N (같은 taskType 가산점, 임계 미만 제외) */
export function shortlist(candidateName: string, candidateType: string | undefined, activities: ActivityLite[], topN = 6): Array<ActivityLite & { score: number }> {
  const norm = normalizeActivityName(candidateName);
  if (!norm) return [];
  return activities
    .map((a) => {
      let score = bigramSim(norm, a.normName);
      for (const al of a.aliases || []) score = Math.max(score, bigramSim(norm, normalizeActivityName(al)));
      if (candidateType && a.taskType && candidateType === a.taskType) score += 0.05;
      return { ...a, score };
    })
    .filter((x) => x.score >= 0.45) // 이 미만은 AI에게 물을 가치도 없음 → 신규
    .sort((x, y) => y.score - x.score)
    .slice(0, topN);
}
