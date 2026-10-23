import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';

/**
 * 어젠다 클레임 (4단계)
 *  - 대표: 한 문장 → AI 항목 초안 + 되묻는 질문 → 답 → 재정리 → 항목 편집 → 공개 → 클레임 승인/반려
 *  - 팀장: 항목을 자기 팀 KR(지표·목표치·근거)로 클레임 (AI 제안 가능)
 *  - 클레임 지도(항목 × 팀): 승인=초록, 제안=파랑, 없음=회색, 아무도 안 건 항목=붉은 행
 */
type Claim = { id: string; orgUnitId: string; teamName: string; claimedById: string; claimedByName: string; title: string; metric: string; unit: string; target: number; direction?: string; rationale?: string; status: string; keyResultId?: string; decisionNote?: string; decidedByName?: string };
type Item = { id: string; order: number; title: string; description?: string; weight: number; status: string; krDraft?: { metric: string; unit: string; target: number; direction: string; rationale: string; teams: string[] }; claims: Claim[] };
type Agenda = { id: string; year: number; statement: string; status: string; summary?: string; aiQuestions?: Array<{ no: number; text: string }>; aiAnswers?: Array<{ no: number; text: string }>; items: Item[]; teams: Array<{ id: string; name: string; managerName: string }>; myTeams: string[]; isCEO: boolean; canClaim: boolean; coverage: { totalWeight: number; coveredWeight: number; pct: number }; publishedAt?: string };
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff' };
const ITEM_COLOR: Record<string, string> = { OPEN: '#b91c1c', CLAIMED: '#1d4ed8', APPROVED: '#15803d' };
const ITEM_LABEL: Record<string, string> = { OPEN: '미클레임', CLAIMED: '제안 있음', APPROVED: '승인됨' };

