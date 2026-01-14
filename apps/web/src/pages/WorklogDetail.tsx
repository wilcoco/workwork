import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { WorklogDocument } from '../components/WorklogDocument';

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
    <div style={{ maxWidth: 980, margin: '24px auto', padding: 12 }}>
      <WorklogDocument worklog={data} variant="full" />
    </div>
  );
}
