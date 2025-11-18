export const API_BASE = (import.meta as any)?.env?.VITE_API_BASE || '';

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
  return fetch(url, { ...init, headers });
}

export async function apiJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as any),
    },
  });
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
    // Non-JSON response (e.g., HTML from static server). Treat as error even if status is 200.
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
