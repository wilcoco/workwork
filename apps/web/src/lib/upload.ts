import { apiFetch, API_BASE } from './api';

export type UploadResp = {
  url: string;
  name: string;
  size: number;
  type: string;
  filename: string;
};

export async function uploadFile(file: File): Promise<UploadResp> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiFetch('/api/uploads', { method: 'POST', body: fd });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data?.message as any) || text || `${res.status}`);
  const out = data as UploadResp;
  if (out && out.url && !/^https?:\/\//i.test(out.url)) {
    out.url = new URL(out.url, API_BASE).toString();
  }
  return out;
}

export async function uploadFiles(list: FileList | File[]): Promise<UploadResp[]> {
  const files: File[] = Array.from(list as any);
  const out: UploadResp[] = [];
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await uploadFile(f));
  }
  return out;
}
