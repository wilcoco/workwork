import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { formatKstYmd } from '../lib/time';

type Me = {
  id: string;
  name: string;
  role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL';
  orgUnitId: string;
  teamName: string;
};

type OrgUnitItem = { id: string; name: string };

type UserItem = {
  id: string;
  name: string;
  orgUnitId: string;
  orgName: string;
};

export function WorklogAi() {
  const nav = useNavigate();
  const myUserId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [team, setTeam] = useState('');
  const [user, setUser] = useState('');
  const [options, setOptions] = useState<{ teams: string[]; users: string[] }>({ teams: [], users: [] });
  const [isMobile, setIsMobile] = useState(false);
  const [overdue, setOverdue] = useState<any | null>(null);
  const [overdueError, setOverdueError] = useState<string | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<OrgUnitItem[]>([]);
  const [managedTeams, setManagedTeams] = useState<OrgUnitItem[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const viewerId = myUserId;
      params.set('days', String(days));
      if (team) params.set('team', team);
      if (user) params.set('user', user);
      if (viewerId) params.set('viewerId', viewerId);
      const r = await apiJson<{ from: string; to: string; days: number; summary: string }>(`/api/worklogs/ai/summary?${params.toString()}`);
      setSummary(r.summary || '');
      setRange({ from: r.from, to: r.to });
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      try {
        const m = await apiJson<Me>(`/api/users/me?userId=${encodeURIComponent(myUserId)}`);
        setMe(m);
      } catch {
        setMe(null);
      }
    })();
  }, [myUserId]);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiJson<{ items: OrgUnitItem[] }>(`/api/orgs`);
        setTeams(Array.isArray(r?.items) ? r.items : []);
      } catch {
        setTeams([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      try {
        const r = await apiJson<{ items: OrgUnitItem[] }>(`/api/orgs/managed?userId=${encodeURIComponent(myUserId)}`);
        setManagedTeams(Array.isArray(r?.items) ? r.items : []);
      } catch {
        setManagedTeams([]);
      }
    })();
  }, [myUserId]);

  const scopeTeamItems = useMemo(() => {
    const role = me?.role;
    if (role === 'CEO') return teams;
    if (role === 'EXEC') return managedTeams;
    if (role === 'MANAGER') {
      if ((managedTeams || []).length > 0) return managedTeams;
      if (me?.orgUnitId) {
        const found = (teams || []).find((t) => String(t.id) === String(me.orgUnitId));
        return found ? [found] : [];
      }
      return [];
    }
    return [];
  }, [managedTeams, me?.orgUnitId, me?.role, teams]);

  const scopeTeamNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of scopeTeamItems || []) {
      const name = String((t as any).name || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scopeTeamItems]);

  useEffect(() => {
    setOptions((prev) => ({ ...prev, teams: scopeTeamNameOptions }));
  }, [scopeTeamNameOptions]);

  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      if (!me) return;

      try {
        const scopeIds = (scopeTeamItems || []).map((t) => String(t.id)).filter(Boolean);
        if (scopeIds.length === 0) {
          setOptions((prev) => ({ ...prev, users: [] }));
          return;
        }

        if (team) {
          const teamItem = (scopeTeamItems || []).find((t) => String(t.name) === String(team));
          const orgUnitId = teamItem ? String(teamItem.id) : '';
          if (!orgUnitId) {
            setOptions((prev) => ({ ...prev, users: [] }));
            return;
          }
          const r = await apiJson<{ items: UserItem[] }>(`/api/users?orgUnitId=${encodeURIComponent(orgUnitId)}`);
          const names = (r?.items || []).map((u) => String(u.name || '')).filter(Boolean);
          const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
          setOptions((prev) => ({ ...prev, users: uniq }));
          return;
        }

        const r = await apiJson<{ items: UserItem[] }>(`/api/users?orgUnitIds=${encodeURIComponent(scopeIds.join(','))}`);
        const names = (r?.items || []).map((u) => String(u.name || '')).filter(Boolean);
        const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
        setOptions((prev) => ({ ...prev, users: uniq }));
      } catch {
        setOptions((prev) => ({ ...prev, users: [] }));
      }
    })();
  }, [me, myUserId, scopeTeamItems, team]);

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!myUserId) return;
        setOverdueError(null);
        const r = await apiJson<any>(`/api/users/overdue?userId=${encodeURIComponent(myUserId)}`);
        setOverdue(r || null);
      } catch (e: any) {
        setOverdue(null);
        setOverdueError(e?.message || '오버듀 로드 실패');
      }
    })();
  }, [myUserId]);

  const filteredUsers = useMemo(() => {
    return options.users;
  }, [options.users]);

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      {overdueError && <div style={{ color: 'red' }}>{overdueError}</div>}
      {(() => {
        if (!overdue) return null;
        const total = Number(overdue?.counts?.total || 0);
        const items = Array.isArray(overdue?.items) ? overdue.items : [];
        const kindKey = (it: any) => String(it?.kind || '').toUpperCase();
        const procCount = Number(overdue?.counts?.processInstances || 0) + Number(overdue?.counts?.processTasks || 0);
        const approvalCount = Number(overdue?.counts?.approvals || 0);
        const helpCount = Number(overdue?.counts?.helpTickets || 0);
        const delegationCount = Number(overdue?.counts?.delegations || 0);
        const initiativeCount = Number(overdue?.counts?.initiatives || 0);
        const preview = (() => {
          const byKind = new Map<string, any[]>();
          for (const it of items) {
            const k = kindKey(it);
            const arr = byKind.get(k) || [];
            arr.push(it);
            byKind.set(k, arr);
          }
          const preferred = ['PROCESS_TASK', 'PROCESS_INSTANCE', 'HELP_TICKET', 'APPROVAL', 'DELEGATION', 'INITIATIVE'];
          const seen = new Set<string>();
          const out: any[] = [];
          for (const k of preferred) {
            const arr = byKind.get(k) || [];
            if (!arr.length) continue;
            const it = arr[0];
            const key = `${kindKey(it)}-${String(it?.id || '')}`;
            if (seen.has(key)) continue;
            out.push(it);
            seen.add(key);
            if (out.length >= 7) return out;
          }
          for (const it of items) {
            const key = `${kindKey(it)}-${String(it?.id || '')}`;
            if (seen.has(key)) continue;
            out.push(it);
            seen.add(key);
            if (out.length >= 7) break;
          }
          return out;
        })();
        const label = (k: any) => {
          const key = String(k || '').toUpperCase();
          if (key === 'PROCESS_TASK' || key === 'PROCESS_INSTANCE') return '프로세스';
          if (key === 'APPROVAL') return '결재';
          if (key === 'HELP_TICKET') return '업무요청';
          if (key === 'DELEGATION') return '위임';
          if (key === 'INITIATIVE') return '과제';
          return key || '기타';
        };
        return (
          <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 900, color: '#0f172a' }}>마감 초과</div>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: total ? '#b91c1c' : '#64748b', fontWeight: 800 }}>
                {total ? `총 ${total}건` : '없음'}
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', fontWeight: 700 }}>
              {procCount ? `프로세스 ${procCount} · ` : ''}
              {helpCount ? `업무요청 ${helpCount} · ` : ''}
              {approvalCount ? `결재 ${approvalCount} · ` : ''}
              {delegationCount ? `위임 ${delegationCount} · ` : ''}
              {initiativeCount ? `과제 ${initiativeCount}` : ''}
            </div>
            {total ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                {preview.map((it: any) => {
                  const key = `${String(it?.kind || '')}-${String(it?.id || '')}`;
                  const due = it?.dueAt ? formatKstYmd(it.dueAt) : '';
                  const href = String(it?.link || '').trim();
                  const title = String(it?.title || '').trim() || '(제목 없음)';
                  const assignee = String(it?.assigneeName || '').trim();
                  const overdueDays = Number(it?.overdueDays || 0) || 0;
                  return (
                    <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#991b1b', minWidth: 64 }}>{label(it?.kind)}</div>
                      {href ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: 0, height: 'auto', lineHeight: 1.2, fontSize: 13, color: '#0f172a', textDecoration: 'underline', textAlign: 'left' as any }}
                          onClick={() => nav(href)}
                        >
                          {title}
                        </button>
                      ) : (
                        <div style={{ fontSize: 13, color: '#0f172a' }}>{title}</div>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                        {assignee ? <div style={{ fontSize: 12, color: '#64748b' }}>{assignee}</div> : null}
                        <div style={{ fontSize: 12, color: '#64748b' }}>{due}</div>
                        {overdueDays ? <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 800 }}>{`초과 ${overdueDays}일`}</div> : null}
                      </div>
                    </div>
                  );
                })}
                {total > preview.length ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>외 {total - preview.length}건</div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>마감 초과 항목 없음</div>
            )}
          </div>
        );
      })()}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(220px, 1fr)) auto', alignItems: 'center', width: '100%' }}>
          <select value={team} onChange={(e) => { setTeam(e.target.value); setUser(''); }} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
            <option value="">전체 팀</option>
            {options.teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={user} onChange={(e) => setUser(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
            <option value="">전체 구성원</option>
            {filteredUsers.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={30}>최근 30일</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? '조회중…' : '조회'}</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ color: '#475569' }}>기간: {range.from ? new Date(range.from).toLocaleString() : '-'} ~ {range.to ? new Date(range.to).toLocaleString() : '-'}</div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, whiteSpace: 'pre-wrap' }}>
        {summary || (loading ? '조회중…' : '요약이 없습니다. 좌측에서 필터를 선택하고 조회를 눌러주세요.')}
      </div>
      <div style={{ color: '#64748b', fontSize: 12 }}>
        참고: OpenAI API 키는 코드에 저장하지 않고 Railway 환경 변수(예: OPENAI_API_KEY, OPENAI_API_KEY_CAMS, OPENAI_API_KEY_IAT)에서 읽습니다.
      </div>
    </div>
  );
}
