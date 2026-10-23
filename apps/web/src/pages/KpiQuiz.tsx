import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';

/**
 * 관리자 시험지 (3단계) — 데이터 연결된 KPI의 실제 수치로 매월 팀장에게 3문항(객관식 1·주관식 2)을 묻는다.
 * 탭: 내 시험지(응답·결과) / 전체 현황(임원·팀장: 열람·채점 확정) / 데이터 감각 점수(순위) / 출제 관리(임원)
 */
type Q = { no: number; type: 'CHOICE' | 'TEXT'; text: string; options?: string[]; answerIdx?: number; rubric?: string; points: number };
type Quiz = {
  id: string; keyResultId: string; year: number; month: number; status: string; respondentId: string; questions: Q[];
  dataSnapshot: { series: Array<{ year: number; month: number; value: number | null }>; target: number; unit: string; direction?: string; title: string; team: string };
  answers?: Array<{ no: number; choiceIdx?: number; text?: string }>; answeredAt?: string; aiGrading?: Array<{ no: number; score: number; max: number; feedback: string }>;
  aiScore?: number | null; finalScore?: number | null; gradeNote?: string | null; gradedAt?: string | null; dueAt: string;
  kr?: { title: string; unit: string; objective?: { orgUnit?: { name: string } } } | null; respondent?: { name: string } | null;
};
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff' };
const STATUS: Record<string, { t: string; c: string; bg: string }> = {
  OPEN: { t: '응답 대기', c: '#b45309', bg: '#fffbeb' }, ANSWERED: { t: 'AI 채점 · 확정 대기', c: '#1d4ed8', bg: '#eff6ff' }, GRADED: { t: '확정', c: '#15803d', bg: '#f0fdf4' }, SKIPPED: { t: '제외', c: '#94a3b8', bg: '#f8fafc' },
};
const fmt = (v: number | null | undefined, unit = '') => (v == null ? '-' : `${Math.round(v * 100) / 100}${unit}`);
const scoreColor = (s: number | null | undefined) => (s == null ? '#94a3b8' : s >= 80 ? '#15803d' : s >= 60 ? '#0369a1' : s >= 40 ? '#b45309' : '#b91c1c');

