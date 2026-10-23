import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';
import { toast, toastConfirm } from '../components/Toast';

/**
 * 회사 설정 · 온보딩 · 데이터 반출 (6단계, 대표 전용)
 *  - 온보딩 체크리스트: 새 회사가 첫 성과까지 가는 8단계
 *  - 테넌트 설정: 회사명·숨김 계정·기본 결재자·AI 공급자·기능 플래그 (코드가 아닌 설정으로)
 *  - 데이터 반출: 핵심 테이블 JSON 한 묶음
 */
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff' };
type K = { key: string; label: string; value: any; defaultValue: any; custom: boolean; updatedAt: string | null };

export function AdminTenant() {
  const userId = useMemo(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : ''), []);
  const nav = useNavigate();
  const [ob, setOb] = useState<any>(null);
  const [st, setSt] = useState<{ keys: K[]; env: Record<string, boolean> } | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try { setOb(await apiJson(`/api/tenant/onboarding?userId=${encodeURIComponent(userId)}`)); } catch (e: any) { toast(e?.message || '실패', 'error'); }
    try { const r = await apiJson<any>(`/api/tenant/settings?userId=${encodeURIComponent(userId)}`); setSt(r); setEdit(Object.fromEntries(r.keys.map((k: K) => [k.key, typeof k.value === 'string' ? k.value : JSON.stringify(k.value, null, Array.isArray(k.value) ? 0 : 1)]))); } catch (e: any) { toast(e?.message || '실패', 'error'); }
  }
  useEffect(() => { if (userId) void load(); /* eslint-disable-next-line */ }, [userId]);

  async function save(k: K) {
    let value: any = edit[k.key];
    if (typeof k.defaultValue !== 'string') { try { value = JSON.parse(edit[k.key]); } catch { return toast('JSON 형식이 올바르지 않습니다', 'error'); } }
    setBusy(k.key);
    try { await apiJson(`/api/tenant/settings`, { method: 'PUT', body: JSON.stringify({ userId, key: k.key, value }) }); toast('저장했습니다 (1분 안에 반영)', 'success'); await load(); } catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(null); }
  }
  async function reset(k: K) {
    if (!(await toastConfirm(`"${k.label}"을(를) 기본값으로 되돌릴까요?`))) return;
    setBusy(k.key);
    try { await apiJson(`/api/tenant/settings`, { method: 'PUT', body: JSON.stringify({ userId, key: k.key, value: k.defaultValue, reset: true }) }); await load(); } catch (e: any) { toast(e?.message || '실패', 'error'); } finally { setBusy(null); }
  }
  async function exportAll() {
    if (!(await toastConfirm('핵심 데이터 전체를 JSON 파일로 내려받습니다(수 MB~수십 MB). 비밀번호·토큰은 포함되지 않습니다. 진행할까요?'))) return;
    window.open(apiUrl(`/api/tenant/export?userId=${encodeURIComponent(userId)}`), '_blank');
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: '0 0 4px' }}>회사 설정 · 온보딩 · 데이터</h2><div style={{ fontSize: 13, color: '#64748b' }}>WorkWork를 다른 회사에 그대로 설치할 수 있도록, 회사마다 다른 값은 코드가 아니라 여기 설정에 둡니다. 온보딩 체크리스트는 새 회사가 첫 성과까지 가는 순서입니다.</div></div>

      {ob && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><b style={{ fontSize: 13 }}>온보딩 체크리스트</b><span style={{ fontSize: 12, color: ob.doneCount === ob.steps.length ? '#15803d' : '#b45309', fontWeight: 700 }}>{ob.doneCount} / {ob.steps.length} 완료</span></div>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {ob.steps.map((s: any) => (
              <div key={s.key} onClick={() => nav(s.link)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: `1px solid ${s.done ? '#86efac' : '#fde68a'}`, background: s.done ? '#f0fdf4' : '#fffbeb', cursor: 'pointer' }}>
                <span style={{ fontSize: 16 }}>{s.done ? '✅' : '⬜'}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{s.title} <span style={{ fontWeight: 400, color: '#64748b' }}>· {s.detail}</span></div><div style={{ fontSize: 11, color: '#64748b' }}>{s.hint}</div></div>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>→</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {st && (
        <div style={card}>
          <b style={{ fontSize: 13 }}>테넌트 설정</b>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>문자열은 그대로, 목록·객체는 JSON으로 입력합니다. 저장 후 1분 안에 서버에 반영됩니다.</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {st.keys.map((k) => (
              <div key={k.key} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'start', fontSize: 13 }}>
                <div><b>{k.label}</b><div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{k.key}</div>{k.custom && <div style={{ fontSize: 10, color: '#0369a1' }}>사용자 지정 · {k.updatedAt ? new Date(k.updatedAt).toLocaleDateString() : ''}</div>}</div>
                {typeof k.defaultValue === 'string' ? <input value={edit[k.key] ?? ''} onChange={(e) => setEdit({ ...edit, [k.key]: e.target.value })} style={{ fontSize: 13, padding: 6 }} /> : <textarea rows={Array.isArray(k.defaultValue) ? 2 : 5} value={edit[k.key] ?? ''} onChange={(e) => setEdit({ ...edit, [k.key]: e.target.value })} style={{ fontSize: 12, padding: 6, fontFamily: 'monospace' }} />}
                <div style={{ display: 'flex', gap: 4 }}><button className="btn btn-sm btn-primary" disabled={busy === k.key} onClick={() => void save(k)}>저장</button>{k.custom && <button className="btn btn-sm btn-outline" disabled={busy === k.key} onClick={() => void reset(k)}>기본값</button>}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: '#475569' }}>
            <b>환경변수(서버에서만 설정)</b>: Anthropic 키 {st.env.anthropicKey ? '✅' : '❌'} · OpenAI 키 {st.env.openaiKey ? '✅' : '❌'} · 사내 에이전트 토큰 {st.env.oracleSyncToken ? '✅' : '❌'} · SharePoint/Graph {st.env.sharepoint ? '✅' : '❌'} · Odoo {st.env.odoo ? '✅' : '❌ (계정 발급 후 ODOO_URL 등 설정)'}
          </div>
        </div>
      )}

      <div style={card}>
        <b style={{ fontSize: 13 }}>데이터 반출</b>
        <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0 8px' }}>조직·구성원·목표/KR/실적·어젠다·업무일지·매뉴얼·프로세스·결재·활동·암묵지 카드·계기판 이력을 JSON 한 파일로. 회사 데이터는 회사 것이라는 약속입니다.</div>
        <button className="btn btn-sm btn-outline" onClick={() => void exportAll()}>⬇ 전체 JSON 내려받기</button>
      </div>
    </div>
  );
}
