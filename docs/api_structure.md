# API Structure

## 개요

NestJS 기반 REST API. Global prefix `/api`. 포트 3000.
인증은 JWT Bearer + userId 파라미터 병행.

## 컨트롤러 목록

| 컨트롤러 | 경로 prefix | 크기 | 핵심 역할 |
|----------|------------|------|----------|
| `WorkManualsController` | `/work-manuals` | 24KB | 매뉴얼 CRUD + AI 4개 |
| `ProcessTemplatesController` | `/process-templates` | 35KB | 템플릿 CRUD + BPMN 컴파일 |
| `ProcessesController` | `/processes` | 73KB | 프로세스 실행 엔진 |
| `WorklogsController` | `/worklogs` | 85KB | 업무일지 전체 |
| `OkrsController` | `/okrs` | 21KB | OKR CRUD + 맵 + 정렬 |
| `UsersController` | `/users` | 31KB | 사용자 관리 + Teams 동기화 |
| `OrgsController` | `/orgs` | 17KB | 조직 구조 관리 |
| `ApprovalsController` | `/approvals` | 15KB | 전자결재 |
| `HelpTicketsController` | `/help-tickets` | 14KB | 업무 요청 |
| `DelegationsController` | `/delegations` | 3KB | 업무 위임 |
| `AttendanceController` | `/attendance` | 25KB | 근태 관리 |
| `CarDispatchController` | `/car-dispatch` | 6KB | 법인차량 배차 |
| `InitiativesController` | `/initiatives` | 6KB | 과제 관리 |
| `ProgressController` | `/progress` | 8KB | KR/Initiative 진행률 |
| `AdminController` | `/admin` | 26KB | 시스템 관리 |
| `AuthController` | `/auth` | 5KB | 로그인/JWT |
| `EntraAuthController` | `/entra-auth` | 10KB | Entra ID SSO |
| `WorklogEvalsController` | `/worklog-evals` | 14KB | 업무일지 평가 |
| `MastersController` | `/masters` | 3KB | 기준정보 |
| `HealthController` | `/health` | 3KB | 헬스체크 |
| `UploadsController` | `/uploads` | 3KB | 파일 업로드 |
| `NotificationsController` | `/notifications` | 1KB | 알림 |
| `SharesController` | `/shares` | 1KB | 공유 |
| `FeedbacksController` | `/feedbacks` | 3KB | 피드백 |
| `HolidaysController` | `/holidays` | 3KB | 공휴일 |
| `CarsController` | `/cars` | 2KB | 차량 등록 |
| `BrandController` | `/brand` | 1KB | 브랜딩 |
| `MyGoalsController` | `/my-goals` | 3KB | 개인 목표 (레거시) |

## 서비스

| 서비스 | 역할 |
|--------|------|
| `PrismaService` | Prisma 클라이언트 (onModuleInit, enableShutdownHooks) |
| `TeamsNotificationService` | MS Teams Graph API 알림 발송 |

## 핵심 API 엔드포인트

### 업무 매뉴얼 (WorkManuals)

```
GET    /api/work-manuals?userId=            # 내 매뉴얼 목록
POST   /api/work-manuals                    # 생성
PUT    /api/work-manuals/:id                # 수정
DELETE /api/work-manuals/:id?userId=        # 삭제

POST   /api/work-manuals/:id/ai/questions      # AI 보완 질문 생성
POST   /api/work-manuals/:id/ai/apply-answers  # AI 답변 반영
POST   /api/work-manuals/:id/ai/draft-steps    # AI STEP 초안 생성
POST   /api/work-manuals/:id/ai/bpmn           # AI BPMN JSON 생성
```

### 프로세스 템플릿 (ProcessTemplates)

```
GET    /api/process-templates?actorId=       # 목록 (visibility 기반 필터)
GET    /api/process-templates/:id?actorId=   # 상세
POST   /api/process-templates                # 생성 (bpmnJson 포함)
PUT    /api/process-templates/:id            # 수정
DELETE /api/process-templates/:id?actorId=   # 삭제
```

