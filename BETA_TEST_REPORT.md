# 베타 테스트 리포트 — 업무 매뉴얼 외재화 시스템

> 코드 흐름 추적 기반 시뮬레이션 (2024-03-25)

---

## 시뮬레이션 시나리오 5종

### 시나리오 1: 📋 업무 절차 (procedure) — "설계변경(ECR/EO) 처리 절차"
- **부서:** 설계팀
- **자유 입력:** "고객사에서 설계변경 요청이 오면 ECR을 접수하고, 설계팀에서 검토 후 EO를 발행합니다. 관련 부서 합의 후 금형수정이 필요하면 금형개발팀에 의뢰하고, 시작품 제작 후 승인받아 양산에 반영합니다."

**Phase 흐름:**
1. Phase 1 → 저장 → `baseType: 'procedure'`, `isProcedure: true`
2. Phase 2 (procedure) → `procDraftSteps()` 자동 호출 → STEP 변환 → StepFormEditor 표시
3. Phase 3 (procedure) → `procSaveAndBpmn()` → BPMN 노드/엣지 생성 → 프로세스 템플릿 생성
4. **⚠️ BUG-1:** Phase 3에서 Phase 4로 가는 버튼이 없음! "매뉴얼 목록으로" 버튼만 있음
5. Phase 5 → `loadPhase5()` → 암묵지 질문 6개 표시

**예상 산출물:** BPMN 흐름도 (접수 → 검토 → 합의 → 금형수정 → 시작품 → 승인 → 양산반영)

---

### 시나리오 2: 🚗 개발 프로젝트 (dev_project) — "신차 범퍼 개발 프로젝트"
- **부서:** 신차개발팀
- **자유 입력:** "현대차 신차 프론트 범퍼 개발입니다. M-8부터 시작해서 L1 설계 10% → L2 50% → L3 80% → L4 100%로 진행합니다. Proto 시작품 후 P1/P2 거쳐 양산까지 M+20 정도 걸립니다. ESIR 실사도 중간에 있고 D-FMEA도 해야 합니다."

**Phase 흐름:**
1. Phase 1 → 저장 → `baseType: 'dev_project'`, `isProcedure: false`
2. Phase 2 (non-procedure) → `loadPhase2Questions()` → AI 구조화 질문 2~3개 × 3라운드
3. Phase 3 (non-procedure) → `loadPhase3()` → 옵션 추천 (project_period, add_dev_milestone 자동 추천)
4. Phase 4 → `generatePhase4()` → 마일스톤 타임라인 매뉴얼 생성
5. **⚠️ BUG-2:** Phase 4에서 모듈 연동 시 `schedule_mgmt` 엔드포인트 `/api/schedules/from-manual/` 호출되나, 이 엔드포인트가 매뉴얼의 phaseData를 읽어 마일스톤을 파싱하는 로직이 있는지 확인 필요
6. Phase 5 → 암묵지 보완 → 완료

**예상 산출물:** 마일스톤 타임라인 (M-8 ~ M+20, Gate Review 포함)

---

### 시나리오 3: 🖥️ 시스템 조작 (system_operation) — "ERP BOM 등록"
- **부서:** 전산팀
- **자유 입력:** "SAP에서 BOM을 등록합니다. 트랜잭션 CS01로 들어가서 자재코드 입력, 유효기간 설정, 하위 부품 추가합니다. 대체 BOM이 있으면 ALT 필드에 번호를 넣어야 합니다. 잘못 등록하면 생산계획에 바로 영향이 가서 주의해야 합니다."

**Phase 흐름:**
1. Phase 1 → 저장
2. Phase 2 → AI 질문 ("어떤 메뉴로 들어가나요?" 등)
3. Phase 3 → 옵션 추천 (add_system_op → 이미 기본형이라 제외됨, always_reference 추천 가능)
4. Phase 4 → 시스템 조작 가이드 생성 (SCREEN 형식)
5. Phase 4 모듈 연동 → `knowledge_base` → `/api/knowledge-base/from-manual/` 호출
6. Phase 5 → 암묵지 보완

**예상 산출물:** Step-by-step 조작 가이드 + FAQ

---

### 시나리오 4: 🧮 계산/산출 (calculation) — "부품 원가계산"
- **부서:** 회계팀
- **자유 입력:** "부품별 원가를 계산합니다. 재료비는 BOM에서 가져오고, 가공비는 사이클타임 × 시간당 가공비로 산출합니다. 환율 변동 시 수입 원자재는 환율을 반영해야 합니다. 결과는 원가산출표(엑셀)로 정리해서 영업팀과 경영진에 보고합니다."

**Phase 흐름:**
1~6: system_operation과 동일한 흐름
- Phase 4 → 산출 공식표 + Worked Example 형식
- 모듈 연동 → `knowledge_base`

**예상 산출물:** 산출 공식표 + Worked Example + 검증 포인트

---

