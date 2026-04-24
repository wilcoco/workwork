import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';

interface ChatMsg {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
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
