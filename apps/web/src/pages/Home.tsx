import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

type WL = { id: string; title: string; excerpt: string; userName?: string; teamName?: string; date: string };
type FB = { id: string; subjectId: string; authorName?: string; content: string; createdAt: string };

export function Home() {
  const [worklogs, setWorklogs] = useState<WL[]>([]);
  const [comments, setComments] = useState<FB[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const wl = await apiJson<{ items: WL[] }>(`/api/worklogs/search?limit=40`);
        setWorklogs(wl.items || []);
      } catch (e: any) {
        setError('업무일지 로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const fb = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&limit=60`);
        setComments((fb.items || []).map((x: any) => ({ id: x.id, subjectId: x.subjectId, authorName: x.authorName, content: x.content, createdAt: x.createdAt })));
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>홈</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 업무일지</div>
          {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
            <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 8 }}>
              {worklogs.map((w) => (
                <div key={w.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                  <div style={{ fontSize: 12, color: '#475569' }}>{w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstDatetime(w.date)}</div>
                  {w.excerpt ? <div style={{ color: '#334155', marginTop: 4 }}>{w.excerpt}</div> : null}
                </div>
              ))}
              {!worklogs.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            </div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 댓글</div>
          <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 8 }}>
            {comments.map((c) => (
              <div key={c.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstDatetime(c.createdAt)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
              </div>
            ))}
            {!comments.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
