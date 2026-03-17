/**
 * 업무 매뉴얼 외재화 시스템 — 기본형 5가지 + 옵션 + 질문 세트 + AI 프롬프트
 */

// ─── Base Types ───────────────────────────────────────────
export type BaseTypeId = 'procedure' | 'dev_project' | 'system_operation' | 'calculation' | 'inspection_mgmt';

export interface BaseTypeDef {
  id: BaseTypeId;
  name: string;
  icon: string;
  group: string;
  userDescription: string;
  examples: string;
  primaryOutput: string;
  targetModule: string;
  templateId: string;
}

export const BASE_TYPES: BaseTypeDef[] = [
  {
    id: 'procedure',
    name: '업무 절차',
    icon: '📋',
    group: '프로세스 생성형',
    userDescription: '순서가 있고 결재/승인을 받으며 진행하는 업무',
    examples: '채용, 구매발주, 출하검사, 클레임 처리, 설계변경(ECR/EO), 부적합품 처리',
    primaryOutput: 'BPMN 흐름도 + 결재라인 + 단계별 상세표',
    targetModule: 'bpmn_engine',
    templateId: 'template_process',
  },
  {
    id: 'dev_project',
    name: '개발 프로젝트',
    icon: '🚗',
    group: '프로세스 생성형',
    userDescription: '마일스톤·Gate 기반으로 장기간 진행되는 개발 업무',
    examples: '신차 범퍼 개발(M-8~M+20), 금형 개발, SE활동, D-FMEA, 벤치마킹, 특허출원',
    primaryOutput: '마일스톤 타임라인 + Gate Review + 단계별 Input/Output',
    targetModule: 'schedule_mgmt',
    templateId: 'template_dev_project',
  },
  {
    id: 'system_operation',
    name: '시스템 조작',
    icon: '🖥️',
    group: '매뉴얼 조회형',
    userDescription: 'ERP/MES 등 시스템 화면을 보며 따라하는 업무',
    examples: 'ERP 전표처리, BOM 등록, MES 실적입력, 재고관리 시스템',
    primaryOutput: 'Step-by-step 조작 가이드 + 시스템 구조도 + FAQ',
    targetModule: 'knowledge_base',
    templateId: 'template_system',
  },
  {
    id: 'calculation',
    name: '계산/산출',
    icon: '🧮',
    group: '매뉴얼 조회형',
    userDescription: '공식에 따라 수치를 계산하고 결과를 보고하는 업무',
    examples: '부품 원가계산, 금형비 산출, 견적서 작성, 손익분석, 자금수지, 채권 수익 산정',
    primaryOutput: '산출 공식표 + Worked Example + 검증 포인트',
    targetModule: 'knowledge_base',
    templateId: 'template_calculation',
  },
  {
    id: 'inspection_mgmt',
    name: '점검/관리',
    icon: '🔧',
    group: '매뉴얼 조회형',
    userDescription: '설비·시설을 점검하고 이상 시 조치하는 업무',
    examples: '사출기 일상점검, 도장라인 관리, 금형 PM, CCTV/출입통제, 안전관리',
    primaryOutput: '점검 체크리스트 + 이상 조치표 + 설비 정보 + 안전 주의사항',
    targetModule: 'periodic_alarm_report',
    templateId: 'template_inspection',
  },
];

export const BASE_TYPE_MAP: Record<string, BaseTypeDef> = {};
for (const bt of BASE_TYPES) BASE_TYPE_MAP[bt.id] = bt;

// ─── Options ──────────────────────────────────────────────
export interface OptionItem {
  id: string;
  label: string;
  targetModule: string;
  note?: string;
}

export interface OptionGroup {
  id: string;
  label: string;
  description: string;
  multiSelect: boolean;
  items: OptionItem[];
}

