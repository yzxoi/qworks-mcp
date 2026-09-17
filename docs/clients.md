# 客户端配置

把示例中的 `/absolute/path/to/qworks-mcp` 和 `/absolute/path/to/workspace` 换成实际路径。如果路径包含空格，保持它是独立的字符串参数。

## Codex

在 `~/.codex/config.toml` 中加入：

```toml
[mcp_servers.qworks]
command = "node"
args = ["/absolute/path/to/qworks-mcp/bin/qworks-mcp.mjs", "--allowed-root", "/absolute/path/to/workspace"]
startup_timeout_sec = 60
tool_timeout_sec = 120
```

如需指定已有凭据，可增加：

```toml
[mcp_servers.qworks.env]
QWORKS_SDK_CREDENTIALS = "/absolute/path/to/credentials.json"
```

此服务通过 `inspire_login` 工具向平台登录，不使用 Codex 针对远程 MCP 服务的 OAuth 登录命令。配置依据：[Codex MCP 官方文档](https://developers.openai.com/codex/mcp/)。

## Claude Code 和通用 JSON 配置

支持 `mcpServers` 格式的客户端可使用以下配置。Claude Code 也可以用 README 中的 `claude mcp add` 命令。

```json
{
  "mcpServers": {
    "qworks": {
      "command": "node",
      "args": [
        "/absolute/path/to/qworks-mcp/bin/qworks-mcp.mjs",
        "--allowed-root",
        "/absolute/path/to/workspace"
      ]
    }
  }
}
```

需要多个文件访问根目录时重复添加 `--allowed-root` 参数。凭据配置是可选项；省略时使用独立的默认凭据文件。

## 分发与故障定位

当前分发方式为授权用户克隆私有 GitHub 仓库并执行 `npm ci`。也可在本地执行 `npm pack`，将生成的私有 tarball 交给有权限的使用者；包中包含运行时、适配器和说明，不包含开发测试和本地状态。`private: true` 会阻止 npm publish。

- **找不到 Node：** 将 command 换成 Node 可执行文件的绝对路径。
- **SDK integrity check failed：** 恢复固定版本 vendor 文件，或用受支持源文件重新提取。
- **只有三个工具：** 尚未登录，或会话需要重新授权。
- **已登录但缺少某个工具：** 检查模块过滤、平台 discovery 和账号权限，不同部署可能不同。
- **本地文件访问失败：** 将需要操作的目录加入 `--allowed-root`；该参数必须指向已有目录。
- **协议解析错误：** 直接启动 Node 入口，避免在 stdio 前面加会输出文字的 shell 包装器。

`node bin/qworks-mcp.mjs --doctor` 只输出版本和完整性信息，适合检查安装。不要把带账户信息的完整工具响应作为公开诊断记录。
