import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

// 변경 이력 (감사 로그) — 수정/삭제 작업의 행위자·시각·before/after 조회 (대표 전용)

type LogItem = {
  id: string;
  ts: string;
  subjectType: string;
  subjectId: string;
  activity: string;
  actorId: string | null;
  actorName: string | null;
  attrs: any;
};

const SUBJECT_LABELS: Record<string, string> = {
  Objective: '목표(Objective)',
  KeyResult: 'KR(지표)',
  KeyInitiative: '중점 추진 과제',
  KeyInitiativeProgress: '과제 진행기록',
  Worklog: '업무일지',
};

function subjectLabel(t: string) {
  return SUBJECT_LABELS[t] || t;
}

function fmtTs(ts: string) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtVal(v: any): string {
  if (v == null || v === '') return '(없음)';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function DiffView({ attrs }: { attrs: any }) {
  if (!attrs) return <span style={{ color: '#94a3b8' }}>—</span>;
  // 수정: before/after, 삭제: snapshot
  if (attrs.before || attrs.after) {
    const keys = Array.from(new Set([...Object.keys(attrs.before || {}), ...Object.keys(attrs.after || {})]));
    if (!keys.length) return <span style={{ color: '#94a3b8' }}>—</span>;
    return (
      <div style={{ display: 'grid', gap: 2 }}>
        {keys.map((k) => (
          <div key={k} style={{ fontSize: 12 }}>
            <b style={{ color: '#475569' }}>{k}</b>:{' '}
            <span style={{ color: '#991b1b', textDecoration: 'line-through' }}>{fmtVal(attrs.before?.[k])}</span>
            {' → '}
            <span style={{ color: '#065f46', fontWeight: 600 }}>{fmtVal(attrs.after?.[k])}</span>
          </div>
        ))}
      </div>
    );
  }
  if (attrs.snapshot) {
    const s = attrs.snapshot;
    return (
      <div style={{ fontSize: 12, color: '#475569' }}>
        {Object.entries(s)
          .filter(([, v]) => v != null && v !== '')
          .slice(0, 6)
          .map(([k, v]) => (
            <span key={k} style={{ marginRight: 10 }}>
              <b>{k}</b>: {fmtVal(v)}
            </span>
          ))}
      </div>
    );
  }
  return <span style={{ fontSize: 12, color: '#64748b' }}>{JSON.stringify(attrs).slice(0, 150)}</span>;
}

export function AdminAuditLogs() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subjectTypes, setSubjectTypes] = useState<string[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [fType, setFType] = useState('');
  const [fAction, setFAction] = useState('');
  const [fActor, setFActor] = useState('');
  const [fDays, setFDays] = useState('30');

  useEffect(() => {
    (async () => {
      try {
        const st = await apiJson<{ items: string[] }>(`/api/admin/audit-logs/subject-types?userId=${encodeURIComponent(userId)}`);
        setSubjectTypes(st.items || []);
      } catch {}
      try {
        const us = await apiJson<Array<{ id: string; name: string }>>('/api/users');
        setUsers(us || []);
      } catch {}
    })();
  }, []);

  async function load(p = page) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ userId, page: String(p), pageSize: String(pageSize), days: fDays });
      if (fType) params.set('subjectType', fType);
      if (fAction) params.set('action', fAction);
      if (fActor) params.set('actorId', fActor);
      const res = await apiJson<{ total: number; items: LogItem[] }>(`/api/admin/audit-logs?${params}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      setError(`${e?.message || '조회 실패'}${e?.status ? ` (HTTP ${e.status})` : ''}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setPage(1); load(1); }, [fType, fAction, fActor, fDays]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const th: React.CSSProperties = { borderBottom: '2px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '8px 10px', fontSize: 13, verticalAlign: 'top' };
  const sel: React.CSSProperties = { padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>변경 이력 (감사 로그)</h2>
        <div style={{ fontSize: 12, color: '#64748b' }}>총 {total}건</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={fType} onChange={(e) => setFType(e.target.value)} style={sel}>
          <option value="">전체 대상</option>
          {subjectTypes.map((t) => <option key={t} value={t}>{subjectLabel(t)}</option>)}
        </select>
        <select value={fAction} onChange={(e) => setFAction(e.target.value)} style={sel}>
          <option value="">수정+삭제</option>
          <option value="updated">수정만</option>
          <option value="deleted">삭제만</option>
        </select>
        <select value={fActor} onChange={(e) => setFActor(e.target.value)} style={sel}>
          <option value="">전체 사용자</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={fDays} onChange={(e) => setFDays(e.target.value)} style={sel}>
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
          <option value="90">최근 90일</option>
          <option value="365">최근 1년</option>
        </select>
        <button onClick={() => load(page)} style={{ padding: '4px 12px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>새로고침</button>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>조회된 변경 이력이 없습니다.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>시각</th>
                <th style={th}>행위자</th>
                <th style={th}>대상</th>
                <th style={th}>작업</th>
                <th style={th}>변경 내용</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const isDelete = l.activity.endsWith('Deleted');
                return (
                  <tr key={l.id} style={{ background: isDelete ? '#FEF2F2' : undefined }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtTs(l.ts)}</td>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.actorName || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <div>{subjectLabel(l.subjectType)}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{l.subjectId.slice(0, 12)}…</div>
                    </td>
                    <td style={td}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, color: '#fff', background: isDelete ? '#dc2626' : '#3b82f6' }}>
                        {isDelete ? '삭제' : '수정'}
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: 520 }}><DiffView attrs={l.attrs} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
          <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); load(p); }} style={{ padding: '4px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', opacity: page <= 1 ? 0.4 : 1 }}>이전</button>
          <span style={{ fontSize: 13, color: '#475569' }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => { const p = page + 1; setPage(p); load(p); }} style={{ padding: '4px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}>다음</button>
        </div>
      )}
    </div>
  );
}
