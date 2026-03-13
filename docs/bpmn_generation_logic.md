# BPMN Generation Logic

## 개요

업무 매뉴얼(자연어/DSL)을 AI가 분석하여 BPMN JSON으로 변환하고,
이를 ProcessTemplate + ProcessTaskTemplate으로 컴파일하여 실행 가능한 프로세스를 생성합니다.

## 전체 파이프라인

```
┌─────────────────────────────────────────────────────────────────┐
│                    Work Manual Editor (3-Phase)                   │
├─────────────┬─────────────────────┬─────────────────────────────┤
│  Phase 1    │      Phase 2        │         Phase 3              │
│  자유형 작성  │  AI 분석 + 구조화     │  BPMN 생성                   │
│             │                     │                              │
│  텍스트 입력  → AI 질문 생성         → AI BPMN JSON 생성            │
│  AI 템플릿   → 답변 반영            → ProcessTemplate 생성         │
│             → AI STEP 초안         → ProcessTaskTemplate[] 생성   │
│             → 구조화 편집           → BPMN 에디터로 이동             │
└─────────────┴─────────────────────┴─────────────────────────────┘
```

## 1. DSL (Domain Specific Language) 포맷

업무 매뉴얼은 다음 DSL 포맷으로 구조화됩니다:

```
### STEP S1 | 단계 제목
- taskType: WORKLOG|APPROVAL|COOPERATION
- 목적: 이 단계의 목표
- 담당자: 역할/팀명
- 작업방법: 구체적 수행 절차
- 입력/필요자료(파일·양식·링크):
  - 도면 (OneDrive 링크)
  - 시방서
- 도구: 필요한 도구, 장비, IT 시스템
- 관련문서: 도면번호, 작업표준서
- 산출물:
  - 검토 보고서
- 확인사항: 품질/안전/규정 확인 항목
- 업무일지(필수):
  - 기록할 내용:
    - 검사 수량, 불량 내용
- 완료조건:
  - 도면 오류 0건
- 연락처: 내부/외부 연락처
- 위험대응: 이상 발생 시 조치
- 협력사: 협력사명
- 협력사담당자: 이름/연락처
- 내부협조: 협조 부서/인원
- 결재선: SEQUENTIAL|PARALLEL|ANY_ONE
- 결재역할: 팀장, 부장
- 이메일수신: 수신자
- 이메일CC: CC
- 이메일제목: 템플릿
- 이메일내용: HTML 본문
- 기한: 3 (시작일+3일)
- SLA: 24 (24시간)
- 분기:
  - 승인: last.approval.status == 'APPROVED' -> S3
  - 반려: last.approval.status == 'REJECTED' -> S4
```

## 2. DSL 파서/시리얼라이저

### 파싱 (Text → StepFormData[])

위치: `apps/web/src/components/StepFormEditor.tsx`

```
parseStepsFromText(text)        → { stepId, title, raw }[]
parseTextToStepForms(text)      → StepFormData[]
```

파싱 로직:
1. `### STEP S1 | 제목` 패턴으로 블록 분할
2. 각 블록에서 `- 필드명: 값` 패턴으로 필드 추출
3. 중첩 리스트 (`  - 항목`) 처리
4. 분기 (`-> S3`) 파싱 → BranchItem[]
5. 품질검사/안전점검 → checkItems로 통합

### 시리얼라이즈 (StepFormData[] → Text)

```
serializeStepsToText(steps)     → string (DSL 텍스트)
```

시리얼라이즈 규칙:
- 빈 필드는 생략
- 리스트 필드 (inputs, outputs 등)는 쉼표로 분리 → 각각 `  - 항목`으로 출력
- branches → `  - 라벨: 조건 -> 대상STEP`

## 3. 매뉴얼 검증 (Validation)

위치: `apps/web/src/pages/WorkManuals.tsx` → `validateManual()`

```
validateManual(content) → { issues: ManualIssue[], steps: ParsedStep[] }
```

| 심각도 | 검증 항목 |
|--------|----------|
| **MUST** | taskType 존재 여부 |
| **MUST** | taskType이 WORKLOG/APPROVAL/COOPERATION 중 하나 |
| **MUST** | TASK는 예외 (변환 필요) |
| **MUST** | 분기 대상 STEP 존재 여부 |
| **SHOULD** | 목적, 입력자료, 산출물, 완료조건 |
| **SHOULD** | WORKLOG → 업무일지 기록 내용 |
| **SHOULD** | APPROVAL → 분기 조건 |
| **SHOULD** | 조건식에 ==, != 포함 |

## 4. AI BPMN JSON 생성

### 입력
업무 매뉴얼 DSL 텍스트 (최대 12,000자)

### AI 출력 JSON 스키마
```json
{
  "title": "프로세스명",
  "bpmnJson": {
    "nodes": [
      {
        "id": "start",
        "type": "start",
        "name": "시작"
      },
      {
        "id": "task_1",
        "type": "task",
        "name": "도면 검토",
        "taskType": "WORKLOG",
        "description": "<ul><li>설계 도면 정합성 확인</li></ul>",
        "assigneeHint": "생산기술팀",
        "emailToTemplate": "team-lead@company.com",
        "emailSubjectTemplate": "[{itemCode}] 도면 검토 완료"
      },
      {
        "id": "gw_1",
        "type": "gateway_xor",
        "name": "결재 결과"
      },
      {
        "id": "end",
        "type": "end",
        "name": "종료"
      }
    ],
    "edges": [
      { "id": "e1", "source": "start", "target": "task_1" },
      { "id": "e2", "source": "task_1", "target": "gw_1" },
      { "id": "e3", "source": "gw_1", "target": "task_2", "condition": "last.approval.status == 'APPROVED'" },
      { "id": "e4", "source": "gw_1", "target": "task_3", "condition": "last.approval.status == 'REJECTED'" }
    ]
  }
}
```

