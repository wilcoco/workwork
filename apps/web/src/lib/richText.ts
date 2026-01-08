import { apiUrl } from './api';

function absolutizeUploads(html: string): string {
  if (!html) return html;
  return html.replace(/(src|href)=["'](\/(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
}

function sanitizeRichHtml(html: string): string {
  if (!html) return html;
  try {
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
      return String(html);
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), 'text/html');

    const kill = doc.querySelectorAll('script, iframe, object, embed');
    kill.forEach((n) => n.remove());

    const all = doc.querySelectorAll('*');
    all.forEach((el) => {
      Array.from(el.attributes || []).forEach((a) => {
        const name = String(a.name || '').toLowerCase();
        const value = String(a.value || '');
        if (name.startsWith('on')) {
          el.removeAttribute(a.name);
          return;
        }
        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
          el.removeAttribute(a.name);
          return;
        }
      });
      if (el.tagName === 'A') {
        const href = (el as HTMLAnchorElement).getAttribute('href') || '';
        if (href && !/^(https?:|mailto:|tel:|\/|#)/i.test(href) && !/^data:/i.test(href)) {
          (el as HTMLAnchorElement).removeAttribute('href');
        }
        (el as HTMLAnchorElement).setAttribute('rel', 'noreferrer');
        (el as HTMLAnchorElement).setAttribute('target', '_blank');
      }
      if (el.tagName === 'IMG') {
        const src = (el as HTMLImageElement).getAttribute('src') || '';
        if (src && !/^(https?:|\/|data:image\/)/i.test(src)) {
          (el as HTMLImageElement).removeAttribute('src');
        }
      }
    });

    return doc.body.innerHTML || '';
  } catch {
    return String(html);
  }
}

export function toSafeHtml(html: string): string {
  return absolutizeUploads(sanitizeRichHtml(html));
}
