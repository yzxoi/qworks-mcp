import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseConfig, defaultCredentialsPath, validateRoots } from '../src/config.mjs';
import { contentViolations } from '../scripts/check-content.mjs';

test('credentials are isolated by default and explicit flags override environment', () => {
  assert.equal(parseConfig([], {}).credentialsPath, defaultCredentialsPath());
  assert.equal(parseConfig(['--credentials', '~/custom.json'], { QWORKS_SDK_CREDENTIALS: 'ignored.json' }).credentialsPath, resolve(homedir(), 'custom.json'));
  assert.equal(parseConfig([], { QWORKS_SDK_CREDENTIALS: 'identity.json' }).credentialsPath, resolve('identity.json'));
});

test('module and file root configuration rejects invalid inputs', () => {
  assert.throws(() => parseConfig(['--modules', 'typo']), /Modules must/);
  assert.throws(() => parseConfig(['--credentials']), /Missing value/);
  assert.throws(() => parseConfig(['--typo']), /Unknown option/);
  assert.deepEqual(parseConfig(['--modules', 'notebooks,context,notebooks']).modules, ['notebooks', 'context']);
  assert.equal(validateRoots([process.cwd(), process.cwd()]).length, 1);
});

test('content gate applies supplied rules to mixed case and escaped text', () => {
  const identifier = 'BLOCKED';
  const rules = ['blocked'];
  assert(contentViolations(identifier, rules).includes('restricted content'));
  assert(contentViolations(identifier.toLowerCase(), rules).includes('restricted content'));
  const escaped = Array.from(identifier, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  assert(contentViolations(escaped, rules).includes('restricted content'));
  assert.deepEqual(contentViolations('Generic accelerator resources and notebook tools'), []);
});