function ClaimForm({ item, agenda, userId, onDone }: { item: Item; agenda: Agenda; userId: string; onDone: (a: Agenda) => void }) {
  const myTeams = agenda.teams.filter((t) => agenda.myTeams.includes(t.id));
  const [orgUnitId, setOrgUnitId] = useState(myTeams[0]?.id || '');
  const mineExisting = item.claims.find((c) => c.orgUnitId === orgUnitId && c.status !== 'APPROVED');
  const d = item.krDraft;
  const [f, setF] = useState({ title: mineExisting?.title || item.title, metric: mineExisting?.metric || d?.metric || '', unit: mineExisting?.unit || d?.unit || '', target: String(mineExisting?.target ?? d?.target ?? ''), direction: mineExisting?.direction || d?.direction || 'AT_LEAST', rationale: mineExisting?.rationale || '' });
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function suggest() {
    setBusy('ai');
    try { const r = await apiJson<any>(`/api/agenda/items/${item.id}/suggest`, { method: 'POST', body: JSON.stringify({ userId, orgUnitId }) }); setF({ title: r.title, metric: r.metric, unit: r.unit, target: String(r.target), direction: r.direction, rationale: r.rationale }); toast('AI 제안을 채웠습니다 — 검토 후 수정하세요', 'success'); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(null); }
  }
  async function submit() {
    if (!f.title.trim() || !f.unit.trim() || f.target === '' || Number.isNaN(Number(f.target))) return toast('KR 제목·단위·목표치를 채우세요', 'error');
    setBusy('save');
    try { const a = await apiJson<Agenda>(`/api/agenda/items/${item.id}/claim`, { method: 'POST', body: JSON.stringify({ userId, orgUnitId, ...f, target: Number(f.target) }) }); toast('클레임했습니다. 대표 승인을 기다립니다.', 'success'); onDone(a); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(null); }
  }
  return (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>🙋 우리 팀이 맡겠습니다</b>
        {myTeams.length > 1 && <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} style={{ fontSize: 13 }}>{myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
        {myTeams.length === 1 && <span style={{ fontSize: 12, color: '#1e3a8a' }}>{myTeams[0].name}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => void suggest()}>{busy === 'ai' ? 'AI 제안 중…' : '🤖 AI 제안 받기'}</button>
      </div>
      <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="KR 제목 (예: 사출 불량률 0.6% 이하 유지)" style={{ fontSize: 13, padding: 6 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6 }}>
        <input value={f.metric} onChange={(e) => set('metric', e.target.value)} placeholder="산식 (예: 불량수량/투입수량×100)" style={{ fontSize: 13, padding: 6 }} />
        <input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="단위 (%·건·시간)" style={{ fontSize: 13, padding: 6 }} />
        <input type="number" value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="목표치" style={{ fontSize: 13, padding: 6 }} />
        <select value={f.direction} onChange={(e) => set('direction', e.target.value)} style={{ fontSize: 13 }}><option value="AT_LEAST">이상이면 달성</option><option value="AT_MOST">이하면 달성</option></select>
      </div>
      <textarea rows={3} value={f.rationale} onChange={(e) => set('rationale', e.target.value)} placeholder="왜 우리 팀이 맡아야 하는지, 왜 이 목표치인지 (근거 데이터·현장 상황)" style={{ fontSize: 13, padding: 6 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void submit()}>{mineExisting ? '클레임 수정' : '클레임 제출'}</button></div>
    </div>
  );
}

function ItemCard({ item, agenda, userId, onChanged }: { item: Item; agenda: Agenda; userId: string; onChanged: (a: Agenda) => void }) {
  const [claiming, setClaiming] = useState(false);
  const [edit, setEdit] = useState(false);
  const [e, setE] = useState({ title: item.title, description: item.description || '', weight: String(item.weight) });
  const [note, setNote] = useState('');
  const canEdit = agenda.isCEO && agenda.status === 'DRAFT';
  async function saveItem() {
    try { onChanged(await apiJson<Agenda>(`/api/agenda/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ userId, title: e.title, description: e.description, weight: Number(e.weight) }) })); setEdit(false); } catch (x: any) { toast(x?.message || '실패', 'error'); }
  }
  async function del() {
    if (!(await toastConfirm('이 항목을 삭제할까요?'))) return;
    try { onChanged(await apiJson<Agenda>(`/api/agenda/items/${item.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' })); } catch (x: any) { toast(x?.message || '실패', 'error'); }
  }
  async function decide(c: Claim, kind: 'approve' | 'reject') {
    if (!(await toastConfirm(kind === 'approve' ? `${c.teamName}의 클레임을 승인하고 KR을 만들까요?\n"${c.title}" 목표 ${c.target}${c.unit}` : `${c.teamName}의 클레임을 반려할까요?`))) return;
    try { onChanged(await apiJson<Agenda>(`/api/agenda/claims/${c.id}/${kind}`, { method: 'POST', body: JSON.stringify({ userId, note }) })); toast(kind === 'approve' ? 'KR이 만들어졌습니다 (팀 KPI 조회에서 확인)' : '반려했습니다', 'success'); } catch (x: any) { toast(x?.message || '실패', 'error'); }
  }
  async function withdraw(c: Claim) {
    if (!(await toastConfirm('클레임을 철회할까요?'))) return;
    try { onChanged(await apiJson<Agenda>(`/api/agenda/claims/${c.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' })); } catch (x: any) { toast(x?.message || '실패', 'error'); }
  }
  const color = ITEM_COLOR[item.status] || '#64748b';
  return (
    <div style={{ ...card, borderLeft: `5px solid ${color}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        {edit ? <input value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 200 }} /> : <b style={{ fontSize: 14 }}>{item.order + 1}. {item.title}</b>}
        <span style={{ fontSize: 11, color: '#64748b' }}>가중치 {edit ? <input type="number" value={e.weight} onChange={(x) => setE({ ...e, weight: x.target.value })} style={{ width: 50, fontSize: 11 }} /> : item.weight}</span>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, color, border: `1px solid ${color}`, fontWeight: 700 }}>{ITEM_LABEL[item.status] || item.status}</span>
        <span style={{ flex: 1 }} />
        {canEdit && !edit && <><button className="btn btn-sm btn-outline" onClick={() => setEdit(true)}>수정</button><button className="btn btn-sm btn-outline" onClick={() => void del()}>삭제</button></>}
        {edit && <><button className="btn btn-sm btn-primary" onClick={() => void saveItem()}>저장</button><button className="btn btn-sm btn-outline" onClick={() => setEdit(false)}>취소</button></>}
        {agenda.canClaim && !claiming && <button className="btn btn-sm btn-primary" onClick={() => setClaiming(true)}>🙋 클레임</button>}
      </div>
      {edit ? <textarea rows={3} value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} style={{ width: '100%', fontSize: 13, marginTop: 6, boxSizing: 'border-box' }} /> : item.description && <div style={{ fontSize: 13, color: '#475569', marginTop: 4, whiteSpace: 'pre-wrap' }}>{item.description}</div>}
      {item.krDraft && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, background: '#f8fafc', borderRadius: 6, padding: 8 }}>
          <b>AI KR 초안</b> · {item.krDraft.metric || '-'} · 목표 {item.krDraft.target}{item.krDraft.unit} ({item.krDraft.direction === 'AT_MOST' ? '이하' : '이상'}){item.krDraft.teams?.length ? ` · 권장 팀: ${item.krDraft.teams.join(', ')}` : ''}
          {item.krDraft.rationale && <div style={{ marginTop: 2 }}>{item.krDraft.rationale}</div>}
        </div>
      )}
      {claiming && <div style={{ marginTop: 8 }}><ClaimForm item={item} agenda={agenda} userId={userId} onDone={(a) => { setClaiming(false); onChanged(a); }} /><div style={{ textAlign: 'right', marginTop: 4 }}><button className="btn btn-sm btn-outline" onClick={() => setClaiming(false)}>닫기</button></div></div>}
      {item.claims.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {item.claims.map((c) => {
            const cc = c.status === 'APPROVED' ? '#15803d' : c.status === 'REJECTED' ? '#94a3b8' : '#1d4ed8';
            return (
              <div key={c.id} style={{ border: `1px solid ${cc}33`, background: c.status === 'APPROVED' ? '#f0fdf4' : c.status === 'REJECTED' ? '#f8fafc' : '#eff6ff', borderRadius: 8, padding: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ color: cc }}>{c.teamName}</b><span style={{ fontSize: 11, color: '#64748b' }}>{c.claimedByName}</span>
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 999, background: '#fff', color: cc, border: `1px solid ${cc}` }}>{c.status === 'APPROVED' ? '승인 · KR 생성됨' : c.status === 'REJECTED' ? '반려' : '제안'}</span>
                  <span style={{ flex: 1 }} />
                  {agenda.isCEO && c.status === 'PROPOSED' && <><input value={note} onChange={(x) => setNote(x.target.value)} placeholder="메모(선택)" style={{ fontSize: 12, padding: 3, width: 140 }} /><button className="btn btn-sm btn-primary" onClick={() => void decide(c, 'approve')}>승인</button><button className="btn btn-sm btn-outline" onClick={() => void decide(c, 'reject')}>반려</button></>}
                  {c.status === 'PROPOSED' && (c.claimedById === userId || agenda.isCEO) && <button className="btn btn-sm btn-outline" onClick={() => void withdraw(c)}>철회</button>}
                </div>
                <div style={{ marginTop: 4 }}><b>{c.title}</b> · {c.metric || '-'} · 목표 <b>{c.target}{c.unit}</b> ({c.direction === 'AT_MOST' ? '이하' : '이상'})</div>
                {c.rationale && <div style={{ fontSize: 12, color: '#475569', marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.rationale}</div>}
                {c.decisionNote && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>대표 메모: {c.decisionNote}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClaimMap({ a }: { a: Agenda }) {
  return (
    <div style={{ ...card, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><b style={{ fontSize: 13 }}>클레임 지도</b><span style={{ fontSize: 11, color: '#64748b' }}>행=항목, 열=팀 · 🟩 승인 🟦 제안 · 붉은 항목=아무도 안 걸었음</span><span style={{ flex: 1 }} /><span style={{ fontSize: 12, color: a.coverage.pct >= 80 ? '#15803d' : '#b45309', fontWeight: 700 }}>가중치 커버 {a.coverage.pct}%</span></div>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, marginTop: 8, minWidth: 600 }}>
        <thead><tr><th style={{ textAlign: 'left', padding: 4, position: 'sticky', left: 0, background: '#fff' }}>항목</th>{a.teams.map((t) => <th key={t.id} style={{ padding: 4, fontWeight: 600, color: '#475569', writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap' }}>{t.name}</th>)}</tr></thead>
        <tbody>
          {a.items.map((it) => (
            <tr key={it.id} style={{ borderTop: '1px solid #f1f5f9', background: it.status === 'OPEN' ? '#fef2f2' : undefined }}>
              <td style={{ padding: 4, fontWeight: 600, color: it.status === 'OPEN' ? '#b91c1c' : '#0f172a', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: it.status === 'OPEN' ? '#fef2f2' : '#fff' }}>{it.title} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({it.weight})</span></td>
              {a.teams.map((t) => { const c = it.claims.find((x) => x.orgUnitId === t.id && x.status !== 'REJECTED'); return <td key={t.id} style={{ padding: 4, textAlign: 'center' }} title={c ? `${c.title} ${c.target}${c.unit}` : ''}>{c ? (c.status === 'APPROVED' ? '🟩' : '🟦') : <span style={{ color: '#e2e8f0' }}>·</span>}</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AgendaPage() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const { id } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState<any>(null);
  const [a, setA] = useState<Agenda | null>(null);
  const [statement, setStatement] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0)));
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function loadList() { try { setList(await apiJson(`/api/agenda?userId=${encodeURIComponent(userId)}`)); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  async function loadOne(aid: string) { try { const r = await apiJson<Agenda>(`/api/agenda/${aid}?userId=${encodeURIComponent(userId)}`); setA(r); setAnswers(Object.fromEntries((r.aiAnswers || []).map((x) => [x.no, x.text]))); } catch (e: any) { toast(e?.message || '실패', 'error'); nav('/okr/agenda'); } }
  useEffect(() => { if (!userId) return; if (id) void loadOne(id); else { setA(null); void loadList(); } /* eslint-disable-next-line */ }, [userId, id]);

  async function draft() {
    if (statement.trim().length < 10) return toast('목표 문장을 10자 이상 적어 주세요', 'error');
    setBusy('draft');
    try { const r = await apiJson<Agenda>(`/api/agenda/draft`, { method: 'POST', body: JSON.stringify({ userId, statement, year: Number(year) }) }); toast('AI가 항목 초안과 질문을 만들었습니다', 'success'); nav(`/okr/agenda/${r.id}`); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(null); }
  }
  async function refine() {
    if (!a) return;
    setBusy('refine');
    try { setA(await apiJson<Agenda>(`/api/agenda/${a.id}/refine`, { method: 'POST', body: JSON.stringify({ userId, answers: (a.aiQuestions || []).map((q) => ({ no: q.no, text: answers[q.no] || '' })) }) })); toast('답을 반영해 항목을 다시 정리했습니다', 'success'); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(null); }
  }
  async function publish() {
    if (!a) return;
    if (!(await toastConfirm('공개하면 팀장 전원에게 알림이 가고 클레임을 받기 시작합니다. 항목은 더 이상 수정할 수 없습니다. 공개할까요?'))) return;
    try { setA(await apiJson<Agenda>(`/api/agenda/${a.id}/publish`, { method: 'POST', body: JSON.stringify({ userId }) })); toast('공개했습니다', 'success'); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }
  async function close() {
    if (!a || !(await toastConfirm('클레임 접수를 마감할까요?'))) return;
    try { setA(await apiJson<Agenda>(`/api/agenda/${a.id}/close`, { method: 'POST', body: JSON.stringify({ userId }) })); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }
  async function addItem() { if (!a) return; try { setA(await apiJson<Agenda>(`/api/agenda/${a.id}/items`, { method: 'POST', body: JSON.stringify({ userId, title: '새 항목' }) })); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  async function removeDraft() { if (!a || !(await toastConfirm('이 초안을 삭제할까요?'))) return; try { await apiJson(`/api/agenda/${a.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }); nav('/okr/agenda'); } catch (e: any) { toast(e?.message || '실패', 'error'); } }

  if (!id) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div><h2 style={{ margin: '0 0 4px' }}>경영 어젠다 · 클레임</h2><div style={{ fontSize: 13, color: '#64748b' }}>대표가 올해 목표를 <b>한 문장</b>으로 쓰면 AI가 항목으로 쪼개고, 팀장이 "우리 팀이 맡겠다"고 지표·목표치를 걸어 클레임합니다. 대표가 승인하면 그대로 팀 KPI(KR)가 됩니다. 아무도 안 건 항목은 붉게 남습니다.</div></div>
        {list?.isCEO && (
          <div style={card}>
            <b style={{ fontSize: 13 }}>새 어젠다</b>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 80, fontSize: 13, padding: 8 }} />
              <textarea rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder='예: "2027년에는 불량·납기 사고 없이 매출 20% 늘리고, 신규 차종 2건을 양산 안착시킨다"' style={{ flex: 1, minWidth: 260, fontSize: 13, padding: 8 }} />
              <button className="btn btn-primary" disabled={busy === 'draft'} onClick={() => void draft()}>{busy === 'draft' ? 'AI 초안 작성 중…' : 'AI로 항목 뽑기'}</button>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {(list?.items || []).map((x: any) => (
            <div key={x.id} style={{ ...card, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} onClick={() => nav(`/okr/agenda/${x.id}`)}>
              <b style={{ fontSize: 14 }}>{x.year}</b>
              <span style={{ flex: 1, fontSize: 13 }}>{x.statement}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: x.status === 'OPEN' ? '#eff6ff' : x.status === 'CLOSED' ? '#f8fafc' : '#fffbeb', color: x.status === 'OPEN' ? '#1d4ed8' : x.status === 'CLOSED' ? '#64748b' : '#b45309', fontWeight: 700 }}>{x.status === 'OPEN' ? '클레임 접수 중' : x.status === 'CLOSED' ? '마감' : '초안'}</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>항목 {x.itemCount} · <span style={{ color: '#15803d' }}>승인 {x.approved}</span> · <span style={{ color: '#1d4ed8' }}>제안 {x.claimed}</span> · <span style={{ color: '#b91c1c' }}>미클레임 {x.open}</span></span>
            </div>
          ))}
          {list && !list.items.length && <div style={{ ...card, color: '#94a3b8', textAlign: 'center' }}>아직 어젠다가 없습니다{list.isCEO ? ' — 위에 한 문장을 적어 시작하세요' : ''}</div>}
        </div>
      </div>
    );
  }

  if (!a) return <div style={{ padding: 24, color: '#94a3b8' }}>불러오는 중…</div>;
  const weightSum = a.items.reduce((s, i) => s + (i.weight || 0), 0);
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-outline" onClick={() => nav('/okr/agenda')}>← 목록</button>
        <h2 style={{ margin: 0, fontSize: 18 }}>{a.year} 경영 어젠다</h2>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: a.status === 'OPEN' ? '#eff6ff' : a.status === 'CLOSED' ? '#f8fafc' : '#fffbeb', color: a.status === 'OPEN' ? '#1d4ed8' : a.status === 'CLOSED' ? '#64748b' : '#b45309', fontWeight: 700 }}>{a.status === 'OPEN' ? '클레임 접수 중' : a.status === 'CLOSED' ? '마감' : '초안 (대표만 봄)'}</span>
        <span style={{ flex: 1 }} />
        {a.isCEO && a.status === 'DRAFT' && <><button className="btn btn-sm btn-outline" onClick={() => void addItem()}>+ 항목</button><button className="btn btn-sm btn-outline" onClick={() => void removeDraft()}>초안 삭제</button><button className="btn btn-sm btn-primary" onClick={() => void publish()}>공개 (클레임 받기)</button></>}
        {a.isCEO && a.status === 'OPEN' && <button className="btn btn-sm btn-outline" onClick={() => void close()}>접수 마감</button>}
      </div>
      <div style={{ ...card, background: '#0F3D73', color: '#fff', border: 'none' }}>
        <div style={{ fontSize: 11, opacity: 0.8 }}>대표의 한 문장</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{a.statement}</div>
        {a.summary && <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6 }}>{a.summary}</div>}
      </div>
      {a.isCEO && a.status === 'DRAFT' && (a.aiQuestions || []).length > 0 && (
        <div style={{ ...card, background: '#fffbeb', borderColor: '#fcd34d' }}>
          <b style={{ fontSize: 13 }}>🤖 AI가 되묻습니다 — 답하면 항목을 다시 정리합니다</b>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {(a.aiQuestions || []).map((q) => <div key={q.no}><div style={{ fontSize: 13, marginBottom: 3 }}>Q{q.no}. {q.text}</div><textarea rows={2} value={answers[q.no] || ''} onChange={(e) => setAnswers((x) => ({ ...x, [q.no]: e.target.value }))} style={{ width: '100%', fontSize: 13, padding: 6, boxSizing: 'border-box' }} /></div>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button className="btn btn-sm btn-primary" disabled={busy === 'refine'} onClick={() => void refine()}>{busy === 'refine' ? '재정리 중…' : '답 반영해 재정리'}</button></div>
        </div>
      )}
      {a.status !== 'DRAFT' && <ClaimMap a={a} />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><b style={{ fontSize: 13 }}>항목 {a.items.length}개</b><span style={{ fontSize: 11, color: weightSum === 100 ? '#15803d' : '#b45309' }}>가중치 합 {weightSum}{weightSum !== 100 ? ' (100 권장)' : ''}</span>{a.canClaim && <span style={{ fontSize: 11, color: '#1d4ed8' }}>· 항목의 "클레임" 버튼으로 우리 팀 KR을 걸 수 있습니다</span>}</div>
      <div style={{ display: 'grid', gap: 10 }}>{a.items.map((it) => <ItemCard key={it.id} item={it} agenda={a} userId={userId} onChanged={setA} />)}</div>
    </div>
  );
}
