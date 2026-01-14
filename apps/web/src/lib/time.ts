export const KST_TZ = 'Asia/Seoul';

export function formatKstDatetime(input: string | number | Date, opts: Intl.DateTimeFormatOptions = {}) {
  const d = new Date(input);
  const base: Intl.DateTimeFormatOptions = {
    timeZone: KST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  return new Intl.DateTimeFormat('ko-KR', { ...base, ...opts }).format(d);
}

export function todayKstYmd(): string {
  const now = new Date();
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function formatMinutesAsHmKo(totalMinutes: number): string {
  const m0 = Number(totalMinutes) || 0;
  const sign = m0 < 0 ? '-' : '';
  const m = Math.abs(m0);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${sign}${mm}분`;
  if (mm === 0) return `${sign}${h}시간`;
  return `${sign}${h}시간 ${mm}분`;
}
