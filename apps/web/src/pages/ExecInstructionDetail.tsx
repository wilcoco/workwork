import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiJson } from '../lib/api';

type User = { id: string; name: string };
type Milestone = {
  id: string; order: number; title: string; expectedResult: string | null;
  status: 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'REVIEW' | 'DONE';
  owner: User | null; ownerId: string | null; dueAt: string | null;
  proof: Array<{ type: string; value: string; by?: string; at?: string }>;
  returnNote: string | null; keyInitiativeId: string | null; approvalRequestId: string | null;
};
type Detail = {
  id: string; summary: string; rawText: string; status: string; source: string;
  author: User; promotedTemplateId: string | null; milestones: Milestone[];
};

const ST: Record<string, { label: string; bg: string; fg: string }> = {
  PENDING: { label: '대기', bg: '#f1f5f9', fg: '#64748b' },
  ACTIVE: { label: '진행', bg: '#dbeafe', fg: '#1d4ed8' },
  BLOCKED: { label: '막힘', bg: '#fee2e2', fg: '#b91c1c' },
  REVIEW: { label: '검수 대기', bg: '#ede9fe', fg: '#6d28d9' },
  DONE: { label: '완료', bg: '#dcfce7', fg: '#15803d' },
};

export function ExecInstructionDetail() {
  const { id = '' } = useParams();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [d, setD] = useState<Detail | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setD(await apiJson<Detail>(`/api/exec-instructions/${id}`)); } catch (e: any) { setErr(e?.message || '로드 실패'); }
  }
  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    apiJson<{ items: User[] }>('/api/users').then((r) => setUsers(r.items || [])).catch(() => {});
    if (userId) apiJson<{ role?: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`).then((m) => setIsAdmin(m?.role === 'CEO' || m?.role === 'EXEC')).catch(() => {});
  }, [userId]);

  if (err) return <div style={{ color: '#dc2626', padding: 20 }}>{err}</div>;
  if (!d) return <div style={{ color: '#94a3b8', padding: 20 }}>불러오는 중…</div>;

  const canManage = isAdmin || d.author?.id === userId; // 지시자/관리자
  const progressed = d.milestones.some((m) => m.status === 'DONE' || m.status === 'REVIEW');
  const doneCount = d.milestones.filter((m) => m.status === 'DONE').length;

  async function act(key: string, url: string, body: any) {
    setBusy(key); setErr(null);
    try { const res = await apiJson<Detail>(url, { method: 'POST', body: JSON.stringify(body) }); setD(res); }
    catch (e: any) { setErr(e?.message || '처리 실패'); }
    finally { setBusy(null); }
  }
  async function patch(key: string, url: string, body: any) {
    setBusy(key); setErr(null);
    try { const res = await apiJson<Detail>(url, { method: 'PATCH', body: JSON.stringify(body) }); setD(res); }
    catch (e: any) { setErr(e?.message || '처리 실패'); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div><Link to="/exec-instructions" style={{ color: '#64748b', fontSize: 13, textDecoration: 'none' }}>← 지시 목록</Link></div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>지시자 {d.author?.name} · {d.source === 'VOICE' ? '🎤 음성' : '텍스트'} · {doneCount}/{d.milestones.length} 완료</div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 15, lineHeight: 1.6 }}>{d.rawText}</div>
          </div>
          {canManage && (
            <div style={{ display: 'grid', gap: 6 }}>
              {!progressed && (
                <button disabled={!!busy} onClick={() => act('regen', `/api/exec-instructions/${id}/regenerate`, { actorId: userId })} style={btnGhost}>AI 재분해</button>
              )}
              {d.promotedTemplateId ? (
                <Link to={`/process/templates`} style={{ ...btnGhost, textDecoration: 'none', textAlign: 'center' }}>템플릿 보기</Link>
              ) : (
                <button disabled={!!busy} onClick={() => act('promote', `/api/exec-instructions/${id}/promote-template`, { actorId: userId }).then(load)} style={btnGhost}>템플릿으로 승격</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {d.milestones.map((m) => {
          const st = ST[m.status];
          const iAmOwner = m.ownerId === userId;
          const canWork = iAmOwner || canManage;
          return (
            <div key={m.id} style={{ border: '1px solid #e2e8f0', borderLeft: `4px solid ${st.fg}`, borderRadius: 12, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#f1f5f9', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#475569' }}>{m.order + 1}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{m.title}</span>
                <span style={{ fontSize: 11, fontWeight: 700, background: st.bg, color: st.fg, padding: '3px 10px', borderRadius: 20 }}>{st.label}</span>
              </div>
              {m.expectedResult && <div style={{ marginTop: 6, fontSize: 13, color: '#475569' }}>🎯 기대결과: {m.expectedResult}</div>}
              {m.returnNote && <div style={{ marginTop: 6, fontSize: 13, color: '#b91c1c' }}>↩ 반려 사유: {m.returnNote}</div>}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                {/* 담당자 배정 */}
                {canManage ? (
                  <select
                    value={m.ownerId || ''}
                    disabled={!!busy || m.status === 'DONE'}
                    onChange={(e) => act('assign' + m.id, `/api/exec-instructions/milestones/${m.id}/assign`, { actorId: userId, ownerId: e.target.value })}
                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
                  >
                    <option value="">담당자 미지정</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 13, color: '#475569' }}>담당: {m.owner?.name || '미지정'}</span>
                )}
                {m.keyInitiativeId && <Link to="/key-initiatives" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>📋 연결된 과제</Link>}

                <div style={{ flex: 1 }} />

                {/* 담당자 액션 */}
                {canWork && (m.status === 'ACTIVE' || m.status === 'BLOCKED') && (
                  <>
                    <button disabled={!!busy} onClick={() => act('submit' + m.id, `/api/exec-instructions/milestones/${m.id}/submit`, { actorId: userId })} style={btnPrimary}>
                      {canManage && (d.author?.id === userId) ? '완료 확정' : '완료 제출(검수요청)'}
                    </button>
                    <button disabled={!!busy} onClick={() => act('block' + m.id, `/api/exec-instructions/milestones/${m.id}/block`, { actorId: userId })} style={btnGhost}>
                      {m.status === 'BLOCKED' ? '막힘 해제' : '막힘'}
                    </button>
                    <button disabled={!!busy} onClick={() => { const v = window.prompt('증빙 링크 또는 메모'); if (v) act('proof' + m.id, `/api/exec-instructions/milestones/${m.id}/proof`, { actorId: userId, type: /^https?:\/\//.test(v) ? 'link' : 'note', value: v }); }} style={btnGhost}>+ 증빙</button>
                  </>
                )}
                {m.status === 'REVIEW' && (
                  <Link to="/approvals/inbox" style={{ ...btnGhost, textDecoration: 'none' }}>검수는 결재하기에서 →</Link>
                )}
              </div>

              {Array.isArray(m.proof) && m.proof.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 3 }}>
                  {m.proof.map((p, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: '#475569' }}>
                      {p.type === 'link' ? <a href={p.value} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>🔗 {p.value}</a> : <span>📝 {p.value}</span>}
                    </div>
                  ))}
                </div>
              )}

              {canManage && m.status !== 'DONE' && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>꼭지 수정</summary>
                  <MilestoneEdit m={m} busy={!!busy} onSave={(body) => patch('edit' + m.id, `/api/exec-instructions/milestones/${m.id}`, { actorId: userId, ...body })} />
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneEdit({ m, busy, onSave }: { m: Milestone; busy: boolean; onSave: (b: any) => void }) {
  const [title, setTitle] = useState(m.title);
  const [expected, setExpected] = useState(m.expectedResult || '');
  const [due, setDue] = useState(m.dueAt ? String(m.dueAt).slice(0, 10) : '');
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" style={inp} />
      <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="기대결과" style={inp} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={inp} />
        <button disabled={busy} onClick={() => onSave({ title, expectedResult: expected, dueAt: due || '' })} style={btnPrimary}>저장</button>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
const btnGhost: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 13 };
const inp: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 };
