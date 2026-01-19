import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

export function AdminTools() {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmYesProc, setConfirmYesProc] = useState('');
  const [confirmYesWl, setConfirmYesWl] = useState('');
  const [confirmYesKpi, setConfirmYesKpi] = useState('');
  const [confirmYesOkr, setConfirmYesOkr] = useState('');
  const [confirmYesHelp, setConfirmYesHelp] = useState('');
  const [confirmYesApps, setConfirmYesApps] = useState('');
  const [confirmYesAppr, setConfirmYesAppr] = useState('');
  const [loadingProc, setLoadingProc] = useState(false);
  const [loadingWl, setLoadingWl] = useState(false);
  const [loadingKpi, setLoadingKpi] = useState(false);
  const [loadingOkr, setLoadingOkr] = useState(false);
  const [loadingHelp, setLoadingHelp] = useState(false);
  const [loadingApps, setLoadingApps] = useState(false);
  const [loadingAppr, setLoadingAppr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any | null>(null);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
    if (!uid) return;
    (async () => {
      try {
        const me = await apiJson<{ id: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        setRole((me as any).role || '');
      } catch {}
    })();
  }, []);

  const canWipe = role === 'CEO' && confirmText === 'ERASE ALL' && !loading;
  const canWipeProc = role === 'CEO' && confirmYesProc === 'YES' && !loadingProc;
  const canWipeWl = role === 'CEO' && confirmYesWl === 'YES' && !loadingWl;
  const canWipeKpi = role === 'CEO' && confirmYesKpi === 'YES' && !loadingKpi;
  const canWipeOkr = role === 'CEO' && confirmYesOkr === 'YES' && !loadingOkr;
  const canWipeHelp = role === 'CEO' && confirmYesHelp === 'YES' && !loadingHelp;
  const canWipeApps = role === 'CEO' && confirmYesApps === 'YES' && !loadingApps;
  const canWipeAppr = role === 'CEO' && confirmYesAppr === 'YES' && !loadingAppr;

  async function onWipe() {
    if (!canWipe) return;
    if (!confirm('정말 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    setError(null);
    setSummary(null);
    setLoading(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'ERASE ALL' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoading(false);
    }
  }

  async function onWipeProcesses() {
    if (!canWipeProc) return;
    if (!confirm('프로세스 관련 데이터(템플릿/인스턴스/태스크)를 모두 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingProc(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/processes?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingProc(false);
    }
  }

  async function onWipeWorklogs() {
    if (!canWipeWl) return;
    if (!confirm('업무일지 및 관련 진행 기록을 모두 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingWl(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/worklogs?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingWl(false);
    }
  }

  async function onWipeKpis() {
    if (!canWipeKpi) return;
    if (!confirm('KPI(Key Result: 운영형)와 연결된 하위 데이터(과제/체크리스트/업무일지/배정/진행기록)를 모두 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingKpi(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/kpis?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingKpi(false);
    }
  }

  async function onWipeOkrs() {
    if (!canWipeOkr) return;
    if (!confirm('OKR(목표/핵심결과/과제) 전체를 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingOkr(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/okrs?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingOkr(false);
    }
  }

  async function onWipeHelpTickets() {
    if (!canWipeHelp) return;
    if (!confirm('업무 요청(협조) 데이터를 모두 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingHelp(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/help-tickets?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingHelp(false);
    }
  }

  async function onWipeApplications() {
    if (!canWipeApps) return;
    if (!confirm('신청(근태/배차) 데이터를 모두 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingApps(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/applications?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingApps(false);
    }
  }

  async function onWipeApprovals() {
    if (!canWipeAppr) return;
    if (!confirm('결재(ApprovalRequest/Step) 데이터를 모두 삭제하시겠습니까?')) return;
    setError(null);
    setSummary(null);
    setLoadingAppr(true);
    try {
      const res = await apiJson<{ ok: boolean; summary: any }>(`/api/admin/wipe/approvals?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES' }),
      });
      setSummary(res.summary || {});
    } catch (e: any) {
      setError(e?.message || '삭제 실패');
    } finally {
      setLoadingAppr(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '24px auto' }}>
      <div>
        <h2 style={{ margin: 0 }}>시스템 도구</h2>
        <div style={{ color: '#6b7280', marginTop: 4 }}>관리자용 도구입니다. 데이터 삭제는 CEO만 수행할 수 있습니다.</div>
      </div>

      <div className="card" style={{ borderColor: '#ef4444', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, color: '#ef4444' }}>Danger Zone</div>
        </div>
        <div style={{ marginTop: 8, color: '#6b7280' }}>
          데이터베이스를 드롭하지 않고 애플리케이션 데이터만 모두 삭제합니다. 복구할 수 없습니다.
        </div>
        {role !== 'CEO' ? (
          <div style={{ marginTop: 10, color: '#64748b' }}>권한이 없습니다. 대표이사(CEO)만 실행할 수 있습니다.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>확인 문자열</label>
            <input
              placeholder="ERASE ALL"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              style={input}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-danger" disabled={!canWipe} onClick={onWipe}>
                {loading ? '삭제중…' : '데이터 전체 삭제'}
              </button>
            </div>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            {summary && (
              <pre style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, overflowX: 'auto' }}>
                {JSON.stringify(summary, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700 }}>부분 삭제</div>
        {role !== 'CEO' ? (
          <div style={{ marginTop: 10, color: '#64748b' }}>권한이 없습니다. 대표이사(CEO)만 실행할 수 있습니다.</div>
        ) : (
          <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div>프로세스 데이터 삭제</div>
              <input placeholder="YES" value={confirmYesProc} onChange={(e) => setConfirmYesProc(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeProc} onClick={onWipeProcesses}>
                  {loadingProc ? '삭제중…' : '프로세스 지우기'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div>업무일지 삭제</div>
              <input placeholder="YES" value={confirmYesWl} onChange={(e) => setConfirmYesWl(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeWl} onClick={onWipeWorklogs}>
                  {loadingWl ? '삭제중…' : '업무일지 지우기'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div>KPI 삭제</div>
              <input placeholder="YES" value={confirmYesKpi} onChange={(e) => setConfirmYesKpi(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeKpi} onClick={onWipeKpis}>
                  {loadingKpi ? '삭제중…' : 'KPI 지우기'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div>OKR 삭제</div>
              <input placeholder="YES" value={confirmYesOkr} onChange={(e) => setConfirmYesOkr(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeOkr} onClick={onWipeOkrs}>
                  {loadingOkr ? '삭제중…' : 'OKR 지우기'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div>업무 요청(협조) 삭제</div>
              <input placeholder="YES" value={confirmYesHelp} onChange={(e) => setConfirmYesHelp(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeHelp} onClick={onWipeHelpTickets}>
                  {loadingHelp ? '삭제중…' : '업무 요청 지우기'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div>신청(근태/배차) 삭제</div>
              <input placeholder="YES" value={confirmYesApps} onChange={(e) => setConfirmYesApps(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeApps} onClick={onWipeApplications}>
                  {loadingApps ? '삭제중…' : '신청 지우기'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div>결재 데이터 삭제</div>
              <input placeholder="YES" value={confirmYesAppr} onChange={(e) => setConfirmYesAppr(e.target.value)} style={input} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!canWipeAppr} onClick={onWipeApprovals}>
                  {loadingAppr ? '삭제중…' : '결재 지우기'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
