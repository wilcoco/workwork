import { useState } from 'react';
import { apiJson } from '../lib/api';
import { UserPicker, type PickedUser } from '../components/UserPicker';

export function ApprovalsSubmit() {
  const [subjectType, setSubjectType] = useState('Initiative');
  const [subjectId, setSubjectId] = useState('');
  const [approverId, setApproverId] = useState('');
  const [steps, setSteps] = useState<Array<{ id: string; name: string }>>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [dueAt, setDueAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');

  const requestedById = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  function addStep(u: PickedUser) {
    setSteps((prev) => [...prev, { id: u.id, name: u.name }]);
    setShowPicker(false);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return next;
    });
  }

  async function submit() {
    if (!subjectType || !subjectId || (!approverId && steps.length === 0) || !requestedById) return;
    setLoading(true);
    setError(null);
    setOkMsg('');
    try {
      const body: any = { subjectType, subjectId, requestedById };
      if (steps.length > 0) {
        body.steps = steps.map((s) => ({ approverId: s.id }));
      } else {
        body.approverId = approverId;
      }
      if (dueAt) body.dueAt = new Date(dueAt).toISOString();
      const res = await apiJson<any>('/api/approvals', { method: 'POST', body: JSON.stringify(body) });
      setOkMsg(`요청 완료: ${res?.id || ''}`);
      setSubjectId('');
      setApproverId('');
      setSteps([]);
      setDueAt('');
    } catch (e: any) {
      setError(e?.message || '요청 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 640, margin: '24px auto' }}>
      <h2 style={{ margin: 0 }}>결재 올리기</h2>
      {requestedById ? null : <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {okMsg && <div style={{ color: '#0F3D73' }}>{okMsg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <label>대상 종류</label>
        <input value={subjectType} onChange={(e) => setSubjectType(e.target.value)} style={input} />
        <label>대상 ID</label>
        <input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={input} />
        <label>결재선</label>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            {steps.map((s, idx) => (
              <div key={`${s.id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={chip}>{idx + 1}</span>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: '#64748b' }}>({s.id})</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" style={ghostBtn} onClick={() => moveStep(idx, -1)}>▲</button>
                  <button type="button" style={ghostBtn} onClick={() => moveStep(idx, 1)}>▼</button>
                  <button type="button" style={ghostBtn} onClick={() => removeStep(idx)}>삭제</button>
                </span>
              </div>
            ))}
            <div>
              <button type="button" style={primaryBtn} onClick={() => setShowPicker(true)}>결재자 추가</button>
              {showPicker && (
                <div style={{ marginTop: 8 }}>
                  <UserPicker onSelect={addStep} onClose={() => setShowPicker(false)} />
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>다단계 결재선을 사용하지 않으면 아래 단일 결재자 ID를 입력하세요.</div>
            <input placeholder="단일 결재자 User ID" value={approverId} onChange={(e) => setApproverId(e.target.value)} style={input} disabled={steps.length > 0} />
          </div>
        </div>
        <label>기한(선택)</label>
        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={input} />
        <button onClick={submit} disabled={!subjectType || !subjectId || (!approverId && steps.length === 0) || !requestedById || loading} style={primaryBtn}>
          {loading ? '요청중…' : '결재 요청'}
        </button>
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

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '6px 10px',
  fontWeight: 600,
};

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
};
