import { useEffect, useRef, useState, CSSProperties } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { OneDriveFilePicker } from '../components/OneDriveFilePicker';
import { MobilePhotoButton } from '../components/MobilePhotoButton';
import { MemberSearchPicker, SingleMemberPicker } from '../components/MemberSearchPicker';

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
  attachments: any[] | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  visibility?: string;
  sharedUserIds?: string[] | null;
  participantUserIds?: string[] | null;
  shareToken?: string | null;
  mine?: boolean;
}

type Member = { id: string; name: string; role?: string; orgName?: string };
const VIS_LABEL: Record<string, string> = { PRIVATE: '나만 보기', MANAGER_PLUS: '팀장 이상', EXEC_PLUS: '임원 이상', ORG: '전사 공개' };

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
const modalOverlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100 };
const modalBody: CSSProperties = { background: '#fff', borderRadius: 16, padding: '20px 16px 24px', width: 'min(900px, 95vw)', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', marginTop: 'env(safe-area-inset-top, 0px)' };

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
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
  const [newParticipantNames, setNewParticipantNames] = useState<string[]>([]);
  const [newParticipantMeta, setNewParticipantMeta] = useState<{ name: string; email: string; teamsUpn: string }[]>([]);

  // Detail view
  const [active, setActive] = useState<Meeting | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineNote, setRefineNote] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [editTranscript, setEditTranscript] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [corrections, setCorrections] = useState<Array<{ from?: string; to?: string; reason?: string }>>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);

  // Action items assignee + Planner integration
  const [actionAssignees, setActionAssignees] = useState<Record<number, { name: string; email: string; teamsUpn: string }>>({});
  const [plans, setPlans] = useState<{ id: string; title: string }[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [creatingTasks, setCreatingTasks] = useState(false);

  const recorder = useAudioRecorder(active?.id || null);

  // ─── 공유 모달 ───
  const [shareFor, setShareFor] = useState<Meeting | null>(null);
  const [shareVis, setShareVis] = useState('PRIVATE');
  const [shareUserIds, setShareUserIds] = useState<string[]>([]);
  const [sharePartIds, setSharePartIds] = useState<string[]>([]);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareSaving, setShareSaving] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberQ, setMemberQ] = useState('');
  useEffect(() => { apiJson<{ items: Member[] }>('/api/users').then((r) => setMembers(r.items || [])).catch(() => {}); }, []);

  function openShare(m: Meeting) {
    setShareFor(m);
    setShareVis(m.visibility || 'PRIVATE');
    setShareUserIds(Array.isArray(m.sharedUserIds) ? m.sharedUserIds : []);
    setSharePartIds(Array.isArray(m.participantUserIds) ? m.participantUserIds : []);
    setShareToken(m.shareToken || null);
    setMemberQ('');
  }
  async function saveShare(enableLink?: boolean) {
    if (!shareFor) return;
    setShareSaving(true);
    try {
      const r = await apiJson<{ visibility: string; sharedUserIds: string[]; participantUserIds: string[]; shareToken: string | null }>(
        `/api/meeting-minutes/${shareFor.id}/share`,
        { method: 'POST', body: JSON.stringify({ actorId: userId, visibility: shareVis, sharedUserIds: shareUserIds, participantUserIds: sharePartIds, ...(enableLink !== undefined ? { enableLink } : {}) }) });
      setShareToken(r.shareToken);
      setShareFor((prev) => prev ? { ...prev, visibility: r.visibility, sharedUserIds: r.sharedUserIds, participantUserIds: r.participantUserIds, shareToken: r.shareToken } : prev);
      if (active && shareFor && active.id === shareFor.id) setActive({ ...active, visibility: r.visibility, sharedUserIds: r.sharedUserIds, participantUserIds: r.participantUserIds, shareToken: r.shareToken });
      if (enableLink === undefined) { setShareFor(null); await load(); }
    } catch (e: any) { setError(e?.message || '공유 설정 실패'); }
    finally { setShareSaving(false); }
  }

  useEffect(() => { if (userId) load(); }, [userId]);

  // 링크 열람: /meetings?share=토큰 → 해당 회의록을 바로 연다
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token) return;
    apiJson<Meeting>(`/api/meeting-minutes/by-token/${encodeURIComponent(token)}`)
      .then((m) => { setActive(m); setEditTranscript(m.transcript || ''); setEditing(false); })
      .catch((e) => setError(e?.message || '링크로 회의록을 열 수 없습니다'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      // viewerId 기준 = 내가 만든 것 + 공유받은 것 + 공개범위 허용
      const res = await apiJson<{ items: Meeting[] }>(`/api/meeting-minutes?viewerId=${encodeURIComponent(userId)}`);
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
      await apiJson('/api/meeting-minutes', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          createdById: userId,
          date: newDate ? `${newDate}T00:00:00+09:00` : undefined,
          participants: newParticipantNames,
        }),
      });
      setNewTitle('');
      setNewParticipantNames([]);
      setNewParticipantMeta([]);
      setShowCreate(false);
      await load();
    } catch (e: any) {
      setError(e?.message || '생성 실패');
    }
  }

  async function openDetail(id: string) {
    try {
      const m = await apiJson<Meeting>(`/api/meeting-minutes/${id}?viewerId=${encodeURIComponent(userId)}`);
      setActive(m);
      setEditTranscript(m.transcript || '');
      setEditing(false);
      setActionAssignees({});
      // Load Planner plans for task creation
      try {
        const res = await apiJson<{ plans: { id: string; title: string }[] }>(`/api/graph-tasks/plans?userId=${userId}`);
        setPlans(res.plans || []);
        if (res.plans?.length) setSelectedPlanId(res.plans[0].id);
      } catch { setPlans([]); }
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    }
  }

  async function handleSave() {
    if (!active) return;
    try {
      // Merge assignees into action items
      const updatedItems = active.actionItems
        ? (active.actionItems as any[]).map((item: any, i: number) => {
            const a = actionAssignees[i];
            return a ? { ...item, assignee: a.name, assigneeUpn: a.teamsUpn } : item;
          })
        : [];
      await apiJson(`/api/meeting-minutes/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ actionItems: updatedItems }),
      });
      setActive({ ...active, actionItems: updatedItems });
      alert('저장되었습니다.');
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    }
  }

  async function createPlannerTasks() {
    if (!active?.actionItems?.length || !selectedPlanId) return;
    setCreatingTasks(true);
    let created = 0;
    try {
      for (let i = 0; i < active.actionItems.length; i++) {
        const item = (active.actionItems as any[])[i];
        const assignee = actionAssignees[i];
        await apiJson('/api/graph-tasks/create-task', {
          method: 'POST',
          body: JSON.stringify({
            userId,
            planId: selectedPlanId,
            title: item.text || `회의 할일 ${i + 1}`,
            assigneeUpn: assignee?.teamsUpn || undefined,
            dueDate: item.dueDate || undefined,
            description: `[회의록: ${active.title}]\n${item.text}${assignee ? `\n담당: ${assignee.name}` : ''}`,
          }),
        });
        created++;
      }
      alert(`${created}개 Planner 태스크가 생성되었습니다.`);
    } catch (e: any) {
      alert(`${created}개 생성 후 오류: ${e?.message || '알 수 없는 오류'}`);
    } finally {
      setCreatingTasks(false);
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
    setRefineNote(null);
    try {
      const res = await apiJson<{
        transcript: string;
        corrections?: Array<{ from?: string; to?: string; reason?: string }>;
        refined?: boolean;
        refineError?: string | null;
      }>(`/api/meeting-minutes/${active.id}/transcribe`, { method: 'POST' });
      setActive({ ...active, transcript: res.transcript, status: 'draft' });
      setEditTranscript(res.transcript);
      setCorrections(res.corrections || []);
      if (res.refined) {
        const n = (res.corrections || []).length;
        setRefineNote(n > 0
          ? `전사 후 자동 정제 완료 (${n}개 단어 교정).`
          : '전사 후 자동 정제 완료.');
      } else if (res.refineError) {
        setRefineNote(`자동 정제 건너뜀: ${res.refineError}. 필요시 'AI 녹취 정제' 버튼을 눌러주세요.`);
      }
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

  async function handleRefine() {
    if (!active) return;
    if (!confirm('AI가 녹취록의 STT 오인식 단어를 교정하고 가독성을 다듬습니다. 기존 녹취록을 덮어씁니다. 계속할까요?')) return;
    setRefining(true);
    setRefineNote(null);
    try {
      const res = await apiJson<{ transcript: string; corrections?: Array<{ from?: string; to?: string; reason?: string }> }>(
        `/api/meeting-minutes/${active.id}/refine`,
        { method: 'POST' },
      );
      setActive({ ...active, transcript: res.transcript });
      setEditTranscript(res.transcript);
      setCorrections(res.corrections || []);
      const n = (res.corrections || []).length;
      setRefineNote(n > 0 ? `${n}개 단어를 교정했습니다.` : '교정할 항목이 없었습니다.');
    } catch (e: any) {
      setError(e?.message || '녹취록 정제 실패');
    } finally {
      setRefining(false);
    }
  }

  async function handleSaveSummary() {
    if (!active) return;
    try {
      await apiJson(`/api/meeting-minutes/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ summary: editSummary, editedById: userId || undefined }),
      });
      setActive({ ...active, summary: editSummary });
      setEditingSummary(false);
    } catch (e: any) {
      setError(e?.message || '요약 저장 실패');
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

  async function handleAddOneDriveFiles(files: { url: string; name: string }[]) {
    if (!active) return;
    const prev = Array.isArray(active.attachments) ? active.attachments : [];
    const updated = [...prev, ...files.map(f => ({ url: f.url, name: f.name }))];
    try {
      await apiJson(`/api/meeting-minutes/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ attachments: updated }),
      });
      setActive({ ...active, attachments: updated });
    } catch (err: any) {
      setError(err?.message || '첨부 추가 실패');
    }
  }

  async function handleRemoveAttachment(idx: number) {
    if (!active) return;
    const prev = Array.isArray(active.attachments) ? [...active.attachments] : [];
    prev.splice(idx, 1);
    try {
      await apiJson(`/api/meeting-minutes/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({ attachments: prev }),
      });
      setActive({ ...active, attachments: prev });
    } catch (err: any) {
      setError(err?.message || '삭제 실패');
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
            <MemberSearchPicker
              label="참석자"
              selected={newParticipantNames}
              onAdd={(m) => {
                setNewParticipantNames((prev) => [...prev, m.name]);
                setNewParticipantMeta((prev) => [...prev, m]);
              }}
              onRemove={(idx) => {
                setNewParticipantNames((prev) => prev.filter((_, i) => i !== idx));
                setNewParticipantMeta((prev) => prev.filter((_, i) => i !== idx));
              }}
              allowManual
              placeholder="이름 검색 또는 외부인 직접 입력 후 Enter"
            />
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
                {m.createdBy?.id !== userId && <span style={{ fontSize: 11, color: '#6d28d9', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '1px 7px' }}>공유받음 · {m.createdBy?.name}</span>}
                {m.createdBy?.id === userId && m.visibility && m.visibility !== 'PRIVATE' && <span style={{ fontSize: 11, color: '#0369a1', background: '#e0f2fe', borderRadius: 8, padding: '1px 7px' }}>{VIS_LABEL[m.visibility]}</span>}
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
              <h2 style={{ margin: 0, flex: 1, fontSize: 18 }}>{active.title}</h2>
              <span style={statusColors[active.status] || statusColors.draft}>{statusLabel[active.status] || active.status}</span>
              {active.createdBy?.id === userId ? (
                <button onClick={() => openShare(active)} style={{ ...ghostBtn, padding: '8px 14px' }} title="다른 사람과 공유">🔗 공유</button>
              ) : (
                <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', borderRadius: 8, padding: '4px 10px' }}>{active.createdBy?.name} 님이 공유</span>
              )}
              <button
                onClick={() => { if (!recorder.recording) setActive(null); }}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#475569', display: 'grid', placeItems: 'center', flexShrink: 0 }}
                title="닫기"
              >✕</button>
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
                  <button style={primaryBtn} onClick={handleRefine} disabled={refining || transcribing}>
                    {refining ? 'AI 정제중…' : 'AI 녹취 정제'}
                  </button>
                )}
                {active.transcript && !editing && (
                  <button style={ghostBtn} onClick={() => setEditing(true)}>편집</button>
                )}
                {editing && (
                  <button style={primaryBtn} onClick={handleSaveTranscript}>저장</button>
                )}
              </div>
              {refineNote && (
                <div style={{ marginBottom: 8, fontSize: 12, color: '#0369a1', background: '#e0f2fe', padding: '6px 10px', borderRadius: 6 }}>
                  {refineNote}
                </div>
              )}
              {transcribing ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🎙️</div>
                  AI가 음성을 텍스트로 변환하고 자동 정제까지 수행합니다…<br />
                  <span style={{ fontSize: 12 }}>오디오 길이에 따라 수 분 소요될 수 있습니다.</span>
                </div>
              ) : refining ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>✨</div>
                  AI가 녹취록의 오인식 단어를 교정하고 다듬는 중…
                </div>
              ) : editing ? (
                <textarea
                  value={editTranscript}
                  onChange={(e) => setEditTranscript(e.target.value)}
                  style={{ width: '100%', minHeight: 300, borderRadius: 8, border: '1px solid #CBD5E1', padding: 12, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.6 }}
                />
              ) : active.transcript ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, maxHeight: 400, overflow: 'auto', color: '#1e293b' }}>
                    {active.transcript}
                  </div>
                  {corrections.length > 0 && (
                    <details style={{ border: '1px solid #bae6fd', borderRadius: 8, padding: '6px 10px', background: '#f0f9ff' }}>
                      <summary style={{ fontSize: 12, fontWeight: 700, color: '#0369a1', cursor: 'pointer' }}>AI 교정 내역 {corrections.length}건 보기</summary>
                      <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                        {corrections.map((c, i) => (
                          <div key={i} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            <span style={{ background: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: 4, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{c.from}</span>
                            <span style={{ color: '#64748b' }}>→</span>
                            <span style={{ background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{c.to}</span>
                            {c.reason && <span style={{ color: '#64748b', fontSize: 11 }}>{c.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
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
                {active.transcript && !editingSummary && (
                  <button style={primaryBtn} onClick={handleSummarize} disabled={summarizing}>
                    {summarizing ? 'AI 요약중…' : (active.summary ? 'AI 재요약' : 'AI 요약 생성')}
                  </button>
                )}
                {active.summary && !editingSummary && (
                  <button style={ghostBtn} onClick={() => { setEditSummary(active.summary || ''); setEditingSummary(true); }}>
                    편집
                  </button>
                )}
                {editingSummary && (
                  <>
                    <button style={ghostBtn} onClick={() => setEditingSummary(false)}>취소</button>
                    <button style={primaryBtn} onClick={handleSaveSummary}>저장</button>
                  </>
                )}
              </div>
              {summarizing ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                  AI가 회의 내용을 분석하고 요약하고 있습니다…
                </div>
              ) : editingSummary ? (
                <>
                  <textarea
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    style={{ width: '100%', minHeight: 320, borderRadius: 8, border: '1px solid #CBD5E1', padding: 12, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.7 }}
                  />
                  <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                    저장된 수정 내역은 다음 회의 요약 시 AI 학습에 자동 반영됩니다.
                  </div>
                </>
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
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>할 일 목록</h3>
                <button style={ghostBtn} onClick={() => {
                  const items = Array.isArray(active.actionItems) ? [...active.actionItems] : [];
                  items.push({ text: '', assignee: '', dueDate: '' });
                  setActive({ ...active, actionItems: items });
                }}>+ 할 일 추가</button>
                {plans.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                    <button
                      style={{ ...primaryBtn, padding: '6px 14px', fontSize: 12 }}
                      onClick={createPlannerTasks}
                      disabled={creatingTasks || !selectedPlanId}
                    >
                      {creatingTasks ? '생성중…' : 'Planner 과제 생성'}
                    </button>
                  </div>
                )}
              </div>
              {active.actionItems && (active.actionItems as any[]).length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {(active.actionItems as any[]).map((item: any, i: number) => (
                    <div key={i} style={{ padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: '#0F3D73', minWidth: 24, paddingTop: 6 }}>{i + 1}.</span>
                        <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                          <input
                            type="text"
                            value={item.text || ''}
                            onChange={(e) => {
                              const items = [...(active.actionItems as any[])];
                              items[i] = { ...items[i], text: e.target.value };
                              setActive({ ...active, actionItems: items });
                            }}
                            placeholder="할 일 내용"
                            style={{ ...input, fontSize: 14, fontWeight: 600 }}
                          />
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 160 }}>
                              <SingleMemberPicker
                                value={actionAssignees[i]?.name || item.assignee || ''}
                                onChange={(m) => {
                                  setActionAssignees((prev) => {
                                    const next = { ...prev };
                                    if (m) next[i] = m;
                                    else delete next[i];
                                    return next;
                                  });
                                }}
                                placeholder="담당자 지정 (검색)"
                              />
                            </div>
                            <input
                              type="date"
                              value={item.dueDate || ''}
                              onChange={(e) => {
                                const items = [...(active.actionItems as any[])];
                                items[i] = { ...items[i], dueDate: e.target.value };
                                setActive({ ...active, actionItems: items });
                              }}
                              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1', color: '#475569' }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const items = [...(active.actionItems as any[])];
                                items.splice(i, 1);
                                setActive({ ...active, actionItems: items });
                                setActionAssignees((prev) => {
                                  const next: Record<number, any> = {};
                                  Object.entries(prev).forEach(([k, v]) => {
                                    const idx = Number(k);
                                    if (idx < i) next[idx] = v;
                                    else if (idx > i) next[idx - 1] = v;
                                  });
                                  return next;
                                });
                              }}
                              style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '2px 6px', whiteSpace: 'nowrap' }}
                            >삭제</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>할 일이 없습니다. AI 요약 생성 후 자동 추출되거나 직접 추가하세요.</div>
              )}
              {!plans.length && (active.actionItems as any[])?.length > 0 && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                  Planner 연동이 필요합니다. Entra SSO 로그인 후 Planner 과제를 생성할 수 있습니다.
                </div>
              )}
            </div>

            {/* Attachments Section */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>첨부파일</h3>
                <button style={ghostBtn} onClick={() => setShowFilePicker(true)}>
                  📁 원드라이브에서 추가 (내부 문서)
                </button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <MobilePhotoButton onUploaded={(files) => void handleAddOneDriveFiles(files.map((f) => ({ url: f.url, name: f.name || f.url })))} />
              </div>
              {active.attachments && (active.attachments as any[]).length > 0 ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  {(active.attachments as any[]).map((att: any, i: number) => {
                    const absUrl = att.url?.startsWith('/') ? apiUrl(att.url) : att.url;
                    const sizeStr = att.size ? `(${(att.size / 1024).toFixed(1)} KB)` : '';
                    return (
                      <div key={`${att.url}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 8 }}>
                        <a className="file-link" href={absUrl} target="_blank" rel="noreferrer" download={att.name || undefined} style={{ flex: 1, fontSize: 14, color: '#0F3D73', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {att.name || att.url}
                        </a>
                        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{sizeStr}</span>
                        <button type="button" style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '2px 6px' }} onClick={() => handleRemoveAttachment(i)}>삭제</button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>첨부된 파일이 없습니다.</div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button style={primaryBtn} onClick={handleSave}>저장</button>
              {active.summary && active.status !== 'finalized' && (
                <button style={{ ...primaryBtn, background: '#059669' }} onClick={handleFinalize}>확정</button>
              )}
              <button style={dangerBtn} onClick={() => handleDelete(active.id)}>삭제</button>
              <button style={ghostBtn} onClick={() => { if (!recorder.recording) setActive(null); }}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {showFilePicker && (
        <OneDriveFilePicker
          userId={userId}
          multiple
          onSelect={(files) => {
            handleAddOneDriveFiles(files);
          }}
          onClose={() => setShowFilePicker(false)}
        />
      )}

      {/* 공유 설정 모달 — 4가지 방식 모두 */}
      {shareFor && (
        <div style={modalOverlay} onClick={() => setShareFor(null)}>
          <div style={{ ...modalBody, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h2 style={{ margin: 0, flex: 1, fontSize: 17 }}>🔗 회의록 공유 — {shareFor.title}</h2>
              <button onClick={() => setShareFor(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontWeight: 700, color: '#475569' }}>✕</button>
            </div>

            {/* ① 공개 범위 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>공개 범위</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['PRIVATE', 'MANAGER_PLUS', 'EXEC_PLUS', 'ORG'] as const).map((v) => (
                  <button key={v} onClick={() => setShareVis(v)}
                    style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${shareVis === v ? '#0F3D73' : '#cbd5e1'}`, background: shareVis === v ? '#0F3D73' : '#fff', color: shareVis === v ? '#fff' : '#334155', cursor: 'pointer', fontSize: 13 }}>
                    {VIS_LABEL[v]}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>범위에 해당하는 구성원은 자동으로 이 회의록을 볼 수 있습니다. <b style={{ color: '#64748b' }}>임원 이상은 공개 범위와 무관하게 모든 회의록을 열람할 수 있습니다.</b></div>
            </div>

            {/* ②③ 지정/참석자 공유 — 구성원 선택 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>구성원 지정 공유 · 참석자</div>
              <input value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder="이름·팀으로 검색해 추가" style={{ ...input, marginBottom: 8 }} />
              {memberQ.trim() && (
                <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8 }}>
                  {members.filter((m) => m.id !== userId && (m.name.includes(memberQ.trim()) || (m.orgName || '').includes(memberQ.trim()))).slice(0, 12).map((m) => {
                    const isShare = shareUserIds.includes(m.id); const isPart = sharePartIds.includes(m.id);
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                        <span style={{ flex: 1 }}>{m.name} <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.orgName}</span></span>
                        <button onClick={() => setSharePartIds((p) => isPart ? p.filter((x) => x !== m.id) : [...p, m.id])}
                          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #ddd6fe', background: isPart ? '#ede9fe' : '#fff', color: '#6d28d9', cursor: 'pointer' }}>참석자</button>
                        <button onClick={() => setShareUserIds((p) => isShare ? p.filter((x) => x !== m.id) : [...p, m.id])}
                          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #bfdbfe', background: isShare ? '#dbeafe' : '#fff', color: '#1d4ed8', cursor: 'pointer' }}>{isShare ? '공유중' : '공유'}</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {(shareUserIds.length > 0 || sharePartIds.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {[...new Set([...sharePartIds, ...shareUserIds])].map((id) => {
                    const m = members.find((x) => x.id === id); const asPart = sharePartIds.includes(id);
                    return (
                      <span key={id} style={{ fontSize: 12, background: asPart ? '#ede9fe' : '#dbeafe', color: asPart ? '#6d28d9' : '#1d4ed8', borderRadius: 14, padding: '2px 8px', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        {asPart ? '👤' : '🔗'}{m?.name || id}
                        <button onClick={() => { setShareUserIds((p) => p.filter((x) => x !== id)); setSharePartIds((p) => p.filter((x) => x !== id)); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}>✕</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>👤 참석자 · 🔗 지정 공유 — 지정된 사람은 자기 회의록 목록에서 바로 봅니다.</div>
            </div>

            {/* ④ 링크 열람 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>링크로 열람</div>
              {shareToken ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input readOnly value={`${window.location.origin}/meetings?share=${shareToken}`} style={{ ...input, flex: 1, fontSize: 12, background: '#f8fafc' }} onFocus={(e) => e.currentTarget.select()} />
                  <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/meetings?share=${shareToken}`); }} style={{ ...ghostBtn }}>복사</button>
                  <button onClick={() => void saveShare(false)} disabled={shareSaving} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#fecaca' }}>링크 해제</button>
                </div>
              ) : (
                <button onClick={() => void saveShare(true)} disabled={shareSaving} style={ghostBtn}>🔗 열람 링크 만들기</button>
              )}
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>로그인한 구성원이 이 링크로 회의록을 열 수 있습니다(읽기 전용).</div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
              <button onClick={() => setShareFor(null)} style={ghostBtn}>취소</button>
              <button onClick={() => void saveShare()} disabled={shareSaving} style={primaryBtn}>{shareSaving ? '저장 중…' : '공유 저장'}</button>
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
