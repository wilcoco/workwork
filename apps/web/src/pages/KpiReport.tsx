import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type OrgUnit = { id: string; name: string; type: string; parentId?: string | null };
type Pillar = 'Q' | 'C' | 'D' | 'DEV' | 'P';
type ProgressEntry = { krValue: number | null; periodStart: string; createdAt: string };

type Kr = {
  id: string; title: string; unit?: string | null; target?: number | null; baseline?: number | null;
  year25Target?: number | null; weight?: number | null; direction?: 'AT_LEAST' | 'AT_MOST' | null;
  pillar?: Pillar | null; metric?: string | null;
  latest?: number | null; latestMonth?: string | null;
};

const PILLARS: { key: Pillar; label: string; color: string; bg: string }[] = [
  { key: 'C', label: '생산성 혁신', color: '#2563eb', bg: '#eff6ff' },
  { key: 'Q', label: '품질 혁신', color: '#16a34a', bg: '#f0fdf4' },
  { key: 'D', label: '납기 혁신', color: '#d97706', bg: '#fffbeb' },
  { key: 'DEV', label: '신차 개발', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'P', label: '역량 강화', color: '#db2777', bg: '#fdf2f8' },
];
const PINFO = (p?: string | null) => PILLARS.find((x) => x.key === p) || { key: 'C' as Pillar, label: '기타', color: '#64748b', bg: '#f8fafc' };

