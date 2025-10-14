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
  return fetch(url, init);
}
