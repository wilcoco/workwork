import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';

/**
 * 메시징 WebSocket 연결 (앱 전체에서 하나만 쓴다).
 * Railway는 배포할 때마다 서버가 재시작돼 연결이 끊긴다 → socket.io의 자동 재연결에 맡기고,
 * 다시 붙으면 화면이 'sync'로 놓친 메시지를 받아간다.
 */
let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('token');
  if (!token) return null;
  if (socket) return socket;
  const base = API_BASE || window.location.origin;
  socket = io(`${base.replace(/\/$/, '')}/ws/messaging`, {
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    timeout: 12000,
  });
  return socket;
}

export function closeSocket() {
  try { socket?.disconnect(); } catch {}
  socket = null;
}

/** 소켓이 살아 있으면 ack까지 기다려 보내고, 아니면 false (호출자가 HTTP로 대체) */
export function emitWithAck<T = any>(event: string, payload: any, timeoutMs = 8000): Promise<T | null> {
  const s = getSocket();
  if (!s || !s.connected) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    s.emit(event, payload, (res: T) => { if (!done) { done = true; clearTimeout(t); resolve(res); } });
  });
}
