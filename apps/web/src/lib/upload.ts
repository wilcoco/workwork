import { apiFetch, API_BASE } from './api';

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
  if (t === 'image/gif' || t === 'image/svg+xml') return false;
  return true;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  } finally {
    // We will create a new object URL again for drawing
  }
  const img = new Image();
  img.src = url;
  await new Promise((r) => (img.onload = r as any));
  return img;
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
  const res = await apiFetch('/api/uploads', { method: 'POST', body: fd });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data?.message as any) || text || `${res.status}`);
  const out = data as UploadResp;
  if (out && out.url && !/^https?:\/\//i.test(out.url)) {
    // If server gave '/files/...' without global prefix, fix to '/api/files/...'
    const path = out.url.startsWith('/files/') ? `/api${out.url}` : out.url;
    out.url = new URL(path, API_BASE).toString();
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
