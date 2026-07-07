import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';

/**
 * 내 업무 매뉴얼 — 전 구성원이 자기 업무를 자연어 매뉴얼로 입력하고,
 * 곧장 "프로세스 만들기"로 이어지는 진입점.
 */
type Manual = { id: string; title: string; content?: string; status: string; qualityScore?: number; createdAt: string; updatedAt: string };

const STD_TEMPLATE = [
  '### STEP S1 | (단계 이름)',
  '- taskType: WORKLOG   ← WORKLOG(업무일지) | APPROVAL(결재) | COOPERATION(타팀 요청)',
  '- 담당: (팀 또는 담당자)',
  '- 방법: (무엇을 어떻게 하는지)',
  '- 완료조건: (무엇이 되어 있어야 완료인지)',
  '- 기한: 시작 후 N일 이내',
  '',
  '### STEP S2 | (결재 단계라면)',
  '- taskType: APPROVAL',
  '- 결재선: (예: 팀장 → 공장장)',
  '- 반려 시: (예: S1로 돌아가 다시 작성)',
].join('\n');

export function MyManuals() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<Manual[]>([]);
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await apiJson<{ items: Manual[] }>(`/api/work-manuals?userId=${encodeURIComponent(userId)}`);
      setItems(r.items || []);
      // 프로세스화 여부: 내 매뉴얼을 원본으로 한 템플릿 존재 확인
      try {
        const tp = await apiJson<any[]>(`/api/process-templates?actorId=${encodeURIComponent(userId)}`);
        setProcessedIds(new Set((tp || []).map((t: any) => String(t.sourceManualId || '')).filter(Boolean)));
      } catch {}
    } catch (e: any) {
      toast(e?.message || '매뉴얼을 불러오지 못했습니다', 'error');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId]);

  async function save(thenProcess: boolean) {
    if (!title.trim() || !content.trim()) { toast('업무명과 내용을 입력하세요.', 'error'); return; }
    setSaving(true);
    try {
      const created = await apiJson<{ id: string }>(`/api/work-manuals`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: title.trim(), content: content.trim() }),
      });
      setTitle(''); setContent('');
      if (thenProcess && created?.id) {
        nav(`/process/from-manual?manualId=${encodeURIComponent(created.id)}`);
        return;
      }
      toast('매뉴얼이 저장되었습니다.', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message || '저장 실패', 'error');
    } finally { setSaving(false); }
  }

  if (!userId) return <div style={{ padding: 24, color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>내 업무 매뉴얼</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          내가 하는 업무를 평소 말하듯 적어주세요. 적은 매뉴얼은 바로 <b>프로세스</b>로 만들 수 있고, 전사 매뉴얼 자산이 됩니다.
        </div>
      </div>

      {/* 새 매뉴얼 작성 */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 14 }}>새 매뉴얼 작성</b>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="업무명 (예: 구매 발주 처리)" />
        <textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)}
          placeholder={'예: 자재가 필요하면 발주 요청서를 작성한다. 팀장이 승인하고, 반려되면 다시 작성한다...\n\n단계·담당·결재선·반려 시 처리·기한이 들어 있을수록 정확한 프로세스가 됩니다.'} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-outline"
            onClick={() => setContent((prev) => (prev.trim() ? prev + '\n\n' + STD_TEMPLATE : STD_TEMPLATE))}>📋 표준 양식 넣기</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => void save(false)} disabled={saving}>저장만</button>
          <button className="btn btn-primary" onClick={() => void save(true)} disabled={saving}>
            {saving ? '저장 중...' : '저장하고 바로 프로세스 만들기 →'}
          </button>
        </div>
      </div>

      {/* 내 매뉴얼 목록 */}
      <div style={{ display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 14 }}>내 매뉴얼 {items.length}개 {loading && <span style={{ fontWeight: 400, color: '#94a3b8' }}>· 로딩중</span>}</b>
        {items.map((m) => {
          const processed = processedIds.has(m.id);
          return (
            <div key={m.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, flex: 1, minWidth: 160 }}>{m.title}</span>
              {processed ? (
                <span style={{ fontSize: 11, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 999, padding: '2px 8px' }}>✓ 프로세스화 완료</span>
              ) : (
                <span style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 999, padding: '2px 8px' }}>프로세스화 전</span>
              )}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(m.updatedAt).toLocaleDateString()}</span>
              <button className="btn btn-sm" onClick={() => nav(`/manuals?openId=${encodeURIComponent(m.id)}`)}>열기</button>
              <button className="btn btn-sm btn-primary" onClick={() => nav(`/process/from-manual?manualId=${encodeURIComponent(m.id)}`)}>
                {processed ? '프로세스 다시 만들기' : '프로세스 만들기 →'}
              </button>
            </div>
          );
        })}
        {!items.length && !loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>아직 작성한 매뉴얼이 없습니다. 위에서 첫 매뉴얼을 작성해 보세요.</div>}
      </div>
    </div>
  );
}