export const OPTION_GROUPS: OptionGroup[] = [
  {
    id: 'execution_cycle',
    label: '실행 주기',
    description: '이 업무를 언제 하는가',
    multiSelect: true,
    items: [
      { id: 'daily', label: '매일 반복', targetModule: 'periodic_alarm_report' },
      { id: 'weekly', label: '매주 반복', targetModule: 'periodic_alarm_report' },
      { id: 'monthly', label: '매월 반복', targetModule: 'periodic_alarm_report' },
      { id: 'quarterly_annual', label: '분기/반기/연간', targetModule: 'periodic_alarm_report' },
      { id: 'event_driven', label: '요청 발생 시', targetModule: 'bpmn_engine', note: '기본형이 업무절차일 때 워크플로우 트리거 조건 등록' },
      { id: 'project_period', label: '프로젝트 기간', targetModule: 'schedule_mgmt' },
      { id: 'always_reference', label: '상시 참조용', targetModule: 'knowledge_base' },
    ],
  },
  {
    id: 'additional_content',
    label: '추가 콘텐츠',
    description: '기본형 외에 추가로 포함시킬 콘텐츠',
    multiSelect: true,
    items: [
      { id: 'add_procedure', label: '결재/승인 절차 포함', targetModule: 'bpmn_engine' },
      { id: 'add_dev_milestone', label: '개발 마일스톤 포함', targetModule: 'schedule_mgmt' },
      { id: 'add_system_op', label: '시스템 조작법 포함', targetModule: 'knowledge_base' },
      { id: 'add_calculation', label: '계산/산출 방법 포함', targetModule: 'knowledge_base' },
      { id: 'add_inspection', label: '설비/시설 관리 포함', targetModule: 'periodic_alarm_report' },
    ],
  },
  {
    id: 'additional_features',
    label: '부가 기능',
    description: '추가로 활성화할 기능',
    multiSelect: true,
    items: [
      { id: 'security_separation', label: '보안정보 분리', targetModule: 'security_module', note: '기본 ON. 보안정보 탐지 시 자동 분리.' },
      { id: 'handover_guide', label: '인수인계 가이드', targetModule: '', note: '기본 ON. 모든 매뉴얼에 인수인계 섹션 포함.' },
      { id: 'missed_alarm', label: '미실행 알림', targetModule: 'periodic_alarm_report', note: '정기 반복 옵션 선택 시 자동 추천' },
      { id: 'checklist_widget', label: '체크리스트 생성', targetModule: 'periodic_alarm_report', note: '점검/관리 또는 정기 반복 시 자동 추천' },
    ],
  },
];

// ─── Question Sets (per base type) ────────────────────────
export const QUESTION_SETS: Record<string, { baseType: string; targetModule: string; coreQuestions: string[] }> = {
  procedure: {
    baseType: '업무 절차',
    targetModule: 'bpmn_engine',
    coreQuestions: [
      '이 업무의 첫 단계는 무엇인가요? 누가 시작하나요?',
      '중간에 누구한테 결재(승인)를 받아야 하나요?',
      '결재가 반려되면 어떻게 하나요?',
      '이 업무의 최종 결과는 누구에게 전달되나요?',
      '급하게 처리해야 할 때 절차가 달라지나요?',
      '다른 부서에서 먼저 뭘 해줘야 시작할 수 있나요?',
    ],
  },
  dev_project: {
    baseType: '개발 프로젝트',
    targetModule: 'schedule_mgmt',
    coreQuestions: [
      '이 개발 업무는 전체적으로 어떤 단계로 나뉘나요?',
      '각 단계가 끝나려면 어떤 조건을 만족해야 하나요? (Gate 통과 기준)',
      '고객사(HKMC)에 제출해야 하는 것은 무엇이 있나요?',
      '고객사 전산시스템에 등록해야 하는 것이 있나요?',
      '이전 단계의 결과물이 다음 단계의 입력이 되는 관계가 있나요?',
      '전체 일정은 보통 몇 개월 정도 걸리나요? M+n 기준으로 알려주실 수 있나요?',
    ],
  },
  system_operation: {
    baseType: '시스템 조작',
    targetModule: 'knowledge_base',
    coreQuestions: [
      '이 시스템에 어떤 메뉴(화면)로 들어가시나요?',
      '입력해야 하는 항목 중 필수인 것은 무엇인가요?',
      '입력한 내용이 다른 시스템이나 보고서에 자동으로 반영되나요?',
      '자주 발생하는 오류나 실수는 어떤 건가요?',
      '처음 쓰는 사람이 가장 헷갈려하는 부분은?',
      '이 작업 전에 다른 시스템에서 먼저 확인해야 할 것이 있나요?',
    ],
  },
  calculation: {
    baseType: '계산/산출',
    targetModule: 'knowledge_base',
    coreQuestions: [
      '계산에 필요한 데이터는 어디서 가져오나요?',
      '계산 공식을 알려주실 수 있나요? (대략적으로라도)',
      '계산 결과가 맞는지 어떻게 확인(크로스체크)하시나요?',
      '계산 결과를 누구에게, 어떤 형식으로 보고하시나요?',
      '시기에 따라 적용 기준이 달라지나요? (환율, 단가 등)',
      '엑셀을 쓰시나요? 정해진 양식이 있나요?',
    ],
  },
  inspection_mgmt: {
    baseType: '점검/관리',
    targetModule: 'periodic_alarm_report',
    coreQuestions: [
      '점검하는 항목을 구체적으로 알려주실 수 있나요?',
      '각 항목의 정상/이상 판단 기준이 있나요?',
      '이상이 발견되면 어떻게 조치하시나요?',
      '정기적으로 점검하는 주기는 어떻게 되나요?',
      '점검 결과를 어디에 기록하시나요?',
      '이 설비/시설에서 특히 위험한 부분이나 안전 주의사항이 있나요?',
    ],
  },
};

