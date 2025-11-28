import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

// trigger redeploy: harmless comment

export function Signup() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [role, setRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>('INDIVIDUAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [teamId, setTeamId] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/orgs`);
        const items = res.items || [];
        setOrgs(items);
        const companies = items.filter((u: any) => u.type === 'COMPANY');
        const defaultCompany = companies[0]?.id || '';
        const divisions = items.filter((u: any) => u.type === 'DIVISION' && (!defaultCompany || u.parentId === defaultCompany));
        const defaultDivision = divisions[0]?.id || '';
        const divisionIds = divisions.map((d: any) => d.id);
        const teamsUnderCompany = items.filter((u: any) => u.type === 'TEAM' && (
          (!!defaultDivision && u.parentId === defaultDivision) || (!defaultDivision && (u.parentId === defaultCompany || divisionIds.includes(u.parentId)))
        ));
        const defaultTeam = teamsUnderCompany[0]?.id || '';
        setCompanyId(defaultCompany);
        setDivisionId(defaultDivision);
        setTeamId(defaultTeam);
        const t = items.find((u: any) => u.id === defaultTeam);
        setTeamName(t?.name || '');
      } catch {}
    })();
  }, []);

  const companies = useMemo(() => orgs.filter((u: any) => u.type === 'COMPANY'), [orgs]);
  const divisions = useMemo(() => orgs.filter((u: any) => u.type === 'DIVISION' && (!companyId || u.parentId === companyId)), [orgs, companyId]);
  const teams = useMemo(() => {
    if (divisionId) {
      return orgs.filter((u: any) => u.type === 'TEAM' && u.parentId === divisionId);
    }
    if (companyId) {
      const divIds = orgs.filter((u: any) => u.type === 'DIVISION' && u.parentId === companyId).map((d: any) => d.id);
      return orgs.filter((u: any) => u.type === 'TEAM' && (u.parentId === companyId || divIds.includes(u.parentId)));
    }
    return orgs.filter((u: any) => u.type === 'TEAM');
  }, [orgs, divisionId, companyId]);

  useEffect(() => {
    const t = orgs.find((u: any) => u.id === teamId);
    setTeamName(t?.name || '');
  }, [teamId, orgs]);

  useEffect(() => {
    // When company/division changes, ensure team is valid; if not, pick first available
    const list = teams;
    if (!list.find((u: any) => u.id === teamId)) {
      setTeamId(list[0]?.id || '');
    }
  }, [companyId, divisionId, teams]);

  const companyName = useMemo(() => (orgs.find((u: any) => u.id === companyId)?.name || ''), [orgs, companyId]);
  const divisionName = useMemo(() => (orgs.find((u: any) => u.id === divisionId)?.name || ''), [orgs, divisionId]);
  const recommendedRoles = useMemo(() => ['MANAGER', 'INDIVIDUAL'] as Array<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>, [teamId]);
  const upperRoles = useMemo(() => ['CEO', 'EXEC'] as Array<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'>, []);
  const isUpper = role === 'CEO' || role === 'EXEC';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload: any = { username, password, name, role };
      if (teamId) {
        payload.teamId = teamId;
        if (teamName) payload.teamName = teamName;
      }
      if (!teamId && isUpper && companyId) payload.companyId = companyId;
      const res = await apiJson<{ token: string; user: { id: string; name: string; teamName: string } }>(
        '/api/auth/signup',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      localStorage.setItem('token', res.token);
      localStorage.setItem('userLogin', username);
      localStorage.setItem('userId', res.user.id);
      localStorage.setItem('userName', res.user.name);
      localStorage.setItem('teamName', res.user.teamName || '');
      nav('/');
    } catch (err: any) {
      setError(err?.message || '가입 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>회원가입</h2>
        <p style={{ color: '#666' }}>팀명/이름/아이디/비밀번호를 입력해 주세요.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit} className="form">
          <label>대표</label>
          <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setDivisionId(''); setTeamId(''); }} required>
            {companies.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <label>실</label>
          <select value={divisionId} onChange={(e) => { setDivisionId(e.target.value); setTeamId(''); }} disabled={divisions.length === 0}>
            <option value="">(선택 없음)</option>
            {divisions.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <label>팀</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required={!isUpper}>
            <option value="">(선택 없음)</option>
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{companyName || '(대표 없음)'}{companyName ? ' > ' : ''}{divisionName || '(실 없음)'}{divisionName ? ' > ' : ''}{teamName || '(팀 없음)'}</div>
          <label>이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label>직책</label>
          <select value={role} onChange={(e) => setRole(e.target.value as any)} required>
            <optgroup label="권장(팀)">
              {recommendedRoles.map((r) => (
                <option key={r} value={r}>
                  {r === 'MANAGER' ? '팀장' : r === 'INDIVIDUAL' ? '직원' : r}
                </option>
              ))}
            </optgroup>
            <optgroup label="상위 계위">
              {upperRoles.map((r) => (
                <option key={r} value={r}>
                  {r === 'CEO' ? '대표이사' : r === 'EXEC' ? '임원' : r}
                </option>
              ))}
            </optgroup>
          </select>
          <label>아이디</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label>비밀번호</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="actions">
            <button className="btn" disabled={loading}>{loading ? '처리중…' : '가입'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
