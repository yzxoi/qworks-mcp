---
name: inspire
description: 通过独立 qworks-mcp 操作启智平台：登录与环境选择、交互实例、训练和推理任务，以及 Jupyter 持续计算、远程文件、终端和后台命令。用于启智算力任务及已连接实例内的开发操作。
---

# Inspire — 启智独立 MCP

本 Skill 基于 QWorks 内置 Private 版本提取并适配。需要客户端已连接独立 qworks-mcp；无需安装或运行 QWorks。
文中的工具名是基础名称，客户端可能显示服务名前缀；按当前工具目录匹配，不硬编码客户端前缀。

## 独立版约定

- 参数以当前工具 Schema 为准。示例 ID、节点名和地址均为占位示例，不可直接提交。
- 先理解目标，复用已确认的 Context、资源选择和用户授权。“确认”指核对现有证据；目标与授权已清楚时直接执行，
  不把参考文件中的确认步骤变成逐项重复询问。只询问影响结果的歧义、缺失信息或新增授权。
- 普通列表先分页展示；用户明确要求完整查询时，在其范围内继续翻页，不必每页请求确认。
- 身份、项目、资源和价格来自当前工具结果，不凭历史示例猜测。资源信息不完整时说明未知部分，
  不把规格列表当作实时余量，也不把排队或等待超时当作创建失败。
- 实例管理与实例内执行分开：notebooks 模块管理平台实例；jupyter 模块连接实例服务。
  Jupyter 不替代平台登录、配额或实例启停权限。
- 当客户端缺少 MCP 时先说明所需配置；安装 Skill 本身不会安装 MCP、登录平台或授予操作权限。


## 在工作流层面操作

先理解用户要完成的业务目标，再选择最少的 Inspire MCP Tool。使用本 Skill 决定模块、调用顺序、等待、诊断和安全边界；
使用当前 Tool 的描述和输入 Schema 决定具体参数、enum、默认值和约束。不要根据本 Skill 猜测未展示的参数。

## 遵守当前公开的 capability

- 只调用当前 MCP 实际暴露的 Tool。缺少工具时检查登录、模块过滤和 discovery；不能仅凭工具不可见断言后端永久缺少能力。
- 不借用 Cloud Tool、旧 V1 路由或未暴露的 Backend Action，也不通过其他模块模拟缺失能力。
- 登录或 Context Tool 不可用时，按当前 MCP 错误提示恢复，不猜测内部接口。

## 准备登录和 Context

首次连接启智且没有已保存的 Backend 时，对 `inspire_login` 指定 `backend_base_url="https://qz.sii.edu.cn"`。
默认使用 Device Flow，不索取用户密码。已知实例 ID 或已有 Jupyter URL 时，不要求先重建平台 Context。


1. 需要平台访问时，先调用 `inspire_login_status`。未登录或凭证失效时调用 `inspire_login`，按返回提示完成授权；
   不传 edition，平台类型由 Backend 自动识别，探测失败时按 Private 继续登录。
2. 调用 `context_current` 检查 workspace、project 和 logic compute group。
3. 当前 Context 已满足任务时直接复用，不要无故重建。
4. Context 缺失或用户要求切换时，无参 `context_options` 返回全部 workspace，但只加载前 10 个可用
   workspace 的 project 和 logic compute group；`children_status=loaded` 的 workspace 优先，并继续按可用 LCG
   和最大健康节点数排序。
5. `workspace_id` 只是可选过滤，仅在需要缩小结果、只查看一个 workspace 时传入；不要把它当作获取子项的必需步骤。
6. `children_status=not_loaded` 表示空间过多而未加载子资源；需要查看时，使用该空间 ID 再调用
   `context_options(workspace_id=...)`，不要把空数组解释为没有 project 或 logic compute group。
7. 检查 `context_options` 的 `workspace_errors`；单个 workspace 的 project 或 logic compute group 加载失败时，
   Tool 会保留其他成功结果，不要把失败分支的空数组解释为该空间确定没有资源。
8. 调用 `context_build` 校验并保存选择；`logic_compute_group_id` 必须使用逻辑计算组 ID，不能使用物理
   Compute Group ID。
9. Tool 的显式 scope 只覆盖本次调用，不应无故修改持久 Context。

## 按用户目标选择模块

| 用户目标 | 优先模块 | 操作策略 |
| --- | --- | --- |
| 登录和选择环境 | `auth`、`context` | 构建 workspace、project、LCG 三元 Context |
| 选择运行资源 | `images`、`resource_specs` | 按任务 purpose 选择镜像与规格 |
| 使用交互式建模或 Notebook | `notebooks` | 查询、创建、检查、从 list/detail 响应判断控制台详情页字段、控制或删除 Notebook |
| 在实例内执行代码、操作文件或终端 | `jupyter` | 使用独立 `session_id`；按 Kernel、后台命令或 PTY 的语义选择工具 |
| 创建训练任务 | `train` | 查询、创建、检查、停止或删除训练任务 |
| 创建 HPC Job | `hpc_jobs` | 准备、查询、创建/复制、六类诊断、下载日志、停止或删除 HPC Job |
| 部署推理服务 | `inference_servings` | 查询、创建、检查、更新、控制、回滚或删除推理服务 |
| 从模型仓库部署 | `model_hub`、`inference_servings` | 检查模型和部署计划，再创建推理服务 |
| 管理当前用户 API Key | `api_keys` | 只在明确请求时 reveal 单个 Key |
| 排查异常 | 对应业务模块 | 优先调用聚合 `inspect` Tool |

