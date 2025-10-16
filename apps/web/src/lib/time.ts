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
