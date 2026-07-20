import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/**
 * 전략 정렬 지도 — 탑다운(전략 기둥 ▸ 목표 ▸ KR/과제)과 바텀업(활동 ▸ 일지)을 잇는다.
 * 각 목표에 연결된 활동의 실행량(일지)·지식(🏅)을 굴려올려 양방향 공백을 대조한다:
 *  · 실행 없는 목표(선언만) — 붉게    · 목표 없는 실행(고아 활동) — 아래 별도 카드
 */
type Goal = { id: string; title: string; metric?: string; unit?: string; status?: string; orgUnitName?: string | null; activityId: string | null; activityName: string | null; domain?: string | null; worklogCount: number; knowledgeCount: number };
type Obj = {
  id: string; title: string; pillar: string | null; orgUnitName: string | null; auto: boolean;
  krs: Goal[]; initiatives: Goal[];
  exec: { worklogs: number; knowledge: number; totalGoals: number; linkedGoals: number; unlinkedGoals: number };
};
type Orphan = { id: string; name: string; domain: string | null; worklogCount: number; knowledgeCount: number };
type Data = {
  totals: { objectives: number; goals: number; linkedGoals: number; deadGoals: number; orphanActivities: number };
  objectives: Obj[]; orphanActivities: Orphan[];
};

const PILLARS: { key: string; label: string; color: string; bg: string }[] = [
  { key: 'C', label: '생산성 혁신', color: '#2563eb', bg: '#eff6ff' },
  { key: 'Q', label: '품질 혁신', color: '#16a34a', bg: '#f0fdf4' },
  { key: 'D', label: '납기 혁신', color: '#d97706', bg: '#fffbeb' },
  { key: 'DEV', label: '신차 개발', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'P', label: '역량 강화', color: '#db2777', bg: '#fdf2f8' },
  { key: '_', label: '전략 미지정', color: '#64748b', bg: '#f8fafc' },
];
const pillarOf = (k: string | null) => PILLARS.find((p) => p.key === (k || '_')) || PILLARS[PILLARS.length - 1];

