import { useEffect, useState } from 'react';
import { LoadingButton } from '../components/LoadingButton';
import { Link, useLocation } from 'react-router-dom';
import { KbBadge, KbAuthorCount } from '../components/KbBadge';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime, formatMinutesAsHmKo } from '../lib/time';
import { WorklogDocument } from '../components/WorklogDocument';

type Item = {
  id: string;
  date: string;
  createdAt?: string;
  visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';
  timeSpentMinutes?: number;
  title: string;
  excerpt: string;
  userName?: string;
  teamName?: string;
  taskName?: string;
  attachments?: any;
  note?: string;
  urgent?: boolean;
  kbBadge?: boolean;
  kbBadgeNote?: string;
  authorKbSeq?: number;
  keywords?: string;
};

const VISIBILITY_LABEL: Record<string, string> = {
  ALL: '전체',
  MANAGER_PLUS: '팀장이상',
  EXEC_PLUS: '임원이상',
  CEO_ONLY: '대표이사',
};

function visibilityKo(v: any): string {
  const key = String(v || 'ALL');
  return VISIBILITY_LABEL[key] || key;
}

function CommentsBox({ worklogId }: { worklogId: string }) {
  const [items, setItems] = useState<Array<{ id: string; authorName?: string; content: string; createdAt: string }>>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const vId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
      const r = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=${encodeURIComponent('Worklog')}&subjectId=${encodeURIComponent(worklogId)}&limit=100${vId ? `&viewerId=${encodeURIComponent(vId)}` : ''}`);
      setItems((r.items || []).map((x: any) => ({ id: x.id, authorName: x.authorName, content: x.content, createdAt: x.createdAt })));
    } catch (e) {
      setError('댓글 조회 실패');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [worklogId]);

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
    };
  }, []);
  async function onSubmit() {
    if (!text.trim()) return;
    const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
    if (!uid) { alert('로그인이 필요합니다'); return; }
    setSubmitting(true);
    try {
      await apiJson(`/api/feedbacks`, {
        method: 'POST',
        body: JSON.stringify({ subjectType: 'Worklog', subjectId: worklogId, authorId: uid, type: 'GENERAL', content: text.trim() }),
      });
      setText('');
      await load();
    } catch (e) {
      alert('댓글 등록 실패');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 700 }}>댓글</div>
      {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
        items.length ? (
          <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
            {items.map((c) => (
              <div key={c.id} style={{ display: 'grid', gap: 2 }}>
                <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstDatetime(c.createdAt)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: '#94a3b8' }}>등록된 댓글이 없습니다.</div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="댓글 입력..."
          style={{
            flex: isMobile ? '1 1 100%' : 1,
            minWidth: isMobile ? '100%' : 0,
            border: '1px solid #CBD5E1',
            borderRadius: 8,
            padding: '8px 10px',
          }}
        />
        <LoadingButton className="btn btn-primary" disabled={!text.trim()} loading={submitting} onClick={onSubmit}>등록</LoadingButton>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}

export function WorklogSearch() {
  const myUserId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [team, setTeam] = useState(''); // team name for API query
  const [user, setUser] = useState(''); // user name for API query
  const [teamId, setTeamId] = useState('');
  const [userId, setUserId] = useState('');
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgUnitId?: string; orgUnitName?: string }>>([]);
  const [krs, setKrs] = useState<Array<{ id: string; label: string; isKpi: boolean }>>([]);
  const [krId, setKrId] = useState('');
  const [krInits, setKrInits] = useState<Record<string, Array<{ id: string; label: string }>>>({});
  const [initiativeId, setInitiativeId] = useState('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'feed' | 'list'>('feed');
  const [detail, setDetail] = useState<Item | null>(null);
  // OneDrive 공유링크 사진의 썸네일 URL 캐시 (공유링크는 <img> 직접 렌더 불가 → Graph 썸네일로 해석)
  const [spThumbs, setSpThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (mode !== 'feed' || !items.length) return;
    const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
    if (!uid) return;
    const need: string[] = [];
    for (const it of items as any[]) {
      for (const f of it?.attachments?.files || []) {
        const u = String(f?.url || '');
        if (!u || spThumbs[u] !== undefined) continue;
        const isImg = /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(String(f?.name || ''));
        const isShare = /^https:\/\/[^/]*sharepoint\.com\//i.test(u) && !/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(u);
        if (isImg && isShare) need.push(u);
      }
    }
    if (!need.length) return;
    apiJson<{ thumbs: Record<string, string> }>(`/api/sharepoint-sync/share-thumbs`, {
      method: 'POST',
      body: JSON.stringify({ userId: uid, urls: Array.from(new Set(need)).slice(0, 60) }),
    })
      .then((r) => setSpThumbs((prev) => {
        const next = { ...prev };
        for (const u of need) next[u] = (r.thumbs || {})[u] || ''; // 실패도 ''로 기록해 재요청 방지
        return next;
      }))
      .catch(() => setSpThumbs((prev) => {
        const next = { ...prev };
        for (const u of need) if (next[u] === undefined) next[u] = '';
        return next;
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, mode]);
  const [detailFull, setDetailFull] = useState<any>(null);
  const [kind, setKind] = useState<'' | 'OKR' | 'KPI'>('');
  const location = useLocation();
  const [isCeo, setIsCeo] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') window.addEventListener('resize', update);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('resize', update); };
  }, []);


  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const viewerId = myUserId;
      if (team) params.set('team', team);
      if (user) params.set('user', user);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q) params.set('q', q);
      if (kind) params.set('kind', kind);
      if (krId) params.set('krId', krId);
      if (initiativeId) params.set('initiativeId', initiativeId);
      if (viewerId) params.set('viewerId', viewerId);
      const res = await apiJson<{ items: Item[] }>(`/api/worklogs/search?${params.toString()}`);
      setItems(res.items);
    } catch (e) {
      setError('조회 실패');
    } finally {
      setLoading(false);
    }
  }

  // default feed load: recent items
  async function loadRecent() {
    setLoading(true);
    setError(null);
    try {
      const viewerId = myUserId;
      const qs = viewerId ? `limit=60&viewerId=${encodeURIComponent(viewerId)}` : 'limit=60';
      const res = await apiJson<{ items: Item[] }>(`/api/worklogs/search?${qs}`);
      setItems(res.items);
    } catch (e) {
      setError('조회 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const m = (sp.get('mode') || '').toLowerCase();
    if (m === 'list') {
      setMode('list');
      search();
    } else {
      setMode('feed');
      loadRecent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  function absLink(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return apiUrl(url);
  }

  function absolutizeUploads(html: string): string {
    if (!html) return html;
    return html.replace(/(src|href)=["'](\/(api\/)?(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
  }

  useEffect(() => {
    (async () => {
      if (myUserId) {
        try {
          const me = await apiJson<{ id: string; role: string; isAdmin?: boolean }>(`/api/users/me?userId=${encodeURIComponent(myUserId)}`);
          setIsCeo(Boolean((me as any)?.isAdmin) || String((me as any)?.role || '') === 'CEO');
        } catch {
          setIsCeo(false);
        }
      } else {
        setIsCeo(false);
      }
      try {
        const orgRes = await apiJson<{ items: any[] }>(`/api/orgs`);
        setTeams((orgRes.items || []).map((o: any) => ({ id: o.id, name: o.name })));
      } catch {}
      try {
        const userRes = await apiJson<{ items: any[] }>(`/api/users`);
        setUsers((userRes.items || []).map((u: any) => ({ id: u.id, name: u.name, orgUnitId: (u as any)?.orgUnitId, orgUnitName: (u as any)?.orgUnit?.name })));
      } catch {}
    })();
  }, [myUserId]);

  async function onDeleteWorklog(id: string) {
    if (!isCeo) return;
    if (!myUserId) { alert('로그인이 필요합니다'); return; }
    if (!confirm('업무일지를 삭제하시겠습니까?')) return;
    try {
      await apiJson(`/api/worklogs/${encodeURIComponent(id)}/delete?userId=${encodeURIComponent(myUserId)}`, { method: 'POST' });
      setItems((prev) => (prev || []).filter((x) => x.id !== id));
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      if (detail?.id === id) setDetail(null);
    } catch (e: any) {
      alert(e?.message || '삭제 실패');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = (items || []).map((it) => it.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  async function onBulkDelete() {
    if (!isCeo) return;
    if (!myUserId) { alert('로그인이 필요합니다'); return; }
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`선택된 ${ids.length}건의 업무일지를 일괄 삭제하시겠습니까?\n(되돌릴 수 없습니다)`)) return;
    try {
      const res = await apiJson<{ deleted: number; requested: number; failed: { id: string; error: string }[] }>(
        `/api/worklogs/bulk-delete?userId=${encodeURIComponent(myUserId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) },
      );
      const deletedSet = new Set(ids.filter((id) => !(res.failed || []).some((f) => f.id === id)));
      setItems((prev) => (prev || []).filter((x) => !deletedSet.has(x.id)));
      setSelectedIds(new Set());
      if (detail && deletedSet.has(detail.id)) setDetail(null);
      const failedCount = (res.failed || []).length;
      alert(`삭제 완료: ${res.deleted}건${failedCount ? ` (실패 ${failedCount}건)` : ''}`);
    } catch (e: any) {
      alert(e?.message || '일괄 삭제 실패');
    }
  }

  // Load KRs when teamId or userId changes
  useEffect(() => {
    (async () => {
      try {
        const list: Array<{ id: string; label: string; isKpi: boolean }> = [];
        const seen = new Set<string>();
        if (teamId) {
          try {
            const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(teamId)}`);
            const map: Record<string, Array<{ id: string; label: string }>> = {};
            for (const o of (res.items || [])) {
              for (const kr of (o.keyResults || [])) {
                if (!seen.has(kr.id)) {
                  seen.add(kr.id);
                  const isKpi = !!o.pillar;
                  list.push({ id: kr.id, label: `${o.title} / ${isKpi ? 'KPI' : 'KR'}: ${kr.title}`, isKpi });
                }
                // Build initiatives list for this KR (flatten children if present)
                const inits: Array<{ id: string; label: string }> = [];
                for (const ii of (kr.initiatives || [])) {
                  const pushInit = (x: any) => {
                    const s0 = x.startAt ? new Date(x.startAt) : null;
                    const e0 = x.endAt ? new Date(x.endAt) : null;
                    const fmt = (d: Date | null) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
                    const label = `${x.title}${s0 || e0 ? ` (${fmt(s0)}${s0||e0?' ~ ':''}${fmt(e0)})` : ''}`;
                    inits.push({ id: x.id, label });
                  };
                  if (Array.isArray(ii.children) && ii.children.length) {
                    for (const ch of ii.children) pushInit(ch);
                  } else {
                    pushInit(ii);
                  }
                }
                map[kr.id] = inits;
              }
            }
            setKrInits(map);
          } catch {}
        }
        if (userId) {
          try {
            const res = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
            for (const o of (res.items || [])) {
              for (const kr of (o.keyResults || [])) {
                if (!seen.has(kr.id)) {
                  seen.add(kr.id);
                  const isKpi = !!o.pillar;
                  list.push({ id: kr.id, label: `${o.title} / ${isKpi ? 'KPI' : 'KR'}: ${kr.title}` , isKpi});
                }
              }
            }
          } catch {}
        }
        setKrs(list);
      } catch {
        setKrs([]);
      }
    })();
  }, [teamId, userId]);

  // 첨부가 사진인지: 이름과 URL을 각각 검사 (OneDrive 공유링크는 URL에 확장자가 없어 이름으로 판별)
  function isImageFile(f: any): boolean {
    return /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(String(f?.name || '')) ||
      /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(String(f?.url || ''));
  }
  // URL을 <img>에 바로 쓸 수 있는지 (디스크 업로드/직접 이미지 URL). OneDrive 공유링크는 불가 → 썸네일 해석 필요
  function isDirectImageUrl(u: string): boolean {
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(u) || u.includes('/uploads/');
  }

  function firstImageUrl(it: Item): string {
    const anyIt: any = it as any;
    const files = anyIt?.attachments?.files || [];
    for (const f of files) {
      if (!isImageFile(f)) continue;
      const u = String(f.url || '');
      if (isDirectImageUrl(u)) return absLink(u);
      const thumb = spThumbs[u]; // OneDrive 공유링크 → Graph 썸네일 (비동기 해석 후 채워짐)
      if (thumb) return thumb;
    }
    const html = anyIt?.attachments?.contentHtml || '';
    if (html) {
      const abs = absolutizeUploads(html);
      const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m && m[1]) return m[1];
    }
    return '';
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', display: 'grid', gap: 12, background: '#F8FAFC', padding: '12px', borderRadius: 12 }}>
      <div style={{ display: 'grid', gap: 8, background: '#FFFFFF', border: '1px solid #E5E7EB', padding: isMobile ? 10 : 14, borderRadius: 12, boxShadow: '0 2px 10px rgba(16,24,40,0.04)', position: 'sticky', top: 0, zIndex: 10 }}>
        {isMobile && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setFiltersOpen((o) => !o)}
              style={{ flex: '0 0 auto' }}
            >
              {filtersOpen ? '▲ 필터 닫기' : '▼ 필터'}
            </button>
            <input
              placeholder="검색어"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setMode('list'); search(); } }}
              style={{ ...input, flex: 1, minWidth: 0, padding: '8px 10px' }}
            />
            <LoadingButton className="btn btn-primary" onClick={() => { setMode('list'); search(); }} loading={loading}>검색</LoadingButton>
          </div>
        )}
        {(!isMobile || filtersOpen) && (
        <>
        <div className="resp-3">
          <select
            value={teamId}
            onChange={(e) => {
              const id = e.target.value;
              setTeamId(id);
              const nm = teams.find((t) => t.id === id)?.name || '';
              setTeam(nm);
            }}
            style={input}
          >
            <option value="">팀 선택(전체)</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select
            value={userId}
            onChange={(e) => {
              const id = e.target.value;
              setUserId(id);
              const u = users.find((uu) => uu.id === id);
              const nm = u?.name || '';
              setUser(nm);
              // When a user is selected, also select their team to load team KPI + personal OKR
              if (u?.orgUnitId) {
                setTeamId(u.orgUnitId);
                const teamName = teams.find((t) => t.id === u.orgUnitId)?.name || u.orgUnitName || '';
                setTeam(teamName);
              }
            }}
            style={input}
          >
            <option value="">이름 선택(전체)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
          <input placeholder="검색어" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
        </div>
        <div className="resp-3">
          <select value={kind} onChange={(e) => {
            const nk = e.target.value as any;
            setKind(nk);
            if (nk) {
              const cur = krs.find((k) => k.id === krId);
              if (cur && ((nk === 'KPI' && !cur.isKpi) || (nk === 'OKR' && cur.isKpi))) {
                setKrId('');
                setInitiativeId('');
              }
            }
          }} style={input}>
            <option value="">종류(전체)</option>
            <option value="OKR">OKR</option>
            <option value="KPI">KPI</option>
          </select>
          <select value={krId} onChange={(e) => setKrId(e.target.value)} style={input}>
            <option value="">지표 선택(전체)</option>
            {(kind ? krs.filter((k) => (kind === 'KPI' ? k.isKpi : !k.isKpi)) : krs).map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <select value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} style={input} disabled={!krId}>
            <option value="">과제 선택(전체)</option>
            {(krInits[krId] || []).map((it) => (
              <option key={it.id} value={it.id}>{it.label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={() => { setMode('feed'); search(); }} type="button">아이콘 보기</button>
          <button className="btn" onClick={() => { setMode('list'); search(); }} type="button">전체 보기</button>
          {mode === 'list' ? (
            <button className="btn" onClick={() => { setTeam(''); setUser(''); setTeamId(''); setUserId(''); setKrId(''); setKrs([]); setKrInits({}); setInitiativeId(''); setFrom(''); setTo(''); setQ(''); setMode('feed'); loadRecent(); }} type="button">최근 보기</button>
          ) : null}
          <LoadingButton className="btn btn-primary" onClick={() => { setMode('list'); search(); }} loading={loading}>검색</LoadingButton>
        </div>
        </>
        )}
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      {isCeo && mode === 'list' && items.length > 0 ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          marginBottom: 8,
          background: selectedIds.size > 0 ? '#FEF2F2' : '#F1F5F9',
          border: `1px solid ${selectedIds.size > 0 ? '#FCA5A5' : '#CBD5E1'}`,
          borderRadius: 10,
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={items.length > 0 && items.every((it) => selectedIds.has(it.id))}
              ref={(el) => {
                if (el) {
                  const some = items.some((it) => selectedIds.has(it.id));
                  const all = items.length > 0 && items.every((it) => selectedIds.has(it.id));
                  el.indeterminate = some && !all;
                }
              }}
              onChange={toggleSelectAllVisible}
            />
            전체 선택 ({selectedIds.size} / {items.length})
          </label>
          <div style={{ flex: 1 }} />
          {selectedIds.size > 0 ? (
            <>
              <button className="btn" type="button" onClick={() => setSelectedIds(new Set())} style={{ fontSize: 12 }}>선택 해제</button>
              <button className="btn" type="button" onClick={onBulkDelete} style={{ background: '#DC2626', color: '#fff', fontWeight: 600 }}>선택 {selectedIds.size}건 일괄 삭제</button>
            </>
          ) : (
            <span style={{ fontSize: 12, color: '#64748B' }}>관리자: 항목 좌측 체크박스로 선택 후 일괄 삭제 가능</span>
          )}
        </div>
      ) : null}

      {mode === 'feed' ? (
        <div className="feed-grid">
          {items.map((it) => {
            const imgUrl = firstImageUrl(it);
            const createdAt = (it as any)?.createdAt || (it as any)?.date;
            const timeSpentMinutes = Number((it as any)?.timeSpentMinutes) || 0;
            const visibility = (it as any)?.visibility;
            return (
              <div
                key={it.id}
                className="feed-tile"
                style={imgUrl ? { backgroundImage: `url(${imgUrl})`, cursor: 'pointer' } : { cursor: 'pointer' }}
                onClick={async () => { setDetail(it); setDetailFull(null); try { const _vid = localStorage.getItem('userId') || ''; const full = await apiJson<any>(`/api/worklogs/${it.id}${_vid ? `?viewerId=${encodeURIComponent(_vid)}` : ''}`); setDetailFull(full); } catch {} }}
                title="내용 보기"
              >
                {imgUrl ? (
                  <div className="feed-titlebar">
                    <div className="feed-title">{it.title}{it.kbBadge ? <><KbBadge note={it.kbBadgeNote} count={it.authorKbSeq} /><KbAuthorCount count={it.authorKbSeq} /></> : null}</div>
                  </div>
                ) : (
                  <div className="feed-fallback">
                    <div className="feed-title">{it.title}{it.kbBadge ? <><KbBadge note={it.kbBadgeNote} count={it.authorKbSeq} /><KbAuthorCount count={it.authorKbSeq} /></> : null}</div>
                  </div>
                )}
                <div className="feed-caption">
                  <div className="feed-caption-user">{it.userName || ''}</div>
                  <div className="feed-caption-meta">
                    {createdAt ? formatKstDatetime(createdAt) : ''}
                    {timeSpentMinutes ? ` · ${formatMinutesAsHmKo(timeSpentMinutes)}` : ''}
                    {visibility ? ` · 조회권한 ${visibilityKo(visibility)}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
        {items.map((it) => (
          <div key={it.id} style={card}>
            {isCeo ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedIds.has(it.id)} onChange={() => toggleSelect(it.id)} />
                  선택
                </label>
                <button className="btn" type="button" onClick={() => onDeleteWorklog(it.id)} style={{ color: '#b91c1c' }}>삭제</button>
              </div>
            ) : null}
            <WorklogDocument worklog={it} variant="full" />
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox worklogId={it.id} />
            </div>
          </div>
        ))}
        </div>
      )}
      {detail && (
        <div className="image-overlay" onClick={() => { setDetail(null); setDetailFull(null); }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 720, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            {isCeo ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn" type="button" onClick={() => onDeleteWorklog(detail.id)} style={{ color: '#b91c1c' }}>삭제</button>
              </div>
            ) : null}
            {detailFull ? <WorklogDocument worklog={detailFull} variant="full" /> : <WorklogDocument worklog={detail} variant="full" />}
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox worklogId={detail.id} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => { setDetail(null); setDetailFull(null); }}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};

const avatar: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  background: '#E2E8F0',
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  fontWeight: 700,
};
