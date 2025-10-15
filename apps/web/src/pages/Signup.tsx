import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

// trigger redeploy: harmless comment

export function Signup() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiJson<{ token: string; user: { id: string; name: string; teamName: string } }>(
        '/api/auth/signup',
        {
          method: 'POST',
          body: JSON.stringify({ username, password, name, teamName }),
        }
      );
      localStorage.setItem('token', res.token);
      localStorage.setItem('userId', res.user.id);
      localStorage.setItem('userName', res.user.name);
      localStorage.setItem('teamName', res.user.teamName || '');
      nav('/');
    } catch (err: any) {
      setError(err?.message || '가입 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>회원가입</h2>
        <p style={{ color: '#666' }}>팀명/이름/아이디/비밀번호를 입력해 주세요.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit} className="form">
          <label>팀명</label>
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
          <label>이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label>아이디</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label>비밀번호</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="actions">
            <button className="btn" disabled={loading}>{loading ? '처리중…' : '가입'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
