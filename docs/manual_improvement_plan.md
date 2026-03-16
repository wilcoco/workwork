# 업무 매뉴얼 시스템 개선 방안

## 현재 시스템 vs 제안 비교

### 이미 구현된 것 ✅

| 제안 항목 | 현재 구현 상태 | 파일 |
|----------|--------------|------|
| 1차 자유 입력 | ✅ Phase 1 자유형 텍스트 입력 | WorkManuals.tsx |
| AI 누락 검출 + 질문 | ✅ `/ai/questions` — 12개 필드 기준 누락/모호 질문 생성 | work-manuals.controller.ts |
| 답변 반영 | ✅ `/ai/apply-answers` — 답변을 DSL 필드로 반영 | work-manuals.controller.ts |
| 표준 템플릿 정규화 | ✅ `/ai/draft-steps` — 자유형 → DSL STEP 변환 | work-manuals.controller.ts |
| 그룹웨어 실행 | ✅ BPMN 생성 → ProcessTemplate → ProcessInstance 실행 | process-templates.controller.ts, processes.controller.ts |
| 구조화 저장 | ✅ DSL 포맷 (30+ 필드), StepFormData 구조체 | StepFormEditor.tsx |
| 체크리스트 연결 | ✅ ProcessTaskInstance (WORKLOG/APPROVAL/COOPERATION 실행) | processes.controller.ts |
| 승인 체계 | ✅ ProcessTemplate에 DRAFT/ACTIVE 상태 | process-templates.controller.ts |
| 버전 관리 | ✅ WorkManual.version 자동 증가 | work-manuals.controller.ts |

### GAP — 아직 없는 것 🔴

| # | 제안 항목 | GAP 상세 | 우선순위 |
|---|----------|---------|---------|
| G1 | **반복 질의 (iterative Q&A)** | 현재는 질문 1회 → 답변 1회로 끝남. "부족한 항목이 남으면 재질문"하는 루프가 없음 | **P0** |
| G2 | **규칙+AI 하이브리드 질문 엔진** | 현재는 AI에게 전부 맡김. 필수 필드 비었으면 룰 기반으로 무조건 질문하는 로직 없음 | **P0** |
| G3 | **완성도 점수 (Quality Score)** | 매뉴얼이 "실행 가능한지" 판정하는 점수 없음. 현재 validateManual()은 프론트에서 MUST/SHOULD만 체크 | **P1** |
| G4 | **팀장/관리자 검토·승인 워크플로** | WorkManual에 승인 상태(DRAFT→REVIEW→APPROVED) 없음. 작성자만 편집 | **P1** |
| G5 | **매뉴얼 공유 (visibility)** | WorkManual은 userId로 소유자만 조회. 팀/부서 공유 없음 | **P1** |
| G6 | **개정 이력 관리** | version은 숫자만 증가. 이전 버전 내용 보관/diff 없음 | **P2** |
| G7 | **매뉴얼 → 체크리스트 직접 변환** | 프로세스 없이도 매뉴얼 STEP을 체크리스트로 사용하는 기능 없음 | **P2** |
| G8 | **AI 품질 점검 (실행 가능성 판정)** | "담당자만 있고 승인자 없으면 미완성" 같은 비즈니스 룰 점검 없음 | **P1** |
| G9 | **AI 호출 로깅** | input/output 쌍 저장 안됨. 질문 품질 개선 데이터 없음 | **P2** |
| G10 | **매뉴얼 템플릿 라이브러리** | 빈 매뉴얼에서 시작. 업무 유형별 템플릿(발주, 검사, 설변 등) 없음 | **P2** |

---

## 개선 설계

### G1. 반복 질의 (Iterative Q&A Loop) — P0

**현재**: Phase 2에서 "AI 질문 생성" 1회 → 답변 입력 → 반영 1회 → 끝
**목표**: 답변 반영 후 재분석 → 아직 부족하면 추가 질문 → 사용자가 "충분"이라고 판단할 때까지 반복

```
┌─────────────────────────────────────────────┐
│              현재 (1-shot)                    │
│  질문 생성 → 답변 → 반영 → 끝                  │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│              개선 (iterative)                 │
│  질문 생성 → 답변 → 반영 → 재분석              │
│       ↑                        │              │
│       └── 부족 항목 있음 ←──────┘              │
│                                               │
│            부족 항목 없음 → 완료                │
└─────────────────────────────────────────────┘
```

**구현 방법**:
- `/ai/apply-answers` 응답에 `remainingIssues[]` 필드 추가
- 프론트에서 remainingIssues > 0이면 "추가 질문이 있습니다" 버튼 표시
- 버튼 클릭 시 `/ai/questions`를 보강된 content로 재호출
- **라운드 카운터** 표시 (1차 보완 → 2차 보완 → ...)
- 최대 3~5라운드 제한 (무한 루프 방지)

