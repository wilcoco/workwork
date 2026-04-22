# Planner Premium (Project for the Web) 리버스 엔지니어링 기록

> **작성일**: 2026-04-22  
> **대상 기능**: 업무일지 → Planner 태스크 동기화 (설명 업데이트 + 진행률 + 첨부 파일)  
> **문제**: Microsoft가 Planner Premium 태스크에 대해 Graph API `PATCH` 를 전면 차단. 공식 우회 경로 없음.  
> **현재 상태**: ✅ 동작 중 (Dataverse Project for the Web 내부 SDK 액션을 직접 호출하여 우회)

이 문서는 **Microsoft가 현재 경로를 차단했을 때 재조사/복구를 빠르게 하기 위한** 핵심 참조 문서입니다.

---

## 1. 문제 정의

### Microsoft가 차단한 경로
| 엔드포인트 | Premium 응답 | 코드 위치 |
|---|---|---|
| `GET /planner/tasks/{id}/details` | **403** "You do not have the required permissions" | `graph-tasks.controller.ts` syncWorklog 초입 |
| `PATCH /planner/tasks/{id}/details` (description) | **403** 동일 | 동일 |
| `PATCH /planner/tasks/{id}/details` (references) | **403** 동일 | `patchPlannerReferences()` |

Graph API만 막혔고 **Dataverse Web API (Project for the Web 내부 저장소) 는 살아있음**. Planner Premium UI는 실제로 Dataverse에서 데이터를 읽어 렌더링하므로, Dataverse에 직접 쓰면 UI에 반영됨.

---

## 2. 발견한 Dataverse 스키마

### 핵심 엔티티
| LogicalName | 용도 | EntitySet |
|---|---|---|
| `msdyn_project` | Planner plan ↔ Project for the Web 프로젝트 매칭 | `msdyn_projects` |
| `msdyn_projecttask` | Planner task ↔ Dataverse task 매칭 | `msdyn_projecttasks` |
| `msdyn_projecttaskattachment` | **Planner UI "첨부 파일" 영역 원본 데이터** | `msdyn_projecttaskattachments` |

### `msdyn_projecttaskattachment` 필수 필드 (스키마 리버스 결과)
```json
{
  "msdyn_projecttaskattachmentid": "<new GUID>",     // randomUUID()
  "msdyn_name": "파일명.xlsx",                        // 표시 이름
  "msdyn_linkuri": "https://...",                    // OneDrive/SharePoint URL
  "msdyn_linktype": "Excel",                         // PowerPoint|Word|Excel|Pdf|OneNote|Video|Image|Other
  "msdyn_Task@odata.bind": "/msdyn_projecttasks(<taskGuid>)"  // ★ Nav prop PascalCase
}
```

**⚠️ 주의점**:
- `msdyn_task` (소문자) = 컬럼 로지컬명 → 400 에러
- `msdyn_Task` (PascalCase) = navigation property → ✅ 정답
- 관계 스키마명 `msdyn_msdyn_projecttask_msdyn_projecttaskattachment_Task` 의 끝 `_Task`

### Planner Plan ↔ Dataverse Project 매칭 로직
1. Graph API로 `/planner/tasks/{id}` 호출 → `planId`, `title` 획득
2. Graph API로 `/planner/plans/{planId}` → plan `title`
3. Dataverse: `msdyn_projects` 에서 `msdyn_subject eq '<plan title>'` 로 매칭
4. Dataverse: `msdyn_projecttasks` 에서 `msdyn_subject eq '<task title>' and _msdyn_project_value eq <projectId>` 로 매칭
5. 부모 breadcrumb: `_msdyn_parenttask_value` 체인을 재귀로 따라감

**위험**: 같은 제목의 plan/task가 여러 개면 식별 불가 → 현재 코드는 `length > 1` 이면 throw.

---

## 3. 쓰기 경로: OperationSet + PSS SDK 액션

### Direct POST/PATCH 차단됨
```
Code: 0x80040265
Message: You cannot directly do '{Create|Update}' operation to '{entity}'.
         Try editing it through the Resource editing UI via Project.
```
→ **PSS (Project Scheduling Service) 플러그인이 가드**하여 반드시 OperationSet 경유 필요.

### 성공한 3단계 플로우

