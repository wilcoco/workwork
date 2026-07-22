# WorkWork 온톨로지 블루프린트 (객체 관계도)

> 이후 온톨로지 확장의 기준 문서. 새 객체/링크를 추가하기 전에 반드시 이 문서의
> 분리 기준을 통과하는지 확인하고, 통과하면 이 문서를 먼저 갱신한 뒤 구현한다.
> (Palantir Foundry의 "1 데이터셋 = 1 객체 타입" 원칙을 따른다 — 우리는 1 Prisma 모델 = 1 객체 타입)

## 1. 객체 타입 (Object Types)

| 객체 | 백킹 테이블 | 성격 | 비고 |
|---|---|---|---|
| **활동** | `Activity` | 반복 가능한 작업 단위 — 5축의 공통 허브 | domain/category/taskType은 속성(별도 객체 아님) |
| **대상** | `OntologyEntity` | 활동이 다루는 실물/개념 (설비·차종·고객사·협력사·부품·시스템) | kind는 속성. 생명주기가 활동·사람과 독립이라 분리 |
| **목표** | `Objective` | 팀/회사의 정성 목표 | pillar(전략 기둥 C·Q·D·DEV·P)는 속성 |
| **KPI** | `KeyResult` | 정량 지표 (측정) | |
| **중점과제** | `KeyInitiative` | 변경/개선 프로젝트 | |
| **프로세스** | `ProcessTemplate` (+`ProcessTaskTemplate`) | 활동의 실행 배열 (BPMN) | PTT는 프로세스의 하위 구성이지 독립 객체 아님 |
| **매뉴얼** | `WorkManual` | 활동의 정의 문서 | |
| **실행 이벤트** | `Worklog` | 시계열 기록 (Foundry의 "센서 이벤트"형) | visibility로 로우 레벨 보안 |
| **조직** | `OrgUnit` | 팀/실 계층 | parentId 자기참조 |
| **구성원** | `User` | 사람 | role은 속성 |

## 2. 링크 (관계 + 카디널리티)

```
OrgUnit ─1:N─ User ─1:N─ Worklog ─N:1─ Activity ─N:M─ OntologyEntity
   │                                       ▲              (WorklogEntity 경유 파생)
   ├─1:N─ Objective ─1:N─ KeyResult ─N:1───┤
   │          └──1:N(alignsTo)─ KeyInitiative ─N:1─┤
   ├─1:N─ ProcessTemplate ─1:N─ ProcessTaskTemplate ─N:1─┤
   │          ▲ N:1 (sourceManualId)                     │
   └─(작성자)─ WorkManual ─N:1───────────────────────────┘
```

| 링크 | 컬럼 | 카디널리티 | 의미 |
|---|---|---|---|
| 일지→활동 | `Worklog.activityId` | N:1 | 실행 기록의 귀속 (⛏ 채굴 / 태스크 완료 훅) |
| 일지→대상 | `WorklogEntity` | N:M | 이 기록이 다룬 실물 (🏭 채굴) |
| 활동↔대상 | (파생) | N:M | 일지 동시출현으로 계산 — 별도 테이블 없음 |
| KPI→활동 | `KeyResult.activityId` | N:1 | 측정 (🎯 매칭) |
| 과제→활동 | `KeyInitiative.activityId` | N:1 | 개선 (🎯 매칭 / 갭 카드 생성) |
| 과제→목표 | `alignsToObjectiveId` | N:1 | 전략 정렬 |
| 태스크→활동 | `ProcessTaskTemplate.activityId` | N:1 | 정의 (템플릿 저장 자동 정합) |
| 프로세스→매뉴얼 | `sourceManualId` | N:1 | 유래 |
| 매뉴얼→활동 | `WorkManual.activityId` | N:1 | 정의 (제목 결정론 정합, ≥0.7) |

**전략 계보 (탐색 경로)**: 매뉴얼 → 프로세스 → 태스크 → 활동 → KPI/과제 → 목표 → 전략 기둥

## 3. 객체 분리 기준 (새 객체 추가 시 체크리스트)

다음 중 **2개 이상** 해당해야 새 객체 타입으로 분리한다. 아니면 기존 객체의 속성으로:

1. **생명주기 독립**: 다른 객체가 사라져도 존속하는가? (예: 설비는 담당자 퇴사와 무관 → 분리 O / 일지의 '팀명'은 일지 없으면 무의미 → 속성)
2. **보안 경계**: 접근 권한을 별도로 통제해야 하는가? (예: 일지 visibility — 단, 우리는 로우 레벨 필터로 해결했으므로 이것만으로는 분리 안 함)
3. **고유 링크/액션**: 다른 객체들과 독자적 관계·행동을 갖는가? (예: 대상은 여러 활동·여러 팀과 연결 → 분리 O)
4. **속성 구조 상이**: 컬럼이 50% 이상 다른가? (예: '관리직 활동'은 활동과 컬럼 동일 → 속성으로)

**분리하지 않기로 한 것들** (재논의 시 이 사유를 먼저 반박할 것):
- 도메인/카테고리 → Activity 속성 (필터 목적일 뿐)
- 전략 기둥(Pillar) → Objective 속성 (5개 고정 enum)
- 결재/협조/업무 구분 → taskType 속성
- 지식(🏅) → Worklog의 kbBadge 속성 (일지와 생명주기 동일)

## 4. 채굴 파이프라인 (실데이터 → 객체)

| 버튼 | 대상 | 방식 | 멱등성 |
|---|---|---|---|
| ⛏ 활동 추출 | Worklog → Activity | AI 일반화 명사 추출 → 결정론 정합 → AI 유사판정 → 신규 | activityId null만 |
| 🏭 대상 추출 | Worklog → OntologyEntity | AI 고유명사 추출(6종) → 결정론 정합 → 신규 | entityMinedAt null만 |
| 🔗 유사 병합 | Activity 중복 통합 | bigram 클러스터 → AI 그룹판정 → 참조 재지정+별칭 보존 | 후보 소진까지 |
| 🗂 체계 정리 | Activity.domain/category | AI 분류 (고정 풀 14종) | domain null만 |
| 🎯 KPI·과제 매칭 | KR/KI → Activity | 목표별 shortlist 후보 → AI 판정 (보수적) | activityId null만 |

## 5. 조회 화면 (시맨틱 레이어)

- **활동 지도** `/process/activity-map` — 기능축 조망 (도메인 트리, 지식 공백/자산, 목표 공백)
- **전략 정렬 지도** `/process/strategy-map` — 가치축 조망 (전략→실행 증거, 양방향 공백)
- **온톨로지 탐색기** `/process/ontology` — 자유 탐색 (객체 중심, 축별 연결, 계보 추적)
- **KPI 기여 분석** `/process/kpi-contribution` — 월별 투입시간↔목표 기여 대조

모두 임원 이상 전용. 일반 구성원 노출 면: 일지 작성 화면 "이 작업의 과거 지식"(공개 일지만), AI 보완질문 컨텍스트.
