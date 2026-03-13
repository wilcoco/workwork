# Frontend Structure

## 개요

React 18 + Vite + TypeScript. SPA (Single Page Application).
상태 관리 라이브러리 없이 각 페이지가 자체 useState로 관리.

## 디렉토리 구조

```
apps/web/src/
├── App.tsx              # 라우팅 + AppShell + 권한 가드 + 네비게이션
├── main.tsx             # ReactDOM.createRoot 진입점
├── deployInfo.ts        # 배포 정보 (타이틀, 설명)
├── vite-env.d.ts        # Vite 환경변수 타입
│
├── pages/               # 48개 페이지 컴포넌트
│   ├── WorkManuals.tsx      # ★ 업무 매뉴얼 3-Phase 위자드 (829줄)
│   ├── ProcessTemplates.tsx # ★ 프로세스 템플릿 + BPMN 에디터 (48KB)
│   ├── ProcessStart.tsx     # 프로세스 시작 (38KB)
│   ├── ProcessInstanceDetail.tsx # 프로세스 실행 상세 (36KB)
│   ├── WorklogQuickNew.tsx  # 간편 업무일지 (57KB, 가장 큼)
│   ├── Home.tsx             # 대시보드 (50KB)
│   ├── WorklogNew.tsx       # 상세 업무일지 (33KB)
│   ├── ApprovalsSubmit.tsx  # 결재 올리기 (31KB)
│   └── ...
│
├── components/          # 11개 공유 컴포넌트
│   ├── BpmnEditor.tsx       # ★ BPMN 다이어그램 에디터 (37KB)
│   ├── BpmnFormEditor.tsx   # BPMN 노드 속성 편집 (25KB)
│   ├── StepFormEditor.tsx   # ★ 매뉴얼 STEP 구조화 편집기 (28KB)
│   ├── Toast.tsx            # 토스트 알림 + 확인 모달 (4.5KB)
│   ├── BpmnMiniView.tsx     # BPMN 미니 뷰어 (3.7KB)
│   ├── ProcessDocument.tsx  # 프로세스 문서 렌더 (8.7KB)
│   ├── WorklogDocument.tsx  # 업무일지 문서 렌더 (12KB)
│   ├── CoopDocument.tsx     # 협조 문서 렌더 (6KB)
│   ├── DocumentTags.tsx     # 문서 태그 (11KB)
│   ├── UserAvatar.tsx       # 사용자 아바타 (1.6KB)
│   └── UserPicker.tsx       # 사용자 선택기 (3.8KB)
│
├── lib/                 # 유틸리티
│   ├── api.ts               # API 호출 함수 (apiJson, apiFetch, apiUrl)
│   ├── richText.ts          # Quill 에디터 유틸
│   ├── time.ts              # 시간 포맷 유틸
│   └── upload.ts            # 파일 업로드 유틸
│
└── styles/              # CSS
```

## 주요 페이지 상세

### WorkManuals.tsx — 업무 매뉴얼 편집기

**3-Phase 위자드 UI**:

```
Phase 1: 작성        Phase 2: AI 분석/보완    Phase 3: 프로세스 생성
┌───────────┐       ┌───────────────┐       ┌──────────────┐
│ 제목/팀/작성자│       │ 구조화 편집      │       │ 매뉴얼 최종 확인│
│ 자유형 텍스트 │  →    │ AI 질문 & 답변   │  →    │ AI BPMN 생성  │
│ AI 템플릿    │       │ AI STEP 초안     │       │ 프로세스 이동   │
└───────────┘       └───────────────┘       └──────────────┘
```

**핵심 상태 (useState 17개)**:
- `items`, `selectedId`, `editing` — 매뉴얼 목록/선택/편집
- `phase` (1|2|3) — 현재 위자드 단계
- `editMode` ('text'|'structured') — 편집 모드
- `stepForms` — StepFormData 배열
- `aiQuestions`, `answers`, `answerLinks` — AI 질문/답변
- `validation` — 매뉴얼 점검 결과
- `prevContent` — AI 변경 전 내용 (undo용)
- 로딩 상태들: `loading`, `saving`, `aiLoading`, `aiQuestionsLoading`, `applyLoading`, `draftLoading`

**디자인 토큰 (`T` 객체)**:
```typescript
const T = {
  border: '1px solid #E5E7EB',
  borderFocus: '1px solid #0F3D73',
  radius: 8, radiusLg: 12, radiusPill: 20,
  input: { border, borderRadius, padding },
  card: { border, borderRadius, background, padding },
  primary: '#0F3D73', danger: '#b91c1c', muted: '#64748b',
  // ...
};
```

### StepFormEditor.tsx — 구조화 편집기

**StepFormData 타입** (30+ 필드):
```typescript
type StepFormData = {
  stepId, title, taskType, purpose, assigneeHint,
  inputs, outputs, completionCondition, worklogHint,
  method, tools, relatedDocs, checkItems, contacts, risks,
  supplierName, supplierContact, cooperationTarget,
  approvalRouteType, approvalRoleCodes,
  emailTo, emailCc, emailSubject, emailBody,
  deadlineOffsetDays, slaHours,
  branches: BranchItem[], needsFiles
}
```

**Progressive Disclosure**: 기본 필드 항상 표시, 상세 필드는 토글로 접기/펼치기
**DSL 파서/시리얼라이저**: `parseTextToStepForms()` ↔ `serializeStepsToText()`

### BpmnEditor.tsx — BPMN 에디터

- Canvas 기반 BPMN 다이어그램 편집
- 노드 유형: start, end, task, gateway_xor, gateway_parallel
- 드래그 & 드롭, 연결선, 조건 편집
- BpmnFormEditor와 연동하여 노드 속성 편집

### ProcessTemplates.tsx — 프로세스 템플릿 관리

- 템플릿 목록 (ACTIVE/DRAFT 필터)
- BPMN 에디터 내장
- 태스크 리스트 편집
- 공개 범위 (PUBLIC/ORG_UNIT/PRIVATE) 설정

## API 호출 패턴

```typescript
// lib/api.ts
import { apiJson } from './lib/api';

// GET
const data = await apiJson<{ items: Item[] }>('/api/work-manuals?userId=xxx');

// POST
const result = await apiJson<Result>('/api/work-manuals', {
  method: 'POST',
  body: JSON.stringify({ userId, title, content }),
});

// 자동으로:
// - VITE_API_BASE를 prefix로 결합
// - localStorage.token을 Authorization: Bearer 헤더에 첨부
// - Content-Type: application/json 설정
// - HTTP 에러 시 Error throw (message = 서버 응답 메시지)
```

## 인증/권한

- **localStorage 기반**: `token` (JWT), `userId`, `userName`, `teamName`
- **권한 가드** (App.tsx):
  - `adminGuard`: CEO만 접근 (`/admin/*`)
  - `evalGuard`: CEO/EXEC/MANAGER/EXTERNAL만 접근 (업무일지 평가)
- **역할 조회**: 앱 마운트 시 `GET /api/users/me?userId=` 호출

## UI 특징

- **인라인 스타일 중심**: CSS-in-JS 패턴 (별도 CSS 파일 최소)
- **토스트 시스템**: `toast()`, `toastConfirm()` 함수 (Toast.tsx)
- **Phase 전환 애니메이션**: CSS `@keyframes fadeInPhase`
- **접근성**: aria-label, aria-current, role="navigation"
- **반응형**: 미적용 (고정 레이아웃, 개선 필요)
