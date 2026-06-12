import { Link } from 'react-router-dom';

// OKR·KPI 목표 입력 가이드 — 대표부터 담당자까지 순차 입력 흐름 안내

const card: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' };

function RoleChip({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800, color: '#fff', background: color }}>
      {text}
    </span>
  );
}

function StepArrow() {
  return <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 20, lineHeight: 1, margin: '2px 0' }}>▼</div>;
}

function GoLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 6, background: '#0F3D73', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
      {label} →
    </Link>
  );
}

export function OkrKpiGuide() {
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>OKR·KPI 목표 입력 가이드</h2>
        <a
          href="/docs/okr-kpi-guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '6px 14px', background: '#dc2626', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
        >
          📄 PDF 설명서 다운로드
        </a>
      </div>

      <div style={{ ...card, background: '#F8FAFC' }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>목표 체계 한눈에 보기</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, fontSize: 13 }}>
          <div style={{ padding: 12, background: '#EFF6FF', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <b>📊 정량 목표 (KPI)</b> — 효율성
            <div style={{ color: '#475569', marginTop: 4 }}>
              반복되는 오퍼레이션 지표. 숫자(기준값→목표값)로 관리하며, 담당자가 <b>업무일지에서 지표값을 입력</b>하면 자동 집계됩니다.
            </div>
          </div>
          <div style={{ padding: 12, background: '#F0FDF4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
            <b>🎯 정성 목표 (OKR)</b> — 효과성
            <div style={{ color: '#475569', marginTop: 4 }}>
              변화·개선을 만드는 프로젝트. 과제(이니셔티브)로 전개하고 <b>업무일지로 진행 내용을 축적</b>합니다.
            </div>
          </div>
          <div style={{ padding: 12, background: '#FFFBEB', border: '1px solid #fde68a', borderRadius: 10 }}>
            <b>🚩 중점 추진 과제</b> — 돌발·프로젝트성
            <div style={{ color: '#475569', marginTop: 4 }}>
              지표로 분해되지 않은 프로젝트성/돌발성 업무. 등록 시 <b>연결된 OKR</b>을 선택해 목표 축에 정렬할 수 있습니다.
            </div>
          </div>
        </div>
      </div>

      {/* STEP 1 */}
      <div style={{ ...card, borderLeft: '6px solid #7c3aed' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RoleChip text="STEP 1 · 대표이사" color="#7c3aed" />
          <b>회사 최상단 목표 정의 (유일하게 상위 선택 없음)</b>
          <span style={{ fontSize: 12, color: '#64748b' }}>연초 · 분기초</span>
        </div>
        <ol style={{ margin: '10px 0 8px 20px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
          <li><b>정성 목표 (OKR) 입력</b> 화면에서 역할 <b>"대표"</b>를 선택합니다.</li>
          <li>회사 전체 <b>Objective</b>(목표 스토리)를 작성합니다 — 기간(분기/연도) 포함.</li>
          <li>각 Objective 아래에 <b>KR</b>(핵심결과)을 정의합니다 — 지표명·목표값·단위·방향(이상/이하) 필수.</li>
        </ol>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>→ 전사 정렬 축의 출발점은 대표의 KR입니다. (참고: 임원·팀장·팀원도 "상위 없음 — 자체 시작"으로 별도의 비정렬 목표 트리를 시작할 수 있습니다 — FAQ 참고)</div>
        <GoLink to="/okr/input" label="정성 목표 (OKR) 입력" />
      </div>
      <StepArrow />

      {/* STEP 2 */}
      <div style={{ ...card, borderLeft: '6px solid #6d28d9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RoleChip text="STEP 2 · 임원 / 실장" color="#6d28d9" />
          <b>대표 KR을 받아 실(부문) 목표 전개</b>
          <span style={{ fontSize: 12, color: '#64748b' }}>연초 · 분기초</span>
        </div>
        <ol style={{ margin: '10px 0 8px 20px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
          <li><b>정성 목표 (OKR) 입력</b>에서 역할 <b>"임원"</b>을 선택합니다.</li>
          <li><b>상위 O-KR 선택</b>에서 <b>대표의 KR 1개</b>를 지정합니다 — 임원도 상위 선택 없이는 저장되지 않습니다.</li>
          <li>받은 KR을 달성하기 위한 실 단위 <b>Objective + KR</b>로 전개합니다.</li>
        </ol>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          예) 대표 KR "전체 공정 불량률 0.6% 이하" 수신 → 생산실장 Objective "도장 공정 안정화" + KR "도장 불량률 0.5% 이하"
        </div>
        <GoLink to="/okr/input" label="정성 목표 (OKR) 입력" />
      </div>
      <StepArrow />

      {/* STEP 3 */}
      <div style={{ ...card, borderLeft: '6px solid #0F3D73' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RoleChip text="STEP 3 · 팀장" color="#0F3D73" />
          <b>실 KR을 받아 팀 목표 전개 + 담당자 지정</b>
          <span style={{ fontSize: 12, color: '#64748b' }}>분기초 · 월초</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginTop: 10, fontSize: 13 }}>
          <div style={{ padding: 12, background: '#F0FDF4', borderRadius: 10 }}>
            <b>🎯 정성 (팀 OKR)</b>
            <ol style={{ margin: '6px 0 8px 18px', padding: 0, lineHeight: 1.7 }}>
              <li>역할 <b>"팀장"</b> 선택 → <b>상위(실장/임원)의 KR 1개</b>를 지정합니다.</li>
              <li>팀 Objective를 작성하고 팀 KR로 전개합니다.</li>
            </ol>
            <GoLink to="/okr/input" label="정성 목표 (OKR) 입력" />
          </div>
          <div style={{ padding: 12, background: '#EFF6FF', borderRadius: 10 }}>
            <b>📊 정량 (팀 KPI)</b>
            <ol style={{ margin: '6px 0 8px 18px', padding: 0, lineHeight: 1.7 }}>
              <li>지표명·기준값·목표값·단위·방향(이상/이하)·주기를 입력합니다.</li>
              <li><b style={{ color: '#dc2626' }}>참여자(담당자)를 반드시 지정</b>합니다 — 지정해야 담당자의 "내 업무 과제"와 업무일지에 지표가 나타납니다.</li>
            </ol>
            <GoLink to="/okr/team" label="정량 목표 (팀 KPI) 입력" />
          </div>
        </div>
        <div style={{ marginTop: 10, padding: 12, background: '#FFFBEB', borderRadius: 10, fontSize: 13 }}>
          <b>🚩 중점 추진 과제</b> — 지표 외 프로젝트성/돌발성 업무는 중점 추진 과제로 등록하고, <b>연결된 OKR</b>과 담당자를 지정합니다.{' '}
          <GoLink to="/key-initiatives" label="중점 추진 과제" />
        </div>
      </div>
      <StepArrow />

      {/* STEP 3 */}
      <div style={{ ...card, borderLeft: '6px solid #16a34a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RoleChip text="STEP 4 · 담당자 / 팀원" color="#16a34a" />
          <b>내 과제 확인 + 일지로 실적 입력</b>
          <span style={{ fontSize: 12, color: '#64748b' }}>매일 · 수시</span>
        </div>
        <ol style={{ margin: '10px 0 8px 20px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
          <li>(정성 과제가 있다면) <b>정성 목표 (OKR) 입력</b>에서 역할 "팀원" → 상위 KR을 선택해 개인 과제를 연결합니다.</li>
          <li><b>내 업무 과제</b>에서 나에게 할당된 정량 지표·정성 과제·중점 과제를 확인합니다.</li>
          <li><b>업무일지 작성</b>에서 대상 선택:
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              <li>📊 <b>KPI 지표 선택 → 달성값 입력</b> → KPI가 자동 업데이트됩니다.</li>
              <li>🎯 OKR 과제 선택 → 진행 내용 기록 (과제 완료 시 완료 체크).</li>
              <li>🚩 중점 과제 선택 → 진행 내용·진행률(%) 기록 → 과제에 컨텐츠가 쌓입니다.</li>
            </ul>
          </li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GoLink to="/goals/my" label="내 업무 과제" />
          <GoLink to="/quick" label="업무일지 작성" />
        </div>
      </div>
      <StepArrow />

      {/* STEP 4 */}
      <div style={{ ...card, borderLeft: '6px solid #d97706' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RoleChip text="STEP 5 · 팀장 / 경영진" color="#d97706" />
          <b>모니터링 & 리뷰</b>
          <span style={{ fontSize: 12, color: '#64748b' }}>매주 · 매월</span>
        </div>
        <ul style={{ margin: '10px 0 8px 20px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
          <li><b>팀장</b>: 정량 목표 (팀 KPI) 조회에서 지표 추이·미달 경고를 확인하고 팀 리뷰를 진행합니다.</li>
          <li><b>경영진</b>: 전사 목표 현황에서 회사 → 실 → 팀 → 개인으로 드릴다운하며 달성/미달/미입력과 과제 진행을 모니터링합니다.</li>
        </ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GoLink to="/okr/team-board" label="정량 목표 (팀 KPI) 조회" />
          <GoLink to="/goals/overview" label="전사 목표 현황" />
        </div>
      </div>

      <div style={{ ...card, background: '#FEF2F2', border: '1px solid #fecaca' }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>⚠ 자주 막히는 부분</div>
        <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
          <li><b>임원·팀장·팀원도 상위 없이 목표를 시작할 수 있나요?</b> → 네. 정성 목표(OKR) 입력에서 상위 O-KR을 <b>"⊘ 상위 없음 — 자체 시작 (비정렬)"</b>으로 두면 누구든 새 목표 트리를 시작할 수 있습니다. 임원이 시작하면 팀장→팀원으로, 팀장이 시작하면 팀원으로 동일하게 내려갑니다. 전사 정렬이 가능한 목표라면 상위 정렬을 권장합니다.</li>
          <li><b>전사 목표에 정렬되지 않은 개인 업무도 되나요?</b> → 네, 3가지 방법: ① 일상 업무는 업무일지 <b>"과제 미선택(키워드 직접 입력)"</b> → 📂 개인 일반 업무로 자동 기록 ② 목표급이면 OKR <b>자체 시작(비정렬)</b> ③ 프로젝트급 돌발 업무는 중점 추진 과제 "미정렬(독립 과제)".</li>
          <li><b>팀원 일지에 KPI 지표가 안 보여요</b> → STEP 3에서 팀 KPI의 <b>참여자(담당자)</b>로 지정되었는지 확인하세요.</li>
          <li><b>달성/미달 판정 기준</b> → 가장 최근 입력값 vs 목표값을 방향(이상/이하)에 따라 비교합니다.</li>
          <li><b>입력 주기</b> → KPI 지표값은 최소 월 1회 입력을 권장합니다. 입력이 없으면 "미입력"으로 표시됩니다.</li>
          <li><b>중점 과제가 안 보여요</b> → 과제의 <b>담당자</b>로 지정된 사람의 일지·내 업무 과제에만 표시됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
