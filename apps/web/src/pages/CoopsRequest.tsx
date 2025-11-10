import { useState } from 'react';
import { apiJson } from '../lib/api';
import { UserPicker, type PickedUser } from '../components/UserPicker';

export function CoopsRequest() {
  const [category, setCategory] = useState('General');
  const [queue, setQueue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [slaMinutes, setSlaMinutes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');

  const requesterId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  function onPick(u: PickedUser) {
    setAssigneeId(u.id);
    setAssigneeName(u.name);
    setShowPicker(false);
  }

  async function submit() {
    if (!category || !requesterId) return;
    setLoading(true);
    setError(null);
    setOkMsg('');
    try {
      const body: any = { category, requesterId };
      if (queue) body.queue = queue;
      if (assigneeId) body.assigneeId = assigneeId;
      if (slaMinutes) body.slaMinutes = Number(slaMinutes) || 0;
      const res = await apiJson<any>('/api/help-tickets', { method: 'POST', body: JSON.stringify(body) });
      setOkMsg(`요청 생성: ${res?.id || ''}`);
      setQueue('');
      setAssigneeId('');
      setSlaMinutes('');
    } catch (e: any) {
      setError(e?.message || '요청 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 640, margin: '24px auto' }}>
      <h2 style={{ margin: 0 }}>업무 협조 요청</h2>
      {requesterId ? null : <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {okMsg && <div style={{ color: '#0F3D73' }}>{okMsg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <label>카테고리</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} style={input} />
        <label>할당 큐(선택)</label>
        <input value={queue} onChange={(e) => setQueue(e.target.value)} style={input} />
        <label>담당자(선택)</label>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input placeholder="담당자 User ID(직접 입력)" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={input} />
            <button type="button" style={primaryBtn} onClick={() => setShowPicker(true)}>선택</button>
          </div>
          {assigneeName && <div style={{ fontSize: 12, color: '#64748b' }}>선택됨: {assigneeName} ({assigneeId})</div>}
          {showPicker && (
            <div>
              <UserPicker onSelect={onPick} onClose={() => setShowPicker(false)} />
            </div>
          )}
        </div>
        <label>SLA 분(선택)</label>
        <input type="number" value={slaMinutes} onChange={(e) => setSlaMinutes(e.target.value)} style={input} />
        <button onClick={submit} disabled={!category || !requesterId || loading} style={primaryBtn}>{loading ? '요청중…' : '협조 요청'}</button>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};
