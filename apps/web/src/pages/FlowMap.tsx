import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';

/**
 * 온톨로지 흐름 맵 (P0) — 회사 객체가 층 전체로 이어진 모습을 한 화면에 그리고,
 * 온톨로지에 정의되지 않은 길로 새는 업무를 그 자리에서 처리 결정까지 내리게 한다.
 *
 * 렌더러는 canvas. 노드 수백·선 수천이 될 수 있고 시안도 canvas다(SVG는 DOM 노드 수에서 먼저 막힌다).
 * 측정은 기계가, 해석은 AI가, 결정은 사람이 — 후보층(점선)은 판단에 쓰지 않는다는 표시를 UI에서 유지한다.
 */
type Node = { id: string; type: string; col: number; label: string; status: 'ok' | 'cand' | 'ghost'; outsideGoal?: boolean; metrics?: any; top?: Array<{ id: string; name: string; n: number; linked: boolean }>; x?: number; y?: number };
type Edge = { from: string; to: string; kind: string; status: 'ok' | 'cand'; count?: number };
type Ghost = {
  id: string; from: string; to: string; fromLabel: string; toLabel: string; count: number; ofCount: number;
  confidence: string; medianGapMinutes?: number | null; offHoursRatio?: number | null;
  sampleCases?: Array<{ entityId: string; entityName: string; worklogId: string }>;
  decision?: { choice: string; rationale?: string; decidedAt: string } | null;
};
type Graph = { month: string; nodes: Node[]; edges: Edge[]; ghosts: Ghost[]; summary: any };
type Ev = { at: string; kind: 'record' | 'intent' | 'verify' | 'ghost'; path: string[]; t?: number };
type Events = { from: string; to: string; hours: number; events: Ev[]; sampled: boolean; counters: any };
type Dot = { u: number; kind: string; path: string[] };

const COLS = [
  { title: '앱 · 현장', sub: 'ERP · MES · 기록' },
  { title: '활동', sub: '회사 작업 사전(대분류)' },
  { title: 'KPI · 과제', sub: '측정과 개선' },
  { title: '목표', sub: '정성 목표' },
  { title: '전략 기둥', sub: '대표의 뼈대' },
  { title: '셸', sub: '대표 화면' },
];
const DEC: Record<string, string> = { NORM: '규범을 고친다', FIX: '현실을 고친다', KEEP: '그냥 둔다' };
const DEC_NOTE: Record<string, string> = {
  NORM: '정식 경로로 추가 — 템플릿·온톨로지에 반영',
  FIX: '막을 대상 — 교육·결재 조건으로',
  KEEP: '예외로 인정 — 사유를 기록',
};
const KIND_LABEL: Record<string, string> = { app: '앱 · 현장', activity: '활동(대분류)', kpi: 'KPI', task: '중점과제', obj: '목표', pillar: '전략 기둥', ceo: '사용자', cloud: '정의 밖' };
const C = {
  ink: '#14232f', muted: '#5d6b75', rule: '#d8dfe3', navy: '#0b2545', green: '#1f7a4d', amber: '#b86a12',
  cand: '#8a97a1', ghost: '#a7aeb4', node: '#ffffff', nodeStroke: '#9fb0b9', edge: 'rgba(20,35,47,.13)',
  surface: '#ffffff', glow: 'rgba(31,122,77,.18)',
};
/** 재생 점의 색 — 핸드오프 2절의 네 가지 */
const EV_COLOR: Record<string, string> = { record: '#1f7a4d', intent: '#0b2545', verify: '#b86a12', ghost: '#8a97a1' };
const EV_LABEL: Record<string, string> = { record: '올라온 기록', intent: '내려간 의도', verify: '확인', ghost: '정의 밖' };
/** 창 전체를 몇 초에 재생할지 */
const PLAY_MS = 45000;
/** 점 하나가 경로를 지나는 데 쓰는 시간(전체 창 대비 비율) */
const TRAVEL = 0.03;

