---
description: '多模型协作执行 - 根据计划多模型直接实施 → 返回执行结果'
---

# Execute - 多模型协作执行

$ARGUMENTS

---

## 核心协议

- **语言协议**：与工具/模型交互用**英语**，与用户交互用**中文**
- **直接实施**：外部模型直接读写文件并返回 batch 执行结果
- **止损机制**：当前阶段输出通过验证前，不进入下一阶段
- **前置条件**：仅在用户对 `/ccg:plan` 输出明确回复 "Y" 后执行（如缺失，必须先二次确认）

---

## 多模型调用规范

**工作目录**：
- `{{WORKDIR}}`：**必须通过 Bash 执行 `pwd`（Unix）或 `cd`（Windows CMD）获取当前工作目录的绝对路径**，禁止从 `$HOME` 或环境变量推断
- 如果用户通过 `/add-dir` 添加了多个工作区，先用 `Glob` 定位候选目录、`Grep` 搜索任务关键词，以确定任务相关的工作区
- 如果无法确定，用 `AskUserQuestion` 询问用户选择目标工作区

**调用语法**（并行用 `run_in_background: true`）：

```
# 复用会话调用（推荐）- 直接实施（Implementation）
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend <{{BACKEND_PRIMARY}}|{{FRONTEND_PRIMARY}}> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"{{WORKDIR}}\" <<'EOF'
ROLE_FILE: <角色提示词路径>
<TASK>
需求：<任务描述>
上下文：<计划内容 + 目标文件>
</TASK>
OUTPUT: Execute the implementation directly and return the batch result summary.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})

# 新会话调用 - 直接实施（Implementation）
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend <{{BACKEND_PRIMARY}}|{{FRONTEND_PRIMARY}}> {{GEMINI_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'
ROLE_FILE: <角色提示词路径>
<TASK>
需求：<任务描述>
上下文：<计划内容 + 目标文件>
</TASK>
OUTPUT: Execute the implementation directly and return the batch result summary.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**角色提示词**：

| 阶段 | 后端 | 前端 |
|------|-------|--------|
| 实施 | `~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/architect.md` | `~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/frontend.md` |

**会话复用**：如果 `/ccg:plan` 提供了 SESSION_ID，使用 `resume <SESSION_ID>` 复用上下文。

**等待后台任务**（最大超时 600000ms = 10 分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：
- 必须指定 `timeout: 600000`，否则默认只有 30 秒会导致提前超时
- 若 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**
- 若因等待时间过长跳过了等待，**必须调用 `AskUserQuestion` 询问用户选择继续等待还是 Kill Task**
- ⛔ **前端模型失败必须重试**：若 {{FRONTEND_PRIMARY}} 调用失败（非零退出码或输出包含错误信息），最多重试 2 次（间隔 5 秒）。仅当 3 次全部失败时才跳过前端模型结果并使用单模型结果继续。
- ⛔ **后端模型结果必须等待**：{{BACKEND_PRIMARY}} 执行时间较长（5-15 分钟）属于正常。TaskOutput 超时后必须继续用 TaskOutput 轮询，**绝对禁止在后端模型未返回结果时直接跳过或继续下一阶段**。已启动的任务若被跳过 = 浪费 token + 丢失结果。

---

## 执行工作流

**执行任务**：$ARGUMENTS

### 📖 Phase 0：读取计划

`[模式：准备]`

1. **识别输入类型**：
   - 计划文件路径（如 `.claude/plan/xxx.md`）
   - 直接的任务描述

2. **读取计划内容**：
   - 若提供了计划文件路径，读取并解析
   - 提取：任务类型、实施步骤、关键文件、SESSION_ID

3. **执行前确认**：
   - 若输入为"直接任务描述"或计划中缺失 `SESSION_ID` / 关键文件：先向用户确认补全信息
   - 若无法确认用户是否已对计划回复 "Y"：必须二次询问确认后再进入下一阶段

4. **任务类型判断**：

   | 任务类型 | 判断依据 | 路由 |
   |----------|----------|------|
   | **前端** | 页面、组件、UI、样式、布局 | {{FRONTEND_PRIMARY}} |
   | **后端** | API、接口、数据库、逻辑、算法 | {{BACKEND_PRIMARY}} |
   | **全栈** | 同时包含前后端 | {{BACKEND_PRIMARY}} ∥ {{FRONTEND_PRIMARY}} 并行 |

---

### 🔍 Phase 1：上下文快速检索

`[模式：检索]`

**⚠️ 必须使用 `Glob` 和 `Grep` 快速检索上下文，禁止手动逐个读取文件**

根据计划中的"关键文件"列表，使用 `Glob` 定位文件、`Grep` 搜索关键符号，并用 `Read` 读取必要上下文。

**检索策略**：
- 从计划的"关键文件"表格提取目标路径
- 搜索覆盖：入口文件、依赖模块、相关类型定义
- 若检索结果不足，可追加 1-2 次递归检索
- **禁止**使用 Bash + find/ls 手动探索项目结构

**检索完成后**：
- 整理检索到的代码片段
- 确认已获取实施所需的完整上下文
- 进入 Phase 3

---

### 🎨 Phase 3：多模型直接实施

`[模式：实施]`

**根据任务类型路由**：

#### Route A: 前端/UI/样式 → {{FRONTEND_PRIMARY}}

**限制**：上下文 < 32k tokens

1. 调用 {{FRONTEND_PRIMARY}}（使用 `~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/frontend.md`）
2. 输入：计划内容 + 检索到的上下文 + 目标文件
3. OUTPUT: `Execute the implementation directly and return the batch result summary.`
4. **{{FRONTEND_PRIMARY}} 是前端设计的权威，其 CSS/React/Vue 实现为最终视觉基准**
5. ⚠️ **警告**：忽略前端模型对后端逻辑的建议
6. 若计划包含 `FRONTEND_SESSION`：优先 `resume <FRONTEND_SESSION>`

#### Route B: 后端/逻辑/算法 → {{BACKEND_PRIMARY}}

1. 调用 {{BACKEND_PRIMARY}}（使用 `~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/architect.md`）
2. 输入：计划内容 + 检索到的上下文 + 目标文件
3. OUTPUT: `Execute the implementation directly and return the batch result summary.`
4. **{{BACKEND_PRIMARY}} 是后端逻辑的权威，利用其逻辑运算与 Debug 能力**
5. 若计划包含 `BACKEND_SESSION`：优先 `resume <BACKEND_SESSION>`

#### Route C: 全栈 → 并行调用

1. **并行调用**（`run_in_background: true`）：
   - {{FRONTEND_PRIMARY}}：处理前端部分
   - {{BACKEND_PRIMARY}}：处理后端部分
2. 用 `TaskOutput` 等待两个模型的完整结果
3. 各自使用计划中对应的 `SESSION_ID` 进行 `resume`（若缺失则创建新会话）

**务必遵循上方 `多模型调用规范` 的 `重要` 指示**

---

### ⚡ Phase 4：结果收集

`[模式：收集]`

**Claude 等待外部模型返回 batch 执行结果**：

1. **等待结果**：用 `TaskOutput` 获取外部模型完整输出

2. **记录结果**：
   - 保存返回的 SESSION_ID / batch 标识
   - 汇总外部模型报告的修改文件、命令输出和完成状态

3. **失败处理**：
   - 若模型执行失败，按重试规则处理
   - 若重试后仍失败，向用户报告失败原因和已完成部分

---

### ✅ Phase 5：交付确认

外部模型执行完成后，向用户报告：

```markdown
## ✅ 执行完成

### 变更摘要
| 文件 | 操作 | 说明 |
|------|------|------|
| path/to/file.ts | 修改 | 描述 |

### 执行结果
- {{BACKEND_PRIMARY}}：<完成/失败/跳过>
- {{FRONTEND_PRIMARY}}：<完成/失败/跳过>

### 后续建议
1. [ ] <建议的测试步骤>
2. [ ] <建议的验证步骤>
```

---

## 关键规则

1. **直接实施** – 外部模型可直接读写文件
2. **结果返回** – 外部模型只需返回 batch 执行结果与变更摘要
3. **信任规则** – 后端以 {{BACKEND_PRIMARY}} 为准，前端以 {{FRONTEND_PRIMARY}} 为准
4. **最小变更** – 仅修改必要的代码，不引入副作用

---

## 使用方法

```bash
# 执行计划文件
/ccg:execute .claude/plan/功能名.md

# 直接执行任务（适用于已在上下文中讨论过的计划）
/ccg:execute 根据之前的计划实施用户认证功能
```

---

## 与 /ccg:plan 的关系

1. `/ccg:plan` 生成计划 + SESSION_ID
2. 用户确认 "Y" 后
3. `/ccg:execute` 读取计划，复用 SESSION_ID，执行实施
