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
import { OkrMap } from './pages/OkrMap';
import { AdminOrgs } from './pages/AdminOrgs';

export function App() {
  return (
    <BrowserRouter>
      <HeaderBar />
      <div className="container page">
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
          <Route path="/okr-map" element={<OkrMap />} />
          <Route path="/admin/orgs" element={<AdminOrgs />} />
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
    <div className="header">
      <div className="container">
        <Link to="/" className="logo" aria-label="아이앤테크(주) 메인">
          <img src="/logo.png" alt="아이앤테크(주) 로고" />
        </Link>
        <Link to="/quick">작성</Link>
        <Link to="/me/goals">내 목표</Link>
        <Link to="/search">조회</Link>
        <Link to="/okr-map">OKR맵</Link>
        <Link to="/admin/orgs">조직관리</Link>
        <span className="nav-right">
          {token ? (
            <>
              <span className="user-chip">{userName}{teamName ? ` · ${teamName}` : ''}</span>
              <button onClick={onLogout} className="btn btn-ghost">로그아웃</button>
            </>
          ) : (
            <>
              <Link to="/login">로그인</Link>
              <Link to="/signup">회원가입</Link>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

