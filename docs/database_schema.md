# Database Schema

## 개요

PostgreSQL + Prisma ORM 기반. `apps/api/prisma/schema.prisma`에 정의.
총 **30+ 모델**, 핵심은 OKR 계층, 프로세스 실행, 업무 매뉴얼 3개 도메인.

## 핵심 테이블 관계도

```
User ──┬── Objective ── KeyResult ── Initiative ── Worklog
       │                    │
       │                    └── KeyResultAssignment
       │
       ├── WorkManual (업무 매뉴얼)
       │
       ├── ProcessTemplate ── ProcessTaskTemplate
       │         │
       │         └── ProcessInstance ── ProcessTaskInstance
       │
       ├── ApprovalRequest ── ApprovalStep
       ├── HelpTicket
       ├── Delegation
       └── Notification
```

## 1. 사용자/조직

### User
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| email | String (unique) | 이메일 |
| name | String | 이름 |
| role | Role (CEO/EXEC/MANAGER/INDIVIDUAL/EXTERNAL) | 역할 |
| status | UserStatus (PENDING/ACTIVE) | 계정 상태 |
| orgUnitId | String? | 소속 조직 FK |
| teamsUpn | String? (unique) | MS Teams UPN |
| entraOid | String? (unique) | Entra ID 오브젝트 ID |
| passwordHash | String? | 비밀번호 해시 |

### OrgUnit
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| name | String | 조직명 |
| type | String | 유형 (부서/팀 등) |
| parentId | String? | 상위 조직 FK (자기참조) |
| managerId | String? | 관리자 User FK |

**관계**: OrgUnit ↔ OrgUnit (계층), OrgUnit → User (1:N), OrgUnit → User.manager (1:1)

## 2. OKR 목표관리

### Objective
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| title | String | 목표명 |
| ownerId | String | 소유자 FK |
| orgUnitId | String | 소속 조직 FK |
| status | ObjectiveStatus (DRAFT/ACTIVE/LOCKED/ARCHIVED) | 상태 |
| alignsToKrId | String? | 상위 KR에 정렬 FK |
| parentId | String? | 상위 Objective FK (자기참조) |
| periodStart/End | DateTime | 기간 |
| pillar | Pillar? (Q/C/D/DEV/P) | 분류 |

### KeyResult
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| objectiveId | String | Objective FK |
| title | String | KR 제목 |
| metric | String | 측정 지표 |
| target | Float | 목표값 |
| unit | String | 단위 |
| type | KeyResultType (PROJECT/OPERATIONAL) | 유형 |
| ownerId | String | 소유자 FK |

**관계**: Objective 1:N KeyResult, KeyResult 1:N Initiative, Objective ↔ KeyResult (정렬)

### Initiative
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| keyResultId | String | KR FK |
| title | String | 과제명 |
| state | InitiativeState (PLANNED/ACTIVE/BLOCKED/DONE/CANCELLED) | 상태 |
| type | InitiativeType (PROJECT/OPERATIONAL) | 유형 |
| ownerId | String | 담당자 FK |
| parentId | String? | 상위 Initiative FK (자기참조) |

## 3. 업무일지

### Worklog
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| initiativeId | String | Initiative FK |
| date | DateTime | 작업일 |
| progressPct | Int | 진행률 (0~100) |
| timeSpentMinutes | Int | 소요 시간 (분 단위, UI는 시간+10분 단위) |
| note | String? | 내용 (HTML) |
| createdById | String | 작성자 FK |
| visibility | WorklogVisibility | 공개 범위 |
| processTaskInstanceId | String? | 프로세스 태스크 연결 FK |

**인덱스**: date, createdAt, createdById+date, visibility+date

## 4. 업무 매뉴얼

### WorkManual
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| userId | String | 소유자 FK |
| title | String | 매뉴얼 제목 |
| content | String? | 매뉴얼 본문 (DSL 포맷) |
| authorName | String | 작성자명 |
| authorTeamName | String | 작성자 팀명 |
| version | Int | 버전 (자동 증가) |
| versionUpAt | DateTime | 버전 업데이트 시간 |

**인덱스**: userId, updatedAt, versionUpAt

