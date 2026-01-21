import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/api';

// trigger redeploy: harmless comment

export function Signup() {
  const nav = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setLoading(true);
    const url = apiUrl(`/api/auth/entra/start?return=${encodeURIComponent(returnTo)}`);
    window.location.href = url;
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>회원가입</h2>
        <p style={{ color: '#666' }}>회원가입은 Teams(Microsoft) 로그인으로 자동 처리됩니다.</p>
        {error && <div className="error">{error}</div>}
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={onMicrosoftLogin} disabled={loading}>
            Microsoft로 로그인
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => nav('/login')} disabled={loading}>
            로그인으로
          </button>
        </div>
        <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
          최초 로그인은 관리자/대표 승인 후 활성화됩니다.
        </div>
      </div>
    </div>
  );
}
