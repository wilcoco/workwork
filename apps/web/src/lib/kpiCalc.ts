// KPI 달성률 공용 계산 — 모든 화면이 같은 규칙을 쓰도록 여기서만 정의한다.
// 집계 방식(aggregation): AVG=월별 독립 측정, SUM=월별 발생량 합산, LAST=누계값 직접 입력. null=단위로 자동추정(%·율=AVG).
// 목표(target)는 연간 목표가 기준 — 합산·누계형의 월/누적 달성률은 경과월로 안분한 목표에 대비한다.

export type KrCalc = {
  unit?: string | null;
  target?: number | null;
  direction?: 'AT_LEAST' | 'AT_MOST' | string | null;
  aggregation?: 'AVG' | 'SUM' | 'LAST' | string | null;
};
export type KpiMode = 'avg' | 'sum' | 'last';

export const isRateKr = (kr: KrCalc) => /[%율]|ppm/i.test(String(kr.unit || '')); // 비율성 단위(%·율·PPM)=월별 독립 측정

export function kpiModeOf(kr: KrCalc): KpiMode {
  if (kr.aggregation === 'AVG') return 'avg';
  if (kr.aggregation === 'SUM') return 'sum';
  if (kr.aggregation === 'LAST') return 'last';
  return isRateKr(kr) ? 'avg' : 'sum';
}

// direction 반영 달성률: 값 v를 목표 t(생략 시 kr.target)에 대비
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

// 그 달(monthIdx: 0~11) 입력값에 대한 유효 목표
// avg: 목표 그대로 · sum: 연간목표÷12 · last: 연간목표×경과월/12(입력값이 연초부터의 누계이므로)
export function monthTargetOf(kr: KrCalc, monthIdx: number): number | null {
  if (kr.target == null) return null;
  const mode = kpiModeOf(kr);
  if (mode === 'sum') return Math.round((kr.target / 12) * 100) / 100;
  if (mode === 'last') return Math.round(kr.target * ((monthIdx + 1) / 12) * 100) / 100;
  return kr.target;
}

export function monthAchPct(kr: KrCalc, v: number | null | undefined, monthIdx: number): number | null {
  return achPct(kr, v, monthTargetOf(kr, monthIdx));
}

// 누적(연초~uptoIdx) 기대 목표 — avg: 목표 그대로, sum·last: 연간목표×경과월/12
export function cumTargetOf(kr: KrCalc, uptoIdx: number): number | null {
  if (kr.target == null) return null;
  if (kpiModeOf(kr) === 'avg') return kr.target;
  return Math.round(kr.target * ((uptoIdx + 1) / 12) * 100) / 100;
}

// 선택월까지의 누적값. 입력 없는 달은 제외.
export function cumValueOf(kr: KrCalc, monthly: (number | null)[] | undefined, uptoIdx: number): { value: number | null; months: number; mode: KpiMode } {
  const mode = kpiModeOf(kr);
  const vals: number[] = [];
  let last: number | null = null;
  for (let i = 0; i <= uptoIdx; i++) {
    const v = monthly?.[i];
    if (v != null) { vals.push(v); last = v; }
  }
  if (!vals.length) return { value: null, months: 0, mode };
  if (mode === 'last') return { value: last, months: vals.length, mode };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { value: mode === 'avg' ? Math.round((sum / vals.length) * 100) / 100 : Math.round(sum * 100) / 100, months: vals.length, mode };
}

export function cumAchPct(kr: KrCalc, monthly: (number | null)[] | undefined, uptoIdx: number): number | null {
  const c = cumValueOf(kr, monthly, uptoIdx);
  if (c.value == null) return null;
  return achPct(kr, c.value, cumTargetOf(kr, uptoIdx));
}

// periodStart(UTC ISO)를 KST 기준 월 인덱스(0~11)로 — UTC 문자열 slice로 월 비교 금지
export function kstMonthIdx(iso: string | Date): number {
  return new Date(new Date(iso).getTime() + 9 * 3600000).getUTCMonth();
}