function kstMonth(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

function achievement(kr: Kr): number | null {
  const v = kr.latest;
  if (v == null || kr.target == null) return null;
  let pct: number;
  if (kr.direction === 'AT_MOST') {
    if (v <= 0) return 100;          // 0 이하 = 목표(이하 좋음) 완전 달성
    if (kr.target === 0) return 0;   // 목표 0인데 실적>0 → 미달
    pct = (kr.target / v) * 100;
  } else {
    if (kr.target === 0) return null;
    pct = (v / kr.target) * 100;
  }
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}
const achColor = (p: number | null) => (p == null ? '#94a3b8' : p >= 100 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626');

export function KpiReport() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [myRole, setMyRole] = useState('');
  const [month, setMonth] = useState(kstMonth());
  const [krs, setKrs] = useState<Kr[]>([]);
  const [loading, setLoading] = useState(false);

  const teams = useMemo(() => orgs.filter((o) => o.type === 'TEAM'), [orgs]);
  const isExec = myRole === 'CEO' || myRole === 'EXEC';
  const teamName = teams.find((t) => t.id === orgUnitId)?.name || '';

  useEffect(() => {
    (async () => {
      try { const r = await apiJson<{ items: OrgUnit[] }>(`/api/orgs`); setOrgs(r.items || []); } catch { /* */ }
    })();
  }, []);
  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const me = await apiJson<{ role: string; orgUnitId?: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole(me.role || '');
        if (!orgUnitId && me.orgUnitId) setOrgUnitId(me.orgUnitId);
      } catch { /* */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function load() {
    if (!orgUnitId) { setKrs([]); return; }
    setLoading(true);
    try {
      const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(orgUnitId)}`);
      const objs = (res.items || []).filter((o: any) => o.pillar);
      const flat: Kr[] = [];
      for (const o of objs) for (const kr of (o.keyResults || [])) flat.push({ ...kr, pillar: kr.pillar || o.pillar });
      await Promise.all(flat.map(async (kr) => {
        try {
          const pr = await apiJson<{ items: ProgressEntry[] }>(`/api/progress?subjectType=KR&subjectId=${encodeURIComponent(kr.id)}`);
          const items = pr.items || [];
          // 선택 월 우선, 없으면 가장 최근값
          const m = items.find((e) => String(e.periodStart).slice(0, 7) === month);
          const pick = m || items[0];
          kr.latest = pick?.krValue ?? null;
          kr.latestMonth = pick ? String(pick.periodStart).slice(0, 7) : null;
        } catch { kr.latest = null; }
      }));
      setKrs(flat);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgUnitId, month]);

  const summary = useMemo(() => {
    let wsum = 0, wach = 0, done = 0;
    for (const kr of krs) {
      const w = typeof kr.weight === 'number' && kr.weight > 0 ? kr.weight : 0;
      const a = achievement(kr);
      if (a != null) done++;
      if (w > 0 && a != null) { wsum += w; wach += w * Math.min(a, 100); }
    }
    return { total: krs.length, done, weighted: wsum > 0 ? Math.round((wach / wsum) * 10) / 10 : null };
  }, [krs]);

  const byPillar = useMemo(() => PILLARS.map((p) => ({ p, list: krs.filter((k) => (k.pillar || 'C') === p.key) })).filter((g) => g.list.length), [krs]);

  return (
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div className="report-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>📊 팀 KPI 리포트</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} disabled={!isExec} style={{ padding: '6px 8px' }}>
            <option value="">팀 선택</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '6px 8px' }} />
          <button type="button" className="btn btn-sm" onClick={() => window.print()}>🖨 인쇄</button>
        </div>
      </div>

      {loading ? (
        <div>불러오는 중…</div>
      ) : !orgUnitId ? (
        <div style={{ color: '#64748b', padding: 24, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>팀을 선택하세요.</div>
      ) : krs.length === 0 ? (
        <div style={{ color: '#64748b', padding: 24, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>등록된 정량 KPI가 없습니다.</div>
      ) : (
        <>
          {/* 헤더 요약 배너 */}
          <div style={{ borderRadius: 16, padding: 20, background: 'linear-gradient(135deg,#0f3d73,#2563eb)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>2026년 KPI 리포트 · {month}</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{teamName}</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>KPI {summary.total}개 · 실적 입력 {summary.done}개</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>가중 달성률</div>
              <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }}>{summary.weighted != null ? `${summary.weighted}%` : '-'}</div>
            </div>
          </div>

          {/* 분야별 섹션 */}
          {byPillar.map(({ p, list }) => {
            const wsum = list.reduce((s, k) => s + (typeof k.weight === 'number' ? k.weight : 0), 0);
            return (
              <div key={p.key} style={{ border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: p.bg, borderBottom: `2px solid ${p.color}` }}>
                  <div style={{ fontWeight: 800, color: p.color }}>{p.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{list.length}개 · 비중합 {wsum}%</div>
                </div>
                <div style={{ display: 'grid', gap: 0 }}>
                  {list.map((kr, i) => {
                    const a = achievement(kr);
                    const barPct = a == null ? 0 : Math.max(0, Math.min(a, 100));
                    return (
                      <div key={kr.id} style={{ padding: '10px 14px', borderTop: i ? '1px solid #f1f5f9' : 'none', display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <div style={{ fontWeight: 700 }}>{kr.title}{kr.unit ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> ({kr.unit})</span> : null}</div>
                          <div style={{ fontSize: 13, color: '#475569' }}>
                            목표 <b>{kr.target ?? '-'}</b>
                            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                            실적 <b style={{ color: '#0f172a' }}>{kr.latest != null ? kr.latest.toLocaleString() : '-'}</b>
                            {kr.latestMonth ? <span style={{ color: '#94a3b8' }}> ({kr.latestMonth})</span> : null}
                            {typeof kr.weight === 'number' ? <span style={{ marginLeft: 8, color: '#94a3b8' }}>비중 {kr.weight}%</span> : null}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, height: 10, background: '#eef2f7', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ width: `${barPct}%`, height: '100%', background: achColor(a), borderRadius: 999, transition: 'width .3s' }} />
                          </div>
                          <div style={{ minWidth: 56, textAlign: 'right', fontWeight: 800, color: achColor(a) }}>{a != null ? `${a}%` : '-'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
                          <span>25목표 {kr.year25Target ?? '-'}</span>
                          <span>25실적 {kr.baseline ?? '-'}</span>
                          <span>26목표 {kr.target ?? '-'}</span>
                          <span>{kr.direction === 'AT_MOST' ? '↓ 이하 좋음' : '↑ 이상 좋음'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
