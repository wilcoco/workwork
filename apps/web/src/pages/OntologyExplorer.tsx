import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';

/**
 * 🧬 온톨로지 탐색기 — 회사의 아무 객체(활동/목표/KPI/과제/프로세스/매뉴얼/팀/사람)에서
 * 출발해 연결을 따라 탐색한다. 탑다운(전략→실행)과 바텀업(실행→전략) 양방향 계보 추적.
 */
type Chip = { type: string; id: string; label: string; sub?: string | null; worklogs?: number; knowledge?: number };
type Section = { key: string; label: string; items: Chip[]; summary?: string; action?: string | null };
type Node = { type: string; id: string; label: string; sub?: string | null; meta?: { taskType?: string; aliases?: string[] } };
type Explore = { node: Node; sections: Section[] };

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  activity: { icon: '⚙️', label: '활동', color: '#0369a1' },
  entity: { icon: '🏭', label: '대상', color: '#b45309' },
  objective: { icon: '🎯', label: '목표', color: '#7c3aed' },
  keyResult: { icon: '📊', label: 'KPI', color: '#16a34a' },
  keyInitiative: { icon: '🚩', label: '중점과제', color: '#d97706' },
  processTemplate: { icon: '🔀', label: '프로세스', color: '#0f766e' },
  workManual: { icon: '📘', label: '매뉴얼', color: '#1d4ed8' },
  orgUnit: { icon: '🏢', label: '조직', color: '#475569' },
  user: { icon: '👤', label: '구성원', color: '#9333ea' },
};

