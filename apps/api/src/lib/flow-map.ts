import { MANUAL_FLOW_MAP, KPI_FLOW_MAP } from './flow-map-data';

/**
 * 전사 업무 흐름 지도 — 가치사슬 L1 도메인/L2 업무군 분류.
 * 기존 매뉴얼 445건은 2026-11-02 AI 전수 분류(flow-map-data.ts)를 쓰고,
 * 그 뒤에 만들어진 매뉴얼은 제목·팀 키워드 규칙으로 즉석 분류한다(미지정 시 etc/미분류).
 */
export type FlowDomainKey =
  | 'sales' | 'rnd' | 'engineering' | 'procurement' | 'production'
  | 'quality' | 'logistics' | 'management' | 'it' | 'etc';

export const FLOW_DOMAINS: Array<{ key: FlowDomainKey; name: string; kind: 'main' | 'support'; desc: string }> = [
  { key: 'sales', name: '영업·수주', kind: 'main', desc: '입찰·견적·수주·단가·매출채권' },
  { key: 'rnd', name: '연구개발·설계', kind: 'main', desc: '신차개발·제품/금형설계·EO·해석' },
  { key: 'engineering', name: '생산기술·금형', kind: 'main', desc: '금형제작·유지보수·설비·공정개발' },
  { key: 'procurement', name: '구매·자재·협력사', kind: 'main', desc: '발주·입고·재고·외주·상생' },
  { key: 'production', name: '생산', kind: 'main', desc: '사출·도장·조립·생산계획·보전' },
  { key: 'quality', name: '품질', kind: 'main', desc: '검사·부적합·클레임·4M·인증' },
  { key: 'logistics', name: '물류·출하', kind: 'main', desc: '포장·출하·배차·납품' },
  { key: 'management', name: '경영지원', kind: 'support', desc: '인사·총무·회계·결재·EHS' },
  { key: 'it', name: '정보시스템', kind: 'support', desc: 'ERP·전산 인프라·자동화' },
  { key: 'etc', name: '기타/관계사', kind: 'support', desc: '관계사·미분류' },
];

// 신규 매뉴얼 즉석 분류: 제목 키워드 우선, 없으면 팀 기본값
const TITLE_RULES: Array<[RegExp, FlowDomainKey, string]> = [
  [/입찰|견적|수주|가격품의|단가|투자비|매출|채권|수금|원산지|FTA/i, 'sales', '영업·수주 일반'],
  [/도장/i, 'production', '도장'],
  [/사출/i, 'production', '사출'],
  [/조립|라인/i, 'production', '조립·라인운영'],
  [/생산계획|생산실적|서열|공수|특근/i, 'production', '생산관리·실적'],
  [/작업표준|관리계획서/i, 'production', '작업표준·공정문서'],
  [/금형/i, 'engineering', '금형 유지보수·개발'],
  [/설비|보전|정기점검|오버홀/i, 'engineering', '설비관리'],
  [/발주|입고|재고|자재|도료/i, 'procurement', '발주·입고·재고'],
  [/협력사|외주|상생|SQ/i, 'procurement', '협력사 관리'],
  [/검사|측정|부적합|클레임|4M|ISIR|IATF|색차|컬러/i, 'quality', '검사·품질관리'],
  [/출하|포장|납품|배차|납입|CKD/i, 'logistics', '출하·납품'],
  [/설계|도면|BOM|DFMEA|해석|시작|파이롯트|EO|설변|특허|벤치마킹|IMDS/i, 'rnd', '설계·개발'],
  [/채용|인사|근태|급여|교육/i, 'management', '인사·채용·근태'],
  [/총무|경조|출입|법인차량|주유/i, 'management', '총무·경조·차량'],
  [/회계|자금|세무|부가세|법인카드|전표|품의|결재/i, 'management', '회계·자금·결재'],
  [/안전|소방|환경|위험성|중대재해|보건/i, 'management', '안전보건·환경(EHS)'],
  [/ERP|전산|서버|네트워크|M365|PC|자동화 도구/i, 'it', '시스템 운영'],
];
const TEAM_DEFAULTS: Record<string, [FlowDomainKey, string]> = {
  '영업관리팀': ['sales', '영업·수주 일반'],
  '설계팀': ['rnd', '설계·개발'],
  '개발팀': ['rnd', '설계·개발'],
  '생산기술팀': ['engineering', '생산기술 일반'],
  '상생협력팀': ['procurement', '협력사 관리'],
  '자재관리팀': ['procurement', '발주·입고·재고'],
  '생산팀': ['production', '생산관리·실적'],
  '함평팀': ['production', '생산관리·실적'],
  '함평공장': ['production', '생산관리·실적'],
  '양산품질팀': ['quality', '검사·품질관리'],
  '전산팀': ['it', '시스템 운영'],
  '경영관리팀': ['management', '회계·자금·결재'],
  '관리각자대표': ['management', '경영 일반'],
  '에스콘': ['etc', '관계사(에스콘)'],
};

export function classifyManual(manualId: string, title: string, team: string): { l1: FlowDomainKey; l2: string } {
  const mapped = (MANUAL_FLOW_MAP as any)[manualId];
  if (mapped?.l1) return { l1: mapped.l1 as FlowDomainKey, l2: String(mapped.l2 || '미분류') };
  const t = String(title || '');
  for (const [rx, l1, l2] of TITLE_RULES) if (rx.test(t)) return { l1, l2 };
  const byTeam = TEAM_DEFAULTS[String(team || '').trim()];
  if (byTeam) return { l1: byTeam[0], l2: byTeam[1] };
  return { l1: 'etc', l2: '미분류' };
}

/** KPI(KeyResult) 분류 — 전수 매핑 우선(제목+조직 일치), 없으면 제목 키워드/조직 기본값 */
export function classifyKpi(title: string, org: string): { l1: FlowDomainKey; l2: string } {
  const hit = (KPI_FLOW_MAP as any[]).find((k) => k.t === title && (!k.org || !org || k.org === org));
  if (hit?.l1) return { l1: hit.l1 as FlowDomainKey, l2: String(hit.l2 || '') };
  const t = String(title || '');
  for (const [rx, l1, l2] of TITLE_RULES) if (rx.test(t)) return { l1, l2 };
  const byTeam = TEAM_DEFAULTS[String(org || '').trim()];
  if (byTeam) return { l1: byTeam[0], l2: '' };
  return { l1: 'etc', l2: '' };
}
