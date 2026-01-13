const ENV_API_BASE = import.meta.env.VITE_API_BASE as string | undefined;
function resolveApiBase(): string {
  try {
    const override = typeof localStorage !== 'undefined' ? localStorage.getItem('API_BASE') || '' : '';
    let base = override || ENV_API_BASE || '';
    base = String(base || '').trim();
    if (!base) throw new Error('VITE_API_BASE is required');

    // Avoid redirects (e.g. http -> https) that may downgrade POST to GET in some environments.
    // Keep localhost as-is for local dev.
    const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const isLocal = /^(http:\/\/)?(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(base);
    if (isHttpsPage && !isLocal && base.startsWith('http://')) {
      base = 'https://' + base.slice('http://'.length);
    }

    // Normalize trailing slashes for consistent URL joins.
    base = base.replace(/\/+$/, '');
    // eslint-disable-next-line no-console
    console.log('[api] API_BASE', { override: !!override, base });
    return base;
  } catch (e) {
    throw e;
  }
}
export const API_BASE = resolveApiBase();

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  try {
    // Ensures proper join even when path starts with '/'
    return new URL(path, API_BASE).toString();
  } catch {
    return API_BASE.replace(/\/$/, '') + path;
  }
}

export function apiFetch(input: string, init?: RequestInit) {
  const url = apiUrl(input);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = new Headers(init?.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const body: any = (init as any)?.body;
  const method = init?.method || (body instanceof FormData ? 'POST' : undefined);
  return fetch(url, { ...init, method, headers });
}

export async function apiJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as any),
    },
  });
  // Tolerate 204 No Content
  if (res.status === 204) return {} as T;
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const err: any = new Error('Invalid JSON response');
      err.status = res.status;
      err.body = text;
      throw err;
    }
  } else {
    // If DELETE and non-JSON, treat as success for robustness (some proxies return empty/html)
    if ((init?.method || 'GET').toUpperCase() === 'DELETE' && res.ok) {
      return {} as T;
    }
    const snippet = (text || '').slice(0, 200);
    const err: any = new Error(`Non-JSON response (${contentType || 'unknown'}): ${snippet}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (!res.ok) {
    const rawMsg = data?.message ?? text ?? `${res.status}`;
    const msg = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
    const err: any = new Error(msg);
    err.status = res.status;
    err.body = data ?? text;
    throw err;
  }
  return data as T;
}
