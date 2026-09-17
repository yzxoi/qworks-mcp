import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getPrivateToolDefinitions, sdkVersion, zod, runtimeInfo } from '../src/sdk.mjs';

test('pinned SDK exposes a complete serializable private tool catalog', () => {
  assert.equal(sdkVersion, '0.1.15-dev.2');
  assert.equal(runtimeInfo().integrity, 'passed');
  const definitions = getPrivateToolDefinitions();
  assert.equal(definitions.length, 41);
  assert.equal(new Set(definitions.map(d => d.name)).size, definitions.length);
  for (const definition of definitions) {
    assert.equal(typeof definition.execute, 'function');
    const schema = zod.toJSONSchema(zod.object(definition.inputSchema));
    assert.equal(JSON.parse(JSON.stringify(schema)).type, 'object');
  }
});

test('real stdio client initializes, lists tools and reads login state offline', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'qworks-mcp-test-'));
  const credentials = join(root, 'identity.json');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--require', fileURLToPath(new URL('./fixtures/offline.cjs', import.meta.url)),
      fileURLToPath(new URL('../bin/qworks-mcp.mjs', import.meta.url)),
      '--credentials', credentials, '--allowed-root', root, '--state-dir', join(root, 'sessions')],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'qworks-mcp-smoke-test', version: '0.1.0' });
  let errors = '';
  transport.stderr?.on('data', chunk => { errors += chunk; });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.filter(x => !x.name.startsWith('jupyter_')).map(x => x.name).sort(), ['inspire_login', 'inspire_login_status', 'inspire_logout']);
    assert.equal(tools.filter(x => x.name.startsWith('jupyter_')).length, 26);
    const login = await client.callTool({ name: 'inspire_login_status', arguments: {} });
    assert(!login.isError);
    const state = JSON.parse(login.content.find(x => x.type === 'text').text);
    assert.equal(state.status, 'unauthenticated');
    await assert.rejects(stat(credentials), { code: 'ENOENT' });
    assert.equal(errors, '');
  } finally {
    await client.close();
    await transport.close();
    await rm(root, { recursive: true, force: true });
  }
});
