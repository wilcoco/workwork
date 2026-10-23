import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { callAI } from './llm/ai-client';
import { assertReadOnlySql } from './kpi-bindings.service';

/**
 * KPI 관련 자료 찾기 — 오라클 메타데이터 카탈로그는 **사내 PC(에이전트)에만** 있다 (대표 지시 2026-10-23).
 * 흐름: 클라우드가 DISCOVER 작업(KPI 제목·산식·단위 + 검색 토큰)을 큐에 넣음
 *   → 에이전트가 로컬 카탈로그를 검색해 "선택된 발췌"(화면 몇 개의 SQL·관련 테이블 컬럼·코드)만 올림
 *   → 여기서 AI가 연·월·값 SQL 초안을 제안 → KpiQueryProposal(PROPOSED)
 *   → 사내 PC에서 사람이 --approve 로 승인해야 agent_queries 에 등록.
 * 카탈로그 전체는 클라우드로 오지 않는다.
 */
@Injectable()
export class KpiDiscoveryService {
  private readonly logger = new Logger(KpiDiscoveryService.name);
  constructor(private prisma: PrismaService) {}

  /** 검색어 토큰화 — 한글 2자 이상 어절·영문/숫자 토큰 + 제조 도메인 동의어 확장 (에이전트가 로컬 검색에 사용) */
  tokens(text: string): string[] {
    const SYN: Record<string, string[]> = {
      '불량률': ['불량', '불량수량', 'bul', '불량율'], '불량': ['bul', '불량률'], '가동률': ['가동', '중단', 'kld', '비가동', '가동율'], '가동율': ['가동률', '중단'],
      '폐각률': ['폐각', '도장', 'doj', '샌딩'], '폐각': ['도장', 'doj'], '생산량': ['생산', '실적', 'sil'], '실적': ['생산', 'sil'],
      '달성률': ['계획', 'pln', '실적'], '계획': ['pln', '생산계획'], '사출': ['sil', 'bul', 'kld', '사출기'], '도장': ['doj', 'pp', '폐각'], '조립': ['alc', 'jr'],
      '출하': ['iop', '출고', '납품'], '재고': ['stock', 'iop', '재고현황'], '납기': ['납입', '출하', '납품'], '클레임': ['claim', '불만', '반품'], '금형': ['mold', 'kld', '금형교환'],
      '원가': ['단가', 'cost'], '매출': ['sales', '판매', '출하'], '구매': ['발주', 'po'], '설비': ['설비', 'equip', '중단'],
    };
    const raw = String(text || '').toLowerCase().replace(/[()/·,%:\-]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
    const out = new Set<string>();
    for (const t of raw) { out.add(t); for (const [k, v] of Object.entries(SYN)) if (t.includes(k)) v.forEach((x) => out.add(x)); }
    return Array.from(out).slice(0, 24);
  }

  /** DISCOVER 작업 파라미터 */
  buildParams(kr: any, hint?: string) {
    const q = [kr.title, kr.metric, kr.unit, hint].filter(Boolean).join(' ');
    return {
      kpi: { id: kr.id, title: kr.title, metric: kr.metric, unit: kr.unit, target: kr.target, direction: kr.direction, aggregation: kr.aggregation, team: kr.objective?.orgUnit?.name || '' },
      tokens: this.tokens(q), hint: hint || '', maxScreens: 6, maxTables: 8, maxCodes: 4,
    };
  }

  /** 에이전트가 올린 발췌(hits)로 AI 제안 생성 → PROPOSED 저장 */
  async proposeFromHits(kr: any, hits: any, userId: string, agentName = 'default') {
    const screens: any[] = Array.isArray(hits?.screens) ? hits.screens.slice(0, 6) : [];
    const tables: any[] = Array.isArray(hits?.tables) ? hits.tables.slice(0, 10) : [];
    const codes: any[] = Array.isArray(hits?.codes) ? hits.codes.slice(0, 4) : [];
    const allowed: string[] = Array.isArray(hits?.allowedTables) && hits.allowedTables.length ? hits.allowedTables : ['t_zl_sil', 't_zl_bul', 't_zl_kld', 't_zj_cod', 't_doj', 't_zm_pln2', 't_zm_pln1', 'dual'];
    if (!screens.length && !tables.length) throw new BadRequestException('카탈로그에서 관련 화면·테이블을 찾지 못했습니다. KPI 제목·산식에 현장 용어(예: 불량, 가동, 폐각, 출하)를 넣어 다시 시도하세요.');
    const ctx = {
      kpi: { title: kr.title, metric: kr.metric, unit: kr.unit, target: kr.target, direction: kr.direction, aggregation: kr.aggregation, team: kr.objective?.orgUnit?.name || '' },
      screens: screens.map((s) => ({ id: s.id, name: s.name, menu: s.menu || '', tables: s.tables || [], binds: s.binds || [], note: s.note || '', sql: String(s.sql || '').slice(0, 2500), grids: (s.grids || []).slice(0, 3).map((g: any) => ({ title: g.title, sql: String(g.sql || '').slice(0, 1500) })) })),
      tables: tables.map((t) => ({ table: t.table, comment: t.comment || '', columns: (t.columns || []).slice(0, 60).map((c: any) => ({ name: c.name, type: c.type, comment: c.comment || '', code_ref: c.code_ref || undefined })) })),
      codes: codes.map((c) => ({ group: c.group, name: c.name, items: (c.items || []).slice(0, 40) })),
      allowedTables: allowed,
    };
    const sys = `당신은 제조회사 ERP(오라클)의 메타데이터 발췌(현장 화면 SQL·테이블 컬럼 사전·코드 마스터)만 보고 KPI 실적을 뽑는 조회문을 설계하는 데이터 엔지니어입니다. 행 데이터는 볼 수 없습니다.
목표: 주어진 KPI의 월별 실적을 "연, 월, 값" 3컬럼으로 돌려주는 Oracle SELECT 문 후보를 최대 3개 제안합니다.
규칙:
- 근거는 [발췌]에 있는 화면 SQL·테이블·컬럼·코드만. 없는 테이블·컬럼을 지어내지 않습니다. 현장 화면(screens)의 SQL이 있으면 그 산식을 월별 집계로 바꾸는 것을 최우선으로 합니다 — 현장이 보는 숫자와 같아야 합니다. menu가 있는 화면(사용자가 아는 화면)을 우선합니다.
- SELECT 하나만. 세미콜론·주석·DML·FOR UPDATE 금지. 기간 조건은 바인드 :yy(연도 4자리) 또는 :from_ymd/:to_ymd('YYYY-MM-DD') 또는 :from_yyyymmdd/:to_yyyymmdd. 컬럼 별칭은 "연","월","값". 날짜 컬럼이 문자열이면 그 형식에 맞는 바인드를 고릅니다.
- allowedTables 밖 테이블을 써야 하면 caveats에 적고 confidence를 낮춥니다(승인 시 화이트리스트 확장 필요).
- 단위·방향이 KPI와 맞는지(%, 건, 시간), 공정 코드 필터가 필요한지(코드 마스터 참고), 분모가 화면 밖 계산식(note에 "미추출")에 있는지를 caveats에 솔직히 적습니다. 모르면 "확인 필요".
- queryId는 영문 소문자·숫자·밑줄(예: injection_defect_rate). extraBinds는 표준 바인드 외 필요한 값({"bul":"폐각"} 등), 없으면 {}.
출력(JSON만): {"candidates":[{"queryId":"...","name":"한글 이름","screenRef":"w_xx_0000 화면명","tables":["..."],"sql":"...","binds":["yy"],"extraBinds":{},"rationale":"화면·컬럼 근거","caveats":"주의·확인 필요","confidence":0~100}]}`;
    const result = await callAI({ system: sys, user: `[KPI]\n${JSON.stringify(ctx.kpi, null, 1)}\n\n[발췌]\n${JSON.stringify({ screens: ctx.screens, tables: ctx.tables, codes: ctx.codes, allowedTables: ctx.allowedTables }, null, 1).slice(0, 60000)}`, model: 'claude', temperature: 0.1, maxTokens: 4000 });
    const cands: any[] = Array.isArray(result.parsed?.candidates) ? result.parsed.candidates : [];
    const saved: any[] = [];
    for (const c of cands.slice(0, 3)) {
      let sql = String(c.sql || '').trim();
      let guard = '';
      try { sql = assertReadOnlySql(sql); } catch (e: any) { guard = `서버 가드 실패: ${e?.message || e}`; }
      const qid = String(c.queryId || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || `kpi_${Date.now()}`;
      saved.push(await (this.prisma as any).kpiQueryProposal.create({
        data: {
          keyResultId: kr.id, queryId: qid, name: String(c.name || kr.title).slice(0, 120), sql,
          binds: Array.isArray(c.binds) ? c.binds.map(String) : Array.from(sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)).map((m) => m[1]),
          tables: Array.isArray(c.tables) ? c.tables.map((t: any) => String(t).toLowerCase()) : [], extraBinds: c.extraBinds && typeof c.extraBinds === 'object' ? c.extraBinds : {},
          screenRef: String(c.screenRef || '').slice(0, 200), rationale: String(c.rationale || '').slice(0, 2000),
          caveats: [String(c.caveats || ''), guard].filter(Boolean).join(' / ').slice(0, 2000), confidence: Math.max(0, Math.min(100, Number(c.confidence) || 0)),
          createdById: userId, agentName,
        },
      }));
    }
    return saved;
  }
}
