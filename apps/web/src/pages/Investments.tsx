import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';
import { OneDriveFilePicker } from '../components/OneDriveFilePicker';

/**
 * 설비투자 포트폴리오 — 건별 가부 심사가 아니라 연간 포트폴리오 안에서 우선순위를 비교하는 절차.
 * 탭: 제안(입력·내 제안) → 사전 검토(점수화) → 포트폴리오(한도·순위) → 투자위원회(소집·심의) → 실행·사후검증
 */
type Meta = {
  me: { id: string; name: string; role: string; orgUnitName: string; canReview: boolean; canDecide: boolean };
  users: Array<{ id: string; name: string; role: string; orgName: string }>;
  years: number[]; categories: Record<string, { label: string; mandatory: boolean }>; statusKo: Record<string, string>; defaultWeights: Record<string, number>;
};
type Proposal = any;
type Meeting = any;

const STEPS = [
  { key: 'SUBMITTED', label: '① 제안 접수', to: '/investments' },
  { key: 'REVIEWED', label: '② 사전 검토·점수화', to: '/investments/review' },
  { key: 'PORTFOLIO', label: '③ 포트폴리오 우선순위', to: '/investments/portfolio' },
  { key: 'ON_AGENDA', label: '④ 위원회 소집·심의', to: '/investments/committee' },
  { key: 'APPROVED', label: '⑤ 결정·실행', to: '/investments/execution' },
  { key: 'AUDITED', label: '⑥ 사후 검증', to: '/investments/execution' },
];
const STATUS_COLOR: Record<string, { c: string; bg: string }> = {
  SUBMITTED: { c: '#475569', bg: '#f1f5f9' }, REVIEWED: { c: '#0369a1', bg: '#e0f2fe' }, ON_AGENDA: { c: '#7c3aed', bg: '#f5f3ff' },
  APPROVED: { c: '#15803d', bg: '#f0fdf4' }, DEFERRED: { c: '#b45309', bg: '#fffbeb' }, REJECTED: { c: '#b91c1c', bg: '#fef2f2' },
  IN_PROGRESS: { c: '#1d4ed8', bg: '#eff6ff' }, COMPLETED: { c: '#065f46', bg: '#ecfdf5' }, AUDITED: { c: '#334155', bg: '#e2e8f0' }, WITHDRAWN: { c: '#94a3b8', bg: '#f8fafc' },
};

