import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiUrl } from '../lib/api';

export function Login() {
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setLoading(true);
    const url = apiUrl(`/api/auth/entra/start?return=${encodeURIComponent(returnTo)}`);
    window.location.href = url;
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>로그인</h2>
        {(qsError || error) && <div className="error">{qsError || error}</div>}
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={onMicrosoftLogin} disabled={loading}>
            Microsoft로 로그인
          </button>
        </div>
        <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
          회사 계정(Entra ID)으로 로그인합니다.
        </div>
      </div>
    </div>
  );
}