export function StrategyMap() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [hideAuto, setHideAuto] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(false);

  useEffect(() => {
    apiJson<Data>(`/api/activities/strategy-map?actorId=${encodeURIComponent(userId)}`)
      .then(setData)
      .catch((e) => setError(e?.message || '조회 실패'));
  }, []);

  const byPillar = useMemo(() => {
    const m = new Map<string, Obj[]>();
    if (!data) return m;
    for (const o of data.objectives) {
      if (hideAuto && o.auto) continue;
      if (hideEmpty && o.exec.totalGoals === 0) continue;
      const k = o.pillar || '_';
      (m.get(k) || m.set(k, []).get(k)!).push(o);
    }
    return m;
  }, [data, hideAuto, hideEmpty]);

  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;
  if (!data) return <div style={{ padding: 24, color: '#94a3b8' }}>전략 정렬 지도를 불러오는 중…</div>;

  const t = data.totals;
  const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 16px' };
  const evidenceChip = (g: Goal) => {
    const dead = g.worklogCount === 0;
    return (
      <span title={g.activityId ? `연결 활동: ${g.activityName}` : '연결된 활동 없음 — ⛏ 채굴/🎯 매칭 필요'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap',
          color: dead ? '#b91c1c' : '#166534', background: dead ? '#fef2f2' : '#f0fdf4', border: `1px solid ${dead ? '#fecaca' : '#bbf7d0'}` }}>
        {dead ? '실행증거 없음' : `📝 ${g.worklogCount}`}{g.knowledgeCount > 0 ? ` · 🏅${g.knowledgeCount}` : ''}
      </span>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>🧭 전략 정렬 지도</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          전략 기둥 ▸ 목표(Objective) ▸ KR·중점과제 아래로 <b>실제 실행(업무일지)</b>이 매달려 있는지 대조합니다.
          목표에 연결된 활동의 일지·지식(🏅)을 굴려올려 <b style={{ color: '#b91c1c' }}>실행 증거 없는 목표</b>와
          <b style={{ color: '#7c3aed' }}> 목표 없이 도는 실행</b>을 함께 봅니다.
          <br />연결이 비어 보이면 활동 지도에서 <b>⛏ 활동 추출 → 🎯 KPI·과제 매칭</b>을 먼저 실행하세요.
        </div>
      </div>

      {/* 요약 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={card}><div style={{ fontSize: 12, color: '#64748b' }}>목표(Objective)</div><div style={{ fontSize: 22, fontWeight: 800 }}>{t.objectives}</div></div>
        <div style={card}><div style={{ fontSize: 12, color: '#64748b' }}>KR·과제</div><div style={{ fontSize: 22, fontWeight: 800 }}>{t.goals}<span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}> · 활동연결 {t.linkedGoals}</span></div></div>
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2' }}><div style={{ fontSize: 12, color: '#b91c1c' }}>실행 증거 없는 목표</div><div style={{ fontSize: 22, fontWeight: 800, color: '#b91c1c' }}>{t.deadGoals}</div></div>
        <div style={{ ...card, borderColor: '#ddd6fe', background: '#f5f3ff' }}><div style={{ fontSize: 12, color: '#7c3aed' }}>목표 없는 실행(활동)</div><div style={{ fontSize: 22, fontWeight: 800, color: '#7c3aed' }}>{t.orphanActivities}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#475569', alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={hideAuto} onChange={(e) => setHideAuto(e.target.checked)} />자동생성 목표 숨기기</label>
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />KR 없는 목표 숨기기</label>
      </div>

      {/* 전략 기둥별 트리 */}
      {PILLARS.filter((p) => byPillar.get(p.key)?.length).map((p) => {
        const objs = (byPillar.get(p.key) || []).sort((a, b) => b.exec.worklogs - a.exec.worklogs);
        return (
          <div key={p.key} style={{ border: `1px solid ${p.color}33`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ background: p.bg, padding: '8px 16px', fontWeight: 800, color: p.color, borderBottom: `1px solid ${p.color}22` }}>
              {p.label} <span style={{ fontWeight: 500, fontSize: 12, color: '#64748b' }}>— 목표 {objs.length}개</span>
            </div>
            <div style={{ padding: '4px 0' }}>
              {objs.map((o) => {
                const goals = [...o.krs, ...o.initiatives];
                const dead = o.exec.worklogs === 0;
                return (
                  <details key={o.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <summary style={{ cursor: 'pointer', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{o.title}</span>
                      {o.orgUnitName && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', borderRadius: 6, padding: '1px 6px' }}>{o.orgUnitName}</span>}
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: dead ? '#b91c1c' : '#166534', fontWeight: 700 }}>
                        {dead ? '⚠ 실행 증거 없음' : `📝 일지 ${o.exec.worklogs}${o.exec.knowledge ? ` · 🏅 ${o.exec.knowledge}` : ''}`}
                      </span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>KR·과제 {goals.length} · 연결 {o.exec.linkedGoals}</span>
                    </summary>
                    <div style={{ padding: '2px 16px 12px 28px', display: 'grid', gap: 5 }}>
                      {goals.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>등록된 KR·과제가 없습니다.</div>}
                      {o.krs.map((g) => (
                        <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700, width: 30 }}>KR</span>
                          <span>{g.title}</span>
                          {g.metric && <span style={{ fontSize: 11, color: '#94a3b8' }}>({g.metric})</span>}
                          <span style={{ flex: 1 }} />
                          {g.activityName && <span style={{ fontSize: 11, color: '#64748b' }}>↔ {g.activityName}</span>}
                          {evidenceChip(g)}
                        </div>
                      ))}
                      {o.initiatives.map((g) => (
                        <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ fontSize: 10, color: '#d97706', fontWeight: 700, width: 30 }}>과제</span>
                          <span>{g.title}</span>
                          <span style={{ flex: 1 }} />
                          {g.activityName && <span style={{ fontSize: 11, color: '#64748b' }}>↔ {g.activityName}</span>}
                          {evidenceChip(g)}
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 역방향 공백: 목표 없이 도는 실행 */}
      {data.orphanActivities.length > 0 && (
        <div style={{ border: '1px solid #c4b5fd', background: '#f5f3ff', borderRadius: 12, padding: '10px 16px' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#5b21b6', marginBottom: 6 }}>🔎 목표 없이 도는 실행 — 일지는 쌓이는데 어떤 KR·과제에도 연결되지 않은 활동</div>
          <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 8 }}>전략에 매달리지 않은 실무입니다. 관리가 필요하면 활동 지도의 <b>🎯 목표 공백 카드</b>에서 중점과제로 승격하세요.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.orphanActivities.map((a) => (
              <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, border: '1px solid #ddd6fe', background: '#fff', borderRadius: 8, padding: '4px 8px' }}>
                <b style={{ color: '#5b21b6' }}>{a.name}</b>
                {a.domain && <span style={{ fontSize: 10, color: '#94a3b8' }}>{a.domain}</span>}
                <span style={{ color: '#7c3aed' }}>📝 {a.worklogCount}{a.knowledgeCount ? ` · 🏅${a.knowledgeCount}` : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default StrategyMap;
