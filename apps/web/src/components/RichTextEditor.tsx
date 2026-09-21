import { useEffect, useRef } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';

/**
 * 공용 리치 텍스트 에디터 (Quill snow) — 본문에 그림을 바로 넣을 수 있다.
 * - 툴바 이미지 버튼 / 붙여넣기 / 드래그앤드롭 → 서버 업로드 후 URL로 삽입 (base64는 항상 업로드로 치환)
 * - `value`는 초기값이자 외부 리셋용: `resetKey`가 바뀌면 `value`를 다시 적용한다 (수정 모드 전환 등)
 * - 타이핑 중에는 `onChange(html)`만 올리고 value 재적용은 하지 않는다 (커서 튐 방지)
 */
export function RichTextEditor(props: {
  value: string;
  onChange: (html: string) => void;
  resetKey?: string | number;
  placeholder?: string;
  minHeight?: number;
  readOnly?: boolean;
}) {
  const { value, onChange, resetKey, placeholder, minHeight = 260, readOnly } = props;
  const elRef = useRef<HTMLDivElement | null>(null);
  const qref = useRef<Quill | null>(null);
  const applyingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  async function replaceDataUris(html: string, tag: string): Promise<string> {
    if (!html || !(html.includes('src="data:') || html.includes("src='data:"))) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgs = Array.from(doc.images || []).filter((im) => im.src.startsWith('data:'));
    for (const im of imgs) {
      try {
        const res = await fetch(im.src);
        const blob = await res.blob();
        const f = new File([blob], `${tag}.` + (blob.type.includes('png') ? 'png' : 'jpg'), { type: blob.type });
        const up = await uploadFile(f);
        im.src = up.url;
      } catch { im.remove(); }
    }
    return doc.body.innerHTML;
  }

  function insertImage(q: any, url: string) {
    const range = q.getSelection?.(true);
    const idx = range ? range.index : q.getLength();
    q.insertEmbed(idx, 'image', url, 'user');
    q.setSelection(idx + 1, 0, 'silent');
  }

  async function applyHtml(q: Quill, html: string) {
    try {
      applyingRef.current = true;
      const clean = await replaceDataUris(html || '', 'init');
      q.setContents(q.clipboard.convert(clean) as any, 'silent');
    } finally { applyingRef.current = false; }
  }

  useEffect(() => {
    if (!elRef.current || qref.current) return;
    const toolbar = [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image'],
      [{ color: [] }, { background: [] }],
      ['clean'],
    ];
    const q = new Quill(elRef.current, {
      theme: 'snow',
      readOnly: !!readOnly,
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {
            image: function () {
              const input = document.createElement('input');
              input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
              input.onchange = async () => {
                try {
                  for (const file of Array.from(input.files || [])) {
                    const up = await uploadFile(file);
                    insertImage(q, up.url);
                  }
                } catch { alert('이미지 업로드에 실패했습니다. 파일 크기/형식을 확인하고 다시 시도하세요.'); }
              };
              input.click();
            },
          },
        },
      },
      placeholder: placeholder || '내용을 입력하세요. 그림은 붙여넣기(Ctrl+V)·드래그·툴바 이미지 버튼으로 넣을 수 있습니다.',
    } as any);
    q.on('text-change', () => {
      if (applyingRef.current) return;
      onChangeRef.current(q.root.innerHTML);
    });
    const onPaste = async (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items;
        const html = e.clipboardData?.getData('text/html') || '';
        const imgs = items ? Array.from(items).filter((i) => i.type.startsWith('image/')) : [];
        if (imgs.length) {
          e.preventDefault(); e.stopPropagation();
          for (const it of imgs) {
            const file = it.getAsFile(); if (!file) continue;
            const up = await uploadFile(file);
            insertImage(q, up.url);
          }
          return;
        }
        if (html && (html.includes('src="data:') || html.includes("src='data:"))) {
          e.preventDefault(); e.stopPropagation();
          const sane = await replaceDataUris(html, 'pasted');
          const range = (q as any).getSelection?.(true);
          (q as any).clipboard.dangerouslyPasteHTML(range ? range.index : 0, sane, 'user');
        }
      } catch {}
    };
    const onDrop = async (e: DragEvent) => {
      try {
        const files = e.dataTransfer?.files;
        const imgs = files ? Array.from(files).filter((f) => f.type.startsWith('image/')) : [];
        if (imgs.length) {
          e.preventDefault(); e.stopPropagation();
          for (const f of imgs) { const up = await uploadFile(f); insertImage(q, up.url); }
        }
      } catch {}
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const ctr = ((q as any).container || q.root.parentElement) as HTMLElement | null;
    if (ctr) {
      ctr.addEventListener('paste', onPaste as any, true);
      ctr.addEventListener('drop', onDrop as any, true);
      ctr.addEventListener('dragover', onDragOver as any, true);
    }
    qref.current = q;
    void applyHtml(q, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 외부 리셋(수정 모드 진입/취소 등)
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const q = qref.current; if (!q) return;
    void applyHtml(q, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => { qref.current?.enable(!readOnly); }, [readOnly]);

  return (
    <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div ref={elRef} style={{ minHeight, fontSize: 14 }} />
    </div>
  );
}