### 프로세스 실행 (Processes)

```
GET    /api/processes?templateId=&status=    # 인스턴스 목록
GET    /api/processes/:id                    # 인스턴스 상세
POST   /api/processes/start                  # 프로세스 시작
POST   /api/processes/:id/tasks/:taskId/complete  # 태스크 완료
POST   /api/processes/:id/tasks/:taskId/skip      # 태스크 스킵
POST   /api/processes/:id/stop                    # 프로세스 중단
```

### 업무일지 (Worklogs)

```
GET    /api/worklogs?userId=&from=&to=       # 목록
POST   /api/worklogs/simple                  # 간편 작성 (KR/Initiative 자동 연결)
POST   /api/worklogs                         # 상세 작성
GET    /api/worklogs/:id                     # 상세 조회
PUT    /api/worklogs/:id                     # 수정
DELETE /api/worklogs/:id                     # 삭제
GET    /api/worklogs/stats                   # 통계
POST   /api/worklogs/ai/analyze              # AI 분석
```

### OKR

```
GET    /api/okrs/my?userId=                  # 내 OKR
GET    /api/okrs/map                         # OKR 맵 (트리)
GET    /api/okrs/parent-krs?userId=          # 정렬 가능한 상위 KR
POST   /api/okrs/objectives                  # Objective 생성 (KR[] 포함)
POST   /api/okrs/objectives/:id/krs          # KR 추가
DELETE /api/okrs/objectives/:id              # Objective 삭제
```

### 인증

```
POST   /api/auth/login                       # 이메일/비밀번호 로그인
POST   /api/auth/signup                      # 회원가입
GET    /api/entra-auth/login                 # Entra ID SSO 시작
POST   /api/entra-auth/callback              # Entra ID 콜백
GET    /api/users/me?userId=                 # 내 정보
```

## AI 통합 상세

### 공통 패턴
```typescript
// 1. API Key 로드
const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;

// 2. 소유권 검증
const manual = await this.requireOwner(uid, id);

// 3. content 클리핑 (12KB)
const clipped = content.length > 12000 ? content.slice(0, 12000) : content;

// 4. OpenAI 호출
const resp = await fetch('https://api.openai.com/v1/chat/completions', {
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }),
});

// 5. JSON 파싱 + 검증
const parsed = JSON.parse(raw);
```

### AI 엔드포인트별 프롬프트 요약

| 엔드포인트 | system 프롬프트 핵심 | 출력 필드 |
|-----------|---------------------|----------|
| `/ai/questions` | 제조업 업무 매뉴얼 검토, 누락/모호 질문 | summary, issues[], questions[] |
| `/ai/apply-answers` | DSL 편집 도우미, 답변 반영 | updatedContent, appliedCount, summary |
| `/ai/draft-steps` | 자유형 → DSL 변환 | draftContent, stepCount, summary |
| `/ai/bpmn` | DSL → BPMN JSON 변환 | title, bpmnJson {nodes[], edges[]} |

## BPMN 컴파일 로직

`ProcessTemplatesController.compileBpmn()`:
1. BPMN JSON의 nodes/edges를 파싱
2. 각 task 노드의 predecessor를 역추적 (gateway 통과)
3. XOR 게이트웨이 → xorGroupKey + xorCondition 추출
4. task 노드를 ProcessTaskTemplate 데이터로 변환

## 환경변수

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `PORT` | API 포트 (기본 3000) |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `JWT_SECRET` | JWT 서명 키 |
| `ENTRA_CLIENT_ID` | Entra ID 앱 클라이언트 ID |
| `ENTRA_CLIENT_SECRET` | Entra ID 앱 시크릿 |
| `ENTRA_TENANT_ID` | Entra ID 테넌트 |
| `TEAMS_NOTIFICATION_WEB_URL` | Teams 알림 웹 URL |