## 按需读取模块引用

- 在实例内运行代码、上传下载、操作终端或管理后台命令前，读取 [Jupyter 连接层](references/jupyter.md)。

- 处理 Notebook 查询、创建、等待、诊断、访问地址、控制台详情页、启停或删除任务前，必须读取
  [Notebook 模块](references/notebooks.md)。
- 处理 Train 查询、创建、等待、诊断、停止或删除任务前，必须读取
  [Train 模块](references/train.md)。
- 处理 Inference Serving 查询、创建、等待、诊断、更新、控制、回滚或删除任务前，必须读取
  [Inference Serving 模块](references/inference-servings.md)。
- 处理 HPC Job 准备、查询、创建/复制、等待、诊断、日志下载、停止或删除任务前，必须读取
  [HPC Job 模块](references/hpc-jobs.md)。
- 一次任务涉及多个运行模块时，只读取并组合相关 reference；具体参数仍以当前 Tool 描述和 Schema 为准。

## 选择前置资源

- 选择镜像前读取 [Images 模块](references/images.md)：`images_list` 默认只展示可用镜像；`total` 用于翻页。
  不要默认官方可见性（仅 CUSTOM 推理且用户未指定来源时用官方）。品牌用 `prefer` 软偏好，未标注品牌
  仍可推荐。规格仍用 `resource_specs_find`。不猜测 ID、address、source。
- 从 Model Hub 部署时先确认模型版本和部署计划，不猜测兼容性或推荐配置。

## 执行工作流

### Model Hub 部署

1. 先读取 [Inference Serving 模块](references/inference-servings.md)：创建必须按
   部署类型 → 名称 → **项目** →（自定义：优先级）→ 计算组 → 模型 →（CUSTOM：镜像、运行命令、端口）→ 规格
   执行；Model Hub 不能单独完成创建。未确认部署类型和 serving 项目前，禁止 `model_hub_list`。
2. 用户确认 serving 项目后再 `model_hub_list`（`inference_serving_type` 与 CUSTOM/SERVERLESS
   一致）。当前项目无模型时先问用户：保持该项目并查 workspace，还是先改 serving 项目；禁止选完
   模型后再 `context_build` 切到模型所在项目。再用 `model_hub_inspect` 检查非失败版本。
3. 调用 `model_hub_deployment_plan` 获取兼容性和推荐部署配置；不要猜测。
4. CUSTOM：先读 Images 模块；用户点名则关键字搜索（不加品牌）；否则
   `images_list(visibility=official, support_brand_list=[gpuBrand], brand_match_mode=prefer)` +
   必填 `image_type`/`command`/`port` + `resource_specs_find(purpose=inference_serving)` 后 create。
   SERVERLESS：不选手动镜像/命令；`resource_specs_find(purpose=inference_serving_dynamic)` 后
   `inference_servings_create(inference_serving_type=SERVERLESS)`（底层 `CreateServingConsole`）。
5. Model Hub 或 create 所需 Tool 不可见、或目标为 Schema 未覆盖路径（如 `MODEL_PLAZA`）时停止
   并说明 capability 缺口，不尝试绕过。若 SERVERLESS 仍报 `unknown field
   "InferenceServingType"`，说明当前环境 `CreateServingConsole` 不可用，停止并反馈后端。

### API Key

先使用 `api_keys_list` 定位目标。只有用户明确要求查看单个 Key 明文时才调用 `api_keys_reveal`；不要把返回的
明文写入普通总结、日志或无关的后续 Tool 参数。调用 `api_keys_create` 或 `api_keys_delete` 前确认用途及准确目标。

## 处理状态、等待和诊断

- 用户只要求提交任务时不要默认长时间等待；用户要求“完成后告诉我”时使用 create/inspect 的等待能力。
- 按相应模块 reference 选择聚合 `inspect` Tool，避免为一次诊断连续调用大量底层 Tool。
- 辅助日志或指标查询失败时保留已确认的主体状态，并明确缺失的诊断部分。

## 安全重试

- 创建前按名称和 scope 查重，并使用具有区分度的名称。
- 明确业务校验错误可以修正输入后重试。
- 网络中断、超时或 `outcome_unknown` 表示结果未知时，先通过 list/get 按名称或 ID 查询，不要立即重复创建。

## 确认高影响操作

停止、删除、回滚、覆盖或 reveal 前确认准确资源 ID、当前状态和用户明确意图。用户只说“清理异常资源”时，先列出候选
并请求确认，不执行批量破坏性操作。

## 保护敏感信息

不在普通响应中输出 token、密码、完整 API Key 或凭证。必须返回敏感结果时说明其敏感性，只返回完成当前任务所需内容。
不要为了推断网页路由读取本地认证配置、提取登录 token 或携带凭证探测路径和端口；平台 Backend 地址不能作为控制台
页面地址的推导依据。

## 汇报有用结果

返回资源名称、ID、状态、关键地址、诊断摘要、capability 限制和建议的下一步。不要倾倒无界 raw response，也不要暴露
client、service、transport 或凭证等内部对象。
