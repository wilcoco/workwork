import { useEffect, useMemo, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { uploadFiles } from '../lib/upload';

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      setExpanded(new Set((r.items || []).map((n) => n.id)));
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
  async function uploadAtt(files: FileList | null) {
    if (!files || !files.length || !editing) return;
    try { const res = await uploadFiles(files); setEditing((p: any) => ({ ...p, attachments: [...(p.attachments || []), ...res.map((r) => ({ url: r.url, name: r.name }))] })); }
    catch (e: any) { alert(e?.message || '업로드 실패'); }
  }

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

  function renderNode(n: Node, depth: number): any {
    const kids = tree[n.id] || [];
    const isOpen = expanded.has(n.id);
    const passed = todayPassed(n.milestoneDate);
    return (
      <div key={n.id} style={{ marginLeft: depth ? 18 : 0, borderLeft: depth ? '2px solid #eef2f7' : 'none', paddingLeft: depth ? 10 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', flexWrap: 'wrap' }}>
          {kids.length > 0 ? (
            <button type="button" onClick={() => setExpanded((s) => { const x = new Set(s); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x; })} style={{ border: 'none', background: 'none', cursor: 'pointer', width: 16 }}>{isOpen ? '▾' : '▸'}</button>
          ) : <span style={{ width: 16, display: 'inline-block' }} />}
          <span style={{ fontWeight: depth === 0 ? 800 : 600 }}>{n.title}</span>
          {n.milestoneDate && (
            <span style={{ fontSize: 11, background: n.status === 'DONE' ? '#dcfce7' : passed ? '#fee2e2' : '#dbeafe', color: n.status === 'DONE' ? '#166534' : passed ? '#991b1b' : '#1e3a8a', borderRadius: 999, padding: '1px 8px' }}>
              🚩 {String(n.milestoneDate).slice(0, 10)}{n.status === 'DONE' ? ' 완료' : passed ? ' 경과' : ''}
            </span>
          )}
          {linkLabel(n) && <span style={{ fontSize: 11, background: '#eef2ff', color: '#3730a3', borderRadius: 999, padding: '1px 8px' }}>🔗 {linkLabel(n)}</span>}
          {(n.attachments?.length || 0) > 0 && <span style={{ fontSize: 11, color: '#64748b' }}>📎 {n.attachments!.length}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => openCreate(n.id)}>＋하위</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(n)}>수정</button>
            <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#b91c1c' }} onClick={() => void removeNode(n)}>삭제</button>
          </span>
        </div>
        {isOpen && (n.prepNote || n.resultNote || (n.attachments?.length || 0) > 0) && (
          <div style={{ marginLeft: 22, marginBottom: 6, display: 'grid', gap: 4, fontSize: 13 }}>
            {n.prepNote && <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 6, padding: '6px 8px' }}><b style={{ color: '#475569' }}>준비자료</b> <span style={{ whiteSpace: 'pre-wrap' }}>{n.prepNote}</span></div>}
            {n.resultNote && <div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: 6, padding: '6px 8px' }}><b style={{ color: '#166534' }}>결과보고</b> <span style={{ whiteSpace: 'pre-wrap' }}>{n.resultNote}</span></div>}
            {(n.attachments || []).map((a, i) => (
              <a key={i} href={resolveUrl(a.url)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0f3d73' }}>📎 {a.name || '첨부'}</a>
            ))}
          </div>
        )}
        {isOpen && kids.map((c) => renderNode(c, depth + 1))}
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
      <div style={{ color: '#475569', fontSize: 13 }}>과제 → 항목 → 마일스톤 형태로 정리하고, 각 단계에 준비자료·결과보고·첨부파일을 입력합니다. KPI/OKR에 세부 태스크로 연동할 수 있습니다. (모든 구성원 입력·편집 가능)</div>

      {orgUnitId && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b>과제 목록</b>
            <button type="button" className="btn btn-sm" onClick={() => openCreate(null)}>＋ 과제 추가</button>
          </div>
          {loading ? <div>불러오는 중…</div> : (tree['__root'] || []).length === 0 ? (
            <div style={{ color: '#64748b', padding: 16, textAlign: 'center' }}>등록된 과제가 없습니다. “＋ 과제 추가”로 시작하세요.</div>
          ) : (tree['__root'] || []).map((n) => renderNode(n, 0))}
        </div>
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
                  <label style={{ display: 'grid', gap: 3 }}><span style={{ fontSize: 12, color: '#475569' }}>첨부파일</span>
                    <input type="file" multiple onChange={(e) => void uploadAtt(e.target.files)} /></label>
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
    </div>
  );
}
