import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';

export function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brandName, setBrandName] = useState<string>('');

  const rawCompanyName = (import.meta as any)?.env?.VITE_COMPANY_NAME ?? '';
  const companyName = String(rawCompanyName).trim().replace(/^['"]+|['"]+$/g, '');
  const norm = companyName.toLowerCase();
  const host = (typeof window !== 'undefined' ? window.location?.hostname : '') || '';
  const hostNorm = String(host || '').toLowerCase();

  useEffect(() => {
    (async () => {
      try {
        const b = await apiJson<{ name: string; logoPath: string }>(`/api/brand`);
        setBrandName(String(b?.name || ''));
      } catch {
        // ignore
      }
    })();
  }, []);

  const isCams = useMemo(() => {
    const byBrand = String(brandName || '').toLowerCase();
    if (byBrand.includes('캠스') || byBrand.includes('cams')) return true;
    // fallback to build-time env
    if (norm.includes('캠스') || norm.includes('cams')) return true;
    // final fallback: production domain (CAMS)
    return hostNorm.endsWith('icams.co.kr') || hostNorm.includes('icams');
  }, [brandName, norm, hostNorm]);

  const qsError = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const e = params.get('error');
      return e ? String(e) : '';
    } catch {
      return '';
    }
  }, [location.search]);

  const returnTo = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const r = String(params.get('return') || '').trim();
      if (r && r.startsWith('/') && !r.startsWith('//')) return r;
      return '/';
    } catch {
      return '/';
    }
  }, [location.search]);

  function onMicrosoftLogin() {
    setLoading(true);
    const url = apiUrl(`/api/auth/entra/start?return=${encodeURIComponent(returnTo)}`);
    window.location.href = url;
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: '24px auto' }}>
        <h2 style={{ margin: 0 }}>로그인</h2>
        {(qsError || error) && <div className="error">{qsError || error}</div>}
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={onMicrosoftLogin} disabled={loading}>
            Microsoft로 로그인
          </button>
          {!isCams && (
            <button type="button" className="btn btn-ghost" onClick={() => nav('/auth/pending')} disabled={loading}>
              로그인 승인 안내
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
          회사 계정(Entra ID)으로 로그인합니다. 최초 로그인은 관리자/대표 승인 후 활성화됩니다.
        </div>
      </div>
    </div>
  );
}
