# Jupyter 实例连接

平台 SDK 提供身份、实例生命周期和访问 URL；连接器用 `@jupyterlab/services` 处理 Kernel、Contents 和 Terminal 协议。所有实例操作直接访问 Jupyter 服务，不经过 QWorks 桌面或固定本地端口，也不要求配置 SSH。

## 会话

```json
{"name":"jupyter_session_open","arguments":{"notebook_id":"INSTANCE_ID"}}
```

返回 `session_id`、内核列表、终端可用性和本会话拥有的资源。打开连接不会立即创建 Kernel。也可传 `jupyter_url` 连接任意可达的兼容 Jupyter 服务；URL 可含 `token`，服务只将它用于认证，不写入会话记录或工具结果。

| 工具 | 用途 |
| --- | --- |
| `jupyter_session_open` | 打开或恢复会话；可指定 `session_id` 和 `kernel_name` |
| `jupyter_sessions_list` | 列出本机会话绑定和资源标识 |
| `jupyter_session_status` | 当前连接、Kernel、终端、作业和执行标识 |
| `jupyter_session_reconnect` | 重新取得访问地址、更新认证并重建连接 |
| `jupyter_session_close` | `detach` 保留远程资源，`shutdown` 关闭本会话 Kernel 和终端 |

会话记录包括实例 ID、访问端点摘要、Kernel ID、终端名和作业 ID；采用原子写入和用户私有文件权限。记录不保存 Token、访问 URL、代码输出或平台凭据。进程锁防止同一会话被多个本地 MCP 进程同时操作；崩溃留下的锁在确认原进程不存在后回收。状态目录应放在本机文件系统。

通过实例 ID 创建的会话可以在 MCP 重启后只凭 `session_id` 恢复。直接 URL 会话需要再次提供 URL。实例访问端点变化时，平台会话在 detach 后重新 open 会丢弃旧 Kernel/终端标识，避免误操作新实例的资源。

正常关闭 MCP 只断开连接。远程资源会继续存在和消耗实例内资源，直到显式关闭或平台回收。`shutdown` 后仍可恢复该会话查询后台作业，但用户 Kernel 中的变量已经清空。

## 持续执行

| 工具 | 用途 |
| --- | --- |
| `jupyter_execute` | 在本会话拥有的持续 Kernel 中执行代码 |
| `jupyter_execution_read` | 按 `execution_id` 和事件 `cursor` 续读输出 |
| `jupyter_interrupt` | 中断正在运行的代码 |
| `jupyter_restart` | 重启 Kernel，清空变量 |

默认优先使用 `python3`；也可指定已安装的其他 Kernel。每个会话只允许一个未完成执行，避免调用方超时后继续堆积命令。`wait_ms` 最大 30000；等待到期返回当前状态，不会取消计算。`input()` 等同步输入被禁用，需要交互输入时使用终端。

输出包含 stream、错误、执行结果和 MIME display 事件；PNG/JPEG 小图同时通过标准 MCP image 内容返回。HTML、Plotly 和 widget 数据不提供桌面专用交互渲染。`clear_output` / `update_display_data` 保留为事件，调用方可重建显示状态。

执行输出仅在当前进程中保留：每个执行最多 2 MiB，每个会话最近 100 次执行。超限会标记 `truncated`。重启客户端可恢复 Kernel 变量，但无法重放之前的 IOPub 输出。连接丢失时未完成执行标记为 `unknown`，不会自动重跑；程序可能仍在远端运行。确认状态后再决定中断或提交新代码。

如果远程 Kernel 已消失，第一次执行报告 `KERNEL_LOST`；再次显式执行才建立新 Kernel。不会把空的新 Kernel 悄悄当成原有会话。

## 文件

| 工具 | 用途 |
| --- | --- |
| `jupyter_files_list` | 列出目录 |
| `jupyter_files_read` | 按字节偏移读取文本或 Base64 |
| `jupyter_files_write` | 写入文本或 Base64 |
| `jupyter_files_mkdir` | 创建一层目录 |
| `jupyter_files_move` | 移动或重命名 |
| `jupyter_files_delete` | 删除文件或空目录 |
| `jupyter_upload` | 本地文件直接上传至实例 |
| `jupyter_download` | 实例文件直接下载至本地 |

```json
{"name":"jupyter_upload","arguments":{"session_id":"research","local_path":"/absolute/project/train.py","remote_path":"train.py"}}
{"name":"jupyter_download","arguments":{"session_id":"research","remote_path":"results.json","local_path":"/absolute/project/results.json"}}
```

远程路径相对于 Jupyter Contents 根目录，拒绝绝对路径、父目录穿越和根目录删除。它不是整个操作系统的文件挂载。上传下载由服务处理字节，无需把文件内容放进模型上下文；单文件上限 32 MiB，返回 SHA-256 便于校验。更大的数据集应使用实例内的数据下载/存储工具。

