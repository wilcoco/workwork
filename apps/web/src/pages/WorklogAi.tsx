import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export function WorklogAi() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiJson<{ from: string; to: string; days: number; summary: string }>(`/api/worklogs/ai/summary?days=${encodeURIComponent(String(days))}`);
      setSummary(r.summary || '');
      setRange({ from: r.from, to: r.to });
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [days]);

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>업무일지 AI 분석</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={30}>최근 30일</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? '생성중…' : '다시 생성'}</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ color: '#475569' }}>기간: {range.from ? new Date(range.from).toLocaleString() : '-'} ~ {range.to ? new Date(range.to).toLocaleString() : '-'}</div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, whiteSpace: 'pre-wrap' }}>
        {summary || (loading ? '생성중…' : '요약이 없습니다.')}
      </div>
      <div style={{ color: '#64748b', fontSize: 12 }}>
        참고: OpenAI API 키는 코드에 저장하지 않고 Railway 환경 변수(예: OPENAI_API_KEY, OPENAI_API_KEY_CAMS, OPENAI_API_KEY_IAT)에서 읽습니다.
      </div>
    </div>
  );
}
