import { apiFetch, API_BASE, apiUrl } from './api';
import { getToken } from './auth';

export type UploadResp = {
  url: string;
  name: string;
  size: number;
  type: string;
  filename: string;
};

// Image constraints
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_IMAGE_DIM = 2560; // px, long edge

function isProcessableImage(file: File) {
  const t = file.type.toLowerCase();
  if (!t.startsWith('image/')) return false;
  // Skip animated/complex formats we shouldn't rasterize
  if (t === 'image/gif' || t === 'image/svg+xml' || t === 'image/heic' || t === 'image/heif') return false;
  return true;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      try { URL.revokeObjectURL(url); } catch {}
      reject(e);
    };
    img.src = url;
  });
}

function drawToCanvas(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const { naturalWidth: w0, naturalHeight: h0 } = img as any;
  const longEdge = Math.max(w0, h0);
  const scale = longEdge > maxDim ? maxDim / longEdge : 1;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function extForType(mime: string) {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('png')) return 'png';
  return 'img';
}

function changeExt(name: string, newExt: string) {
  const i = name.lastIndexOf('.');
  return (i > 0 ? name.slice(0, i) : name) + '.' + newExt;
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
  });
}

async function compressImageToLimits(file: File): Promise<File> {
  if (!isProcessableImage(file)) return file;
  // Load and possibly downscale
  const img = await loadImageElement(file);
  let maxDim = MAX_IMAGE_DIM;
  let quality = 0.82;
  // Choose output format
  const srcType = file.type.toLowerCase();
  let outType = srcType.includes('jpeg') ? 'image/jpeg' : 'image/webp'; // preserve alpha via webp

  let canvas = drawToCanvas(img, maxDim);
  let blob = await canvasToBlob(canvas, outType, quality);

  // Iterate to satisfy size limit
  let attempts = 0;
  while (blob.size > MAX_IMAGE_BYTES && attempts < 5) {
    attempts += 1;
    if (quality > 0.65) {
      quality = Math.max(0.55, quality - 0.12);
    } else if (maxDim > 1600) {
      maxDim = Math.max(1600, Math.round(maxDim * 0.8));
      canvas = drawToCanvas(img, maxDim);
    } else {
      // last resort: lower dimension further
      maxDim = Math.max(1200, Math.round(maxDim * 0.85));
      canvas = drawToCanvas(img, maxDim);
    }
    blob = await canvasToBlob(canvas, outType, quality);
  }

  // If already within limits and original was small and within dims, keep original file to save time
  const w0 = (img as any).naturalWidth as number;
  const h0 = (img as any).naturalHeight as number;
  const withinDim = Math.max(w0, h0) <= MAX_IMAGE_DIM;
  if (file.size <= MAX_IMAGE_BYTES && withinDim) {
    // Revoke object URL
    URL.revokeObjectURL(img.src);
    return file;
  }

  const newName = changeExt(file.name || 'image', extForType(outType));
  const outFile = new File([blob], newName, { type: outType, lastModified: Date.now() });
  // Revoke object URL
  URL.revokeObjectURL(img.src);
  // Enforce dimension cap: if original exceeded, always return resized result
  if (!withinDim) return outFile;
  // Else prefer smaller or if original exceeds size cap
  return outFile.size < file.size || file.size > MAX_IMAGE_BYTES ? outFile : file;
}

