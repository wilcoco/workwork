import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

export function OkrInput() {
  const [userId, setUserId] = useState('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [parentKrs, setParentKrs] = useState<any[]>([]);
  const [parentKrId, setParentKrId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [myObjectives, setMyObjectives] = useState<any[]>([]);

  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oMonths, setOMonths] = useState<boolean[]>(() => Array(12).fill(false));

  const months2026 = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1)), []);
  function toggleOMonth(i: number) { setOMonths(prev => prev.map((v, idx) => idx === i ? !v : v)); }

  type Row = { title: string; metric: string; target: string; unit: string; months: boolean[] };
  const [rows, setRows] = useState<Row[]>([{ title: '', metric: '', target: '', unit: '', months: Array(12).fill(false) }] );
  function addRow() { setRows(prev => [...prev, { title: '', metric: '', target: '', unit: '', months: Array(12).fill(false) }]); }
  function removeRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)); }
  function toggleRMonth(r: number, m: number) {
    setRows(prev => prev.map((row, i) => i === r ? { ...row, months: row.months.map((v, j) => j === m ? !v : v) } : row));
  }

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setLoading(true);
        const me = await apiJson<{ id: string; role: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole((me.role as any) || '');
        const p = await apiJson<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`);
        setParentKrs(p.items || []);
        const mine = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
        setMyObjectives(mine.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  async function save() {
    try {
      setError(null);
      setSuccess(null);
      setSaving(true);
      if (!userId) throw new Error('userId');
      if (!oTitle) throw new Error('Objective 제목');
      const selO = oMonths.map((v, i) => v ? i : -1).filter(i => i >= 0);
      if (!selO.length) throw new Error('Objective 기간');
      if (myRole !== 'CEO' && !parentKrId) throw new Error('상위 O-KR');
      const validRows = rows.filter(r => r.title && r.metric && r.target !== '' && r.unit);
      if (!validRows.length) throw new Error('KR 최소 1개');

      const mStart = Math.min(...selO);
      const mEnd = Math.max(...selO);
      const s = new Date(2026, mStart, 1);
      const e = new Date(2026, mEnd + 1, 0);
      const periodStart = `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;
      const periodEnd = `${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,'0')}-${String(e.getDate()).padStart(2,'0')}`;

      const obj = await apiJson<{ id: string }>(`/api/okrs/objectives`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: oTitle, description: oDesc || undefined, periodStart, periodEnd, alignsToKrId: myRole === 'CEO' ? undefined : parentKrId }),
      });

      for (const r of validRows) {
        const kr = await apiJson<{ id: string }>(`/api/okrs/objectives/${encodeURIComponent(obj.id)}/krs`, {
          method: 'POST',
          body: JSON.stringify({ userId, title: r.title, metric: r.metric, target: Number(r.target), unit: r.unit }),
        });
        const sel = r.months.map((v, i) => v ? i : -1).filter(i => i >= 0);
        if (sel.length) {
          const ms = Math.min(...sel);
          const me = Math.max(...sel);
          const ss = new Date(2026, ms, 1);
          const ee = new Date(2026, me + 1, 0);
          const startAt = `${ss.getFullYear()}-${String(ss.getMonth()+1).padStart(2,'0')}-${String(ss.getDate()).padStart(2,'0')}`;
          const endAt = `${ee.getFullYear()}-${String(ee.getMonth()+1).padStart(2,'0')}-${String(ee.getDate()).padStart(2,'0')}`;
          await apiJson(`/api/initiatives`, {
            method: 'POST',
            body: JSON.stringify({ keyResultId: kr.id, ownerId: userId, title: r.title, startAt, endAt }),
          });
        }
      }

      setOTitle(''); setODesc(''); setOMonths(Array(12).fill(false)); setRows([{ title: '', metric: '', target: '', unit: '', months: Array(12).fill(false) }]); setParentKrId('');
      const mine = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
      setMyObjectives(mine.items || []);
      setSuccess('OKR이 저장되었습니다');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      setError(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12, maxWidth: 960, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>OKR 입력</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!userId || loading} onClick={() => window.location.reload()} className="btn btn-primary">새로고침</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>상위 선택</h3>
        <div style={card}>
          <div className="stack-1-2">
            <select value={myRole} onChange={async (e) => {
              const role = e.target.value as any;
              setMyRole(role);
              if (!userId) return;
              try {
                await apiJson(`/api/users/${encodeURIComponent(userId)}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
                const p = await apiJson<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`);
                setParentKrs(p.items || []);
              } catch {}
            }} style={{ ...input, appearance: 'auto' as any }}>
              <option value="">역할 선택</option>
              <option value="CEO">대표이사</option>
              <option value="EXEC">임원</option>
              <option value="MANAGER">팀장</option>
              <option value="INDIVIDUAL">팀원</option>
            </select>
            {myRole !== 'CEO' && (
              <select value={parentKrId} onChange={(e) => setParentKrId(e.target.value)} style={{ ...input, appearance: 'auto' as any }}>
                <option value="">상위 O-KR 선택</option>
                {parentKrs.map((kr) => (
                  <option key={kr.id} value={kr.id}>[{kr.objective?.orgUnit?.name || '-'}] {kr.objective?.title} / KR: {kr.title}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>개선목표(O)</h3>
        <div style={card}>
          <input value={oTitle} onChange={(e) => setOTitle(e.target.value)} placeholder="Objective 제목" style={input} />
          <textarea value={oDesc} onChange={(e) => setODesc(e.target.value)} placeholder="Objective 내용" style={{ ...input, minHeight: 80 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12, 32px)', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>기간(2026)</div>
            {months2026.map((_, i) => (
              <div key={`ol-${i}`} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{i + 1}</div>
            ))}
            <div style={{ gridColumn: '1 / span 1' }} />
            {oMonths.map((on, i) => (
              <div key={`om-${i}`} onClick={() => toggleOMonth(i)} style={{ width: 32, height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>주요 측정 지표(KR)</h3>
        <div style={card}>
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gap: 8, border: '1px dashed #e5e7eb', borderRadius: 8, padding: 8 }}>
                <div className="resp-2">
                  <input value={r.title} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, title: e.target.value } : rr))} placeholder={`KR ${i+1} 제목`} style={input} />
                  <input value={r.metric} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, metric: e.target.value } : rr))} placeholder="KR 내용/측정 기준" style={input} />
                </div>
                <div className="resp-3">
                  <input type="number" step="any" value={r.target} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, target: e.target.value } : rr))} placeholder="측정 수치" style={input} />
                  <input value={r.unit} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, unit: e.target.value } : rr))} placeholder="단위" style={input} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '140px repeat(12, 32px)', gap: 6, alignItems: 'center' }}>
                  <div />
                  {months2026.map((_, m) => (
                    <div key={`ml-${i}-${m}`} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{m + 1}</div>
                  ))}
                  <div style={{ gridColumn: '1 / span 1' }} />
                  {r.months.map((on, m) => (
                    <div key={`mm-${i}-${m}`} onClick={() => toggleRMonth(i, m)} style={{ width: 32, height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }} />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => removeRow(i)}>행 제거</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={addRow}>KR 행 추가</button>
            <button className="btn btn-primary" onClick={save} disabled={!userId || loading || saving}>{saving ? '저장중…' : '저장'}</button>
          </div>
        </div>
      </section>

      {success && (
        <div style={{ color: '#16a34a', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{success}</span>
          <Link to="/okr/tree" style={{ color: '#0ea5e9', textDecoration: 'underline' }}>OKR 조회</Link>
          <Link to="/me/goals" style={{ color: '#0ea5e9', textDecoration: 'underline' }}>내 목표</Link>
        </div>
      )}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>내 OKR 목록</h3>
        <div style={card}>
          <div style={{ display: 'grid', gap: 10 }}>
            {myObjectives.map((o) => (
              <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>목표</span>
                  <b>{o.title}</b>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{o.pillar || '-'}</span>
                </div>
                {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                  <ul style={{ marginLeft: 18 }}>
                    {o.keyResults.map((kr: any) => (
                      <li key={kr.id}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <div style={{ fontWeight: 600 }}>{o.title} / KR: {kr.title}</div>
                          <div style={{ color: '#334155' }}>({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {myObjectives.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>등록된 OKR이 없습니다.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

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
