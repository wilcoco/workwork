# myvboro — 프로젝트 킥오프 문서

> 새 Claude Code 세션 (`wilcoco/myvboro` 레포)을 시작할 때 첫 메시지로 통째로 붙여넣어 사용.
> 모든 의사결정·컨셉·아키텍처가 이 한 장에 압축되어 있음.

---

## 1. 프로젝트 한 줄

**위치·지식 영토를 사용자 증거(사진+GPS)로 가꾸는 글로벌 신뢰 기반 맛집/지식 공유 서비스.**

비유: "AI 대화판 GitHub × Foursquare × Stack Overflow" — 단, 광고가 구조적으로 못 끼는 형태.

---

## 2. 핵심 인사이트 (왜 이 서비스인가)

1. **AI의 최대 사각지대 = 맛집** — 학습 데이터 시차, 블로그 SEO 오염, 주관성, 시간성, 환각. AI 단독으론 절대 못 풂.
2. **기존 대안 다 망가짐** — 네이버 플레이스(협찬), 망고플레이트(죽음), 인스타(광고), 블로그(SEO).
3. **빈자리** = "신뢰할 수 있는 사람들이 AI와 함께 정리한 동네 지식".
4. **콜드 스타트 해법 = 영토 게임 메커닉** — 세균전처럼 지역/지식을 점거·확장·협업·전투. 빈 땅이 단점이 아니라 기회.
5. **POI를 외부 API에 의탁하지 않음** — 사용자 사진+GPS 증거로 emergent하게 Place 구축. 같은 건물 1·2층, 옆 가게 구분까지 사진 유사도로 자체 해결. **이게 진짜 데이터 해자.**

---

## 3. 핵심 메커닉

### 3-1. 두 종류 맵
- **지리맵**: 실제 지도. 맛집·카페·장소 기반 지식.
- **지식맵 (v2+)**: 카테고리/주제 기반 추상 공간. 일반 지식용.

MVP는 **지리맵만**.

### 3-2. POI = Evidence-first
- 외부 POI API(Foursquare, Google Places) **사용 안 함**.
- 사용자가 등록한 **정면 사진 + 메뉴 사진 + GPS**로 Place가 emergent하게 형성.
- 지도 표시 = **핀이 아닌 원**:
  - 반경 = 위치 불확실성 (방문 GPS의 표준편차)
  - 색 농도 = 신뢰도 (방문 수, 권위 합)
  - 신규 Place: 흐릿한 큰 원 → 방문 누적 → 작고 진한 원
- **이것이 시각적 시그니처**. 타사가 흉내 못 냄.

### 3-3. AI 클러스터링 (선택 B 확정)
같은 가게가 다른 이름/위치로 등록되면 자동 통합:
```
신뢰도 = α·이름 임베딩 유사도 + β·사진(정면) CLIP 임베딩 + γ·GPS 거리
  ≥ 0.9  → 자동 merge
  0.6~0.9 → 사용자에 "같은 곳?" 확인
  < 0.6  → 새 Place
```
- 추천/줄서기는 canonical Place에 집계 (alias로 검색해도 통합 결과)
- 모든 merge는 audit log로 되돌리기 가능
- 신고 누적 시 자동 split → 재검토

### 3-4. 증명 계단 (가중치)
방문/식사/지불을 증명할수록 권위 가중치 ↑:
| Tier | 방식 | 가중치 | MVP 포함 |
|---|---|---|---|
| 0 | 텍스트만 | 1x | ✅ |
| 1 | GPS 통과 | 2x | ✅ |
| 2 | GPS 체류 15분+ | 4x | ✅ |
| 3 | 인앱 카메라 사진 (EXIF+GPS) | 7x | ✅ |
| 4 | 음식 사진 + AI 메뉴 일치 검증 | 10x | (v1.5) |
| 5 | 영수증 OCR | 20x | **v2** |
| 6 | 반복 방문 (시간 간격) | ×배수 | ✅ |

**시간 감쇠**: 6개월마다 50% 감쇠 (가게는 변함).

