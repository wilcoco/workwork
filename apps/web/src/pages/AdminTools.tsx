import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

export function AdminTools() {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any | null>(null);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
    if (!uid) return;
    (async () => {
      try {
        const me = await apiJson<{ id: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        setRole((me as any).role || '');
      } catch {}
    })();
  }, []);

  const canWipe = role === 'CEO' && confirmText === 'ERASE ALL' && !loading;

  async function onWipe() {
    if (!canWipe) return;
    if (!confirm('정말 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    setError(null);
    setSummary(null);
    setLoading(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'ERASE ALL' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '24px auto' }}>
      <div>
        <h2 style={{ margin: 0 }}>시스템 도구</h2>
        <div style={{ color: '#6b7280', marginTop: 4 }}>관리자용 도구입니다. 데이터 삭제는 CEO만 수행할 수 있습니다.</div>
      </div>

      <div className="card" style={{ borderColor: '#ef4444', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, color: '#ef4444' }}>Danger Zone</div>
        </div>
        <div style={{ marginTop: 8, color: '#6b7280' }}>
          데이터베이스를 드롭하지 않고 애플리케이션 데이터만 모두 삭제합니다. 복구할 수 없습니다.
        </div>
        {role !== 'CEO' ? (
          <div style={{ marginTop: 10, color: '#64748b' }}>권한이 없습니다. 대표이사(CEO)만 실행할 수 있습니다.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>확인 문자열</label>
            <input
              placeholder="ERASE ALL"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              style={input}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-danger" disabled={!canWipe} onClick={onWipe}>
                {loading ? '삭제중…' : '데이터 전체 삭제'}
              </button>
            </div>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            {summary && (
              <pre style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, overflowX: 'auto' }}>
                {JSON.stringify(summary, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};
