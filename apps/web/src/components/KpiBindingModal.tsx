import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { toast, toastConfirm } from './Toast';

/**
 * KPI 데이터 연결(바인딩) 설정 모달 — 소스(오라클 에이전트 / Odoo / 내부 지표 / REST)만 고르면
 * 월별 값 수집 → 실적 기록 → 리포트 반영은 공통으로 처리된다. 저장 전 미리보기 필수.
 */
type Meta = {
  sourceTypes: string[]; schedules: Record<string, string>; internalMetrics: Record<string, { label: string; unit: string; desc: string }>;
  odooConfigured: boolean; agentTokenConfigured: boolean; agents: Array<{ name: string; version: string; host: string; lastSeenAt: string; online: boolean; queries?: Array<{ id: string; name: string; binds: string[]; tables: string[] }> }>;
  bindTemplates: Record<string, string>;
};
type Binding = { id: string; keyResultId: string; sourceType: string; config: any; schedule: string; enabled: boolean; agentName?: string | null; lastRunAt?: string | null; lastSuccessAt?: string | null; lastError?: string | null; lastValues?: Array<{ year: number; month: number; value: number | null }> | null; jobs?: any[] };

const SRC_LABEL: Record<string, string> = { ORACLE_AGENT: '사내 오라클 (에이전트)', ODOO_RPC: 'Odoo ERP', INTERNAL: 'WorkWork 내부 지표', REST: '외부 REST API' };
const inp: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 13, width: '100%' };
const lbl: React.CSSProperties = { fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 2 };

