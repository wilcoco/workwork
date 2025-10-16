import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function MeGoals() {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fType, setFType] = useState<'PROJECT' | 'OPERATIONAL'>('PROJECT');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [fCadence, setFCadence] = useState<'' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('');
  const [fAnchor, setFAnchor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: any[] }>(`/api/initiatives/my?userId=${encodeURIComponent(userId)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const projects = items.filter((it) => it.type === 'PROJECT');
  const ops = items.filter((it) => it.type === 'OPERATIONAL');

  function toYmd(v?: string) {
    if (!v) return '';
    const d = new Date(v);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function beginEdit(it: any) {
    setEditingId(it.id);
    setFTitle(it.title || '');
    setFDesc(it.description || '');
    setFType(it.type || 'PROJECT');
    setFStart(toYmd(it.startAt));
    setFEnd(toYmd(it.endAt));
    setFCadence((it.cadence as any) || '');
    setFAnchor(it.cadenceAnchor || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setSaving(false);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/initiatives/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: fTitle || undefined,
          description: fDesc || undefined,
          type: fType,
          startAt: fStart || undefined,
          endAt: fEnd || undefined,
          cadence: fCadence || undefined,
          cadenceAnchor: fAnchor || undefined,
        }),
      });
      await load();
      setEditingId(null);
    } catch (e: any) {
      setError(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', display: 'grid', gap: 12, background: '#F8FAFC', padding: 12, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>내 목표</h2>
        <button disabled={!userId || loading} onClick={load} style={primaryBtn}>{loading ? '새로고침…' : '새로고침'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>프로젝트형</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {projects.map((p) => (
            <div key={p.id} style={card}>
              {editingId === p.id ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="제목" style={input} />
                  <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="설명" style={{ ...input, minHeight: 80 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select value={fType} onChange={(e) => setFType(e.target.value as any)} style={{ ...input, appearance: 'auto' as any }}>
                      <option value="PROJECT">PROJECT</option>
                      <option value="OPERATIONAL">OPERATIONAL</option>
                    </select>
                    <select value={fCadence} onChange={(e) => setFCadence(e.target.value as any)} style={{ ...input, appearance: 'auto' as any }}>
                      <option value="">주기 없음</option>
                      <option value="DAILY">DAILY</option>
                      <option value="WEEKLY">WEEKLY</option>
                      <option value="MONTHLY">MONTHLY</option>
                    </select>
                  </div>
                  <input value={fAnchor} onChange={(e) => setFAnchor(e.target.value)} placeholder="주기 기준(예: MON, 15 등)" style={input} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} style={input} />
                    <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} style={input} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={cancelEdit} type="button" style={ghostBtn} disabled={saving}>취소</button>
                    <button onClick={saveEdit} type="button" style={primaryBtn} disabled={saving}>{saving ? '저장중…' : '저장'}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                    <div style={{ marginLeft: 'auto', background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                      {p.startAt ? formatKstDatetime(p.startAt) : '-'} ~ {p.endAt ? formatKstDatetime(p.endAt) : '-'}
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{p.title}</div>
                  {p.description && <div style={{ marginTop: 6, color: '#374151' }}>{p.description}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button onClick={() => beginEdit(p)} type="button" style={ghostBtn}>편집</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!projects.length && <div style={{ color: '#64748b' }}>등록된 프로젝트형 과제가 없습니다.</div>}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>오퍼레이션형</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {ops.map((o) => (
            <div key={o.id} style={card}>
              {editingId === o.id ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="제목" style={input} />
                  <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="설명" style={{ ...input, minHeight: 80 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select value={fType} onChange={(e) => setFType(e.target.value as any)} style={{ ...input, appearance: 'auto' as any }}>
                      <option value="PROJECT">PROJECT</option>
                      <option value="OPERATIONAL">OPERATIONAL</option>
                    </select>
                    <select value={fCadence} onChange={(e) => setFCadence(e.target.value as any)} style={{ ...input, appearance: 'auto' as any }}>
                      <option value="">주기 없음</option>
                      <option value="DAILY">DAILY</option>
                      <option value="WEEKLY">WEEKLY</option>
                      <option value="MONTHLY">MONTHLY</option>
                    </select>
                  </div>
                  <input value={fAnchor} onChange={(e) => setFAnchor(e.target.value)} placeholder="주기 기준(예: MON, 15 등)" style={input} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} style={input} />
                    <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} style={input} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={cancelEdit} type="button" style={ghostBtn} disabled={saving}>취소</button>
                    <button onClick={saveEdit} type="button" style={primaryBtn} disabled={saving}>{saving ? '저장중…' : '저장'}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                    <div>주기:</div>
                    <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                      {o.cadence || '-'} {o.cadenceAnchor ? `(${o.cadenceAnchor})` : ''}
                    </div>
                    <div style={{ marginLeft: 'auto' }}>
                      {o.startAt ? formatKstDatetime(o.startAt) : '-'} ~ {o.endAt ? formatKstDatetime(o.endAt) : '-'}
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
                  {o.description && <div style={{ marginTop: 6, color: '#374151' }}>{o.description}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button onClick={() => beginEdit(o)} type="button" style={ghostBtn}>편집</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!ops.length && <div style={{ color: '#64748b' }}>등록된 오퍼레이션형 과제가 없습니다.</div>}
        </div>
      </section>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '8px 12px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '8px 12px',
  fontWeight: 600,
};
