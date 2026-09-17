# Private Train 模块

## 模块目标

使用 Private Train Tool 完成查询、查重、创建、等待、聚合诊断、停止和删除。只在当前 MCP Catalog 暴露对应 Tool 时执行；
具体输入、状态 enum、默认值和返回结构读取当前 Tool 描述与 Schema。

## 使用前检查

- 复用根 Skill 已确认的登录状态和 Private Context，并在一次工作流中保持 workspace、project 和 logic compute group
  scope 一致。
- 调用 `images_list` 选择真实镜像。必须取同一条结果的 `address` 和 `source`，分别原样用于当前 `train_create` Schema
  指定的 `image_address` 和 `image_type`，不得跨记录拼接或猜测。详见 [Images 模块](images.md)。
- 调用 `resource_specs_find` 并指定 `purpose=train`，只从返回结果选择真实资源规格。
- 创建前准备有区分度的唯一名称，并用 `train_list` 在目标 scope 内查重。
- Tool 不可见时停止工作流，说明当前 Backend capability 未公开；不要借用 Cloud Tool、旧 V1 或 Backend Action。

## 对外表达

按用户需要汇报任务、状态、资源、关键日志和下一步。调试或接入 MCP 时可以展示工具名、参数名、原始状态及退出码。
时间按用户指定时区或已知会话时区展示并注明时区；未知时保留带时区的原始时间，不假定所有用户处于同一时区。
不要让展示风格妨碍诊断，也不要输出凭据或无界原始响应。

## Tool 选择

- 使用 `train_list` 查询任务、创建前查重，或确认结果未知的创建请求。
- 使用 `train_create` 创建任务；仅在用户要求同步等待时启用其等待选项。
- 使用 `train_inspect` 等待 ready/completed，或聚合任务、事件、实例、工作目录和按需日志。
- 使用 `train_stop` 停止已确认且状态允许停止的单个任务。
- 使用 `train_delete` 永久删除已确认的单个任务。

## 标准工作流

1. 调用 `train_list`，用唯一名称和当前 scope 查重。
2. 调用 `images_list`，保存同一结果的 `address` / `source` 配对。
3. 调用 `resource_specs_find` 并指定 `purpose=train`，选择符合任务需求的规格。
4. 根据当前 `train_create` Schema 创建任务；用户只要求提交时不要默认等待。
5. 用户要求运行、完成或排障时调用 `train_inspect`，再根据状态决定下一步。

## 详细引用

- 列表查询、筛选、分页、状态展示和返回摘要：[train/list.md](train/list.md)。
- 详情、等待、事件、实例、工作目录、日志和时间展示：[train/inspect.md](train/inspect.md)。
- 创建任务、镜像和资源规格选择、资源余量确认、参数要点和创建失败恢复：[train/create.md](train/create.md)。
- 等待诊断、失败恢复、停止、删除和最终汇报：[train/operations.md](train/operations.md)。

## 入口约束

- 读取本文件后，按用户意图继续读取对应详细引用；不要只凭本入口猜测字段、状态或默认值。
- 创建前必须组合 `images_list`、`resource_specs_find` 和 `train_list` 完成真实资源选择与查重。
- 查询或排障优先使用 `train_inspect` 聚合状态、事件、实例、工作目录和必要日志。
- `train_stop` 和 `train_delete` 都是高影响操作，必须先确认准确任务和用户意图。
