import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

type WorkManualDto = {
  id?: string;
  userId?: string;
  title: string;
  content?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export function WorkManuals() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  const [items, setItems] = useState<WorkManualDto[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editing, setEditing] = useState<WorkManualDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const selected = useMemo(() => {
    if (!editing) return null;
    return editing;
  }, [editing]);

  const loadList = useCallback(async (openId?: string) => {
    if (!userId) {
      setItems([]);
      setSelectedId('');
      setEditing(null);
      return;
    }
    setLoading(true);
    try {
      const r = await apiJson<{ items: WorkManualDto[] }>(`/api/work-manuals?userId=${encodeURIComponent(userId)}`);
      const rows = Array.isArray(r?.items) ? r.items : [];
      setItems(rows);

      const nextId = String(openId || selectedId || rows?.[0]?.id || '').trim();
      if (nextId) {
        const found = rows.find((x) => String(x.id) === nextId) || null;
        if (found) {
          setSelectedId(String(found.id));
          setEditing({ ...found, content: found.content || '' });
          return;
        }
      }
      if (rows.length) {
        setSelectedId(String(rows[0].id || ''));
        setEditing({ ...rows[0], content: rows[0].content || '' });
      } else {
        setSelectedId('');
        setEditing(null);
      }
    } catch {
      setItems([]);
      setSelectedId('');
      setEditing(null);
    } finally {
      setLoading(false);
    }
  }, [selectedId, userId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function newManual() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    setSelectedId('');
    setEditing({ title: '', content: '' });
  }

  function editManual(m: WorkManualDto) {
    setSelectedId(String(m.id || ''));
    setEditing({ ...m, content: m.content || '' });
  }

  async function save() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing) return;
    const title = String(editing.title || '').trim();
    if (!title) {
      alert('업무명을 입력하세요.');
      return;
    }
    const content = String(editing.content || '');
    setSaving(true);
    try {
      if (editing.id) {
        await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}`, {
          method: 'PUT',
          body: JSON.stringify({ userId, title, content }),
        });
        await loadList(String(editing.id));
      } else {
        const created = await apiJson<WorkManualDto>(`/api/work-manuals`, {
          method: 'POST',
          body: JSON.stringify({ userId, title, content }),
        });
        await loadList(String(created?.id || ''));
      }
      alert('저장되었습니다.');
    } catch (e: any) {
      alert(e?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing?.id) return;
    const ok = confirm('이 메뉴얼을 삭제할까요?');
    if (!ok) return;
    try {
      await apiJson(`/api/work-manuals/${encodeURIComponent(String(editing.id))}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await loadList('');
      alert('삭제되었습니다.');
    } catch (e: any) {
      alert(e?.message || '삭제에 실패했습니다.');
    }
  }

  async function aiToBpmn() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!editing?.id) {
      alert('먼저 메뉴얼을 저장해 주세요.');
      return;
    }
    setAiLoading(true);
    try {
      const r = await apiJson<{ title: string; bpmnJson: any }>(`/api/work-manuals/${encodeURIComponent(String(editing.id))}/ai/bpmn`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      const tmplTitle = String(r?.title || '').trim();
      const bpmnJson = r?.bpmnJson;
      if (!tmplTitle || !bpmnJson) throw new Error('AI 응답이 올바르지 않습니다.');

      const ok = confirm(`AI가 BPMN 초안을 만들었습니다.\n\n- 템플릿 제목: ${tmplTitle}\n\n이 초안으로 프로세스 템플릿을 생성할까요?`);
      if (!ok) return;

      const created = await apiJson<any>(`/api/process-templates`, {
        method: 'POST',
        body: JSON.stringify({
          title: tmplTitle,
          description: '',
          type: 'PROJECT',
          ownerId: userId,
          actorId: userId,
          visibility: 'PRIVATE',
          bpmnJson,
          tasks: [],
        }),
      });
      const id = String(created?.id || '').trim();
      if (!id) throw new Error('템플릿 생성 응답이 올바르지 않습니다.');
      alert('프로세스 템플릿이 생성되었습니다.');
      nav(`/process/templates?openId=${encodeURIComponent(id)}`);
    } catch (e: any) {
      alert(e?.message || 'AI BPMN 생성에 실패했습니다.');
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' as any }}>
        <h2 style={{ margin: 0 }}>업무 메뉴얼</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as any }}>
          <button className="btn btn-outline" type="button" onClick={newManual}>새 메뉴얼</button>
          <button className="btn" type="button" onClick={save} disabled={saving || loading || !editing}>{saving ? '저장중…' : '저장'}</button>
          <button className="btn btn-outline" type="button" onClick={remove} disabled={!editing?.id}>삭제</button>
          <button className="btn" type="button" onClick={aiToBpmn} disabled={!editing?.id || aiLoading}>{aiLoading ? 'AI 생성중…' : 'AI로 BPMN 생성'}</button>
        </div>
      </div>

      {!userId ? (
        <div style={{ color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, background: '#FFFFFF', padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontWeight: 800 }}>내 메뉴얼</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{loading ? '로딩…' : `${items.length}개`}</div>
            </div>
            <div style={{ display: 'grid', gap: 6, maxHeight: '70vh', overflowY: 'auto' }}>
              {items.map((m) => {
                const active = String(m.id || '') === String(selectedId || '');
                const title = String(m.title || '').trim() || '(제목 없음)';
                const excerpt = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
                return (
                  <button
                    key={String(m.id)}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => editManual(m)}
                    style={{
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      border: active ? '1px solid #0F3D73' : '1px solid transparent',
                      background: active ? '#EFF6FF' : 'transparent',
                      padding: '10px 10px',
                      borderRadius: 10,
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{title}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{excerpt}</div>
                  </button>
                );
              })}
              {!items.length && !loading && (
                <div style={{ color: '#64748b', fontSize: 13 }}>아직 메뉴얼이 없습니다. “새 메뉴얼”을 눌러 작성해 주세요.</div>
              )}
            </div>
          </div>

          <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, background: '#FFFFFF', padding: 12, display: 'grid', gap: 10 }}>
            {!selected ? (
              <div style={{ color: '#64748b' }}>왼쪽에서 메뉴얼을 선택하거나 새로 만들어 주세요.</div>
            ) : (
              <>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>업무명</div>
                  <input
                    value={selected.title}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                    placeholder="예: 금형 발주/관리"
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>업무 메뉴얼</div>
                  <textarea
                    value={String(selected.content || '')}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
                    placeholder="업무 목적, 입력/산출물, 단계별 절차, 담당/협조, 예외 처리, 참고 링크 등을 자유롭게 적어주세요."
                    rows={18}
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px', resize: 'vertical' as any }}
                  />
                </label>

                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
                  AI로 BPMN 생성 버튼은 이 메뉴얼 내용을 기반으로 프로세스 템플릿 초안을 생성합니다. 생성된 템플릿은 프로세스 템플릿 메뉴에서 수정/게시할 수 있습니다.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
