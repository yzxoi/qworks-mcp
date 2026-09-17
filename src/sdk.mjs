import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defaultCredentialsPath } from './config.mjs';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../vendor/manifest.json', import.meta.url), 'utf8'));
const runtimeUrl = new URL('../vendor/inspire-sdk.cjs', import.meta.url);
const digest = createHash('sha256').update(readFileSync(runtimeUrl)).digest('hex');
if (digest !== manifest.runtimeSha256) throw new Error('SDK integrity check failed; restore or re-extract the pinned runtime');
const sdk = require(fileURLToPath(runtimeUrl));
if (sdk.sdkVersion !== manifest.sdkVersion) throw new Error('SDK version does not match the extraction manifest');

export const sdkVersion = sdk.sdkVersion;
export const getPrivateToolDefinitions = sdk.getPrivateToolDefinitions;
export const privateActions = sdk.privateActions;
export const PrivateContext = sdk.PrivateContext;
export const zod = sdk.zod;

// Use the adapter's own identity store unless a caller explicitly supplies one.
export class InspireProvider extends sdk.InspireProvider {
  constructor(options = {}) {
    super({ ...options, credentialsPath: options.credentialsPath ?? defaultCredentialsPath() });
  }
}

export function createInspireMcpServer(options = {}) {
  return sdk.createInspireMcpServer({
    ...options,
    credentialsPath: options.credentialsPath ?? defaultCredentialsPath(),
    allowedRoots: options.allowedRoots?.length ? options.allowedRoots : [process.cwd()],
  });
}

export function runtimeInfo() {
  return { sdkVersion, qworksVersion: manifest.qworksVersion, runtimeSha256: digest, integrity: 'passed' };
}
