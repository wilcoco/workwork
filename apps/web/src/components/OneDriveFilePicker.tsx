import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  lastModified: string;
  webUrl: string;
  isFolder: boolean;
  childCount?: number;
  mimeType?: string;
}

interface Props {
  userId: string;
  onSelect: (files: Array<{ url: string; name: string }>) => void;
  onClose: () => void;
  multiple?: boolean;
}

export function OneDriveFilePicker({ userId, onSelect, onClose, multiple = true }: Props) {
  const [items, setItems] = useState<OneDriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: 'OneDrive' }]);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const currentFolderId = folderStack[folderStack.length - 1].id;

  useEffect(() => {
    loadFiles(currentFolderId);
  }, [currentFolderId]);

  async function loadFiles(folderId: string, searchQuery?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ userId });
      if (searchQuery) {
        params.set('search', searchQuery);
      } else {
        params.set('folderId', folderId);
      }
      const data = await apiJson<{ items: OneDriveItem[] }>(`/api/graph-tasks/onedrive/files?${params.toString()}`);
      setItems(data.items || []);
    } catch (e: any) {
      setError(e?.message || '파일 목록 로딩 실패');
    } finally {
      setLoading(false);
    }
  }

  function openFolder(item: OneDriveItem) {
    setSearchMode(false);
    setSearch('');
    setSelected(new Set());
    setFolderStack((prev) => [...prev, { id: item.id, name: item.name }]);
  }

  function goBack() {
    if (folderStack.length <= 1) return;
    setSearchMode(false);
    setSearch('');
    setSelected(new Set());
    setFolderStack((prev) => prev.slice(0, -1));
  }

  function goTo(idx: number) {
    if (idx >= folderStack.length - 1) return;
    setSearchMode(false);
    setSearch('');
    setSelected(new Set());
    setFolderStack((prev) => prev.slice(0, idx + 1));
  }

  function doSearch() {
    const q = search.trim();
    if (!q) return;
    setSearchMode(true);
    setSelected(new Set());
    loadFiles('root', q);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (!multiple) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  async function confirmSelection() {
    const selectedFiles = items.filter((f) => selected.has(f.id) && !f.isFolder);
    if (!selectedFiles.length) return;

    setCreating(true);
    setError(null);
    try {
      const results: Array<{ url: string; name: string }> = [];
      for (const f of selectedFiles) {
        const link = await apiJson<{ url: string; name: string }>('/api/graph-tasks/onedrive/share-link', {
          method: 'POST',
          body: JSON.stringify({ userId, fileId: f.id, fileName: f.name }),
        });
        results.push({ url: link.url, name: f.name });
      }
      onSelect(results);
      onClose();
    } catch (e: any) {
      setError(e?.message || '공유 링크 생성 실패');
    } finally {
      setCreating(false);
    }
  }

  function formatSize(bytes: number) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(iso: string) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function fileIcon(item: OneDriveItem) {
    if (item.isFolder) return '📁';
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return '🖼️';
    if (['pdf'].includes(ext)) return '📄';
    if (['doc', 'docx'].includes(ext)) return '📝';
    if (['xls', 'xlsx'].includes(ext)) return '📊';
    if (['ppt', 'pptx'].includes(ext)) return '📑';
    if (['zip', 'rar', '7z'].includes(ext)) return '📦';
    if (['mp4', 'avi', 'mov'].includes(ext)) return '🎬';
    return '📎';
  }

  const selectedCount = [...selected].filter((id) => items.find((f) => f.id === id && !f.isFolder)).length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        style={{ background: '#fff', borderRadius: 16, width: '90vw', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>OneDrive 파일 선택</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 20px', display: 'flex', gap: 8 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            placeholder="파일 검색..."
            style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 12px', fontSize: 13, outline: 'none' }}
          />
          <button type="button" onClick={doSearch} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 13, cursor: 'pointer' }}>
            검색
          </button>
        </div>

        {/* Breadcrumb */}
        {!searchMode && (
          <div style={{ padding: '4px 20px 8px', display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
            {folderStack.map((f, i) => (
              <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: '#94a3b8' }}>›</span>}
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  style={{ background: 'none', border: 'none', cursor: i < folderStack.length - 1 ? 'pointer' : 'default', color: i < folderStack.length - 1 ? '#3b82f6' : '#334155', fontWeight: i === folderStack.length - 1 ? 600 : 400, fontSize: 12, padding: 0 }}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </div>
        )}
        {searchMode && (
          <div style={{ padding: '4px 20px 8px', fontSize: 12, color: '#64748b' }}>
            검색 결과 · <button type="button" onClick={() => { setSearchMode(false); setSearch(''); loadFiles(currentFolderId); }} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12, padding: 0 }}>목록으로 돌아가기</button>
          </div>
        )}

        {/* Error */}
        {error && <div style={{ padding: '0 20px 8px', color: '#ef4444', fontSize: 13 }}>{error}</div>}

        {/* File List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>불러오는 중...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>파일이 없습니다</div>
          ) : (
            <div>
              {/* Back button */}
              {!searchMode && folderStack.length > 1 && (
                <div
                  onClick={goBack}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', cursor: 'pointer', borderRadius: 8, fontSize: 13, color: '#64748b' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 16 }}>⬆️</span>
                  <span>상위 폴더</span>
                </div>
              )}
              {items.map((item) => {
                const isSelected = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => item.isFolder ? openFolder(item) : toggleSelect(item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', cursor: 'pointer',
                      borderRadius: 8, background: isSelected ? '#eff6ff' : 'transparent', border: isSelected ? '1px solid #bfdbfe' : '1px solid transparent',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{fileIcon(item)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b' }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        {item.isFolder ? `${item.childCount ?? ''}개 항목` : formatSize(item.size)}
                        {item.lastModified ? ` · ${formatDate(item.lastModified)}` : ''}
                      </div>
                    </div>
                    {!item.isFolder && (
                      <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${isSelected ? '#3b82f6' : '#cbd5e1'}`, background: isSelected ? '#3b82f6' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {isSelected && <span style={{ color: '#fff', fontSize: 12, lineHeight: 1 }}>✓</span>}
                      </div>
                    )}
                    {item.isFolder && <span style={{ color: '#94a3b8', fontSize: 16 }}>›</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {selectedCount > 0 ? `${selectedCount}개 파일 선택됨` : '파일을 클릭하여 선택하세요'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13, cursor: 'pointer' }}>
              취소
            </button>
            <button
              type="button"
              onClick={confirmSelection}
              disabled={selectedCount === 0 || creating}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: selectedCount > 0 ? '#3b82f6' : '#94a3b8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: selectedCount > 0 ? 'pointer' : 'default', opacity: creating ? 0.6 : 1 }}
            >
              {creating ? '링크 생성 중...' : '선택 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
