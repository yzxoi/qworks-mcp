## 列表查询

### 使用场景

仅用于分布式训练任务的只读查询：列表浏览、创建前查重、结果未知时确认是否已创建，以及其他需要先查询任务列表再继续操作的场景。
使用 `train_list` Tool。具体可传字段以当前 Tool Schema 为准，不要向 Tool 传入当前 Schema 未暴露的字段。

### 快速流程

1. 明确查询目标：只看用户本人创建的任务、查看工作空间内任务、按名称或关键字、状态、节点、创建时间、排序，或创建前查重。
2. 明确 `workspace_id`。如果用户未给出，先调用 `context_current` 查看当前空间；`workspaces_list` 可见时可用它
   获取用户可选择的工作空间列表并让用户选择，否则使用 `context_options` 的 `workspaces[].id`，不要替用户猜测 workspace。
3. 需要创建人或节点筛选时，优先让用户从可用选项中选择；候选项来源不明确时不要自行猜测。
4. 用户输入自然语言时间时，转换为毫秒级 Unix 时间戳后传入 `created_at_begin` / `created_at_end`。
5. 调用 `train_list`，默认分页从第一页开始且 `page_size` 使用 10；先展示当前页最多 10 条和 `total` 总数，让用户判断是否继续查询下一页。

### 查询意图映射

#### 本人创建的任务

- 内部调用优先使用当前 `train_list` Schema 的本人任务筛选能力查询当前用户任务；参数名和值只用于 Tool Call。
- 如果未来 Schema 暴露 `created_by`，只使用用户明确选择或已确认的 `user_id`，不要猜测。

#### 全部任务

- 内部调用按当前 `train_list` Schema 表达“非本人限定”的查询；参数名和值只用于 Tool Call。
- 仍必须限定明确的 `workspace_id`，避免跨工作空间误读。

#### 工作空间选择

- `workspace_id` 候选优先来自已暴露的 `workspaces_list` 返回的 `workspaces[].workspace_id`。
- `workspaces_list` 不依赖当前 Private Context 的 `workspace_id`；仅提取 `userWorkspaceList` 表示当前用户可选择的工作空间。
- 当 `workspaces_list` 未被 Discovery 暴露或不可用时，使用无参 `context_options` 返回的 `workspaces[].id` 选择空间。

#### 名称或关键字搜索

- 使用 `keyword`。
- 创建前查重时，把用户计划创建的任务名作为 `keyword`，并结合 `workspace_id`、必要的项目或时间范围缩小结果。

#### 状态查询

- 使用 `status`。
- 状态值以当前 Tool Schema、Tool 描述或实际返回中的稳定状态为准；不要自行编造 enum。
- 列表结果展示状态时，若返回状态命中下表，使用对应中文展示名；未命中时保留原始状态值，不要自行翻译。

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

#### 节点查询

- 已知节点名称时使用 `node`。
- 已知节点数字 ID 且当前 Schema 支持时使用 `node_id`。
- 节点必须来自用户选择或已确认的候选项，不要凭记忆拼写节点名。

#### 创建时间查询

- 使用 `created_at_begin` 和 `created_at_end`，单位必须是毫秒。
- 用户给出日期但未给具体时分秒时，按用户语义扩展为本地日期范围：开始为当天 `00:00:00.000`，结束为当天 `23:59:59.999`。
- 用户给出时间段时分别转换两端；只给开始或结束时，只传对应边界。

#### 其他字段查询

如果当前 `train_list` Schema 支持更多过滤字段，可以按用户明确条件传入，例如 `framework`、`project_ids`、
`owner_project_ids`。这些字段属于业务过滤器，不要因为名称相似就自动从 Context 推断。

### 分页与排序

- `page` / `page_num`：页码，从 1 开始。当前 Tool Schema 若使用 `page`，不要传 `page_num`。
- `page_size`：每页数量。默认使用 10；即使总数很多，也不要一次列出所有任务。
- 结果总数很多时，先汇报 `total` 总数和当前页最多 10 条任务；只有用户明确要求继续查看时，才按页查询下一批。
- `sorters`：数组，每项包含 `field` 和 `sort`。用户未指定排序时，默认按创建时间升序查询：`field` 使用 `created_at`，
  `sort` 使用 `ascend`。
- `field` 支持按当前接口能力排序，优先使用：`gpu_count`、`node_count`、`created_at`、`finished_at`、`running_time_ms`。
- `sort` 只使用 `ascend` 或 `descend`。

### 示例参数

```json
{
  "page": 1,
  "page_size": 10,
  "workspace_id": "ws-00000000-0000-4000-8000-000000000000",
  "keyword": "example-training-job",
  "node": "example-node",
  "created_at_begin": 1786291200000,
  "created_at_end": 1787587200000,
  "sorters": [
    {
      "field": "created_at",
      "sort": "ascend"
    }
  ]
}
```

### 返回结果

先汇报 `total` 总数，再展示当前页最多 10 条任务的任务名称、job ID、状态、创建人、节点、GPU 卡数、创建时间、
结束时间和执行时长等对下一步有用的信息。不要把所有任务一次性列出来；如需更多结果，询问用户是否继续查看下一页。
不要倾倒无界 raw response，不输出凭证或内部对象。

