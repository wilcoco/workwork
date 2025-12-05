import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

export function WorklogAi() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [team, setTeam] = useState('');
  const [user, setUser] = useState('');
  const [options, setOptions] = useState<{ teams: string[]; users: string[] }>({ teams: [], users: [] });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      if (team) qs.set('team', team);
      if (user) qs.set('user', user);
      const r = await apiJson<{ from: string; to: string; days: number; summary: string }>(`/api/worklogs/ai/summary?${qs.toString()}`);
      setSummary(r.summary || '');
      setRange({ from: r.from, to: r.to });
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  // Load filter options (teams/users) from weekly stats; do not auto-run AI summary.
  useEffect(() => {
    (async () => {
      try {
        const r = await apiJson<{ teams: Array<{ teamName: string; members: Array<{ userName: string; count: number }> }> }>(`/api/worklogs/stats/weekly?days=${encodeURIComponent(String(days))}`);
        const teamSet = new Set<string>();
        const userSet = new Set<string>();
        for (const t of r.teams || []) {
          teamSet.add(t.teamName);
          if (!team || t.teamName === team) {
            for (const m of t.members || []) userSet.add(m.userName);
          }
        }
        setOptions({ teams: Array.from(teamSet), users: Array.from(userSet) });
      } catch {}
    })();
  }, [days, team]);

  const filteredUsers = useMemo(() => {
    return options.users;
  }, [options.users]);

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>업무일지 AI 분석</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={team} onChange={(e) => { setTeam(e.target.value); setUser(''); }} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
            <option value="">전체 팀</option>
            {options.teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={user} onChange={(e) => setUser(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
            <option value="">전체 구성원</option>
            {filteredUsers.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
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
