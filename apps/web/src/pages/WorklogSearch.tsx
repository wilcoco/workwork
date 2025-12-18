import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

type Item = {
  id: string;
  date: string;
  title: string;
  excerpt: string;
  userName?: string;
  teamName?: string;
  taskName?: string;
  attachments?: any;
  note?: string;
};

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
      const r = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=${encodeURIComponent('Worklog')}&subjectId=${encodeURIComponent(worklogId)}&limit=100`);
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
        <button className="btn btn-primary" disabled={submitting || !text.trim()} onClick={onSubmit}>{submitting ? '등록중…' : '등록'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}

export function WorklogSearch() {
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
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<'feed' | 'list'>('feed');
  const [detail, setDetail] = useState<Item | null>(null);
  const [kind, setKind] = useState<'' | 'OKR' | 'KPI'>('');
  const location = useLocation();


  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
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
      const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
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
    return html.replace(/(src|href)=["'](\/(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
  }

  useEffect(() => {
    (async () => {
      try {
        const orgRes = await apiJson<{ items: any[] }>(`/api/orgs`);
        setTeams((orgRes.items || []).map((o: any) => ({ id: o.id, name: o.name })));
      } catch {}
      try {
        const userRes = await apiJson<{ items: any[] }>(`/api/users`);
        setUsers((userRes.items || []).map((u: any) => ({ id: u.id, name: u.name, orgUnitId: (u as any)?.orgUnitId, orgUnitName: (u as any)?.orgUnit?.name })));
      } catch {}
    })();
  }, []);

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

  function onContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'IMG') {
      e.preventDefault();
      const src = (target as HTMLImageElement).src;
      if (src) setZoomSrc(src);
    }
  }

  function firstImageUrl(it: Item): string {
    const anyIt: any = it as any;
    const files = anyIt?.attachments?.files || [];
    const fileImg = files.find((f: any) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
    if (fileImg) {
      return absLink(fileImg.url as string);
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
      <div style={{ display: 'grid', gap: 8, background: '#FFFFFF', border: '1px solid #E5E7EB', padding: 14, borderRadius: 12, boxShadow: '0 2px 10px rgba(16,24,40,0.04)' }}>
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
          <button className="btn btn-primary" onClick={() => { setMode('list'); search(); }} disabled={loading}>{loading ? '검색중…' : '검색'}</button>
        </div>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      {mode === 'feed' ? (
        <div className="feed-grid">
          {items.map((it) => {
            const imgUrl = firstImageUrl(it);
            return (
              <div
                key={it.id}
                className="feed-tile"
                style={imgUrl ? { backgroundImage: `url(${imgUrl})`, cursor: 'pointer' } : { cursor: 'pointer' }}
                onClick={() => setDetail(it)}
                title="내용 보기"
              >
                {imgUrl ? (
                  <div className="feed-titlebar">
                    <div className="feed-title">{it.title}</div>
                  </div>
                ) : (
                  <div className="feed-fallback">
                    <div className="feed-title">{it.title}</div>
                  </div>
                )}
                <div className="feed-caption">{it.userName || ''}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
        {items.map((it) => (
          <div key={it.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
              <div style={avatar}>{(it.userName || '?').slice(0, 1)}</div>
              <div>{it.userName}</div>
              <div>·</div>
              <div>{it.teamName}</div>
              <div style={{ marginLeft: 'auto', background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{formatKstDatetime(it.date)}</div>
            </div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{it.title}</div>
            {it.attachments?.contentHtml ? (
              <div
                className="rich-content"
                style={{ marginTop: 6, color: '#111827', border: '1px solid #eee', borderRadius: 8, padding: 12 }}
                onClick={onContentClick}
                dangerouslySetInnerHTML={{ __html: absolutizeUploads(it.attachments.contentHtml) }}
              />
            ) : (
              <div style={{ marginTop: 6, color: '#374151' }}>{it.excerpt}</div>
            )}
            {Array.isArray(it.attachments?.files) && it.attachments.files.length > 0 && (
              <div className="attachments" style={{ marginTop: 10 }}>
                {it.attachments.files.map((f: any, i: number) => {
                  const url = absLink(f.url as string);
                  const name = f.name || f.filename || decodeURIComponent((url.split('/').pop() || url));
                  const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                  return (
                    <div className="attachment-item" key={(f.filename || f.url) + i}>
                      {isImg ? (
                        <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, cursor: 'zoom-in' }} onClick={() => setZoomSrc(url)} />
                      ) : (
                        <a className="file-link" href={url} target="_blank" rel="noreferrer">{name}</a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {it.taskName && <div style={{ marginTop: 10, fontSize: 12, color: '#0F3D73', background: '#E6EEF7', display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontWeight: 600 }}>{it.taskName}</div>}
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox worklogId={it.id} />
            </div>
          </div>
        ))}
        </div>
      )}
      {zoomSrc && (
        <div className="image-overlay" onClick={() => setZoomSrc(null)}>
          <img src={zoomSrc} alt="preview" />
        </div>
      )}
      {detail && (
        <div className="image-overlay" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 720, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
              <div style={avatar}>{(detail.userName || '?').slice(0, 1)}</div>
              <div>{detail.userName}</div>
              <div>·</div>
              <div>{detail.teamName}</div>
              <div style={{ marginLeft: 'auto', background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{formatKstDatetime(detail.date)}</div>
            </div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{detail.title}</div>
            {(detail as any)?.attachments?.contentHtml ? (
              <div
                className="rich-content"
                style={{ marginTop: 6, color: '#111827', border: '1px solid #eee', borderRadius: 8, padding: 12 }}
                onClick={onContentClick}
                dangerouslySetInnerHTML={{ __html: absolutizeUploads((detail as any).attachments.contentHtml) }}
              />
            ) : (
              <div style={{ marginTop: 6, color: '#374151' }}>{detail.excerpt}</div>
            )}
            {Array.isArray((detail as any)?.attachments?.files) && (detail as any).attachments.files.length > 0 && (
              <div className="attachments" style={{ marginTop: 10 }}>
                {(detail as any).attachments.files.map((f: any, i: number) => {
                  const url = absLink(f.url as string);
                  const name = f.name || f.filename || decodeURIComponent((url.split('/').pop() || url));
                  const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                  return (
                    <div className="attachment-item" key={(f.filename || f.url) + i}>
                      {isImg ? (
                        <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, cursor: 'zoom-in' }} onClick={() => setZoomSrc(url)} />
                      ) : (
                        <a className="file-link" href={url} target="_blank" rel="noreferrer">{name}</a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {detail.taskName && <div style={{ marginTop: 10, fontSize: 12, color: '#0F3D73', background: '#E6EEF7', display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontWeight: 600 }}>{detail.taskName}</div>}
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox worklogId={detail.id} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setDetail(null)}>닫기</button>
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