export function OntologyExplorer() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Chip[]>([]);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState<Explore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trail, setTrail] = useState<Chip[]>([]); // 탐색 경로 (빵부스러기)
  const [viewMode, setViewMode] = useState<'graph' | 'card'>('graph');
  const debounceRef = useRef<number | undefined>(undefined);

  // 검색 디바운스
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await apiJson<{ items: Chip[] }>(`/api/ontology/search?q=${encodeURIComponent(q.trim())}&actorId=${encodeURIComponent(userId)}`);
        setResults(r.items || []);
      } catch (e: any) { setError(e?.message || '검색 실패'); }
      finally { setSearching(false); }
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [q]);

  async function open(chip: Chip, fromTrail = false) {
    setLoading(true); setError(''); setResults([]); setQ('');
    try {
      const r = await apiJson<Explore>(`/api/ontology/explore?type=${encodeURIComponent(chip.type)}&id=${encodeURIComponent(chip.id)}&actorId=${encodeURIComponent(userId)}`);
      setData(r);
      setTrail((prev) => {
        if (fromTrail) {
          const i = prev.findIndex((x) => x.type === chip.type && x.id === chip.id);
          return i >= 0 ? prev.slice(0, i + 1) : [...prev, chip];
        }
        return [...prev.slice(-7), { type: chip.type, id: chip.id, label: chip.label }];
      });
    } catch (e: any) { setError(e?.message || '조회 실패'); }
    finally { setLoading(false); }
  }

  async function createInitiative(activity: Node) {
    const title = prompt(`「${activity.label}」 활동을 개선할 중점과제 제목:`, `${activity.label} 개선`);
    if (!title?.trim()) return;
    try {
      await apiJson(`/api/key-initiatives`, { method: 'POST', body: JSON.stringify({ title: title.trim(), goal: `[온톨로지 탐색기] 활동 「${activity.label}」 개선`, assigneeId: userId, createdById: userId, actorId: userId, activityId: activity.id }) });
      alert('중점과제가 생성되었습니다.');
      void open({ type: activity.type, id: activity.id, label: activity.label }, true);
    } catch (e: any) { alert(e?.message || '생성 실패'); }
  }

  const meta = (t: string) => TYPE_META[t] || { icon: '•', label: t, color: '#64748b' };

  /** 에고 그래프: 중심 노드 + 섹션별 각도 구역에 연결 노드를 방사형 배치 (SVG, 외부 라이브러리 없음) */
  function renderGraph(d: Explore) {
    const W = 960, H = 620, CX = W / 2, CY = H / 2;
    const MAX_PER_SEC = 10;
    const secs = d.sections.filter((x) => x.items.length > 0);
    const nodes: Array<{ chip: Chip; x: number; y: number; secLabel: string; more?: number }> = [];
    const secLabels: Array<{ label: string; x: number; y: number; summary?: string }> = [];
    const totalItems = secs.reduce((a, x) => a + Math.min(x.items.length, MAX_PER_SEC), 0) || 1;
    const GAP = 0.22; // 섹션 간 각도 여백(rad)
    const usable = Math.PI * 2 - GAP * secs.length;
    let ang = -Math.PI / 2; // 12시 방향부터
    for (const sec of secs) {
      const shown = sec.items.slice(0, MAX_PER_SEC);
      const span = usable * (shown.length / totalItems);
      const mid = ang + span / 2;
      secLabels.push({ label: sec.label, x: CX + Math.cos(mid) * 292, y: CY + Math.sin(mid) * 292 });
      shown.forEach((it, i) => {
        const a = shown.length === 1 ? mid : ang + (span * i) / (shown.length - 1 || 1);
        const r = 210 + (i % 2) * 34; // 지그재그 반경으로 라벨 겹침 완화
        nodes.push({ chip: it, x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r, secLabel: sec.label, more: i === shown.length - 1 && sec.items.length > MAX_PER_SEC ? sec.items.length - MAX_PER_SEC : undefined });
      });
      ang += span + GAP;
    }
    const cMeta = meta(d.node.type);
    const trunc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', border: '1px solid #e5e7eb', borderRadius: 14, background: '#fcfcfd' }}>
        {/* 간선 */}
        {nodes.map((n, i) => (
          <line key={`e${i}`} x1={CX} y1={CY} x2={n.x} y2={n.y} stroke={meta(n.chip.type).color} strokeOpacity={0.28} strokeWidth={1.4} />
        ))}
        {/* 섹션 라벨 */}
        {secLabels.map((sl, i) => (
          <text key={`s${i}`} x={sl.x} y={sl.y} textAnchor="middle" fontSize={11} fontWeight={800} fill="#94a3b8">{sl.label}</text>
        ))}
        {/* 연결 노드 */}
        {nodes.map((n, i) => {
          const m = meta(n.chip.type);
          return (
            <g key={`n${i}`} onClick={() => void open(n.chip)} style={{ cursor: 'pointer' }}>
              <circle cx={n.x} cy={n.y} r={17} fill="#fff" stroke={m.color} strokeWidth={1.8} />
              <text x={n.x} y={n.y + 4.5} textAnchor="middle" fontSize={13}>{m.icon}</text>
              <text x={n.x} y={n.y + 31} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#334155">{trunc(n.chip.label, 14)}</text>
              {(n.chip.worklogs || n.chip.knowledge) ? (
                <text x={n.x} y={n.y + 43} textAnchor="middle" fontSize={9} fill="#64748b">
                  {n.chip.worklogs ? `📝${n.chip.worklogs}` : ''}{n.chip.knowledge ? ` 🏅${n.chip.knowledge}` : ''}
                </text>
              ) : n.chip.sub ? (
                <text x={n.x} y={n.y + 43} textAnchor="middle" fontSize={9} fill="#94a3b8">{trunc(n.chip.sub, 16)}</text>
              ) : null}
              {n.more ? <text x={n.x + 24} y={n.y - 14} fontSize={9.5} fontWeight={800} fill="#7c3aed">+{n.more}</text> : null}
            </g>
          );
        })}
        {/* 중심 노드 */}
        <g>
          <circle cx={CX} cy={CY} r={52} fill={`${cMeta.color}14`} stroke={cMeta.color} strokeWidth={2.5} />
          <text x={CX} y={CY - 12} textAnchor="middle" fontSize={20}>{cMeta.icon}</text>
          <text x={CX} y={CY + 8} textAnchor="middle" fontSize={12} fontWeight={800} fill="#0f172a">{trunc(d.node.label, 12)}</text>
          {d.node.label.length > 12 && <text x={CX} y={CY + 22} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0f172a">{trunc(d.node.label.slice(11), 12)}</text>}
          <text x={CX} y={CY + 38} textAnchor="middle" fontSize={9.5} fill="#64748b">{cMeta.label}</text>
        </g>
        {secs.length === 0 && <text x={CX} y={CY + 90} textAnchor="middle" fontSize={12} fill="#94a3b8">연결된 객체가 없습니다</text>}
      </svg>
    );
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>🧬 온톨로지 탐색기</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          활동·목표·KPI·과제·프로세스·매뉴얼·팀·사람 — 무엇이든 검색해서 시작하세요. 연결된 항목을 클릭하면 그 객체로 이동하며,
          <b> 일지 하나에서 전략까지, 전략에서 실무까지</b> 계보를 따라갈 수 있습니다.
        </div>
      </div>

      {/* 검색 */}
      <div style={{ position: 'relative' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 예: 구매원가, 품질 혁신, 사출기, 현대차, SP2, 홍길동..."
          style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '2px solid #cbd5e1', borderRadius: 10, boxSizing: 'border-box' }} />
        {(results.length > 0 || searching) && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 4, maxHeight: 380, overflow: 'auto', boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}>
            {searching && <div style={{ padding: 10, fontSize: 12, color: '#94a3b8' }}>검색 중...</div>}
            {results.map((r) => (
              <div key={`${r.type}:${r.id}`} onClick={() => void open(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', fontSize: 13 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                <span>{meta(r.type).icon}</span>
                <b style={{ flex: 1 }}>{r.label}</b>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.sub || meta(r.type).label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 탐색 경로 */}
      {trail.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: '#64748b' }}>
          {trail.map((tItem, i) => (
            <span key={`${tItem.type}:${tItem.id}:${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span style={{ color: '#cbd5e1' }}>›</span>}
              <button onClick={() => void open(tItem, true)}
                style={{ border: 'none', background: i === trail.length - 1 ? '#e0f2fe' : 'transparent', color: i === trail.length - 1 ? '#0369a1' : '#64748b', cursor: 'pointer', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: i === trail.length - 1 ? 700 : 500 }}>
                {meta(tItem.type).icon} {tItem.label.slice(0, 24)}
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: '#94a3b8', padding: 20 }}>연결을 불러오는 중…</div>}

      {/* 중심 객체 + 축별 연결 */}
      {data && !loading && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            <button className={viewMode === 'graph' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline'} onClick={() => setViewMode('graph')}>🕸 그래프</button>
            <button className={viewMode === 'card' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline'} onClick={() => setViewMode('card')}>▦ 카드</button>
          </div>
          {viewMode === 'graph' && (
            <>
              {renderGraph(data)}
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                {data.node.sub ? <span>{data.node.sub}</span> : null}
                {data.sections.filter((x) => x.summary).map((x) => <span key={x.key}> · {x.summary}</span>)}
                <span style={{ color: '#94a3b8' }}> — 노드를 클릭하면 그 객체가 중심이 됩니다</span>
              </div>
            </>
          )}
          <div style={{ border: `2px solid ${meta(data.node.type).color}33`, background: `${meta(data.node.type).color}0a`, borderRadius: 14, padding: '14px 18px', display: viewMode === 'graph' ? 'none' : undefined }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: meta(data.node.type).color }}>{meta(data.node.type).icon} {meta(data.node.type).label}</div>
            <div style={{ fontSize: 19, fontWeight: 800, margin: '2px 0' }}>{data.node.label}</div>
            {data.node.sub && <div style={{ fontSize: 13, color: '#64748b' }}>{data.node.sub}</div>}
            {data.node.meta?.aliases && data.node.meta.aliases.length > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>별칭: {data.node.meta.aliases.join(' · ')}</div>
            )}
          </div>

          <div style={{ display: viewMode === 'graph' ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {data.sections.map((sec) => (
              <div key={sec.key} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 6, alignContent: 'start' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#475569' }}>
                  {sec.label} {sec.items.length > 0 && <span style={{ fontWeight: 500, color: '#94a3b8' }}>({sec.items.length})</span>}
                </div>
                {sec.summary && <div style={{ fontSize: 13, color: '#334155' }}>{sec.summary}</div>}
                {sec.items.length === 0 && !sec.summary && <div style={{ fontSize: 12, color: '#cbd5e1' }}>연결 없음</div>}
                {sec.items.map((it) => (
                  <div key={`${it.type}:${it.id}`} onClick={() => void open(it)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', padding: '5px 8px', borderRadius: 8, border: '1px solid #f1f5f9', background: '#fafafa' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fafafa')}>
                    <span style={{ fontSize: 12 }}>{meta(it.type).icon}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{it.label}</span>
                    {typeof it.worklogs === 'number' && it.worklogs > 0 && <span style={{ fontSize: 11, color: '#0369a1' }}>📝{it.worklogs}</span>}
                    {typeof it.knowledge === 'number' && it.knowledge > 0 && <span style={{ fontSize: 11, color: '#b45309' }}>🏅{it.knowledge}</span>}
                    {it.sub && <span style={{ fontSize: 10, color: '#94a3b8', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sub}</span>}
                  </div>
                ))}
                {sec.action === 'createInitiative' && data.node.type === 'activity' && (
                  <button className="btn btn-sm btn-outline" style={{ fontSize: 12 }} onClick={() => void createInitiative(data.node)}>+ 중점과제 생성</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!data && !loading && (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 12, padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          위 검색창에서 아무 객체나 찾아 탐색을 시작하세요.<br />
          예: 활동 "구매원가 계산서 작성" → 측정하는 KPI → 그 목표 → 전략 기둥 → 같은 전략의 다른 팀 활동...
        </div>
      )}
    </div>
  );
}

export default OntologyExplorer;
