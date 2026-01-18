import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

// trigger redeploy: harmless comment

export function Signup() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [teamsUpn, setTeamsUpn] = useState('');
  const [role, setRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>('INDIVIDUAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recommendedRoles = useMemo(() => ['MANAGER', 'INDIVIDUAL'] as Array<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>, []);
  const upperRoles = useMemo(() => ['CEO', 'EXEC'] as Array<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload: any = { username, password, name, role };
      if (teamsUpn.trim()) payload.teamsUpn = teamsUpn.trim();
      const res = await apiJson<{ token: string; user: { id: string; name: string; teamName: string } }>(
        '/api/auth/signup',
        {
          method: 'POST',
          body: JSON.stringify(payload),
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
        <p style={{ color: '#666' }}>이름/직급/아이디/비밀번호를 입력해 주세요. 소속(팀/실)은 추후 조직관리에서 설정합니다.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit} className="form">
          <label>이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label>직책</label>
          <select value={role} onChange={(e) => setRole(e.target.value as any)} required>
            <optgroup label="권장(팀)">
              {recommendedRoles.map((r) => (
                <option key={r} value={r}>
                  {r === 'MANAGER' ? '팀장' : r === 'INDIVIDUAL' ? '팀원' : r}
                </option>
              ))}
            </optgroup>
            <optgroup label="상위 계위">
              {upperRoles.map((r) => (
                <option key={r} value={r}>
                  {r === 'CEO' ? '대표' : r === 'EXEC' ? '임원' : r}
                </option>
              ))}
            </optgroup>
          </select>
          <label>이메일(로그인)</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label>Teams ID(UPN)</label>
          <input
            value={teamsUpn}
            onChange={(e) => setTeamsUpn(e.target.value)}
            placeholder="보통 회사 이메일과 동일"
          />
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
