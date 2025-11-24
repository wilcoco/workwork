import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiJson } from './lib/api';
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

function DeployBanner() {
  const title = String(((import.meta as any)?.env?.VITE_DEPLOY_TITLE) ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  const desc = String(((import.meta as any)?.env?.VITE_DEPLOY_DESC ?? (import.meta as any)?.env?.VITE_DEPLOY_NOTE ?? '') as any)
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  if (!title && !desc) return null as any;
  return (
    <div className="deploy-banner">
      <div className="container">
        <b>{title}</b>{desc ? ` · ${desc}` : ''}
      </div>
    </div>
  );
}

export function App() {
  const SHOW_APPROVALS = ((import.meta as any)?.env?.VITE_SHOW_APPROVALS ?? 'true') === 'true';
  const SHOW_COOPS = ((import.meta as any)?.env?.VITE_SHOW_COOPS ?? 'true') === 'true';
  return (
    <BrowserRouter>
      <DeployBanner />
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
  const [brand, setBrand] = useState<{ name: string; logoPath: string } | null>(null);
  const rawCompanyName = (import.meta as any)?.env?.VITE_COMPANY_NAME ?? '';
  const companyName = String(rawCompanyName).trim().replace(/^['"]+|['"]+$/g, '');
  const norm = companyName.toLowerCase();
  const isCams = norm.includes('캠스') || norm.includes('cams');
  const isIat = norm.includes('아이앤테크');
  const envLogo = isCams ? '/camslogo.jpg' : isIat ? '/logo.png' : '/logo.png';
  const [logoSrc, setLogoSrc] = useState(envLogo);
  const [brandLabel, setBrandLabel] = useState(companyName || '회사');

  useEffect(() => {
    (async () => {
      try {
        const b = await apiJson<{ name: string; logoPath: string }>(`/api/brand`);
        // If env explicitly indicates CAMS, keep env-based logo (camslogo.jpg)
        const envIsCams = norm.includes('캠스') || norm.includes('cams');
        if (envIsCams) {
          setBrand(b);
          return;
        }
        const apiName = String(b?.name || '').trim();
        const apiLogo = String(b?.logoPath || '');
        const isMeaningful = (apiName && apiName !== '회사') || apiLogo.includes('camslogo');
        if (isMeaningful) {
          if (b?.logoPath) setLogoSrc(b.logoPath);
          if (b?.name) setBrandLabel(b.name);
        }
        setBrand(b);
      } catch {
        // ignore, fall back to env
      }
    })();
  }, []);
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
        <Link to="/" className="logo" aria-label={`${brandLabel} 메인`}>
          <img src={logoSrc} alt={`${brandLabel} 로고`} />
        </Link>
        <NavDropdown label="업무일지">
          <Link to="/quick">작성</Link>
          <Link to="/search">조회</Link>
        </NavDropdown>
        <NavDropdown label="목표관리">
          <Link to="/me/goals">내 목표</Link>
          <Link to="/okr-map">전사 목표</Link>
        </NavDropdown>
        {SHOW_APPROVALS && (
          <NavDropdown label="결재">
            <Link to="/approvals/new">결재올리기</Link>
            <Link to="/approvals/inbox">결재함</Link>
            <Link to="/approvals/mine">내결재</Link>
            <Link to="/approvals/status">결재현황</Link>
          </NavDropdown>
        )}
        {SHOW_COOPS && (
          <NavDropdown label="협조">
            <Link to="/coops/request">협조요청</Link>
            <Link to="/coops/inbox">내협조함</Link>
            <Link to="/coops/mine">보낸협조</Link>
            <Link to="/coops/status">협조현황</Link>
          </NavDropdown>
        )}
        <Link to="/admin/orgs">조직관리</Link>
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

function NavDropdown({ label, children }: { label: string; children: any }) {
  return (
    <details style={{ position: 'relative', marginLeft: 12 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>{label}</summary>
      <div style={{ position: 'absolute', top: '100%', left: 0, background: '#FFFFFF', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 6, zIndex: 50, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        {children}
      </div>
    </details>
  );
}

