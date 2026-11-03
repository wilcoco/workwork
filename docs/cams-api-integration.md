# 품의서·전표 — CAMS 공식 API 연동 (2026-11-04 전환)

이전: 레거시 ASP.NET 화면(`/boss/mpu.aspx`, `/acco/*_list.aspx`)을 **HTTP로 긁어 HTML 파싱**(`cams.util.ts`, 삭제됨).
현재: 사내에서 제공하는 **JSON API**(사양서 `API_사용법.md`, 2026-10-20) 사용.

## 서버 설정 (저장소에 키를 두지 않는다)

| 환경변수 | 값 | 비고 |
|---|---|---|
| `CAMS_API_KEY` | (Railway `@workwork/api`에 설정됨) | 헤더 `X-API-KEY`. 교체 시 사내 `D:\cn\api\web.config`·`D:\cn\web.config`와 같이 변경 |
| `CAMS_API_BASE` | `https://cn.icams.co.kr` | 기본값 동일 |

테넌트 설정(관리 → 회사 설정): `cams.allowedUserIds`(조회 허용 계정), `cams.writeEnabled`(결재·반려 사용, **기본 false**).

## ⚠ 중요한 발견 — 응답 인코딩

서버가 `Content-Type: application/json; charset=utf-8`로 보내지만 **실제 바이트는 CP949(EUC-KR)**다.
그대로 `res.json()` 하면 한글이 전부 깨진다. `cams-api.service.ts`는 바이트를 받아 **UTF-8 엄격 디코딩 → 실패 시 EUC-KR**로 처리한다(사내 서버가 UTF-8로 고쳐도 그대로 동작).
→ 사내 서버 쪽에서 실제 UTF-8로 출력하도록 고치는 것이 근본 해결. 다른 연동처도 같은 문제를 겪는다.

## 코드

- `apps/api/src/cams-api.service.ts` — 클라이언트(data/file/act) + 응답 → 화면 `grids` 매핑
- `apps/api/src/proposals.controller.ts`, `vouchers.controller.ts` — list/file/approve/reject/health
- `apps/web/src/components/CamsBrowser.tsx` — 기간 선택 UI, 서버가 준 구역 이름(`grid.label`) 우선, **필드 이름 기반 값 매핑**

### 엔드포인트

| 경로 | 설명 |
|---|---|
| `GET /api/proposals/list?from&to[&sbn]` | 기간별 품의 목록 (기본 90일) |
| `GET /api/proposals/list?slpNo=` | 품의 상세 — 품의 정보·첨부·결재선·결재이력 |
| `GET /api/proposals/file?slpNo&sort&filename` | 첨부 다운로드(프록시, 대용량 스트리밍) |
| `POST /api/proposals/approve` / `/reject` | 결재·반려 (**기본 잠금**) |
| `GET /api/proposals/health` | 키 설정·연결·쓰기 허용 여부 점검 |
| `GET /api/vouchers/*` | 동일 (기본 30일, 첨부는 `src=ac`) |

### 결재·반려 안전장치
운영 회계 DB에 직접 INSERT/UPDATE가 일어나므로 3중 잠금:
1. `cams.writeEnabled`가 true여야 함 (기본 false)
2. `cams.allowedUserIds`에 있는 계정만
3. **그 문서의 결재선에 내 사번(`User.employeeNo`)이 있고 아직 미결(GSTATUS='01')** 일 때만
호출 시 `comnm=WORKWORK`로 감사 로그에 남는다.

## 필드 매핑

품의 상세 `asp` → `pu_main`: SLPNO→slpno, TITLE→title, AIM→purpose, SBNNAME→sname, SBN→sabun, PYMD→date, WYMD→duedate, SAMT→amount, GJO→payterm, GCOMP→company, CONT→content
전표 `psp` → `ac_main`: PSPSLPNO→slpno, PSPPYMD→accdate, SBNNAME→sname, PSPDRAMT→dramt, PSPCRAMT→cramt, PSPDSG→apryn, PSPCNLSG→cancelyn, PSPDYMD→signdate, PSPSDT→inpdt
전표 `items` → `ac_items`: ASPDCSG→aspdcsg(1=차변/2=대변), ASPACD→aspacd, ACDNAME→acctnm, ASPAMT→aspamt, ASPNOTE→aspnote
공통: `line`→결재선(SEQ→signorder, SNAME→empname, JNAME→position, GSTATUS→approvalstatus 한글), `log`→결재 이력, `files`→첨부(FNM/SORT/FSIZE)

> 전환 중 겪은 버그: 기존 서식이 그리드 **필드 순서**로 값을 꺼내고 있어 필드가 하나 늘자 기안일자·금액·내용이 한 칸씩 밀렸다. 지금은 **이름으로만** 찾고, 이름이 지정된 칸은 값이 없으면 빈칸으로 둔다.

## 검증 (2026-11-04, 운영)

- 품의 목록 90일 **399건**, 전표 30일 **270건**, 한글 정상
- 품의 상세(202611030002): 결재선 6명·첨부 4건·금액 63,000,000원 정상
- 첨부 프록시: 1.2MB xlsx 200 OK
- `health`: ok, 최근 7일 31건, `writeEnabled=false`
- 결재·반려는 **호출하지 않음**(운영 반영되는 쓰기라 대표 승인 후 테스트)

## 남은 일

1. 사내 서버: JSON 응답을 실제 UTF-8로 출력 (지금은 CP949)
2. 사양서 §7 TODO: Oracle 읽기전용 계정, 건별 접근권한 검사, 소비자별 키 분리·로깅
3. 결재·반려 기능 켜기 전 테스트 품의 1건으로 확인
4. `cams-sync.controller.ts`(사내 푸시 방식)와 `CamsProposal/CamsVoucher` 테이블은 이제 중복 — API 직결이 안정되면 정리 검토
