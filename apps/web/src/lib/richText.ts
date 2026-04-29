import { apiUrl } from './api';
import { rewriteOneDriveImagesInHtml } from './onedrive';

function absolutizeUploads(html: string): string {
  if (!html) return html;
  // Rewrite uploads/files (legacy) plus any /api/... reference (e.g. the
  // OneDrive proxy endpoint /api/graph-tasks/onedrive/proxy?t=...) so that
  // relative src/href values resolve to the API host when the web and API
  // are served from different origins.
  return html
    .replace(/(src|href)=["'](\/(api\/)?(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`)
    .replace(/(src|href)=["'](\/api\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
}

/**
 * Wrap bare URLs (http/https) that appear in plain-text nodes with <a> tags,
 * so worklog content rendered from Quill or plain text becomes clickable.
 * Existing anchors and nodes inside <a>, <code>, <pre>, <script>, <style>
 * are skipped to avoid double-wrapping or corrupting code blocks.
 */
function autoLinkUrls(html: string): string {
  if (!html) return html;
  try {
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
      return String(html);
    }
    const URL_RE = /\b(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}])/g;
    const SKIP = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      let skip = false;
      for (let p: Node | null = n.parentNode; p && p !== doc.body; p = p.parentNode) {
        if ((p as Element).tagName && SKIP.has((p as Element).tagName)) {
          skip = true;
          break;
        }
      }
      if (!skip && n.nodeValue && URL_RE.test(n.nodeValue)) {
        targets.push(n as Text);
      }
      URL_RE.lastIndex = 0;
      n = walker.nextNode();
    }
    for (const t of targets) {
      const text = t.nodeValue || '';
      const frag = doc.createDocumentFragment();
      let last = 0;
      text.replace(URL_RE, (match, _g, offset: number) => {
        if (offset > last) frag.appendChild(doc.createTextNode(text.slice(last, offset)));
        const a = doc.createElement('a');
        a.setAttribute('href', match);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noreferrer');
        a.textContent = match;
        frag.appendChild(a);
        last = offset + match.length;
        return match;
      });
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      t.parentNode?.replaceChild(frag, t);
    }
    return doc.body.innerHTML || '';
  } catch {
    return String(html);
  }
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
  return rewriteOneDriveImagesInHtml(autoLinkUrls(absolutizeUploads(sanitizeRichHtml(html))));
}
