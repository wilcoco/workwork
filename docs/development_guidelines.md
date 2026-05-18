# 개발 가이드라인 및 코딩 규칙

## 전역 정책

### 파일/이미지 첨부 정책
- **원칙**: OneDrive(또는 SharePoint) URL 붙여넣기만 허용
- **금지**: 직접 파일 업로드(`/api/uploads`) 불가
- **적용 범위**: 수정보완(WorklogSupplement), 업무일지, 댓글 등 모든 첨부 영역
- **URL 처리**: `toOneDriveDirectUrl()` 함수로 OneDrive 직접 링크 변환
- **Quill 에디터**: 이미지 삽입은 URL 프롬프트만 허용, base64 embed/drag-drop 차단

### Graph API Teams 알림 제약사항
1. `topic.webUrl`은 반드시 Teams deep link (`https://teams.microsoft.com/l/...`)이어야 함. 일반 HTTPS URL은 400 오류
2. `topic.value`는 128자 이하, 한 줄, URL 문자열 포함 불가
3. `previewText.content`도 URL 문자열 거부
4. 안전한 포맷: `[홍길동] 결재 요청` 같은 짧은 텍스트만 사용
5. `buildTeamsTopicWebUrl()` 메서드가 유효한 Teams deep link 반환
   - `TEAMS_ACTIVITY_WEB_URL` 환경변수 우선
   - 없으면 `https://teams.microsoft.com/l/chat/0/0?users={upn}` fallback
6. 프로젝트 `WEB_BASE_URL`: `https://worklog.icams.co.kr`

### 테스트 정책
- 사용자는 로컬 개발 서버에서 테스트하는 것을 선호하지 않음
- 배포된 버전에서만 오류 검증
- 필요시 빌드/타입체크 명령만 실행 (서버 시작 X)

### 언어 스타일
- 비공식 한국어(반말) 사용 가능
- 업무가 잘 되는 것이 중요

---

## 공통 모듈 및 라이브러리

### API (`lib/api.ts`)
- `apiFetch(url, options?)`: 토큰 자동 포함 fetch 래퍼
- `apiJson(url, options?)`: JSON 응답 자동 파싱
- `apiUrl(path)`: API 베이스 URL 조합

### OneDrive (`lib/onedrive.ts`)
- `toOneDriveDirectUrl(url)`: OneDrive 공유 URL → 직접 다운로드 링크 변환

### 시간 포맷 (`lib/time.ts`)
- `formatKstDatetime(date)`: KST 날짜시간 포맷
- `formatKstYmd(date)`: KST YYYY-MM-DD 포맷
- `formatMinutesAsHmKo(minutes)`: 분 → 한국어 시간 포맷 (예: 1시간 30분)

### 리치 텍스트 (`lib/richText.ts`)
- `toSafeHtml(html)`: 안전한 HTML 변환

---

## 프로젝트 특화 기능

