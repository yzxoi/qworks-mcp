// Extract the dependency closure of selected SDK symbols from the user's local
// QWorks installation. This does not patch or attach to the running application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positionals = args.filter(arg => arg !== '--check');
if (positionals.length > 1 || positionals.some(arg => arg.startsWith('--'))) {
  throw new Error('Usage: npm run extract -- [bundle-path] [--check]');
}
const sourcePath = positionals[0] || '/Applications/qworks.app/Contents/Resources/server/index.cjs';
const outDir = path.join(__dirname, '..', 'vendor');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
const supportedSha256 = 'a7174d80ec9bee60d3d70aca62f2c505bf3d1ad77374d943bb995407dc3e7e76';
if (sourceSha256 !== supportedSha256) throw new Error('Unsupported QWorks bundle. Recheck symbol mappings before extracting a different build.');
const ast = parser.parse(source, { sourceType: 'script' });
let program;
traverse(ast, { Program(p) { program = p; p.stop(); } });
const exportsMap = {
  createInspireMcpServer: 'uk',
  getPrivateToolDefinitions: 'EC',
  InspireProvider: 'fs',
  PrivateContext: 'Ia',
  privateActions: 'K',
  sdkVersion: 'ms',
  zod: 'E',
};
const selected = new Map();
const visitedBindings = new Set();
const initializers = new Map();
for (const p of program.get('body')) {
  if (!p.isExpressionStatement()) continue;
  const e = p.node.expression;
  let target;
  if (e.type === 'CallExpression' && e.callee.type === 'Identifier' && e.callee.name === '$o') {
    if (e.arguments[0]?.type === 'Identifier') target = e.arguments[0].name;
  }
  if (target) {
    const list = initializers.get(target) || [];
    list.push(p);
    initializers.set(target, list);
  }
}
function visit(p) {
  if (selected.has(p.node.start)) return;
  selected.set(p.node.start, p);
  p.traverse({ ReferencedIdentifier(ref) {
    const binding = ref.scope.getBinding(ref.node.name);
    if (binding?.scope === program.scope) add(binding.identifier.name);
  } });
}
function add(name) {
  if (visitedBindings.has(name)) return;
  visitedBindings.add(name);
  const binding = program.scope.getBinding(name);
  if (!binding) throw new Error(`Missing SDK symbol ${name}; QWorks bundle may have changed`);
  visit(binding.path);
  for (const init of initializers.get(name) || []) visit(init);
  // TypeScript enums and some namespace objects are assigned by a separate IIFE.
  for (const mutation of binding.constantViolations) {
    let p = mutation;
    while (p.parentPath && !p.parentPath.isProgram()) p = p.parentPath;
    if (p.isExpressionStatement()) visit(p);
  }
}
Object.values(exportsMap).forEach(add);
// Zod initializes its shared registry/config using standalone expressions.
// They are not captured by the declaration graph and must retain source order.
for (const p of program.get('body')) {
  if (p.isExpressionStatement() && /__zod_global(?:Config|Registry)/.test(source.slice(p.node.start, p.node.end))) visit(p);
}
const nodes = [...selected.values()].sort((a, b) => a.node.start - b.node.start);
const generated = '"use strict";\n' + nodes.map(p =>
  (p.isVariableDeclarator() ? 'var ' : '') + source.slice(p.node.start, p.node.end) + ';'
).join('\n') + '\nmodule.exports={' + Object.entries(exportsMap).map(([k,v]) => `${k}:${v}`).join(',') + '};\n';
const manifest = {
  qworksVersion: '0.7.9.1176',
  sdkPackage: '@inspire/inspire-sdk',
  sdkVersion: '0.1.15-dev.2',
  sourceSha256,
  runtimeSha256: crypto.createHash('sha256').update(generated).digest('hex'),
  selectedDeclarations: nodes.length, generatedBytes: Buffer.byteLength(generated),
  exports: exportsMap,
  note: 'SDK dependency closure derived from the pinned desktop bundle. Not an official SDK release.',
};
const manifestText = JSON.stringify(manifest, null, 2) + '\n';
if (checkOnly) {
  if (fs.readFileSync(path.join(outDir, 'inspire-sdk.cjs'), 'utf8') !== generated ||
      fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8') !== manifestText) {
    throw new Error('Committed SDK artifacts do not match the pinned source bundle');
  }
} else {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'inspire-sdk.cjs'), generated);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestText);
}
console.log(JSON.stringify(manifest, null, 2));