function won(n?: number | null): string {
  const v = Number(n || 0);
  if (!v) return '0';
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1)}억`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return v.toLocaleString();
}

function d(s?: string | null): string { return s ? new Date(s).toLocaleDateString() : ''; }
function dt(s?: string | null): string { return s ? new Date(s).toLocaleString() : ''; }
function toLocalInput(s?: string | null): string {
  if (!s) return '';
  const t = new Date(new Date(s).getTime() + 9 * 3600000);
  return t.toISOString().slice(0, 16);
}

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 8 };
const lbl: React.CSSProperties = { fontSize: 12, color: '#475569', fontWeight: 600 };
const inp: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 13, width: '100%' };

export function Investments({ tab }: { tab: 'proposals' | 'review' | 'portfolio' | 'committee' | 'execution' }) {
  const location = useLocation();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [meta, setMeta] = useState<Meta | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadMeta() {
    try { const m = await apiJson<Meta>(`/api/investments/meta?userId=${encodeURIComponent(userId)}`); setMeta(m); } catch (e: any) { toast(e?.message || '불러오기 실패', 'error'); }
  }
  async function loadItems() {
    setLoading(true);
    try { const r = await apiJson<{ items: Proposal[] }>(`/api/investments/proposals?userId=${encodeURIComponent(userId)}`); setItems(r.items || []); }
    catch (e: any) { toast(e?.message || '불러오기 실패', 'error'); } finally { setLoading(false); }
  }
  useEffect(() => { if (userId) { void loadMeta(); void loadItems(); } /* eslint-disable-next-line */ }, [userId, location.pathname]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of items) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [items]);
  if (!userId) return <div style={{ padding: 24, color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>설비투자 포트폴리오</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          투자 안건을 건별로 가부만 정하지 않고, <b>연간 한도 안에서 전체 포트폴리오와 대조해 우선순위</b>를 정합니다. 법규·안전·환경과 원청·신차 대응은 필수(선배정), 나머지는 재량(우선순위 경쟁)입니다.
        </div>
      </div>
      {/* 절차 스트립 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STEPS.map((s) => {
          const active = location.pathname === s.to || (s.key === 'AUDITED' && location.pathname === '/investments/execution');
          const n = s.key === 'PORTFOLIO' ? undefined : s.key === 'APPROVED' ? (counts.APPROVED || 0) + (counts.IN_PROGRESS || 0) + (counts.COMPLETED || 0) : counts[s.key] || 0;
          return (
            <Link key={s.key + s.label} to={s.to} style={{ textDecoration: 'none', fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 999, border: `1px solid ${active ? '#0F3D73' : '#e5e7eb'}`, background: active ? '#0F3D73' : '#fff', color: active ? '#fff' : '#334155' }}>
              {s.label}{n != null ? <span style={{ marginLeft: 6, opacity: 0.8 }}>{n}</span> : null}
            </Link>
          );
        })}
      </div>

      {tab === 'proposals' && <ProposalsTab meta={meta} items={items} userId={userId} reload={loadItems} loading={loading} />}
      {tab === 'review' && <ReviewTab meta={meta} items={items} userId={userId} reload={loadItems} />}
      {tab === 'portfolio' && <PortfolioTab meta={meta} userId={userId} year={year} setYear={setYear} />}
      {tab === 'committee' && <CommitteeTab meta={meta} items={items} userId={userId} reload={loadItems} />}
      {tab === 'execution' && <ExecutionTab meta={meta} items={items} userId={userId} reload={loadItems} />}
    </div>
  );
}

function StatusChip({ st, meta }: { st: string; meta: Meta | null }) {
  const c = STATUS_COLOR[st] || STATUS_COLOR.SUBMITTED;
  return <span style={{ fontSize: 11, fontWeight: 700, color: c.c, background: c.bg, border: `1px solid ${c.c}33`, borderRadius: 999, padding: '2px 8px' }}>{meta?.statusKo?.[st] || st}</span>;
}
function CatChip({ cat, meta }: { cat: string; meta: Meta | null }) {
  const c = meta?.categories?.[cat];
  return <span style={{ fontSize: 11, color: c?.mandatory ? '#9a3412' : '#1e40af', background: c?.mandatory ? '#fff7ed' : '#eff6ff', border: `1px solid ${c?.mandatory ? '#fdba74' : '#bfdbfe'}`, borderRadius: 999, padding: '2px 8px' }}>{c?.mandatory ? '필수 · ' : ''}{c?.label || cat}</span>;
}

// ───────────────────────── ① 제안 ─────────────────────────
function ProposalsTab({ meta, items, userId, reload, loading }: { meta: Meta | null; items: Proposal[]; userId: string; reload: () => Promise<void>; loading: boolean }) {
  const empty = { title: '', category: 'MAINTENANCE', description: '', rationale: '', amount: '', targetYear: new Date().getFullYear() + 1, targetQuarter: '', carProgram: '', deadlineAt: '', annualBenefit: '', paybackMonths: '', fastTrack: false, dependencies: [] as string[], attachments: [] as Array<{ url: string; name: string }> };
  const [f, setF] = useState<any>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const mine = items.filter((p) => p.proposerId === userId);
  const list = showAll ? items : mine;
  const set = (k: string, v: any) => setF((prev: any) => ({ ...prev, [k]: v }));

  function openEdit(p: Proposal) {
    setEditingId(p.id);
    setF({ title: p.title, category: p.category, description: p.description || '', rationale: p.rationale || '', amount: p.amount ?? '', targetYear: p.targetYear, targetQuarter: p.targetQuarter ?? '', carProgram: p.carProgram || '', deadlineAt: p.deadlineAt ? String(p.deadlineAt).slice(0, 10) : '', annualBenefit: p.annualBenefit ?? '', paybackMonths: p.paybackMonths ?? '', fastTrack: !!p.fastTrack, dependencies: Array.isArray(p.dependencies) ? p.dependencies : [], attachments: Array.isArray(p.attachments) ? p.attachments : [] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function save() {
    if (!f.title.trim()) { toast('제목을 입력하세요', 'error'); return; }
    if (!(Number(f.amount) >= 0) || f.amount === '') { toast('투자 금액을 입력하세요', 'error'); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({ userId, ...f, deadlineAt: f.deadlineAt ? new Date(f.deadlineAt + 'T00:00:00+09:00').toISOString() : null });
      if (editingId) await apiJson(`/api/investments/proposals/${encodeURIComponent(editingId)}`, { method: 'PUT', body });
      else await apiJson(`/api/investments/proposals`, { method: 'POST', body });
      toast(editingId ? '수정되었습니다' : '투자 제안이 접수되었습니다. 임원에게 알림이 갔습니다.', 'success');
      setF(empty); setEditingId(null); await reload();
    } catch (e: any) { toast(e?.message || '저장 실패', 'error'); } finally { setSaving(false); }
  }
  async function withdraw(p: Proposal) {
    if (!(await toastConfirm(`"${p.title}" 제안을 철회할까요?`))) return;
    try { await apiJson(`/api/investments/proposals/${encodeURIComponent(p.id)}/withdraw`, { method: 'POST', body: JSON.stringify({ userId }) }); toast('철회했습니다', 'success'); await reload(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); }
  }
  const payback = f.amount && f.annualBenefit && Number(f.annualBenefit) > 0 ? Math.round((Number(f.amount) / Number(f.annualBenefit)) * 12) : null;

  return (
    <>
      <div style={{ ...card, border: editingId ? '2px solid #0F3D73' : card.border }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b>{editingId ? '✏️ 제안 수정' : '투자 제안 입력'}</b>
          <span style={{ fontSize: 12, color: '#64748b' }}>제안자: {meta?.me?.name} · {meta?.me?.orgUnitName}</span>
          <span style={{ flex: 1 }} />
          {editingId && <button className="btn btn-sm btn-outline" onClick={() => { setEditingId(null); setF(empty); }}>취소</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>제목 *</div><input style={inp} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 도장 2라인 이송 로봇 교체" /></div>
          <div><div style={lbl}>투자 범주 *</div>
            <select style={inp} value={f.category} onChange={(e) => set('category', e.target.value)}>
              {Object.entries(meta?.categories || {}).map(([k, v]) => <option key={k} value={k}>{v.mandatory ? '[필수] ' : '[재량] '}{v.label}</option>)}
            </select></div>
          <div><div style={lbl}>투자 금액(원) *</div><input style={inp} type="number" min={0} step={1000000} value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="150000000" />
            <div style={{ fontSize: 11, color: '#64748b' }}>{f.amount ? `= ${won(Number(f.amount))}원` : '숫자만 (예: 1억5천만 = 150000000)'}</div></div>
          <div><div style={lbl}>투자 시기</div><div style={{ display: 'flex', gap: 6 }}>
            <select style={inp} value={f.targetYear} onChange={(e) => set('targetYear', Number(e.target.value))}>{(meta?.years || [new Date().getFullYear()]).map((y) => <option key={y} value={y}>{y}년</option>)}</select>
            <select style={inp} value={f.targetQuarter} onChange={(e) => set('targetQuarter', e.target.value)}><option value="">분기 미정</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}분기</option>)}</select></div></div>
          <div><div style={lbl}>관련 차종·프로그램</div><input style={inp} value={f.carProgram} onChange={(e) => set('carProgram', e.target.value)} placeholder="예: NX4 F/L SOP 2027.03" /></div>
          <div><div style={lbl}>기한(원청 요구·법규)</div><input style={inp} type="date" value={f.deadlineAt} onChange={(e) => set('deadlineAt', e.target.value)} /></div>
          <div><div style={lbl}>연간 기대효과(원)</div><input style={inp} type="number" min={0} value={f.annualBenefit} onChange={(e) => set('annualBenefit', e.target.value)} placeholder="절감·매출 증가" /></div>
          <div><div style={lbl}>회수기간(개월)</div><input style={inp} type="number" min={0} value={f.paybackMonths} onChange={(e) => set('paybackMonths', e.target.value)} placeholder={payback ? `자동 계산: ${payback}` : ''} />
            {payback && !f.paybackMonths && <div style={{ fontSize: 11, color: '#64748b' }}>금액÷연간효과 = 약 {payback}개월 (비우면 이 값 사용)</div>}</div>
          <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>투자 내용·범위</div><textarea style={{ ...inp, minHeight: 70 }} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="무엇을, 어디에, 어떤 규격으로" /></div>
          <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>필요성·배경 (안 하면 생기는 문제)</div><textarea style={{ ...inp, minHeight: 70 }} value={f.rationale} onChange={(e) => set('rationale', e.target.value)} placeholder="노후 정도, 고장·불량 이력, 원청 요구 문서, 법규 근거 등" /></div>
          <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>관련 안건 (선후·중복 관계)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {items.filter((p) => p.id !== editingId && !['WITHDRAWN', 'REJECTED'].includes(p.status)).map((p) => {
                const on = (f.dependencies || []).includes(p.id);
                return <button key={p.id} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 11 }} onClick={() => set('dependencies', on ? f.dependencies.filter((x: string) => x !== p.id) : [...f.dependencies, p.id])}>{p.title}</button>;
              })}
              {!items.length && <span style={{ fontSize: 12, color: '#94a3b8' }}>등록된 다른 안건이 없습니다</span>}
            </div></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f.fastTrack} onChange={(e) => set('fastTrack', e.target.checked)} /> 긴급(패스트트랙) — 정기 회의를 기다릴 수 없음</label>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowPicker(true)}>📁 첨부(OneDrive)</button>
            {(f.attachments || []).map((a: any, i: number) => <span key={i} style={{ fontSize: 12 }}><a href={a.url} target="_blank" rel="noreferrer">{a.name}</a> <button type="button" onClick={() => set('attachments', f.attachments.filter((_: any, j: number) => j !== i))} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer' }}>×</button></span>)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : editingId ? '수정 저장' : '제안 접수'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>{showAll ? '전체 제안' : '내 제안'} {list.length}건</b>{loading && <span style={{ fontSize: 12, color: '#94a3b8' }}>로딩중</span>}
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 전체 보기</label>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {list.map((p) => (
          <div key={p.id} style={{ ...card, padding: '8px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ flex: 1, minWidth: 200 }}>{p.title}</b>
              <CatChip cat={p.category} meta={meta} /><StatusChip st={p.status} meta={meta} />
              {p.fastTrack && <span style={{ fontSize: 11, color: '#b91c1c' }}>⚡긴급</span>}
              <span style={{ fontSize: 12, fontWeight: 700 }}>{won(p.amount)}원</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.targetYear}년{p.targetQuarter ? ` ${p.targetQuarter}Q` : ''} · {p.proposerName} · {p.orgUnitName}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {p.priorityScore != null && <span>우선순위 점수 <b>{p.priorityScore}</b></span>}
              {p.reviewNote && <span>검토 의견: {p.reviewNote}</span>}
              {p.meeting && <span>회의: {p.meeting.title} ({d(p.meeting.scheduledAt)})</span>}
              {p.decision && <span>결정: {meta?.statusKo?.[p.decision]}{p.decisionNote ? ` — ${p.decisionNote}` : ''}</span>}
            </div>
            {(p.proposerId === userId || meta?.me?.canDecide) && ['SUBMITTED', 'REVIEWED', 'REJECTED', 'DEFERRED', 'ON_AGENDA'].includes(p.status) && (
              <div style={{ display: 'flex', gap: 6 }}>
                {p.status !== 'ON_AGENDA' && <button className="btn btn-sm btn-outline" onClick={() => openEdit(p)}>수정</button>}
                <button className="btn btn-sm btn-outline" style={{ color: '#dc2626' }} onClick={() => void withdraw(p)}>철회</button>
              </div>
            )}
          </div>
        ))}
        {!list.length && !loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>아직 제안이 없습니다.</div>}
      </div>
      {showPicker && <OneDriveFilePicker userId={userId} multiple onSelect={(files) => set('attachments', [...(f.attachments || []), ...files.map((x) => ({ url: x.url, name: x.name || x.url }))])} onClose={() => setShowPicker(false)} />}
    </>
  );
}

// ───────────────────────── ② 사전 검토 ─────────────────────────
function ReviewTab({ meta, items, userId, reload }: { meta: Meta | null; items: Proposal[]; userId: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const targets = items.filter((p) => ['SUBMITTED', 'REVIEWED', 'ON_AGENDA'].includes(p.status));
  const SCORES: Array<[string, string, string]> = [
    ['scoreFinancial', '재무 (회수기간·NPV)', '≤12개월=5, ≤24=4, ≤36=3, ≤60=2, 그 이상=1. 비우면 회수기간으로 자동'],
    ['scoreRisk', '리스크 감소', '라인 정지·품질사고·법규 위반 위험을 얼마나 줄이나'],
    ['scoreStrategic', '전략 적합성', '수주 차종·중기 방향과의 연결'],
    ['scoreFeasibility', '실행 가능성', '인력·공사기간·기술 확보 수준'],
    ['scoreUrgency', '시급성', '미루면 생기는 손실·기한'],
  ];
  function start(p: Proposal) {
    setOpen(p.id);
    setF({ scoreFinancial: p.scoreFinancial ?? '', scoreRisk: p.scoreRisk ?? '', scoreStrategic: p.scoreStrategic ?? '', scoreFeasibility: p.scoreFeasibility ?? '', scoreUrgency: p.scoreUrgency ?? '', reviewNote: p.reviewNote || '' });
  }
  async function save(p: Proposal) {
    setSaving(true);
    try { const r = await apiJson<any>(`/api/investments/proposals/${encodeURIComponent(p.id)}/review`, { method: 'POST', body: JSON.stringify({ userId, ...f }) }); toast(`검토 저장 — 우선순위 점수 ${r.priorityScore ?? '(점수 미완성)'}`, 'success'); setOpen(null); await reload(); }
    catch (e: any) { toast(e?.message || '저장 실패', 'error'); } finally { setSaving(false); }
  }
  if (!meta?.me?.canReview) return <div style={card}><b>사전 검토</b><div style={{ fontSize: 13, color: '#64748b' }}>팀장 이상이 접수된 안건을 같은 기준으로 점수화합니다. 내 제안의 점수는 "제안" 탭에서 확인하세요.</div></div>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, color: '#64748b' }}>같은 기준(5개 항목 × 1~5점)으로 매겨야 위원회에서 비교가 됩니다. 점수표를 정교하게 만드는 것보다 <b>모두 같은 저울로 재는 것</b>이 핵심입니다. 가중치는 포트폴리오 탭에서 연도별로 정합니다.</div>
      {targets.map((p) => (
        <div key={p.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ flex: 1, minWidth: 200 }}>{p.title}</b><CatChip cat={p.category} meta={meta} /><StatusChip st={p.status} meta={meta} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{won(p.amount)}원</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.targetYear}년 · {p.proposerName} · {p.orgUnitName}</span>
            {p.priorityScore != null ? <span style={{ fontSize: 12, color: '#0369a1', fontWeight: 700 }}>점수 {p.priorityScore}</span> : <span style={{ fontSize: 12, color: '#b45309' }}>미검토</span>}
            <button className="btn btn-sm btn-primary" onClick={() => (open === p.id ? setOpen(null) : start(p))}>{open === p.id ? '닫기' : p.reviewedAt ? '점수 수정' : '검토하기'}</button>
          </div>
          <div style={{ fontSize: 12, color: '#475569' }}>{p.rationale || p.description}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>기대효과 {p.annualBenefit ? `${won(p.annualBenefit)}원/년` : '-'} · 회수 {p.paybackMonths ? `${p.paybackMonths}개월` : '-'} · {p.carProgram || ''} {p.deadlineAt ? `· 기한 ${d(p.deadlineAt)}` : ''}</div>
          {open === p.id && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8, display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                {SCORES.map(([k, label, hint]) => (
                  <div key={k}><div style={lbl}>{label}</div>
                    <div style={{ display: 'flex', gap: 4 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`btn btn-sm ${Number(f[k]) === n ? 'btn-primary' : 'btn-outline'}`} onClick={() => setF((x: any) => ({ ...x, [k]: n }))}>{n}</button>)}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{hint}</div></div>
                ))}
              </div>
              <textarea style={{ ...inp, minHeight: 50 }} placeholder="검토 의견 (근거·확인 필요 사항)" value={f.reviewNote} onChange={(e) => setF((x: any) => ({ ...x, reviewNote: e.target.value }))} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={saving} onClick={() => void save(p)}>{saving ? '저장 중…' : '검토 저장'}</button></div>
            </div>
          )}
        </div>
      ))}
      {!targets.length && <div style={{ fontSize: 13, color: '#94a3b8' }}>검토할 안건이 없습니다.</div>}
    </div>
  );
}

// ───────────────────────── ③ 포트폴리오 ─────────────────────────
function PortfolioTab({ meta, userId, year, setYear }: { meta: Meta | null; userId: string; year: number; setYear: (y: number) => void }) {
  const [pf, setPf] = useState<any>(null);
  const [b, setB] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  async function load() {
    try { const r = await apiJson<any>(`/api/investments/portfolio?userId=${encodeURIComponent(userId)}&year=${year}`); setPf(r); setB({ limitAmount: r.budget.limitAmount, mandatoryReserve: r.budget.mandatoryReserve, weights: r.budget.weights, note: r.budget.note || '' }); }
    catch (e: any) { toast(e?.message || '불러오기 실패', 'error'); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [year]);
  async function saveBudget() {
    setSaving(true);
    try { await apiJson(`/api/investments/budget/${year}`, { method: 'PUT', body: JSON.stringify({ userId, ...b }) }); toast('한도·가중치 저장', 'success'); await load(); }
    catch (e: any) { toast(e?.message || '저장 실패', 'error'); } finally { setSaving(false); }
  }
  if (!pf) return <div style={{ color: '#94a3b8' }}>불러오는 중…</div>;
  const t = pf.totals; const lim = Number(pf.budget.limitAmount || 0);
  const wsum = Object.values(b?.weights || {}).reduce((s: number, v: any) => s + Number(v || 0), 0);
  const Row = ({ p, i }: { p: any; i?: number }) => (
    <tr style={{ background: p.withinLimit === false ? '#fff1f2' : undefined, opacity: ['DEFERRED'].includes(p.status) ? 0.6 : 1 }}>
      <td style={{ textAlign: 'center' }}>{p.mandatory ? '필수' : p.rank}</td>
      <td><b>{p.title}</b><div style={{ fontSize: 11, color: '#64748b' }}>{p.proposerName} · {p.orgUnitName}{p.carProgram ? ` · ${p.carProgram}` : ''}{p.fastTrack ? ' · ⚡긴급' : ''}</div></td>
      <td><CatChip cat={p.category} meta={meta} /></td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{won(p.approvedAmount ?? p.amount)}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.mandatory ? '' : won(p.cumulative)}</td>
      <td style={{ textAlign: 'center' }}>{p.priorityScore ?? <span style={{ color: '#b45309' }}>미검토</span>}</td>
      <td><StatusChip st={p.status} meta={meta} /></td>
      <td style={{ fontSize: 11, color: '#64748b' }}>{p.withinLimit === false ? '한도 초과' : p.withinLimit === true ? '한도 내' : ''}{p.meeting ? ` · ${p.meeting.title}` : ''}</td>
    </tr>
  );
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select style={{ ...inp, width: 120 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>{(meta?.years || [year]).map((y) => <option key={y} value={y}>{y}년</option>)}</select>
        <span style={{ fontSize: 12, color: '#64748b' }}>연간 한도를 먼저 정하고(영업현금흐름·차입 여력), 필수 투자를 선배정한 뒤 나머지에서 재량 투자가 우선순위 경쟁을 합니다.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {[
          ['연간 한도', lim ? won(lim) : '미설정', '#0F3D73'], ['필수 투자 합계', won(t.mandatorySum), '#9a3412'], ['재량 가용액', lim ? won(t.discretionaryLimit) : '-', '#1e40af'],
          ['승인 누계', won(t.approvedSum), '#15803d'], ['신청 총액', won(t.requested), '#475569'], ['안건 수', String(t.count), '#475569'],
        ].map(([l, v, c]) => <div key={l} style={{ ...card, padding: 10 }}><div style={{ fontSize: 11, color: '#64748b' }}>{l}</div><b style={{ fontSize: 18, color: c as string }}>{v}</b></div>)}
      </div>
      {lim > 0 && (
        <div style={{ height: 14, background: '#e5e7eb', borderRadius: 7, overflow: 'hidden', display: 'flex' }} title={`필수 ${won(t.mandatorySum)} / 승인 ${won(t.approvedSum)} / 한도 ${won(lim)}`}>
          <div style={{ width: `${Math.min(100, (t.mandatorySum / lim) * 100)}%`, background: '#f97316' }} />
          <div style={{ width: `${Math.min(100, Math.max(0, (t.approvedSum - t.mandatorySum) / lim) * 100)}%`, background: '#22c55e' }} />
        </div>
      )}
      {meta?.me?.canDecide && b && (
        <details style={card}><summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>연간 한도·필수 예비·우선순위 가중치 설정 (임원)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 8 }}>
            <div><div style={lbl}>연간 투자 한도(원)</div><input style={inp} type="number" value={b.limitAmount} onChange={(e) => setB({ ...b, limitAmount: Number(e.target.value) })} /></div>
            <div><div style={lbl}>필수 투자 선배정(원)</div><input style={inp} type="number" value={b.mandatoryReserve} onChange={(e) => setB({ ...b, mandatoryReserve: Number(e.target.value) })} /><div style={{ fontSize: 10, color: '#94a3b8' }}>실제 필수 합계가 더 크면 그 값을 씀</div></div>
            {[['financial', '재무'], ['risk', '리스크 감소'], ['strategic', '전략 적합'], ['feasibility', '실행 가능'], ['urgency', '시급성']].map(([k, l]) => (
              <div key={k}><div style={lbl}>가중치 · {l}</div><input style={inp} type="number" min={0} max={100} value={b.weights?.[k] ?? 0} onChange={(e) => setB({ ...b, weights: { ...b.weights, [k]: Number(e.target.value) } })} /></div>
            ))}
            <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>메모</div><input style={inp} value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}><span style={{ fontSize: 12, color: wsum === 100 ? '#15803d' : '#b45309' }}>가중치 합 {wsum}{wsum !== 100 ? ' (100 권장)' : ''}</span><span style={{ flex: 1 }} /><button className="btn btn-primary" disabled={saving} onClick={() => void saveBudget()}>{saving ? '저장 중…' : '저장'}</button></div>
        </details>
      )}
      <div style={{ overflowX: 'auto', ...card, padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8fafc', fontSize: 11, color: '#64748b' }}><th style={{ padding: 8 }}>순위</th><th style={{ textAlign: 'left', padding: 8 }}>안건</th><th>범주</th><th style={{ textAlign: 'right' }}>금액</th><th style={{ textAlign: 'right' }}>누적</th><th>점수</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {pf.mandatory.length > 0 && <tr><td colSpan={8} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, color: '#9a3412', background: '#fff7ed' }}>필수 투자 (법규·안전·환경 / 원청·신차) — 선배정, 순위 경쟁 없음</td></tr>}
            {pf.mandatory.map((p: any) => <Row key={p.id} p={p} />)}
            <tr><td colSpan={8} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, color: '#1e40af', background: '#eff6ff' }}>재량 투자 — 승인건 먼저, 그다음 우선순위 점수순. 누적이 재량 가용액을 넘으면 붉게 표시</td></tr>
            {pf.discretionary.map((p: any) => <Row key={p.id} p={p} />)}
            {!pf.mandatory.length && !pf.discretionary.length && <tr><td colSpan={8} style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>{year}년 안건이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── ④ 투자위원회 ─────────────────────────
function CommitteeTab({ meta, items, userId, reload }: { meta: Meta | null; items: Proposal[]; userId: string; reload: () => Promise<void> }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState<any>({ title: '', kind: 'QUARTERLY', scheduledAt: '', location: '', attendeeIds: [] as string[], proposalIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [dec, setDec] = useState<Record<string, { decision: string; note: string; approvedAmount: string }>>({});
  const [minutes, setMinutes] = useState('');
  const canDecide = !!meta?.me?.canDecide;
  async function load() { try { const r = await apiJson<{ items: Meeting[] }>(`/api/investments/meetings?userId=${encodeURIComponent(userId)}`); setMeetings(r.items || []); } catch (e: any) { toast(e?.message || '불러오기 실패', 'error'); } }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);
  const candidates = items.filter((p) => ['SUBMITTED', 'REVIEWED', 'DEFERRED'].includes(p.status));
  const committee = (meta?.users || []).filter((u) => ['CEO', 'EXEC'].includes(u.role));
  function startCreate(kind: string) {
    const y = new Date().getFullYear();
    setF({ title: kind === 'ANNUAL' ? `${y + 1}년 설비투자 포트폴리오 연간 검토` : kind === 'FAST_TRACK' ? '긴급 투자 심의' : `${y}년 ${Math.floor(new Date().getMonth() / 3) + 1}분기 투자 재조정`, kind, scheduledAt: '', location: '', attendeeIds: committee.map((u) => u.id), proposalIds: kind === 'FAST_TRACK' ? candidates.filter((p) => p.fastTrack).map((p) => p.id) : candidates.map((p) => p.id) });
    setCreating(true);
  }
  async function create() {
    if (!f.title.trim() || !f.scheduledAt) { toast('제목과 일시를 입력하세요', 'error'); return; }
    setSaving(true);
    try { await apiJson(`/api/investments/meetings`, { method: 'POST', body: JSON.stringify({ userId, ...f, scheduledAt: new Date(f.scheduledAt + ':00+09:00').toISOString() }) }); toast('회의를 소집했습니다. 참석자·제안자에게 알림이 갔습니다.', 'success'); setCreating(false); await load(); await reload(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setSaving(false); }
  }
  function startDecide(m: Meeting) {
    setDeciding(m.id); setMinutes(m.minutes || '');
    const init: any = {}; for (const p of m.proposals || []) init[p.id] = { decision: p.decision || '', note: p.decisionNote || '', approvedAmount: p.approvedAmount ?? '' };
    setDec(init);
  }
  async function submitDecision(m: Meeting, finalize: boolean) {
    const decisions = Object.entries(dec).filter(([, v]) => v.decision).map(([proposalId, v]) => ({ proposalId, decision: v.decision, note: v.note, approvedAmount: v.approvedAmount === '' ? undefined : Number(v.approvedAmount) }));
    if (finalize && decisions.length < (m.proposals || []).filter((p: any) => p.status === 'ON_AGENDA').length) { if (!(await toastConfirm('결정하지 않은 안건이 있습니다. 그대로 회의를 종료할까요? (미결 안건은 상정 상태로 남습니다)'))) return; }
    setSaving(true);
    try { await apiJson(`/api/investments/meetings/${encodeURIComponent(m.id)}/decide`, { method: 'POST', body: JSON.stringify({ userId, minutes, decisions, finalize }) }); toast(finalize ? '회의 결과가 확정되었습니다. 제안자에게 알림이 갔습니다.' : '중간 저장', 'success'); if (finalize) setDeciding(null); await load(); await reload(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setSaving(false); }
  }
  async function cancel(m: Meeting) { if (!(await toastConfirm(`"${m.title}" 회의를 취소할까요? 안건은 검토 상태로 돌아갑니다.`))) return; try { await apiJson(`/api/investments/meetings/${encodeURIComponent(m.id)}/cancel`, { method: 'POST', body: JSON.stringify({ userId }) }); await load(); await reload(); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  async function renotify(m: Meeting) { try { await apiJson(`/api/investments/meetings/${encodeURIComponent(m.id)}/notify`, { method: 'POST', body: JSON.stringify({ userId }) }); toast('소집 알림을 다시 보냈습니다', 'success'); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  const KIND: Record<string, string> = { ANNUAL: '연간 전체 검토', QUARTERLY: '분기 재조정', FAST_TRACK: '긴급(패스트트랙)' };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13, color: '#64748b' }}>운영 원칙: <b>연 1회 포트폴리오 전체 검토 + 분기별 재조정</b>. 긴급 건은 패스트트랙으로 심의하고 사후에 포트폴리오에 반영합니다. 개별 안건은 "포트폴리오의 어느 자리를 차지하고 무엇이 밀려나는지"와 함께 심의합니다.</div>
      {canDecide && !creating && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => startCreate('QUARTERLY')}>📅 분기 재조정 회의 소집</button>
          <button className="btn" onClick={() => startCreate('ANNUAL')}>연간 전체 검토 소집</button>
          <button className="btn btn-outline" onClick={() => startCreate('FAST_TRACK')}>⚡ 긴급 심의 소집</button>
          <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>상정 가능 안건 {candidates.length}건 (접수·검토완료·보류)</span>
        </div>
      )}
      {creating && (
        <div style={{ ...card, border: '2px solid #0F3D73' }}>
          <b>회의 소집 — {KIND[f.kind]}</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>제목</div><input style={inp} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div><div style={lbl}>일시</div><input style={inp} type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></div>
            <div><div style={lbl}>장소</div><input style={inp} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="예: 본관 회의실 / Teams" /></div>
          </div>
          <div><div style={lbl}>참석자 (위원)</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(meta?.users || []).filter((u) => ['CEO', 'EXEC', 'MANAGER'].includes(u.role)).map((u) => { const on = f.attendeeIds.includes(u.id); return <button key={u.id} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 11 }} onClick={() => setF({ ...f, attendeeIds: on ? f.attendeeIds.filter((x: string) => x !== u.id) : [...f.attendeeIds, u.id] })}>{u.name}{u.orgName ? ` (${u.orgName})` : ''}</button>; })}
          </div></div>
          <div><div style={lbl}>안건 (체크된 안건이 상정됨 · 미검토 안건은 점수 없이 상정)</div><div style={{ display: 'grid', gap: 4 }}>
            {candidates.map((p) => { const on = f.proposalIds.includes(p.id); return (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 6px', background: on ? '#eff6ff' : '#fff', borderRadius: 6 }}>
                <input type="checkbox" checked={on} onChange={(e) => setF({ ...f, proposalIds: e.target.checked ? [...f.proposalIds, p.id] : f.proposalIds.filter((x: string) => x !== p.id) })} />
                <span style={{ flex: 1 }}>{p.title}</span><CatChip cat={p.category} meta={meta} /><span style={{ fontSize: 12 }}>{won(p.amount)}원</span><span style={{ fontSize: 12, color: '#0369a1' }}>{p.priorityScore != null ? `점수 ${p.priorityScore}` : '미검토'}</span>{p.fastTrack && <span style={{ color: '#b91c1c', fontSize: 11 }}>⚡</span>}
              </label>); })}
            {!candidates.length && <span style={{ fontSize: 12, color: '#94a3b8' }}>상정할 안건이 없습니다</span>}
          </div></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn btn-outline" onClick={() => setCreating(false)}>취소</button><button className="btn btn-primary" disabled={saving} onClick={() => void create()}>{saving ? '소집 중…' : '소집하고 알림 보내기'}</button></div>
        </div>
      )}
      {meetings.map((m) => {
        const isOpen = deciding === m.id;
        const attendees = (m.attendeeIds || []).map((id: string) => meta?.users?.find((u) => u.id === id)?.name || '').filter(Boolean);
        return (
          <div key={m.id} style={{ ...card, opacity: m.status === 'CANCELLED' ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ flex: 1 }}>{m.title}</b>
              <span style={{ fontSize: 11, color: '#7c3aed', background: '#f5f3ff', borderRadius: 999, padding: '2px 8px' }}>{KIND[m.kind] || m.kind}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: m.status === 'HELD' ? '#15803d' : m.status === 'CANCELLED' ? '#94a3b8' : '#1d4ed8' }}>{m.status === 'HELD' ? '종료' : m.status === 'CANCELLED' ? '취소' : '예정'}</span>
              <span style={{ fontSize: 12 }}>{dt(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>참석: {attendees.join(', ') || '-'} · 안건 {(m.proposals || []).length}건{m.notifiedAt ? ` · 알림 ${dt(m.notifiedAt)}` : ''}</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {(m.proposals || []).map((p: any) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap', padding: '4px 6px', background: '#f8fafc', borderRadius: 6 }}>
                  <span style={{ flex: 1, minWidth: 160 }}>{p.title} <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.proposerName}</span></span>
                  <CatChip cat={p.category} meta={meta} /><span style={{ fontSize: 12 }}>{won(p.amount)}원</span><span style={{ fontSize: 12, color: '#0369a1' }}>{p.priorityScore != null ? `점수 ${p.priorityScore}` : '미검토'}</span>
                  {isOpen && canDecide ? (
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {['APPROVED', 'DEFERRED', 'REJECTED'].map((k) => <button key={k} type="button" className={`btn btn-sm ${dec[p.id]?.decision === k ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 11 }} onClick={() => setDec({ ...dec, [p.id]: { ...(dec[p.id] || { note: '', approvedAmount: '' }), decision: k } })}>{meta?.statusKo?.[k]}</button>)}
                      {dec[p.id]?.decision === 'APPROVED' && <input style={{ ...inp, width: 130 }} type="number" placeholder={`승인금액 (${won(p.amount)})`} value={dec[p.id]?.approvedAmount ?? ''} onChange={(e) => setDec({ ...dec, [p.id]: { ...dec[p.id], approvedAmount: e.target.value } })} />}
                      <input style={{ ...inp, width: 220 }} placeholder="결정 사유 / 무엇이 밀려났는지" value={dec[p.id]?.note ?? ''} onChange={(e) => setDec({ ...dec, [p.id]: { ...(dec[p.id] || { decision: '', approvedAmount: '' }), note: e.target.value } })} />
                    </span>
                  ) : (
                    <><StatusChip st={p.status} meta={meta} />{p.decisionNote && <span style={{ fontSize: 11, color: '#64748b' }}>{p.decisionNote}</span>}{p.approvedAmount != null && p.status !== 'REJECTED' && <span style={{ fontSize: 11, color: '#15803d' }}>승인 {won(p.approvedAmount)}원</span>}</>
                  )}
                </div>
              ))}
            </div>
            {isOpen && canDecide && (
              <div style={{ display: 'grid', gap: 6 }}>
                <textarea style={{ ...inp, minHeight: 60 }} placeholder="회의 결과 요약 (포트폴리오 조정 내용, 다음 검토 시점 등)" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline" onClick={() => setDeciding(null)}>닫기</button>
                  <button className="btn" disabled={saving} onClick={() => void submitDecision(m, false)}>중간 저장</button>
                  <button className="btn btn-primary" disabled={saving} onClick={() => void submitDecision(m, true)}>{saving ? '처리 중…' : '결과 확정 (회의 종료)'}</button>
                </div>
              </div>
            )}
            {m.minutes && !isOpen && <div style={{ fontSize: 12, color: '#334155', background: '#f8fafc', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>📝 {m.minutes}</div>}
            {canDecide && m.status === 'PLANNED' && !isOpen && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={() => startDecide(m)}>심의 결과 입력</button>
                <button className="btn btn-sm btn-outline" onClick={() => void renotify(m)}>소집 알림 재발송</button>
                <button className="btn btn-sm btn-outline" style={{ color: '#dc2626' }} onClick={() => void cancel(m)}>회의 취소</button>
              </div>
            )}
          </div>
        );
      })}
      {!meetings.length && <div style={{ fontSize: 13, color: '#94a3b8' }}>소집된 회의가 없습니다.</div>}
    </div>
  );
}

