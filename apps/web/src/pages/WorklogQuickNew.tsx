import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

export function WorklogQuickNew() {
  const nav = useNavigate();
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [teamName, setTeamName] = useState<string>('');
  const [taskName, setTaskName] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('teamName') || '';
    if (stored) setTeamName(stored);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const userId = localStorage.getItem('userId') || '';
      if (!userId) throw new Error('로그인이 필요합니다');
      const res = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({ userId, teamName, taskName, title, content, date }),
        }
      );
      nav(`/worklogs/${res.id}`);
    } catch (err: any) {
      setError(err?.message || '저장 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '24px auto' }}>
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: '#f3f4f6', display: 'grid', placeItems: 'center', fontWeight: 700 }}>🙂</div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>무엇을 진행하셨나요?</div>
        </div>
        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} required />
            <input placeholder="팀명" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input} required />
          </div>
          <input placeholder="과제명" value={taskName} onChange={(e) => setTaskName(e.target.value)} style={input} required />
          <input placeholder="업무일지 제목" value={title} onChange={(e) => setTitle(e.target.value)} style={input} required />
          <textarea placeholder="업무 내용" value={content} onChange={(e) => setContent(e.target.value)} style={{ ...input, minHeight: 140, resize: 'vertical' }} required />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={ghostBtn} onClick={() => { setTitle(''); setContent(''); }}>
              초기화
            </button>
            <button style={primaryBtn} disabled={loading}>
              {loading ? '작성중…' : '작성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#111827',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};
