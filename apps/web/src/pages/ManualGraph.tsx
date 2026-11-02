import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';
import { ManualDocument } from '../components/ManualDocument';
import { ManualRelated } from '../components/ManualRelated';

/**
 * 전사 업무 그래프 — 모든 매뉴얼을 가치사슬 열(column)로 늘어놓고,
 * 선행→후행 체인을 선으로 연결해 회사 전체 업무를 한 장의 노드-링크 그림으로 본다.
 * 노드 클릭 → 본문(그림 포함)+연계(KPI·체인) 모달. 수정은 고급 편집기로.
 */
type GNode = { id: string; userId: string; title: string; team: string; status: string; templateId: string | null; domainKey: string; l2: string };
type GEdge = { from: string; to: string; why: string };

const DOMAIN_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  sales: { bg: '#fff7ed', border: '#fdba74', text: '#9a3412' },
  rnd: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
  engineering: { bg: '#f0fdfa', border: '#5eead4', text: '#115e59' },
  procurement: { bg: '#fdf4ff', border: '#e9d5ff', text: '#7e22ce' },
  production: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
  quality: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
  logistics: { bg: '#fefce8', border: '#fde047', text: '#854d0e' },
  management: { bg: '#f8fafc', border: '#cbd5e1', text: '#334155' },
  it: { bg: '#eef2ff', border: '#a5b4fc', text: '#3730a3' },
  etc: { bg: '#fafafa', border: '#e5e5e5', text: '#525252' },
};

const NODE_W = 168, NODE_H = 26, ROW_GAP = 6, COL_GAP = 60, HEADER_H = 46, PAD = 16;

