import { useEffect, useState, useRef, CSSProperties } from 'react';
import { apiJson } from '../lib/api';

interface Member {
  id: string;
  name: string;
  email: string;
  teamsUpn: string;
  orgName: string;
}

interface Props {
  /** Already selected members (name strings) */
  selected: string[];
  onAdd: (member: { name: string; email: string; teamsUpn: string }) => void;
  onRemove: (idx: number) => void;
  /** Allow manual text entry for non-members */
  allowManual?: boolean;
  placeholder?: string;
  label?: string;
}

const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
  borderRadius: 999, background: '#eff6ff', color: '#1e40af', fontSize: 12, fontWeight: 500,
};
const inputStyle: CSSProperties = {
  flex: 1, minWidth: 120, border: '1px solid #cbd5e1', borderRadius: 8,
  padding: '6px 10px', fontSize: 13, outline: 'none',
};

export function MemberSearchPicker({ selected, onAdd, onRemove, allowManual = true, placeholder, label }: Props) {
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiJson<{ items: Member[] }>('/api/users')
      .then((res) => setAllMembers(res.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = query.trim()
    ? allMembers.filter((m) => {
        const q = query.trim().toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.orgName || '').toLowerCase().includes(q)
        );
      }).slice(0, 10)
    : [];

  function selectMember(m: Member) {
    if (!selected.includes(m.name)) {
      onAdd({ name: m.name, email: m.email, teamsUpn: m.teamsUpn || m.email });
    }
    setQuery('');
    setShowDropdown(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      // If there's a matching member, select them
      const match = filtered[0];
      if (match) {
        selectMember(match);
        return;
      }
      // Otherwise, add as manual entry if allowed
      if (allowManual && !selected.includes(q)) {
        onAdd({ name: q, email: '', teamsUpn: '' });
        setQuery('');
        setShowDropdown(false);
      }
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {label && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{label}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {selected.map((name, i) => (
          <span key={`${name}-${i}`} style={chipStyle}>
            {name}
            <button
              type="button"
              onClick={() => onRemove(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: 14, padding: 0, lineHeight: 1 }}
            >×</button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => { if (query.trim()) setShowDropdown(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || '이름 또는 이메일로 검색'}
          style={inputStyle}
        />
      </div>
      {allowManual && query.trim() && !filtered.length && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
          Enter 키를 누르면 "{query.trim()}"(으)로 직접 추가됩니다.
        </div>
      )}
      {showDropdown && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 220, overflowY: 'auto', marginTop: 4,
        }}>
          {filtered.map((m) => (
            <div
              key={m.id}
              onClick={() => selectMember(m)}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
            >
              <div style={{ width: 28, height: 28, borderRadius: 999, background: '#e2e8f0', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                {m.name.charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.orgName ? `${m.orgName} · ` : ''}{m.email}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Simpler single-member picker — returns one member selection */
export function SingleMemberPicker({ value, onChange, placeholder }: {
  value: string;
  onChange: (member: { name: string; email: string; teamsUpn: string } | null) => void;
  placeholder?: string;
}) {
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState(value || '');
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiJson<{ items: Member[] }>('/api/users')
      .then((res) => setAllMembers(res.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = query.trim()
    ? allMembers.filter((m) => {
        const q = query.trim().toLowerCase();
        return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || (m.orgName || '').toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
            if (!e.target.value.trim()) onChange(null);
          }}
          onFocus={() => { if (query.trim()) setShowDropdown(true); }}
          placeholder={placeholder || '담당자 검색'}
          style={{ ...inputStyle, flex: 1 }}
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); onChange(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}>✕</button>
        )}
      </div>
      {showDropdown && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setQuery(m.name);
                onChange({ name: m.name, email: m.email, teamsUpn: m.teamsUpn || m.email });
                setShowDropdown(false);
              }}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
            >
              <b>{m.name}</b> <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.orgName ? `${m.orgName} · ` : ''}{m.email}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