**UI 변경**:
- Phase 2에 "보완 라운드" 진행 표시기 추가
- 각 라운드별 질문/답변 이력 접기/펼치기
- "충분합니다 — 다음 단계로" 버튼으로 수동 탈출

### G2. 규칙+AI 하이브리드 질문 엔진 — P0

**현재**: AI가 전체 판단 (들쭉날쭉할 수 있음)
**목표**: 필수 필드 비었으면 **룰 엔진**이 무조건 질문, 맥락 보완만 **AI**가 담당

```
검증 레이어:
  1. 룰 엔진 (서버, 100% 결정적)
     - STEP에 taskType 없음 → 필수 질문
     - STEP에 담당자 없음 → 필수 질문
     - APPROVAL인데 결재선 없음 → 필수 질문
     - COOPERATION인데 협력사 없음 → 필수 질문
     - 입력자료/산출물/완료조건 없음 → 권장 질문

  2. AI 엔진 (OpenAI, 맥락 기반)
     - "검토 후 처리" → 누가 검토하는지?
     - "필요 시 보고" → 기준이 뭔지?
     - 절차는 있는데 예외처리 없음
     - 내용이 모호하거나 불충분한 경우
```

**구현 방법**:
- 서버에 `ruleBasedValidation(content)` 함수 추가 (현재 프론트 validateManual()을 서버로 이동+확장)
- `/ai/questions` 호출 시:
  1. 먼저 룰 엔진으로 필수 누락 검출
  2. AI에게는 "이미 검출된 필수 누락 외에 맥락상 부족한 부분"만 질문 요청
  3. 두 결과를 합쳐서 `ruleQuestions[]` + `aiQuestions[]`로 분리 반환
- 프론트에서 룰 질문은 빨간색(필수), AI 질문은 파란색(권장)으로 구분 표시

**장점**:
- AI 응답이 이상해도 필수 항목은 반드시 잡힘
- AI 토큰 절약 (필수 항목은 AI 호출 불필요)
- 질문 품질 일관성 확보

### G3. 완성도 점수 (Quality Score) — P1

**현재**: MUST/SHOULD 이슈 개수만 표시
**목표**: 0~100점 점수로 매뉴얼 품질 시각화

```
점수 산정 기준 (STEP 당):
  - taskType 있음: +10
  - 목적 있음: +8
  - 담당자 있음: +10
  - 입력자료 있음: +8
  - 산출물 있음: +10
  - 완료조건 있음: +10
  - 작업방법 있음: +8
  - 확인사항 있음: +8
  - 업무일지 힌트 있음 (WORKLOG): +8
  - 결재선 있음 (APPROVAL): +10
  - 협력사 있음 (COOPERATION): +10
  - 예외/위험대응 있음: +5
  - 기한/SLA 있음: +5

전체 점수 = 각 STEP 점수의 가중 평균
```

**UI**: Phase 2 상단에 원형 프로그레스바 + 점수 표시
- 🔴 0~39점: 초안 수준, 추가 보완 필요
- 🟡 40~69점: 기본 구조 갖춤, 세부 보완 권장
- 🟢 70~100점: 실행 가능 수준

### G4. 매뉴얼 승인 워크플로 — P1

**현재**: WorkManual에 상태 없음 (작성자만 편집/조회)
**목표**: DRAFT → REVIEW → APPROVED → ARCHIVED 워크플로

**DB 변경** (schema.prisma):
```prisma
model WorkManual {
  // 기존 필드 ...
  status         ManualStatus @default(DRAFT)
  reviewerId     String?
  reviewer       User?   @relation("manualReviewer", fields: [reviewerId], references: [id])
  reviewedAt     DateTime?
  reviewComment  String?
}

enum ManualStatus {
  DRAFT
  REVIEW
  APPROVED
  ARCHIVED
}
```

**흐름**:
1. 작성자: DRAFT → "검토 요청" → REVIEW (팀장에게 알림)
2. 팀장: 검토 → 승인(APPROVED) 또는 반려(DRAFT + 코멘트)
3. 승인된 매뉴얼만 프로세스 생성 가능

### G5. 매뉴얼 공유 (visibility) — P1

**DB 변경**:
```prisma
model WorkManual {
  // 기존 필드 ...
  visibility  ManualVisibility @default(PRIVATE)
  orgUnitId   String?
  orgUnit     OrgUnit? @relation(fields: [orgUnitId], references: [id])
}

enum ManualVisibility {
  PRIVATE     // 본인만
  ORG_UNIT    // 같은 부서
  PUBLIC      // 전사
}
```

### G8. AI 품질 점검 (실행 가능성 판정) — P1

**현재 AI 질문**과 별도로, 최종 단계에서 **비즈니스 룰 기반 실행 가능성 점검**:

