import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

type Holiday = {
  id: string;
  date: string;
  name: string;
  isLegal: boolean;
};

export function AdminHolidays() {
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [items, setItems] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [isLegal, setIsLegal] = useState(true);

  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  useEffect(() => {
    void loadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function loadHolidays() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: { id: string; date: string; name: string; isLegal: boolean }[] }>(`/api/holidays?year=${year}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '공휴일 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      alert('로그인이 필요합니다');
      return;
    }
    if (!date || !name) {
      alert('날짜와 이름을 입력해 주세요');
      return;
    }
    try {
      await apiJson(`/api/holidays`, {
        method: 'POST',
        body: JSON.stringify({ actorId: userId, date, name, isLegal }),
      });
      setName('');
      await loadHolidays();
    } catch (e: any) {
      alert(e?.message || '공휴일 등록에 실패했습니다 (EXEC/CEO만 가능)');
    }
  }

  async function onDelete(id: string) {
    if (!userId) {
      alert('로그인이 필요합니다');
      return;
    }
    if (!window.confirm('삭제하시겠습니까?')) return;
    try {
      await apiJson(`/api/holidays/${encodeURIComponent(id)}?actorId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      await loadHolidays();
    } catch (e: any) {
      alert(e?.message || '공휴일 삭제에 실패했습니다 (EXEC/CEO만 가능)');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>휴일 캘린더 관리</h2>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>연도</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value || String(new Date().getFullYear()), 10))}
            style={{ width: 80 }}
          />
        </label>
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>날짜</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>이름</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={isLegal} onChange={(e) => setIsLegal(e.target.checked)} />
          <span>법정 공휴일</span>
        </label>
        <button type="submit">공휴일 추가/수정</button>
      </form>

      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>공휴일 로딩중…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ borderBottom: '1px solid #e5e7eb', padding: 4, textAlign: 'left' }}>날짜</th>
              <th style={{ borderBottom: '1px solid #e5e7eb', padding: 4, textAlign: 'left' }}>이름</th>
              <th style={{ borderBottom: '1px solid #e5e7eb', padding: 4, textAlign: 'center' }}>법정</th>
              <th style={{ borderBottom: '1px solid #e5e7eb', padding: 4 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id}>
                <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4 }}>{h.date.slice(0, 10)}</td>
                <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4 }}>{h.name}</td>
                <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4, textAlign: 'center' }}>{h.isLegal ? '✓' : ''}</td>
                <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4, textAlign: 'right' }}>
                  <button type="button" onClick={() => onDelete(h.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
