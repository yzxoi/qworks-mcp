import services from '@jupyterlab/services';
import terminalModule from '@jupyterlab/services/lib/terminal/default.js';
import WebSocket from 'ws';
import { check, JupyterError } from './common.mjs';

const { ServerConnection, ContentsManager, KernelAPI, KernelSpecAPI, KernelConnection } = services;
const { TerminalConnection } = terminalModule;

export function parseEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new JupyterError('INVALID_URL', 'Provide an absolute Jupyter access URL.'); }
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'INVALID_URL', 'Jupyter requires an HTTP(S) URL without embedded user credentials.');
  const parts = url.pathname.split('/').filter(Boolean);
  const index = parts.findIndex(x => ['lab', 'tree', 'notebooks', 'edit', 'terminals', 'doc'].includes(x));
  const base = index < 0 ? parts : parts.slice(0, index);
  return { baseUrl: `${url.origin}/${base.length ? base.join('/') + '/' : ''}`, token: url.searchParams.get('token') || '' };
}

export class JupyterConnection {
  constructor(endpoint, { requestTimeout = 30000, maxResponseBytes = 48 * 1024 * 1024, fetchImpl = fetch } = {}) {
    this.endpoint = endpoint;
    const sockets = this.sockets = new Set();
    this.settings = ServerConnection.makeSettings({
      baseUrl: endpoint.baseUrl, wsUrl: endpoint.baseUrl.replace(/^http/, 'ws'), token: '', appendToken: false,
      init: { cache: 'no-store', credentials: 'omit' },
      fetch: async request => {
        const url = new URL(request.url), base = new URL(endpoint.baseUrl);
        check(url.origin === base.origin && url.pathname.startsWith(base.pathname), 'INVALID_ENDPOINT', 'Request escaped the Jupyter base URL.');
        const headers = new Headers(request.headers);
        if (endpoint.token) headers.set('Authorization', `token ${endpoint.token}`);
        headers.set('Content-Type', 'application/json');
        const attempts = request.method === 'GET' ? 2 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            const response = await fetchImpl(new Request(request.clone(), { headers, redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(requestTimeout)]) }));
            // Reject unbounded JSON responses before handing them to the client library.
            if (Number(response.headers.get('content-length')) > maxResponseBytes) { await response.body?.cancel(); throw new JupyterError('RESPONSE_TOO_LARGE', 'Jupyter response exceeds the configured transfer limit.'); }
            const chunks = []; let bytes = 0;
            if (response.body) for await (const chunk of response.body) {
              bytes += chunk.byteLength;
              check(bytes <= maxResponseBytes, 'RESPONSE_TOO_LARGE', 'Jupyter response exceeds the configured transfer limit.');
              chunks.push(chunk);
            }
            return new Response(response.status === 204 ? null : Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
          } catch (error) {
            // Reads can survive a transient gateway reset. Never replay mutations.
            if (attempt + 1 === attempts || error instanceof JupyterError || request.signal.aborted) throw error;
          }
        }
      },
      WebSocket: class extends WebSocket {
        constructor(url, protocols) {
          super(url, protocols, { headers: endpoint.token ? { Authorization: `token ${endpoint.token}` } : {}, handshakeTimeout: requestTimeout, maxPayload: maxResponseBytes, followRedirects: false });
          sockets.add(this); this.once('close', () => sockets.delete(this));
        }
      },
    });
    this.contents = new ContentsManager({ serverSettings: this.settings });
  }
  async json(path, method = 'GET', data, acceptable = [200]) {
    const response = await ServerConnection.makeRequest(this.endpoint.baseUrl + path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, this.settings);
    if (!acceptable.includes(response.status)) throw new JupyterError(response.status === 401 || response.status === 403 ? 'AUTHENTICATION_FAILED' : 'JUPYTER_HTTP_ERROR', `Jupyter returned HTTP ${response.status}.`, { status: response.status });
    return response.status === 204 || method === 'DELETE' && response.status === 404 ? null : response.json();
  }
  async probe() {
    await this.json('api/status');
    const specs = await KernelSpecAPI.getSpecs(this.settings);
    let terminals = true;
    try { await this.json('api/terminals'); } catch (error) { if ([403, 404, 405, 501].includes(error.details?.status)) terminals = false; else throw error; }
    return { kernels: Object.keys(specs.kernelspecs), default_kernel: specs.default, terminals, contents: true };
  }
  startKernel(name) { return KernelAPI.startNew({ name }, this.settings); }
  getKernel(id) { return KernelAPI.getKernelModel(id, this.settings); }
  connectKernel(model) { return new KernelConnection({ model, serverSettings: this.settings, handleComms: false }); }
  interruptKernel(id) { return KernelAPI.interruptKernel(id, this.settings); }
  restartKernel(id) { return KernelAPI.restartKernel(id, this.settings); }
  shutdownKernel(id) { return KernelAPI.shutdownKernel(id, this.settings); }
  createTerminal(name, cwd) { return this.json('api/terminals', 'POST', { name, ...(cwd === undefined ? {} : { cwd }) }, [200, 201]); }
  listTerminals() { return this.json('api/terminals'); }
  deleteTerminal(name) { return this.json(`api/terminals/${encodeURIComponent(name)}`, 'DELETE', undefined, [204, 404]); }
  connectTerminal(model) {
    const connection = new TerminalConnection({ model, serverSettings: this.settings, terminalAPIClient: { shutdown: name => this.deleteTerminal(name) } });
    // The standard client deliberately does not retry normal WebSocket closes.
    // Mark those handles disposed so a later read cannot report them connected.
    const suffix = `/terminals/websocket/${encodeURIComponent(model.name)}`;
    for (const socket of this.sockets) if (new URL(socket.url).pathname.endsWith(suffix)) socket.once('close', code => {
      if (code === 1000 || code === 1001) connection.dispose();
    });
    return connection;
  }
  dispose() { this.contents.dispose(); for (const socket of this.sockets) socket.terminate(); this.sockets.clear(); }
}