export async function uploadFile(file: File): Promise<UploadResp> {
  try {
    if (file && file.type && file.type.startsWith('image/')) {
      file = await compressImageToLimits(file);
    }
  } catch {
    // Fallback to original file if compression fails
  }
  const fd = new FormData();
  fd.append('file', file);
  // Send filename separately to avoid Multer latin1 encoding corruption for Korean/CJK
  if (file.name) fd.append('originalName', file.name);

  const isChromeDesktop = (() => {
    try {
      const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
      const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua);
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
      return isChrome && !isMobile;
    } catch {
      return false;
    }
  })();

  async function postViaXhr(): Promise<{ status: number; text: string }> {
    const url = apiUrl('/api/uploads');
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'text';
      xhr.onload = () => {
        const status = xhr.status || 0;
        const text = typeof xhr.response === 'string' ? xhr.response : (xhr.responseText || '');
        resolve({ status, text });
      };
      xhr.onerror = () => {
        reject(new Error('upload failed'));
      };
      xhr.onabort = () => {
        reject(new Error('upload aborted'));
      };
      xhr.send(fd);
    });
  }

  let status: number;
  let text: string;
  if (isChromeDesktop) {
    try {
      ({ status, text } = await postViaXhr());
    } catch {
      const res = await apiFetch('/api/uploads', { method: 'POST', body: fd });
      status = res.status;
      text = await res.text();
    }
  } else {
    const res = await apiFetch('/api/uploads', { method: 'POST', body: fd });
    status = res.status;
    text = await res.text();
  }

  const data = text ? JSON.parse(text) : null;
  if (!(status >= 200 && status < 300)) throw new Error((data?.message as any) || text || `${status}`);
  const out = data as UploadResp;
  // Always use the local File.name (correct UTF-8) instead of server's parsed name
  // which may be corrupted by Multer's latin1 encoding
  if (file.name) out.name = file.name;
  if (out && out.url && !/^https?:\/\//i.test(out.url)) {
    // If server gave '/files/...' without global prefix, fix to '/api/files/...'
    const path = out.url.startsWith('/files/') ? `/api${out.url}` : out.url;
    out.url = new URL(path, API_BASE).toString();
  }
  return out;
}

// 사진을 Railway 볼륨(디스크)에 업로드 (/api/uploads/photo → '/uploads/<file>')
export async function uploadPhotosDisk(list: FileList | File[]): Promise<UploadResp[]> {
  const files: File[] = Array.from(list as any);
  const out: UploadResp[] = [];
  for (let f of files) {
    try { if (f && f.type && f.type.startsWith('image/')) f = await compressImageToLimits(f); } catch { /* keep original */ }
    const fd = new FormData();
    fd.append('file', f);
    if (f.name) fd.append('originalName', f.name);
    const res = await apiFetch('/api/uploads/photo', { method: 'POST', body: fd });
    const text = await res.text();
    if (!(res.status >= 200 && res.status < 300)) throw new Error(text || `${res.status}`);
    const data = text ? JSON.parse(text) : null;
    const r = data as UploadResp;
    if (f.name) r.name = f.name;
    if (r && r.url && !/^https?:\/\//i.test(r.url)) r.url = new URL(r.url, API_BASE).toString();
    out.push(r);
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

/** 메시지 첨부 업로드 — 영상 등 큰 파일을 진행률과 함께 올린다 (한 개 200MB까지) */
export const ATTACH_MAX_BYTES = 200 * 1024 * 1024;
export async function uploadAttachments(
  list: FileList | File[],
  onProgress?: (fileIndex: number, percent: number, name: string) => void,
): Promise<UploadResp[]> {
  const files: File[] = Array.from(list as any);
  const out: UploadResp[] = [];
  for (let i = 0; i < files.length; i++) {
    let f = files[i];
    // 사진은 그대로 올리면 큰 경우가 많아 먼저 줄인다. 영상·문서는 손대지 않는다.
    try { if (f?.type?.startsWith('image/')) f = await compressImageToLimits(f); } catch { /* 원본 유지 */ }
    if (f.size > ATTACH_MAX_BYTES) {
      throw new Error(`${f.name}은(는) ${Math.round(f.size / 1024 / 1024)}MB로 너무 큽니다 (한 개 ${ATTACH_MAX_BYTES / 1024 / 1024}MB까지)`);
    }
    const fd = new FormData();
    fd.append('file', f);
    if (f.name) fd.append('originalName', f.name);
    const token = getToken();
    const data: UploadResp = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/api/uploads/attachment'));
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(i, Math.round((e.loaded / e.total) * 100), f.name); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('응답 해석 실패')); } }
        else if (xhr.status === 413) reject(new Error(`${f.name}이(가) 너무 큽니다`));
        else reject(new Error(xhr.responseText || `업로드 실패 (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('네트워크 오류로 업로드하지 못했습니다'));
      xhr.ontimeout = () => reject(new Error('업로드 시간이 초과됐습니다'));
      xhr.timeout = 10 * 60 * 1000; // 큰 영상 대비 10분
      xhr.send(fd);
    });
    if (f.name) data.name = f.name;
    if (data?.url && !/^https?:\/\//i.test(data.url)) data.url = new URL(data.url, API_BASE).toString();
    out.push(data);
  }
  return out;
}
