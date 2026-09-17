# Changelog

## 0.2.0

- Add 26 Jupyter MCP tools alongside the existing platform SDK.
- Use independent, persisted session IDs with process locking and explicit detach/shutdown behavior.
- Support persistent kernels, bounded asynchronous output, interruption, restart and rich MIME results through the official JupyterLab client.
- Add remote directory and file operations, binary upload/download, local path boundaries and transfer checksums.
- Add owned interactive terminals with input, cursor-based output, resize and close.
- Add independent Linux shell jobs with durable receipts, logs, exit codes, cancellation, idempotent job IDs and spool cleanup.
- Add real Jupyter integration tests, including process recovery and resource cleanup; require the Linux suite in CI.
- Verified the core execution, transfer, PTY and job flows against a live platform instance without retaining account data in the repository.

## 0.1.0

- Extract and pin the platform SDK dependency closure.
- Provide standalone JavaScript exports, stdio MCP, runtime integrity checks and configurable content checks.