### 시나리오 5: 🔧 점검/관리 (inspection_mgmt) — "사출기 일상점검"
- **부서:** 생산기술팀
- **자유 입력:** "매일 아침 사출기 10대를 점검합니다. 유압유 온도, 형체력 압력, 노즐 상태, 호퍼 잔량을 확인합니다. 유압유 온도가 60도 넘으면 냉각수 점검해야 합니다. 노즐에 수지가 탄화되어 있으면 교체합니다. 점검일지는 MES에 입력합니다."

**Phase 흐름:**
1~6: 정상 흐름
- Phase 3 → daily, missed_alarm, checklist_widget 자동 추천
- Phase 4 → 점검 체크리스트 형식 (CHECK 형식)
- 모듈 연동 → `periodic_alarm_report` → `/api/periodic-alarms/from-manual/` 호출

**예상 산출물:** 점검 체크리스트 + 이상 조치표 + 설비 정보

---

## 발견된 버그/이슈

### 🔴 BUG-1 (Critical): procedure 기본형 — Phase 3→4→5 전환 불가
- **위치:** Phase 3 (procedure) 렌더링 (line ~1234)
- **문제:** Phase 3 하단에 "← 이전: 프로세스 단계 편집"과 "매뉴얼 목록으로" 버튼만 있고, Phase 4/5로 이동하는 버튼이 없음
- **영향:** procedure 기본형 사용자는 Phase 3에서 막힘 → Phase 4 산출물 생성, Phase 5 암묵지 보완 불가
- **수정:** Phase 4로 이동하는 "다음: 산출물 생성 →" 버튼 추가 필요

### 🔴 BUG-2 (Critical): Phase 4 extPhase4 엔드포인트가 callAI 대신 raw fetch 사용
- **위치:** work-manuals.controller.ts line ~1145-1167
- **문제:** extPhase4도 Phase 2처럼 `(globalThis as any).fetch`를 직접 사용 → Phase 2와 같은 이유로 실패 가능
- **수정:** callAI 헬퍼로 리팩터링 필요

### 🔴 BUG-3 (Critical): Phase 5 extPhase5Complete도 raw fetch 사용
- **위치:** work-manuals.controller.ts line ~1244-1266
- **문제:** 동일하게 raw fetch 사용
- **수정:** callAI 헬퍼로 리팩터링 필요

### 🟡 BUG-4 (Medium): procedure Phase 2 → Phase 3 진입 시 BPMN 자동 생성 조건
- **위치:** procSaveAndBpmn() 호출 (line ~1070)
- **문제:** Phase 2에서 "다음: BPMN 프로세스 생성 →" 클릭 시 `setPhase(3); void procSaveAndBpmn();` 순서로 호출
- **잠재 이슈:** BPMN JSON이 아직 없는 상태에서 Phase 3 렌더링 → "BPMN 변환이 아직 완료되지 않았습니다" 메시지가 잠깐 깜빡임 (UX)

### 🟡 BUG-5 (Medium): Phase 4 자동 생성 useEffect 조건
- **위치:** line ~638-642
```js
useEffect(() => {
    if (phase === 4 && manual?.id && !p4Content && !p4Loading) {
      void generatePhase4();
    }
  }, [phase, manual?.id]);
```
- **문제:** procedure 기본형에서 Phase 3→4 전환 시에도 자동으로 generatePhase4() 호출됨.
  procedure는 이미 Phase 3에서 BPMN을 생성했으므로 Phase 4에서 또 AI를 호출하는 것은 중복.
  하지만 Phase 4의 AI는 "매뉴얼 콘텐츠"를 생성하는 것이므로, BPMN과 별개로 필요할 수 있음.
  → procedure의 Phase 4 목적을 명확히 할 필요 있음

### 🟡 BUG-6 (Medium): procedure Phase 3에서 optionGroups 건너뜀
- **문제:** procedure 기본형은 Phase 3이 BPMN 생성이라 옵션 선택을 완전히 건너뜀
- **영향:** "결재/승인 절차 포함", "시스템 조작법 포함" 등 추가 옵션을 선택할 기회가 없음
- **의견:** Phase 4 산출물에 옵션이 반영되지 않을 수 있음

### 🟢 BUG-7 (Low): p2Error → 매뉴얼 선택 시 리셋 안 됨
- **위치:** selectManual 함수
- **문제:** 다른 매뉴얼을 선택할 때 p2Error가 이전 매뉴얼의 에러를 유지할 수 있음

### 🟢 BUG-8 (Low): 모드 선택 Phase 4+ 조건
- **문제:** procedure 기본형은 Phase 3에서 이미 최종 단계(BPMN 템플릿 생성)인데, 모드 선택이 Phase 4+에서만 표시됨
- **영향:** procedure 사용자는 모드 선택을 볼 기회가 없음 (Phase 3에서 끝나므로)

---

## 우선순위별 수정 계획

1. **BUG-1** (procedure Phase 3→4 버튼 추가) — 즉시 수정
2. **BUG-2, BUG-3** (Phase 4, 5 callAI 리팩터링) — 즉시 수정
3. **BUG-7** (selectManual에서 p2Error 리셋) — 빠른 수정
4. **BUG-4~6, 8** (UX 개선) — 논의 후 수정

