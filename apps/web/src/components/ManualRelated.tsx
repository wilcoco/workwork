import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

/**
 * 매뉴얼 연계 섹션 — 가치사슬 위치(앞/뒤 단계), 연관 KPI, 같은 업무군의 다른 업무, 연결 프로세스.
 * 열람 모달(전사 열람·흐름 지도) 공용. onOpenManual을 주면 형제 매뉴얼을 같은 모달에서 이어서 연다.
 */
type Related = {
  l1: string; l2: string; domainName: string;
  prevDomain: { key: string; name: string } | null;
  nextDomain: { key: string; name: string } | null;
  template: { id: string; title: string } | null;
  kpis: Array<{ id: string; title: string; unit: string; org: string; direct: boolean }>;
  siblings: Array<{ id: string; userId: string; title: string; team: string; author: string; status: string; templateId: string | null }>;
};

const STATUS_KO: Record<string, string> = { DRAFT: '초안', REVIEW: '대기', APPROVED: '승인', REJECTED: '반려' };

export function ManualRelated(props: { manualId: string; userId: string; onOpenManual?: (m: { id: string; userId: string; title: string; templateId: string | null }) => void }) {
  const { manualId, userId, onOpenManual } = props;
  const nav = useNavigate();
  const [rel, setRel] = useState<Related | null>(null);

  useEffect(() => {
    let alive = true;
    setRel(null);
    apiJson<Related>(`/api/work-manuals/related/${encodeURIComponent(manualId)}?userId=${encodeURIComponent(userId)}`)
      .then((r) => { if (alive) setRel(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, [manualId, userId]);

  if (!rel) return null;
  return (
    <div style={{ border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
      {/* 가치사슬 위치 */}
      <div style={{ fontSize: 12.5, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <b style={{ color: '#0f172a' }}>🧭 흐름 위치</b>
        {rel.prevDomain && <span style={{ color: '#94a3b8' }}>{rel.prevDomain.name} →</span>}
        <span style={{ fontWeight: 700, color: '#0F3D73', background: '#f0f6ff', border: '1px solid #bfdbfe', borderRadius: 999, padding: '1px 9px' }}>{rel.domainName} · {rel.l2}</span>
        {rel.nextDomain && <span style={{ color: '#94a3b8' }}>→ {rel.nextDomain.name}</span>}
        <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={() => nav('/manuals/flow')}>지도에서 보기</button>
      </div>

      {/* 연관 KPI */}
      <div style={{ display: 'grid', gap: 4 }}>
        <b style={{ fontSize: 12.5, color: '#6d28d9' }}>📊 연관 KPI {rel.kpis.length ? `(${rel.kpis.length})` : ''}</b>
        {rel.kpis.length ? (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {rel.kpis.map((k) => (
              <span key={k.id} title={`${k.org}${k.direct ? ' · 이 업무군 직접 지표' : ' · 단계 공통 지표'}`}
                style={{ fontSize: 11.5, color: k.direct ? '#fff' : '#5b21b6', background: k.direct ? '#7c3aed' : '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '2px 9px' }}>
                {k.title}{k.unit ? ` (${k.unit})` : ''}{k.org ? ` · ${k.org}` : ''}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: '#b45309' }}>이 업무가 속한 단계에 연결된 KPI가 없습니다 — 측정 없는 실행 영역.</span>
        )}
      </div>

      {/* 연결 프로세스 */}
      {rel.template && (
        <div style={{ fontSize: 12.5 }}>
          <b style={{ color: '#0F3D73' }}>🔁 연결 프로세스</b>{' '}
          <button className="btn btn-sm btn-outline" onClick={() => nav(`/process/templates?openId=${encodeURIComponent(rel.template!.id)}`)}>{rel.template.title || '프로세스 보기'}</button>
        </div>
      )}

      {/* 같은 업무군의 다른 업무 */}
      {rel.siblings.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          <b style={{ fontSize: 12.5, color: '#334155' }}>🔗 같은 업무군의 다른 업무 ({rel.siblings.length})</b>
          <div style={{ display: 'grid', gap: 3, maxHeight: 180, overflow: 'auto' }}>
            {rel.siblings.map((s) => (
              <div key={s.id}
                onClick={() => onOpenManual?.({ id: s.id, userId: s.userId, title: s.title, templateId: s.templateId })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', cursor: onOpenManual ? 'pointer' : 'default' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>{s.team}{s.author ? ` · ${s.author}` : ''} · {STATUS_KO[s.status] || s.status}</span>
                {s.templateId && <span style={{ fontSize: 11, color: '#0F3D73' }}>🔁</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
