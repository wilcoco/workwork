import { useCallback, useEffect, useState } from 'react';

type ToastItem = {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
};

type ConfirmItem = {
  id: number;
  message: string;
  resolve: (ok: boolean) => void;
};

let _addToast: (msg: string, type?: ToastItem['type'], duration?: number) => void = () => {};
let _addConfirm: (msg: string) => Promise<boolean> = () => Promise.resolve(false);

export function toast(msg: string, type: ToastItem['type'] = 'info', duration = 3000) {
  _addToast(msg, type, duration);
}

export function toastConfirm(msg: string): Promise<boolean> {
  return _addConfirm(msg);
}

const TYPE_STYLES: Record<ToastItem['type'], { bg: string; border: string; color: string }> = {
  success: { bg: '#F0FDF4', border: '#86EFAC', color: '#166534' },
  error: { bg: '#FEF2F2', border: '#FCA5A5', color: '#991B1B' },
  info: { bg: '#EFF6FF', border: '#93C5FD', color: '#1E40AF' },
  warning: { bg: '#FFFBEB', border: '#FCD34D', color: '#92400E' },
};

let _nextId = 0;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirms, setConfirms] = useState<ConfirmItem[]>([]);

  const addToast = useCallback((msg: string, type: ToastItem['type'] = 'info', duration = 3000) => {
    const id = ++_nextId;
    setToasts(p => [...p, { id, message: msg, type, duration }]);
    if (duration > 0) setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration);
  }, []);

  const addConfirm = useCallback((msg: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = ++_nextId;
      setConfirms(p => [...p, { id, message: msg, resolve }]);
    });
  }, []);

  useEffect(() => { _addToast = addToast; _addConfirm = addConfirm; }, [addToast, addConfirm]);

  const resolveConfirm = (id: number, ok: boolean) => {
    setConfirms(p => {
      const item = p.find(c => c.id === id);
      if (item) item.resolve(ok);
      return p.filter(c => c.id !== id);
    });
  };

  return (
    <>
      {/* Toast stack */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420, pointerEvents: 'none' }}>
        {toasts.map(t => {
          const s = TYPE_STYLES[t.type];
          return (
            <div key={t.id} style={{
              pointerEvents: 'auto', background: s.bg, border: `1px solid ${s.border}`, color: s.color,
              borderRadius: 10, padding: '10px 16px', fontSize: 13, lineHeight: 1.5, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              animation: 'toast-in 0.25s ease-out',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{t.message}</span>
              <button type="button" onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.color, opacity: 0.6, fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          );
        })}
      </div>

      {/* Confirm dialogs */}
      {confirms.map(c => (
        <div key={c.id} style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}
          onClick={(e) => { if (e.target === e.currentTarget) resolveConfirm(c.id, false); }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', maxWidth: 420, width: '90%', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', animation: 'toast-in 0.2s ease-out' }}>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: '#0f172a', whiteSpace: 'pre-wrap', marginBottom: 20 }}>{c.message}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => resolveConfirm(c.id, false)} style={{ padding: '6px 16px', fontSize: 13 }}>취소</button>
              <button type="button" className="btn" onClick={() => resolveConfirm(c.id, true)} style={{ padding: '6px 16px', fontSize: 13 }}>확인</button>
            </div>
          </div>
        </div>
      ))}

      {/* Animation keyframes */}
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </>
  );
}
