import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

type Car = {
  id: string;
  name: string;
  type?: string | null;
  plateNo?: string | null;
  active: boolean;
};

export function CarAdmin() {
  const [items, setItems] = useState<Car[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: Car[] }>(`/api/cars`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '차량 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert('차량 이름을 입력해 주세요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/cars`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type: type.trim() || undefined,
          plateNo: plateNo.trim() || undefined,
          active: true,
        }),
      });
      setName('');
      setType('');
      setPlateNo('');
      await reload();
    } catch (e: any) {
      setError(e?.message || '차량 등록에 실패했습니다');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(car: Car) {
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/cars/${encodeURIComponent(car.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: car.name,
          type: car.type ?? undefined,
          plateNo: car.plateNo ?? undefined,
          active: !car.active,
        }),
      });
      await reload();
    } catch (e: any) {
      setError(e?.message || '차량 상태 변경에 실패했습니다');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <h2>차량 관리</h2>
      <form onSubmit={onCreate} style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 2, display: 'grid', gap: 4 }}>
            <span>차량 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 그랜저 1호" />
          </label>
          <label style={{ flex: 1, display: 'grid', gap: 4 }}>
            <span>차량 종류</span>
            <input value={type} onChange={(e) => setType(e.target.value)} placeholder="예: 법인차량" />
          </label>
          <label style={{ flex: 1.2, display: 'grid', gap: 4 }}>
            <span>차량 번호</span>
            <input value={plateNo} onChange={(e) => setPlateNo(e.target.value)} placeholder="예: 12가 3456" />
          </label>
        </div>
        <div>
          <button type="submit" disabled={saving}>차량 등록</button>
        </div>
      </form>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div>
        {loading ? (
          <div>차량 목록 로딩중…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 4 }}>이름</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 4 }}>종류</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 4 }}>번호</th>
                <th style={{ textAlign: 'center', borderBottom: '1px solid #e5e7eb', padding: 4 }}>사용 여부</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: 4, borderBottom: '1px solid #f1f5f9' }}>{c.name}</td>
                  <td style={{ padding: 4, borderBottom: '1px solid #f1f5f9' }}>{c.type ?? ''}</td>
                  <td style={{ padding: 4, borderBottom: '1px solid #f1f5f9' }}>{c.plateNo ?? ''}</td>
                  <td style={{ padding: 4, borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                    <button type="button" disabled={saving} onClick={() => void toggleActive(c)}>
                      {c.active ? '사용 중지' : '사용'}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} style={{ padding: 8, textAlign: 'center', color: '#64748b' }}>
                    등록된 차량이 없습니다. 위에서 차량을 추가해 주세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
