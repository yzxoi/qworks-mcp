## 创建任务

### 使用场景

仅用于创建分布式训练任务：根据用户提供的训练名称、框架、启动命令、镜像、资源规格和可选运行配置提交任务，并在用户明确要求时等待任务进入运行状态。
使用 `train_create` Tool。创建前必须使用 `train_list` 查重，使用 `images_list` 选择真实镜像，使用 `resource_specs_find`
且指定 `purpose=train` 选择真实资源规格，并核对当前空间的可用资源余量。具体可传字段以当前 Tool Schema 为准，
不要向 Tool 传入当前 Schema 未暴露的字段。

### 快速流程

1. 明确创建目标：任务名称、框架、启动命令、镜像需求、资源规格需求、运行副本数、环境变量、数据集、保留时长、故障自愈和是否等待运行。
2. 确认 Private Context 已包含目标 workspace、project 和 logic compute group；如用户明确覆盖 scope，只用于本次创建，不修改持久 Context。
3. 准备有区分度的唯一任务名称，并调用 `train_list` 在目标 workspace/scope 内查重；存在同名或高度相似任务时先让用户确认是否继续。
4. 调用 `images_list` 获取镜像候选，必须从同一条镜像结果取 `address` 和 `source`，分别原样传给 `train_create` 的
   `image_address` 和 `image_type`。
5. 调用 `resource_specs_find`，`purpose` 使用 `train`，按用户需求选择真实规格；用户未明确指定资源时默认选择最小可用规格。
6. 按单副本规格与副本数核算总资源和费用，并与用户给定预算、资源范围及已知余量核对。
   无法确认实时余量时说明该限制，不把规格目录当作余量保证；仅当缺失信息会改变用户的资源决策时询问。
7. 核对任务名称、框架、命令、镜像、规格和副本数。已有请求清楚授权该配置时直接创建；配置存在实质歧义或超出
   已授权资源范围时再询问，不因为走到此步骤而重复索要同一授权。
8. 调用 `train_create` 创建任务；用户只要求提交时不要默认等待，用户要求“创建后等到运行”时才启用等待运行。
9. 创建返回未知、网络中断或超时时，先用唯一名称和 scope 调用 `train_list` 确认是否已创建，不要立即重复创建。

### 创建前检查

#### 名称与查重

- 任务名称必须有区分度，避免使用过于通用的名称。
- 创建前使用 `train_list` 按任务名称、目标 workspace 和必要的 project/time 范围查重。
- 查重结果命中相同名称、疑似重复或近期创建结果未知的任务时，先展示少量候选信息并让用户确认，不替用户判断是否重复提交。

#### 镜像选择

- 必须使用 `images_list` 选择真实镜像，不凭记忆拼写镜像地址。
- 必须取同一条镜像结果的 `address` / `source` 配对，分别原样用于 `image_address` / `image_type`。
- 不跨镜像记录拼接地址和来源，不把展示名、镜像 ID 或仓库提示误当作完整镜像地址。
- 遇到镜像相关 `InvalidParameter` 时，停止猜测，重新调用 `images_list` 并重新选择同一条结果的 `address` / `source`。

#### 资源规格选择

- 必须使用 `resource_specs_find` 且指定 `purpose=train`。
- 用户未明确指定资源规格时，默认按最小可用规格选择；GPU 训练优先选择最小 GPU 规格，CPU 训练按最小整体规格选择。
- 用户只说“最小可用”或“最小 GPU”时，可按当前 Tool Schema 的选择能力表达；用户提出明确 GPU、显存、节点或优先级需求时，
  优先用真实规格列表让用户确认。
- 创建前必须核对当前 workspace / project / logic compute group 的可用资源余量，按副本数折算总资源占用。示例：
  2 副本 × 每副本 8 张加速卡，表示共 16 张卡；费用也按 2 倍核算。若可用数不足，不要把该配置当成可立即运行。
- 不擅自扩大用户授权的资源规模；只有占满余量会超出已授权范围或已知项目策略时，才需调整或确认。
- 当前能力无法确认实时余量时，明确可能排队或被后端拒绝；按用户已授权的配置和预算执行，不声称资源充足。
- 只传选中规格的稳定 ID 给 `resource_spec_id`，不要把完整规格对象传给 `train_create`。

#### Scope 一致性

- `workspace_id`、`project_id`、`logic_compute_group_id` 属于执行 scope；显式值只影响当前调用，缺省时由 Service 回退当前 Private Context。
- 创建前查重、镜像选择、资源规格选择和最终创建应使用同一业务 scope，避免在不同 workspace/project/LCG 之间混用资源。
- 业务过滤器不要自动从 Context 推断，除非当前 Tool Schema 和模块规则明确要求。

### 参数要点

