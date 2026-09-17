import { randomUUID } from 'node:crypto';

export class JupyterError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

export function check(condition, code, message) {
  if (!condition) throw new JupyterError(code, message);
}

export function identifier(value = randomUUID()) {
  check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value), 'INVALID_ID', 'IDs must contain 1–80 letters, digits, underscores or hyphens.');
  return value;
}

export function remotePath(value = '') {
  check(typeof value === 'string' && !value.includes('\0') && !value.includes('\\') && !value.startsWith('/'), 'INVALID_PATH', 'Use a path relative to the Jupyter contents root.');
  const parts = value.split('/').filter(x => x && x !== '.');
  check(!parts.includes('..') && !parts.some(x => /[\u0000-\u001f]/.test(x)), 'INVALID_PATH', 'Parent traversal and control characters are not allowed.');
  return parts.join('/');
}

export function publicError(error) {
  if (error instanceof JupyterError) return { code: error.code, message: error.message, ...error.details };
  const status = error?.response?.status;
  if (status) return { code: status === 401 || status === 403 ? 'AUTHENTICATION_FAILED' : 'JUPYTER_HTTP_ERROR', message: `Jupyter returned HTTP ${status}.`, status };
  // Upstream exceptions can contain request URLs, tokens or response bodies.
  return { code: 'JUPYTER_CONNECTION_ERROR', message: 'Jupyter request failed. Check instance readiness and reconnect the session before retrying. Mutations are not automatically retried.' };
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function deadline(promise, ms, message = 'Operation timed out.') {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new JupyterError('TIMEOUT', message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export async function waitForConnection(connection, timeout = 20000) {
  if (connection.connectionStatus === 'connected') return;
  let handler;
  try {
    await deadline(new Promise((resolve, reject) => {
      handler = (_, status) => {
        if (status === 'connected') resolve();
        if (status === 'disconnected') reject(new JupyterError('DISCONNECTED', 'The remote connection closed. Reconnect the session.'));
      };
      connection.connectionStatusChanged.connect(handler);
    }), timeout, 'Jupyter WebSocket did not become ready.');
  } finally { if (handler) connection.connectionStatusChanged.disconnect(handler); }
}

// A bounded, cursor-addressable terminal transcript. Offsets count UTF-16 code units.
export class Transcript {
  constructor(limit = 1024 * 1024) { this.limit = limit; this.text = ''; this.start = 0; this.streamId = randomUUID(); }
  append(text) {
    this.text += text;
    if (this.text.length > this.limit) {
      const drop = this.text.length - this.limit;
      this.text = this.text.slice(drop); this.start += drop;
    }
  }
  read(cursor = 0, size = 65536, streamId) {
    check(!streamId || streamId === this.streamId, 'STREAM_CHANGED', 'This terminal has a new output stream. Read again from cursor 0 without stream_id.');
    const end = this.start + this.text.length;
    check(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= end, 'INVALID_CURSOR', 'The terminal cursor is outside the current stream.');
    const position = Math.max(cursor, this.start);
    const output = this.text.slice(position - this.start, position - this.start + size);
    return { output, cursor: position, next_cursor: position + output.length, stream_id: this.streamId, truncated: cursor < this.start, has_more: position + output.length < end };
  }
}