### 노드 유형 매핑

| DSL 요소 | BPMN 노드 유형 | 설명 |
|----------|---------------|------|
| (자동 생성) | `start` | 시작 이벤트 |
| (자동 생성) | `end` | 종료 이벤트 |
| `### STEP` | `task` | 업무 태스크 |
| 분기 조건 | `gateway_xor` | 배타적 분기 |
| (미사용) | `gateway_parallel` | 병렬 분기 |

### taskType 정규화

AI가 생성한 taskType을 서버에서 정규화:
```
TASK → WORKLOG (기본값으로 대체)
기타 → WORKLOG (알 수 없는 값은 기본값)
```

## 5. BPMN 컴파일 (JSON → ProcessTaskTemplate[])

위치: `apps/api/src/process-templates.controller.ts` → `compileBpmn()`

### 컴파일 로직

```
1. nodes/edges를 파싱하여 incoming/outgoing 그래프 구성
2. 각 task 노드에 대해:
   a. collectUpstreamTasks()로 선행 task 노드 역추적
      - gateway, start 노드는 건너뛰고 그 위의 task를 찾음
   b. 직전 노드가 gateway_xor이면:
      - xorGroupKey = gateway 노드 ID
      - xorCondition = gateway→task 간 edge의 condition
   c. ProcessTaskTemplate 데이터 생성:
      - predecessorIds (쉼표 구분)
      - predecessorMode ('ANY' if XOR)
      - 모든 task 속성 매핑
3. ID 리매핑 (prefix 추가)하여 DB 저장
```

### 매핑 테이블

| BPMN 노드 속성 | ProcessTaskTemplate 필드 |
|---------------|------------------------|
| id | id |
| name | name |
| taskType | taskType |
| description | description |
| assigneeHint | assigneeHint |
| (계산됨) | predecessorIds |
| (계산됨) | predecessorMode |
| (계산됨) | xorGroupKey |
| (계산됨) | xorCondition |
| emailToTemplate | emailToTemplate |
| emailCcTemplate | emailCcTemplate |
| emailSubjectTemplate | emailSubjectTemplate |
| emailBodyTemplate | emailBodyTemplate |
| worklogTemplateHint | worklogTemplateHint |
| approvalRouteType | approvalRouteType |
| approvalRoleCodes | approvalRoleCodes |
| approvalUserIds | approvalUserIds |
| deadlineOffsetDays | deadlineOffsetDays |
| slaHours | slaHours |

## 6. 프로세스 실행 엔진

위치: `apps/api/src/processes.controller.ts`

### 실행 흐름

```
ProcessInstance 시작
  │
  ├── 선행 없는 태스크 → status: READY
  ├── 선행 있는 태스크 → status: CHAIN_WAIT
  │
  ▼ 태스크 완료 시:
  │
  ├── allPredecessorsCompleted() 확인
  │   ├── predecessorMode = 'ALL' → 모든 선행 완료 필요
  │   └── predecessorMode = 'ANY' → 하나만 완료 필요 (XOR)
  │
  ├── XOR 분기 시 evalCondition() 평가
  │   ├── 조건 충족 → 해당 태스크 READY
  │   └── 조건 미충족 → 해당 태스크 SKIPPED
  │
  └── 모든 태스크 완료 → ProcessInstance 완료
```

### XOR 조건식 평가

`evalCondition(cond, ctx)`:
- 지원 연산자: `==`, `!=`, `&&`, `||`
- 지원 변수: `last.approval.status`, `startedBy.role`, `itemCode`, `moldCode`, `carModelCode`, `initiativeId`
- 우변: 문자열('APPROVED'), 숫자, true/false, null

예: `last.approval.status == 'APPROVED' && startedBy.role != 'EXTERNAL'`

## 7. 전체 데이터 흐름 요약

```
User Input (자연어 매뉴얼)
       │
       ▼
WorkManual.content (DB 저장)
       │
       ▼ Phase 1 → Phase 2
AI /ai/questions → 질문 생성
       │
       ▼
User 답변 입력
       │
       ▼
AI /ai/apply-answers → content 보강
       │
       ▼ (선택적)
AI /ai/draft-steps → DSL 초안 생성
       │
       ▼
StepFormEditor (구조화 편집)
       │
       ▼ serializeStepsToText()
WorkManual.content (DSL 포맷)
       │
       ▼ Phase 2 → Phase 3
AI /ai/bpmn → bpmnJson 생성
       │
       ▼
POST /api/process-templates
       │
       ▼ compileBpmn()
ProcessTemplate + ProcessTaskTemplate[] (DB 저장)
       │
       ▼
BpmnEditor (시각적 편집/확인)
       │
       ▼
POST /api/processes/start
       │
       ▼
ProcessInstance + ProcessTaskInstance[] (실행)
```
