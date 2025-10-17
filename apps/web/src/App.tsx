import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { WorklogNew } from './pages/WorklogNew';
import { WorklogDetail } from './pages/WorklogDetail';
import { Inbox } from './pages/Inbox';
import { Signup } from './pages/Signup';
import { Login } from './pages/Login';
import { WorklogQuickNew } from './pages/WorklogQuickNew';
import { WorklogSearch } from './pages/WorklogSearch';
import { MeGoals } from './pages/MeGoals';

export function App() {
  return (
    <BrowserRouter>
      <HeaderBar />
      <div style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/worklogs/new" element={<WorklogNew />} />
          <Route path="/worklogs/:id" element={<WorklogDetail />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/quick" element={<WorklogQuickNew />} />
          <Route path="/search" element={<WorklogSearch />} />
          <Route path="/me/goals" element={<MeGoals />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function HeaderBar() {
  const nav = useNavigate();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  const userName = typeof localStorage !== 'undefined' ? localStorage.getItem('userName') || '' : '';
  const teamName = typeof localStorage !== 'undefined' ? localStorage.getItem('teamName') || '' : '';
  const onLogout = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('userName');
      localStorage.removeItem('teamName');
    }
    nav('/login');
  };
  return (
    <div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', borderBottom: '1px solid #eee' }}>
      <Link to="/">Home</Link>
      <Link to="/quick">작성</Link>
      <Link to="/me/goals">내 목표</Link>
      <Link to="/search">조회</Link>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
        {token ? (
          <>
            <span style={{ color: '#334155', fontSize: 14 }}>{userName}{teamName ? ` · ${teamName}` : ''}</span>
            <button onClick={onLogout} style={{ background: 'transparent', color: '#0F3D73', border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>로그아웃</button>
          </>
        ) : (
          <>
            <Link to="/login">로그인</Link>
            <Link to="/signup">회원가입</Link>
          </>
        )}
      </span>
    </div>
  );
}
