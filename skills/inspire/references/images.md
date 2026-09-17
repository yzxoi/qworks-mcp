# Private Images 模块

## 模块目标

用 `images_list` 为 Train、HPC、Notebook、CUSTOM 推理选择真实镜像。不猜测地址或 source。

## 使用前检查

- 复用已确认的 Private Context；`registry_hint` 会自动带当前 workspace（及 LCG，若有）。
- 镜像 ID、地址与来源必须来自同一条可用结果。当前 SDK 中：Train/CUSTOM 创建用 `image_address` + `image_type`；
  HPC 创建用 `image` + `image_type`；Notebook 创建用 `image_id` 或 `image_url`，没有 `image_type`。各模块字段不可混用。
- 更新推理服务换镜像用 `mirror_id`，不要传 `image_address`。
- 默认 `success_only=true`：本页去掉不可用镜像。`total` 是后端目录总数（翻页用），不是本页
  `images.length`。`omitted` 是本页去掉的条数。本页为空但 `total>0` 时翻页。

## 选择策略

1. **不要默认官方**。Train / HPC / Notebook：用户点名用 `keyword`/`specific_name`；未点名则按可见
   范围列，不要先锁 `visibility=official`。
2. **仅 CUSTOM 推理**：用户未指定来源时才 `visibility=official`。
3. **点名优先**：用户说了镜像名时只用 `keyword`/`specific_name`，**不要**再带 `support_brand_list`，
   并覆盖 official/public/private/project 直到找到 SUCCESS 记录。
4. **品牌软偏好**：CUSTOM 可用规格 `gpuBrand` 作 `support_brand_list`，默认
   `brand_match_mode=prefer`。会保留：品牌匹配、通用（brand 空串）、**未标注**（supportBrands
   为空，许多可部署镜像如此）。返回 `brandAffinities`：matched > universal > unlabeled。
   **禁止**默认 `require`——后端硬过滤会漏掉未标注但仍可创建的镜像。
5. **多候选**：按用户已给定的镜像、兼容性和资源条件筛选；仍有影响结果的歧义时列出少量候选询问，不任意取第一条。
6. **推荐候选**：`model_hub_inspect` 仅作候选，须再 list 校验 SUCCESS 后才用。

## 失败处理

镜像 `InvalidParameter` 时停止猜测，重新 `images_list` 并重选同一条 `address`/`source`。
