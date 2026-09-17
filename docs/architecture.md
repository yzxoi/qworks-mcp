# 架构与验证边界

```text
Codex / Claude Code / stdio MCP client
                │ JSON-RPC over stdin/stdout
                ▼
       bin/qworks-mcp.mjs
                │ configuration + transport
                ▼
          src/sdk.mjs
                │ digest check + stable named exports
                ▼
       vendor/inspire-sdk.cjs
                │ HTTPS + per-user authentication
                ▼
           platform backend
```

没有固定本地端口、会话证明计算或桌面进程依赖。SDK 直接访问部署后端，沿用其原有认证、上下文、请求序列化和能力发现逻辑。

## 提取方法

`scripts/extract-sdk.cjs` 固定一个源构建 SHA-256，再从 MCP 工厂、Provider、Private Context、工具定义、Action 映射和 Schema 库等已识别符号计算顶层依赖闭包。它保留命名空间初始化、枚举赋值和 Zod 的独立初始化语句，并按源顺序输出。

原始桌面服务的启动入口不进入输出。提取不会启动或修改 QWorks。manifest 保存源文件摘要、输出摘要、声明数和入口映射，不记录本机路径或登录信息。适配器每次加载 SDK 时验证输出摘要。

SDK 中静态出现的外部 AJV 模块在 package.json 显式声明；Node 内建模块由 Node 提供。MCP 的 stdio transport 由独立安装的官方协议 SDK 提供。

## 能力发现

Private 平台使用 `/discovery` 提供能力描述，随后调用 `/api/v2/{service}?Action={action}`。Service 名称与 URL 路径并不总是相同，应使用 SDK 的 Action 映射和序列化逻辑，避免自行把名称拼成路径。

固定版本有 41 个 Private 工具定义，工厂会依据会话状态和 discovery 动态筛选。定义存在不等于每个账号都可调用；平台继续执行权限检查。SDK 也保留了原有 Cloud 分支，但此适配项目主要围绕 Private 部署验证。

## 已验证

- 固定源文件可重复提取，生成相同 SDK 文件和 manifest。
- 运行文件的 SHA-256 与 manifest 一致。
- 41 个 Private 工具定义均能转为 JSON Schema。
- 空凭据场景：真实 stdio 初始化，列出三个认证工具并成功查询未登录状态，全程阻断网络。
- 当前适配器在有效已有会话下完成直接后端的只读空间查询，并完成认证后的 MCP 初始化、发现 37 个工具和查询登录状态。验证时仅允许指定只读请求；只保存统计结论，不提交账号结果。

## 尚未覆盖

- 所有写操作和所有业务接口的端到端验证。
- 本适配器的首次 Device Flow、长时间刷新与多进程共享身份压力测试。
- 新版桌面构建或其他平台部署的兼容性。
- 桌面专用的 Jupyter 执行会话、聊天、UI 插件能力。
- 远程 Streamable HTTP 网关及其多用户身份隔离。

离线 CI 不访问真实后端，因此只能证明安装、提取文件完整性和基础协议行为；不能替代部署后的业务验收。
