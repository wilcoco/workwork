import { useEffect } from 'react';
import * as microsoftTeams from '@microsoft/teams-js';

/**
 * This page is loaded inside the Teams auth popup after OAuth completes.
 * It reads the token from the URL hash and notifies Teams to close the popup.
 */
export function AuthTeamsPopupComplete() {
  useEffect(() => {
    (async () => {
      try {
        await microsoftTeams.app.initialize();
      } catch {}

      const hash = window.location.hash || '';
      const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

      const token = params.get('token') || '';
      const userId = params.get('userId') || '';
      const userName = params.get('userName') || '';
      const teamName = params.get('teamName') || '';

      if (token) {
        const result = JSON.stringify({ token, userId, userName, teamName });
        try {
          microsoftTeams.authentication.notifySuccess(result);
        } catch {
          // Fallback: if not in Teams popup context, just store and redirect
          localStorage.setItem('token', token);
          if (userId) localStorage.setItem('userId', userId);
          if (userName) localStorage.setItem('userName', userName);
          localStorage.setItem('teamName', teamName || '');
          window.location.href = '/';
        }
      } else {
        try {
          microsoftTeams.authentication.notifyFailure('로그인 실패');
        } catch {
          window.location.href = '/login?error=token_missing';
        }
      }
    })();
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
      로그인 처리 중...
    </div>
  );
}
