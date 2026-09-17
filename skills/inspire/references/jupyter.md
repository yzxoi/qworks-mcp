# 独立 Jupyter 连接层

本文件是独立适配器补充，不属于上游 Private Skill。仅使用当前客户端已暴露的工具；通常需要启用 `jupyter` 模块。

## 连接与恢复

- 用户已给出实例 ID 时直接 `jupyter_session_open(notebook_id=...)`，不要求用户重新选择 Context 或提供访问 Token。
- 只有名称时，用 `notebooks_list` 在已确认范围内定位；多个匹配且无法按用户条件区分时再询问。
- 实例未就绪时，通过 `notebooks_inspect` 检查状态，按已有授权决定是否启动并等待；不要重复创建实例。
- `jupyter_session_open` 返回独立 `session_id` 和实际能力。之后每次传同一个 ID，不能把 Notebook ID 当成会话 ID。
- 同一个会话只允许一个本地 MCP 进程打开；多个客户端通常各用自己的会话。同一实例可有多个相互独立的会话。
- 通过实例 ID 创建的会话在 MCP 重启后可只传原 `session_id` 恢复；直接 URL 会话需重新提供 URL。
- `jupyter_sessions_list` 查本地绑定；`jupyter_session_status` 查当前连接与资源；认证过期或连接中断可用
  `jupyter_session_reconnect` 重新取得访问地址。它不会自动重新执行未完成代码。

## 按任务选择执行方式

| 需要 | 工具 | 状态语义 |
| --- | --- | --- |
| 反复分析、保留 Python 变量 | `jupyter_execute` / `jupyter_execution_read` | 持续用户 Kernel |
| 跑脚本、编译、训练、取得退出码 | `jupyter_exec_start` / `jupyter_exec_read` | 独立后台进程和可恢复日志 |
| 交互式程序、连续输入、Ctrl-C | `jupyter_terminal_open` / `jupyter_terminal_write` / `jupyter_terminal_read` | 持续 PTY |

### 持续 Kernel

1. 调用 `jupyter_execute`，传 `session_id`、`code` 和有界 `wait_ms`。
2. 返回 `finished=false` 时保留 `execution_id`，用 `jupyter_execution_read` 继续等待或读取，传回 `next_cursor` 防止重复输出。
3. 同一 Kernel 保留变量和导入，一次只提交一个未完成执行。不要将每个代码块都放到新会话。
4. `jupyter_interrupt` 中断计算并通常保留变量；`jupyter_restart` 清空变量，不可混用。

`input()` 被禁用，需要持续输入时使用 PTY。`KERNEL_LOST` 表示原进程已消失，变量丢失；只有决定重新开始后才再次执行。
断线时 `state=unknown` 表示送达或完成情况不确定，不能自动重跑有副作用的代码。
Kernel 输出只在当前 MCP 进程内保留，恢复会话能找回仍在运行的 Kernel，但不会恢复此前 IOPub 历史。
输出截断时摘要说明；不要把 `truncated=true` 当作完整日志。

### 后台 Shell

- 使用 `jupyter_exec_start` 提交 `command`，按需提供 `cwd`、`env` 和唯一 `job_id`。要求实例支持 Linux、Bash 和 Python Kernel。
- 长任务保留 `job_id`，使用 `jupyter_exec_read` 和字节 `cursor` 续查。任务管理用独立控制 Kernel，不必等待用户 Kernel 空闲。
- 相同 `job_id` 与相同参数的重复请求返回已有任务；结果未知时先 read，不换一个 ID 重复 start。
- 检查 `finished`、`state` 和 `exit_code`，有输出不等于成功，等待到期不等于取消。
- 用户要终止时 `jupyter_exec_cancel`，继续 read 确认结束；仅必要且已授权时用 `force=true`。
- 作业结束且日志不再需要时 `jupyter_exec_forget` 清理远端临时文件；它拒绝删除运行中的作业。

后台命令可跨 MCP 重启和 Kernel 关闭继续运行，但不保证跨实例停止、重建或临时目录回收继续存在。

### 交互终端

- `jupyter_terminal_open` 新建独立终端，保留其 `terminal_id`。不要接管用户已有终端。
- `jupyter_terminal_write` 的 `input` 带 `\n` 才提交命令；`\u0003` 发送 Ctrl-C。成功发送不代表命令执行完成。
- `jupyter_terminal_read` 续读时带 `next_cursor` 和 `stream_id`；重连后可能换 stream，旧游标不可直接复用。
- 需要时 `jupyter_terminal_resize` 调整行列；结束用 `jupyter_terminal_close`。全屏程序可能返回 ANSI 控制序列，不能假定所有客户端都渲染成终端界面。

## 远程文件

- 列表、查看和小文本修改用 `jupyter_files_list`、`jupyter_files_read`、`jupyter_files_write`。
- 本地与远程传输用 `jupyter_upload` / `jupyter_download`，传路径即可；不要把文件内容编码后放进模型上下文搬运。
- 路径相对于 Jupyter Contents 根目录，不是任意系统绝对路径。创建一层目录用 `jupyter_files_mkdir`；移动与删除用
  `jupyter_files_move` / `jupyter_files_delete`。目录父级需已存在，不可删除 Contents 根目录。
- 本地路径须位于配置的 `--allowed-root` 内。文件传输上限 32 MiB，返回 SHA-256 可供校验。
- 默认不覆盖现有文件。需要替换时核对路径及现有授权，再传 `overwrite=true`；远端覆盖检查不是跨进程原子锁。
- 更大数据集优先让已授权的远程命令直接从数据源获取，而非重复尝试超限上传。

## 清理边界

区分三个层次：

1. `jupyter_session_close(mode="detach")` 或正常退出 MCP：只断开，保留 Kernel、终端、后台作业。
2. `jupyter_session_close(mode="shutdown")`：关闭该会话拥有的 Kernel 和终端；后台作业需单独取消。
3. `notebooks_control` 的停止操作：停止平台实例，影响实例上的其他会话和工作；只在用户确实要求时执行。

临时测试只清理自己创建的文件、Kernel、终端与作业；复用用户已有实例不代表获准停止它。汇报保留的 `session_id`、
`execution_id` 或 `job_id` 和最新状态，不输出 Token 或无界日志。
