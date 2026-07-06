/**
 * 조직도 계층 권한 헬퍼.
 *
 * 규칙: 조직도상 상위 조직에 있는 사람은 하위 조직의 KPI/OKR을 입력·수정할 수 있다.
 * 대상 팀에서 parentId를 따라 올라가며
 *  (a) 사용자의 소속 조직(orgUnitId)이 대상의 '조상' 조직이거나  ← 핵심 규칙
 *  (b) 대상 팀 또는 어느 조상 조직의 책임자(OrgUnit.managerId)로 등록돼 있으면
 * 관리 권한이 있다고 판정한다. 직급/역할 무관 — 조직도만 맞으면 인사이동에도 자동 추종.
 */
export async function isAncestorOrgManager(
  prisma: any,
  user: { id: string; role?: any; orgUnitId?: string | null } | null | undefined,
  targetOrgUnitId?: string | null,
): Promise<boolean> {
  if (!user?.id || !targetOrgUnitId) return false;
  let curId: string | null = String(targetOrgUnitId);
  for (let hop = 0; curId && hop < 10; hop += 1) {
    const cur: { id: string; parentId: string | null; managerId: string | null } | null =
      await prisma.orgUnit.findUnique({ where: { id: curId }, select: { id: true, parentId: true, managerId: true } });
    if (!cur) break;
    if (cur.managerId === user.id) return true; // 대상 팀(hop 0) 또는 조상 조직의 책임자
    if (hop > 0 && !!user.orgUnitId && cur.id === user.orgUnitId) return true; // 상위 조직 소속이면 하위 조직 관리 가능
    curId = cur.parentId;
  }
  return false;
}
