# BPMN 생성 개선 — 진단 및 실행 계획

작성일: 2026-05-07  
상태: 진단 완료 / 1차 구현 대기

---

## 1. 배경

회사 내에서 실제 사용 시작. 가장 미진한 부분: **업무 매뉴얼 → BPMN 프로세스 전환**, 그리고 그 BPMN 을 결재·의사결정 흐름에 사용하는 부분. 자연어 매뉴얼을 넣었을 때 BPMN 이 제대로 안 나옴.

핵심 진단(외부 LLM 컨설팅 결과 + 코드 리뷰):

> "자연어 → BPMN 한방 변환은 LLM 이 본질적으로 약한 작업. 한 번에 시키지 말고 (1) 단계 분해, (2) JSON intermediate, (3) 유형별 템플릿 prior, (4) few-shot 사내 예시 — 이 순으로 우회해야 한다."

---

## 2. 현재 코드 상태

BPMN 생성 경로가 두 군데 있고 둘 다 같은 함정에 빠져 있음.

### 경로 A: `POST /api/work-manuals/:id/ai/bpmn`
- 파일: `apps/api/src/work-manuals.controller.ts:482-643`
- 한 번의 LLM 호출로 한국어 매뉴얼 → `{title, bpmnJson{nodes, edges}}` 통째 생성.
- 한 prompt 안에서 STEP 파싱 / taskType 분류 / AND-Split,Join / XOR gateway + condition / 반려 loop-back / stageLabel / SLA 를 동시에 요구.
- 입력이 깔끔한 `### STEP S1 | …` DSL 이 아닐 때 거의 항상 **선형 task→task→task** 로 떨어짐. Gateway/Loop 누락이 가장 흔한 실패 패턴.

### 경로 B: Skill File → BPMN (이미 절반은 옳은 구조)
- `generateSkillFile` (work-manuals.controller.ts:1306+) — 매뉴얼을 구조화 JSON 으로 추출 (`steps`, `decisions`, `exceptions`, `actors`, `tacitKnowledge`, …). **여기서 의미 추출은 끝.**
- `skillFileToBpmn` (work-manuals.controller.ts:1470-1574) — 그런데 그 구조화 JSON 을 **다시 텍스트로 직렬화해 LLM 에게 BPMN 그래프를 그려달라고 한 번 더 호출**. 여기서 정보가 새거나 왜곡됨.
- 즉 `{steps, decisions}` → `{nodes, edges}` 변환은 본래 **결정론적 코드 변환**으로 충분한데 LLM 을 한 번 더 거치고 있는 것이 핵심 문제.

---

## 3. 4단계 실행 계획 (사용자 합의: 4개 모두 채택, 단 진단 → 단계 분해 → 템플릿 prior → few-shot 순)

### Step 0 (완료)
- 현재 파이프라인을 읽고 어디가 깨지는지 파악.
- 결론: 가장 큰 누수는 경로 B 의 두 번째 LLM 호출. 경로 A 는 그다음.

### Step 1 — Skill File → BPMN 결정론적 빌더 (가장 큰 ROI, 다음 작업)
- 새 파일 `apps/api/src/skill-to-bpmn.ts`: 순수 함수
  ```ts
  buildBpmnFromSkillFile(skillData) → { title, bpmnJson: { nodes, edges } }
  ```
- 동작:
  - `start` / `end` 자동 추가
  - `steps[]` 순서대로 task 노드 생성, taskType / description / assigneeHint / stageLabel / deadlineOffsetDays / slaHours 그대로 매핑
  - 인접 step 사이 sequential edge
  - `decisions[]` 의 `afterStep` 위치에 `gateway_xor` 삽입, 각 `conditions[].condition` 을 edge.condition 으로 매핑, 다음 노드는 `nextStep`
  - `taskType === 'APPROVAL'` 인 step 뒤에 reject loop-back 후보가 있으면 자동 추가 (조건: `last.approval.status == 'REJECTED'`, target: 직전 작성형 step)
- `skillFileToBpmn` 컨트롤러는 이 함수를 호출하도록 교체. 기존 LLM 경로는 `?ai=1` 옵션으로만 보존.
- 검증: 회사에서 만들어진 실패 케이스 5개에 새 빌더를 돌려보고 직선 vs 분기 비율 비교.

### Step 2 — 경로 A 를 단계 분해 + JSON intermediate 으로 재구성
- `aiBpmn` 의 단일 호출을 다음으로 분해:
  1. `extractActors(content)` — 등장 actor / 역할 목록
  2. `extractTasks(content, actors)` — task 후보 (이름, taskType, actor, 단계명)
  3. `extractDecisions(content, tasks)` — 분기점 (afterStep, 질문, conditions)
  4. `extractExceptions(content, tasks)` — 반려/예외 경로
- 각 단계는 Anthropic tool-use schema 로 JSON 강제. 단계마다 LLM 이 하는 일은 단순.
- 4개 출력을 합쳐 Skill File 과 동일한 shape 으로 만들고 Step 1 의 결정론적 빌더에 통과시킴 → 두 경로 합류.

### Step 3 — 유형별 템플릿 prior
- `manual-externalization.constants.ts` 의 5 BASE_TYPE (procedure / dev_project / system_operation / calculation / inspection_mgmt) 마다 BPMN 골격 템플릿을 정의.
- 예: `procedure-approval` 골격 = `[요청 작성] → [1차 검토] → [XOR: 통과?] → {Yes: 최종 승인, No: 작성으로 loop-back}`.
- LLM 호출 시 baseType 에 맞는 골격을 prompt 에 넣고 **"빈 slot 채우기"** 작업으로 변환 → 누락 패턴 급감.

### Step 4 — Few-shot 사내 예시
- 회사에서 잘 작동하는 BPMN 5~10건 (사출기 일상점검, ECR 처리, BOM 등록, 차량 배차 등) 을 큐레이션.
- in-context example 로 prompt 에 주입.
- 사내 도메인 어휘에 맞춰 품질 한 단계 점프.

---

## 4. 즉시 실행 항목 우선순위

1. (다음) Skill File → BPMN 결정론적 빌더 + 컨트롤러 교체. 회귀 테스트 1개라도 추가.
2. 회사 실패 케이스 5건 캡처 및 어떤 패턴(Gateway 누락 / Actor 누락 / Loop 누락 / 너무 단순 / 너무 복잡)인지 분류 (사용자 직접). 이 데이터가 Step 2 의 단계 분해 기준이 됨.
3. Step 2 (경로 A 단계 분해) 진행.
4. Step 3 / Step 4 는 Step 2 가 안정된 후.

---

## 5. 부수 결정 사항

- **실행 가능 BPMN(워크플로 엔진)**: 현재 자체 엔진(`processes.controller.ts` + `ProcessTaskInstance`) 을 이미 운영 중이므로 추가 엔진 도입 불필요. AI 는 BPMN 초안만 만들고, 사용자가 시각 에디터(`BpmnEditor.tsx`)에서 폼/조건/권한을 확정한 뒤 `processTemplate` 에 등록하는 현재 흐름 유지.
- **이번 회차 우선순위**: 품의서(결재) 동작 점검을 먼저 진행하고, 그 다음 Step 1 빌더 구현.

