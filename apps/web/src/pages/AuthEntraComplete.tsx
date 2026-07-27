import { useEffect, useState } from 'react';
import { setSession } from '../lib/auth';

function safePath(raw?: string | null) {
  const s = String(raw || '').trim();
  if (!s) return '/';
  if (!s.startsWith('/')) return '/';
  if (s.startsWith('//')) return '/';
  return s;
}

export function AuthEntraComplete() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
      const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

      const token = params.get('token') || '';
      const returnTo = safePath(params.get('return'));
      const userId = params.get('userId') || '';
      const userName = params.get('userName') || '';
      const teamName = params.get('teamName') || '';
      const userLogin = params.get('userLogin') || '';

      if (!token) {
        setError('로그인 토큰이 없습니다');
        return;
      }

      setSession({ token, userId, userName, teamName, userLogin });

      // 전체 새로고침으로 진입 — SPA nav()는 App의 token 상태를 갱신하지 못하고,
      // 옛 토큰으로 나간 비행 중 요청의 401이 새 세션을 지우는 레이스도 페이지 전환으로 끊는다
      window.location.replace(returnTo || '/');
    } catch (e: any) {
      setError(e?.message || '로그인 처리 실패');
    }
  }, []);

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>로그인 처리중…</h2>
        {error ? (
          <div style={{ marginTop: 12, color: 'red' }}>{error}</div>
        ) : (
          <div style={{ marginTop: 12, color: '#64748b' }}>잠시만 기다려 주세요.</div>
        )}
      </div>
    </div>
  );
}
