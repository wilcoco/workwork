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

function isPersonalOneDrive(url: string): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('1drv.ms/') || u.includes('onedrive.live.com/');
}

function isSharePointShare(url: string): boolean {
  // SharePoint share links use the /:i:/, /:b:/, /:w:/, /:x:/, /:p:/, /:f:/ patterns.
  return /sharepoint\.com\/:[a-z]:\//i.test(url);
}

function isOneDriveShareUrl(url: string): boolean {
  if (!url) return false;
  return isPersonalOneDrive(url) || isSharePointShare(url);
}

/**
 * Convert a OneDrive / SharePoint share URL into a URL that resolves to raw
 * binary content (image bytes, file bytes). Non-share URLs are returned as-is.
 *
 * - SharePoint Business (`*-my.sharepoint.com/:i:/g/...`):
 *     Append `?download=1`. Returns raw bytes if the viewer has a SharePoint
 *     session cookie (typical for M365 users) or if the share is anonymous.
 *     The legacy `api.onedrive.com/v1.0/shares/` endpoint is OneDrive Personal
 *     only and does NOT work for SharePoint Business links.
 * - OneDrive Personal (`1drv.ms`, `onedrive.live.com`):
 *     Use the anonymous Shares API `api.onedrive.com/v1.0/shares/u!<b64>/root/content`
 *     which redirects to the raw content for "anyone with the link" shares.
 */
export function toOneDriveDirectUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (!isOneDriveShareUrl(url)) return url;
  if (url.includes('api.onedrive.com/v1.0/shares/')) return url;

  if (isSharePointShare(url)) {
    if (/[?&]download=1\b/i.test(url)) return url;
    return url + (url.includes('?') ? '&' : '?') + 'download=1';
  }

  // OneDrive Personal
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
