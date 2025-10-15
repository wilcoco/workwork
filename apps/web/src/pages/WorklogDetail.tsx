import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export function WorklogDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function run() {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/worklogs/${id}`);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = await res.json();
        if (!ignore) setData(json);
      } catch (e: any) {
        if (!ignore) setError(e.message || '로드 실패');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    if (id) run();
    return () => {
      ignore = true;
    };
  }, [id]);

  if (loading) return <div>로딩중...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (!data) return <div>데이터 없음</div>;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <h2>업무일지 상세</h2>
      <div><b>ID:</b> {data.id}</div>
      <div><b>Initiative:</b> {data.initiativeId}</div>
      <div><b>작성자:</b> {data.createdById}</div>
      <div><b>진척%:</b> {data.progressPct}</div>
      <div><b>소요시간(분):</b> {data.timeSpentMinutes}</div>
      <div><b>차단코드:</b> {data.blockerCode || '-'}</div>
      {data.attachments?.contentHtml ? (
        <div>
          <b>내용(HTML):</b>
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, marginTop: 6 }}
               dangerouslySetInnerHTML={{ __html: data.attachments.contentHtml }} />
        </div>
      ) : (
        <div><b>노트:</b> {data.note || '-'}</div>
      )}
      {Array.isArray(data.attachments?.files) && data.attachments.files.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b>첨부:</b>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {data.attachments.files.map((f: any, i: number) => (
              <a key={(f.filename || f.url) + i} href={f.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                {f.name || f.filename || f.url}
              </a>
            ))}
          </div>
        </div>
      )}
      <div><b>작성일:</b> {data.createdAt}</div>
    </div>
  );
}
