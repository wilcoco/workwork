import { useMemo, useState } from 'react';
import { toSafeHtml } from '../lib/richText';
import { formatKstDatetime } from '../lib/time';
import { WorklogDocument } from './WorklogDocument';

type Variant = 'full' | 'compact' | 'content';

export function ProcessDocument({ processDoc, variant, onOpenWorklog }: { processDoc: any; variant?: Variant; onOpenWorklog?: (wl: any) => void }) {
  const v: Variant = variant || 'full';
  const inst = processDoc?.process || null;
  const pendingTask = processDoc?.pendingTask || null;
  const summaryTasks: any[] = Array.isArray(processDoc?.summaryTasks) ? processDoc.summaryTasks : [];

  const [localWl, setLocalWl] = useState<any | null>(null);

  const title = String(inst?.title || '').trim() || '프로세스 결재';
  const startedBy = inst?.startedBy?.name || '';
  const status = inst?.status || '';
  const when = inst?.startAt || inst?.createdAt || '';

  const showHeader = v !== 'content';
  const showPending = v === 'full';
  const showPendingDescription = v === 'full';
  const showTasks = v === 'full';
  const showWorklogPreview = v === 'full';

  const totals = useMemo(() => {
    let done = 0;
    let wlCount = 0;
    for (const t of summaryTasks) {
      done += 1;
      const wls = Array.isArray(t?.worklogs) ? t.worklogs : [];
      wlCount += wls.length;
    }
    return { done, wlCount };
  }, [summaryTasks]);

  const openWl = (wl: any) => {
    if (!wl) return;
    if (onOpenWorklog) onOpenWorklog(wl);
    else setLocalWl(wl);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {showHeader && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800, fontSize: v === 'compact' ? 16 : 18, color: '#0f172a' }}>{title}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: '#475569', fontSize: 12 }}>
            {startedBy ? <span style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>시작자: {startedBy}</span> : null}
            {status ? <span style={{ background: '#F1F5F9', color: '#334155', padding: '2px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #CBD5E1' }}>상태: {status}</span> : null}
            {when ? <span style={{ background: '#F8FAFC', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontWeight: 600, border: '1px solid #E2E8F0' }}>시작: {formatKstDatetime(when)}</span> : null}
          </div>
        </div>
      )}

      {showPending && pendingTask && (pendingTask?.name || pendingTask?.description) ? (
        <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#166534' }}>결재 과제</div>
          {pendingTask?.name ? (
            <div style={{ fontSize: 13, color: '#166534', fontWeight: 700 }}>
              {pendingTask.name}{pendingTask.stageLabel ? ` · ${pendingTask.stageLabel}` : ''}
            </div>
          ) : null}
          {showPendingDescription && pendingTask?.description ? (
            <div className="rich-content" style={{ fontSize: 13, color: '#166534', fontWeight: 600 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(String(pendingTask.description)) }} />
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E5E7EB' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>완료 단계 요약</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#475569' }}>완료 {totals.done}건</span>
            <span style={{ fontSize: 12, color: '#475569' }}>참조 업무일지 {totals.wlCount}건</span>
          </div>
        </div>

        {showTasks && summaryTasks.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {summaryTasks.map((t: any, idx: number) => {
              const wls = Array.isArray(t?.worklogs) ? t.worklogs : [];
              return (
                <div key={t?.id || idx} style={{ border: '1px solid #EEF2F7', borderRadius: 10, padding: 10, background: '#F8FAFC', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>#{idx + 1}</div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{t?.name || '-'}</div>
                    {t?.stageLabel ? <div style={{ color: '#64748b' }}>· {t.stageLabel}</div> : null}
                    {t?.taskType ? <div style={{ marginLeft: 'auto', fontSize: 12, color: '#334155' }}>{t.taskType}</div> : null}
                  </div>
                  {wls.length > 0 ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>관련 업무일지</div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {wls.map((wl: any) => {
                          const wlTitle = String(wl?.title || '').trim() || String(wl?.note || '').split(/\n+/)[0] || '업무일지';
                          return (
                            <div key={wl.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, background: '#FFFFFF', display: 'grid', gap: 8 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="btn btn-link"
                                  style={{ padding: 0, border: 'none', background: 'transparent', color: '#0F3D73', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openWl(wl);
                                  }}
                                >
                                  {wlTitle}
                                </button>
                                {wl?.createdAt ? <span style={{ fontSize: 12, color: '#64748b' }}>{formatKstDatetime(wl.createdAt)}</span> : null}
                                {wl?.createdBy?.name ? <span style={{ fontSize: 12, color: '#64748b' }}>· {wl.createdBy.name}</span> : null}
                              </div>
                              {showWorklogPreview ? (
                                <WorklogDocument worklog={wl} variant="content" />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>관련 업무일지 없음</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {localWl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 16 }} onClick={() => setLocalWl(null)}>
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 900, width: '100%', maxHeight: '80vh', padding: 16, overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b>{String(localWl?.title || '').trim() || '업무일지'}</b>
              <button type="button" className="btn" onClick={() => setLocalWl(null)}>닫기</button>
            </div>
            <WorklogDocument worklog={localWl} variant="full" />
          </div>
        </div>
      )}
    </div>
  );
}
