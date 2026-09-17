# QWorks MCP

把 QWorks 中的 Inspire SDK 包装成独立的 JavaScript SDK 和标准 stdio MCP 服务，供 Codex、Claude Code 以及其他支持本地 stdio 的 MCP 客户端调用。

仓库已包含固定版本的 SDK 运行文件。**运行时不需要安装或启动 QWorks**，也不经过它的本地 HTTP 服务；登录后直接访问平台后端。只有维护者重新提取 SDK 时才需要对应版本的桌面安装包。

当前适配 QWorks `0.7.9.1176`，内嵌 SDK `0.1.15-dev.2`。这是非官方适配项目，采用 private 仓库管理，未发布到公共 npm。

## 安装

需要 Node.js **24.11 或以上版本**、npm，以及此私有仓库的读取权限。

```sh
git clone git@github.com:yzxoi/qworks-mcp.git
cd qworks-mcp
npm ci
npm run verify
npm run doctor
```

`doctor` 在本地验证 SDK 文件摘要、版本和工具定义数量，不读取登录凭据、不连接平台。

## 接入客户端

在仓库目录执行，命令会把当前绝对路径写入客户端配置。以下命令选择仓库目录为文件操作根目录，可以替换成自己的工作目录。

**Codex：**

```sh
codex mcp add qworks -- node "$PWD/bin/qworks-mcp.mjs" --allowed-root "$PWD"
```

也可以在 Codex 的 MCP 设置中添加 stdio 服务，或参照 [配置示例](docs/clients.md) 编辑配置。配置格式见 [Codex MCP 文档](https://developers.openai.com/codex/mcp/)。

**Claude Code：**

```sh
claude mcp add --transport stdio --scope user qworks -- node "$PWD/bin/qworks-mcp.mjs" --allowed-root "$PWD"
```

**其他客户端：** 使用 `node` 作为 command，将本仓库 `bin/qworks-mcp.mjs` 的绝对路径放入 args。若 GUI 客户端找不到 Node，请把 command 换成 `node` 可执行文件的绝对路径。仅支持 HTTP 的远程客户端需要另设网关；本项目当前只实现 stdio。

请直接启动 `node bin/qworks-mcp.mjs`；MCP 配置中不要用会额外输出启动信息的 npm 命令。

## 登录与凭据

默认使用独立凭据文件 `~/.qworks-mcp/credentials.json`。首次连接只提供三个认证工具：`inspire_login`、`inspire_login_status`、`inspire_logout`。

在客户端让助手调用：

```json
{
  "name": "inspire_login",
  "arguments": { "backend_base_url": "https://qz.sii.edu.cn" }
}
```

按返回结果完成浏览器 Device Flow 授权，再调用 `inspire_login_status` 查看状态。登录成功后 SDK 会根据平台能力刷新工具列表；如果客户端没有及时刷新，重新连接 MCP 服务即可。Device Flow 的完整首次登录交互尚未在此适配项目中端到端测试；已验证空凭据启动和已有有效会话下的只读调用。

需要沿用本人已有 SDK 身份时，显式指定凭据文件：

```sh
node bin/qworks-mcp.mjs --credentials "$HOME/.inspire/config.json"
```

也可用环境变量 `QWORKS_SDK_CREDENTIALS`。`--credentials` 优先于环境变量。共享文件中的登录刷新、退出和上下文更新会作用于同一身份；独立文件适合客户端之间隔离使用。

凭据留在用户本机，CLI 创建文件时采用仅当前用户可访问的权限掩码。仓库和安装包不包含任何账户凭据、工作空间快照或抓包文件。

## 提供哪些能力

固定版本包含 **41 个 Private 工具定义**；实际工具数量取决于登录状态、后端 discovery 和账号权限。在已有会话验证中提供了 **37 个工具**，这一数量不是所有部署的保证。

| 模块 | 用途 |
| --- | --- |
| `auth` | Device Flow、登录状态、退出 |
| `context`、`workspaces` | 选择空间、项目和逻辑计算组 |
| `resource_specs`、`images` | 查询资源规格和镜像 |
| `notebooks` | 开发机列表、创建、详情、访问和生命周期 |
| `train`、`hpc_jobs` | 训练与作业管理、准备、日志等 |
| `inference_servings` | 推理服务创建、配置、控制和回滚 |
| `model_hub` | 模型列表、详情和部署计划 |
| `api_keys` | 用户 API Key 管理 |

原有 SDK 的读写工具都保留，实际调用受平台账号权限和客户端审批设置约束。可以限制需要暴露的模块，例如：

```sh
node bin/qworks-mcp.mjs --modules context,notebooks,resource_specs,images
```

认证工具始终保留。`--modules` 是功能分组过滤，不是只读模式；`--allowed-root` 限制 SDK 的本地文件操作范围，不限制远端平台操作。

这份 SDK 不包含 QWorks 的所有桌面能力。例如桌面的 Jupyter 会话执行桥接、聊天和插件编排没有包装进来。项目目标是可独立运行的 SDK MCP。

## JavaScript SDK

可以在其他 Node 项目中通过本地路径安装：

```sh
npm install /absolute/path/to/qworks-mcp
```

```js
import { InspireProvider, getPrivateToolDefinitions } from '@yzxoi/qworks-mcp';

const provider = new InspireProvider(); // 默认使用适配器独立凭据文件
const state = await provider.loginStatus();
const tools = getPrivateToolDefinitions();

// 需要已登录的 Private 会话。
const client = await provider.getPrivateClient();
const workspaces = await client.api.invoke('workspace', 'ListWorkspaces', {
  PageNumber: 1,
  PageSize: 20,
});
```

还导出 `createInspireMcpServer`、`PrivateContext`、`privateActions`、`sdkVersion`、`zod` 和 `runtimeInfo`。这是固定版本运行时的适配接口，尚不承诺跨上游版本稳定。

## 维护与验证

```sh
npm run extract -- /path/to/QWorks/Resources/server/index.cjs
npm run extract -- /path/to/QWorks/Resources/server/index.cjs --check
npm run verify
```

提取器只接受 manifest 记录的源文件 SHA-256，通过 AST 依赖闭包提取所需声明，不执行桌面服务入口。遇到不同构建会直接报错，需要重新分析符号映射。`--check` 比较提取结果和已提交文件，不修改文件。

`npm run verify` 检查仓库内容并运行离线测试，包括真实 stdio 子进程的 MCP 初始化、工具发现、登录状态调用和 JSON Schema 转换。测试显式阻断网络，不使用真实凭据。CI 同时验证 Linux 环境下的运行；本地验证在 macOS 上进行。

内容检查覆盖 Git 跟踪文件和未忽略的新增文件，包含源代码、文档、锁文件、SDK 运行文件和文件名。默认检查个人机器路径及常见凭据格式；额外的禁止内容规则通过 `CONTENT_DENY_PATTERNS` 环境变量提供，格式为正则表达式字符串的 JSON 数组，并检查常见源码转义形式。CI 从同名仓库 secret 注入规则，缺少配置会失败，避免把禁止内容本身写进源码。它不扫描平台运行时返回的数据。

结构、提取边界和验证范围见 [架构说明](docs/architecture.md)。第三方代码归属见 [NOTICE](NOTICE.md)。
