import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, Handle, MiniMap, Position, ReactFlowProvider, useReactFlow, type Connection, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';

/**
 * 목표 정렬 작업대 — 탑다운(전사 KR → 팀 목표 → 팀 KR → 사람)과 보텀업(일지·활동)을 맞닿게 잇는 화면.
 *  · 그래프: 온톨로지 객체를 층별로 늘어놓고 선을 드래그해 연결. 끊긴 노드는 빨간 점선.
 *  · 회색 점선 = AI·규칙 제안(근거 포함). 클릭하면 확정/버리기.
 *  · 목록: 같은 데이터를 묶음 처리용으로. 팀장은 목록, 임원은 그래프를 주로 쓴다.
 */
type GNode = { id: string; type: string; refId: string; label: string; sub: string; layer: number; broken?: boolean; dismissed?: boolean; candidate?: boolean; logCount?: number; bound?: boolean; activityName?: string; orgUnitId?: string; objectiveId?: string };
type GEdge = { id: string; source: string; target: string; type: string; confirmed?: boolean; fixed?: boolean };
type Sugg = { id: string; type: string; source: string; target: string; score: number; reason: string; sourceLabel: string; targetLabel: string; weak?: boolean; activityName?: string };
type Graph = { nodes: GNode[]; edges: GEdge[]; suggestions: Sugg[]; teams?: Array<{ id: string; name: string }>; brokenCount: { objective: number; kr: number; activity: number }; total: { objective: number; kr: number; companyKr: number }; rate: { objective: number; kr: number; activity: number }; year: number; scope: string };

const COLOR: Record<string, { bg: string; bd: string; fg: string }> = {
  COMPANY_KR: { bg: '#0F3D73', bd: '#0F3D73', fg: '#fff' },
  OBJECTIVE: { bg: '#e0f2fe', bd: '#0284c7', fg: '#075985' },
  KR: { bg: '#f0f9ff', bd: '#38bdf8', fg: '#0c4a6e' },
  PERSON: { bg: '#f8fafc', bd: '#94a3b8', fg: '#334155' },
  ACTIVITY: { bg: '#f5f3ff', bd: '#a78bfa', fg: '#5b21b6' },
};
const LAYER_LABEL = ['전사 KR (어젠다 항목)', '팀 목표', '팀 지표(KR)', '담당자'];
const TYPE_LABEL: Record<string, string> = { OBJECTIVE_PARENT: '팀 목표 → 전사 KR', KR_ASSIGNEE: '지표 → 담당자', KR_ACTIVITY: '지표 → 활동', OBJECTIVE_TREE: '목표 → 상위 목표' };

function OntoNode({ data }: { data: any }) {
  const c = COLOR[data.ntype] || COLOR.KR;
  const broken = data.broken && !data.dismissed;
  return (
    <div
      onClick={() => data.onSelect?.()}
      style={{
        padding: '7px 10px', borderRadius: 10, minWidth: 150, maxWidth: 230, cursor: 'pointer',
        background: c.bg, color: c.fg, border: `2px ${broken ? 'dashed' : 'solid'} ${broken ? '#ef4444' : c.bd}`,
        boxShadow: data.selected ? '0 0 0 3px rgba(15,61,115,.25)' : '0 1px 2px rgba(0,0,0,.06)', fontSize: 12,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ width: 8, height: 8, background: c.bd }} />
      <div style={{ fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {broken && <span title="위에 연결된 것이 없습니다">⚠ </span>}{data.label}
      </div>
      {data.sub && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.sub}</div>}
      <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
        {data.logCount > 0 && <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 999, background: 'rgba(0,0,0,.07)' }}>일지 {data.logCount}</span>}
        {data.bound && <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 999, background: '#dcfce7', color: '#15803d' }}>데이터</span>}
        {data.activityName && <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 999, background: '#ede9fe', color: '#5b21b6' }}>{data.activityName}</span>}
        {data.candidate && <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}>후보</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ width: 8, height: 8, background: c.bd }} />
    </div>
  );
}

