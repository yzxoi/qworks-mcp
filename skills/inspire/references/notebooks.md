# Private Notebook 模块

## 模块目标

使用 Private Notebook Tool 完成查询、查重、创建、等待、聚合诊断、获取浏览器访问地址、启停和删除。只在当前 MCP
Catalog 暴露对应 Tool 时执行；具体输入、状态 enum、默认值和返回结构读取当前 Tool 描述与 Schema。

## 使用前检查

- 复用根 Skill 已确认的登录状态和 Private Context。执行 scope 必须包含 workspace、project 和 logic compute group。
- 一次创建链路中保持相同 scope：查询规格与创建 Notebook 时，不要切换 Context 或混用另一组显式 scope。
- 使用 `images_list` 选择真实镜像，使用 `resource_specs_find` 并指定 `purpose=notebook` 选择规格，不猜测镜像或规格 ID。
- 将 `project_ids`、`owner_project_ids`、`statuses`、`keyword`、`mine` 等视为显式业务过滤器；不要因为 Context
  已有 project 就自动补入未指定的过滤器。
- Tool 不可见时停止工作流，说明当前 Backend capability 未公开；不要借用 Cloud Tool、旧 V1 或 Backend Action。

## Tool 选择

- 使用 `notebooks_list` 定位资源、创建前按名称和 scope 查重，或确认结果未知的创建请求。
- 使用 `notebooks_create` 创建 Notebook；仅在用户要求同步等待时启用其等待选项。
- 使用 `notebooks_inspect` 等待就绪或聚合读取 Notebook、事件和运行索引。
- 使用 `notebooks_access` 获取 RUNNING Notebook 的 Jupyter Lab 和 VS Code 浏览器访问地址。
- 使用 `notebooks_control` 启动或停止已确认的单个 Notebook。
- 使用 `notebooks_delete` 永久删除已确认的单个 Notebook。

## 区分开发环境地址与控制台详情页

- `notebooks_access` 只用于获取 Jupyter Lab 和 VS Code 开发环境地址，不代表交互式建模管理控制台详情页。
  用户明确说“详情页”“控制台页面”，或明确排除 Jupyter/VS Code 时，不要调用该 Tool 作为答案。
- 查找控制台详情页时按以下顺序执行，Notebook 业务响应是第一事实源：
  1. `notebooks_inspect` 可见且已知准确 Notebook ID 时，检查 `notebook` 及 `notebook.raw`，这对应 Notebook detail
     业务数据；只有名称等线索时，先用 `notebooks_list` 在相同 scope 精确定位，再 inspect 单个结果。
  2. inspect 结果未返回页面字段时，再检查 `notebooks_list` 中目标条目的稳定字段与 `raw`；列表接口可能提供详情接口
     没有的控制台 URL、相对 path、route、href 或 link 字段。
  3. `notebooks_inspect` 因其组合依赖的 capability 不可见、但 `notebooks_list` 可见时，用名称、关键词和相同 scope
     精确查询目标并检查列表条目。只有 ID 且 list 无法按 ID 精确定位时，说明当前能力限制，不做全量枚举。
  4. 只采用语义明确指向交互式建模控制台详情页的字段。完整 URL 可直接返回；相对路径只有在响应契约同时明确其控制台
     origin 或拼接规则时才能组合，不把 Jupyter、VS Code、IDE、API endpoint 或普通 Backend base URL 当成详情页。
  5. 可用的 list/detail 业务响应没有页面字段、且已有登录态的浏览器可用时，实际打开交互式建模列表，按准确 ID，或按
     名称加 scope 匹配目标，进入详情页后复制浏览器最终地址。
  6. 只有 Tool 与浏览器都无法提供链接时才停止：明确说明已检查哪些可用的 list/detail 返回及其未返回 URL 或路由字段，
     给出已确认的 Notebook 名称、ID、workspace 和 project，并请用户提供其正在使用的控制台入口。
- 不为寻找页面地址读取本地认证配置或提取 token，不携带凭证探测前端路径、后端路径或端口，也不搜索外网或反编译应用
  猜路由。Backend API base URL、APISIX/Keycloak 跳转和 HTTP 成功状态都不能证明控制台详情页路由。
