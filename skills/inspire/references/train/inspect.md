## 详情查询

### 使用场景

仅用于分布式训练任务的只读详情查询：查看单个任务状态、等待任务可运行或结束、聚合训练任务事件、实例、工作目录，
以及在用户明确需要排障时读取必要日志。必须区分训练任务事件和训练实例事件，不要把两类事件混在一起回答。
使用 `train_inspect` Tool。具体可传字段以当前 Tool Schema 为准，不要向 Tool 传入当前 Schema 未暴露的字段。

### 快速流程

1. 明确目标任务的 job ID。如果用户只给了任务名称、关键字或模糊描述，先使用训练任务列表查询定位候选任务，再让用户确认准确任务。
2. 明确查询意图：只看详情、等待可运行、等待结束、查看训练任务事件、查看训练实例事件、查看实例、查看工作目录，
   或需要包含日志辅助排障。
3. 调用 `train_inspect`。默认只查询主体详情、训练任务事件和实例列表，不主动启用日志，也不把实例列表误当作实例事件。
4. 需要等待时，按用户语义选择 ready 或 completed；用户未要求等待时保持普通详情查询。
5. 返回任务名称、job ID、状态、资源与镜像摘要、实例概览、关键训练任务事件、工作目录和下一步建议；用户明确要求某个实例的事件时，
   只在当前能力确实支持实例事件查询后展示实例事件，不要倾倒无界 raw response。

### 时间展示

- SDK/Tool 输出中的 `createdAt`、`lastTimestamp`、`timestamp` 等时间字段是稳定机器字段，保持后端返回的原始 ISO、秒级 epoch
  或毫秒级 epoch；不要要求 Tool 把这些字段改写成中文或无时区字符串。
- 面向用户回答时，按用户指定时区或已知会话时区展示为 `YYYY-MM-DD HH:mm:ss` 并注明时区；未知时保留带时区的原值。
- 秒级时间戳先按秒解析，毫秒级时间戳按毫秒解析；不要把 `1690000000` 这类秒级值误当作毫秒。
- 事件、实例事件和日志摘要中出现 `timestamp`、`last_timestamp`、`created_at`、`updated_at` 等时间字段时，用户可见输出统一写成
  “`YYYY-MM-DD HH:mm:ss`：事件内容”或“时间：`YYYY-MM-DD HH:mm:ss`”。不要输出 `last_timestamp: 1690000000000`、
  `timestamp=1690000000` 这类原始时间戳字段。

### 任务状态展示

- 状态值以当前 Tool Schema、Tool 描述或实际返回中的稳定状态为准；不要自行编造 enum。
- Tool 的 `status` 字段命中下表时可返回中文展示名；未命中时必须回退原始状态值，不要统一折叠成“状态暂未识别”。
- 面向用户回答时，若 Tool 已返回中文展示名可直接使用；若返回的是未命中的原始状态值，应把该原值保留为排障线索。

| 状态值 | 展示名 |
| --- | --- |
| `job_creating` | 创建中 |
| `job_created` | 已创建 |
| `job_queuing` | 排队中 |
| `job_queue_out` | 排队超时 |
| `job_running` | 运行中 |
| `job_stopping` | 停止中 |
| `job_stopped` | 已停止 |
| `job_restarting` | 重启中 |
| `job_succeeded` | 已成功 |
| `job_failed` | 失败 |
| `job_fail_reserving` | 失败保留中 |
| `job_success_reserving` | 成功保留中 |
| `job_create_failed` | 创建失败 |
| `job_pre_checking` | 检测中 |
| `job_pre_check_failed` | 检测失败 |

### 实例状态展示

- 展示训练任务实例状态时，优先读取实例对象的 `instance_status` 字段，不要用任务状态字段替代实例状态。
- Tool 的实例 `status` 字段命中下表时可返回中文展示名；未命中时必须回退原始实例状态值，不要统一折叠成“未知状态”。
- `instance_status` 按下表 key 匹配展示名；匹配时大小写不敏感。面向用户回答时，未命中的原始实例状态值应作为排障线索保留。

