import { Link } from 'react-router-dom';

export function AuthPending() {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>로그인 안내</h2>
        <div style={{ marginTop: 12, color: '#475569' }}>
          로그인 처리 중 문제가 발생했습니다. 다시 로그인해 주세요.
        </div>
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>
          문제가 반복되면 관리자에게 문의해 주세요.
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link to="/login" className="btn">로그인 화면</Link>
        </div>
      </div>
    </div>
  );
}
