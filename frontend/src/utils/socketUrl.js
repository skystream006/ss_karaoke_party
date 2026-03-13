/**
 * Resolve the Socket.IO server URL.
 *
 * Priority:
 *  1. REACT_APP_SOCKET_URL baked in at build time (set in .env for reverse-proxy
 *     deployments, e.g. REACT_APP_SOCKET_URL=https://yourdomain.com).
 *  2. Auto-detection:
 *     - localhost / 127.0.0.1 / bare LAN IP → connect directly to port 6000
 *       (standard Docker Compose / LAN setup, no reverse proxy)
 *     - domain name → use window.location.origin so the reverse proxy can route
 *       /socket.io/ to the backend on a different host/port
 */
const isDirectHost =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  /^(\d{1,3}\.){3}\d{1,3}$/.test(window.location.hostname);

export const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  (isDirectHost
    ? `${window.location.protocol}//${window.location.hostname}:6000`
    : window.location.origin);