| 단계 | SDK 액션 | Body |
|---|---|---|
| 1. OpSet 생성 | `msdyn_CreateOperationSetV1` | `{ ProjectId, Description }` |
| 2a. 태스크 업데이트 | `msdyn_PssUpdateV2` | `{ OperationSetId, EntityCollection: [taskEntity] }` |
| 2b. 첨부 생성 | `msdyn_PssCreateV2` ★ | `{ OperationSetId, EntityCollection: [attachmentEntity, ...] }` |
| 3. 커밋 | `msdyn_ExecuteOperationSetV1` | `{ OperationSetId }` |

**⚠️ 매우 중요 – PssUpdateV2 vs PssCreateV2**:
- `PssUpdateV2`: **UPDATE-only**. 신규 GUID 넣으면 `"The row with Id ... does not exist"` 에러.
- `PssCreateV2`: **Create 전용**. 새 GUID를 생성자로 받아 신규 레코드로 삽입.
- 반드시 **분리해서 호출** 해야 하며, 같은 OperationSet 안에서 순차 호출 후 단일 Execute로 커밋.

### Entity Collection 내부 payload 포맷
```json
{
  "@odata.type": "Microsoft.Dynamics.CRM.<logicalName>",
  "<primaryKeyField>": "<GUID>",
  "<field1>": "<value>",
  "<navProp>@odata.bind": "/<entitySetName>(<GUID>)"
}
```

### Impersonation 규칙 (MSCRMCallerID 헤더)
| 호출자 | 권한 요구 | 현재 구현 |
|---|---|---|
| `createOperationSet` / `pssUpdate` / `pssCreate` | `prvCreatemsdyn_operationset` | `creatorCallerId` (요청 사용자 systemuser) |
| `executeOperationSet` | **Project Plan 라이선스** | `executorCallerId` = `DATAVERSE_EXECUTOR_EMAIL` 환경변수 사용자 |

환경변수 `DATAVERSE_EXECUTOR_EMAIL` 이 없으면 요청 사용자로 폴백. 하지만 대부분의 사용자는 Project Plan 라이선스가 없어서 서비스 계정 필요.

---

## 4. 현재 코드 맵 (재조사 시 시작점)

| 파일 | 함수 | 역할 |
|---|---|---|
| `apps/api/src/graph-tasks.controller.ts` | `syncWorklog` | Graph 시도 → 403 시 Dataverse fallback 진입 |
| | `syncViaDataverse` | Plan/Task 매칭 + OperationSet 플로우 오케스트레이션 |
| | `inferLinkType` | 파일 확장자 → `msdyn_linktype` 매핑 |
| | `patchPlannerReferences` | 일반 Planner (non-Premium) 첨부 처리 |
| `apps/api/src/dataverse.service.ts` | `findProjectsBySubject` / `findProjectTasksBySubject` | plan/task 매칭 쿼리 |
| | `createOperationSet` | `msdyn_CreateOperationSetV1` 호출 |
| | `pssUpdate` | `msdyn_PssUpdateV2` |
| | `pssCreate` | `msdyn_PssCreateV2` ← 첨부 Create 핵심 |
| | `executeOperationSet` | `msdyn_ExecuteOperationSetV1` |
| | `updateProjectTaskViaOperationSet` | Update + Create + Execute 묶음 |
| | `buildTaskParentChain` | `_msdyn_parenttask_value` 체인 재귀 |

---

## 5. 진단 엔드포인트 (리버스 재개용 – **삭제 금지**)

Microsoft가 스키마나 액션 시그니처를 바꿨을 때 이 엔드포인트들로 빠르게 재탐색 가능.

| 엔드포인트 | 용도 |
|---|---|
| `GET /api/graph-tasks/dataverse-entities?q=<keyword>` | LogicalName에 키워드 포함된 테이블 검색 |
| `GET /api/graph-tasks/dataverse-entity-attrs?entity=<logical>` | 테이블의 모든 컬럼 + 타입 + 필수 여부 |
| `GET /api/graph-tasks/dataverse-table-sample?entity=<logical>&top=3` | 실제 데이터 샘플 (스키마 이해 최속) |
| `GET /api/graph-tasks/dataverse-relationships?entity=<logical>` | 1:N / N:N 관계 → 자식 테이블/nav prop 발견 |
| `GET /api/graph-tasks/dataverse-actions?filter=<prefix>` | SDK 메시지(custom action) 목록 |
| `GET /api/graph-tasks/dataverse-action-params?name=<action>` | 특정 액션의 파라미터 시그니처 |
| `GET /api/graph-tasks/dataverse-test?plannerTaskId=&email=&subject=` | 전체 플로우 dry-run |

