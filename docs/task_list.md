# Task List

## 완료된 작업

### Work Manual Editor UX 개선 (2025-03)

| ID | Task | 우선순위 | 상태 |
|----|------|---------|------|
| R1 | AI 프롬프트 필드명 불일치 수정 (work-manuals.controller.ts) | HIGH | ✅ 완료 |
| R2 | response_format: { type: 'json_object' } 추가 (4개 AI 엔드포인트) | HIGH | ✅ 완료 |
| R3 | alert()/confirm() → 토스트/배너 교체 (Toast.tsx 신규) | HIGH | ✅ 완료 |
| R4 | StepFormEditor progressive disclosure (접기/펼치기) | HIGH | ✅ 완료 |
| R5 | State 16개 → Custom hooks 분리 | LOW | ⏸ 보류 |
| R6 | AI 변경 diff/되돌리기 UI (prevContent + undo 배너) | MEDIUM | ✅ 완료 |
| R7 | Phase 전환 애니메이션 (fadeInPhase) | MEDIUM | ✅ 완료 |
| R8 | 디자인 토큰 시스템 도입 (T 객체) | MEDIUM | ✅ 완료 |
| R9 | 접근성 (a11y) 개선 (aria-label, aria-current, role) | MEDIUM | ✅ 완료 |
| R10 | 빌드 확인 및 커밋/푸시 | HIGH | ✅ 완료 |

## 미래 개선 과제 (Expert Review 기반)

### 안정성/보안 (P0-P1)

| ID | Task | 출처 | 우선순위 | 상태 |
|----|------|------|---------|------|
| F1 | AI fetch timeout + retry (AbortController 60s) | Amazon | HIGH | 미시작 |
| F2 | 프롬프트 인젝션 방어 (delimiter 태그) | OpenAI | HIGH | 미시작 |
| F3 | AI 출력 검증 (파싱 체크 후 DB 저장) | OpenAI/Anthropic | HIGH | 미시작 |
| F4 | 낙관적 잠금 (expectedVersion 비교) | Amazon | MEDIUM | 미시작 |
| F5 | Undo stack (배열, 최대 5개) | Anthropic | MEDIUM | 미시작 |
| F6 | AI 호출 rate limit (userId별 일일 한도) | Amazon/서비스매니저 | MEDIUM | 미시작 |
| F7 | API Key 메시지 노출 방지 | Amazon | LOW | 미시작 |

### UX 개선 (P2)

| ID | Task | 출처 | 우선순위 | 상태 |
|----|------|------|---------|------|
| U1 | AI 로딩 skeleton UI | X | MEDIUM | 미시작 |
| U2 | 모바일 반응형 레이아웃 | X | MEDIUM | 미시작 |
| U3 | Ctrl+S 저장 단축키 | X | LOW | 미시작 |
| U4 | 빈 상태 CTA (예시 메뉴얼로 시작) | X | LOW | 미시작 |
| U5 | Phase 전환 시 자동저장 경고 | Anthropic | MEDIUM | 미시작 |

### 코드 품질

| ID | Task | 출처 | 우선순위 | 상태 |
|----|------|------|---------|------|
| C1 | 파서 중복 제거 (공통 모듈로 추출) | Google | MEDIUM | 미시작 |
| C2 | WorkManuals.tsx 컴포넌트 분할 (3개) | Google | LOW | 미시작 |
| C3 | Prisma `as any` 제거 | Google | LOW | 미시작 |
| C4 | parser/serializer unit test 추가 | Google | MEDIUM | 미시작 |
| C5 | useMemo(selected) 불필요 코드 삭제 | Google | LOW | 미시작 |
| C6 | OPENAI_MODEL 환경변수 도입 | OpenAI | LOW | 미시작 |

### 비즈니스/운영

| ID | Task | 출처 | 우선순위 | 상태 |
|----|------|------|---------|------|
| B1 | AI 호출 로깅 (input/output 쌍 저장) | 서비스매니저 | MEDIUM | 미시작 |
| B2 | Phase 전환율 로깅 (1→2, 2→3) | 서비스매니저 | LOW | 미시작 |
| B3 | 팀 매뉴얼 공유 (visibility) | 서비스매니저 | MEDIUM | 미시작 |
| B4 | 매뉴얼 템플릿 라이브러리 | 서비스매니저 | LOW | 미시작 |
| B5 | 매뉴얼 버전 diff 비교 | 서비스매니저 | LOW | 미시작 |