export const TACIT_KNOWLEDGE_QUESTIONS = [
  '이 업무를 처음 하는 사람이 가장 실수하기 쉬운 부분은?',
  '본인이 빠지면 누가 대행하나요? 대행자가 꼭 알아야 할 것은?',
  '예전에 문제가 된 적이 있는 부분은?',
  '연말이나 특정 시기에만 달라지는 부분이 있나요?',
  '이 업무에서 가장 시간이 오래 걸리는 부분은?',
  '이 업무가 IATF 16949 절차서(품질 인증)와 관련이 있나요?',
];

// ─── Security patterns ────────────────────────────────────
export const SECURITY_PATTERNS = [
  /ID\s*[:：]\s*\S+/i,
  /PW\s*[:：]\s*\S+/i,
  /P\.?W\.?\s*[:：]\s*\S+/i,
  /비밀번호\s*[:：]\s*\S+/i,
  /아이디\s*[:：]\s*\S+/i,
  /https?:\/\/\S+.*(?:login|로그인)/i,
];

export function detectSecurityInfo(text: string): string[] {
  const found: string[] = [];
  for (const p of SECURITY_PATTERNS) {
    const m = text.match(p);
    if (m) found.push(m[0]);
  }
  return found;
}

// ─── Departments (12 teams) ───────────────────────────────
export const DEPARTMENTS = [
  '설계팀', '신차개발팀', '개발팀', '금형개발팀',
  '생산팀', '제2공장 생산팀', '생산기술팀', '양산품질팀',
  '영업팀', '회계팀', '자재관리팀', '전산팀',
];

// ─── AI System Prompt ─────────────────────────────────────
export const AI_SYSTEM_PROMPT = `당신은 자동차 부품 제조 1차 협력사의 업무 지식 구조화 전문가입니다.
담당자가 자기 업무를 자유롭게 설명하면, 단계적 질문을 통해 암묵지를 끌어내고,
선택된 기본형에 맞는 체계적인 업무 매뉴얼 또는 업무 프로세스로 변환합니다.

### 회사 개요
- 현대기아차에 범퍼를 연구개발하여 사출, 도장, 조립 후 납품하는 1차 협력사
- 주요 공정: 설계 → 금형개발 → 사출성형 → 도장 → 조립 → 출하검사 → 납품
- 고객사 개발 프로세스(HKMC)와 연동되어 M-n ~ M+n 마일스톤 기준으로 운영

### 조직 구조 (12개 팀)
[개발/기술] 설계팀, 신차개발팀, 개발팀, 금형개발팀
[생산/품질] 생산팀(1공장), 제2공장 생산팀, 생산기술팀, 양산품질팀
[경영지원] 영업팀, 회계팀, 자재관리팀, 전산팀

### 사내 주요 용어
SR(Sourcing Requirement), SE(Simultaneous Engineering), D-FMEA, L1~L4(설계단계 10%→100%),
M+n/M-n(양산기준 일정), L/L(Long Lead), ECR/EO(설계변경), ESIR(ES 실사),
Proto/P1/P2/M(시작품→양산), HKMC(현대기아차), BOM(부품구성표), MES, PM(예방보전), IATF 16949

### 대화 원칙
- 전문 용어를 사용자에게 노출하지 않는다
- "정리해보면 이런 업무들이 있는 것 같은데 맞나요?" 식의 확인형 대화
- 한번에 2~3개 질문씩, 답변 받고 다음 질문으로
- 매 회차마다 "지금까지 정리된 내용"을 보여주고 확인받는다`;

