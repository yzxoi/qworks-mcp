import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getPrivateToolDefinitions, zod } from '../src/sdk.mjs';
import { registerJupyterTools } from '../src/jupyter/tools.mjs';
import { extractSkill } from '../scripts/extract-inspire-skill.mjs';

const root = fileURLToPath(new URL('../skills/inspire/', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../vendor/inspire-skill-manifest.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');

test('skill includes pinned derived files and every reference is portable and reachable', () => {
  assert.equal(manifest.edition, 'private');
  assert.equal(manifest.files.length, 10);
  for (const entry of manifest.files) {
    assert.match(entry.sourceSha256, /^[a-f\d]{64}$/);
    assert.equal(sha(readFileSync(join(root, entry.path))), entry.adaptedSha256, entry.path);
  }
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    visited.add(path);
    const contents = readFileSync(path, 'utf8');
    for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^https?:/.test(link)) continue;
      const target = resolve(dirname(path), link), rel = relative(root, target);
      assert(!rel.startsWith('..') && !link.startsWith('/'), `Nonportable skill reference in ${path}`);
      visit(target);
    }
  }
  visit(join(root, 'SKILL.md'));
  for (const entry of manifest.files) assert(visited.has(join(root, entry.path)), `Unreachable reference: ${entry.path}`);
  assert(visited.has(join(root, 'references/jupyter.md')));
  const entry = readFileSync(join(root, 'SKILL.md'), 'utf8');
  assert.match(entry, /^---\nname: inspire\ndescription: [^\n]+\n---\n/);
});

test('skill tool references belong to the current platform or Jupyter catalog', () => {
  const names = new Set(getPrivateToolDefinitions().map(x => x.name));
  for (const name of registerJupyterTools({ registerTool() {} }, {}, zod)) names.add(name);
  const referenced = new Set();
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (path.endsWith('.md')) {
        const text = readFileSync(path, 'utf8');
        for (const [, name] of text.matchAll(/`((?:inspire|context|resource_specs|images|notebooks|train|hpc_jobs|inference_servings|model_hub|api_keys|workspaces|jupyter)_[a-z_]+)(?:`|\()/g)) {
          referenced.add(name);
          assert(names.has(name), `Unknown MCP tool in skill: ${name}`);
        }
      }
    }
  }
  walk(root);
  assert(referenced.size > 40, 'The extraction lost module guidance.');
});

test('extractor rejects an unrecognized source before writing destination files', () => {
  const source = mkdtempSync(join(tmpdir(), 'inspire-skill-source-'));
  const before = sha(readFileSync(join(root, 'SKILL.md')));
  try {
    // Same inventory, different source revision. No desktop install is needed.
    for (const entry of manifest.files) {
      const path = join(source, entry.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'unrecognized source revision\n');
    }
    assert.throws(() => extractSkill(source, { denyPatterns: ['BLOCKED_LITERAL'] }), /Unsupported skill source revision/);
    assert.equal(sha(readFileSync(join(root, 'SKILL.md'))), before);
    assert.throws(() => extractSkill(source), /CONTENT_DENY_PATTERNS/);
  } finally { rmSync(source, { recursive: true, force: true }); }
});
