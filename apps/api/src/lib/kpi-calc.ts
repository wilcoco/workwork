// KPI 달성률 공용 계산 (서버) — apps/web/src/lib/kpiCalc.ts와 같은 규칙. 수정 시 양쪽 함께.
// 집계 방식(aggregation): AVG=월별 독립 측정, SUM=월별 발생량 합산, LAST=누계값 직접 입력. null=단위로 자동추정(%·율=AVG).
// 목표(target)는 연간 목표가 기준 — 합산·누계형의 월/누적 달성률은 경과월로 안분한 목표에 대비한다.

export type KrCalc = {
  unit?: string | null;
  target?: number | null;
  direction?: string | null;
  aggregation?: string | null;
};
export type KpiMode = 'avg' | 'sum' | 'last' | 'progress';

export const isRateKr = (kr: KrCalc) => /[%율]|ppm/i.test(String(kr.unit || '')); // 비율성 단위(%·율·PPM)=월별 독립 측정

export function kpiModeOf(kr: KrCalc): KpiMode {
  if (kr.aggregation === 'AVG') return 'avg';
  if (kr.aggregation === 'SUM') return 'sum';
  if (kr.aggregation === 'LAST') return 'last';
  if (kr.aggregation === 'PROGRESS') return 'progress'; // 매월 진척율 입력 — 최신값을 목표에 그대로 대비(안분 없음)
  return isRateKr(kr) ? 'avg' : 'sum';
}

export function achPct(kr: KrCalc, v: number | null | undefined, t?: number | null): number | null {
  const target = t === undefined ? kr.target : t;
  if (v == null || target == null) return null;
  let pct: number;
  if (kr.direction === 'AT_MOST') {
    if (v <= 0) return 100;
    if (target === 0) return 0;
    pct = (target / v) * 100;
  } else {
    if (target === 0) return null;
    pct = (v / target) * 100;
  }
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
}

// 그 달(monthIdx: 0~11) 입력값에 대한 유효 목표 — avg: 목표 그대로 · sum: ÷12 · last: ×경과월/12
export function monthTargetOf(kr: KrCalc, monthIdx: number): number | null {
  if (kr.target == null) return null;
  const mode = kpiModeOf(kr);
  if (mode === 'sum') return Math.round((kr.target / 12) * 100) / 100;
  if (mode === 'last') return Math.round(kr.target * ((monthIdx + 1) / 12) * 100) / 100;
  return kr.target; // avg·progress: 목표 그대로
}

export function monthAchPct(kr: KrCalc, v: number | null | undefined, monthIdx: number): number | null {
  return achPct(kr, v, monthTargetOf(kr, monthIdx));
}

// periodStart(UTC)를 KST 기준 월 인덱스(0~11)/연도로 — UTC 문자열 slice로 월 비교 금지
export function kstMonthIdx(d: Date | string): number {
  return new Date(new Date(d).getTime() + 9 * 3600000).getUTCMonth();
}
export function kstYear(d: Date | string): number {
  return new Date(new Date(d).getTime() + 9 * 3600000).getUTCFullYear();
}

// 최신 상태 판정 — entries는 createdAt desc(월별 첫 항목=그 달 최신값).
// avg: 최신값 vs 목표 · last: 최신값 vs 안분목표 · sum: 최신입력 연도의 월별값 누적합 vs 안분목표
export function kpiStatFromEntries(
  kr: KrCalc,
  entries: Array<{ periodStart: Date | string; krValue: number | null }>,
): { latestValue: number | null; pct: number | null; status: 'OK' | 'WARN' | 'NONE' } {
  const first = entries.find((e) => e.krValue != null);
  if (!first) return { latestValue: null, pct: null, status: 'NONE' };
  const latestValue = first.krValue as number;
  const mode = kpiModeOf(kr);
  let pct: number | null;
  if (mode === 'avg' || mode === 'progress') {
    pct = achPct(kr, latestValue); // progress: 최신 진척율을 목표에 그대로 대비
  } else {
    const mIdx = kstMonthIdx(first.periodStart);
    if (mode === 'last') {
      pct = achPct(kr, latestValue, monthTargetOf(kr, mIdx));
    } else {
      // sum: 최신 입력 연도의 월별 최신값을 합산해 경과월 안분 목표에 대비
      const year = kstYear(first.periodStart);
      const byMonth = new Map<number, number>();
      for (const e of entries) {
        if (e.krValue == null) continue;
        if (kstYear(e.periodStart) !== year) continue;
        const m = kstMonthIdx(e.periodStart);
        if (!byMonth.has(m)) byMonth.set(m, e.krValue); // desc → 첫 값이 그 달 최신
      }
      let sum = 0, maxM = 0;
      for (const [m, v] of byMonth) { sum += v; if (m > maxM) maxM = m; }
      const cumTarget = kr.target == null ? null : Math.round(kr.target * ((maxM + 1) / 12) * 100) / 100;
      pct = achPct(kr, sum, cumTarget);
    }
  }
  const status: 'OK' | 'WARN' | 'NONE' = pct == null ? 'NONE' : pct >= 100 ? 'OK' : 'WARN';
  return { latestValue, pct, status };
}
