import { publicError } from './common.mjs';

export function registerJupyterTools(server, manager, z) {
  const id = () => z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
  const session = () => ({ session_id: id().describe('Independent session ID returned by jupyter_session_open.') });
  const wait = () => z.number().int().min(0).max(30000).optional().describe('Bounded wait in milliseconds; timing out does not cancel remote work.');
  const cursor = () => z.number().int().min(0).optional();
  const path = () => z.string().max(4096).describe('Path relative to the Jupyter contents root.');
  const encoding = () => z.enum(['utf8', 'base64']).optional();
  const overwrite = () => z.boolean().optional().describe('Default false. Explicitly allow replacing an existing file.');
  const terminal = () => ({ ...session(), terminal_id: z.string().regex(/^\w{1,100}$/) });
  const job = () => ({ ...session(), job_id: id() });
  const definitions = [
    ['jupyter_session_open', 'open', 'Connect using notebook_id (preferred) or a Jupyter URL. Returns an independent session_id. Reuse session_id to resume saved kernels, terminals and jobs after detaching. Starts no kernel until needed. No desktop required.', { notebook_id: z.string().max(200).optional(), jupyter_url: z.string().max(16384).optional(), session_id: id().optional(), kernel_name: z.string().max(200).optional() }],
    ['jupyter_sessions_list', 'list', 'List local session bindings, owned resources and whether they are open in this process. Does not contact instances.', {}, true],
    ['jupyter_session_status', 'status', 'Inspect session capabilities, user kernel, terminal IDs and job IDs without exposing access credentials.', session(), true],
    ['jupyter_session_reconnect', 'reconnect', 'Refresh the access URL and reconnect. In-flight Python result delivery may become unknown; never automatically rerun code. Terminal transcript cursors reset. Direct-URL sessions may supply a refreshed URL.', { ...session(), jupyter_url: z.string().max(16384).optional() }],
    ['jupyter_session_close', 'close', 'Detach (default) preserving remote resources for resume, or shut down only kernels and terminals owned by this session. Neither mode stops independent shell jobs; cancel them explicitly. Does not stop the platform instance.', { ...session(), mode: z.enum(['detach', 'shutdown']).optional() }],
    ['jupyter_execute', 'execute', 'Execute code in the persistent user kernel. Variables survive calls. Returns execution_id and bounded output; read again for long executions. input() is disabled. Do not retry submission on uncertain delivery.', { ...session(), code: z.string().min(1).max(256 * 1024), wait_ms: wait() }],
    ['jupyter_execution_read', 'readExecution', 'Read incremental kernel output by execution_id and event cursor. Output is retained only in this server process, not replayed after restart. Includes text, errors and MIME display data.', { ...session(), execution_id: id(), cursor: cursor(), wait_ms: wait() }, true],
    ['jupyter_interrupt', 'interrupt', 'Interrupt current user-kernel execution without clearing variables. Read status afterwards.', session()],
    ['jupyter_restart', 'restart', 'Restart this session user kernel, clearing variables and interrupting code. Independent shell jobs continue.', session()],
    ['jupyter_files_list', 'filesList', 'List remote directory entries using Jupyter Contents API.', { ...session(), path: path().optional() }, true],
    ['jupyter_files_read', 'filesRead', 'Read part of a remote file as UTF-8 or Base64. Offsets count bytes. Use jupyter_download for transfer to disk.', { ...session(), path: path(), encoding: encoding(), offset: cursor(), max_bytes: z.number().int().min(1).max(256 * 1024).optional() }, true],
    ['jupyter_files_write', 'filesWrite', 'Write text or Base64 to a remote file. Parents must exist. Existing paths require overwrite=true. Remote no-clobber is best effort; Contents API has no atomic conditional PUT.', { ...session(), path: path(), content: z.string().max(1024 * 1024), encoding: encoding(), overwrite: overwrite() }],
    ['jupyter_files_mkdir', 'mkdir', 'Create one remote directory; its parent must exist.', { ...session(), path: path() }],
    ['jupyter_files_move', 'move', 'Move or rename a remote file/directory. Rejects an existing destination.', { ...session(), path: path(), destination: path() }],
    ['jupyter_files_delete', 'deleteFile', 'Delete a specific file or empty directory. Cannot delete the Contents root.', { ...session(), path: path() }],
    ['jupyter_upload', 'upload', 'Transfer a local file directly to the instance without putting bytes in model context. Local file must be inside --allowed-root. Maximum 32 MiB; parents must exist.', { ...session(), local_path: z.string().max(4096), remote_path: path(), overwrite: overwrite() }],
    ['jupyter_download', 'download', 'Transfer a remote file directly to a local path inside --allowed-root. Maximum 32 MiB; local parent must exist. Atomic replacement or no-clobber creation.', { ...session(), remote_path: path(), local_path: z.string().max(4096), overwrite: overwrite() }],
    ['jupyter_terminal_open', 'terminalOpen', 'Create a persistent PTY owned by this session. Use write/read for interactive programs, exec_start for scripts needing exit codes.', { ...session(), cwd: z.string().max(4096).optional(), rows: z.number().int().min(1).max(500).optional(), cols: z.number().int().min(1).max(1000).optional() }],
    ['jupyter_terminal_read', 'terminalRead', 'Read terminal output including ANSI escapes. Supply next_cursor and stream_id afterwards. Cursors count UTF-16 units. Reconnection may cause gaps; truncation is reported.', { ...terminal(), cursor: cursor(), stream_id: z.string().optional(), max_chars: z.number().int().min(1).max(256 * 1024).optional(), wait_ms: wait() }, true],
    ['jupyter_terminal_write', 'terminalWrite', 'Send input once. Include newline to submit; \\u0003 sends Ctrl-C. Delivery is not command completion. Read output before retrying uncertain input.', { ...terminal(), input: z.string().max(65536) }],
    ['jupyter_terminal_resize', 'terminalResize', 'Resize the session-owned PTY.', { ...terminal(), rows: z.number().int().min(1).max(500), cols: z.number().int().min(1).max(1000) }],
    ['jupyter_terminal_close', 'terminalClose', 'Shut down a session-owned terminal. Attached programs may terminate.', terminal()],
    ['jupyter_exec_start', 'execStart', 'Start a detached Bash command on Linux via a separate Python control kernel. Does not block the user kernel. Returns durable job_id, output and exit status. Explicit job_id is idempotent for the same payload. Never blindly retry an uncertain launch. Jobs survive client and kernel shutdown.', { ...session(), command: z.string().min(1).max(256 * 1024), cwd: z.string().max(4096).optional(), env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(65536)).optional(), job_id: id().optional(), wait_ms: wait() }],
    ['jupyter_exec_read', 'execRead', 'Read shell job output and exit status, including after reconnect/restart. May start a private control kernel. cursor counts bytes. The remote spool is temporary and does not survive instance recreation.', { ...job(), cursor: cursor(), max_bytes: z.number().int().min(1).max(256 * 1024).optional(), wait_ms: wait() }],
    ['jupyter_exec_cancel', 'execCancel', 'Send SIGTERM to a session-owned job process group after checking process identity. force=true sends SIGKILL. Read status to confirm completion.', { ...job(), force: z.boolean().optional() }],
    ['jupyter_exec_forget', 'execForget', 'Remove a finished job and its remote spool files. Refuses to remove a running job; cancel and confirm completion first.', job()],
  ];
  for (const [name, method, description, inputSchema, readOnly = false] of definitions) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } }, async args => {
      try {
        const result = await manager[method](args);
        const content = [{ type: 'text', text: JSON.stringify(result) }];
        for (const output of result.outputs ?? []) {
          for (const mimeType of ['image/png', 'image/jpeg']) {
            const data = output.data?.[mimeType];
            if (typeof data === 'string' && data.length <= 700000) content.push({ type: 'image', mimeType, data: data.replace(/\s/g, '') });
          }
        }
        return { content, structuredContent: result };
      } catch (error) {
        const result = { error: publicError(error) };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      }
    });
  }
  return definitions.map(x => x[0]);
}
