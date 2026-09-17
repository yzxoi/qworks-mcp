## 等待与诊断

- 只需等待任务可运行时使用 ready 语义；需要等待终态时使用 completed 语义，具体选项以 `train_inspect` Schema 为准。
- 优先使用 `train_inspect` 聚合诊断。只有排障确实需要时才启用日志，避免无界输出。
- 等待超时时保留已确认的 job ID、最近状态和已有诊断；超时不等于创建或运行失败。

## 失败恢复

- 遇到镜像相关 `InvalidParameter` 时，停止猜测，重新调用 `images_list` 并重新选择同一条结果的 `address` / `source`。
- 明确业务校验错误时，根据当前 Tool Schema 修正输入后再试。
- 网络中断、超时或 `outcome_unknown` 表示创建结果未知时，先用 `train_list` 按唯一名称和 scope 查询，
  不立即重复调用 `train_create`。
- 辅助日志读取失败时保留 `train_inspect` 已确认的主体状态，并说明缺失的诊断部分。

## 高影响操作

- 调用 `train_stop` 前先用 `train_inspect` 确认准确 job ID 和当前状态，只在用户明确要求且状态允许时停止。
- `train_delete` 是永久删除。执行前确认准确 job ID、当前状态和用户明确授权；“处理失败任务”不足以授权删除。
- 不批量停止或删除模糊匹配结果，不通过其他 Tool 模拟缺失的 retry 或其他状态操作。

## 返回结果

返回任务名称、job ID、状态、镜像与规格摘要、关键事件、诊断结论和建议的下一步。说明 capability 或等待限制，不倾倒
无界 raw response，也不输出凭证或内部对象。
