import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstYmd, todayKstYmd } from '../lib/time';

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
  const myUserId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [team, setTeam] = useState('');
  const [user, setUser] = useState('');
  const [options, setOptions] = useState<{ teams: string[]; users: string[] }>({ teams: [], users: [] });
  const [isMobile, setIsMobile] = useState(false);

  const ymdToMs = (ymd: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return NaN;
    return new Date(`${ymd}T00:00:00+09:00`).getTime();
  };
  const shiftYmd = (ymd: string, deltaDays: number) => {
    const ms = ymdToMs(ymd);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms + deltaDays * 24 * 60 * 60 * 1000);
    return formatKstYmd(d);
  };
  const [fromYmd, setFromYmd] = useState(() => {
    const t = todayKstYmd();
    return shiftYmd(t, -2) || t;
  });
  const [toYmd, setToYmd] = useState(() => todayKstYmd());
  const [question, setQuestion] = useState('');
  const [includeProcess, setIncludeProcess] = useState(true);
  const [includeHelp, setIncludeHelp] = useState(true);
  const [includeApprovals, setIncludeApprovals] = useState(true);
  const [includeEvaluation, setIncludeEvaluation] = useState(true);

  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ taskTitle: string; frequency: number; users: string[]; hashTags: string[]; hasManual: boolean; latestNote: string }>>([]);
  const [suggestAi, setSuggestAi] = useState<string | null>(null);
  const [suggestDays, setSuggestDays] = useState(30);

  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<OrgUnitItem[]>([]);
  const [managedTeams, setManagedTeams] = useState<OrgUnitItem[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const viewerId = myUserId;
      if (fromYmd) params.set('from', fromYmd);
      if (toYmd) params.set('to', toYmd);
      if (team) params.set('team', team);
      if (user) params.set('user', user);
      if (viewerId) params.set('viewerId', viewerId);
      if (question.trim()) params.set('question', question.trim());
      params.set('includeProcess', includeProcess ? '1' : '0');
      params.set('includeHelp', includeHelp ? '1' : '0');
      params.set('includeApprovals', includeApprovals ? '1' : '0');
      params.set('includeEvaluation', includeEvaluation ? '1' : '0');

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

  const filteredUsers = useMemo(() => {
    return options.users;
  }, [options.users]);

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <input
              type="date"
              value={fromYmd}
              onChange={(e) => setFromYmd(e.target.value)}
              style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', width: '100%' }}
            />
            <div style={{ color: '#64748b', fontSize: 12 }}>~</div>
            <input
              type="date"
              value={toYmd}
              onChange={(e) => setToYmd(e.target.value)}
              style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', width: '100%' }}
            />
          </div>
          <button className="btn" onClick={load} disabled={loading}>{loading ? '조회중…' : '조회'}</button>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="추가 문의 사항(선택)"
          style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px', minHeight: 64, resize: 'vertical' as any }}
        />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as any, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#0f172a' }}>
            <input type="checkbox" checked={includeProcess} onChange={(e) => setIncludeProcess(e.target.checked)} />
            진행중 프로세스 포함
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#0f172a' }}>
            <input type="checkbox" checked={includeHelp} onChange={(e) => setIncludeHelp(e.target.checked)} />
            진행중 업무요청 포함
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#0f172a' }}>
            <input type="checkbox" checked={includeApprovals} onChange={(e) => setIncludeApprovals(e.target.checked)} />
            결재 대기 포함
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#0f172a' }}>
            <input type="checkbox" checked={includeEvaluation} onChange={(e) => setIncludeEvaluation(e.target.checked)} />
            업무 평가 포함
          </label>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ color: '#475569' }}>기간: {range.from ? formatKstYmd(range.from) : '-'} ~ {range.to ? formatKstYmd(range.to) : '-'}</div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, whiteSpace: 'pre-wrap' }}>
        {summary || (loading ? '조회중…' : '요약이 없습니다. 좌측에서 필터를 선택하고 조회를 눌러주세요.')}
      </div>
      

      <div style={{ borderTop: '2px solid #E5E7EB', marginTop: 16, paddingTop: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>반복업무 → 매뉴얼 제안</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={suggestDays} onChange={e => setSuggestDays(Number(e.target.value))}
              style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '4px 8px', fontSize: 13, appearance: 'auto' as any }}>
              <option value={14}>최근 14일</option>
              <option value={30}>최근 30일</option>
              <option value={60}>최근 60일</option>
              <option value={90}>최근 90일</option>
            </select>
            <button className="btn" onClick={async () => {
              setSuggestLoading(true);
              setSuggestError(null);
              try {
                const res = await apiJson<{ suggestions: any[]; aiAnalysis?: string; message?: string; days?: number }>('/api/worklogs/suggest-manuals', {
                  method: 'POST',
                  body: JSON.stringify({ viewerId: myUserId || undefined, team: team || undefined, user: user || undefined, days: suggestDays }),
                });
                setSuggestions(res.suggestions || []);
                setSuggestAi(res.aiAnalysis || res.message || null);
              } catch (e: any) {
                setSuggestError(e?.message || '분석 실패');
              } finally {
                setSuggestLoading(false);
              }
            }} disabled={suggestLoading}>
              {suggestLoading ? '분석 중...' : '분석'}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          일정 기간 동안 3회 이상 반복된 업무를 감지하여 매뉴얼 작성이 필요한 업무를 제안합니다.
        </div>
        {suggestError && <div style={{ color: '#b91c1c', fontSize: 13 }}>{suggestError}</div>}
        {suggestions.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{s.taskTitle}</span>
                  <span style={{ background: '#EFF6FF', color: '#1e40af', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>{s.frequency}회</span>
                  {s.hasManual ? (
                    <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>매뉴얼 있음</span>
                  ) : (
                    <span style={{ background: '#FEF2F2', color: '#991b1b', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>매뉴얼 없음</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  담당: {s.users.join(', ') || '-'}
                  {s.hashTags.length > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      {s.hashTags.map((ht, j) => (
                        <span key={j} style={{ background: '#EFF6FF', color: '#1e40af', borderRadius: 999, padding: '0 6px', fontSize: 11, marginRight: 4 }}>#{ht}</span>
                      ))}
                    </span>
                  )}
                </div>
                {!s.hasManual && (
                  <a href="/manuals" style={{ fontSize: 12, color: '#0F3D73', fontWeight: 600, textDecoration: 'none' }}>→ 매뉴얼 작성하기</a>
                )}
              </div>
            ))}
          </div>
        )}
        {suggestAi && (
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, whiteSpace: 'pre-wrap', fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#0f172a' }}>AI 분석 결과</div>
            {suggestAi}
          </div>
        )}
        {!suggestLoading && suggestions.length === 0 && !suggestError && (
          <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' as any, padding: 20 }}>
            "분석" 버튼을 눌러 반복 업무를 감지하세요.
          </div>
        )}
      </div>
    </div>
  );
}