export function KpiBindingModal(props: { keyResultId: string; title: string; unit?: string | null; userId: string; onClose: () => void; onChanged?: () => void }) {
  const { keyResultId, title, unit, userId, onClose, onChanged } = props;
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cur, setCur] = useState<Binding | null>(null);
  const [sourceType, setSourceType] = useState('INTERNAL');
  const [config, setConfig] = useState<any>({});
  const [schedule, setSchedule] = useState('MONTHLY_2');
  const [agentName, setAgentName] = useState('default');
  const [enabled, setEnabled] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [preview, setPreview] = useState<Array<{ year: number; month: number; value: number | null }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, b] = await Promise.all([
          apiJson<Meta>(`/api/kpi-bindings/meta?userId=${encodeURIComponent(userId)}`),
          apiJson<Binding | null>(`/api/kpi-bindings/kr/${encodeURIComponent(keyResultId)}?userId=${encodeURIComponent(userId)}`),
        ]);
        setMeta(m);
        if (b) { setCur(b); setSourceType(b.sourceType); setConfig(b.config || {}); setSchedule(b.schedule || 'MONTHLY_2'); setAgentName(b.agentName || 'default'); setEnabled(b.enabled !== false); if (b.lastValues) setPreview(b.lastValues); }
        else if (m.agents?.some((a) => a.online)) setSourceType('ORACLE_AGENT');
      } catch (e: any) { toast(e?.message || '불러오기 실패', 'error'); }
    })();
  }, [keyResultId, userId]);

  // 에이전트 작업 폴링
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const j = await apiJson<any>(`/api/kpi-bindings/jobs/${encodeURIComponent(jobId)}?userId=${encodeURIComponent(userId)}`);
        if (j.status === 'DONE') { setPreview(j.result || []); setBusy(null); setJobId(null); toast(`에이전트 실행 완료 (${(j.result || []).length}개월)`, 'success'); onChanged?.(); }
        else if (j.status === 'ERROR' || j.status === 'EXPIRED') { setBusy(null); setJobId(null); toast(`에이전트 오류: ${j.error || j.status}`, 'error'); }
        else setBusy(`사내 에이전트가 실행 중… (${j.status === 'RUNNING' ? '쿼리 실행' : '에이전트 대기'} · 에이전트가 켜져 있어야 합니다)`);
      } catch {}
      if (stop) clearInterval(t);
    }, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [jobId, userId, onChanged]);

  const setC = (k: string, v: any) => setConfig((c: any) => ({ ...c, [k]: v }));

  async function save(): Promise<boolean> {
    setBusy('저장 중…');
    try {
      const b = await apiJson<Binding>(`/api/kpi-bindings/kr/${encodeURIComponent(keyResultId)}`, { method: 'PUT', body: JSON.stringify({ userId, sourceType, config, schedule, agentName, enabled }) });
      setCur(b); toast('데이터 연결을 저장했습니다', 'success'); onChanged?.(); return true;
    } catch (e: any) { toast(e?.message || '저장 실패', 'error'); return false; } finally { setBusy(null); }
  }
  async function doPreview() {
    setBusy('미리보기 조회 중…'); setPreview(null);
    try {
      if (sourceType === 'ORACLE_AGENT' && !cur) { const ok = await save(); if (!ok) return; }
      const r = await apiJson<any>(`/api/kpi-bindings/preview`, { method: 'POST', body: JSON.stringify({ userId, keyResultId, sourceType, config, agentName, year }) });
      if (r.queued) { setJobId(r.jobId); setBusy('사내 에이전트에 작업을 보냈습니다. 결과를 기다리는 중…'); }
      else { setPreview(r.values || []); setBusy(null); }
    } catch (e: any) { toast(e?.message || '미리보기 실패', 'error'); setBusy(null); }
  }
  async function runNow() {
    if (!cur) { const ok = await save(); if (!ok) return; }
    setBusy('동기화 중…');
    try {
      const r = await apiJson<any>(`/api/kpi-bindings/kr/${encodeURIComponent(keyResultId)}/run`, { method: 'POST', body: JSON.stringify({ userId, year }) });
      if (r.queued) { setJobId(r.jobId); setBusy('사내 에이전트에 작업을 보냈습니다…'); }
      else { setPreview(r.values || []); setBusy(null); toast(`실적 ${r.written}개월 기록됨`, 'success'); onChanged?.(); }
    } catch (e: any) { toast(e?.message || '동기화 실패', 'error'); setBusy(null); }
  }
  async function remove() {
    const delValues = await toastConfirm('연결을 해제할까요? (확인=연결만 해제, 자동 기록된 실적은 유지)');
    if (!delValues) return;
    try { await apiJson(`/api/kpi-bindings/kr/${encodeURIComponent(keyResultId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }); toast('연결을 해제했습니다', 'success'); onChanged?.(); onClose(); }
    catch (e: any) { toast(e?.message || '해제 실패', 'error'); }
  }

  const agentOnline = meta?.agents?.some((a) => a.online);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 95, padding: 12 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 860, maxHeight: '92vh', overflow: 'auto', padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16 }}>🔗 데이터 연결</b><span style={{ fontSize: 13, color: '#64748b' }}>{title}{unit ? ` (${unit})` : ''}</span>
          {cur && <span style={{ fontSize: 11, color: cur.lastError ? '#b91c1c' : '#15803d', background: cur.lastError ? '#fef2f2' : '#f0fdf4', borderRadius: 999, padding: '2px 8px' }}>{cur.lastError ? `오류: ${cur.lastError.slice(0, 60)}` : cur.lastSuccessAt ? `마지막 성공 ${new Date(cur.lastSuccessAt).toLocaleString()}` : '아직 실행 안 됨'}</span>}
          <span style={{ flex: 1 }} /><button type="button" className="btn btn-sm btn-outline" onClick={onClose}>닫기</button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>소스만 고르면 월별 값 수집 → KPI 실적 기록 → 리포트 반영은 공통으로 처리됩니다. 자동 기록된 값은 "자동" 배지가 붙고, 사람이 입력한 값과 다르면 괴리가 표시됩니다.</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <div><div style={lbl}>소스</div>
            <select style={inp} value={sourceType} onChange={(e) => { setSourceType(e.target.value); setPreview(null); }}>
              {(meta?.sourceTypes || Object.keys(SRC_LABEL)).map((s) => <option key={s} value={s}>{SRC_LABEL[s] || s}</option>)}
            </select></div>
          <div><div style={lbl}>갱신 주기</div><select style={inp} value={schedule} onChange={(e) => setSchedule(e.target.value)}>{Object.entries(meta?.schedules || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><div style={lbl}>조회 연도</div><select style={inp} value={year} onChange={(e) => setYear(Number(e.target.value))}>{[0, 1, 2].map((d) => { const y = new Date().getFullYear() - d; return <option key={y} value={y}>{y}</option>; })}</select></div>
          <div><div style={lbl}>사용</div><label style={{ fontSize: 13 }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 자동 갱신 켜기</label></div>
        </div>

        {sourceType === 'INTERNAL' && (
          <div><div style={lbl}>내부 지표</div>
            <select style={inp} value={config.metric || ''} onChange={(e) => setC('metric', e.target.value)}>
              <option value="">선택…</option>
              {Object.entries(meta?.internalMetrics || {}).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.unit})</option>)}
            </select>
            {config.metric && meta?.internalMetrics?.[config.metric] && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{meta.internalMetrics[config.metric].desc}</div>}
          </div>
        )}

        {sourceType === 'ORACLE_AGENT' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, padding: 8, borderRadius: 8, background: agentOnline ? '#f0fdf4' : '#fffbeb', border: `1px solid ${agentOnline ? '#86efac' : '#fcd34d'}`, color: agentOnline ? '#166534' : '#92400e' }}>
              {agentOnline ? `사내 에이전트 온라인: ${meta!.agents.filter((a) => a.online).map((a) => `${a.name}@${a.host}`).join(', ')}` : '사내 에이전트가 연결되어 있지 않습니다. 사내 PC에서 workwork_agent 를 실행하면 등록된 질의 목록이 올라오고 작업을 가져갑니다. (설정은 저장 가능)'}
              {!meta?.agentTokenConfigured && ' · 서버에 ORACLE_SYNC_TOKEN 이 없습니다'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><div style={lbl}>에이전트 이름</div><input style={inp} value={agentName} onChange={(e) => setAgentName(e.target.value)} list="agent-names" /><datalist id="agent-names">{(meta?.agents || []).map((a) => <option key={a.name} value={a.name} />)}</datalist></div>
              <div><div style={lbl}>추가 바인드 (JSON, 선택)</div><input style={inp} placeholder='예: {"bul":"폐각"}' value={typeof config.extraBinds === 'string' ? config.extraBinds : config.extraBinds ? JSON.stringify(config.extraBinds) : ''} onChange={(e) => { const v = e.target.value; try { setC('extraBinds', v ? JSON.parse(v) : undefined); } catch { setC('extraBinds', v); } }} /></div>
            </div>
            {(() => {
              const qs = (meta?.agents || []).filter((a) => a.name === agentName).flatMap((a) => a.queries || []);
              const all = qs.length ? qs : (meta?.agents || []).flatMap((a) => a.queries || []);
              const sel = all.find((q) => q.id === config.queryId);
              return (
                <div><div style={lbl}>질의 (사내 에이전트의 agent_queries 폴더에 등록된 것만 선택 가능 — SQL 본문은 클라우드에 저장되지 않습니다)</div>
                  {all.length ? (
                    <select style={inp} value={config.queryId || ''} onChange={(e) => setC('queryId', e.target.value)}>
                      <option value="">선택…</option>
                      {all.map((q) => <option key={q.id} value={q.id}>{q.name} [{q.id}]</option>)}
                    </select>
                  ) : (
                    <input style={inp} placeholder="질의 ID (예: injection_defect_rate) — 에이전트가 연결되면 목록에서 고를 수 있습니다" value={config.queryId || ''} onChange={(e) => setC('queryId', e.target.value)} />
                  )}
                  {sel && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>바인드: {sel.binds.join(', ') || '없음'} · 테이블: {sel.tables.join(', ')}{sel.binds.some((b) => !['yy', 'from_ymd', 'to_ymd', 'from_yyyymmdd', 'to_yyyymmdd'].includes(b)) ? ' · 표준 외 바인드는 "추가 바인드"에 JSON으로 지정하세요' : ''}</div>}
                </div>
              );
            })()}
          </div>
        )}

        {sourceType === 'ODOO_RPC' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {!meta?.odooConfigured && <div style={{ fontSize: 12, padding: 8, borderRadius: 8, background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e' }}>서버에 Odoo 접속 설정(ODOO_URL / ODOO_DB / ODOO_USER / ODOO_API_KEY)이 아직 없습니다. 설정은 저장할 수 있고, 환경변수가 들어오면 자동으로 동작합니다.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              <div><div style={lbl}>모델</div><input style={inp} placeholder="mrp.production" value={config.model || ''} onChange={(e) => setC('model', e.target.value)} /></div>
              <div><div style={lbl}>날짜 필드</div><input style={inp} placeholder="date_finished" value={config.dateField || ''} onChange={(e) => setC('dateField', e.target.value)} /></div>
              <div><div style={lbl}>측정 필드 (__count = 건수)</div><input style={inp} placeholder="product_qty" value={config.measure || ''} onChange={(e) => setC('measure', e.target.value)} /></div>
              <div><div style={lbl}>집계</div><select style={inp} value={config.aggregate || ''} onChange={(e) => setC('aggregate', e.target.value)}><option value="">자동</option><option value="sum">합계</option><option value="avg">평균</option><option value="count">건수</option><option value="max">최대</option><option value="min">최소</option></select></div>
            </div>
            <div><div style={lbl}>필터 domain (JSON 배열, 선택)</div><input style={inp} placeholder='[["state","=","done"]]' value={typeof config.domain === 'string' ? config.domain : config.domain ? JSON.stringify(config.domain) : ''} onChange={(e) => setC('domain', e.target.value)} /></div>
          </div>
        )}

        {sourceType === 'REST' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div><div style={lbl}>URL ({'{year}'} 치환 가능)</div><input style={inp} placeholder="https://.../kpi/defect-rate?year={year}" value={config.url || ''} onChange={(e) => setC('url', e.target.value)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <div><div style={lbl}>응답 배열 경로 (선택)</div><input style={inp} placeholder="data.items" value={config.path || ''} onChange={(e) => setC('path', e.target.value)} /></div>
              <div><div style={lbl}>연도 키</div><input style={inp} placeholder="year" value={config.yearKey || ''} onChange={(e) => setC('yearKey', e.target.value)} /></div>
              <div><div style={lbl}>월 키</div><input style={inp} placeholder="month" value={config.monthKey || ''} onChange={(e) => setC('monthKey', e.target.value)} /></div>
              <div><div style={lbl}>값 키</div><input style={inp} placeholder="value" value={config.valueKey || ''} onChange={(e) => setC('valueKey', e.target.value)} /></div>
              <div><div style={lbl}>인증 토큰 환경변수명 (선택)</div><input style={inp} placeholder="MES_API_TOKEN" value={config.bearerEnv || ''} onChange={(e) => setC('bearerEnv', e.target.value)} /></div>
            </div>
          </div>
        )}

        {busy && <div style={{ fontSize: 13, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px' }}>⏳ {busy}</div>}

        {preview && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>연도</th>{Array.from({ length: 12 }, (_, i) => <th key={i} style={{ padding: 6, textAlign: 'right' }}>{i + 1}월</th>)}</tr></thead>
              <tbody>
                {Array.from(new Set(preview.map((p) => p.year))).map((y) => (
                  <tr key={y}><td style={{ padding: 6, fontWeight: 700 }}>{y}</td>{Array.from({ length: 12 }, (_, i) => { const v = preview.find((p) => p.year === y && p.month === i + 1); return <td key={i} style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v?.value == null ? '#cbd5e1' : '#0f172a' }}>{v?.value == null ? '-' : v.value.toLocaleString()}</td>; })}</tr>
                ))}
                {!preview.length && <tr><td colSpan={13} style={{ padding: 10, color: '#94a3b8', textAlign: 'center' }}>결과가 없습니다 — 기간 조건·바인드·컬럼명을 확인하세요</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {cur && <button type="button" className="btn btn-sm btn-outline" style={{ color: '#dc2626', marginRight: 'auto' }} onClick={() => void remove()}>연결 해제</button>}
          <button type="button" className="btn" disabled={!!busy} onClick={() => void doPreview()}>미리보기</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void save()}>저장</button>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void runNow()}>저장하고 지금 동기화</button>
        </div>
      </div>
    </div>
  );
}
