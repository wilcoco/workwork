import { useEffect, useRef, useState, CSSProperties } from 'react';
import { apiJson, apiUrl } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────
interface Meeting {
  id: string;
  title: string;
  date: string;
  participants: string[];
  transcript: string | null;
  summary: string | null;
  actionItems: any[] | null;
  status: string;
  duration: number | null;
  audioChunks: any[] | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

// ─── Styles ──────────────────────────────────────────────────
const card: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, cursor: 'pointer', transition: 'box-shadow .15s', background: '#fff' };
const input: CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 14 };
const primaryBtn: CSSProperties = { background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14 };
const ghostBtn: CSSProperties = { background: 'transparent', color: '#0F3D73', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 };
const dangerBtn: CSSProperties = { background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 };
const recBtn: CSSProperties = { background: '#DC2626', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 28px', fontWeight: 700, cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 };
const stopBtn: CSSProperties = { background: '#475569', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 28px', fontWeight: 700, cursor: 'pointer', fontSize: 15 };
const chip: CSSProperties = { display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 };
const statusColors: Record<string, CSSProperties> = {
  draft: { ...chip, background: '#f1f5f9', color: '#475569' },
  recording: { ...chip, background: '#fef3c7', color: '#92400e' },
  transcribing: { ...chip, background: '#dbeafe', color: '#1e40af' },
  summarized: { ...chip, background: '#d1fae5', color: '#065f46' },
  finalized: { ...chip, background: '#ede9fe', color: '#5b21b6' },
};
const statusLabel: Record<string, string> = {
  draft: '초안',
  recording: '녹음중',
  transcribing: '전사중',
  summarized: '요약완료',
  finalized: '확정',
};
const modalOverlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 };
const modalBody: CSSProperties = { background: '#fff', borderRadius: 16, padding: 24, width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' };

// ─── Audio Recorder Hook ─────────────────────────────────────
const CHUNK_DURATION_MS = 5 * 60 * 1000; // 5 min per chunk

function useAudioRecorder(meetingId: string | null) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkOrderRef = useRef(0);
  const startTimeRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function uploadChunk(blob: Blob, order: number, duration: number) {
    if (!meetingId) return;
    const form = new FormData();
    form.append('file', blob, `chunk-${order}.webm`);
    form.append('order', String(order));
    form.append('duration', String(Math.round(duration)));
    const token = localStorage.getItem('token') || '';
    const resp = await fetch(apiUrl(`/api/meeting-minutes/${meetingId}/audio`), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!resp.ok) throw new Error('Audio upload failed');
    return resp.json();
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunkOrderRef.current = 0;
      startTimeRef.current = Date.now();
      setElapsed(0);
      setRecording(true);

      // Elapsed timer
      elapsedRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      startNewChunk(stream);

      // Auto-rotate chunks every CHUNK_DURATION_MS
      chunkTimerRef.current = setInterval(() => {
        rotateChunk(stream);
      }, CHUNK_DURATION_MS);
    } catch (err: any) {
      alert('마이크 접근 권한이 필요합니다: ' + (err?.message || ''));
    }
  }

  function startNewChunk(stream: MediaStream) {
    const mr = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    const chunks: BlobPart[] = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(chunks, { type: mr.mimeType });
      const order = chunkOrderRef.current++;
      const duration = CHUNK_DURATION_MS / 1000;
      try {
        setUploading(true);
        await uploadChunk(blob, order, duration);
      } catch (err) {
        console.error('Chunk upload failed:', err);
      } finally {
        setUploading(false);
      }
    };
    mr.start();
    mediaRecorderRef.current = mr;
  }

  function rotateChunk(stream: MediaStream) {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === 'recording') {
      mr.stop();
    }
    startNewChunk(stream);
  }

  async function stop() {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === 'recording') {
      // Wait for the existing onstop handler (which uploads the chunk) to finish
      await new Promise<void>((resolve) => {
        const prevOnStop = mr.onstop;
        mr.onstop = async (e) => {
          if (prevOnStop) await (prevOnStop as any).call(mr, e);
          resolve();
        };
        mr.stop();
      });
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecording(false);
  }

  return { recording, elapsed, uploading, start, stop };
}

function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'audio/webm';
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

