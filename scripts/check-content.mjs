import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function normalizeText(value) {
  let text = value;
  // Decode common source/JSON escapes as well as literal Unicode forms.
  for (let round = 0; round < 3; round++) {
    const next = text
      .replace(/\\u\{([\da-f]{1,6})\}/gi, (match, hex) => parseInt(hex, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(hex, 16)) : match)
      .replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (next === text) break;
    text = next;
  }
  return text.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '');
}

export function contentViolations(value, denyPatterns = []) {
  const text = normalizeText(value);
  const rules = [
    ...denyPatterns.map(pattern => ['restricted content', new RegExp(pattern, 'i')]),
    ['personal machine path', /\/Users\/[a-z\d][^\s/"']*\//i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['access credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|AKIA[A-Z0-9]{16})\b/],
    ['encoded access credential', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export function scanRepository(root, denyPatterns = []) {
  const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
  const failures = [];
  for (const path of paths) {
    const problems = [...contentViolations(path, denyPatterns), ...contentViolations(readFileSync(resolve(root, path), 'utf8'), denyPatterns)];
    if (/(?:^|\/)(?:credentials[^/]*\.json|\.env(?:\..*)?|private-state)(?:\/|$)|\.(?:pem|key|har|pcap|pcapng)$/i.test(path)) problems.push('private data file');
    if (problems.length) failures.push({ path, problems: [...new Set(problems)] });
  }
  return { filesChecked: paths.length, customPolicies: denyPatterns.length, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const denyPatterns = JSON.parse(process.env.CONTENT_DENY_PATTERNS || '[]');
  if (!Array.isArray(denyPatterns) || denyPatterns.some(pattern => typeof pattern !== 'string')) {
    throw new Error('CONTENT_DENY_PATTERNS must be a JSON array of regular expression strings');
  }
  if (process.env.REQUIRE_CONTENT_POLICY === 'true' && !denyPatterns.length) {
    throw new Error('Required content policy is not configured');
  }
  const report = scanRepository(root, denyPatterns);
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
