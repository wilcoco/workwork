// 인증 세션 단일 관리 모듈 — 토큰/사용자 정보의 "쓰기"는 반드시 이 모듈을 거친다.
// 저장 키는 기존과 동일(localStorage: token/userId/userName/teamName/userLogin)해서
// 각 화면의 기존 읽기 코드(localStorage.getItem('userId') 등)와 호환된다.
// 의존성 없음(api.ts가 이 모듈을 import하므로 여기서 api.ts를 import하면 순환).

export type Session = {
  token: string;
  userId?: string | null;
  userName?: string | null;
  teamName?: string | null;
  userLogin?: string | null;
};

const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export const getToken = () => ls()?.getItem('token') ?? null;
export const getUserId = () => ls()?.getItem('userId') ?? '';
export const getUserName = () => ls()?.getItem('userName') ?? '';
export const getTeamName = () => ls()?.getItem('teamName') ?? '';
export const getUserLogin = () => ls()?.getItem('userLogin') ?? '';
export const isAuthenticated = () => !!getToken();

export function setSession(s: Session) {
  const st = ls();
  if (!st) return;
  st.setItem('token', s.token);
  if (s.userId) st.setItem('userId', String(s.userId));
  if (s.userName) st.setItem('userName', String(s.userName));
  if (s.teamName !== undefined) st.setItem('teamName', String(s.teamName || ''));
  if (s.userLogin) st.setItem('userLogin', String(s.userLogin));
}

export function clearSession() {
  const st = ls();
  if (!st) return;
  for (const k of ['token', 'userId', 'userName', 'teamName', 'userLogin']) st.removeItem(k);
}

// ── 토큰 자동 연장 (sliding expiry) ─────────────────────────────
// JWT의 exp를 읽어 남은 수명이 절반(3.5일) 아래로 내려가면, 앱을 쓰는 동안 자동으로 새 토큰을 받는다.
// 만료 "후"에는 연장 불가(서버가 401) — 그때는 기존 재로그인 흐름을 탄다.

function tokenExpMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const REFRESH_WHEN_REMAINING_MS = 3.5 * 24 * 3600 * 1000; // 수명 절반
const CHECK_THROTTLE_MS = 10 * 60 * 1000; // 확인은 10분에 한 번이면 충분
let lastCheckAt = 0;
let refreshing = false;

// api.ts가 매 요청마다 호출 — 스로틀되어 실제 네트워크는 필요할 때만 나간다. fire-and-forget.
export function maybeRefreshToken(refreshUrl: string) {
  const now = Date.now();
  if (refreshing || now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;
  const token = getToken();
  if (!token) return;
  const exp = tokenExpMs(token);
  if (exp == null || exp - now > REFRESH_WHEN_REMAINING_MS) return;
  if (exp <= now) return; // 이미 만료 — 연장 불가, 일반 401 흐름에 맡김
  refreshing = true;
  fetch(refreshUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    .then(async (res) => {
      if (!res.ok) return;
      const json: any = await res.json().catch(() => null);
      const newToken = String(json?.token || '');
      // 그 사이 로그아웃/재로그인으로 토큰이 바뀌었으면 덮어쓰지 않는다
      if (newToken && getToken() === token) ls()?.setItem('token', newToken);
    })
    .catch(() => { /* 네트워크 오류 — 다음 기회에 재시도 */ })
    .finally(() => { refreshing = false; });
}
