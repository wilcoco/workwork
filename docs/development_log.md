# Development Log

## 2025-03-12 — Work Manual Editor UX 대규모 개선

### 작업 내용
업무 매뉴얼 편집기의 3-Phase 위자드 UX를 전문가 관점(Google, Notion, Anthropic, Apple, OpenAI)에서 리뷰하고, 도출된 개선 사항을 High/Medium 우선순위로 모두 적용.

### 수정 파일
| 파일 | 변경 내용 |
|------|----------|
| `apps/api/src/work-manuals.controller.ts` | AI 프롬프트 필드명 통일 (checkItems, method, tools, contacts, risks), response_format 추가 |
| `apps/web/src/components/Toast.tsx` | **신규** — 토스트 알림 + 확인 모달 컴포넌트 |
| `apps/web/src/App.tsx` | ToastContainer 마운트 |
| `apps/web/src/pages/WorkManuals.tsx` | alert→toast 교체, Phase 애니메이션, AI undo 배너, 디자인 토큰, a11y |
| `apps/web/src/components/StepFormEditor.tsx` | Progressive disclosure, toast, a11y, section 시맨틱 |

### 구현 기능
- **토스트 시스템**: `toast()`, `toastConfirm()` 비차단 알림
- **Progressive disclosure**: StepFormEditor 상세 필드 접기/펼치기
- **Phase 전환 애니메이션**: CSS @keyframes fadeInPhase
- **AI diff/undo**: prevContent 저장, 되돌리기 배너
- **디자인 토큰**: `T` 객체로 스타일 상수 통일
- **접근성**: aria-label, aria-current, role="navigation", 터치 타겟 확대

### 커밋
- `0cececf` — Work Manual Editor: UX improvements (5 files, +315 -151)

### Expert Review 결과 요약
- Amazon: timeout/retry, 낙관적 잠금, rate limit 필요
- Google: 파서 중복 제거, 컴포넌트 분할, 테스트 필요
- OpenAI: 프롬프트 인젝션 방어, AI 출력 검증, structured outputs
- Anthropic: Undo stack, Phase 전환 시 자동저장, 에러 메시지 번역
- X: Skeleton UI, 모바일 반응형, 키보드 단축키

### 다음 작업
- F1~F3: AI 안정성/보안 (timeout, 인젝션 방어, 출력 검증)
- C1: 파서 중복 제거 + 공통 모듈
- C4: parser/serializer unit test

---

## 2025-03-13 — 프로젝트 문서화 (docs/)

### 작업 내용
프로젝트 전체 구조를 분석하고 docs/ 폴더에 8개 문서를 생성.

### 생성 파일
| 파일 | 내용 |
|------|------|
| `docs/project_overview.md` | 서비스 목적, 기술 스택, 기능 요약 |
| `docs/system_architecture.md` | 전체 아키텍처, Frontend/Backend 구조 |
| `docs/database_schema.md` | Prisma 스키마 30+ 모델 정리 |
| `docs/api_structure.md` | API 엔드포인트, 컨트롤러 목록 |
| `docs/frontend_structure.md` | 페이지/컴포넌트/상태 관리 |
| `docs/bpmn_generation_logic.md` | DSL→AI→BPMN 파이프라인 |
| `docs/task_list.md` | 완료/미래 작업 목록 |
| `docs/development_log.md` | 개발 이력 |
