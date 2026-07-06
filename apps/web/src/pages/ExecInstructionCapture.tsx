import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

// 경영지시 캡처: 텍스트 + 음성(STT). 음성은 브라우저 Web Speech(무키) 사용, 미지원 시 텍스트만.
export function ExecInstructionCapture() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recogRef = useRef<any>(null);
  const usedVoiceRef = useRef(false);

  const speechSupported = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function toggleVoice() {
    if (!speechSupported) { setError('이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트로 입력해 주세요.'); return; }
    if (listening) { try { recogRef.current?.stop(); } catch {} setListening(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.lang = 'ko-KR';
    r.interimResults = true;
    r.continuous = true;
    let finalChunk = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      setText((prev) => {
        // 이전 확정분 + 새 확정/중간
        const base = prev.replace(/\s*\[듣는 중\].*$/, '');
        return (base + finalChunk + (interim ? ` [듣는 중] ${interim}` : '')).trimStart();
      });
    };
    r.onerror = () => { setListening(false); };
    r.onend = () => { setListening(false); setText((prev) => prev.replace(/\s*\[듣는 중\].*$/, '')); };
    recogRef.current = r;
    usedVoiceRef.current = true;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

  async function submit() {
    const raw = text.replace(/\s*\[듣는 중\].*$/, '').trim();
    if (!raw) { setError('지시 내용을 입력해 주세요.'); return; }
    if (!userId) { setError('로그인이 필요합니다.'); return; }
    setSubmitting(true); setError(null);
    try {
      try { recogRef.current?.stop(); } catch {}
      const res = await apiJson<{ id: string }>('/api/exec-instructions', {
        method: 'POST',
        body: JSON.stringify({ authorId: userId, rawText: raw, source: usedVoiceRef.current ? 'VOICE' : 'TEXT' }),
      });
      nav(`/exec-instructions/${res.id}`);
    } catch (e: any) {
      setError(e?.message || '지시 생성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '4px 0' }}>경영지시 등록</h2>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
          지시를 말하거나 입력하면 AI가 실행 <b>꼭지 3~6개</b>로 분해합니다. (꼭지 = 굵직한 실행 매듭 · 순서와 결과만 관리)
        </p>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="예) 신차종 A 원가 절감 방안을 이달 안에 만들어라. 협력사 단가 재협의하고, 대체 소재 검토하고, 결과를 임원회의에 보고해라."
        rows={7}
        style={{ width: '100%', padding: 12, border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 15, lineHeight: 1.6, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          onClick={toggleVoice}
          style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid ' + (listening ? '#dc2626' : '#cbd5e1'), background: listening ? '#fef2f2' : '#fff', color: listening ? '#dc2626' : '#334155', cursor: 'pointer', fontWeight: 600 }}
        >
          {listening ? '⏹ 음성 입력 중지' : '🎤 음성으로 지시'}
        </button>
        {listening && <span style={{ color: '#dc2626', fontSize: 13 }}>● 듣는 중…</span>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
        >
          {submitting ? 'AI 분해 중…' : '지시 등록 · 꼭지 생성'}
        </button>
      </div>
      {!speechSupported && (
        <div style={{ color: '#94a3b8', fontSize: 12 }}>※ 음성 입력 미지원 브라우저입니다(모바일 크롬/사파리, 데스크톱 크롬 권장). 텍스트로 입력하셔도 됩니다.</div>
      )}
    </div>
  );
}
