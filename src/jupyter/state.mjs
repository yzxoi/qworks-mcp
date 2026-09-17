import { mkdir, readFile, writeFile, rename, unlink, readdir, open, realpath, link } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identifier, check, JupyterError } from './common.mjs';

export class SessionStore {
  constructor(directory) { this.directory = directory; this.locks = new Map(); this.writes = new Map(); }
  path(id) { return join(this.directory, `${identifier(id)}.json`); }
  async load(id) {
    try {
      const data = JSON.parse(await readFile(this.path(id), 'utf8'));
      check(data.version === 1 && data.session_id === id, 'INVALID_STATE', 'Unsupported session state.');
      return data;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async list() {
    const files = await readdir(this.directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const values = [];
    for (const file of files.filter(x => x.endsWith('.json'))) {
      try { const record = await this.load(file.slice(0, -5)); if (record) values.push(record); } catch { /* Ignore unrelated or damaged state files. */ }
    }
    return values;
  }
  async acquire(id) {
    if (this.locks.has(id)) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = `${this.path(id)}.lock`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, 'wx', 0o600);
        const token = randomUUID();
        await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.close();
        this.locks.set(id, token); return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let lock;
        try { lock = JSON.parse(await readFile(path, 'utf8')); } catch { throw new JupyterError('SESSION_LOCKED', 'Another process is opening this session.'); }
        let alive = true;
        try { process.kill(lock.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        check(!alive, 'SESSION_LOCKED', 'This session is open in another process. Detach it there before resuming here.');
        await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
    }
    throw new JupyterError('SESSION_LOCKED', 'Could not acquire the session.');
  }
  save(record) {
    const json = JSON.stringify(record, null, 2);
    const previous = this.writes.get(record.session_id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const path = this.path(record.session_id), temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, json, { mode: 0o600, flag: 'wx' });
      try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
    });
    this.writes.set(record.session_id, next);
    return next;
  }
  async release(id) {
    await this.writes.get(id)?.catch(() => {});
    this.writes.delete(id);
    const token = this.locks.get(id);
    if (!token) return;
    const path = `${this.path(id)}.lock`;
    const lock = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
    if (lock?.token === token) await unlink(path).catch(() => {});
    this.locks.delete(id);
  }
}

export class LocalFiles {
  constructor(roots, maxBytes = 32 * 1024 * 1024) { this.roots = roots; this.maxBytes = maxBytes; }
  async allowed(path) {
    const roots = await Promise.all(this.roots.map(x => realpath(x)));
    check(roots.some(root => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel)); }), 'LOCAL_PATH_DENIED', 'Local file path is outside the configured allowed roots.');
    return path;
  }
  async read(path) {
    const actual = await this.allowed(await realpath(resolve(path)));
    const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      check(info.isFile() && info.size <= this.maxBytes, 'FILE_TOO_LARGE', 'Upload must be a regular file within the transfer size limit.');
      const chunks = []; let total = 0;
      while (true) {
        const buffer = Buffer.alloc(Math.min(1024 * 1024, this.maxBytes + 1 - total));
        const { bytesRead } = await handle.read(buffer);
        if (!bytesRead) break;
        total += bytesRead;
        check(total <= this.maxBytes, 'FILE_TOO_LARGE', 'Upload exceeds the transfer size limit.');
        chunks.push(buffer.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks, total);
    } finally { await handle.close(); }
  }
  async write(path, data, overwrite = false) {
    check(data.length <= this.maxBytes, 'FILE_TOO_LARGE', 'Download exceeds the transfer size limit.');
    const actual = join(await realpath(dirname(resolve(path))), basename(path));
    await this.allowed(actual);
    const temporary = join(dirname(actual), `.qworks-download-${randomUUID()}`);
    try {
      await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
      if (overwrite) {
        // Renaming replaces a symlink itself; it never writes through its target.
        await rename(temporary, actual);
      } else { await link(temporary, actual); }
    } finally { await unlink(temporary).catch(() => {}); }
    return { local_path: actual, bytes: data.length };
  }
}