- 用户在纠正“我要详情页，不是 Jupyter 页面”时，先承认地址类型判断错误，再执行上述有限检查并简洁回答。“停止”只
  禁止继续枚举文件、路由、端口或相似平台实现，不得跳过上述已有登录态浏览器的实际页面确认步骤。

## 标准工作流

1. 调用 `notebooks_list`，用有区分度的名称和当前 scope 查重。
2. 调用 `images_list` 选择镜像，再调用 `resource_specs_find` 并指定 `purpose=notebook` 选择真实规格。
3. 根据当前 `notebooks_create` Schema 组装输入，并在规格查询和创建中复用同一 scope。
4. 用户只要求提交时直接返回创建结果；用户要求等待可用时使用创建等待选项或 `notebooks_inspect`。
5. 创建后或异常时调用 `notebooks_inspect`，再决定是否需要控制操作。
6. 用户需要进入开发环境时，确认 Notebook 已 RUNNING 后调用 `notebooks_access`，将用户选择的 Jupyter Lab 或
   VS Code 地址返回给用户在浏览器打开。

## 等待与诊断

- 用户只要求创建时不要默认长时间等待；用户要求“运行后告诉我”时再等待 ready。
- 优先使用 `notebooks_inspect` 完成等待和诊断，不连续拼接多个底层查询。
- 等待超时时保留已确认的 Notebook ID 和最近状态，说明超时不等于创建失败，再给出继续检查建议。
- `notebooks_access` 返回 `available=false` 或两个 URL 都为空时，先检查状态；Notebook 未运行时按用户意图启动并等待
  ready，不猜测或拼接访问地址。

## 失败恢复

- 明确业务校验错误时，根据当前 Tool Schema 修正输入后再试。
- 网络中断、超时或 `outcome_unknown` 表示创建结果未知时，先用 `notebooks_list` 按唯一名称和 scope 查询，
  不立即重复调用 `notebooks_create`。
- 控制操作失败时先重新 `notebooks_inspect`，确认状态是否已变化，再决定是否重试。

## 高影响操作

- 调用 `notebooks_control` 前先 inspect 当前状态和准确 Notebook ID，只执行当前状态允许且用户明确要求的 `start` 或
  `stop`。
- `notebooks_delete` 是永久删除。执行前确认准确 ID、当前状态和用户明确授权；“清理异常 Notebook”不足以授权删除。
- 不批量控制或删除模糊匹配结果，不通过其他 Tool 模拟缺失的状态操作。
- Jupyter/VS Code 访问地址可能携带临时访问凭据，只返回给当前用户，不写入日志、长期缓存或无关对话。

## 返回结果

返回 Notebook 名称、ID、状态、关键运行信息、诊断摘要和建议的下一步。用户明确需要访问开发环境时，返回其选择的
Jupyter Lab 或 VS Code URL，并提醒直接在浏览器打开。用户需要控制台详情页时，只返回 Tool 明确提供或通过已登录浏览器
实际确认的地址；否则说明当前 Tool 不提供该地址，并给出控制台定位所需的已确认字段。说明 capability 或等待限制，不倾倒
无界 raw response，也不输出内部对象或访问地址之外的凭证。

## 独立 MCP 的连接方式与部署差异

- Agent 需要运行代码、文件或终端时，读取 [Jupyter 连接层](jupyter.md)，直接调用
  `jupyter_session_open(notebook_id=...)`；访问 URL 由 MCP 内部解析，不需要让模型传递 Token。
- 当前固定 SDK 的 Notebook 镜像字段是 `image_id` / `image_url`；不要把 Train 的
  `image_address` / `image_type` 套用到 Notebook。值仍须来自同一条实际镜像结果。
- 当前启智部署实测拒绝创建请求的 `description`，即使固定 SDK Schema 暴露了该字段，创建时也应省略。
- 当前部署创建需显式提交有效 `task_priority`；不要照搬详情中的内部优先级。低优先级测试接受值 `1`，
  其他需求以当前平台可提交值和用户授权为准，不能把这一测试值当成所有部署的通用默认。
- 停止 Kernel、关闭终端或断开会话均不等于停止平台实例；只在任务确实要求时调用平台控制工具。