```
실행 불가 조건 (BLOCK):
  - 담당자만 있고 승인자 없는 APPROVAL 단계
  - 절차는 있는데 예외처리가 전혀 없음
  - 결과물은 있는데 저장 위치/시스템이 없음
  - 2개 이상 STEP에 같은 담당자 + 같은 시간대 기한 (병렬 불가능)

경고 조건 (WARN):
  - SLA가 없는 외부 협력사 STEP
  - 분기 조건이 있는데 한 쪽만 정의됨
  - 전체 프로세스에 APPROVAL이 하나도 없음
```

---

## 구현 로드맵

### Phase A: 핵심 엔진 강화 (1~2주)

| ID | Task | 관련 GAP | 파일 |
|----|------|---------|------|
| A1 | 서버에 `ruleBasedValidation()` 함수 추가 | G2 | work-manuals.controller.ts |
| A2 | `/ai/questions`를 룰+AI 하이브리드로 개선 | G2 | work-manuals.controller.ts |
| A3 | `/ai/apply-answers` 응답에 `remainingIssues` 추가 | G1 | work-manuals.controller.ts |
| A4 | Phase 2 UI에 반복 질의 루프 구현 | G1 | WorkManuals.tsx |
| A5 | 완성도 점수 계산 함수 (프론트+서버) | G3 | 양쪽 |
| A6 | Phase 2 상단에 점수 프로그레스바 | G3 | WorkManuals.tsx |

### Phase B: 승인/공유 (2~3주)

| ID | Task | 관련 GAP | 파일 |
|----|------|---------|------|
| B1 | WorkManual에 status/visibility 필드 추가 (Prisma) | G4, G5 | schema.prisma |
| B2 | 매뉴얼 상태 변경 API (DRAFT→REVIEW→APPROVED) | G4 | work-manuals.controller.ts |
| B3 | 매뉴얼 목록에 공유 범위 필터 | G5 | WorkManuals.tsx |
| B4 | 팀장 검토 UI (승인/반려/코멘트) | G4 | WorkManuals.tsx |
| B5 | 승인된 매뉴얼만 BPMN 생성 허용 | G4 | work-manuals.controller.ts |

### Phase C: 품질/운영 (3~4주)

| ID | Task | 관련 GAP | 파일 |
|----|------|---------|------|
| C1 | 비즈니스 룰 기반 실행 가능성 점검 | G8 | work-manuals.controller.ts |
| C2 | 매뉴얼 버전 이력 테이블 (WorkManualVersion) | G6 | schema.prisma |
| C3 | 버전 diff UI | G6 | WorkManuals.tsx |
| C4 | AI 호출 로깅 (ManualAiLog 테이블) | G9 | schema.prisma, work-manuals.controller.ts |
| C5 | 업무 유형별 시작 템플릿 라이브러리 | G10 | work-manuals.controller.ts, WorkManuals.tsx |
| C6 | 매뉴얼 → 체크리스트 독립 실행 | G7 | 신규 |

---

## 대상 업무 (우선 적용)

제조업 특성상 아래 업무부터 적용하면 효과가 큽니다:

| 순서 | 업무 | 이유 |
|------|------|------|
| 1 | 외주 발주 프로세스 | 단계 명확, 승인 포함, 협력사 연동 |
| 2 | 도면 변경 대응 | 분기 조건 다양, 예외처리 중요 |
| 3 | 입고 검사 | 체크리스트 성격, 품질 기준 명확 |
| 4 | 개발→양산 전환 | 다부서 협업, 장기 프로세스 |
| 5 | 품질 이슈 대응 | 긴급성, 에스컬레이션 경로 필요 |
| 6 | 비상 대응 매뉴얼 | 안전 필수, 연락처/대응 절차 핵심 |

---

## 핵심 요약

**현재 시스템은 전체 6단계 중 5단계가 이미 구현되어 있습니다.**

| 단계 | 현재 | 개선 후 |
|------|------|--------|
| 1. 1차 입력 | ✅ 자유형 텍스트 | ✅ 동일 |
| 2. AI 누락 검출 | ✅ AI 전담 (1회) | 🔄 **룰+AI 하이브리드, 반복 질의** |
| 3. 추가 질문/답변 | ✅ 1회 Q&A | 🔄 **N회 반복 (라운드별 추적)** |
| 4. 템플릿 완성 | ✅ DSL STEP | 🆕 **+ 완성도 점수 + 실행 가능성 점검** |
| 5. 승인 | ❌ 없음 | 🆕 **DRAFT→REVIEW→APPROVED 워크플로** |
| 6. 그룹웨어 실행 | ✅ BPMN→프로세스 | ✅ 동일 (승인된 것만 허용) |

**가장 임팩트가 큰 개선 2가지**:
1. **반복 질의 + 룰 엔진** (G1+G2) — 매뉴얼 품질을 구조적으로 끌어올림
2. **승인 워크플로** (G4) — AI가 만든 문서를 현업이 검증하는 안전장치
