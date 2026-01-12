import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

interface MasterItem {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

type MasterType = 'items' | 'molds' | 'car-models' | 'suppliers' | 'equipments';

const masterLabels: Record<MasterType, string> = {
  items: '품번',
  molds: '금형',
  'car-models': '차종',
  suppliers: '협력사',
  equipments: '설비',
};

export function MasterManagement() {
  const [activeTab, setActiveTab] = useState<MasterType>('items');
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, [activeTab]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: MasterItem[] }>(`/api/masters/${activeTab}`);
      setItems(res?.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function add() {
    if (!newCode.trim() || !newName.trim()) {
      setError('코드와 이름을 모두 입력하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/masters/${activeTab}`, {
        method: 'POST',
        body: JSON.stringify({ code: newCode.trim(), name: newName.trim() }),
      });
      setNewCode('');
      setNewName('');
      await load();
    } catch (e: any) {
      setError(e?.message || '추가 실패');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      await apiJson(`/api/masters/${activeTab}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>
        {(Object.keys(masterLabels) as MasterType[]).map((key) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              background: activeTab === key ? '#0F3D73' : 'transparent',
              color: activeTab === key ? '#fff' : '#374151',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {masterLabels[key]}
          </button>
        ))}
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="코드"
          style={{ ...inputStyle, minWidth: 140, flex: '0 0 140px' }}
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="이름"
          style={{ ...inputStyle, minWidth: 200, flex: '1 1 240px' }}
        />
        <button onClick={add} disabled={saving} style={{ ...primaryBtn, flex: '0 0 auto' }}>
          {saving ? '추가 중...' : '추가'}
        </button>
      </div>

      {loading && <div>로딩 중...</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr 80px', gap: 8, padding: '8px 12px', background: '#f1f5f9', borderRadius: 6, fontWeight: 600, fontSize: 13 }}>
          <div>코드</div>
          <div>이름</div>
          <div>등록일</div>
          <div></div>
        </div>
        {items.map((it) => (
          <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr 80px', gap: 8, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 6, alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>{it.code}</div>
            <div>{it.name}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(it.createdAt).toLocaleDateString()}</div>
            <button onClick={() => remove(it.id)} style={dangerBtn}>삭제</button>
          </div>
        ))}
        {!loading && !items.length && <div style={{ color: '#9ca3af' }}>등록된 항목이 없습니다.</div>}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 8,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  padding: '10px 16px',
  fontWeight: 600,
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = {
  background: '#ef4444',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
};
