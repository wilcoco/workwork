/**
 * 조직도 계층 권한 헬퍼.
 *
 * 규칙: 상위 조직(실/본부)의 책임자는 산하 모든 팀의 KPI/OKR을 입력·수정할 수 있다.
 * 대상 팀에서 parentId를 따라 올라가며
 *  (a) 대상 팀 또는 어느 조상 조직의 책임자(OrgUnit.managerId)이거나
 *  (b) 임원(EXEC)이면서 어느 '조상' 조직 소속이면 (managerId 등록이 안 된 이사 커버)
 * 관리 권한이 있다고 판정한다. 조직도만 맞으면 인사이동에도 자동 추종된다.
 */
export async function isAncestorOrgManager(
  prisma: any,
  user: { id: string; role?: any; orgUnitId?: string | null } | null | undefined,
  targetOrgUnitId?: string | null,
): Promise<boolean> {
  if (!user?.id || !targetOrgUnitId) return false;
  const isExec = String(user.role || '').toUpperCase() === 'EXEC';
  let curId: string | null = String(targetOrgUnitId);
  for (let hop = 0; curId && hop < 10; hop += 1) {
    const cur: { id: string; parentId: string | null; managerId: string | null } | null =
      await prisma.orgUnit.findUnique({ where: { id: curId }, select: { id: true, parentId: true, managerId: true } });
    if (!cur) break;
    if (cur.managerId === user.id) return true; // 대상 팀(hop 0) 또는 조상 조직의 책임자
    if (hop > 0 && isExec && !!user.orgUnitId && cur.id === user.orgUnitId) return true; // 임원이 조상 조직 소속
    curId = cur.parentId;
  }
  return false;
}
