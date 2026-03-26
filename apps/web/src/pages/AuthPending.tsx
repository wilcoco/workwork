import { Link } from 'react-router-dom';

export function AuthPending() {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>계정 승인 대기</h2>
        <div style={{ marginTop: 12, color: '#475569' }}>
          계정이 생성되었습니다. 관리자(대표이사) 승인 후 로그인이 가능합니다.
        </div>
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>
          승인이 지연되면 관리자에게 문의해 주세요.
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link to="/login" className="btn">로그인 화면으로</Link>
        </div>
      </div>
    </div>
  );
}