// ─── Option Recommendation Rules ──────────────────────────
export const OPTION_RECOMMENDATION_RULES: Array<{ keywords: RegExp; recommendOptionIds: string[] }> = [
  { keywords: /매일|일일|daily/i, recommendOptionIds: ['daily', 'missed_alarm'] },
  { keywords: /매주|주간|weekly/i, recommendOptionIds: ['weekly', 'missed_alarm'] },
  { keywords: /매월|월간|monthly/i, recommendOptionIds: ['monthly', 'missed_alarm'] },
  { keywords: /분기|반기|연간|quarterly|annual/i, recommendOptionIds: ['quarterly_annual', 'missed_alarm'] },
  { keywords: /결재|승인|품의|기안/i, recommendOptionIds: ['add_procedure'] },
  { keywords: /M[-+]\d|개발단계|마일스톤|milestone/i, recommendOptionIds: ['add_dev_milestone', 'project_period'] },
  { keywords: /ERP|MES|시스템|화면|메뉴/i, recommendOptionIds: ['add_system_op'] },
  { keywords: /계산|공식|금액|산출|원가/i, recommendOptionIds: ['add_calculation'] },
  { keywords: /점검|설비|체크|PM|보전/i, recommendOptionIds: ['add_inspection', 'checklist_widget'] },
  { keywords: /ID\s*[:：]|PW\s*[:：]|비밀번호|아이디/i, recommendOptionIds: ['security_separation'] },
];

export function recommendOptions(baseType: string, freeText: string): string[] {
  const set = new Set<string>();
  // defaults
  set.add('security_separation');
  set.add('handover_guide');
  for (const rule of OPTION_RECOMMENDATION_RULES) {
    if (rule.keywords.test(freeText)) {
      for (const id of rule.recommendOptionIds) set.add(id);
    }
  }
  // filter out options same as base type
  if (baseType === 'procedure') { set.delete('add_procedure'); }
  if (baseType === 'dev_project') { set.delete('add_dev_milestone'); set.delete('project_period'); }
  if (baseType === 'system_operation') { set.delete('add_system_op'); }
  if (baseType === 'calculation') { set.delete('add_calculation'); }
  if (baseType === 'inspection_mgmt') { set.delete('add_inspection'); set.delete('checklist_widget'); }
  return Array.from(set);
}

// ─── Phase data types ─────────────────────────────────────
export interface PhaseData {
  /** Phase 1: user inputs */
  phase1?: {
    baseType: string;
    department: string;
    jobTitle: string;
    author: string;
    freeText: string;
    extractedData?: any;
  };
  /** Phase 2: AI conversation rounds */
  phase2?: {
    rounds: Array<{
      roundNum: number;
      aiQuestions: string[];
      userAnswers: string[];
      structuredSoFar?: string;
    }>;
    completedRounds: number;
  };
  /** Phase 3: selected options */
  phase3?: {
    selectedOptions: Record<string, string[]>;
    recommendedOptions: string[];
  };
  /** Phase 4: generated outputs */
  phase4?: {
    manualContent: string;
    moduleData?: Record<string, any>;
    securityItems?: Array<{ systemName: string; original: string; replacement: string }>;
  };
  /** Phase 5: tacit knowledge */
  phase5?: {
    questions: Array<{ question: string; answer: string }>;
    finalContent: string;
  };
}
