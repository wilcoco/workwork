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
  const [siteId, setSiteId] = useState<string>('');
  const [hostname, setHostname] = useState('cams2002.sharepoint.com');
  const [sitePath, setSitePath] = useState('/sites/msteams_03d426');
  const [listName, setListName] = useState('WorkReports'); // SharePoint list name
  const [startDate, setStartDate] = useState(''); // Filter by start date
  const [limit, setLimit] = useState(100); // Default limit to 100 items
  const [listId, setListId] = useState<string>(''); // SharePoint list ID

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

  async function getSiteId() {
    if (!hostname || !sitePath) {
      alert('hostname과 sitePath를 입력하세요.');
      return;
    }
    try {
      const res = await apiJson<{ id: string; name: string; webUrl: string }>(
        `/api/sharepoint-sync/site-id?userId=${encodeURIComponent(userId)}&hostname=${encodeURIComponent(hostname)}&sitePath=${encodeURIComponent(sitePath)}`
      );
      setSiteId(res.id);
      alert(`사이트 ID 가져오기 성공: ${res.name} (${res.id})`);
    } catch (e: any) {
      alert(`사이트 ID 가져오기 실패: ${e?.message}`);
    }
  }

  async function loadSharePointFiles() {
    if (!siteId) {
      alert('먼저 사이트 ID를 가져오세요.');
      return;
    }
    setLoadingSharePoint(true);
    try {
      const url = listName
        ? `/api/sharepoint-sync/files?userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}&listName=${encodeURIComponent(listName)}&limit=${limit}${startDate ? `&startDate=${encodeURIComponent(startDate)}` : ''}`
        : `/api/sharepoint-sync/files?userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}&limit=${limit}${startDate ? `&startDate=${encodeURIComponent(startDate)}` : ''}`;
      const res = await apiJson<{ files?: any[]; items?: any[]; total: number; listId?: string }>(url);
      const items = res.files || res.items || [];
      setSharePointFiles(items);
      if (res.listId) setListId(res.listId);
      alert(`${items.length}개 항목 발견 (최근 ${limit}개)${startDate ? ` (${startDate} 이후)` : ''}`);
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
        body: JSON.stringify({ userId, fileId, siteId, listId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`동기화 실패 (${res.status}): ${text}`);
      }
      alert('동기화 완료');
      loadDataSources();
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
      const response = await apiFetch('/api/sharepoint-sync/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, fileIds, siteId, listId }),
      });

      if (!response.ok) {
        throw new Error(`동기화 실패: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('응답을 읽을 수 없습니다');
      }

      // 10분 타임아웃
      const timeoutId = setTimeout(() => {
        reader.cancel();
        alert('일괄 동기화 시간 초과 (10분). 일부 항목만 동기화되었을 수 있습니다.');
      }, 600000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timeoutId);
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') {
              console.log(`진행률: ${data.completed}/${data.total} (성공: ${data.success}, 실패: ${data.failed})`);
            } else if (data.type === 'complete') {
              clearTimeout(timeoutId);
              alert(`동기화 완료: 성공 ${data.success}개, 실패 ${data.failed}개`);
              loadDataSources();
              loadSharePointFiles();
              return;
            } else if (data.type === 'error') {
              clearTimeout(timeoutId);
              alert(`동기화 오류: ${data.message}`);
              return;
            }
          }
        }
      }
    } catch (e: any) {
      alert(`동기화 실패: ${e?.message}`);
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
          <div className="mb-6 p-4 bg-gray-50 rounded">
            <div className="font-semibold mb-3">SharePoint 사이트 설정</div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">Hostname</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-2"
                  placeholder="cams2002.sharepoint.com"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Site Path</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-2"
                  placeholder="/sites/msteams_03d426"
                  value={sitePath}
                  onChange={(e) => setSitePath(e.target.value)}
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">List Name (선택사항 - SharePoint List인 경우)</label>
              <input
                type="text"
                className="w-full border rounded px-3 py-2"
                placeholder="WorkReports"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
              />
              <div className="text-xs text-gray-500 mt-1">비워두면 Drive 파일을 읽습니다.</div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">시작 날짜 필터 (선택사항)</label>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <div className="text-xs text-gray-500 mt-1">이 날짜 이후의 항목만 동기화합니다. 비워두면 전체 동기화.</div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">최대 항목 수 (기본: 100)</label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 100)}
                min="1"
                max="1000"
              />
              <div className="text-xs text-gray-500 mt-1">최근 N개 항목만 동기화합니다. 너무 많으면 시간이 오래 걸립니다.</div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                onClick={getSiteId}
              >
                사이트 ID 가져오기
              </button>
              {siteId && (
                <div className="flex items-center px-3 py-2 bg-green-50 text-green-700 rounded">
                  사이트 ID: {siteId.slice(0, 20)}...
                </div>
              )}
            </div>
          </div>

          <div className="mb-4 flex gap-2">
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={loadSharePointFiles}
              disabled={loadingSharePoint || !siteId}
            >
              {loadingSharePoint ? '로딩 중...' : '항목 확인'}
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
              {siteId ? '항목 확인 버튼을 클릭하세요.' : '먼저 사이트 ID를 가져오세요.'}
            </div>
          )}
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