本地路径受 `--allowed-root` 约束，并检查解析符号链接后的路径。父目录必须存在；默认不覆盖，需显式 `overwrite=true`。本地下载采用原子写入和无覆盖创建。远程 Contents API 不支持原子条件写入，因此远程“禁止覆盖”检查无法排除其他进程同时创建文件的竞争。

## 终端

| 工具 | 用途 |
| --- | --- |
| `jupyter_terminal_open` | 新建本会话拥有的 PTY |
| `jupyter_terminal_write` | 输入文本、回车或控制字符 |
| `jupyter_terminal_read` | 按游标读取输出 |
| `jupyter_terminal_resize` | 调整行列数 |
| `jupyter_terminal_close` | 关闭终端及其附属程序 |

写入命令时在 `input` 末尾包含 `\n`；`\u0003` 表示 Ctrl-C。成功写入只代表发送了输入，不代表命令完成；需要退出码的脚本使用下方的 Shell 作业工具。

输出保留 ANSI 控制序列，每个终端最多保留约一百万 UTF-16 单元。传回 `next_cursor` 和 `stream_id` 续读；被覆盖的旧输出标记 `truncated`。连接重建会重置 `stream_id`，不能保证断线期间输出完整。每个会话最多 8 个终端、一个 MCP 进程最多打开 16 个会话。

## 后台 Shell 作业

| 工具 | 用途 |
| --- | --- |
| `jupyter_exec_start` | 后台执行 Bash 命令，支持 `cwd`、环境变量和显式 `job_id` |
| `jupyter_exec_read` | 按字节游标读取日志、状态和退出码 |
| `jupyter_exec_cancel` | 对核对过身份的作业进程组发送终止信号 |
| `jupyter_exec_forget` | 删除已结束作业及其远程日志 |

作业工具要求 Linux、Bash 和 Python Kernel。它使用独立控制 Kernel，用户的长时间 Python 计算不会阻塞作业管理。控制 Kernel 通过标准库创建独立进程组，日志和启动回执放在实例临时目录下本用户私有的会话子目录中。

```json
{"name":"jupyter_exec_start","arguments":{"session_id":"research","command":"python train.py","job_id":"train-run-01","wait_ms":1000}}
{"name":"jupyter_exec_read","arguments":{"session_id":"research","job_id":"train-run-01","cursor":0,"wait_ms":1000}}
```

同一个 `job_id`、相同命令参数的重复请求返回原作业，不重复启动。启动中断且没有完整回执时报告 `unknown`；不自动重试不确定的命令。取消前会核对进程启动时间、命令行中的作业目录和进程组，避免 PID 重用误伤其他进程。

客户端或 Kernel 退出不终止这些作业；实例停止、重建或临时目录回收可能使其丢失。输出不限制远程日志文件大小，应主动清理；最多保留 256 个作业记录。取消默认 SIGTERM，`force=true` 为 SIGKILL；继续查询直到确认终止，再 forget。

## JavaScript 接口

```js
import { InspireProvider } from '@yzxoi/qworks-mcp';
import { JupyterManager, createQworksMcpServer } from '@yzxoi/qworks-mcp/jupyter';

const manager = new JupyterManager({
  allowedRoots: [process.cwd()],
  resolveAccess: async notebookId => {
    const provider = new InspireProvider();
    return (await provider.getPrivateClient()).notebooks.getAccessUrls(notebookId);
  },
});
const session = await manager.open({ notebook_id: 'INSTANCE_ID' });
const result = await manager.execute({ session_id: session.session_id, code: 'print(42)', wait_ms: 1000 });
// manager.readExecution(...) / upload(...) / terminalOpen(...) / execStart(...)
await manager.close({ session_id: session.session_id, mode: 'shutdown' });
await manager.dispose();

// Full platform + Jupyter MCP factory. The original createInspireMcpServer
// remains available for callers wanting only the platform SDK tools.
const server = await createQworksMcpServer({ allowedRoots: [process.cwd()] });
await server.close();
```

## 验证

`npm test` 包含会话状态、文件边界和真实 stdio 协议测试。若本机安装了 `jupyter_server` 与 `ipykernel`，还会启动隔离的本地 Jupyter，验证持续执行、富输出、错误、中断/重启、二进制文件往返、PTY、跨进程恢复及清理。Linux 下额外验证后台作业。

```sh
python3 -m venv /tmp/qworks-jupyter-tests
/tmp/qworks-jupyter-tests/bin/pip install 'jupyter_server>=2,<3' 'ipykernel>=6,<7'
QWORKS_TEST_PYTHON=/tmp/qworks-jupyter-tests/bin/python QWORKS_REQUIRE_JUPYTER_TESTS=1 npm test
```

CI 在 Linux 强制运行真实 Jupyter 测试，不访问平台账户。部署特定的网关、Token 过期和实例回收仍应在目标平台验收。协议参考：[JupyterLab services](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.html)、[Jupyter REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)。
