import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { OneDriveFilePicker } from '../components/OneDriveFilePicker';

interface DataSource {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  content: string | null;
  openaiFileId: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
}

interface ChatMsg {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export function CompanyDataAI() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  // Data sources
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add data form
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addContent, setAddContent] = useState('');
  const [addFileUrl, setAddFileUrl] = useState('');
  const [addFileName, setAddFileName] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Chat
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [asking, setAsking] = useState(false);

  // Tab
  const [tab, setTab] = useState<'data' | 'chat'>('chat');

  useEffect(() => { loadData(); loadChats(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiJson<DataSource[]>('/api/company-data');
      setDataSources(res || []);
    } catch (e: any) {
      setError(e?.message || '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function loadChats() {
    if (!userId) return;
    try {
      const res = await apiJson<ChatMsg[]>(`/api/company-data/chats?userId=${encodeURIComponent(userId)}`);
      setChatHistory(res || []);
    } catch {}
  }

  async function handleAdd() {
    if (!addTitle.trim()) {
      setError('제목을 입력해주세요.');
      return;
    }
    if (!addContent.trim() && !addFileUrl.trim()) {
      setError('내용을 입력하거나 OneDrive 파일을 선택해주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson('/api/company-data', {
        method: 'POST',
        body: JSON.stringify({
          title: addTitle.trim(),
          description: addDesc.trim() || undefined,
          fileUrl: addFileUrl || '',
          fileName: addFileName || addTitle.trim(),
          content: addContent.trim() || undefined,
          uploadedById: userId,
        }),
      });
      setAddTitle(''); setAddDesc(''); setAddContent(''); setAddFileUrl(''); setAddFileName('');
      setShowAdd(false);
      await loadData();
    } catch (e: any) {
      setError(e?.message || '등록 실패');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      await apiJson(`/api/company-data/${id}`, { method: 'DELETE' });
      await loadData();
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    }
  }

  async function handleSaveContent(id: string) {
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/company-data/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editContent }),
      });
      setEditingId(null);
      await loadData();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function handleAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const res = await apiJson<{ answer: string; chatId: string }>('/api/company-data/ask', {
        method: 'POST',
        body: JSON.stringify({ question: question.trim(), userId }),
      });
      setChatHistory((prev) => [
        { id: res.chatId, question: question.trim(), answer: res.answer, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setQuestion('');
    } catch (e: any) {
      setError(e?.message || 'AI 질의 실패');
    } finally {
      setAsking(false);
    }
  }

  const oaiCount = dataSources.filter((d) => d.openaiFileId).length;
  const contentCount = dataSources.filter((d) => d.content?.trim()).length;

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 14, outline: 'none' };
  const btnPrimary: React.CSSProperties = { background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14 };
  const btnGhost: React.CSSProperties = { background: 'transparent', color: '#0F3D73', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>회사 데이터 AI 분석</h2>

      {/* Tab buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button
          className={tab === 'chat' ? 'btn btn-primary' : 'btn'}
          onClick={() => setTab('chat')}
          style={{ height: 36, padding: '0 16px', fontWeight: 600, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}
        >AI 질의</button>
        <button
          className={tab === 'data' ? 'btn btn-primary' : 'btn'}
          onClick={() => setTab('data')}
          style={{ height: 36, padding: '0 16px', fontWeight: 600, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}
        >자료 관리 ({dataSources.length})</button>
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {tab === 'chat' && (
        <div>
          {/* Status indicator */}
          <div style={{ marginBottom: 12, padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, color: '#64748b' }}>
            {oaiCount > 0 ? (
              <span style={{ color: '#16a34a' }}>AI에 {oaiCount}개 자료 등록됨 — 질문하면 자동으로 모든 자료를 검색합니다</span>
            ) : contentCount > 0 ? (
              <span style={{ color: '#d97706' }}>DB에 {contentCount}개 자료 내용 있음 (텍스트 기반 분석)</span>
            ) : (
              <span style={{ color: '#94a3b8' }}>등록된 자료가 없습니다. "자료 관리" 탭에서 먼저 등록하세요.</span>
            )}
          </div>

          {/* Question input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder="회사 데이터에 대해 질문하세요..."
              style={{ ...inputStyle, flex: 1 }}
              disabled={asking}
            />
            <button style={btnPrimary} onClick={handleAsk} disabled={asking || !question.trim()}>
              {asking ? '분석중…' : '질문'}
            </button>
          </div>

          {/* Chat history */}
          <div style={{ display: 'grid', gap: 16 }}>
            {chatHistory.map((c) => (
              <div key={c.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: '#f1f5f9', fontWeight: 600, fontSize: 14, color: '#334155' }}>
                  Q. {c.question}
                </div>
                <div style={{ padding: '12px 14px', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#1e293b' }}>
                  {c.answer}
                </div>
                <div style={{ padding: '4px 14px 8px', fontSize: 11, color: '#94a3b8' }}>
                  {new Date(c.createdAt).toLocaleString('ko-KR')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button style={btnPrimary} onClick={() => setShowAdd(true)}>+ 자료 등록</button>
          </div>

          {/* Add form */}
          {showAdd && (
            <div style={{ border: '1px solid #3b82f6', borderRadius: 12, padding: 16, marginBottom: 16, background: '#f0f9ff' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>새 자료 등록</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                <input type="text" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="자료 제목 (예: 2026년 1분기 매출현황)" style={inputStyle} />
                <input type="text" value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="설명 (선택)" style={inputStyle} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button style={btnGhost} onClick={() => setShowFilePicker(true)}>OneDrive에서 파일 선택 (선택)</button>
                  {addFileName && <span style={{ fontSize: 13, color: '#475569' }}>{addFileName}</span>}
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    자료 내용 (텍스트) — 이 내용이 OpenAI에 업로드되어 AI가 참조합니다
                  </label>
                  <textarea
                    value={addContent}
                    onChange={(e) => setAddContent(e.target.value)}
                    placeholder="Excel/문서 내용을 여기에 복사·붙여넣기 하세요.&#10;예: 월별 매출, 부서별 실적, KPI 현황 등&#10;&#10;내용을 입력하면 OpenAI에 자동 업로드됩니다."
                    rows={10}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button style={btnGhost} onClick={() => setShowAdd(false)}>취소</button>
                  <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={handleAdd} disabled={saving}>
                    {saving ? 'OpenAI 업로드 중…' : '등록'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>불러오는 중…</div>
          ) : dataSources.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 14, background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              등록된 자료가 없습니다.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {dataSources.map((d) => (
                <div key={d.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{d.title}</span>
                    {d.openaiFileId ? (
                      <span style={{ fontSize: 11, color: '#16a34a', background: '#f0fdf4', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>AI 등록됨</span>
                    ) : d.content?.trim() ? (
                      <span style={{ fontSize: 11, color: '#d97706', background: '#fffbeb', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>텍스트만</span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8', background: '#f8fafc', padding: '2px 8px', borderRadius: 6 }}>내용 없음</span>
                    )}
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(d.createdAt).toLocaleDateString('ko-KR')}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{d.uploadedBy?.name}</span>
                  </div>
                  {d.description && <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{d.description}</div>}
                  {d.fileUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0F3D73', textDecoration: 'underline' }}>{d.fileName}</a>
                    </div>
                  )}

                  {editingId === d.id ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={8}
                        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
                      />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                        <button style={btnGhost} onClick={() => setEditingId(null)}>취소</button>
                        <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={() => handleSaveContent(d.id)} disabled={saving}>
                          {saving ? '업로드 중…' : '저장 (OpenAI 재업로드)'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {d.content ? (
                        <div style={{ fontSize: 12, color: '#475569', background: '#f8fafc', borderRadius: 8, padding: 10, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', marginBottom: 6 }}>
                          {d.content.slice(0, 500)}{d.content.length > 500 ? '…' : ''}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 6 }}>내용 미입력 — 내용을 입력하면 OpenAI에 업로드되어 AI 질의에 활용됩니다</div>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={{ ...btnGhost, fontSize: 12, padding: '4px 12px' }} onClick={() => { setEditingId(d.id); setEditContent(d.content || ''); }}>
                          {d.content ? '내용 편집' : '내용 입력'}
                        </button>
                        <button
                          style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                          onClick={() => handleDelete(d.id)}
                        >삭제</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showFilePicker && (
        <OneDriveFilePicker
          userId={userId}
          multiple={false}
          onSelect={(files) => {
            if (files.length) {
              setAddFileUrl(files[0].url);
              setAddFileName(files[0].name);
            }
          }}
          onClose={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}
