import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { uploadPhotosDisk, type UploadResp } from '../lib/upload';
import { toast } from '../components/Toast';
import { emitWithAck, getSocket } from '../lib/messagingSocket';
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../lib/push';

/**
 * 사내 메시지 — Teams식 3단 구성(대화 목록 / 대화창 / 참여자).
 * 실시간은 WebSocket, 끊기면 자동 재연결 후 놓친 메시지를 복구한다(배포 때마다 끊기므로 필수).
 */
type Conv = { id: string; type: 'DM' | 'GROUP'; title: string; subtitle: string; memberIds: string[]; members: Array<{ id: string; name: string; team: string }>; lastMessageAt?: string; lastPreview: string; unread: number; muted?: boolean };
type Msg = { id: string; conversationId: string; senderId: string; senderName: string; body: string; attachments?: any[]; createdAt: string; tempId?: string; pending?: boolean; failed?: boolean };
type Person = { id: string; name: string; team: string; email?: string };

const ACCENT = '#5B5FC7';          // Teams 보라 계열
const ACCENT_SOFT = '#E8EBFA';
const BORDER = '#E1E1E1';

const initials = (n: string) => (n || '?').trim().slice(0, 2);
function colorOf(id: string) {
  const palette = ['#6264A7', '#0F7B8A', '#C4314B', '#498205', '#8764B8', '#005B70', '#A16400', '#4F6BED'];
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function Avatar({ id, name, size = 32, online }: { id: string; name: string; size?: number; online?: boolean }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: `0 0 ${size}px` }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: colorOf(id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700 }}>{initials(name)}</div>
      {online !== undefined && (
        <span style={{ position: 'absolute', right: -1, bottom: -1, width: size * 0.3, height: size * 0.3, borderRadius: '50%', background: online ? '#6BB700' : '#C8C6C4', border: '2px solid #fff' }} />
      )}
    </div>
  );
}
function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  if (yest) return '어제';
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}
/** 한글 초성 추출 — "ㄱㅂㅇ"으로 "김부영"을 찾을 수 있게 */
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
function initialsOf(text: string) {
  let out = '';
  for (const ch of String(text || '')) {
    const c = ch.charCodeAt(0);
    out += (c >= 0xac00 && c <= 0xd7a3) ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}
/** 이름·팀을 글자/초성 양쪽으로 맞춰 본다 */
function personMatches(p: { name: string; team: string }, q: string) {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = `${p.name} ${p.team}`.toLowerCase();
  if (hay.includes(t)) return true;
  return initialsOf(hay).toLowerCase().includes(initialsOf(t).toLowerCase());
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

export function Messenger() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const myName = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userName') || '나' : '나'), []);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typingIn, setTypingIn] = useState<Record<string, string[]>>({});
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState<null | 'dm' | 'group'>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [pickSel, setPickSel] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [pickerQ, setPickerQ] = useState('');
  const [push, setPush] = useState<PushState>('unsupported');
  const [pendingFiles, setPendingFiles] = useState<UploadResp[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(activeId);
  const lastIdRef = useRef<string>('');
  activeRef.current = activeId;

  const active = convs.find((c) => c.id === activeId) || null;

  const loadConvs = useCallback(async () => {
    try {
      const r = await apiJson<{ items: Conv[]; online: string[] }>(`/api/messaging/conversations?userId=${encodeURIComponent(userId)}`);
      setConvs(r.items || []);
      setOnline(new Set(r.online || []));
      return r.items || [];
    } catch (e: any) { toast(e?.message || '대화 목록을 불러오지 못했습니다', 'error'); return []; }
  }, [userId]);

  const openConv = useCallback(async (id: string) => {
    setActiveId(id); setLoading(true); setMsgs([]);
    try {
      const r = await apiJson<{ items: Msg[] }>(`/api/messaging/conversations/${id}/messages?userId=${encodeURIComponent(userId)}&limit=50`);
      setMsgs(r.items || []);
      lastIdRef.current = r.items?.length ? r.items[r.items.length - 1].id : '';
      const s = getSocket();
      if (s?.connected) s.emit('read', { conversationId: id });
      else await apiJson(`/api/messaging/conversations/${id}/read`, { method: 'POST', body: JSON.stringify({ userId }) }).catch(() => {});
      setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    } catch (e: any) { toast(e?.message || '대화를 열지 못했습니다', 'error'); } finally { setLoading(false); }
  }, [userId]);

  // 최초 로드
  useEffect(() => { if (userId) void loadConvs(); }, [userId, loadConvs]);
  useEffect(() => { void pushState().then(setPush); }, []);

  async function togglePush() {
    if (push === 'on') { await disablePush(userId); setPush('off'); toast('이 기기에서 알림을 껐습니다', 'info'); return; }
    const r = await enablePush(userId);
    if (!r.ok) { toast(r.reason || '켜지 못했습니다', 'error', 6000); setPush(await pushState()); return; }
    setPush('on');
    try { const t = await sendTestPush(userId); toast(t.sent ? '알림을 켰습니다 — 시험 알림을 보냈습니다' : '켰지만 시험 알림이 가지 않았습니다', t.sent ? 'success' : 'error'); }
    catch { toast('알림을 켰습니다', 'success'); }
  }

  // 소켓 — 연결/수신/재연결 복구
  useEffect(() => {
    if (!userId) return;
    const s = getSocket();
    if (!s) return;
    const onConnect = () => {
      setConnected(true);
      // 끊겼던 동안 놓친 것 복구
      const id = activeRef.current;
      if (id) {
        s.emit('sync', { conversationId: id, afterMessageId: lastIdRef.current }, (res: any) => {
          if (res?.ok && res.items?.length) {
            setMsgs((prev) => {
              const have = new Set(prev.map((m) => m.id));
              const add = res.items.filter((m: Msg) => !have.has(m.id));
              return add.length ? [...prev, ...add] : prev;
            });
            lastIdRef.current = res.items[res.items.length - 1].id;
          }
        });
      }
      void loadConvs();
    };
    const onDisconnect = () => setConnected(false);
    const onMessage = (m: Msg) => {
      if (m.conversationId === activeRef.current) {
        setMsgs((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev;
          const withoutTemp = m.tempId ? prev.filter((x) => x.tempId !== m.tempId) : prev;
          return [...withoutTemp, m];
        });
        lastIdRef.current = m.id;
        if (m.senderId !== userId) s.emit('read', { conversationId: m.conversationId, messageId: m.id });
      }
      setConvs((cs) => {
        const hit = cs.find((c) => c.id === m.conversationId);
        if (!hit) { void loadConvs(); return cs; }
        return cs
          .map((c) => (c.id === m.conversationId
            ? { ...c, lastMessageAt: m.createdAt, lastPreview: m.body || '📎 첨부', unread: c.id === activeRef.current || m.senderId === userId ? 0 : c.unread + 1 }
            : c))
          .sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
      });
    };
    const onPresence = (p: { userId: string; online: boolean }) => setOnline((o) => { const n = new Set(o); p.online ? n.add(p.userId) : n.delete(p.userId); return n; });
    const onTyping = (p: { conversationId: string; userId: string; typing: boolean }) => {
      setTypingIn((t) => {
        const cur = new Set(t[p.conversationId] || []);
        p.typing ? cur.add(p.userId) : cur.delete(p.userId);
        return { ...t, [p.conversationId]: Array.from(cur) };
      });
      if (p.typing) setTimeout(() => setTypingIn((t) => ({ ...t, [p.conversationId]: (t[p.conversationId] || []).filter((x) => x !== p.userId) })), 4000);
    };
    s.on('connect', onConnect); s.on('disconnect', onDisconnect);
    s.on('message', onMessage); s.on('presence', onPresence); s.on('typing', onTyping);
    if (s.connected) onConnect();
    return () => { s.off('connect', onConnect); s.off('disconnect', onDisconnect); s.off('message', onMessage); s.off('presence', onPresence); s.off('typing', onTyping); };
  }, [userId, loadConvs]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, activeId]);

  // 지금 보고 있는 대화를 서버에 알린다 → 보고 있는 사람에게는 알림을 보내지 않는다
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const tell = () => s.emit('view', { conversationId: activeId || null });
    tell();
    s.on('connect', tell);
    const onHide = () => s.emit('view', { conversationId: document.hidden ? null : (activeId || null) });
    document.addEventListener('visibilitychange', onHide);
    return () => { s.off('connect', tell); document.removeEventListener('visibilitychange', onHide); s.emit('view', { conversationId: null }); };
  }, [activeId]);

  async function send() {
    const text = draft.trim();
    const atts = pendingFiles;
    if ((!text && !atts.length) || !activeId) return;
    const tempId = `t${Date.now()}`;
    const optimistic: Msg = { id: tempId, tempId, conversationId: activeId, senderId: userId, senderName: myName, body: text, attachments: atts, createdAt: new Date().toISOString(), pending: true };
    setMsgs((p) => [...p, optimistic]);
    setDraft(''); setPendingFiles([]);
    const res = await emitWithAck<{ ok: boolean; message?: Msg; error?: string }>('send', { conversationId: activeId, body: text, attachments: atts, tempId });
    if (res?.ok && res.message) {
      setMsgs((p) => p.map((m) => (m.tempId === tempId ? { ...res.message!, tempId: undefined } : m)));
      lastIdRef.current = res.message.id;
      return;
    }
    // 소켓이 안 되면 HTTP로 다시 시도
    try {
      const m = await apiJson<Msg>(`/api/messaging/conversations/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ userId, body: text, attachments: atts }) });
      setMsgs((p) => p.map((x) => (x.tempId === tempId ? m : x)));
      lastIdRef.current = m.id;
    } catch (e: any) {
      setMsgs((p) => p.map((x) => (x.tempId === tempId ? { ...x, pending: false, failed: true } : x)));
      toast(e?.message || '전송 실패', 'error');
    }
  }

  // 한글 IME: 조합(composition) 중에는 Enter를 전송으로 쓰면 안 된다.
  // 조합 중 Enter는 '글자 확정'이 먼저 일어나므로, 전송하고 입력칸을 비우면 확정된 끝 글자가 다시 들어온다.
  const composingRef = useRef(false);
  async function pickFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setUploading(true);
    try {
      const ups = await uploadPhotosDisk(list);   // 디스크 볼륨(/data)에 저장 — DB에 넣지 않는다
      setPendingFiles((p) => [...p, ...ups].slice(0, 10));
    } catch (e: any) { toast(e?.message || '업로드 실패', 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const typingTimer = useRef<any>(null);
  function onDraftChange(v: string) {
    setDraft(v);
    const s = getSocket();
    if (!s?.connected || !activeId) return;
    s.emit('typing', { conversationId: activeId, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => s.emit('typing', { conversationId: activeId, typing: false }), 1500);
  }

  async function openPicker(kind: 'dm' | 'group') {
    setPicker(kind); setPickSel([]); setGroupTitle(''); setPickerQ('');
    try { const r = await apiJson<{ items: Person[] }>(`/api/messaging/directory?userId=${encodeURIComponent(userId)}`); setPeople(r.items || []); }
    catch (e: any) { toast(e?.message || '구성원을 불러오지 못했습니다', 'error'); }
  }
  async function startDm(otherId: string) {
    try { const r = await apiJson<{ id: string }>(`/api/messaging/dm`, { method: 'POST', body: JSON.stringify({ userId, otherId }) }); setPicker(null); await loadConvs(); void openConv(r.id); }
    catch (e: any) { toast(e?.message || '실패', 'error'); }
  }
  async function startGroup() {
    if (pickSel.length < 1) return toast('참여자를 1명 이상 고르세요', 'error');
    try { const r = await apiJson<{ id: string }>(`/api/messaging/group`, { method: 'POST', body: JSON.stringify({ userId, title: groupTitle, memberIds: pickSel }) }); setPicker(null); await loadConvs(); void openConv(r.id); }
    catch (e: any) { toast(e?.message || '실패', 'error'); }
  }

  const filtered = convs.filter((c) => !search.trim() || c.title.includes(search.trim()) || (c.lastPreview || '').includes(search.trim()));
  const typingNames = (active ? (typingIn[active.id] || []) : []).map((id) => active?.members.find((m) => m.id === id)?.name).filter(Boolean);
  // 고를 수 있는 사람: 검색어로 거르되, 그룹에서 이미 고른 사람은 항상 보이게
  const shownPeople = people.filter((p) => personMatches(p, pickerQ) || (picker === 'group' && pickSel.includes(p.id)));
  // 팀 먼저 — 그룹 대화는 보통 팀 단위로 만든다
  const teamGroups = (() => {
    const m = new Map<string, Person[]>();
    for (const p of shownPeople) { const k = p.team || '(소속 없음)'; m.set(k, [...(m.get(k) || []), p]); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  })();
  const toggleTeam = (members: Person[]) => {
    const ids = members.map((m) => m.id);
    const allIn = ids.every((id) => pickSel.includes(id));
    setPickSel((sel) => (allIn ? sel.filter((id) => !ids.includes(id)) : Array.from(new Set([...sel, ...ids]))));
  };

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 8px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '4px 0 10px' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>메시지</h2>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: connected ? '#DFF6DD' : '#FDE7E9', color: connected ? '#0B6A0B' : '#A4262C', fontWeight: 700 }}>
          {connected ? '실시간 연결됨' : '연결 중…'}
        </span>
        <span style={{ flex: 1 }} />
        {push !== 'unsupported' && (
          <button className="btn btn-sm btn-outline" onClick={() => void togglePush()}
            title={push === 'on' ? '이 기기에서 알림 끄기' : '앱을 꺼 둬도 알림을 받습니다'}
            style={push === 'on' ? { borderColor: '#6BB700', color: '#0B6A0B' } : undefined}>
            {push === 'on' ? '🔔 알림 켜짐' : push === 'denied' ? '🔕 알림 차단됨' : '🔔 알림 켜기'}
          </button>
        )}
        <button className="btn btn-sm btn-outline" onClick={() => void openPicker('dm')}>+ 새 대화</button>
        <button className="btn btn-sm btn-outline" onClick={() => void openPicker('group')}>+ 그룹</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', height: 'calc(100vh - 220px)', minHeight: 480, background: '#fff' }}>
        {/* 좌: 대화 목록 */}
        <aside style={{ borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', background: '#F5F5F5', minWidth: 0 }}>
          <div style={{ padding: 10 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="대화 검색"
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '7px 10px', fontSize: 13, background: '#fff' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.map((c) => {
              const act = c.id === activeId;
              const peer = c.type === 'DM' ? c.members[0] : null;
              return (
                <div key={c.id} onClick={() => void openConv(c.id)}
                  style={{ display: 'flex', gap: 10, padding: '9px 10px', cursor: 'pointer', alignItems: 'center', background: act ? '#fff' : 'transparent', borderLeft: `3px solid ${act ? ACCENT : 'transparent'}` }}>
                  <Avatar id={peer?.id || c.id} name={c.title} size={36} online={peer ? online.has(peer.id) : undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13.5, fontWeight: c.unread ? 800 : 600, color: '#252423', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#616161', whiteSpace: 'nowrap' }}>{fmtTime(c.lastMessageAt)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: c.unread ? '#252423' : '#616161', fontWeight: c.unread ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {c.lastPreview || <span style={{ color: '#A19F9D' }}>대화를 시작하세요</span>}
                      </span>
                      {c.unread > 0 && <span style={{ background: '#C4314B', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 800, padding: '1px 6px' }}>{c.unread}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {!filtered.length && <div style={{ padding: 20, textAlign: 'center', color: '#A19F9D', fontSize: 13 }}>대화가 없습니다<br />“+ 새 대화”로 시작하세요</div>}
          </div>
        </aside>

        {/* 우: 대화창 */}
        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!active ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#A19F9D', fontSize: 14 }}>왼쪽에서 대화를 고르세요</div>
          ) : (
            <>
              <header style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Avatar id={active.members[0]?.id || active.id} name={active.title} size={32} online={active.type === 'DM' ? online.has(active.members[0]?.id || '') : undefined} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#252423' }}>{active.title}</div>
                  <div style={{ fontSize: 11.5, color: '#616161' }}>
                    {active.type === 'DM'
                      ? `${active.subtitle}${online.has(active.members[0]?.id || '') ? ' · 접속 중' : ''}`
                      : active.members.map((m) => m.name).join(', ')}
                  </div>
                </div>
              </header>

              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: '#fff' }}>
                {loading && <div style={{ color: '#A19F9D', fontSize: 13 }}>불러오는 중…</div>}
                {msgs.map((m, i) => {
                  const mine = m.senderId === userId;
                  const prev = msgs[i - 1];
                  const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                  const grouped = prev && prev.senderId === m.senderId && !newDay && (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60000);
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 10px' }}>
                          <div style={{ flex: 1, height: 1, background: BORDER }} />
                          <span style={{ fontSize: 11, color: '#616161' }}>{dayLabel(m.createdAt)}</span>
                          <div style={{ flex: 1, height: 1, background: BORDER }} />
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: grouped ? 2 : 10, flexDirection: mine ? 'row-reverse' : 'row' }}>
                        <div style={{ width: 32, flex: '0 0 32px' }}>{!grouped && !mine && <Avatar id={m.senderId} name={m.senderName} size={32} />}</div>
                        <div style={{ maxWidth: '68%', minWidth: 0 }}>
                          {!grouped && (
                            <div style={{ fontSize: 11.5, color: '#616161', marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                              {mine ? '나' : m.senderName} · {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                          <div style={{
                            background: mine ? ACCENT_SOFT : '#F5F5F5', border: `1px solid ${mine ? '#C5CBF5' : BORDER}`,
                            borderRadius: 6, padding: '7px 11px', fontSize: 13.5, lineHeight: 1.5, color: '#252423',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: m.pending ? 0.6 : 1,
                          }}>
                            {m.body}
                            {!!m.attachments?.length && (
                              <div style={{ display: 'grid', gap: 6, marginTop: m.body ? 6 : 0 }}>
                                {m.attachments.map((a: any, k: number) => {
                                  const href = String(a?.url || '').startsWith('http') ? a.url : apiUrl(String(a?.url || ''));
                                  const isImg = /^image\//i.test(String(a?.type || '')) || /\.(png|jpe?g|gif|webp)$/i.test(String(a?.name || ''));
                                  return isImg ? (
                                    <a key={k} href={href} target="_blank" rel="noopener noreferrer">
                                      <img src={href} alt={a?.name || ''} style={{ maxWidth: 260, maxHeight: 220, borderRadius: 6, display: 'block', border: `1px solid ${BORDER}` }} />
                                    </a>
                                  ) : (
                                    <a key={k} href={href} target="_blank" rel="noopener noreferrer" download={a?.name}
                                      style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '6px 10px', fontSize: 12.5, color: '#252423', textDecoration: 'none', maxWidth: 280 }}>
                                      <span>📎</span>
                                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a?.name || '첨부파일'}</span>
                                      {a?.size ? <span style={{ color: '#A19F9D', fontSize: 11 }}>{Math.round(a.size / 1024).toLocaleString()}KB</span> : null}
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                            {m.failed && <div style={{ fontSize: 11, color: '#A4262C', marginTop: 3 }}>전송 실패 — 다시 보내 주세요</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!loading && !msgs.length && <div style={{ color: '#A19F9D', fontSize: 13, textAlign: 'center', marginTop: 30 }}>첫 메시지를 보내 보세요</div>}
                {typingNames.length > 0 && <div style={{ fontSize: 12, color: '#616161', marginTop: 8 }}>{typingNames.join(', ')} 님이 입력 중…</div>}
                <div ref={bottomRef} />
              </div>

              {(pendingFiles.length > 0 || uploading) && (
                <div style={{ borderTop: `1px solid ${BORDER}`, padding: '8px 10px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: '#FAFAFA' }}>
                  {uploading && <span style={{ fontSize: 12, color: '#616161' }}>올리는 중…</span>}
                  {pendingFiles.map((f, i) => (
                    <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 999, padding: '3px 8px', fontSize: 12 }}>
                      📎 <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <button type="button" onClick={() => setPendingFiles((p) => p.filter((_, k) => k !== i))}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#A19F9D', fontSize: 13, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ borderTop: `1px solid ${BORDER}`, padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end', background: '#fff' }}>
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => void pickFiles(e.target.files)} />
                <button type="button" title="파일 첨부 (한 개당 25MB까지)" onClick={() => fileRef.current?.click()}
                  style={{ border: `1px solid ${BORDER}`, background: '#fff', borderRadius: 6, padding: '9px 11px', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>📎</button>
                <textarea
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={(e) => { composingRef.current = false; setDraft((e.target as HTMLTextAreaElement).value); }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey) return;
                    // 조합 중(한글 입력 중)이면 Enter는 글자 확정용 — 전송하지 않는다
                    if (composingRef.current || (e.nativeEvent as any)?.isComposing || (e as any).keyCode === 229) return;
                    e.preventDefault();
                    void send();
                  }}
                  placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
                  rows={1}
                  style={{ flex: 1, resize: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '9px 12px', fontSize: 13.5, maxHeight: 120, fontFamily: 'inherit' }}
                />
                <button onClick={() => void send()} disabled={!draft.trim() && !pendingFiles.length}
                  style={{ background: (draft.trim() || pendingFiles.length) ? ACCENT : '#E1DFDD', color: (draft.trim() || pendingFiles.length) ? '#fff' : '#A19F9D', border: 'none', borderRadius: 6, padding: '9px 18px', fontWeight: 700, fontSize: 13.5, cursor: (draft.trim() || pendingFiles.length) ? 'pointer' : 'default' }}>
                  보내기
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {picker && (
        <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 3000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 440, maxWidth: 'min(440px, 94vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 3001, boxShadow: '0 16px 48px rgba(0,0,0,.28)' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, fontWeight: 700 }}>{picker === 'dm' ? '새 대화 — 상대 고르기' : '그룹 대화 만들기'}</div>
            {picker === 'group' && (
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}` }}>
                <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="그룹 이름 (예: 사출 품질 대응)"
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '7px 10px', fontSize: 13 }} />
              </div>
            )}
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}` }}>
              <input autoFocus value={pickerQ} onChange={(e) => setPickerQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && picker === 'dm' && shownPeople.length === 1) void startDm(shownPeople[0].id); }}
                placeholder="이름 · 팀 검색 (초성도 됩니다, 예: ㄱㅂㅇ)"
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '7px 10px', fontSize: 13 }} />
              <div style={{ fontSize: 11, color: '#A19F9D', marginTop: 4 }}>
                {shownPeople.length}명{picker === 'group' && pickSel.length ? ` · 선택 ${pickSel.length}명` : ''}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {picker === 'group' && teamGroups.length > 1 && (
                <div style={{ padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, background: '#FAFAFA' }}>
                  <div style={{ fontSize: 11, color: '#616161', marginBottom: 6 }}>팀으로 한 번에 고르기</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {teamGroups.map(([team, members]) => {
                      const n = members.filter((m) => pickSel.includes(m.id)).length;
                      const all = n === members.length;
                      return (
                        <button key={team} type="button" onClick={() => toggleTeam(members)}
                          style={{ border: `1px solid ${all ? ACCENT : BORDER}`, background: all ? ACCENT_SOFT : '#fff', color: all ? '#3B3F9E' : '#252423',
                                   borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', width: 'auto' }}>
                          {team} <span style={{ color: '#A19F9D' }}>{n ? `${n}/${members.length}` : members.length}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {teamGroups.map(([team, members]) => (
                <div key={team}>
                  {picker === 'group' && teamGroups.length > 1 && (
                    <div style={{ padding: '6px 16px 2px', fontSize: 11, color: '#A19F9D', background: '#fff', position: 'sticky', top: 0 }}>{team}</div>
                  )}
                  {members.map((p) => (
                    <div key={p.id}
                      onClick={() => picker === 'dm' ? void startDm(p.id) : setPickSel((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])}
                      style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 16px', cursor: 'pointer', background: pickSel.includes(p.id) ? ACCENT_SOFT : undefined }}>
                      <Avatar id={p.id} name={p.name} size={28} online={online.has(p.id)} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                        <span style={{ fontSize: 11.5, color: '#616161', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team}</span>
                      </div>
                      {picker === 'group' && (
                        <input type="checkbox" readOnly checked={pickSel.includes(p.id)}
                          style={{ width: 'auto', minWidth: 0, flex: '0 0 auto', margin: 0, padding: 0 }} />
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {!people.length && <div style={{ padding: 20, textAlign: 'center', color: '#A19F9D', fontSize: 13 }}>구성원을 불러오는 중…</div>}
              {!!people.length && !shownPeople.length && <div style={{ padding: 20, textAlign: 'center', color: '#A19F9D', fontSize: 13 }}>검색 결과가 없습니다</div>}
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-outline" onClick={() => setPicker(null)}>취소</button>
              {picker === 'group' && <button className="btn btn-sm btn-primary" onClick={() => void startGroup()}>만들기 ({pickSel.length})</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
