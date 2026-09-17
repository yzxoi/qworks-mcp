import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JupyterConnection, parseEndpoint } from './connection.mjs';
import { SessionStore, LocalFiles } from './state.mjs';
import { check, identifier, remotePath, JupyterError, publicError, deadline, delay, waitForConnection, Transcript } from './common.mjs';

const jobProgram = readFileSync(new URL('./jobs.py', import.meta.url), 'utf8');
const fingerprint = endpoint => createHash('sha256').update(endpoint.baseUrl).digest('hex');
const now = () => new Date().toISOString();
const terminalName = value => { check(typeof value === 'string' && /^\w{1,100}$/.test(value), 'INVALID_TERMINAL', 'Invalid terminal ID.'); return value; };

export class JupyterManager {
  constructor({ resolveAccess, stateDir = join(homedir(), '.qworks-mcp', 'sessions'), allowedRoots = [process.cwd()], connectionFactory = endpoint => new JupyterConnection(endpoint), maxExecutions = 100, maxOutputBytes = 2 * 1024 * 1024 } = {}) {
    this.resolveAccess = resolveAccess;
    this.store = new SessionStore(stateDir);
    this.local = new LocalFiles(allowedRoots);
    this.connectionFactory = connectionFactory;
    this.maxExecutions = maxExecutions;
    this.maxOutputBytes = maxOutputBytes;
    this.sessions = new Map(); this.locks = new Map(); this.disposed = false;
  }

  async exclusive(key, fn) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
  session(id) {
    const session = this.sessions.get(identifier(id));
    check(session && !session.closing, 'SESSION_NOT_OPEN', 'Open or resume this session first.');
    return session;
  }
  summary(session) {
    return { session_id: session.record.session_id, notebook_id: session.record.notebook_id, capabilities: session.capabilities,
      kernel: session.record.kernels.user ? { ...session.record.kernels.user, connection_status: session.kernels.user?.connectionStatus ?? 'detached', status: session.kernels.user?.status ?? 'unknown' } : null,
      terminals: [...session.record.terminals], jobs: [...session.record.jobs], active_executions: [...session.executions.values()].filter(x => !x.finished).map(x => x.id),
      created_at: session.record.created_at, notices: session.notices };
  }
  async save(session) { session.record.updated_at = now(); await this.store.save(session.record); }