// ───────────────────────── ⑤⑥ 실행·사후검증 ─────────────────────────
function ExecutionTab({ meta, items, userId, reload }: { meta: Meta | null; items: Proposal[]; userId: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const list = items.filter((p) => ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'AUDITED'].includes(p.status));
  const auditDue = list.filter((p) => p.status === 'COMPLETED' && p.auditDueAt && new Date(p.auditDueAt) <= new Date());
  function start(p: Proposal) {
    setOpen(p.id);
    setF({ status: p.status === 'APPROVED' ? 'IN_PROGRESS' : p.status === 'AUDITED' ? 'AUDIT' : p.status, executionStartAt: toLocalInput(p.executionStartAt).slice(0, 10), executionEndAt: toLocalInput(p.executionEndAt).slice(0, 10), actualAmount: p.actualAmount ?? '', executionNote: p.executionNote || '', actualBenefit: p.actualBenefit ?? '', auditNote: p.auditNote || '', mode: p.status === 'COMPLETED' ? 'AUDIT' : 'EXEC' });
  }
  async function save(p: Proposal) {
    setSaving(true);
    try {
      if (f.mode === 'AUDIT') await apiJson(`/api/investments/proposals/${encodeURIComponent(p.id)}/audit`, { method: 'POST', body: JSON.stringify({ userId, actualBenefit: f.actualBenefit, auditNote: f.auditNote }) });
      else await apiJson(`/api/investments/proposals/${encodeURIComponent(p.id)}/execution`, { method: 'POST', body: JSON.stringify({ userId, status: f.status, executionStartAt: f.executionStartAt ? new Date(f.executionStartAt + 'T00:00:00+09:00').toISOString() : undefined, executionEndAt: f.executionEndAt ? new Date(f.executionEndAt + 'T00:00:00+09:00').toISOString() : undefined, actualAmount: f.actualAmount, executionNote: f.executionNote }) });
      toast('저장되었습니다', 'success'); setOpen(null); await reload();
    } catch (e: any) { toast(e?.message || '저장 실패', 'error'); } finally { setSaving(false); }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, color: '#64748b' }}>승인된 안건의 실행을 추적하고, 완료 12개월 뒤 <b>승인 당시 제시한 효과가 실제로 나왔는지</b> 검증합니다. 이 기록이 있어야 다음 기안의 낙관적 추정이 줄고 우선순위 판단이 정확해집니다.</div>
      {auditDue.length > 0 && <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: 8, fontSize: 13, color: '#92400e' }}>🔔 사후 검증 기한 도래 {auditDue.length}건: {auditDue.map((p) => p.title).join(', ')}</div>}
      {list.map((p) => (
        <div key={p.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ flex: 1, minWidth: 200 }}>{p.title}</b><CatChip cat={p.category} meta={meta} /><StatusChip st={p.status} meta={meta} />
            <span style={{ fontSize: 12 }}>승인 {won(p.approvedAmount ?? p.amount)}원{p.actualAmount != null ? ` · 실집행 ${won(p.actualAmount)}원` : ''}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.proposerName} · {p.orgUnitName} · 결정 {d(p.decidedAt)}</span>
            {(p.proposerId === userId || meta?.me?.canReview) && p.status !== 'AUDITED' && <button className="btn btn-sm btn-primary" onClick={() => (open === p.id ? setOpen(null) : start(p))}>{open === p.id ? '닫기' : p.status === 'COMPLETED' ? '사후 검증 입력' : '실행 현황 입력'}</button>}
          </div>
          <div style={{ fontSize: 12, color: '#475569', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {p.executionStartAt && <span>착수 {d(p.executionStartAt)}</span>}{p.executionEndAt && <span>완료 {d(p.executionEndAt)}</span>}{p.auditDueAt && p.status !== 'AUDITED' && <span>검증 예정 {d(p.auditDueAt)}</span>}
            {p.executionNote && <span>{p.executionNote}</span>}
            {p.status === 'AUDITED' && <span style={{ color: '#065f46' }}>검증: 기대 {won(p.annualBenefit)}원/년 → 실제 {won(p.actualBenefit)}원/년{p.annualBenefit ? ` (${Math.round(((p.actualBenefit || 0) / p.annualBenefit) * 100)}%)` : ''} · {p.auditorName} {d(p.auditedAt)}{p.auditNote ? ` · ${p.auditNote}` : ''}</span>}
          </div>
          {open === p.id && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8, display: 'grid', gap: 8 }}>
              {f.mode === 'AUDIT' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  <div><div style={lbl}>실제 연간 효과(원) — 승인 시 기대 {won(p.annualBenefit)}원</div><input style={inp} type="number" value={f.actualBenefit} onChange={(e) => setF({ ...f, actualBenefit: e.target.value })} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>검증 의견 (차이 원인, 다음 기안에 반영할 점)</div><textarea style={{ ...inp, minHeight: 60 }} value={f.auditNote} onChange={(e) => setF({ ...f, auditNote: e.target.value })} /></div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  <div><div style={lbl}>상태</div><select style={inp} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="IN_PROGRESS">실행중</option><option value="COMPLETED">실행완료</option></select></div>
                  <div><div style={lbl}>착수일</div><input style={inp} type="date" value={f.executionStartAt} onChange={(e) => setF({ ...f, executionStartAt: e.target.value })} /></div>
                  <div><div style={lbl}>완료일</div><input style={inp} type="date" value={f.executionEndAt} onChange={(e) => setF({ ...f, executionEndAt: e.target.value })} /></div>
                  <div><div style={lbl}>실집행 금액(원)</div><input style={inp} type="number" value={f.actualAmount} onChange={(e) => setF({ ...f, actualAmount: e.target.value })} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>진행 메모</div><input style={inp} value={f.executionNote} onChange={(e) => setF({ ...f, executionNote: e.target.value })} /></div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={saving} onClick={() => void save(p)}>{saving ? '저장 중…' : '저장'}</button></div>
            </div>
          )}
        </div>
      ))}
      {!list.length && <div style={{ fontSize: 13, color: '#94a3b8' }}>승인된 안건이 없습니다.</div>}
    </div>
  );
}
