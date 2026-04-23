import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';

interface WorklogSummary {
  id: string;
  date: string;
  content: string;
  summary: string | null;
  aiAnalysis: string | null;
  user: { id: string; name: string };
}

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

  // Worklog summaries
  const [worklogs, setWorklogs] = useState<WorklogSummary[]>([]);
  const [loadingWorklogs, setLoadingWorklogs] = useState(false);
  const [selectedWorklog, setSelectedWorklog] = useState<WorklogSummary | null>(null);

  // Data sources (SharePoint + company data)
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Chat
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [asking, setAsking] = useState(false);

  // Tab
  const [tab, setTab] = useState<'worklogs' | 'data' | 'chat'>('worklogs');

  useEffect(() => { loadWorklogs(); loadDataSources(); loadChats(); }, []);

  async function loadWorklogs() {
    setLoadingWorklogs(true);
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3); // Last 3 months
      const res = await apiJson<WorklogSummary[]>(
        `/api/worklogs?startDate=${startDate.toISOString().split('T')[0]}&limit=100`
      );
      setWorklogs(res || []);
    } catch (e: any) {
      console.error('Failed to load worklogs:', e?.message);
    } finally {
      setLoadingWorklogs(false);
    }
  }

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

  async function loadChats() {
    if (!userId) return;
    try {
      const res = await apiJson<ChatMsg[]>(`/api/company-data/chats?userId=${encodeURIComponent(userId)}`);
      setChatHistory(res || []);
    } catch {}
  }

  async function generateWorklogSummary(worklogId: string) {
    try {
      const res = await apiFetch(`/api/worklogs/${worklogId}/ai-summary`, { method: 'POST' });
      if (!res.ok) throw new Error('요약 생성 실패');
      const data = await res.json();
      setSelectedWorklog((prev) => prev ? { ...prev, summary: data.summary, aiAnalysis: data.aiAnalysis } : null);
      loadWorklogs(); // Refresh list
    } catch (e: any) {
      alert(`요약 생성 실패: ${e?.message}`);
    }
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

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          className={`px-4 py-2 ${tab === 'worklogs' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}
          onClick={() => setTab('worklogs')}
        >
          업무일지
        </button>
        <button
          className={`px-4 py-2 ${tab === 'data' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}
          onClick={() => setTab('data')}
        >
          데이터 소스 (SharePoint)
        </button>
        <button
          className={`px-4 py-2 ${tab === 'chat' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}
          onClick={() => setTab('chat')}
        >
          AI 질의
        </button>
      </div>

      {/* Worklogs Tab */}
      {tab === 'worklogs' && (
        <div>
          {loadingWorklogs ? (
            <div className="text-center py-8">로딩 중...</div>
          ) : (
            <div className="space-y-4">
              {worklogs.map((worklog) => (
                <div key={worklog.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-semibold">{worklog.date}</div>
                      <div className="text-sm text-gray-500">{worklog.user.name}</div>
                    </div>
                    <button
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                      onClick={() => generateWorklogSummary(worklog.id)}
                    >
                      AI 요약
                    </button>
                  </div>
                  <div className="text-sm text-gray-700 line-clamp-3">{worklog.content}</div>
                  {(worklog.summary || worklog.aiAnalysis) && (
                    <div className="mt-3 p-3 bg-blue-50 rounded">
                      <div className="font-semibold text-sm mb-1">AI 요약</div>
                      <div className="text-sm">{worklog.summary || worklog.aiAnalysis}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Data Sources Tab */}
      {tab === 'data' && (
        <div>
          <div className="mb-4 p-4 bg-yellow-50 rounded">
            <div className="font-semibold mb-2">SharePoint 파일 동기화</div>
            <div className="text-sm text-gray-600 mb-3">
              SharePoint 파일을 자동으로 OpenAI vector store에 동기화합니다.
            </div>
            <button
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              onClick={async () => {
                try {
                  const res = await apiJson<{ files: any[] }>(`/api/sharepoint-sync/files?userId=${encodeURIComponent(userId)}`);
                  alert(`${res.files.length}개 파일 발견`);
                } catch (e: any) {
                  alert(`파일 목록 로드 실패: ${e?.message}`);
                }
              }}
            >
              SharePoint 파일 목록 가져오기
            </button>
          </div>

          {loadingData ? (
            <div className="text-center py-8">로딩 중...</div>
          ) : (
            <div className="space-y-3">
              {dataSources.map((source) => (
                <div key={source.id} className="border rounded-lg p-3">
                  <div className="font-semibold">{source.title}</div>
                  <div className="text-sm text-gray-500">{source.fileName}</div>
                  {source.description && <div className="text-sm text-gray-600 mt-1">{source.description}</div>}
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
              placeholder="업무일지나 데이터 소스에 대해 질문하세요..."
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
