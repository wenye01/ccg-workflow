# src (CCG TypeScript CLI)

> [根目录](../CLAUDE.md) > **src**

## 模块职责

`src/` 是 CCG Workflow CLI 的 TypeScript 实现。它负责注册 CLI 命令、读取配置、安装/更新模板、生成 commands/agents/prompts/skills/rules，并提供中英双语交互界面。

## 入口与命令

| 文件 | 角色 |
|------|------|
| `src/cli.ts` | CLI 主入口，创建 `cac('ccg')` 实例并调用 `setupCommands()` |
| `src/cli-setup.ts` | 注册 `ccg`、`ccg init`、`ccg update`，绑定语言与 action |
| `src/index.ts` | 库导出入口 |
| `src/commands/init.ts` | 3 步安装向导：API 提供方、模型路由、性能模式 |
| `src/commands/menu.ts` | 交互式主菜单 |
| `src/commands/update.ts` | 检查并重装最新工作流 |

## 安装链路

`installWorkflows()` 是安装主入口：

1. 校验 `templates/` 目录存在。
2. 安装 slash commands 到 `commands/ccg`。
3. 安装 agents 到 `agents/ccg`。
4. 安装模型 prompts 到 `.ccg/prompts`。
5. 安装 skills 与由 Skill Registry 生成的命令。
6. 安装 rules、output styles、codeagent-wrapper binary。
7. 写入 manifest，供卸载时只删除 CCG 管理的文件。

## 关键模块

| 文件 | 职责 |
|------|------|
| `utils/installer.ts` | 安装/卸载主流程、binary 管理、模板写入 |
| `utils/installer-data.ts` | 工作流注册表 |
| `utils/installer-template.ts` | 模板变量替换与路径替换 |
| `utils/manifest.ts` | 记录并卸载 CCG 管理的文件和 settings 条目 |
| `utils/config.ts` | 读取、写入、合并 CCG 配置 |
| `utils/paths.ts` | 全局/本地安装路径解析 |
| `utils/skill-registry.ts` | 读取 skill frontmatter 并生成命令 |

## 配置结构

`CcgConfig` 当前包含：

- `general`: 版本、语言、创建时间
- `routing`: 前端/后端/review 的模型路由
- `workflows`: 已安装工作流
- `paths`: commands、prompts、backup 路径
- `performance`: lite mode 与 Impeccable 安装偏好

## 模板变量

`injectConfigVariables()` 安装时处理这些占位符：

| 占位符 | 说明 |
|--------|------|
| `{{FRONTEND_PRIMARY}}` | 前端主模型 |
| `{{BACKEND_PRIMARY}}` | 后端主模型 |
| `{{FRONTEND_MODELS}}` | 前端模型 JSON 数组 |
| `{{BACKEND_MODELS}}` | 后端模型 JSON 数组 |
| `{{REVIEW_MODELS}}` | 审查模型 JSON 数组 |
| `{{ROUTING_MODE}}` | 协作模式 |
| `{{GEMINI_MODEL_FLAG}}` | 使用 Gemini 时注入 wrapper 参数 |
| `{{LITE_MODE_FLAG}}` | 轻量模式时注入 `--lite` |
