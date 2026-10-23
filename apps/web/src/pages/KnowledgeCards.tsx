import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';
import { KnowledgeCardView, type KCard } from '../components/KnowledgeCardView';

/**
 * 암묵지 카드 (5단계) — 검색·열람, 내가 확인할 AI 추출 카드, 직접 작성, 임원 추출 실행
 */
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff' };

export function KnowledgeCards() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [team, setTeam] = useState('');
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<{ items: KCard[]; myDrafts: number; isExec: boolean; teams: Array<{ id: string; name: string }> } | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [f, setF] = useState({ title: '', symptom: '', checks: '', action: '', tags: '' });

  async function load() {
    const p = new URLSearchParams({ userId }); if (q.trim()) p.set('q', q.trim()); if (status) p.set('status', status); if (team) p.set('orgUnitId', team); if (mine) p.set('mine', '1');
    try { setData(await apiJson(`/api/knowledge-cards?${p.toString()}`)); } catch (e: any) { toast(e?.message || '실패', 'error'); }
    try { setStats(await apiJson(`/api/knowledge-cards/stats?userId=${encodeURIComponent(userId)}`)); } catch {}
  }
  useEffect(() => { if (userId) void load(); /* eslint-disable-next-line */ }, [userId, status, team, mine]);

  async function extract() {
    if (!(await toastConfirm('최근 업무일지 25건·매뉴얼 5건에서 AI가 암묵지 카드를 추출합니다(1~2분). 추출된 카드는 원 작성자가 확인해야 공개됩니다. 실행할까요?'))) return;
    setBusy(true);
    try { const r = await apiJson<any>(`/api/knowledge-cards/extract`, { method: 'POST', body: JSON.stringify({ userId }) }); toast(r.skipped ? '이미 실행 중입니다' : `일지 ${r.worklogsScanned}·매뉴얼 ${r.manualsScanned} 검토 → 카드 ${r.created}장 (중복 ${r.duplicates}, 근거 부족 ${r.lowConfidence})`, 'success', 6000); await load(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }
  async function create() {
    if (!f.title.trim() || !f.action.trim()) return toast('제목과 조치는 필수입니다', 'error');
    setBusy(true);
    try { await apiJson(`/api/knowledge-cards`, { method: 'POST', body: JSON.stringify({ userId, title: f.title, symptom: f.symptom, checks: f.checks.split('\n').map((x) => x.trim()).filter(Boolean), action: f.action, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean) }) }); toast('카드를 등록했습니다', 'success'); setWriting(false); setF({ title: '', symptom: '', checks: '', action: '', tags: '' }); await load(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }
  function patch(c: KCard) { setData((d) => d ? { ...d, items: d.items.map((x) => (x.id === c.id ? { ...x, ...c, canEdit: x.canEdit } : x)).filter((x) => status || x.status !== 'ARCHIVED') } : d); }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>🧠 암묵지 카드</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>업무일지의 문제·예외 기록과 매뉴얼에서 AI가 <b>증상 → 확인 순서 → 조치</b>를 뽑아 카드로 만듭니다. 원 작성자가 "맞습니다"로 확인하면 같은 활동의 프로세스 화면과 검색에 나타납니다 — 사람 머릿속에만 있던 노하우가 회사 자산이 되는 길입니다.</div>
      </div>
      {stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {[['카드', stats.total], ['확인됨', stats.confirmed], ['확인 대기', stats.draft], ['미검토 일지', stats.pendingWorklogs]].map(([l, v]) => <div key={String(l)} style={{ ...card, padding: '8px 14px', minWidth: 90, textAlign: 'center' }}><div style={{ fontSize: 10, color: '#64748b' }}>{l}</div><div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div></div>)}
          <span style={{ flex: 1 }} />
          {data?.isExec && <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void extract()}>{busy ? '추출 중…' : '🤖 지금 추출 (일지 25·매뉴얼 5)'}</button>}
          <button className="btn btn-sm btn-primary" onClick={() => setWriting((v) => !v)}>+ 직접 쓰기</button>
        </div>
      )}
      {data && data.myDrafts > 0 && !mine && <div onClick={() => setMine(true)} style={{ ...card, background: '#fffbeb', borderColor: '#fcd34d', cursor: 'pointer', fontSize: 13 }}>✍️ 내 기록에서 뽑힌 카드 <b>{data.myDrafts}장</b>이 확인을 기다립니다 — 맞으면 "맞습니다", 틀리면 고치거나 버려 주세요 →</div>}
      {writing && (
        <div style={{ ...card, display: 'grid', gap: 6 }}>
          <b style={{ fontSize: 13 }}>직접 쓰기 — 다음에 같은 일이 생기면 누가 봐도 따라 할 수 있게</b>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목 (증상을 한 줄로, 예: 2호기 사출 후 런너 미절단 발생)" style={{ fontSize: 13, padding: 6 }} />
          <textarea rows={2} value={f.symptom} onChange={(e) => setF({ ...f, symptom: e.target.value })} placeholder="증상·상황: 언제, 어디서, 무엇이" style={{ fontSize: 13, padding: 6 }} />
          <textarea rows={3} value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} placeholder={'확인 순서 (한 줄에 하나)\n1. 절단 지그 마모 확인\n2. 금형 온도 확인'} style={{ fontSize: 13, padding: 6 }} />
          <textarea rows={2} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="조치: 어떻게 해결했는지" style={{ fontSize: 13, padding: 6 }} />
          <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="태그 (쉼표로: 설비, 차종, 공정, 고객사)" style={{ fontSize: 12, padding: 6 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><button className="btn btn-sm btn-outline" onClick={() => setWriting(false)}>취소</button><button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void create()}>등록</button></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} placeholder="검색: 설비·차종·증상·조치 (예: 런너, 가스, 금형 세척)" style={{ flex: 1, minWidth: 220, fontSize: 13, padding: 8 }} />
        <button className="btn btn-sm btn-outline" onClick={() => void load()}>검색</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontSize: 13 }}><option value="">확인됨+대기</option><option value="CONFIRMED">확인됨</option><option value="DRAFT">확인 대기</option><option value="ARCHIVED">보관</option></select>
        <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ fontSize: 13 }}><option value="">전체 팀</option>{(data?.teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap', flexDirection: 'row' }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ margin: 0, width: 'auto' }} /><span>내 카드만</span></label>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {(data?.items || []).map((c) => <KnowledgeCardView key={c.id} card={c} userId={userId} onChanged={patch} />)}
        {data && !data.items.length && <div style={{ ...card, color: '#94a3b8', textAlign: 'center' }}>카드가 없습니다{data.isExec ? ' — "지금 추출"로 최근 업무일지에서 뽑아 보세요' : ''}</div>}
      </div>
    </div>
  );
}
