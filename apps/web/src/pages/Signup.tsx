import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

// trigger redeploy: harmless comment

export function Signup() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [role, setRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>('INDIVIDUAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/orgs`);
        const options = (res.items || []).filter((u: any) => u.type === 'TEAM').map((u: any) => u.name).sort();
        setTeams(options);
        if (!teamName && options.length > 0) setTeamName(options[0]);
      } catch {}
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiJson<{ token: string; user: { id: string; name: string; teamName: string } }>(
        '/api/auth/signup',
        {
          method: 'POST',
          body: JSON.stringify({ username, password, name, teamName, role }),
        }
      );
      localStorage.setItem('token', res.token);
      localStorage.setItem('userLogin', username);
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
          <label>팀</label>
          <select value={teamName} onChange={(e) => setTeamName(e.target.value)} required>
            {teams.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label>이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label>직책</label>
          <select value={role} onChange={(e) => setRole(e.target.value as any)} required>
            <option value="CEO">대표이사</option>
            <option value="EXEC">임원</option>
            <option value="MANAGER">팀장</option>
            <option value="INDIVIDUAL">직원</option>
          </select>
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
