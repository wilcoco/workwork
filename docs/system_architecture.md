# System Architecture

## 전체 아키텍처

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   React App  │────▶│  NestJS API  │────▶│  PostgreSQL  │
│  (Vite/TS)   │     │  (Express)   │     │  (Prisma)    │
│  port 5173   │     │  port 3000   │     │  Railway     │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                    ┌───────┴───────┐
                    │               │
              ┌─────▼─────┐  ┌─────▼──────┐
              │ OpenAI API │  │ MS Graph   │
              │ gpt-4o-mini│  │ Teams 알림  │
              └───────────┘  └────────────┘
```

## Frontend (apps/web)

### 구조
```
apps/web/src/
├── App.tsx              # 라우팅, AppShell, 권한 가드
├── main.tsx             # React 앱 진입점
├── pages/               # 48개 페이지 컴포넌트
│   ├── WorkManuals.tsx      # 업무 매뉴얼 3-Phase 위자드
│   ├── ProcessTemplates.tsx # 프로세스 템플릿 관리 + BPMN 에디터
│   ├── ProcessStart.tsx     # 프로세스 시작
│   ├── ProcessInstanceDetail.tsx # 프로세스 실행 상세
│   ├── WorklogQuickNew.tsx  # 간편 업무일지 작성
│   ├── Home.tsx             # 대시보드
│   └── ...
├── components/          # 11개 공유 컴포넌트
│   ├── BpmnEditor.tsx       # BPMN 다이어그램 편집기
│   ├── BpmnFormEditor.tsx   # BPMN 노드 폼 편집
│   ├── StepFormEditor.tsx   # 매뉴얼 STEP 구조화 편집기
│   ├── Toast.tsx            # 토스트/확인 모달
│   └── ...
├── lib/                 # 유틸리티
│   ├── api.ts               # API 호출 (apiJson, apiFetch)
│   ├── richText.ts          # Quill 에디터 유틸
│   ├── time.ts              # 시간 포맷
│   └── upload.ts            # 업로드 유틸
└── styles/              # CSS
```

### 상태 관리
- **전역 상태 없음**: Context/Redux 미사용, 각 페이지가 자체 useState로 관리
- **인증**: localStorage에 `token`, `userId`, `userName`, `teamName` 저장
- **API 호출**: `apiJson<T>()` 유틸로 통일 (JWT Bearer 자동 첨부)

### 라우팅 구조
| 경로 | 페이지 | 설명 |
|------|--------|------|
| `/` | Home | 대시보드 |
| `/manuals` | WorkManuals | 업무 매뉴얼 편집기 |
| `/process/templates` | ProcessTemplates | 프로세스 템플릿 |
| `/process/start` | ProcessStart | 프로세스 시작 |
| `/process/my` | ProcessMy | 참여 프로세스 |
| `/process/dashboard` | ProcessDashboard | 프로세스 대시보드 |
| `/quick` | WorklogQuickNew | 간편 업무일지 |
| `/okr/*` | OKR 관련 | 목표관리 |
| `/approvals/*` | 결재 관련 | 전자결재 |
| `/coops/*` | 협조 관련 | 업무 요청 |
| `/admin/*` | 관리 | CEO 전용 (가드) |

## Backend (apps/api)

### 구조
```
apps/api/src/
├── main.ts                      # NestJS 부트스트랩 (prefix: /api)
├── app.module.ts                # 모듈 등록 (컨트롤러 30+, 서비스 2)
├── prisma.service.ts            # Prisma 클라이언트 서비스
│
├── work-manuals.controller.ts   # 업무 매뉴얼 CRUD + AI 4개 엔드포인트
├── process-templates.controller.ts # 프로세스 템플릿 CRUD + BPMN 컴파일
├── processes.controller.ts      # 프로세스 인스턴스 실행 엔진
│
├── worklogs.controller.ts       # 업무일지 (가장 큰 파일: 85KB)
├── okrs.controller.ts           # OKR 관리
├── approvals.controller.ts      # 전자결재
├── users.controller.ts          # 사용자/인증
├── orgs.controller.ts           # 조직 관리
│
├── teams-notification.service.ts # MS Teams 알림
├── entra-auth.controller.ts      # Entra ID SSO
└── ...
```

### API 패턴
- **Global prefix**: `/api` (main.ts)
- **인증**: userId를 쿼리 파라미터/body로 전달, 서버에서 DB 검증
- **JWT**: Bearer 토큰을 Authorization 헤더로 전달
- **CORS**: origin: true (모든 출처 허용)
- **Validation**: class-validator + ValidationPipe (whitelist + transform)

### 핵심 컨트롤러 역할

| 컨트롤러 | 크기 | 역할 |
|----------|------|------|
| `processes.controller.ts` | 73KB | 프로세스 실행 엔진 (시작, 완료, XOR 분기, 이메일, 결재 연동) |
| `worklogs.controller.ts` | 85KB | 업무일지 CRUD, 통계, AI 분석 |
| `process-templates.controller.ts` | 35KB | 템플릿 CRUD, BPMN 컴파일, 버전 diff |
| `work-manuals.controller.ts` | 24KB | 매뉴얼 CRUD + AI 4개 엔드포인트 |
| `users.controller.ts` | 31KB | 사용자 CRUD, Teams 프로필 싱크 |
| `okrs.controller.ts` | 21KB | OKR 관리, 역할 기반 정렬 |

## AI 통합

### OpenAI 호출 포인트

| 엔드포인트 | 입력 | 출력 | 용도 |
|-----------|------|------|------|
| `POST /api/work-manuals/:id/ai/questions` | 매뉴얼 content | questions[], issues[] | 누락/모호 항목 질문 생성 |
| `POST /api/work-manuals/:id/ai/apply-answers` | content + answers | updatedContent | 답변을 매뉴얼에 반영 |
| `POST /api/work-manuals/:id/ai/draft-steps` | 자유형 content | DSL 포맷 draftContent | STEP 블록 초안 생성 |
| `POST /api/work-manuals/:id/ai/bpmn` | DSL content | bpmnJson (nodes/edges) | BPMN 프로세스 JSON 생성 |

### AI 설정
- **모델**: gpt-4o-mini (4곳 하드코딩)
- **temperature**: 0.1~0.2
- **response_format**: `{ type: 'json_object' }`
- **content 제한**: 12,000자 클리핑

## 인증 흐름

```
[브라우저]                    [API]                    [Entra ID]
   │                           │                          │
   ├── GET /auth/entra ────────▶ redirect ────────────────▶
   │                           │                          │
   ◀── code callback ─────────┤◀── token ────────────────┤
   │                           │                          │
   ├── POST /auth/entra ───────▶ verify token             │
   │                           │  find/create User        │
   │                           │  check status=ACTIVE     │
   ◀── JWT + userId ───────────┤                          │
   │                           │                          │
   ├── localStorage.token ─────│                          │
   ├── localStorage.userId ────│                          │
```

## 배포 구조

```
GitHub (main branch)
       │
       ▼
   Railway
   ├── API Service (NestJS)
   │   ├── Dockerfile/Nixpacks
   │   ├── prisma migrate deploy
   │   └── PORT=3000
   │
   ├── Web Service (Vite build → static)
   │   └── VITE_API_BASE=https://workworkapi-production.up.railway.app
   │
   └── PostgreSQL Database
       └── DATABASE_URL
```