### 3-5. 권위·신뢰 시스템
사용자별 점수:
- **Breadth Score**: 고유 방문 노드 수 (log)
- **Distribution Score**: 지리·카테고리 분산도 (엔트로피) — **광고 어카운트 자동 차단의 핵심**
- **Authority Score**: 내 추천 → 줄선 사람 수 × 평균 만족도
- **Consistency Score**: 내 평가가 후속 방문자 평가와 일치하는 비율
- **Hit Rate**: "별로다" 평가도 정확한지 (negative review 없으면 광고 의심)

### 3-6. 줄서기 메커닉 (4단 폐쇄 루프)
```
A "여기 좋다" → B "A 추천 보고 갈래" 줄섬
            → B 실제 방문 (Tier 2-5 증명)
              → B 만족 평가
                → A 권위 +1, B-A 신뢰 링크 강화
```
단순 upvote와 달리 4단 검증 → 봇으로 못 뚫음.

### 3-7. 구조적 안티-광고
| 패턴 | 진짜 | 광고 |
|---|---|---|
| 노드 분포 | 동네 전체 흩어짐 | 1-3곳 집중 |
| 카테고리 | 다양 | 단일 |
| 평가 분포 | 좋음/별로 섞임 | 다 좋음 |
| 줄서기 만족도 | 높음 | 낮음 (페널티) |
패턴매칭 ML 필요 없음 — "다른 곳도 평가해봤어?" 하나로 90% 잡힘.

---

## 4. MVP 범위 (두 메뉴 + 프로필)

### 메뉴1: 등록
- 내 위치 표시
- 가게 정면 사진, 음식 사진, 메뉴 사진 업로드
- 근처 50m 내 기존 Place 자동 후보 추천 → 선택 or 새로 만들기
- (인앱 카메라 우선, 갤러리 업로드는 가중치 낮춤)

### 메뉴2: 검색
- 지역 기반 (현재 위치 또는 지도 영역)
- 정렬: **권위 × 줄서기 길이 × 만족도** 가중합
- 결과는 원형으로 지도에 표시

### 프로필
- 다녀온 장소 전부 한눈에 (지도 위 본인 노드들)
- 권위 점수, breadth, distribution
- 공개/비공개/팔로워만 토글

---

## 5. 기술 스택 (확정)

```
Frontend:   Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
Map:        MapLibre GL JS + Mapbox raster tiles
Auth:       Auth.js (Google + 이메일 매직링크)
i18n:       next-intl (en, ko 시작 — 처음부터 다국어 구조)
DB:         PostgreSQL + PostGIS (Railway)
ORM:        Prisma (PostGIS는 raw query 병행)
Storage:    Cloudflare R2 (이미지)
Embeddings: OpenAI (text-embedding-3-small for names, CLIP via API for photos)
Deploy:     Railway (nixpacks)
모바일:     PWA로 시작 (React Native는 검증 후)
```

**의도적으로 안 쓰는 것**:
- 카카오맵, 네이버맵 (한국 종속)
- Foursquare/Google Places API (POI는 자체 구축)
- 영수증 OCR (v2)

---

## 6. 데이터 모델 스케치

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String?
  image           String?
  authorityScore  Float    @default(0)
  breadthScore    Float    @default(0)
  distributionScore Float  @default(0)
  visits          Visit[]
  endorsements    Endorsement[]
  createdAt       DateTime @default(now())
}

model Place {
  id              String   @id @default(cuid())
  // canonical 정보
  primaryName     String
  aliases         Json     // [{name, count, lang}]
  centroidLat     Float
  centroidLng     Float
  radiusMeters    Float    // 위치 불확실성
  confidence      Float    // 클러스터 응집도 (0-1)
  // 사진 임베딩 평균 (정면 사진)
  storefrontEmbedding Json?
  // 메타
  visits          Visit[]
  visitCount      Int      @default(0)
  authoritySum    Float    @default(0)
  endorsementCount Int     @default(0)
  createdAt       DateTime @default(now())
  // PostGIS: location geography(POINT, 4326) - migration에서 추가
}

model Visit {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  placeId         String?
  place           Place?   @relation(fields: [placeId], references: [id])
  rawName         String   // 사용자가 입력한 이름
  lat             Float
  lng             Float
  gpsAccuracy     Float?
  dwellTimeSec    Int?
  tier            Int      // 0~6 증명 단계
  weight          Float    // 가중치
  photos          Photo[]
  visitedAt       DateTime
  createdAt       DateTime @default(now())
}

