import { Link } from 'react-router-dom';

export function AuthPending() {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>승인 대기</h2>
        <div style={{ marginTop: 12, color: '#475569' }}>
          회사 계정으로 로그인은 완료되었지만, 현재는 관리자/대표 승인 전이라 사용할 수 없습니다.
        </div>
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>
          관리자에게 승인 요청 후 다시 로그인해 주세요.
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link to="/login" className="btn">로그인 화면</Link>
        </div>
      </div>
    </div>
  );
}