export function FlowMap() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const nav = useNavigate();
  const [month, setMonth] = useState(() => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7));
  const [g, setG] = useState<Graph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Node | null>(null);
  const [showGhost, setShowGhost] = useState(true);
  const [showCand, setShowCand] = useState(true);
  const [hlGhost, setHlGhost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replayOn, setReplayOn] = useState(false);
  const [hours, setHours] = useState(24);
  const [ev, setEv] = useState<Events | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursorUi, setCursorUi] = useState(0);
  const [evBusy, setEvBusy] = useState(false);
  const cursorRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const laidOut = useRef<{ nodes: Node[]; w: number; h: number }>({ nodes: [], w: 1200, h: 700 });

  const load = useCallback(async (m: string) => {
    try { setG(await apiJson<Graph>(`/api/ontology/graph?month=${m}&actorId=${encodeURIComponent(userId)}`)); setErr(null); }
    catch (e: any) { setErr(e?.message || '불러오지 못했습니다'); setG(null); }
  }, [userId]);
  useEffect(() => { if (userId) void load(month); }, [userId, month, load]);

  async function scan() {
    if (!(await toastConfirm(`${month} 기록에서 "실제로 일이 흐른 길"을 다시 뽑습니다. 1~2분 걸릴 수 있습니다.`))) return;
    setBusy(true);
    try {
      const r = await apiJson<any>(`/api/ontology/graph/scan`, { method: 'POST', body: JSON.stringify({ actorId: userId, month }) });
      toast(`전이 ${r.scanned}건 분석 · 저장 ${r.saved}건`, 'success');
      await load(month);
    } catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }

  async function decide(gh: Ghost, choice: string) {
    let rationale = '';
    if (choice === 'KEEP') {
      rationale = window.prompt('그냥 두는 사유를 적어 주세요 (기록에 남습니다)') || '';
      if (!rationale.trim()) return;
    }
    try {
      await apiJson(`/api/ontology/graph/deviations/${gh.id}/decide`, { method: 'POST', body: JSON.stringify({ actorId: userId, choice, rationale }) });
      toast(`${DEC[choice]} — 결정이 기록됐습니다`, 'success');
      await load(month);
    } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }

  // ── 좌표 계산
  const layout = useMemo(() => {
    if (!g) return { nodes: [] as Node[], w: 1200, h: 700 };
    const byCol: Node[][] = [[], [], [], [], [], []];
    for (const n of g.nodes) byCol[Math.min(5, Math.max(0, n.col))].push(n);
    const maxRows = Math.max(...byCol.map((c) => c.length), 1);
    // 한 열에 100개가 넘으면 라벨이 겹친다 → 행 간격 26px을 확보하고 캔버스를 길게(스크롤)
    const h = Math.max(620, Math.min(2600, 110 + maxRows * 26));
    const w = 1200;
    const xs = [95, 330, 605, 850, 1035, 1150];
    byCol.forEach((arr, c) => {
      const top = 96, bottom = h - 36;
      const gap = arr.length > 1 ? (bottom - top) / (arr.length - 1) : 0;
      arr.forEach((n, i) => {
        n.x = c === 5 ? xs[5] : xs[c];
        n.y = c === 5 ? h / 2 : (arr.length === 1 ? (top + bottom) / 2 : top + i * gap);
      });
    });
    return { nodes: g.nodes, w, h };
  }, [g]);
  laidOut.current = layout;

  // ── 그리기 (재생 중에는 점 목록을 받아 매 프레임 다시 그린다)
  const paint = useCallback((dots: Dot[]) => {
    const cv = cvRef.current;
    if (!cv || !g) return;
    const { w, h } = layout;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const byCol: Node[][] = [[], [], [], [], [], []];
    for (const n of g.nodes) byCol[Math.min(5, Math.max(0, n.col))].push(n);
    const font = '"IBM Plex Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif';

    const neighbors = (n: Node) => {
      const s = new Set<string>([n.id]);
      for (const e of g.edges) { if (e.from === n.id) s.add(e.to); if (e.to === n.id) s.add(e.from); }
      for (const gh of g.ghosts) { if (gh.from === n.id) s.add(gh.to); if (gh.to === n.id) s.add(gh.from); }
      return s;
    };
    const nb = sel ? neighbors(sel) : null;
    const r = (n: Node) => (n.type === 'ceo' ? 24 : n.type === 'pillar' ? 13 : n.type === 'app' ? 12 : n.type === 'activity' || n.type === 'cloud' ? 12 : 8);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, w, h);
    // 열 제목
    ctx.textAlign = 'center';
    const xs = [95, 330, 605, 850, 1035, 1150];
    COLS.forEach((c, i) => {
      ctx.fillStyle = C.ink; ctx.font = `700 13px ${font}`; ctx.fillText(c.title, xs[i], 30);
      ctx.fillStyle = C.muted; ctx.font = `11px ${font}`; ctx.fillText(c.sub, xs[i], 46);
    });
    // 커널 띠
    ctx.strokeStyle = C.rule; ctx.setLineDash([4, 6]); ctx.strokeRect(215, 62, 900, h - 84); ctx.setLineDash([]);
    ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.font = `11px ${font}`; ctx.fillText('커널 · 온톨로지', 226, 78);

    // 확정/후보 선
    for (const e of g.edges) {
      if (e.status === 'cand' && !showCand) continue;
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b || a.x == null || b.x == null) continue;
      const on = nb ? (nb.has(a.id) && nb.has(b.id)) : true;
      ctx.strokeStyle = on && nb ? C.green : C.edge;
      ctx.globalAlpha = on ? 1 : 0.18;
      ctx.lineWidth = on && nb ? 1.8 : 1;
      ctx.setLineDash(e.status === 'cand' ? [5, 5] : []);
      const mx = (a.x + b.x) / 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y!); ctx.bezierCurveTo(mx, a.y!, mx, b.y!, b.x, b.y!); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // 정의 밖 경로 (같은 열 안의 전이 → 왼쪽으로 부푼 호)
    if (showGhost) {
      for (const gh of g.ghosts) {
        const a = byId.get(gh.from), b = byId.get(gh.to);
        if (!a || !b || a.x == null || b.x == null) continue;
        const on = nb ? (nb.has(a.id) && nb.has(b.id)) : true;
        const hl = hlGhost === gh.id;
        const dec = gh.decision?.choice;
        ctx.globalAlpha = (on ? 1 : 0.12) * (dec === 'FIX' ? 0.35 : 1);
        ctx.strokeStyle = hl ? C.amber : dec === 'NORM' ? C.cand : C.ghost;
        ctx.lineWidth = hl ? 4 : Math.max(1.5, Math.min(6, gh.count / 12));
        ctx.setLineDash(dec === 'NORM' ? [5, 5] : dec === 'KEEP' ? [1, 4] : [10, 6]);
        const mx = a.x + 95, my = (a.y! + b.y!) / 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y!); ctx.quadraticCurveTo(mx, my, b.x, b.y!); ctx.stroke();
        if (on && (hl || gh.count >= 40)) {
          ctx.fillStyle = hl ? C.amber : C.muted; ctx.font = `11px ${font}`; ctx.textAlign = 'left';
          ctx.fillText(`${gh.count}건${dec ? ` · ${DEC[dec]}` : ''}`, (a.x + mx + b.x) / 3 + 8, my);
        }
        ctx.globalAlpha = 1; ctx.setLineDash([]);
      }
    }

    // 노드
    for (const n of g.nodes) {
      if (n.x == null) continue;
      const dim = nb ? !nb.has(n.id) : false;
      ctx.globalAlpha = dim ? 0.22 : 1;
      const rad = r(n);
      ctx.fillStyle = n.type === 'ceo' ? C.navy : n.type === 'pillar' ? C.green : C.node;
      ctx.strokeStyle = n.status === 'cand' ? C.cand : n.type === 'app' ? C.muted : C.nodeStroke;
      ctx.lineWidth = sel?.id === n.id ? 3 : 1.5;
      ctx.setLineDash(n.status === 'cand' ? [3, 3] : []);
      ctx.beginPath();
      if (n.type === 'app') ctx.rect(n.x - rad, n.y! - rad, rad * 2, rad * 2);
      else ctx.arc(n.x, n.y!, rad, 0, 7);
      ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      // 글자 — 간격이 좁으면 겹쳐서 읽을 수 없다. 선택했거나 이웃일 때만 쓴다.
      const rowsInCol = byCol[n.col]?.length || 1;
      const spacing = rowsInCol > 1 ? (h - 132) / (rowsInCol - 1) : 99;
      const showLabel = spacing >= 13 || !!nb || sel?.id === n.id || n.type === 'ceo' || n.type === 'pillar';
      if (!showLabel) { ctx.globalAlpha = 1; continue; }
      const dense = n.col === 2 || n.col === 3;
      ctx.font = `${n.type === 'ceo' || n.type === 'pillar' ? '700' : '500'} ${dense ? 10.5 : 12}px ${font}`;
      ctx.fillStyle = n.status === 'cand' ? C.muted : C.ink;
      const label = n.label.length > (dense ? 18 : 24) ? `${n.label.slice(0, dense ? 17 : 23)}…` : n.label;
      if (n.type === 'ceo') { ctx.textAlign = 'center'; ctx.fillText(label, n.x, n.y! + rad + 18); }
      else { ctx.textAlign = 'left'; ctx.fillText(label, n.x + rad + 6, n.y! + 4); }
      if (n.outsideGoal) {
        const wTxt = ctx.measureText(label).width;
        ctx.fillStyle = C.amber; ctx.font = `700 10.5px ${font}`;
        ctx.fillText('목표 밖', n.x + rad + 12 + wTxt, n.y! + 4);
      }
      ctx.globalAlpha = 1;
    }

    // ── 재생 점
    // 선을 그릴 때 쓴 곡선과 같은 식으로 위치를 구한다. 선 위를 벗어나면 흐름으로 보이지 않는다.
    if (dots.length) {
      const at = (a: Node, b: Node, t: number) => {
        if (a.col === b.col) {                       // 정의 밖 경로 — 왼쪽으로 부푼 2차 곡선
          const cx = a.x! + 95, cy = (a.y! + b.y!) / 2, m = 1 - t;
          return [m * m * a.x! + 2 * m * t * cx + t * t * b.x!, m * m * a.y! + 2 * m * t * cy + t * t * b.y!];
        }
        const mx = (a.x! + b.x!) / 2, m = 1 - t;     // 층 사이 — 3차 베지에
        return [
          m ** 3 * a.x! + 3 * m * m * t * mx + 3 * m * t * t * mx + t ** 3 * b.x!,
          m ** 3 * a.y! + 3 * m * m * t * a.y! + 3 * m * t * t * b.y! + t ** 3 * b.y!,
        ];
      };
      for (const d of dots) {
        const ns = d.path.map((id) => byId.get(id)).filter((n): n is Node => !!n && n.x != null);
        if (!ns.length) continue;
        let x: number, y: number;
        if (ns.length === 1) { x = ns[0].x!; y = ns[0].y!; }   // 갈 곳이 없는 사건은 제자리에서 깜빡인다
        else {
          const segs = ns.length - 1;
          const i = Math.min(segs - 1, Math.floor(d.u * segs));
          [x, y] = at(ns[i], ns[i + 1], d.u * segs - i);
        }
        const fade = Math.sin(Math.PI * Math.min(1, Math.max(0, d.u)));
        ctx.globalAlpha = 0.25 + 0.75 * fade;
        ctx.fillStyle = EV_COLOR[d.kind] || C.muted;
        ctx.beginPath(); ctx.arc(x, y, ns.length === 1 ? 3 + 4 * fade : 3.6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }, [g, layout, sel, showGhost, showCand, hlGhost]);

  useEffect(() => { paint([]); }, [paint]);

  // ── 재생
  const loadEvents = useCallback(async (h: number) => {
    setEvBusy(true);
    try {
      const r = await apiJson<Events>(`/api/ontology/events?hours=${h}&actorId=${encodeURIComponent(userId)}`);
      const t0 = new Date(r.from).getTime(), span = Math.max(1, new Date(r.to).getTime() - t0);
      r.events = r.events.map((e) => ({ ...e, t: (new Date(e.at).getTime() - t0) / span }));
      setEv(r); cursorRef.current = 0; setCursorUi(0);
    } catch (e: any) { toast(e?.message || '재생할 사건을 불러오지 못했습니다', 'error'); }
    finally { setEvBusy(false); }
  }, [userId]);

  const dotsAt = useCallback((c: number): Dot[] => {
    if (!ev) return [];
    const out: Dot[] = [];
    for (const e of ev.events) {
      const t = e.t ?? 0;
      if (c < t || c > t + TRAVEL) continue;
      out.push({ u: (c - t) / TRAVEL, kind: e.kind, path: e.path });
      if (out.length >= 200) break;     // 한 프레임에 200개면 충분하다. 더 그려도 읽히지 않는다.
    }
    return out;
  }, [ev]);

  useEffect(() => {
    if (!playing || !ev) return;
    let last = performance.now(), lastUi = 0;
    const step = (now: number) => {
      const dt = now - last; last = now;
      let c = cursorRef.current + (dt / PLAY_MS) * speed;
      if (c >= 1) c = 1;
      cursorRef.current = c;
      paint(dotsAt(c));
      if (now - lastUi > 120) { lastUi = now; setCursorUi(c); }
      if (c >= 1) { setCursorUi(1); setPlaying(false); return; }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, ev, speed, paint, dotsAt]);

  const seek = (c: number) => { cursorRef.current = c; setCursorUi(c); paint(dotsAt(c)); };

  function onCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const cv = cvRef.current; if (!cv || !g) return;
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * layout.w / rect.width;
    const y = (ev.clientY - rect.top) * layout.h / rect.height;
    let hit: Node | null = null;
    for (const n of g.nodes) {
      if (n.x == null) continue;
      const rr = (n.type === 'ceo' ? 26 : 14) + 6;
      if ((n.x - x) ** 2 + (n.y! - y) ** 2 < rr * rr) hit = n;
    }
    setSel(hit);
  }

  if (err) return <div style={{ padding: 24, color: '#b91c1c' }}>{err}</div>;

  const s = g?.summary;
  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 8px', display: 'grid', gap: 12 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>온톨로지 흐름 맵</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          회사의 객체가 어떻게 이어져 있고, 업무가 그 망을 따라 실제로 어떻게 흐르는지, 그리고 <b>정의되지 않은 길로 새는 업무</b>까지 한 화면에서 봅니다.
          측정은 기계가, 해석은 AI가, <b>결정은 사람이</b> 합니다. 점선은 아직 사람이 확인하지 않은 후보이고 판단에 쓰지 않습니다.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={month} max={new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)}
          onChange={(e) => { setSel(null); setMonth(e.target.value); }}
          style={{ width: 'auto', fontSize: 13, padding: '5px 8px', border: `1px solid ${C.rule}`, borderRadius: 8 }} />
        <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} style={{ width: 'auto', minWidth: 0, margin: 0 }} /> 정의 밖 경로
        </label>
        <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showCand} onChange={(e) => setShowCand(e.target.checked)} style={{ width: 'auto', minWidth: 0, margin: 0 }} /> 후보층(점선)
        </label>
        <span style={{ flex: 1 }} />
        {s && (
          <span style={{ fontSize: 12, color: '#5d6b75', fontVariantNumeric: 'tabular-nums' }}>
            활동 {s.activities} · 대분류 {s.domains} · 일지 {s.worklogs} · 미분류 {s.unclassifiedRatio}% · 목표 밖 {s.outsideGoalHours}시간 · 정의 밖 경로 {s.ghostCount}
            {s.hiddenEmptyGoals ? <span title="활동·지표·담당이 하나도 붙지 않은 자동 생성 목표입니다. 지우지 않고 맵에서만 가렸습니다." style={{ color: C.muted }}> · 빈 자동 목표 {s.hiddenEmptyGoals}개 가림</span> : null}
          </span>
        )}
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void scan()}>{busy ? '분석 중…' : '흐름 다시 분석'}</button>
        <button className="btn btn-sm btn-outline"
          onClick={() => { const on = !replayOn; setReplayOn(on); if (on && !ev) void loadEvents(hours); if (!on) { setPlaying(false); paint([]); } }}>
          {replayOn ? '재생 닫기' : '흐름 재생'}
        </button>
      </div>

      {replayOn && (
        <div style={{ background: '#fff', border: `1px solid ${C.rule}`, borderRadius: 10, padding: '10px 14px', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={hours} onChange={(e) => { const h = Number(e.target.value); setHours(h); setPlaying(false); void loadEvents(h); }}
              style={{ width: 'auto', fontSize: 13, padding: '4px 8px', border: `1px solid ${C.rule}`, borderRadius: 8 }}>
              <option value={24}>최근 24시간</option>
              <option value={168}>최근 7일</option>
            </select>
            <button className="btn btn-sm" disabled={!ev || evBusy}
              onClick={() => { if (cursorRef.current >= 1) seek(0); setPlaying((v) => !v); }}>
              {evBusy ? '불러오는 중…' : playing ? '멈춤' : '재생'}
            </button>
            <button className="btn btn-sm btn-outline" disabled={!ev} onClick={() => { setPlaying(false); seek(0); }}>처음으로</button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
              style={{ width: 'auto', fontSize: 13, padding: '4px 8px', border: `1px solid ${C.rule}`, borderRadius: 8 }}>
              <option value={0.5}>0.5배</option><option value={1}>1배</option><option value={2}>2배</option><option value={4}>4배</option>
            </select>
            <input type="range" min={0} max={1000} value={Math.round(cursorUi * 1000)} disabled={!ev}
              onChange={(e) => { setPlaying(false); seek(Number(e.target.value) / 1000); }}
              style={{ flex: '1 1 220px', minWidth: 160, accentColor: C.navy }} />
            {ev && (
              <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {new Date(new Date(ev.from).getTime() + cursorUi * (new Date(ev.to).getTime() - new Date(ev.from).getTime()))
                  .toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {ev && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
              {(['record', 'intent', 'verify', 'ghost'] as const).map((k) => (
                <span key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                  <i style={{ width: 9, height: 9, borderRadius: 9, background: EV_COLOR[k], display: 'inline-block' }} />
                  {EV_LABEL[k]} <b style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {k === 'record' ? ev.counters.up : k === 'intent' ? ev.counters.down : k === 'verify' ? ev.counters.verify : ev.counters.ghost}
                  </b>
                </span>
              ))}
              <span style={{ color: ev.counters.ghostRatio >= 30 ? C.amber : C.muted, whiteSpace: 'nowrap' }}>
                정의 밖 비율 <b>{ev.counters.ghostRatio}%</b>
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: C.muted }}>
                {ev.counters.total === 0 ? '이 창에는 사건이 없습니다' : `사건 ${ev.counters.total}건`}
                {ev.sampled ? ' · 많아서 고르게 추려 그립니다' : ''}
              </span>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.muted }}>
            경로만 돌려받아 그립니다. 누가 썼는지는 내려오지 않습니다. 정의 밖 경로는 대상(금형·부품·설비·협력사)을 공유하는 기록이 이어진 순간에 찍힙니다.
          </div>
        </div>
      )}

      {!g ? <div style={{ padding: 30, color: '#94a3b8' }}>그리는 중…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 12, alignItems: 'start' }}>
          <div style={{ background: '#fff', border: `1px solid ${C.rule}`, borderRadius: 10, overflow: 'auto', maxHeight: '78vh' }}>
            <canvas ref={cvRef} onClick={onCanvasClick}
              style={{ display: 'block', width: layout.w, maxWidth: 'none', height: layout.h, cursor: 'pointer' }} />
          </div>

          <aside style={{ background: '#fff', border: `1px solid ${C.rule}`, borderRadius: 10, padding: 14, display: 'grid', gap: 10, maxHeight: '78vh', overflowY: 'auto' }}>
            {sel ? (
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <b style={{ fontSize: 15 }}>{sel.label}</b>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-outline" onClick={() => setSel(null)}>닫기</button>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.rule}` }}>{KIND_LABEL[sel.type] || sel.type}</span>
                  <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, border: `1px solid ${sel.status === 'ok' ? C.green : C.cand}`, color: sel.status === 'ok' ? C.green : C.cand, borderStyle: sel.status === 'ok' ? 'solid' : 'dashed' }}>
                    {sel.status === 'ok' ? '확정층' : sel.status === 'ghost' ? '온톨로지 밖' : '후보층 · AI 해석'}
                  </span>
                  {sel.outsideGoal && <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', fontWeight: 700 }}>목표 밖</span>}
                </div>
                {sel.metrics && (
                  <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: 13, margin: 0 }}>
                    {sel.metrics.activities != null && (<><dt style={{ color: C.muted }}>활동</dt><dd style={{ margin: 0 }}>{sel.metrics.activities}개 (확정 {sel.metrics.confirmed})</dd></>)}
                    {sel.metrics.worklogs != null && (<><dt style={{ color: C.muted }}>일지</dt><dd style={{ margin: 0 }}>{sel.metrics.worklogs}건</dd></>)}
                    {sel.metrics.minutes != null && (<><dt style={{ color: C.muted }}>투입</dt><dd style={{ margin: 0 }}>{Math.round(sel.metrics.minutes / 60)}시간</dd></>)}
                    {sel.metrics.goalLinked != null && (<><dt style={{ color: C.muted }}>목표 연결</dt><dd style={{ margin: 0, color: sel.metrics.goalLinked ? C.green : C.amber }}>{sel.metrics.goalLinked}개 활동</dd></>)}
                    {sel.metrics.team && (<><dt style={{ color: C.muted }}>팀</dt><dd style={{ margin: 0 }}>{sel.metrics.team}</dd></>)}
                  </dl>
                )}
                {!!sel.top?.length && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>이 대분류의 주요 활동</div>
                    <div style={{ display: 'grid', gap: 3 }}>
                      {sel.top.map((t) => (
                        <div key={t.id} style={{ display: 'flex', gap: 6, fontSize: 12.5, alignItems: 'baseline' }}>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                          <span style={{ color: C.muted }}>{t.n}건</span>
                          {!t.linked && <span style={{ color: C.amber, fontSize: 10.5 }}>목표 밖</span>}
                        </div>
                      ))}
                    </div>
                    <button className="btn btn-sm btn-outline" style={{ marginTop: 6 }} onClick={() => nav('/process/ontology')}>온톨로지 탐색기에서 보기 →</button>
                  </div>
                )}
                {sel.type === 'cloud' && (
                  <div style={{ fontSize: 12.5, color: C.muted }}>
                    어떤 활동에도 귀속되지 않은 기록입니다. 묶어서 새 활동 후보로 올리려면 활동 지도의 채굴 기능을 쓰세요.
                    <button className="btn btn-sm btn-outline" style={{ marginTop: 6 }} onClick={() => nav('/process/activity-map')}>활동 지도 →</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <b style={{ fontSize: 15 }}>읽는 법</b>
                <div style={{ fontSize: 12.5, color: C.muted, display: 'grid', gap: 5 }}>
                  <span>— 실선: 확정층(사람이 확인한 연결)</span>
                  <span>— 점선: 후보층(AI 해석, 판단에 쓰지 않음)</span>
                  <span>— 굵은 회색 곡선: <b>정의 밖 경로</b>(실제로 관찰됐지만 온톨로지에 없는 길, 굵기는 빈도)</span>
                  <span>— 노드를 누르면 이어진 것만 남습니다</span>
                </div>

                <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 8 }}>
                  <b style={{ fontSize: 14 }}>정의 밖에서 일어나는 일</b>
                  <div style={{ fontSize: 12, color: C.muted, margin: '2px 0 8px' }}>
                    같은 대상(금형·부품·설비·협력사)을 공유하는 기록을 시간순으로 이어 만든 길입니다. <b>집계로만 보이고 개인 이름은 없습니다.</b>
                    발견한 길마다 셋 중 하나를 고르면 결정 기록으로 남고, 관리자 시험지의 재료가 됩니다.
                  </div>
                  {!g.ghosts.length && (
                    <div style={{ fontSize: 12.5, color: C.muted }}>
                      아직 분석한 결과가 없습니다. 위 <b>흐름 다시 분석</b>을 눌러 주세요.
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {g.ghosts.map((gh) => (
                      <div key={gh.id}
                        onMouseEnter={() => setHlGhost(gh.id)} onMouseLeave={() => setHlGhost(null)}
                        style={{ border: `1px solid ${hlGhost === gh.id ? C.amber : C.rule}`, borderRadius: 8, padding: 9, display: 'grid', gap: 5, fontSize: 13 }}>
                        <b>{gh.fromLabel} → {gh.toLabel}</b>
                        <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                          {gh.count} / {gh.ofCount}건 ({Math.round((gh.count / Math.max(1, gh.ofCount)) * 100)}%)
                          {gh.medianGapMinutes != null && ` · 간격 중앙값 ${gh.medianGapMinutes >= 1440 ? `${Math.round(gh.medianGapMinutes / 1440)}일` : `${Math.round(gh.medianGapMinutes / 60)}시간`}`}
                          {!!gh.offHoursRatio && gh.offHoursRatio >= 30 && ` · 3일 넘게 빈 경우 ${gh.offHoursRatio}%`}
                        </span>
                        {!!gh.offHoursRatio && gh.offHoursRatio >= 50 && (
                          <span style={{ fontSize: 11.5, color: C.amber }}>단계 사이가 자주 비어 있습니다 — 시스템 밖(메신저·전화)에서 처리됐을 수 있습니다</span>
                        )}
                        {!!gh.sampleCases?.length && (
                          <span style={{ fontSize: 11.5, color: C.muted }}>
                            근거 대상: {gh.sampleCases.slice(0, 3).map((c) => c.entityName).join(', ')}
                          </span>
                        )}
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {Object.entries(DEC).map(([k, v]) => (
                            <button key={k} type="button" onClick={() => void decide(gh, k)}
                              style={{
                                border: `1px solid ${gh.decision?.choice === k ? C.green : C.rule}`,
                                color: gh.decision?.choice === k ? C.green : C.ink,
                                fontWeight: gh.decision?.choice === k ? 700 : 400,
                                background: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer', width: 'auto',
                              }}>{v}</button>
                          ))}
                        </div>
                        {gh.decision && (
                          <span style={{ fontSize: 12, color: C.green }}>
                            {DEC_NOTE[gh.decision.choice]}{gh.decision.rationale ? ` · ${gh.decision.rationale}` : ''}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {s && (
                  <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 8, fontSize: 12, color: C.muted }}>
                    {s.scannedAt ? `마지막 분석 ${new Date(s.scannedAt).toLocaleString('ko-KR')}` : '아직 분석하지 않음'}
                    {' · '}KPI {s.kpis}개 중 데이터 연결 {s.boundKpis}개
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
