-- name: 사출 불량률(%) 월별
-- desc: 원본 화면 w_zl_5018 불량률집계표와 동일 산식. 불량수량(T_ZL_BUL.BULCQTY) / 생산수량(T_ZL_SIL.SILAQTY) × 100, 공정 001(사출)
-- binds: yy
SELECT s.YY AS "연", s.MM AS "월",
       ROUND(NVL(b.BAD,0) / NULLIF(s.PROD,0) * 100, 3) AS "값"
  FROM (SELECT silyy YY, silmm MM, SUM(silaqty) PROD
          FROM t_zl_sil WHERE silrtg = '001' AND silyy = :yy
         GROUP BY silyy, silmm) s
  LEFT JOIN (SELECT bulyy YY, bulmm MM, SUM(bulcqty) BAD
               FROM t_zl_bul WHERE bulrtg = '001' AND bulyy = :yy
              GROUP BY bulyy, bulmm) b
    ON s.YY = b.YY AND s.MM = b.MM
 ORDER BY 1, 2
