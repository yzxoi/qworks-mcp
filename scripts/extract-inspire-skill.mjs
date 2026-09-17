import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { contentViolations } from './check-content.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = join(root, 'vendor/inspire-skill-manifest.json');
const sha = value => createHash('sha256').update(value).digest('hex');

function replace(text, pattern, replacement, label) {
  const output = text.replace(pattern, replacement);
  if (output === text) throw new Error(`Pinned skill transform did not match: ${label}`);
  return output;
}

export function adaptSkill(path, original) {
  let text = original;
  // Upstream examples include concrete environment IDs. Keep valid syntax with
  // explicitly synthetic identifiers instead of distributing those examples.
  text = text.replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi, '00000000-0000-4000-8000-000000000000');
  text = text.replace(/"node": "[^"]+"/g, '"node": "example-node"');
  text = text.replace(/"keyword": "[^"]+"/g, '"keyword": "example-training-job"');

  if (path === 'SKILL.md') {
    text = replace(text, /^description:.*$/m, 'description: 通过独立 qworks-mcp 操作启智平台：登录与环境选择、交互实例、训练和推理任务，以及 Jupyter 持续计算、远程文件、终端和后台命令。用于启智算力任务及已连接实例内的开发操作。', 'skill description');
    text = replace(text, '# Inspire Private\n', `# Inspire — 启智独立 MCP\n\n本 Skill 基于 QWorks 内置 Private 版本提取并适配。需要客户端已连接独立 qworks-mcp；无需安装或运行 QWorks。\n文中的工具名是基础名称，客户端可能显示服务名前缀；按当前工具目录匹配，不硬编码客户端前缀。\n\n## 独立版约定\n\n- 参数以当前工具 Schema 为准。示例 ID、节点名和地址均为占位示例，不可直接提交。\n- 先理解目标，复用已确认的 Context、资源选择和用户授权。“确认”指核对现有证据；目标与授权已清楚时直接执行，\n  不把参考文件中的确认步骤变成逐项重复询问。只询问影响结果的歧义、缺失信息或新增授权。\n- 普通列表先分页展示；用户明确要求完整查询时，在其范围内继续翻页，不必每页请求确认。\n- 身份、项目、资源和价格来自当前工具结果，不凭历史示例猜测。资源信息不完整时说明未知部分，\n  不把规格列表当作实时余量，也不把排队或等待超时当作创建失败。\n- 实例管理与实例内执行分开：notebooks 模块管理平台实例；jupyter 模块连接实例服务。\n  Jupyter 不替代平台登录、配额或实例启停权限。\n- 当客户端缺少 MCP 时先说明所需配置；安装 Skill 本身不会安装 MCP、登录平台或授予操作权限。\n\n`, 'entrypoint');
    text = replace(text, '- 只调用当前 MCP 实际暴露的 Tool。普通业务 Tool 不可见时，将其视为当前 Backend capability 未公开。', '- 只调用当前 MCP 实际暴露的 Tool。缺少工具时检查登录、模块过滤和 discovery；不能仅凭工具不可见断言后端永久缺少能力。', 'capability diagnosis');
    text = replace(text, '## 准备登录和 Context\n', '## 准备登录和 Context\n\n首次连接启智且没有已保存的 Backend 时，对 `inspire_login` 指定 `backend_base_url="https://qz.sii.edu.cn"`。\n默认使用 Device Flow，不索取用户密码。已知实例 ID 或已有 Jupyter URL 时，不要求先重建平台 Context。\n\n', 'login defaults');
    text = replace(text, '| 创建训练任务 |', '| 在实例内执行代码、操作文件或终端 | `jupyter` | 使用独立 `session_id`；按 Kernel、后台命令或 PTY 的语义选择工具 |\n| 创建训练任务 |', 'Jupyter routing');
    text = replace(text, '## 按需读取模块引用\n', '## 按需读取模块引用\n\n- 在实例内运行代码、上传下载、操作终端或管理后台命令前，读取 [Jupyter 连接层](references/jupyter.md)。\n', 'Jupyter reference');
  }

  if (path === 'references/images.md') {
    text = replace(text, /- 创建必须用\*\*同一条\*\*结果：[^\n]+\n/, '- 镜像 ID、地址与来源必须来自同一条可用结果。当前 SDK 中：Train/CUSTOM 创建用 `image_address` + `image_type`；\n  HPC 创建用 `image` + `image_type`；Notebook 创建用 `image_id` 或 `image_url`，没有 `image_type`。各模块字段不可混用。\n', 'image schema mapping');
    text = replace(text, '5. **多候选**：列出名称/地址/`brandAffinity` 让用户确认；禁止默默取第一条。', '5. **多候选**：按用户已给定的镜像、兼容性和资源条件筛选；仍有影响结果的歧义时列出少量候选询问，不任意取第一条。', 'image selection');
  }

  if (path === 'references/notebooks.md') {
    text += `\n## 独立 MCP 的连接方式与部署差异\n\n- Agent 需要运行代码、文件或终端时，读取 [Jupyter 连接层](jupyter.md)，直接调用\n  \`jupyter_session_open(notebook_id=...)\`；访问 URL 由 MCP 内部解析，不需要让模型传递 Token。\n- 当前固定 SDK 的 Notebook 镜像字段是 \`image_id\` / \`image_url\`；不要把 Train 的\n  \`image_address\` / \`image_type\` 套用到 Notebook。值仍须来自同一条实际镜像结果。\n- 当前启智部署实测拒绝创建请求的 \`description\`，即使固定 SDK Schema 暴露了该字段，创建时也应省略。\n- 当前部署创建需显式提交有效 \`task_priority\`；不要照搬详情中的内部优先级。低优先级测试接受值 \`1\`，\n  其他需求以当前平台可提交值和用户授权为准，不能把这一测试值当成所有部署的通用默认。\n- 停止 Kernel、关闭终端或断开会话均不等于停止平台实例；只在任务确实要求时调用平台控制工具。\n`;
  }

  if (path === 'references/train.md') {
    text = replace(text, /## 对外表达\n[\s\S]*?(?=## Tool 选择)/, '## 对外表达\n\n按用户需要汇报任务、状态、资源、关键日志和下一步。调试或接入 MCP 时可以展示工具名、参数名、原始状态及退出码。\n时间按用户指定时区或已知会话时区展示并注明时区；未知时保留带时区的原始时间，不假定所有用户处于同一时区。\n不要让展示风格妨碍诊断，也不要输出凭据或无界原始响应。\n\n', 'portable presentation');
  }

  if (path === 'references/train/create.md') {
    text = replace(text, /  2 副本 × 8×[^\n]+\n/, '  2 副本 × 每副本 8 张加速卡，表示共 16 张卡；费用也按 2 倍核算。若可用数不足，不要把该配置当成可立即运行。\n', 'generic resource example');
    text = replace(text, /6\. 核对同一 scope 的实际可用资源余量[\s\S]*?(?=8\. 调用)/, '6. 按单副本规格与副本数核算总资源和费用，并与用户给定预算、资源范围及已知余量核对。\n   无法确认实时余量时说明该限制，不把规格目录当作余量保证；仅当缺失信息会改变用户的资源决策时询问。\n7. 核对任务名称、框架、命令、镜像、规格和副本数。已有请求清楚授权该配置时直接创建；配置存在实质歧义或超出\n   已授权资源范围时再询问，不因为走到此步骤而重复索要同一授权。\n', 'creation authorization');
    text = replace(text, '- 不要创建会占满当前可用 GPU 的训练任务；即使总 GPU 数等于可用 GPU 数，也应先要求用户降低规格、减少副本数或明确确认保留余量策略。', '- 不擅自扩大用户授权的资源规模；只有占满余量会超出已授权范围或已知项目策略时，才需调整或确认。', 'resource scope');
    text = replace(text, '- 如果当前公开能力无法确认实际可用 GPU、节点或点券余量，停止创建并向用户说明需要先确认资源余量；不要只凭规格列表判断资源充足。', '- 当前能力无法确认实时余量时，明确可能排队或被后端拒绝；按用户已授权的配置和预算执行，不声称资源充足。', 'unknown availability');
  }

  if (path === 'references/train/inspect.md') {
    text = replace(text, '- 面向用户回答时，如需把时间转为可读文案，统一按 `Asia/Shanghai` 展示为 `YYYY-MM-DD HH:mm:ss`，不要依赖本机时区。', '- 面向用户回答时，按用户指定时区或已知会话时区展示为 `YYYY-MM-DD HH:mm:ss` 并注明时区；未知时保留带时区的原值。', 'time zone');
  }

  if (path === 'references/train/list.md') {
    text = replace(text, /\n### TODO\n[\s\S]*$/, '\n', 'remove unfinished upstream notes');
  }
  return text;
}

export function extractSkill(sourceRoot, { check = false, denyPatterns = [] } = {}) {
  if (!denyPatterns.length) throw new Error('Set CONTENT_DENY_PATTERNS before extracting the skill.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const inventory = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Skill source must not contain symlinks.');
      const path = prefix + entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), path + '/');
      else inventory.push(path);
    }
  }
  if (lstatSync(sourceRoot).isSymbolicLink()) throw new Error('Skill source must be a real directory.');
  walk(sourceRoot);
  if (JSON.stringify(inventory.sort()) !== JSON.stringify(manifest.files.map(x => x.path).sort())) throw new Error('Skill source inventory differs from the pinned build.');
  const outputs = manifest.files.map(file => {
    const source = readFileSync(join(sourceRoot, file.path));
    if (sha(source) !== file.sourceSha256) throw new Error(`Unsupported skill source revision: ${file.path}`);
    const text = adaptSkill(file.path, source.toString('utf8'));
    if (contentViolations(file.path + '\n' + text, denyPatterns).length) throw new Error(`Skill content policy failed: ${file.path}`);
    return { path: file.path, text, sourceSha256: file.sourceSha256, adaptedSha256: sha(text) };
  });
  // Validate every source and transformed result before writing any file.
  for (const output of outputs) {
    const target = join(root, 'skills/inspire', output.path);
    if (check) {
      if (readFileSync(target, 'utf8') !== output.text) throw new Error(`Extracted skill differs: ${output.path}`);
      if (manifest.files.find(x => x.path === output.path).adaptedSha256 !== output.adaptedSha256) throw new Error(`Skill manifest differs: ${output.path}`);
    } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, output.text); }
  }
  if (!check) writeFileSync(manifestPath, JSON.stringify({ ...manifest, files: outputs.map(({ text, ...metadata }) => metadata) }, null, 2) + '\n');
  return { edition: manifest.edition, qworksVersion: manifest.qworksVersion, files: outputs.length, check, contentPolicy: 'passed' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), check = args.includes('--check'), paths = args.filter(x => x !== '--check');
  if (paths.length !== 1) throw new Error('Usage: node scripts/extract-inspire-skill.mjs /path/to/inspire-skills/private/inspire [--check]');
  const denyPatterns = JSON.parse(process.env.CONTENT_DENY_PATTERNS || '[]');
  if (!Array.isArray(denyPatterns) || denyPatterns.some(x => typeof x !== 'string')) throw new Error('CONTENT_DENY_PATTERNS must be a JSON array of regex strings.');
  console.log(JSON.stringify(extractSkill(resolve(paths[0]), { check, denyPatterns }), null, 2));
}
