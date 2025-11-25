import React from 'react';

export function OkrInstructions() {
  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0 }}>입력 안내: 전사 개선 목표 & KPI 체계</h2>

      <section className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>작성 취지</h3>
        <div>
          전사 전략축(Q/C/D/Dev/P)을 기준으로 "무엇을 어떻게 개선할 것인지(OKR)"와
          "어떤 지표로 운영을 관리할 것인지(KPI)"를 일관된 틀로 정리합니다.
        </div>
      </section>

      <section className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>전체 구조</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>전사 OKR: Q / C / D / Dev / P 축으로 전사 Objective 4~5개 내외 설정</li>
          <li>팀 OKR: 전사 OKR을 팀 관점에서 하위 목표(O)와 핵심 지표(KR)로 전개</li>
          <li>팀 KPI 표: 운영 지표 전체를 관리하고, OKR에 포함되는 지표는 연결 표시</li>
        </ul>
      </section>

      <section className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>팀 KPI 표 컬럼 가이드</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>전략축(주): Q / C / D / Dev / P 중 1개</li>
          <li>KPI명, 단위, 주기</li>
          <li>기준값(전년도/당해) 및 목표값(차년도), 평가비중</li>
          <li>주요 추진 계획(이니셔티브)
            <div style={{ color: '#6b7280', fontSize: 13 }}>KR 달성을 위한 핵심 과제. 시스템에서는 KR 하위 Initiative로 저장됩니다.</div>
          </li>
          <li>OKR 연계: 팀 OKR 코드(예: O1-KR2) 또는 연결된 Objective/KR 선택</li>
        </ul>
      </section>

      <section className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>입력 절차</h3>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>전사 OKR 입력: 상위 Objective 생성(조직/기간/전략축) → KR(지표/목표/단위/베이스라인/비중/주기/전략축)</li>
          <li>팀 KPI/OKR 입력: 팀 Objective 생성 또는 선택 → KR로 KPI를 등록 → KR별 추진 계획(이니셔티브) 등록</li>
          <li>대시보드 확인: 전사/팀별 보드에서 Pillar별 정렬과 연결 관계 확인</li>
        </ol>
      </section>
    </div>
  );
}
