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

export function WorklogSearch() {
  const [team, setTeam] = useState('');
  const [user, setUser] = useState('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<'feed' | 'list'>('feed');
  const location = useLocation();


  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (team) params.set('team', team);
      if (user) params.set('user', user);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q) params.set('q', q);
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
      const res = await apiJson<{ items: Item[] }>(`/api/worklogs/search?limit=60`);
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
          <input placeholder="팀명" value={team} onChange={(e) => setTeam(e.target.value)} style={input} />
          <input placeholder="이름" value={user} onChange={(e) => setUser(e.target.value)} style={input} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
          <input placeholder="검색어" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {mode === 'list' ? (
            <button className="btn" onClick={() => { setTeam(''); setUser(''); setFrom(''); setTo(''); setQ(''); setMode('feed'); loadRecent(); }} type="button">최근 보기</button>
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
              <Link to={`/search?mode=list`} key={it.id} className="feed-tile" style={imgUrl ? { backgroundImage: `url(${imgUrl})` } : undefined}>
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
              </Link>
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
          </div>
        ))}
        </div>
      )}
      {zoomSrc && (
        <div className="image-overlay" onClick={() => setZoomSrc(null)}>
          <img src={zoomSrc} alt="preview" />
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
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
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