export function ManualGraph() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [domains, setDomains] = useState<any[]>([]);
  const [chains, setChains] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyLinked, setOnlyLinked] = useState(true);
  const [team, setTeam] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<GNode | null>(null);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    apiJson<{ domains: any[]; chains: GEdge[] }>(`/api/work-manuals/flow-map?userId=${encodeURIComponent(userId)}`)
      .then((r) => { setDomains(r.domains || []); setChains(r.chains || []); })
      .catch((e: any) => toast(e?.message || '그래프를 불러오지 못했습니다', 'error'))
      .finally(() => setLoading(false));
  }, [userId]);

  async function openDoc(n: GNode) {
    setOpen(n); setDetail(null);
    try {
      const d = await apiJson<any>(`/api/work-manuals/library/${encodeURIComponent(n.id)}?userId=${encodeURIComponent(userId)}`);
      setDetail(d);
    } catch (e: any) { toast(e?.message || '본문을 불러오지 못했습니다', 'error'); setOpen(null); }
  }

  const { cols, nodes, pos, edges, width, height, teams } = useMemo(() => {
    const linked = new Set<string>();
    for (const e of chains) { linked.add(e.from); linked.add(e.to); }
    // 도메인 → 노드 목록 (체인 연결 노드 우선 정렬)
    const cols = domains.map((d) => ({ key: d.key, name: d.name, kind: d.kind }));
    const all: GNode[] = [];
    for (const d of domains) for (const g of d.groups || []) for (const m of g.manuals || []) {
      all.push({ id: m.id, userId: m.userId, title: m.title, team: m.team, status: m.status, templateId: m.templateId, domainKey: d.key, l2: g.name });
    }
    const teams = Array.from(new Set(all.map((n) => n.team).filter(Boolean))).sort();
    const visible = all.filter((n) => (!onlyLinked || linked.has(n.id)) && (!team || n.team === team));
    const visIds = new Set(visible.map((n) => n.id));
    // 열 내 정렬: l2 → 제목
    const byCol = new Map<string, GNode[]>();
    for (const c of cols) byCol.set(c.key, []);
    for (const n of visible) (byCol.get(n.domainKey) || byCol.get('etc')!).push(n);
    for (const arr of byCol.values()) arr.sort((a, b) => a.l2.localeCompare(b.l2) || a.title.localeCompare(b.title));
    // 좌표
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    cols.forEach((c, ci) => {
      const arr = byCol.get(c.key) || [];
      maxRows = Math.max(maxRows, arr.length);
      arr.forEach((n, ri) => pos.set(n.id, { x: PAD + ci * (NODE_W + COL_GAP), y: HEADER_H + ri * (NODE_H + ROW_GAP) }));
    });
    const width = PAD * 2 + cols.length * (NODE_W + COL_GAP) - COL_GAP;
    const height = HEADER_H + Math.max(1, maxRows) * (NODE_H + ROW_GAP) + PAD;
    const edges = chains.filter((e) => visIds.has(e.from) && visIds.has(e.to));
    return { cols, nodes: visible, pos, edges, width, height, teams };
  }, [domains, chains, onlyLinked, team]);

  const edgePath = (e: GEdge) => {
    const a = pos.get(e.from)!, b = pos.get(e.to)!;
    const forward = b.x > a.x;
    const x1 = forward ? a.x + NODE_W : a.x, y1 = a.y + NODE_H / 2;
    const x2 = forward ? b.x : b.x + NODE_W, y2 = b.y + NODE_H / 2;
    const dx = Math.max(30, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + (forward ? dx : -dx)} ${y1}, ${x2 + (forward ? -dx : dx)} ${y2}, ${x2} ${y2}`;
  };

  if (!userId) return <div style={{ padding: 24, color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>전사 업무 그래프</h2>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>업무 {nodes.length}개 · 연결 {edges.length}개 — 선은 "선행 → 후행". 노드를 누르면 매뉴얼이 열립니다.</span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12.5, color: '#334155', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} /> 체인에 연결된 업무만
        </label>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">팀 전체</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn btn-sm btn-outline" onClick={() => nav('/manuals/flow')}>흐름 지도(목록형)</button>
      </div>

      {loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>불러오는 중…</div>}

      <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', maxHeight: '78vh' }}>
        <svg width={width} height={height} style={{ display: 'block' }}>
          {/* 열 헤더 */}
          {cols.map((c, ci) => {
            const color = DOMAIN_COLORS[c.key] || DOMAIN_COLORS.etc;
            const x = PAD + ci * (NODE_W + COL_GAP);
            return (
              <g key={c.key}>
                <rect x={x} y={8} width={NODE_W} height={26} rx={13} fill={color.bg} stroke={color.border} />
                <text x={x + NODE_W / 2} y={25} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={color.text}>{c.name}</text>
                {c.kind === 'main' && ci < cols.length - 1 && cols[ci + 1]?.kind === 'main' && (
                  <text x={x + NODE_W + COL_GAP / 2} y={26} textAnchor="middle" fontSize={14} fontWeight={800} fill="#94a3b8">→</text>
                )}
              </g>
            );
          })}
          {/* 엣지 (하이라이트 대상은 위에 다시 그림) */}
          {edges.map((e, i) => {
            const hot = hover === e.from || hover === e.to;
            return (
              <path key={i} d={edgePath(e)} fill="none"
                stroke={hot ? '#7c3aed' : '#cbd5e1'} strokeWidth={hot ? 2.2 : 1.1} opacity={hover && !hot ? 0.25 : 0.9}>
                <title>{e.why}</title>
              </path>
            );
          })}
          {/* 노드 */}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            const color = DOMAIN_COLORS[n.domainKey] || DOMAIN_COLORS.etc;
            const dim = hover && hover !== n.id && !edges.some((e) => (e.from === hover && e.to === n.id) || (e.to === hover && e.from === n.id));
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }}
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onClick={() => void openDoc(n)}>
                <rect width={NODE_W} height={NODE_H} rx={7} fill={color.bg} stroke={hover === n.id ? '#7c3aed' : color.border} strokeWidth={hover === n.id ? 2 : 1} />
                <text x={8} y={17} fontSize={11.5} fill={color.text}>
                  {n.title.length > 15 ? `${n.title.slice(0, 15)}…` : n.title}
                </text>
                {n.templateId && <circle cx={NODE_W - 10} cy={NODE_H / 2} r={3.5} fill="#0F3D73"><title>프로세스화됨</title></circle>}
                <title>{`${n.title}\n${n.team} · ${n.l2}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>
        ● 파란 점 = 프로세스화된 업무 · 노드에 마우스를 올리면 연결된 업무가 강조됩니다 · "체인에 연결된 업무만"을 끄면 전체 {domains.reduce((s, d) => s + (d.manualCount || 0), 0)}개가 열별로 모두 표시됩니다
      </div>

      {/* 매뉴얼 모달 — 본문 + 연계 */}
      {open && (
        <div onClick={() => { setOpen(null); setDetail(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, maxWidth: 860, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 18, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, flex: 1 }}>📖 매뉴얼 열람</b>
              {open.templateId && (
                <button className="btn btn-sm btn-outline" onClick={() => nav(`/process/templates?openId=${encodeURIComponent(open.templateId!)}`)}>🔁 프로세스 보기</button>
              )}
              {open.userId === userId && (
                <button className="btn btn-sm btn-primary" onClick={() => nav(`/manuals/mine?edit=${encodeURIComponent(open.id)}`)}>✏️ 고급 편집기에서 수정</button>
              )}
              <button className="btn btn-sm btn-outline" onClick={() => { setOpen(null); setDetail(null); }}>닫기</button>
            </div>
            <ManualRelated manualId={open.id} userId={userId}
              onOpenManual={(m) => void openDoc({ team: '', status: '', l2: '', domainKey: open.domainKey, ...m } as GNode)} />
            {detail ? <ManualDocument manual={detail} /> : <div style={{ fontSize: 13, color: '#94a3b8' }}>본문 불러오는 중…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
