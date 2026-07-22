import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/**
 * 회사 활동 지도 (온톨로지 대시보드)
 * 회사가 수행하는 활동 전체를 한 화면에서 조망: 어디서 쓰이고(프로세스),
 * 얼마나 실행되고(일지), 지식이 어디에 쌓였고(🏅), 어디가 비어 있는가(리스크).
 */
type Item = { id: string; name: string; taskType?: string | null; roleHint?: string | null; domain?: string | null; category?: string | null; aliasCount: number; templateUse: number; worklogCount: number; knowledgeCount: number; kpiCount?: number; initiativeCount?: number; lastRunAt?: string | null };
type Overview = {
  totals: { activities: number; withKnowledge: number; executedActivities: number; totalKnowledge: number; byType: Record<string, number> };
  items: Item[]; risky: Item[]; rich: Item[];
};
type Knowledge = { activity: { id: string; name: string; taskType?: string; criteria?: string; roleHint?: string; aliases?: string[] }; knowledge: Array<{ id: string; title: string; excerpt: string; badgeNote: string; authorName: string; date: string }> };

const TYPE_KO: Record<string, string> = { WORKLOG: '업무', APPROVAL: '결재', COOPERATION: '협조' };

export function ActivityMap() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [mining, setMining] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [orgProgress, setOrgProgress] = useState('');

  // 대상(설비·차종·고객사) 채굴 — 두 번째 객체 타입
  const [miningEnt, setMiningEnt] = useState(false);
  const [entProgress, setEntProgress] = useState('');
  async function mineEntities() {
    if (!confirm('업무일지에서 대상(설비·차종·고객사·협력사·부품·시스템)을 추출해 온톨로지에 등록합니다.\n100건 단위로 자동 반복 처리합니다 (활동 추출과 별도, 이미 처리된 일지는 건너뜀). 진행할까요?')) return;
    setMiningEnt(true);
    const tot = { scanned: 0, linked: 0, created: 0 };
    let fail = 0;
    try {
      for (let round = 1; round <= 40; round++) {
        setEntProgress(`${round}회차 · ${tot.scanned}건`);
        let r: { scanned: number; linked: number; created: number; error?: string };
        try {
          r = await apiJson(`/api/activities/mine-entities`, { method: 'POST', body: JSON.stringify({ actorId: userId, days: 180, limit: 100 }) });
        } catch { if (++fail >= 3) { alert(`서버 오류 반복 — 중단 (${tot.scanned}건 처리)`); break; } continue; }
        if (r.error) { if (++fail >= 2) { alert(`AI 추출 실패 — 중단 (${tot.scanned}건 처리, 연결 ${tot.linked}건)`); break; } continue; }
        fail = 0;
        tot.scanned += r.scanned; tot.linked += r.linked; tot.created += r.created;
        if (r.scanned < 100) { alert(`완료 — 일지 ${tot.scanned}건에서 대상 ${tot.created}개 등록, 링크 ${tot.linked}건`); break; }
        if (round === 40) alert(`40회차 처리 — ${tot.scanned}건, 대상 ${tot.created}개. 남은 일지는 다시 눌러 이어서.`);
      }
    } finally { setMiningEnt(false); setEntProgress(''); }
  }

  // 탑다운 매칭: KPI/중점과제를 활동과 연결
  const [mappingGoals, setMappingGoals] = useState(false);
  async function mapGoals() {
    if (!confirm('KPI 지표와 중점과제를 활동 사전과 매칭합니다 (확실한 것만 연결). 진행할까요?')) return;
    setMappingGoals(true);
    try {
      const r = await apiJson<any>(`/api/activities/map-goals`, { method: 'POST', body: JSON.stringify({ actorId: userId }) });
      alert(`KPI ${r.kpiMapped}/${r.kpiScanned}건, 중점과제 ${r.initiativeMapped}/${r.initiativeScanned}건 연결${r.note ? `\n${r.note}` : ''}`);
      const d = await apiJson<Overview>(`/api/activities/dashboard/overview?actorId=${encodeURIComponent(userId)}`); setData(d);
    } catch (e: any) { alert(e?.message || '실행 실패'); }
    finally { setMappingGoals(false); }
  }

  // 갭 영역에 중점과제 생성 (③ 부족 영역 → 과제)
  async function createInitiativeForDomain(domain: string) {
    const title = prompt(`「${domain}」 영역에 만들 중점과제 제목을 입력하세요:`, `${domain} 업무 체계화 및 지표 정립`);
    if (!title?.trim()) return;
    try {
      await apiJson(`/api/key-initiatives`, { method: 'POST', body: JSON.stringify({ title: title.trim(), goal: `[활동 지도 갭 보완] ${domain} 영역`, assigneeId: userId, createdById: userId, actorId: userId }) });
      alert('중점과제가 생성되었습니다. 목표관리 ▸ 중점 추진 과제에서 담당·기한을 지정하세요.');
    } catch (e: any) { alert(e?.message || '생성 실패'); }
  }

  // 유사 활동 병합: 잘게 쪼개진 활동을 하나의 반복작업으로 통합 (반복 실행 시 남은 후보 이어서)
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState('');
  async function mergeSimilar() {
    if (!confirm('이름이 비슷해 사실상 같은 반복작업인 활동들을 AI로 묶어 하나로 통합합니다.\n예: "구매원가 계산서 작성 및 송부", "구매원가 2차 계산서 작성" → "구매원가 계산서 작성".\n원본 이름은 별칭으로 보존됩니다. 후보가 소진될 때까지 자동 반복하며 수 분 걸릴 수 있습니다. 진행할까요?')) return;
    setMerging(true);
    const tot = { merged: 0, removed: 0 };
    let failStreak = 0;
    const MAX = 60;
    try {
      for (let round = 1; round <= MAX; round++) {
        setMergeProgress(`${round}회차 · 통합 ${tot.merged}그룹`);
        let r: { candidates: number; processed: number; merged: number; removed: number; remaining: number };
        try {
          r = await apiJson(`/api/activities/merge-similar`, { method: 'POST', body: JSON.stringify({ actorId: userId, limit: 5 }) });
        } catch (err: any) {
          if (++failStreak >= 3) { alert(`서버 오류가 반복됩니다 — 잠시 후 다시 시도하세요.\n(지금까지 ${tot.merged}그룹 통합, ${tot.removed}개 정리)`); break; }
          continue; // 일시적 오류는 건너뛰고 재시도
        }
        failStreak = 0;
        tot.merged += r.merged; tot.removed += r.removed;
        if (r.remaining === 0 || r.candidates === 0) {
          alert(`완료 — ${tot.merged}개 그룹 통합, 중복 활동 ${tot.removed}개 정리`);
          break;
        }
        if (round === MAX) alert(`${MAX}회차까지 진행 — ${tot.merged}그룹 통합, ${tot.removed}개 정리. 남은 후보는 버튼을 다시 눌러 이어서 처리하세요.`);
      }
      const d = await apiJson<Overview>(`/api/activities/dashboard/overview?actorId=${encodeURIComponent(userId)}`); setData(d);
    } catch (e: any) { alert((e?.message || '실행 실패') + (tot.merged ? `\n(중단 전까지 ${tot.merged}그룹 통합)` : '')); }
    finally { setMerging(false); setMergeProgress(''); }
  }

  // 체계 정리: 미분류 활동을 대분류/중분류로 AI 분류 (미분류 소진까지 자동 반복)
  async function organize() {
    if (!confirm('추출된 활동을 회사 기능 체계(영업/생산/품질 등 대분류 → 중분류)로 정리합니다.\n미분류가 없어질 때까지 자동 반복하며 수 분 걸릴 수 있습니다. 진행할까요?')) return;
    setOrganizing(true);
    let totalClassified = 0;
    try {
      for (let round = 1; round <= 30; round++) {
        setOrgProgress(`${round}회차 · 누적 ${totalClassified}개`);
        const r = await apiJson<{ classified: number; remaining: number }>(`/api/activities/organize`, {
          method: 'POST', body: JSON.stringify({ actorId: userId }),
        });
        totalClassified += r.classified;
        if (r.remaining === 0 || r.classified === 0) {
          alert(`활동 ${totalClassified}개 분류 완료${r.remaining ? ` (미분류 ${r.remaining}개 남음)` : ' — 전부 분류됨'}`);
          break;
        }
        if (round === 30) alert(`30회차까지 진행 — ${totalClassified}개 분류. 남으면 버튼을 다시 누르세요.`);
      }
      const d = await apiJson<Overview>(`/api/activities/dashboard/overview?actorId=${encodeURIComponent(userId)}`); setData(d);
    } catch (e: any) { alert(e?.message || '실행 실패'); }
    finally { setOrganizing(false); setOrgProgress(''); }
  }

  // 상향식 채굴: 기존 업무일지에서 활동 추출·정합 (반복 클릭 시 미연결 일지 이어서 처리)
  const [mineProgress, setMineProgress] = useState('');
  const [mineDays, setMineDays] = useState(180); // 분석 기간 (0=전체)
  const [mineMax, setMineMax] = useState(500); // 최대 처리 건수
  async function mine() {
    const maxCount = Math.max(100, Math.min(mineMax || 500, 4000));
    const periodLabel = mineDays ? `최근 ${mineDays >= 360 ? `${Math.round(mineDays / 30 / 12 * 10) / 10}년` : `${Math.round(mineDays / 30)}개월`}` : '전체 기간';
    if (!confirm(`${periodLabel}의 미처리 업무일지에서 최대 ${maxCount}건을 분석해 활동 사전에 등록/연결합니다.\n100건 단위로 자동 반복 처리하며 수 분 걸릴 수 있습니다 (중간에 페이지를 닫아도 처리된 만큼은 저장됨). 진행할까요?`)) return;
    setMining(true);
    const total = { scanned: 0, linked: 0, created: 0, skipped: 0 };
    const rounds = Math.ceil(maxCount / 100);
    let failStreak = 0;
    try {
      for (let round = 1; round <= rounds; round++) {
        setMineProgress(`${round}/${rounds}회차 · 누적 ${total.scanned}건`);
        const batch = Math.min(100, maxCount - total.scanned);
        const r = await apiJson<{ scanned: number; linked: number; created: number; skipped: number; error?: string }>(`/api/activities/mine-worklogs`, {
          method: 'POST', body: JSON.stringify({ actorId: userId, days: mineDays, limit: batch }),
        });
        if (r.error) { if (++failStreak >= 2) { alert('AI 추출이 연속 실패했습니다 — 잠시 후 다시 시도하세요.\n' + `(지금까지 ${total.scanned}건 처리, 연결 ${total.linked}건)`); break; } continue; }
        failStreak = 0;
        total.scanned += r.scanned; total.linked += r.linked; total.created += r.created; total.skipped += r.skipped;
        if (r.scanned < batch || total.scanned >= maxCount) {
          alert(`${r.scanned < batch ? '잔여 소진 — ' : ''}일지 ${total.scanned}건 처리, 활동 연결 ${total.linked}건 (신규 활동 ${total.created}개, 작업 특정불가 ${total.skipped}건)${total.scanned >= maxCount && r.scanned >= batch ? '\n남은 일지는 버튼을 다시 눌러 이어서 처리할 수 있습니다.' : ''}`);
          break;
        }
      }
      const d = await apiJson<Overview>(`/api/activities/dashboard/overview?actorId=${encodeURIComponent(userId)}`); setData(d);
    } catch (e: any) { alert((e?.message || '실행 실패') + (total.scanned ? `\n(중단 전까지 ${total.scanned}건 처리, 연결 ${total.linked}건)` : '')); }
    finally { setMining(false); setMineProgress(''); }
  }
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [sel, setSel] = useState<Knowledge | null>(null);

  useEffect(() => {
    apiJson<Overview>(`/api/activities/dashboard/overview?actorId=${encodeURIComponent(userId)}`)
      .then(setData)
      .catch((e) => setError(e?.message || '조회 실패'));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter((it) => (!q.trim() || it.name.includes(q.trim())) && (!typeF || it.taskType === typeF))
      .sort((a, b) => (b.knowledgeCount - a.knowledgeCount) || (b.worklogCount - a.worklogCount) || (b.templateUse - a.templateUse));
  }, [data, q, typeF]);

  async function openKnowledge(id: string) {
    try { setSel(await apiJson<Knowledge>(`/api/activities/${encodeURIComponent(id)}/knowledge?actorId=${encodeURIComponent(userId)}`)); } catch {}
  }

  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;
  if (!data) return <div style={{ padding: 24, color: '#94a3b8' }}>회사 활동 지도를 불러오는 중…</div>;

  const t = data.totals;
  const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 16px' };
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13 };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>🗺 회사 활동 지도</h2>
        <div style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>프로세스 템플릿을 만들 때마다 회사의 <b>활동 사전</b>이 자동으로 자랍니다. 각 활동에 실행 기록(일지)과 인증 지식(🏅)이 쌓입니다.</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #e2e8f0', borderRadius: 8, padding: '2px 6px', background: '#f8fafc' }}>
            <select value={mineDays} disabled={mining} onChange={(e) => setMineDays(Number(e.target.value))} title="분석 기간" style={{ fontSize: 12, border: 'none', background: 'transparent' }}>
              <option value={90}>최근 3개월</option>
              <option value={180}>최근 6개월</option>
              <option value={365}>최근 1년</option>
              <option value={730}>최근 2년</option>
              <option value={0}>전체 기간</option>
            </select>
            <select value={mineMax} disabled={mining} onChange={(e) => setMineMax(Number(e.target.value))} title="최대 분석 건수" style={{ fontSize: 12, border: 'none', background: 'transparent' }}>
              <option value={100}>100건</option>
              <option value={300}>300건</option>
              <option value={500}>500건</option>
              <option value={1000}>1,000건</option>
              <option value={2000}>2,000건</option>
              <option value={4000}>4,000건</option>
            </select>
            <button className="btn btn-sm btn-outline" disabled={mining} onClick={() => void mine()} title="선택한 기간·건수의 업무일지에서 활동을 추출해 사전을 채웁니다 (임원 이상)">
              {mining ? `⛏ 추출 중... ${mineProgress}` : '⛏ 일지에서 활동 추출'}
            </button>
          </span>
          <button className="btn btn-sm btn-outline" disabled={merging} onClick={() => void mergeSimilar()} title="이름이 비슷해 사실상 같은 활동을 하나로 통합합니다 (원본명은 별칭 보존, 임원 이상)">
            {merging ? `🔗 통합 중... ${mergeProgress}` : '🔗 유사 활동 병합'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={organizing} onClick={() => void organize()} title="활동을 대분류(기능 영역)→중분류 체계로 정리합니다 (임원 이상)">
            {organizing ? `🗂 정리 중... ${orgProgress}` : '🗂 체계 정리'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={miningEnt} onClick={() => void mineEntities()} title="일지에서 설비·차종·고객사·부품·시스템을 추출해 온톨로지 대상으로 등록합니다 (임원 이상)">
            {miningEnt ? `🏭 추출 중... ${entProgress}` : '🏭 대상 추출'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={mappingGoals} onClick={() => void mapGoals()} title="KPI 지표·중점과제를 활동과 매칭합니다 (임원 이상)">
            {mappingGoals ? '🎯 매칭 중...' : '🎯 KPI·과제 매칭'}
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: '등록된 활동', value: `${t.activities}개`, sub: `업무 ${t.byType.WORKLOG} · 결재 ${t.byType.APPROVAL} · 협조 ${t.byType.COOPERATION}` },
          { label: '실행된 활동', value: `${t.executedActivities}개`, sub: '일지가 1건 이상 연결됨' },
          { label: '지식 보유 활동', value: `${t.withKnowledge}개`, sub: `전체의 ${t.activities ? Math.round((t.withKnowledge / t.activities) * 100) : 0}%` },
          { label: '축적 지식(🏅)', value: `${t.totalKnowledge}건`, sub: 'AI 인증 통과 기록' },
        ].map((c) => (
          <div key={c.label} style={card}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{c.value}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ③ 갭 분석: 실행은 있는데 목표(KPI·과제)가 없는 도메인 → 과제 생성 */}
      {(() => {
        const byDomain = new Map<string, { wl: number; goals: number }>();
        for (const it of data.items) {
          const d = it.domain || '미분류';
          const cur = byDomain.get(d) || { wl: 0, goals: 0 };
          cur.wl += it.worklogCount; cur.goals += (it.kpiCount || 0) + (it.initiativeCount || 0);
          byDomain.set(d, cur);
        }
        const gaps = Array.from(byDomain.entries()).filter(([d, v]) => d !== '미분류' && v.wl >= 5 && v.goals === 0).sort((a, b) => b[1].wl - a[1].wl);
        if (!gaps.length) return null;
        return (
          <div style={{ border: '1px solid #c4b5fd', background: '#f5f3ff', borderRadius: 10, padding: '10px 16px' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#5b21b6', marginBottom: 6 }}>🎯 목표 공백 — 실행(일지)은 많은데 KPI·중점과제가 연결되지 않은 영역</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {gaps.map(([d, v]) => (
                <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, border: '1px solid #ddd6fe', background: '#fff', borderRadius: 8, padding: '4px 8px' }}>
                  <b style={{ color: '#5b21b6' }}>{d}</b> <span style={{ color: '#7c3aed' }}>일지 {v.wl}건 · 목표 0</span>
                  <button className="btn btn-sm btn-outline" style={{ fontSize: 11, padding: '1px 8px' }} onClick={() => void createInitiativeForDomain(d)}>+ 중점과제</button>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 인사이트: 지식 공백 리스크 / 지식 자산 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
        <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#991b1b', marginBottom: 6 }}>⚠ 지식 공백 — 자주 하는데 정리된 지식이 없는 활동</div>
          {data.risky.length === 0 ? <div style={{ fontSize: 12, color: '#b91c1c' }}>해당 없음</div> : data.risky.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: '#7f1d1d' }}>· {r.name} <span style={{ color: '#b91c1c' }}>(일지 {r.worklogCount}건, 지식 0)</span></div>
          ))}
        </div>
        <div style={{ ...card, borderColor: '#fcd34d', background: '#fffbeb' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#92400e', marginBottom: 6 }}>🏅 지식 자산 — 인증 지식이 밀집된 활동</div>
          {data.rich.length === 0 ? <div style={{ fontSize: 12, color: '#b45309' }}>아직 없음 — 일지 지식인증이 쌓이면 여기 나타납니다</div> : data.rich.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: '#78350f', cursor: 'pointer' }} onClick={() => void openKnowledge(r.id)}>· {r.name} <b>🏅{r.knowledgeCount}</b></div>
          ))}
        </div>
      </div>

      {/* 활동 목록 — 도메인(대분류) ▸ 중분류 체계 트리 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="활동 검색" style={{ padding: '5px 10px', fontSize: 13 }} />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} style={{ padding: '5px 8px', fontSize: 13 }}>
          <option value="">전체 유형</option>
          <option value="WORKLOG">업무</option>
          <option value="APPROVAL">결재</option>
          <option value="COOPERATION">협조</option>
        </select>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length}개 · 활동을 클릭하면 축적 지식을 봅니다</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {(() => {
          const domains = new Map<string, Item[]>();
          for (const it of filtered) {
            const d = it.domain || '미분류';
            if (!domains.has(d)) domains.set(d, []);
            domains.get(d)!.push(it);
          }
          const order = ['영업', '연구개발', '금형', '생산-사출', '생산-도장', '생산-조립', '생산관리', '품질', '구매·자재', '물류', '설비·보전', '경영지원', '안전·환경', '기타', '미분류'];
          const sorted = Array.from(domains.entries()).sort((a, b) => (order.indexOf(a[0]) + 100 * Number(order.indexOf(a[0]) < 0)) - (order.indexOf(b[0]) + 100 * Number(order.indexOf(b[0]) < 0)));
          return sorted.map(([domain, items]) => {
            const kn = items.reduce((s2, x) => s2 + x.knowledgeCount, 0);
            // 중분류 그룹
            const cats = new Map<string, Item[]>();
            for (const it of items) {
              const c = it.category || '기타';
              if (!cats.has(c)) cats.set(c, []);
              cats.get(c)!.push(it);
            }
            return (
              <details key={domain} open={domain !== '미분류'} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <summary style={{ padding: '10px 14px', background: domain === '미분류' ? '#f8fafc' : '#eff6ff', cursor: 'pointer', fontWeight: 800, fontSize: 14, color: '#0f172a' }}>
                  {domain} <span style={{ fontWeight: 500, fontSize: 12, color: '#64748b' }}>— 활동 {items.length}개{kn ? ` · 지식 🏅${kn}` : ''}{(() => { const g = items.reduce((s2, x) => s2 + (x.kpiCount || 0) + (x.initiativeCount || 0), 0); return g ? ` · 목표연결 🎯${g}` : ''; })()}</span>
                </summary>
                <div style={{ padding: '6px 10px 10px', display: 'grid', gap: 8 }}>
                  {Array.from(cats.entries()).sort((a, b) => b[1].length - a[1].length).map(([cat, catItems]) => (
                    <div key={cat}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', padding: '4px 4px 2px' }}>{cat} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({catItems.length})</span></div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {catItems.map((it) => (
                          <button key={it.id} type="button" onClick={() => void openKnowledge(it.id)}
                            title={`프로세스 사용 ${it.templateUse} · 일지 ${it.worklogCount} · 지식 ${it.knowledgeCount}${it.roleHint ? ` · 담당: ${it.roleHint}` : ''}`}
                            style={{
                              fontSize: 12, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                              border: `1px solid ${it.knowledgeCount ? '#f59e0b' : '#e2e8f0'}`,
                              background: it.knowledgeCount ? '#fffbeb' : '#fff', color: '#334155',
                            }}>
                            {it.name}
                            {it.worklogCount > 0 && <span style={{ color: '#94a3b8', marginLeft: 4 }}>{it.worklogCount}</span>}
                            {it.knowledgeCount > 0 && <b style={{ color: '#b45309', marginLeft: 4 }}>🏅{it.knowledgeCount}</b>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            );
          });
        })()}
        {!filtered.length && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>아직 등록된 활동이 없습니다. ⛏ 추출 또는 프로세스 템플릿 저장으로 채워집니다.</div>}
      </div>

      {/* 활동 지식 모달 */}
      {sel && (
        <div onClick={() => setSel(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 680, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 16, flex: 1 }}>{sel.activity.name}</b>
              <span style={{ fontSize: 12, color: '#64748b' }}>{TYPE_KO[String(sel.activity.taskType)] || ''}</span>
              <button className="btn btn-sm" onClick={() => setSel(null)}>닫기</button>
            </div>
            {sel.activity.roleHint && <div style={{ fontSize: 12, color: '#64748b' }}>담당: {sel.activity.roleHint}</div>}
            {sel.activity.criteria && <div style={{ fontSize: 12, color: '#0f766e' }}>판단기준: {sel.activity.criteria}</div>}
            {Array.isArray(sel.activity.aliases) && sel.activity.aliases.length > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8' }}>별칭: {sel.activity.aliases.join(', ')}</div>
            )}
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>🏅 축적 지식 {sel.knowledge.length}건</div>
            {sel.knowledge.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>이 활동으로 실행한 일지가 지식 인증을 받으면 여기 쌓입니다.</div>}
            {sel.knowledge.map((k) => (
              <div key={k.id} style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{k.title} <span style={{ fontWeight: 400, fontSize: 11, color: '#92400e' }}>— {k.authorName} · {new Date(k.date).toLocaleDateString()}</span></div>
                {k.excerpt && <div style={{ fontSize: 12, color: '#78350f', marginTop: 2 }}>{k.excerpt}</div>}
                {k.badgeNote && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>“{k.badgeNote}”</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
