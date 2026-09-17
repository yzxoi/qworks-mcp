import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

export const privateModules = Object.freeze([
  'auth', 'api_keys', 'context', 'workspaces', 'resource_specs', 'images',
  'notebooks', 'train', 'hpc_jobs', 'inference_servings', 'model_hub',
]);

export function expandPath(value, cwd = process.cwd()) {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(homedir(), value.slice(2));
  return resolve(cwd, value);
}

export function defaultCredentialsPath() {
  return join(homedir(), '.qworks-mcp', 'credentials.json');
}

export function parseConfig(argv, env = process.env, cwd = process.cwd()) {
  const options = { mode: 'serve', credentialsPath: env.QWORKS_SDK_CREDENTIALS || defaultCredentialsPath(), allowedRoots: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.mode = 'help'; continue; }
    if (arg === '--version') { options.mode = 'version'; continue; }
    if (arg === '--doctor') { options.mode = 'doctor'; continue; }
    if (!['--credentials', '--allowed-root', '--modules'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++i];
    if (!value?.trim() || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--credentials') options.credentialsPath = value;
    if (arg === '--allowed-root') options.allowedRoots.push(value);
    if (arg === '--modules') {
      options.modules = [...new Set(value.split(',').map(x => x.trim()).filter(Boolean))];
      if (!options.modules.length || options.modules.some(x => !privateModules.includes(x))) {
        throw new Error(`Modules must be selected from: ${privateModules.join(', ')}`);
      }
    }
  }
  options.credentialsPath = expandPath(options.credentialsPath, cwd);
  options.allowedRoots = (options.allowedRoots.length ? options.allowedRoots : [cwd]).map(x => expandPath(x, cwd));
  return options;
}

export function validateRoots(roots) {
  return [...new Set(roots.map(root => {
    if (!statSync(root).isDirectory()) throw new Error('Each allowed root must be an existing directory');
    return realpathSync(root);
  }))];
}