- `name`：必填，训练任务名称，创建前必须查重。
- `framework`：必填，训练框架或运行框架；使用用户明确提供或当前业务候选中的值，不自行编造。创建时如果框架是 PyTorch，必须传小写 `pytorch`。
- `command`：必填，容器启动后执行的训练命令；保持用户给出的命令语义，不擅自改写路径、参数或重定向。
- `image_address`：必填，必须来自 `images_list` 同一条结果的 `address`。
- `image_type`：必填，必须来自 `images_list` 同一条结果的 `source`；当前常见值包括 `SOURCE_OFFICIAL`、`SOURCE_PUBLIC`、
  `SOURCE_PRIVATE`，以当前 Schema 为准。
- `resource_spec_id`：必填，必须来自 `resource_specs_find(purpose=train)` 选中的真实规格；用户未指定时默认使用最小可用规格。
- `replicas`：可选，训练任务副本数；用户未指定时按 1 副本核算资源并在确认信息中说明，最终是否传参以当前 Schema 默认行为为准。
- `shared_memory_gi`：可选，共享内存大小；仅在用户需要或框架明确依赖时设置。
- `envs`：可选，环境变量键值对；不要写入 token、密码、完整 API Key 等敏感信息。
- `description`：可选，任务描述；可根据用户意图保持简短。
- `task_priority`：可选，任务优先级；只在用户明确指定或资源规格选择需要时传入。
- `auto_fault_tolerance`、`fault_tolerance_max_retry`、`fault_tolerance_retry_interval_sec`：可选，故障自愈相关设置；用户未要求时不主动启用。
- `max_running_time_ms`、`reserve_on_fail_ms`、`reserve_on_success_ms`：可选，按毫秒字符串表达运行上限和保留时长；自然语言时长需转换后再传入。
- `tb_summary_path`：可选，TensorBoard summary 路径；只在用户提供或明确需要时设置。
- `dataset_info`：可选，数据集信息；结构以当前 Schema 为准，不猜测字段。
- `enable_troubleshoot`：可选，排障能力开关；只在用户需要自动排障或任务策略要求时启用。
- `exclude_nodes`、`specified_nodes`：可选，节点约束；节点必须来自用户确认或可靠候选，不凭记忆拼写。
- `pre_check_items`、`runtime_attributes`、`is_public_path_readonly`、`enable_notification`：可选，按当前 Schema 和用户明确需求设置。
- `wait_ready`：可选，用户只要求提交时保持 false；用户要求创建后等到运行、启动成功后通知等语义时设为 true。
- `poll_interval_ms` / `timeout_ms`：可选，仅在启用等待或用户指定等待策略时传入。

### 示例参数

仅提交创建请求：

```json
{
  "name": "train-resnet50-20260826-1130",
  "framework": "pytorch",
  "command": "python train.py --config configs/resnet50.yaml",
  "image_address": "registry.example.com/team/pytorch:2.3.0-cuda12.1",
  "image_type": "SOURCE_PRIVATE",
  "resource_spec_id": "rs-xxxxxxxx",
  "replicas": 1,
  "envs": {
    "NCCL_DEBUG": "INFO"
  },
  "wait_ready": false
}
```

创建后等待进入运行状态：

```json
{
  "name": "train-llm-sft-20260826-1130",
  "framework": "pytorch",
  "command": "bash scripts/train_sft.sh",
  "image_address": "registry.example.com/official/pytorch:2.4.0-cuda12.4",
  "image_type": "SOURCE_OFFICIAL",
  "resource_spec_id": "rs-yyyyyyyy",
  "replicas": 2,
  "shared_memory_gi": 64,
  "max_running_time_ms": "86400000",
  "wait_ready": true,
  "timeout_ms": 600000
}
```

### 等待与后续检查

- `train_create` 的等待能力只用于等待任务进入运行状态；需要等待终态、查看事件、实例、工作目录或日志时，创建后使用训练详情查询。
- 等待超时不等于创建失败；返回已确认的 job ID、最新状态和可继续查看详情或日志的建议。
- 用户要求“训练完成后告诉我”时，创建后再按任务详情的 completed 等待语义处理，不把 ready 当作完成。

### 失败恢复

- 业务校验错误可根据错误提示和当前 Schema 修正输入后重试。
- 镜像错误必须重新查询镜像并使用同一条结果的 `address` / `source` 配对。
- 资源规格不可用时重新调用 `resource_specs_find(purpose=train)`，不要复用其他 purpose 或其他 workspace/LCG 下的规格。
- 网络中断、超时或返回结果未知时，先用唯一任务名称和 scope 调用 `train_list` 查询是否已创建；确认未创建且用户仍要继续时才再次创建。
- 如果创建成功但等待失败，保留已创建任务的 job ID，并建议继续查看详情、事件或日志；不要把等待失败描述成创建失败。

### 返回结果

创建成功后先汇报任务名称、job ID、当前状态、镜像摘要、资源规格摘要和是否已按用户要求等待到运行状态。若结果未知，
说明需要先按名称确认创建结果；若等待超时，说明最新状态和下一步建议。不要倾倒无界 raw response，不输出凭证、内部对象、
内部规则集名称或内部工具名称。
