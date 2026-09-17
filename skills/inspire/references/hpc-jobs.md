# Private HPC Job 模块

## 适用范围

HPC 是 CPU-only 的 Slurm 作业。用户需要 GPU、训练框架或训练任务语义时，改用 Train；不要把 HPC 当成通用训练入口。
参数、enum 和限制以当前 Tool Schema 为准，本文件只规定工作流和安全边界。

## 创建或复制

1. 确认 workspace、project、logic compute group Context，并用 `hpc_jobs_list` 按唯一名称查重。
2. 先调用 `hpc_jobs_prepare`，读取空间运行策略、工作目录、可用规格和创建约束；不要跳过其中的 warning。
3. 用 `images_list` 选择真实镜像，`address` 与 `source` 必须来自同一条记录；用
   `resource_specs_find` 并设置 `purpose=hpc`，选择同一 scope 下的 CPU 规格。
4. 当前创建只接受每 CPU 内存。`hpc.CreateJob` 走 OpenAPI 扁平字段（`Name` /
   `SpecId` / `Entrypoint` / `MemoryPerCpu` 等），不是 GetJob 回的 `JobName` + `SbatchScript`
   嵌套。通知、数据集、工作目录、最长运行时间当前 CreateJob 不接受，不要为了这些字段换
   Train 或改写请求；工作目录由项目默认分配，最长运行时间由空间策略约束。
5. 新建时调用 `hpc_jobs_create`；复制时提供 `copy_from_job_id`，只在 `overrides` 中写需要改变的字段。
   用户只要求提交时不要等待；明确要求“运行后/完成后告诉我”时才使用等待选项。

## 六类详情与排障

- `hpc_jobs_inspect` 一次聚合基本信息、实例、任务事件、资源指标、聚合日志和节点日志，并对辅助分支返回
  `partialErrors`。先看已有结果，不因一个诊断分支失败而否定已确认的主体状态。
- 资源指标按 Tool Schema 选择 CPU、内存、磁盘读写和 TCP 收发六类；时间范围必须有界。
- 大量日志落盘使用 `hpc_jobs_logs_download`；它会读取全部实例，并按任务起止时间加前后余量下载聚合日志。
  目标路径必须位于允许目录。不要要求 `inspect` 返回无界日志。

## 状态与高影响操作

- HPC Job 没有 start/retry。停止前确认当前状态允许停止；删除前确认已进入可删除终态，并再次核对准确 ID。
- `hpc_jobs_stop` 会中断计算，`hpc_jobs_delete` 会永久删除记录；必须有用户明确意图，不能按模糊条件批量执行。
- 权限与最终状态由 Backend 裁决；客户端状态守卫通过不代表一定有权限。

## 恢复与汇报

- 创建、停止或删除遇到网络中断、超时或 `outcome_unknown` 时，先用 list/inspect 核实结果，禁止立即重放。
- Tool 不可见或返回 capability 未公开时停止，不借用 Cloud、旧 V1 或其他模块模拟。
- 返回名称、job ID、状态、工作目录、关键诊断、下载文件和下一步；不输出凭证、无限日志或内部对象。
