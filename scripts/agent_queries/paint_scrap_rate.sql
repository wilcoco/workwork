-- name: 도장 폐각률(%) 월별
-- desc: 원본 화면 w_pp_00471 도장투입 대비 폐각/샌딩(율)과 동일. 바인드 bul='폐각'|'샌딩'|'워크'. plndate는 'YYYY-MM-DD' 문자열
-- binds: from_ymd, to_ymd, bul
SELECT TO_CHAR(TO_DATE(plndate,'YYYY-MM-DD'),'YYYY') AS "연",
       TO_CHAR(TO_DATE(plndate,'YYYY-MM-DD'),'MM')   AS "월",
       ROUND( SUM(CASE WHEN silld='2' AND silbcd <> 'AB599'
                        AND silbcd IN (SELECT codcod FROM t_zj_cod
                                        WHERE codgb1='RTG' AND codgb2=2
                                          AND SUBSTR(coddsd,-2) = :bul) THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN silld='1' THEN 1 ELSE 0 END),0) * 100, 3) AS "값"
  FROM t_doj
 WHERE plndate >= :from_ymd AND plndate <= :to_ymd
 GROUP BY TO_CHAR(TO_DATE(plndate,'YYYY-MM-DD'),'YYYY'),
          TO_CHAR(TO_DATE(plndate,'YYYY-MM-DD'),'MM')
 ORDER BY 1,2
