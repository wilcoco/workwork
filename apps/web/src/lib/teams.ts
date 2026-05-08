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
    return result || null;
  } catch (e) {
    console.error('Teams SSO token failed:', e);
    return null;
  }
}
