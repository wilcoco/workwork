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
import { ApprovalsSubmit } from './pages/ApprovalsSubmit';
import { ApprovalsInbox } from './pages/ApprovalsInbox';
import { ApprovalsMine } from './pages/ApprovalsMine';
import { ApprovalsStatus } from './pages/ApprovalsStatus';
import { CoopsRequest } from './pages/CoopsRequest';
import { CoopsInbox } from './pages/CoopsInbox';
import { CoopsMine } from './pages/CoopsMine';
import { CoopsStatus } from './pages/CoopsStatus';

export function App() {
  const SHOW_APPROVALS = (import.meta as any)?.env?.VITE_SHOW_APPROVALS === 'true';
  const SHOW_COOPS = (import.meta as any)?.env?.VITE_SHOW_COOPS === 'true';
  return (
    <BrowserRouter>
      <HeaderBar SHOW_APPROVALS={SHOW_APPROVALS} SHOW_COOPS={SHOW_COOPS} />
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
          {SHOW_APPROVALS && (
            <>
              <Route path="/approvals/new" element={<ApprovalsSubmit />} />
              <Route path="/approvals/inbox" element={<ApprovalsInbox />} />
              <Route path="/approvals/mine" element={<ApprovalsMine />} />
              <Route path="/approvals/status" element={<ApprovalsStatus />} />
            </>
          )}
          {SHOW_COOPS && (
            <>
              <Route path="/coops/request" element={<CoopsRequest />} />
              <Route path="/coops/inbox" element={<CoopsInbox />} />
              <Route path="/coops/mine" element={<CoopsMine />} />
              <Route path="/coops/status" element={<CoopsStatus />} />
            </>
          )}
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function HeaderBar({ SHOW_APPROVALS, SHOW_COOPS }: { SHOW_APPROVALS: boolean; SHOW_COOPS: boolean }) {
  const nav = useNavigate();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  const userLogin = typeof localStorage !== 'undefined' ? localStorage.getItem('userLogin') || '' : '';
  const userName = typeof localStorage !== 'undefined' ? localStorage.getItem('userName') || '' : '';
  const teamName = typeof localStorage !== 'undefined' ? localStorage.getItem('teamName') || '' : '';
  const onLogout = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('userName');
      localStorage.removeItem('userLogin');
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
        {SHOW_APPROVALS && (
          <>
            <Link to="/approvals/new">결재올리기</Link>
            <Link to="/approvals/inbox">결재함</Link>
            <Link to="/approvals/mine">내결재</Link>
            <Link to="/approvals/status">결재현황</Link>
          </>
        )}
        {SHOW_COOPS && (
          <>
            <Link to="/coops/request">협조요청</Link>
            <Link to="/coops/inbox">내협조함</Link>
            <Link to="/coops/mine">보낸협조</Link>
            <Link to="/coops/status">협조현황</Link>
          </>
        )}
        <span className="nav-right">
          {token ? (
            <>
              <span className="user-chip">{userName}{teamName ? ` · ${teamName}` : ''}{userLogin ? ` · ${userLogin}` : ''}</span>
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

