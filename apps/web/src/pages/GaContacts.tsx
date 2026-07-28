import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

/** 📞 총무 비상연락망 — 총무성 업무별 담당자·업체 연락처 (조회=전 구성원, 수정=임원) */
type Row = { id: string; category: string; task: string; deptName: string; managerName: string; phone: string; vendorName: string; vendorPhone: string; note: string };

const EMPTY: Omit<Row, 'id'> = { category: '', task: '', deptName: '', managerName: '', phone: '', vendorName: '', vendorPhone: '', note: '' };

function Tel({ s }: { s: string }) {
  if (!s || s === '-') return <span style={{ color: '#cbd5e1' }}>-</span>;
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  return (
    <span>
      {parts.map((pn, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {/^[\d\-]+$/.test(pn) ? <a href={`tel:${pn.replace(/-/g, '')}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{pn}</a> : pn}
        </span>
      ))}
    </span>
  );
}

export function GaContacts() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState<null | (Partial<Row> & { isNew?: boolean })>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await apiJson<{ items: Row[] }>(`/api/ga-contacts`);
      setRows(r.items || []);
    } catch (e: any) { setError(e?.message || '조회 실패'); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!userId) return;
    apiJson<any>(`/api/users/me?userId=${encodeURIComponent(userId)}`)
      .then((me) => setCanEdit(['CEO', 'EXEC'].includes(String(me?.role || ''))))
      .catch(() => {});
  }, [userId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.category, r.task, r.deptName, r.managerName, r.phone, r.vendorName, r.vendorPhone, r.note].some((v) => String(v || '').toLowerCase().includes(t)));
  }, [rows, q]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.isNew) {
        await apiJson(`/api/ga-contacts`, { method: 'POST', body: JSON.stringify({ ...editing, actorId: userId }) });
      } else {
        await apiJson(`/api/ga-contacts/${encodeURIComponent(String(editing.id))}`, { method: 'PUT', body: JSON.stringify({ ...editing, actorId: userId }) });
      }
      setEditing(null);
      await load();
    } catch (e: any) { alert(e?.message || '저장 실패'); }
    finally { setSaving(false); }
  }

  async function remove(r: Row) {
    if (!confirm(`「${r.category} — ${r.task}」 항목을 삭제할까요?`)) return;
    try {
      await apiJson(`/api/ga-contacts/${encodeURIComponent(r.id)}?actorId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await load();
    } catch (e: any) { alert(e?.message || '삭제 실패'); }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13, verticalAlign: 'top' };

  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>📞 총무 비상연락망</h2>
          <div style={{ fontSize: 12, color: '#64748b' }}>총무성 업무별 담당자·협력업체 연락처 — 전화번호를 누르면 바로 연결됩니다</div>
        </div>
        <span style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 검색 (업무·이름·업체·번호...)"
          style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, minWidth: 240 }} />
        {canEdit && <button className="btn btn-sm btn-primary" onClick={() => setEditing({ ...EMPTY, isNew: true })}>+ 항목 추가</button>}
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'auto', maxHeight: '75vh' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th}>구분</th><th style={th}>내용</th><th style={th}>부서</th><th style={th}>담당자</th>
              <th style={th}>전화번호</th><th style={th}>업체명</th><th style={th}>업체전화</th><th style={th}>비고</th>
              {canEdit && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const newCat = i === 0 || filtered[i - 1].category !== r.category;
              return (
                <tr key={r.id} style={newCat ? { borderTop: '2px solid #cbd5e1' } : undefined}>
                  <td style={{ ...td, fontWeight: newCat ? 800 : 400, color: newCat ? '#0f3d73' : '#cbd5e1', whiteSpace: 'nowrap' }}>{newCat ? r.category : '〃'}</td>
                  <td style={td}>{r.task}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.deptName || '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.managerName || '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><Tel s={r.phone} /></td>
                  <td style={td}>{r.vendorName || '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><Tel s={r.vendorPhone} /></td>
                  <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{r.note || '-'}</td>
                  {canEdit && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...r })} title="수정">✏️</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void remove(r)} title="삭제">🗑</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!filtered.length && <tr><td style={td} colSpan={9}>검색 결과가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>총 {rows.length}건{q.trim() ? ` · 검색 결과 ${filtered.length}건` : ''} — 내용 변경이 필요하면 총무 담당 또는 임원에게 요청하세요.</div>

      {/* 편집 모달 (임원) */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 560, width: '100%', padding: 20, display: 'grid', gap: 8 }}>
            <b style={{ fontSize: 15 }}>{editing.isNew ? '항목 추가' : '항목 수정'}</b>
            {([['category', '구분 *'], ['task', '내용 *'], ['deptName', '부서'], ['managerName', '담당자'], ['phone', '전화번호 (여러 개는 / 로 구분)'], ['vendorName', '업체명'], ['vendorPhone', '업체전화'], ['note', '비고']] as Array<[keyof Row, string]>).map(([f, label]) => (
              <label key={f} style={{ display: 'grid', gap: 2, fontSize: 12, color: '#475569' }}>
                {label}
                <input value={String((editing as any)[f] || '')} onChange={(e) => setEditing((prev) => ({ ...prev!, [f]: e.target.value }))}
                  style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn" disabled={saving} onClick={() => setEditing(null)}>취소</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GaContacts;