**DSL 포맷 예시**:
```
### STEP S1 | 도면 검토
- taskType: WORKLOG
- 목적: 설계 도면 정합성 확인
- 담당자: 생산기술팀 대리
- 입력/필요자료(파일·양식·링크):
  - 설계 도면 (OneDrive 링크)
- 산출물:
  - 검토 보고서
- 완료조건:
  - 도면 오류 0건
```

## 5. 프로세스 관리

### ProcessTemplate
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| title | String | 템플릿명 |
| type | ProcessType (RECURRING/PROJECT) | 유형 |
| visibility | ProcessVisibility (PUBLIC/ORG_UNIT/PRIVATE) | 공개 범위 |
| ownerId | String | 소유자 FK |
| bpmnJson | Json? | BPMN 다이어그램 JSON (nodes/edges) |
| status | String | 상태 (ACTIVE/DRAFT) |
| official | Boolean | 공식 프로세스 여부 |

### ProcessTaskTemplate
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| processTemplateId | String | 템플릿 FK |
| name | String | 태스크명 |
| taskType | TaskType (WORKLOG/APPROVAL/COOPERATION/TASK) | 유형 |
| orderHint | Int | 순서 |
| predecessorIds | String? | 선행 태스크 ID (쉼표 구분) |
| predecessorMode | String? | 'ALL' (기본) 또는 'ANY' (XOR join) |
| xorGroupKey | String? | XOR 게이트웨이 그룹 키 |
| xorCondition | String? | XOR 분기 조건식 |
| assigneeHint | String? | 담당자 힌트 |
| approvalRouteType | ApprovalRouteType? | 결재선 유형 |
| deadlineOffsetDays | Int? | 기한 (시작일 기준 +N일) |
| slaHours | Int? | SLA 시간 |
| emailToTemplate | String? | 이메일 수신자 템플릿 |
| worklogTemplateHint | String? | 업무일지 힌트 |

### ProcessInstance
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| templateId | String | 템플릿 FK |
| title | String | 인스턴스명 |
| startedById | String | 시작자 FK |
| status | String | 'ACTIVE'/'COMPLETED'/'SUSPENDED'/'ABORTED' |
| itemCode | String? | 품번 |
| moldCode | String? | 금형 번호 |
| carModelCode | String? | 차종 코드 |
| initiativeId | String? | Initiative 연결 FK |

### ProcessTaskInstance
| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| instanceId | String | ProcessInstance FK |
| taskTemplateId | String | ProcessTaskTemplate FK |
| name | String | 태스크명 |
| taskType | TaskType | 유형 |
| status | String | NOT_STARTED/READY/IN_PROGRESS/COMPLETED/SKIPPED/CHAIN_WAIT |
| assigneeId | String? | 담당자 FK |
| deadlineAt | DateTime? | 기한 |
| worklogId | String? | 업무일지 연결 |
| approvalRequestId | String? | 결재 연결 |
| cooperationId | String? | 협조 연결 |

## 6. 결재/협조

### ApprovalRequest + ApprovalStep
- 결재 요청 → 다단계 순차 결재 (ApprovalStep.stepNo)
- 상태: PENDING/APPROVED/REJECTED/EXPIRED

### HelpTicket
- 업무 요청 (OPEN → ACCEPTED → IN_PROGRESS → DONE)

### Delegation
- 업무 위임 (PENDING → ACCEPTED → ACTIVE → DONE)

## 7. 기준정보 (Master Data)

| 모델 | 설명 |
|------|------|
| Item | 품번 |
| Mold | 금형 |
| CarModel | 차종 |
| Supplier | 협력사 |
| Equipment | 장비 |
| Car | 법인차량 |
| Holiday | 공휴일/휴무일 |

## Enum 정리

| Enum | 값 |
|------|-----|
| Role | CEO, EXEC, MANAGER, INDIVIDUAL, EXTERNAL |
| TaskType | WORKLOG, APPROVAL, COOPERATION, TASK |
| ProcessType | RECURRING, PROJECT |
| ProcessVisibility | PUBLIC, ORG_UNIT, PRIVATE |
| ApprovalRouteType | ORG_CHART, ROLE_BASED, CUSTOM_USERS |
| InitiativeState | PLANNED, ACTIVE, BLOCKED, DONE, CANCELLED |
| WorklogVisibility | ALL, MANAGER_PLUS, EXEC_PLUS, CEO_ONLY |
