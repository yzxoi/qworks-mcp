import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { delay } from '../src/jupyter/common.mjs';

const python = process.env.QWORKS_TEST_PYTHON || 'python3';
const available = spawnSync(python, ['-c', 'import jupyter_server, ipykernel'], { stdio: 'ignore' }).status === 0;

test('real Jupyter + stdio MCP: execution, files, terminals and session recovery', { timeout: 180000, skip: !available && process.env.QWORKS_REQUIRE_JUPYTER_TESTS !== '1' }, async t => {
  assert(available, 'Install jupyter_server and ipykernel or set QWORKS_TEST_PYTHON.');
  const root = await mkdtemp(join(tmpdir(), 'qworks-jupyter-integration-'));
  const remote = join(root, 'remote'), state = join(root, 'state'), token = randomBytes(24).toString('hex');
  await mkdir(remote);
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}/proxy/test/`;
  const url = `${base}lab?token=${token}`;
  const server = spawn(python, ['-m', 'jupyter_server', '--no-browser', '--ServerApp.ip=127.0.0.1', `--ServerApp.port=${port}`, '--ServerApp.port_retries=0', `--ServerApp.root_dir=${remote}`, '--ServerApp.base_url=/proxy/test/', `--IdentityProvider.token=${token}`, '--ServerApp.allow_root=True'], {
    env: { ...process.env, JUPYTER_RUNTIME_DIR: join(root, 'runtime'), PATH: `${dirname(python)}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '', client, transport, stderr = '', session_id, terminal_id;
  server.stdout.on('data', data => { serverLog += data; });
  server.stderr.on('data', data => { serverLog += data; });
  const api = async path => {
    const response = await fetch(base + path, { headers: { Authorization: `token ${token}` }, signal: AbortSignal.timeout(2000) });
    assert(response.ok, `Jupyter HTTP ${response.status}`); return response.json();
  };
  const connect = async () => {
    transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../bin/qworks-mcp.mjs', import.meta.url)), '--credentials', join(root, 'identity.json'), '--state-dir', state, '--allowed-root', root, '--modules', 'jupyter'], stderr: 'pipe' });
    transport.stderr?.on('data', data => { stderr += data; });
    client = new Client({ name: 'jupyter-integration-test', version: '1.0.0' });
    await client.connect(transport);
  };
  const call = async (name, args = {}, expectError) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    const value = result.structuredContent ?? JSON.parse(result.content.find(x => x.type === 'text').text);
    if (expectError) { assert(result.isError, JSON.stringify(value)); assert.equal(value.error.code, expectError); }
    else assert(!result.isError, JSON.stringify(value));
    assert(!JSON.stringify(value).includes(token), 'Tool result exposed a credential');
    return value;
  };
  const execute = (code, extra = {}) => call('jupyter_execute', { session_id, code, wait_ms: 10000, ...extra });
  const output = result => result.outputs.filter(x => x.type === 'stream').map(x => x.text).join('');
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { await api('api/status'); ready = true; break; } catch { await delay(100); }
      if (server.exitCode !== null) break;
    }
    assert(ready, 'Jupyter test server did not start: ' + serverLog.replaceAll(token, '[redacted]').slice(-2000));
    await connect();
    await t.test('module filtering, authentication and capability discovery', async () => {
      const tools = (await client.listTools()).tools;
      assert.equal(tools.length, 29);
      assert(!tools.some(x => x.name === 'notebooks_create'));
      await call('jupyter_session_open', { jupyter_url: base + 'lab?token=invalid' }, 'AUTHENTICATION_FAILED');
      const opened = await call('jupyter_session_open', { jupyter_url: url });
      session_id = opened.session_id;
      assert(opened.capabilities.kernels.includes('python3'));
      assert(opened.capabilities.terminals);
      assert.equal((await api('api/kernels')).length, 0, 'Connecting should not allocate a kernel');
    });
    await t.test('persistent kernel, rich output, errors and bounded asynchronous execution', async () => {
      assert.equal((await execute('counter = 40\nprint(counter)')).state, 'completed');
      assert.equal(output(await execute('counter += 2\nprint(counter)')).trim(), '42');
      const failure = await execute('raise ValueError("expected test error")');
      assert.equal(failure.state, 'error'); assert(failure.outputs.some(x => x.type === 'error'));
      const rich = await execute('from IPython.display import display\ndisplay({"text/plain": "rich-result", "text/html": "<b>rich-result</b>"}, raw=True)');
      assert(rich.outputs.some(x => x.data?.['text/html'] === '<b>rich-result</b>'));
      const pending = await execute('import time\ntime.sleep(1)\nprint("later")', { wait_ms: 0 });
      assert(!pending.finished);
      await call('jupyter_execute', { session_id, code: 'print("duplicate")' }, 'KERNEL_BUSY');
      const done = await call('jupyter_execution_read', { session_id, execution_id: pending.execution_id, wait_ms: 5000 });
      assert(done.finished); assert.equal(output(done).trim(), 'later');
      const empty = await call('jupyter_execution_read', { session_id, execution_id: pending.execution_id, cursor: done.next_cursor });
      assert.equal(empty.outputs.length, 0);
    });
    await t.test('text and binary transfers, overwrite handling, move and delete', async () => {
      await call('jupyter_files_mkdir', { session_id, path: 'roundtrip' });
      await call('jupyter_files_write', { session_id, path: 'roundtrip/中文.txt', content: 'hello 世界\n' });
      const read = await call('jupyter_files_read', { session_id, path: 'roundtrip/中文.txt' });
      assert.equal(read.content, 'hello 世界\n');
      await call('jupyter_files_write', { session_id, path: 'roundtrip/中文.txt', content: 'no overwrite' }, 'FILE_EXISTS');
      await call('jupyter_files_read', { session_id, path: '../outside' }, 'INVALID_PATH');
      const data = randomBytes(128 * 1024 + 17), source = join(root, 'upload.bin'), destination = join(root, 'download.bin');
      await writeFile(source, data);
      const uploaded = await call('jupyter_upload', { session_id, local_path: source, remote_path: 'roundtrip/binary' });
      const downloaded = await call('jupyter_download', { session_id, remote_path: 'roundtrip/binary', local_path: destination });
      assert.equal(uploaded.sha256, downloaded.sha256); assert.deepEqual(await readFile(destination), data);
      await call('jupyter_files_move', { session_id, path: 'roundtrip/binary', destination: 'roundtrip/moved' });
      assert((await call('jupyter_files_list', { session_id, path: 'roundtrip' })).entries.some(x => x.name === 'moved'));
      await call('jupyter_files_delete', { session_id, path: 'roundtrip/moved' });
      await call('jupyter_files_delete', { session_id, path: 'roundtrip/中文.txt' });
      await call('jupyter_files_delete', { session_id, path: 'roundtrip' });
    });
    await t.test('interactive terminal input, output and resize', async () => {
      const opened = await call('jupyter_terminal_open', { session_id, rows: 31, cols: 111 });
      terminal_id = opened.terminal_id;
      await call('jupyter_terminal_write', { session_id, terminal_id, input: "printf '\\n%s\\n' 'terminal-ready'; stty size\n" });
      let transcript = '', cursor = 0;
      for (let n = 0; n < 30; n++) {
        const result = await call('jupyter_terminal_read', { session_id, terminal_id, cursor, wait_ms: 500 });
        cursor = result.next_cursor; transcript += result.output;
        if (transcript.includes('31 111')) break;
      }
      assert.match(transcript, /\r?\nterminal-ready\r?\n/); assert.match(transcript, /31 111/);
      await call('jupyter_terminal_resize', { session_id, terminal_id, rows: 40, cols: 120 });
    });
    await t.test('detach and process restart preserve kernel state without saving tokens', async () => {
      const saved = await readFile(join(state, `${session_id}.json`), 'utf8');
      assert(!saved.includes(token)); assert(!saved.includes(base));
      // Closing the transport must detach automatically and release its lock.
      await client.close(); await transport.close();
      await connect();
      await call('jupyter_session_open', { session_id, jupyter_url: url });
      assert.equal(output(await execute('print(counter)')).trim(), '42');
      const status = await call('jupyter_session_status', { session_id });
      assert(status.terminals.includes(terminal_id));
      await call('jupyter_terminal_read', { session_id, terminal_id, wait_ms: 100 });
      await call('jupyter_session_reconnect', { session_id });
      assert.equal(output(await execute('print(counter)')).trim(), '42');
    });
    await t.test('interrupt and restart distinguish cancellation from state loss', async () => {
      const pending = await execute('import time\ntime.sleep(60)', { wait_ms: 0 });
      await delay(300);
      await call('jupyter_interrupt', { session_id });
      const interrupted = await call('jupyter_execution_read', { session_id, execution_id: pending.execution_id, wait_ms: 5000 });
      assert(interrupted.finished); assert.equal(interrupted.state, 'error');
      await call('jupyter_restart', { session_id });
      assert.equal((await execute('print(counter)')).state, 'error');
    });
    await t.test('external kernel loss is reported before allocating a replacement', async () => {
      const status = await call('jupyter_session_status', { session_id });
      const response = await fetch(base + 'api/kernels/' + status.kernel.id, { method: 'DELETE', headers: { Authorization: `token ${token}` } });
      assert.equal(response.status, 204);
      await delay(300);
      await call('jupyter_execute', { session_id, code: 'print("fresh")' }, 'KERNEL_LOST');
      assert.equal((await api('api/kernels')).length, 0);
      assert.equal(output(await execute('print("fresh")')).trim(), 'fresh');
    });
    await t.test('Linux background jobs have receipts, exit codes, cancellation and cleanup', { skip: process.platform !== 'linux' }, async () => {
      const job_id = randomUUID();
      let result = await call('jupyter_exec_start', { session_id, job_id, command: 'printf "%s" "$QWORKS_TEST_VALUE"; exit 7', env: { QWORKS_TEST_VALUE: 'job-ready' }, wait_ms: 1000 });
      for (let n = 0; n < 10 && !result.finished; n++) result = await call('jupyter_exec_read', { session_id, job_id, wait_ms: 500 });
      assert.equal(result.exit_code, 7); assert.equal(result.output, 'job-ready');
      const again = await call('jupyter_exec_start', { session_id, job_id, command: 'printf "%s" "$QWORKS_TEST_VALUE"; exit 7', env: { QWORKS_TEST_VALUE: 'job-ready' } });
      assert.equal(again.log_bytes, 9);
      const long = await call('jupyter_exec_start', { session_id, command: 'sleep 60', wait_ms: 0 });
      await call('jupyter_exec_cancel', { session_id, job_id: long.job_id });
      let cancelled;
      for (let n = 0; n < 10; n++) { cancelled = await call('jupyter_exec_read', { session_id, job_id: long.job_id, wait_ms: 100 }); if (cancelled.finished) break; await delay(100); }
      assert(cancelled.finished);
      await call('jupyter_exec_forget', { session_id, job_id: long.job_id });
      await call('jupyter_exec_forget', { session_id, job_id });
    });
    await t.test('shutdown removes only session-owned resources', async () => {
      await call('jupyter_terminal_close', { session_id, terminal_id });
      const closed = await call('jupyter_session_close', { session_id, mode: 'shutdown' });
      assert.deepEqual(closed.errors, []);
      assert.equal((await api('api/kernels')).length, 0);
      assert.equal((await api('api/terminals')).length, 0);
    });
    assert(!stderr.includes(token));
  } finally {
    if (client && session_id) await client.callTool({ name: 'jupyter_session_close', arguments: { session_id, mode: 'shutdown' } }).catch(() => {});
    await client?.close().catch(() => {}); await transport?.close().catch(() => {});
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});
