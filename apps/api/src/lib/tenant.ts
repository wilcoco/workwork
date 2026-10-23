/**
 * 테넌트 설정 접근자 — 회사별로 달라지는 값을 TenantSetting 테이블에서 읽고(60초 캐시) 없으면 기본값(캠스 초기값)을 쓴다.
 * DI 없이 prisma 인스턴스를 받아 쓰므로 어느 컨트롤러에서나 호출 가능.
 */
export const TENANT_DEFAULTS: Record<string, any> = {
  'company.name': '주식회사 캠스',
  'company.locale': 'ko-KR',
  'accounts.hiddenUserIds': ['cmouna6bf01w0xjhgf6imupg5', 'cmoknhiqj0av02rtgo5eou86t'], // 조직도 미배정 활성 계정 — 목록·명단에서만 숨김(삭제 금지)
  'accounts.hiddenNames': ['김정중', '김선구'],
  'logistics.defaultFinalApprovers': ['윤대룡', '최연상'],
  'ai.defaultProvider': 'claude',
  'features': { oracleAgent: true, sharepointImport: true, camsAttachments: true, odoo: false, kpiQuiz: true, agenda: true, knowledgeCards: true },
  'onboarding.completedSteps': [],
};
export const TENANT_KEYS = Object.keys(TENANT_DEFAULTS);
export const TENANT_KEY_LABELS: Record<string, string> = {
  'company.name': '회사명', 'company.locale': '언어·지역', 'accounts.hiddenUserIds': '명단에서 숨길 계정 ID', 'accounts.hiddenNames': '명단에서 숨길 이름',
  'logistics.defaultFinalApprovers': '물류 배차 기본 최종 결재자(이름)', 'ai.defaultProvider': 'AI 기본 공급자(claude|openai)', 'features': '기능 플래그', 'onboarding.completedSteps': '온보딩 완료 단계',
};

const cache = new Map<string, { v: any; at: number }>();
const TTL = 60 * 1000;

export async function tenantGet<T = any>(prisma: any, key: string): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.v as T;
  let v: any = TENANT_DEFAULTS[key];
  try {
    const row = await prisma.tenantSetting.findUnique({ where: { key } });
    if (row) v = row.value;
  } catch { /* 테이블 없음 등 → 기본값 */ }
  cache.set(key, { v, at: Date.now() });
  return v as T;
}

export async function tenantGetAll(prisma: any): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const k of TENANT_KEYS) out[k] = await tenantGet(prisma, k);
  return out;
}

export async function tenantSet(prisma: any, key: string, value: any, updatedById?: string | null) {
  await prisma.tenantSetting.upsert({ where: { key }, create: { key, value, updatedById: updatedById || null }, update: { value, updatedById: updatedById || null } });
  cache.set(key, { v: value, at: Date.now() });
}

export function tenantInvalidate() { cache.clear(); }

export async function hiddenUserIds(prisma: any): Promise<string[]> { const v = await tenantGet<string[]>(prisma, 'accounts.hiddenUserIds'); return Array.isArray(v) ? v.map(String) : []; }
export async function hiddenUserNames(prisma: any): Promise<string[]> { const v = await tenantGet<string[]>(prisma, 'accounts.hiddenNames'); return Array.isArray(v) ? v.map(String) : []; }
export async function featureOn(prisma: any, name: string): Promise<boolean> { const f = await tenantGet<Record<string, boolean>>(prisma, 'features'); return !!(f && f[name]); }
