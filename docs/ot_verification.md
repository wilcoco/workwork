# OT 검증 (초과근무 입출입 기록 대조)

## 개요

OT(초과근무) 신청 내역과 실제 입출입 기록을 대조하여 근무 사실을 검증하는 기능.

## 데이터 소스

### 입출입 기록 테이블

| 테이블 | 출처 | 위치 | 식별자 |
|--------|------|------|--------|
| `KtAccessLog` | KT텔레캅 | 복지동, 정문 | 사번(employeeNo) |
| `SecomAlarm` | 에스원 | 함평공장 | 이름(personName) |
| `CapsAlarm` | 캡스 | 사무실 | 사번(employeeNo) 또는 이름 |

### 데이터 동기화

- **방식**: 내부 Oracle DB → Railway PostgreSQL로 푸시
- **엔드포인트**: `POST /api/sync/access-records`
- **인증**: `x-sync-key` 헤더 (환경변수 `SYNC_PUSH_KEY`)
- **소스 구분**: `TB_ACCESS`, `T_SECOM_ALARM`, `T_CAPS_ALARM`

## API 엔드포인트

### 1. OT 검증 목록 조회

```
GET /api/ot-verification
```

**파라미터:**
| 이름 | 필수 | 설명 |
|------|------|------|
| month | N | 조회 월 (YYYY-MM), 기본값: 이번 달 |
| userId | N | 특정 사용자 필터 |
| actorId | N | 요청자 ID (권한 확인용) |
| verifiedOnly | N | 검증된 것만 (true/false) |
| unverifiedOnly | N | 미검증만 (true/false) |

**권한:**
- 임원(CEO/EXEC): 전체 조회 가능
- 일반: 본인 기록만 조회

### 2. 입출입 기록 일일 리포트

```
GET /api/ot-verification/daily-report
```

**파라미터:**
| 이름 | 필수 | 설명 |
|------|------|------|
| date | Y | 조회 날짜 (YYYY-MM-DD) |
| actorId | Y | 요청자 ID |

**응답:**
- 해당 날짜 전체 입출입 기록 (KT/SECOM/CAPS 통합)
- 해당 날짜 OT 신청 목록
- 소스별 건수 요약

**권한:** 임원(CEO/EXEC)만 조회 가능

### 3. 특정 사번 입출입 기록 조회

```
GET /api/ot-verification/access-records
```

**파라미터:**
| 이름 | 필수 | 설명 |
|------|------|------|
| employeeId | Y | 사번 |
| startDate | Y | 시작일 (YYYY-MM-DD) |
| endDate | N | 종료일 (기본: startDate와 동일) |

## 검증 로직

### 기본 원칙

1. **OT 날짜의 입출입 기록 조회**
2. **가장 일찍 찍힌 기록 = 출근**
3. **가장 늦게 찍힌 기록 = 퇴근**
4. **퇴근 시간 ≥ OT 종료 시간이면 검증 OK**

### 검증 상태

| 상태 | 조건 | 표시 |
|------|------|------|
| `OK` | 출근/퇴근 기록 있고, 퇴근이 OT 종료 이후 | ✅ 확인됨 |
| `WARN` | 기록 1건만 있거나, 퇴근이 OT 종료 전 | ⚠️ 경고 |
| `FAIL` | 입출입 기록 없음 | ❌ 미확인 |
| `NO_DATA` | 사번/이름 정보 없음 | ➖ 데이터없음 |

### 사번/이름 매칭

- **KT, CAPS**: 사번(`employeeNo`) 우선, 없으면 이름(`personName`)
- **SECOM**: 이름(`personName`)으로만 매칭 (사번 없음)

### 시간대 기준

모든 날짜/시간 조회는 **KST(+09:00)** 기준:
```typescript
const startAt = new Date(date + 'T00:00:00+09:00');
const endAt = new Date(date + 'T23:59:59+09:00');
```

## 프론트엔드 페이지

### OT 검증 (`/attendance/ot-verification`)

- 월별 OT 신청 목록
- 각 신청별 입출입 기록 대조 결과
- 검증 상태별 필터링
- 요약 통계 (전체/확인/경고/미확인/시간)

### 입출입 리포트 (`/attendance/access-report`)

- 날짜별 전체 입출입 기록 조회
- OT 신청 목록과 함께 표시
- 이름/사번으로 필터링
- 소스별(KT/SECOM/CAPS) 건수 표시

## 특이사항

### 대체휴무(휴일근무) 중복 체크

- OT 신청일에 HOLIDAY_WORK 신청이 있으면 경고 표시
- 메시지: "⚠️ 대체근무일(휴일근무)과 중복 - OT 대신 휴일근무 신청 필요"

### 데이터베이스 스키마

```prisma
model KtAccessLog {
  id         Int       @id @default(autoincrement())
  eventAt    DateTime
  cardNo     String?
  employeeNo String?
  personName String?
  direction  String?
  gateName   String?
  gateId     String?
  deviceId   String?
  resultCode String?
  rawData    Json?
  sourceId   String    @unique
  createdAt  DateTime  @default(now())
}

model SecomAlarm {
  id         Int       @id @default(autoincrement())
  eventAt    DateTime
  cardNo     String?
  employeeNo String?
  personName String?
  direction  String?
  zoneName   String?
  zoneId     String?
  deviceId   String?
  alarmType  String?
  resultCode String?
  rawData    Json?
  sourceId   String    @unique
  createdAt  DateTime  @default(now())
}

model CapsAlarm {
  id         Int       @id @default(autoincrement())
  eventAt    DateTime
  cardNo     String?
  employeeNo String?
  personName String?
  direction  String?
  doorName   String?
  doorId     String?
  deviceId   String?
  alarmType  String?
  resultCode String?
  rawData    Json?
  sourceId   String    @unique
  createdAt  DateTime  @default(now())
}
```

## 관련 파일

- `apps/api/src/ot-verification.controller.ts` - OT 검증 API
- `apps/api/src/sync.controller.ts` - 입출입 기록 동기화 API
- `apps/web/src/pages/OtVerification.tsx` - OT 검증 UI
- `apps/web/src/pages/AccessRecordReport.tsx` - 입출입 리포트 UI
