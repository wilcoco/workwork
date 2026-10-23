-- name: 사출 중단시간(분) 월별 합계 — 가동률 분자 재료 (분모 확정 전 참고용)
-- desc: T_ZL_KLD 사출(001) 전 호기 중단시간 합계(분). 가동률 = (가동가능시간 − 중단) / 가동가능시간 은 분모 확정 후 별도 질의로 등록
-- binds: yy
SELECT kldyy AS "연", kldmm AS "월", ROUND(SUM(kldah),1) AS "값"
  FROM t_zl_kld
 WHERE kldrtg = '001' AND kldyy = :yy
 GROUP BY kldyy, kldmm
 ORDER BY 1,2
