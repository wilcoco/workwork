import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toast } from '../components/Toast';
import { ManualDocument } from '../components/ManualDocument';
import { ManualRelated } from '../components/ManualRelated';

/**
 * 전사 업무 흐름 지도 — 가치사슬(영업·수주 → … → 물류·출하) 위에 전 매뉴얼과 KPI를 배치.
 * 단계를 클릭하면 업무군(L2)별 매뉴얼 목록이, 매뉴얼을 클릭하면 본문(그림 포함)이 바로 열린다.
 */
type FlowManual = { id: string; userId: string; title: string; team: string; author: string; status: string; readinessScore: number; imageCount: number; attachmentCount: number; templateId: string | null; updatedAt: string };
type FlowDomain = {
  key: string; name: string; kind: 'main' | 'support'; desc: string;
  groups: Array<{ name: string; manuals: FlowManual[] }>;
  kpis: Array<{ id: string; title: string; unit: string; org: string; l2: string }>;
  manualCount: number; processized: number; approved: number;
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DRAFT: { label: '초안', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  REVIEW: { label: '승인 대기', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  APPROVED: { label: '승인됨', color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
  REJECTED: { label: '반려', color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
};

export function ManualFlowMap() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [domains, setDomains] = useState<FlowDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<string>('sales');
  const [openManual, setOpenManual] = useState<FlowManual | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    apiJson<{ domains: FlowDomain[] }>(`/api/work-manuals/flow-map?userId=${encodeURIComponent(userId)}`)
      .then((r) => setDomains(r.domains || []))
      .catch((e: any) => toast(e?.message || '흐름 지도를 불러오지 못했습니다', 'error'))
      .finally(() => setLoading(false));
  }, [userId]);

  async function openDoc(m: FlowManual) {
    setOpenManual(m); setDetail(null); setDetailLoading(true);
    try {
      const d = await apiJson<any>(`/api/work-manuals/library/${encodeURIComponent(m.id)}?userId=${encodeURIComponent(userId)}`);
      setDetail(d);
    } catch (e: any) { toast(e?.message || '본문을 불러오지 못했습니다', 'error'); setOpenManual(null); }
    finally { setDetailLoading(false); }
  }

  const mains = domains.filter((d) => d.kind === 'main');
  const supports = domains.filter((d) => d.kind === 'support');
  const current = domains.find((d) => d.key === sel) || null;

  const DomainBox = ({ d }: { d: FlowDomain }) => (
    <button type="button" onClick={() => setSel(d.key)}
      style={{
        cursor: 'pointer', textAlign: 'left', borderRadius: 10, padding: '8px 10px', minWidth: 118,
        border: sel === d.key ? '2px solid #0F3D73' : '1px solid #cbd5e1',
        background: sel === d.key ? '#f0f6ff' : '#fff',
        display: 'grid', gap: 2,
      }}>
      <b style={{ fontSize: 13, color: '#0f172a' }}>{d.name}</b>
      <span style={{ fontSize: 11, color: '#64748b' }}>매뉴얼 {d.manualCount} · 프로세스 {d.processized}</span>
      <span style={{ fontSize: 11, color: d.kpis.length ? '#6d28d9' : '#cbd5e1' }}>KPI {d.kpis.length}</span>
    </button>
  );

  if (!userId) return <div style={{ padding: 24, color: '#64748b' }}>로그인 후 사용할 수 있습니다.</div>;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>전사 업무 흐름 지도</h2>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          회사 전체 업무를 가치사슬 순서로 배치했습니다. 단계를 누르면 업무군별 매뉴얼이, 매뉴얼을 누르면 본문이 바로 열립니다. KPI는 같은 단계에 매핑되어 있습니다.
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>불러오는 중…</div>}

      {/* 주흐름 가치사슬 */}
      {mains.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, flexWrap: 'wrap' }}>
          {mains.map((d, i) => (
            <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <DomainBox d={d} />
              {i < mains.length - 1 && <span style={{ color: '#94a3b8', fontWeight: 700 }}>→</span>}
            </div>
          ))}
        </div>
      )}
      {/* 지원 도메인 */}
      {supports.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>지원</span>
          {supports.map((d) => <DomainBox key={d.key} d={d} />)}
        </div>
      )}

      {/* 선택된 도메인 상세 */}
      {current && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 16 }}>{current.name}</b>
            <span style={{ fontSize: 12.5, color: '#64748b' }}>{current.desc}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: '#475569' }}>매뉴얼 {current.manualCount} · 프로세스화 {current.processized} · 승인 {current.approved}</span>
          </div>

          {/* KPI 매핑 */}
          {current.kpis.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <b style={{ fontSize: 13, color: '#6d28d9' }}>📊 이 단계의 KPI {current.kpis.length}개</b>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {current.kpis.map((k) => (
                  <span key={k.id} title={`${k.org}${k.l2 ? ` · 연결 업무군: ${k.l2}` : ''}`}
                    style={{ fontSize: 12, color: '#5b21b6', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '3px 10px' }}>
                    {k.title}{k.unit ? ` (${k.unit})` : ''}{k.org ? ` · ${k.org}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          {current.kpis.length === 0 && (
            <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '6px 10px' }}>
              📊 이 단계에는 연결된 KPI가 없습니다 — 실행(매뉴얼)은 있는데 측정이 없는 영역입니다.
            </div>
          )}

          {/* L2 업무군 → 매뉴얼 */}
          {current.groups.map((g) => (
            <div key={g.name} style={{ display: 'grid', gap: 6 }}>
              <b style={{ fontSize: 13.5 }}>{g.name} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({g.manuals.length})</span></b>
              <div style={{ display: 'grid', gap: 4 }}>
                {g.manuals.map((m) => {
                  const st = STATUS_LABEL[m.status] || STATUS_LABEL.DRAFT;
                  return (
                    <div key={m.id} onClick={() => void openDoc(m)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', background: '#fff' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 180 }}>{m.title}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{m.team}{m.author ? ` · ${m.author}` : ''}</span>
                      {m.imageCount > 0
                        ? <span style={{ fontSize: 11, color: '#15803d' }}>📷{m.imageCount}</span>
                        : <span style={{ fontSize: 11, color: '#d97706' }}>📷없음</span>}
                      {m.attachmentCount > 0 && <span title="첨부파일 — 열면 본문 아래에 링크로 표시됩니다" style={{ fontSize: 11, color: '#0F3D73' }}>📎{m.attachmentCount}</span>}
                      <span style={{ fontSize: 11, color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 999, padding: '1px 7px' }}>{st.label}</span>
                      {m.templateId && <span style={{ fontSize: 11, color: '#0F3D73', background: '#f0f6ff', border: '1px solid #bfdbfe', borderRadius: 999, padding: '1px 7px' }}>🔁 프로세스</span>}
                      {m.userId === userId && (
                        <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); nav(`/manuals/mine?edit=${encodeURIComponent(m.id)}`); }}
                          title="내 매뉴얼 — 표준 에디터에서 바로 수정합니다">✏️ 수정</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!current.groups.length && <div style={{ fontSize: 13, color: '#94a3b8' }}>이 단계에 등록된 매뉴얼이 없습니다.</div>}
        </div>
      )}

      {/* 매뉴얼 본문 모달 — 그림·양식 그대로 */}
      {openManual && (
        <div onClick={() => { setOpenManual(null); setDetail(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, maxWidth: 860, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 18, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, flex: 1 }}>📖 매뉴얼 열람</b>
              {openManual.templateId && (
                <button className="btn btn-sm btn-outline" onClick={() => nav(`/process/templates?openId=${encodeURIComponent(openManual.templateId!)}`)}>🔁 프로세스 보기</button>
              )}
              {openManual.userId === userId && (
                <button className="btn btn-sm btn-primary" onClick={() => nav(`/manuals/mine?edit=${encodeURIComponent(openManual.id)}`)}
                  title="표준 에디터(내 매뉴얼 입력)에서 그림 붙여넣기·파일 첨부까지 바로 수정합니다">✏️ 표준 에디터에서 수정</button>
              )}
              <button className="btn btn-sm btn-outline" onClick={() => nav(`/manuals/library`)}>전사 열람에서 보기</button>
              <button className="btn btn-sm btn-outline" onClick={() => { setOpenManual(null); setDetail(null); }}>닫기</button>
            </div>
            <ManualRelated manualId={openManual.id} userId={userId}
              onOpenManual={(m) => void openDoc({ team: '', author: '', status: '', readinessScore: 0, imageCount: 0, attachmentCount: 0, updatedAt: '', ...m } as FlowManual)} />
            {detailLoading && <div style={{ fontSize: 13, color: '#94a3b8' }}>본문 불러오는 중…</div>}
            {detail && <ManualDocument manual={detail} />}
          </div>
        </div>
      )}
    </div>
  );
}
