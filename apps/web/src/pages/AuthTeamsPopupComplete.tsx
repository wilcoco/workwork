import { useEffect } from 'react';

/**
 * This page is loaded inside a popup window after OAuth completes.
 * It reads the token from the URL hash and sends it to the opener via postMessage.
 */
export function AuthTeamsPopupComplete() {
  useEffect(() => {
    const hash = window.location.hash || '';
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

    const token = params.get('token') || '';
    const userId = params.get('userId') || '';
    const userName = params.get('userName') || '';
    const teamName = params.get('teamName') || '';

    if (token && window.opener) {
      // Send credentials to the parent window
      window.opener.postMessage({
        type: 'teams-auth-complete',
        token,
        userId,
        userName,
        teamName,
      }, '*');
      // Close this popup
      setTimeout(() => window.close(), 500);
    } else if (token) {
      // No opener (opened directly): store and redirect
      localStorage.setItem('token', token);
      if (userId) localStorage.setItem('userId', userId);
      if (userName) localStorage.setItem('userName', userName);
      localStorage.setItem('teamName', teamName || '');
      window.location.href = '/';
    } else {
      window.location.href = '/login?error=token_missing';
    }
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
      로그인 완료 중... 잠시 후 창이 닫힙니다.
    </div>
  );
}
