import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { isInTeams } from '../lib/teams';

type Mode = 'login' | 'signup';

export function Login() {
  const location = useLocation();
  const nav = useNavigate();
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  async function onMicrosoftLogin() {
    setSsoLoading(true);
    setError(null);

    // Inside Teams (iframe): open a popup window for OAuth
    if (isInTeams()) {
      const popupUrl = apiUrl('/api/auth/entra/start?return=/auth/teams-popup-complete');
      const popup = window.open(popupUrl, '_blank', 'width=600,height=600');
      if (!popup) {
        setError('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        setSsoLoading(false);
        return;
      }
      // Listen for message from popup
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'teams-auth-complete' && event.data?.token) {
          window.removeEventListener('message', handler);
          localStorage.setItem('token', event.data.token);
          if (event.data.userId) localStorage.setItem('userId', event.data.userId);
          if (event.data.userName) localStorage.setItem('userName', event.data.userName);
          if (event.data.teamName !== undefined) localStorage.setItem('teamName', event.data.teamName || '');
          nav(returnTo || '/');
        }
      };
      window.addEventListener('message', handler);
      // Poll to detect if popup was closed without completing
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', handler);
          setSsoLoading(false);
        }
      }, 500);
      return;
    }

    // Outside Teams: normal redirect
    const url = apiUrl(`/api/auth/entra/start?return=${encodeURIComponent(returnTo)}`);
    window.location.href = url;
  }

  function persistSession(payload: any) {
    try {
      const token = String(payload?.token || '');
      const user = payload?.user || {};
      if (!token) throw new Error('토큰을 받지 못했습니다');
      localStorage.setItem('token', token);
      if (user?.id) localStorage.setItem('userId', String(user.id));
      if (user?.name) localStorage.setItem('userName', String(user.name));
      if (user?.teamName !== undefined) localStorage.setItem('teamName', String(user.teamName || ''));
      // Username (email) is what users typed; useful for display
      if (username) localStorage.setItem('userLogin', username);
    } catch (e: any) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('아이디와 비밀번호를 입력하세요');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setError('이름을 입력하세요');
      return;
    }
    setSubmitting(true);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body: any = mode === 'login'
        ? { username: username.trim(), password }
        : { username: username.trim(), password, name: name.trim() };
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(json?.message || json?.error || (mode === 'login' ? '로그인 실패' : '가입 실패')));
      }
      persistSession(json);
      nav(returnTo || '/');
    } catch (e: any) {
      setError(String(e?.message || '요청 실패'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>로그인</h2>
        {(qsError || error) && <div className="error" style={{ marginTop: 8 }}>{qsError || error}</div>}
        {isInTeams() && (window as any).__teamsSsoError && (
          <div style={{ marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
            SSO 오류: {(window as any).__teamsSsoError}
          </div>
        )}

        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={onMicrosoftLogin} disabled={ssoLoading}>
            {isInTeams() ? 'Microsoft로 로그인 (팝업)' : 'Microsoft로 로그인'}
          </button>
        </div>
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 13 }}>
          회사 계정(Entra ID)이 있으신 경우 권장합니다.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 10px' }}>
          <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
          <div style={{ color: '#6b7280', fontSize: 12 }}>또는 외부 사용자</div>
          <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            className="btn"
            style={{ flex: 1, background: mode === 'login' ? '#0f172a' : '#e5e7eb', color: mode === 'login' ? '#fff' : '#0f172a' }}
            onClick={() => { setMode('login'); setError(null); }}
          >
            아이디 로그인
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1, background: mode === 'signup' ? '#0f172a' : '#e5e7eb', color: mode === 'signup' ? '#fff' : '#0f172a' }}
            onClick={() => { setMode('signup'); setError(null); }}
          >
            계정 만들기
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mode === 'signup' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#374151' }}>이름</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="홍길동"
              />
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#374151' }}>아이디(이메일)</span>
            <input
              type="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete={mode === 'login' ? 'username' : 'email'}
              placeholder="user@example.com"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#374151' }}>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
            />
          </label>
          <button type="submit" className="btn" disabled={submitting} style={{ marginTop: 4 }}>
            {submitting ? '처리 중…' : mode === 'login' ? '로그인' : '계정 만들기'}
          </button>
        </form>

        <div style={{ marginTop: 10, color: '#6b7280', fontSize: 12 }}>
          외부 협력사·게스트 사용자를 위한 로그인 경로입니다. 가입 후 관리자의 권한 부여가 필요할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
