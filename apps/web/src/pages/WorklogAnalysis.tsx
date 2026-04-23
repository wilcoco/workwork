import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';

interface DataSource {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  createdAt: string;
}

interface ChatMsg {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export function WorklogAnalysis() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  // Data sources (SharePoint + company data)
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // SharePoint files
  const [sharePointFiles, setSharePointFiles] = useState<any[]>([]);
  const [loadingSharePoint, setLoadingSharePoint] = useState(false);

  // Chat
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [asking, setAsking] = useState(false);

  // Tab
  const [tab, setTab] = useState<'sharepoint' | 'data' | 'chat'>('sharepoint');

  useEffect(() => { loadDataSources(); loadChats(); }, []);

  async function loadDataSources() {
    setLoadingData(true);
    try {
      const res = await apiJson<DataSource[]>('/api/company-data');
      setDataSources(res || []);
    } catch (e: any) {
      console.error('Failed to load data sources:', e?.message);
    } finally {
      setLoadingData(false);
    }
  }

  async function loadSharePointFiles() {
    setLoadingSharePoint(true);
    try {
      const res = await apiJson<{ files: any[] }>(`/api/sharepoint-sync/files?userId=${encodeURIComponent(userId)}`);
      setSharePointFiles(res.files || []);
    } catch (e: any) {
      console.error('Failed to load SharePoint files:', e?.message);
      alert(`SharePoint 파일 목록 로드 실패: ${e?.message}`);
    } finally {
      setLoadingSharePoint(false);
    }
  }

  async function syncSharePointFile(fileId: string) {
    try {
      const res = await apiFetch('/api/sharepoint-sync/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, fileId }),
      });
      if (!res.ok) throw new Error('동기화 실패');
      const data = await res.json();
      alert(`동기화 완료: ${data.entry.title}`);
      loadDataSources(); // Refresh data sources
      loadSharePointFiles(); // Refresh SharePoint files
    } catch (e: any) {
      alert(`동기화 실패: ${e?.message}`);
    }
  }

  async function syncAllSharePointFiles() {
    const fileIds = sharePointFiles.map((f) => f.id);
    if (fileIds.length === 0) {
      alert('동기화할 파일이 없습니다.');
      return;
    }
    try {
      const res = await apiFetch('/api/sharepoint-sync/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, fileIds }),
      });
      if (!res.ok) throw new Error('일괄 동기화 실패');
      const data = await res.json();
      alert(`동기화 완료: 성공 ${data.success}개, 실패 ${data.failed}개`);
      loadDataSources();
      loadSharePointFiles();
    } catch (e: any) {
      alert(`일괄 동기화 실패: ${e?.message}`);
    }
  }

  async function loadChats() {
    if (!userId) return;
    try {
      const res = await apiJson<ChatMsg[]>(`/api/company-data/chats?userId=${encodeURIComponent(userId)}`);
      setChatHistory(res || []);
    } catch {}
  }

  async function askQuestion() {
    if (!question.trim() || !userId) return;
    setAsking(true);
    try {
      const res = await apiFetch('/api/company-data/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, question }),
      });
      if (!res.ok) throw new Error('질문 실패');
      const data = await res.json();
      setChatHistory((prev) => [{ id: Date.now().toString(), question, answer: data.answer, createdAt: new Date().toISOString() }, ...prev]);
      setQuestion('');
    } catch (e: any) {
      alert(`질문 실패: ${e?.message}`);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">과거 업무일지 분석</h1>
      <p className="text-gray-600 mb-6">SharePoint 파일과 회사 데이터를 AI로 분석하여 과거 업무일지를 검색하고 질의할 수 있습니다.</p>

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          className={`px-4 py-2 ${tab === 'sharepoint' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}
          onClick={() => setTab('sharepoint')}
        >
          SharePoint 동기화
        </button>
        <button
          className={`px-4 py-2 ${tab === 'data' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}
          onClick={() => setTab('data')}
        >
          데이터 소스
        </button>
        <button
          className={`px-4 py-2 ${tab === 'chat' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}
          onClick={() => setTab('chat')}
        >
          AI 질의
        </button>
      </div>

      {/* SharePoint Tab */}
      {tab === 'sharepoint' && (
        <div>
          <div className="mb-4 flex gap-2">
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={loadSharePointFiles}
              disabled={loadingSharePoint}
            >
              {loadingSharePoint ? '로딩 중...' : 'SharePoint 파일 목록 가져오기'}
            </button>
            {sharePointFiles.length > 0 && (
              <button
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                onClick={syncAllSharePointFiles}
              >
                전체 동기화 ({sharePointFiles.length}개)
              </button>
            )}
          </div>

          {sharePointFiles.length === 0 && !loadingSharePoint && (
            <div className="text-center py-8 text-gray-500">
              SharePoint 파일 목록을 가져오세요.
            </div>
          )}

          <div className="space-y-3">
            {sharePointFiles.map((file) => (
              <div key={file.id} className="border rounded-lg p-4 flex justify-between items-center">
                <div>
                  <div className="font-semibold">{file.name}</div>
                  <div className="text-sm text-gray-500">{new Date(file.lastModified).toLocaleDateString()}</div>
                </div>
                <button
                  className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                  onClick={() => syncSharePointFile(file.id)}
                >
                  동기화
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Sources Tab */}
      {tab === 'data' && (
        <div>
          {loadingData ? (
            <div className="text-center py-8">로딩 중...</div>
          ) : dataSources.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              동기화된 데이터가 없습니다. SharePoint 파일을 동기화하세요.
            </div>
          ) : (
            <div className="space-y-3">
              {dataSources.map((source) => (
                <div key={source.id} className="border rounded-lg p-4">
                  <div className="font-semibold">{source.title}</div>
                  <div className="text-sm text-gray-500">{source.fileName}</div>
                  {source.description && <div className="text-sm text-gray-600 mt-1">{source.description}</div>}
                  <div className="text-xs text-gray-400 mt-2">{new Date(source.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat Tab */}
      {tab === 'chat' && (
        <div>
          <div className="mb-4">
            <textarea
              className="w-full border rounded-lg p-3"
              rows={3}
              placeholder="SharePoint 파일이나 회사 데이터에 대해 질문하세요..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              onClick={askQuestion}
              disabled={asking || !question.trim()}
            >
              {asking ? '분석 중...' : '질문하기'}
            </button>
          </div>

          <div className="space-y-4">
            {chatHistory.map((msg) => (
              <div key={msg.id} className="border rounded-lg p-4">
                <div className="font-semibold text-sm mb-2">Q: {msg.question}</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{msg.answer}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