  async open({ session_id = randomUUID(), notebook_id, jupyter_url, kernel_name } = {}) {
    identifier(session_id);
    check(!(notebook_id && jupyter_url), 'INVALID_ARGUMENT', 'Provide notebook_id or jupyter_url, not both.');
    return this.exclusive(session_id, async () => {
      check(!this.disposed, 'CLOSED', 'This manager is closed.');
      const existing = this.sessions.get(session_id);
      if (existing) {
        check(!notebook_id || notebook_id === existing.record.notebook_id, 'SESSION_CONFLICT', 'This session belongs to another instance.');
        check(!jupyter_url || fingerprint(parseEndpoint(jupyter_url)) === existing.record.endpoint_hash, 'SESSION_CONFLICT', 'This session belongs to another endpoint.');
        return this.summary(existing);
      }
      check(this.sessions.size < 16, 'SESSION_LIMIT', 'Detach a session before opening more than 16 at once.');
      await this.store.acquire(session_id);
      let connection;
      try {
        const saved = await this.store.load(session_id);
        check(!saved || !notebook_id || saved.notebook_id === notebook_id, 'SESSION_CONFLICT', 'This session belongs to another instance.');
        check(!saved?.notebook_id || !jupyter_url, 'SESSION_CONFLICT', 'Resume this platform session using its notebook binding.');
        notebook_id ??= saved?.notebook_id;
        if (notebook_id) {
          check(this.resolveAccess, 'NO_PLATFORM_PROVIDER', 'No platform access resolver is configured.');
          const access = await this.resolveAccess(notebook_id);
          jupyter_url = typeof access === 'string' ? access : access?.jupyterUrl;
        }
        check(jupyter_url, 'ACCESS_UNAVAILABLE', 'No Jupyter URL is available. Wait for the instance or supply its URL. Direct-URL sessions require the URL again after a restart.');
        const endpoint = parseEndpoint(jupyter_url);
        check(!saved || saved.notebook_id || saved.endpoint_hash === fingerprint(endpoint), 'SESSION_CONFLICT', 'A direct-URL session cannot move to a different endpoint.');
        connection = this.connectionFactory(endpoint);
        const capabilities = await connection.probe();
        check(!kernel_name || capabilities.kernels.includes(kernel_name), 'KERNEL_UNAVAILABLE', 'The requested kernel is not installed.');
        const record = saved ?? { version: 1, session_id, notebook_id: notebook_id ?? null, created_at: now(), kernels: {}, terminals: [], jobs: [] };
        const notices = [];
        if (record.closed) { notices.push('Previous kernels and terminals were shut down. Resuming creates fresh ones on demand; saved shell jobs remain addressable.'); record.closed = false; }
        if (saved && saved.endpoint_hash !== fingerprint(endpoint)) {
          record.kernels = {}; record.terminals = [];
          notices.push('The instance endpoint changed. Old kernel and terminal handles were discarded; remote jobs must be checked explicitly.');
        }
        record.endpoint_hash = fingerprint(endpoint);
        record.kernel_name = kernel_name ?? record.kernel_name ?? (capabilities.kernels.includes('python3') ? 'python3' : capabilities.default_kernel);
        const session = { record, connection, capabilities, kernels: {}, terminals: new Map(), executions: new Map(), notices, closing: false };
        await this.save(session);
        this.sessions.set(session_id, session);
        return this.summary(session);
      } catch (error) { connection?.dispose(); await this.store.release(session_id); throw error; }
    });
  }

  async list() {
    return { sessions: (await this.store.list()).map(record => ({ session_id: record.session_id, notebook_id: record.notebook_id, connected: this.sessions.has(record.session_id), closed: !!record.closed, created_at: record.created_at, updated_at: record.updated_at, resumable_with_notebook_id: !!record.notebook_id, kernels: record.kernels, terminals: record.terminals, jobs: record.jobs })) };
  }
  status({ session_id }) { return this.summary(this.session(session_id)); }

  async reconnect({ session_id, jupyter_url }) {
    return this.exclusive(session_id, () => this.exclusive(`control:${session_id}`, async () => {
      const session = this.session(session_id);
      let endpoint;
      if (session.record.notebook_id) {
        const access = await this.resolveAccess(session.record.notebook_id);
        endpoint = parseEndpoint(typeof access === 'string' ? access : access.jupyterUrl);
      } else endpoint = jupyter_url ? parseEndpoint(jupyter_url) : session.connection.endpoint;
      check(fingerprint(endpoint) === session.record.endpoint_hash, 'ENDPOINT_CHANGED', 'The instance endpoint changed. Detach and reopen the session to discard obsolete remote handles.');
      const connection = this.connectionFactory(endpoint);
      try { session.capabilities = await connection.probe(); } catch (error) { connection.dispose(); throw error; }
      this.disposeConnections(session);
      session.connection = connection;
      session.notices.push('Connections refreshed. In-flight Python execution delivery may be uncertain; do not automatically re-execute code. Terminal transcript cursors reset.');
      return this.summary(session);
    }));
  }

