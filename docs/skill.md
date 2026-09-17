# Inspire Skill

`skills/inspire` 是可单独安装的 Agent Skill，指导客户端使用现有 MCP。Skill 提供工作流，MCP 提供实际工具；安装 Skill 不会安装 MCP、导入登录凭据或创建远程实例。

## 提取来源

QWorks `0.7.9.1176` 安装包以普通 Markdown 目录打包了 `server/inspire-skills/private/inspire` 和 `cloud/inspire`。桌面根据平台 edition 把对应目录复制到 Agent 的 skills 目录，并不需要专用 Skill SDK 或运行时解密。

本项目提取 Private 版，用于启智部署。保留入口及 9 个模块参考文件，覆盖登录/Context、镜像、Notebook、训练任务、HPC 和推理服务；另补充独立 MCP 的 Jupyter 参考文件和 Codex 展示元数据。Cloud 版涉及当前 Private 工具目录未提供的能力，未混入本 Skill。

这是有记录的适配版，不是上游文件的逐字镜像。变化包括：

- 清理具体型号示例，并把原文的具体环境 ID、节点名和查询示例改成合成占位值。
- 将已知授权的复用、客户端工具前缀和模块过滤行为写入入口，避免因换客户端重复询问或误判 capability。
- 修正 Notebook、HPC、Train 的镜像字段差异，以当前 SDK Schema 为依据；补充已实测的 Notebook 创建差异。
- 增加独立 `session_id`、Kernel/后台命令/PTY 选择、文件传输、重连和资源清理指导。
- 调整上游固定时区与展示偏好，移除未完成的参考笔记。

原始及适配后的文件摘要记录在 `vendor/inspire-skill-manifest.json`。原始未过滤文档不会写入仓库或安装包。代码与文档归属见 [NOTICE](../NOTICE.md)。

## 安装

先按 [README](../README.md) 配置 `qworks-mcp`。然后将整个 `skills/inspire` 目录复制到客户端的技能目录，不能只复制入口文件，否则模块引用会缺失。

Codex：本地 Codex 支持的用户技能目录为 `~/.codex/skills`，也可按客户端配置使用自己的技能根目录。

```sh
mkdir -p ~/.codex/skills
test ! -e ~/.codex/skills/inspire && cp -R skills/inspire ~/.codex/skills/inspire
```

Claude Code：

```sh
mkdir -p ~/.claude/skills
test ! -e ~/.claude/skills/inspire && cp -R skills/inspire ~/.claude/skills/inspire
```

这两条复制命令在同名目标已存在时不会覆盖它；更新时先比较已有版本。其他支持 Agent Skills 的客户端可导入同一个目录。Claude Code 的用户级和项目级位置见其 [Skills 文档](https://code.claude.com/docs/en/skills#choose-where-skills-load)。

重新加载客户端后，Codex 可用 `$inspire`，Claude Code 可用 `/inspire`，也可让客户端按描述自动选用。示例：

> 使用 inspire 连接我指定的启智实例，上传脚本，在后台运行并保留可续查的任务 ID。

默认 MCP 服务名为 `qworks`；客户端若使用其他名称，按实际工具目录匹配。仅安装 Skill 而未连接 MCP 时，Skill 不会获得远程执行能力。

## 维护

以下命令只供维护者更新或校验提取结果。运行时不需要 QWorks 安装包。

```sh
npm run extract:skill -- /path/to/inspire-skills/private/inspire
npm run extract:skill -- /path/to/inspire-skills/private/inspire --check
```

运行前须在环境中配置 `CONTENT_DENY_PATTERNS` 的正则数组，与仓库内容检查使用相同策略。提取器先校验固定版本的文件清单与全部源摘要，再在内存里适配、检查内容，最后写入；上游变更会拒绝执行，需要重新审查。`--check` 不写文件。

生成的 10 个文件应通过提取器修改；独立补充的 `references/jupyter.md` 和 `agents/openai.yaml` 单独维护。验证会检查摘要、引用能否解析、引用资源是否齐全，以及 Skill 中出现的 MCP 工具是否属于当前工具定义。
