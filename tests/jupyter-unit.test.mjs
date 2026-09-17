import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JupyterConnection, parseEndpoint } from '../src/jupyter/connection.mjs';
import { LocalFiles, SessionStore } from '../src/jupyter/state.mjs';
import { Transcript, remotePath, publicError } from '../src/jupyter/common.mjs';

test('proxy URL parsing preserves base paths but strips credentials from the base', () => {
  assert.deepEqual(parseEndpoint('https://example.test/proxy/node/lab/tree/work?token=test-value#frag'), { baseUrl: 'https://example.test/proxy/node/', token: 'test-value' });
  assert.deepEqual(parseEndpoint('http://localhost:8888/'), { baseUrl: 'http://localhost:8888/', token: '' });
  assert.throws(() => parseEndpoint('file:///tmp/x'), { code: 'INVALID_URL' });
  assert.throws(() => parseEndpoint('https://user:password@example.test'), { code: 'INVALID_URL' });
  for (const value of ['../secret', 'folder/../../secret', '/etc/passwd', 'folder\\secret', 'x\0y']) assert.throws(() => remotePath(value));
  assert.equal(remotePath('folder//./中文.txt'), 'folder/中文.txt');
  assert(!JSON.stringify(publicError(new Error('https://example.test/?token=secret'))).includes('secret'));
});

test('terminal cursors expose eviction and reject stale streams', () => {
  const transcript = new Transcript(6);
  transcript.append('1234');
  const first = transcript.read(0, 2);
  assert.equal(first.output, '12'); assert(first.has_more);
  transcript.append('56789');
  const second = transcript.read(first.next_cursor, 4, first.stream_id);
  assert.equal(second.output, '4567'); assert(second.truncated); assert.equal(second.next_cursor, 7);
  assert.throws(() => transcript.read(0, 4, 'old-stream'), { code: 'STREAM_CHANGED' });
  assert.throws(() => transcript.read(100), { code: 'INVALID_CURSOR' });
});

test('transport sends header authentication and retries only reads', async () => {
  let attempts = 0;
  const connection = new JupyterConnection({ baseUrl: 'https://example.test/proxy/', token: 'fixture-private-value' }, { fetchImpl: async request => {
    attempts++;
    assert.equal(request.headers.get('Authorization'), 'token fixture-private-value');
    assert(!request.url.includes('fixture-private-value'));
    assert.equal(request.redirect, 'error');
    if (request.method !== 'GET' || attempts === 1) throw new Error('simulated reset');
    return new Response('{}', { status: 200 });
  } });
  try {
    await connection.json('api/status'); assert.equal(attempts, 2);
    await assert.rejects(connection.json('api/kernels', 'POST', { name: 'python3' }));
    assert.equal(attempts, 3, 'A mutation must never be replayed automatically');
  } finally { connection.dispose(); }
});

test('local transfers enforce real paths, no-clobber and symlink boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qworks-file-test-'));
  try {
    const allowed = join(root, 'allowed'), outside = join(root, 'outside');
    await mkdir(allowed); await mkdir(outside);
    await writeFile(join(outside, 'secret'), 'outside');
    await symlink(outside, join(allowed, 'escape'));
    const files = new LocalFiles([allowed]);
    await assert.rejects(files.read(join(allowed, 'escape/secret')), { code: 'LOCAL_PATH_DENIED' });
    await assert.rejects(files.write(join(allowed, 'escape/new'), Buffer.from('x')), { code: 'LOCAL_PATH_DENIED' });
    await files.write(join(allowed, 'file'), Buffer.from('one'));
    await assert.rejects(files.write(join(allowed, 'file'), Buffer.from('two')), { code: 'EEXIST' });
    assert.equal((await files.read(join(allowed, 'file'))).toString(), 'one');
    await files.write(join(allowed, 'file'), Buffer.from('two'), true);
    assert.equal((await files.read(join(allowed, 'file'))).toString(), 'two');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session state writes are atomic, private and exclusively acquired', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qworks-state-test-'));
  const a = new SessionStore(root), b = new SessionStore(root);
  try {
    await a.acquire('test');
    await assert.rejects(b.acquire('test'), { code: 'SESSION_LOCKED' });
    await Promise.all([a.save({ version: 1, session_id: 'test', sequence: 1 }), a.save({ version: 1, session_id: 'test', sequence: 2 })]);
    assert.equal((await a.load('test')).sequence, 2);
    assert.equal((await stat(join(root, 'test.json'))).mode & 0o777, 0o600);
    await a.release('test'); await b.acquire('test'); await b.release('test');
    await assert.rejects(a.load('../escape'), { code: 'INVALID_ID' });
  } finally { await a.release('test'); await b.release('test'); await rm(root, { recursive: true, force: true }); }
});
