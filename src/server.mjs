import { createInspireMcpServer, InspireProvider, zod } from './sdk.mjs';
import { JupyterManager } from './jupyter/manager.mjs';
import { registerJupyterTools } from './jupyter/tools.mjs';

export async function createQworksMcpServer(options = {}) {
  const { modules, stateDir, resolveAccess, ...platformOptions } = options;
  const server = await createInspireMcpServer({ ...platformOptions, modules: modules?.filter(x => x !== 'jupyter') });
  if (modules && !modules.includes('jupyter')) return server;
  const manager = new JupyterManager({
    allowedRoots: options.allowedRoots, stateDir,
    resolveAccess: resolveAccess ?? (async notebookId => {
      // Read the latest credentials after login/logout/refresh by the SDK.
      const provider = new InspireProvider({ credentialsPath: options.credentialsPath });
      return (await provider.getPrivateClient()).notebooks.getAccessUrls(notebookId);
    }),
  });
  registerJupyterTools(server, manager, zod);
  const close = server.close.bind(server);
  server.close = async () => { await manager.dispose(); await close(); };
  const onclose = server.server.onclose;
  server.server.onclose = () => { onclose?.(); void manager.dispose(); };
  server.jupyter = manager;
  return server;
}

export { JupyterManager } from './jupyter/manager.mjs';
