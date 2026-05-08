import * as microsoftTeams from '@microsoft/teams-js';

let _inTeams: boolean | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * Initialize the Teams SDK. Resolves quickly if not inside Teams.
 */
export function initTeams(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = new Promise<void>((resolve) => {
    try {
      microsoftTeams.app
        .initialize()
        .then(() => {
          _inTeams = true;
          resolve();
        })
        .catch(() => {
          _inTeams = false;
          resolve();
        });
      // Timeout: if Teams SDK doesn't respond in 2s, assume not in Teams
      setTimeout(() => {
        if (_inTeams === null) {
          _inTeams = false;
          resolve();
        }
      }, 2000);
    } catch {
      _inTeams = false;
      resolve();
    }
  });
  return _initPromise;
}

/**
 * Returns true if the app is running inside Microsoft Teams.
 */
export function isInTeams(): boolean {
  return _inTeams === true;
}

/**
 * Get an SSO token from Teams. Only works when running inside Teams.
 * Returns null if not in Teams or if token retrieval fails.
 */
export async function getTeamsSsoToken(): Promise<string | null> {
  if (!_inTeams) return null;
  try {
    const result = await microsoftTeams.authentication.getAuthToken();
    console.log('[teams-sso] getAuthToken success');
    return result || null;
  } catch (e: any) {
    const msg = e?.message || e?.errorCode || JSON.stringify(e);
    console.error('[teams-sso] getAuthToken FAILED:', msg, e);
    // Store error for debugging display
    (window as any).__teamsSsoError = msg;
    return null;
  }
}

/**
 * Open a popup-based authentication flow inside Teams.
 * This works even when SSO fails because it opens a real browser popup
 * where normal OAuth redirect works fine.
 * Returns the token/session info or null if user cancelled/failed.
 */
export async function teamsPopupLogin(authUrl: string): Promise<{ token: string; userId: string; userName: string; teamName: string } | null> {
  if (!_inTeams) return null;
  try {
    const result = await microsoftTeams.authentication.authenticate({
      url: authUrl,
      width: 600,
      height: 535,
      isExternal: false,
    });
    // result is whatever was passed to authentication.notifySuccess()
    if (typeof result === 'string') {
      try { return JSON.parse(result); } catch { return null; }
    }
    return result as any || null;
  } catch (e) {
    console.error('Teams popup login failed/cancelled:', e);
    return null;
  }
}
