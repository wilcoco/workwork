import React from 'react';

export type ApprovalStep = {
  id: string;
  stepNo: number;
  approverId?: string;
  approver?: { id: string; name: string } | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  actedAt?: string | null;
  comment?: string | null;
};

export function stepDisplayStatus(
  steps: ApprovalStep[],
  step: ApprovalStep,
): 'DONE' | 'CURRENT' | 'WAITING' | 'REJECTED' {
  if (step.status === 'APPROVED') return 'DONE';
  if (step.status === 'REJECTED') return 'REJECTED';
  const firstPending = steps.find((s) => s.status === 'PENDING');
  if (firstPending && firstPending.id === step.id) return 'CURRENT';
  return 'WAITING';
}

export function pillStyle(
  ds: 'DONE' | 'CURRENT' | 'WAITING' | 'REJECTED',
  isMe?: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
  if (ds === 'DONE') return { ...base, background: '#ECFDF5', color: '#065F46', borderColor: '#A7F3D0' };
  if (ds === 'REJECTED') return { ...base, background: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA' };
  if (ds === 'CURRENT')
    return {
      ...base,
      background: isMe ? '#0F3D73' : '#FFF7ED',
      color: isMe ? '#FFFFFF' : '#9A3412',
      borderColor: isMe ? '#0F3D73' : '#FED7AA',
    };
  return { ...base, background: '#F8FAFC', color: '#64748B', borderColor: '#E2E8F0' };
}

export function stepIcon(ds: 'DONE' | 'CURRENT' | 'WAITING' | 'REJECTED'): string {
  if (ds === 'DONE') return '✓';
  if (ds === 'REJECTED') return '✗';
  if (ds === 'CURRENT') return '●';
  return '◌';
}

export function turnBadge(
  isMine: boolean,
  status: string,
): { label: string; style: React.CSSProperties } {
  if (status !== 'PENDING') {
    const label = status === 'APPROVED' ? '승인 완료' : status === 'REJECTED' ? '반려됨' : status;
    return {
      label,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        fontWeight: 800,
        background: '#F1F5F9',
        color: '#334155',
        border: '1px solid #CBD5E1',
        whiteSpace: 'nowrap',
      },
    };
  }
  if (isMine) {
    return {
      label: '내 차례',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        fontWeight: 800,
        background: '#16A34A',
        color: '#FFFFFF',
        border: '1px solid #15803D',
        whiteSpace: 'nowrap',
      },
    };
  }
  return {
    label: '내 차례 아님',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 999,
      fontWeight: 700,
      background: '#FEF3C7',
      color: '#92400E',
      border: '1px solid #FDE68A',
      whiteSpace: 'nowrap',
    },
  };
}

export function ApprovalStepLadder({
  steps,
  currentApproverId,
  mineId,
  variant = 'row',
}: {
  steps: ApprovalStep[];
  currentApproverId?: string;
  mineId?: string;
  variant?: 'row' | 'modal';
}) {
  const list = (steps || []).slice().sort((a, b) => (a.stepNo || 0) - (b.stepNo || 0));
  if (list.length === 0) {
    if (!currentApproverId) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={pillStyle('CURRENT')}>1. 결재자</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {list.map((s, idx) => {
        const ds = stepDisplayStatus(list, s);
        const isMe = Boolean(mineId && String(s.approverId || s.approver?.id || '') === mineId);
        return (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={pillStyle(ds, isMe)} title={s.comment ? `의견: ${s.comment}` : undefined}>
              <span style={{ fontWeight: 800, marginRight: 4, opacity: 0.8 }}>{s.stepNo}.</span>
              {s.approver?.name || '결재자'}
              {isMe && <span style={{ marginLeft: 4, fontWeight: 800 }}>(나)</span>}
              <span style={{ marginLeft: 6 }}>{stepIcon(ds)}</span>
            </span>
            {variant === 'modal' && s.actedAt && (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(s.actedAt).toLocaleString()}</span>
            )}
            {idx < list.length - 1 && <span style={{ color: '#cbd5e1' }}>→</span>}
          </span>
        );
      })}
    </div>
  );
}
