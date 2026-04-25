/**
 * Shared API/socket base resolution for dev and production.
 * Backend listens on 3001 by default; CRA proxy should target the same port.
 */
export function getApiBaseUrl(): string {
  return process.env.REACT_APP_API_URL || '/api';
}

/** Origin for Socket.IO (no /api path). */
export function getSocketOrigin(): string {
  const raw = process.env.REACT_APP_API_URL;
  if (!raw || raw === '/api') {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'http://localhost:3001';
  }
  if (raw.startsWith('http')) {
    return raw.replace(/\/api\/?$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}