### 업무일지 구조화 개편 (로드맵)
- **Phase A**: 업무일지 구조화 (WorklogQuickNew에 5섹션 모드: 금일업무/진행중/이슈/익일계획/특이사항)
- **Phase B**: 주간 리포트 신규 (Weekly Status Report - AI 자동 집계)
- **Phase C**: 자유형 해시태그 시스템 (#사출 #ERP 등)
- **Phase D**: AI 자동 연결 (주간리포트 자동생성, 반복업무→매뉴얼 제안)
- 문서: `docs/improvement_roadmap.md`

### Work Manual Externalization System (AI 매뉴얼 외재화)

**5 Base Types:**
- `procedure` (업무절차)
- `dev_project` (개발프로젝트)
- `system_operation` (시스템조작)
- `calculation` (계산/산출)
- `inspection_mgmt` (점검/관리)

**5 Phases:**
1. Initial Input
2. AI Structured Questions
3. Options Selection
4. Output Generation + Module Integration
5. Review & Tacit Knowledge

**Module Integration:**
- `bpmn_engine`: 기존 (procedure base type)
- `schedule_mgmt`: 신규 (dev_project base type)
- `knowledge_base`: 기존 (system_operation, calculation)
- `periodic_alarm_report`: 신규 (inspection_mgmt)
- `security_module`: 기존 (option)

**관련 파일:**
- Frontend: `apps/web/src/pages/WorkManuals.tsx`
- Backend: `apps/api/src/work-manuals.controller.ts`
- Schema: `apps/api/prisma/schema.prisma` (WorkLog model at line 304)

### Skill File 시스템

**DB:** WorkSkillFile 모델 (skillData Json, qaHistory Json, version Int, status String)

**백엔드 엔드포인트 (`work-manuals.controller.ts`):**
- `POST :id/skill-file` — 메뉴얼 → Skill File 생성 (Claude Tool Use + Extended Thinking / OpenAI fallback)
- `GET :id/skill-file` — 최신 Skill File 조회
- `POST :id/skill-file/to-bpmn` — Skill File → BPMN 변환
- `POST :id/skill-file/to-schedule` — Skill File → Schedule (마일스톤 자동 추출)
- `POST :id/skill-file/to-knowledge-base` — Skill File → KnowledgeBase (steps+faq+tacit 통합 문서)
- `POST :id/skill-file/to-periodic-alarm` — Skill File → PeriodicAlarm (체크리스트+주기 추론)
- `POST :id/skill-qa` — Skill File 기반 Q&A 챗봇 (대화 이력 qaHistory 누적)

**Skill File 스키마:**
- meta, overview, actors
- steps (tips, commonMistakes)
- decisions, exceptions
- relatedKnowledge, tacitKnowledge
- faq, handover

**프론트엔드 대메뉴 모드 선택 (`WorkManualExt.tsx`):**
- `workMode` 상태: `'classic'` | `'skill-plus'` | `'skill-center'`
- 📄 기존 방식: 5단계 위저드 + from-manual 모듈, Skill 기능 숨김
- 🧠 스킬 추가 버전: 기존 + Skill File 패널(Q&A/인수인계/모듈생성) 보조
- ⚡ 스킬 중심 버전: Phase 4에서 from-manual 숨김, Skill File→모듈 직접 생성, Phase 5를 Skill File 인수인계+Q&A로 대체

**Skill File 패널:** 480px 슬라이드 사이드바 — 개요/단계/FAQ/모듈생성/Q&A 5탭
**플로팅 버튼:** classic 모드 숨김, skill-plus/skill-center에서 표시

### 전자결재/업무협조 분리 계획
- 전사 공용 업무일지 개편: 전자결재와 업무협조를 별도 메뉴로 분리
- 전자결재: 제출/결재함(내게 올라온)/내가 올린 결재 진행 조회
- 결재선: 조직도에서 다단계 순차로 구성(여러 명 가능, 순서대로 결재)
- 진행 단계별 상태 추적
- 내가 즐겨쓰는 결재선 저장
- 전자결재 연동 및 전자서명/타임스탬프 필요
- 업무협조: 특정 팀/개인에게 요청, 수락/거절 후 진행, 응답/산출물 업로드, 내가 보낸 협조 진행 추적, 내 협조함에서 처리
- 공개 범위: 비공개/제한 범위 지원(필요시 공개 확장)
- 알림: 인박스/메일/Slack 및 리마인더/에스컬레이션
- 리포트: 결재 리드타임/단계별 소요, 협업 수락·완료 리드타임
- 초기 데이터: 자동 시드 없이 수동 입력 선호

---

## 데이터베이스 마이그레이션

### 마이그레이션 파일 위치
- `apps/api/prisma/migrations/`

### 마이그레이션 실행
- 개발: `npm run prisma:migrate:dev`
- 배포: `npm run prisma:migrate:deploy` (start 스크립트에 포함됨)
- 스키마 생성: `npx prisma generate`

---

## 권한 및 역할

### 역할 계층
- `CEO`: 대표이사
- `EXEC`: 임원
- `MANAGER`: 팀장
- 기타: 일반 사용자

### 권한 체크 패턴
```typescript
// 역할 API에서 가져오기 (localStorage 사용 금지)
const userId = localStorage.getItem('userId');
const me = await apiJson(`/api/users/me?userId=${userId}`);
const myRole = String(me?.role || '').toUpperCase();
const isExec = myRole === 'CEO' || myRole === 'EXEC';
const isManager = isExec || myRole === 'MANAGER';
```

---

## 기술 스택

### 백엔드
- NestJS
- Prisma ORM
- PostgreSQL

### 프론트엔드
- React
- TypeScript
- Vite

### 인증
- Microsoft Entra ID
- Teams SSO
