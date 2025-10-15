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
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}
