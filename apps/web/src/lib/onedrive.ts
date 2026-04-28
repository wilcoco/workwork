// Utilities for turning OneDrive / SharePoint share URLs into URLs that the
// browser can actually render as raw image/file content.
//
// OneDrive "share" links (https://1drv.ms/... or
// https://<tenant>-my.sharepoint.com/:i:/g/personal/...) point at HTML landing
// pages, so using them directly in an <img src=""> produces a broken image.
// Microsoft exposes an anonymous Shares API that redirects to the raw content:
//
//   GET https://api.onedrive.com/v1.0/shares/u!<base64url>/root/content
//
// where <base64url> is the url-safe base64 encoding of the original share URL
// (trailing '=' padding stripped, '+' -> '-', '/' -> '_').
//
// This works for both 1drv.ms short links and SharePoint personal share links
// as long as the share is set to "anyone with the link".

function toBase64Url(input: string): string {
  try {
    // btoa only handles latin1; encodeURIComponent -> unescape keeps unicode safe.
    const b64 = btoa(unescape(encodeURIComponent(input)));
    return b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  } catch {
    return '';
  }
}

function isOneDriveShareUrl(url: string): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('1drv.ms/')) return true;
  if (u.includes('onedrive.live.com/')) return true;
  // SharePoint personal share links use the /:i:/, /:b:/, /:w:/, /:x:/, /:p:/ patterns.
  if (/sharepoint\.com\/:[a-z]:\//i.test(url)) return true;
  return false;
}

/**
 * Convert a OneDrive / SharePoint share URL into a URL that resolves to raw
 * binary content (image bytes, file bytes). Non-share URLs are returned as-is.
 */
export function toOneDriveDirectUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (!isOneDriveShareUrl(url)) return url;
  // Already a direct content URL – leave alone.
  if (url.includes('api.onedrive.com/v1.0/shares/')) return url;
  const encoded = toBase64Url(url);
  if (!encoded) return url;
  return `https://api.onedrive.com/v1.0/shares/u!${encoded}/root/content`;
}

/**
 * Rewrite <img src> inside an HTML string so OneDrive/SharePoint share links
 * resolve to raw content. Other attributes and content are left untouched.
 */
export function rewriteOneDriveImagesInHtml(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b([^>]*?)\ssrc=("([^"]*)"|'([^']*)')/gi, (match, pre, _q, dq, sq) => {
    const src = dq ?? sq ?? '';
    if (!isOneDriveShareUrl(src)) return match;
    const direct = toOneDriveDirectUrl(src);
    if (!direct || direct === src) return match;
    return `<img${pre} src="${direct}"`;
  });
}
