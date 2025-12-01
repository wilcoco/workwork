import { BrowserRouter, Link, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { OkrInput } from './pages/OkrInput';
import { OkrTree } from './pages/OkrTree';
import { OkrInstructions } from './pages/OkrInstructions';
import { CompanyOkrInput } from './pages/CompanyOkrInput';
import { TeamKpiInput } from './pages/TeamKpiInput';
import { TeamKpiBoard } from './pages/TeamKpiBoard';
import { TeamOkrInput } from './pages/TeamOkrInput';
import { AdminOrgs } from './pages/AdminOrgs';
import { ApprovalsSubmit } from './pages/ApprovalsSubmit';
import { ApprovalsInbox } from './pages/ApprovalsInbox';
import { ApprovalsMine } from './pages/ApprovalsMine';
import { ApprovalsStatus } from './pages/ApprovalsStatus';
import { CoopsRequest } from './pages/CoopsRequest';
import { CoopsInbox } from './pages/CoopsInbox';
import { CoopsMine } from './pages/CoopsMine';
import { CoopsStatus } from './pages/CoopsStatus';
import { DEPLOY_TITLE, DEPLOY_DESC } from './deployInfo';
import { AdminMembers } from './pages/AdminMembers';
import { AdminTools } from './pages/AdminTools';

function DeployBanner() {
  const codeTitle = String((DEPLOY_TITLE ?? '')).trim().replace(/^['"]+|['"]+$/g, '');
  const codeDesc = String((DEPLOY_DESC ?? '')).trim().replace(/^['"]+|['"]+$/g, '');
  const gitTitle = String(import.meta.env.VITE_GIT_TITLE ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  const gitCommit = String(import.meta.env.VITE_GIT_COMMIT ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  const gitDate = String(import.meta.env.VITE_GIT_DATE ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  const envTitle = String(import.meta.env.VITE_DEPLOY_TITLE ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  const envDesc = String((import.meta.env.VITE_DEPLOY_DESC ?? import.meta.env.VITE_DEPLOY_NOTE ?? '') as any)
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  const repo = String(import.meta.env.VITE_GIT_REPO ?? '').trim();
  const fullSha = String(import.meta.env.VITE_GIT_COMMIT_FULL ?? '').trim();

  const [dynTitle, setDynTitle] = useState<string>('');
  const [dynDesc, setDynDesc] = useState<string>('');

  useEffect(() => {
    const initialTitle = gitTitle || codeTitle || envTitle;
    const shouldFetch = (!gitTitle || gitTitle === codeTitle || gitTitle === envTitle) && repo && fullSha;
    if (!shouldFetch) return;
    const url = `https://api.github.com/repos/${repo}/commits/${fullSha}`;
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return;
        const message = String(j?.commit?.message || '').split('\n')[0];
        const when = String(j?.commit?.committer?.date || j?.commit?.author?.date || '');
        if (message) setDynTitle(message);
        const short = fullSha.slice(0, 7);
        const info = [short || gitCommit, when || gitDate].filter(Boolean).join(' · ');
        if (info) setDynDesc(info);
      })
      .catch(() => {});
  }, [gitTitle, codeTitle, envTitle, repo, fullSha, gitCommit, gitDate]);
  const title = dynTitle || gitTitle || codeTitle || envTitle || 'WorkWork Deploy';
  const gitInfo = dynDesc || [gitCommit, gitDate].filter(Boolean).join(' · ');
  const desc = gitInfo || codeDesc || envDesc || '';
  return (
    <div className="deploy-banner">
      <div className="container">
        <b>{title}</b>{desc ? ` · ${desc}` : ''}
      </div>
    </div>
  );
}

export function App() {
  const SHOW_APPROVALS = (import.meta.env.VITE_SHOW_APPROVALS ?? 'true') === 'true';
  const SHOW_COOPS = (import.meta.env.VITE_SHOW_COOPS ?? 'true') === 'true';
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
          <Route path="/okr/input" element={<OkrInput />} />
          <Route path="/okr/tree" element={<OkrTree />} />
          <Route path="/okr-map" element={<OkrMap />} />
          <Route path="/okr/instructions" element={<OkrInstructions />} />
          <Route path="/okr/company" element={<CompanyOkrInput />} />
          <Route path="/okr/team" element={<TeamKpiInput />} />
          <Route path="/okr/team-board" element={<TeamKpiBoard />} />
          <Route path="/okr/team-okr" element={<TeamOkrInput />} />
          <Route path="/admin/orgs" element={<AdminOrgs />} />
          <Route path="/admin/members" element={<AdminMembers />} />
          <Route path="/admin/tools" element={<AdminTools />} />
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
  console.log('VITE_COMPANY_NAME(raw):', (import.meta as any)?.env?.VITE_COMPANY_NAME);
  console.log('companyName:', companyName);
  console.log('norm:', norm);
  console.log('isCams:', isCams);
  console.log('initial logoSrc:', envLogo);
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
          <Link to="/okr/input">OKR 입력</Link>
          <Link to="/okr/tree">OKR 조회</Link>
          <Link to="/okr/team">팀 KPI 입력</Link>
          <Link to="/okr/team-board">팀 KPI 조회</Link>
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
        <NavDropdown label="관리">
          <Link to="/admin/orgs">조직관리</Link>
          <Link to="/admin/members">구성원</Link>
          <Link to="/admin/tools">시스템 도구</Link>
        </NavDropdown>
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
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const location = useLocation();

  const updatePos = () => {
    const el = summaryRef.current as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 220));
    setPos({ top: r.bottom + 12, left });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    const onResize = () => updatePos();
    const onDown = (e: any) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (summaryRef.current && summaryRef.current.contains(e.target)) return;
      setOpen(false);
      if (detailsRef.current) detailsRef.current.open = false;
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const onToggle = (e: any) => {
    const d = e.currentTarget as HTMLDetailsElement;
    const next = !!d.open;
    setOpen(next);
    if (next) updatePos();
  };

  // Close when route changes
  useEffect(() => {
    if (open) {
      setOpen(false);
      if (detailsRef.current) detailsRef.current.open = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // no-op

  const panel = open
    ? createPortal(
        <div
          className="nav-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'transparent' }}
          onClick={() => {
            setOpen(false);
            if (detailsRef.current) detailsRef.current.open = false;
          }}
        >
          <div
            ref={panelRef}
            className="nav-panel"
            style={{ position: 'absolute', top: pos.top, left: pos.left, background: '#FFFFFF', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2147483001, minWidth: 180, maxHeight: '60vh', overflowY: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' }}
            onClick={(e) => {
              // Close when clicking any anchor (<a>) inside panel (react-router Link renders as <a>)
              const target = e.target as HTMLElement | null;
              const anchor = target?.closest('a');
              if (anchor) {
                setOpen(false);
                if (detailsRef.current) detailsRef.current.open = false;
                return;
              }
              e.stopPropagation();
            }}
          >
            {children}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <details ref={detailsRef} onToggle={onToggle} style={{ position: 'relative', marginLeft: 12 }}>
        <summary ref={summaryRef} style={{ cursor: 'pointer', listStyle: 'none' }}>{label}</summary>
      </details>
      {panel}
    </>
  );
}