이 엔드포인트들은 모두 `@Public()` (auth 불필요) — **운영 환경에선 IP 제한 권장**. 현재는 편의상 오픈.

---

## 6. 리버스 엔지니어링 방법론 (막혔을 때 따라할 순서)

1. **에러 메시지 분석**: `0x80040265` = PSS guard, 403 = Graph 차단, 400 `undeclared property` = OData 문법
2. **SDK 액션 검색**: `dataverse-actions?filter=Pss` 또는 `?filter=Create` 또는 관련 키워드
3. **엔티티 검색**: `dataverse-entities?q=<관련단어>` 로 테이블명 발견
4. **관계 매핑**: `dataverse-relationships?entity=<부모>` 로 자식 테이블 + nav prop 이름 획득
5. **스키마 파악**: `dataverse-entity-attrs` + `dataverse-table-sample` 병행 사용
6. **실제 데이터 1건 수동 생성 후 샘플 조회**: UI에서 직접 만든 뒤 `dataverse-table-sample` 로 필드값 관찰 → 필수 필드 + 값 포맷 확정
7. **Power Automate / Project 웹앱 F12**: 네트워크 탭에서 Microsoft 공식 UI가 보내는 요청을 관찰 → 가장 확실한 정답

---

## 7. Microsoft가 막을 가능성과 대응

### 가능성 높은 차단 시나리오
| 시나리오 | 증상 | 대응 |
|---|---|---|
| `msdyn_PssCreateV2` Application User 차단 | 액션 호출 시 401/403 | 인터랙티브 사용자 토큰으로 호출 (delegated) |
| `msdyn_projecttaskattachment` direct Create 플러그인 추가 | `0x80040265` Create blocked | 이미 경험 — PssCreateV2 로 우회 중 |
| Nav prop 이름 변경 | 400 undeclared property | `dataverse-relationships` 로 재확인 |
| `V2` deprecate → `V3` 출시 | 404 action not found | `dataverse-actions` 로 새 버전 찾기 |
| 새 필수 컬럼 추가 | 400 missing required field | `dataverse-entity-attrs` 에서 `required: ApplicationRequired` 확인 |

### 완전 차단 시 최후 대체안 (현재 코드에 일부 남아있음)
- **description 텍스트에 `📎 파일명: URL` 삽입**: Planner 기본 UI는 URL을 자동 하이퍼링크. Premium UI는 **자동 링크 안 됨** (텍스트로만 보임).
- 체크리스트 항목에 URL 삽입: 시도 안 해봄. 가능성 있음.
- Teams 채널 "파일" 탭 링크: 태스크 단위 아님 (프로젝트 전체).

---

## 8. 모니터링 권장사항

1. **에러율 추적**: 
   - `[sync-worklog] description PATCH failed` 빈도
   - `[sync-dataverse] attachment create failed` 빈도
2. **정기 헬스체크** (예: 주 1회):
   ```bash
   curl .../api/graph-tasks/dataverse-actions?filter=Pss
   # PssCreateV2, PssUpdateV2 가 목록에 있는지 확인
   ```
3. **Microsoft Roadmap 모니터링**: 
   - https://www.microsoft.com/ko-kr/microsoft-365/roadmap (Planner / Project)
   - "Graph API" + "Planner Premium" 키워드 주기적 검색

---

## 9. 타임라인 (진행 기록)

- **2026-04-22 오후**: Graph API 403 확인 (description + references 양쪽)
- 동일일: Dataverse fallback 구현 (description only)
- 동일일: `msdyn_projecttaskattachment` 테이블 식별
- 동일일: direct POST → `0x80040265` (PSS guard) 발견
- 동일일: `msdyn_PssUpdateV2` 시도 → UPDATE-only 확인
- 동일일: **`msdyn_PssCreateV2` 발견 → 성공** ✅

---

## 10. 핵심 커밋 레퍼런스

| 커밋 | 내용 |
|---|---|
| `e5a516c` | 진단 엔드포인트 추가 (entity-attrs, table-sample) |
| `16bdf9c` | msdyn_projecttaskattachment 직접 POST 시도 (실패 — PSS guard) |
| `37e79fc` | `msdyn_Task` PascalCase nav prop 수정 |
| `fd5a899` | Graph GET /details 403 시 Dataverse fallback 자동 진입 |
| `a60cf4c` | **`msdyn_PssCreateV2` 로 분리 → 최종 성공** ✅ |
