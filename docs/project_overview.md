# Project Overview — WorkWork

## 서비스 목적

제조업 중심의 **업무 관리 통합 플랫폼**으로, 업무일지·OKR·프로세스 관리·결재·협조 등을 하나의 시스템에서 처리합니다.

핵심 차별점은 **업무 매뉴얼 → AI 분석 → BPMN 프로세스 자동 생성** 파이프라인입니다.
사용자가 자연어로 업무 매뉴얼을 작성하면, AI가 이를 분석하여 구조화된 프로세스 템플릿(BPMN)으로 변환하고, 실제 실행 가능한 워크플로우로 전환합니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| **Frontend** | React 18 + Vite + TypeScript |
| **Backend** | NestJS + TypeScript |
| **Database** | PostgreSQL + Prisma ORM |
| **AI** | OpenAI API (gpt-4o-mini) |
| **Auth** | JWT + Entra ID SSO |
| **Infra** | Railway (API + DB), GitHub |
| **알림** | Microsoft Teams Graph API |

## Monorepo 구조

```
workwork/
├── apps/
│   ├── api/          # NestJS 백엔드 (포트 3000)
│   │   ├── src/      # 컨트롤러 34개, 서비스 2개
│   │   └── prisma/   # schema.prisma (모델 30+)
│   └── web/          # React 프론트엔드 (포트 5173)
│       └── src/
│           ├── pages/       # 48개 페이지
│           ├── components/  # 11개 공통 컴포넌트
│           └── lib/         # API, 유틸
├── docs/             # 프로젝트 문서
├── package.json      # npm workspaces 루트
└── readfirst.txt     # 핵심 결정사항 요약
```

## 현재 구현된 주요 기능

### 1. 업무일지 (Worklog)
- 간편 작성 (WorklogQuickNew)
- 상세 작성 (WorklogNew)
- 검색 / 통계 / AI 분석

### 2. OKR 목표관리
- Objective → Key Result → Initiative 계층 구조
- 역할 기반 정렬 (CEO/EXEC/MANAGER/INDIVIDUAL)
- OKR 트리 / 맵 시각화

### 3. 프로세스 관리
- 프로세스 템플릿 생성/편집 (BPMN 에디터)
- 프로세스 인스턴스 시작/실행
- XOR 게이트웨이 조건 분기
- 작업 유형: WORKLOG, APPROVAL, COOPERATION, TASK

### 4. 업무 매뉴얼 (Work Manual) → AI → BPMN
- 3-Phase 위자드 UI (작성 → AI 분석/보완 → 프로세스 생성)
- DSL 기반 구조화 편집 (StepFormEditor)
- AI 질문 생성 / 답변 반영 / STEP 초안 생성
- AI BPMN JSON 생성 → 프로세스 템플릿 자동 생성

### 5. 결재 / 업무협조
- 결재 올리기/하기/통계
- 업무 요청 보내기/받기/상태 추적

### 6. 기타
- 조직 관리 (OrgUnit 계층)
- 법인차량 배차 / 근태 신청
- Teams 알림 연동
- Entra ID SSO 인증

## 운영 환경

| 환경 | Web | API |
|------|-----|-----|
| **Production** | https://cworks.icams.co.kr | Railway |
| **Local Dev** | http://localhost:5173 | http://localhost:3000 |

## 핵심 설계 결정

1. **OKR 중심 모델**: 업무일지는 KR/Initiative에 연결
2. **DSL 기반 매뉴얼**: `### STEP S1 | 단계명` 포맷으로 AI와 사람 모두 읽기 가능
3. **BPMN 실행 엔진**: 프로세스 인스턴스가 실제 작업 흐름을 실행 (predecessor, XOR 분기)
4. **수동 시드 선호**: 자동 seed 스크립트 없이 수동 입력
5. **파일 업로드 대신 클라우드 URL 공유**: 이미지/파일은 URL로 관리