  disposeConnections(session) {
    for (const execution of session.executions.values()) if (!execution.finished) {
      execution.state = 'unknown'; execution.finished = true; execution.future?.dispose();
    }
    for (const kernel of Object.values(session.kernels)) kernel.dispose();
    for (const terminal of session.terminals.values()) terminal.connection.dispose();
    session.connection.dispose(); session.kernels = {}; session.terminals.clear();
  }
  async close({ session_id, mode = 'detach' }) {
    check(['detach', 'shutdown'].includes(mode), 'INVALID_ARGUMENT', 'Close mode must be detach or shutdown.');
    return this.exclusive(session_id, () => this.exclusive(`control:${session_id}`, async () => {
      const session = this.session(session_id);
      session.closing = true;
      const errors = [];
      if (mode === 'shutdown') {
        for (const [role, kernel] of Object.entries(session.record.kernels)) {
          try { await session.connection.shutdownKernel(kernel.id); delete session.record.kernels[role]; }
          catch (error) { errors.push({ resource: `kernel:${role}`, ...publicError(error) }); }
        }
        for (const name of [...session.record.terminals]) {
          try { await session.connection.deleteTerminal(name); session.record.terminals = session.record.terminals.filter(x => x !== name); }
          catch (error) { errors.push({ resource: 'terminal', terminal_id: name, ...publicError(error) }); }
        }
        session.record.closed = errors.length === 0;
      }
      this.disposeConnections(session);
      try { await this.save(session); } finally { this.sessions.delete(session_id); await this.store.release(session_id); }
      return { session_id, mode, errors, background_jobs: session.record.jobs, note: 'Background shell jobs are independent. Cancel them explicitly before shutting down if they should stop.' };
    }));
  }
  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.sessions.keys()].map(session_id => this.close({ session_id })));
  }

  async kernel(session, role = 'user') {
    const current = session.kernels[role];
    let model;
    if (session.record.kernels[role]) {
      model = await session.connection.getKernel(session.record.kernels[role].id);
      if (!model || model.execution_state === 'dead') {
        current?.dispose(); delete session.kernels[role];
        delete session.record.kernels[role]; await this.save(session);
        if (role === 'user') throw new JupyterError('KERNEL_LOST', 'The previous kernel no longer exists. Its variables are lost. Call execute again only when starting a fresh kernel is intended.');
        model = undefined;
      }
    }
    if (model && current && !current.isDisposed) {
      check(model.execution_state !== 'busy', 'KERNEL_BUSY', 'The remote kernel is still busy. Inspect or interrupt it before submitting more work.');
      await waitForConnection(current); return current;
    }
    if (!model) {
      const name = role === 'control' ? session.capabilities.kernels.find(x => x === 'python3') ?? session.capabilities.kernels.find(x => /python/i.test(x)) : session.record.kernel_name;
      check(name, 'KERNEL_UNAVAILABLE', role === 'control' ? 'Shell jobs require an installed Python kernel and a Linux instance.' : 'No kernel is available.');
      model = await session.connection.startKernel(name);
      session.record.kernels[role] = { id: model.id, name: model.name };
      await this.save(session);
    }
    const connection = session.connection.connectKernel(model);
    session.kernels[role] = connection;
    await waitForConnection(connection);
    if (role === 'user') connection.connectionStatusChanged.connect((_, status) => {
      if (status === 'connected') return;
      for (const execution of session.executions.values()) if (!execution.finished) {
        execution.state = 'unknown'; execution.finished = true; execution.future?.dispose();
      }
    });
    return connection;
  }

  async execute({ session_id, code, wait_ms = 1000 }) {
    const execution = await this.exclusive(session_id, async () => {
      const session = this.session(session_id);
      check(![...session.executions.values()].some(x => !x.finished), 'KERNEL_BUSY', 'An execution is already pending. Read its result or interrupt it before submitting another.');
      const kernel = await this.kernel(session);
      check(kernel.status !== 'busy', 'KERNEL_BUSY', 'The kernel is busy. Do not submit duplicate work.');
      while (session.executions.size >= this.maxExecutions) session.executions.delete(session.executions.keys().next().value);
      const value = { id: randomUUID(), state: 'running', finished: false, outputs: [], bytes: 0, truncated: false, created_at: now() };
      const future = value.future = kernel.requestExecute({ code, stop_on_error: true, allow_stdin: false, store_history: true }, true);
      session.executions.set(value.id, value);
      future.onIOPub = message => {
        const type = message.header.msg_type;
        if (!['stream', 'execute_result', 'display_data', 'update_display_data', 'clear_output', 'error'].includes(type)) return;
        const output = { type, ...message.content };
        const bytes = Buffer.byteLength(JSON.stringify(output));
        if (value.bytes + bytes > this.maxOutputBytes) { value.truncated = true; return; }
        value.bytes += bytes; value.outputs.push(output);
      };
      value.done = future.done.then(reply => {
        if (value.state !== 'unknown') value.state = reply.content.status === 'ok' ? 'completed' : reply.content.status === 'abort' || reply.content.status === 'aborted' ? 'aborted' : 'error';
        value.execution_count = reply.content.execution_count; value.finished = true; value.finished_at = now();
      }).catch(() => { value.state = 'unknown'; value.finished = true; value.finished_at = now(); });
      return value;
    });
    await this.waitExecution(execution, wait_ms);
    return this.readExecution({ session_id, execution_id: execution.id });
  }
  async waitExecution(execution, wait_ms) {
    if (!execution.finished && wait_ms > 0) { try { await deadline(execution.done, wait_ms); } catch (e) { if (e.code !== 'TIMEOUT') throw e; } }
  }
  async readExecution({ session_id, execution_id, cursor = 0, wait_ms = 0 }) {
    const session = this.session(session_id), execution = session.executions.get(execution_id);
    check(execution, 'EXECUTION_NOT_FOUND', 'Execution output is not retained in this process. It may have been evicted or the client restarted. Do not automatically rerun the code.');
    await this.waitExecution(execution, wait_ms);
    check(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= execution.outputs.length, 'INVALID_CURSOR', 'Invalid execution output cursor.');
    let size = 0, end = cursor;
    while (end < execution.outputs.length && (size === 0 || size + Buffer.byteLength(JSON.stringify(execution.outputs[end])) <= this.maxOutputBytes)) {
      size += Buffer.byteLength(JSON.stringify(execution.outputs[end++]));
    }
    return { session_id, execution_id, state: execution.state, finished: execution.finished, execution_count: execution.execution_count,
      outputs: execution.outputs.slice(cursor, end), next_cursor: end, has_more: end < execution.outputs.length, truncated: execution.truncated,
      created_at: execution.created_at, finished_at: execution.finished_at };
  }
  async interrupt({ session_id }) {
    const session = this.session(session_id), kernel = session.record.kernels.user;
    check(kernel, 'NO_KERNEL', 'This session has no user kernel.');
    await session.connection.interruptKernel(kernel.id);
    return { session_id, interrupt_requested: true };
  }
  async restart({ session_id }) {
    return this.exclusive(session_id, async () => {
      const session = this.session(session_id), kernel = session.record.kernels.user;
      check(kernel, 'NO_KERNEL', 'This session has no user kernel.');
      await session.connection.restartKernel(kernel.id);
      session.kernels.user?.dispose(); delete session.kernels.user;
      for (const execution of session.executions.values()) if (!execution.finished) { execution.state = 'unknown'; execution.finished = true; execution.future.dispose(); }
      await this.kernel(session);
      return { session_id, restarted: true, variables_cleared: true };
    });
  }

  async filesList({ session_id, path = '' }) {
    const contents = this.session(session_id).connection.contents;
    const model = await contents.get(remotePath(path), { type: 'directory', content: true });
    return { path: model.path, entries: model.content.map(({ name, path, type, size, last_modified, writable }) => ({ name, path, type, size, last_modified, writable })) };
  }
  async fileData(session_id, path) {
    const contents = this.session(session_id).connection.contents;
    const metadata = await contents.get(remotePath(path), { content: false });
    check(metadata.type !== 'directory', 'IS_DIRECTORY', 'Select a file, not a directory.');
    check(metadata.size == null || metadata.size <= this.local.maxBytes, 'FILE_TOO_LARGE', 'File exceeds the transfer size limit.');
    const model = await contents.get(remotePath(path), { type: 'file', format: 'base64', content: true });
    const data = Buffer.from(model.content, 'base64');
    check(data.length <= this.local.maxBytes, 'FILE_TOO_LARGE', 'File exceeds the transfer size limit.');
    return data;
  }
  async filesRead({ session_id, path, encoding = 'utf8', offset = 0, max_bytes = 65536 }) {
    const data = await this.fileData(session_id, path);
    check(offset <= data.length, 'INVALID_CURSOR', 'Read offset exceeds file size.');
    const chunk = data.subarray(offset, offset + max_bytes);
    return { path, content: chunk.toString(encoding), encoding, bytes: chunk.length, total_bytes: data.length, next_offset: offset + chunk.length, has_more: offset + chunk.length < data.length };
  }
  async ensureWritable(session, path, overwrite) {
    check(path, 'INVALID_PATH', 'The contents root cannot be overwritten.');
    if (overwrite) return;
    try { await session.connection.contents.get(path, { content: false }); }
    catch (e) { if (e.response?.status === 404 || e.details?.status === 404) return; throw e; }
    throw new JupyterError('FILE_EXISTS', 'The remote path exists. Set overwrite=true to replace it.');
  }
  async saveFile(session_id, path, data, overwrite) {
    const session = this.session(session_id); path = remotePath(path);
    await this.ensureWritable(session, path, overwrite);
    check(data.length <= this.local.maxBytes, 'FILE_TOO_LARGE', 'File exceeds the transfer size limit.');
    const model = await session.connection.contents.save(path, { type: 'file', format: 'base64', content: data.toString('base64') });
    return { path: model.path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  filesWrite({ session_id, path, content, encoding = 'utf8', overwrite = false }) { return this.saveFile(session_id, path, Buffer.from(content, encoding), overwrite); }
  async upload({ session_id, local_path, remote_path, overwrite = false }) { return this.saveFile(session_id, remote_path, await this.local.read(local_path), overwrite); }
  async download({ session_id, remote_path, local_path, overwrite = false }) {
    const data = await this.fileData(session_id, remote_path);
    return { ...await this.local.write(local_path, data, overwrite), sha256: createHash('sha256').update(data).digest('hex') };
  }
  async mkdir({ session_id, path }) {
    const session = this.session(session_id); path = remotePath(path);
    await this.ensureWritable(session, path, false);
    const model = await session.connection.contents.save(path, { type: 'directory' });
    return { path: model.path };
  }
  async move({ session_id, path, destination }) {
    const session = this.session(session_id); path = remotePath(path); destination = remotePath(destination);
    check(path, 'INVALID_PATH', 'Cannot move the contents root.');
    await this.ensureWritable(session, destination, false);
    const model = await session.connection.contents.rename(path, destination);
    return { path: model.path };
  }
  async deleteFile({ session_id, path }) {
    path = remotePath(path); check(path, 'INVALID_PATH', 'Cannot delete the contents root.');
    await this.session(session_id).connection.contents.delete(path);
    return { path, deleted: true };
  }

  async terminal(session, name) {
    return this.exclusive(`terminal:${session.record.session_id}:${name}`, async () => {
    terminalName(name);
    check(session.record.terminals.includes(name), 'TERMINAL_NOT_OWNED', 'This terminal is not owned by the session.');
    let terminal = session.terminals.get(name);
    if (!terminal || terminal.connection.isDisposed) {
      const models = await session.connection.listTerminals();
      check(models.some(x => x.name === name), 'TERMINAL_LOST', 'The remote terminal no longer exists.');
      check(!session.closing, 'SESSION_CLOSING', 'The session is closing.');
      const connection = session.connection.connectTerminal({ name });
      terminal = { connection, transcript: new Transcript() };
      connection.messageReceived.connect((_, message) => { if (message.type === 'stdout') terminal.transcript.append(message.content.join('')); });
      let connected = false;
      connection.connectionStatusChanged.connect((_, status) => {
        if (status === 'connected') connected = true;
        else if (connected) { terminal.transcript = new Transcript(); connected = false; }
      });
      session.terminals.set(name, terminal);
    }
    await waitForConnection(terminal.connection);
    return terminal;
    });
  }
  async terminalOpen({ session_id, cwd, rows = 24, cols = 100 }) {
    return this.exclusive(session_id, async () => {
      const session = this.session(session_id);
      check(session.capabilities.terminals, 'TERMINALS_UNAVAILABLE', 'This Jupyter server does not expose terminals.');
      check(session.record.terminals.length < 8, 'TERMINAL_LIMIT', 'Close a terminal before opening more than eight per session.');
      // Jupyter accepts arbitrary names on POST, but its GET/WS/DELETE routes
      // match only word characters. A hyphenated name becomes unreachable.
      const model = await session.connection.createTerminal(`qwm_${randomUUID().replaceAll('-', '')}`, cwd);
      const name = terminalName(model.name);
      session.record.terminals.push(name); await this.save(session);
      const terminal = await this.terminal(session, name);
      terminal.connection.send({ type: 'set_size', content: [rows, cols, 0, 0] });
      return { session_id, terminal_id: name, ...terminal.transcript.read() };
    });
  }
  async terminalRead({ session_id, terminal_id, cursor = 0, max_chars = 65536, wait_ms = 0, stream_id }) {
    const terminal = await this.terminal(this.session(session_id), terminal_id);
    let result = terminal.transcript.read(cursor, max_chars, stream_id);
    const until = Date.now() + wait_ms;
    while (!result.output && Date.now() < until && !terminal.connection.isDisposed) {
      await delay(Math.min(100, until - Date.now())); result = terminal.transcript.read(cursor, max_chars, stream_id);
    }
    return { session_id, terminal_id, connection_status: terminal.connection.connectionStatus, ...result };
  }
  async terminalWrite({ session_id, terminal_id, input }) {
    const terminal = await this.terminal(this.session(session_id), terminal_id);
    terminal.connection.send({ type: 'stdin', content: [input] });
    return { session_id, terminal_id, sent: true, note: 'Input sent once; execution is not acknowledged. Read the terminal before retrying.' };
  }
  async terminalResize({ session_id, terminal_id, rows, cols }) {
    const terminal = await this.terminal(this.session(session_id), terminal_id);
    terminal.connection.send({ type: 'set_size', content: [rows, cols, 0, 0] });
    return { session_id, terminal_id, rows, cols };
  }
  async terminalClose({ session_id, terminal_id }) {
    return this.exclusive(session_id, async () => {
      const session = this.session(session_id);
      check(session.record.terminals.includes(terminal_id), 'TERMINAL_NOT_OWNED', 'This terminal is not owned by the session.');
      await session.connection.deleteTerminal(terminalName(terminal_id));
      session.terminals.get(terminal_id)?.connection.dispose(); session.terminals.delete(terminal_id);
      session.record.terminals = session.record.terminals.filter(x => x !== terminal_id); await this.save(session);
      return { session_id, terminal_id, closed: true };
    });
  }

  async jobRequest(session, request) {
    return this.exclusive(`control:${session.record.session_id}`, async () => {
      check(!session.closing, 'SESSION_CLOSING', 'The session is closing.');
      const kernel = await this.kernel(session, 'control');
      check(kernel.status !== 'busy', 'CONTROL_BUSY', 'The previous job control request is still running. Check status before retrying.');
      const marker = `qwm_${randomUUID()}_`;
      const payload = Buffer.from(JSON.stringify({ ...request, session_id: session.record.session_id })).toString('base64');
      const program = Buffer.from(jobProgram).toString('base64');
      const code = `import base64, json\n_request = json.loads(base64.b64decode('${payload}'))\n_marker = '${marker}'\nexec(compile(base64.b64decode('${program}'), '<qworks-job-control>', 'exec'))`;
      const future = kernel.requestExecute({ code, allow_stdin: false, store_history: false, stop_on_error: true }, true);
      let output = '';
      future.onIOPub = message => { if (message.header.msg_type === 'stream') { output += message.content.text; if (output.length > 2 * 1024 * 1024) { output = ''; future.dispose(); } } };
      try {
        const reply = await deadline(future.done, 20000, 'Job control timed out. Inspect the returned job ID before attempting another launch.');
        check(reply.content.status === 'ok', 'JOB_CONTROL_FAILED', 'The Python control kernel could not run the job operation.');
        const line = output.split('\n').find(x => x.startsWith(marker));
        check(line, 'JOB_CONTROL_FAILED', 'No job receipt was returned. Inspect the job before retrying.');
        const answer = JSON.parse(Buffer.from(line.slice(marker.length), 'base64').toString());
        if (answer.error) throw new JupyterError('JOB_CONTROL_FAILED', `Remote job operation failed (${answer.error}).`, { reason: answer.message });
        return answer;
      } finally { future.dispose(); }
    });
  }
  async execStart({ session_id, command, cwd, env = {}, job_id = randomUUID(), wait_ms = 1000 }) {
    identifier(job_id);
    const session = this.session(session_id);
    check(session.record.jobs.includes(job_id) || session.record.jobs.length < 256, 'JOB_LIMIT', 'Forget finished jobs before retaining more than 256 in one session.');
    if (!session.record.jobs.includes(job_id)) { session.record.jobs.push(job_id); await this.save(session); }
    let result;
    try { result = await this.jobRequest(session, { op: 'start', job_id, command, cwd, env }); }
    catch (error) {
      return { session_id, job_id, state: 'unknown', finished: false, error: publicError(error), note: 'Launch may have happened. Use exec_read with this job ID; do not blindly submit another command.' };
    }
    if (!result.finished && wait_ms) return this.execRead({ session_id, job_id, wait_ms });
    return { session_id, job_id, ...result };
  }
  async execRead({ session_id, job_id, cursor = 0, max_bytes = 65536, wait_ms = 0 }) {
    const session = this.session(session_id); identifier(job_id);
    check(session.record.jobs.includes(job_id), 'JOB_NOT_OWNED', 'This job is not recorded in the session.');
    const until = Date.now() + wait_ms;
    let result;
    do {
      result = await this.jobRequest(session, { op: 'read', job_id, cursor, max_bytes });
      if (result.finished || result.output || result.state === 'unknown' || Date.now() >= until) break;
      await delay(Math.min(250, Math.max(0, until - Date.now())));
    } while (true);
    return { session_id, job_id, ...result };
  }
  async execCancel({ session_id, job_id, force = false }) {
    const session = this.session(session_id); identifier(job_id);
    check(session.record.jobs.includes(job_id), 'JOB_NOT_OWNED', 'This job is not recorded in the session.');
    return { session_id, job_id, ...await this.jobRequest(session, { op: 'cancel', job_id, force }) };
  }
  async execForget({ session_id, job_id }) {
    const session = this.session(session_id); identifier(job_id);
    check(session.record.jobs.includes(job_id), 'JOB_NOT_OWNED', 'This job is not recorded in the session.');
    const result = await this.jobRequest(session, { op: 'forget', job_id });
    check(result.forgotten, 'JOB_STATE_UNKNOWN', 'The remote job has no receipt. Its files were not removed.');
    session.record.jobs = session.record.jobs.filter(x => x !== job_id); await this.save(session);
    return { session_id, job_id, forgotten: true };
  }
}
