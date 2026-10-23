# 에이전트 등록 질의

- 이 폴더의 `*.sql` 한 파일이 질의 하나이고, **파일명(확장자 제외)이 질의 ID**입니다. 클라우드(WorkWork)는 이 ID와 바인드 값만 내려보내며 SQL 본문은 사내 PC에만 있습니다.
- 머리말 주석: `-- name:`(표시 이름), `-- desc:`(설명), `-- binds:`(쓰는 바인드). 머리말 외 본문에는 주석을 쓰지 않습니다(가드가 거부).
- 결과는 **연·월·값 3컬럼**(별칭 "연","월","값" 또는 YEAR/MONTH/VALUE)이어야 합니다.
- 허용 테이블 밖을 조회하면 거부됩니다 (`ALLOWED_TABLES` 환경변수로 조정). 기본: t_zl_sil, t_zl_bul, t_zl_kld, t_zj_cod, t_doj, t_zm_pln2, t_zm_pln1, dual
- 바인드 표준값(클라우드가 채움): `:yy` 연도, `:from_ymd`/`:to_ymd` YYYY-MM-DD, `:from_yyyymmdd`/`:to_yyyymmdd` YYYYMMDD. 그 외는 KPI 연결 설정의 "추가 바인드"에서 지정.
