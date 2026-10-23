-- name: 사출 불량률(월별)
-- desc: w_zl_5018 불량률집계표(1-31) w_zl_5018 화면이 t_zl_sil(양품수량 silaqty)과 t_zl_bul(불량수량 bulcqty)을 품목·일자별로 집계해 불량률을 계산. 화면의 일별(a01~a31=silaqty, b01~b31=bulcqty) 산식을 월 합계로 변환. 불량률=불량수량합/양품수량합*100. 공정 '001'(사출)로 필터(RTG/1 코드).
-- binds: yy
select s.silyy "연", s.silmm "월", round(nvl(b.bul,0)/nullif(s.sil,0)*100,2) "값" from (select silyy, silmm, sum(nvl(silaqty,0)) sil from t_zl_sil where silyy = :yy and silrtg = '001' group by silyy, silmm) s left join (select bulyy, bulmm, sum(nvl(bulcqty,0)) bul from t_zl_bul where bulyy = :yy and bulrtg = '001' group by bulyy, bulmm) b on s.silyy = b.bulyy and s.silmm = b.bulmm order by s.silmm