function Canvas({ g, onLink, onPick, selected }: { g: Graph; onLink: (type: string, sourceRef: string, targetRef: string) => void; onPick: (n: GNode | null) => void; selected: string | null }) {
  const nodeTypes = useMemo(() => ({ onto: OntoNode }), []);
  const rf = useReactFlow();
  // 필터를 바꾸면 보이는 것에 맞춰 다시 맞춘다 (fitView 속성은 최초 1회만 동작)
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 60); return () => clearTimeout(t); }, [g.nodes.length, g.nodes.map((n) => n.id).join('|'), rf]);
  const byId = useMemo(() => new Map(g.nodes.map((n) => [n.id, n])), [g.nodes]);

  // 층마다 띠로 나누고, 한 줄에 최대 8개씩 접어 넣는다 (한 줄로 늘어놓으면 읽을 수 없다)
  const nodes: Node[] = useMemo(() => {
    const COL = 270, ROW = 104, BAND_GAP = 70, PER_ROW = 8;
    const perLayer = new Map<number, GNode[]>();
    for (const n of g.nodes) perLayer.set(n.layer, [...(perLayer.get(n.layer) || []), n]);
    const out: Node[] = [];
    let y = 0;
    for (const layer of [0, 1, 2, 3]) {
      const list = perLayer.get(layer) || [];
      if (!list.length) continue;
      const perRow = Math.min(PER_ROW, list.length);
      list.forEach((n, i) => out.push({
        id: n.id, type: 'onto', position: { x: (i % perRow) * COL, y: y + Math.floor(i / perRow) * ROW }, draggable: true,
        data: { ...n, ntype: n.type, selected: selected === n.id, onSelect: () => onPick(n) },
      }));
      y += Math.ceil(list.length / perRow) * ROW + BAND_GAP;
    }
    return out;
  }, [g.nodes, selected, onPick]);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = g.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, animated: false,
      style: { stroke: e.type === 'KR_OF' ? '#cbd5e1' : e.type === 'KR_ASSIGNEE' ? '#94a3b8' : '#0284c7', strokeWidth: e.type === 'KR_OF' ? 1 : 2 },
      label: e.type === 'KR_OF' ? undefined : undefined,
    }));
    for (const s of g.suggestions) {
      if (!byId.has(s.source) || !byId.has(s.target)) continue;
      out.push({ id: s.id, source: s.source, target: s.target, animated: true, style: { stroke: s.weak ? '#cbd5e1' : '#f59e0b', strokeWidth: 2, strokeDasharray: '5 4' }, label: `제안 ${s.score}`, labelStyle: { fontSize: 9, fill: '#b45309' }, labelBgStyle: { fill: '#fffbeb' } });
    }
    return out;
  }, [g.edges, g.suggestions, byId]);

  const onConnect = useCallback((c: Connection) => {
    const s = c.source ? byId.get(c.source) : null, t = c.target ? byId.get(c.target) : null;
    if (!s || !t) return;
    if (s.type === 'OBJECTIVE' && t.type === 'COMPANY_KR') return onLink('OBJECTIVE_PARENT', s.refId, t.refId);
    if (s.type === 'OBJECTIVE' && t.type === 'OBJECTIVE') return onLink('OBJECTIVE_TREE', s.refId, t.refId);
    if (s.type === 'PERSON' && t.type === 'KR') return onLink('KR_ASSIGNEE', s.refId, t.refId);
    if (s.type === 'KR' && t.type === 'ACTIVITY') return onLink('KR_ACTIVITY', s.refId, t.refId);
    toast(`${s.type} → ${t.type}는 연결할 수 없습니다. 팀 목표→전사 KR, 담당자→지표, 지표→활동만 가능합니다`, 'error', 5000);
  }, [byId, onLink]);

  return (
    <div style={{ height: 560, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafbfc' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onConnect={onConnect} onPaneClick={() => onPick(null)} fitView minZoom={0.15} proOptions={{ hideAttribution: true }}>
        <Background gap={18} color="#eef2f7" />
        <MiniMap pannable zoomable style={{ height: 70 }} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** 그 노드가 선택한 팀에 속하는가 (팀 미선택이면 모두 통과) */
function inTeam(g: Graph, nodeId: string, team: string) {
  if (!team) return true;
  const n = g.nodes.find((x) => x.id === nodeId);
  return n?.orgUnitId === team;
}

export function AlignmentWorkbench() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [g, setG] = useState<Graph | null>(null);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [kind, setKind] = useState<string>('ALL');
  const [onlyBroken, setOnlyBroken] = useState(true);
  const [team, setTeam] = useState('');
  const [sel, setSel] = useState<GNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setG(await apiJson<Graph>(`/api/alignment/graph?userId=${encodeURIComponent(userId)}`)); setErr(null); }
    catch (e: any) { setErr(e?.message || '불러오기 실패'); }
  }
  useEffect(() => { if (userId) void load(); /* eslint-disable-next-line */ }, [userId]);

  const doLink = useCallback(async (type: string, sourceId: string, targetId: string) => {
    setBusy(true);
    try { await apiJson(`/api/alignment/link`, { method: 'POST', body: JSON.stringify({ userId, type, sourceId, targetId }) }); toast('연결했습니다', 'success'); await load(); }
    catch (e: any) { toast(e?.message || '연결 실패', 'error'); } finally { setBusy(false); }
  }, [userId]);

  async function confirmSugg(s: Sugg) {
    const src = g?.nodes.find((n) => n.id === s.source), tgt = g?.nodes.find((n) => n.id === s.target);
    const srcRef = src?.refId || s.source.split(':')[1], tgtRef = tgt?.refId || s.target.split(':')[1];
    await doLink(s.type, srcRef, tgtRef);
  }
  async function dismiss(s: Sugg) {
    const itemId = s.type === 'OBJECTIVE_PARENT' ? s.source.split(':')[1] : s.type === 'KR_ASSIGNEE' ? s.target.split(':')[1] : s.source.split(':')[1];
    if (!(await toastConfirm('이 항목은 연결하지 않아도 되는 것으로 표시할까요? 같은 제안이 다시 뜨지 않습니다.'))) return;
    try { await apiJson(`/api/alignment/dismiss`, { method: 'POST', body: JSON.stringify({ userId, itemType: s.type, itemId }) }); await load(); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }
  async function unlinkSel(n: GNode, type: string, targetId?: string) {
    if (!(await toastConfirm('이 연결을 해제할까요?'))) return;
    try { await apiJson(`/api/alignment/unlink`, { method: 'POST', body: JSON.stringify({ userId, type, sourceId: n.refId, targetId }) }); toast('해제했습니다', 'success'); await load(); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }

  if (err) return <div style={{ padding: 24, color: '#b91c1c' }}>{err}</div>;
  if (!g) return <div style={{ padding: 24, color: '#94a3b8' }}>불러오는 중…</div>;
  const suggs = g.suggestions.filter((s) => (kind === 'ALL' || s.type === kind) && (!team || inTeam(g, s.source, team) || inTeam(g, s.target, team)));

  // 그래프에 그릴 것만 추리기 — 기본은 "끊긴 것 + 그 후보"만 (전부 그리면 읽을 수 없다)
  const view상 = (() => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    let keep = new Set<string>();
    const pass = (n: GNode) => (!team || !n.orgUnitId || n.orgUnitId === team);
    if (onlyBroken) {
      for (const n of g.nodes) if (n.broken && !n.dismissed && pass(n)) keep.add(n.id);
      for (const s of g.suggestions) {
        if (keep.has(s.source) || keep.has(s.target)) { keep.add(s.source); keep.add(s.target); }
      }
      // 끊긴 KR의 소속 목표는 맥락으로 함께
      for (const id of Array.from(keep)) { const n = byId.get(id); if (n?.objectiveId) keep.add(`obj:${n.objectiveId}`); }
      for (const n of g.nodes) if (n.type === 'COMPANY_KR') keep.add(n.id);
    } else {
      for (const n of g.nodes) if (pass(n) || n.type === 'COMPANY_KR' || n.type === 'PERSON') keep.add(n.id);
    }
    if (team) {
      // 팀 필터: 그 팀 목표/지표와 이어진 것만
      const teamNodeIds = new Set(g.nodes.filter((n) => n.orgUnitId === team).map((n) => n.id));
      const linked = new Set<string>(teamNodeIds);
      for (const e of g.edges) { if (teamNodeIds.has(e.source)) linked.add(e.target); if (teamNodeIds.has(e.target)) linked.add(e.source); }
      for (const s of g.suggestions) { if (teamNodeIds.has(s.source)) linked.add(s.target); if (teamNodeIds.has(s.target)) linked.add(s.source); }
      for (const n of g.nodes) if (n.type === 'COMPANY_KR') linked.add(n.id);
      keep = new Set(Array.from(keep).filter((id) => linked.has(id)));
    }
    const nodes = g.nodes.filter((n) => keep.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...g, nodes, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), suggestions: suggs.filter((s) => ids.has(s.source) && ids.has(s.target)) };
  })();
  const grouped = new Map<string, Sugg[]>();
  for (const s of suggs) { const k = `${s.type}|${s.type === 'KR_ASSIGNEE' ? s.target : s.source}`; grouped.set(k, [...(grouped.get(k) || []), s]); }
  const gauge = (label: string, v: number, broken: number, na = false) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 12px', background: '#fff', minWidth: 140 }}>
      <div style={{ fontSize: 10, color: '#64748b' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: na ? '#94a3b8' : v >= 80 ? '#15803d' : v >= 40 ? '#b45309' : '#b91c1c' }}>{na ? '—' : `${v}%`}</span>
        {broken > 0 && <span style={{ fontSize: 11, color: '#b91c1c' }}>끊김 {broken}</span>}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>목표 정렬 작업대</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          위에서 내려온 목표와 현장에서 올라온 일지가 <b>맞닿게</b> 잇는 곳입니다. 끊긴 것은 빨간 점선, 주황 점선은 <b>이미 쌓인 데이터로 만든 제안</b>입니다 — 만들지 말고 <b>고르기만</b> 하세요. 선을 직접 끌어서 연결할 수도 있습니다. 범위: {g.scope} · {g.year}년
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {gauge('팀 목표 → 전사 KR', g.rate.objective, g.brokenCount.objective, g.total.companyKr === 0)}
        {gauge('지표 → 담당자', g.rate.kr, g.brokenCount.kr)}
        {gauge('지표 → 활동', g.rate.activity, g.brokenCount.activity)}
        <span style={{ flex: 1 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ fontSize: 13 }}>
          <option value="ALL">모든 제안 ({g.suggestions.length})</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v} ({g.suggestions.filter((s) => s.type === k).length})</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">모든 팀</option>
          {(g.teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={onlyBroken} onChange={(e) => setOnlyBroken(e.target.checked)} style={{ margin: 0, width: 'auto' }} /><span>끊긴 것만</span>
        </label>
        <button className={`btn btn-sm ${view === 'graph' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('graph')}>그래프</button>
        <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('list')}>목록</button>
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void load()}>새로고침</button>
      </div>

      {g.total.companyKr === 0 && (
        <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 10, padding: 10, fontSize: 13, color: '#92400e' }}>
          전사 KR이 아직 없습니다 — <b>목표관리 → 경영 어젠다·클레임</b>에서 어젠다를 <b>공개</b>하면 항목마다 전사 KR이 만들어지고, 팀 목표를 그 아래로 붙일 수 있습니다.
        </div>
      )}

      {view === 'graph' ? (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 300px' : '1fr', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#64748b', marginBottom: 4, flexWrap: 'wrap' }}>
              {LAYER_LABEL.map((l, i) => <span key={l}><b style={{ color: '#334155' }}>{i + 1}층</b> {l}</span>)}
              <span style={{ flex: 1 }} />
              <span>⚠ 빨간 점선 = 위에 연결 없음 · 주황 점선 = 제안 · 노드 클릭 = 상세</span>
            </div>
            <ReactFlowProvider>
              <Canvas g={view상} onLink={doLink} onPick={setSel} selected={sel?.id || null} />
            </ReactFlowProvider>
            <div style={{ fontSize: 11, color: view상.nodes.length > 120 ? '#b91c1c' : '#94a3b8', marginTop: 4 }}>
              노드 {view상.nodes.length}개 · 제안 {view상.suggestions.length}개{view상.nodes.length > 120 ? ' — 너무 많습니다. 팀을 선택해 좁혀 보세요' : ''}
            </div>
          </div>
          {sel && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff', display: 'grid', gap: 8, alignContent: 'start', maxHeight: 580, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <b style={{ fontSize: 13 }}>{sel.label}</b>
                <span style={{ flex: 1 }} />
                <button className="btn btn-sm btn-outline" onClick={() => setSel(null)}>닫기</button>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{LAYER_LABEL[sel.layer]} · {sel.sub}</div>
              {sel.logCount != null && sel.logCount > 0 && <div style={{ fontSize: 12 }}>최근 180일 관련 일지 <b>{sel.logCount}건</b></div>}
              {sel.broken && <div style={{ fontSize: 12, color: '#b91c1c' }}>⚠ 위에 연결된 것이 없습니다</div>}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>이 객체의 제안</div>
                {g.suggestions.filter((s) => s.source === sel.id || s.target === sel.id).map((s) => (
                  <div key={s.id} style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 12 }}>
                    <div><b>{s.sourceLabel}</b> → <b>{s.targetLabel}</b></div>
                    <div style={{ color: '#92400e', marginTop: 2 }}>{s.reason}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void confirmSugg(s)}>확정</button>
                      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void dismiss(s)}>필요 없음</button>
                    </div>
                  </div>
                ))}
                {!g.suggestions.some((s) => s.source === sel.id || s.target === sel.id) && <div style={{ fontSize: 12, color: '#94a3b8' }}>제안이 없습니다 — 그래프에서 선을 직접 끌어 연결하세요</div>}
              </div>
              {sel.type === 'OBJECTIVE' && !sel.broken && <button className="btn btn-sm btn-outline" onClick={() => void unlinkSel(sel, 'OBJECTIVE_PARENT')}>상위 연결 해제</button>}
              {sel.type === 'KR' && sel.activityName && <button className="btn btn-sm btn-outline" onClick={() => void unlinkSel(sel, 'KR_ACTIVITY')}>활동 연결 해제</button>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from(grouped.entries()).map(([k, list]) => {
            const first = list[0];
            const subject = first.type === 'KR_ASSIGNEE' ? first.targetLabel : first.sourceLabel;
            return (
              <div key={k} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}>{TYPE_LABEL[first.type]}</span>
                  <b style={{ fontSize: 13 }}>{subject}</b>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void dismiss(first)}>필요 없음</button>
                </div>
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  {list.sort((a, b) => b.score - a.score).map((s) => (
                    <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, background: '#f8fafc', borderRadius: 8, padding: '6px 10px' }}>
                      <b style={{ minWidth: 120 }}>{s.type === 'KR_ASSIGNEE' ? s.sourceLabel : s.targetLabel}</b>
                      <span style={{ flex: 1, color: '#475569', fontSize: 12 }}>{s.reason}</span>
                      <span style={{ fontSize: 11, color: s.score >= 70 ? '#15803d' : '#b45309', fontWeight: 700 }}>{s.score}</span>
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void confirmSugg(s)}>확정</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {!suggs.length && <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, textAlign: 'center', color: '#94a3b8', background: '#fff' }}>연결 대기 중인 제안이 없습니다 👍</div>}
        </div>
      )}
    </div>
  );
}
