import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * 업무일지 저장 직후 AI 보완 질문 + 지식 배지 심사 (공용).
 * 흐름: 질문 로딩 → (질문 있으면) 모달 문답 → 답변은 보충 기록으로 저장
 *      → 지식 배지 심사 → 합격 시 🏅 칭찬 → onDone()
 * 질문이 없거나 AI가 실패하면 조용히 onDone() — 작성 흐름을 막지 않는다.
 */
export function WorklogAiFollowup({ worklogId, onDone }: { worklogId: string; onDone: () => void }) {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [phase, setPhase] = useState<'loading' | 'ask' | 'praise' | 'feedback'>('loading');
  const [hint, setHint] = useState('');
  const [questions, setQuestions] = useState<Array<{ id: number; question: string }>>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [praise, setPraise] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/worklogs/${encodeURIComponent(worklogId)}/ai/questions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const d = r.ok ? await r.json() : { questions: [] };
        const qs = Array.isArray(d?.questions) ? d.questions : [];
        if (!alive) return;
        if (qs.length) { setQuestions(qs); setPhase('ask'); return; }
      } catch { /* ignore */ }
      if (alive) onDone();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worklogId]);

  async function kbReviewThenFinish() {
    try {
      const r = await apiFetch(`/api/worklogs/${encodeURIComponent(worklogId)}/ai/kb-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const d = r.ok ? await r.json() : null;
      if (d?.awarded) {
        setPraise(d.reason || '재사용 가능한 업무 지식으로 훌륭하게 정리되었습니다.');
        setPhase('praise');
        return;
      }
      // 엄격 심사 도입: 탈락 시 개선 힌트를 보여줘 다음 기록의 질을 끌어올린다
      if (d?.hint) {
        setHint(d.hint);
        setPhase('feedback');
        return;
      }
    } catch { /* ignore */ }
    onDone();
  }

  async function submitAnswers() {
    const qa = questions.map((q) => ({ q: q.question, a: (answers[q.id] || '').trim() })).filter((x) => x.a);
    setSaving(true);
    try {
      if (qa.length) {
        const content = '[AI 보완 문답]\n' + qa.map((x) => `Q. ${x.q}\nA. ${x.a}`).join('\n\n');
        await apiFetch(`/api/worklogs/${encodeURIComponent(worklogId)}/supplements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, content }),
        });
      }
    } catch { /* 보충 저장 실패해도 일지는 저장됨 */ }
    await kbReviewThenFinish();
    setSaving(false);
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 };

  if (phase === 'loading') {
    return (
      <div style={overlay}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '18px 24px', fontSize: 14, fontWeight: 600, color: '#334155' }}>
          ✓ 저장되었습니다 — AI가 보완 질문을 준비 중입니다...
        </div>
      </div>
    );
  }
  if (phase === 'feedback') {
    return (
      <div style={overlay}>
        <div style={{ background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%', padding: 26, textAlign: 'center', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 40 }}>📝</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#334155' }}>저장 완료 — 이번엔 🏅 인증 기준에 조금 못 미쳤어요</div>
          <div style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', lineHeight: 1.6, textAlign: 'left' }}>
            💡 {hint}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>🏅은 원인·기준·절차처럼 다른 구성원이 재사용할 수 있는 지식에 부여됩니다. 보완 질문에 실제 경험으로 답하면 인증 확률이 크게 올라갑니다.</div>
          <button type="button" className="btn btn-primary" onClick={onDone}>확인</button>
        </div>
      </div>
    );
  }
  if (phase === 'praise') {
    return (
      <div style={overlay}>
        <div style={{ background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%', padding: 26, textAlign: 'center', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 44 }}>🏅</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0F3D73' }}>훌륭한 업무 지식 정리입니다!</div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{praise}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>이 일지에 지식 배지가 달렸고, 지식 정리 랭킹에 집계됩니다.</div>
          <button type="button" className="btn btn-primary" onClick={onDone}>확인</button>
        </div>
      </div>
    );
  }
  return (
    <div style={overlay}>
      <div style={{ background: '#fff', borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20, display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>✓ 업무일지가 저장되었습니다</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          이 기록이 <b>회사의 지식</b>이 되도록 AI가 몇 가지만 여쭤봅니다. <b>아는 것만 짧게</b> 답해주세요 — 답변은 보충 기록으로 함께 남고, 잘 정리된 일지에는 🏅 지식 배지가 달립니다. (건너뛰어도 됩니다)
        </div>
        {questions.map((q) => (
          <div key={q.id} style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Q. {q.question}</div>
            <textarea rows={2} value={answers[q.id] || ''} placeholder="한두 문장이면 충분합니다 (모르면 비워두세요)"
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={saving}
            onClick={async () => { setSaving(true); await kbReviewThenFinish(); setSaving(false); }}>건너뛰기</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submitAnswers()}>
            {saving ? '저장 중...' : '답변 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
