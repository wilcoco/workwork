import { useEffect, useMemo, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { OneDriveFilePicker } from '../components/OneDriveFilePicker';

type Team = { id: string; name: string; visibility: 'PUBLIC' | 'PRIVATE' };
type Attachment = { url?: string; name?: string };
type Node = {
  id: string; orgUnitId: string; parentId: string | null; title: string; order: number;
  milestoneDate?: string | null; status?: string | null; prepNote?: string | null; resultNote?: string | null;
  attachments?: Attachment[] | null; keyResultId?: string | null; objectiveId?: string | null;
};
type LinkOpt = { kind: 'KR' | 'OBJ'; id: string; title: string };

const resolveUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : apiUrl(u || ''));
function todayPassed(d?: string | null) { return !!d && new Date(d) < new Date(); }

export function TeamTasks() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgUnitId, setOrgUnitId] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<LinkOpt[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [aiQ, setAiQ] = useState('');
  const [aiAns, setAiAns] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const curTeam = useMemo(() => teams.find((t) => t.id === orgUnitId), [teams, orgUnitId]);

  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const [acc, me] = await Promise.all([
          apiJson<{ items: Team[]; isAdmin: boolean }>(`/api/team-tasks/accessible-teams?userId=${encodeURIComponent(userId)}`),
          apiJson<{ orgUnitId?: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`),
        ]);
        setTeams(acc.items || []); setIsAdmin(!!acc.isAdmin);
        const own = me.orgUnitId && (acc.items || []).some((t) => t.id === me.orgUnitId) ? me.orgUnitId : (acc.items?.[0]?.id || '');
        if (!orgUnitId && own) setOrgUnitId(own);
      } catch { /* */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function setVisibility(v: 'PUBLIC' | 'PRIVATE') {
    if (!orgUnitId) return;
    try {
      await apiJson(`/api/team-tasks/visibility`, { method: 'PUT', body: JSON.stringify({ orgUnitId, visibility: v, actorId: userId }) });
      setTeams((ts) => ts.map((t) => (t.id === orgUnitId ? { ...t, visibility: v } : t)));
    } catch (e: any) { alert(e?.message || '변경 실패'); }
  }

  async function load() {
    if (!orgUnitId) { setNodes([]); return; }
    setLoading(true);
    try {
      const r = await apiJson<{ items: Node[] }>(`/api/team-tasks?orgUnitId=${encodeURIComponent(orgUnitId)}&userId=${encodeURIComponent(userId)}`);
      setNodes(r.items || []);
      // KPI/OKR 연동 옵션
      const ok = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(orgUnitId)}`);
      const opts: LinkOpt[] = [];
      for (const o of (ok.items || [])) {
        opts.push({ kind: 'OBJ', id: o.id, title: o.title });
        for (const kr of (o.keyResults || [])) opts.push({ kind: 'KR', id: kr.id, title: kr.title });
      }
      setLinks(opts);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgUnitId]);

  const tree = useMemo(() => {
    const byParent: Record<string, Node[]> = {};
    for (const n of nodes) { const k = n.parentId || '__root'; (byParent[k] ||= []).push(n); }
    return byParent;
  }, [nodes]);

  const [quickText, setQuickText] = useState<Record<string, string>>({});
  const setQ = (pid: string, v: string) => setQuickText((m) => ({ ...m, [pid]: v }));
  async function quickAdd(pid: string) {
    const title = (quickText[pid] || '').trim();
    if (!title || !orgUnitId) return;
    try {
      await apiJson(`/api/team-tasks`, { method: 'POST', body: JSON.stringify({ orgUnitId, parentId: pid === '__root' ? null : pid, actorId: userId, title }) });
      setQ(pid, '');
      await load();
    } catch (e: any) { alert(e?.message || '추가 실패'); }
  }

  function openCreate(parentId: string | null) {
    setEditing({ id: null, parentId, title: '', milestoneDate: '', status: '', prepNote: '', resultNote: '', attachments: [], link: '' });
  }
  function openEdit(n: Node) {
    const link = n.keyResultId ? `KR:${n.keyResultId}` : n.objectiveId ? `OBJ:${n.objectiveId}` : '';
    setEditing({ id: n.id, parentId: n.parentId, title: n.title, milestoneDate: n.milestoneDate ? String(n.milestoneDate).slice(0, 10) : '', status: n.status || '', prepNote: n.prepNote || '', resultNote: n.resultNote || '', attachments: n.attachments || [], link });
  }

  async function saveEditing() {
    const e = editing; if (!e) return;
    if (!String(e.title || '').trim()) { alert('제목을 입력하세요'); return; }
    const body: any = {
      orgUnitId, parentId: e.parentId, actorId: userId,
      title: e.title, milestoneDate: e.milestoneDate || null, status: e.status || null,
      prepNote: e.prepNote, resultNote: e.resultNote, attachments: e.attachments,
      keyResultId: e.link.startsWith('KR:') ? e.link.slice(3) : null,
      objectiveId: e.link.startsWith('OBJ:') ? e.link.slice(4) : null,
    };
    try {
      if (e.id) await apiJson(`/api/team-tasks/${e.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiJson(`/api/team-tasks`, { method: 'POST', body: JSON.stringify(body) });
      setEditing(null); await load();
    } catch (err: any) { alert(err?.message || '저장 실패'); }
  }
  async function removeNode(n: Node) {
    if (!confirm(`'${n.title}'${(tree[n.id]?.length ? ' 및 하위 항목 전체를' : '를')} 삭제할까요?`)) return;
    try { await apiJson(`/api/team-tasks/${n.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }); await load(); } catch (e: any) { alert(e?.message || '삭제 실패'); }
  }
  const [showPicker, setShowPicker] = useState(false);

  async function askAi() {
    if (!aiQ.trim() || !orgUnitId) return;
    setAiBusy(true); setAiAns('');
    try { const r = await apiJson<{ answer: string }>(`/api/team-tasks/ask`, { method: 'POST', body: JSON.stringify({ orgUnitId, question: aiQ.trim(), actorId: userId }) }); setAiAns(r.answer || ''); }
    catch (e: any) { setAiAns(`오류: ${e?.message || '질의 실패'}`); }
    finally { setAiBusy(false); }
  }

  const linkLabel = (n: Node) => {
    if (n.keyResultId) return `KPI: ${links.find((l) => l.kind === 'KR' && l.id === n.keyResultId)?.title || ''}`;
    if (n.objectiveId) return `OKR: ${links.find((l) => l.kind === 'OBJ' && l.id === n.objectiveId)?.title || ''}`;
    return '';
  };

  function QuickAdd({ pid, placeholder }: { pid: string; placeholder: string }) {
    return (
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input
          value={quickText[pid] || ''}
          onChange={(e) => setQ(pid, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void quickAdd(pid); }}
          placeholder={placeholder}
          style={{ flex: 1, padding: '5px 8px', border: '1px dashed #cbd5e1', borderRadius: 6, fontSize: 12, background: 'transparent' }}
        />
        {(quickText[pid] || '').trim() && <button type="button" className="btn btn-sm" onClick={() => void quickAdd(pid)}>추가</button>}
      </div>
    );
  }

  // 카드형 노드(칸반 카드) — 마일스톤 상태색
  function renderCard(n: Node, depth: number): any {
    const kids = tree[n.id] || [];
    const passed = todayPassed(n.milestoneDate);
    const sc = n.status === 'DONE' ? { c: '#16a34a', label: '완료' } : passed ? { c: '#dc2626', label: '경과' } : n.milestoneDate ? { c: '#2563eb', label: '예정' } : { c: '#cbd5e1', label: '' };
    return (
      <div key={n.id} style={{ marginLeft: depth ? 8 : 0, marginTop: 6 }}>
        <div style={{ borderLeft: `3px solid ${sc.c}`, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 9px', boxShadow: '0 1px 2px rgba(16,24,40,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</span>
            {n.milestoneDate && (
              <span style={{ fontSize: 10, background: sc.c, color: '#fff', borderRadius: 999, padding: '1px 7px' }}>🚩 {String(n.milestoneDate).slice(5, 10)} {sc.label}</span>
            )}
            {linkLabel(n) && <span style={{ fontSize: 10, background: '#eef2ff', color: '#3730a3', borderRadius: 999, padding: '1px 7px' }}>🔗</span>}
            {(n.attachments?.length || 0) > 0 && <span style={{ fontSize: 11, color: '#64748b' }}>📎{n.attachments!.length}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 6px' }} onClick={() => openEdit(n)}>수정</button>
              <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 6px', color: '#b91c1c' }} onClick={() => void removeNode(n)}>×</button>
            </span>
          </div>
          {(n.prepNote || n.resultNote || (n.attachments?.length || 0) > 0) && (
            <div style={{ marginTop: 5, display: 'grid', gap: 3, fontSize: 12 }}>
              {n.prepNote && <div><b style={{ color: '#64748b' }}>준비</b> <span style={{ whiteSpace: 'pre-wrap' }}>{n.prepNote}</span></div>}
              {n.resultNote && <div><b style={{ color: '#166534' }}>결과</b> <span style={{ whiteSpace: 'pre-wrap' }}>{n.resultNote}</span></div>}
              {(n.attachments || []).map((a, i) => <a key={i} href={resolveUrl(a.url)} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0f3d73' }}>📎 {a.name || '첨부'}</a>)}
            </div>
          )}
        </div>
        {kids.map((c) => renderCard(c, depth + 1))}
        <div style={{ marginLeft: 8 }}><QuickAdd pid={n.id} placeholder="＋ 하위 단계 입력 후 Enter" /></div>
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>🗂 팀 과제 관리</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {curTeam && (
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '2px 10px', background: curTeam.visibility === 'PRIVATE' ? '#fee2e2' : '#dcfce7', color: curTeam.visibility === 'PRIVATE' ? '#991b1b' : '#166534' }}>
              {curTeam.visibility === 'PRIVATE' ? '🔒 비공개' : '🌐 전체공개'}
            </span>
          )}
          {isAdmin && curTeam && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void setVisibility(curTeam.visibility === 'PRIVATE' ? 'PUBLIC' : 'PRIVATE')}>
              {curTeam.visibility === 'PRIVATE' ? '전체공개로' : '비공개로'}
            </button>
          )}
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} style={{ padding: '6px 8px' }}>
            <option value="">팀 선택</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.visibility === 'PRIVATE' ? ' 🔒' : ''}</option>)}
          </select>
        </div>
      </div>
      <div style={{ color: '#475569', fontSize: 13 }}>
        <b>과제(컬럼)</b>를 만들고, 그 안에 <b>세부 단계</b>를 칸반 카드로 단계별 입력합니다. 카드의 “＋ 하위 단계”로 더 세부 단계를 이어 붙일 수 있고, <b>수정</b>에서 마일스톤 일자·준비자료·결과보고·첨부·KPI/OKR 연동을 넣습니다. (모든 구성원 입력·편집 가능)
      </div>

      {orgUnitId && (
        loading ? <div>불러오는 중…</div> : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {(tree['__root'] || []).map((root) => {
              const passed = todayPassed(root.milestoneDate);
              const rc = root.status === 'DONE' ? '#16a34a' : passed ? '#dc2626' : '#0f3d73';
              return (
                <div key={root.id} style={{ minWidth: 300, maxWidth: 360, flex: '0 0 auto', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: `2px solid ${rc}`, paddingBottom: 6, marginBottom: 4 }}>
                    <b style={{ fontSize: 15 }}>{root.title}</b>
                    {linkLabel(root) && <span style={{ fontSize: 10, background: '#eef2ff', color: '#3730a3', borderRadius: 999, padding: '1px 7px' }}>🔗</span>}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 6px' }} onClick={() => openEdit(root)}>수정</button>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 6px', color: '#b91c1c' }} onClick={() => void removeNode(root)}>×</button>
                    </span>
                  </div>
                  {(tree[root.id] || []).map((c) => renderCard(c, 0))}
                  <QuickAdd pid={root.id} placeholder="＋ 세부 단계 입력 후 Enter" />
                </div>
              );
            })}
            {/* 새 과제(컬럼) */}
            <div style={{ minWidth: 240, flex: '0 0 auto', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 10 }}>
              <div style={{ fontWeight: 700, color: '#475569', fontSize: 13, marginBottom: 4 }}>＋ 새 과제</div>
              <QuickAdd pid="__root" placeholder="과제명 입력 후 Enter" />
              <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => openCreate(null)}>상세 입력으로 추가</button>
            </div>
          </div>
        )
      )}

      {orgUnitId && (
        <div style={{ border: '1px solid #bae6fd', borderRadius: 12, background: '#f0f9ff', padding: 14, display: 'grid', gap: 8 }}>
          <b>🤖 과제 자료 AI 질의</b>
          <div style={{ fontSize: 12, color: '#475569' }}>과제 내용·준비자료·결과보고·첨부파일(엑셀/워드/PDF/텍스트)을 AI가 읽고 요약·답변합니다.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askAi(); }} placeholder="예: 차종1 투자비 회수 현황 요약해줘" style={{ flex: 1, padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
            <button type="button" className="btn" disabled={aiBusy} onClick={() => void askAi()}>{aiBusy ? '분석 중…' : '질문'}</button>
          </div>
          {aiAns && <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap', fontSize: 14 }}>{aiAns}</div>}
        </div>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }} onClick={() => setEditing(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 18, width: 480, maxWidth: '96%', maxHeight: '92vh', overflowY: 'auto', display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>{editing.id ? '항목 수정' : (editing.parentId ? '하위 항목 추가' : '과제 추가')}</h3>
            {(() => {
              const f = editing; const set = (k: string, v: any) => setEditing((p: any) => ({ ...p, [k]: v }));
              const fld: React.CSSProperties = { padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, width: '100%' };
              return (
                <>
                  <label style={{ display: 'grid', gap: 3 }}><span style={{ fontSize: 12, color: '#475569' }}>제목 *</span>
                    <input style={fld} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 차종1 / 시작비 점검" /></label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 3, flex: 1 }}><span style={{ fontSize: 12, color: '#475569' }}>마일스톤 일자</span>
                      <input type="date" style={fld} value={f.milestoneDate} onChange={(e) => set('milestoneDate', e.target.value)} /></label>
                    <label style={{ display: 'grid', gap: 3, flex: 1 }}><span style={{ fontSize: 12, color: '#475569' }}>상태</span>
                      <select style={fld} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">진행</option><option value="DONE">완료</option></select></label>
                  </div>
                  <label style={{ display: 'grid', gap: 3 }}><span style={{ fontSize: 12, color: '#475569' }}>KPI/OKR 연동</span>
                    <select style={fld} value={f.link} onChange={(e) => set('link', e.target.value)}>
                      <option value="">연동 안함</option>
                      {links.filter((l) => l.kind === 'KR').length > 0 && <optgroup label="KPI">{links.filter((l) => l.kind === 'KR').map((l) => <option key={l.id} value={`KR:${l.id}`}>{l.title}</option>)}</optgroup>}
                      {links.filter((l) => l.kind === 'OBJ').length > 0 && <optgroup label="OKR/목표">{links.filter((l) => l.kind === 'OBJ').map((l) => <option key={l.id} value={`OBJ:${l.id}`}>{l.title}</option>)}</optgroup>}
                    </select></label>
                  <label style={{ display: 'grid', gap: 3 }}><span style={{ fontSize: 12, color: '#475569' }}>준비 자료</span>
                    <textarea style={fld} rows={2} value={f.prepNote} onChange={(e) => set('prepNote', e.target.value)} /></label>
                  <label style={{ display: 'grid', gap: 3 }}><span style={{ fontSize: 12, color: '#475569' }}>결과 보고 (마일스톤 경과 후)</span>
                    <textarea style={fld} rows={2} value={f.resultNote} onChange={(e) => set('resultNote', e.target.value)} /></label>
                  <div style={{ display: 'grid', gap: 3 }}><span style={{ fontSize: 12, color: '#475569' }}>첨부파일 (원드라이브)</span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setShowPicker(true)}>📁 원드라이브에서 첨부</button></div>
                  {(f.attachments || []).length > 0 && (
                    <div style={{ display: 'grid', gap: 4 }}>
                      {(f.attachments || []).map((a: Attachment, i: number) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, background: '#f8fafc', borderRadius: 6, padding: '4px 8px' }}>
                          <span>📎 {a.name}</span>
                          <button type="button" style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer' }} onClick={() => set('attachments', f.attachments.filter((_: any, idx: number) => idx !== i))}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>취소</button>
              <button type="button" className="btn btn-sm" onClick={() => void saveEditing()}>저장</button>
            </div>
          </div>
        </div>
      )}

      {showPicker && editing && (
        <OneDriveFilePicker
          userId={userId}
          multiple
          onClose={() => setShowPicker(false)}
          onSelect={(files) => {
            setEditing((p: any) => ({ ...p, attachments: [...(p.attachments || []), ...files.map((f) => ({ url: f.url, name: f.name }))] }));
            setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}