/** 월별 수치 미니 차트 */
function Series({ s, unit, hi }: { s: Quiz['dataSnapshot']['series']; unit: string; hi: { year: number; month: number } }) {
  const vals = s.map((x) => x.value).filter((v): v is number => v != null);
  const max = Math.max(...vals, 0.0001), min = Math.min(...vals, 0);
  const W = 420, H = 70, n = s.length || 1;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" style={{ maxWidth: 520, display: 'block' }}>
        {s.map((x, i) => {
          const h = x.value == null ? 0 : ((x.value - min) / (max - min || 1)) * (H - 14) + 4;
          const bw = (W / n) * 0.6, bx = (i + 0.2) * (W / n);
          const isHi = x.year === hi.year && x.month === hi.month;
          return (
            <g key={`${x.year}-${x.month}`}>
              <rect x={bx} y={H - h} width={bw} height={h} fill={isHi ? '#0F3D73' : '#cbd5e1'} rx={2} />
              <text x={bx + bw / 2} y={H - h - 2} fontSize={8} textAnchor="middle" fill={isHi ? '#0F3D73' : '#64748b'}>{fmt(x.value)}</text>
              <text x={bx + bw / 2} y={H + 12} fontSize={8} textAnchor="middle" fill="#94a3b8">{x.month}월</text>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>단위 {unit || '-'} · 데이터 연결로 자동 수집된 값(잠정값 제외)</div>
    </div>
  );
}

function QuizCard({ q, userId, isExec, onChanged }: { q: Quiz; userId: string; isExec: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(q.status === 'OPEN' && q.respondentId === userId);
  const [choice, setChoice] = useState<number | null>(null);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [final, setFinal] = useState<string>(q.finalScore != null ? String(q.finalScore) : q.aiScore != null ? String(q.aiScore) : '');
  const [note, setNote] = useState(q.gradeNote || '');
  const st = STATUS[q.status] || STATUS.OPEN;
  const title = q.kr?.title || q.dataSnapshot?.title || '';
  const team = q.kr?.objective?.orgUnit?.name || q.dataSnapshot?.team || '';
  const unit = q.kr?.unit || q.dataSnapshot?.unit || '';
  const score = q.finalScore ?? q.aiScore;
  const overdue = q.status === 'OPEN' && new Date(q.dueAt).getTime() < Date.now();
  const mine = q.respondentId === userId;

  async function submit() {
    const answers = q.questions.map((qq) => (qq.type === 'CHOICE' ? { no: qq.no, choiceIdx: choice } : { no: qq.no, text: texts[qq.no] || '' }));
    if (choice == null) return toast('1번 객관식에 답하세요', 'error');
    for (const qq of q.questions) if (qq.type === 'TEXT' && (texts[qq.no] || '').trim().length < 20) return toast(`${qq.no}번은 20자 이상 적어 주세요`, 'error');
    if (!(await toastConfirm('제출하면 수정할 수 없습니다. AI가 바로 채점하고 임원이 확정합니다. 제출할까요?'))) return;
    setBusy(true);
    try { const r = await apiJson<Quiz>(`/api/kpi-quiz/${q.id}/answer`, { method: 'POST', body: JSON.stringify({ userId, answers }) }); toast(`제출 완료 · AI 1차 점수 ${r.aiScore ?? '-'}점`, 'success'); onChanged(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }
  async function grade() {
    setBusy(true);
    try { await apiJson(`/api/kpi-quiz/${q.id}/grade`, { method: 'POST', body: JSON.stringify({ userId, finalScore: final, note }) }); toast('확정했습니다', 'success'); onChanged(); }
    catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }
  async function skip() {
    if (!(await toastConfirm('이 시험지를 제외(점수 집계에서 빼기)할까요?'))) return;
    try { await apiJson(`/api/kpi-quiz/${q.id}/skip`, { method: 'POST', body: JSON.stringify({ userId }) }); onChanged(); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }

  return (
    <div style={{ ...card, borderColor: overdue ? '#fca5a5' : '#e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <b style={{ fontSize: 14 }}>{q.year}년 {q.month}월 · {title}</b>
        <span style={{ fontSize: 11, color: '#64748b' }}>{team}{q.respondent ? ` · 응답자 ${q.respondent.name}` : ''}</span>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.c, fontWeight: 700 }}>{st.t}</span>
        {overdue && <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700 }}>기한 지남 ({new Date(q.dueAt).toLocaleDateString()})</span>}
        {!overdue && q.status === 'OPEN' && <span style={{ fontSize: 11, color: '#64748b' }}>기한 {new Date(q.dueAt).toLocaleDateString()}</span>}
        <span style={{ flex: 1 }} />
        {score != null && q.status !== 'OPEN' && <span style={{ fontSize: 18, fontWeight: 800, color: scoreColor(score), fontVariantNumeric: 'tabular-nums' }}>{score}<span style={{ fontSize: 11, color: '#94a3b8' }}> /100{q.status === 'ANSWERED' ? ' (AI 1차)' : ''}</span></span>}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>📊 실제 데이터 (목표 {fmt(q.dataSnapshot?.target, unit)}{q.dataSnapshot?.direction === 'AT_MOST' ? ' · 낮을수록 좋음' : q.dataSnapshot?.direction === 'AT_LEAST' ? ' · 높을수록 좋음' : ''})</div>
            <Series s={q.dataSnapshot?.series || []} unit={unit} hi={{ year: q.year, month: q.month }} />
          </div>
          {q.questions.map((qq) => {
            const ans = q.answers?.find((a) => a.no === qq.no);
            const g = q.aiGrading?.find((x) => x.no === qq.no);
            return (
              <div key={qq.no} style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 13 }}><b>Q{qq.no}.</b> {qq.text} <span style={{ fontSize: 11, color: '#94a3b8' }}>({qq.points}점)</span></div>
                {qq.type === 'CHOICE' && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {(qq.options || []).map((o, i) => {
                      const picked = q.status === 'OPEN' ? choice === i : ans?.choiceIdx === i;
                      const correct = q.status !== 'OPEN' && qq.answerIdx === i;
                      return (
                        <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 10px', borderRadius: 6, border: `1px solid ${correct ? '#86efac' : picked ? '#93c5fd' : '#e5e7eb'}`, background: correct ? '#f0fdf4' : picked ? '#eff6ff' : '#fff', cursor: q.status === 'OPEN' && mine ? 'pointer' : 'default' }}>
                          <input type="radio" name={`q${q.id}-${qq.no}`} disabled={q.status !== 'OPEN' || !mine} checked={!!picked} onChange={() => setChoice(i)} />
                          <span>{o}</span>
                          {correct && <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>정답(데이터)</span>}
                          {picked && !correct && q.status !== 'OPEN' && <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700 }}>선택</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
                {qq.type === 'TEXT' && q.status === 'OPEN' && mine && (
                  <textarea rows={4} value={texts[qq.no] || ''} onChange={(e) => setTexts((t) => ({ ...t, [qq.no]: e.target.value }))} placeholder="현장 근거·담당·기한·수치를 구체적으로 (20자 이상)" style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                )}
                {qq.type === 'TEXT' && q.status !== 'OPEN' && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>{ans?.text || <span style={{ color: '#94a3b8' }}>(답 없음)</span>}</div>}
                {qq.type === 'TEXT' && q.status === 'OPEN' && !mine && <div style={{ fontSize: 12, color: '#94a3b8' }}>응답 대기 중</div>}
                {g && <div style={{ fontSize: 12, color: '#334155', background: '#f8fafc', borderRadius: 6, padding: 8 }}><b style={{ color: scoreColor((g.score / g.max) * 100) }}>{g.score}/{g.max}</b> · {g.feedback}{qq.rubric && (isExec || mine) && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>채점기준: {qq.rubric}</div>}</div>}
              </div>
            );
          })}
          {q.status === 'OPEN' && mine && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'AI 채점 중…' : '제출'}</button>
            </div>
          )}
          {q.status !== 'OPEN' && (
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8, display: 'grid', gap: 6 }}>
              {q.status === 'GRADED' && <div style={{ fontSize: 12, color: '#15803d' }}>✅ 확정 {q.finalScore}점 {q.gradedAt ? `· ${new Date(q.gradedAt).toLocaleDateString()}` : ''}{q.gradeNote ? ` · ${q.gradeNote}` : ''}{q.aiScore != null && q.finalScore !== q.aiScore ? ` (AI 1차 ${q.aiScore}점)` : ''}</div>}
              {isExec && q.status !== 'SKIPPED' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>임원 확정</span>
                  <input type="number" min={0} max={100} value={final} onChange={(e) => setFinal(e.target.value)} style={{ width: 70, fontSize: 13, padding: 4 }} /><span style={{ fontSize: 12, color: '#64748b' }}>/100</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="확정 메모(선택)" style={{ flex: 1, minWidth: 160, fontSize: 13, padding: 4 }} />
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void grade()}>{q.status === 'GRADED' ? '수정 확정' : '확정'}</button>
                  {q.status !== 'GRADED' && <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => void skip()}>제외</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function KpiQuiz() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<'mine' | 'all' | 'board' | 'manage'>('mine');
  const [mine, setMine] = useState<{ items: Quiz[]; open: number; avg: number | null } | null>(null);
  const [all, setAll] = useState<Quiz[]>([]);
  const [board, setBoard] = useState<any>(null);
  const [targets, setTargets] = useState<any>(null);
  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const isExec = me?.role === 'CEO' || me?.role === 'EXEC';
  const canSeeAll = isExec || me?.role === 'MANAGER';

  async function loadMine() { try { setMine(await apiJson(`/api/kpi-quiz/mine?userId=${encodeURIComponent(userId)}`)); } catch {} }
  async function loadAll() { try { const r = await apiJson<{ items: Quiz[] }>(`/api/kpi-quiz/all?userId=${encodeURIComponent(userId)}${filter ? `&status=${filter}` : ''}`); setAll(r.items || []); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  async function loadBoard() { try { setBoard(await apiJson(`/api/kpi-quiz/board?userId=${encodeURIComponent(userId)}`)); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  async function loadTargets() { try { setTargets(await apiJson(`/api/kpi-quiz/targets?userId=${encodeURIComponent(userId)}`)); } catch (e: any) { toast(e?.message || '실패', 'error'); } }
  useEffect(() => { if (!userId) return; void apiJson(`/api/users/me?userId=${encodeURIComponent(userId)}`).then(setMe).catch(() => {}); void loadMine(); /* eslint-disable-next-line */ }, [userId]);
  useEffect(() => { if (tab === 'all') void loadAll(); if (tab === 'board') void loadBoard(); if (tab === 'manage') void loadTargets(); /* eslint-disable-next-line */ }, [tab, filter]);
  function refresh() { void loadMine(); if (tab === 'all') void loadAll(); if (tab === 'board') void loadBoard(); }

  async function generate(keyResultId?: string) {
    const label = keyResultId ? '이 KPI' : '출제 대상 전체';
    if (!(await toastConfirm(`${label}에 직전 마감월(${targets?.baseMonth?.year}년 ${targets?.baseMonth?.month}월) 시험지를 지금 출제할까요? 응답자에게 알림이 갑니다.`))) return;
    setBusy(true);
    try {
      const r = await apiJson<{ results: any[] }>(`/api/kpi-quiz/generate`, { method: 'POST', body: JSON.stringify({ userId, keyResultId }) });
      const made = r.results.filter((x) => x.created).length, errs = r.results.filter((x) => x.error);
      toast(`출제 ${made}건${errs.length ? ` · 건너뜀 ${errs.length}건: ${errs.map((e) => `${e.title}(${e.error})`).join(', ')}` : ''}`, errs.length && !made ? 'error' : 'success', 6000);
      await loadTargets(); await loadMine();
    } catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(false); }
  }
  async function toggle(keyResultId: string, enabled: boolean) {
    try { await apiJson(`/api/kpi-quiz/targets/${encodeURIComponent(keyResultId)}/toggle`, { method: 'POST', body: JSON.stringify({ userId, enabled }) }); await loadTargets(); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }

  const tabBtn = (k: typeof tab, label: string) => <button className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(k)}>{label}</button>;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>관리자 시험지 · 데이터 감각</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          데이터가 연결된 KPI의 <b>실제 수치</b>로 매월 3문항을 묻습니다 — 방향(객관식)·원인·조치(주관식). 숫자를 외우는 시험이 아니라, 자기 팀 숫자를 읽고 행동으로 잇는지 보는 시험입니다. 주관식은 AI가 1차 채점하고 임원이 확정합니다.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabBtn('mine', `내 시험지${mine?.open ? ` (${mine.open})` : ''}`)}
        {canSeeAll && tabBtn('all', '전체 현황')}
        {canSeeAll && tabBtn('board', '데이터 감각 점수')}
        {isExec && tabBtn('manage', '출제 관리')}
      </div>

      {tab === 'mine' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {mine && <div style={{ fontSize: 13, color: '#475569' }}>응답 대기 <b style={{ color: mine.open ? '#b45309' : '#15803d' }}>{mine.open}</b>건 · 내 평균 <b style={{ color: scoreColor(mine.avg) }}>{mine.avg ?? '-'}</b>점</div>}
          {mine?.items.map((q) => <QuizCard key={q.id} q={q} userId={userId} isExec={isExec} onChanged={refresh} />)}
          {mine && !mine.items.length && <div style={{ ...card, color: '#94a3b8', textAlign: 'center' }}>아직 받은 시험지가 없습니다. 데이터가 연결된 KPI의 팀 책임자(또는 KPI 담당)에게 매월 3일 출제됩니다.</div>}
        </div>
      )}

      {tab === 'all' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>상태</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ fontSize: 13 }}><option value="">전체</option><option value="OPEN">응답 대기</option><option value="ANSWERED">확정 대기</option><option value="GRADED">확정</option><option value="SKIPPED">제외</option></select>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{all.length}건</span>
          </div>
          {all.map((q) => <QuizCard key={q.id} q={q} userId={userId} isExec={isExec} onChanged={refresh} />)}
          {!all.length && <div style={{ ...card, color: '#94a3b8', textAlign: 'center' }}>시험지가 없습니다</div>}
        </div>
      )}

      {tab === 'board' && board && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {[['출제', board.summary.total], ['응답', board.summary.answered], ['확정', board.summary.graded], ['대기', board.summary.open]].map(([l, v]) => <div key={String(l)} style={{ ...card, minWidth: 100, textAlign: 'center' }}><div style={{ fontSize: 11, color: '#64748b' }}>{l}</div><div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div></div>)}
            <div style={{ ...card, minWidth: 120, textAlign: 'center' }}><div style={{ fontSize: 11, color: '#64748b' }}>전사 평균</div><div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(board.summary.avg) }}>{board.summary.avg ?? '-'}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
            <div style={card}>
              <b style={{ fontSize: 13 }}>개인별</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                <thead><tr style={{ color: '#64748b', background: '#f8fafc' }}><th style={{ textAlign: 'left', padding: 6 }}>이름</th><th style={{ padding: 6 }}>팀</th><th style={{ padding: 6 }}>출제</th><th style={{ padding: 6 }}>응답률</th><th style={{ padding: 6 }}>기한 초과</th><th style={{ padding: 6 }}>평균</th></tr></thead>
                <tbody>{board.people.map((p: any) => <tr key={p.userId} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6, fontWeight: 600 }}>{p.name}</td><td style={{ padding: 6, textAlign: 'center' }}>{p.team}</td><td style={{ padding: 6, textAlign: 'center' }}>{p.total}</td><td style={{ padding: 6, textAlign: 'center' }}>{p.responseRate}%</td><td style={{ padding: 6, textAlign: 'center', color: p.overdue ? '#b91c1c' : '#94a3b8' }}>{p.overdue}</td><td style={{ padding: 6, textAlign: 'center', fontWeight: 800, color: scoreColor(p.avg) }}>{p.avg ?? '-'}</td></tr>)}</tbody>
              </table>
            </div>
            <div style={card}>
              <b style={{ fontSize: 13 }}>팀별</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                <thead><tr style={{ color: '#64748b', background: '#f8fafc' }}><th style={{ textAlign: 'left', padding: 6 }}>팀</th><th style={{ padding: 6 }}>출제</th><th style={{ padding: 6 }}>응답률</th><th style={{ padding: 6 }}>평균</th></tr></thead>
                <tbody>{board.teams.map((t: any) => <tr key={t.teamId} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6, fontWeight: 600 }}>{t.team}</td><td style={{ padding: 6, textAlign: 'center' }}>{t.total}</td><td style={{ padding: 6, textAlign: 'center' }}>{t.responseRate}%</td><td style={{ padding: 6, textAlign: 'center', fontWeight: 800, color: scoreColor(t.avg) }}>{t.avg ?? '-'}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'manage' && targets && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#475569' }}>출제 기준월: <b>{targets.baseMonth.year}년 {targets.baseMonth.month}월</b> · 매월 3일 03:00 자동 출제 · 데이터 연결된 KPI만 대상</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void generate()}>출제 대상 전체 지금 출제</button>
          </div>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: '#64748b', background: '#f8fafc' }}><th style={{ textAlign: 'left', padding: 6 }}>KPI</th><th style={{ padding: 6 }}>팀</th><th style={{ padding: 6 }}>응답자(팀 책임자)</th><th style={{ padding: 6 }}>데이터</th><th style={{ padding: 6 }}>최근 출제</th><th style={{ padding: 6 }}>출제</th><th style={{ padding: 6 }}></th></tr></thead>
              <tbody>
                {targets.items.map((t: any) => (
                  <tr key={t.keyResultId} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6, fontWeight: 600 }}>{t.title}{t.lastError && <div style={{ fontSize: 10, color: '#b91c1c' }}>연결 오류: {t.lastError}</div>}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{t.team}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{t.manager}</td>
                    <td style={{ padding: 6, textAlign: 'center', color: t.ready ? '#15803d' : '#b45309' }}>{t.ready ? `준비됨 (${t.months}개월)` : `기준월 값 없음 (${t.months}개월)`}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{t.latestQuiz ? `${t.latestQuiz.year}-${String(t.latestQuiz.month).padStart(2, '0')} ${STATUS[t.latestQuiz.status]?.t || ''}` : '-'}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}><label style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!t.quizEnabled} onChange={(e) => void toggle(t.keyResultId, e.target.checked)} /> {t.quizEnabled ? '켬' : '끔'}</label></td>
                    <td style={{ padding: 6, textAlign: 'center' }}><button className="btn btn-sm btn-outline" disabled={busy || !t.quizEnabled || !t.ready} onClick={() => void generate(t.keyResultId)}>지금 출제</button></td>
                  </tr>
                ))}
                {!targets.items.length && <tr><td colSpan={7} style={{ padding: 10, color: '#94a3b8', textAlign: 'center' }}>데이터 연결된 KPI가 없습니다 — KPI 실적 입력(수동) 메뉴에서 "데이터 연결"을 먼저 하세요</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
