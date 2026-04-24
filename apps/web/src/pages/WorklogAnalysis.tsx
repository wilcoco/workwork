import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';

interface ChatMsg {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  keywords?: string[];
  sourceFiles?: { name: string; url: string }[];
  sources?: number;
}

export function WorklogAnalysis() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  // Chat
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [asking, setAsking] = useState(false);

  useEffect(() => { loadChats(); }, []);

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
      setChatHistory((prev) => [{
        id: Date.now().toString(),
        question,
        answer: data.answer,
        createdAt: new Date().toISOString(),
        keywords: data.keywords,
        sourceFiles: data.sourceFiles,
        sources: data.sources,
      }, ...prev]);
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
      <p className="text-gray-600 mb-6">SharePoint 문서와 업무일지를 AI로 검색하고 질의할 수 있습니다.</p>

      {/* Chat Section */}
      <div className="mb-6">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && askQuestion()}
            placeholder="질문을 입력하세요..."
            className="flex-1 border rounded-lg px-4 py-2"
            disabled={asking}
          />
          <button
            onClick={askQuestion}
            disabled={asking || !question.trim()}
            className="bg-blue-500 text-white px-6 py-2 rounded-lg disabled:opacity-50"
          >
            {asking ? '질문 중...' : '질문하기'}
          </button>
        </div>

        {/* Chat History */}
        <div className="space-y-4">
          {chatHistory.map((msg) => (
            <div key={msg.id} className="border rounded-lg p-4">
              <div className="font-semibold mb-2">Q: {msg.question}</div>
              <div className="text-gray-700 whitespace-pre-wrap">{msg.answer}</div>
              {msg.keywords && msg.keywords.length > 0 && (
                <div className="mt-3 text-xs">
                  <span className="text-gray-500">검색 키워드: </span>
                  {msg.keywords.map((k, i) => (
                    <span key={i} className="inline-block bg-blue-100 text-blue-700 px-2 py-0.5 rounded mr-1">{k}</span>
                  ))}
                </div>
              )}
              {msg.sourceFiles && msg.sourceFiles.length > 0 && (
                <div className="mt-2 text-xs">
                  <span className="text-gray-500">참조 문서 ({msg.sourceFiles.length}개): </span>
                  {msg.sourceFiles.map((f, i) => (
                    <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-block bg-green-100 text-green-700 px-2 py-0.5 rounded mr-1 hover:bg-green-200">{f.name}</a>
                  ))}
                </div>
              )}
              <div className="text-sm text-gray-500 mt-2">{new Date(msg.createdAt).toLocaleString('ko-KR')}</div>
            </div>
          ))}
          {chatHistory.length === 0 && (
            <div className="text-gray-500 text-center py-8">아직 질문이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