| `instance_status` | 展示名 |
| --- | --- |
| `unknown_status` | 未知状态 |
| `instance_creating` | 创建中 |
| `instance_running` | 运行中 |
| `instance_stopping` | 停止中 |
| `instance_stopped` | 已停止 |
| `instance_failed` | 失败 |
| `instance_success` | 已成功 |
| `instance_success_reserving` | 成功保留中 |
| `instance_fail_reserving` | 失败保留中 |
| `Pending` | 排队中 |
| `Running` | 运行中 |
| `Succeeded` | 已成功 |
| `Failed` | 失败 |
| `Unknown` | 未知状态 |
| `Deleted` | 已删除 |

### 查询意图映射

#### 查看任务详情

- 已知 job ID 时直接查询。
- 未知 job ID 时先查询任务列表定位候选项；如果存在多个候选，展示少量关键信息并让用户确认，不要替用户选择。
- 不为了详情查询要求用户重复提供 workspace、project 或 logic compute group；详情查询以 job ID 为主。

#### 等待任务可运行

- 用户表达“等到运行”“等到 ready”“启动后告诉我”等意图时，使用 ready 等待语义。
- 等待超时不等于失败；返回已确认的最新状态、关键事件和可继续等待或查看日志的建议。

#### 等待任务结束

- 用户表达“等完成”“等训练结束”“看最终结果”等意图时，使用 completed 等待语义。
- 终态包括已成功、失败、已停止等后端定义的结束状态；不要自行编造终态 enum，也不要把终态枚举值写给用户。

#### 查看训练任务事件

- 训练任务事件的对象是 job，`object_ids` 必须使用训练任务的 job ID，例如 `job-00000000-0000-4000-8000-000000000000`。
- 当前 `train_inspect` 的 `event_page` / `event_page_size` 只表示训练任务事件分页，不表示训练实例事件。
- 底层语义对应 `ListJobEvents`，请求体应表达为 `object_type: "job"`，并按 `last_timestamp` 升序排序。示例：

```json
{
  "pageNum": -1,
  "pageSize": 10,
  "filter": {
    "object_ids": ["job-00000000-0000-4000-8000-000000000000"],
    "object_type": "job"
  },
  "sorter": [
    {
      "field": "last_timestamp",
      "sort": "ascend"
    }
  ]
}
```

- 默认查询任务事件第一页，按时间顺序提炼最近关键事件。
- 展示训练任务事件时，事件时间必须转换为 `YYYY-MM-DD HH:mm:ss`；不要展示原始 `last_timestamp`、`timestamp` 或其他时间戳字段名和值。
- 事件很多时只展示对判断任务状态有用的少量事件；用户要求更多时再按页继续查询。

#### 查看训练实例事件

- 训练实例事件也使用 `train_inspect`；不要改用其他未暴露接口，也不要回答“平台仅提供 Job 级事件、无单独实例事件接口”。
- 训练实例事件的对象是 instance，`object_ids` 必须使用训练实例 ID，例如 `job-00000000-0000-4000-8000-000000000000-worker-0`，
  不要使用训练任务 job ID。
- 当前 `train_inspect` 查询训练实例事件时，底层语义同样对应 `ListJobEvents`，但请求体必须表达为 `object_type: "instance"`，
  `object_ids` 必须使用训练实例 ID，并按 `last_timestamp` 升序排序。示例：

```json
{
  "page_size": -1,
  "page_num": 1,
  "filter": {
    "object_type": "instance",
    "object_ids": ["job-00000000-0000-4000-8000-000000000000-worker-0"]
  },
  "sorter": [
    {
      "field": "last_timestamp",
      "sort": "ascend"
    }
  ]
}
```

- 用户只说“看事件”且没有指定实例 ID 时，默认理解为训练任务事件；如果用户说“看 worker-0 的事件”“看某个实例事件”，
  先确认准确实例 ID。
- 用户明确要求实例事件时，必须按训练实例事件语义查询，不要用训练任务事件冒充实例事件，也不要把 job ID 填进 instance 事件的
  `object_ids`。
