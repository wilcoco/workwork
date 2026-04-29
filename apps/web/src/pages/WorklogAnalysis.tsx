import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, apiJson } from '../lib/api';

interface ChatMsg {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  keywords?: string[];
  sourceFiles?: { name: string; url: string }[];
  sources?: number;
  debug?: any;
  provider?: 'openai' | 'claude' | 'claude-opus';
}

type Provider = 'openai' | 'claude' | 'claude-opus';

export function WorklogAnalysis() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  // Chat
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [asking, setAsking] = useState<Provider | null>(null);
  const [mode, setMode] = useState<'summary' | 'deep'>('deep');
  const [isExecOrAbove, setIsExecOrAbove] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadChats();
    (async () => {
      if (!userId) return;
      try {
        const me = await apiJson<{ isExecOrAbove?: boolean }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setIsExecOrAbove(Boolean(me?.isExecOrAbove));
      } catch {
        setIsExecOrAbove(false);
      }
    })();
  }, []);

  async function loadChats() {
    if (!userId) return;
    try {
      const res = await apiJson<ChatMsg[]>(`/api/company-data/chats?userId=${encodeURIComponent(userId)}&source=worklog-analysis`);
      setChatHistory(res || []);
    } catch {}
  }

  async function askQuestion(provider: Provider) {
    if (!question.trim() || !userId) return;
    setAsking(provider);
    try {
      const res = await apiFetch('/api/company-data/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, question, provider, mode, source: 'worklog-analysis' }),
      });
      if (!res.ok) throw new Error('질문 실패');
      const data = await res.json();
      const newId = data.chatId || Date.now().toString();
      setChatHistory((prev) => [{
        id: newId,
        question,
        answer: data.answer,
        createdAt: new Date().toISOString(),
        keywords: data.keywords,
        sourceFiles: data.sourceFiles,
        sources: data.sources,
        debug: data.debug,
        provider,
      }, ...prev]);
      setExpandedId(newId);
      setQuestion('');
    } catch (e: any) {
      alert(`질문 실패: ${e?.message}`);
    } finally {
      setAsking(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">업무 자료 분석</h1>
      <p className="text-gray-600 mb-4">SharePoint 문서와 업무일지를 AI로 검색하고 질의할 수 있습니다.</p>

      {/* Mode Toggle */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700">분석 모드:</span>
        <div className="inline-flex rounded-lg border bg-white p-1">
          <button
            onClick={() => setMode('deep')}
            className={`px-3 py-1 text-sm rounded transition ${mode === 'deep' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            심층 분석 (IATF 표준 기반)
          </button>
          <button
            onClick={() => setMode('summary')}
            className={`px-3 py-1 text-sm rounded transition ${mode === 'summary' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            간단 요약
          </button>
        </div>
        <span className="text-xs text-gray-500">
          {mode === 'deep' ? 'IATF 16949 등 표준을 인용해 Gap 분석·개선 제안을 제공합니다' : '자료 내용 요약 수준으로만 답변합니다'}
        </span>
      </div>

      {/* Chat Section */}
      <div className="mb-6">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !asking && askQuestion('openai')}
            placeholder="질문을 입력하세요..."
            className="flex-1 border rounded-lg px-4 py-2"
            disabled={!!asking}
          />
          <button
            onClick={() => askQuestion('openai')}
            disabled={!!asking || !question.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg disabled:opacity-50"
            title="OpenAI GPT-4.1 (최신)"
          >
            {asking === 'openai' ? '분석 중...' : 'OpenAI'}
          </button>
          <button
            onClick={() => askQuestion('claude')}
            disabled={!!asking || !question.trim()}
            className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-lg disabled:opacity-50"
            title="Claude Opus 4 (최신)"
          >
            {asking === 'claude' ? '분석 중...' : 'Claude'}
          </button>
          {isExecOrAbove && (
            <button
              onClick={() => askQuestion('claude-opus')}
              disabled={!!asking || !question.trim()}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6 py-2 rounded-lg disabled:opacity-50 font-semibold shadow"
              title="Claude Opus 4 + Extended Thinking (임원 전용)"
            >
              {asking === 'claude-opus' ? '심도 분석 중... (최대 3분)' : 'Opus (심도)'}
            </button>
          )}
        </div>

        {/* Chat History — Google-style collapsible list */}
        <div className="space-y-2">
          {chatHistory.map((msg) => {
            const isOpen = expandedId === msg.id;
            const snippet = String(msg.answer || '')
              .replace(/[#*_`>\-]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 180);
            return (
            <div key={msg.id} className="border rounded-lg bg-white">
              {/* Collapsed row — title + snippet */}
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : msg.id)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[13px] text-gray-500 shrink-0">{new Date(msg.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {msg.provider && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      msg.provider === 'claude-opus' ? 'bg-purple-100 text-purple-700' :
                      msg.provider === 'claude' ? 'bg-orange-100 text-orange-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {msg.provider === 'claude-opus' ? 'Opus 심도' : msg.provider === 'claude' ? 'Claude' : 'OpenAI'}
                    </span>
                  )}
                  {typeof msg.sources === 'number' && msg.sources > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">참조 {msg.sources}건</span>
                  )}
                  <span className="ml-auto text-gray-400 text-xs">{isOpen ? '▲ 접기' : '▼ 펼치기'}</span>
                </div>
                <div className="text-[15px] font-semibold text-blue-700 line-clamp-2">{msg.question}</div>
                {!isOpen && (
                  <div className="text-[13px] text-gray-600 mt-1 line-clamp-2">{snippet}{snippet.length >= 180 ? '…' : ''}</div>
                )}
              </button>

              {!isOpen ? null : (
              <div className="px-4 pb-4">
              {/* Report card with clear top/bottom delimiters */}
              <div className="mt-1 border-2 border-gray-300 rounded-lg bg-white shadow-sm overflow-hidden">
                {/* Report Header */}
                <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white px-5 py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tracking-wider">📑 분석 보고서 (REPORT)</span>
                    {msg.provider && (
                      <span className="px-2 py-0.5 rounded bg-white/20 text-white text-[10px]">
                        {msg.provider === 'claude-opus' ? 'Claude Opus 4 (Extended Thinking)' : msg.provider === 'claude' ? 'Claude Opus 4' : 'GPT-4.1'}
                      </span>
                    )}
                  </div>
                  <span className="text-gray-300">{new Date(msg.createdAt).toLocaleString('ko-KR')}</span>
                </div>

                {/* Report Body */}
                <div className="px-6 py-5 text-gray-800 leading-relaxed
                    [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-3 [&_h1]:border-b-2 [&_h1]:border-gray-400 [&_h1]:pb-2 [&_h1]:text-center
                    [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-slate-800 [&_h2]:border-l-4 [&_h2]:border-slate-700 [&_h2]:pl-2
                    [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-slate-700
                    [&_p]:my-2.5 [&_p]:text-justify
                    [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2
                    [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2
                    [&_li]:my-1
                    [&_table]:border-collapse [&_table]:my-3 [&_table]:w-full
                    [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left
                    [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1
                    [&_blockquote]:border-l-4 [&_blockquote]:border-amber-400 [&_blockquote]:bg-amber-50 [&_blockquote]:pl-3 [&_blockquote]:py-2 [&_blockquote]:italic [&_blockquote]:text-gray-700 [&_blockquote]:my-3
                    [&_strong]:font-semibold [&_strong]:text-slate-900
                    [&_hr]:my-4 [&_hr]:border-gray-300
                    [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.answer}</ReactMarkdown>
                </div>

                {/* Report Footer */}
                <div className="bg-gray-50 border-t border-gray-200 px-5 py-2 text-[11px] text-gray-500 flex items-center justify-between">
                  <span>— 보고서 끝 (END OF REPORT) —</span>
                  <span>AI 분석 시스템</span>
                </div>
              </div>
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
              {msg.debug && (
                <details className="mt-2 text-xs text-gray-600">
                  <summary className="cursor-pointer">디버그 정보 ({msg.debug.path})</summary>
                  <pre className="bg-gray-50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(msg.debug, null, 2)}</pre>
                </details>
              )}
              </div>
              )}
            </div>
            );
          })}
          {chatHistory.length === 0 && (
            <div className="text-gray-500 text-center py-8">아직 질문이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
