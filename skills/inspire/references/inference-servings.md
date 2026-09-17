# Private Inference Serving 模块

## 模块目标

用 Private Inference Serving Tool 完成查询、查重、创建、等待、聚合诊断、更新、控制、回滚和删除。
只在当前 Catalog 暴露对应 Tool 时执行；字段、enum 与默认值以当前 Schema 为准。

## 使用前检查

- 复用已确认的登录与 Private Context；一次工作流内 workspace / project / LCG scope 一致。
- `project_ids`、`statuses`、`serving_types`、`keyword`、`mine` 是显式过滤器，不因 Context 有
  project 就自动填入。`mine=true` 才限制为我的服务。
- Tool 是否可见由 `/discovery` 决定。查规格都是 `GetLogicComputeGroupResourceSpecPrices`。缺 Tool 时停止。
- SDK：CUSTOM → `CreateServing`（`SpecId`+`Image`+`ImageType`，不传 `InferenceServingType`）；
  SERVERLESS → `CreateServingConsole`（类型 + 完整 `ResourceSpecPrice`）。Agent 只调
  `inference_servings_create`。Tool 会按 Discovery 只开放 Backend 实际支持的类型；Schema
  没有目标类型时停止，不要尝试绕过。
- 共用必填：`name`、`resource_spec_id`、`model_id`、`model_version`。CUSTOM 另必填
  `image_address`、`image_type`、`command`、`port`；SERVERLESS 禁止手动镜像和
  `command`。`MODEL_PLAZA` 若无 `model_source` 则停止。

## 创建前置依赖

顺序：类型 → 名称 → **项目** →（CUSTOM：优先级）→ 计算组 → 模型 →（CUSTOM：镜像/命令/端口）→ 规格 → 创建。
未确认类型和 serving 项目前禁止 `model_hub_list`，禁止先选模型再改项目。

1. **类型**：只说「部署」时先问 CUSTOM/SERVERLESS；大语言模型选 SERVERLESS。
2. **项目**：确认 `project_id`；`name` 小写字母开头，`[a-z0-9-.]`，≤32。CUSTOM 选手动优先级。
   确认 LCG；创建前 `inference_servings_list` 查重。
3. **模型**：`model_hub_list` 的类型与部署一致。无模型时先问用户；禁止选完模型后静默切项目。
4. **镜像与运行命令**（仅 CUSTOM）：先读 [Images 模块](images.md)。用户点名镜像时只按关键字查，
   不要加品牌过滤。未点名时：确认 LCG 后 `resource_specs_find` 取 `gpuBrand`，再
   `images_list(visibility=official, support_brand_list=[gpuBrand], brand_match_mode=prefer)`。
   未标注品牌的可用镜像会保留（affinity=unlabeled），不要当成不兼容。同一条
   `address`/`source` → `image_address`/`image_type`。多候选问用户。`command`/`port` 必填。
   `command` 需要读取平台挂载模型时必须用 `${MODEL_PATH}`，禁止猜 `/mnt/model`；
   不读取挂载模型的合法命令无需包含该占位符。端口建议 `${PORT}`。多实例还可用 `${LWS_GROUP_SIZE}` /
   `${LWS_WORKER_INDEX}` / `${LWS_LEADER_ADDRESS}` / `${LWS_WORKERS_ADDRESS}`。
   SERVERLESS 不选手动镜像。
5. **规格**：CUSTOM=`inference_serving`；SERVERLESS=`inference_serving_dynamic`。只从返回结果选 ID。

## 创建入参（FE → MCP）

| 控制台 | MCP | 注意 |
| --- | --- | --- |
| `mirror_id` | `image_address` + `image_type` | 仅 CUSTOM 创建；更新换镜像用 `mirror_id` |
| `command` | `command` | CUSTOM **必填**；引用挂载模型时用 `${MODEL_PATH}` |
| `resource_spec_price.quota_id` | `resource_spec_id` | 按类型选 purpose |
| HTTP 端口 | `port` | CUSTOM **必填** |
| `replicas` / `node_num_per_replica` | 同名 | SERVERLESS 固定 1 |

## Tool 与工作流

`inference_servings_list` 查重 → `model_hub_list` / `model_hub_inspect` / `model_hub_deployment_plan`
→ CUSTOM：`images_list` → `resource_specs_find` → `inference_servings_create`；
排障用 `inference_servings_inspect`；`inference_servings_update` 只需传变更字段（换镜像用
`mirror_id`），改 `command` 且需引用挂载模型时同样用 `${MODEL_PATH}`；Service 会按控制台
编辑逻辑补齐全量 `UpdateServing` 体；
`inference_servings_control` / `inference_servings_rollback` / `inference_servings_delete` 须授权。

## 返回结果

返回名称、ID、状态、版本、访问地址、副本摘要、关键事件和下一步；不倾倒 raw 或凭证。
