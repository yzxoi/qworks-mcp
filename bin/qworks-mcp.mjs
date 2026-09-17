#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseConfig, validateRoots } from '../src/config.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
try {
  const config = parseConfig(process.argv.slice(2));
  if (config.mode === 'help') {
    console.log(`qworks-mcp ${version}

Usage: qworks-mcp [options]
  --credentials PATH    Credential store (default: ~/.qworks-mcp/credentials.json)
  --allowed-root PATH   Local file access root; repeatable (default: working directory)
  --state-dir PATH      Session metadata (default: ~/.qworks-mcp/sessions)
  --modules LIST        Comma-separated modules, including jupyter; auth stays available
  --doctor              Print runtime integrity and definition count, without login
  --version             Print adapter version
  --help                Show this help

QWORKS_SDK_CREDENTIALS sets the credential store when --credentials is omitted.
With no mode flag, starts the MCP server over stdio. No desktop process required.`);
  } else if (config.mode === 'version') {
    console.log(version);
  } else {
    const { getPrivateToolDefinitions, runtimeInfo } = await import('../src/sdk.mjs');
    if (config.mode === 'doctor') {
      console.log(JSON.stringify({ adapterVersion: version, ...runtimeInfo(),
        privateToolDefinitions: getPrivateToolDefinitions().length,
        jupyterToolDefinitions: 26,
        transport: 'stdio', desktopRequired: false }, null, 2));
    } else {
      // JupyterLab diagnostics must not write to the MCP framing stream.
      console.log = console.error.bind(console);
      console.debug = () => {};
      const { createQworksMcpServer } = await import('../src/server.mjs');
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      // Files created by the SDK, including its credential store, are owner-only.
      process.umask(0o077);
      const server = await createQworksMcpServer({
        credentialsPath: config.credentialsPath,
        allowedRoots: validateRoots(config.allowedRoots),
        modules: config.modules,
        stateDir: config.stateDir,
      });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
        void server.close().finally(() => process.exit(0));
      });
      await server.connect(new StdioServerTransport());
    }
  }
} catch (error) {
  // stdout is reserved for protocol messages when serving.
  console.error(`qworks-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