model Photo {
  id              String   @id @default(cuid())
  visitId         String
  visit           Visit    @relation(fields: [visitId], references: [id])
  kind            PhotoKind // STOREFRONT | MENU | FOOD | INTERIOR | RECEIPT
  url             String   // R2 URL
  exifTime        DateTime?
  exifLat         Float?
  exifLng         Float?
  perceptualHash  String?
  clipEmbedding   Json?
  createdAt       DateTime @default(now())
}

enum PhotoKind { STOREFRONT MENU FOOD INTERIOR RECEIPT }

model Endorsement {
  // "줄서기" — A 추천 → B 줄섬 → B 방문 → B 만족
  id              String   @id @default(cuid())
  fromUserId      String   // 추천한 사람
  toUserId        String   // 줄선 사람 (= 방문한 사람)
  placeId         String
  visitId         String?  // 줄서기가 실제 방문으로 이어진 경우
  satisfaction    Int?     // null = 아직 방문 전, 1-5 = 방문 후 평가
  createdAt       DateTime @default(now())
  visitedAt       DateTime?
}

model PlaceMerge {
  id              String   @id @default(cuid())
  fromPlaceId     String
  toPlaceId       String
  mergedBy        String   // "ai" | userId
  confidence      Float
  reversible      Boolean  @default(true)
  createdAt       DateTime @default(now())
}
```

---

## 7. 진화 로드맵

**MVP (v1)**:
- 등록·검색·프로필
- 사용자 직접 Place 선택 (또는 새로 만들기)
- GPS + 사진(정면/음식/메뉴) Tier 0-3
- 권위 점수 단순 계산
- 줄서기 "가보고 싶음" 버튼

**v1.5**:
- 사진 perceptual hash 자동 후보 추천
- 음식 사진 메뉴 일치 AI 검증 (Tier 4)
- 다국어 이름 임베딩 자동 alias 통합

**v2**:
- 영수증 OCR (Tier 5)
- CLIP 임베딩 자동 merge/split
- 지식맵 (카테고리 기반) 추가
- AI 대화 통합 (Place별 채팅, 동네 봇)

**v3+**:
- 마이데이터 연동 (한국 등 가능 지역)
- 영토 게임 메커닉 강화 (시즌, 길드)
- 팀/조직 비공개 영토

---

## 8. 첫 타깃 도시 (콜드 스타트)
- **서울** (한국어+영어 듀얼) 또는
- **도쿄/싱가포르** (식문화 풍부 + 영어 OK)
- **미국은 비추** (Yelp/Google 두꺼움)

MVP 검증은 한 도시 한 카테고리(예: 강남 카페)로 좁히기.

---

## 9. 새 세션 첫 작업 지시

위 내용 이해했으면 다음 순서로 MVP 1단계 진행:

1. **프로젝트 초기 세팅** — `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`
2. **Railway 배포 설정** — `nixpacks.toml` (Node + Postgres + PostGIS 확장)
3. **Prisma 스키마** — 위 6장의 모델 그대로 + PostGIS migration (geography 컬럼, GIST 인덱스)
4. **Auth.js 세팅** — Google + 이메일 매직링크 (Resend 권장)
5. **i18n 세팅** — next-intl, `/en` `/ko` 라우팅
6. **지도 페이지** — `/[locale]/map`, MapLibre + Mapbox 타일 + 내 위치 마커
7. **README** — 설치/실행/배포 가이드

각 단계 끝나면 커밋. 1단계부터 시작.

---

## 10. 주의사항

- **이 서비스는 글로벌**. 한국 종속 SDK·API 절대 안 씀.
- **POI는 자체 구축**. 외부 POI API에 의존 금지 (참고용 fallback만 가능).
- **지도 표시는 원형**. 핀 사용 금지 (시그니처).
- **i18n 처음부터**. 영어 우선, 한글 병행.
- **모바일 우선**. 데스크탑은 부수적.
- **광고 차단은 메커닉으로**. 사후 신고가 아닌 구조적 차단.
- **인앱 카메라 우선**. 갤러리 업로드는 가중치 낮춤.
