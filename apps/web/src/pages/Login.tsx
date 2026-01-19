import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';

export function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawCompanyName = (import.meta as any)?.env?.VITE_COMPANY_NAME ?? '';
  const companyName = String(rawCompanyName).trim().replace(/^['"]+|['"]+$/g, '');
  const norm = companyName.toLowerCase();
  const isCams = norm.includes('캠스') || norm.includes('cams');

  const qsError = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const e = params.get('error');
      return e ? String(e) : '';
    } catch {
      return '';
    }
  }, [location.search]);

  const returnTo = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const r = String(params.get('return') || '').trim();
      if (r && r.startsWith('/') && !r.startsWith('//')) return r;
      return '/';
    } catch {
      return '/';
    }
  }, [location.search]);

  function onMicrosoftLogin() {
    const url = apiUrl(`/api/auth/entra/start?return=${encodeURIComponent(returnTo)}`);
    window.location.href = url;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiJson<{ token: string; user: { id: string; name: string; teamName: string } }>(
        '/api/auth/login',
        { method: 'POST', body: JSON.stringify({ username, password }) }
      );
      localStorage.setItem('token', res.token);
      localStorage.setItem('userLogin', username);
      localStorage.setItem('userId', res.user.id);
      localStorage.setItem('userName', res.user.name);
      localStorage.setItem('teamName', res.user.teamName || '');
      nav('/');
    } catch (err: any) {
      setError(err?.message || '로그인 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>로그인</h2>
        {(qsError || error) && <div className="error">{qsError || error}</div>}
        {isCams && (
          <>
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={onMicrosoftLogin} disabled={loading}>
                Microsoft로 로그인
              </button>
            </div>
            <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
              회사 계정(Entra ID)으로 로그인합니다. 최초 로그인은 관리자/대표 승인 후 활성화됩니다.
            </div>
          </>
        )}
        <form onSubmit={submit} className="form">
          <label>아이디</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label>비밀번호</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="actions">
            <button className="btn" disabled={loading}>{loading ? '처리중…' : '로그인'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