- 展示训练实例事件时，事件时间必须转换为 `YYYY-MM-DD HH:mm:ss`；实例状态只展示“实例状态展示”表中的展示名，不展示原始
  `instance_status` 枚举。

#### 查看实例

- 默认查询实例第一页，汇总实例数量、运行状态、节点、资源和异常信息。
- 实例概览里的状态只展示“实例状态展示”表中的展示名；不要展示 `instance_success`、`Running` 等原始枚举，也不要展示退出码，
  除非用户明确要求分析退出码。
- 不逐条输出大量实例；实例很多时先给概览，再询问是否继续查看下一页或特定实例。

#### 查看工作目录

- 如果返回工作目录，向用户展示可用于后续定位产物、日志或代码的业务路径。
- 不把工作目录误当成本地文件路径，也不要尝试绕过 Tool 直接访问后端或节点文件。

#### 查看日志

- 只有用户明确要求查看日志、任务异常、等待超时需要排障，或训练任务事件/实例概览不足以判断原因时，才启用日志。
- 日志输出必须截断和摘要化，优先提取错误栈、失败原因、最后若干条关键日志和建议动作。
- 不输出凭证、token、访问地址中的敏感参数或其他秘密；如日志疑似包含敏感信息，先脱敏再汇报。

### 参数要点

- `job_id`：必填，必须来自用户明确提供或经列表结果确认的准确 job ID。
- `wait_for`：普通查询使用 none；等待可运行使用 ready；等待终态使用 completed。
- `event_page` / `event_page_size`：训练任务事件分页。默认页大小可以使用当前 Schema 默认值，但对外只展示摘要；
  不要把它解释为训练实例事件分页。
- `instance_page` / `instance_page_size`：实例分页。默认页大小可以使用当前 Schema 默认值，但对外只展示概览。
- `include_instance_events`：默认 false。只有用户明确要求查看某个实例/worker 的事件时才设为 true。
- `instance_ids`：实例事件查询对象。必须使用训练实例 ID，例如 `job-00000000-0000-4000-8000-000000000000-worker-0`；
  不要传训练任务 job ID。
- `instance_event_page` / `instance_event_page_size`：训练实例事件分页。只在启用实例事件查询时传入，不要和训练任务事件分页混用。
- `include_logs`：默认 false；只有排障需要时才设为 true。
- `log_page` / `log_page_size`：日志分页。只在启用日志时传入，避免一次性读取过多日志。
- `poll_interval_ms` / `timeout_ms`：等待参数。用户未指定时使用当前 Tool 默认行为；用户给出自然语言时转换成毫秒。

### 示例参数

普通详情查询：

```json
{
  "job_id": "job-xxxxxxxx",
  "wait_for": "none",
  "event_page": 1,
  "event_page_size": 200,
  "instance_page": 1,
  "instance_page_size": 200,
  "include_logs": false
}
```

等待任务结束并包含少量日志：

```json
{
  "job_id": "job-xxxxxxxx",
  "wait_for": "completed",
  "include_logs": true,
  "log_page": 1,
  "log_page_size": 100,
  "timeout_ms": 600000
}
```

### 返回结果

先汇报任务名称、job ID、状态和是否已达到用户期望状态，再展示资源规格、镜像、节点/实例概览、关键训练任务事件、工作目录和必要日志摘要；
只有当前能力确实支持且用户明确请求时，才展示训练实例事件。任务状态只展示“任务状态展示”表中的展示名，实例状态只展示“实例状态展示”
表中的展示名；不要展示状态枚举值、退出码或括号补充的原始状态。所有用户可见时间都转换为 `YYYY-MM-DD HH:mm:ss`，
尤其是事件、实例事件和日志摘要时间，不要输出原始时间戳字段。失败或异常时给出最可能原因和下一步建议；信息不足时说明还需要查看哪类详情。
不要输出无界 raw response，不输出凭证、内部对象、内部规则集名称或内部工具名称。