// ─── Main Component ──────────────────────────────────────────
export function MeetingMinutes() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [newParticipants, setNewParticipants] = useState('');

  // Detail view
  const [active, setActive] = useState<Meeting | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [editTranscript, setEditTranscript] = useState('');
  const [editing, setEditing] = useState(false);

  const recorder = useAudioRecorder(active?.id || null);

  useEffect(() => { if (userId) load(); }, [userId]);

  async function load() {
    setLoading(true);
    try {
      const res = await apiJson<{ items: Meeting[] }>(`/api/meeting-minutes?createdById=${userId}`);
      setMeetings(res.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!newTitle.trim()) return;
    try {
      const participants = newParticipants.split(',').map((s) => s.trim()).filter(Boolean);
      await apiJson('/api/meeting-minutes', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          createdById: userId,
          date: newDate ? `${newDate}T00:00:00+09:00` : undefined,
          participants,
        }),
      });
      setNewTitle('');
      setNewParticipants('');
      setShowCreate(false);
      await load();
    } catch (e: any) {
      setError(e?.message || '생성 실패');
    }
  }

  async function openDetail(id: string) {
    try {
      const m = await apiJson<Meeting>(`/api/meeting-minutes/${id}`);
      setActive(m);
      setEditTranscript(m.transcript || '');
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    }
  }

  async function handleStartRecording() {
    if (!active) return;
    await recorder.start();
  }

  async function handleStopRecording() {
    await recorder.stop();
    if (active) {
      // Wait a moment for the final chunk to upload, then reload
      setTimeout(async () => {
        await openDetail(active.id);
      }, 2000);
    }
  }

  async function handleTranscribe() {
    if (!active) return;
    setTranscribing(true);
    try {
      const res = await apiJson<{ transcript: string }>(`/api/meeting-minutes/${active.id}/transcribe`, { method: 'POST' });
      setActive({ ...active, transcript: res.transcript, status: 'draft' });
      setEditTranscript(res.transcript);
    } catch (e: any) {
      setError(e?.message || '전사 실패');
    } finally {
      setTranscribing(false);
    }
  }

  async function handleSaveTranscript() {
    if (!active) return;
    try {
      await apiJson(`/api/meeting-minutes/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ transcript: editTranscript }),
      });
      setActive({ ...active, transcript: editTranscript });
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    }
  }

  async function handleSummarize() {
    if (!active) return;
    setSummarizing(true);
    try {
      const res = await apiJson<{ summary: string; actionItems: any[] }>(`/api/meeting-minutes/${active.id}/summarize`, { method: 'POST' });
      setActive({ ...active, summary: res.summary, actionItems: res.actionItems, status: 'summarized' });
    } catch (e: any) {
      setError(e?.message || '요약 실패');
    } finally {
      setSummarizing(false);
    }
  }

  async function handleFinalize() {
    if (!active) return;
    try {
      await apiJson(`/api/meeting-minutes/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'finalized' }),
      });
      setActive({ ...active, status: 'finalized' });
      await load();
    } catch (e: any) {
      setError(e?.message || '확정 실패');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      await apiJson(`/api/meeting-minutes/${id}`, { method: 'DELETE' });
      setActive(null);
      await load();
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>회의록</h2>
        <button style={primaryBtn} onClick={() => setShowCreate(true)}>+ 새 회의</button>
      </div>

      {error && <div style={{ color: '#DC2626', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button></div>}

      {/* Create Form */}
      {showCreate && (
        <div style={{ border: '2px solid #0F3D73', borderRadius: 12, padding: 16, background: '#f8fafc', display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0 }}>새 회의 만들기</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>회의 제목 *</label>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={input} placeholder="예: 주간 팀 회의" />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>회의 일자</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={input} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>참석자 (쉼표로 구분)</label>
            <input value={newParticipants} onChange={(e) => setNewParticipants(e.target.value)} style={input} placeholder="홍길동, 김철수, 이영희" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={primaryBtn} onClick={create} disabled={!newTitle.trim()}>만들기</button>
            <button style={ghostBtn} onClick={() => setShowCreate(false)}>취소</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? <div>로딩중…</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {meetings.map((m) => (
            <div
              key={m.id}
              style={card}
              onClick={() => openDetail(m.id)}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ flex: 1, fontSize: 15 }}>{m.title}</b>
                <span style={statusColors[m.status] || statusColors.draft}>{statusLabel[m.status] || m.status}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{new Date(m.date).toLocaleDateString('ko-KR')}</span>
              </div>
              {m.participants && (m.participants as string[]).length > 0 && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>참석: {(m.participants as string[]).join(', ')}</div>
              )}
              {m.duration && <span style={{ fontSize: 12, color: '#94a3b8' }}>녹음: {formatDuration(m.duration)}</span>}
            </div>
          ))}
          {!meetings.length && <div style={{ color: '#94a3b8', fontSize: 14 }}>아직 회의록이 없습니다. 새 회의를 만들어보세요.</div>}
        </div>
      )}

      {/* Detail Modal */}
      {active && (
        <div style={modalOverlay} onClick={() => { if (!recorder.recording) setActive(null); }}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <h2 style={{ margin: 0, flex: 1 }}>{active.title}</h2>
              <span style={statusColors[active.status] || statusColors.draft}>{statusLabel[active.status] || active.status}</span>
              <button style={ghostBtn} onClick={() => { if (!recorder.recording) setActive(null); }}>닫기</button>
            </div>

            <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#475569', marginBottom: 16 }}>
              <div>일시: {new Date(active.date).toLocaleDateString('ko-KR')}</div>
              {active.participants && (active.participants as string[]).length > 0 && (
                <div>참석자: {(active.participants as string[]).join(', ')}</div>
              )}
              {active.duration && <div>녹음 시간: {formatDuration(active.duration)}</div>}
            </div>

            {/* Recording Section */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, background: recorder.recording ? '#fef2f2' : '#f8fafc' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>음성 녹음</h3>
              {recorder.recording ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#DC2626', animation: 'pulse 1s infinite' }} />
                    <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatDuration(recorder.elapsed)}</span>
                  </div>
                  <button style={stopBtn} onClick={handleStopRecording}>녹음 중지</button>
                  {recorder.uploading && <span style={{ fontSize: 12, color: '#64748b' }}>청크 업로드중…</span>}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button style={recBtn} onClick={handleStartRecording}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                    녹음 시작
                  </button>
                  {active.audioChunks && (active.audioChunks as any[]).length > 0 && (
                    <span style={{ fontSize: 13, color: '#16a34a' }}>
                      {(active.audioChunks as any[]).length}개 청크 녹음됨
                    </span>
                  )}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                긴 회의도 자동으로 5분 단위로 분할 저장됩니다. 녹음을 시작하면 마이크 접근 권한이 필요합니다.
              </div>
            </div>

            {/* Transcription Section */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>녹취록</h3>
                {active.audioChunks && (active.audioChunks as any[]).length > 0 && !active.transcript && (
                  <button style={primaryBtn} onClick={handleTranscribe} disabled={transcribing}>
                    {transcribing ? 'AI 전사중…' : 'AI 음성 전사'}
                  </button>
                )}
                {active.transcript && !editing && (
                  <button style={ghostBtn} onClick={() => setEditing(true)}>편집</button>
                )}
                {editing && (
                  <button style={primaryBtn} onClick={handleSaveTranscript}>저장</button>
                )}
              </div>
              {transcribing ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🎙️</div>
                  AI가 음성을 텍스트로 변환하고 있습니다…<br />
                  <span style={{ fontSize: 12 }}>오디오 길이에 따라 수 분 소요될 수 있습니다.</span>
                </div>
              ) : editing ? (
                <textarea
                  value={editTranscript}
                  onChange={(e) => setEditTranscript(e.target.value)}
                  style={{ width: '100%', minHeight: 300, borderRadius: 8, border: '1px solid #CBD5E1', padding: 12, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.6 }}
                />
              ) : active.transcript ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, maxHeight: 400, overflow: 'auto', color: '#1e293b' }}>
                  {active.transcript}
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                  녹음 후 "AI 음성 전사" 버튼을 눌러 녹취록을 생성하세요.
                </div>
              )}
            </div>

            {/* Summary Section */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>AI 요약</h3>
                {active.transcript && (
                  <button style={primaryBtn} onClick={handleSummarize} disabled={summarizing}>
                    {summarizing ? 'AI 요약중…' : (active.summary ? 'AI 재요약' : 'AI 요약 생성')}
                  </button>
                )}
              </div>
              {summarizing ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  AI가 회의 내용을 분석하고 요약하고 있습니다…
                </div>
              ) : active.summary ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: '#1e293b' }}>
                  {active.summary}
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                  녹취록이 있으면 "AI 요약 생성" 버튼을 눌러 회의 요약을 생성하세요.
                </div>
              )}
            </div>

            {/* Action Items */}
            {active.actionItems && (active.actionItems as any[]).length > 0 && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>할 일 목록</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {(active.actionItems as any[]).map((item: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, background: '#f8fafc', borderRadius: 8 }}>
                      <span style={{ fontWeight: 700, color: '#0F3D73', minWidth: 24 }}>{i + 1}.</span>
                      <div>
                        <div style={{ fontSize: 14 }}>{item.text}</div>
                        {(item.assignee || item.dueDate) && (
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                            {item.assignee && `담당: ${item.assignee}`}
                            {item.assignee && item.dueDate && ' · '}
                            {item.dueDate && `기한: ${item.dueDate}`}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {active.summary && active.status !== 'finalized' && (
                <button style={{ ...primaryBtn, background: '#059669' }} onClick={handleFinalize}>확정</button>
              )}
              <button style={dangerBtn} onClick={() => handleDelete(active.id)}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Pulse animation for recording indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
